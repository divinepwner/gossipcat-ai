# Process Findings: Meta-Finding Classification in Consensus Engine

**Date:** 2026-04-01
**Status:** Draft
**Origin:** Signal quality audit revealed 11 UNVERIFIED findings that were process observations (signal misclassification, scoring assessments, review quality metrics) — unverifiable by code inspection.

## Problem

The consensus cross-review engine treats all findings identically — it tries to verify each one by checking code anchors. But there are two categories of findings:

- **Code findings:** "Bug at file:line" — verifiable by reading code
- **Process findings:** "Signal was misclassified", "review quality 7/10", "agent accuracy is low" — observations about the gossipcat review process itself, not the codebase

Process findings have no code anchors. The cross-review agent correctly reports "This refers to a dispute within the review process, not the code itself. No code anchor is provided." They will always end up UNVERIFIED, cluttering the dashboard with findings that only the orchestrator can resolve.

**Evidence:** In a single session audit, 11 out of 11 cross-review findings from a signal quality audit were UNVERIFIED because they were process observations.

## Goal

Classify findings as `code` or `process` at creation time. Handle them differently in cross-review and dashboard display so process findings don't create false UNVERIFIED noise.

## Non-Goals

- Changing how code findings work (the existing flow is correct)
- Auto-resolving code findings (those still need agent verification)
- Removing process findings from the system (they're valuable, just need different handling)

## Design

### Change 1: Finding Category Field

Add an optional `category` field to findings in the consensus engine.

```typescript
interface Finding {
  // existing fields...
  agent_id: string;
  finding: string;
  confidence: number;
  anchor?: string;      // file:line reference
  // new field
  category?: 'code' | 'process';
}
```

Default: `'code'` (backward compatible — all existing findings are code findings).

### Change 2: Auto-Detection of Process Findings

When the consensus engine receives findings from agents, classify them before cross-review:

**A finding is `process` if ANY of these are true:**
- No code anchor (`anchor` is empty/undefined) AND the finding text matches process keywords
- The finding references review system concepts: signal, scoring, accuracy, hallucination, consensus, dispatch weight, memory importance, agent performance

**Process keyword patterns:**
```typescript
const PROCESS_PATTERNS = [
  /signal.*misclassif|misclassif.*signal/i,
  /scoring.*distort|dispatch.*weight/i,
  /accuracy.*\d+\.\d+|uniqueness.*\d+\.\d+/i,
  /review.*quality|quality.*score.*\d+\/\d+/i,
  /hallucination.*caught|caught.*hallucination/i,
  /unique_confirmed.*count|inflated.*count/i,
  /non-standard.*signal|signal.*type/i,
  /agent.*performance|performance.*metric/i,
  /consensus.*run|cross-review.*round/i,
  /false positive rate/i,
];
```

This runs once at finding ingestion, not during cross-review. The category is stored with the finding.

### Change 3: Skip Cross-Review for Process Findings

In the consensus cross-review round, process findings are excluded from the verification prompt sent to peer agents. They are tagged `PROCESS` instead of going through the CONFIRMED/DISPUTED/UNVERIFIED flow.

```
Cross-review prompt (existing):
  "Verify these peer findings against the code: [code findings only]"

Process findings bypass:
  Tagged as PROCESS — orchestrator resolves these manually
```

The cross-review round is faster because it doesn't waste tokens asking agents to verify things they can't verify.

### Change 4: Dashboard Display

Process findings appear on the dashboard with a distinct `PROCESS` badge instead of `UNVERIFIED`. They are visually separated from code findings.

| Badge | Meaning | Who Resolves |
|-------|---------|-------------|
| CONFIRMED | Multiple agents agree, code-verified | Automatic |
| DISPUTED | Agents disagree | Orchestrator reviews |
| UNVERIFIED | Only one agent found it, peers couldn't verify | Orchestrator verifies against code |
| PROCESS | Meta-finding about review system | Orchestrator resolves manually |
| UNIQUE | One agent only | Orchestrator verifies |

## File Changes

| File | Change |
|------|--------|
| `packages/orchestrator/src/consensus-engine.ts` | Add `category` to Finding type, add `classifyFinding()` function, filter process findings from cross-review prompt |
| `packages/orchestrator/src/types.ts` | Add `category?: 'code' \| 'process'` to finding-related types |
| `packages/dashboard-v2/src/components/ConsensusView.tsx` | Render `PROCESS` badge, separate process findings visually |
| `tests/orchestrator/consensus-engine.test.ts` | Tests for finding classification |

## Backward Compatibility

- `category` is optional, defaults to `'code'`
- Existing findings without `category` are treated as code findings
- No migration needed — only new findings get classified

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| False positive process classification (code finding tagged as process) | Medium | Conservative keyword matching, require BOTH no-anchor AND keyword match |
| Process findings never reviewed | Low | Orchestrator is responsible; dashboard shows them prominently |
| Keyword list incomplete | Low | Can be extended; false negatives just stay as UNVERIFIED (existing behavior) |

## Success Criteria

- Process findings from signal quality audits get `PROCESS` badge, not `UNVERIFIED`
- Cross-review round doesn't waste tokens on unverifiable findings
- Code findings continue working exactly as before
- Dashboard clearly distinguishes process vs code findings
