import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(process.cwd(), 'src/workbench.css'), 'utf8');

function rgb(hex: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Expected a six-digit hex color');
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const components = rgb(hex).map((channel) => {
    const normal = channel / 255;
    return normal <= 0.04045 ? normal / 12.92 : ((normal + 0.055) / 1.055) ** 2.4;
  });
  return components[0] * .2126 + components[1] * .7152 + components[2] * .0722;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function variable(name: string, context: string): string {
  const match = context.match(new RegExp('--' + name + ':\\s*(#[a-fA-F0-9]{6})\\s*;'));
  if (!match) throw new Error('Missing color token: ' + name);
  return match[1];
}

const themeStart = styles.indexOf('html.dark:not(.ai-sister) .workbench-shell {');
if (themeStart < 0) throw new Error('Dark theme palette is missing');
const theme = styles.slice(themeStart, styles.indexOf('}', themeStart));

const surface = variable('wb-surface', theme);
const soft = variable('wb-surface-soft', theme);
const hover = variable('wb-hover', theme);
const sidebar = variable('wb-sidebar', theme);
const ink = variable('wb-ink', theme);
const muted = variable('wb-secondary', theme);
const link = variable('wb-accent', theme);
const field = variable('wb-accessible-field-border', styles);
const focus = variable('wb-accessible-focus', styles);
const danger = variable('wb-accessible-danger-text', styles);
const overrideMuted = variable('wb-accessible-muted-text', styles);

describe('WCAG AA Cogitor dark palette contrast', () => {
  it('keeps ordinary and secondary text at 4.5:1 on all common surfaces', () => {
    for (const foreground of [ink, muted, overrideMuted, link]) {
      for (const background of [surface, soft, hover, sidebar]) {
        expect(contrast(foreground, background), foreground + ' on ' + background).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps danger messages at 4.5:1 even on hovered cards', () => {
    for (const background of [surface, soft, hover, sidebar]) {
      expect(contrast(danger, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps keyboard outlines and functional field borders at 3:1', () => {
    for (const foreground of [field, focus]) {
      for (const background of [surface, soft, hover, sidebar]) {
        expect(contrast(foreground, background), foreground + ' on ' + background).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('targets gray text, dialogs, controls, and keyboard focus without touching provider webviews', () => {
    expect(styles).toContain('WCAG 2.2 AA dark theme contrast pass');
    expect(styles).toContain('.dark\\:text-zinc-500');
    expect(styles).toContain('.dark\\:text-zinc-600');
    expect(styles).toContain('.workbench-dialog-backdrop :is(');
    expect(styles).toContain('.workbench-composer:focus-within');
    expect(styles).toContain('.workbench-session-delete:focus-visible');
    expect(styles).toContain('without affecting provider pages');
  });
});
