import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChatCircleDots,
  PaperPlaneTilt,
  Robot,
  Spinner,
  Trash,
  User,
  Wrench,
  X,
} from '@phosphor-icons/react';

/**
 * Agent chat panel — the dashboard's conversational interface to
 * Bufo, LaunchKit's AI teammate.
 *
 * Architecture: the panel opens as a slide-over from the right
 * edge. Messages stream in via SSE from
 * `POST /api/projects/:projectId/chat`. Tool calls are rendered
 * inline as collapsed cards that expand on click.
 *
 * Design direction (from /frontend-design skill):
 * - Dark glass panel with subtle noise texture
 * - Messages use the accent glow pulse on arrival
 * - Tool calls render as collapsible "operation cards"
 * - Input has a subtle inner glow on focus
 * - Bufo's messages stream character-by-character
 */

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: {
    id: string;
    name: string;
    input: unknown;
    result?: unknown;
    isExecuting?: boolean;
  }[];
  isStreaming?: boolean;
}

const STORAGE_KEY_PREFIX = 'launchkit-chat-';

function loadPersistedMessages(projectId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Strip transient streaming state from restored messages.
    return (parsed as ChatMessage[]).map((m) => ({
      ...m,
      isStreaming: false,
      ...(m.toolCalls
        ? { toolCalls: m.toolCalls.map((tc) => ({ ...tc, isExecuting: false })) }
        : {}),
    }));
  } catch {
    return [];
  }
}

function persistMessages(projectId: string, msgs: ChatMessage[]): void {
  try {
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${projectId}`,
      JSON.stringify(msgs)
    );
  } catch {
    // Storage full or unavailable — silently drop.
  }
}

interface ChatPanelProps {
  projectId: string;
}

export function ChatPanel({ projectId }: ChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadPersistedMessages(projectId)
  );
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [model, setModel] = useState<'claude-sonnet-4-6' | 'claude-opus-4-6' | 'claude-haiku-4-5-20251001'>('claude-sonnet-4-6');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist messages to localStorage whenever they change.
  useEffect(() => {
    persistMessages(projectId, messages);
  }, [projectId, messages]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now().toString()}`,
      role: 'user',
      content: input.trim(),
    };

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now().toString()}`,
      role: 'assistant',
      content: '',
      toolCalls: [],
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput('');
    setStreaming(true);

    // Build the conversation history for the API.
    const history = [...messages, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response = await fetch(
        `/api/projects/${projectId}/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, model }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Chat failed' })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${String(response.status)}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;

            try {
              const event = JSON.parse(jsonStr) as {
                text?: string;
                id?: string;
                name?: string;
                input?: unknown;
                result?: unknown;
                error?: string;
                status?: string;
              };

              // Determine event type from the SSE event field.
              // Hono's streamSSE sends `event:` lines before `data:`.
              // We parse the data payload and infer the type from
              // which fields are present.
              if (event.text !== undefined) {
                // Text delta — append to the assistant message.
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + event.text,
                    };
                  }
                  return updated;
                });
              } else if (event.status === 'executing' && event.id && event.name) {
                // Tool progress — mark the tool call as actively executing.
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant' && last.toolCalls) {
                    const calls = last.toolCalls.map((tc) =>
                      tc.id === event.id
                        ? { ...tc, isExecuting: true }
                        : tc
                    );
                    updated[updated.length - 1] = {
                      ...last,
                      toolCalls: calls,
                    };
                  }
                  return updated;
                });
              } else if (event.name && event.id && event.result === undefined && event.input !== undefined) {
                // Tool call start.
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      toolCalls: [
                        ...(last.toolCalls ?? []),
                        {
                          id: event.id ?? '',
                          name: event.name ?? '',
                          input: event.input,
                        },
                      ],
                    };
                  }
                  return updated;
                });
              } else if (event.id && event.result !== undefined) {
                // Tool result — store result and clear executing state.
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant' && last.toolCalls) {
                    const calls = last.toolCalls.map((tc) =>
                      tc.id === event.id
                        ? { ...tc, result: event.result, isExecuting: false }
                        : tc
                    );
                    updated[updated.length - 1] = {
                      ...last,
                      toolCalls: calls,
                    };
                  }
                  return updated;
                });
              } else if (event.error) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      content: `Error: ${String(event.error ?? 'Unknown error')}`,
                      isStreaming: false,
                    };
                  }
                  return updated;
                });
              }
            } catch {
              // Non-JSON line — skip.
            }
          }
        }
      }

      // Mark streaming complete.
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            isStreaming: false,
          };
        }
        return updated;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: `Error: ${message}`,
            isStreaming: false,
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, messages, projectId, model]);

  const clearConversation = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${projectId}`);
  }, [projectId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      <motion.button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-accent-500 text-white shadow-lg shadow-accent-500/25 flex items-center justify-center"
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: open ? 0 : 1, opacity: open ? 0 : 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        aria-label="Open chat with Bufo"
      >
        <ChatCircleDots weight="fill" size={26} />
      </motion.button>

      {/* Chat panel slide-over */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />

            {/* Panel */}
            <motion.div
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg flex flex-col bg-surface-950 border-l border-surface-800 shadow-2xl shadow-black/50"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{
                type: 'spring',
                stiffness: 300,
                damping: 30,
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-surface-800">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent-500/20 flex items-center justify-center">
                    <Robot weight="fill" size={18} className="text-accent-400" />
                  </div>
                  <div>
                    <h3 className="font-display text-heading-sm text-text-primary">
                      Bufo
                    </h3>
                    <p className="text-mono-sm text-text-muted font-mono">
                      AI teammate
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Model selector */}
                  <select
                    value={model}
                    onChange={(e) =>
                      setModel(
                        e.target.value as typeof model
                      )
                    }
                    disabled={streaming}
                    className="rounded-lg border border-surface-700 bg-surface-900/80 px-2.5 py-1.5 font-mono text-mono-sm text-text-secondary focus:outline-none focus:border-accent-500/50 transition-colors disabled:opacity-40 cursor-pointer appearance-none"
                    aria-label="Select AI model"
                    style={{ backgroundImage: 'none' }}
                  >
                    <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                    <option value="claude-opus-4-6">Opus 4.6</option>
                    <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
                  </select>
                  <button
                    onClick={clearConversation}
                    disabled={streaming || messages.length === 0}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-surface-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="Clear conversation"
                    title="Clear conversation"
                  >
                    <Trash weight="bold" size={16} />
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-800 transition-colors"
                    aria-label="Close chat"
                  >
                    <X weight="bold" size={16} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {messages.length === 0 && (
                  <motion.div
                    className="flex flex-col items-center justify-center h-full text-center py-12"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <div className="w-16 h-16 rounded-2xl bg-accent-500/10 flex items-center justify-center mb-4">
                      <Robot weight="fill" size={32} className="text-accent-400" />
                    </div>
                    <p className="font-display text-display-sm text-text-primary mb-2">
                      Chat with Bufo
                    </p>
                    <p className="text-body-sm text-text-muted max-w-xs">
                      Ask questions about the project, generate marketing
                      content, or iterate on existing assets.
                    </p>
                  </motion.div>
                )}

                <AnimatePresence initial={false}>
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{
                        type: 'spring',
                        stiffness: 260,
                        damping: 24,
                      }}
                      className={`flex gap-3 ${
                        msg.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-accent-500/15 flex items-center justify-center mt-0.5">
                          <Robot
                            weight="fill"
                            size={14}
                            className="text-accent-400"
                          />
                        </div>
                      )}

                      <div
                        className={`max-w-[85%] ${
                          msg.role === 'user'
                            ? 'bg-accent-500/15 border border-accent-500/20 rounded-2xl rounded-br-md px-4 py-3'
                            : 'bg-surface-900/80 border border-surface-800 rounded-2xl rounded-bl-md px-4 py-3'
                        }`}
                      >
                        {/* Tool calls */}
                        {msg.toolCalls && msg.toolCalls.length > 0 && (
                          <div className="mb-3 space-y-2">
                            {msg.toolCalls.map((tc) => (
                              <ToolCallCard key={tc.id} toolCall={tc} />
                            ))}
                          </div>
                        )}

                        {/* Message text */}
                        {msg.content && (
                          <div className="text-body-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                            {msg.content}
                            {msg.isStreaming && (
                              <motion.span
                                className="inline-block w-1.5 h-4 bg-accent-400 ml-0.5 rounded-sm"
                                animate={{ opacity: [1, 0] }}
                                transition={{
                                  duration: 0.6,
                                  repeat: Infinity,
                                  repeatType: 'reverse',
                                }}
                              />
                            )}
                          </div>
                        )}

                        {!msg.content && msg.isStreaming && (
                          <div className="flex items-center gap-2 text-text-muted text-body-sm">
                            <Spinner
                              weight="bold"
                              size={14}
                              className="animate-spin"
                            />
                            Thinking...
                          </div>
                        )}
                      </div>

                      {msg.role === 'user' && (
                        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-surface-800 flex items-center justify-center mt-0.5">
                          <User weight="fill" size={14} className="text-text-secondary" />
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>

                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-5 py-4 border-t border-surface-800">
                <div className="relative flex items-end gap-2">
                  <div className="flex-1 relative group">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask Bufo anything..."
                      rows={1}
                      disabled={streaming}
                      className="w-full resize-none rounded-xl border border-surface-700 bg-surface-900/60 px-4 py-3 text-body-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/20 transition-all disabled:opacity-50"
                      style={{ minHeight: '44px', maxHeight: '120px' }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = `${String(Math.min(target.scrollHeight, 120))}px`;
                      }}
                    />
                    {/* Focus glow */}
                    <div className="pointer-events-none absolute inset-0 rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 shadow-[inset_0_0_16px_2px_var(--color-accent-500,#10b981)] mix-blend-overlay" />
                  </div>
                  <motion.button
                    onClick={() => void sendMessage()}
                    disabled={!input.trim() || streaming}
                    className="flex-shrink-0 w-11 h-11 rounded-xl bg-accent-500 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {streaming ? (
                      <Spinner weight="bold" size={18} className="animate-spin" />
                    ) : (
                      <PaperPlaneTilt weight="fill" size={18} />
                    )}
                  </motion.button>
                </div>
                <p className="text-mono-sm text-text-muted mt-2 font-mono">
                  Enter to send · Shift+Enter for new line
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Tool call card ───────────────────────────────────────────────

interface ToolCallCardProps {
  toolCall: {
    id: string;
    name: string;
    input: unknown;
    result?: unknown;
    isExecuting?: boolean;
  };
}

function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const toolLabels: Record<string, string> = {
    generate_written_content: 'Generate content',
    get_project_info: 'Read project info',
    list_project_assets: 'List assets',
    search_web: 'Search the web',
  };

  return (
    <motion.div
      className="rounded-lg border border-surface-700 bg-surface-900/60 overflow-hidden"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-body-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <Wrench weight="bold" size={12} className="text-accent-400" />
        <span className="font-mono text-mono-sm">
          {toolLabels[toolCall.name] ?? toolCall.name}
        </span>
        {toolCall.result !== undefined ? (
          <span className="ml-auto text-accent-400 text-mono-sm font-mono">
            done
          </span>
        ) : toolCall.isExecuting ? (
          <span className="ml-auto text-amber-400 text-mono-sm font-mono">
            Running...
          </span>
        ) : (
          <Spinner
            weight="bold"
            size={12}
            className="ml-auto animate-spin text-text-muted"
          />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-surface-700 px-3 py-2 overflow-hidden"
          >
            {toolCall.input !== undefined && toolCall.input !== null && (
              <div className="mb-2">
                <p className="text-mono-sm font-mono text-text-muted mb-1">
                  Input:
                </p>
                <pre className="text-mono-sm font-mono text-text-tertiary bg-surface-950 rounded p-2 overflow-x-auto max-h-32">
                  {JSON.stringify(toolCall.input, null, 2)}
                </pre>
              </div>
            )}
            {toolCall.result !== undefined && (
              <div>
                <p className="text-mono-sm font-mono text-text-muted mb-1">
                  Result:
                </p>
                <pre className="text-mono-sm font-mono text-text-tertiary bg-surface-950 rounded p-2 overflow-x-auto max-h-48">
                  {typeof toolCall.result === 'string'
                    ? toolCall.result
                    : JSON.stringify(toolCall.result, null, 2)}
                </pre>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
