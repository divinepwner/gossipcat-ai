# Agent Finding Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bullet-line finding parser with structured `<agent_finding>` tag parser in the consensus engine, with per-agent fallback to bullets.

**Architecture:** Tag parser runs first on raw summary text. If no tags found for an agent, falls back to existing bullet parser. Severity field added to ConsensusFinding. Dedup merges severity (highest wins).

**Tech Stack:** TypeScript, regex, jest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/orchestrator/src/consensus-engine.ts` | Tag parser in synthesize, severity in dedup |
| `packages/orchestrator/src/consensus-types.ts` | Add severity to ConsensusFinding |
| `packages/orchestrator/src/prompt-assembler.ts` | Teach agents the `<agent_finding>` format |
| `tests/orchestrator/consensus-engine.test.ts` | Tests for tag parsing, fallback, severity |

---

### Task 1: Add `severity` to ConsensusFinding type

**Files:**
- Modify: `packages/orchestrator/src/consensus-types.ts`

- [ ] **Step 1: Add severity field**

In `packages/orchestrator/src/consensus-types.ts`, the `ConsensusFinding` interface already has `findingType?`. Add `severity?` after it:

```typescript
  findingType?: 'finding' | 'suggestion' | 'insight';
  severity?: 'critical' | 'high' | 'medium' | 'low';
```

- [ ] **Step 2: Commit**

```bash
git add packages/orchestrator/src/consensus-types.ts
git commit -m "feat(consensus): add severity field to ConsensusFinding type"
```

---

### Task 2: Add `<agent_finding>` tag parser to synthesize

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts:258-282`
- Modify: `tests/orchestrator/consensus-engine.test.ts`

- [ ] **Step 1: Write tests for tag parsing**

Add to `tests/orchestrator/consensus-engine.test.ts`:

```typescript
describe('agent_finding tag parsing', () => {
  it('parses basic finding tag', () => {
    const TAG_PATTERN = /<agent_finding\s+([^>]*)>([\s\S]*?)<\/agent_finding>/g;
    const input = '<agent_finding type="finding" severity="high">Missing Secure flag at routes.ts:126</agent_finding>';
    const match = TAG_PATTERN.exec(input);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('type="finding"');
    expect(match![1]).toContain('severity="high"');
    expect(match![2].trim()).toBe('Missing Secure flag at routes.ts:126');
  });

  it('parses attributes in any order', () => {
    const TAG_PATTERN = /<agent_finding\s+([^>]*)>([\s\S]*?)<\/agent_finding>/g;
    const input = '<agent_finding severity="medium" type="suggestion">Consider using Strict</agent_finding>';
    const match = TAG_PATTERN.exec(input);
    expect(match).not.toBeNull();
    const attrs = match![1];
    expect(attrs.match(/type="(finding|suggestion|insight)"/)![1]).toBe('suggestion');
    expect(attrs.match(/severity="(critical|high|medium|low)"/)![1]).toBe('medium');
  });

  it('parses multiline content', () => {
    const TAG_PATTERN = /<agent_finding\s+([^>]*)>([\s\S]*?)<\/agent_finding>/g;
    const input = '<agent_finding type="finding" severity="high">\nLine 1\nLine 2\n</agent_finding>';
    const match = TAG_PATTERN.exec(input);
    expect(match![2].trim()).toBe('Line 1\nLine 2');
  });

  it('skips content over 2000 chars', () => {
    const TAG_PATTERN = /<agent_finding\s+([^>]*)>([\s\S]*?)<\/agent_finding>/g;
    const longContent = 'x'.repeat(2001);
    const input = `<agent_finding type="finding">${longContent}</agent_finding>`;
    const match = TAG_PATTERN.exec(input);
    expect(match).not.toBeNull();
    // Content exceeds 2000 — should be filtered by the engine
    expect(match![2].trim().length).toBeGreaterThan(2000);
  });

  it('skips tags without type attribute', () => {
    const TAG_PATTERN = /<agent_finding\s+([^>]*)>([\s\S]*?)<\/agent_finding>/g;
    const input = '<agent_finding severity="high">No type attr</agent_finding>';
    const match = TAG_PATTERN.exec(input);
    expect(match).not.toBeNull();
    const attrs = match![1];
    expect(attrs.match(/type="(finding|suggestion|insight)"/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (regex-only tests)**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts -t "agent_finding" --no-coverage`
Expected: PASS

- [ ] **Step 3: Implement tag parser in synthesize**

In `packages/orchestrator/src/consensus-engine.ts`, find the seeding loop at ~line 258. Replace the body of the `for (const r of successful)` loop:

```typescript
for (const r of successful) {
  const summary = this.extractSummary(r.result!);
  let agentFindingsFound = 0;

  // Primary: parse <agent_finding> tags from raw summary
  const tagPattern = /<agent_finding\s+([^>]*)>([\s\S]*?)<\/agent_finding>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(summary)) !== null) {
    const attrs = tagMatch[1];
    const content = tagMatch[2].trim();
    if (!content || content.length < 10 || content.length > 2000) continue;

    const typeMatch = attrs.match(/type="(finding|suggestion|insight)"/);
    if (!typeMatch) continue;
    const severityMatch = attrs.match(/severity="(critical|high|medium|low)"/);

    const findingType = typeMatch[1] as 'finding' | 'suggestion' | 'insight';
    const severity = severityMatch?.[1] as 'critical' | 'high' | 'medium' | 'low' | undefined;
    const key = `${r.agentId}::${content}`;
    const hasAnchor = /[\w./-]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|md|json|yaml|yml|toml|sh):\d+/.test(content);

    findingMap.set(key, {
      originalAgentId: r.agentId,
      finding: content,
      findingType,
      severity,
      confirmedBy: [],
      disputedBy: [],
      unverifiedBy: [],
      confidences: hasAnchor ? [] : [2],
    });
    agentFindingsFound++;
  }

  // Per-agent fallback: if THIS agent produced no tags, use legacy bullet parsing
  if (agentFindingsFound === 0) {
    const lines = summary.split('\n').filter(l => l.trimStart().startsWith('-'));
    for (const line of lines) {
      let finding = line.replace(/^\s*-\s*/, '').trim();
      if (!finding || finding.length < 20) continue;
      const tagMatch2 = finding.match(/^\[(FINDING|SUGGESTION|INSIGHT)\]\s*/i);
      const findingType = tagMatch2 ? tagMatch2[1].toLowerCase() as 'finding' | 'suggestion' | 'insight' : 'finding';
      if (tagMatch2) finding = finding.slice(tagMatch2[0].length).trim();
      const key = `${r.agentId}::${finding}`;
      const hasAnchor = /[\w./-]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|md|json|yaml|yml|toml|sh):\d+/.test(finding);
      findingMap.set(key, {
        originalAgentId: r.agentId,
        finding,
        findingType,
        confirmedBy: [],
        disputedBy: [],
        unverifiedBy: [],
        confidences: hasAnchor ? [] : [2],
      });
    }
  }
}
```

Note: The `findingMap` type declaration (~line 246) must also include `severity?` in the inline type.

- [ ] **Step 4: Run all consensus tests**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts tests/orchestrator/consensus-engine.test.ts
git commit -m "feat(consensus): add <agent_finding> tag parser with per-agent bullet fallback"
```

---

### Task 3: Add severity merge to deduplicateFindings

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts` (dedup method)

- [ ] **Step 1: Add severity rank and merge logic**

In `deduplicateFindings`, after the existing `findingType` merge lines, add severity merge:

```typescript
const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// During merge into A:
if (entryB.severity && (!entryA.severity || (SEVERITY_RANK[entryB.severity] || 0) > (SEVERITY_RANK[entryA.severity] || 0))) {
  entryA.severity = entryB.severity;
}

// During merge into B (swap case):
if (entryA.severity && (!entryB.severity || (SEVERITY_RANK[entryA.severity] || 0) > (SEVERITY_RANK[entryB.severity] || 0))) {
  entryB.severity = entryA.severity;
}
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts
git commit -m "feat(consensus): highest severity wins during finding dedup merge"
```

---

### Task 4: Update prompt to teach agents the format

**Files:**
- Modify: `packages/orchestrator/src/prompt-assembler.ts`

- [ ] **Step 1: Replace FINDING FORMAT section**

In `prompt-assembler.ts`, replace the current FINDING TYPES section with:

```
FINDING FORMAT:
Wrap each finding in an <agent_finding> tag:

<agent_finding type="finding" severity="high">
Your finding here with <cite tag="file">file.ts:123</cite> references
</agent_finding>

<agent_finding type="suggestion">
Your recommendation here
</agent_finding>

<agent_finding type="insight">
Your observation here
</agent_finding>

Types: finding (factual, verifiable), suggestion (recommendation), insight (observation)
Severity (for findings only): critical, high, medium, low
Attributes can appear in any order.
Do NOT include confirmations ("X is correct", "Y works as expected")
```

- [ ] **Step 2: Update test**

Update the prompt-assembler test to check for `<agent_finding` instead of old text.

- [ ] **Step 3: Run tests**

Run: `npx jest tests/orchestrator/prompt-assembler.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/prompt-assembler.ts tests/orchestrator/prompt-assembler.test.ts
git commit -m "feat(consensus): teach agents <agent_finding> tag format in Phase 1 prompt"
```

---

### Task 5: Build and verify

- [ ] **Step 1: Build MCP**

```bash
npm run build:mcp
```

- [ ] **Step 2: Run all affected tests**

```bash
npx jest tests/orchestrator/consensus-engine.test.ts tests/orchestrator/prompt-assembler.test.ts --no-coverage
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git push origin master
```

---

## Summary

| Task | What | Risk |
|------|------|------|
| 1 | Add severity to ConsensusFinding type | Low — additive field |
| 2 | Tag parser + per-agent fallback | Medium — replaces core parser, bullet fallback preserves compat |
| 3 | Severity merge in dedup | Low — additive logic |
| 4 | Prompt update | Low — teaches new format, old format still works |
| 5 | Build + verify | Low |
