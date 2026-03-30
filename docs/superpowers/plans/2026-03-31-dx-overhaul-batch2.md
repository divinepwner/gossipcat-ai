# DX Overhaul — Batch 2: Tool Consolidation (27 → 12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate 27 MCP tools into 12 (8 core + 4 power-user) with dual-mode deprecation wrappers for backward compatibility.

**Architecture:** All tools are in `apps/cli/src/mcp-server-sdk.ts`. Each merge task: (1) write the unified handler, (2) convert old tools to thin wrappers, (3) update gossip_tools listing. Bootstrap and dispatch rules updated in final task.

**Tech Stack:** TypeScript, Zod schemas, MCP SDK

**Spec:** `docs/superpowers/specs/2026-03-31-dx-overhaul-design.md` (Batch 2)

---

## Tool Registration Map (current)

| # | Tool | Line | Fate |
|---|------|------|------|
| 1 | `gossip_orchestrate` | 649 | → merge into `gossip_run` (agent_id: "auto") |
| 2 | `gossip_plan` | 667 | keep |
| 3 | `gossip_dispatch` | 801 | → deprecated wrapper for `gossip_dispatch` unified |
| 4 | `gossip_dispatch_parallel` | 895 | → deprecated wrapper for `gossip_dispatch(mode: "parallel")` |
| 5 | `gossip_collect` | 979 | keep as unified `gossip_collect` |
| 6 | `gossip_dispatch_consensus` | 1150 | → deprecated wrapper for `gossip_dispatch(mode: "consensus")` |
| 7 | `gossip_collect_consensus` | 1228 | → deprecated wrapper for `gossip_collect(consensus: true)` |
| 8 | `gossip_agents` | 1332 | → deprecated wrapper for `gossip_status` |
| 9 | `gossip_status` | 1376 | → merge with agents into unified `gossip_status` |
| 10 | `gossip_update_instructions` | 1400 | → deprecated wrapper for `gossip_setup(mode: "update_instructions")` |
| 11 | `gossip_bootstrap` | 1471 | remove (auto-called) |
| 12 | `gossip_setup` | 1488 | keep + absorb update_instructions |
| 13 | `gossip_relay_result` | 1682 | → deprecated wrapper for `gossip_relay` |
| 14 | `gossip_run` | 1774 | keep + absorb orchestrate |
| 15 | `gossip_run_complete` | 1850 | → deprecated wrapper for `gossip_relay` |
| 16 | `gossip_record_signals` | 1929 | → merge into `gossip_signals` |
| 17 | `gossip_retract_signal` | 2002 | → merge into `gossip_signals(action: "retract")` |
| 18 | `gossip_scores` | 2034 | keep |
| 19 | `gossip_log_finding` | 2068 | remove |
| 20 | `gossip_findings` | 2135 | remove |
| 21 | `gossip_build_skills` | 2200 | → merge into `gossip_skills(action: "build")` |
| 22 | `gossip_develop_skill` | 2294 | → merge into `gossip_skills(action: "develop")` |
| 23 | `gossip_skill_index` | 2336 | → merge into `gossip_skills(action: "list")` |
| 24 | `gossip_skill_bind` | 2361 | → merge into `gossip_skills(action: "bind")` |
| 25 | `gossip_skill_unbind` | 2385 | → merge into `gossip_skills(action: "unbind")` |
| 26 | `gossip_session_save` | 2407 | keep |
| 27 | `gossip_tools` | 2508 | keep (update listing) |

## Deprecation Helper

All deprecated wrappers share the same pattern. Define this once at module level:

```ts
const deprecatedTools = new Set<string>();
function deprecationWarning(oldName: string, newName: string): void {
  if (!deprecatedTools.has(oldName)) {
    deprecatedTools.add(oldName);
    process.stderr.write(`[gossipcat] ⚠️ ${oldName} is deprecated — use ${newName} instead. Will be removed after 2026-06-30.\n`);
  }
}
```

---

### Task 1: Merge gossip_relay_result + gossip_run_complete → gossip_relay

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

These two tools have identical implementations. Create `gossip_relay` as the canonical tool, then make both old tools thin wrappers.

- [ ] **Step 1: Add deprecation helper at module level**

Find a spot near the top of the file (after imports, before tool registrations). Add:

```ts
// Deprecation tracking — each deprecated tool warns once per session
const deprecatedTools = new Set<string>();
function deprecationWarning(oldName: string, newName: string): void {
  if (!deprecatedTools.has(oldName)) {
    deprecatedTools.add(oldName);
    process.stderr.write(`[gossipcat] ⚠️ ${oldName} is deprecated — use ${newName} instead. Will be removed after 2026-06-30.\n`);
  }
}
```

- [ ] **Step 2: Create gossip_relay tool**

Add a new tool registration (place it before the existing `gossip_relay_result`). The handler should be the exact body from `gossip_relay_result` (lines 1689-1770) — no changes to logic, just new tool name:

```ts
server.tool(
  'gossip_relay',
  'Feed a native agent result back into gossipcat. Call after Agent() completes a task dispatched via gossip_dispatch or gossip_run.',
  {
    task_id: z.string().describe('Task ID returned by dispatch'),
    result: z.string().describe('The agent output/result text'),
    error: z.string().optional().describe('Error message if the agent failed'),
  },
  async ({ task_id, result, error }) => {
    // ... exact handler body from gossip_relay_result ...
  }
);
```

- [ ] **Step 3: Extract shared handler function**

Since `gossip_relay_result` and `gossip_run_complete` have identical logic, extract the handler body into a shared function:

```ts
async function handleNativeRelay(task_id: string, result: string, error?: string) {
  // ... handler body ...
}
```

Then `gossip_relay`, `gossip_relay_result`, and `gossip_run_complete` all call this function.

- [ ] **Step 4: Convert gossip_relay_result to deprecated wrapper**

Replace the handler body of `gossip_relay_result` (lines 1689-1770) with:

```ts
async ({ task_id, result, error }) => {
  deprecationWarning('gossip_relay_result', 'gossip_relay');
  return handleNativeRelay(task_id, result, error);
}
```

- [ ] **Step 5: Convert gossip_run_complete to deprecated wrapper**

Replace the handler body of `gossip_run_complete` (lines 1857-1924) with:

```ts
async ({ task_id, result, error }) => {
  deprecationWarning('gossip_run_complete', 'gossip_relay');
  return handleNativeRelay(task_id, result, error);
}
```

- [ ] **Step 6: Update NATIVE_DISPATCH instruction strings**

Search for all sites that generate `gossip_relay_result` or `gossip_run_complete` in instruction text. Update them to reference `gossip_relay`:

```bash
grep -n 'gossip_relay_result\|gossip_run_complete' apps/cli/src/mcp-server-sdk.ts
```

Update each match in instruction strings (not in tool registrations — those stay as wrappers).

- [ ] **Step 7: Verify and commit**

```bash
grep -n 'handleNativeRelay' apps/cli/src/mcp-server-sdk.ts
# Should appear in gossip_relay, gossip_relay_result, gossip_run_complete
```

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "refactor: merge gossip_relay_result + gossip_run_complete into gossip_relay"
```

---

### Task 2: Merge gossip_agents + gossip_status → unified gossip_status

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

- [ ] **Step 1: Read both handlers**

Read `gossip_agents` (lines 1335-1371) and `gossip_status` (lines 1379-1395). Understand what each returns.

- [ ] **Step 2: Create unified gossip_status handler**

Replace the existing `gossip_status` handler body with one that combines both outputs — show system status first, then agent list:

```ts
server.tool(
  'gossip_status',
  'Show system status and configured agents. Includes relay connection, worker count, and agent list with models and skills.',
  {},
  async () => {
    await boot();
    // ... combine status info + agent list into one response ...
  }
);
```

- [ ] **Step 3: Convert gossip_agents to deprecated wrapper**

```ts
async () => {
  deprecationWarning('gossip_agents', 'gossip_status');
  // Call the new gossip_status handler logic
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "refactor: merge gossip_agents into gossip_status"
```

---

### Task 3: Merge gossip_record_signals + gossip_retract_signal → gossip_signals

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

- [ ] **Step 1: Create gossip_signals with action param**

```ts
server.tool(
  'gossip_signals',
  'Record or retract consensus performance signals. Use action "record" to log findings, "retract" to correct a wrong signal.',
  {
    action: z.enum(['record', 'retract']).default('record').describe('Action to perform'),
    // record params
    task_id: z.string().optional().describe('Task ID to link signals to'),
    signals: z.array(z.object({
      signal: z.enum(['agreement', 'disagreement', 'unique_confirmed', 'unique_unconfirmed', 'new_finding', 'hallucination_caught']),
      agent_id: z.string(),
      counterpart_id: z.string().optional(),
      finding: z.string(),
      evidence: z.string().optional(),
    })).optional().describe('Signals to record (required for action: record)'),
    // retract params
    agent_id: z.string().optional().describe('Agent ID (required for action: retract)'),
    reason: z.string().optional().describe('Reason for retraction (required for action: retract)'),
  },
  async (params) => {
    await boot();
    if (params.action === 'retract') {
      // ... retract logic from gossip_retract_signal handler ...
    } else {
      // ... record logic from gossip_record_signals handler ...
    }
  }
);
```

- [ ] **Step 2: Convert gossip_record_signals to deprecated wrapper**

```ts
async (params) => {
  deprecationWarning('gossip_record_signals', 'gossip_signals');
  // delegate to gossip_signals handler with action: 'record'
}
```

- [ ] **Step 3: Convert gossip_retract_signal to deprecated wrapper**

```ts
async (params) => {
  deprecationWarning('gossip_retract_signal', 'gossip_signals');
  // delegate to gossip_signals handler with action: 'retract'
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "refactor: merge gossip_record_signals + gossip_retract_signal into gossip_signals"
```

---

### Task 4: Merge 5 skill tools → gossip_skills

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

Merge `gossip_skill_index`, `gossip_skill_bind`, `gossip_skill_unbind`, `gossip_build_skills`, `gossip_develop_skill` into one `gossip_skills` with `action` param.

- [ ] **Step 1: Create gossip_skills**

```ts
server.tool(
  'gossip_skills',
  'Manage agent skills. Actions: list (show skill slots), bind (attach skill), unbind (remove skill), build (create skill files from gap suggestions), develop (generate skill from ATI competency data).',
  {
    action: z.enum(['list', 'bind', 'unbind', 'build', 'develop']).describe('Skill management action'),
    agent_id: z.string().optional().describe('Agent ID (required for bind, unbind, develop)'),
    skill: z.string().optional().describe('Skill name (required for bind, unbind)'),
    enabled: z.boolean().optional().describe('Enable/disable (for bind action)'),
    category: z.string().optional().describe('Competency category (for develop action)'),
    skill_names: z.array(z.string()).optional().describe('Skill names (for build action)'),
    skills: z.array(z.object({ name: z.string(), content: z.string() })).optional().describe('Skill content (for build action)'),
  },
  async (params) => {
    await boot();
    switch (params.action) {
      case 'list': // ... gossip_skill_index handler body ...
      case 'bind': // ... gossip_skill_bind handler body ...
      case 'unbind': // ... gossip_skill_unbind handler body ...
      case 'build': // ... gossip_build_skills handler body ...
      case 'develop': // ... gossip_develop_skill handler body ...
    }
  }
);
```

- [ ] **Step 2: Convert all 5 old tools to deprecated wrappers**

Each old tool calls `deprecationWarning` then delegates to the `gossip_skills` handler with the appropriate action.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "refactor: merge 5 skill tools into gossip_skills with action param"
```

---

### Task 5: Merge dispatch tools → unified gossip_dispatch

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

Merge `gossip_dispatch` (single), `gossip_dispatch_parallel`, `gossip_dispatch_consensus` into one `gossip_dispatch` with `mode` param.

- [ ] **Step 1: Create unified gossip_dispatch handler**

The unified tool accepts a `mode` parameter:

```ts
server.tool(
  'gossip_dispatch',
  'Dispatch tasks to agents. Modes: single (one agent), parallel (fan out), consensus (fan out with cross-review).',
  {
    mode: z.enum(['single', 'parallel', 'consensus']).default('single').describe('Dispatch mode'),
    // single mode params
    agent_id: z.string().optional().describe('Agent ID (required for single mode)'),
    task: z.string().optional().describe('Task description (required for single mode)'),
    write_mode: z.enum(['sequential', 'scoped', 'worktree']).optional(),
    scope: z.string().optional(),
    timeout_ms: z.number().optional(),
    plan_id: z.string().optional(),
    step: z.number().optional(),
    // parallel/consensus mode params
    tasks: z.array(z.object({
      agent_id: z.string(),
      task: z.string(),
      write_mode: z.enum(['sequential', 'scoped', 'worktree']).optional(),
      scope: z.string().optional(),
    })).optional().describe('Task array (required for parallel/consensus modes)'),
  },
  async (params) => {
    await boot();
    await syncWorkersViaKeychain();
    switch (params.mode) {
      case 'single': // ... old gossip_dispatch handler logic ...
      case 'parallel': // ... old gossip_dispatch_parallel handler logic (consensus: false) ...
      case 'consensus': // ... old gossip_dispatch_consensus handler logic ...
    }
  }
);
```

- [ ] **Step 2: Convert old gossip_dispatch to deprecated wrapper**

Rename the current `gossip_dispatch` registration to `gossip_dispatch_single_legacy` internally, then register a deprecated wrapper under the old name that delegates to the unified handler with `mode: 'single'`.

**Important:** The new unified tool takes the name `gossip_dispatch`. The old single-dispatch tool becomes a no-op since its name is reused. The old `gossip_dispatch_parallel` and `gossip_dispatch_consensus` become wrappers.

- [ ] **Step 3: Convert gossip_dispatch_parallel to deprecated wrapper**

```ts
async (params) => {
  deprecationWarning('gossip_dispatch_parallel', 'gossip_dispatch');
  // delegate with mode: params.consensus ? 'consensus' : 'parallel'
}
```

- [ ] **Step 4: Convert gossip_dispatch_consensus to deprecated wrapper**

```ts
async (params) => {
  deprecationWarning('gossip_dispatch_consensus', 'gossip_dispatch');
  // delegate with mode: 'consensus'
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "refactor: merge dispatch tools into unified gossip_dispatch with mode param"
```

---

### Task 6: Merge collect tools + absorb orchestrate into gossip_run

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

Two sub-tasks:

**6a: Merge gossip_collect_consensus into gossip_collect**

`gossip_collect` already has a `consensus: boolean` param. Make `gossip_collect_consensus` a deprecated wrapper.

- [ ] **Step 1: Ensure gossip_collect handles consensus correctly**

Read both implementations. `gossip_collect` with `consensus: true` should produce the same output as `gossip_collect_consensus`. Check for any semantic differences (e.g., the empty-IDs default behavior — `gossip_collect` allows `[]` for "all tasks", `gossip_collect_consensus` requires explicit IDs).

If `gossip_collect`'s consensus path doesn't fully replicate `gossip_collect_consensus`, port the missing logic.

- [ ] **Step 2: Convert gossip_collect_consensus to deprecated wrapper**

```ts
async ({ task_ids, timeout_ms }) => {
  deprecationWarning('gossip_collect_consensus', 'gossip_collect');
  // delegate to gossip_collect with consensus: true
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: merge gossip_collect_consensus into gossip_collect(consensus: true)"
```

**6b: Absorb gossip_orchestrate into gossip_run**

- [ ] **Step 4: Add agent_id: "auto" support to gossip_run**

When `agent_id` is `"auto"`, `gossip_run` should call `mainAgent.handleMessage(task, { mode: 'decompose' })` — the same logic as `gossip_orchestrate`.

- [ ] **Step 5: Convert gossip_orchestrate to deprecated wrapper**

```ts
async ({ task }) => {
  deprecationWarning('gossip_orchestrate', 'gossip_run');
  // delegate to gossip_run with agent_id: 'auto'
}
```

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor: absorb gossip_orchestrate into gossip_run(agent_id: 'auto')"
```

---

### Task 7: Absorb gossip_update_instructions into gossip_setup + remove dead tools

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

- [ ] **Step 1: Add mode: "update_instructions" to gossip_setup**

Extend the gossip_setup Zod schema to accept `mode: 'create' | 'merge' | 'replace' | 'update_instructions'`. When mode is `update_instructions`, run the logic from `gossip_update_instructions`.

- [ ] **Step 2: Convert gossip_update_instructions to deprecated wrapper**

- [ ] **Step 3: Remove gossip_bootstrap registration**

Delete the `gossip_bootstrap` tool registration entirely (lines 1471-1483). It's auto-called on boot and session save.

- [ ] **Step 4: Remove gossip_log_finding and gossip_findings**

Delete both registrations (lines 2068-2195). Per spec: removed entirely, `gossip_signals` is the single channel.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: absorb update_instructions into setup, remove bootstrap/log_finding/findings"
```

---

### Task 8: Update gossip_tools listing, bootstrap, and dispatch rules

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts` (gossip_tools handler)
- Modify: `packages/orchestrator/src/bootstrap.ts` (tool table)
- Modify: `.claude/rules/gossipcat.md` (dispatch rules)

- [ ] **Step 1: Rewrite gossip_tools listing**

Replace the hardcoded array with 12 new tools first, then deprecated tools marked `[deprecated]`:

```ts
const tools = [
  // === Core ===
  { name: 'gossip_run', desc: 'Run a task on one agent. Use agent_id: "auto" for decomposer.' },
  { name: 'gossip_dispatch', desc: 'Dispatch tasks. Modes: single, parallel, consensus.' },
  { name: 'gossip_collect', desc: 'Collect results. Use consensus: true for cross-review.' },
  { name: 'gossip_relay', desc: 'Feed native Agent() result back into gossipcat.' },
  { name: 'gossip_signals', desc: 'Record or retract consensus performance signals.' },
  { name: 'gossip_status', desc: 'Show system status and configured agents.' },
  { name: 'gossip_setup', desc: 'Create/update team configuration.' },
  { name: 'gossip_session_save', desc: 'Save session summary for next session context.' },
  // === Power-user ===
  { name: 'gossip_plan', desc: 'Plan task with write-mode suggestions.' },
  { name: 'gossip_scores', desc: 'View agent performance scores and dispatch weights.' },
  { name: 'gossip_skills', desc: 'Manage agent skills: list, bind, unbind, build, develop.' },
  { name: 'gossip_tools', desc: 'List available tools (this command).' },
  // === Deprecated (remove after 2026-06-30) ===
  { name: 'gossip_dispatch_parallel [deprecated]', desc: 'Use gossip_dispatch(mode: "parallel")' },
  { name: 'gossip_dispatch_consensus [deprecated]', desc: 'Use gossip_dispatch(mode: "consensus")' },
  { name: 'gossip_collect_consensus [deprecated]', desc: 'Use gossip_collect(consensus: true)' },
  { name: 'gossip_orchestrate [deprecated]', desc: 'Use gossip_run(agent_id: "auto")' },
  { name: 'gossip_relay_result [deprecated]', desc: 'Use gossip_relay' },
  { name: 'gossip_run_complete [deprecated]', desc: 'Use gossip_relay' },
  { name: 'gossip_record_signals [deprecated]', desc: 'Use gossip_signals' },
  { name: 'gossip_retract_signal [deprecated]', desc: 'Use gossip_signals(action: "retract")' },
  { name: 'gossip_agents [deprecated]', desc: 'Use gossip_status' },
  { name: 'gossip_update_instructions [deprecated]', desc: 'Use gossip_setup(mode: "update_instructions")' },
  { name: 'gossip_skill_index [deprecated]', desc: 'Use gossip_skills(action: "list")' },
  { name: 'gossip_skill_bind [deprecated]', desc: 'Use gossip_skills(action: "bind")' },
  { name: 'gossip_skill_unbind [deprecated]', desc: 'Use gossip_skills(action: "unbind")' },
  { name: 'gossip_build_skills [deprecated]', desc: 'Use gossip_skills(action: "build")' },
  { name: 'gossip_develop_skill [deprecated]', desc: 'Use gossip_skills(action: "develop")' },
];
```

- [ ] **Step 2: Update bootstrap.ts tool table**

Read `packages/orchestrator/src/bootstrap.ts` and find the tool table in `renderTeamPrompt()`. Update it to list the 12 new tools with deprecated tools marked. Include both new and deprecated during transition.

- [ ] **Step 3: Rewrite .claude/rules/gossipcat.md dispatch rules**

This needs a full narrative rewrite, not find-and-replace. Update:
- The "Subagent Override" section to reference `gossip_run` and `gossip_relay` (not `gossip_relay_result`/`gossip_run_complete`)
- The dispatch pattern examples to use `gossip_dispatch(mode: ...)` syntax
- The consensus workflow to use `gossip_dispatch(mode: "consensus")` + `gossip_collect(consensus: true)`
- The Tier 1/2/3 tables (tool names in "Files to watch" column)

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts packages/orchestrator/src/bootstrap.ts .claude/rules/gossipcat.md
git commit -m "docs: update tool listing, bootstrap, and dispatch rules for consolidated API"
```

---

### Task 9: Rebuild MCP bundle and verify

**Files:**
- Build: `dist-mcp/mcp-server.js`

- [ ] **Step 1: Build and verify**

```bash
npm run build --workspaces 2>&1 | grep -v 'error TS' | grep -E '(built|Dashboard)'
npm run build:mcp
```

- [ ] **Step 2: Verify new tools exist in bundle**

```bash
for tool in gossip_relay gossip_signals gossip_skills gossip_status; do
  echo "$tool: $(grep -c "'$tool'" dist-mcp/mcp-server.js)"
done
```

- [ ] **Step 3: Verify deprecated tools still registered**

```bash
for tool in gossip_relay_result gossip_run_complete gossip_dispatch_consensus gossip_collect_consensus gossip_orchestrate; do
  echo "$tool: $(grep -c "'$tool'" dist-mcp/mcp-server.js)"
done
```

- [ ] **Step 4: Verify removed tools are gone**

```bash
for tool in gossip_bootstrap gossip_log_finding gossip_findings; do
  echo "$tool: $(grep -c "server.tool.*'$tool'" dist-mcp/mcp-server.js)"
done
```

Expected: 0 for each.

- [ ] **Step 5: Commit bundle**

```bash
git add dist-mcp/mcp-server.js
git commit -m "build: rebuild MCP bundle with consolidated tool surface (27→12)"
```

---

## Review Requirements

- Tasks 1-4 (relay, status, signals, skills merges): **Tier 3** — isolated merges, no dispatch pipeline changes
- Task 5 (dispatch merge): **Tier 2** — new MCP tool registration for core dispatch
- Task 6 (collect merge + orchestrate): **Tier 2** — modifies collection semantics
- Task 7 (setup + removals): **Tier 2** — removes tools
- Task 8 (bootstrap + rules): **Tier 3** — documentation only
