# Auto-Dispatch for Implementation Tasks

**Date:** 2026-04-01
**Status:** Draft (revised after 2-agent spec review consensus)
**Consensus:** Architecture: 3-agent (sonnet-reviewer, gemini-reviewer, haiku-researcher). Spec review: 2-agent (sonnet-reviewer, gemini-reviewer)

## Problem

In new Claude Code sessions, the orchestrator (Claude) writes implementation code directly instead of dispatching through the gossipcat pipeline. This means:

- Agent memory is not written
- Performance signals are not recorded
- The dashboard misses activity
- No cross-review happens on code changes

The dispatch rules in `.claude/rules/gossipcat.md` are advisory text. Nothing enforces them. The orchestrator reads them and decides whether they apply — and for implementation tasks, it routinely decides they don't.

## Goal

Make the orchestrator a **coordinator by default** for implementation tasks. All non-trivial code changes should flow through `gossip_run` so that memory, signals, and dashboard tracking are captured automatically.

## Non-Goals

- Hard-blocking Edit/Write via PreToolUse hooks (deferred to v2 if rule compliance is low)
- Changing how reviews/consensus work (already enforced)
- Automatic dispatch without any user visibility (user should see what's being dispatched)

## Design

### Change 1: Auto-Dispatch Rule

Add to `.claude/rules/gossipcat.md`:

```markdown
## Auto-Dispatch Rule

**Precedence:** The existing Tier 1/2/3 dispatch rules take priority over auto-dispatch.
If a task matches a Tier 1 trigger (shared mutable state, auth, persistence, etc.), use
gossip_dispatch(mode: "consensus") as before. If it matches Tier 2, use gossip_run with
the appropriate reviewer. Auto-dispatch applies to implementation tasks that don't match
Tier 1 or Tier 2 triggers.

Before writing implementation code, call `gossip_run(agent_id: "auto", task: "<description>")`.

This applies when the user asks to implement, build, add, create, refactor, or fix any
non-trivial code change. The orchestrator's role is to coordinate — dispatch to agents,
verify results, record signals — not to implement directly.

**Exceptions (orchestrator may implement directly):**
- User includes `(direct)` in their message
- Change matches Tier 3 in the dispatch rules (docs, CSS, test additions, log strings)
- Change is under 10 lines with no side effects on shared state (existing `(quick-fix)` rules)
- Orchestrator is already executing inside a dispatched plan step (re-entrant context)

**Flow:**
1. User requests implementation
2. Orchestrator checks Tier 1/2 triggers first — if matched, follow existing dispatch rules
3. Otherwise, calls `gossip_run(agent_id: "auto", task: "<what user asked>")`
4. gossip_run classifies → single-agent or multi-agent
5. Single: selects best-fit agent via `AgentRegistry.findBestMatch()`, dispatches directly
6. Multi: calls gossip_plan, presents decomposition, dispatches on approval
7. Orchestrator collects results, verifies, records signals
```

### Change 2: Fast-Path Classifier in `gossip_run auto`

Current `gossip_run(agent_id: "auto")` calls `handleMessageDecompose` which is a **full executor** — it decomposes, assigns agents, executes subtasks on relay workers, and synthesizes results. It triggers 2 sequential LLM calls (`decompose` and `classifyWriteModes`; `assignAgents` is synchronous in-memory matching via `AgentRegistry`). For simple single-agent tasks, this adds 15-30 seconds of overhead — more than the implementation itself.

**Important:** The current `auto` mode returns a completed result, not a plan. The proposed change alters this contract: the "single" path still returns a result (via `gossip_run`), but the "multi" path returns task IDs for the caller to collect. This is an intentional contract change to give the orchestrator visibility into what's being dispatched before execution.

**Replace with a two-tier route:**

```
gossip_run(agent_id: "auto", task)
  │
  ├─ Step 1: Fast classifier (single LLM call, no tools, <5 output tokens)
  │    Input: task description + agent roster summary
  │    Output: "single" | "multi"
  │
  ├─ If "single":
  │    Select best-fit agent via AgentRegistry.findBestMatch(task, agentConfigs)
  │    (uses dispatch weights, skill matching, and task category affinity)
  │    Call gossip_run(agent_id: selected, task: task)
  │    Return result directly (~2-3s classifier overhead + agent execution time)
  │
  └─ If "multi":
       Call gossip_plan(task) for full decomposition
       Present plan to user for approval
       Dispatch via gossip_dispatch(mode: "parallel", tasks: plan.tasks)
       Return task IDs for collection
```

**Fast classifier prompt (embedded, not a tool call):**

```
Given this task and available agents, respond with ONLY "single" or "multi".

"single" = one agent can handle the entire task (clear scope, one concern, no conflicting file ownership)
"multi" = needs decomposition (multiple independent concerns, parallel workstreams, or unclear scope)

Task: {task}
Agents: {agent_id: role, skills — one line each}
```

This reduces single-agent overhead from ~30-60s to ~2-3s while preserving full planning for complex tasks.

### Change 3: Re-Entrant Guard

Prevent cascading dispatch when an agent executing a plan step triggers another `gossip_plan` call.

**Problem:** `gossip_plan`'s current Zod schema only accepts `task` and `strategy` — there is no `plan_id` parameter (that lives on `gossip_dispatch`). A naive `if (args.plan_id)` guard would never fire.

**Implementation:** Use an in-memory context flag instead of a schema parameter:

```typescript
// In mcp-server-sdk.ts context object
let planExecutionDepth = 0;

// In gossip_plan handler (~line 574)
if (planExecutionDepth > 0) {
  // Already inside a plan execution — don't re-decompose
  return { content: [{ type: 'text', text: 'Skipped: already inside a plan step. Execute the task directly.' }] };
}

// In gossip_dispatch handler, wrap execution:
planExecutionDepth++;
try { /* execute plan steps */ } finally { planExecutionDepth--; }
```

This avoids modifying `gossip_plan`'s public schema while catching re-entrant calls from agent prompts that contain implementation-like language.

### Change 4: Bootstrap Injection

Add the auto-dispatch rule to `generateRulesContent()` in `mcp-server-sdk.ts`. Note: `generateRulesContent()` is called by `gossip_setup`, not on every MCP boot. The generated rules are written to `.claude/rules/gossipcat.md` on disk and persist across sessions. This change ensures the rule is included whenever the rules file is regenerated (e.g., after adding/removing agents).

The primary persistence mechanism is Change 1 (direct edit to the rules file). This change ensures regeneration doesn't overwrite it.

**Location:** `apps/cli/src/mcp-server-sdk.ts` lines 52-173 (inside `generateRulesContent()`)

Add a section:

```
## Implementation Tasks — Auto-Dispatch

Check Tier 1/2 triggers first. If no match, call gossip_run(agent_id: "auto", task: "<description>")
BEFORE writing any code. Exceptions: (direct) in message, Tier 3 changes, or already
inside a plan step.

gossip_run auto will classify single vs multi and route appropriately.
```

## File Changes

| File | Change |
|------|--------|
| `.claude/rules/gossipcat.md` | Add Auto-Dispatch Rule section; update "single agent is fine for" to exclude "simple implementations" |
| `apps/cli/src/mcp-server-sdk.ts` | Add rule to `generateRulesContent()` (~line 52) |
| `apps/cli/src/mcp-server-sdk.ts` | Replace `auto` mode full executor with fast classifier + routing (~line 1102) |
| `apps/cli/src/mcp-server-sdk.ts` | Add `planExecutionDepth` re-entrant guard around `gossip_dispatch` execution |
| `packages/orchestrator/src/main-agent.ts` | Add `classifyTaskComplexity()` method for fast single/multi classification |
| `packages/orchestrator/src/agent-registry.ts` | Expose `findBestMatch()` for agent selection after "single" classification |

## Latency Budget

| Path | Before | After |
|------|--------|-------|
| Single-agent task via `gossip_run auto` | ~15-30s (full executor: 2 LLM calls + execution) | ~2-3s classifier + agent execution time |
| Multi-agent task via `gossip_run auto` | ~15-30s (full executor) | ~15-30s (unchanged — full gossip_plan) |
| Tier 3 / `(direct)` bypass | 0s | 0s (unchanged) |

## Escape Hatches

| Mechanism | When to Use |
|-----------|-------------|
| `(direct)` in user message | User explicitly wants orchestrator to implement |
| `(quick-fix)` in commit message | Diff under 10 lines, no shared state, test coverage exists |
| Tier 3 match | Docs, CSS, tests, log strings — auto-detected |
| Inside plan step | Already dispatched — execute directly, don't re-plan |

## v2 Considerations (Deferred)

If rule compliance is low after shipping v1:

- **PreToolUse hook:** Block Edit/Write on `.ts` files if no `gossip_run`/`gossip_plan` was called this session. Return `permissionDecision: "deny"` with message instructing dispatch.
- **Session-level tracking:** Write a `.gossip/dispatch-log.json` on every `gossip_run`/`gossip_plan` call. PreToolUse hook reads it to verify dispatch happened.
- **Compliance metrics:** Track how often the orchestrator writes code directly vs dispatching. Surface in dashboard.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Latency frustration on simple tasks | High | Fast-path classifier reduces to ~2-3s |
| False positive dispatch on trivial edits | Medium | Tier 3 exceptions + `(direct)` escape |
| Re-entrant dispatch loops | Medium | plan_id guard in gossip_plan |
| Rule ignored by new sessions | Medium | Dual injection: rules file + generateRulesContent() |
| Fast classifier misclassifies multi as single | Low | Agent handles it anyway; just less optimally decomposed |

## Success Criteria

- Majority of implementation tasks flow through `gossip_run` (vs current ~20%). Exact measurement deferred to v2 dispatch-log.
- No increase in user complaints about latency
- Dashboard shows activity for implementation tasks that were previously invisible
- Agent memory entries are written for all dispatched tasks
