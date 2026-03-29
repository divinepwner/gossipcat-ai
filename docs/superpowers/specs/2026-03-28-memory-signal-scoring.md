# Memory Signal Scoring — Design Spec

> ATI consensus signals flow back into memory importance, making high-quality task memories survive longer and low-quality ones decay faster.

**Date:** 2026-03-28
**Status:** Ready for implementation
**Dependencies:** ATI v3 (shipped), Consensus Protocol (shipped), Memory System (shipped)

---

## Problem Statement

The memory scoring system exists but doesn't work:

- `accuracy` is always 4 (dead branch inside `status === 'completed'` block)
- `uniqueness` is always 3 (hardcoded)
- `relevance` is 3 or 4 based on result length (weak signal)
- `deriveImportance` produces [0.67-0.73] — effectively constant
- Warmth = importance × age_decay, but since importance is constant, warmth is purely age-based
- All memories age out equally regardless of quality

Meanwhile, ATI consensus signals (`consensus_verified`, `unique_confirmed`, `hallucination_caught`) carry real quality information but never flow back into memory importance.

## Design

### Signal → Memory Importance Flow

After consensus produces signals, update the corresponding task memory entries:

```
consensus_verified     → task importance += 0.15 (judge confirmed this was real)
unique_confirmed       → task importance += 0.20 (agent found something others missed)
agreement              → task importance += 0.05 (peers agreed)
hallucination_caught   → task importance -= 0.25 (finding was fabricated)
disagreement           → task importance -= 0.10 (peers disagreed)
```

### Where It Happens

In `dispatch-pipeline.ts`, after consensus signals are written to `agent-performance.jsonl`, call a new method on `MemoryWriter`:

```typescript
// After consensus signals are emitted
if (consensusReport.signals.length > 0) {
  this.memWriter.updateImportanceFromSignals(consensusReport.signals);
}
```

### MemoryWriter.updateImportanceFromSignals

New method that reads `tasks.jsonl` for each agent, finds the matching task entry by taskId, adjusts importance, and rewrites the line.

```typescript
updateImportanceFromSignals(signals: ConsensusSignal[]): void {
  // Group signals by agentId
  // For each agent, read tasks.jsonl
  // For each signal, find the task entry and adjust importance
  // Rewrite tasks.jsonl with updated importance values
}
```

### Fix Dead Scores

Also fix the accuracy/uniqueness dead code:

```typescript
// Before (dead branch):
accuracy: t.status === 'completed' ? 4 : 2,  // always 4
uniqueness: 3,  // always 3

// After (meaningful signals):
accuracy: (t.result && t.result.length > 500) ? 5 : (t.result && t.result.length > 100) ? 4 : 3,
uniqueness: 3,  // remains 3 at write time — updated by consensus signals later
```

The real fix for accuracy and uniqueness is the consensus signal feedback — it adjusts importance AFTER the task is evaluated by peers, not at write time when we don't yet know the quality.

---

## Architecture

### Modified Files

| File | Change |
|------|--------|
| `packages/orchestrator/src/memory-writer.ts` | Add `updateImportanceFromSignals()` method |
| `packages/orchestrator/src/dispatch-pipeline.ts` | Call `updateImportanceFromSignals` after consensus signals |

### Signal Weight Map

```typescript
const IMPORTANCE_ADJUSTMENTS: Record<string, number> = {
  consensus_verified: 0.15,
  unique_confirmed: 0.20,
  agreement: 0.05,
  hallucination_caught: -0.25,
  disagreement: -0.10,
};
```

Importance is clamped to [0.1, 1.0] after adjustment.

### Task Entry Matching

Consensus signals carry `taskId` which maps to the task entry in `tasks.jsonl`. The `updateImportanceFromSignals` method:

1. Groups signals by `agentId`
2. For each agent, reads `tasks.jsonl`
3. For each signal, finds the entry where `entry.taskId === signal.taskId`
4. Adjusts `entry.importance` by the signal weight
5. Rewrites `tasks.jsonl` (respects the compaction lock)

### Concurrent Safety

Uses the same lock file pattern as `MemoryCompactor` — checks for `tasks.jsonl.lock` before writing. If locked, skips the update (best-effort, signals are already persisted in `agent-performance.jsonl`).

---

## Also Fix (bundled)

These 6 actionable findings from the review are fixed alongside:

| # | Fix |
|---|-----|
| 1 | Remove `touchKnowledgeFile` write side-effect from `loadMemory` — gate behind score > 0.5 |
| 2 | Call `rebuildIndex` after `writeConsensusKnowledge` |
| 3 | Enforce 10-file cap in `writeConsensusKnowledge` |
| 4 | Add TTL check on compaction lock (expire after 60 seconds) |
| 5 | `require('fs')` in loop → use top-level import |
| 6 | Include consensus round timestamp in filename for idempotency |

---

## Testing

- Given `consensus_verified` signal → task importance increases
- Given `hallucination_caught` signal → task importance decreases
- Given multiple signals for same task → importance adjusts cumulatively
- Importance clamped to [0.1, 1.0]
- Signal for unknown taskId → silently skipped
- Lock file present → update skipped gracefully

---

## Effect

After this ships:
```
Agent produces high-quality finding → consensus confirms → task importance boosted →
  memory survives compaction longer → agent remembers what it did well

Agent hallucinates → consensus catches it → task importance reduced →
  memory compacted sooner → agent forgets bad patterns faster
```

The memory system becomes self-improving — quality rises, noise falls.
