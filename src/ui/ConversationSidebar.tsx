import { useEffect, useState, type ReactNode } from 'react';
import { CogitorMark } from './CogitorMark';
import type { WorkbenchProject } from '../workspace/model';
import { DEFAULT_CONVERSATION_SESSION_TITLE, type ConversationSession } from './conversationSessions';

export interface ConversationSidebarLabels {
  toggle: string;
  newConversation: string;
  history: string;
  empty: string;
  deleteConversation: string;
  confirmDeleteConversation: string;
  projects: string;
  newProject: string;
  projectName: string;
  cancel: string;
  create: string;
  unassigned: string;
  moveTo: string;
  newInProject: string;
  expand: string;
  collapse: string;
  projectSettings: string;
}

export function ConversationSidebar({
  collapsed,
  width = 304,
  brandActive = false,
  sessions,
  projects,
  activeSessionId,
  disabled,
  labels,
  onToggle,
  onNewConversation,
  onSelectSession,
  onDeleteSession,
  onAssignProject,
  onCreateProject,
  onOpenProjectSettings,
}: {
  collapsed: boolean;
  width?: number;
  brandActive?: boolean;
  sessions: readonly ConversationSession[];
  projects: readonly WorkbenchProject[];
  activeSessionId: string;
  disabled: boolean;
  labels: ConversationSidebarLabels;
  locale: string;
  onToggle: () => void;
  onNewConversation: (projectId?: string) => void;
  onSelectSession: (session: ConversationSession) => void;
  onDeleteSession: (session: ConversationSession) => void;
  onAssignProject: (session: ConversationSession, projectId?: string) => void;
  onCreateProject: (name: string) => Promise<void>;
  onOpenProjectSettings: () => void;
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [newChatMenuOpen, setNewChatMenuOpen] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectError, setProjectError] = useState<string>();
  useEffect(() => {
    if (pendingDeleteId && (collapsed || disabled || !sessions.some((session) => session.id === pendingDeleteId))) {
      setPendingDeleteId(undefined);
    }
    if (collapsed || disabled) setNewChatMenuOpen(false);
  }, [collapsed, disabled, pendingDeleteId, sessions]);

  const knownProjects = new Set(projects.map((project) => project.id));
  const unassigned = sessions.filter((session) => !session.projectId || !knownProjects.has(session.projectId));
  const toggleProject = (id: string) => {
    setCollapsedProjects((old) => old.includes(id) ? old.filter((key) => key !== id) : [...old, id]);
  };
  const submitProject = async () => {
    const clean = projectName.trim();
    if (!clean || projectBusy) return;
    setProjectBusy(true);
    setProjectError(undefined);
    try {
      await onCreateProject(clean);
      setCreating(false);
      setNewChatMenuOpen(false);
      setProjectName('');
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectBusy(false);
    }
  };
  const sessionRow = (session: ConversationSession, nested: boolean): ReactNode => (
    <li key={session.id} className={`workbench-session-row group flex items-stretch gap-0.5 ${nested ? 'pl-3' : ''}`}>
      <button type="button"
        className={`workbench-session-item min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left transition ${
          session.id === activeSessionId
            ? 'bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100'
            : 'text-zinc-700 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800'
        }`}
        onClick={() => onSelectSession(session)}
        disabled={disabled}
        aria-current={session.id === activeSessionId ? 'page' : undefined}
        title={session.title}
      >
        <span className="block truncate text-xs font-medium">
          {session.title === DEFAULT_CONVERSATION_SESSION_TITLE ? labels.newConversation : session.title}
        </span>
      </button>
      <select aria-label={`${labels.moveTo}: ${session.title}`}
        className="workbench-session-project-control w-5 shrink-0 cursor-pointer rounded-md bg-transparent text-[0.65rem] text-zinc-500 opacity-40 group-hover:opacity-100 focus:opacity-100 dark:text-zinc-400"
        value={knownProjects.has(session.projectId ?? '') ? session.projectId : ''}
        title={labels.moveTo}
        disabled={disabled}
        onChange={(event) => onAssignProject(session, event.target.value || undefined)}>
        <option value="">{labels.unassigned}</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      {pendingDeleteId === session.id ? (
        <button type="button" className="shrink-0 rounded-lg border border-red-300 px-1.5 text-[0.625rem] text-red-700 dark:border-red-800 dark:text-red-300"
          onClick={() => { setPendingDeleteId(undefined); onDeleteSession(session); }}
          onBlur={() => setPendingDeleteId(undefined)}
          disabled={disabled} aria-label={labels.confirmDeleteConversation} title={labels.confirmDeleteConversation}
          autoFocus>{labels.confirmDeleteConversation}</button>
      ) : (
        <button type="button" className="workbench-session-delete shrink-0 rounded-md px-1.5 text-xs text-zinc-400 opacity-40 group-hover:opacity-100 focus:opacity-100 dark:text-zinc-500"
          onClick={() => setPendingDeleteId(session.id)} disabled={disabled}
          aria-label={labels.deleteConversation} title={labels.deleteConversation}>
          <span aria-hidden="true">×</span>
        </button>
      )}
    </li>
  );

  return (
    <nav aria-label={labels.history}
      className={`ai-sister-session-sidebar workbench-session-sidebar ${collapsed ? 'w-[60px]' : 'min-w-0'} flex min-h-0 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-[width] dark:border-zinc-800 dark:bg-zinc-900`}
      style={{ width: collapsed ? 60 : width, flex: 'none' }}>
      <div className="workbench-sidebar-brand flex items-center gap-2 border-b border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <button type="button" className="workbench-brand-button grid h-9 w-9 shrink-0 place-items-center rounded-xl hover:bg-white dark:hover:bg-zinc-800"
          aria-label={labels.toggle} title={labels.toggle} onClick={onToggle}>
          <CogitorMark active={brandActive} className="default-brand-icon h-6 w-6" />
        </button>
        {!collapsed ? (
          <span className="min-w-0">
            <span className="cogitor-wordmark block truncate">COGITOR</span>
          </span>
        ) : null}
      </div>
      <div className="px-2.5 pt-3 pb-1">
        <button type="button"
          className={`workbench-new-conversation ${collapsed ? 'grid h-9 w-9 place-items-center p-0' : 'flex w-full items-center gap-2 px-3 py-2'} rounded-xl border text-sm font-medium disabled:opacity-50`}
          onClick={() => collapsed ? onNewConversation() : setNewChatMenuOpen((open) => !open)}
          aria-haspopup={collapsed ? undefined : 'menu'} aria-expanded={collapsed ? undefined : newChatMenuOpen}
          disabled={disabled}
          aria-label={labels.newConversation} title={labels.newConversation}>
          <span className="text-lg leading-none" aria-hidden="true">＋</span>
          {!collapsed ? <span className="flex-1 text-left">{labels.newConversation}</span> : null}
          {!collapsed ? <span className="text-zinc-400" aria-hidden="true">⌄</span> : null}
        </button>
      </div>
      {!collapsed && newChatMenuOpen ? (
        <div className="workbench-new-chat-menu mx-2.5 mb-2 space-y-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-700 dark:bg-zinc-900" role="menu" aria-label={labels.newConversation}>
          <button type="button" role="menuitem" className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => { setNewChatMenuOpen(false); onNewConversation(); }} disabled={disabled}>
            {labels.unassigned}
          </button>
          {projects.map((project) => (
            <button type="button" role="menuitem" key={project.id}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => { setNewChatMenuOpen(false); onNewConversation(project.id); }} disabled={disabled}>
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3z"/></svg>
              <span className="truncate">{project.name}</span>
            </button>
          ))}
          <button type="button" role="menuitem" className="w-full border-t border-zinc-200 px-2.5 py-2 pt-3 text-left text-xs font-medium text-sky-700 dark:border-zinc-700 dark:text-sky-300"
            onClick={() => { setCreating(true); setNewChatMenuOpen(false); }} disabled={disabled || projects.length >= 100}>
            + {labels.newProject}
          </button>
        </div>
      ) : null}
      {!collapsed ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-3">
          <section aria-label={labels.projects}>
            <div className="workbench-sidebar-section-title flex items-center justify-between px-2 pb-1.5">
              <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{labels.projects}</h2>
              <div className="flex items-center gap-1">
                <button type="button" className="workbench-sidebar-add grid h-6 w-6 place-items-center rounded-md text-base text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  onClick={onOpenProjectSettings} disabled={disabled}
                  aria-label={labels.projectSettings} title={labels.projectSettings}>⚙</button>
                <button type="button" className="workbench-sidebar-add grid h-6 w-6 place-items-center rounded-md text-base text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  onClick={() => setCreating((value) => !value)}
                  disabled={disabled || projectBusy || projects.length >= 100}
                  aria-label={labels.newProject} title={labels.newProject}>＋</button>
              </div>
            </div>
            {creating ? (
              <form className="workbench-project-create mx-1 mb-2 space-y-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700"
                onSubmit={(event) => { event.preventDefault(); void submitProject(); }}>
                <input className="w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  autoFocus value={projectName} maxLength={100} placeholder={labels.projectName}
                  aria-label={labels.projectName} disabled={projectBusy}
                  onChange={(event) => setProjectName(event.target.value)} />
                <div className="flex gap-2">
                  <button className="rounded-md bg-sky-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                    type="submit" disabled={!projectName.trim() || projectBusy}>{labels.create}</button>
                  <button className="text-xs text-zinc-500" type="button"
                    onClick={() => { setCreating(false); setProjectError(undefined); }}
                    disabled={projectBusy}>{labels.cancel}</button>
                </div>
                {projectError ? <p className="text-xs text-red-600" role="alert">{projectError}</p> : null}
              </form>
            ) : null}
            <ol className="space-y-1">
              {projects.map((project) => {
                const members = sessions.filter((session) => session.projectId === project.id);
                const isClosed = collapsedProjects.includes(project.id);
                return <li key={project.id}>
                  <div className="workbench-sidebar-project group flex items-center gap-1 rounded-lg">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium hover:bg-zinc-200/50 dark:hover:bg-zinc-800/60"
                      aria-expanded={!isClosed} title={project.name}
                      aria-label={`${isClosed ? labels.expand : labels.collapse} ${project.name}`}
                      onClick={() => toggleProject(project.id)}>
                      <span className="text-xs text-zinc-400" aria-hidden="true">{isClosed ? '▸' : '▾'}</span>
                      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M3 7h7l2 2h9v10H3z"/></svg>
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    </button>
                    <button type="button" className="workbench-sidebar-project-add grid h-6 w-6 shrink-0 place-items-center rounded-md text-zinc-500 opacity-50 hover:bg-zinc-200 hover:opacity-100 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-zinc-800"
                      disabled={disabled} title={labels.newInProject} aria-label={`${labels.newInProject}: ${project.name}`}
                      onClick={() => onNewConversation(project.id)}>＋</button>
                  </div>
                  {!isClosed ? <ol className="mt-0.5 space-y-0.5">{members.map((session) => sessionRow(session, true))}</ol> : null}
                </li>;
              })}
            </ol>
          </section>
          <section aria-label={labels.history}>
            <h2 className="workbench-sidebar-heading px-2 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{labels.history}</h2>
            {unassigned.length ? <ol className="space-y-0.5">{unassigned.map((session) => sessionRow(session, false))}</ol>
              : <p className="px-2 py-2 text-[0.7rem] text-zinc-500">{labels.empty}</p>}
          </section>
        </div>
      ) : null}
    </nav>
  );
}
