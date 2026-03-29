# Native Implementer Agents + Bootstrap Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Claude implementer agents (sonnet + opus) to the gossipcat team and fix bootstrap staleness by verifying tool claims on boot.

**Architecture:** Create agent definition files + config entries so `gossip_run` can dispatch implementation tasks through the mesh. Add `verifyToolClaims()` to `BootstrapGenerator` that greps the MCP server source for tool registrations before including session notes. Fix `gossip_run` to propagate scope into native agent prompts.

**Tech Stack:** TypeScript, Jest, Claude Code agent definitions (.md frontmatter)

**Spec:** `docs/specs/2026-03-29-native-implementer-bootstrap-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `.claude/agents/sonnet-implementer.md` | Native sonnet implementer agent definition |
| `.claude/agents/opus-implementer.md` | Native opus implementer agent definition |

### Modified files

| File | Change |
|------|--------|
| `.gossip/config.json` | Add sonnet-implementer and opus-implementer entries with explicit skills |
| `packages/orchestrator/src/bootstrap.ts` | Add `verifyToolClaims()`, update tools table in `renderTeamPrompt()` |
| `apps/cli/src/mcp-server-sdk.ts` | Inject scope restriction into native dispatch prompt in `gossip_run` |
| `tests/orchestrator/bootstrap.test.ts` | Add tests for `verifyToolClaims()` |

---

## Task 1: Create Native Implementer Agent Definitions

**Files:**
- Create: `.claude/agents/sonnet-implementer.md`
- Create: `.claude/agents/opus-implementer.md`

- [ ] **Step 1: Create sonnet-implementer.md**

```markdown
---
name: sonnet-implementer
model: sonnet
description: Fast implementation agent for well-specified tasks — TDD, clean code, atomic commits
tools:
  - Bash
  - Glob
  - Grep
  - Read
  - Edit
  - Write
---

You are an implementation agent. Your job is to write clean, tested code that matches the spec exactly.

## How You Work

1. Read the task description fully before writing any code
2. Write failing tests first (TDD) when tests are part of the task
3. Implement the minimal code to make tests pass
4. Run tests to verify — do not claim they pass without running them
5. Self-review: check completeness, quality, YAGNI
6. Commit with a descriptive message

## Rules

- Follow existing patterns in the codebase — match style, naming, file organization
- Do not add features, refactoring, or improvements beyond what was requested
- Do not guess — if something is unclear, report back with status NEEDS_CONTEXT
- If the task is too complex or you're uncertain, report BLOCKED rather than producing bad work
- Keep files focused — one clear responsibility per file
- Test behavior, not implementation details

## Report Format

When done, report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Test results (with actual command output)
- Files changed
- Any concerns
```

- [ ] **Step 2: Create opus-implementer.md**

```markdown
---
name: opus-implementer
model: opus
description: Senior implementation agent for complex multi-file integration, architectural decisions, and debugging
tools:
  - Bash
  - Glob
  - Grep
  - Read
  - Edit
  - Write
---

You are a senior implementation agent. You handle tasks that require understanding multiple modules, making design judgment calls, or debugging complex interactions. Think carefully about how your changes affect the broader system.

## How You Work

1. Read the task description fully before writing any code
2. Understand the broader context — read related files before making changes
3. Write failing tests first (TDD) when tests are part of the task
4. Implement the minimal code to make tests pass
5. Run tests to verify — do not claim they pass without running them
6. Self-review: check completeness, quality, YAGNI, cross-module impact
7. Commit with a descriptive message

## Rules

- Follow existing patterns in the codebase — match style, naming, file organization
- Do not add features, refactoring, or improvements beyond what was requested
- Do not guess — if something is unclear, report back with status NEEDS_CONTEXT
- If the task is too complex or you're uncertain, report BLOCKED rather than producing bad work
- Keep files focused — one clear responsibility per file
- Test behavior, not implementation details
- When modifying shared interfaces, check all consumers

## Report Format

When done, report:
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- What you implemented
- Test results (with actual command output)
- Files changed
- Any concerns
```

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/sonnet-implementer.md .claude/agents/opus-implementer.md
git commit -m "feat: add native sonnet-implementer and opus-implementer agent definitions"
```

---

## Task 2: Add Implementer Agents to Config

**Files:**
- Modify: `.gossip/config.json`

- [ ] **Step 1: Add both agents to the agents object in config.json**

Add these two entries to the `"agents"` object in `.gossip/config.json`, after the existing 5 agents:

```json
"sonnet-implementer": {
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "preset": "implementer",
  "skills": ["implementation", "typescript", "testing"],
  "native": true
},
"opus-implementer": {
  "provider": "anthropic",
  "model": "claude-opus-4-6",
  "preset": "implementer",
  "skills": ["implementation", "typescript", "testing"],
  "native": true
}
```

The full config.json should now have 7 agents: sonnet-reviewer, haiku-researcher, gemini-implementer, gemini-reviewer, gemini-tester, sonnet-implementer, opus-implementer.

- [ ] **Step 2: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('.gossip/config.json','utf-8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add .gossip/config.json
git commit -m "feat: register sonnet-implementer and opus-implementer in config with explicit skills"
```

---

## Task 3: Bootstrap Tool Claim Verification

**Files:**
- Modify: `packages/orchestrator/src/bootstrap.ts:337-345`
- Test: `tests/orchestrator/bootstrap.test.ts`

- [ ] **Step 1: Write failing tests for verifyToolClaims**

Append to `tests/orchestrator/bootstrap.test.ts`:

```typescript
describe('tool claim verification', () => {
  it('annotates TODO lines when tool exists in MCP server', () => {
    const dir = join(testDir, 'verify-tools');
    mkdirSync(join(dir, '.gossip'), { recursive: true });
    mkdirSync(join(dir, 'apps', 'cli', 'src'), { recursive: true });

    // Write a config so bootstrap generates a full prompt
    writeFileSync(join(dir, '.gossip', 'config.json'), JSON.stringify({
      main_agent: { provider: 'local', model: 'q' },
      agents: { 'a1': { provider: 'local', model: 'q', skills: ['t'] } }
    }));

    // Write next-session.md with a TODO mentioning a tool
    writeFileSync(join(dir, '.gossip', 'next-session.md'),
      '## Remaining\n- gossip_foo — TODO: needs implementation\n- gossip_bar — pending feature\n'
    );

    // Write a fake MCP server source that registers gossip_foo but not gossip_bar
    writeFileSync(join(dir, 'apps', 'cli', 'src', 'mcp-server-sdk.ts'),
      "server.tool('gossip_foo', 'does stuff', {}, async () => {});\n" +
      "// gossip_bar is just mentioned in a comment\n"
    );

    const gen = new BootstrapGenerator(dir);
    const result = gen.generate();

    // gossip_foo should be annotated as shipped
    expect(result.prompt).toContain('verified: gossip_foo exists');
    // gossip_bar should NOT be annotated (only in a comment)
    expect(result.prompt).not.toContain('verified: gossip_bar');
    // gossip_bar line should still be present unmodified
    expect(result.prompt).toContain('gossip_bar — pending feature');
  });

  it('passes through content unchanged when MCP source is missing', () => {
    const dir = join(testDir, 'verify-no-mcp');
    mkdirSync(join(dir, '.gossip'), { recursive: true });

    writeFileSync(join(dir, '.gossip', 'config.json'), JSON.stringify({
      main_agent: { provider: 'local', model: 'q' },
      agents: { 'a1': { provider: 'local', model: 'q', skills: ['t'] } }
    }));

    writeFileSync(join(dir, '.gossip', 'next-session.md'),
      '- gossip_missing — TODO: build this\n'
    );
    // No apps/cli/src/mcp-server-sdk.ts — should pass through unchanged

    const gen = new BootstrapGenerator(dir);
    const result = gen.generate();
    expect(result.prompt).toContain('gossip_missing — TODO: build this');
    expect(result.prompt).not.toContain('verified');
  });

  it('does not annotate lines without TODO/remaining/pending keywords', () => {
    const dir = join(testDir, 'verify-no-keyword');
    mkdirSync(join(dir, '.gossip'), { recursive: true });
    mkdirSync(join(dir, 'apps', 'cli', 'src'), { recursive: true });

    writeFileSync(join(dir, '.gossip', 'config.json'), JSON.stringify({
      main_agent: { provider: 'local', model: 'q' },
      agents: { 'a1': { provider: 'local', model: 'q', skills: ['t'] } }
    }));

    writeFileSync(join(dir, '.gossip', 'next-session.md'),
      '- SHIPPED: gossip_run works great\n'
    );

    writeFileSync(join(dir, 'apps', 'cli', 'src', 'mcp-server-sdk.ts'),
      "server.tool('gossip_run', 'run stuff', {}, async () => {});\n"
    );

    const gen = new BootstrapGenerator(dir);
    const result = gen.generate();
    // No TODO keyword, so no annotation even though tool exists
    expect(result.prompt).not.toContain('verified');
    expect(result.prompt).toContain('SHIPPED: gossip_run works great');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/orchestrator/bootstrap.test.ts --no-coverage`
Expected: FAIL — `verifyToolClaims` not called yet, so `verified:` never appears in output

- [ ] **Step 3: Implement verifyToolClaims in bootstrap.ts**

In `packages/orchestrator/src/bootstrap.ts`, add this private method to the `BootstrapGenerator` class (after `readNextSessionNotes`):

```typescript
/**
 * Verify tool-related claims in session notes against MCP server source.
 * Annotates TODO/remaining lines where the referenced tool actually exists.
 */
private verifyToolClaims(content: string): string {
  const mcpPath = join(this.projectRoot, 'apps', 'cli', 'src', 'mcp-server-sdk.ts');
  if (!existsSync(mcpPath)) return content;

  const rawSource = readFileSync(mcpPath, 'utf-8');
  // Strip comments once — avoids false positives from gossip_tools() listing
  const source = rawSource.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');

  return content.replace(
    /^(.*(?:TODO|remaining|deferred|needed|pending).*)(gossip_\w+)(.*)/gim,
    (match, _before, toolName, _after) => {
      const pattern = new RegExp(`server\\.tool\\(\\s*['"]${toolName}['"]`);
      if (pattern.test(source)) {
        return `~~${match.trim()}~~ *(verified: ${toolName} exists in MCP server)*`;
      }
      return match;
    }
  );
}
```

- [ ] **Step 4: Call verifyToolClaims from readNextSessionNotes**

In `readNextSessionNotes()`, change the return statement (line ~343) from:

```typescript
return content.length > 0 ? content.slice(0, 2000) : null;
```

to:

```typescript
if (content.length === 0) return null;
return this.verifyToolClaims(content).slice(0, 2000);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/orchestrator/bootstrap.test.ts --no-coverage`
Expected: All tests PASS (existing 5 + new 3)

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/bootstrap.ts tests/orchestrator/bootstrap.test.ts
git commit -m "feat: bootstrap verifyToolClaims — annotates stale TODOs for shipped tools"
```

---

## Task 4: Update Bootstrap Tools Table

**Files:**
- Modify: `packages/orchestrator/src/bootstrap.ts:210-224`

- [ ] **Step 1: Add missing tools to the tools table in renderTeamPrompt**

In `packages/orchestrator/src/bootstrap.ts`, find the tools table in `renderTeamPrompt()` (around line 210). After the last existing row (`gossip_plan`), add these rows:

```typescript
| \`gossip_run(agent_id, task)\` | Single-agent dispatch. Relay: returns result directly. Native: returns Agent() instructions + gossip_run_complete callback. |
| \`gossip_run_complete(task_id, result)\` | Complete a native agent gossip_run — relays result, writes memory, emits signals. |
| \`gossip_relay_result(task_id, result)\` | Feed native Agent() result back into relay for consensus cross-review. |
| \`gossip_session_save()\` | Save session summary for next session context. Call before ending session. |
| \`gossip_scores()\` | View agent performance scores and dispatch weights. |
```

- [ ] **Step 2: Verify bootstrap still generates correctly**

Run: `npx jest tests/orchestrator/bootstrap.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/bootstrap.ts
git commit -m "feat: add gossip_run, gossip_session_save, gossip_scores to bootstrap tools table"
```

---

## Task 5: Inject Scope Into Native Dispatch Prompt

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts:1610-1634`

- [ ] **Step 1: Add scope restriction to native dispatch in gossip_run**

In `apps/cli/src/mcp-server-sdk.ts`, find the `gossip_run` tool handler's native agent branch (around line 1610). After `const presetPrompt = presetPrompts[preset] || ...;` (line 1625), add scope injection:

```typescript
// Inject scope restriction for scoped write mode
const scopePrefix = (write_mode === 'scoped' && scope)
  ? `SCOPE RESTRICTION: Only modify files within ${scope}. Do not edit files outside this directory.\n\n`
  : '';
```

Then update the return template (line 1631) to include the scope prefix. Change:

```typescript
`Agent(model: "${config.model}", prompt: "${presetPrompt}\\n\\n---\\n\\nTask: ${task.slice(0, 200)}...")\n` +
```

to:

```typescript
`Agent(model: "${config.model}", prompt: "${scopePrefix}${presetPrompt}\\n\\n---\\n\\nTask: ${task.slice(0, 200)}...")\n` +
```

- [ ] **Step 2: Verify the change doesn't break non-scoped dispatch**

The `scopePrefix` is empty string when `write_mode` is not `'scoped'` or `scope` is not set, so existing behavior is unchanged.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "fix: inject scope restriction into native agent prompt for scoped write mode"
```

---

## Task 6: Refresh Bootstrap + Verify End-to-End

**Files:**
- No new files — verification only

- [ ] **Step 1: Run full bootstrap test suite**

Run: `npx jest tests/orchestrator/bootstrap.test.ts --no-coverage`
Expected: All tests PASS

- [ ] **Step 2: Run full test suite to check for regressions**

Run: `npx jest --no-coverage 2>&1 | tail -10`
Expected: All tests PASS (or only pre-existing failures)

- [ ] **Step 3: Verify new agents appear in gossip_agents output**

After MCP reconnect, call `gossip_agents()` and verify `sonnet-implementer` and `opus-implementer` appear with correct skills.

- [ ] **Step 4: Verify gossip_run dispatches to sonnet-implementer**

Test: `gossip_run(agent_id: "sonnet-implementer", task: "List files in packages/relay/src/ and report back")`
Expected: Returns NATIVE_DISPATCH instructions with `model: "sonnet"` and `gossip_run_complete` callback.

- [ ] **Step 5: Commit any fixes from verification**

```bash
git add -A
git commit -m "chore: verification fixes for native implementer agents"
```

---

## Summary

| Task | Description | Files | Tests |
|------|------------|-------|-------|
| 1 | Agent definition files | 2 new .md files | — |
| 2 | Config.json entries | config.json | — |
| 3 | verifyToolClaims | bootstrap.ts | 3 |
| 4 | Tools table update | bootstrap.ts | — |
| 5 | Scope injection | mcp-server-sdk.ts | — |
| 6 | End-to-end verification | — | full suite |

**Total: 6 tasks, 3 tests, 5-6 commits**
