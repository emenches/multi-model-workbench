import { describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderModelControls } from '../ui/ProviderModelControls';

interface Props {
  children?: ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
}
function buttons(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<Props>(node)) return [];
  const self = node.type === 'button' ? [node] : [];
  return [...self, ...buttons(node.props.children)];
}
describe('verified model & effort UX', () => {
  it('never claims to have selected a model or effort it cannot verify', () => {
    const markup = renderToStaticMarkup(
      <ProviderModelControls provider="chatgpt" onOpenProvider={vi.fn()} onClose={vi.fn()} />,
    );
    expect(markup).toContain('Current model');
    expect(markup).toContain('Thinking effort');
    expect(markup.match(/Not verified/g)).toHaveLength(2);
    expect(markup).toContain('Options depend on your account');
  });
  it('opens the actual provider page instead of changing an inert local dropdown', () => {
    const open = vi.fn();
    const close = vi.fn();
    const panel = ProviderModelControls({ provider: 'gemini', onOpenProvider: open, onClose: close });
    const action = buttons(panel).find((button) =>
      renderToStaticMarkup(button).includes('Open Gemini model controls'),
    );
    expect(action).toBeDefined();
    action?.props.onClick?.();
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith('gemini');
    expect(renderToStaticMarkup(panel)).not.toContain('<select');
    buttons(panel).find((button) => button.props['aria-label'] === 'Close model settings')?.props.onClick?.();
    expect(close).toHaveBeenCalledOnce();
  });
});
