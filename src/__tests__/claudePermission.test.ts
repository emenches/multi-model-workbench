import { describe, expect, it } from 'vitest';
import {
  isClaudeChromeApprovalCard,
  isClaudeChromeToolAcknowledgement,
  isClaudeChromeApprovalPending,
  nextClaudeChromeTurnGate,
  claudePermissionControlMounted,
  type ClaudeChromeTurnGate,
} from '../../injected/claudePermission';

const empty: ClaudeChromeTurnGate = { awaitingFinal: false, interimText: '' };

describe('Claude in Chrome permission and completion protection', () => {
  it('recognizes the browser permission choices without exposing page content', () => {
    expect(isClaudeChromeApprovalCard(
      'Claude in Chrome wants to read this page',
      ['Allow this action', 'Always allow actions on this site', 'Decline'],
    )).toBe(true);
    expect(isClaudeChromeApprovalCard(
      'New permissions required for Chrome',
      ['Allow this time only', 'Deny'],
    )).toBe(true);
    expect(isClaudeChromeApprovalCard('Use this analogy in your answer', ['Allow', 'Deny'])).toBe(false);
    expect(isClaudeChromeApprovalCard('Claude in Chrome wants to read this page', ['Deny'])).toBe(false);
  });


  it('detects mounted consent in hidden WKWebViews without layout rectangles', () => {
    const dialog = {
      hidden: false, parentElement: null, textContent: 'Claude in Chrome wants to access a page. Allow this action Decline',
      getAttribute: (_name: string) => null,
      hasAttribute: (_name: string) => false,
      querySelectorAll: (_selector: string) => [] as unknown[],
      getClientRects: () => [],
    };
    const button = (label: string) => ({
      hidden: false, parentElement: dialog, textContent: label,
      getAttribute: (_name: string) => null,
      hasAttribute: (_name: string) => false,
      getClientRects: () => [],
    });
    const allow = button('Allow this action');
    const decline = button('Decline');
    dialog.querySelectorAll = () => [allow, decline];
    const document = {
      querySelector: () => null,
      querySelectorAll: () => [allow, decline],
    } as unknown as Document;
    expect(isClaudeChromeApprovalPending(document, { origin: 'https://claude.ai', pathname: '/new' }, claudePermissionControlMounted)).toBe(true);
    expect(claudePermissionControlMounted(allow as unknown as Element)).toBe(true);
    (dialog as typeof dialog & { hidden: boolean }).hidden = true;
    expect(isClaudeChromeApprovalPending(document, { origin: 'https://claude.ai', pathname: '/new' }, claudePermissionControlMounted)).toBe(false);
  });

  it('never scans SSO or authentication routes for permission prompts', () => {
    const login = { querySelector: () => null, querySelectorAll: () => { throw new Error('should not scan'); } } as unknown as Document;
    expect(isClaudeChromeApprovalPending(login, { origin: 'https://claude.ai', pathname: '/login' }, () => true)).toBe(false);
    expect(isClaudeChromeApprovalPending(login, { origin: 'https://accounts.google.com', pathname: '/chat/123' }, () => true)).toBe(false);
  });

  it('recognizes short future-tense acknowledgements but not completed answers', () => {
    expect(isClaudeChromeToolAcknowledgement("I'll use Chrome to check the site.")).toBe(true);
    expect(isClaudeChromeToolAcknowledgement("Let me open your browser first.")).toBe(true);
    expect(isClaudeChromeToolAcknowledgement('The browser tool found three relevant pages and here is the analysis.')).toBe(false);
  });

  it('never treats the acknowledgement as completion while permission is pending', () => {
    const acknowledgement = "I'll use Chrome to inspect that.";
    let gate = nextClaudeChromeTurnGate(empty, acknowledgement, false);
    expect(gate).toEqual({ awaitingFinal: true, interimText: acknowledgement });
    gate = nextClaudeChromeTurnGate(gate, acknowledgement, true);
    expect(gate.awaitingFinal).toBe(true);
    gate = nextClaudeChromeTurnGate(gate, acknowledgement, false);
    expect(gate.awaitingFinal).toBe(true);
    gate = nextClaudeChromeTurnGate(gate, 'The browser results show the requested answer.', false);
    expect(gate).toEqual(empty);
  });

  it('holds the turn for a permission card even without a recognizable acknowledgement', () => {
    let gate = nextClaudeChromeTurnGate(empty, 'Getting started.', true);
    expect(gate.awaitingFinal).toBe(true);
    expect(nextClaudeChromeTurnGate(gate, 'Getting started.', false).awaitingFinal).toBe(true);
    gate = nextClaudeChromeTurnGate(gate, 'Completed analysis after your approval.', false);
    expect(gate.awaitingFinal).toBe(false);
  });
});
