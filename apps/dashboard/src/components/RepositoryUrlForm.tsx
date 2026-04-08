import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api.js';

interface RepositoryUrlFormProps {
  onProjectCreated: (id: string) => void;
}

// Loose check that catches the most common typos before we round-trip
// to the API. The server still validates strictly via Zod — this is a
// UX nicety so the input shows a "looks like a repo URL" affordance
// instead of waiting for a network error.
const REPO_URL_RE = /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/?$/i;

type SubmissionState = 'idle' | 'submitting' | 'success' | 'error';

export function RepositoryUrlForm({ onProjectCreated }: RepositoryUrlFormProps) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [showTokenField, setShowTokenField] = useState(false);
  const [state, setState] = useState<SubmissionState>('idle');
  const [error, setError] = useState<string | null>(null);

  const trimmed = url.trim();
  const looksValid = REPO_URL_RE.test(trimmed);
  const isSubmitting = state === 'submitting';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;

    setState('submitting');
    setError(null);

    try {
      const trimmedToken = token.trim();
      const result = await api.createProject(
        trimmed,
        trimmedToken.length > 0 ? trimmedToken : undefined
      );
      setState('success');
      // Tiny pause so the success morph is visible before navigation.
      // The parent navigates immediately on the callback; we resolve
      // both ends so the user actually sees the "Launching" -> check
      // transition rather than a flash before the route change.
      setTimeout(() => {
        onProjectCreated(result.id);
        setUrl('');
        setToken('');
        setShowTokenField(false);
        setState('idle');
      }, 320);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setState('error');
    }
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      className="w-full max-w-2xl mx-auto"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="relative">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (state === 'error') setState('idle');
              }}
              placeholder="https://github.com/owner/repo"
              className="input w-full text-lg font-mono pr-10"
              disabled={isSubmitting || state === 'success'}
              autoFocus
            />
            {/* Inline validation glyph — fades in once the URL parses
                cleanly, gives the user a non-blocking signal that the
                form is ready to submit. */}
            <AnimatePresence>
              {looksValid && state !== 'submitting' && state !== 'success' && (
                <motion.span
                  key="valid-check"
                  initial={{ opacity: 0, scale: 0.6, rotate: -30 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.6, rotate: 30 }}
                  transition={{
                    type: 'spring',
                    stiffness: 420,
                    damping: 22,
                  }}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-500/15 text-accent-400">
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </span>
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          <motion.button
            type="submit"
            disabled={isSubmitting || state === 'success' || !trimmed}
            className="btn-primary text-lg px-8 whitespace-nowrap min-w-[10rem] flex items-center justify-center"
            // Hover/tap motions only when the button is interactive.
            // Spread pattern keeps `exactOptionalPropertyTypes` happy
            // — explicit `undefined` is rejected for those props.
            {...(!isSubmitting && state !== 'success' && trimmed
              ? {
                  whileHover: { scale: 1.025 },
                  whileTap: { scale: 0.98 },
                }
              : {})}
            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
            // Soft glow halo while submitting so the button reads as
            // an active step in the pipeline rather than a frozen
            // disabled control.
            animate={
              isSubmitting
                ? {
                    boxShadow: [
                      '0 0 0 0 rgba(16,185,129,0.5)',
                      '0 0 0 10px rgba(16,185,129,0)',
                    ],
                  }
                : { boxShadow: '0 0 0 0 rgba(16,185,129,0)' }
            }
          >
            <AnimatePresence mode="wait" initial={false}>
              {state === 'submitting' && (
                <motion.span
                  key="submitting"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22 }}
                  className="flex items-center gap-2"
                >
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Launching
                </motion.span>
              )}
              {state === 'success' && (
                <motion.span
                  key="success"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22 }}
                  className="flex items-center gap-2"
                >
                  <motion.svg
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.32, ease: 'easeOut' }}
                  >
                    <motion.path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.32, ease: 'easeOut' }}
                    />
                  </motion.svg>
                  Launched
                </motion.span>
              )}
              {state !== 'submitting' && state !== 'success' && (
                <motion.span
                  key="idle"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22 }}
                >
                  Launch
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>

        <div className="mt-2 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => { setShowTokenField((v) => !v); }}
            className="text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
            disabled={isSubmitting || state === 'success'}
          >
            {showTokenField ? '− Hide private-repo options' : '+ Private repo? Use an access token'}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {showTokenField && (
            <motion.div
              key="token-field"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="mt-3">
                <label htmlFor="github-token" className="block text-sm text-gray-300 mb-1">
                  GitHub personal access token
                </label>
                <input
                  id="github-token"
                  type="password"
                  value={token}
                  onChange={(e) => { setToken(e.target.value); }}
                  placeholder="github_pat_..."
                  className="input w-full font-mono text-sm"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isSubmitting || state === 'success'}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Create a fine-grained token at{' '}
                  <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-gray-300"
                  >
                    github.com/settings/personal-access-tokens
                  </a>
                  {' '}with read access to the target repo. Stored encrypted at
                  rest (AES-256-GCM) and used only to fetch this project&apos;s
                  metadata.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.p
              key={error}
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{
                opacity: 1,
                y: 0,
                // Tiny shake on appearance to draw the eye to the
                // newly-revealed error without being obnoxious.
                x: [0, -6, 6, -4, 4, 0],
              }}
              exit={{ opacity: 0, y: -4 }}
              transition={{
                duration: 0.5,
                x: { duration: 0.4, ease: 'easeOut' },
              }}
              className="mt-2 text-red-400 text-sm"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.form>
  );
}
