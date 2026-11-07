/**
 * Read-only Claude browser tool / permission detection. No buttons are clicked,
 * and only bounded boolean state leaves the authenticated provider page.
 */
const APPROVE = /^(?:allow(?: this (?:action|time only))?|allow all for this website|always allow(?: actions on this site)?|approve(?: plan)?|install extension|continue with browser tools|yes, use my browser)$/i;
const DECLINE = /^(?:deny|decline|reject|not now|make changes|continue without browser tools|no, keep browser tools off|don't ask again)$/i;
const CHROME_CONTEXT = /(?:claude in chrome|claude wants to use (?:chrome|your browser)|new permissions required|chrome extension detected|(?:use|access|connect|control|permission(?:s)? for)\b.{0,85}\b(?:chrome|browser)\b|\bchrome\b.{0,85}\b(?:use|access|connect|permission|browser))/i;

/** Short, future-tense tool-use acknowledgements are not final answers. */
export function isClaudeChromeToolAcknowledgement(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 480) return false;
  return /\b(?:i(?:'ll| will|'m going to| am going to)|let me|i can)\s+(?:(?:quickly|now|first)\s+)?(?:use|open|access|check|connect(?: to)?|look (?:in|at|up)|browse|navigate)(?:\s+(?:the|your|a))?\s+(?:chrome|browser|web(?:site)?)\b/i.test(value) ||
    /\b(?:i(?:'ll| will|'m going to| am going to))\s+(?:do|handle|check|look up|investigate)\s+(?:this|that|it)\s+(?:in|using|with)\s+(?:chrome|the browser)\b/i.test(value);
}

export function isClaudeChromeApprovalCard(text: string, buttonLabels: readonly string[]): boolean {
  if (!CHROME_CONTEXT.test(text.slice(0, 1600))) return false;
  const labels = buttonLabels.map((value) => value.trim()).filter(Boolean);
  return labels.some((label) => APPROVE.test(label)) &&
    (labels.some((label) => DECLINE.test(label)) ||
     labels.some((label) => /^(?:allow this action|always allow actions on this site|allow all for this website|approve plan|continue with browser tools)$/i.test(label)));
}

export function isClaudeChromeApprovalPending(
  document: Document,
  page: { origin: string; pathname: string },
  isVisible: (element: Element) => boolean,
): boolean {
  // Never inspect login, MFA, SSO or challenge documents.
  if (page.origin !== 'https://claude.ai' ||
      !(page.pathname === '/new' || /^\/chat\/[^/]+$/.test(page.pathname)) ||
      document.querySelector('input[type="password"], input[autocomplete="one-time-code"], input[type="email"]')) return false;

  const controls = Array.from(document.querySelectorAll('button')).filter(isVisible);
  for (const button of controls) {
    const label = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim();
    if (!APPROVE.test(label)) continue;
    let node: Element | null = button;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (!isVisible(node)) continue;
      const text = (node.textContent ?? '').slice(0, 1601);
      if (text.length > 1600) break;
      const labels = Array.from(node.querySelectorAll('button'))
        .filter(isVisible)
        .map((element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim());
      if (isClaudeChromeApprovalCard(text, labels)) return true;
    }
  }
  return false;
}
