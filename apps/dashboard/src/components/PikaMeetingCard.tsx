import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, type PikaMeetingSession } from '../lib/api.js';

/**
 * Dashboard card for the Pika video-meeting integration.
 *
 * Renders below the asset gallery on the project detail page.
 * The card is the entire user-facing surface for:
 *
 *   1. Inviting the AI teammate into a Google Meet (opens a modal
 *      that takes a meet URL + optional bot name).
 *   2. Polling the session list every 5s while any row is in a
 *      non-terminal state so the dashboard sees the
 *      pending → joining → active → ending → ended transitions
 *      without an SSE subscription.
 *   3. Ending an active meeting with a single click.
 *   4. Showing a history of recent sessions with per-session cost
 *      and error messages.
 *
 * The card never "owns" session state — every mutation goes through
 * the HTTP API which persists to `pika_meeting_sessions`. The local
 * `useState` list is a projection of the server state refreshed on
 * mount, on poll tick, and on every mutation's response.
 */

const ACTIVE_STATUSES: ReadonlyArray<PikaMeetingSession['status']> = [
  'pending',
  'joining',
  'active',
  'ending',
];

const POLL_INTERVAL_MS = 5000;

interface PikaMeetingCardProps {
  projectId: string;
}

export function PikaMeetingCard({ projectId }: PikaMeetingCardProps) {
  const [sessions, setSessions] = useState<PikaMeetingSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await api.listProjectMeetings(projectId);
      // The shared schema types `startedAt`, `endedAt`, `createdAt`,
      // `updatedAt` as `Date` (via `z.date()`) but HTTP-serialized
      // values arrive as strings after `JSON.parse`. The server
      // schema validates `z.date()` which coerces ISO strings to
      // Date objects during safeParse — so after the
      // schema-validated `request()` helper runs, we have Date
      // instances end-to-end.
      setSessions(response.sessions);
    } catch (err) {
      console.warn(
        '[PikaMeetingCard] list refresh failed:',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  // Initial load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while any row is non-terminal. An empty list or a list of
  // all-terminal rows skips the interval entirely so we do not
  // burn CPU on projects that aren't using the feature.
  const hasActive = useMemo(
    () => sessions.some((s) => ACTIVE_STATUSES.includes(s.status)),
    [sessions]
  );
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasActive, refresh]);

  const activeSession = useMemo(
    () => sessions.find((s) => ACTIVE_STATUSES.includes(s.status)) ?? null,
    [sessions]
  );
  const endedSessions = useMemo(
    () => sessions.filter((s) => !ACTIVE_STATUSES.includes(s.status)),
    [sessions]
  );

  if (!loaded) {
    return null;
  }

  return (
    <motion.section
      className="card mt-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      aria-label="AI teammate video meeting"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="label">AI teammate · video call</h3>
          <p className="text-body-sm text-text-secondary mt-1 max-w-xl">
            Drop a Google Meet URL and the AI teammate joins the call
            as a real video participant. It already knows this
            project — repo, launch strategy, generated assets — so
            you can ask it anything.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          disabled={activeSession !== null}
          className="btn btn-primary text-body-sm"
          aria-label="Invite AI teammate to a meet"
        >
          {activeSession !== null ? 'Session in progress' : 'Invite teammate'}
        </button>
      </header>

      {activeSession !== null && (
        <ActiveSessionPanel
          session={activeSession}
          projectId={projectId}
          onUpdated={refresh}
        />
      )}

      {endedSessions.length > 0 && (
        <EndedSessionList sessions={endedSessions} />
      )}

      {sessions.length === 0 && (
        <p className="text-body-sm text-text-muted italic">
          No meetings yet for this project.
        </p>
      )}

      <AnimatePresence>
        {modalOpen && (
          <InviteModal
            projectId={projectId}
            onClose={() => setModalOpen(false)}
            onCreated={(row) => {
              setSessions((prev) => [row, ...prev]);
              setModalOpen(false);
              // Immediately refresh to pick up the server-side
              // status transition in case the worker got to it
              // before the optimistic insert landed.
              void refresh();
            }}
          />
        )}
      </AnimatePresence>
    </motion.section>
  );
}

// ── Active session panel ─────────────────────────────────────────────

interface ActiveSessionPanelProps {
  session: PikaMeetingSession;
  projectId: string;
  onUpdated: () => Promise<void>;
}

function ActiveSessionPanel({
  session,
  projectId,
  onUpdated,
}: ActiveSessionPanelProps) {
  const [ending, setEnding] = useState(false);

  const handleEnd = useCallback(async () => {
    setEnding(true);
    try {
      await api.endProjectMeeting(projectId, session.id);
    } catch (err) {
      console.warn(
        '[PikaMeetingCard] leave failed:',
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      setEnding(false);
      await onUpdated();
    }
  }, [projectId, session.id, onUpdated]);

  return (
    <div className="rounded border border-surface-800 bg-surface-900/60 p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <StatusChip status={session.status} />
          <div className="min-w-0">
            <div className="font-mono text-mono-sm text-text-primary truncate">
              {session.botName}
            </div>
            <a
              href={session.meetUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-mono-sm text-accent-400 hover:text-accent-300 truncate block max-w-md"
            >
              {session.meetUrl}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {session.status === 'active' && session.startedAt && (
            <ElapsedTimer startedAt={session.startedAt} />
          )}
          <button
            type="button"
            onClick={() => void handleEnd()}
            disabled={
              ending ||
              session.status === 'pending' ||
              session.status === 'joining'
            }
            className="btn btn-secondary text-body-sm"
            title={
              session.status === 'pending' || session.status === 'joining'
                ? 'Wait for the bot to finish joining before ending'
                : 'End the meeting'
            }
          >
            {ending ? 'Ending…' : 'End meeting'}
          </button>
        </div>
      </div>
      {session.error && (
        <p className="mt-3 text-body-sm text-red-400 font-mono">
          {session.error}
        </p>
      )}
    </div>
  );
}

// ── Elapsed timer ────────────────────────────────────────────────────

interface ElapsedTimerProps {
  startedAt: Date;
}

function ElapsedTimer({ startedAt }: ElapsedTimerProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const startedMs = startedAt instanceof Date ? startedAt.getTime() : Date.parse(String(startedAt));
  const elapsedSec = Math.max(0, Math.floor((now - startedMs) / 1000));
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    <span
      className="font-mono text-mono-sm text-text-secondary"
      aria-label="Elapsed call time"
    >
      {pad(minutes)}:{pad(seconds)}
    </span>
  );
}

// ── Ended session list ───────────────────────────────────────────────

interface EndedSessionListProps {
  sessions: readonly PikaMeetingSession[];
}

function EndedSessionList({ sessions }: EndedSessionListProps) {
  return (
    <details className="mt-4 group">
      <summary className="cursor-pointer list-none flex items-center gap-2 text-body-sm text-text-muted hover:text-text-secondary transition-colors">
        <svg
          className="h-3 w-3 transition-transform group-open:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span>
          {sessions.length} past session{sessions.length === 1 ? '' : 's'}
        </span>
      </summary>
      <ul className="mt-3 space-y-2">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex items-center justify-between gap-3 rounded border border-surface-800 bg-surface-900/40 px-3 py-2"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <StatusChip status={session.status} />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-mono-sm text-text-primary truncate">
                  {session.botName}
                </div>
                {session.error && (
                  <div className="font-mono text-xs text-red-400 truncate">
                    {session.error}
                  </div>
                )}
              </div>
            </div>
            {session.costCents > 0 && (
              <span className="font-mono text-mono-sm text-text-muted flex-shrink-0">
                ${(session.costCents / 100).toFixed(2)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── Status chip ──────────────────────────────────────────────────────

interface StatusChipProps {
  status: PikaMeetingSession['status'];
}

const STATUS_COLORS: Record<PikaMeetingSession['status'], string> = {
  pending: 'text-text-muted bg-surface-800',
  joining: 'text-yellow-300 bg-yellow-900/30',
  active: 'text-green-300 bg-green-900/30',
  ending: 'text-orange-300 bg-orange-900/30',
  ended: 'text-text-muted bg-surface-800',
  failed: 'text-red-300 bg-red-900/30',
};

function StatusChip({ status }: StatusChipProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-mono-sm capitalize ${STATUS_COLORS[status]}`}
    >
      {status}
    </span>
  );
}

// ── Invite modal ─────────────────────────────────────────────────────

interface InviteModalProps {
  projectId: string;
  onClose: () => void;
  onCreated: (session: PikaMeetingSession) => void;
}

function InviteModal({ projectId, onClose, onCreated }: InviteModalProps) {
  const [meetUrl, setMeetUrl] = useState('');
  const [botName, setBotName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const body: { meetUrl: string; botName?: string } = { meetUrl };
        if (botName.trim().length > 0) {
          body.botName = botName.trim();
        }
        const response = await api.createProjectMeeting(projectId, body);
        onCreated(response.session);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [projectId, meetUrl, botName, submitting, onCreated]
  );

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => {
        // Close on backdrop click only, not on modal clicks.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="w-full max-w-md card bg-surface-950"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        <h3 className="label mb-1">Invite AI teammate</h3>
        <p className="text-body-sm text-text-secondary mb-4">
          Paste a Google Meet or Zoom link. The bot joins within ~90
          seconds and stays until you end the meeting (30-minute
          auto-timeout).
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          <div>
            <label
              htmlFor="pika-meet-url"
              className="block text-body-sm text-text-secondary mb-1"
            >
              Meeting URL
            </label>
            <input
              id="pika-meet-url"
              type="url"
              value={meetUrl}
              onChange={(e) => setMeetUrl(e.target.value)}
              placeholder="https://meet.google.com/abc-defg-hij"
              required
              autoFocus
              className="input font-mono text-mono-sm w-full"
            />
          </div>
          <div>
            <label
              htmlFor="pika-bot-name"
              className="block text-body-sm text-text-secondary mb-1"
            >
              Bot name <span className="text-text-muted">(optional)</span>
            </label>
            <input
              id="pika-bot-name"
              type="text"
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              placeholder="LaunchKit Teammate"
              maxLength={80}
              className="input text-body-sm w-full"
            />
          </div>
          {error && (
            <p className="text-body-sm text-red-400 font-mono">{error}</p>
          )}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn btn-secondary text-body-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || meetUrl.trim().length === 0}
              className="btn btn-primary text-body-sm"
            >
              {submitting ? 'Inviting…' : 'Invite teammate'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
