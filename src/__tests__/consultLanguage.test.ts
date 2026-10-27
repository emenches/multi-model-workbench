import { describe, expect, it } from 'vitest';
import { PROMPTS } from '../../shared/constants';
import { createResponseLanguagePolicy, prependResponseLanguagePolicy } from '../workflow/responseLanguage';

describe('Consult language continuity', () => {
  const question = 'What tire pressure should I use on washboard roads?';
  const first = 'Keep tire pressure within load limits.';
  const second = 'Adjust pressure for terrain and conditions.';
  const review = 'Some advice needs sources.';

  it('does not force a different language in the review prompt', () => {
    const prompt = PROMPTS.consult.reviewer(question, first, 'ChatGPT', second, 'Gemini');
    expect(prompt).toContain('Original user question:\n\n' + question);
    expect(prompt).toContain('Write your review in the language');
    expect(prompt).toContain('ORIGINAL USER');
    expect(prompt).toContain(first);
    expect(prompt).toContain(second);
    expect(prompt).not.toMatch(/[\u4e00-\u9fff]/u);
  });

  it('keeps the original question language explicit in synthesis', () => {
    const prompt = PROMPTS.consult.summary(question, first, 'ChatGPT', second, 'Gemini', review, 'ChatGPT');
    expect(prompt).toContain('Use the original user\'s requested or primary question language');
    expect(prompt).toContain(question);
    expect(prompt).toContain(review);
    expect(prompt).not.toMatch(/[\u4e00-\u9fff]/u);
  });

  it('keeps the existing Auto response language policy with Consult prompt', () => {
    const prompt = PROMPTS.consult.reviewer(question, first, 'ChatGPT', second, 'Gemini');
    const routed = prependResponseLanguagePolicy(prompt, createResponseLanguagePolicy('auto', 'en'));
    expect(routed).toContain('primary language of the user-authored prose');
    expect(routed).toContain(question);
  });
});
