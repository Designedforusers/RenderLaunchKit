import { useState, useRef, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TooltipProps {
  label: string;
  children: ReactElement;
  side?: 'top' | 'bottom';
  delay?: number;
}

/**
 * Lightweight tooltip primitive. Wraps a single interactive child and
 * renders a motion-animated label above (or below) it on hover /
 * focus. Uses the native `aria-describedby` relationship so screen
 * readers read the label out loud — this is a real affordance, not
 * purely decorative.
 *
 * Intentionally not using a portal: all of our tooltips live inside
 * cards that don't overflow-hide, so the positioning is stable with
 * a plain absolutely-positioned div. Keeps the component self-
 * contained with no extra root-level infrastructure to wire up.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  delay = 180,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(false);
  };

  return (
    <span className="relative inline-flex">
      <span
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? tooltipId : undefined}
        className="inline-flex"
      >
        {children}
      </span>
      <AnimatePresence>
        {open && (
          <motion.span
            id={tooltipId}
            role="tooltip"
            initial={{ opacity: 0, y: side === 'top' ? 4 : -4, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: side === 'top' ? 4 : -4, scale: 0.94 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-surface-700 bg-surface-900/95 px-2 py-1 font-mono text-[11px] text-surface-200 shadow-lg backdrop-blur ${
              side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
            }`}
          >
            {label}
            {/* Arrow */}
            <span
              className={`absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border-surface-700 bg-surface-900 ${
                side === 'top'
                  ? 'bottom-[-3px] border-b border-r'
                  : 'top-[-3px] border-l border-t'
              }`}
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

interface TooltipRootProps {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}

/**
 * Non-element variant of `Tooltip` that wraps arbitrary ReactNode
 * children in a span. Use when the child isn't a single React
 * element (e.g. a string, a fragment). Slightly more expensive
 * markup but more ergonomic for one-offs.
 */
export function TooltipSpan({ label, children, side = 'top' }: TooltipRootProps) {
  return (
    <Tooltip label={label} side={side}>
      <span className="inline-flex">{children}</span>
    </Tooltip>
  );
}
