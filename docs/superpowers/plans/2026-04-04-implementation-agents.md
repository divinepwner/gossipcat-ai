# Implementation Agents Activation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing write-mode machinery usable by removing artificial constraints and adding safe verification tools.

**Architecture:** Fix task decomposition prompt to allow 3-5 parallel tasks, create dedicated `run_tests` and `run_typecheck` tools (NOT a shell allowlist — command injection risk), document the scoped-agent contract.

**Tech Stack:** TypeScript, Jest

**Prerequisite:** Plan 1 (dispatch-pipeline refactor) should be complete since this touches dispatch-pipeline.ts.

---

### Task 1: Fix task decomposition prompt

**Files:**
- Modify: `packages/orchestrator/src/task-dispatcher.ts:30-59`

- [ ] **Step 1: Read the current decomposition prompt**

Read `packages/orchestrator/src/task-dispatcher.ts` lines 30-59 to see the full prompt template.

- [ ] **Step 2: Update the prompt rules**

Replace lines 35-49 (the Rules section) with:

```typescript
## Rules

1. **Decompose by file scope.** Split implementation into 3-5 tasks, each owning a non-overlapping set of files or directories. One task = one scope.

2. **Use the full team in parallel.** If researchers and reviewers are available, give them work alongside implementers:
   - Researcher: investigate APIs, find examples, check docs — runs in parallel with implementation
   - Reviewer: review the completed code — runs after implementation (sequential)

3. **Describe WHAT, not HOW.** The agent decides file structure, components, architecture.

4. **3-5 tasks max.** Typical patterns:
   - Small feature → single implementer (1 task)
   - Medium feature → 2-3 scoped implementers in parallel
   - Large feature → 3-5 scoped implementers + researcher + reviewer
   - Each implementation task should specify its file scope (e.g., "packages/relay/src/dashboard/")
```

- [ ] **Step 3: Run any existing decomposition tests**

Run: `npx jest tests/orchestrator/task-dispatcher --no-coverage`
Expected: PASS (or no tests exist — this is a prompt change, not logic)

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/task-dispatcher.ts
git commit -m "feat: update decomposition prompt to allow 3-5 scoped parallel tasks"
```

---

### Task 2: Create run_tests verification tool

**Files:**
- Modify: `packages/tools/src/tool-server.ts`
- Test: `tests/tools/run-tests-tool.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/tools/run-tests-tool.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals';

describe('run_tests tool validation', () => {
  it('rejects --config flag to prevent injection', () => {
    const args = { fileGlob: 'src/**/*.test.ts', extraArgs: '--config malicious.js' };
    const hasBlockedFlag = /--config|--setupFiles|--globalSetup|--transform/.test(args.extraArgs || '');
    expect(hasBlockedFlag).toBe(true);
  });

  it('accepts a clean file glob', () => {
    const args = { fileGlob: 'src/utils.test.ts' };
    const hasBlockedFlag = /--config|--setupFiles|--globalSetup|--transform/.test(args.fileGlob || '');
    expect(hasBlockedFlag).toBe(false);
  });

  it('rejects path traversal in glob', () => {
    const args = { fileGlob: '../../../etc/passwd' };
    const hasTraversal = /\.\.\//.test(args.fileGlob);
    expect(hasTraversal).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx jest tests/tools/run-tests-tool.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Register run_tests tool in tool-server.ts**

In `packages/tools/src/tool-server.ts`, add a new tool registration for `run_tests`. This is a dedicated tool, not a shell_exec allowlist:

```typescript
// Add to the tool registration section
this.registerTool('run_tests', {
  description: 'Run Jest tests on specified files. Safe for scoped agents — ignores custom configs.',
  parameters: {
    fileGlob: { type: 'string', description: 'Test file glob pattern (e.g., "src/**/*.test.ts")' },
  },
  handler: async (args: Record<string, unknown>, callerId: string) => {
    const fileGlob = args.fileGlob as string;
    if (!fileGlob) throw new Error('fileGlob is required');

    // Block path traversal
    if (/\.\.\//.test(fileGlob)) {
      throw new Error('Path traversal not allowed in fileGlob');
    }

    // Block injection via flags masquerading as file paths
    if (/^--/.test(fileGlob)) {
      throw new Error('fileGlob must be a file path, not a flag');
    }

    // Run jest with locked-down config — no custom config, no setup files
    const { execSync } = require('child_process');
    const scope = this.getAgentScope(callerId);
    const cwd = scope || this.projectRoot;

    try {
      const output = execSync(
        `npx jest "${fileGlob}" --no-coverage --passWithNoTests --no-cache`,
        { cwd, timeout: 60_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return { success: true, output: output.slice(0, 4000) };
    } catch (err: any) {
      return { success: false, output: (err.stdout || err.stderr || err.message || '').slice(0, 4000) };
    }
  },
});
```

- [ ] **Step 4: Register run_typecheck tool**

```typescript
this.registerTool('run_typecheck', {
  description: 'Run TypeScript type checking. Safe for scoped agents — uses project tsconfig only.',
  parameters: {},
  handler: async (_args: Record<string, unknown>, callerId: string) => {
    const { execSync } = require('child_process');
    const scope = this.getAgentScope(callerId);
    const cwd = scope || this.projectRoot;

    try {
      const output = execSync(
        'npx tsc --noEmit',
        { cwd, timeout: 120_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return { success: true, output: output.slice(0, 4000) };
    } catch (err: any) {
      return { success: false, output: (err.stdout || err.stderr || err.message || '').slice(0, 4000) };
    }
  },
});
```

- [ ] **Step 5: Add a read-only shell allowlist for git status/diff**

In the shell_exec block at line 170-174, replace the full block for scoped agents:

```typescript
if (toolName === 'shell_exec') {
  if (scope) {
    // Allow ONLY read-only git commands for scoped agents
    const cmd = (args.command as string || '').trim();
    const isReadOnlyGit = /^git\s+(status|diff|log|show)\b/.test(cmd);
    if (!isReadOnlyGit) {
      throw new Error('shell_exec is restricted in scoped write mode. Only git status/diff/log/show are allowed. Use run_tests and run_typecheck for verification.');
    }
  }
  // ... existing worktree checks below
```

- [ ] **Step 6: Run tests**

Run: `npx jest tests/tools/ --no-coverage`
Expected: PASS

- [ ] **Step 7: Build**

Run: `npm run build -w packages/tools`
Expected: clean

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/tool-server.ts tests/tools/run-tests-tool.test.ts
git commit -m "feat: add run_tests and run_typecheck tools for scoped agents, restrict shell_exec to read-only git"
```

---

### Task 3: Document the scoped-agent contract

**Files:**
- Modify: `CLAUDE.md` (add to the Write Modes section or create new section)

- [ ] **Step 1: Add scoped-agent documentation**

Add a section to CLAUDE.md under the existing dispatch rules:

```markdown
## Scoped Agent Contract

When an agent is dispatched with `write_mode: "scoped"`:
- **Can:** `file_write`, `file_delete` (within scope), `file_read` (anywhere), `run_tests`, `run_typecheck`, `git status/diff/log/show`
- **Cannot:** `shell_exec` (except read-only git), `git_commit`, `git_branch`
- **Orchestrator commits** on behalf of scoped agents after verifying their output
- **Worktree agents** have full shell + git access within their isolated branch

This is intentional: scoped agents write files, the orchestrator validates and commits.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document scoped-agent tool permissions contract"
```

---

### Task 4: Verify end-to-end with a test dispatch

- [ ] **Step 1: Test gossip_plan with a sample task**

Call `gossip_plan(task: "Add a health check endpoint to packages/relay/src/dashboard/routes.ts that returns { status: 'ok', uptime: process.uptime() }")` and verify:
- Decomposition produces 2+ tasks (not 1 monolithic task)
- Each task has a file scope suggestion
- Write modes are suggested

- [ ] **Step 2: Verify run_tests is available to agents**

After `/mcp reconnect`, call `gossip_tools()` and confirm `run_tests` and `run_typecheck` appear in the tool list (they should be registered by the tool-server, not the MCP tools list — verify the tool-server exposes them to agents).

- [ ] **Step 3: Record results**

If decomposition works: no commit needed.
If issues found: fix and commit.
