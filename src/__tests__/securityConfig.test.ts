import { describe, expect, it } from 'vitest';
import capability from '../../src-tauri/capabilities/default.json';
import toolbarCapability from '../../src-tauri/capabilities/claude-login-toolbar.json';
import tauriConfig from '../../src-tauri/tauri.conf.json';

describe('Tauri control-pane security boundary', () => {
  it('grants IPC only to the local main webview', () => {
    expect(capability).toMatchObject({ webviews: ['main'] });
    expect(capability).not.toHaveProperty('windows');
    expect(capability).not.toHaveProperty('remote');
    expect(capability.permissions).not.toContain('allow-provider-eval');
    expect(capability.permissions).not.toContain('allow-provider-eval-with-callback');
    expect(capability.permissions).toContain('allow-provider-control-action');
    expect(capability.permissions).toContain('allow-provider-bridge-read');
  });

  it('isolates the Claude login toolbar from provider webviews and privileged native commands', () => {
    expect(toolbarCapability.webviews).toEqual(['claude-login-toolbar']);
    expect(toolbarCapability).not.toHaveProperty('windows');
    expect(toolbarCapability).not.toHaveProperty('remote');
    expect(toolbarCapability.permissions).toEqual([
      'core:default',
      'allow-claude-auth-tab-open-email',
      'allow-claude-auth-tab-switch',
      'allow-claude-auth-tab-close-email',
    ]);
    for (const provider of ['ai-claude', 'claude-login-mail', 'claude-email-popup-0']) {
      expect(toolbarCapability.webviews).not.toContain(provider);
      expect(capability.webviews).not.toContain(provider);
    }
  });

  it('enables a production CSP while leaving Vite development usable', () => {
    expect(tauriConfig.app.security).toMatchObject({
      csp: {
        'default-src': "'self'",
        'connect-src': 'ipc: http://ipc.localhost https://api.github.com',
        'img-src': "'self' asset: http://asset.localhost blob: data:",
        'style-src': "'self' 'unsafe-inline'",
      },
      devCsp: null,
    });
  });
});
