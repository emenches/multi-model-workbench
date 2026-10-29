import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationSidebar, type ConversationSidebarLabels } from '../ui/ConversationSidebar';
import { createConversationSession } from '../ui/conversationSessions';

const labels: ConversationSidebarLabels = {
  toggle: 'Toggle',
  newConversation: 'New conversation',
  history: 'History',
  empty: 'Empty',
  deleteConversation: 'Delete',
  confirmDeleteConversation: 'Confirm',
  projects: 'Projects',
  newProject: 'New project',
  projectName: 'Project name',
  cancel: 'Cancel',
  create: 'Create',
  unassigned: 'Unassigned',
  moveTo: 'Move to',
  newInProject: 'New in project',
  expand: 'Expand',
  collapse: 'Collapse',
  projectSettings: 'Project settings',
};

describe('conversation sidebar navigation', () => {
  it('leaves history selectable while a workflow disables edits and new conversations', () => {
    const session = createConversationSession({ id: 'saved', title: 'Saved response', now: 1 });
    const html = renderToStaticMarkup(createElement(ConversationSidebar, {
      collapsed: false, sessions: [session], projects: [], activeSessionId: 'saved',
      disabled: true, historyDisabled: false, labels, locale: 'en',
      onToggle() {}, onNewConversation() {}, onSelectSession() {}, onDeleteSession() {},
      onAssignProject() {}, async onCreateProject() {}, onOpenProjectSettings() {},
    }));
    expect(html).toMatch(/class="workbench-session-item[^"]*"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/class="workbench-session-item[^"]*"[^>]*disabled/);
    expect(html).toMatch(/class="workbench-new-conversation[^"]*"[^>]*disabled/);
  });

  it('shows the running conversation even when a different history row is selected', () => {
    const active = createConversationSession({ id: 'a', title: 'Running Consult', now: 1 });
    const viewed = createConversationSession({ id: 'b', title: 'Historical notes', now: 2 });
    const html = renderToStaticMarkup(createElement(ConversationSidebar, {
      collapsed: false, sessions: [active, viewed], projects: [], activeSessionId: 'b',
      disabled: true, historyDisabled: false,
      sessionStatuses: { a: 'running', b: 'completed' },
      labels, locale: 'en',
      onToggle() {}, onNewConversation() {}, onSelectSession() {}, onDeleteSession() {},
      onAssignProject() {}, async onCreateProject() {}, onOpenProjectSettings() {},
    }));
    expect(html).toContain('data-run-status="running"');
    expect(html).toContain('aria-label="Conversation running"');
    expect(html).toContain('data-run-status="completed"');
    expect(html).toContain('Historical notes');
    // Running conversations remain readable but cannot be deleted or moved
    // while a provider still owns their native conversation.
    expect(html).toMatch(/aria-label="Delete" title="Delete" disabled=""/);
  });

  it('never opens a new-conversation options menu, even with projects', () => {
    const html = renderToStaticMarkup(createElement(ConversationSidebar, {
      collapsed: false, sessions: [], projects: [{
        id: 'project', name: 'Project', instructions: '', createdAt: 1, updatedAt: 1,
      }], activeSessionId: 'none', disabled: false, labels, locale: 'en',
      onToggle() {}, onNewConversation() {}, onSelectSession() {}, onDeleteSession() {},
      onAssignProject() {}, async onCreateProject() {}, onOpenProjectSettings() {},
    }));
    expect(html).toContain('workbench-new-conversation');
    expect(html).not.toContain('workbench-new-chat-menu');
    expect(html).not.toContain('aria-haspopup="menu"');
    // New chats within an existing project remain available via the project's + button.
    expect(html).toContain('aria-label="New in project: Project"');
  });
});
