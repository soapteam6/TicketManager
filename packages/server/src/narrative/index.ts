import { narrativeEnabled } from '../env.js';
import type { NarrativeAdapter } from './adapter.js';
import { NoopNarrativeAdapter } from './noop.adapter.js';
import { AnthropicNarrativeAdapter } from './anthropic.adapter.js';

let instance: NarrativeAdapter | null = null;

// Factory: key-gated. No ANTHROPIC_API_KEY -> deterministic fallback, everything still works.
export function getNarrativeAdapter(): NarrativeAdapter {
  if (!instance) {
    instance = narrativeEnabled ? new AnthropicNarrativeAdapter() : new NoopNarrativeAdapter();
  }
  return instance;
}

export * from './adapter.js';
