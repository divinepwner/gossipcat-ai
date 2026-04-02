# Per-Finding Snippet Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the 52% UNVERIFIED rate in consensus cross-review by giving each finding its own inline code context instead of sharing a global 5-snippet cap.

**Architecture:** Replace the current `inlineCodeAnchors` (line-by-line scanning, global cap=15) with per-finding snippet injection in `crossReviewForAgent`. Each peer finding gets up to 3 code snippets extracted from its own citations. Also add a Tier 0 normalized match in `findMatchingFinding` to catch punctuation/casing paraphrases.

**Tech Stack:** TypeScript, Jest, Node.js `fs/promises`

**Spec:** `docs/superpowers/specs/2026-03-30-cross-review-context-fix.md`

---

### Task 1: Add Tier 0 normalized match to `findMatchingFinding`

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts:914-948`
- Test: `tests/orchestrator/consensus-engine.test.ts`

- [ ] **Step 1: Write failing tests for normalized matching**

Add these tests inside the existing `describe('findMatchingFinding()')` block at `tests/orchestrator/consensus-engine.test.ts:405`:

```typescript
it('should match with normalized text (trailing period difference)', () => {
  const key = find(findingMap, 'peer-1', 'The button is blue');
  expect(key).toBe('peer-1::The button is blue.');
});

it('should match with normalized text (casing + punctuation difference)', () => {
  const key = find(findingMap, 'peer-2', 'the api call fails!');
  expect(key).toBe('peer-2::The API call fails.');
});

it('should not false-match normalized text across different agents', () => {
  const key = find(findingMap, 'peer-1', 'the api call fails.');
  expect(key).toBe(null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts -t "findMatchingFinding" --no-coverage`
Expected: First test may pass (substring match catches it), second should fail — the `!` changes the substring match behavior.

- [ ] **Step 3: Implement Tier 0 normalized match**

In `packages/orchestrator/src/consensus-engine.ts`, add a `normalize` helper and a Tier 0 block before the existing Tier 1 (exact match) at line 919:

```typescript
private findMatchingFinding(
  findingMap: Map<string, { originalAgentId: string; finding: string; confirmedBy: string[]; disputedBy: Array<{ agentId: string; reason: string; evidence: string }>; unverifiedBy: Array<{ agentId: string; reason: string }>; confidences: number[] }>,
  peerAgentId: string,
  findingText: string,
): string | null {
  // Tier 0: Normalized match (lowercase, strip punctuation, collapse whitespace)
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const normalizedText = normalize(findingText);
  for (const [key, entry] of findingMap) {
    if (entry.originalAgentId !== peerAgentId) continue;
    if (normalize(entry.finding) === normalizedText) return key;
  }

  // Tier 1: Exact match
  const exactKey = `${peerAgentId}::${findingText}`;
  if (findingMap.has(exactKey)) return exactKey;

  // ... rest unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts -t "findMatchingFinding" --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts tests/orchestrator/consensus-engine.test.ts
git commit -m "feat(consensus): add Tier 0 normalized match to findMatchingFinding"
```

---

### Task 2: Extract `inlineCodeAnchors` into per-finding snippet method

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts:686-768` (replace `inlineCodeAnchors`)
- Test: `tests/orchestrator/consensus-engine.test.ts`

The current `inlineCodeAnchors` method processes an entire summary line-by-line and appends anchors after each line. We need a new method `snippetsForFinding` that takes a single finding text and returns inline code snippets for that finding's citations.

- [ ] **Step 1: Write failing tests for `snippetsForFinding`**

Add a new describe block in `tests/orchestrator/consensus-engine.test.ts`:

```typescript
describe('snippetsForFinding()', () => {
  const tmpDir = join(__dirname, '../../.test-fixtures');
  let engineWithRoot: ConsensusEngine;

  beforeAll(async () => {
    const { mkdirSync, writeFileSync } = require('fs');
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'example.ts'), [
      'import { foo } from "bar";',
      '',
      'function processTask(input: string) {',
      '  const result = validate(input);',
      '  if (!result) return;',
      '  await doWork(result); // not locked',
      '  taskMap.delete(result.id);',
      '}',
      '',
      'export { processTask };',
    ].join('\n'));

    engineWithRoot = new ConsensusEngine({
      llm: mockLlm,
      registryGet: mockRegistryGet,
      projectRoot: tmpDir,
    });
  });

  afterAll(async () => {
    const { rmSync } = require('fs');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const getSnippets = (finding: string, maxSnippets?: number) =>
    (engineWithRoot as any).snippetsForFinding(finding, maxSnippets);

  it('should extract snippet for a finding with file:line citation', async () => {
    const result = await getSnippets('Race condition in src/example.ts:6 — not locked');
    expect(result).toContain('<anchor');
    expect(result).toContain('not locked');
    expect(result).toContain('src/example.ts:6');
  });

  it('should return empty string for finding without citations', async () => {
    const result = await getSnippets('The code has poor error handling overall');
    expect(result).toBe('');
  });

  it('should respect maxSnippets cap', async () => {
    const finding = 'Issues at src/example.ts:3 and src/example.ts:6';
    const result = await getSnippets(finding, 1);
    const anchorCount = (result.match(/<anchor/g) || []).length;
    expect(anchorCount).toBe(1);
  });

  it('should default to 3 snippets max', async () => {
    const finding = 'Problems at src/example.ts:1 and src/example.ts:3 and src/example.ts:5 and src/example.ts:7';
    const result = await getSnippets(finding, 3);
    const anchorCount = (result.match(/<anchor/g) || []).length;
    expect(anchorCount).toBeLessThanOrEqual(3);
  });

  it('should sanitize anchor content to prevent fence escape', async () => {
    const { writeFileSync } = require('fs');
    writeFileSync(join(tmpDir, 'src', 'tricky.ts'), [
      'const x = "</data>";',
      'const y = "<anchor>evil</anchor>";',
    ].join('\n'));
    const result = await getSnippets('Issue at src/tricky.ts:1');
    expect(result).not.toContain('</data>');
    expect(result).not.toContain('</anchor>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts -t "snippetsForFinding" --no-coverage`
Expected: FAIL — `snippetsForFinding is not a function`

- [ ] **Step 3: Implement `snippetsForFinding`**

Add this method to `ConsensusEngine` in `packages/orchestrator/src/consensus-engine.ts` (after the existing `inlineCodeAnchors` method — we'll keep the old method for now and remove it in Task 3):

```typescript
/**
 * Extract code snippets for a single finding's file:line citations.
 * Returns formatted anchor blocks as a string, or '' if no citations found.
 */
private async snippetsForFinding(findingText: string, maxSnippets = 3): Promise<string> {
  if (!this.config.projectRoot) return '';

  const citationPattern = /((?:[\w./-]+\/)?([a-zA-Z][\w.-]+\.[a-z]{1,6})):(\d+)/g;
  const CONTEXT_LINES = 2;
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const anchors: string[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = citationPattern.exec(findingText)) !== null) {
    if (anchors.length >= maxSnippets) break;

    const fullRef = match[1];
    const bareFile = match[2];
    const lineNum = parseInt(match[3], 10);
    const key = `${fullRef}:${lineNum}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
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
      anchors.push(`<anchor src="${fullRef}:${lineNum}">\n${safeSnippet}\n</anchor>`);
    } catch { /* file unreadable, skip */ }
  }

  return anchors.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts -t "snippetsForFinding" --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts tests/orchestrator/consensus-engine.test.ts
git commit -m "feat(consensus): add snippetsForFinding for per-finding code context"
```

---

### Task 3: Wire per-finding snippets into cross-review prompt

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts:146-220` (`crossReviewForAgent`)
- Test: `tests/orchestrator/consensus-engine.test.ts`

Replace the current approach (call `inlineCodeAnchors` on the entire peer summary) with per-finding snippet injection.

- [ ] **Step 1: Write failing test for per-finding snippets in cross-review**

Add to `tests/orchestrator/consensus-engine.test.ts`:

```typescript
describe('crossReviewForAgent per-finding snippets', () => {
  const tmpDir = join(__dirname, '../../.test-fixtures-xr');

  beforeAll(async () => {
    const { mkdirSync, writeFileSync } = require('fs');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'handler.ts'), [
      'export function handleRequest(req: Request) {',
      '  const body = req.body;',
      '  if (!body.token) throw new Error("missing token");',
      '  return processBody(body);',
      '}',
    ].join('\n'));
  });

  afterAll(async () => {
    const { rmSync } = require('fs');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should inline code anchor after each finding with a citation', async () => {
    const engine = new ConsensusEngine({
      llm: mockLlm,
      registryGet: mockRegistryGet,
      projectRoot: tmpDir,
    });

    mockLlm.generate.mockResolvedValue({
      text: JSON.stringify([
        { action: 'agree', agentId: 'agent-a', finding: 'missing validation', evidence: 'confirmed', confidence: 4 },
      ]),
    } as any);

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed',
        result: '## Consensus Summary\n- No token check at src/handler.ts:2', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed',
        result: '## Consensus Summary\n- Missing error handling', startedAt: 0 },
    ];

    await engine.dispatchCrossReview(results);

    // Verify the prompt sent to agent-b contains an anchor for handler.ts:2
    const callArgs = mockLlm.generate.mock.calls.find(
      call => call[0][1].content.includes('agent-a')
    );
    expect(callArgs).toBeDefined();
    const prompt = callArgs![0][1].content as string;
    expect(prompt).toContain('<anchor src="src/handler.ts:2">');
    expect(prompt).toContain('const body = req.body');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts -t "per-finding snippets" --no-coverage`
Expected: FAIL — the current code uses `inlineCodeAnchors` which processes the whole summary, not per-finding

- [ ] **Step 3: Replace `inlineCodeAnchors` call with per-finding snippet injection**

In `packages/orchestrator/src/consensus-engine.ts`, modify `crossReviewForAgent` (lines 152-167). Replace:

```typescript
    // Build peer findings section with per-finding inline code anchors
    const peerLines: string[] = [];
    for (const [peerId, peerSummary] of summaries) {
      if (peerId === agent.agentId) continue;
      const peerConfig = this.config.registryGet(peerId);
      const preset = peerConfig?.preset ?? 'unknown';

      // Inline short code anchors into each finding so cross-reviewers can verify
      const annotated = this.config.projectRoot
        ? await this.inlineCodeAnchors(peerSummary)
        : peerSummary;

      // SECURITY: Wrap external LLM output in <data> tags to prevent prompt injection.
      const peerBlock = `Agent "${peerId}" (${preset}):\n<data>${annotated}</data>`;
      peerLines.push(peerBlock);
    }
```

With:

```typescript
    // Build peer findings section with per-finding inline code snippets
    const peerLines: string[] = [];
    for (const [peerId, peerSummary] of summaries) {
      if (peerId === agent.agentId) continue;
      const peerConfig = this.config.registryGet(peerId);
      const preset = peerConfig?.preset ?? 'unknown';

      // Split summary into individual findings and attach code snippets to each
      const summaryLines = peerSummary.split('\n');
      const annotatedLines: string[] = [];
      for (const line of summaryLines) {
        // Sanitize each line before injection (summaries already sanitized, but belt-and-suspenders)
        annotatedLines.push(line);
        // Only fetch snippets for lines that look like findings (bullet points or non-empty content lines)
        const trimmed = line.trim();
        if (trimmed && this.config.projectRoot) {
          const snippets = await this.snippetsForFinding(trimmed);
          if (snippets) annotatedLines.push(snippets);
        }
      }

      // SECURITY: Wrap external LLM output in <data> tags to prevent prompt injection.
      const peerBlock = `Agent "${peerId}" (${preset}):\n<data>${annotatedLines.join('\n')}</data>`;
      peerLines.push(peerBlock);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: All PASS

- [ ] **Step 5: Run the full consensus test suite**

Run: `npx jest tests/orchestrator/consensus --no-coverage`
Expected: All existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts tests/orchestrator/consensus-engine.test.ts
git commit -m "feat(consensus): wire per-finding snippet injection into cross-review prompt"
```

---

### Task 4: Remove dead `inlineCodeAnchors` method

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts:686-768`

- [ ] **Step 1: Verify `inlineCodeAnchors` is no longer called**

Run: `grep -n 'inlineCodeAnchors' packages/orchestrator/src/consensus-engine.ts`
Expected: Only the method definition (line ~686), no call sites.

- [ ] **Step 2: Delete the `inlineCodeAnchors` method**

Remove the entire method from `packages/orchestrator/src/consensus-engine.ts` (lines 681-768, the JSDoc + method body).

- [ ] **Step 3: Run full test suite**

Run: `npx jest tests/orchestrator/consensus --no-coverage`
Expected: All PASS (no test referenced `inlineCodeAnchors`)

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts
git commit -m "refactor(consensus): remove unused inlineCodeAnchors method"
```

---

### Task 5: Integration smoke test — run consensus and verify UNVERIFIED rate

**Files:**
- No code changes — this is a manual verification task

- [ ] **Step 1: Run a consensus dispatch with the gossipcat team**

Use `gossip_dispatch(mode: "consensus", ...)` to review a known file with at least 2 agents. Pick a file with clear findings (e.g., `packages/orchestrator/src/dispatch-pipeline.ts`).

- [ ] **Step 2: Collect and check results**

Use `gossip_collect(task_ids: [...], consensus: true)`. Check:
- Findings with file:line citations have `<anchor>` blocks in the cross-review prompt (visible in stderr logs)
- UNVERIFIED count is lower than the historical ~52% baseline
- No regressions — confirmed/disputed findings still work correctly

- [ ] **Step 3: Record signals for any notable results**

If the UNVERIFIED rate dropped significantly, that's a positive signal for the implementation.

---

## Summary

| Task | What | Files | Est. |
|------|------|-------|------|
| 1 | Tier 0 normalized match | consensus-engine.ts, test | 3 min |
| 2 | `snippetsForFinding` method | consensus-engine.ts, test | 5 min |
| 3 | Wire into cross-review prompt | consensus-engine.ts, test | 5 min |
| 4 | Remove dead `inlineCodeAnchors` | consensus-engine.ts | 2 min |
| 5 | Integration smoke test | — | 5 min |
