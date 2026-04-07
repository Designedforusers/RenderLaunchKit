interface LaunchStrategyCardProps {
  strategy: {
    positioning: string;
    tone: string;
    keyMessages: string[];
    selectedChannels: Array<{
      channel: string;
      priority: number;
      reasoning: string;
    }>;
    skipAssets: Array<{
      type: string;
      reasoning: string;
    }>;
  };
}

const TONE_COLORS: Record<string, string> = {
  technical: 'text-blue-400 bg-blue-400/10',
  casual: 'text-amber-400 bg-amber-400/10',
  enthusiastic: 'text-pink-400 bg-pink-400/10',
  authoritative: 'text-violet-400 bg-violet-400/10',
};

export function LaunchStrategyCard({ strategy }: LaunchStrategyCardProps) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-mono font-semibold text-sm text-surface-400 uppercase tracking-wider">
          Launch Strategy
        </h3>
        <span className={`badge ${TONE_COLORS[strategy.tone] ?? 'text-surface-400 bg-surface-400/10'}`}>
          {strategy.tone}
        </span>
      </div>

      {/* Positioning */}
      <div className="mb-6">
        <p className="text-lg text-surface-100 font-medium leading-relaxed">
          &ldquo;{strategy.positioning}&rdquo;
        </p>
      </div>

      {/* Key Messages */}
      <div className="mb-6">
        <h4 className="text-xs font-mono text-surface-500 uppercase tracking-wider mb-3">
          Key Messages
        </h4>
        <ul className="space-y-2">
          {strategy.keyMessages.map((msg, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-accent-500 mt-0.5 font-mono text-xs">{String(i + 1).padStart(2, '0')}</span>
              <span className="text-sm text-surface-300">{msg}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Channels */}
      <div className="mb-6">
        <h4 className="text-xs font-mono text-surface-500 uppercase tracking-wider mb-3">
          Target Channels
        </h4>
        <div className="flex flex-wrap gap-2">
          {strategy.selectedChannels
            .sort((a, b) => a.priority - b.priority)
            .map((ch) => (
              <div
                key={ch.channel}
                className="group relative"
                title={ch.reasoning}
              >
                <span className="badge bg-surface-800 text-surface-300 border border-surface-700">
                  <span className="text-accent-500 mr-1 font-mono text-[10px]">#{ch.priority}</span>
                  {ch.channel.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Skipped Assets */}
      {strategy.skipAssets.length > 0 && (
        <div>
          <h4 className="text-xs font-mono text-surface-500 uppercase tracking-wider mb-3">
            Skipped Assets
          </h4>
          <div className="space-y-1.5">
            {strategy.skipAssets.map((skip) => (
              <div key={skip.type} className="flex items-start gap-2 text-sm">
                <span className="text-surface-600">~</span>
                <span className="text-surface-500">
                  <span className="text-surface-400">{skip.type.replace(/_/g, ' ')}</span>
                  {' — '}
                  {skip.reasoning}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
