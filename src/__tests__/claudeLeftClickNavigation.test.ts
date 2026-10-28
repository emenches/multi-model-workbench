import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const script = readFileSync(
  resolve(process.cwd(), 'src-tauri/src/claude_email_link_activation.js'), 'utf8',
);
const rust = readFileSync(
  resolve(process.cwd(), 'src-tauri/src/claude_login_tabs.rs'), 'utf8',
);

type Click = {
  isTrusted: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: { nodeType: number; closest: (selector: string) => { getAttribute: (name: string) => string } };
  preventDefault: ReturnType<typeof vi.fn>;
  stopImmediatePropagation: ReturnType<typeof vi.fn>;
};

function browser(allowTopNavigation = true) {
  const topNavigate = vi.fn();
  const frameNavigate = vi.fn();
  let onClick: (event: Click) => void = () => { throw new Error('no click listener'); };
  const document = {
    baseURI: 'https://mail.google.com/mail/u/1/#inbox',
    addEventListener: vi.fn((kind: string, handler: (event: Click) => void, capture: boolean) => {
      expect(kind).toBe('click');
      expect(capture).toBe(true);
      onClick = handler;
    }),
  };
  const frameLocation = { href: document.baseURI, assign: frameNavigate };
  const topLocation = { assign: allowTopNavigation ? topNavigate : vi.fn(() => { throw Error('cross-origin frame'); }) };
  const window = { location: frameLocation, top: { location: topLocation } };
  vm.runInNewContext(script, { document, window, URL }, { timeout: 1000 });
  const click = (href: string, options: Partial<Click> = {}) => {
    const event: Click = {
      isTrusted: true, button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
      target: {
        nodeType: 1,
        closest: (selector) => {
          expect(selector).toBe('a[href]');
          return { getAttribute: (name) => {
            expect(name).toBe('href');
            return href;
          } };
        },
      },
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      ...options,
    };
    onClick(event);
    return event;
  };
  return { document, click, topNavigate, frameNavigate };
}

describe('Claude Gmail left-click magic-link navigation fallback', () => {
  it('turns a real left-click on the exact Claude origin into native-interceptable navigation', () => {
    const b = browser();
    const href = 'https://claude.ai/auth/verify?token=secret#login';
    const e = b.click(href);
    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(e.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(b.topNavigate).toHaveBeenCalledWith(href);
    expect(b.frameNavigate).not.toHaveBeenCalled();
  });

  it('handles only Google redirect links that explicitly lead to Claude', () => {
    const b = browser();
    const wrapper = 'https://www.google.com/url?q=' +
      encodeURIComponent('https://claude.ai/auth/verify?token=private');
    b.click(wrapper);
    expect(b.topNavigate).toHaveBeenCalledWith(wrapper);
    b.topNavigate.mockClear();
    const bad = b.click('https://www.google.com/url?q=https%3A%2F%2Fevil.example%2F');
    expect(bad.preventDefault).not.toHaveBeenCalled();
    expect(b.topNavigate).not.toHaveBeenCalled();
  });

  it.each([
    'http://claude.ai/auth/verify?token=x',
    'https://claude.ai.evil.example/auth',
    'https://claude.ai@evil.example/auth',
    'https://user:password@claude.ai/auth',
    'https://claude.ai:8443/auth',
    'javascript:alert(1)',
    'https://accounts.google.com/AccountChooser',
    'https://mail.google.com/mail/u/2/#inbox',
    'https://other.example/',
  ])('leaves unrelated or unsafe links untouched: %s', (href) => {
    const b = browser();
    const event = b.click(href);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(b.topNavigate).not.toHaveBeenCalled();
  });

  it('does not interfere with right-click Open, Cmd-click, or synthetic events', () => {
    const b = browser();
    const href = 'https://claude.ai/auth/verify?token=x';
    for (const options of [{ button: 2 }, { metaKey: true }, { ctrlKey: true }, { isTrusted: false }]) {
      const e = b.click(href, options);
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
    expect(b.topNavigate).not.toHaveBeenCalled();
  });

  it('falls back to frame navigation when sandbox permissions block top navigation', () => {
    const b = browser(false);
    const url = 'https://claude.ai/auth/verify?token=x';
    const e = b.click(url);
    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(b.frameNavigate).toHaveBeenCalledWith(url);
  });

  it('attaches only a navigation listener in the email view and its popup frames', () => {
    expect(rust).toContain('include_str!("claude_email_link_activation.js")');
    expect(rust.match(/\.initialization_script_for_all_frames\(EMAIL_CLICK_ACTIVATION_JS\)/g)).toHaveLength(2);
    for (const forbidden of ['document.cookie', 'window.localStorage', 'innerHTML', 'textContent', 'querySelector(', 'fetch(', 'XMLHttpRequest(', '__TAURI__', 'console.log']) {
      expect(script).not.toContain(forbidden);
    }
  });
});
