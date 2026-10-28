/* global URL, window, document */
// Strictly a user-gesture navigation fallback for Claude email magic links.
// This script runs in the isolated *email* webview (including message frames).
// It does not read message bodies, cookies, localStorage, or page text; does
// not send data through Tauri IPC; and never logs or stores a login URL.
(() => {
  'use strict';

  const isClaude = (url) =>
    url.protocol === 'https:' &&
    url.hostname === 'claude.ai' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '';

  const approvedNavigation = (href) => {
    try {
      const link = new URL(href, document.baseURI || window.location.href);
      if (isClaude(link)) return link.href;

      // Gmail frequently wraps a real destination with Google's /url route.
      // Only use the wrapper when its destination is itself an exact-origin
      // Claude link; never unwrap arbitrary web or identity-provider URLs.
      if (link.protocol !== 'https:' ||
          link.hostname !== 'www.google.com' ||
          link.port !== '' ||
          link.username !== '' ||
          link.password !== '' ||
          link.pathname !== '/url') return null;

      const wrapped = link.searchParams.get('url') || link.searchParams.get('q');
      if (!wrapped || !isClaude(new URL(wrapped))) return null;
      return link.href;
    } catch {
      return null;
    }
  };

  document.addEventListener('click', (event) => {
    // Only actual left-click or keyboard activation, not scripted events,
    // right-click Open, Cmd-click, or normal Gmail account switching.
    if (!event.isTrusted || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target;
    const element = target && (target.nodeType === 1 ? target : target.parentElement);
    const anchor = element && typeof element.closest === 'function'
      ? element.closest('a[href]') : null;
    if (!anchor || typeof anchor.getAttribute !== 'function') return;
    const destination = approvedNavigation(anchor.getAttribute('href'));
    if (!destination) return;

    // Gmail JS or target="_blank" can consume a normal click before WebKit
    // calls our on_new_window/on_navigation handlers. Convert only this
    // user-activated Claude link into a top-level navigation so the native
    // exact-origin check can hand it to the original Claude provider session.
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      // Cross-origin frames can usually WRITE top.location.href after a real
      // user gesture even though reading it or calling .assign is forbidden.
      window.top.location.href = destination;
    } catch {
      // A sandboxed frame may reject top-level navigation altogether.
      window.location.assign(destination);
    }
  }, true);
})();
