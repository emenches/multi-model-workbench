/** Presentation-only platform gate. Never affects provider webviews or IPC. */
export function isMacDesktop(platform: string, userAgent: string): boolean {
  return /^Mac(?:Intel|PPC|68K)?$/i.test(platform)
    || /\bMacintosh\b/i.test(userAgent);
}

/** Opt-in per experimental build: add the CSS class only for the host UI. */
export function enableMacGlass(
  root: HTMLElement,
  platform: string,
  userAgent: string,
): void {
  root.classList.toggle('cogitor-mac-glass', isMacDesktop(platform, userAgent));
}
