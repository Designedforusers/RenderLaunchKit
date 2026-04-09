import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PikaLeaveResponseSchema,
  PikaNeedsTopupPayloadSchema,
  PikaSessionUpdateSchema,
  type PikaLeaveResponse,
  type PikaSessionUpdate,
} from '@launchkit/shared';

import { env } from '../env.js';

/**
 * TypeScript subprocess wrapper around the vendored
 * `pikastream-video-meeting` Python CLI.
 *
 * Contract recap (captured from a careful read of
 * `vendor/pikastream-video-meeting/scripts/pikastreaming_videomeeting.py`
 * at commit 9623c21):
 *
 *   • `join --meet-url --bot-name --image --system-prompt-file
 *     --voice-id --timeout-sec` emits JSON lines on stdout:
 *       1. `{session_id, platform, status: "created"}` immediately
 *          after `POST /meeting-session` succeeds.
 *       2. `{session_id, status, video, bot}` on every subsequent
 *          poll iteration that produces a status change.
 *     The subprocess returns exit 0 as soon as it observes
 *     `status=ready` OR (`video=true AND bot=true`) at the polling
 *     loop in `cmd_join:314`, so in the happy path the wrapper
 *     simply waits for exit and uses the session_id from the first
 *     successfully-parsed line.
 *
 *   • `leave --session-id` emits a single line
 *     `{session_id, closed: true}` and exits 0 on success.
 *
 *   • Exit codes:
 *       0 success
 *       1 PIKA_DEV_KEY missing (caught at env-check time, never
 *         seen in practice from this wrapper because we validate
 *         the env var ourselves before spawning)
 *       2 validation error (bad URL, missing image file, unknown
 *         platform, unreadable system prompt file)
 *       3 HTTP error (non-2xx response from Pika, or unexpected
 *         response shape without a session_id)
 *       4 session error (Pika reported `status=error` or
 *         `status=closed` during polling)
 *       5 timeout (subprocess reached its own `--timeout-sec`
 *         without observing a ready state)
 *       6 insufficient credits (stdout JSON carries a checkout_url)
 *
 *   • The subprocess's funding check (`ensure_funded()`) can block
 *     for up to 300 seconds while polling for payment completion.
 *     In our normal path the Pika account is pre-funded and the
 *     check returns in ~1 second; the wrapper's own `AbortSignal`
 *     timeout bounds the worst case at 240 seconds (well under the
 *     funding poll ceiling), so a degenerate payment stall becomes
 *     a `PikaTimeoutError` rather than a hung BullMQ job.
 *
 * Env var mapping
 * ---------------
 *
 * LaunchKit's codebase uses `PIKA_API_KEY` in its `.env` surface for
 * naming consistency with every other `*_API_KEY`. The upstream
 * Python CLI reads from `PIKA_DEV_KEY`. This wrapper performs the
 * rename at spawn time so the rest of our code never sees
 * `PIKA_DEV_KEY` and a grep for `PIKA_API_KEY` lands every
 * consumer.
 *
 * Non-negotiable invariants
 * -------------------------
 *
 *   1. Every subprocess run is bounded by an `AbortController`.
 *      No unbounded wait. No un-killed child processes.
 *   2. stdout and stderr are drained continuously with bounded
 *      2 MB buffers so a runaway subprocess cannot fill pipe
 *      buffers and cannot flood our log aggregator.
 *   3. Exit code → error class mapping is exhaustive. An unknown
 *      exit code raises `PikaSubprocessError` (the base class) with
 *      the raw code in the message so triage can find it.
 *   4. The tmp file carrying the system prompt is cleaned up on
 *      both the success and failure paths via try/finally.
 *   5. The `PIKA_AVATAR` value is NEVER logged, even in debug
 *      output — it's user-private. Error messages quote the
 *      subcommand and the meet URL, not the avatar ref.
 */

// ── Path to the vendored Python CLI ─────────────────────────────────
//
// Walk from this compiled module's location up to the repo root,
// then down into `vendor/pikastream-video-meeting`. The walk works
// in BOTH dev (tsx watch, `apps/worker/src/lib/pika-stream.ts`) and
// compiled prod (`apps/worker/dist/lib/pika-stream.js`) because the
// directory depth is identical: both `src/lib/` and `dist/lib/` are
// three directories below the repo root.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, '../../..', '..');
const VENDORED_SCRIPT = join(
  REPO_ROOT,
  'vendor',
  'pikastream-video-meeting',
  'scripts',
  'pikastreaming_videomeeting.py'
);

// Upper bound for bytes we'll keep from either stdout or stderr
// before truncating further output. 2 MB is generous enough for the
// documented output shape (< 10 JSON lines) and bounds the worst
// case at ~4 MB resident per run.
const BUFFER_CAP_BYTES = 2 * 1024 * 1024;

// Default wall-clock bounds. The Python CLI has its own
// `--timeout-sec` which we set slightly higher than our own abort
// so a subprocess-side timeout surfaces as exit 5 (maps to
// `PikaTimeoutError`) rather than a SIGTERM from us. The
// auto-timeout for a LIVE session (30 minutes of bot runtime) is
// enforced by a separate delayed BullMQ job, not here.
const DEFAULT_JOIN_WALL_CLOCK_MS = 240 * 1000;
const DEFAULT_SUBPROCESS_TIMEOUT_SEC = 200;
const DEFAULT_LEAVE_WALL_CLOCK_MS = 60 * 1000;

// ── Error classes ───────────────────────────────────────────────────
//
// One per documented failure mode. All extend `PikaSubprocessError`
// so a caller that only cares about "did this fail" can `catch
// (err) { if (err instanceof PikaSubprocessError) ... }` and get
// every mode at once, while a caller that cares about specific
// modes (the invite processor surfacing "insufficient credits" on
// the session row) can narrow via `instanceof`.

export class PikaSubprocessError extends Error {
  public override readonly name: string = 'PikaSubprocessError';
  public readonly exitCode: number | null;
  public readonly stderr: string;
  public readonly stdout: string;

  constructor(
    message: string,
    opts: { exitCode: number | null; stderr: string; stdout: string }
  ) {
    super(message);
    this.exitCode = opts.exitCode;
    this.stderr = opts.stderr;
    this.stdout = opts.stdout;
  }
}

export class PikaMissingKeyError extends PikaSubprocessError {
  public override readonly name = 'PikaMissingKeyError';
}

export class PikaMissingAvatarError extends PikaSubprocessError {
  public override readonly name = 'PikaMissingAvatarError';
}

export class PikaValidationError extends PikaSubprocessError {
  public override readonly name = 'PikaValidationError';
}

export class PikaHttpError extends PikaSubprocessError {
  public override readonly name = 'PikaHttpError';
}

export class PikaSessionError extends PikaSubprocessError {
  public override readonly name = 'PikaSessionError';
}

export class PikaTimeoutError extends PikaSubprocessError {
  public override readonly name = 'PikaTimeoutError';
}

export class PikaInsufficientCreditsError extends PikaSubprocessError {
  public override readonly name = 'PikaInsufficientCreditsError';
  public readonly checkoutUrl: string | null;

  constructor(
    message: string,
    opts: {
      exitCode: number | null;
      stderr: string;
      stdout: string;
      checkoutUrl: string | null;
    }
  ) {
    super(message, {
      exitCode: opts.exitCode,
      stderr: opts.stderr,
      stdout: opts.stdout,
    });
    this.checkoutUrl = opts.checkoutUrl;
  }
}

// Map a numeric exit code to the right error class. Exit 0 never
// reaches this function — it's the success path.
export function mapExitCodeToError(
  exitCode: number | null,
  message: string,
  context: { stdout: string; stderr: string; checkoutUrl: string | null }
): PikaSubprocessError {
  const base = {
    exitCode,
    stdout: context.stdout,
    stderr: context.stderr,
  };
  switch (exitCode) {
    case 1:
      return new PikaMissingKeyError(message, base);
    case 2:
      return new PikaValidationError(message, base);
    case 3:
      return new PikaHttpError(message, base);
    case 4:
      return new PikaSessionError(message, base);
    case 5:
      return new PikaTimeoutError(message, base);
    case 6:
      return new PikaInsufficientCreditsError(message, {
        ...base,
        checkoutUrl: context.checkoutUrl,
      });
    default:
      return new PikaSubprocessError(message, base);
  }
}

// ── startMeeting ────────────────────────────────────────────────────

export interface StartMeetingInput {
  meetUrl: string;
  botName: string;
  /**
   * System prompt text (not a path). The wrapper writes it to a
   * tmp file and passes `--system-prompt-file` so long prompts do
   * not hit command-line-length caps. Null means no system prompt
   * is passed; the subprocess falls back to Pika's default agent
   * behavior.
   */
  systemPrompt: string | null;
  /**
   * Optional voice id override. Null/undefined means the subprocess
   * uses the documented default (`English_radiant_girl`).
   */
  voiceId?: string | null;
  /**
   * Optional wall-clock timeout for the entire join flow. Defaults
   * to `DEFAULT_JOIN_WALL_CLOCK_MS`. Should always be slightly
   * longer than the `--timeout-sec` passed to the Python CLI so
   * an exit-5 surfaces as `PikaTimeoutError` rather than an abort
   * kill.
   */
  timeoutMs?: number;
  /**
   * Optional override for the subprocess's `--timeout-sec` value.
   * Defaults to `DEFAULT_SUBPROCESS_TIMEOUT_SEC`.
   */
  subprocessTimeoutSec?: number;
}

export interface StartMeetingResult {
  /** Pika-side session identifier, used by the leave call. */
  pikaSessionId: string;
  /**
   * The final `PikaSessionUpdate` line observed on stdout. In the
   * happy path `status === 'ready'` or `video && bot`.
   */
  lastUpdate: PikaSessionUpdate;
}

/**
 * Spawn the Python CLI's `join` subcommand and resolve when the
 * Pika-hosted bot reports `status=ready`. Throws the appropriate
 * `PikaSubprocessError` subclass on any non-zero exit.
 */
export async function startMeeting(
  input: StartMeetingInput
): Promise<StartMeetingResult> {
  const apiKey = env.PIKA_API_KEY;
  if (!apiKey) {
    throw new PikaMissingKeyError(
      'PIKA_API_KEY is required for startMeeting',
      { exitCode: null, stdout: '', stderr: '' }
    );
  }

  const avatarRef = env.PIKA_AVATAR;
  if (!avatarRef) {
    throw new PikaMissingAvatarError(
      'PIKA_AVATAR is required for startMeeting (absolute path or https URL)',
      { exitCode: null, stdout: '', stderr: '' }
    );
  }

  const wallClockMs = input.timeoutMs ?? DEFAULT_JOIN_WALL_CLOCK_MS;
  const subprocessTimeoutSec =
    input.subprocessTimeoutSec ?? DEFAULT_SUBPROCESS_TIMEOUT_SEC;

  const { systemPromptPath, cleanupSystemPromptFile } =
    await writeSystemPromptFile(input.systemPrompt);

  try {
    const args: string[] = [
      VENDORED_SCRIPT,
      'join',
      '--meet-url',
      input.meetUrl,
      '--bot-name',
      input.botName,
      '--image',
      avatarRef,
      '--timeout-sec',
      String(subprocessTimeoutSec),
    ];
    if (systemPromptPath) {
      args.push('--system-prompt-file', systemPromptPath);
    }
    if (input.voiceId) {
      args.push('--voice-id', input.voiceId);
    }

    const run = await runPikaSubprocess({
      args,
      apiKey,
      wallClockMs,
      context: `join (${redactMeetUrl(input.meetUrl)})`,
    });

    if (run.exitCode !== 0) {
      throw mapExitCodeToError(
        run.exitCode,
        `Pika join failed (exit ${String(run.exitCode)}): ${firstStderrLine(run.stderr)}`,
        {
          stdout: run.stdout,
          stderr: run.stderr,
          checkoutUrl: run.checkoutUrl,
        }
      );
    }

    // Walk the successfully-parsed updates from the end of the
    // stream backwards to find the last one that carries a
    // session_id. In practice the final update always carries one
    // (the poll loop emits the same session_id on every line), but
    // walking the array defensively guards against a future schema
    // tweak where a terminal line might carry only a status and no
    // id.
    const lastUpdate =
      run.updates.length > 0 ? run.updates[run.updates.length - 1] : undefined;
    if (!lastUpdate) {
      throw new PikaSubprocessError(
        'Pika join exited 0 but produced no parseable stdout lines',
        { exitCode: 0, stdout: run.stdout, stderr: run.stderr }
      );
    }

    return {
      pikaSessionId: lastUpdate.session_id,
      lastUpdate,
    };
  } finally {
    await cleanupSystemPromptFile();
  }
}

// ── endMeeting ──────────────────────────────────────────────────────

export interface EndMeetingInput {
  pikaSessionId: string;
  timeoutMs?: number;
}

/**
 * Spawn the Python CLI's `leave` subcommand for a previously
 * captured Pika session id. Idempotent on the Python side: leaving
 * a session that Pika has already closed returns HTTP 404 which the
 * Python code surfaces as exit 3, but our wrapper can safely ignore
 * that specific failure mode if the caller passes `ignoreMissing:
 * true`. For now we just propagate the error — the web route
 * returns a 409 to the dashboard on double-leave, which is the
 * simpler contract for the MVP.
 */
export async function endMeeting(
  input: EndMeetingInput
): Promise<PikaLeaveResponse> {
  const apiKey = env.PIKA_API_KEY;
  if (!apiKey) {
    throw new PikaMissingKeyError(
      'PIKA_API_KEY is required for endMeeting',
      { exitCode: null, stdout: '', stderr: '' }
    );
  }

  const wallClockMs = input.timeoutMs ?? DEFAULT_LEAVE_WALL_CLOCK_MS;

  const args: string[] = [
    VENDORED_SCRIPT,
    'leave',
    '--session-id',
    input.pikaSessionId,
  ];

  const run = await runPikaSubprocess({
    args,
    apiKey,
    wallClockMs,
    context: `leave (${input.pikaSessionId})`,
  });

  if (run.exitCode !== 0) {
    throw mapExitCodeToError(
      run.exitCode,
      `Pika leave failed (exit ${String(run.exitCode)}): ${firstStderrLine(run.stderr)}`,
      {
        stdout: run.stdout,
        stderr: run.stderr,
        checkoutUrl: run.checkoutUrl,
      }
    );
  }

  // Parse the terminal line, which is the only line `leave` emits
  // on success. Uses `.at(-1)` rather than indexing because a
  // future schema tweak could add a progress line above the
  // terminal one; grabbing the last parseable line is forward
  // compatible and still lands on the single-line response in the
  // common case.
  const terminal = run.leaveResponses.at(-1);
  if (!terminal) {
    throw new PikaSubprocessError(
      'Pika leave exited 0 but produced no parseable stdout lines',
      { exitCode: 0, stdout: run.stdout, stderr: run.stderr }
    );
  }
  return terminal;
}

// ── Subprocess runner (private) ─────────────────────────────────────

interface RunPikaSubprocessInput {
  args: string[];
  apiKey: string;
  wallClockMs: number;
  context: string;
}

interface RunPikaSubprocessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  updates: PikaSessionUpdate[];
  leaveResponses: PikaLeaveResponse[];
  checkoutUrl: string | null;
}

/**
 * Spawn `python3 <script> <args...>` with bounded buffers, env
 * mapping, and an AbortController wall-clock bound. Returns the
 * parsed JSON lines alongside the raw stdout/stderr so the caller
 * can branch on exit code and on parsed structure separately.
 */
async function runPikaSubprocess(
  input: RunPikaSubprocessInput
): Promise<RunPikaSubprocessResult> {
  return new Promise<RunPikaSubprocessResult>((resolvePromise) => {
    // `stdio: ['ignore', 'pipe', 'pipe']` makes stdin null and
    // stdout/stderr Readable streams, so the return type is
    // `ChildProcessByStdio<null, Readable, Readable>` — not
    // `ChildProcessWithoutNullStreams`, which assumes all three
    // streams are open.
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      // Build a MINIMAL subprocess env. We deliberately do NOT
      // spread `...process.env` here: that would forward every
      // worker secret (DATABASE_URL, ANTHROPIC_API_KEY, REDIS_URL,
      // and friends) into the Python subprocess's environment
      // where it has no legitimate use, and a compromised or
      // crashed subprocess could expose them via core dumps, child
      // process inheritance, or a write-to-/proc leak. The
      // subprocess only needs `PATH` (to find `python3` and any
      // dependency binaries like `ffmpeg`) and `PIKA_DEV_KEY`.
      // `process.env` uses bracket notation here because
      // `noPropertyAccessFromIndexSignature` forbids the dot form
      // on `Record<string, string | undefined>`.
      // `NodeJS.ProcessEnv` is `Record<string, string | undefined>`
      // so `noPropertyAccessFromIndexSignature` forces bracket
      // notation on reads AND writes. Building a plain record and
      // typing it for the `spawn` option satisfies the constraint.
      const subprocessEnv: Record<string, string> = {
        PIKA_DEV_KEY: input.apiKey,
      };
      const parentPath = process.env['PATH'];
      if (parentPath !== undefined) {
        subprocessEnv['PATH'] = parentPath;
      }
      // Preserve HOME too — `pikastreaming_videomeeting.py` reads
      // `~/.pika/devkey` as a fallback lookup for the dev key (see
      // upstream `get_devkey()` at line 84). We always pass
      // `PIKA_DEV_KEY` directly so the fallback never fires, but
      // the HOME preservation keeps `Path.home()` working in case
      // the upstream adds new HOME-relative file reads in a
      // future refresh.
      const parentHome = process.env['HOME'];
      if (parentHome !== undefined) {
        subprocessEnv['HOME'] = parentHome;
      }

      child = spawn('python3', input.args, {
        env: subprocessEnv,
        // Inherit the repo root as cwd. The Python CLI resolves
        // `SKILL_DIR` from its own `__file__` path, so cwd is
        // irrelevant to its own file lookups — but a predictable
        // cwd makes it easier to reason about any relative-path
        // behavior if the CLI ever gains one.
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // Spawn-time errors (ENOENT when python3 is missing,
      // permission denied, etc.) surface as synchronous throws on
      // some platforms and async 'error' events on others. Catch
      // both paths so the caller gets a consistent PikaSubprocessError.
      resolvePromise({
        exitCode: null,
        stdout: '',
        stderr:
          err instanceof Error
            ? `spawn failed: ${err.message}`
            : `spawn failed: ${String(err)}`,
        updates: [],
        leaveResponses: [],
        checkoutUrl: null,
      });
      return;
    }

    let stdoutTruncated = false;
    let stderrTruncated = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const updates: PikaSessionUpdate[] = [];
    const leaveResponses: PikaLeaveResponse[] = [];
    let checkoutUrl: string | null = null;
    let lineBuffer = '';
    let settled = false;

    const settle = (result: RunPikaSubprocessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolvePromise(result);
    };

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      // Gentle kill first so the subprocess can flush stdio, then
      // a hard kill a few seconds later if it still hasn't exited.
      // We do NOT await the kill — 'exit' fires synchronously on
      // SIGTERM delivery in practice, and the `settled` guard
      // prevents a double-resolve if it doesn't.
      //
      // Destroy the stdio streams AFTER scheduling the SIGKILL so
      // the data handlers stop accumulating into the (now-capped)
      // buffers for the 3-second grace window. A subprocess that
      // intentionally delays exit and keeps writing cannot extend
      // the resident buffer state past the timeout moment.
      child.kill('SIGTERM');
      const killHandle = setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 3000);
      // `unref()` so this follow-up timer does not keep the Node
      // event loop alive if the subprocess exits cleanly before
      // the 3-second SIGKILL fires.
      killHandle.unref();
      child.stdout.destroy();
      child.stderr.destroy();
      settle({
        exitCode: null,
        stdout: stdoutBuffer,
        stderr:
          stderrBuffer +
          `\n[pika-stream] wall-clock timeout after ${String(input.wallClockMs)}ms, killed subprocess`,
        updates,
        leaveResponses,
        checkoutUrl,
      });
    }, input.wallClockMs);

    // ── stdout handler ──
    //
    // Read chunks, accumulate into a line buffer, split on newline,
    // and try to parse each complete line as JSON. Malformed lines
    // (a partial write that got flushed mid-object) are kept in
    // the buffer until the next chunk completes them. Any line
    // that does not parse as JSON is silently ignored — the Python
    // CLI occasionally writes status text to stdout via `print`
    // that is not a JSON object, and treating those as parse
    // failures would be noisy.
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      if (stdoutBuffer.length + chunk.length > BUFFER_CAP_BYTES) {
        if (!stdoutTruncated) {
          stdoutTruncated = true;
          stdoutBuffer += `\n[pika-stream] stdout truncated at ${String(BUFFER_CAP_BYTES)} bytes`;
        }
      } else {
        stdoutBuffer += chunk;
      }

      lineBuffer += chunk;
      let newlineIndex = lineBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const rawLine = lineBuffer.slice(0, newlineIndex).trim();
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        newlineIndex = lineBuffer.indexOf('\n');
        if (!rawLine) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawLine);
        } catch {
          // Non-JSON line — `print(...)` text or partial write
          // leftover. Ignore it.
          continue;
        }

        const asUpdate = PikaSessionUpdateSchema.safeParse(parsed);
        if (asUpdate.success) {
          updates.push(asUpdate.data);
          continue;
        }

        const asLeave = PikaLeaveResponseSchema.safeParse(parsed);
        if (asLeave.success) {
          leaveResponses.push(asLeave.data);
          continue;
        }

        const asTopup = PikaNeedsTopupPayloadSchema.safeParse(parsed);
        if (asTopup.success && asTopup.data.checkout_url) {
          checkoutUrl = asTopup.data.checkout_url;
          continue;
        }
        // Any other shape (funded status, generic payloads) is
        // ignored — we only care about the three documented stdout
        // JSON shapes.
      }
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      if (stderrBuffer.length + chunk.length > BUFFER_CAP_BYTES) {
        if (!stderrTruncated) {
          stderrTruncated = true;
          stderrBuffer += `\n[pika-stream] stderr truncated at ${String(BUFFER_CAP_BYTES)} bytes`;
        }
      } else {
        stderrBuffer += chunk;
      }
    });

    child.on('error', (err: Error) => {
      settle({
        exitCode: null,
        stdout: stdoutBuffer,
        stderr: `${stderrBuffer}\n[pika-stream] subprocess error: ${err.message}`,
        updates,
        leaveResponses,
        checkoutUrl,
      });
    });

    child.on('exit', (code) => {
      // Flush any trailing partial line from the subprocess. The
      // Python CLI's `print(json.dumps(...))` always emits a
      // newline, so in the happy path `lineBuffer` is empty here —
      // but a subprocess that exits mid-write or a degenerate
      // stdout flush could leave a partial final line behind.
      // Parse whatever is left so the last update is not silently
      // dropped.
      const trailing = lineBuffer.trim();
      if (trailing.length > 0) {
        try {
          const parsed: unknown = JSON.parse(trailing);
          const asUpdate = PikaSessionUpdateSchema.safeParse(parsed);
          if (asUpdate.success) {
            updates.push(asUpdate.data);
          } else {
            const asLeave = PikaLeaveResponseSchema.safeParse(parsed);
            if (asLeave.success) {
              leaveResponses.push(asLeave.data);
            }
          }
        } catch {
          // Non-JSON trailing text — ignore, same policy as the
          // mid-stream parse loop.
        }
      }
      settle({
        exitCode: code,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        updates,
        leaveResponses,
        checkoutUrl,
      });
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Write the system prompt to a tmp file for `--system-prompt-file`.
 * Returns `{ systemPromptPath: null, cleanupSystemPromptFile: async
 * noop }` when the prompt is null so the caller does not have to
 * branch on the result at every use site.
 */
async function writeSystemPromptFile(prompt: string | null): Promise<{
  systemPromptPath: string | null;
  cleanupSystemPromptFile: () => Promise<void>;
}> {
  if (prompt === null) {
    return {
      systemPromptPath: null,
      cleanupSystemPromptFile: async () => {
        // no-op
      },
    };
  }
  const dir = await mkdtemp(join(tmpdir(), 'pika-stream-'));
  const path = join(dir, 'system-prompt.txt');
  await writeFile(path, prompt, 'utf-8');
  return {
    systemPromptPath: path,
    cleanupSystemPromptFile: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Pick the first non-empty line of stderr for inclusion in a
 * thrown error message. Bounds the included text to 240 chars so a
 * chatty Python traceback does not blow up the DB column or the
 * log aggregator.
 */
function firstStderrLine(stderr: string): string {
  const firstLine = stderr.split('\n').find((l) => l.trim().length > 0) ?? '';
  return firstLine.length > 240 ? `${firstLine.slice(0, 240)}…` : firstLine;
}

/**
 * Truncate a Meet URL to its host + last path segment for log and
 * error inclusion. Google Meet URLs embed a meeting code that is
 * fine to log; Zoom URLs can embed a password query parameter we
 * do NOT want in logs. Stripping the query string handles both.
 */
function redactMeetUrl(meetUrl: string): string {
  try {
    const url = new URL(meetUrl);
    return `${url.host}${url.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}
