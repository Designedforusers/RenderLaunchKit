import { z } from 'zod';

/**
 * Schema for a single dev influencer in the curated + auto-enriched
 * database.
 *
 * Mirrors the `dev_influencers` Drizzle table in `schema.ts`. The
 * `platforms` jsonb column is loosely typed because each handle is
 * optional — most influencers are present on Twitter and GitHub,
 * fewer on dev.to or Hacker News, even fewer on Product Hunt or
 * Reddit. The schema documents which keys we expect; the actual
 * jsonb cell can omit any of them.
 */

export const InfluencerPlatformsSchema = z.object({
  twitter: z.string().optional(),
  github: z.string().optional(),
  devto: z.string().optional(),
  reddit: z.string().optional(),
  hackernews: z.string().optional(),
  producthunt: z.string().optional(),
  website: z.string().url().optional(),
});
export type InfluencerPlatforms = z.infer<typeof InfluencerPlatformsSchema>;

/**
 * Per-platform audience data for a dev influencer. Separate from the
 * canonical `audienceSize` integer on `DevInfluencerSchema`, which is
 * the scalar max-across-platforms that the matcher ranks on. This
 * schema captures the full per-platform breakdown the enrichment cron
 * collects (follower counts, public repos, post/karma counts) so the
 * UI can explain the ranking and the matcher can skip influencers
 * whose only signal is one inflated platform.
 *
 * Every platform sub-object is optional because not every influencer
 * has been enriched on every surface — dev.to and Hacker News in
 * particular are opt-in. Within a sub-object the primary count
 * (`followers`, `postCount`, `karma`) is required so a present key
 * always carries a meaningful signal.
 */
export const AudienceBreakdownSchema = z.object({
  twitter: z
    .object({
      followers: z.number().int().nonnegative(),
      following: z.number().int().nonnegative().optional(),
      tweetCount: z.number().int().nonnegative().optional(),
      verified: z.boolean().optional(),
    })
    .optional(),
  github: z
    .object({
      followers: z.number().int().nonnegative(),
      publicRepos: z.number().int().nonnegative().optional(),
    })
    .optional(),
  devto: z
    .object({
      postCount: z.number().int().nonnegative(),
      joinedAt: z.string().optional(),
    })
    .optional(),
  hn: z
    .object({
      karma: z.number().int().nonnegative(),
      createdAt: z.string().optional(),
    })
    .optional(),
});
export type AudienceBreakdown = z.infer<typeof AudienceBreakdownSchema>;

export const DevInfluencerSchema = z.object({
  id: z.string().uuid(),
  handle: z.string().min(1),
  platforms: InfluencerPlatformsSchema,
  categories: z.array(z.string()),
  bio: z.string().nullable(),
  recentTopics: z.array(z.string()).nullable(),
  audienceSize: z.number().int().nonnegative(),
  audienceBreakdown: AudienceBreakdownSchema.nullable(),
  topicEmbedding: z.array(z.number()).nullable(),
  lastEnrichedAt: z.date().nullable(),
  lastXEnrichedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DevInfluencer = z.infer<typeof DevInfluencerSchema>;

export const DevInfluencerInsertSchema = z.object({
  handle: z.string().min(1),
  platforms: InfluencerPlatformsSchema,
  categories: z.array(z.string()),
  bio: z.string().optional(),
  recentTopics: z.array(z.string()).optional(),
  audienceSize: z.number().int().nonnegative().default(0),
  audienceBreakdown: AudienceBreakdownSchema.optional(),
  topicEmbedding: z.array(z.number()).optional(),
  lastXEnrichedAt: z.date().optional(),
});
export type DevInfluencerInsert = z.infer<typeof DevInfluencerInsertSchema>;
