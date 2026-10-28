import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Only the three dedicated commands granted to the separate Claude login
// toolbar. Do not import the main workbench host into the auth toolbar.
export const claudeAuthHost = {
  switchTab: (tab: 'claude' | 'email'): Promise<void> =>
    invoke('claude_auth_tab_switch', { tab }),
  openEmail: (address: string): Promise<void> =>
    invoke('claude_auth_tab_open_email', { address }),
  closeEmail: (): Promise<void> => invoke('claude_auth_tab_close_email'),
  onSelected: (handler: (value: string) => void): Promise<() => void> =>
    listen<string>('claude-auth-tab:selected', event => handler(event.payload)),
  onHandoff: (handler: (value: string) => void): Promise<() => void> =>
    listen<string>('claude-auth-tab:handoff', event => handler(event.payload)),
};
