import { AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider } from '../../shared/types';

/** This is deliberately NOT a fake model picker. Each website owns its
 * model/effort menu; until we can read back a verified selection, the app
 * must never imply that choosing a local value changed provider behavior.
 */
export function ProviderModelControls({
  provider,
  onOpenProvider,
  onClose,
}: {
  provider: AIProvider;
  onOpenProvider: (provider: AIProvider) => void;
  onClose: () => void;
}) {
  const name = AI_PROVIDERS[provider].name;
  return (
    <section
      aria-label={`${name} model and reasoning effort`}
      className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{name} · Model & effort</h3>
        <button
          type="button"
          aria-label="Close model settings"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Close
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-950">
          <dt className="text-zinc-500 dark:text-zinc-400">Current model</dt>
          <dd className="mt-1 font-medium">Not verified</dd>
        </div>
        <div className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-950">
          <dt className="text-zinc-500 dark:text-zinc-400">Thinking effort</dt>
          <dd className="mt-1 font-medium">Not verified</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
        Select a model and any available reasoning-effort option from {name}'s own menu in its native page.
        Options depend on your account and the provider. The Workbench does not yet verify those selections,
        so it will not claim a model or effort level was applied.
      </p>
      <button
        type="button"
        onClick={() => onOpenProvider(provider)}
        className="mt-3 w-full rounded-lg bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
      >
        Open {name} model controls ↗
      </button>
    </section>
  );
}
