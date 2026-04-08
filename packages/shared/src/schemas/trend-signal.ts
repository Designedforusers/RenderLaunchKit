import { z } from 'zod';
import { TrendSourceSchema } from '../enums.js';

/**
 * Schema for a single trending signal ingested by the
 * `trending-signals-agent` from a free API or via Grok / Exa.
 *
 * Mirrors the `trend_signals` Drizzle table in `schema.ts`. Hand
 * written (no `drizzle-zod`) so the same idiom holds across the
 * 10+ existing schemas in this directory — see the architecture
 * decision in `silly-popping-rocket.md` § "Architecture decisions".
 *
 * The `source` field is the only one with a closed-set vocabulary;
 * `TrendSourceSchema` is derived from the Drizzle pgEnum so the
 * database column and the Zod validator can never silently disagree
 * on the allowed values.
 */
// HN sometimes returns relative URLs like `/item?id=123`, and Reddit
// returns scheme-relative URLs in some payload shapes. Use a permissive
// non-empty string check rather than `z.string().url()` so the
// ingestion agents don't have to pre-normalize every source.
const PermissiveUrlSchema = z.string().min(1);

export const TrendSignalSchema = z.object({
  id: z.string().uuid(),
  source: TrendSourceSchema,
  topic: z.string().min(1),
  headline: z.string().min(1),
  url: PermissiveUrlSchema.nullable(),
  rawPayload: z.unknown().nullable(),
  velocityScore: z.number().nonnegative(),
  embedding: z.array(z.number()).nullable(),
  category: z.string().nullable(),
  ingestedAt: z.date(),
  expiresAt: z.date().nullable(),
});
export type TrendSignal = z.infer<typeof TrendSignalSchema>;

/**
 * Insert shape for `trend_signals`. Omits server-generated fields
 * (`id`, `ingestedAt`) and lets the embedding column default to
 * null at insert time — the Voyage embedding can be backfilled
 * via a follow-up update if the ingestion path doesn't compute it
 * synchronously.
 */
export const TrendSignalInsertSchema = z.object({
  source: TrendSourceSchema,
  topic: z.string().min(1),
  headline: z.string().min(1),
  url: PermissiveUrlSchema.nullable().optional(),
  rawPayload: z.unknown().optional(),
  velocityScore: z.number().nonnegative().default(0),
  embedding: z.array(z.number()).optional(),
  category: z.string().optional(),
  expiresAt: z.date().optional(),
});
export type TrendSignalInsert = z.infer<typeof TrendSignalInsertSchema>;
