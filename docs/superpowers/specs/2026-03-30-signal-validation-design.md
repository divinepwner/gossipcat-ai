# Signal Validation at Ingestion

**Date:** 2026-03-30
**Status:** Design approved (reviewed by 4 agents, updated with findings)
**Consensus:** 3/3 agents agreed on Option C (sonnet-reviewer, haiku-researcher, gemini-reviewer)
**Review:** 4/4 agents reviewed spec (+ gemini-implementer). 8 confirmed, 0 disputed.

## Problem

`agent-performance.jsonl` has 304 signals. 46 (15%) have empty `taskId`, 221 (73%) are missing `consensusId`, 23 have empty `evidence`. `PerformanceWriter.appendSignal()` does zero validation — raw `appendFileSync`. The reader compensates with `taskId || timestamp` fallback, which breaks retraction matching and consensus grouping.

Consequences:
- **Retraction is broken** for empty-taskId signals — retraction key uses retraction's timestamp, original uses original's timestamp, keys never match
- **Decay is incoherent** for manual signals — synthetic `manual-*` taskIds create isolated decay buckets disconnected from real tasks
- **Scoring is skewed** by signals that can't be retracted or grouped

## Approach: Option C — Two-Layer Validation

### Layer 1: PerformanceWriter (hard schema)

The writer rejects any signal missing required structural fields. This is the last line of defense — no bad data reaches disk.

**Required fields (all signal types):**

| Field | Rule | Why |
|-------|------|-----|
| `type` | Must be `'consensus'`, `'impl'`, or `'meta'` | Reader filters on type |
| `agentId` | Non-empty string | Scoring keys on this |
| `taskId` | Non-empty string | Retraction matching, decay bucketing |
| `signal` | Known enum value per type | Unknown values silently dropped by reader |
| `timestamp` | Valid ISO-8601 string | Signal expiry, circuit breaker |

**Validation function:** A `validateSignal(signal: PerformanceSignal)` function that throws on violation. Called in both `appendSignal()` and `appendSignals()` before writing. Must handle the full `PerformanceSignal` union — use `switch (signal.type)` to validate `signal` enum values per type (`consensus` has 10 values, `impl` has 4, `meta` has 2). Validate with `isFinite(new Date(signal.timestamp).getTime())` for timestamp — consistent with how the reader already handles this (performance-reader.ts:114-115).

**On validation failure:** Throw with a descriptive message. Callers must fix their signal construction. Do NOT silently drop — silent drops are how we got here.

### Layer 2: Ingestion Points (business rules)

Each caller validates context-specific rules before calling the writer.

#### ConsensusEngine (consensus-engine.ts)

- Assert `agentTaskIds.get(agentId)` is defined and non-empty before constructing signal. If undefined, log a warning and use `unknown-${consensusId}-${agentId}` as a recoverable fallback (better than empty string). **All 9 emit sites** in `synthesize()` use `?? ''` and must be updated: lines 241, 259, 288, 304, 329, 378, 399, 416, 426. Search globally for `agentTaskIds.get(` with `?? ''` to catch any additions.
- Always attach `consensusId` — the engine generates it, so there's no excuse for omission. Enforce via runtime assertion (the type stays optional since manual signals lack it).
- Cap `evidence` length at 2000 chars to prevent unbounded file growth from LLM output.

#### gossip_record_signals (mcp-server-sdk.ts)

- Accept optional `task_id` parameter from the caller (add `task_id: z.string().optional()` to Zod schema). When provided, use it as the real `taskId` to link manual signals to the task that triggered the review.
- When no `task_id` provided, generate `manual-${timestamp}-${i}` as today (backward compatible).
- Require non-empty `evidence` for `hallucination_caught` and `disagreement` signals — these are punitive and must be auditable. Enforce in the handler before calling writer: throw McpError if evidence is empty/missing for these signal types.
- Cap `evidence` length at 2000 chars (same as ConsensusEngine) to prevent unbounded file growth from manual signals.

#### gossip_retract_signal (mcp-server-sdk.ts)

- Remove the `as any` cast on `signal_retracted` — it's already in the union type.
- Validate that `task_id` is non-empty before writing retraction.

### Conditional field requirements (enforced at ingestion)

| Field | Required when | Why |
|-------|--------------|-----|
| `evidence` | `signal` in `{hallucination_caught, disagreement}` | Punitive signals need audit trail |
| `counterpartId` | `signal` in `{agreement, disagreement}` | Winner-gets-credit logic no-ops without it |

### Optional fields (no enforcement)

| Field | Reason |
|-------|--------|
| `consensusId` | Manual signals legitimately lack it |
| `skill` | Not used in scoring |
| `outcome` | Only meaningful for `hallucination_caught`; default severity is fine |
| `category` | Not used in scoring |

## Migration Strategy

**Principle:** Append-only. Do not rewrite the file — it's an audit log.

1. **46 empty-taskId signals:** Write `signal_retracted` entries for each. **Critical:** the retraction entry's `taskId` field must be set to the **original signal's `timestamp` value** (not a new current timestamp) — this is how the reader's retraction key matches when `taskId` is empty: `agentId + ':' + (taskId || timestamp)`. The retraction must use the original's timestamp as its `taskId` so the keys align.
2. **221 missing-consensusId signals:** No action. The reader doesn't group by `consensusId` today. These age out naturally.
3. **23 empty-evidence signals:** No action. Evidence isn't used in scoring math.
4. **After migration — TIMING DEPENDENCY:** The `taskId || timestamp` fallback in `PerformanceReader` can ONLY be removed after the 46 bad signals have aged out (30 days from their timestamp) or after the file is compacted to remove them. Removing the fallback earlier breaks retraction matching for those signals — the retraction keys use `taskId = original.timestamp`, but the originals have empty `taskId` and rely on the fallback to key by timestamp. **Target removal: 2026-04-30** (30 days from oldest bad signal).

## Bonus Bug Fixes (in scope)

These were discovered during the consensus review and directly relate to signal quality:

1. **`verifyCitations` false positives** (consensus-engine.ts:516-519) — catch block returns `true` (fabricated) on any I/O error. Fix: return `false` on I/O errors (benefit of doubt), only return `true` on confirmed non-existence. Note: this function is called from two sites (line ~279 on reviewer evidence, line ~373 on original findings) — the fix is in the one function definition and affects both paths.
2. **`as any` cast on `signal_retracted`** (mcp-server-sdk.ts:1987) — remove it, the value is already in the union type.

## Out of Scope

- File size eviction/rotation — important but separate concern (unbounded growth)
- `consensusId` grouping in the reader — no reader changes until legacy signals age out
- O(n^2) dedup in ConsensusEngine — no observed impact at current scale
- mtime cache staleness — filesystem-dependent, low priority

## Files to Change

| File | Change |
|------|--------|
| `packages/orchestrator/src/performance-writer.ts` | Add `validateSignal()`, call before every write |
| `packages/orchestrator/src/consensus-types.ts` | No change — types already cover the schema |
| `packages/orchestrator/src/consensus-engine.ts` | Assert taskId non-empty, cap evidence length, fix verifyCitations catch |
| `apps/cli/src/mcp-server-sdk.ts` | Add optional `task_id` param to record_signals, require evidence for punitive signals, remove `as any` cast |
| `packages/orchestrator/src/performance-reader.ts` | Remove `taskId \|\| timestamp` fallback — **deferred to 2026-04-30** after bad signals age out |
| `tests/orchestrator/performance-writer.test.ts` | New — validation tests for all 3 signal types |
| `tests/orchestrator/signal-types.test.ts` | Extend with conditional field tests |
| `tests/orchestrator/signal-migration.test.ts` | New — round-trip test: write empty-taskId signal, run migration retraction, verify excluded from scoring |

## Implementation Order

**Critical sequencing** (confirmed by gemini-implementer):

1. **Writer validation first** — `validateSignal()` in performance-writer.ts + tests. Establishes the baseline data integrity guarantee.
2. **Ingestion point fixes second** — ConsensusEngine (9 emit sites), gossip_record_signals (schema + handler), gossip_retract_signal (as-any cast). Producers must comply with the new writer contract.
3. **Migration third** — Run retraction entries for 46 empty-taskId signals.
4. **Reader fallback removal last** — Deferred to 2026-04-30. Only safe after bad signals age out.

## Test Plan

- Writer rejects signal with empty `taskId` (throws)
- Writer rejects signal with invalid `timestamp`
- Writer rejects signal with unknown `signal` enum
- Writer accepts valid signal for each type (consensus, impl, meta)
- ConsensusEngine never produces empty `taskId` — mock agent not in map, verify fallback
- `gossip_record_signals` requires evidence for `hallucination_caught`
- `gossip_record_signals` accepts optional `task_id` and uses it
- `verifyCitations` returns `false` on I/O error (not `true`)
- Retraction works for signals with real `taskId`
- Migration script produces valid retraction entries for empty-taskId signals
