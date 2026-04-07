import { useState } from 'react';
import { api } from '../lib/api.js';

interface RepositoryUrlFormProps {
  onProjectCreated: (id: string) => void;
}

export function RepositoryUrlForm({ onProjectCreated }: RepositoryUrlFormProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const result = await api.createProject(url.trim());
      onProjectCreated(result.id);
      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="relative">
        <div className="flex gap-3">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="input flex-1 text-lg font-mono"
            disabled={loading}
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="btn-primary text-lg px-8 whitespace-nowrap"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Analyzing...
              </span>
            ) : (
              'Launch'
            )}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-red-400 text-sm animate-fade-in">{error}</p>
        )}
      </div>
    </form>
  );
}
