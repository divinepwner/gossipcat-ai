# Gossipcat Write Tasks — Design Spec

> Enable gossipcat workers (Gemini, GPT, local models) to safely handle implementation tasks with three layered write modes: sequential, scoped, and worktree.

**Date:** 2026-03-22
**Status:** Draft
**Dependencies:** CLI/MCP Parity (shipped), DispatchPipeline (shipped), Tool Server (shipped)

---

## Problem Statement

Gossipcat workers have file write tools (`file_write`, `git_commit`, `git_branch`, `shell_exec`) via the Tool Server, but there is no coordination layer to prevent conflicts when multiple agents write simultaneously. Today, write tasks are only safe when dispatched to Claude Code's native `Agent()` tool (which has built-in worktree isolation). This limits gossipcat to read-only tasks for Gemini/GPT agents — the entire implementation capability of the multi-agent team is unused.

## Design Overview

**Add a `writeMode` option to `dispatch()` with three progressive layers:**

```
dispatch(agentId, task, { writeMode: 'sequential' | 'scoped' | 'worktree', scope?: string })
```

| Mode | Isolation | Parallelism | Use case |
|------|-----------|-------------|----------|
| `sequential` | Main working tree | One write task at a time | Simple implementation tasks |
| `scoped` | Main working tree + directory lock | Parallel across non-overlapping directories | Multi-package refactors |
| `worktree` | Isolated git worktree | Fully parallel | Risky changes, experiments |

Enforcement is defense-in-depth: DispatchPipeline prevents conflicts at dispatch time, Tool Server validates writes at execution time.

---

## Component 1: DispatchOptions

### Types

```typescript
export interface DispatchOptions {
  writeMode?: 'sequential' | 'scoped' | 'worktree';
  scope?: string;  // Required for 'scoped' mode — directory path relative to project root
}
```

`TaskEntry` gains new optional fields:

```typescript
export interface TaskEntry {
  // ... existing fields ...
  writeMode?: 'sequential' | 'scoped' | 'worktree';
  scope?: string;
  worktreeInfo?: {
    path: string;      // /tmp/gossip-wt-<taskId>/
    branch: string;    // gossip-<taskId>
  };
}
```

### dispatch() signature change

```typescript
dispatch(agentId: string, task: string, options?: DispatchOptions): { taskId: string; promise: Promise<string> }
```

No write mode = current behavior (read-only, no coordination). Write mode triggers the appropriate coordination layer before executing.

**Validation at dispatch time:**
- `writeMode === 'scoped'` and `scope` is undefined/empty → throw: `"scope is required for scoped write mode"`
- `writeMode === 'worktree'` and agent already has an active worktree task → throw: `"agent already has an active worktree task"` (prevents `agentRoots` collision)
- `writeMode === 'sequential'` and another sequential task is queued/active → queue (not reject — sequential tasks wait)

**file_read in scoped mode:** Intentionally unrestricted. Scoped agents can read any file — the scope only restricts writes. This allows review + edit workflows where an agent reads broadly but writes narrowly.

---

## Component 2: Sequential Write Queue

Simplest write mode. One write task at a time.

### State

```typescript
// In DispatchPipeline
private writeQueue: Array<{ taskId: string; execute: () => void }> = [];
private activeWriteTaskId: string | null = null;
```

### Dispatch flow

1. If `activeWriteTaskId === null` — start immediately, set `activeWriteTaskId = taskId`
2. If a write task IS running — create a **deferred promise** and add to queue:
```typescript
// Deferred promise pattern — task doesn't start until execute() is called
let deferResolve: (v: string) => void;
let deferReject: (e: Error) => void;
entry.promise = new Promise<string>((res, rej) => { deferResolve = res; deferReject = rej; });
this.writeQueue.push({
  taskId,
  execute: () => {
    this.activeWriteTaskId = taskId;
    worker.executeTask(task, undefined, promptContent)
      .then((result) => { entry.status = 'completed'; entry.result = result; entry.completedAt = Date.now(); deferResolve(result); })
      .catch((err) => { entry.status = 'failed'; entry.error = err.message; entry.completedAt = Date.now(); deferReject(err); });
  },
});
```
This guarantees `entry.promise` only settles after the task actually runs, not when it's queued.
3. Read-only tasks (no writeMode) run in parallel with write tasks — they are never blocked

### Completion flow

When a sequential write task completes (via `collect()` or `writeMemoryForTask()`):
1. Set `activeWriteTaskId = null`
2. If `writeQueue` is not empty — dequeue next task, set it as active, call its `execute()` callback

Both `collect()` and `writeMemoryForTask()` must call the same `drainWriteQueue()` method after task cleanup. **This method MUST be synchronous** — it runs after all async work settles and must not be interleaved:

```typescript
private drainWriteQueue(): void {
  if (this.activeWriteTaskId !== null) return;
  const next = this.writeQueue.shift();
  if (next) {
    next.execute(); // execute() sets activeWriteTaskId internally
  }
}
```

**Drain triggers — ALL completion paths must drain:**
- `collect()` — after post-collect pipeline, for each completed/failed write task: set `activeWriteTaskId = null`, then call `drainWriteQueue()`
- `writeMemoryForTask()` — same: set `activeWriteTaskId = null`, then `drainWriteQueue()`
- **Failed tasks:** `writeMemoryForTask()` currently returns early for non-completed tasks. For sequential write tasks, the queue MUST still drain on failure. Add: if the task had `writeMode === 'sequential'` and status is `'failed'`, still set `activeWriteTaskId = null` and call `drainWriteQueue()`.

Without draining on failure, a failed sequential task blocks the queue indefinitely.

### Constraint

Sequential mode writes to the **main working tree**. The agent writes directly to project files. Safe because only one write task runs at a time.

---

## Component 3: ScopeTracker

Directory-level ownership for parallel write tasks.

### File: `packages/orchestrator/src/scope-tracker.ts`

```typescript
export class ScopeTracker {
  private activeScopes: Map<string, string> = new Map(); // normalized scope → taskId

  /** Check if a scope overlaps with any active scope */
  hasOverlap(scope: string): { overlaps: boolean; conflictTaskId?: string; conflictScope?: string };

  /** Register a scope for a task */
  register(scope: string, taskId: string): void;

  /** Release a scope when task completes */
  release(taskId: string): void;

  /** Release all scopes (for shutdown) */
  clear(): void;
}
```

### Overlap detection rules

Two scopes overlap if either is a prefix of the other:
- `packages/relay/` overlaps with `packages/relay/src/` (parent contains child)
- `packages/relay/src/` overlaps with `packages/relay/` (child within parent)
- `packages/relay/` does NOT overlap with `packages/tools/` (siblings)
- `packages/` overlaps with everything under `packages/` (too broad — warn but allow)

Scopes MUST be normalized before registration and comparison to prevent path traversal:

```typescript
import { resolve, relative } from 'path';

private normalizeScope(scope: string, projectRoot: string): string {
  const abs = resolve(projectRoot, scope);
  const rel = relative(projectRoot, abs);
  if (rel.startsWith('..')) throw new Error(`Scope "${scope}" resolves outside project root`);
  return rel.endsWith('/') ? rel : rel + '/';
}
```

Implementation:
```typescript
hasOverlap(scope: string): { overlaps: boolean; conflictTaskId?: string; conflictScope?: string } {
  const normalized = scope.endsWith('/') ? scope : scope + '/';
  for (const [activeScope, taskId] of this.activeScopes) {
    if (normalized.startsWith(activeScope) || activeScope.startsWith(normalized)) {
      return { overlaps: true, conflictTaskId: taskId, conflictScope: activeScope };
    }
  }
  return { overlaps: false };
}
```

### Dispatch flow (scoped mode)

1. Validate `scope` is provided (throw if missing)
2. Check `scopeTracker.hasOverlap(scope)` — reject if overlaps with running task
3. Register scope: `scopeTracker.register(scope, taskId)`
4. Assign scope to ToolServer: send `scope_assign` RPC to tool-server
5. Dispatch worker as normal

### Completion flow

1. Release scope: `scopeTracker.release(taskId)`
2. Clear ToolServer scope: send `scope_release` RPC to tool-server

### Tool Server enforcement (defense in depth)

ToolServer tracks per-agent scopes and roots:

```typescript
// In ToolServer
private agentScopes: Map<string, string> = new Map(); // agentId → scope path
private orchestratorId: string;  // Only this agent can assign scopes/roots

// In ToolServerConfig:
orchestratorId?: string;  // If set, only this agent can send scope_assign/root_assign RPCs

// New RPC handlers — MUST verify sender is orchestrator:
case 'scope_assign':
  if (this.orchestratorId && envelope.sid !== this.orchestratorId) {
    throw new Error('Unauthorized: only orchestrator can assign scopes');
  }
  this.agentScopes.set(args.agentId, args.scope);
  return 'OK';
case 'scope_release':
  if (this.orchestratorId && envelope.sid !== this.orchestratorId) {
    throw new Error('Unauthorized');
  }
  this.agentScopes.delete(args.agentId);
  return 'OK';
```

### Tool Server state recovery

`agentScopes` and `agentRoots` are in-memory. If the ToolServer crashes and reconnects, all scope/root assignments are lost — silently disabling enforcement.

**Recovery mechanism:** When DispatchPipeline detects a ToolServer reconnect (via relay presence events or a heartbeat check), it re-sends all active `scope_assign` and `root_assign` RPCs for currently-running write tasks:

```typescript
// In DispatchPipeline — called when ToolServer reconnects:
private async reRegisterWriteTaskState(): Promise<void> {
  for (const [taskId, entry] of this.tasks) {
    if (entry.writeMode === 'scoped' && entry.scope) {
      await this.sendRpc('tool-server', 'scope_assign', { agentId: entry.agentId, scope: entry.scope });
    }
    if (entry.writeMode === 'worktree' && entry.worktreeInfo) {
      await this.sendRpc('tool-server', 'root_assign', { agentId: entry.agentId, root: entry.worktreeInfo.path });
    }
  }
}
```

This ensures scope enforcement is restored after any ToolServer restart.

On every `file_write` call:
```typescript
if (this.agentScopes.has(callerId)) {
  const allowed = this.agentScopes.get(callerId)!;
  const normalized = allowed.endsWith('/') ? allowed : allowed + '/';
  if (!args.path.startsWith(normalized) && args.path !== allowed) {
    throw new Error(`Agent cannot write outside scope: ${allowed}`);
  }
}
```

On `shell_exec` for scoped agents — set `cwd` to the scope directory:
```typescript
if (this.agentScopes.has(callerId)) {
  const scopeDir = join(this.sandbox.projectRoot, this.agentScopes.get(callerId)!);
  args.cwd = scopeDir; // Override cwd to scope directory
}
```

On `git_commit` for scoped agents — validate files are within scope:
```typescript
if (this.agentScopes.has(callerId) && args.files) {
  const allowed = this.agentScopes.get(callerId)!;
  for (const f of args.files) {
    if (!f.startsWith(allowed)) throw new Error(`Cannot commit file outside scope: ${f}`);
  }
}
```

This is defense-in-depth: even if DispatchPipeline has a bug, ToolServer blocks unauthorized writes and constrains shell execution to the scope directory.

---

## Component 4: WorktreeManager

Git worktree lifecycle for fully isolated write tasks.

### File: `packages/orchestrator/src/worktree-manager.ts`

```typescript
export class WorktreeManager {
  constructor(private projectRoot: string) {}

  /** Create a worktree for a task */
  async create(taskId: string): Promise<{ path: string; branch: string }>;

  /** Try to merge a worktree branch into the current branch */
  async merge(taskId: string): Promise<{ merged: boolean; conflicts?: string[] }>;

  /** Clean up worktree and branch */
  async cleanup(taskId: string): Promise<void>;
}
```

### Create flow

```typescript
async create(taskId: string): Promise<{ path: string; branch: string }> {
  const branch = `gossip-${taskId}`;
  // Use mkdtemp for unpredictable paths (prevents TOCTOU pre-creation attacks)
  const wtPath = await mkdtemp(join(tmpdir(), 'gossip-wt-'));

  await execFile('git', ['branch', branch, 'HEAD'], { cwd: this.projectRoot });
  await execFile('git', ['worktree', 'add', wtPath, branch], { cwd: this.projectRoot });

  return { path: wtPath, branch };
}
```

### Merge flow (auto-merge with conflict detection)

```typescript
async merge(taskId: string): Promise<{ merged: boolean; conflicts?: string[] }> {
  const branch = `gossip-${taskId}`;

  // Check if branch has any commits beyond HEAD
  const log = await execFile('git', ['log', `HEAD..${branch}`, '--oneline'], { cwd: this.projectRoot });
  if (!log.stdout.trim()) {
    return { merged: true }; // No changes to merge
  }

  try {
    await execFile('git', ['merge', branch, '--no-edit'], { cwd: this.projectRoot });
    return { merged: true };
  } catch {
    // Merge conflict — abort and report
    await execFile('git', ['merge', '--abort'], { cwd: this.projectRoot });
    const diffOutput = await execFile('git', ['diff', '--name-only', `HEAD...${branch}`], { cwd: this.projectRoot });
    return { merged: false, conflicts: diffOutput.stdout.trim().split('\n') };
  }
}
```

### Cleanup flow

```typescript
async cleanup(taskId: string, wtPath: string): Promise<void> {
  const branch = `gossip-${taskId}`;

  try { await execFile('git', ['worktree', 'remove', wtPath, '--force'], { cwd: this.projectRoot }); } catch { /* already removed */ }
  try { await execFile('git', ['branch', '-d', branch], { cwd: this.projectRoot }); } catch { /* branch in use or doesn't exist */ }
}
```

Note: `wtPath` is passed from the stored `worktreeInfo.path` on the TaskEntry (since mkdtemp generates a random suffix, we can't reconstruct the path from the taskId alone).

**Orphan cleanup on startup:**

```typescript
async pruneOrphans(): Promise<void> {
  // Find stale gossip worktrees that survived a crash
  const result = await execFile('git', ['worktree', 'list', '--porcelain'], { cwd: this.projectRoot });
  const orphans = result.stdout.split('\n\n')
    .filter(block => block.includes('gossip-wt-'))
    .map(block => block.match(/worktree (.+)/)?.[1])
    .filter(Boolean);
  for (const wtPath of orphans) {
    try { await execFile('git', ['worktree', 'remove', wtPath!, '--force'], { cwd: this.projectRoot }); } catch {}
  }
  // Prune gossip branches with no worktree
  await execFile('git', ['worktree', 'prune'], { cwd: this.projectRoot }).catch(() => {});
}
```

### ToolServer worktree routing

When a worktree task is dispatched, ToolServer routes that agent's file operations to the worktree path:

```typescript
// In ToolServer
private agentRoots: Map<string, string> = new Map(); // agentId → worktree path

setAgentRoot(agentId: string, root: string): void {
  this.agentRoots.set(agentId, root);
}

clearAgentRoot(agentId: string): void {
  this.agentRoots.delete(agentId);
}

// In executeTool, resolve the root per agent:
const root = this.agentRoots.get(callerId) || this.sandbox.projectRoot;
```

**Threading the root to all tool classes:**

The overridden root must be used by ALL tool classes, not just file tools:

```typescript
// In executeTool:
const root = this.agentRoots.get(callerId) || this.sandbox.projectRoot;

// File tools — pass root to Sandbox for path validation:
case 'file_read':
  const sandbox = new Sandbox(root);
  return new FileTools(sandbox).fileRead(args);

// Shell tools — pass root as cwd:
case 'shell_exec':
  return this.shellTools.shellExec({ ...args, cwd: root });

// Git tools — construct with dynamic root:
case 'git_status':
case 'git_diff':
case 'git_log':
case 'git_commit':
case 'git_branch':
  return new GitTools(root).gitStatus(); // (dispatch to correct method)
```

`GitTools` and `FileTools` are lightweight — constructing per-call is acceptable. Alternatively, cache per root path. The key requirement: `cwd` for shell commands and `projectRoot` for file/git operations MUST use the per-agent root, not the ToolServer's original root.

The agent doesn't know it's in a worktree — it just works.

### Dispatch flow (worktree mode)

1. Create worktree: `worktreeManager.create(taskId)`
2. Set ToolServer root: send `root_assign` RPC to tool-server with `{ agentId, root: wtPath }`
3. Store worktreeInfo on TaskEntry
4. Dispatch worker as normal

### Collect flow (worktree mode)

1. Clear ToolServer root: send `root_release` RPC
2. If task **failed** — cleanup worktree + branch (no useful changes), skip merge
3. If task **completed** — try merge: `worktreeManager.merge(taskId)`
   - If merged successfully — cleanup worktree + branch
   - If conflicts — DON'T cleanup (user needs to resolve), include conflict details in result

Failed tasks always clean up (the branch has incomplete/broken changes). Successful tasks with merge conflicts preserve the branch so the user can resolve manually.

---

## Component 5: dispatchParallel with write modes

### MCP API

```
gossip_dispatch_parallel(tasks: [
  { agent_id: "gemini-impl-a", task: "...", write_mode: "scoped", scope: "packages/relay/" },
  { agent_id: "gemini-impl-b", task: "...", write_mode: "scoped", scope: "packages/tools/" },
  { agent_id: "gemini-reviewer", task: "..." }
])
```

### Validation rules

| Combination | Allowed? |
|------------|----------|
| Multiple read-only | Yes |
| One sequential + read-only | Yes |
| Multiple sequential | No — error |
| Multiple scoped (non-overlapping) | Yes |
| Multiple scoped (overlapping) | No — error |
| Multiple worktree (different agents) | Yes |
| Multiple worktree (same agent) | No — `agentRoots` keyed on agentId, would collide |
| Scoped + worktree + read-only | Yes |
| Sequential + any other write mode | No — error |

### Batch pre-validation (true all-or-nothing)

ALL validation runs BEFORE any task is dispatched. If any check fails, the entire batch is rejected with zero side effects:

1. **Agent existence:** verify all agents exist in the workers map
2. **Write mode rules:** check the combination table above
3. **Scope overlap:** check inter-batch and against active scopes
4. **Worktree agent collision:** verify no agent has two worktree tasks

Only after all checks pass does dispatching begin. This prevents the partial-dispatch problem where task 1 is running but task 2 fails validation.

All scoped tasks in a batch are validated as a group:

```typescript
// Check all scoped tasks for inter-batch overlap
const scopedTasks = taskDefs.filter(t => t.writeMode === 'scoped');
for (let i = 0; i < scopedTasks.length; i++) {
  for (let j = i + 1; j < scopedTasks.length; j++) {
    if (scopesOverlap(scopedTasks[i].scope, scopedTasks[j].scope)) {
      return { taskIds: [], errors: [`Scope conflict in batch: ${scopedTasks[i].scope} overlaps ${scopedTasks[j].scope}`] };
    }
  }
  // Also check against already-active scopes
  const overlap = scopeTracker.hasOverlap(scopedTasks[i].scope);
  if (overlap.overlaps) {
    return { taskIds: [], errors: [`Scope '${scopedTasks[i].scope}' conflicts with running task ${overlap.conflictTaskId}`] };
  }
}
```

### Worktree merge order on collect

When collecting a batch with multiple worktree tasks, merge them sequentially (one at a time) to avoid cascading conflicts. If worktree A and B both modified different files, sequential merge works cleanly. If they modified the same file, the second merge detects the conflict.

---

## Component 6: MCP Tool Updates

### gossip_dispatch

Add optional parameters:

```typescript
server.tool('gossip_dispatch', '...', {
  agent_id: z.string(),
  task: z.string(),
  write_mode: z.enum(['sequential', 'scoped', 'worktree']).optional(),
  scope: z.string().optional().describe('Directory scope for scoped write mode'),
}, async ({ agent_id, task, write_mode, scope }) => {
  // ... existing validation ...
  const options: DispatchOptions | undefined = write_mode
    ? { writeMode: write_mode, scope }
    : undefined;
  const { taskId } = mainAgent.dispatch(agent_id, task, options);
  // ...
});
```

### gossip_dispatch_parallel

Add `write_mode` and `scope` to each task in the array:

```typescript
tasks: z.array(z.object({
  agent_id: z.string(),
  task: z.string(),
  write_mode: z.enum(['sequential', 'scoped', 'worktree']).optional(),
  scope: z.string().optional(),
}))
```

### gossip_collect

Add merge result info for worktree tasks:

```
[taskId] gemini-impl (3500ms):
Result text here...

Worktree merge: SUCCESS (branch gossip-abc123 merged and cleaned up)
```

Or on conflict:
```
[taskId] gemini-impl (3500ms):
Result text here...

Worktree merge: CONFLICT
  Conflicting files: packages/relay/src/server.ts
  Branch preserved: gossip-abc123
  Resolve manually: git merge gossip-abc123
```

---

## Files Changed

| File | Action | Change |
|------|--------|--------|
| `packages/orchestrator/src/scope-tracker.ts` | **Create** | ScopeTracker: overlap detection, register/release (~60 lines) |
| `packages/orchestrator/src/worktree-manager.ts` | **Create** | WorktreeManager: create/merge/cleanup (~80 lines) |
| `packages/orchestrator/src/dispatch-pipeline.ts` | **Edit** | Add writeMode handling: sequential queue, scoped delegation, worktree delegation. Modify dispatch(), collect(), dispatchParallel() |
| `packages/orchestrator/src/types.ts` | **Edit** | Add DispatchOptions, extend TaskEntry with writeMode/scope/worktreeInfo |
| `packages/orchestrator/src/index.ts` | **Edit** | Export ScopeTracker, WorktreeManager, DispatchOptions |
| `packages/tools/src/tool-server.ts` | **Edit** | Add agentScopes + agentRoots maps, scope_assign/scope_release/root_assign/root_release RPC handlers, enforce scope on file_write |
| `apps/cli/src/mcp-server-sdk.ts` | **Edit** | Add write_mode + scope params to gossip_dispatch and gossip_dispatch_parallel |
| `tests/orchestrator/scope-tracker.test.ts` | **Create** | Overlap detection, register/release, edge cases |
| `tests/orchestrator/worktree-manager.test.ts` | **Create** | Create/merge/cleanup, conflict handling |
| `tests/orchestrator/dispatch-pipeline.test.ts` | **Edit** | Sequential queue, scoped dispatch, worktree dispatch tests |

---

## Testing Strategy

- **ScopeTracker:** Unit test — overlap detection for parent/child/sibling scopes, register/release lifecycle, concurrent scope checks
- **WorktreeManager:** Integration test — create worktree, make changes, merge back, verify files. Conflict test — make conflicting changes, verify merge fails gracefully
- **Sequential queue:** Unit test — verify tasks run one at a time, read tasks not blocked, queue drains in order
- **Scoped dispatch:** Unit test — verify overlap rejection, scope registration, ToolServer scope assignment
- **Worktree dispatch:** Integration test — full flow from dispatch through worktree to merge on collect
- **dispatchParallel validation:** Unit test — verify batch rules (no multiple sequential, no overlapping scopes, mixed modes)
- **MCP tools:** Smoke test — dispatch with write_mode via MCP, verify coordination works
- **Regression:** All existing tests must pass

---

## Security Constraints

- Write coordination is opt-in — existing read-only dispatch is unchanged
- Tool Server enforces scopes at the file operation level (defense in depth)
- Worktree paths use `os.tmpdir()` — not inside the project directory
- Worktree branches use `gossip-<taskId>` prefix — won't collide with user branches
- Scope validation is strict: paths must be relative, no `..` traversal
- `scope_assign` / `root_assign` RPCs require `orchestratorId` match — not just general `allowedCallers`. Worker agents cannot assign their own scopes.
- Sequential mode limits: only one write task at a time, enforced by the pipeline, not bypassable by MCP callers
- **Multi-orchestrator limitation:** Only one orchestrator process should run against a project at a time. ScopeTracker is in-memory with no cross-process coordination. Running multiple orchestrators could cause scope conflicts and data corruption. This is documented, not enforced — future work for distributed locking.
- **Worktree paths** use `mkdtemp` for unpredictable random suffixes — prevents TOCTOU pre-creation attacks
- **ToolServer state recovery:** On ToolServer reconnect, DispatchPipeline re-sends all active scope/root assignments. See "Tool Server state recovery" section.
- **Orphan cleanup:** WorktreeManager.pruneOrphans() runs at startup to clean stale worktrees from prior crashes
