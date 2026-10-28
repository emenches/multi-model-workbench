import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CogitorMark } from '../ui/CogitorMark';

describe('Cogitor flat orbital identity', () => {
  it('is accessible as a decorative mark and motionless while idle', () => {
    const html = renderToStaticMarkup(createElement(CogitorMark));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-active="false"');
    expect(html).not.toContain('cogitor-mark--thinking');
    expect(html).toContain('#E38B45');
    expect(html).toContain('#EFE6D3');
  });

  it('only opts into breathing while a response is processing', () => {
    const html = renderToStaticMarkup(createElement(CogitorMark, { active: true }));
    expect(html).toContain('cogitor-mark--thinking');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('cogitor-mark__core');
    expect(html).toContain('cogitor-mark__highlight');
  });
});
