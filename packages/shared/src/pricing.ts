/**
 * Provider pricing constants and cost-compute helpers for every
 * upstream API LaunchKit pays for during asset generation.
 *
 * Source-of-truth dates are in the comments next to each rate table.
 * The rates do not move often enough to justify a cron-driven sync
 * against provider dashboards — a quarterly manual refresh is fine.
 * When you touch a rate, bump the date in the comment so the next
 * reader knows how stale the number is.
 *
 * Design invariants:
 *
 *   - **Integer cents.** Every public helper returns a non-negative
 *     integer via `Math.ceil`. The dashboard formats the total with
 *     `(cents / 100).toFixed(2)` — no floating-point dollar math at
 *     any layer. `Math.ceil` is the deliberate choice: undercounting
 *     hides spend from the operator; overcounting by <1c is noise.
 *
 *   - **Unknown models are free.** An unknown model id in the rate
 *     table logs a warning and returns 0 rather than throwing. The
 *     cost tracker is non-blocking by design — a pricing lookup miss
 *     must never fail a real asset generation. The warning is the
 *     load-bearing signal that the rate table is stale.
 *
 *   - **Rate tables keyed by provider model id.** The strings match
 *     the model id the client passes to the SDK so there is no
 *     translation layer between "what the code called" and "what we
 *     priced" — a future reader can grep the Anthropic model id and
 *     find both the call site and the pricing entry.
 *
 * These helpers are consumed by `packages/asset-generators/src/clients/`
 * (fal, elevenlabs, world-labs) and by the two anthropic-claude-client
 * copies in `apps/worker/src/lib/` and `apps/workflows/src/lib/`.
 */

// ── Anthropic ───────────────────────────────────────────────────────
//
// https://www.anthropic.com/pricing — rates as of 2026-04.
//
//   claude-opus-4-6        $15.00 / 1M input tokens, $75.00 / 1M output
//   claude-sonnet-4-6       $3.00 / 1M input tokens, $15.00 / 1M output
//   claude-haiku-4-5        $0.80 / 1M input tokens,  $4.00 / 1M output

export const ANTHROPIC_PRICING: Record<
  string,
  { inputCentsPerMillion: number; outputCentsPerMillion: number }
> = {
  'claude-opus-4-6': {
    inputCentsPerMillion: 1500,
    outputCentsPerMillion: 7500,
  },
  'claude-sonnet-4-6': {
    inputCentsPerMillion: 300,
    outputCentsPerMillion: 1500,
  },
  'claude-haiku-4-5-20251001': {
    inputCentsPerMillion: 80,
    outputCentsPerMillion: 400,
  },
};

// ── fal.ai ──────────────────────────────────────────────────────────
//
// https://fal.ai/models — rates as of 2026-04.
//
//   FLUX.2 Pro Ultra (image):     ~$0.055 per image
//   Kling 3.0 Standard (video):   ~$0.15  per second
//
// Note on fractional `perImageCents`: the FLUX.2 Pro Ultra rate is
// $0.055 / image, which is 5.5 cents. We store the exact provider
// rate here — including the fractional value — and let the compute
// helper `Math.ceil` it to the integer-cents invariant at call time.
// Storing the pre-rounded integer (6) would work for current usage
// but would silently drop the 0.5-cent distinction if the helper is
// ever called on a multi-image batch (`Math.ceil(5.5 * N)` vs.
// `Math.ceil(6 * N)` diverge for N >= 2). Keeping the source rate
// fractional preserves the right semantics for any future batching.

export const FAL_PRICING: Record<string, { perImageCents?: number; perSecondCents?: number }> = {
  'flux-pro-ultra-image': { perImageCents: 5.5 },
  'kling-video-standard-per-second': { perSecondCents: 15 },
};

// ── ElevenLabs ──────────────────────────────────────────────────────
//
// https://elevenlabs.io/pricing — rates as of 2026-04.
//
//   Creator tier, Turbo v2:        ~$0.18 / 1k characters
//   Creator tier, Multilingual v2: ~$0.30 / 1k characters

export const ELEVENLABS_PRICING: Record<string, { centsPer1kChars: number }> = {
  eleven_turbo_v2: { centsPer1kChars: 18 },
  eleven_multilingual_v2: { centsPer1kChars: 30 },
};

// ── World Labs (Marble) ─────────────────────────────────────────────
//
// No public pricing as of 2026-04. These are internal estimates based
// on the documented compute profile: a 5-minute GPU render of a
// Gaussian-splat world. Update when World Labs publishes a pricing
// page.

export const WORLD_LABS_PRICING: Record<string, { perWorldCents: number }> = {
  'marble-1.1': { perWorldCents: 50 },
  'marble-1.1-plus': { perWorldCents: 150 },
};

// ── Voyage AI ───────────────────────────────────────────────────────
//
// https://docs.voyageai.com/docs/pricing — rates as of 2026-04.
//
//   voyage-3-large: $0.18 / 1M tokens
//
// Voyage is used only in the research path today; cost tracking for
// the research path is deferred (see plan §2.1.4). The helper exists
// so a follow-up PR can wire it in without touching the pricing file.

export const VOYAGE_PRICING: Record<string, { centsPerMillionTokens: number }> = {
  'voyage-3-large': { centsPerMillionTokens: 18 },
};

// ── Computation helpers ─────────────────────────────────────────────

/**
 * Compute the Anthropic messages.create cost in integer cents for a
 * given model and token counts. Returns 0 and logs a warning when the
 * model id is not in `ANTHROPIC_PRICING` — the miss is non-fatal
 * because cost tracking must never block a real generation.
 */
export function computeAnthropicCostCents(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = ANTHROPIC_PRICING[model];
  if (!rates) {
    console.warn(`[pricing] Unknown Anthropic model "${model}" — cost will be 0`);
    return 0;
  }
  const cents =
    (inputTokens * rates.inputCentsPerMillion) / 1_000_000 +
    (outputTokens * rates.outputCentsPerMillion) / 1_000_000;
  return Math.ceil(cents);
}

/**
 * Compute the fixed per-image cost for a FLUX.2 Pro Ultra render.
 * The underlying rate is a fractional cent (5.5) so `Math.ceil`
 * lifts it to 6 — the integer-cents invariant holds even on a
 * single-image render.
 */
export function computeFalImageCostCents(): number {
  const rate = FAL_PRICING['flux-pro-ultra-image'];
  if (!rate?.perImageCents) {
    console.warn('[pricing] Missing FAL flux-pro-ultra-image rate — cost will be 0');
    return 0;
  }
  return Math.ceil(rate.perImageCents);
}

/**
 * Compute the Kling video cost for a given duration in seconds.
 * Kling's billing is per-second; we round up at the end so a
 * 5.5-second render still bills as 83 cents (15 * 5.5 = 82.5).
 */
export function computeFalVideoCostCents(durationSeconds: number): number {
  const rate = FAL_PRICING['kling-video-standard-per-second'];
  if (!rate?.perSecondCents) {
    console.warn('[pricing] Missing FAL kling-video-standard rate — cost will be 0');
    return 0;
  }
  return Math.ceil(durationSeconds * rate.perSecondCents);
}

/**
 * Compute the ElevenLabs TTS cost for a given model id and
 * synthesized character count. Both Turbo v2 and Multilingual v2
 * are priced per 1k characters, so the math is identical — only
 * the rate differs.
 */
export function computeElevenLabsCostCents(
  model: string,
  characterCount: number
): number {
  const rates = ELEVENLABS_PRICING[model];
  if (!rates) {
    console.warn(`[pricing] Unknown ElevenLabs model "${model}" — cost will be 0`);
    return 0;
  }
  return Math.ceil((characterCount * rates.centsPer1kChars) / 1000);
}

/**
 * Compute the World Labs (Marble) per-world fixed cost. Marble
 * bills per completed world regardless of scene complexity, so
 * the helper takes only a model id. `Math.ceil` is applied for
 * consistency with every other compute helper in this file — the
 * current rate values are already integers, but the rounding keeps
 * the integer-cents invariant safe when a future rate lands as
 * fractional (e.g. `$0.475 → 47.5 cents → ceils to 48`).
 */
export function computeWorldLabsCostCents(model: string): number {
  const rates = WORLD_LABS_PRICING[model];
  if (!rates) {
    console.warn(`[pricing] Unknown World Labs model "${model}" — cost will be 0`);
    return 0;
  }
  return Math.ceil(rates.perWorldCents);
}

/**
 * Compute the Voyage embedding cost for a given model id and
 * token count. Kept alongside the other helpers so a future
 * research-path instrumentation pass has a drop-in site.
 */
export function computeVoyageCostCents(
  model: string,
  tokenCount: number
): number {
  const rates = VOYAGE_PRICING[model];
  if (!rates) {
    console.warn(`[pricing] Unknown Voyage model "${model}" — cost will be 0`);
    return 0;
  }
  return Math.ceil((tokenCount * rates.centsPerMillionTokens) / 1_000_000);
}
