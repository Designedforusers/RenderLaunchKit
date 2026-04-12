import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowClockwise,
  CaretDown,
  ChatCircleDots,
  Check,
  CircleNotch,
  PaperPlaneTilt,
  Robot,
  Trash,
  User,
  Warning,
  Wrench,
  X,
} from '@phosphor-icons/react';

/** Strip markdown syntax so chat messages render as clean plain text. */
function stripMarkdown(text: string): string {
  return (
    text
      // Bold / italic wrappers
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      // Inline code
      .replace(/`(.+?)`/g, '$1')
      // Headings
      .replace(/^#{1,6}\s+/gm, '')
      // Markdown links → just the label
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
  );
}

/** Three-dot typing indicator — the Mercury/iMessage pattern. */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-success-400/70"
          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

/** Inline error display with retry action. */
function ChatError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  // Extract a user-friendly summary from the raw error.
  const friendly = message.includes('HTTP 5')
    ? 'The server hit an issue processing that request.'
    : message.includes('HTTP 4')
      ? 'That request couldn\u2019t be completed.'
      : message.includes('No response body')
        ? 'Lost connection to the server.'
        : message.includes('fetch')
          ? 'Couldn\u2019t reach the server. Check your connection.'
          : message;

  return (
    <motion.div
      className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
    >
      <div className="flex-shrink-0 mt-0.5">
        <div className="w-6 h-6 rounded-lg bg-red-500/15 flex items-center justify-center">
          <Warning weight="fill" size={14} className="text-red-400" />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body-sm text-red-300/90 leading-relaxed">
          {friendly}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1.5 text-mono-sm font-mono text-red-400/80 hover:text-red-300 transition-colors"
          >
            <ArrowClockwise weight="bold" size={12} />
            Try again
          </button>
        )}
      </div>
    </motion.div>
  );
}

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
  error?: string;
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
                      error: String(event.error ?? 'Something went wrong'),
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
      const errMessage = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            error: errMessage,
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
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-800/80">
                <div className="flex items-center gap-3">
                  <div className="relative w-9 h-9 rounded-xl bg-accent-500/15 flex items-center justify-center">
                    <Robot weight="fill" size={18} className="text-accent-400" />
                    {/* Online dot */}
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success-500 border-2 border-surface-950" />
                  </div>
                  <div>
                    <h3 className="text-heading-sm text-text-primary leading-none">
                      Bufo
                    </h3>
                    <p className="text-mono-sm text-text-muted font-mono mt-0.5">
                      {streaming ? 'thinking...' : 'online'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {/* Model selector */}
                  <select
                    value={model}
                    onChange={(e) =>
                      setModel(
                        e.target.value as typeof model
                      )
                    }
                    disabled={streaming}
                    className="rounded-lg border border-surface-700/60 bg-surface-900/60 px-2.5 py-1.5 font-mono text-mono-sm text-text-tertiary hover:text-text-secondary focus:outline-none focus:border-accent-500/40 transition-colors disabled:opacity-40 cursor-pointer appearance-none"
                    aria-label="Select AI model"
                    style={{ backgroundImage: 'none' }}
                  >
                    <option value="claude-sonnet-4-6">Sonnet</option>
                    <option value="claude-opus-4-6">Opus</option>
                    <option value="claude-haiku-4-5-20251001">Haiku</option>
                  </select>
                  <motion.button
                    onClick={clearConversation}
                    disabled={streaming || messages.length === 0}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                    whileTap={{ scale: 0.9 }}
                    aria-label="Clear conversation"
                    title="Clear conversation"
                  >
                    <Trash weight="bold" size={15} />
                  </motion.button>
                  <motion.button
                    onClick={() => setOpen(false)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-800 transition-colors"
                    whileTap={{ scale: 0.9 }}
                    aria-label="Close chat"
                  >
                    <X weight="bold" size={15} />
                  </motion.button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {messages.length === 0 && (
                  <motion.div
                    className="flex flex-col items-center justify-center h-full text-center py-12"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.4 }}
                  >
                    <motion.div
                      className="w-14 h-14 rounded-2xl bg-accent-500/10 flex items-center justify-center mb-5"
                      animate={{ y: [0, -3, 0] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <Robot weight="fill" size={28} className="text-accent-400" />
                    </motion.div>
                    <p className="text-heading-md text-text-primary mb-2">
                      What are you working on?
                    </p>
                    <p className="text-body-sm text-text-muted max-w-[240px] leading-relaxed">
                      Ask about the project, generate content, search for trends, or refine assets.
                    </p>

                    {/* Quick action chips */}
                    <div className="flex flex-wrap justify-center gap-2 mt-6 max-w-xs">
                      {[
                        'What assets do we have?',
                        'Write a tweet thread',
                        'Summarize the strategy',
                      ].map((suggestion) => (
                        <motion.button
                          key={suggestion}
                          onClick={() => setInput(suggestion)}
                          className="px-3 py-1.5 rounded-full border border-surface-700/60 bg-surface-900/40 text-body-xs text-text-tertiary hover:text-text-secondary hover:border-surface-600 hover:bg-surface-800/60 transition-all"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          {suggestion}
                        </motion.button>
                      ))}
                    </div>
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
                        <div className="flex-shrink-0 w-6 h-6 rounded-lg bg-accent-500/12 flex items-center justify-center mt-1">
                          <Robot
                            weight="fill"
                            size={12}
                            className="text-accent-400/80"
                          />
                        </div>
                      )}

                      <div
                        className={`max-w-[82%] ${
                          msg.role === 'user'
                            ? 'bg-accent-500/10 border border-accent-500/15 rounded-2xl rounded-br-md px-4 py-2.5'
                            : `rounded-2xl rounded-bl-md px-4 py-2.5 ${
                                msg.error
                                  ? 'bg-transparent border-none p-0'
                                  : 'bg-surface-900/50 border border-surface-800/60'
                              }`
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

                        {/* Error display */}
                        {msg.error && (
                          <ChatError
                            message={msg.error}
                            onRetry={() => {
                              // Remove the failed assistant message and re-send the last user message.
                              const lastUserMsg = messages
                                .filter((m) => m.role === 'user')
                                .pop();
                              if (lastUserMsg) {
                                setMessages((prev) =>
                                  prev.filter((m) => m.id !== msg.id)
                                );
                                setInput(lastUserMsg.content);
                              }
                            }}
                          />
                        )}

                        {/* Message text */}
                        {msg.content && !msg.error && (
                          <div className="text-body-sm text-text-primary whitespace-pre-wrap leading-relaxed">
                            {stripMarkdown(msg.content)}
                            {msg.isStreaming && (
                              <motion.span
                                className="inline-block w-1.5 h-4 bg-success-400 ml-0.5 rounded-sm"
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

                        {/* Typing indicator — shows when waiting for first token */}
                        {!msg.content && !msg.error && msg.isStreaming && (
                          <TypingIndicator />
                        )}
                      </div>

                      {msg.role === 'user' && (
                        <div className="flex-shrink-0 w-6 h-6 rounded-lg bg-surface-800/80 flex items-center justify-center mt-1">
                          <User weight="fill" size={12} className="text-text-tertiary" />
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>

                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-5 py-3.5 border-t border-surface-800/80">
                <div className="relative flex items-end gap-2">
                  <div className="flex-1 relative group">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Message Bufo..."
                      rows={1}
                      disabled={streaming}
                      className="w-full resize-none rounded-xl border border-surface-700/60 bg-surface-900/40 px-4 py-3 text-body-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-500/40 focus:ring-1 focus:ring-accent-500/15 transition-all duration-200 disabled:opacity-40"
                      style={{ minHeight: '44px', maxHeight: '120px' }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = `${String(Math.min(target.scrollHeight, 120))}px`;
                      }}
                    />
                  </div>
                  <motion.button
                    onClick={() => void sendMessage()}
                    disabled={!input.trim() || streaming}
                    className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-200 ${
                      input.trim() && !streaming
                        ? 'bg-accent-500 text-white shadow-sm shadow-accent-500/20'
                        : 'bg-surface-800/60 text-text-muted'
                    } disabled:cursor-not-allowed`}
                    whileHover={input.trim() && !streaming ? { scale: 1.05 } : {}}
                    whileTap={input.trim() && !streaming ? { scale: 0.92 } : {}}
                  >
                    {streaming ? (
                      <CircleNotch weight="bold" size={16} className="animate-spin" />
                    ) : (
                      <PaperPlaneTilt weight="fill" size={16} />
                    )}
                  </motion.button>
                </div>
                <p className="text-mono-sm text-text-muted/60 mt-1.5 font-mono text-center">
                  enter to send
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
  const isDone = toolCall.result !== undefined;
  const isRunning = toolCall.isExecuting === true;

  const toolLabels: Record<string, string> = {
    generate_written_content: 'Generating content',
    get_project_info: 'Reading project info',
    list_project_assets: 'Listing assets',
    search_web: 'Searching the web',
    web_search: 'Searching the web',
  };

  const toolDoneLabels: Record<string, string> = {
    generate_written_content: 'Generated content',
    get_project_info: 'Read project info',
    list_project_assets: 'Listed assets',
    search_web: 'Searched the web',
    web_search: 'Searched the web',
  };

  const label = isDone
    ? (toolDoneLabels[toolCall.name] ?? toolCall.name)
    : (toolLabels[toolCall.name] ?? toolCall.name);

  return (
    <motion.div
      className={`rounded-lg border overflow-hidden transition-colors duration-200 ${
        isDone
          ? 'border-success-500/15 bg-success-500/[0.03]'
          : isRunning
            ? 'border-amber-500/20 bg-amber-500/[0.03]'
            : 'border-surface-700 bg-surface-900/40'
      }`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-body-sm hover:bg-surface-800/30 transition-colors"
      >
        {/* Status icon */}
        {isDone ? (
          <motion.div
            className="flex-shrink-0 w-4.5 h-4.5 rounded-full bg-success-500/20 flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 20, delay: 0.1 }}
          >
            <Check weight="bold" size={10} className="text-success-400" />
          </motion.div>
        ) : isRunning ? (
          <CircleNotch weight="bold" size={14} className="flex-shrink-0 animate-spin text-amber-400" />
        ) : (
          <Wrench weight="bold" size={12} className="flex-shrink-0 text-text-muted" />
        )}

        <span className={`font-mono text-mono-sm ${isDone ? 'text-text-secondary' : 'text-text-tertiary'}`}>
          {label}
        </span>

        {/* Expand chevron */}
        <motion.div
          className="ml-auto"
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <CaretDown weight="bold" size={10} className="text-text-muted" />
        </motion.div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="border-t border-surface-800/60 px-3 py-2.5 overflow-hidden"
          >
            {toolCall.input !== undefined && toolCall.input !== null && (
              <div className="mb-2.5">
                <p className="text-mono-sm font-mono text-text-muted mb-1.5 uppercase tracking-wider">
                  Input
                </p>
                <pre className="text-mono-sm font-mono text-text-tertiary bg-surface-950/80 rounded-lg p-2.5 overflow-x-auto max-h-32 border border-surface-800/40">
                  {JSON.stringify(toolCall.input, null, 2)}
                </pre>
              </div>
            )}
            {toolCall.result !== undefined && (
              <div>
                <p className="text-mono-sm font-mono text-text-muted mb-1.5 uppercase tracking-wider">
                  Result
                </p>
                <pre className="text-mono-sm font-mono text-text-tertiary bg-surface-950/80 rounded-lg p-2.5 overflow-x-auto max-h-48 border border-surface-800/40">
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
