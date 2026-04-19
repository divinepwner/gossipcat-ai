/**
 * Prompt cache helpers — build deterministic cacheable prompt prefixes.
 *
 * Anthropic prompt caching requires byte-identical prefixes across requests.
 * Any non-determinism (timestamps, map-order iteration, trailing whitespace
 * drift) silently misses the cache and wastes tokens at full price. The
 * builders in this module are the single site that produces cache-eligible
 * prefixes; keep them pure and side-effect-free.
 *
 * See docs/specs/2026-04-19-ast-xref-and-context-compaction.md §Phase 2.
 */

import type { TextContent, ToolDefinition } from '@gossip/types';

/** Anthropic requires ~1024 input tokens minimum to cache (higher tiers for
 *  small models). We apply a conservative byte floor — ~3.5 chars/token × 1024
 *  — below which we skip the cache marker entirely to avoid paying the
 *  creation surcharge on prefixes that will never hit. */
export const CACHE_MIN_CHARS = 3600;

/**
 * Build a system message content array with a cache breakpoint after the
 * static prefix. The static portion is identical across dispatches (schemas,
 * verification rules, handbook pointers) and should not embed per-request
 * strings — dates, task IDs, agent IDs all belong in the dynamic tail.
 *
 * Returns a plain `TextContent[]` when the static portion is too small to
 * benefit from caching (Anthropic's per-request overhead dominates). In that
 * case both portions merge into a single uncached block.
 *
 * Deterministic guarantees:
 * - Block order: static first, dynamic second (never reordered).
 * - Whitespace: inputs passed through verbatim; no trim() that would mask
 *   accidental drift in caller input.
 * - Empty `dynamic` produces exactly one block; absent callers never see a
 *   stray empty block that could shift byte offsets.
 */
export function buildCacheableSystem(staticPart: string, dynamicPart?: string): TextContent[] {
  if (!staticPart) {
    return dynamicPart ? [{ type: 'text', text: dynamicPart }] : [];
  }

  if (staticPart.length < CACHE_MIN_CHARS) {
    const merged = dynamicPart ? `${staticPart}${dynamicPart}` : staticPart;
    return [{ type: 'text', text: merged }];
  }

  const blocks: TextContent[] = [
    { type: 'text', text: staticPart, cacheControl: 'ephemeral' },
  ];
  if (dynamicPart) {
    blocks.push({ type: 'text', text: dynamicPart });
  }
  return blocks;
}

/**
 * Mark the last tool in an array as a cache breakpoint. Anthropic evaluates
 * tools as part of the cacheable prefix when any tool carries `cache_control`;
 * tagging the last one caches the entire tools block in one breakpoint.
 *
 * Returns a new array — never mutates the input, so VERIFIER_TOOLS and other
 * module-level constants stay stable.
 *
 * The `cacheControl` tag is attached as a non-standard field that the
 * AnthropicProvider translates into `cache_control: { type: 'ephemeral' }`
 * on the wire. Other providers ignore it.
 */
export function markToolsCacheable(tools: ToolDefinition[]): CacheableToolDefinition[] {
  if (tools.length === 0) return [];
  return tools.map((t, i) =>
    i === tools.length - 1
      ? { ...t, cacheControl: 'ephemeral' as const }
      : t,
  );
}

/** ToolDefinition with an optional cache marker honored by AnthropicProvider. */
export interface CacheableToolDefinition extends ToolDefinition {
  cacheControl?: 'ephemeral';
}
