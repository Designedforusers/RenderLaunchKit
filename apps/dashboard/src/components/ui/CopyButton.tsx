import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from './ToastProvider.js';
import { Tooltip } from './Tooltip.js';

interface CopyButtonProps {
  value: string;
  label?: string;
  successMessage?: string;
  className?: string;
}

/**
 * Icon button that copies `value` to the clipboard, swaps its glyph
 * to a check-mark for a beat, and surfaces a success toast. Falls
 * back to a real error toast if the async clipboard call throws.
 */
export function CopyButton({
  value,
  label = 'Copy to clipboard',
  successMessage = 'Copied to clipboard',
  className = '',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ message: successMessage, variant: 'success' });
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({
        message: 'Copy failed',
        description: 'Your browser blocked clipboard access',
        variant: 'error',
      });
    }
  };

  return (
    <Tooltip label={copied ? 'Copied!' : label}>
      <motion.button
        type="button"
        onClick={() => void handleCopy()}
        whileTap={{ scale: 0.92 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-surface-700 bg-surface-800/80 text-surface-400 hover:border-accent-500/50 hover:bg-surface-800 hover:text-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 transition-colors ${className}`}
        aria-label={label}
      >
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.svg
              key="check"
              initial={{ scale: 0.5, rotate: -45, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              exit={{ scale: 0.5, rotate: 45, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              className="h-3.5 w-3.5 text-accent-400"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </motion.svg>
          ) : (
            <motion.svg
              key="copy"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.15 }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-3.5 w-3.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </motion.svg>
          )}
        </AnimatePresence>
      </motion.button>
    </Tooltip>
  );
}
