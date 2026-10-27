import { describe, expect, it, vi } from 'vitest';
import { applyCenterHiddenCommands, type PresentationCommandHost } from '../ui/presentationCommands';
import { defaultPresentation, setProviderPresentation } from '../ui/presentation';
import type { AIProvider, ProviderState } from '../../shared/types';

const host = (): PresentationCommandHost => ({
  close: vi.fn().mockResolvedValue(undefined),
  hide: vi.fn().mockResolvedValue(undefined),
  open: vi.fn().mockResolvedValue(undefined),
  show: vi.fn().mockResolvedValue(undefined),
  setBounds: vi.fn().mockResolvedValue(undefined),
});
const state = (provider: AIProvider): ProviderState => ({
  provider, webview: 'loaded', dom: 'ready', login: 'logged_in', thinking: false, lastStatusAt: 1,
});
describe('native restore safety', () => {
  const presentation = setProviderPresentation(defaultPresentation(), 'chatgpt', 'center');
  const states = {
    chatgpt: state('chatgpt'), claude: state('claude'), gemini: state('gemini'),
    grok: state('grok'), meta: state('meta'),
  };
  it('does not show a formerly hidden child in text mode or without a measured stage', async () => {
    const h = host();
    await applyCenterHiddenCommands({
      host: h, previousHidden: new Set(['chatgpt']), nextHidden: new Set(),
      snapshot: () => ({ states, presentation, userHidden: new Set(), overlayGuardOpen: false }),
      getRestoreBounds: () => undefined,
    });
    expect(h.show).not.toHaveBeenCalled();
    expect(h.setBounds).not.toHaveBeenCalled();
  });
  it('moves a hidden native child into the content region before showing', async () => {
    const h = host();
    const rect = { x: 300, y: 80, width: 450, height: 370 } as DOMRectReadOnly;
    await applyCenterHiddenCommands({
      host: h, previousHidden: new Set(['chatgpt']), nextHidden: new Set(),
      snapshot: () => ({ states, presentation, userHidden: new Set(), overlayGuardOpen: false }),
      getRestoreBounds: () => rect,
    });
    expect(h.setBounds).toHaveBeenCalledWith('chatgpt', rect);
    expect(h.show).toHaveBeenCalledWith('chatgpt');
    expect(vi.mocked(h.setBounds).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(h.show).mock.invocationCallOrder[0]);
  });
});
