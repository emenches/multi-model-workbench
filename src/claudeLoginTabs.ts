import { claudeAuthHost } from './host/claudeAuth';

// This isolated toolbar never reads the Claude/email pages, cookies,
// session tokens, or authentication codes. Its input handles only a URL
// the user explicitly types. The native process does not log this value.
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing login tab control: ${id}`);
  return el;
};
const claude = $('claude') as HTMLButtonElement;
const email = $('email') as HTMLButtonElement;
const navigation = $('navigation') as HTMLFormElement;
const address = $('address') as HTMLInputElement;
const status = $('status');
const closeEmail = $('close-email') as HTMLButtonElement;

let hasEmail = false;
let active: 'claude' | 'email' = 'claude';
function render() {
  claude.classList.toggle('active', active === 'claude');
  email.classList.toggle('active', active === 'email');
  email.textContent = hasEmail ? 'Email' : '+ Email';
  navigation.classList.toggle('hidden', !hasEmail);
}
function fail(error: unknown) {
  // Do not include raw backend error messages: they could contain a URL.
  status.textContent = 'Could not open tab. Check the address.';
  console.warn('Claude login tab action failed', error instanceof Error ? error.name : 'error');
}
async function showClaude() {
  try {
    await claudeAuthHost.switchTab('claude');
    active = 'claude';
    status.textContent = '';
    render();
  } catch (error) { fail(error); }
}
async function showEmail() {
  try {
    if (!hasEmail) {
      await claudeAuthHost.openEmail(address.value.trim() || 'https://mail.google.com/');
      hasEmail = true;
    } else {
      await claudeAuthHost.switchTab('email');
    }
    active = 'email';
    status.textContent = '';
    render();
    address.focus();
  } catch (error) { fail(error); }
}
claude.addEventListener('click', () => { void showClaude(); });
email.addEventListener('click', () => { void showEmail(); });
navigation.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await claudeAuthHost.openEmail(address.value.trim());
    hasEmail = true;
    // A pasted Claude magic link is handed directly to the native Claude view.
    // Never display or retain the pasted link in the toolbar afterwards.
    const isClaude = /^(?:https:\/\/)?claude\.ai(?:\/|\?|#|$)/i.test(address.value.trim());
    address.value = '';
    active = isClaude ? 'claude' : 'email';
    status.textContent = '';
    render();
  } catch (error) { fail(error); }
});
closeEmail.addEventListener('click', async () => {
  try {
    await claudeAuthHost.closeEmail();
    hasEmail = false;
    active = 'claude';
    address.value = '';
    status.textContent = '';
    render();
  } catch (error) { fail(error); }
});

void claudeAuthHost.onSelected((selected) => {
  active = selected === 'email' ? 'email' : 'claude';
  if (active === 'claude') address.value = '';
  render();
});
void claudeAuthHost.onHandoff((handoff) => {
  // Only a fixed, token-free status string crosses this boundary.
  status.textContent = [
    'Login link opened in Claude',
    'Link could not open in Claude',
    'Claude tab is unavailable',
    'Gmail account opened in Email tab',
  ].includes(handoff) ? handoff : '';
});
document.addEventListener('keydown', event => {
  if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'l') {
    if (active === 'email') { event.preventDefault(); address.focus(); address.select(); }
  }
});
render();
