import { useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { api } from '../lib/api.js';
import { useToast } from './ui/index.js';

// ── Types ──────────────────────────────────────────────────────────

type AssetMode = 'image' | 'video' | 'audio' | 'world';

interface GenerationResult {
  type: AssetMode;
  url?: string;
  audioUrl?: string;
  marbleUrl?: string;
  prompt: string;
  enhancedPrompt?: string | null;
  model: string;
  costCents: number;
  duration?: number;
}

// ── Constants ──────────────────────────────────────────────────────

const IMAGE_MODELS = [
  { id: 'flux-pro-ultra', label: 'FLUX Pro Ultra', badge: 'reliable' },
  { id: 'nano-banana-pro', label: 'Gemini Pro Image', badge: 'best text' },
] as const;

const VIDEO_MODELS = [
  { id: 'kling-v3', label: 'Kling 3.0', badge: 'recommended' },
  { id: 'seedance-2', label: 'Seedance 2.0', badge: 'native audio' },
] as const;

const ASPECT_RATIOS = [
  { id: '16:9', label: '16:9', icon: 'w-5 h-3' },
  { id: '1:1', label: '1:1', icon: 'w-3.5 h-3.5' },
  { id: '9:16', label: '9:16', icon: 'w-3 h-5' },
  { id: '4:3', label: '4:3', icon: 'w-4 h-3' },
  { id: '3:4', label: '3:4', icon: 'w-3 h-4' },
  { id: '21:9', label: '21:9', icon: 'w-6 h-2.5' },
] as const;

const MODE_TABS: { id: AssetMode; label: string; icon: string }[] = [
  {
    id: 'image',
    label: 'Image',
    icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    id: 'video',
    label: 'Video',
    icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
  },
  {
    id: 'audio',
    label: 'Audio',
    icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3',
  },
  {
    id: 'world',
    label: '3D World',
    icon: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12',
  },
];

// ── Component ──────────────────────────────────────────────────────

export function CreatePage() {
  const { toast } = useToast();
  const shouldReduceMotion = useReducedMotion();

  // State
  const [mode, setMode] = useState<AssetMode>('image');
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);

  // Image params
  const [imageModel, setImageModel] = useState('flux-pro-ultra');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [style, setStyle] = useState('');
  const [enhance, setEnhance] = useState(true);

  // Video params
  const [videoModel, setVideoModel] = useState('kling-v3');
  const [duration, setDuration] = useState(5);
  const [imageUrl, setImageUrl] = useState('');
  const [generateAudio, setGenerateAudio] = useState(false);

  // Audio params
  const [audioType, setAudioType] = useState<'single' | 'dialogue'>('single');
  const [dialogueLines, setDialogueLines] = useState([
    { speaker: 'alex' as const, text: '' },
    { speaker: 'sam' as const, text: '' },
  ]);

  // World params
  const [worldModel, setWorldModel] = useState('marble-1.1');
  const [displayName, setDisplayName] = useState('');

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() && mode !== 'audio') return;
    setGenerating(true);
    setResult(null);

    try {
      if (mode === 'image') {
        const res = await api.generateImage({
          prompt,
          model: imageModel,
          aspectRatio,
          ...(style ? { style } : {}),
          enhance,
        });
        setResult({
          type: 'image',
          url: res.url,
          prompt: res.prompt,
          enhancedPrompt: res.enhancedPrompt,
          model: res.model,
          costCents: res.costCents,
        });
      } else if (mode === 'video') {
        const res = await api.generateVideo({
          prompt,
          model: videoModel,
          duration,
          ...(imageUrl ? { imageUrl } : {}),
          generateAudio,
          enhance,
        });
        setResult({
          type: 'video',
          url: res.url,
          prompt: res.prompt,
          enhancedPrompt: res.enhancedPrompt,
          model: res.model,
          costCents: res.costCents,
          duration: res.duration,
        });
      } else if (mode === 'audio') {
        const input =
          audioType === 'single'
            ? { type: 'single' as const, text: prompt }
            : {
                type: 'dialogue' as const,
                lines: dialogueLines.filter((l) => l.text.trim()),
              };
        const res = await api.generateAudio(input);
        setResult({
          type: 'audio',
          audioUrl: res.audioUrl,
          prompt: audioType === 'single' ? prompt : `${dialogueLines.length} lines`,
          model: 'eleven_v3',
          costCents: res.costCents,
          duration: res.durationSeconds,
        });
      } else if (mode === 'world') {
        const res = await api.generateWorld({
          prompt,
          ...(displayName ? { displayName } : {}),
          model: worldModel,
        });
        setResult({
          type: 'world',
          marbleUrl: res.marbleUrl,
          prompt: res.prompt,
          model: res.model,
          costCents: res.costCents,
        });
      }

      toast({ message: 'Generation complete', variant: 'success' });
    } catch (err) {
      toast({
        message: 'Generation failed',
        variant: 'error',
        ...(err instanceof Error ? { description: err.message } : {}),
      });
    } finally {
      setGenerating(false);
    }
  }, [
    mode, prompt, imageModel, aspectRatio, style, enhance,
    videoModel, duration, imageUrl, generateAudio,
    audioType, dialogueLines, worldModel, displayName, toast,
  ]);

  const addDialogueLine = () => {
    const nextSpeaker = dialogueLines.length % 2 === 0 ? 'alex' as const : 'sam' as const;
    setDialogueLines([...dialogueLines, { speaker: nextSpeaker, text: '' }]);
  };

  const updateDialogueLine = (index: number, text: string) => {
    setDialogueLines(dialogueLines.map((l, i) => (i === index ? { ...l, text } : l)));
  };

  const ease = [0.16, 1, 0.3, 1] as const;

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease }}
      >
        <h1 className="font-display text-display-md text-text-primary tracking-tight">
          Create
        </h1>
        <p className="text-body-md text-text-tertiary mt-1">
          Generate images, videos, audio, and 3D worlds with your own prompts.
        </p>
      </motion.div>

      {/* Mode tabs */}
      <motion.div
        className="flex gap-1 p-1 rounded-xl bg-surface-900/60 border border-surface-800/50 w-fit mb-8"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4, ease }}
      >
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setMode(tab.id);
              setResult(null);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
              mode === tab.id
                ? 'bg-surface-800 text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-850/50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
            </svg>
            {tab.label}
          </button>
        ))}
      </motion.div>

      {/* Main layout: controls + preview */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Controls */}
        <motion.div
          className="lg:col-span-2 space-y-5"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, duration: 0.4, ease }}
        >
          {/* Prompt */}
          <div>
            <label className="text-label text-text-muted block mb-2">PROMPT</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                mode === 'image' ? 'Describe the image you want to generate...' :
                mode === 'video' ? 'Describe the video scene, camera movement, action...' :
                mode === 'audio' ? 'Write the text to synthesize...' :
                'Describe the 3D scene or environment...'
              }
              rows={5}
              className="input w-full font-mono text-sm resize-none"
              disabled={generating}
            />
            <div className="flex justify-end mt-1">
              <span className="text-body-xs text-text-muted">{prompt.length} chars</span>
            </div>
          </div>

          {/* Model selector */}
          {(mode === 'image' || mode === 'video') && (
            <div>
              <label className="text-label text-text-muted block mb-2">MODEL</label>
              <div className="grid grid-cols-2 gap-2">
                {(mode === 'image' ? IMAGE_MODELS : VIDEO_MODELS).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => mode === 'image' ? setImageModel(m.id) : setVideoModel(m.id)}
                    className={`text-left px-3 py-2.5 rounded-lg border transition-all text-sm ${
                      (mode === 'image' ? imageModel : videoModel) === m.id
                        ? 'border-accent-500/50 bg-accent-500/8 text-text-primary'
                        : 'border-surface-700/50 bg-surface-900/40 text-text-secondary hover:border-surface-600'
                    }`}
                  >
                    <span className="font-medium block">{m.label}</span>
                    <span className="text-xs text-text-muted mt-0.5 block">{m.badge}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Image-specific controls */}
          {mode === 'image' && (
            <>
              <div>
                <label className="text-label text-text-muted block mb-2">ASPECT RATIO</label>
                <div className="flex gap-1.5 flex-wrap">
                  {ASPECT_RATIOS.map((ar) => (
                    <button
                      key={ar.id}
                      type="button"
                      onClick={() => setAspectRatio(ar.id)}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        aspectRatio === ar.id
                          ? 'border-accent-500/50 bg-accent-500/8 text-accent-400'
                          : 'border-surface-700/50 text-text-muted hover:text-text-secondary hover:border-surface-600'
                      }`}
                    >
                      <div className={`${ar.icon} rounded-sm border border-current`} />
                      {ar.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-label text-text-muted block mb-2">STYLE (OPTIONAL)</label>
                <input
                  type="text"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  placeholder="e.g. cinematic dark tech, minimalist, isometric 3D"
                  className="input w-full text-sm"
                  disabled={generating}
                />
              </div>
            </>
          )}

          {/* Video-specific controls */}
          {mode === 'video' && (
            <>
              <div>
                <label className="text-label text-text-muted block mb-2">
                  DURATION: {duration}s
                </label>
                <input
                  type="range"
                  min={3}
                  max={15}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full accent-accent-500"
                  disabled={generating}
                />
                <div className="flex justify-between text-body-xs text-text-muted mt-1">
                  <span>3s</span><span>15s</span>
                </div>
              </div>
              <div>
                <label className="text-label text-text-muted block mb-2">IMAGE URL (OPTIONAL)</label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="Paste an image URL for image-to-video"
                  className="input w-full text-sm"
                  disabled={generating}
                />
              </div>
              {videoModel === 'seedance-2' && (
                <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={generateAudio}
                    onChange={(e) => setGenerateAudio(e.target.checked)}
                    className="accent-accent-500"
                  />
                  Generate native audio
                </label>
              )}
            </>
          )}

          {/* Audio-specific controls */}
          {mode === 'audio' && (
            <div>
              <label className="text-label text-text-muted block mb-2">TYPE</label>
              <div className="flex gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => setAudioType('single')}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                    audioType === 'single'
                      ? 'border-accent-500/50 bg-accent-500/8 text-text-primary'
                      : 'border-surface-700/50 text-text-muted hover:text-text-secondary'
                  }`}
                >
                  Single Voice
                </button>
                <button
                  type="button"
                  onClick={() => setAudioType('dialogue')}
                  className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                    audioType === 'dialogue'
                      ? 'border-accent-500/50 bg-accent-500/8 text-text-primary'
                      : 'border-surface-700/50 text-text-muted hover:text-text-secondary'
                  }`}
                >
                  Dialogue (2 Voices)
                </button>
              </div>
              {audioType === 'dialogue' && (
                <div className="space-y-2">
                  {dialogueLines.map((line, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className={`text-xs font-mono px-2 py-2 rounded shrink-0 ${
                        line.speaker === 'alex'
                          ? 'bg-accent-500/10 text-accent-400'
                          : 'bg-sky-500/10 text-sky-400'
                      }`}>
                        {line.speaker === 'alex' ? 'Chris' : 'Jessica'}
                      </span>
                      <input
                        type="text"
                        value={line.text}
                        onChange={(e) => updateDialogueLine(i, e.target.value)}
                        placeholder={`${line.speaker === 'alex' ? 'Chris' : 'Jessica'} says...`}
                        className="input flex-1 text-sm"
                        disabled={generating}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addDialogueLine}
                    className="btn-ghost text-xs text-text-muted"
                  >
                    + Add line
                  </button>
                </div>
              )}
            </div>
          )}

          {/* World-specific controls */}
          {mode === 'world' && (
            <>
              <div>
                <label className="text-label text-text-muted block mb-2">DISPLAY NAME</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Developer Home Office"
                  className="input w-full text-sm"
                  disabled={generating}
                />
              </div>
              <div>
                <label className="text-label text-text-muted block mb-2">MODEL</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'marble-1.1', label: 'Marble 1.1', badge: 'standard' },
                    { id: 'marble-1.1-plus', label: 'Marble 1.1+', badge: 'larger worlds' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setWorldModel(m.id)}
                      className={`text-left px-3 py-2.5 rounded-lg border transition-all text-sm ${
                        worldModel === m.id
                          ? 'border-accent-500/50 bg-accent-500/8 text-text-primary'
                          : 'border-surface-700/50 bg-surface-900/40 text-text-secondary hover:border-surface-600'
                      }`}
                    >
                      <span className="font-medium block">{m.label}</span>
                      <span className="text-xs text-text-muted mt-0.5 block">{m.badge}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Enhance toggle (image + video only) */}
          {(mode === 'image' || mode === 'video') && (
            <label className="flex items-center justify-between py-2 cursor-pointer">
              <div>
                <span className="text-sm font-medium text-text-secondary">Prompt Enhancer</span>
                <span className="text-body-xs text-text-muted block">
                  Optimizes prompt for the selected model
                </span>
              </div>
              <div
                onClick={() => setEnhance(!enhance)}
                className={`relative w-10 h-6 rounded-full transition-colors cursor-pointer ${
                  enhance ? 'bg-accent-500' : 'bg-surface-700'
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    enhance ? 'left-5' : 'left-1'
                  }`}
                />
              </div>
            </label>
          )}

          {/* Generate button */}
          <motion.button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || (!prompt.trim() && mode !== 'audio')}
            {...(shouldReduceMotion ? {} : { whileTap: { scale: 0.98 } })}
            className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {mode === 'world' ? 'Generating (~5 min)...' : 'Generating...'}
              </>
            ) : (
              `Generate ${mode === 'image' ? 'Image' : mode === 'video' ? 'Video' : mode === 'audio' ? 'Audio' : '3D World'}`
            )}
          </motion.button>
        </motion.div>

        {/* Right: Preview */}
        <motion.div
          className="lg:col-span-3"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, duration: 0.4, ease }}
        >
          <div className="card min-h-[480px] flex flex-col items-center justify-center overflow-hidden">
            {!result && !generating && (
              <div className="text-center py-16 px-8">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-800/60 flex items-center justify-center">
                  <svg className="w-7 h-7 text-text-muted" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d={MODE_TABS.find((t) => t.id === mode)?.icon ?? ''}
                    />
                  </svg>
                </div>
                <p className="text-text-muted text-sm">
                  Your {mode === 'image' ? 'image' : mode === 'video' ? 'video' : mode === 'audio' ? 'audio' : '3D world'} will appear here
                </p>
              </div>
            )}

            {generating && (
              <div className="text-center py-16">
                <div className="w-12 h-12 mx-auto mb-4 border-2 border-success-500/30 border-t-success-500 rounded-full animate-spin" />
                <p className="text-text-secondary text-sm">
                  {mode === 'world' ? 'Building 3D world (this takes ~5 minutes)...' : 'Generating...'}
                </p>
              </div>
            )}

            {result && (
              <div className="w-full p-4">
                {/* Image result */}
                {result.type === 'image' && result.url && (
                  <div className="space-y-3">
                    <img
                      src={result.url}
                      alt="Generated"
                      className="w-full rounded-lg"
                    />
                    <div className="flex items-center justify-between">
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost text-xs text-text-muted"
                      >
                        Open full size
                      </a>
                      <span className="font-mono text-xs text-accent-400">
                        ${(result.costCents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Video result */}
                {result.type === 'video' && result.url && (
                  <div className="space-y-3">
                    <video
                      src={result.url}
                      controls
                      autoPlay
                      loop
                      className="w-full rounded-lg"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted">
                        {result.duration}s - {result.model}
                      </span>
                      <span className="font-mono text-xs text-accent-400">
                        ${(result.costCents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Audio result */}
                {result.type === 'audio' && result.audioUrl && (
                  <div className="space-y-3 w-full">
                    <div className="bg-surface-900 rounded-lg p-6">
                      <audio
                        src={result.audioUrl}
                        controls
                        autoPlay
                        className="w-full"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-muted">
                        ~{result.duration}s - eleven_v3
                      </span>
                      <span className="font-mono text-xs text-accent-400">
                        ${(result.costCents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* World result */}
                {result.type === 'world' && result.marbleUrl && (
                  <div className="space-y-3 text-center w-full">
                    <div className="bg-surface-900 rounded-lg p-8">
                      <svg className="w-16 h-16 mx-auto text-accent-400 mb-4" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12" />
                      </svg>
                      <p className="text-text-secondary text-sm mb-4">3D World generated</p>
                      <a
                        href={result.marbleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm"
                      >
                        Open in Marble Viewer
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                    <div className="flex items-center justify-center">
                      <span className="font-mono text-xs text-accent-400">
                        ${(result.costCents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Enhanced prompt info */}
                {result.enhancedPrompt && (
                  <details className="mt-4">
                    <summary className="text-body-xs text-text-muted cursor-pointer hover:text-text-secondary">
                      View enhanced prompt
                    </summary>
                    <pre className="mt-2 text-body-xs text-text-muted bg-surface-900 rounded-lg p-3 whitespace-pre-wrap font-mono overflow-x-auto">
                      {result.enhancedPrompt}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
