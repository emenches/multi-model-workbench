import { describe, expect, it } from 'vitest';
import { EMPTY_PROJECT_STORE, mergeProjectContext, type ProjectStore } from '../workspace/model';

const withProject: ProjectStore = {
  schemaVersion: 1,
  activeProjectId: 'project-test',
  projects: [{ id: 'project-test', name: 'LRDT research', instructions: 'Use primary sources.', createdAt: 1, updatedAt: 1 }],
};
describe('project context handoff', () => {
  it('does not change conversations without a selected project', () => {
    expect(mergeProjectContext(EMPTY_PROJECT_STORE)).toBeUndefined();
    expect(mergeProjectContext(EMPTY_PROJECT_STORE, 'previous chat')).toBe('previous chat');
  });
  it('adds selected project instructions and preserves conversation context', () => {
    const context = mergeProjectContext(withProject, 'previous chat');
    expect(context).toContain('Project: LRDT research');
    expect(context).toContain('Use primary sources.');
    expect(context).toContain('previous chat');
  });
  it('never includes non-selected project notes', () => {
    expect(mergeProjectContext({ ...withProject, activeProjectId: null })).toBeUndefined();
  });
});
