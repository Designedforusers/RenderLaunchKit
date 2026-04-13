import { motion } from 'framer-motion';
import { Tooltip } from '../ui/index.js';

export function QualityScoreRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(10, score)) / 10;
  const circumference = 2 * Math.PI * 10;
  const color =
    score >= 7
      ? 'text-success-400'
      : score >= 5
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <Tooltip label={`Quality score: ${score.toFixed(1)} / 10`}>
      <div className={`relative flex h-7 w-7 items-center justify-center ${color}`}>
        <svg viewBox="0 0 24 24" className="absolute inset-0 h-full w-full -rotate-90">
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.15}
            strokeWidth={2}
          />
          <motion.circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference * (1 - pct) }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          />
        </svg>
        <span className="font-mono text-[10px] font-bold">{score.toFixed(1)}</span>
      </div>
    </Tooltip>
  );
}
