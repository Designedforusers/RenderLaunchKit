import { eq, isNotNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@launchkit/shared';
import { groupBy, mean } from '@launchkit/shared';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

/**
 * Aggregate learning insights from user feedback on generated assets.
 * This is the self-learning system — it analyzes what works and what doesn't
 * across all projects, grouped by category.
 */
export async function aggregateFeedbackInsights(): Promise<void> {
  console.log(
    '[Cron:AggregateFeedbackInsights] Aggregating learnings from user feedback...'
  );

  // Get all complete projects with user feedback on assets
  const completedProjects = await db.query.projects.findMany({
    where: eq(schema.projects.status, 'complete'),
    with: {
      assets: true,
    },
  });

  const projectsWithFeedback = completedProjects.filter((p) =>
    p.assets.some((a) => a.userApproved !== null)
  );

  if (projectsWithFeedback.length === 0) {
    console.log(
      '[Cron:AggregateFeedbackInsights] No projects with user feedback found'
    );
    return;
  }

  // Group by project category
  const byCategory = groupBy(projectsWithFeedback, (p) => {
    const analysis = p.repoAnalysis as any;
    return analysis?.category || 'unknown';
  });

  let insightCount = 0;

  for (const [category, categoryProjects] of Object.entries(byCategory)) {
    const allAssets = categoryProjects.flatMap((p) => p.assets);
    const assetsWithFeedback = allAssets.filter((a) => a.userApproved !== null);

    if (assetsWithFeedback.length < 2) continue;

    // Insight 1: Approval rate by asset type
    const byType = groupBy(assetsWithFeedback, (a) => a.type);

    for (const [assetType, typeAssets] of Object.entries(byType)) {
      if (typeAssets.length < 2) continue;

      const approvalRate =
        typeAssets.filter((a) => a.userApproved).length / typeAssets.length;
      const avgScore = mean(
        typeAssets.map((a) => a.qualityScore).filter((s): s is number => s !== null)
      );

      // Generate insight for low approval types
      if (approvalRate < 0.4) {
        await upsertInsight({
          category,
          insight: `Users reject ${assetType} assets ${Math.round((1 - approvalRate) * 100)}% of the time for ${category} projects. Consider skipping or adjusting approach.`,
          confidence: Math.min(typeAssets.length / 10, 1),
          sampleSize: typeAssets.length,
        });
        insightCount++;
      }

      // Generate insight for high-performing types
      if (approvalRate > 0.8 && avgScore > 7.5) {
        await upsertInsight({
          category,
          insight: `${assetType} assets perform exceptionally well for ${category} projects (${Math.round(approvalRate * 100)}% approval, avg score ${avgScore.toFixed(1)}).`,
          confidence: Math.min(typeAssets.length / 10, 1),
          sampleSize: typeAssets.length,
        });
        insightCount++;
      }
    }

    // Insight 2: Tone analysis
    const toneScores: Record<string, number[]> = {};
    for (const project of categoryProjects) {
      const strategy = project.strategy as any;
      const tone = strategy?.tone;
      if (tone && project.reviewScore) {
        if (!toneScores[tone]) toneScores[tone] = [];
        toneScores[tone].push(project.reviewScore);
      }
    }

    const toneEntries = Object.entries(toneScores).filter(([, scores]) => scores.length >= 2);
    if (toneEntries.length >= 2) {
      const bestTone = toneEntries.reduce((best, [tone, scores]) => {
        const avg = mean(scores);
        return avg > best.avg ? { tone, avg } : best;
      }, { tone: '', avg: 0 });

      await upsertInsight({
        category,
        insight: `For ${category} projects, "${bestTone.tone}" tone performs best with an average score of ${bestTone.avg.toFixed(1)}/10.`,
        confidence: Math.min(toneEntries.reduce((sum, [, s]) => sum + s.length, 0) / 20, 1),
        sampleSize: toneEntries.reduce((sum, [, s]) => sum + s.length, 0),
      });
      insightCount++;
    }

    // Insight 3: User edit patterns
    const editedAssets = assetsWithFeedback.filter((a) => a.userEdited);
    if (editedAssets.length >= 2) {
      const editRate = editedAssets.length / assetsWithFeedback.length;
      const editedTypes = groupBy(editedAssets, (a) => a.type);
      const mostEditedType = Object.entries(editedTypes).sort(
        ([, a], [, b]) => b.length - a.length
      )[0];

      if (mostEditedType && editRate > 0.3) {
        await upsertInsight({
          category,
          insight: `Users frequently edit ${mostEditedType[0]} assets for ${category} projects (${Math.round(editRate * 100)}% edit rate). Consider adjusting generation approach.`,
          confidence: Math.min(assetsWithFeedback.length / 15, 1),
          sampleSize: assetsWithFeedback.length,
        });
        insightCount++;
      }
    }
  }

  console.log(
    `[Cron:AggregateFeedbackInsights] Generated/updated ${insightCount} insights from ${projectsWithFeedback.length} projects`
  );
}

async function upsertInsight(data: {
  category: string;
  insight: string;
  confidence: number;
  sampleSize: number;
}): Promise<void> {
  // Check if a similar insight already exists
  const existing = await db.query.strategyInsights.findFirst({
    where: eq(schema.strategyInsights.category, data.category),
  });

  if (existing && existing.insight.includes(data.insight.split(' ').slice(0, 5).join(' '))) {
    // Update existing insight
    await db
      .update(schema.strategyInsights)
      .set({
        insight: data.insight,
        confidence: data.confidence,
        sampleSize: data.sampleSize,
        updatedAt: new Date(),
      })
      .where(eq(schema.strategyInsights.id, existing.id));
  } else {
    // Insert new insight
    await db.insert(schema.strategyInsights).values({
      category: data.category,
      insight: data.insight,
      confidence: data.confidence,
      sampleSize: data.sampleSize,
    });
  }
}
