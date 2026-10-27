import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  attachmentChipName,
  attachmentChipSize,
  beginAttachmentBatch,
  hasReadingAttachment,
  readAttachmentJobs,
  readyAttachmentFiles,
  removeAttachment,
  removeReadingAttachmentIds,
  settleAttachmentReadResults,
  type AttachmentChip,
} from './fileAttachments';
import { filesFromDataTransfer, isOsFileDrag, markFileDragCopy, preventFileDragDefaults } from './fileDrop';
import { formatInsertedFilesPrompt, TEXT_FILE_EXTENSIONS, type FileLike } from './fileInsert';
import type { Locale } from '../i18n/resolve';
import { t } from '../i18n/t';

export function InputBar({
  onSend,
  onCancel,
  disabled,
  disabledPlaceholder,
  projects = [],
  currentProjectId,
  onChooseProject,
  onCreateProject,
  projectsDisabled = false,
  sendBlocked = false,
  blockedMessage,
  isProcessing,
  locale = 'en',
}: {
  onSend: (text: string) => boolean | void | Promise<boolean | void>;
  onCancel: () => void;
  disabled: boolean;
  disabledPlaceholder?: string;
  projects?: readonly { id: string; name: string }[];
  currentProjectId?: string;
  onChooseProject?: (projectId?: string) => void;
  onCreateProject?: () => void;
  projectsDisabled?: boolean;
  sendBlocked?: boolean;
  blockedMessage?: string;
  isProcessing: boolean;
  locale?: Locale;
}) {
  const [text, setText] = useState('');
  const [attachmentChips, setAttachmentChips] = useState<AttachmentChip[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | undefined>();
  const [dropActive, setDropActive] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const attachmentChipsRef = useRef<AttachmentChip[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchGeneration = useRef(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [text]);

  const commitAttachmentChips = (chips: AttachmentChip[]) => {
    attachmentChipsRef.current = chips;
    setAttachmentChips(chips);
  };

  const canAddFilesFromRef = () => !disabled && !isProcessing && !submittingRef.current && !hasReadingAttachment(attachmentChipsRef.current);

  const addAttachmentFiles = async (files: readonly FileLike[]) => {
    if (files.length === 0) return;
    if (!canAddFilesFromRef()) return;

    // Guard against a stale earlier batch settling after the composer was cleared or a newer
    // batch was accepted, which would otherwise reattach stale content.
    const generation = (batchGeneration.current += 1);
    setAttachmentError(undefined);

    const begun = beginAttachmentBatch(attachmentChipsRef.current, files, undefined, locale);
    commitAttachmentChips(begun.chips);
    if (begun.error) setAttachmentError(begun.error.message);
    if (begun.jobs.length === 0) return;

    const results = await readAttachmentJobs(begun.jobs, locale);
    if (generation !== batchGeneration.current) {
      commitAttachmentChips(removeReadingAttachmentIds(attachmentChipsRef.current, begun.jobs.map((job) => job.id)));
      return;
    }

    const settled = settleAttachmentReadResults(attachmentChipsRef.current, results, locale);
    commitAttachmentChips(settled.chips);
    if (settled.error) setAttachmentError(settled.error.message);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    await addAttachmentFiles(files);
  };

  const clearAttachments = () => {
    batchGeneration.current += 1;
    commitAttachmentChips([]);
    setAttachmentError(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachmentChip = (id: string) => {
    commitAttachmentChips(removeAttachment(attachmentChipsRef.current, id));
    setAttachmentError(undefined);
  };

  const isReadingFile = hasReadingAttachment(attachmentChips);
  const readyFiles = readyAttachmentFiles(attachmentChips);
  const hasReadyAttachments = readyFiles.length > 0;
  const canAddFiles = !disabled && !isProcessing && !isSubmitting && !isReadingFile;

  const submit = async () => {
    const trimmed = text.trim();
    if ((!trimmed && !hasReadyAttachments) || disabled || sendBlocked || isProcessing || isReadingFile || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setAttachmentError(undefined);
    try {
      const decision = onSend(hasReadyAttachments ? formatInsertedFilesPrompt(readyFiles, trimmed) : trimmed);
      const accepted = decision instanceof Promise ? await decision : decision;
      if (accepted !== false) {
        setText('');
        clearAttachments();
      }
    } catch {
      setAttachmentError(t('input.sendFailed', locale));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!isOsFileDrag(event.dataTransfer)) return;
    const canAcceptFiles = canAddFilesFromRef();
    markFileDragCopy(event, canAcceptFiles);
    setDropActive(canAcceptFiles);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!isOsFileDrag(event.dataTransfer)) return;
    const canAcceptFiles = canAddFilesFromRef();
    markFileDragCopy(event, canAcceptFiles);
    if (!canAcceptFiles) setDropActive(false);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isOsFileDrag(event.dataTransfer)) return;
    preventFileDragDefaults(event);
    if (dragLeaveStayedInside(event.currentTarget, event.relatedTarget)) return;
    setDropActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isOsFileDrag(event.dataTransfer)) return;
    const canAcceptFiles = canAddFilesFromRef();
    markFileDragCopy(event, canAcceptFiles);
    setDropActive(false);
    if (!canAcceptFiles) return;
    void addAttachmentFiles(filesFromDataTransfer(event.dataTransfer));
  };

  const placeholder = isProcessing
    ? t('input.workflowRunning', locale)
    : disabled
      ? disabledPlaceholder ?? t('input.connectProvider', locale)
      : sendBlocked
        ? blockedMessage ?? t('input.connectProvider', locale)
        : t('input.messagePlaceholder', locale);
  const sendDisabled = disabled || sendBlocked || isProcessing || isSubmitting || isReadingFile || (!text.trim() && !hasReadyAttachments);
  const insertDisabled = disabled || isProcessing || isSubmitting || isReadingFile;
  const showDropActive = dropActive && canAddFiles;
  const activeProjectName = projects.find((project) => project.id === currentProjectId)?.name;

  return (
    <div
      className={`workbench-composer mt-3 space-y-2 rounded-2xl border p-2 transition-colors ${
        showDropActive ? 'border-emerald-400 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20' : 'border-transparent'
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="workbench-composer-body flex flex-wrap items-center gap-2">
        <textarea
          ref={textareaRef}
          className="workbench-composer-textarea min-h-12 w-full flex-[0_0_100%] resize-none border border-zinc-300 bg-zinc-50 p-3 text-sm outline-none focus:border-sky-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          aria-label={t('input.messagePlaceholder', locale)}
          disabled={disabled || isSubmitting}
          rows={2}
        />
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept={TEXT_FILE_EXTENSIONS.join(',')}
          multiple
          onChange={handleFileChange}
        />
        <div className="workbench-composer-more relative"
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setMoreOpen(false); setProjectMenuOpen(false); } }}
          onKeyDown={(event) => { if (event.key === 'Escape') { setMoreOpen(false); setProjectMenuOpen(false); } }}>
          <button type="button" className="workbench-composer-plus grid h-9 w-9 place-items-center rounded-full text-xl"
            aria-label={t('composer.more', locale)} aria-haspopup="menu" aria-expanded={moreOpen}
            onClick={() => { setMoreOpen((open) => !open); setProjectMenuOpen(false); }}>+</button>
          {moreOpen ? (
            <div className="workbench-composer-more-menu absolute bottom-full left-0 z-40 mb-2 w-64 rounded-2xl p-1.5 shadow-xl"
              role="menu" aria-label={t('composer.more', locale)}>
              <button type="button" role="menuitem" className="workbench-composer-menu-item"
                disabled={insertDisabled}
                onClick={() => { setMoreOpen(false); fileInputRef.current?.click(); }}>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 11.5 12 20a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>
                {t('input.insertFile', locale)}
              </button>
              {onChooseProject ? (
                <>
                  <button type="button" role="menuitem" className="workbench-composer-menu-item"
                    aria-expanded={projectMenuOpen} disabled={projectsDisabled}
                    onClick={() => setProjectMenuOpen((open) => !open)}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3z"/></svg>
                    {t('composer.project', locale)}
                    <span className="ml-auto text-xs opacity-60">{projectMenuOpen ? '⌃' : '⌄'}</span>
                  </button>
                  {projectMenuOpen ? (
                    <div className="workbench-composer-project-choices max-h-52 overflow-y-auto" role="group" aria-label={t('composer.project', locale)}>
                      <button type="button" role="menuitemradio" aria-checked={!currentProjectId} className="workbench-composer-menu-item"
                        onClick={() => { onChooseProject(undefined); setMoreOpen(false); setProjectMenuOpen(false); }}>
                        {t('sidebar.general', locale)}
                      </button>
                      {projects.map((project) => (
                        <button key={project.id} type="button" role="menuitemradio" aria-checked={currentProjectId === project.id}
                          className="workbench-composer-menu-item"
                          onClick={() => { onChooseProject(project.id); setMoreOpen(false); setProjectMenuOpen(false); }}>
                          <span className="min-w-0 truncate">{project.name}</span>
                        </button>
                      ))}
                      {onCreateProject ? (
                        <button type="button" role="menuitem" className="workbench-composer-menu-item"
                          onClick={() => { setMoreOpen(false); setProjectMenuOpen(false); onCreateProject(); }}>
                          + {t('sidebar.newProject', locale)}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        {activeProjectName ? (
          <button type="button" className="workbench-composer-project-tag min-w-0 max-w-36 truncate rounded-lg px-2 py-1 text-xs"
            title={activeProjectName} disabled={projectsDisabled} onClick={() => { setMoreOpen(true); setProjectMenuOpen(true); }}>
            {activeProjectName}
          </button>
        ) : null}
        {isProcessing ? (
          <button type="button" className="workbench-composer-stop min-h-9 rounded-lg border border-red-300 bg-red-50 px-3 text-xs font-medium text-red-800 hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-100 dark:hover:bg-red-900" onClick={onCancel}>
            {t('input.stop', locale)}
          </button>
        ) : null}
        <button
          type="button"
          className="workbench-composer-send ml-auto flex min-h-9 items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-700 dark:bg-emerald-900 dark:text-zinc-100 dark:hover:bg-emerald-800"
          onClick={() => void submit()}
          disabled={sendDisabled}
        >
          {isSubmitting ? t('input.preparing', locale) : t('input.send', locale)}
          <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m5 12 14 0m-6-6 6 6-6 6"/>
          </svg>
        </button>
      </div>
      {attachmentChips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attachmentChips.map((chip) => (
            <div
              key={chip.id}
              className={`flex max-w-full items-center gap-2 border px-2 py-1 text-xs ${
                chip.phase === 'error'
                  ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200'
                  : chip.phase === 'reading'
                    ? 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-500 dark:text-zinc-500'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
              }`}
            >
              <span className="max-w-48 truncate" title={attachmentChipName(chip)}>
                {attachmentChipName(chip)}
              </span>
              <span className="shrink-0 text-zinc-500 dark:text-zinc-500">
                {formatAttachmentSize(attachmentChipSize(chip), locale)}
              </span>
              {chip.phase === 'reading' ? <span className="shrink-0 text-zinc-500 dark:text-zinc-500">{t('input.reading', locale)}</span> : null}
              {chip.phase === 'error' ? (
                <span className="max-w-64 truncate text-red-700 dark:text-red-300" title={chip.message}>
                  {chip.message}
                </span>
              ) : null}
              <button
                type="button"
                className="shrink-0 text-base leading-none text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => removeAttachmentChip(chip.id)}
                disabled={isProcessing}
                aria-label={`${t('input.removeFile', locale)} ${attachmentChipName(chip)}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {attachmentError ? (
        <div className="border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-200" role="alert">
          {attachmentError}
        </div>
      ) : null}
    </div>
  );
}

function dragLeaveStayedInside(currentTarget: HTMLDivElement, relatedTarget: EventTarget | null): boolean {
  if (!relatedTarget || typeof Node === 'undefined' || !(relatedTarget instanceof Node)) return false;
  return currentTarget.contains(relatedTarget);
}

function formatAttachmentSize(bytes: number, locale: Locale): string {
  if (bytes < 1024) return `${bytes} B`;
  const value = bytes / 1024;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} KB`;
}
