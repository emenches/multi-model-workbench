/**
 * Read-only Claude consent prompt detection. This never clicks a permission
 * control or transmits page text. It returns a single boolean for the Activity UI.
 */
const ALLOW = /^(?:allow(?: this (?:action|time only))?|always allow(?: actions on this site)?|approve(?: plan)?|yes, use my browser|continue with browser tools)$/i;
const DENY = /^(?:deny|decline|reject|not now|make changes|continue without browser tools|no, keep browser tools off)$/i;
const CHROME_CONTEXT = /(?:claude in chrome|claude wants to use (?:chrome|your browser)|(?:use|access|connect|open|control|permission(?:s)? for)\b.{0,85}\bchrome\b|\bchrome\b.{0,85}\b(?:use|access|connect|permission|browser))/i;

export function isClaudeChromeApprovalCard(text: string, buttonLabels: readonly string[]): boolean {
  if (!CHROME_CONTEXT.test(text.slice(0, 1600))) return false;
  const labels = buttonLabels.map((value) => value.trim()).filter(Boolean);
  return labels.some((label) => ALLOW.test(label)) &&
    (labels.some((label) => DENY.test(label)) ||
     labels.some((label) => /^(?:allow this action|always allow actions on this site|yes, use my browser|continue with browser tools)$/i.test(label)));
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

  // Explicit dialog/tool cards first; a consent UI embedded in the transcript
  // may not have role="dialog", so also examine bounded button ancestors.
  const controls = Array.from(document.querySelectorAll('button')).filter(isVisible);
  for (const button of controls) {
    const label = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim();
    if (!ALLOW.test(label)) continue;
    let node: Element | null = button;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
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
