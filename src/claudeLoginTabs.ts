import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
    await invoke('claude_auth_tab_switch', { tab: 'claude' });
    active = 'claude';
    status.textContent = '';
    render();
  } catch (error) { fail(error); }
}
async function showEmail() {
  try {
    if (!hasEmail) {
      await invoke('claude_auth_tab_open_email', { address: address.value.trim() || 'https://mail.google.com/' });
      hasEmail = true;
    } else {
      await invoke('claude_auth_tab_switch', { tab: 'email' });
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
    await invoke('claude_auth_tab_open_email', { address: address.value.trim() });
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
    await invoke('claude_auth_tab_close_email');
    hasEmail = false;
    active = 'claude';
    address.value = '';
    status.textContent = '';
    render();
  } catch (error) { fail(error); }
});

void listen<string>('claude-auth-tab:selected', (event) => {
  active = event.payload === 'email' ? 'email' : 'claude';
  if (active === 'claude') address.value = '';
  render();
});
void listen<string>('claude-auth-tab:handoff', (event) => {
  // Only a fixed, token-free status string crosses this boundary.
  status.textContent = [
    'Login link opened in Claude',
    'Link could not open in Claude',
    'Claude tab is unavailable',
    'Gmail account opened in Email tab',
  ].includes(event.payload) ? event.payload : '';
});
document.addEventListener('keydown', event => {
  if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'l') {
    if (active === 'email') { event.preventDefault(); address.focus(); address.select(); }
  }
});
render();
