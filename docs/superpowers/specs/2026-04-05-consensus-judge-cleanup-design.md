# Consensus Judge Cleanup — Design Spec

**Date:** 2026-04-05
**Status:** Approved

## Problem

The consensus pipeline has three verification layers, two of which are redundant:

1. **Cross-review** — agents check each other's findings (agree/disagree/unverified)
2. **Phase 3** (`verifyUnverified` in consensus-engine.ts:740) — Gemini re-checks UNVERIFIED findings via LLM call. Same model that produced the consensus.
3. **Orchestrator** (Claude) — verifies ALL remaining UNVERIFIED findings after `gossip_collect` with actual file access (grep/read). Mandatory per CLAUDE.md.

Phase 3 is a redundant middle layer. If cross-review already marked something UNVERIFIED, Phase 3 re-trying with the same Gemini LLM is unlikely to do better. The orchestrator with actual file access is what resolves them.

Additionally, **ConsensusJudge** (consensus-judge.ts) was designed as a separate verification of CONFIRMED findings, but only runs on all-relay rounds. When native agents are present (the norm), the code path in `collect.ts:182` bypasses ConsensusCoordinator entirely, so the judge never executes.

## Decision

**The orchestrator is the judge.** Remove Phase 3 and the consensus judge.

The cross-model diversity already exists:
- **Gemini** runs consensus synthesis and cross-review
- **Claude** (orchestrator) verifies findings with actual file access after consensus
- Cross-review agents already check each other's work before the report is returned

## Changes

### Remove Phase 3
- Delete `verifyUnverified()` from `consensus-engine.ts` (~170 lines, 740-912)
- Remove Phase 3 invocation from `run()` (line 118) and `synthesizeWithCrossReview()` (line 1576)
- Update `tests/orchestrator/consensus-e2e.test.ts:123` — `report.rounds` assertion

### Remove ConsensusJudge
- Delete `packages/orchestrator/src/consensus-judge.ts` (~140 lines)
- Delete judge instantiation from `apps/cli/src/mcp-server-sdk.ts` (lines 480-501)
- Delete judge integration from `packages/orchestrator/src/consensus-coordinator.ts` (lines 46-48 setter, 96-143 integration)
- Delete judge setter from `packages/orchestrator/src/dispatch-pipeline.ts` (line 876-878)
- Remove exports from `packages/orchestrator/src/index.ts` (lines 64-65: ConsensusJudge, IConsensusJudge, JudgeVerdict)
- Delete `tests/orchestrator/consensus-judge.test.ts` (~146 lines)
- Update stale comment in `tests/orchestrator/citation-verification.test.ts:201`
- Delete `NATIVE_JUDGE_DESIGN.md` from repo root (dead design doc)
- Remove `consensus_judge` config field handling from mcp-server-sdk.ts

### Cleanup
- Remove `verifyMs` timing variable from `consensus-engine.ts` (dead code, always 0 after Phase 3 removal)
- Remove `consensus_judge` config wiring at `mcp-server-sdk.ts:480-501` (untyped access, not in GossipConfig interface)

### Keep
- CLAUDE.md UNVERIFIED verification rules — these ARE the judge
- Cross-review flow — unchanged
- Signal recording — unchanged
- `gossip_collect` with `consensus: true` — unchanged

## Clarifications

**Phase 3 vs Judge:** These are different systems. Phase 3 verifies UNVERIFIED findings (promote → confirmed/disputed). The Judge verifies CONFIRMED findings (demote → disputed). Both are removed because:
- Phase 3: redundant with orchestrator verification, same model
- Judge: never runs with native agents (dead code path)

**Report changes:** Without Phase 3, the consensus report returned from `gossip_collect` will have more findings in the UNVERIFIED bucket. This is expected — the orchestrator verifies them immediately after with better tools (file access). The end result presented to the user is the same.

## Non-goals

- No new MCP tools
- No changes to the cross-review flow
- No changes to how the orchestrator verifies findings (already works)

## Impact

- ~500 lines of code removed (Phase 3 + Judge + tests)
- One fewer LLM call per consensus round (Phase 3 removal)
- Consensus rounds slightly faster (skip Phase 3 LLM call)
- More UNVERIFIED in raw report, but orchestrator resolves them before presenting
