# Cross-Review Context Fix — Per-Finding Snippet Extraction

**Date:** 2026-03-30
**Status:** Draft — pending opus review
**Consensus:** 2/2 Claude agents agreed re-dispatch is wrong lever. Root cause is context starvation.

## Problem

52% of consensus findings are tagged UNVERIFIED. The cross-review LLM correctly says "I can't verify this" because it literally can't see the code — the global 5-snippet cap means most findings arrive in the prompt with zero code context.

**Root cause:** `extractCodeSnippets()` at `consensus-engine.ts:468-502` is called once on the entire blob of all peer findings (`peerLines.join('\n')`). All file:line citations across all peer findings compete for 5 slots. With 3 agents producing 5-10 findings each, most findings get no snippets.

**Why re-dispatch won't work:** A 4th agent faces the same 5-snippet cap. Same context gap = same UNVERIFIED result.

## Fix: Per-Finding Snippet Extraction

### Change 1: Extract snippets per finding, not per blob

**Current flow** (consensus-engine.ts:121-128):
```
peerLines = all peer findings concatenated
snippets = extractCodeSnippets(peerLines.join('\n'))  // 5 global cap
codeContext = one big REFERENCED CODE block
```

**New flow:**
```
for each peer finding:
  snippets = extractCodeSnippets(finding_text, cap=3)
  inline the snippets right after the finding text
```

This means each finding gets its own code context (up to 3 snippets), and the LLM sees the code directly next to the claim it needs to verify.

### Change 2: Modify extractCodeSnippets to accept a cap parameter

`extractCodeSnippets(text: string, maxSnippets = 5)` — change the hardcoded `5` at line 498 to use the parameter. When called per-finding, pass `3`. This keeps the function backward-compatible.

### Change 3: Inline snippets in peer findings section

Instead of one big `REFERENCED CODE` block at the end of the prompt, embed snippets after each finding:

```
Agent "gemini-reviewer" (reviewer):
<data>Finding: Race condition in dispatch-pipeline.ts:142...</data>
<code>
dispatch-pipeline.ts:142:
  140:     const result = taskMap.get(id);
  141:     if (!result) return;
  142:     await processTask(result);  // ← not locked
  143:     taskMap.delete(id);
</code>

Agent "haiku-researcher" (researcher):
<data>Finding: No input validation in memory-writer.ts:89...</data>
<code>
memory-writer.ts:89:
  87:   writeMemory(agentId: string, content: string) {
  88:     const path = join(this.dir, agentId, 'memory.md');
  89:     writeFileSync(path, content);  // ← no sanitization
  90:   }
</code>
```

### Change 4: Fix findMatchingFinding paraphrase gap

Add a Tier 0 before exact match that normalizes both strings:

```typescript
// Tier 0: Normalized match (lowercase, strip punctuation, collapse whitespace)
const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
const normalizedText = normalize(findingText);
for (const [key, entry] of findingMap) {
  if (entry.originalAgentId !== peerAgentId) continue;
  if (normalize(entry.finding) === normalizedText) return key;
}
```

This catches paraphrasing where the LLM preserves the words but changes punctuation/casing.

## Files to Change

| File | Change |
|------|--------|
| `packages/orchestrator/src/consensus-engine.ts` | Per-finding snippet extraction, inline code context, extractCodeSnippets cap parameter, findMatchingFinding Tier 0 |

## What This Does NOT Change

- The `UNVERIFIED` action in the prompt stays — it's the correct escape hatch when context is genuinely insufficient
- Findings without any file:line references still get no snippets (future improvement: identifier search)
- The tagging logic (confirmed/disputed/unverified/unique) is unchanged
- Signal generation is unchanged

## Expected Impact

- Findings with file:line citations get code context 100% of the time (was ~30% with global 5-cap)
- LLM can verify/refute claims against actual code instead of defaulting to UNVERIFIED
- UNVERIFIED rate should drop from ~52% to ~15-20% (remaining: findings without citations, genuinely vague claims)
- Prompt size increases ~200-400 tokens per finding with snippets (acceptable)

## Test Plan

- Cross-review with 3 agents, 5 findings each with file:line citations → all findings get code snippets
- Finding without file:line reference → no snippet, no crash
- extractCodeSnippets with cap=3 → returns max 3 snippets
- findMatchingFinding matches "Race condition at line 142" against "Race condition at line 142." (trailing period)
- Run existing consensus-e2e test suite
