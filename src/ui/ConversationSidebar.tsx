import { useEffect, useState } from 'react';
import appIconUrl from '../assets/app-icon.svg';
import { AiSisterBrandMark } from './AiSisterTheme';
import { DEFAULT_CONVERSATION_SESSION_TITLE, type ConversationSession } from './conversationSessions';

export interface ConversationSidebarLabels {
  toggle: string;
  newConversation: string;
  history: string;
  empty: string;
  deleteConversation: string;
  confirmDeleteConversation: string;
}

export function ConversationSidebar({
  collapsed,
  sessions,
  activeSessionId,
  disabled,
  labels,
  locale,
  onToggle,
  onNewConversation,
  onSelectSession,
  onDeleteSession,
}: {
  collapsed: boolean;
  sessions: readonly ConversationSession[];
  activeSessionId: string;
  disabled: boolean;
  labels: ConversationSidebarLabels;
  locale: string;
  onToggle: () => void;
  onNewConversation: () => void;
  onSelectSession: (session: ConversationSession) => void;
  onDeleteSession: (session: ConversationSession) => void;
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | undefined>();

  useEffect(() => {
    if (
      pendingDeleteId
      && (collapsed || disabled || !sessions.some((session) => session.id === pendingDeleteId))
    ) {
      setPendingDeleteId(undefined);
    }
  }, [collapsed, disabled, pendingDeleteId, sessions]);

  return (
    <nav
      aria-label={labels.history}
      className={`ai-sister-session-sidebar workbench-session-sidebar ${collapsed ? 'w-[60px]' : 'w-[208px]'} flex min-h-0 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-[width] dark:border-zinc-800 dark:bg-zinc-900`}
    >
      <div className="workbench-sidebar-brand flex items-center gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <button
          type="button"
          className="workbench-brand-button grid h-9 w-9 shrink-0 place-items-center rounded-xl hover:bg-white focus-visible:outline-offset-2 dark:hover:bg-zinc-800"
          aria-label={labels.toggle}
          title={labels.toggle}
          onClick={onToggle}
        >
          <img src={appIconUrl} alt="" className="default-brand-icon h-8 w-8" />
          <AiSisterBrandMark className="h-8 w-8" />
        </button>
        {!collapsed ? (
          <span className="min-w-0">
            <span className="block truncate text-[0.875rem] font-semibold tracking-[-.02em] text-zinc-900 dark:text-zinc-100">Workbench</span>
            <span className="block truncate text-[0.625rem] text-zinc-500 dark:text-zinc-400">Multi-model workspace</span>
            <span className="ai-sister-only ai-sister-brand-subtitle">AI-Sister Edition</span>
          </span>
        ) : null}
      </div>

      <div className="px-2.5 py-3">
        <button
          type="button"
          className={`workbench-new-conversation ${collapsed ? 'grid h-9 w-9 place-items-center p-0' : 'flex w-full items-center gap-2 px-3 py-2'} rounded-xl border text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50`}
          onClick={onNewConversation}
          disabled={disabled}
          aria-label={labels.newConversation}
          title={labels.newConversation}
        >
          <span className="text-lg leading-none" aria-hidden="true">＋</span>
          {!collapsed ? <span>{labels.newConversation}</span> : null}
        </button>
      </div>

      {!collapsed ? (
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
          <h2 className="workbench-sidebar-heading px-2 pb-2 pt-2 text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{labels.history}</h2>
          <div className="min-h-0 flex-1 overflow-auto">
            {sessions.length === 0 ? (
              <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">{labels.empty}</div>
            ) : (
              <ol className="space-y-1">
                {sessions.map((session) => (
                  <li key={session.id} className="flex items-stretch gap-1">
                    <button
                      type="button"
                      className={`workbench-session-item min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left transition ${
                        session.id === activeSessionId
                          ? 'bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100'
                          : 'text-zinc-700 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800'
                      }`}
                      onClick={() => onSelectSession(session)}
                      disabled={disabled}
                      aria-current={session.id === activeSessionId ? 'page' : undefined}
                    >
                      <span className="block truncate text-xs font-medium">
                        {session.title === DEFAULT_CONVERSATION_SESSION_TITLE ? labels.newConversation : session.title}
                      </span>
                      <span className="mt-1 block text-[0.625rem] text-zinc-500 dark:text-zinc-400">
                        {new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(session.updatedAt)}
                      </span>
                    </button>
                    {pendingDeleteId === session.id ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-red-300 px-2 text-[0.625rem] font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950"
                        onClick={() => {
                          setPendingDeleteId(undefined);
                          onDeleteSession(session);
                        }}
                        onBlur={() => setPendingDeleteId(undefined)}
                        disabled={disabled}
                        aria-label={labels.confirmDeleteConversation}
                        title={labels.confirmDeleteConversation}
                        autoFocus
                      >
                        {labels.confirmDeleteConversation}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="workbench-session-delete shrink-0 rounded-lg px-2 text-xs text-zinc-400 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-500 dark:hover:bg-red-950 dark:hover:text-red-200"
                        onClick={() => setPendingDeleteId(session.id)}
                        disabled={disabled}
                        aria-label={labels.deleteConversation}
                        title={labels.deleteConversation}
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
