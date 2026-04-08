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

export const DevInfluencerSchema = z.object({
  id: z.string().uuid(),
  handle: z.string().min(1),
  platforms: InfluencerPlatformsSchema,
  categories: z.array(z.string()),
  bio: z.string().nullable(),
  recentTopics: z.array(z.string()).nullable(),
  audienceSize: z.number().int().nonnegative(),
  topicEmbedding: z.array(z.number()).nullable(),
  lastEnrichedAt: z.date().nullable(),
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
  topicEmbedding: z.array(z.number()).optional(),
});
export type DevInfluencerInsert = z.infer<typeof DevInfluencerInsertSchema>;
