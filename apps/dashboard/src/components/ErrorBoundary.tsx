import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { motion } from 'framer-motion';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Route-level error boundary. Catches render-time crashes in any
 * child component tree and shows a recovery card instead of a
 * blank white page. Placed inside `<Routes>` in App.tsx so the
 * shell nav still renders when a single route blows up.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="max-w-6xl mx-auto px-6 py-24 flex justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-red-500/15 bg-surface-900/60 p-10 text-center"
        >
          <motion.div
            className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 text-red-400/80"
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              delay: 0.1,
              type: 'spring',
              stiffness: 400,
              damping: 22,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-6 w-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </motion.div>
          <p className="text-heading-md text-text-primary">
            Something went wrong
          </p>
          <p className="text-body-sm text-text-muted mt-2">
            An unexpected error occurred while rendering this page.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
            className="btn-secondary mt-7 inline-flex items-center gap-2 text-body-sm"
          >
            Reload page
          </button>
        </motion.div>
      </div>
    );
  }
}
