# Freeform Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded 4-value `preset` enum with a freeform `role` string and fix the native dispatch prompt to use `.claude/agents/<id>.md` instructions.

**Architecture:** Rename `preset` → `role` across schema/config/boot, delete `inferPreset()` and `presetPrompts`, use `config.instructions` for native agent prompts, flatten importance scores to a universal default.

**Tech Stack:** TypeScript, Zod, MCP SDK

---

## File Structure

| File | Responsibility |
|------|---------------|
| `apps/cli/src/mcp-server-sdk.ts` | MCP tool handlers — schema, config writes, native dispatch prompt, boot |
| `apps/cli/src/mcp-context.ts` | Shared context — `presetScores()` → `defaultImportanceScores()` |
| `apps/cli/src/config.ts` | Config loading — `inferPreset()` deletion, `claudeSubagentsToConfigs()` |
| `apps/cli/src/handlers/native-tasks.ts` | Native task relay — calls importance scoring |
| `tests/cli/mcp-server-sdk.test.ts` | Tests for scoring function |

---

### Task 1: Replace `presetScores()` with `defaultImportanceScores()`

**Files:**
- Modify: `apps/cli/src/mcp-context.ts:66-74`
- Modify: `apps/cli/src/handlers/native-tasks.ts:234`
- Modify: `apps/cli/src/mcp-server-sdk.ts:11` (import)
- Modify: `tests/cli/mcp-server-sdk.test.ts:79-101`

- [ ] **Step 1: Update the test to match new function**

In `tests/cli/mcp-server-sdk.test.ts`, replace lines 79-101:

```typescript
function defaultImportanceScores(): { relevance: number; accuracy: number; uniqueness: number } {
  return { relevance: 3, accuracy: 3, uniqueness: 3 };
}

describe('defaultImportanceScores', () => {
    it('should return flat default scores', () => {
        expect(defaultImportanceScores()).toEqual({ relevance: 3, accuracy: 3, uniqueness: 3 });
    });

    it('should return a new object each call', () => {
        const a = defaultImportanceScores();
        const b = defaultImportanceScores();
        expect(a).toEqual(b);
        expect(a).not.toBe(b);
    });
});
```

- [ ] **Step 2: Run test to verify it passes (test is self-contained)**

Run: `npx jest tests/cli/mcp-server-sdk.test.ts --no-coverage`
Expected: PASS (the test uses a local function copy, same as before)

- [ ] **Step 3: Replace `presetScores` in `mcp-context.ts`**

In `apps/cli/src/mcp-context.ts`, replace lines 66-74:

```typescript
export function presetScores(preset: string): { relevance: number; accuracy: number; uniqueness: number } {
  switch (preset) {
    case 'reviewer':   return { relevance: 3, accuracy: 5, uniqueness: 4 };
    case 'tester':     return { relevance: 3, accuracy: 4, uniqueness: 4 };
    case 'researcher': return { relevance: 4, accuracy: 3, uniqueness: 5 };
    case 'implementer': return { relevance: 5, accuracy: 3, uniqueness: 2 };
    default:           return { relevance: 3, accuracy: 3, uniqueness: 3 };
  }
}
```

With:

```typescript
export function defaultImportanceScores(): { relevance: number; accuracy: number; uniqueness: number } {
  return { relevance: 3, accuracy: 3, uniqueness: 3 };
}
```

- [ ] **Step 4: Update the import in `mcp-server-sdk.ts`**

In `apps/cli/src/mcp-server-sdk.ts:11`, change:

```typescript
import { ctx, presetScores, NATIVE_TASK_TTL_MS } from './mcp-context';
```

To:

```typescript
import { ctx, defaultImportanceScores, NATIVE_TASK_TTL_MS } from './mcp-context';
```

- [ ] **Step 5: Update the call site in `native-tasks.ts`**

In `apps/cli/src/handlers/native-tasks.ts:5`, change:

```typescript
import { ctx, NATIVE_TASK_TTL_MS, presetScores } from '../mcp-context';
```

To:

```typescript
import { ctx, NATIVE_TASK_TTL_MS, defaultImportanceScores } from '../mcp-context';
```

At line 234, change:

```typescript
const scores = presetScores(agentMeta.preset);
```

To:

```typescript
const scores = defaultImportanceScores();
```

- [ ] **Step 6: Run tests**

Run: `npx jest tests/cli/mcp-server-sdk.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/mcp-context.ts apps/cli/src/mcp-server-sdk.ts apps/cli/src/handlers/native-tasks.ts tests/cli/mcp-server-sdk.test.ts
git commit -m "refactor: replace presetScores with flat defaultImportanceScores"
```

---

### Task 2: Delete `inferPreset()` and update `claudeSubagentsToConfigs()`

**Files:**
- Modify: `apps/cli/src/config.ts:180-197`

- [ ] **Step 1: Delete `inferPreset()` and update `claudeSubagentsToConfigs()`**

In `apps/cli/src/config.ts`, replace lines 180-197:

```typescript
export function claudeSubagentsToConfigs(subagents: ClaudeSubagent[]): AgentConfig[] {
  return subagents.map(sa => ({
    id: sa.id,
    provider: sa.provider as AgentConfig['provider'],
    model: sa.model,
    preset: inferPreset(sa.description, sa.name),
    skills: inferSkills(sa.description, sa.name),
    native: true,
  }));
}

function inferPreset(description: string, name: string): string {
  const text = `${name} ${description}`.toLowerCase();
  if (/review|audit|critic/.test(text)) return 'reviewer';
  if (/research|investigat|analyz/.test(text)) return 'researcher';
  if (/test|qa|quality/.test(text)) return 'tester';
  return 'implementer';
}
```

With:

```typescript
export function claudeSubagentsToConfigs(subagents: ClaudeSubagent[]): AgentConfig[] {
  return subagents.map(sa => ({
    id: sa.id,
    provider: sa.provider as AgentConfig['provider'],
    model: sa.model,
    role: sa.description || sa.name,
    skills: inferSkills(sa.description, sa.name),
    native: true,
  }));
}
```

Note: `inferSkills()` (lines 199+) is kept — it's useful and doesn't force a preset category. Only `inferPreset()` is deleted.

- [ ] **Step 2: Check if AgentConfig type has `preset` or `role`**

Run: `grep -n 'preset\|role' packages/orchestrator/src/types.ts | head -20`

If `AgentConfig` has `preset: string`, rename it to `role: string`. If it has both, keep `role` and add `preset` as an optional alias. The exact change depends on what the type file shows.

- [ ] **Step 3: Run tests**

Run: `npx jest tests/cli/ --no-coverage`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/config.ts
git commit -m "refactor: delete inferPreset, use description as role in claudeSubagentsToConfigs"
```

---

### Task 3: Rename `preset` → `role` in `gossip_setup` schema and config writes

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts:873` (Zod schema)
- Modify: `apps/cli/src/mcp-server-sdk.ts:1000` (native config write)
- Modify: `apps/cli/src/mcp-server-sdk.ts:1024` (custom config write)

- [ ] **Step 1: Change the Zod schema**

In `apps/cli/src/mcp-server-sdk.ts:873`, change:

```typescript
      preset: z.enum(['implementer', 'reviewer', 'researcher', 'tester']).optional()
        .describe('Agent role preset'),
```

To:

```typescript
      role: z.string().optional()
        .describe('Agent role — freeform, e.g. "ui-architect", "security-auditor", "reviewer"'),
```

- [ ] **Step 2: Update native config write**

At line 1000, change:

```typescript
          preset: agent.preset || 'implementer',
```

To:

```typescript
          role: agent.role || agent.preset,
```

Note: `agent.preset` is read for backward compat — old callers might still send it. The Zod schema only has `role` now, but the raw input object may carry `preset` from old configs.

- [ ] **Step 3: Update custom config write**

At line 1024, change:

```typescript
          preset: agent.preset || 'implementer',
```

To:

```typescript
          role: agent.role || agent.preset,
```

- [ ] **Step 4: Search for other `agent.preset` references in this handler**

Run: `grep -n 'agent\.preset' apps/cli/src/mcp-server-sdk.ts`

Update any remaining references to use `agent.role || agent.preset`.

- [ ] **Step 5: Run tests**

Run: `npx jest tests/cli/mcp-server-sdk.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "refactor: rename preset to freeform role in gossip_setup schema and config writes"
```

---

### Task 4: Fix native dispatch prompt to use `config.instructions`

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts:1179-1195`

- [ ] **Step 1: Replace the presetPrompts block**

In `apps/cli/src/mcp-server-sdk.ts`, replace lines 1179-1195:

```typescript
      const config = ctx.nativeAgentConfigs.get(agent_id)!;
      const agentConfig = ctx.mainAgent.getAgentList?.()?.find((a: any) => a.id === agent_id);
      const preset = agentConfig?.preset || config.description || '';
      const presetPrompts: Record<string, string> = {
        reviewer: 'You are a senior code reviewer. Focus on logic errors, security vulnerabilities, TypeScript type safety, and performance. Cite file:line for every finding.',
        researcher: 'You are a research agent. Explore codebases, trace execution paths, answer architecture questions. Be concise — bullet points over paragraphs. Cite file paths.',
        implementer: 'You are an implementation agent. Write clean, tested code. Follow existing patterns. Commit your work.',
        tester: 'You are a testing agent. Write thorough tests, find edge cases, verify behavior. Run tests and report results.',
      };
      const presetPrompt = presetPrompts[preset] || `You are a ${preset} agent.`;

      // Inject scope restriction for scoped write mode
      const scopePrefix = (write_mode === 'scoped' && scope)
        ? `SCOPE RESTRICTION: Only modify files within ${scope}. Do not edit files outside this directory.\n\n`
        : '';

      const agentPrompt = `${scopePrefix}${presetPrompt}\n\n---\n\nTask: ${task}`;
```

With:

```typescript
      const config = ctx.nativeAgentConfigs.get(agent_id)!;

      // Use agent's .claude/agents/<id>.md instructions as the system prompt
      const basePrompt = config.instructions
        || `You are a skilled ${config.description || 'agent'}. Complete the task thoroughly.`;

      // Inject scope restriction for scoped write mode
      const scopePrefix = (write_mode === 'scoped' && scope)
        ? `SCOPE RESTRICTION: Only modify files within ${scope}. Do not edit files outside this directory.\n\n`
        : '';

      const agentPrompt = `${scopePrefix}${basePrompt}\n\n---\n\nTask: ${task}`;
```

This is the biggest behavioral change: native agents now get their real `.md` file prompt instead of a 1-line hardcoded string.

- [ ] **Step 2: Run tests**

Run: `npx jest tests/cli/ --no-coverage`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "fix(dispatch): use config.instructions for native agent prompt instead of presetPrompts"
```

---

### Task 5: Update boot-time `nativeAgentConfigs` description

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts:269` (initial boot)
- Modify: `apps/cli/src/mcp-server-sdk.ts:533` (hot-reload)

- [ ] **Step 1: Update initial boot path**

At line 269, change:

```typescript
ctx.nativeAgentConfigs.set(ac.id, { model: modelTier, instructions, description: ac.preset || '' });
```

To:

```typescript
ctx.nativeAgentConfigs.set(ac.id, { model: modelTier, instructions, description: ac.role || ac.preset || '' });
```

- [ ] **Step 2: Update hot-reload path**

At line 533, change:

```typescript
ctx.nativeAgentConfigs.set(ac.id, { model: modelTier, instructions, description: ac.preset || '' });
```

To:

```typescript
ctx.nativeAgentConfigs.set(ac.id, { model: modelTier, instructions, description: ac.role || ac.preset || '' });
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "refactor: read role field (with preset fallback) for nativeAgentConfigs description"
```

---

### Task 6: Build MCP bundle and verify

**Files:**
- No new files — build and integration test

- [ ] **Step 1: Build the orchestrator**

```bash
cd packages/orchestrator && npm run build && cd ../..
```

Expected: Clean build.

- [ ] **Step 2: Build MCP bundle**

```bash
npm run build:mcp
```

Expected: Clean build.

- [ ] **Step 3: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: All tests pass (except pre-existing E2E flaky test in quick-smoke.test.ts).

- [ ] **Step 4: Commit build**

```bash
git add dist-mcp/mcp-server.js
git commit -m "build: rebuild MCP bundle with freeform role support"
```

---

## Summary

| Task | What | Risk |
|------|------|------|
| 1 | `presetScores()` → `defaultImportanceScores()` | Low — flat default, signal history dominates |
| 2 | Delete `inferPreset()` | Low — stops forcing legacy roles on auto-discovered agents |
| 3 | `preset` enum → `role` string in schema + config | Medium — schema change, backward compat via fallback |
| 4 | Native dispatch uses `config.instructions` | Medium — biggest behavioral change, but it's a bug fix |
| 5 | Boot reads `role` with `preset` fallback | Low — additive |
| 6 | Build and verify | Low — integration check |
