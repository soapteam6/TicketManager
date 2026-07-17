import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import type { NarrativeAdapter, NarrativeRequest, NarrativeResult } from './adapter.js';
import { NARRATIVE_SYSTEM_PROMPT, buildUserMessage } from './prompt.js';

// Real narrative generator. The decision is already persisted before this is called, so any
// failure degrades gracefully to available:false without affecting the allocation.
export class AnthropicNarrativeAdapter implements NarrativeAdapter {
  private client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  isEnabled(): boolean {
    return true;
  }

  async explainRanking(input: NarrativeRequest): Promise<NarrativeResult> {
    try {
      const resp = await this.client.messages.create({
        model: env.ANTHROPIC_MODEL,
        max_tokens: 1024,
        // cache_control marks the stable system prompt as a cached prefix. Cast keeps us
        // decoupled from minor SDK type-version differences (the API accepts it at runtime).
        system: [{ type: 'text', text: NARRATIVE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] as unknown as Anthropic.TextBlockParam[],
        messages: [{ role: 'user', content: buildUserMessage(JSON.stringify(input, null, 2)) }],
      });
      const text = resp.content.find((b) => b.type === 'text');
      const usage = resp.usage as { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
      return {
        available: true,
        narrative: text && text.type === 'text' ? text.text : '',
        source: 'anthropic',
        model: resp.model,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        },
      };
    } catch (err) {
      logger.warn({ err }, 'Narrative generation failed; falling back');
      return { available: false, narrative: '', source: 'fallback' };
    }
  }
}
