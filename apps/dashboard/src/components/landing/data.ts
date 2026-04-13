import {
  GithubLogo,
  MagnifyingGlass,
  Brain,
  Sparkle,
  Lightning,
  CheckCircle,
  Article,
  Image as PhImage,
  VideoCamera,
  MicrophoneStage,
  CubeFocus,
} from '@phosphor-icons/react';

// ─────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────

export type PipelineStage = {
  readonly icon: typeof GithubLogo;
  readonly label: string;
  readonly detail: string;
};

export type AssetKind = 'written' | 'image' | 'video' | 'audio' | 'scene';

export type AssetCard = {
  readonly kind: AssetKind;
  readonly icon: typeof Article;
  readonly eyebrow: string;
  readonly title: string;
  readonly copy: string;
  readonly tint: string; // tailwind class suffix, e.g. 'emerald'
};

export type ScrollStage = {
  readonly index: string;
  readonly title: string;
  readonly body: string;
  readonly mono: string;
};

export type FaqItem = {
  readonly q: string;
  readonly a: string;
};

export type StackLogo = {
  readonly src: string;
  readonly name: string;
  readonly sub: string;
  /** Monochrome SVGs get the brightness-0/invert filter so the mark renders
   * white on dark. Raster (webp) logos keep their native brand colour. */
  readonly mono: boolean;
  /** Intrinsic dimensions so the browser reserves the correct CLS slot
   * on first paint before the asset resolves. Tailwind `h-7 w-auto` still
   * controls the visual size; these are purely the layout reservation. */
  readonly width: number;
  readonly height: number;
};

// ─────────────────────────────────────────────────────────────────────
// Data — kept at module scope so every section reads from one source.
// ─────────────────────────────────────────────────────────────────────

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  { icon: GithubLogo,      label: 'CLONING REPOSITORY',     detail: 'github.com/acme/orbit-cli' },
  { icon: MagnifyingGlass, label: 'ANALYZING CODEBASE',     detail: '1,284 files · TypeScript + Rust' },
  { icon: Brain,           label: 'RUNNING RESEARCH AGENT', detail: '14 searches · 3 competitors · 12 citations' },
  { icon: Sparkle,         label: 'BUILDING STRATEGY',      detail: 'Positioning · ICP · 17 asset briefs' },
  { icon: Lightning,       label: 'GENERATING IN PARALLEL', detail: 'text · image · video · audio · 3D' },
  { icon: CheckCircle,     label: 'KIT READY',              detail: '17 assets · $1.54 · 6m 42s' },
] as const;

export const CARD_WRITTEN: AssetCard = {
  kind: 'written',
  icon: Article,
  eyebrow: 'WRITTEN',
  title: 'Launch posts, cold emails, changelog notes',
  copy: 'Grounded in your README, not hallucinated. Every draft cites the file it read from.',
  tint: 'emerald',
};
export const CARD_IMAGE: AssetCard = {
  kind: 'image',
  icon: PhImage,
  eyebrow: 'IMAGE',
  title: 'On-brand hero art, OG cards, social thumbnails',
  copy: 'fal.ai diffusion, tuned per project. Four variations per brief — pick or regenerate in one click.',
  tint: 'sky',
};
export const CARD_VIDEO: AssetCard = {
  kind: 'video',
  icon: VideoCamera,
  eyebrow: 'VIDEO',
  title: 'Vertical launch reels, product teasers',
  copy: 'Remotion compositions with timed captions, BGM and the voiceover your brand already has.',
  tint: 'rose',
};
export const CARD_AUDIO: AssetCard = {
  kind: 'audio',
  icon: MicrophoneStage,
  eyebrow: 'VOICE',
  title: 'Narration, podcast intros, ad reads',
  copy: 'ElevenLabs voices, cached per-project, drift-free across every asset in the kit.',
  tint: 'amber',
};
export const CARD_SCENE: AssetCard = {
  kind: 'scene',
  icon: CubeFocus,
  eyebrow: '3D SCENE',
  title: 'World Labs environments for product walkthroughs',
  copy: 'Walk the user through your product inside a generated spatial scene — GLB exports included.',
  tint: 'violet',
};

export const SCROLL_STAGES: readonly ScrollStage[] = [
  {
    index: '01',
    title: 'Reads your repo like a human',
    body: 'An Agent SDK worker clones the repo, walks the tree, and actually reads README.md, package.json, docs, and the top-level source files. No RAG guessing.',
    mono: 'analyze-project-repository.ts',
  },
  {
    index: '02',
    title: 'Researches the market around it',
    body: 'A second agent runs Claude native web search, Exa deep search, pulls competitor positioning, and writes a structured brief with real citations you can audit.',
    mono: 'launch-research-agent.ts',
  },
  {
    index: '03',
    title: 'Strategizes — then fans out',
    body: 'The strategist writes up to 16 asset briefs, then Render Workflows spins up five compute-bucketed child tasks so a 20-second blog post never waits for a 10-minute video render.',
    mono: 'build-project-launch-strategy.ts',
  },
  {
    index: '04',
    title: 'Reviews its own output, then learns',
    body: 'A creative director agent scores every asset, auto-approves or re-queues. Your edits get embedded and clustered — next run, the prompts already know your taste.',
    mono: 'creative-director-agent.ts',
  },
] as const;

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: 'Is this just a ChatGPT wrapper?',
    a: 'No. LaunchKit is a multi-agent pipeline running on Render Workflows with five compute-profiled child tasks, a pgvector feedback loop, and real provider calls to fal.ai, ElevenLabs and World Labs alongside Claude. Every generation records real cost.',
  },
  {
    q: 'What does a full kit actually cost?',
    a: 'A full kit — up to 16 assets across text, image, video, audio, and 3D — typically runs $1–6 in provider cost depending on which models and asset types you enable. The dashboard shows the real cost on every project card. No subscription, no markup.',
  },
  {
    q: 'Can I regenerate a single asset without re-running everything?',
    a: 'Yes. Every asset row has its own status machine. Click Regenerate on a single card and only that one goes back through the pipeline — the rest of the kit stays intact.',
  },
  {
    q: 'Does LaunchKit learn from my edits?',
    a: 'Your approve / reject / edit actions write to asset_feedback_events, get embedded with Voyage, and cluster via pgvector. The next kit you generate sees those edit patterns as context — the model actually learns your voice.',
  },
  {
    q: 'How does it handle long runs without timeouts?',
    a: 'Render Workflows. The parent task fans out to five child tasks via run chaining, each sized to the work: starter instances for text, standard for images and audio, pro for video and 3D. A 10-minute Remotion render never blocks a 20-second blog post.',
  },
] as const;

export const DIFFERENTIATORS = [
  {
    icon: Brain,
    title: 'Grounded in your repo — not hallucinated',
    body: 'Every agent reads the actual file system and cites it. No more "you mentioned a feature that doesn\'t exist" moments.',
  },
  {
    icon: Lightning,
    title: 'Parallel fanout, not sequential prompts',
    body: 'Render Workflows spins up five compute-profiled child tasks. A 10-minute video render never blocks a 20-second post.',
  },
  {
    icon: Sparkle,
    title: 'Learns your voice from your edits',
    body: 'Your edits get embedded, clustered by pgvector, and surfaced as context on the next run. The model gets more you, over time.',
  },
] as const;

export const STACK_LOGOS: readonly StackLogo[] = [
  { src: '/logos/render.svg',     name: 'RENDER',     sub: 'WORKFLOWS',  mono: true,  width: 120, height: 28 },
  { src: '/logos/claude.svg',     name: 'CLAUDE',     sub: 'AGENT SDK',  mono: true,  width: 120, height: 28 },
  { src: '/logos/fal.webp',       name: 'FAL.AI',     sub: 'DIFFUSION',  mono: false, width: 120, height: 28 },
  { src: '/logos/elevenlabs.svg', name: 'ELEVENLABS', sub: 'VOICE',      mono: true,  width: 120, height: 28 },
  { src: '/logos/worldlabs.svg',  name: 'WORLD LABS', sub: '3D SCENES',  mono: true,  width: 120, height: 28 },
  { src: '/logos/remotion.webp',  name: 'REMOTION',   sub: 'VIDEO',      mono: false, width: 120, height: 28 },
  { src: '/logos/exa.webp',       name: 'EXA',        sub: 'DEEP SEARCH',mono: false, width: 120, height: 28 },
  { src: '/logos/postgresql.svg', name: 'POSTGRES',   sub: 'PGVECTOR',   mono: true,  width: 120, height: 28 },
] as const;
