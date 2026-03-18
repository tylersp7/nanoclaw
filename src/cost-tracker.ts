/**
 * Cost Tracker for NanoClaw
 *
 * Accumulates API token usage from the credential proxy, keyed by group folder.
 * The proxy routes requests through /track/{groupFolder}/... paths, allowing
 * per-group cost attribution even with concurrent containers.
 *
 * Token counts are extracted from Anthropic API responses:
 *   - Non-streaming: response body `usage.input_tokens` / `usage.output_tokens`
 *   - Streaming (SSE): `message_start` event (input) + `message_delta` event (output)
 */

import { logger } from './logger.js';

// Model pricing per million tokens (USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-20250506': { input: 0.25, output: 1.25 },
  // Fallback for unknown models
  default: { input: 3, output: 15 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  model: string;
}

interface AccumulatedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requestCount: number;
  estimatedCostUsd: number;
}

// Per-group token accumulators — reset after each container run records them
const groupAccumulators = new Map<string, AccumulatedUsage>();

function getOrCreateAccumulator(groupFolder: string): AccumulatedUsage {
  let acc = groupAccumulators.get(groupFolder);
  if (!acc) {
    acc = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      requestCount: 0,
      estimatedCostUsd: 0,
    };
    groupAccumulators.set(groupFolder, acc);
  }
  return acc;
}

function estimateCost(usage: TokenUsage): number {
  const pricing = MODEL_PRICING[usage.model] || MODEL_PRICING.default;
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  // Cache creation costs same as input; cache reads are discounted (typically 90% off)
  const cacheCreateCost =
    (usage.cacheCreationInputTokens / 1_000_000) * pricing.input;
  const cacheReadCost =
    (usage.cacheReadInputTokens / 1_000_000) * pricing.input * 0.1;
  return inputCost + outputCost + cacheCreateCost + cacheReadCost;
}

/**
 * Record token usage for a group. Called by the credential proxy
 * after parsing an API response.
 */
export function recordTokenUsage(groupFolder: string, usage: TokenUsage): void {
  const acc = getOrCreateAccumulator(groupFolder);
  acc.inputTokens += usage.inputTokens;
  acc.outputTokens += usage.outputTokens;
  acc.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  acc.cacheReadInputTokens += usage.cacheReadInputTokens;
  acc.requestCount += 1;
  acc.estimatedCostUsd += estimateCost(usage);

  logger.trace(
    {
      groupFolder,
      input: usage.inputTokens,
      output: usage.outputTokens,
      model: usage.model,
    },
    'Token usage recorded',
  );
}

/**
 * Drain and return accumulated usage for a group, resetting the counter.
 * Called by the container runner after a container run completes.
 */
export function drainGroupUsage(groupFolder: string): AccumulatedUsage | null {
  const acc = groupAccumulators.get(groupFolder);
  if (!acc || acc.requestCount === 0) return null;

  const result = { ...acc };
  // Reset
  acc.inputTokens = 0;
  acc.outputTokens = 0;
  acc.cacheCreationInputTokens = 0;
  acc.cacheReadInputTokens = 0;
  acc.requestCount = 0;
  acc.estimatedCostUsd = 0;

  return result;
}

/**
 * Parse token usage from a non-streaming Anthropic API response body.
 */
export function parseNonStreamingUsage(body: string): TokenUsage | null {
  try {
    const json = JSON.parse(body);
    if (!json.usage) return null;
    return {
      inputTokens: json.usage.input_tokens || 0,
      outputTokens: json.usage.output_tokens || 0,
      cacheCreationInputTokens: json.usage.cache_creation_input_tokens || 0,
      cacheReadInputTokens: json.usage.cache_read_input_tokens || 0,
      model: json.model || 'unknown',
    };
  } catch {
    return null;
  }
}

/**
 * Parse token usage from a streaming (SSE) Anthropic API response.
 * Extracts from `message_start` (input tokens) and `message_delta` (output tokens).
 */
export function parseStreamingUsage(body: string): TokenUsage | null {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let model = 'unknown';

  // Parse SSE events
  const lines = body.split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;

    try {
      const event = JSON.parse(data);

      if (event.type === 'message_start' && event.message?.usage) {
        inputTokens = event.message.usage.input_tokens || 0;
        cacheCreationInputTokens =
          event.message.usage.cache_creation_input_tokens || 0;
        cacheReadInputTokens = event.message.usage.cache_read_input_tokens || 0;
        model = event.message.model || model;
      }

      if (event.type === 'message_delta' && event.usage) {
        outputTokens = event.usage.output_tokens || 0;
      }
    } catch {
      // Skip unparseable lines
    }
  }

  if (inputTokens === 0 && outputTokens === 0) return null;

  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    model,
  };
}

/**
 * Extract the group folder from a proxy request path.
 * Paths are formatted as /track/{groupFolder}/v1/messages
 * Returns null if the path doesn't contain a tracking prefix.
 */
export function extractGroupFromPath(path: string): {
  groupFolder: string;
  strippedPath: string;
} | null {
  const match = path.match(/^\/track\/([^/]+)(\/.*)/);
  if (!match) return null;
  return {
    groupFolder: decodeURIComponent(match[1]),
    strippedPath: match[2],
  };
}

/**
 * Get current model pricing for display/reporting.
 */
export function getModelPricing(): Record<
  string,
  { input: number; output: number }
> {
  return { ...MODEL_PRICING };
}
