import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../../../src-tauri/src/claude_email_link_activation.js', import.meta.url),
  'utf8',
);

function simulateClick(href, overrides = {}) {
  const redirects = [];
  let listener;
  const document = {
    baseURI: 'https://mail.google.com/mail/u/0/',
    addEventListener(type, fn, capture) {
      assert.equal(type, 'click');
      assert.equal(capture, true);
      listener = fn;
    },
  };
  const anchor = { getAttribute: key => key === 'href' ? href : null };
  const target = {
    nodeType: 1,
    closest: selector => selector === 'a[href]' ? anchor : null,
  };
  const window = {
    location: {
      href: 'https://mail.google.com/mail/u/0/',
      assign: value => redirects.push(value),
    },
    top: { location: { set href(value) { redirects.push(value); } } },
  };
  vm.runInNewContext(source, { URL, window, document }, { timeout: 1000 });
  assert.equal(typeof listener, 'function');
  let prevented = 0;
  let stopped = 0;
  listener({
    isTrusted: true,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target,
    preventDefault() { prevented++; },
    stopImmediatePropagation() { stopped++; },
    ...overrides,
  });
  return { redirects, prevented, stopped };
}

test('trusted normal click hands only an exact Claude URL to native navigation', () => {
  const result = simulateClick('https://claude.ai/auth/verify?token=opaque-test');
  assert.deepEqual(result.redirects, ['https://claude.ai/auth/verify?token=opaque-test']);
  assert.equal(result.prevented, 1);
  assert.equal(result.stopped, 1);
});

test('Gmail Google redirect wrapper only accepted for exact Claude destination', () => {
  const good = simulateClick(
    'https://www.google.com/url?q=' + encodeURIComponent('https://claude.ai/auth/verify?token=abc'),
  );
  assert.equal(good.redirects.length, 1);
  assert.ok(good.redirects[0].startsWith('https://www.google.com/url?q='));
  const bad = simulateClick(
    'https://www.google.com/url?q=' + encodeURIComponent('https://evil.example/?next=https://claude.ai/'),
  );
  assert.deepEqual(bad.redirects, []);
});

test('host spoofing, credentialed URLs, scripts and malicious wrappers are ignored', () => {
  const attacks = [
    'https://claude.ai.evil.example/auth/verify',
    'https://evil-claude.ai/auth/verify',
    'https://claude.ai@evil.example/auth/verify',
    'https://evil.example@claude.ai/auth/verify',
    'http://claude.ai/auth/verify',
    'https://claude.ai:8443/auth/verify',
    'javascript:alert(1)',
    'data:text/html,evil',
    'file:///etc/passwd',
    'https://www.google.com.evil.example/url?q=https%3A%2F%2Fclaude.ai%2F',
    'https://www.google.com/url?url=javascript%3Aalert(1)',
    'https://www.google.com/url?url=https%3A%2F%2Fclaude.ai.evil.test%2F',
    'https://www.google.com/url?url=https%3A%2F%2Fattacker%40claude.ai%2F',
    'https://www.google.com/url?url=https%3A%2F%2Fclaude.ai%3A8443%2F',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://mail.google.com/mail/u/0/',
  ];
  for (const url of attacks) {
    const result = simulateClick(url);
    assert.deepEqual(result.redirects, [], 'redirect allowed: ' + url);
    assert.equal(result.prevented, 0, 'click intercepted: ' + url);
  }
});

test('scripted clicks, new tabs, modifier clicks and right-click are never intercepted', () => {
  const url = 'https://claude.ai/auth/verify?token=test';
  const variants = [
    { isTrusted: false }, { button: 2 }, { metaKey: true },
    { ctrlKey: true }, { altKey: true }, { shiftKey: true },
  ];
  for (const variant of variants) {
    const result = simulateClick(url, variant);
    assert.deepEqual(result.redirects, []);
    assert.equal(result.prevented, 0);
  }
});
