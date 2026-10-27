import { describe, expect, it } from 'vitest';
import {
  appendResponseLanguageReminder,
  createResponseLanguagePolicy,
  isResponseLanguagePolicy,
  prependResponseLanguagePolicy,
  responseLanguageDirective,
  responseLanguagePolicyFromPrompt,
} from '../workflow/responseLanguage';

describe('response language policy', () => {
  it('keeps prompts unchanged when no response-language policy was supplied', () => {
    expect(prependResponseLanguagePolicy('original prompt')).toBe('original prompt');
    expect(appendResponseLanguageReminder('original prompt')).toBe('original prompt');
  });

  it('reinforces original user language after non-English workflow instructions', () => {
    const policy = createResponseLanguagePolicy('auto', 'en');
    const routed = appendResponseLanguageReminder(
      prependResponseLanguagePolicy('這裡有一些工作流程指示。', policy),
      policy,
    );
    expect(routed).toContain('primary language of the ORIGINAL USER QUESTION');
    expect(routed).toContain('Do not copy the language of preceding workflow instructions');
    expect(routed).toContain('Keep direct quotations, code, names and citations');
  });

  it('respects explicit user language requests even with a fixed setting', () => {
    const routed = appendResponseLanguageReminder('Prompt', createResponseLanguagePolicy('de', 'en'));
    expect(routed).toContain('German (de)');
    expect(routed).toContain('explicitly requests another output language');
  });

  it('uses question and conversation language before the interface fallback in Auto mode', () => {
    const policy = createResponseLanguagePolicy('auto', 'zh-TW');
    const directive = responseLanguageDirective(policy);

    expect(directive).toContain('explicit output-language request(s)');
    expect(directive).toContain('primary language of the user-authored prose');
    expect(directive).toContain('language previously used by the user');
    expect(directive).toContain('Traditional Chinese (zh-TW) (the app interface language fallback)');
    expect(directive).toContain('does not change the requested task, output modality, structure, or format');
    expect(directive).toContain('Do not infer it from these workflow instructions, other AI responses');
    expect(directive).toContain('attachments, code, identifiers, URLs, or filenames');
    expect(directive).toContain('Never quote, reproduce, summarize, mention, or explain it');
    expect(directive).toContain('The request to answer begins after the closing tag.');
    expect(prependResponseLanguagePolicy('original prompt', policy)).toBe(`${directive}\n\noriginal prompt`);
  });

  it('lets a fixed response-language preference override inferred question language', () => {
    const directive = responseLanguageDirective(createResponseLanguagePolicy('de', 'en'));

    expect(directive).toContain('explicit output-language request(s)');
    expect(directive).toContain('Otherwise, reply in German (de).');
    expect(directive).not.toContain('app interface language fallback');
  });

  it('restores the last valid policy tag from a retained snapshot prompt', () => {
    const policy = createResponseLanguagePolicy('auto', 'ja');
    const prompt = [
      '<response-language-policy version="1" setting="de" interface-locale="de">',
      prependResponseLanguagePolicy('original prompt', policy),
    ].join('\n');

    expect(responseLanguagePolicyFromPrompt(prompt)).toEqual(policy);
    expect(responseLanguagePolicyFromPrompt('<response-language-policy version="99" setting="auto" interface-locale="en">')).toBeUndefined();
    expect(isResponseLanguagePolicy(policy)).toBe(true);
  });
});
