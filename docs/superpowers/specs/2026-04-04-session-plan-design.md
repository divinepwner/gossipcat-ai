# Session 2026-04-04 — Design Spec

Five work items in dependency order: dead code audit → dispatch-pipeline refactor → paginated reports → progress tool → implementation agents activation.

> **Reviewed by 3-agent consensus** (sonnet-reviewer, haiku-researcher, gemini-reviewer).
> 11 confirmed findings, 10 spec corrections applied. See consensus report `c7216911-234d41fd`.

---

## Item 1: Dead Code Audit

**Scope:** Remove `export` keyword from 6 type exports that are only used internally.

| File | Types | Action |
|------|-------|--------|
| `packages/relay/src/channels.ts` | `SubscribeResult`, `UnsubscribeResult`, `BroadcastResult` | Remove `export` keyword |
| `packages/relay/src/presence.ts` | `PresenceStatus`, `PresenceEntry`, `PresenceConfig` | Remove `export` keyword |

- Agent-verified: zero imports across entire codebase, no barrel re-exports
- Types remain for internal use — only the `export` is removed
- `PresenceStatus` type alias (presence.ts) does not conflict with `PresenceStatus` enum (protocol.ts) — different files, different scopes
- Verify: `tsc --noEmit` after removal

**Effort:** 30 min | **Tier:** 3 (self-review + tests)

---

## Item 2: dispatch-pipeline.ts Refactor

**Goal:** 1226 lines → ~750 lines. Extract two domain modules with clean boundaries.

### Extract 1: `consensus-coordinator.ts` (~350 lines)

> **Name:** `ConsensusCoordinator` (not `ConsensusOrchestrator` — avoids confusion with existing `ConsensusEngine`).

**Moves from DispatchPipeline:**
- `runConsensus()` and all consensus-related private helpers
- Judge integration and signal pipeline
- Consensus history tracking (`sessionConsensusHistory`)

**Constructor dependencies** (corrected per consensus — these are what `runConsensus` actually uses):
- `ILLMProvider` (for LLM calls)
- `registryGet` function (agent config lookup)
- `projectRoot` string
- `keyProvider` (API key resolution)
- `IConsensusJudge` (optional, set via setter)
- `GossipPublisher` (optional, set via setter)

> **Consensus correction:** Spec originally listed `ConsensusEngine` and `PerformanceWriter` as constructor deps, but `runConsensus` constructs them inline at :915-917. The extracted class receives the raw ingredients, not pre-built instances.

**Interface:** DispatchPipeline holds a `ConsensusCoordinator` instance and delegates `runConsensus()` calls to it.

### Extract 2: `session-context.ts` (~120 lines)

**Moves from DispatchPipeline:**
- `registerPlan()`, `getChainContext()`, `recordPlanStepResult()`
- `getSessionConsensusHistory()`, `getSessionStartTime()`, `getSessionGossip()`
- `getSkillGapSuggestions()`, `suppressSkillGapAlert()`, `getSkeletonMessages()`
- `summarizeAndStoreGossip()`, `summarizeForSession()`, `rotateJsonlFile()`
- **`sessionGossip` array** (ownership moves to SessionContext)

> **Consensus correction:** `summarizeAndStoreGossip` is called from `collect()` at :475, which stays in DispatchPipeline. The `sessionGossip` array must move to `SessionContext` so `DispatchPipeline.collect()` delegates via `this.sessionContext.summarizeAndStoreGossip(...)`. One-directional dependency: DispatchPipeline → SessionContext. No back-references.

**Constructor dependencies:**
- `ILLMProvider` (for summarization)
- Project root path

> **Consensus correction:** `SkillIndex` and `SkillCounterTracker` stay on DispatchPipeline (not SessionContext). They are exposed via public getters consumed by `mcp-server-sdk`. Moving them would create unnecessary delegation. `SkillGapTracker` also stays — `getSkillGapSuggestions` can access it via a passed reference rather than owning it.

### What stays in DispatchPipeline (~750 lines)

- Task execution: `dispatch()`, `getTask()`, `cancelRunningTasks()`, `getActiveTasksHealth()`
- Collection: `collect()`, `dispatchParallel()`
- Write-mode cleanup: worktree merge, scope release, sequential queue handling
- DI setters: wire ConsensusCoordinator + SessionContext dependencies
- `_postTaskComplete()`: shared pipeline (TaskGraph + memory)
- Skill index/counter getters and setters

### Test strategy

> **Consensus correction:** Tests at `dispatch-pipeline.test.ts:340` and `dispatch-pipeline-gossip.test.ts:87` directly call `pipeline.runConsensus()` and `pipeline.registerPlan()`. These must remain as **delegating methods** on DispatchPipeline so existing tests pass unchanged. The extracted classes are internal implementation details — tests interact through DispatchPipeline's public API.

### Constraints

- No circular imports — extracted classes receive deps via constructor, not back-references
- Existing tests continue to pass — delegating stubs on DispatchPipeline preserve the public API
- `DispatchPipeline` remains the public API; extracted classes are internal

**Effort:** 2-3 hours | **Tier:** 1 (touches core dispatch pipeline)

---

## Item 3: Paginated Consensus Reports

### API (`packages/relay/src/dashboard/routes.ts`)

`getConsensusReports()` changes:
- Accept `page` (default 1) and `pageSize` (default 5, max 20) query params
- Return `{ reports: [...], totalReports: number, page: number, pageSize: number }`
- Remove hardcoded `.slice(0, 20)` at line 290
- Mirror pagination pattern from `api-consensus.ts`

### Dashboard (`packages/dashboard-v2/src/`)

- FindingsMetrics: show page 1 by default
- Add "Load older reports" button at bottom of reports list
- Update fetch hook to pass `page` query param
- Increment page on button click, append results

### Not changing

- No archive folder changes — pagination replaces the need for archiving
- No infinite scroll — explicit "Load older" button

**Effort:** 1-2 hours | **Tier:** 2 (dashboard API handler)

---

## Item 4: `gossip_progress()` Tool

### MCP tool registration (`mcp-server-sdk.ts`)

New tool: `gossip_progress()` — no required params.

> **Post-registration:** Add to hardcoded tools list in `gossip_tools` handler at mcp-server-sdk.ts:2019 (not auto-discovered). Also update `.gossip/bootstrap.md` tool table.

### Response shape (corrected per consensus)

```typescript
{
  activeTasks: [{
    taskId: string,
    agentId: string,
    elapsedMs: number,       // raw ms — formatting done by consumer
    toolCalls: number,
    status: "running" | "likely_stuck"
  }],
  consensus: {               // if consensus is in progress
    phase: "review" | "cross_review" | "synthesis",
    tasksComplete: number,
    tasksTotal: number,
    elapsedMs: number
  } | null
}
```

> **Consensus corrections:**
> - Removed `tokens` field — `getActiveTasksHealth` doesn't include it; adding requires modifying the return shape (minor enhancement, not "just exposure")
> - Removed `currentTool` field — **does not exist anywhere** in TaskEntry or stream processing. Would require new tracking in the worker agent progress loop. Deferred to a follow-up.
> - Changed `elapsed` from formatted string to raw `elapsedMs` — matches existing return shape, consumer formats

### Data sources

- `getActiveTasksHealth()` at `dispatch-pipeline.ts:365` — returns `id`, `agentId`, `task`, `status`, `elapsedMs`, `toolCalls`, `isLikelyStuck`
- Consensus phase: add a `currentPhase` field to `ConsensusCoordinator` (from item 2) that tracks review/cross_review/synthesis

### Follow-up enhancements (not this session)

- Add `tokens` to `getActiveTasksHealth` (pull from TaskEntry.inputTokens/outputTokens)
- Add `currentTool` tracking to worker agent stream processing
- Formatted elapsed string helper

**Effort:** 1-2 hours | **Tier:** 2 (new MCP tool)

> **Dependency:** Consensus phase tracking requires `ConsensusCoordinator` from item 2. Item 4 runs **after** item 2, not parallel with item 3.

---

## Item 5: Implementation Agents Activation

**Goal:** Make existing write-mode machinery usable by removing artificial constraints.

### Change 1: Fix task decomposition prompt

**File:** `packages/orchestrator/src/task-dispatcher.ts`

- Remove "Implementation is always ONE task" constraint at line 37
- **Also update** "2-3 tasks max" constraint at line 44 → change to "3-5 tasks max"
- New guidance: decompose by file/module scope, each task gets a non-overlapping directory scope

> **Consensus correction:** Both constraints must be updated together — the 2-3 cap at :44 would conflict with the spec's 3-5 target if only the ONE task rule is removed.

### Change 2: Dedicated verification tools (NOT a shell allowlist)

**File:** `packages/tools/src/tool-server.ts`

> **Consensus correction (CRITICAL):** The original spec proposed a shell_exec allowlist for jest/tsc/npm test/git status/git diff. **This is a command injection vector.** Scoped agents have `file_write` access — they could write a malicious `package.json` (scripts.test), `jest.config.js` (--config), or `tsconfig.json` (plugin) that executes arbitrary code when the "safe" command runs.

**Instead:** Create two dedicated sandboxed tools:
- `run_tests` — invokes `jest` with locked-down config: `--config` flag ignored, uses project root jest.config only, accepts only a file glob for test scope
- `run_typecheck` — invokes `tsc --noEmit` on the project, ignores agent-writable tsconfig plugins

Read-only commands (`git status`, `git diff`) can stay as a minimal allowlist since they don't execute user-controlled config.

> **Also address git commit gate:** Scoped agents are blocked from `git_commit` at tool-server.ts:192-196. This is correct behavior — the orchestrator commits on behalf of scoped agents. Worktree agents can already commit (line 197). No change needed here, but document the contract: scoped agents write files, orchestrator commits.

### Change 3: ~~Default to worktree for multi-file changes~~ REMOVED

> **Consensus correction:** The spec originally cited `classifyWriteModes.ts (~line 154)` for a worktree restriction on parallel plans. **This file does not exist.** The actual constraint at `dispatch-pipeline.ts:649-650` blocks **sequential** mode in parallel dispatch, not worktree. Worktree is already allowed. Change 3 is invalid and removed.

### Change 4: Re-dispatch on failure

- No complex step resumption logic
- If a step fails or times out: orchestrator re-dispatches (same task, same or next-best agent)
- Signal recording: `hallucination_caught` if agent output broke build, `disagreement` if timeout

### Not building

- No mid-task clarification mechanism
- No transaction semantics beyond worktree branches
- No implementation quality signals (future scoring enhancement)
- No `currentTool` tracking (deferred from Item 4)

**Effort:** 2-3 hours | **Tier:** 1 (touches dispatch pipeline + tool server)

---

## Session Order (corrected)

| Step | Item | Effort | Notes |
|------|------|--------|-------|
| 1 | Dead code audit | 30 min | Independent |
| 2 | dispatch-pipeline refactor | 2-3 hrs | Unblocks steps 3-4 |
| 3 | Paginated consensus reports | 1-2 hrs | Independent of step 4 |
| 4 | gossip_progress() tool | 1-2 hrs | **After step 2** (needs ConsensusCoordinator) |
| 5 | Implementation agents activation | 2-3 hrs | After step 2 (touches dispatch-pipeline) |

> **Consensus correction:** Items 3 and 4 are **not** parallelizable. Item 4 depends on item 2's ConsensusCoordinator for phase tracking. Item 3 is the only step that can run independently after step 2.
