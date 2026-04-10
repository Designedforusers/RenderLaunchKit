import { useState, useRef, useEffect, useCallback } from 'react';

interface ModelOption {
  id: string;
  name: string;
  badge: string;
  costLabel: string;
}

interface ModelSelectorProps {
  label: string;
  value: string;
  options: readonly ModelOption[];
  onChange: (id: string) => void;
}

/**
 * Compact dropdown for picking a generation model. Shows the current
 * selection as a label + chevron trigger; clicking opens a popover
 * with all options and their cost/badge metadata.
 *
 * "Auto" is always the first option — the auto-router picks the best
 * model for the asset type and instructions. Manual overrides are for
 * power users who want control.
 *
 * Inspired by Visual Electric's model selector: compact trigger,
 * descriptive badges, minimal footprint when collapsed.
 */
export function ModelSelector({
  label,
  value,
  options,
  onChange,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = value === 'auto'
    ? null
    : options.find((o) => o.id === value);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      containerRef.current &&
      !containerRef.current.contains(e.target as Node)
    ) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, handleClickOutside]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200 transition-colors rounded-md px-2 py-1 hover:bg-surface-800/50"
      >
        <span className="text-surface-500">{label}:</span>
        <span className="font-medium">
          {selected ? selected.name : 'Auto'}
        </span>
        <svg
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-50 min-w-[220px] rounded-lg border border-surface-700/50 bg-surface-850 shadow-xl shadow-black/30 overflow-hidden">
          {/* Auto option */}
          <button
            type="button"
            onClick={() => {
              onChange('auto');
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-3 transition-colors ${
              value === 'auto'
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'text-surface-300 hover:bg-surface-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">Auto</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                recommended
              </span>
            </div>
            {value === 'auto' && (
              <svg className="h-3.5 w-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          <div className="h-px bg-surface-700/50" />

          {/* Model options */}
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-3 transition-colors ${
                value === option.id
                  ? 'bg-emerald-500/10 text-emerald-300'
                  : 'text-surface-300 hover:bg-surface-800'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate">{option.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-700/60 text-surface-400 font-medium shrink-0">
                  {option.badge}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-surface-500">
                  {option.costLabel}
                </span>
                {value === option.id && (
                  <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
