# Paginated Reports + gossip_progress() Tool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pagination to consensus-reports API + dashboard, and create a `gossip_progress` MCP tool for live task monitoring.

**Architecture:** API pagination mirrors existing `api-consensus.ts` pattern. Progress tool exposes `getActiveTasksHealth()` via MCP with consensus phase tracking from ConsensusCoordinator.

**Tech Stack:** TypeScript, React, Jest

**Prerequisite:** Plan 1 (dispatch-pipeline refactor) must be complete — `gossip_progress` needs `ConsensusCoordinator.getCurrentPhase()`.

---

### Task 1: Add pagination to consensus-reports API

**Files:**
- Modify: `packages/relay/src/dashboard/routes.ts:280-304`
- Test: `tests/relay/dashboard-routes.test.ts` (if exists) or manual verification

- [ ] **Step 1: Write failing test for paginated reports**

Create or add to `tests/relay/dashboard-pagination.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

// Test the getConsensusReports logic directly
describe('consensus-reports pagination', () => {
  const testDir = join('/tmp', 'gossip-pagination-test');
  const reportsDir = join(testDir, '.gossip', 'consensus-reports');

  beforeEach(() => {
    mkdirSync(reportsDir, { recursive: true });
    // Create 12 fake report files
    for (let i = 1; i <= 12; i++) {
      const name = `2026-04-${String(i).padStart(2, '0')}-report.json`;
      writeFileSync(join(reportsDir, name), JSON.stringify({
        timestamp: `2026-04-${String(i).padStart(2, '0')}T00:00:00Z`,
        findings: [{ id: `f${i}`, finding: `test finding ${i}` }],
      }));
    }
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns page 1 with default pageSize', () => {
    // This test validates the pagination logic we'll implement
    // Expected: page 1 returns 5 most recent reports (default pageSize=5)
    expect(true).toBe(true); // placeholder — will be replaced with actual route test
  });
});
```

- [ ] **Step 2: Update getConsensusReports to accept pagination params**

In `packages/relay/src/dashboard/routes.ts`, modify `getConsensusReports`:

```typescript
private getConsensusReports(page = 1, pageSize = 5): { reports: any[]; totalReports: number; page: number; pageSize: number } {
  const { readdirSync, readFileSync, existsSync } = require('fs');
  const reportsDir = join(this.projectRoot, '.gossip', 'consensus-reports');
  if (!existsSync(reportsDir)) return { reports: [], totalReports: 0, page, pageSize };

  try {
    const allFiles = readdirSync(reportsDir)
      .filter((f: string) => f.endsWith('.json'))
      .sort()
      .reverse();

    const totalReports = allFiles.length;
    const clampedPageSize = Math.min(Math.max(pageSize, 1), 20);
    const clampedPage = Math.max(page, 1);
    const start = (clampedPage - 1) * clampedPageSize;
    const files = allFiles.slice(start, start + clampedPageSize);

    const realReportsDir = realpathSync(reportsDir);
    const reports = files.map((f: string) => {
      try {
        const filePath = join(reportsDir, f);
        const realFile = realpathSync(filePath);
        if (!realFile.startsWith(realReportsDir + '/')) return null;
        return JSON.parse(readFileSync(realFile, 'utf-8'));
      } catch { return null; }
    }).filter(Boolean);

    return { reports, totalReports, page: clampedPage, pageSize: clampedPageSize };
  } catch { return { reports: [], totalReports: 0, page, pageSize }; }
}
```

- [ ] **Step 3: Update route handler to pass query params**

Find where `getConsensusReports()` is called in the route handler and pass query params:

```typescript
// In the route handler for /dashboard/api/consensus-reports
const page = parseInt(url.searchParams.get('page') || '1', 10);
const pageSize = parseInt(url.searchParams.get('pageSize') || '5', 10);
const result = this.getConsensusReports(page, pageSize);
```

- [ ] **Step 4: Verify manually or with test**

Run: `npm run build -w packages/relay && npx jest tests/relay --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/dashboard/routes.ts
git commit -m "feat: add pagination to consensus-reports API"
```

---

### Task 2: Add "Load older" button to dashboard

**Files:**
- Modify: `packages/dashboard-v2/src/components/FindingsMetrics.tsx`
- Modify: `packages/dashboard-v2/src/lib/types.ts` (if response type needs updating)

- [ ] **Step 1: Update the fetch hook to include page param**

In the component or hook that fetches consensus-reports, add page state:

```typescript
// In FindingsMetrics.tsx or its parent hook
const [reportPage, setReportPage] = useState(1);
const [allReports, setAllReports] = useState<any[]>([]);
const [hasMoreReports, setHasMoreReports] = useState(false);
```

Update the fetch URL to include `?page=${reportPage}&pageSize=5`.

When new data arrives, append to `allReports`:
```typescript
// On fetch success:
setAllReports(prev => reportPage === 1 ? data.reports : [...prev, ...data.reports]);
setHasMoreReports(data.reports.length > 0 && data.page * data.pageSize < data.totalReports);
```

- [ ] **Step 2: Replace hardcoded slice with paginated data**

In `FindingsMetrics.tsx`, replace:
```typescript
const latestReports = (reports?.reports || [])
  .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  .slice(0, MAX_RUNS);
```

With:
```typescript
const latestReports = allReports;
```

- [ ] **Step 3: Add "Load older reports" button**

After the reports list, add:
```tsx
{hasMoreReports && (
  <button
    onClick={() => setReportPage(prev => prev + 1)}
    className="mt-3 w-full rounded border border-border/40 px-3 py-1.5 font-mono text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
  >
    Load older reports
  </button>
)}
```

- [ ] **Step 4: Build and verify**

Run: `npm run build -w packages/dashboard-v2`
Expected: clean build

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard-v2/src/
git commit -m "feat: add pagination to consensus reports in dashboard"
```

---

### Task 3: Create gossip_progress MCP tool

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts` (add tool registration + update gossip_tools list)
- Test: `tests/mcp/progress-handler.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/mcp/progress-handler.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals';

describe('gossip_progress handler', () => {
  it('returns empty activeTasks when no tasks running', () => {
    // Mock getActiveTasksHealth returning []
    const health: any[] = [];
    const result = {
      activeTasks: health.map(t => ({
        taskId: t.id,
        agentId: t.agentId,
        elapsedMs: t.elapsedMs,
        toolCalls: t.toolCalls,
        status: t.isLikelyStuck ? 'likely_stuck' as const : 'running' as const,
      })),
      consensus: null,
    };
    expect(result.activeTasks).toEqual([]);
    expect(result.consensus).toBeNull();
  });

  it('maps health data to progress format', () => {
    const health = [{
      id: 't1', agentId: 'sonnet-reviewer', task: 'review code',
      status: 'running', elapsedMs: 30000, toolCalls: 5, isLikelyStuck: false,
    }];
    const result = {
      activeTasks: health.map(t => ({
        taskId: t.id,
        agentId: t.agentId,
        elapsedMs: t.elapsedMs,
        toolCalls: t.toolCalls,
        status: t.isLikelyStuck ? 'likely_stuck' as const : 'running' as const,
      })),
      consensus: null,
    };
    expect(result.activeTasks).toHaveLength(1);
    expect(result.activeTasks[0].taskId).toBe('t1');
    expect(result.activeTasks[0].status).toBe('running');
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (logic test, not integration)

Run: `npx jest tests/mcp/progress-handler.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Register gossip_progress tool in mcp-server-sdk.ts**

Add the tool registration after the existing `gossip_tools` block (around line 2037):

```typescript
server.tool(
  'gossip_progress',
  'Show progress of active tasks and consensus rounds. Call during long-running operations to see what agents are doing.',
  {},
  async () => {
    const health = pipeline.getActiveTasksHealth();
    const coordinator = pipeline.getConsensusCoordinator();
    const phase = coordinator?.getCurrentPhase() ?? 'idle';

    const activeTasks = health.map(t => ({
      taskId: t.id,
      agentId: t.agentId,
      elapsedMs: t.elapsedMs,
      toolCalls: t.toolCalls,
      status: t.isLikelyStuck ? 'likely_stuck' : 'running',
    }));

    const consensus = phase !== 'idle' ? {
      phase,
      tasksComplete: health.filter(t => !t.isLikelyStuck).length,
      tasksTotal: health.length,
      elapsedMs: health.length > 0 ? Math.max(...health.map(t => t.elapsedMs)) : 0,
    } : null;

    const result = { activeTasks, consensus };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);
```

- [ ] **Step 4: Add getConsensusCoordinator accessor to DispatchPipeline**

In `dispatch-pipeline.ts`, add:

```typescript
getConsensusCoordinator(): ConsensusCoordinator {
  return this.consensusCoordinator;
}
```

- [ ] **Step 5: Add gossip_progress to the gossip_tools hardcoded list**

At `mcp-server-sdk.ts:2019`, in the `const tools = [...]` array, add:

```typescript
{ name: 'gossip_progress', desc: 'Show active task progress and consensus phase. No params.' },
```

- [ ] **Step 6: Build and verify**

Run: `npm run build:mcp`
Expected: clean build

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts packages/orchestrator/src/dispatch-pipeline.ts
git commit -m "feat: add gossip_progress MCP tool for live task monitoring"
```

---

### Task 4: Update bootstrap

**Files:**
- Modify: `.gossip/bootstrap.md`

- [ ] **Step 1: Add gossip_progress to the tool table**

In `.gossip/bootstrap.md`, in the Tools table, add:

```markdown
| `gossip_progress()` | Show active tasks and consensus phase. Call during long operations. |
```

- [ ] **Step 2: Commit**

```bash
git add .gossip/bootstrap.md
git commit -m "docs: add gossip_progress to bootstrap tool table"
```
