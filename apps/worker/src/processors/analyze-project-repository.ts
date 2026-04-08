import { eq } from 'drizzle-orm';
import * as schema from '@launchkit/shared';
import type { AnalyzeRepoJobData, RepoAnalysis, ProjectCategory } from '@launchkit/shared';
import {
  getRepo,
  getReadme,
  getFileTree,
  getPackageJson,
  getRecentCommits,
  getLanguages,
  getTopics,
  type GithubFetchOptions,
} from '../tools/github-repository-tools.js';
import { projectProgressPublisher } from '../lib/project-progress-publisher.js';
import { storeProjectEmbedding } from '../tools/project-insight-memory.js';
import { database as db } from '../lib/database.js';
import { decryptGithubToken } from '../lib/github-token-crypto.js';

/**
 * Infer project category from file tree, dependencies, and metadata.
 */
function inferCategory(data: {
  fileTree: string[];
  packageDeps: Record<string, string>;
  topics: string[];
  description: string;
}): ProjectCategory {
  const { fileTree, packageDeps, topics, description } = data;
  const allText = [...topics, description].join(' ').toLowerCase();
  const files = fileTree.join(' ').toLowerCase();
  const deps = Object.keys(packageDeps).join(' ').toLowerCase();

  if (allText.includes('cli') || files.includes('bin/') || deps.includes('commander') || deps.includes('yargs') || deps.includes('inquirer')) {
    return 'cli_tool';
  }
  if (allText.includes('framework') || allText.includes('meta-framework')) {
    return 'framework';
  }
  if (deps.includes('next') || deps.includes('nuxt') || deps.includes('remix') || deps.includes('express') || deps.includes('hono') || deps.includes('fastify')) {
    return 'web_app';
  }
  if (deps.includes('react-native') || deps.includes('expo') || allText.includes('mobile')) {
    return 'mobile_app';
  }
  if (allText.includes('api') || files.includes('routes/') || allText.includes('rest')) {
    return 'api';
  }
  if (allText.includes('infrastructure') || allText.includes('deploy') || allText.includes('docker') || allText.includes('kubernetes')) {
    return 'infrastructure';
  }
  if (allText.includes('data') || allText.includes('database') || allText.includes('analytics')) {
    return 'data';
  }
  if (fileTree.some((f) => f.endsWith('.test.ts') || f.endsWith('.spec.ts')) && !files.includes('src/app') && !files.includes('src/pages')) {
    return 'library';
  }
  if (allText.includes('devtool') || allText.includes('developer tool') || allText.includes('linter') || allText.includes('formatter')) {
    return 'devtool';
  }

  return 'library'; // default to library for most OSS repos
}

/**
 * Process an analyze-repo job.
 * Fetches all repo data from GitHub and creates a comprehensive analysis.
 */
export async function analyzeProjectRepository(data: AnalyzeRepoJobData): Promise<void> {
  const { projectId, repoOwner, repoName } = data;

  await projectProgressPublisher.phaseStart(
    projectId,
    'analyzing',
    `Analyzing ${repoOwner}/${repoName}`
  );

  // Look up the project row to see whether the user attached an
  // encrypted personal access token at creation time. When present,
  // decrypt it once and thread it through every GitHub fetch below
  // so private-repo analyses are routed through the user's own scope
  // instead of the shared public token. When absent (or when the
  // decrypt fails — see `decryptGithubToken` for the degrade-to-null
  // contract), the fetch tools fall back to the global `GITHUB_TOKEN`
  // env var or run unauthenticated.
  const projectRow = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { githubTokenEncrypted: true },
  });

  const authToken =
    projectRow?.githubTokenEncrypted != null
      ? (decryptGithubToken(projectRow.githubTokenEncrypted) ?? undefined)
      : undefined;

  const githubOptions: GithubFetchOptions = authToken !== undefined
    ? { authToken }
    : {};

  // Fetch all repo data in parallel
  const [repoMeta, readme, fileTree, packageJson, commits, languages, topics] = await Promise.all([
    getRepo(repoOwner, repoName, githubOptions),
    getReadme(repoOwner, repoName, githubOptions),
    getFileTree(repoOwner, repoName, githubOptions),
    getPackageJson(repoOwner, repoName, githubOptions),
    getRecentCommits(repoOwner, repoName, 10, githubOptions),
    getLanguages(repoOwner, repoName, githubOptions),
    getTopics(repoOwner, repoName, githubOptions),
  ]);

  // Build tech stack from languages and dependencies
  const techStack = new Set<string>();
  Object.keys(languages).forEach((lang) => techStack.add(lang));
  if (packageJson?.dependencies) {
    Object.keys(packageJson.dependencies).forEach((dep) => techStack.add(dep));
  }

  // Detect framework
  const deps = packageJson?.dependencies ?? {};
  const devDeps = packageJson?.devDependencies ?? {};
  const allDeps = { ...deps, ...devDeps };
  let framework: string | null = null;
  const frameworkMap: Record<string, string> = {
    next: 'Next.js',
    nuxt: 'Nuxt',
    react: 'React',
    vue: 'Vue.js',
    svelte: 'Svelte',
    angular: 'Angular',
    express: 'Express',
    hono: 'Hono',
    fastify: 'Fastify',
  };
  for (const [pkg, name] of Object.entries(frameworkMap)) {
    if (allDeps[pkg]) {
      framework = name;
      break;
    }
  }

  const packageDeps = { ...deps };

  const category = inferCategory({
    fileTree,
    packageDeps,
    topics,
    description: repoMeta.description ?? '',
  });

  const repoAnalysis: RepoAnalysis = {
    readme,
    description: repoMeta.description ?? '',
    language: repoMeta.language ?? Object.keys(languages)[0] ?? 'Unknown',
    techStack: Array.from(techStack).slice(0, 20),
    framework,
    stars: repoMeta.stargazers_count ?? 0,
    forks: repoMeta.forks_count ?? 0,
    topics,
    license: repoMeta.license?.spdx_id ?? null,
    hasTests: fileTree.some((f) =>
      f.includes('test') || f.includes('spec') || f.includes('__tests__')
    ),
    hasCi: fileTree.some((f) =>
      f.includes('.github/workflows') || f.includes('.circleci') || f.includes('.travis')
    ),
    recentCommits: commits,
    fileTree: fileTree.slice(0, 100),
    packageDeps,
    category,
  };

  // Update project with analysis results
  await db
    .update(schema.projects)
    .set({
      repoAnalysis,
      lastCommitSha: commits[0]?.sha ?? null,
      status: 'researching',
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, projectId));

  // Store embedding for similarity search
  await storeProjectEmbedding(projectId, {
    repoName,
    description: repoAnalysis.description,
    language: repoAnalysis.language,
    techStack: repoAnalysis.techStack,
    category: repoAnalysis.category,
    topics: repoAnalysis.topics,
  });

  await projectProgressPublisher.phaseComplete(
    projectId,
    'analyzing',
    `Analysis complete: ${category} (${repoAnalysis.language})`
  );

  console.log(`[Analyze] ${repoOwner}/${repoName}: ${category}, ${repoAnalysis.techStack.length} tech, ${repoAnalysis.stars} stars`);
}
