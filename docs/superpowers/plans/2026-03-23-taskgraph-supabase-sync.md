# TaskGraph Supabase Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync the local TaskGraph JSONL event log to Supabase for cross-session analytics, agent performance tracking, and team-level task history.

**Architecture:** JSONL remains source of truth. A `TaskGraphSync` class translates unsynced events to Supabase REST API calls (direct fetch, no SDK). Sync triggers automatically every 30 completed events or manually via `gossipcat sync`. Connection config lives in `.gossip/supabase.json` (gitignored), API key in OS keychain.

**Tech Stack:** TypeScript, Supabase REST API (PostgREST), node `fetch`, existing `Keychain` class, existing `TaskGraph` class.

**Spec:** `docs/superpowers/specs/2026-03-21-taskgraph-supabase-design.md`

**Spec deviations:**
- `sync()` returns `{ events, scores, errors }` — extends spec's `{ events, scores }` with an `errors` array for better error visibility.
- `gossipcat sync --setup` uses manual URL+key prompt only. MCP integration (mcp__supabase__list_projects, apply_migration) is deferred — the CLI can't call MCP tools. MCP-based setup would require a gossip_sync MCP tool, which is a separate feature.
- RLS policies use `USING (true)` (single-tenant assumption). Per-user filtering requires Supabase Auth, which is deferred.
- `getUnsynced()` uses `readEvents()` which scans the last 1000 JSONL lines only. First-time sync on projects with >1000 events will skip the oldest. Acceptable for typical usage (~20-50 tasks/session). A full-scan sync path can be added later if needed.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/orchestrator/src/task-graph-sync.ts` | Create | JSONL → Supabase REST translator. Reads unsynced events, maps to INSERT/UPDATE, updates sync meta. |
| `packages/orchestrator/src/index.ts` | Modify | Export `TaskGraphSync` |
| `packages/orchestrator/src/dispatch-pipeline.ts` | Modify | Add sync trigger after collect event recording (step 6.5 in pipeline) |
| `apps/cli/src/identity.ts` | Create | Shared `getUserId()` and `getProjectId()` — used by sync-command.ts and mcp-server-sdk.ts |
| `apps/cli/src/sync-command.ts` | Create | `gossipcat sync`, `gossipcat sync --setup`, `gossipcat sync --status` CLI |
| `apps/cli/src/index.ts` | Modify | Register `sync` command |
| `tests/orchestrator/task-graph-sync.test.ts` | Create | Unit tests with mocked fetch |

---

### Task 1: TaskGraphSync — Core Sync Class

**Files:**
- Create: `packages/orchestrator/src/task-graph-sync.ts`
- Test: `tests/orchestrator/task-graph-sync.test.ts`

- [ ] **Step 1: Write the failing test — sync translates created+completed events**

```typescript
// tests/orchestrator/task-graph-sync.test.ts
import { TaskGraph } from '../../packages/orchestrator/src/task-graph';
import { TaskGraphSync } from '../../packages/orchestrator/src/task-graph-sync';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock global fetch
const fetchCalls: Array<{ url: string; method: string; body: any }> = [];
global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(init.body as string) : null;
  const method = init?.method || 'GET';
  fetchCalls.push({ url: url.toString(), method, body });
  // Supabase REST returns the upserted row(s) — all calls use POST (upsert)
  return new Response(JSON.stringify(body ? [body] : []), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}) as any;

describe('TaskGraphSync', () => {
  let tmpDir: string;
  let graph: TaskGraph;
  let sync: TaskGraphSync;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tg-sync-'));
    graph = new TaskGraph(tmpDir);
    sync = new TaskGraphSync(graph, 'https://test.supabase.co', 'test-key', 'user-hash', 'project-hash', tmpDir);
    fetchCalls.length = 0;
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('syncs created and completed events to Supabase', async () => {
    graph.recordCreated('t1', 'gemini-reviewer', 'Review relay', ['code_review']);
    graph.recordCompleted('t1', 'Found 2 bugs', 15000);

    const result = await sync.sync();

    expect(result.events).toBeGreaterThanOrEqual(2);
    // created → INSERT into tasks
    const insert = fetchCalls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/tasks'));
    expect(insert).toBeDefined();
    expect(insert!.body.id).toBe('t1');
    expect(insert!.body.agent_id).toBe('gemini-reviewer');
    expect(insert!.body.status).toBe('created');
    // completed → UPSERT (POST with on_conflict)
    const completed = fetchCalls.find(c => c.body?.status === 'completed' && c.url.includes('on_conflict'));
    expect(completed).toBeDefined();
    expect(completed!.body.result).toBe('Found 2 bugs');
  });

  it('updates sync meta after successful sync', async () => {
    graph.recordCreated('t1', 'gemini-reviewer', 'Review relay', ['code_review']);
    await sync.sync();

    const meta = graph.getSyncMeta();
    expect(meta.lastSync).toBeTruthy();
    expect(meta.lastSyncEventCount).toBe(1);
  });

  it('only syncs events after last sync timestamp', async () => {
    graph.recordCreated('t1', 'agent-a', 'Old task', []);
    await sync.sync();
    fetchCalls.length = 0;

    graph.recordCreated('t2', 'agent-b', 'New task', []);
    const result = await sync.sync();

    expect(result.events).toBe(1);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].body.id).toBe('t2');
  });

  it('syncs decomposed events', async () => {
    graph.recordCreated('p1', 'orchestrator', 'Parent task', []);
    graph.recordDecomposed('p1', 'parallel', ['s1', 's2']);
    await sync.sync();

    const decomp = fetchCalls.find(c => c.url.includes('/rest/v1/task_decompositions'));
    expect(decomp).toBeDefined();
    expect(decomp!.body.parent_id).toBe('p1');
    expect(decomp!.body.sub_task_ids).toEqual(['s1', 's2']);
  });

  it('syncs reference events', async () => {
    graph.recordCreated('t1', 'agent-a', 'Found bug', []);
    graph.recordCreated('fix1', 'agent-b', 'Fix bug', []);
    graph.recordReference('fix1', 't1', 'fixes', 'commit abc123');
    await sync.sync();

    const ref = fetchCalls.find(c => c.url.includes('/rest/v1/task_references'));
    expect(ref).toBeDefined();
    expect(ref!.body.from_task_id).toBe('fix1');
    expect(ref!.body.relationship).toBe('fixes');
  });

  it('syncs failed events as UPSERT', async () => {
    graph.recordCreated('t1', 'agent-a', 'Task', []);
    graph.recordFailed('t1', 'Timeout error', 30000);
    await sync.sync();

    const failed = fetchCalls.find(c => c.body?.status === 'failed');
    expect(failed).toBeDefined();
    expect(failed!.body.error).toBe('Timeout error');
  });

  it('handles fetch errors gracefully without throwing', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
    graph.recordCreated('t1', 'agent-a', 'Task', []);

    // Should not throw — errors are captured, not propagated
    const result = await sync.sync();
    expect(result.events).toBe(0); // 0 because the event failed to sync
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Network error');
  });

  it('syncs cancelled events', async () => {
    graph.recordCreated('t1', 'agent-a', 'Task', []);
    graph.recordCancelled('t1', 'collect timeout', 120000);
    await sync.sync();

    const upserts = fetchCalls.filter(c => c.url.includes('/rest/v1/tasks'));
    const cancelled = upserts.find(c => c.body.status === 'cancelled');
    expect(cancelled).toBeDefined();
    expect(cancelled!.body.error).toBe('collect timeout');
  });

  it('handles 409 conflict gracefully on re-sync', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      new Response('{"message":"duplicate key"}', { status: 409 })
    );
    graph.recordCreated('t1', 'agent-a', 'Task', []);

    const result = await sync.sync();
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('409');
  });

  it('reports isConfigured correctly', () => {
    expect(sync.isConfigured()).toBe(true);
    const unconfigured = new TaskGraphSync(graph, '', '', 'u', 'p', tmpDir);
    expect(unconfigured.isConfigured()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/task-graph-sync.test.ts --config jest.config.base.js --verbose`
Expected: FAIL with "Cannot find module '../../packages/orchestrator/src/task-graph-sync'"

- [ ] **Step 3: Implement TaskGraphSync**

```typescript
// packages/orchestrator/src/task-graph-sync.ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { TaskGraph } from './task-graph';
import type {
  TaskGraphEvent, TaskCreatedEvent, TaskCompletedEvent,
  TaskFailedEvent, TaskCancelledEvent, TaskDecomposedEvent, TaskReferenceEvent,
} from './types';

export class TaskGraphSync {
  private readonly gossipDir: string;

  constructor(
    private graph: TaskGraph,
    private supabaseUrl: string,
    private supabaseKey: string,
    private userId: string,
    private projectId: string,
    projectRoot: string,
  ) {
    this.gossipDir = join(projectRoot, '.gossip');
  }

  isConfigured(): boolean {
    return !!(this.supabaseUrl && this.supabaseKey);
  }

  async sync(): Promise<{ events: number; scores: number; errors: string[] }> {
    if (!this.isConfigured()) return { events: 0, scores: 0, errors: ['Not configured'] };

    const meta = this.graph.getSyncMeta();
    const events = this.graph.getUnsynced(meta.lastSync);
    if (events.length === 0) return { events: 0, scores: 0, errors: [] };

    let synced = 0;
    const errors: string[] = [];

    for (const event of events) {
      try {
        await this.syncEvent(event);
        synced++;
      } catch (err) {
        errors.push(`${event.type}: ${(err as Error).message}`);
      }
    }

    // Sync agent performance scores
    let scores = 0;
    try {
      scores = await this.syncAgentScores();
    } catch (err) {
      errors.push(`agent_scores: ${(err as Error).message}`);
    }

    if (synced > 0) {
      this.graph.updateSyncMeta({
        lastSync: events[events.length - 1].timestamp,
        lastSyncEventCount: meta.lastSyncEventCount + synced,
      });
    }

    return { events: synced, scores, errors };
  }

  private async syncEvent(event: TaskGraphEvent): Promise<void> {
    switch (event.type) {
      case 'task.created':
        return this.syncCreated(event);
      case 'task.completed':
        return this.syncCompleted(event);
      case 'task.failed':
        return this.syncFailed(event);
      case 'task.cancelled':
        return this.syncCancelled(event);
      case 'task.decomposed':
        return this.syncDecomposed(event);
      case 'task.reference':
        return this.syncReference(event);
    }
  }

  private async syncCreated(event: TaskCreatedEvent): Promise<void> {
    // UPSERT: handles re-sync idempotently (on_conflict=id merges duplicates)
    await this.upsert('/rest/v1/tasks?on_conflict=id', {
      id: event.taskId,
      agent_id: event.agentId,
      task: event.task,
      skills: event.skills,
      parent_id: event.parentId || null,
      status: 'created',
      user_id: this.userId,
      project_id: this.projectId,
      created_at: event.timestamp,
    });
  }

  private async syncCompleted(event: TaskCompletedEvent): Promise<void> {
    await this.upsert('/rest/v1/tasks?on_conflict=id', {
      id: event.taskId,
      status: 'completed',
      result: event.result,
      duration_ms: event.duration,
      completed_at: event.timestamp,
    });
  }

  private async syncFailed(event: TaskFailedEvent): Promise<void> {
    await this.upsert('/rest/v1/tasks?on_conflict=id', {
      id: event.taskId,
      status: 'failed',
      error: event.error,
      duration_ms: event.duration,
      completed_at: event.timestamp,
    });
  }

  private async syncCancelled(event: TaskCancelledEvent): Promise<void> {
    await this.upsert('/rest/v1/tasks?on_conflict=id', {
      id: event.taskId,
      status: 'cancelled',
      error: event.reason,
      duration_ms: event.duration,
      completed_at: event.timestamp,
    });
  }

  private async syncDecomposed(event: TaskDecomposedEvent): Promise<void> {
    await this.upsert('/rest/v1/task_decompositions', {
      parent_id: event.parentId,
      strategy: event.strategy,
      sub_task_ids: event.subTaskIds,
      created_at: event.timestamp,
    });
  }

  private async syncReference(event: TaskReferenceEvent): Promise<void> {
    await this.upsert('/rest/v1/task_references', {
      from_task_id: event.fromTaskId,
      to_task_id: event.toTaskId,
      relationship: event.relationship,
      evidence: event.evidence || null,
      created_at: event.timestamp,
    });
  }

  async syncAgentScores(): Promise<number> {
    const perfPath = join(this.gossipDir, 'agent-performance.jsonl');
    if (!existsSync(perfPath)) return 0;
    const content = readFileSync(perfPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    // Only sync entries after lastSync timestamp
    const meta = this.graph.getSyncMeta();
    let synced = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (meta.lastSync && entry.timestamp <= meta.lastSync) continue;
        await this.upsert('/rest/v1/agent_scores', {
          user_id: this.userId,
          agent_id: entry.agentId,
          task_id: entry.taskId,
          skills: entry.skills || [],
          relevance: entry.scores?.relevance,
          accuracy: entry.scores?.accuracy,
          uniqueness: entry.scores?.uniqueness,
          source: 'judgment',
          created_at: entry.timestamp,
        });
        synced++;
      } catch { /* skip malformed entries */ }
    }
    return synced;
  }

  /** UPSERT via PostgREST — POST with merge-duplicates handles both insert and update */
  private async upsert(path: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.supabaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'apikey': this.supabaseKey,           // must be the non-privileged anon key
        'Authorization': `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`UPSERT ${path} failed: ${res.status} ${await res.text()}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/orchestrator/task-graph-sync.test.ts --config jest.config.base.js --verbose`
Expected: all 7 tests PASS

- [ ] **Step 5: Export from orchestrator index**

Add to `packages/orchestrator/src/index.ts`:
```typescript
export { TaskGraphSync } from './task-graph-sync';
```

- [ ] **Step 6: Run full test suite**

Run: `npx jest --config jest.config.base.js`
Expected: all 335+ tests pass, 0 regressions

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/task-graph-sync.ts packages/orchestrator/src/index.ts tests/orchestrator/task-graph-sync.test.ts
git commit -m "feat(task-graph): add TaskGraphSync for JSONL→Supabase translation"
```

---

### Task 2: Sync Trigger in Collect Pipeline

**Files:**
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts:~310` (after skill gap check)

The TaskGraph event recording is already done in collect (lines 265-274). We need to add the sync trigger.

- [ ] **Step 1: Write the failing test — sync triggers every 30 events**

Add to `tests/orchestrator/task-graph-sync.test.ts`:
```typescript
it('returns event count correctly for sync threshold checking', () => {
  // The DispatchPipeline checks: graph.getEventCount() - syncMeta.lastSyncEventCount >= 30
  // This test verifies the math works
  for (let i = 0; i < 30; i++) {
    graph.recordCreated(`t${i}`, 'agent', `Task ${i}`, []);
  }
  expect(graph.getEventCount()).toBe(30);
  const meta = graph.getSyncMeta();
  expect(graph.getEventCount() - meta.lastSyncEventCount).toBe(30);
});
```

- [ ] **Step 2: Run test to verify it passes** (this is a sanity check on existing code)

Run: `npx jest tests/orchestrator/task-graph-sync.test.ts --config jest.config.base.js --verbose -t "event count"`
Expected: PASS

- [ ] **Step 3: Add sync trigger to DispatchPipeline collect**

In `packages/orchestrator/src/dispatch-pipeline.ts`, add after the skill gap check (after line ~320):

```typescript
    // 5. Sync threshold check (every 30 events)
    try {
      const eventCount = this.taskGraph.getEventCount();
      const syncMeta = this.taskGraph.getSyncMeta();
      if (eventCount - syncMeta.lastSyncEventCount >= 30 && this.syncFactory) {
        const sync = this.syncFactory();
        if (sync?.isConfigured()) {
          sync.sync().catch(err =>
            log(`Supabase sync failed: ${(err as Error).message}`)
          );
        }
      }
    } catch (err) { log(`Sync check failed: ${(err as Error).message}`); }
```

Also add to `DispatchPipelineConfig`:
```typescript
  syncFactory?: () => TaskGraphSync | null;
```

And to the constructor:
```typescript
  private syncFactory: (() => TaskGraphSync | null) | null;
  // In constructor:
  this.syncFactory = config.syncFactory ?? null;
```

Import `TaskGraphSync` at the top of the file — must be a **value import** (not `import type`) since the factory returns an instance:
```typescript
import { TaskGraphSync } from './task-graph-sync';
```

- [ ] **Step 4: Run full test suite**

Run: `npx jest --config jest.config.base.js`
Expected: all tests pass. The sync factory is optional so existing tests are unaffected.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/dispatch-pipeline.ts
git commit -m "feat(dispatch): add Supabase sync trigger every 30 events in collect pipeline"
```

---

### Task 3: CLI Sync Command

> **Dependency:** Task 1 must be completed first — this imports `TaskGraphSync` from `@gossip/orchestrator`.

**Files:**
- Create: `apps/cli/src/sync-command.ts`
- Modify: `apps/cli/src/index.ts`

- [ ] **Step 1: Create sync-command.ts**

```typescript
// apps/cli/src/sync-command.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { TaskGraph, TaskGraphSync } from '@gossip/orchestrator';
import { Keychain } from './keychain';

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
};

interface SupabaseConfig {
  url: string;
  projectRef: string;
}

function loadSupabaseConfig(): SupabaseConfig | null {
  const configPath = join(process.cwd(), '.gossip', 'supabase.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch { return null; }
}

function saveSupabaseConfig(config: SupabaseConfig): void {
  const gossipDir = join(process.cwd(), '.gossip');
  mkdirSync(gossipDir, { recursive: true });
  writeFileSync(join(gossipDir, 'supabase.json'), JSON.stringify(config, null, 2));
}

function getOrCreateSalt(): string {
  const saltPath = join(process.cwd(), '.gossip', 'local-salt');
  if (existsSync(saltPath)) return readFileSync(saltPath, 'utf-8').trim();
  const { randomBytes } = require('crypto');
  const salt = randomBytes(16).toString('hex');
  mkdirSync(join(process.cwd(), '.gossip'), { recursive: true });
  writeFileSync(saltPath, salt);
  return salt;
}

function getUserId(): string {
  try {
    const { execFileSync } = require('child_process');
    const email = execFileSync('git', ['config', 'user.email'], { stdio: 'pipe' }).toString().trim();
    const salt = getOrCreateSalt();
    return createHash('sha256').update(email + process.cwd() + salt).digest('hex').slice(0, 16);
  } catch { return 'anonymous'; }
}

function getProjectId(): string {
  return createHash('sha256').update(process.cwd()).digest('hex').slice(0, 16);
}

export async function runSyncCommand(args: string[]): Promise<void> {
  const flag = args[0];

  if (flag === '--setup') {
    await runSetup();
    return;
  }

  if (flag === '--status') {
    showStatus();
    return;
  }

  // Default: run sync now
  const config = loadSupabaseConfig();
  if (!config) {
    console.log(`${c.yellow}Supabase not configured.${c.reset} Run: gossipcat sync --setup`);
    return;
  }

  const keychain = new Keychain();
  const key = await keychain.getKey('supabase');
  if (!key) {
    console.log(`${c.red}No Supabase API key found in keychain.${c.reset} Run: gossipcat sync --setup`);
    return;
  }

  const graph = new TaskGraph(process.cwd());
  const sync = new TaskGraphSync(graph, config.url, key, getUserId(), getProjectId(), process.cwd());

  console.log('Syncing to Supabase...');
  const result = await sync.sync();

  if (result.errors.length) {
    console.log(`${c.yellow}Synced ${result.events} events with ${result.errors.length} errors:${c.reset}`);
    for (const err of result.errors) console.log(`  ${c.red}${err}${c.reset}`);
  } else {
    console.log(`${c.green}Synced ${result.events} events.${c.reset}`);
  }
}

function showStatus(): void {
  const config = loadSupabaseConfig();
  const graph = new TaskGraph(process.cwd());
  const meta = graph.getSyncMeta();

  console.log(`\n${c.bold}Sync Status${c.reset}\n`);
  console.log(`  Supabase: ${config ? `${c.green}configured${c.reset} (${config.url})` : `${c.dim}not configured${c.reset}`}`);
  console.log(`  Total events: ${graph.getEventCount()}`);
  console.log(`  Last sync: ${meta.lastSync || 'never'}`);
  console.log(`  Synced events: ${meta.lastSyncEventCount}`);
  console.log(`  Pending: ${graph.getEventCount() - meta.lastSyncEventCount}`);
  console.log('');
}

async function runSetup(): Promise<void> {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

  console.log(`\n${c.bold}Supabase Sync Setup${c.reset}\n`);

  const existing = loadSupabaseConfig();
  if (existing) {
    console.log(`  Existing config: ${existing.url}`);
    const overwrite = await ask('  Overwrite? (y/N) ');
    if (overwrite.toLowerCase() !== 'y') { rl.close(); return; }
  }

  const url = await ask(`  Supabase URL (e.g. https://xxx.supabase.co): `);
  if (!url.startsWith('https://')) {
    console.log(`${c.red}URL must start with https://${c.reset}`);
    rl.close(); return;
  }

  const ref = url.replace('https://', '').replace('.supabase.co', '');
  const key = await ask(`  Supabase anon key: `);
  if (!key) { console.log(`${c.red}Key required.${c.reset}`); rl.close(); return; }

  rl.close();

  // Save config
  saveSupabaseConfig({ url, projectRef: ref });

  // Save key to keychain
  const keychain = new Keychain();
  await keychain.setKey('supabase', key);

  console.log(`\n${c.green}Supabase configured.${c.reset}`);
  console.log(`  Config: .gossip/supabase.json`);
  console.log(`  Key: stored in keychain`);
  console.log(`\n  Run the migration SQL in your Supabase dashboard:`);
  console.log(`  ${c.dim}See docs/superpowers/specs/2026-03-21-taskgraph-supabase-design.md § Component 3${c.reset}`);
  console.log(`\n  Then run: ${c.cyan}gossipcat sync${c.reset} to sync existing events.\n`);
}
```

- [ ] **Step 2: Register sync command in CLI index**

In `apps/cli/src/index.ts`, add after the `tasks` case:
```typescript
    case 'sync': {
      const { runSyncCommand } = await import('./sync-command');
      await runSyncCommand(process.argv.slice(3));
      return;
    }
```

Update `printHelp()` to include:
```
    gossipcat sync             Sync task history to Supabase
    gossipcat sync --setup     Configure Supabase connection
    gossipcat sync --status    Show sync status
```

- [ ] **Step 3: Add .gossip/supabase.json to .gitignore**

Check `.gitignore` for existing `.gossip/` entries. If `.gossip/supabase.json` isn't covered, add it.

- [ ] **Step 4: Run full test suite**

Run: `npx jest --config jest.config.base.js`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/sync-command.ts apps/cli/src/index.ts
git commit -m "feat(cli): add gossipcat sync command for Supabase setup and manual sync"
```

---

### Task 4: Supabase Migration SQL

**Files:**
- Create: `docs/migrations/001-taskgraph-schema.sql`

- [ ] **Step 1: Create migration file**

```sql
-- TaskGraph Supabase Schema
-- Run via Supabase dashboard SQL editor or gossipcat sync --setup
-- See: docs/superpowers/specs/2026-03-21-taskgraph-supabase-design.md

-- Core task table
CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  agent_id text NOT NULL,
  task text NOT NULL,
  skills text[],
  parent_id text REFERENCES tasks(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('created', 'completed', 'failed', 'cancelled')),
  result text,
  error text,
  duration_ms integer,
  user_id text NOT NULL,
  project_id text NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

-- Decomposition records
CREATE TABLE IF NOT EXISTS task_decompositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  strategy text NOT NULL CHECK (strategy IN ('single', 'parallel', 'sequential')),
  sub_task_ids text[] NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decomp_parent ON task_decompositions(parent_id);

-- Cross-references between tasks
CREATE TABLE IF NOT EXISTS task_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  relationship text NOT NULL CHECK (relationship IN ('triggered_by', 'fixes', 'follows_up', 'related_to')),
  evidence text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refs_from ON task_references(from_task_id);
CREATE INDEX IF NOT EXISTS idx_refs_to ON task_references(to_task_id);

-- Agent performance scores (from ATI spec — co-located)
CREATE TABLE IF NOT EXISTS agent_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  agent_id text NOT NULL,
  task_id text REFERENCES tasks(id) ON DELETE CASCADE,
  task_type text,
  skills text[],
  lens text,
  relevance smallint CHECK (relevance BETWEEN 1 AND 5),
  accuracy smallint CHECK (accuracy BETWEEN 1 AND 5),
  uniqueness smallint CHECK (uniqueness BETWEEN 1 AND 5),
  source text CHECK (source IN ('judgment', 'outcome')),
  event text,
  evidence text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scores_agent ON agent_scores(agent_id);
CREATE INDEX IF NOT EXISTS idx_scores_task ON agent_scores(task_id);
CREATE INDEX IF NOT EXISTS idx_scores_user ON agent_scores(user_id);

-- RLS policies (enable row-level security)
-- NOTE: Policies use USING(true) — single-tenant assumption.
-- For multi-tenant deployments, replace with user_id-based filtering
-- and Supabase Auth JWT claims. Deferred until auth is implemented.
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_decompositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access (single-tenant)" ON tasks
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access (single-tenant)" ON task_decompositions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access (single-tenant)" ON task_references
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access (single-tenant)" ON agent_scores
  FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Commit**

```bash
git add docs/migrations/001-taskgraph-schema.sql
git commit -m "docs: add Supabase migration SQL for TaskGraph schema"
```

---

### Task 5: Wire Sync Factory into MCP Boot

**Files:**
- Modify: `packages/orchestrator/src/main-agent.ts:75` (DispatchPipeline constructor)
- Modify: `packages/orchestrator/src/main-agent.ts:~55` (MainAgentConfig)
- Modify: `apps/cli/src/mcp-server-sdk.ts` (boot function — cache Supabase key)

**Context:** `MainAgent` creates `DispatchPipeline` at line 75 of `main-agent.ts`. The pipeline config needs a `syncFactory`. The factory must be sync (called from the collect pipeline), so the async Supabase keychain read must be cached at MCP boot time.

- [ ] **Step 1: Add syncFactory to MainAgentConfig**

In `packages/orchestrator/src/main-agent.ts`, add to the `MainAgentConfig` interface:
```typescript
  syncFactory?: () => TaskGraphSync | null;
```

And thread it into the DispatchPipeline constructor (line 75):
```typescript
    this.pipeline = new DispatchPipeline({
      projectRoot: this.projectRoot,
      workers: this.workers,
      registryGet: (id) => this.registry.get(id),
      llm: this.llm,
      syncFactory: config.syncFactory,
    });
```

Add the import at the top:
```typescript
import { TaskGraphSync } from './task-graph-sync';
```

- [ ] **Step 2: Wire sync factory in MCP boot**

In `apps/cli/src/mcp-server-sdk.ts`, the `boot()` function creates the `MainAgent`. After the keychain reads for LLM providers (around line ~70-100), add:

```typescript
// Cache Supabase key at boot (sync factory needs it synchronously)
import { existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { TaskGraph, TaskGraphSync } from '@gossip/orchestrator';

let supaKeyCache: string | null = null;

// Inside boot(), after keychain.getKey calls:
supaKeyCache = await keychain.getKey('supabase');

// In MainAgent config object:
syncFactory: () => {
  try {
    const configPath = join(process.cwd(), '.gossip', 'supabase.json');
    if (!existsSync(configPath) || !supaKeyCache) return null;
    const supaConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    const saltPath = join(process.cwd(), '.gossip', 'local-salt');
    const salt = existsSync(saltPath) ? readFileSync(saltPath, 'utf-8').trim() : '';
    const email = execFileSync('git', ['config', 'user.email'], { stdio: 'pipe' }).toString().trim();
    const userId = createHash('sha256').update(email + process.cwd() + salt).digest('hex').slice(0, 16);
    const projectId = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 16);
    return new TaskGraphSync(new TaskGraph(process.cwd()), supaConfig.url, supaKeyCache, userId, projectId, process.cwd());
  } catch { return null; }
},
```

- [ ] **Step 3: Run full test suite + rebuild MCP**

Run: `npx jest --config jest.config.base.js && npm run build:mcp`
Expected: all tests pass, MCP bundle rebuilt

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/main-agent.ts apps/cli/src/mcp-server-sdk.ts
git commit -m "feat(mcp): wire Supabase syncFactory into dispatch pipeline for auto-sync"
```

---

### Task 6: Integration Test — End-to-End Sync

- [ ] **Step 1: Manual E2E verification**

1. Run `gossipcat sync --status` — should show "not configured"
2. Dispatch a few tasks via `gossip_dispatch` + `gossip_collect`
3. Run `gossipcat tasks` — verify events are in JSONL
4. If Supabase is configured: run `gossipcat sync` — verify events land in Supabase
5. Run `gossipcat sync --status` — should show synced count

- [ ] **Step 2: Rebuild MCP bundle**

```bash
npm run build:mcp
```

- [ ] **Step 3: Final commit**

```bash
git add dist-mcp/mcp-server.js
git commit -m "build: rebuild MCP bundle with Supabase sync support"
```
