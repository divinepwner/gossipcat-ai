# Reducing UNVERIFIED Findings in Consensus Engine

**Date:** 2026-04-01
**Status:** Draft (co-designed with sonnet-reviewer + gemini-reviewer)
**Supersedes:** `2026-04-01-process-findings-design.md` (rejected — overengineered engine-level classification)

## Problem

80% of UNVERIFIED findings in the consensus engine are preventable:

| Category | % | Root Cause |
|----------|---|-----------|
| No code anchor | 60% | Agent makes factual claim about code but provides no file:line |
| Subjective assessment | 20% | Opinion/recommendation — not a verifiable fact |
| Incorrect/stale anchor | 15% | Line number wrong, blank line, file moved |
| System/process meta-claim | 5% | Observation about review process, not codebase |

The cross-review agent correctly says "I cannot verify this" for all four categories. The findings clutter the dashboard as UNVERIFIED when they should either have anchors (60%), be classified differently (20%), be flagged as invalid (15%), or be labeled as insights (5%).

## Goal

Reduce UNVERIFIED findings by 75%+ through:
1. Requiring code anchors for factual claims (prompt + confidence downgrade)
2. Adding a `suggestion` finding type for non-factual observations
3. Validating anchors before cross-review
4. Labeling process observations as `INSIGHT`

## Non-Goals

- Rejecting findings (DOWNGRADE, not REJECT — structural findings without line numbers are valid)
- Changing the CONFIRMED/DISPUTED flow (working correctly)
- Building a separate process-findings subsystem (too complex for the value)

## Design

### Batch 1: Anchor Enforcement + Validation (ships first, targets 75%)

#### Change 1A: Downgrade Anchorless Factual Findings

In `consensus-engine.ts`, within the `synthesize()` seeding loop (~line 254-270), detect whether a finding has a `file:line` citation. If not, pre-seed its confidence to 2 (low) instead of the default.

```typescript
// In the for(const line of lines) loop inside synthesize()
const hasAnchor = /[\w.-]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|md|json|yaml|yml|toml|sh):\d+/.test(finding);
findingMap.set(key, {
  originalAgentId: r.agentId,
  finding,
  confirmedBy: [],
  disputedBy: [],
  unverifiedBy: [],
  confidences: hasAnchor ? [] : [2], // pre-load low confidence for anchorless
});
```

This drags down UNVERIFIED findings' average confidence without deleting them. Structural findings ("no error boundary in this module") survive but rank lower than anchored findings.

**Why DOWNGRADE over REJECT:** Some legitimate findings are structural and can't be pinpointed to a single line. Dropping them silently wastes real signal. The UNVERIFIED bucket already makes them second-class — downgrading confidence reinforces that.

**Citation regex note:** The regex restricts to known source extensions (`.ts`, `.js`, `.py`, etc.) to avoid false matches on `node:18`, `http://host:443`, or YAML `version: 1`. The existing `citationPattern` at lines 553, 722, 779 matches these false positives — this is a pre-existing issue that should be fixed in those locations too.

#### Change 1B: Surface Invalid Anchors

In `snippetsForFinding()` (~line 747-757), when a citation fails to resolve (file not found, line out of range, or line is blank/comment-only), emit a warning instead of silently dropping:

```typescript
// In snippetsForFinding, when resolution fails
anchors.push(`⚠ Agent cited \`${safeRef}:${lineNum}\` but ${reason}`);
// where reason is: "file not found", "line out of range (file has N lines)", or "line is blank"
```

Add to the cross-review system prompt (~line 209-219):

```
- ⚠ warnings mean the citation is unresolvable. Mark as UNVERIFIED; do NOT agree.
```

Also add a blank-line check — line 747 currently checks bounds but not content:

```typescript
if (fileLines[lineNum - 1].trim() === '' || fileLines[lineNum - 1].trim().startsWith('//')) {
  // Blank or comment-only line — anchor is invalid
}
```

#### Change 1C: Phase 1 Agent Prompt Addition

Add to the agent system prompt that feeds Phase 1 reviews (outside `consensus-engine.ts` — this is in the prompt assembly for review tasks):

```
Every factual claim about code MUST include a code anchor:
  `path/to/file.ts:line` — e.g., `packages/relay/src/server.ts:47`

Claims without a file:line citation cannot be verified by peer reviewers and will
receive low confidence. Subjective recommendations do NOT need anchors — but factual
assertions (missing validation, wrong type, race condition, etc.) always do.
```

### Batch 2: Finding Type Classification (ships second, targets 20%)

#### Change 2A: Add `findingType` to `ConsensusFinding`

In `consensus-types.ts` (~line 2-18), add:

```typescript
export interface ConsensusFinding {
  // existing fields...
  findingType?: 'finding' | 'suggestion' | 'insight';
}
```

Default: `'finding'` (backward compatible).

#### Change 2B: Agent Tagging Protocol

Agents tag their findings with a prefix:

```
- [FINDING] `auth.ts:47` — token comparison uses string equality, not timingSafeEqual
- [SUGGESTION] Consider extracting the retry logic into a shared utility
- [INSIGHT] Signal recording latency increased this session — check relay performance
```

Add to Phase 1 agent prompt:

```
Tag each finding:
  [FINDING] — factual, verifiable against code (requires file:line anchor)
  [SUGGESTION] — recommendation or design idea (no anchor needed)
  [INSIGHT] — observation about system behavior or review process (no anchor needed)

Default is [FINDING] if no tag is provided.
```

#### Change 2C: Parse and Route in `synthesize()`

In the synthesize seeding loop (~line 254-270):

```typescript
const tagMatch = finding.match(/^\[(FINDING|SUGGESTION|INSIGHT)\]\s*/i);
const findingType = tagMatch ? tagMatch[1].toLowerCase() as 'finding' | 'suggestion' | 'insight' : 'finding';
const cleanFinding = finding.replace(/^\[(FINDING|SUGGESTION|INSIGHT)\]\s*/i, '').trim();
```

**Critical:** Strip the tag BEFORE inserting into `findingMap`. The `findMatchingFinding` function (~line 907) normalizes by stripping punctuation (`replace(/[^\w\s]/g, '')`), which removes `[]` brackets. If the tag survives into the map key, matching will break.

#### Change 2D: Route Suggestions/Insights Away from Cross-Review

In the tagging loop (~line 491), before the UNVERIFIED branch:

```typescript
if (findingType === 'suggestion' || findingType === 'insight') {
  // Route to insights array, not unverified
  report.insights = report.insights || [];
  report.insights.push(entry);
  continue; // skip UNVERIFIED tagging
}
```

Suggestions and insights still appear on the dashboard but with an `INSIGHT` badge, not `UNVERIFIED`. They remain in cross-review — peers can still AGREE/DISAGREE with the idea's merit, but are told not to demand code anchors.

Add to cross-review prompt:

```
For findings tagged [SUGGESTION] or [INSIGHT]: evaluate the idea's merit, not factual accuracy.
You may AGREE (good suggestion) or note it without judgment. Do not mark UNVERIFIED.
```

### Batch 3: Fix 4 — INSIGHT Badge (free with Batch 2)

Process meta-findings (5%) are handled by agents tagging them `[INSIGHT]`. No separate regex detection needed — the agent prompt in Batch 2 teaches agents when to use `[INSIGHT]`. The dashboard renders them with a distinct badge.

## File Changes

| File | Change | Batch |
|------|--------|-------|
| `packages/orchestrator/src/consensus-engine.ts:254-270` | Anchor detection + confidence pre-seeding in synthesize | 1 |
| `packages/orchestrator/src/consensus-engine.ts:747-757` | Surface invalid anchors in snippetsForFinding | 1 |
| `packages/orchestrator/src/consensus-engine.ts:209-219` | Cross-review prompt: anchor warning instruction | 1 |
| Phase 1 agent prompts (prompt-assembler or dispatch) | Require file:line for factual claims | 1 |
| `packages/orchestrator/src/consensus-types.ts:2-18` | Add `findingType` to ConsensusFinding | 2 |
| `packages/orchestrator/src/consensus-engine.ts:254-270` | Parse [FINDING]/[SUGGESTION]/[INSIGHT] tags, strip before map | 2 |
| `packages/orchestrator/src/consensus-engine.ts:491` | Route suggestions/insights to separate array | 2 |
| `packages/orchestrator/src/consensus-engine.ts:1003` | formatReport: add INSIGHT section | 2 |
| Dashboard consensus view | Render INSIGHT badge, filter toggle | 2 |

## Ship Order

| Batch | Impact | Effort | Risk |
|-------|--------|--------|------|
| **Batch 1:** Anchor enforcement + validation | 75% reduction | ~20 lines + prompt | Low |
| **Batch 2:** Finding type classification | 20% reduction | Type change + tagging + prompt | Medium |
| **Batch 3:** INSIGHT badge | 5% reduction | Free with Batch 2 | None |

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Structural findings downgraded unfairly | Medium | DOWNGRADE not REJECT — still visible, just lower confidence |
| Agents misuse [SUGGESTION] to soften real findings | Medium | Cross-review still verifies [FINDING] tags; misuse is detectable |
| Citation regex false positives (node:18, http:443) | Low | Restricted to known source extensions |
| Tag stripped by findMatchingFinding normalization | High | Strip tag BEFORE inserting into findingMap — explicit in spec |

## Success Criteria

- UNVERIFIED findings reduced by 75%+ after Batch 1
- Remaining UNVERIFIED findings are genuinely ambiguous (not anchorless or subjective)
- Suggestions/insights visible on dashboard with distinct badge after Batch 2
- Cross-review tokens reduced (fewer unverifiable findings sent to peers)
- No regression in CONFIRMED/DISPUTED finding quality
