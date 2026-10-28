import { describe, expect, it } from 'vitest';
import { usableLoginStageBounds } from '../ui/loginStageBounds';

function rect(x: number, y: number, width: number, height: number): DOMRectReadOnly {
  return { x, y, width, height } as DOMRectReadOnly;
}

describe('login stage WebView bounds', () => {
  it('returns the measured visible stage rectangle', () => {
    const stage = rect(520, 90, 600, 400);
    expect(usableLoginStageBounds(stage)).toBe(stage);
  });
  it('rejects empty, offscreen or invalid stage rectangles', () => {
    expect(usableLoginStageBounds(null)).toBeUndefined();
    expect(usableLoginStageBounds(undefined)).toBeUndefined();
    expect(usableLoginStageBounds(rect(520, 90, 0, 400))).toBeUndefined();
    expect(usableLoginStageBounds(rect(-10_000, -10_000, 420, 320))).toBeUndefined();
    expect(usableLoginStageBounds(rect(Number.NaN, 90, 420, 320))).toBeUndefined();
  });
});
