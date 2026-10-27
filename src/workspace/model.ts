/** Explicit user-authored project metadata. M1 does not index arbitrary files. */
export interface WorkbenchProject {
  id: string;
  name: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
}
export interface ProjectStore {
  schemaVersion: 1;
  activeProjectId: string | null;
  projects: WorkbenchProject[];
}
export const EMPTY_PROJECT_STORE: ProjectStore = {
  schemaVersion: 1,
  activeProjectId: null,
  projects: [],
};
export function activeProject(store: ProjectStore): WorkbenchProject | undefined {
  return store.projects.find((project) => project.id === store.activeProjectId);
}
/** Keep the displayed question unchanged; add notes via the existing workflow context. */
export function mergeProjectContext(store: ProjectStore, conversationContext?: string): string | undefined {
  const project = activeProject(store);
  if (!project) return conversationContext;
  const instructions = project.instructions.trim();
  const projectContext = [
    '[User-maintained project context]',
    `Project: ${project.name}`,
    ...(instructions ? [`Project instructions and constraints:\n${instructions}`] : []),
    '[/User-maintained project context]',
  ].join('\n');
  return conversationContext ? `${projectContext}\n\n${conversationContext}` : projectContext;
}
