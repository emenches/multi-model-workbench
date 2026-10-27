import { describe, expect, it } from 'vitest';
import { base64UrlDecode, base64UrlEncode, decodeTitleFrame, encodeBoundedStatusTitleFrame, encodeTitleFrame } from '../../injected/codec';

describe('bridge codec', () => {
  it('round-trips title frames and returns null for non-frames', () => {
    const payload = { v: 1, action: 'STATUS_REPORT', payload: { text: 'hello 中文' } };
    const frame = encodeTitleFrame('boot1234', 42, payload);
    expect(frame.startsWith('\u200BMAC1|boot1234|42|')).toBe(true);
    expect(decodeTitleFrame(frame)).toEqual({ bootId: 'boot1234', seq: 42, json: payload });
    expect(decodeTitleFrame('ChatGPT')).toBeNull();
  });

  it('throws when title frames exceed 900 chars', () => {
    expect(() => encodeTitleFrame('boot1234', 1, { data: 'x'.repeat(900) })).toThrow(/900/);
  });

  it('compacts oversized ChatGPT status diagnostics while preserving essential hints', () => {
    const message = {
      v: 1, action: 'STATUS_REPORT', provider: 'chatgpt', bootId: 'boot1234', seq: 7,
      payload: {
        dom: 'ready', login: 'logged_in', thinking: null,
        bulkReady: 4, doneReady: true, fill: 'done', fillChars: 2302,
        capturePhase: 'candidate-rejected',
        captureResponseNodes: 1, captureAssistantUnits: 1,
        captureLatestUnitDomChars: 13, captureTextChars: 0,
        captureAnchor: true, captureGenerationSeen: true,
        captureFullDiagnostics: 'x'.repeat(12_000),
      },
    };
    const result = encodeBoundedStatusTitleFrame('boot1234', 7, message);
    expect(result.compacted).toBe(true);
    expect(result.frame.length).toBeLessThanOrEqual(900);
    const decoded = decodeTitleFrame(result.frame);
    expect(decoded?.json).toMatchObject({
      action: 'STATUS_REPORT', provider: 'chatgpt', bootId: 'boot1234', seq: 7,
      payload: {
        dom: 'ready', login: 'logged_in', thinking: null,
        bulkReady: 4, doneReady: true, fill: 'done', fillChars: 2302,
        capturePhase: 'candidate-rejected',
        captureResponseNodes: 1, captureAssistantUnits: 1,
        captureLatestUnitDomChars: 13, captureTextChars: 0,
        captureAnchor: true, captureGenerationSeen: true,
      },
    });
    expect(JSON.stringify(decoded?.json)).not.toContain('captureFullDiagnostics');
  });

  it('retains essential transport hints even when every optional field is oversized', () => {
    const inflated = {
      action: 'STATUS_REPORT', provider: 'chatgpt', v: 1,
      payload: Object.fromEntries([
        'dom', 'login', 'bridge', 'reason', 'adapter', 'fill',
        'statusErrorStage', 'capturePhase',
      ].map((key) => [key, 'x'.repeat(200)])),
    };
    Object.assign(inflated.payload, { bulkReady: 1, doneReady: true, thinking: false });
    const result = encodeBoundedStatusTitleFrame('boot1234', 9, inflated);
    expect(result.compacted).toBe(true);
    expect(result.frame.length).toBeLessThanOrEqual(900);
    expect(decodeTitleFrame(result.frame)?.json).toMatchObject({
      action: 'STATUS_REPORT',
      payload: { bulkReady: 1, doneReady: true, thinking: false },
    });
  });

  it('does not alter small status hints and does not compact other actions', () => {
    const message = { v: 1, action: 'STATUS_REPORT', payload: { dom: 'ready', login: 'logged_in' } };
    const normal = encodeBoundedStatusTitleFrame('boot1234', 2, message);
    expect(normal).toEqual({ frame: encodeTitleFrame('boot1234', 2, message), compacted: false });
    expect(() => encodeBoundedStatusTitleFrame('boot1234', 3, {
      action: 'RESPONSE_DONE', payload: 'x'.repeat(12_000),
    })).toThrow(/900/);
  });

  it('uses base64url without padding, plus, or slash and preserves UTF-8', () => {
    const encoded = base64UrlEncode('中文 + / =');
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(base64UrlDecode(encoded)).toBe('中文 + / =');
  });
});
