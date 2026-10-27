import { useEffect, useState } from 'react';
import { activeProject, type ProjectStore, type WorkbenchProject } from './model';

const inputClass = 'w-full min-w-0 rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';
const buttonClass = 'rounded border border-zinc-300 px-2 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800';

export function ProjectPicker({
  store, disabled, onSave, loadError,
}: {
  store: ProjectStore;
  disabled: boolean;
  onSave: (store: ProjectStore) => Promise<void>;
  loadError?: string;
}) {
  const selected = activeProject(store);
  const [editing, setEditing] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isNew) return;
    setName(selected?.name ?? '');
    setInstructions(selected?.instructions ?? '');
  }, [isNew, selected?.id, selected?.name, selected?.instructions]);

  const persist = async (next: ProjectStore): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      await onSave(next);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 100) {
      setError('Project name must be between 1 and 100 characters.');
      return;
    }
    if (new TextEncoder().encode(instructions).length > 16_000) {
      setError('Project instructions must be 16 KB or less.');
      return;
    }
    const now = Date.now();
    const nextProject: WorkbenchProject = isNew || !selected
      ? { id: `project-${crypto.randomUUID()}`, name: cleanName, instructions, createdAt: now, updatedAt: now }
      : { ...selected, name: cleanName, instructions, updatedAt: now };
    const next: ProjectStore = {
      schemaVersion: 1,
      activeProjectId: nextProject.id,
      projects: isNew || !selected
        ? [...store.projects, nextProject]
        : store.projects.map((project) => project.id === nextProject.id ? nextProject : project),
    };
    if (await persist(next)) {
      setEditing(false);
      setIsNew(false);
    }
  };

  const select = async (id: string) => {
    if (await persist({ ...store, activeProjectId: id || null })) {
      setEditing(false);
      setIsNew(false);
    }
  };

  return (
    <section className="mb-3 rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950" aria-label="Workbench project">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Project workspace</h2>
        <button type="button" className={buttonClass} onClick={() => {
          setIsNew(true); setName(''); setInstructions(''); setEditing(true); setError('');
        }} disabled={disabled || busy || !!loadError || store.projects.length >= 100}>+ New</button>
      </div>
      <div className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Active project</span>
          <select className={inputClass} value={store.activeProjectId ?? ''} onChange={(event) => void select(event.target.value)} disabled={disabled || busy || !!loadError}>
            <option value="">No project (regular chat)</option>
            {store.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <button type="button" className={buttonClass} onClick={() => { setIsNew(false); setEditing(!editing); setError(''); }} disabled={!selected || disabled || busy || !!loadError}>Edit</button>
      </div>
      {selected && !editing ? (
        <p className="mt-1 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">
          {selected.instructions.trim() ? 'Saved instructions accompany new workflow questions.' : 'Add instructions to supply persistent context.'}
        </p>
      ) : null}
      {editing ? (
        <div className="mt-3 space-y-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <label className="block text-xs">Project name
            <input className={`${inputClass} mt-1`} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} disabled={busy || disabled} />
          </label>
          <label className="block text-xs">Shared instructions and decisions
            <textarea className={`${inputClass} mt-1 min-h-28 resize-y`} value={instructions} onChange={(event) => setInstructions(event.target.value)} disabled={busy || disabled} placeholder="Goals, constraints, verified facts, decisions, and source-use rules..." />
          </label>
          <div className="flex gap-2">
            <button type="button" className={`${buttonClass} border-sky-400 text-sky-800 dark:text-sky-200`} onClick={() => void saveDraft()} disabled={busy || disabled}>{busy ? 'Saving…' : 'Save project'}</button>
            <button type="button" className={buttonClass} onClick={() => { setEditing(false); setIsNew(false); setError(''); }} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : null}
      <p className="mt-2 text-[0.625rem] text-zinc-500 dark:text-zinc-400">Conversations remain global in M1. Start a new conversation when changing projects.</p>
      {loadError || error ? <p className="mt-2 text-xs text-red-700 dark:text-red-300" role="alert">{loadError || error}</p> : null}
    </section>
  );
}
