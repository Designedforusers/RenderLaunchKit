import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ── Types ───────────────────────────────────────────────────────────

type ToastVariant = 'success' | 'error' | 'info';

interface ToastInput {
  message: string;
  variant?: ToastVariant;
  description?: string;
  duration?: number;
}

interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  description: string | null;
  duration: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

// ── Context ─────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Hook to push a toast from anywhere inside `<ToastProvider>`. Throws
 * if called outside the provider so a mis-mounted consumer fails
 * loudly during development instead of silently swallowing actions.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}

// ── Provider ────────────────────────────────────────────────────────

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Monotonic id so AnimatePresence can track entries cleanly.
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const duration = input.duration ?? 2800;
      const next: Toast = {
        id,
        message: input.message,
        variant: input.variant ?? 'info',
        description: input.description ?? null,
        duration,
      };
      setToasts((prev) => [...prev, next]);
      setTimeout(() => {
        dismiss(id);
      }, duration);
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Stack — fixed bottom-right. Framer-motion layout animation
          slides newer toasts up as older ones dismiss, producing a
          tidy, intentional stack instead of jumpy absolute positioning. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-6 sm:items-end sm:pr-6">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// ── Single toast ────────────────────────────────────────────────────

const VARIANT_STYLES: Record<
  ToastVariant,
  { border: string; bg: string; icon: string; accent: string; iconPath: string }
> = {
  success: {
    border: 'border-success-500/40',
    bg: 'from-success-500/20 via-success-500/5 to-transparent',
    icon: 'text-success-300',
    accent: 'bg-success-500',
    iconPath: 'M5 13l4 4L19 7',
  },
  error: {
    border: 'border-red-500/40',
    bg: 'from-red-500/20 via-red-500/5 to-transparent',
    icon: 'text-red-300',
    accent: 'bg-red-500',
    iconPath: 'M6 18L18 6M6 6l12 12',
  },
  info: {
    border: 'border-blue-500/40',
    bg: 'from-blue-500/20 via-blue-500/5 to-transparent',
    icon: 'text-blue-300',
    accent: 'bg-blue-500',
    iconPath:
      'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const styles = VARIANT_STYLES[toast.variant];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className={`pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border ${styles.border} bg-gradient-to-br ${styles.bg} bg-surface-900/85 px-4 py-3 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.5)] backdrop-blur`}
      role="status"
      aria-live="polite"
    >
      {/* Animated progress bar showing remaining dwell time. */}
      <motion.div
        className={`absolute left-0 bottom-0 h-[2px] ${styles.accent}`}
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration: toast.duration / 1000, ease: 'linear' }}
      />
      <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/5 ${styles.icon}`}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          className="h-3.5 w-3.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d={styles.iconPath}
          />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-surface-100 truncate">
          {toast.message}
        </p>
        {toast.description && (
          <p className="mt-0.5 text-xs text-surface-400 truncate">
            {toast.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-surface-500 hover:text-surface-200 transition-colors"
        aria-label="Dismiss notification"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-4 w-4"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  );
}
