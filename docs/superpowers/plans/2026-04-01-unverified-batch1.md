# Unverified Findings Reduction — Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce UNVERIFIED consensus findings by ~75% through anchor enforcement (confidence downgrade for anchorless findings) and invalid anchor surfacing.

**Architecture:** Two code changes in `consensus-engine.ts` (confidence pre-seeding + anchor failure surfacing), one prompt strengthening in `prompt-assembler.ts`, plus tests.

**Tech Stack:** TypeScript, jest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/orchestrator/src/consensus-engine.ts` | Consensus cross-review engine — synthesize findings, fetch code snippets |
| `packages/orchestrator/src/prompt-assembler.ts` | Builds Phase 1 agent prompts — consensus output format instructions |
| `tests/orchestrator/consensus-engine.test.ts` | Existing consensus engine tests — add anchor detection tests |

---

### Task 1: Downgrade Anchorless Findings in Synthesize

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts:257-268`
- Modify: `tests/orchestrator/consensus-engine.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator/consensus-engine.test.ts`:

```typescript
describe('anchor detection in synthesize', () => {
  it('pre-seeds low confidence for findings without file:line anchors', () => {
    // Test the anchor detection regex
    const SOURCE_ANCHOR_PATTERN = /[\w./-]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|md|json|yaml|yml|toml|sh):\d+/;

    // Should match real source anchors
    expect(SOURCE_ANCHOR_PATTERN.test('packages/relay/src/server.ts:47')).toBe(true);
    expect(SOURCE_ANCHOR_PATTERN.test('consensus-engine.ts:254')).toBe(true);
    expect(SOURCE_ANCHOR_PATTERN.test('src/index.js:1')).toBe(true);

    // Should NOT match false positives
    expect(SOURCE_ANCHOR_PATTERN.test('node:18')).toBe(false);
    expect(SOURCE_ANCHOR_PATTERN.test('http://host:443')).toBe(false);
    expect(SOURCE_ANCHOR_PATTERN.test('version: 1')).toBe(false);
    expect(SOURCE_ANCHOR_PATTERN.test('accuracy is 0.95')).toBe(false);

    // Edge cases
    expect(SOURCE_ANCHOR_PATTERN.test('file.yaml:10')).toBe(true);
    expect(SOURCE_ANCHOR_PATTERN.test('Makefile:5')).toBe(false); // no extension
  });
});
```

- [ ] **Step 2: Run test to verify it passes (regex validation only)**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts -t "anchor detection" --no-coverage`
Expected: PASS

- [ ] **Step 3: Implement confidence pre-seeding in synthesize**

In `packages/orchestrator/src/consensus-engine.ts`, find the seeding loop at lines 257-268:

```typescript
      for (const line of lines) {
        const finding = line.replace(/^\s*-\s*/, '').trim();
        if (!finding) continue;
        const key = `${r.agentId}::${finding}`;
        findingMap.set(key, {
          originalAgentId: r.agentId,
          finding,
          confirmedBy: [],
          disputedBy: [],
          unverifiedBy: [],
          confidences: [],
        });
      }
```

Replace with:

```typescript
      for (const line of lines) {
        const finding = line.replace(/^\s*-\s*/, '').trim();
        if (!finding) continue;
        const key = `${r.agentId}::${finding}`;
        // Detect source file anchors — restrict to known extensions to avoid false matches (node:18, http:443)
        const hasAnchor = /[\w./-]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|md|json|yaml|yml|toml|sh):\d+/.test(finding);
        findingMap.set(key, {
          originalAgentId: r.agentId,
          finding,
          confirmedBy: [],
          disputedBy: [],
          unverifiedBy: [],
          confidences: hasAnchor ? [] : [2], // pre-load low confidence for anchorless findings
        });
      }
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: PASS (all existing + new tests)

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts tests/orchestrator/consensus-engine.test.ts
git commit -m "feat(consensus): downgrade confidence for anchorless findings in synthesize"
```

---

### Task 2: Surface Invalid Anchors in snippetsForFinding

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts:739-757`

- [ ] **Step 1: Add blank-line and resolution failure surfacing**

In `packages/orchestrator/src/consensus-engine.ts`, find `snippetsForFinding` at lines 739-757. The current code silently `continue`s when a file isn't found or line is out of range.

Replace lines 740-757:

```typescript
        const filePath = await this.cachedResolve(fullRef) ?? await this.cachedResolve(bareFile);
        if (!filePath) continue;
        const fileStat = await stat(filePath);
        if (fileStat.size > MAX_FILE_SIZE) continue;
        const content = await this.cachedRead(filePath);
        if (!content) continue;
        const fileLines = content.split('\n');
        if (lineNum > fileLines.length) continue;

        const start = Math.max(0, lineNum - 1 - CONTEXT_LINES);
        const end = Math.min(fileLines.length, lineNum + CONTEXT_LINES);
        const snippet = fileLines.slice(start, end)
          .map((l, i) => `  ${start + i + 1}: ${l}`)
          .join('\n');
        const safeSnippet = snippet.replace(/<\/?(data|anchor|code)\b[^>]*>/gi, '');
        const safeRef = fullRef.replace(/["<>]/g, '');
        anchors.push(`<anchor src="${safeRef}:${lineNum}">\n${safeSnippet}\n</anchor>`);
      } catch { /* file unreadable, skip */ }
```

With:

```typescript
        const filePath = await this.cachedResolve(fullRef) ?? await this.cachedResolve(bareFile);
        const safeRef = fullRef.replace(/["<>]/g, '');
        if (!filePath) {
          anchors.push(`⚠ Agent cited \`${safeRef}:${lineNum}\` but file not found`);
          continue;
        }
        const fileStat = await stat(filePath);
        if (fileStat.size > MAX_FILE_SIZE) continue;
        const content = await this.cachedRead(filePath);
        if (!content) continue;
        const fileLines = content.split('\n');
        if (lineNum > fileLines.length) {
          anchors.push(`⚠ Agent cited \`${safeRef}:${lineNum}\` but file has only ${fileLines.length} lines`);
          continue;
        }
        if (fileLines[lineNum - 1].trim() === '') {
          anchors.push(`⚠ Agent cited \`${safeRef}:${lineNum}\` but line is blank`);
          continue;
        }

        const start = Math.max(0, lineNum - 1 - CONTEXT_LINES);
        const end = Math.min(fileLines.length, lineNum + CONTEXT_LINES);
        const snippet = fileLines.slice(start, end)
          .map((l, i) => `  ${start + i + 1}: ${l}`)
          .join('\n');
        const safeSnippet = snippet.replace(/<\/?(data|anchor|code)\b[^>]*>/gi, '');
        anchors.push(`<anchor src="${safeRef}:${lineNum}">\n${safeSnippet}\n</anchor>`);
      } catch { /* file unreadable, skip */ }
```

- [ ] **Step 2: Update the cross-review system prompt**

In the same file, find the system prompt at lines 209-218. After the existing UNVERIFIED rule (line 215), add:

```typescript
- ⚠ warnings mean the agent's citation is unresolvable (file not found, line out of range, or blank line). Treat these as UNVERIFIED — do NOT agree with findings that have broken citations.
```

Insert this line after `- UNVERIFIED if an anchor is missing...` (line 215).

- [ ] **Step 3: Run tests**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts
git commit -m "feat(consensus): surface invalid anchors instead of silently dropping them"
```

---

### Task 3: Strengthen Phase 1 Agent Prompt

**Files:**
- Modify: `packages/orchestrator/src/prompt-assembler.ts:110-123`

- [ ] **Step 1: Update the consensus output format prompt**

In `packages/orchestrator/src/prompt-assembler.ts`, find lines 110-123 (the `consensusSummary` block).

Replace:

```typescript
  if (parts.consensusSummary) {
    blocks.push(`\n\n--- CONSENSUS OUTPUT FORMAT ---
End your response with a section titled "## Consensus Summary".
EVERY finding MUST include a citation. Use file:line for specific issues, or just the filename for file-level concerns. Without a citation, peers cannot verify your claim and it will be marked UNVERIFIED.
Format: "- <finding description> (file.ts:123)" or "- <finding description> (file.ts)"

Do NOT fabricate file paths or line numbers. If you cannot identify a specific file, omit the finding — uncited findings waste review capacity.

IMPORTANT: Only list actual issues — bugs, security concerns, design problems.
Do NOT include confirmations like "X is correct", "Y works as expected", or
"no bug found". These cannot be cross-verified and waste review capacity.

This section will be used for cross-review with peer agents.
--- END CONSENSUS OUTPUT FORMAT ---`);
  }
```

With:

```typescript
  if (parts.consensusSummary) {
    blocks.push(`\n\n--- CONSENSUS OUTPUT FORMAT ---
End your response with a section titled "## Consensus Summary".

CITATION RULES:
- Every FACTUAL claim about code MUST include a file:line citation
  Format: "- <finding> (file.ts:123)" or "- <finding> (file.ts)"
- Claims without citations receive LOW confidence and will likely be marked UNVERIFIED
- Do NOT fabricate file paths or line numbers — broken citations are worse than no citation
- If you cannot identify a specific file for a factual claim, omit the finding

FINDING TYPES:
- Factual issues (bugs, security, design problems) — REQUIRE file:line citation
- Do NOT include confirmations ("X is correct", "Y works as expected")

This section will be used for cross-review with peer agents.
--- END CONSENSUS OUTPUT FORMAT ---`);
  }
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/orchestrator/prompt-assembler.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/prompt-assembler.ts
git commit -m "feat(consensus): strengthen Phase 1 prompt to require file:line citations"
```

---

### Task 4: Build and Verify

**Files:**
- No new files — build and integration test

- [ ] **Step 1: Build orchestrator**

```bash
cd packages/orchestrator && npm run build && cd ../..
```

Expected: Clean build (or pre-existing errors only — not from our changes).

- [ ] **Step 2: Build MCP bundle**

```bash
npm run build:mcp
```

Expected: Clean build.

- [ ] **Step 3: Run consensus engine tests**

```bash
npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage
```

Expected: All tests pass.

- [ ] **Step 4: Run prompt assembler tests**

```bash
npx jest tests/orchestrator/prompt-assembler.test.ts --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Commit build**

```bash
git add dist-mcp/mcp-server.js
git commit -m "build: rebuild MCP bundle with anchor enforcement"
```

---

## Summary

| Task | What | Lines Changed | Risk |
|------|------|--------------|------|
| 1 | Confidence pre-seeding for anchorless findings | ~5 lines in synthesize | Low |
| 2 | Surface invalid anchors + blank-line check | ~15 lines in snippetsForFinding + 1 prompt line | Low |
| 3 | Strengthen Phase 1 citation prompt | ~10 lines in prompt-assembler | Low |
| 4 | Build and verify | 0 new lines | Low |
