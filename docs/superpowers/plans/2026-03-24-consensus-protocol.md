# Consensus Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured cross-review round after parallel agent dispatch, producing a consensus report with CONFIRMED/DISPUTED/UNIQUE/NEW tags and feeding performance signals into `agent-performance.jsonl`.

**Architecture:** After Phase 1 (existing parallel dispatch), a new `ConsensusEngine` summarizes each agent's findings, dispatches cross-review LLM calls directly (not through relay), and synthesizes tagged findings. The engine lives in `packages/orchestrator/src/consensus-engine.ts` and is called from `DispatchPipeline.collect()` when `consensus: true`. Performance signals are appended to `.gossip/agent-performance.jsonl`.

**Tech Stack:** TypeScript, Jest, existing `ILLMProvider` abstraction, existing `DispatchPipeline`

---

## Decisions from spec review

These decisions were made during interactive review with the user and override the spec where they differ:

1. **Phase 2 uses direct LLM calls** — not relay dispatch. Same model/provider as the agent, but called from the orchestrator. No tool use needed.
2. **Summarization via structured output** — agents include a `## Consensus Summary` section (one-liner per finding, no max count). Only injected when `consensus: true`. Fallback: cheap LLM summarization if section missing.
3. **Return type** — `collect()` always returns `{ results: TaskEntry[], consensus?: ConsensusReport }`. Breaking change from `TaskEntry[]`.
4. **agent-performance.jsonl** — created as part of this feature. First entries are consensus signals.
5. **Tool surface** — `gossip_collect({ consensus: true })`, not a separate tool.
6. **All successful agents** participate in consensus. No filtering for MVP. (Filtering by task similarity deferred to v2.)
7. **Preset lookup** — consensus engine looks up presets from agent registry at synthesis time, not stored on TaskEntry.

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/orchestrator/src/consensus-engine.ts` | **Create** | Extract summaries, dispatch cross-review LLM calls, synthesize tagged findings, emit signals |
| `packages/orchestrator/src/consensus-types.ts` | **Create** | `ConsensusReport`, `ConsensusFinding`, `ConsensusSignal`, `CrossReviewEntry`, `CollectResult` |
| `packages/orchestrator/src/performance-writer.ts` | **Create** | Append `ConsensusSignal` entries to `.gossip/agent-performance.jsonl` |
| `packages/orchestrator/src/dispatch-pipeline.ts` | **Modify** | Change `collect()` signature → `CollectResult`, add consensus option, call engine |
| `packages/orchestrator/src/prompt-assembler.ts` | **Modify** | Add `consensusSummaryInstruction` block |
| `packages/orchestrator/src/types.ts` | **Modify** | Add `consensus` to `DispatchOptions` |
| `packages/orchestrator/src/main-agent.ts` | **Modify** | Pass-through consensus option in collect/dispatchParallel |
| `packages/orchestrator/src/index.ts` | **Modify** | Export new modules |
| `apps/cli/src/mcp-server-sdk.ts` | **Modify** | Add `consensus` param to `gossip_collect`, format consensus report |
| `tests/orchestrator/consensus-engine.test.ts` | **Create** | Unit tests for engine |
| `tests/orchestrator/performance-writer.test.ts` | **Create** | Unit tests for JSONL writer |
| `tests/orchestrator/dispatch-pipeline-consensus.test.ts` | **Create** | Integration test: pipeline + consensus flow |

---

## Task 1: Consensus types

**Files:**
- Create: `packages/orchestrator/src/consensus-types.ts`
- Test: `tests/orchestrator/consensus-engine.test.ts` (type import validation)

- [ ] **Step 1: Write the type definitions**

```typescript
// packages/orchestrator/src/consensus-types.ts

/** A finding tagged by consensus phase */
export interface ConsensusFinding {
  id: string;
  originalAgentId: string;
  finding: string;
  tag: 'confirmed' | 'disputed' | 'unique';
  confirmedBy: string[];
  disputedBy: Array<{
    agentId: string;
    reason: string;
    evidence: string;
  }>;
  confidence: number; // 1-5, averaged from cross-review responses
}

/** A new finding discovered during cross-review */
export interface ConsensusNewFinding {
  agentId: string;
  finding: string;
  evidence: string;
  confidence: number;
}

/** A single cross-review entry from one agent about one peer finding */
export interface CrossReviewEntry {
  action: 'agree' | 'disagree' | 'new';
  agentId: string;       // the reviewing agent
  peerAgentId: string;   // the agent whose finding is being reviewed
  finding: string;
  evidence: string;
  confidence: number;    // 1-5
}

/** Full consensus report */
export interface ConsensusReport {
  agentCount: number;
  rounds: number;        // always 2 for MVP (phase 1 + phase 2)
  confirmed: ConsensusFinding[];
  disputed: ConsensusFinding[];
  unique: ConsensusFinding[];
  newFindings: ConsensusNewFinding[];
  signals: ConsensusSignal[];
  summary: string;       // formatted text report
}

/** Return type for collect() */
export interface CollectResult {
  results: import('./types').TaskEntry[];
  consensus?: ConsensusReport;
}

/** A consensus signal for agent performance tracking */
export interface ConsensusSignal {
  type: 'consensus';
  taskId: string;
  signal: 'agreement' | 'disagreement' | 'unique_confirmed' | 'unique_unconfirmed' | 'new_finding' | 'hallucination_caught';
  agentId: string;
  counterpartId?: string;
  skill?: string;
  outcome?: 'correct' | 'incorrect' | 'unresolved';
  evidence: string;
  timestamp: string;
}
```

- [ ] **Step 2: Write a smoke test that imports the types**

```typescript
// tests/orchestrator/consensus-engine.test.ts (initial — will be extended in later tasks)
import type { ConsensusReport, ConsensusFinding, ConsensusSignal, CollectResult } from '@gossip/orchestrator';

describe('Consensus types', () => {
  it('CollectResult shape is valid', () => {
    const result: CollectResult = {
      results: [],
      consensus: undefined,
    };
    expect(result.results).toEqual([]);
    expect(result.consensus).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 4: Export from index.ts**

Add to `packages/orchestrator/src/index.ts`:
```typescript
export * from './consensus-types';
```

- [ ] **Step 5: Run test again to verify export works**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/consensus-types.ts packages/orchestrator/src/index.ts tests/orchestrator/consensus-engine.test.ts
git commit -m "feat(consensus): add consensus type definitions"
```

---

## Task 2: Performance writer

**Files:**
- Create: `packages/orchestrator/src/performance-writer.ts`
- Create: `tests/orchestrator/performance-writer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/orchestrator/performance-writer.test.ts
import { PerformanceWriter } from '@gossip/orchestrator';
import { ConsensusSignal } from '@gossip/orchestrator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('PerformanceWriter', () => {
  let tmpDir: string;
  let writer: PerformanceWriter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-writer-'));
    fs.mkdirSync(path.join(tmpDir, '.gossip'), { recursive: true });
    writer = new PerformanceWriter(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends a signal to agent-performance.jsonl', () => {
    const signal: ConsensusSignal = {
      type: 'consensus',
      taskId: 'abc123',
      signal: 'agreement',
      agentId: 'gemini-reviewer',
      counterpartId: 'gemini-tester',
      evidence: 'both found SQL injection at auth.ts:47',
      timestamp: '2026-03-24T10:00:00Z',
    };
    writer.appendSignal(signal);

    const filePath = path.join(tmpDir, '.gossip', 'agent-performance.jsonl');
    expect(fs.existsSync(filePath)).toBe(true);
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(signal);
  });

  it('appends multiple signals', () => {
    const signal1: ConsensusSignal = {
      type: 'consensus', taskId: 't1', signal: 'agreement',
      agentId: 'a', evidence: 'e1', timestamp: '2026-03-24T10:00:00Z',
    };
    const signal2: ConsensusSignal = {
      type: 'consensus', taskId: 't2', signal: 'disagreement',
      agentId: 'b', counterpartId: 'a', outcome: 'correct',
      evidence: 'e2', timestamp: '2026-03-24T10:01:00Z',
    };
    writer.appendSignal(signal1);
    writer.appendSignal(signal2);

    const filePath = path.join(tmpDir, '.gossip', 'agent-performance.jsonl');
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('appendSignals batch writes', () => {
    const signals: ConsensusSignal[] = [
      { type: 'consensus', taskId: 't1', signal: 'agreement', agentId: 'a', evidence: 'e1', timestamp: '2026-03-24T10:00:00Z' },
      { type: 'consensus', taskId: 't2', signal: 'new_finding', agentId: 'b', evidence: 'e2', timestamp: '2026-03-24T10:01:00Z' },
    ];
    writer.appendSignals(signals);

    const filePath = path.join(tmpDir, '.gossip', 'agent-performance.jsonl');
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/performance-writer.test.ts --no-coverage`
Expected: FAIL — cannot find `PerformanceWriter`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/orchestrator/src/performance-writer.ts
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ConsensusSignal } from './consensus-types';

export class PerformanceWriter {
  private readonly filePath: string;

  constructor(projectRoot: string) {
    const dir = join(projectRoot, '.gossip');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'agent-performance.jsonl');
  }

  appendSignal(signal: ConsensusSignal): void {
    appendFileSync(this.filePath, JSON.stringify(signal) + '\n');
  }

  appendSignals(signals: ConsensusSignal[]): void {
    if (signals.length === 0) return;
    const data = signals.map(s => JSON.stringify(s)).join('\n') + '\n';
    appendFileSync(this.filePath, data);
  }
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/orchestrator/src/index.ts`:
```typescript
export { PerformanceWriter } from './performance-writer';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/orchestrator/performance-writer.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/performance-writer.ts packages/orchestrator/src/index.ts tests/orchestrator/performance-writer.test.ts
git commit -m "feat(consensus): add PerformanceWriter for agent-performance.jsonl"
```

---

## Task 3: Consensus engine — summary extraction

**Files:**
- Create: `packages/orchestrator/src/consensus-engine.ts`
- Modify: `tests/orchestrator/consensus-engine.test.ts`

The consensus engine is the core module. We build it incrementally: first summary extraction, then cross-review dispatch, then synthesis.

- [ ] **Step 1: Write the failing test for summary extraction**

```typescript
// Add to tests/orchestrator/consensus-engine.test.ts
import { ConsensusEngine } from '@gossip/orchestrator';

describe('ConsensusEngine', () => {
  describe('extractSummary()', () => {
    it('extracts ## Consensus Summary section', () => {
      const result = `Some long analysis...\n\n## Consensus Summary\n- SQL injection at auth.ts:47\n- Missing rate limiting on /api/tasks\n\nSome trailing text`;
      const engine = new ConsensusEngine({
        llm: null as any, // not needed for extraction
        registryGet: () => undefined,
      });
      const summary = engine.extractSummary(result);
      expect(summary).toBe('- SQL injection at auth.ts:47\n- Missing rate limiting on /api/tasks');
    });

    it('returns full result (truncated) when no summary section found', () => {
      const result = 'Found a bug at line 47. Also line 92 has issues.';
      const engine = new ConsensusEngine({
        llm: null as any,
        registryGet: () => undefined,
      });
      const summary = engine.extractSummary(result);
      expect(summary).toBe(result); // short enough, no truncation
    });

    it('truncates full result at sentence boundary when no summary section', () => {
      // Build a long result with clear sentence boundaries
      const sentences = Array.from({ length: 50 }, (_, i) => `Finding ${i}: something is wrong at file${i}.ts:${i}.`);
      const result = sentences.join(' ');
      const engine = new ConsensusEngine({
        llm: null as any,
        registryGet: () => undefined,
      });
      const summary = engine.extractSummary(result);
      // Should end at a sentence boundary (period), not mid-word
      expect(summary.endsWith('.')).toBe(true);
      expect(summary.length).toBeLessThanOrEqual(2000);
    });

    it('returns empty string for empty result', () => {
      const engine = new ConsensusEngine({
        llm: null as any,
        registryGet: () => undefined,
      });
      const summary = engine.extractSummary('');
      expect(summary).toBe('');
    });

    it('handles multiple ## Consensus Summary sections (takes first)', () => {
      const result = '## Consensus Summary\n- Finding A\n\n## Consensus Summary\n- Finding B';
      const engine = new ConsensusEngine({
        llm: null as any,
        registryGet: () => undefined,
      });
      const summary = engine.extractSummary(result);
      expect(summary).toContain('Finding A');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: FAIL — cannot find `ConsensusEngine`

- [ ] **Step 3: Write the implementation**

```typescript
// packages/orchestrator/src/consensus-engine.ts
import { ILLMProvider } from './llm-client';
import { AgentConfig, TaskEntry } from './types';
import {
  ConsensusReport,
  ConsensusFinding,
  ConsensusNewFinding,
  ConsensusSignal,
  CrossReviewEntry,
} from './consensus-types';

const SUMMARY_HEADER = '## Consensus Summary';
const FALLBACK_MAX_LENGTH = 2000;

export interface ConsensusEngineConfig {
  llm: ILLMProvider;
  registryGet: (agentId: string) => AgentConfig | undefined;
}

export class ConsensusEngine {
  private readonly llm: ILLMProvider;
  private readonly registryGet: (agentId: string) => AgentConfig | undefined;

  constructor(config: ConsensusEngineConfig) {
    this.llm = config.llm;
    this.registryGet = config.registryGet;
  }

  /**
   * Extract the consensus summary section from an agent's result.
   * Falls back to truncated full result if section is missing.
   */
  extractSummary(result: string): string {
    const idx = result.indexOf(SUMMARY_HEADER);
    if (idx !== -1) {
      const afterHeader = result.slice(idx + SUMMARY_HEADER.length).trimStart();
      // Take until the next ## header or end of string
      const nextHeader = afterHeader.indexOf('\n## ');
      const section = nextHeader !== -1 ? afterHeader.slice(0, nextHeader) : afterHeader;
      return section.trim();
    }

    // Fallback: truncate at sentence boundary
    if (result.length <= FALLBACK_MAX_LENGTH) return result;
    const truncated = result.slice(0, FALLBACK_MAX_LENGTH);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > FALLBACK_MAX_LENGTH * 0.5) {
      return truncated.slice(0, lastPeriod + 1);
    }
    return truncated;
  }
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/orchestrator/src/index.ts`:
```typescript
export { ConsensusEngine } from './consensus-engine';
export type { ConsensusEngineConfig } from './consensus-engine';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts packages/orchestrator/src/index.ts tests/orchestrator/consensus-engine.test.ts
git commit -m "feat(consensus): ConsensusEngine with summary extraction"
```

---

## Task 4: Consensus engine — cross-review dispatch

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts`
- Modify: `tests/orchestrator/consensus-engine.test.ts`

- [ ] **Step 1: Write the failing test for cross-review dispatch**

```typescript
// Add to describe('ConsensusEngine') in tests/orchestrator/consensus-engine.test.ts
describe('dispatchCrossReview()', () => {
  it('sends cross-review prompts to each agent and collects structured responses', async () => {
    const mockLlm = {
      generate: jest.fn().mockResolvedValue({
        text: JSON.stringify([
          { action: 'agree', agentId: 'agent-b', finding: 'SQL injection', evidence: 'confirmed at auth.ts:47', confidence: 5 },
          { action: 'disagree', agentId: 'agent-b', finding: 'Rate limit bypass', evidence: 'nginx handles this', confidence: 4 },
        ]),
      }),
    };

    const engine = new ConsensusEngine({
      llm: mockLlm as any,
      registryGet: (id) => ({
        id, provider: 'google' as const, model: 'gemini-2.0-flash',
        preset: id === 'agent-a' ? 'reviewer' : 'tester', skills: [],
      }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: '## Consensus Summary\n- SQL injection at auth.ts:47\n- Rate limit bypass', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: '## Consensus Summary\n- Missing input validation', startedAt: 0 },
    ];

    const entries = await engine.dispatchCrossReview(results);
    // 2 agents → 2 LLM calls
    expect(mockLlm.generate).toHaveBeenCalledTimes(2);
    // Each call should include peer summaries
    const firstCall = mockLlm.generate.mock.calls[0][0];
    expect(firstCall[1].content).toContain('PEER FINDINGS');
    // Returns cross-review entries
    expect(entries.length).toBeGreaterThan(0);
  });

  it('gracefully skips agents whose cross-review call fails', async () => {
    let callCount = 0;
    const mockLlm = {
      generate: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('API timeout'));
        return Promise.resolve({
          text: JSON.stringify([
            { action: 'agree', agentId: 'agent-a', finding: 'bug', evidence: 'yes', confidence: 4 },
          ]),
        });
      }),
    };

    const engine = new ConsensusEngine({
      llm: mockLlm as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: 'findings A', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: 'findings B', startedAt: 0 },
    ];

    const entries = await engine.dispatchCrossReview(results);
    // First agent failed, second succeeded — should still have entries
    expect(entries.length).toBeGreaterThan(0);
  });

  it('parses cross-review JSON even with markdown code fences', async () => {
    const mockLlm = {
      generate: jest.fn().mockResolvedValue({
        text: '```json\n[{"action":"agree","agentId":"agent-b","finding":"bug","evidence":"yes","confidence":4}]\n```',
      }),
    };

    const engine = new ConsensusEngine({
      llm: mockLlm as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: 'findings A', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: 'findings B', startedAt: 0 },
    ];

    const entries = await engine.dispatchCrossReview(results);
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('agree');
  });

  it('returns empty array when LLM returns non-JSON text', async () => {
    const mockLlm = {
      generate: jest.fn().mockResolvedValue({
        text: 'I cannot produce JSON for this request. Here are my thoughts...',
      }),
    };

    const engine = new ConsensusEngine({
      llm: mockLlm as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: 'findings A', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: 'findings B', startedAt: 0 },
    ];

    const entries = await engine.dispatchCrossReview(results);
    // Both agents get non-JSON → all parsing fails → empty
    expect(entries).toHaveLength(0);
  });

  it('handles LLM returning empty JSON array', async () => {
    const mockLlm = {
      generate: jest.fn().mockResolvedValue({ text: '[]' }),
    };

    const engine = new ConsensusEngine({
      llm: mockLlm as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: 'findings A', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: 'findings B', startedAt: 0 },
    ];

    const entries = await engine.dispatchCrossReview(results);
    expect(entries).toHaveLength(0);
  });

  it('returns empty when fewer than 2 successful results', async () => {
    const engine = new ConsensusEngine({
      llm: { generate: jest.fn() } as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: 'findings', startedAt: 0 },
    ];

    const entries = await engine.dispatchCrossReview(results);
    expect(entries).toHaveLength(0);
    expect((engine as any).llm.generate).not.toHaveBeenCalled();
  });

  it('applies default confidence when entry has invalid confidence', async () => {
    const mockLlm = {
      generate: jest.fn().mockResolvedValue({
        text: JSON.stringify([
          { action: 'agree', agentId: 'agent-b', finding: 'bug', evidence: 'yes', confidence: -1 },
          { action: 'agree', agentId: 'agent-b', finding: 'bug2', evidence: 'yes' },
        ]),
      }),
    };

    const engine = new ConsensusEngine({
      llm: mockLlm as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: 'findings A', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: 'findings B', startedAt: 0 },
    ];

    const entries = await engine.dispatchCrossReview(results);
    // confidence -1 should be clamped to 1, missing confidence should default to 3
    expect(entries.some(e => e.confidence === 1)).toBe(true);
    expect(entries.some(e => e.confidence === 3)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: FAIL — `dispatchCrossReview` is not a function

- [ ] **Step 3: Implement `dispatchCrossReview`**

Add to `ConsensusEngine` class in `packages/orchestrator/src/consensus-engine.ts`:

```typescript
/**
 * Dispatch cross-review to all agents. Each agent reviews all peers' summaries.
 * Uses direct LLM calls (not relay) for cost efficiency.
 */
async dispatchCrossReview(results: TaskEntry[]): Promise<CrossReviewEntry[]> {
  const successful = results.filter(r => r.status === 'completed' && r.result);
  if (successful.length < 2) return [];

  // Build summaries map
  const summaries = new Map<string, string>();
  for (const r of successful) {
    summaries.set(r.agentId, this.extractSummary(r.result!));
  }

  // Dispatch cross-review in parallel
  const allEntries: CrossReviewEntry[] = [];
  const promises = successful.map(async (agent) => {
    try {
      const entries = await this.crossReviewForAgent(agent, summaries);
      return entries;
    } catch (err) {
      process.stderr.write(`[consensus] Cross-review failed for ${agent.agentId}: ${(err as Error).message}\n`);
      return [];
    }
  });

  const results2 = await Promise.all(promises);
  for (const entries of results2) {
    allEntries.push(...entries);
  }
  return allEntries;
}

private async crossReviewForAgent(
  agent: TaskEntry,
  summaries: Map<string, string>,
): Promise<CrossReviewEntry[]> {
  const ownSummary = summaries.get(agent.agentId) || '';
  const peerLines: string[] = [];
  for (const [peerId, summary] of summaries) {
    if (peerId === agent.agentId) continue;
    const preset = this.registryGet(peerId)?.preset || 'unknown';
    peerLines.push(`Agent "${peerId}" (${preset}):\n${summary}`);
  }

  const prompt = `You previously reviewed code and produced findings. Now review your peers' findings.

YOUR FINDINGS (Phase 1):
${ownSummary}

PEER FINDINGS:
${peerLines.join('\n\n')}

For each peer finding, respond with one of:
- AGREE: You independently confirm this finding is correct. Cite your evidence.
- DISAGREE: You believe this finding is incorrect. Explain why with evidence (file:line references).
- NEW: Something ALL agents missed that you now realize after seeing peer work.

Return ONLY a JSON array:
[
  { "action": "agree"|"disagree"|"new", "agentId": "peer_id", "finding": "summary", "evidence": "your reasoning", "confidence": 1-5 }
]`;

  const messages: import('@gossip/types').LLMMessage[] = [
    { role: 'system', content: 'You are a code reviewer performing cross-review. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ];

  const response = await this.llm.generate(messages, { temperature: 0 });
  return this.parseCrossReviewResponse(agent.agentId, response.text);
}

private parseCrossReviewResponse(reviewerAgentId: string, text: string): CrossReviewEntry[] {
  // Strip markdown code fences
  let json = text.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(json) as Array<{
      action: string;
      agentId: string;
      finding: string;
      evidence: string;
      confidence: number;
    }>;

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(e => ['agree', 'disagree', 'new'].includes(e.action))
      .map(e => ({
        action: e.action as 'agree' | 'disagree' | 'new',
        agentId: reviewerAgentId,
        peerAgentId: e.agentId,
        finding: e.finding || '',
        evidence: e.evidence || '',
        confidence: Math.max(1, Math.min(5, e.confidence || 3)),
      }));
  } catch {
    process.stderr.write(`[consensus] Failed to parse cross-review JSON from ${reviewerAgentId}\n`);
    return [];
  }
}
```

Note: you'll need to add `import { LLMMessage } from '@gossip/types';` at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts tests/orchestrator/consensus-engine.test.ts
git commit -m "feat(consensus): cross-review dispatch with graceful degradation"
```

---

## Task 5: Consensus engine — synthesis

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts`
- Modify: `tests/orchestrator/consensus-engine.test.ts`

- [ ] **Step 1: Write the failing test for synthesis**

```typescript
// Add to describe('ConsensusEngine')
describe('synthesize()', () => {
  it('tags findings as confirmed when peer agrees', () => {
    const engine = new ConsensusEngine({
      llm: null as any,
      registryGet: (id) => ({
        id, provider: 'google' as const, model: 'm',
        preset: id === 'agent-a' ? 'reviewer' : 'tester', skills: [],
      }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: '## Consensus Summary\n- SQL injection at auth.ts:47', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: '## Consensus Summary\n- Missing validation', startedAt: 0 },
    ];

    const crossReviewEntries: CrossReviewEntry[] = [
      { action: 'agree', agentId: 'agent-b', peerAgentId: 'agent-a', finding: 'SQL injection at auth.ts:47', evidence: 'confirmed', confidence: 5 },
    ];

    const report = engine.synthesize(results, crossReviewEntries);
    expect(report.confirmed).toHaveLength(1);
    expect(report.confirmed[0].finding).toContain('SQL injection');
    expect(report.confirmed[0].confirmedBy).toContain('agent-b');
  });

  it('tags findings as disputed when peer disagrees', () => {
    const engine = new ConsensusEngine({
      llm: null as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: '## Consensus Summary\n- Rate limit bypass', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: '## Consensus Summary\n- Other finding', startedAt: 0 },
    ];

    const crossReviewEntries: CrossReviewEntry[] = [
      { action: 'disagree', agentId: 'agent-b', peerAgentId: 'agent-a', finding: 'Rate limit bypass', evidence: 'nginx handles this', confidence: 4 },
    ];

    const report = engine.synthesize(results, crossReviewEntries);
    expect(report.disputed).toHaveLength(1);
    expect(report.disputed[0].disputedBy[0].reason).toContain('nginx');
  });

  it('tags findings as unique when no peer mentions them', () => {
    const engine = new ConsensusEngine({
      llm: null as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: '## Consensus Summary\n- Obscure edge case', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: '## Consensus Summary\n- Something else', startedAt: 0 },
    ];

    const report = engine.synthesize(results, []);
    // Both findings are unique (no cross-review mentions)
    expect(report.unique.length).toBeGreaterThanOrEqual(2);
  });

  it('collects new findings from cross-review', () => {
    const engine = new ConsensusEngine({
      llm: null as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: '## Consensus Summary\n- Finding A', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: '## Consensus Summary\n- Finding B', startedAt: 0 },
    ];

    const crossReviewEntries: CrossReviewEntry[] = [
      { action: 'new', agentId: 'agent-a', peerAgentId: 'agent-b', finding: 'No auth error path tests', evidence: 'After seeing Bs findings', confidence: 4 },
    ];

    const report = engine.synthesize(results, crossReviewEntries);
    expect(report.newFindings).toHaveLength(1);
    expect(report.newFindings[0].finding).toContain('auth error path');
  });

  it('generates consensus signals', () => {
    const engine = new ConsensusEngine({
      llm: null as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: '## Consensus Summary\n- Bug A', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: '## Consensus Summary\n- Bug B', startedAt: 0 },
    ];

    const crossReviewEntries: CrossReviewEntry[] = [
      { action: 'agree', agentId: 'agent-b', peerAgentId: 'agent-a', finding: 'Bug A', evidence: 'confirmed', confidence: 5 },
      { action: 'new', agentId: 'agent-a', peerAgentId: 'agent-b', finding: 'Missed thing', evidence: 'realized after', confidence: 3 },
    ];

    const report = engine.synthesize(results, crossReviewEntries);
    expect(report.signals.length).toBeGreaterThan(0);
    expect(report.signals.some(s => s.signal === 'agreement')).toBe(true);
    expect(report.signals.some(s => s.signal === 'new_finding')).toBe(true);
  });

  it('emits hallucination_caught signal when disagree evidence indicates hallucination', () => {
    const engine = new ConsensusEngine({
      llm: null as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: '## Consensus Summary\n- Vulnerability at server.ts:47', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: '## Consensus Summary\n- Other finding', startedAt: 0 },
    ];

    const crossReviewEntries: CrossReviewEntry[] = [
      { action: 'disagree', agentId: 'agent-b', peerAgentId: 'agent-a', finding: 'Vulnerability at server.ts:47', evidence: 'line 47 does not exist, file only has 30 lines', confidence: 5 },
    ];

    const report = engine.synthesize(results, crossReviewEntries);
    expect(report.signals.some(s => s.signal === 'hallucination_caught')).toBe(true);
    expect(report.signals.some(s => s.signal === 'hallucination_caught' && s.agentId === 'agent-a')).toBe(true);
  });

  it('detects hallucination from various indicator phrases', () => {
    const engine = new ConsensusEngine({
      llm: null as any,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'm', skills: [] }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: '## Consensus Summary\n- Bug in validateInput()\n- Issue at auth.ts:99', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: '## Consensus Summary\n- Other', startedAt: 0 },
    ];

    const crossReviewEntries: CrossReviewEntry[] = [
      { action: 'disagree', agentId: 'agent-b', peerAgentId: 'agent-a', finding: 'Bug in validateInput()', evidence: 'no such function exists in the codebase', confidence: 5 },
      { action: 'disagree', agentId: 'agent-b', peerAgentId: 'agent-a', finding: 'Issue at auth.ts:99', evidence: 'line 99 is a comment, not executable code', confidence: 4 },
    ];

    const report = engine.synthesize(results, crossReviewEntries);
    const hallucinations = report.signals.filter(s => s.signal === 'hallucination_caught');
    expect(hallucinations).toHaveLength(2);
  });

  describe('findMatchingFinding()', () => {
    const engine = new ConsensusEngine({
      llm: null as any,
      registryGet: () => undefined,
    });

    // Access private method for testing
    const match = (findings: Array<[string, string]>, peerId: string, text: string) => {
      const map = new Map(findings.map(([agent, finding]) => [
        `${agent}::${finding}`,
        { originalAgentId: agent, finding, confirmedBy: [] as string[], disputedBy: [] as any[], confidences: [] as number[] },
      ]));
      return (engine as any).findMatchingFinding(map, peerId, text);
    };

    it('matches exact finding text', () => {
      expect(match([['a', 'SQL injection at auth.ts:47']], 'a', 'SQL injection at auth.ts:47')).toBeTruthy();
    });

    it('matches case-insensitive substring', () => {
      expect(match([['a', 'SQL injection at auth.ts:47']], 'a', 'sql injection')).toBeTruthy();
    });

    it('matches by significant word overlap', () => {
      expect(match([['a', 'SQL injection vulnerability in auth handler']], 'a', 'SQLi vulnerability auth handler detected')).toBeTruthy();
    });

    it('returns null when no match found', () => {
      expect(match([['a', 'SQL injection']], 'a', 'completely unrelated finding')).toBeNull();
    });

    it('only matches findings from the specified peer agent', () => {
      expect(match([['a', 'SQL injection'], ['b', 'SQL injection']], 'b', 'SQL injection')).toBe('b::SQL injection');
    });
  });

  it('generates formatted summary string', () => {
    const engine = new ConsensusEngine({
      llm: null as any,
      registryGet: (id) => ({
        id, provider: 'google' as const, model: 'm',
        preset: id === 'agent-a' ? 'reviewer' : 'tester', skills: [],
      }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: '## Consensus Summary\n- SQL injection', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: '## Consensus Summary\n- Missing tests', startedAt: 0 },
    ];

    const crossReviewEntries: CrossReviewEntry[] = [
      { action: 'agree', agentId: 'agent-b', peerAgentId: 'agent-a', finding: 'SQL injection', evidence: 'confirmed', confidence: 5 },
    ];

    const report = engine.synthesize(results, crossReviewEntries);
    expect(report.summary).toContain('CONSENSUS REPORT');
    expect(report.summary).toContain('CONFIRMED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: FAIL — `synthesize` is not a function

- [ ] **Step 3: Implement `synthesize`**

Add to `ConsensusEngine` class:

```typescript
/**
 * Synthesize cross-review entries into a consensus report.
 * Tags each finding as confirmed/disputed/unique, collects new findings,
 * and emits performance signals.
 */
synthesize(results: TaskEntry[], crossReviewEntries: CrossReviewEntry[]): ConsensusReport {
  const successful = results.filter(r => r.status === 'completed' && r.result);

  // Build per-finding data: which agents mentioned it, who agreed/disagreed
  const findingMap = new Map<string, {
    originalAgentId: string;
    finding: string;
    confirmedBy: string[];
    disputedBy: Array<{ agentId: string; reason: string; evidence: string }>;
    confidences: number[];
  }>();

  // Seed with Phase 1 findings (one per summary line per agent)
  for (const r of successful) {
    const summary = this.extractSummary(r.result!);
    const lines = summary.split('\n').filter(l => l.trim().startsWith('-'));
    for (const line of lines) {
      const finding = line.replace(/^-\s*/, '').trim();
      if (!finding) continue;
      const key = `${r.agentId}::${finding}`;
      findingMap.set(key, {
        originalAgentId: r.agentId,
        finding,
        confirmedBy: [],
        disputedBy: [],
        confidences: [],
      });
    }
  }

  // Apply cross-review entries
  const newFindings: ConsensusNewFinding[] = [];
  const signals: ConsensusSignal[] = [];
  const now = new Date().toISOString();

  for (const entry of crossReviewEntries) {
    if (entry.action === 'new') {
      newFindings.push({
        agentId: entry.agentId,
        finding: entry.finding,
        evidence: entry.evidence,
        confidence: entry.confidence,
      });
      signals.push({
        type: 'consensus', taskId: results[0]?.id || '', signal: 'new_finding',
        agentId: entry.agentId, evidence: entry.evidence, timestamp: now,
      });
      continue;
    }

    // Find the matching Phase 1 finding
    const matchKey = this.findMatchingFinding(findingMap, entry.peerAgentId, entry.finding);
    if (!matchKey) continue;
    const data = findingMap.get(matchKey)!;

    if (entry.action === 'agree') {
      data.confirmedBy.push(entry.agentId);
      data.confidences.push(entry.confidence);
      signals.push({
        type: 'consensus', taskId: results[0]?.id || '', signal: 'agreement',
        agentId: entry.agentId, counterpartId: entry.peerAgentId,
        evidence: entry.evidence, timestamp: now,
      });
    } else if (entry.action === 'disagree') {
      data.disputedBy.push({
        agentId: entry.agentId,
        reason: entry.evidence,
        evidence: entry.evidence,
      });
      data.confidences.push(entry.confidence);

      // Detect hallucination: check if the disagreement evidence indicates
      // the original finding referenced something that doesn't exist
      const isHallucination = this.detectHallucination(entry.evidence);
      signals.push({
        type: 'consensus', taskId: results[0]?.id || '',
        signal: isHallucination ? 'hallucination_caught' : 'disagreement',
        agentId: entry.peerAgentId, counterpartId: entry.agentId,
        outcome: isHallucination ? 'incorrect' : 'unresolved',
        evidence: entry.evidence, timestamp: now,
      });
    }
  }

  // Tag findings
  const confirmed: ConsensusFinding[] = [];
  const disputed: ConsensusFinding[] = [];
  const unique: ConsensusFinding[] = [];
  let idCounter = 0;

  for (const [, data] of findingMap) {
    const avgConfidence = data.confidences.length > 0
      ? data.confidences.reduce((a, b) => a + b, 0) / data.confidences.length
      : 3;

    const finding: ConsensusFinding = {
      id: `cf-${++idCounter}`,
      originalAgentId: data.originalAgentId,
      finding: data.finding,
      tag: 'unique', // default
      confirmedBy: data.confirmedBy,
      disputedBy: data.disputedBy,
      confidence: Math.round(avgConfidence * 10) / 10,
    };

    if (data.disputedBy.length > 0) {
      finding.tag = 'disputed';
      disputed.push(finding);
    } else if (data.confirmedBy.length > 0) {
      finding.tag = 'confirmed';
      confirmed.push(finding);
    } else {
      unique.push(finding);
    }
  }

  // Generate unique signals
  for (const f of unique) {
    signals.push({
      type: 'consensus', taskId: results[0]?.id || '',
      signal: 'unique_unconfirmed',
      agentId: f.originalAgentId, evidence: f.finding, timestamp: now,
    });
  }

  const summary = this.formatReport(confirmed, disputed, unique, newFindings, successful.length);

  return {
    agentCount: successful.length,
    rounds: 2,
    confirmed, disputed, unique, newFindings, signals, summary,
  };
}

/**
 * Find the best matching finding key for a cross-review entry.
 * Uses exact agent ID match + substring/overlap matching on finding text.
 */
private findMatchingFinding(
  findingMap: Map<string, { originalAgentId: string; finding: string; confirmedBy: string[]; disputedBy: Array<{ agentId: string; reason: string; evidence: string }>; confidences: number[] }>,
  peerAgentId: string,
  findingText: string,
): string | null {
  // First: exact match on agentId + finding
  for (const [key, data] of findingMap) {
    if (data.originalAgentId === peerAgentId && data.finding === findingText) return key;
  }
  // Second: agentId match + substring
  const normalizedFinding = findingText.toLowerCase();
  for (const [key, data] of findingMap) {
    if (data.originalAgentId !== peerAgentId) continue;
    if (data.finding.toLowerCase().includes(normalizedFinding) ||
        normalizedFinding.includes(data.finding.toLowerCase())) {
      return key;
    }
  }
  // Third: agentId match + significant word overlap (>50%)
  const findingWords = new Set(normalizedFinding.split(/\s+/).filter(w => w.length > 3));
  for (const [key, data] of findingMap) {
    if (data.originalAgentId !== peerAgentId) continue;
    const dataWords = new Set(data.finding.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const overlap = [...findingWords].filter(w => dataWords.has(w)).length;
    if (overlap > 0 && overlap / Math.max(findingWords.size, dataWords.size) > 0.5) {
      return key;
    }
  }
  return null;
}

/**
 * Detect whether a disagreement's evidence indicates a hallucination.
 * Checks for phrases that suggest the original finding referenced
 * something that doesn't exist in the codebase.
 */
private detectHallucination(evidence: string): boolean {
  const lower = evidence.toLowerCase();
  const indicators = [
    'does not exist',
    'doesn\'t exist',
    'no such file',
    'no such function',
    'no such method',
    'no such variable',
    'not found in',
    'is a comment',
    'only has',           // "file only has 30 lines"
    'no line',            // "no line 47"
    'nonexistent',
    'non-existent',
    'never defined',
    'not defined',
    'fabricated',
    'hallucinated',
  ];
  return indicators.some(phrase => lower.includes(phrase));
}

private formatReport(
  confirmed: ConsensusFinding[],
  disputed: ConsensusFinding[],
  unique: ConsensusFinding[],
  newFindings: ConsensusNewFinding[],
  agentCount: number,
): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════');
  lines.push(`CONSENSUS REPORT (${agentCount} agents, 2 rounds)`);
  lines.push('═══════════════════════════════════════════');
  lines.push('');

  if (confirmed.length > 0) {
    lines.push('CONFIRMED (high confidence — act on these):');
    for (const f of confirmed) {
      const preset = this.registryGet(f.originalAgentId)?.preset || f.originalAgentId;
      const confirmerPresets = f.confirmedBy.map(id => this.registryGet(id)?.preset || id);
      lines.push(`  ✓ [${preset} + ${confirmerPresets.join(' + ')}] ${f.finding}`);
    }
    lines.push('');
  }

  if (disputed.length > 0) {
    lines.push('DISPUTED (agents disagree — review the evidence):');
    for (const f of disputed) {
      const origPreset = this.registryGet(f.originalAgentId)?.preset || f.originalAgentId;
      for (const d of f.disputedBy) {
        const dispPreset = this.registryGet(d.agentId)?.preset || d.agentId;
        lines.push(`  ⚡ [${origPreset} vs ${dispPreset}] "${f.finding}"`);
        lines.push(`    → ${origPreset}: original finding`);
        lines.push(`    → ${dispPreset}: ${d.reason}`);
      }
    }
    lines.push('');
  }

  if (unique.length > 0) {
    lines.push('UNIQUE (one agent only — verify before acting):');
    for (const f of unique) {
      const preset = this.registryGet(f.originalAgentId)?.preset || f.originalAgentId;
      lines.push(`  ? [${preset}] "${f.finding}"`);
    }
    lines.push('');
  }

  if (newFindings.length > 0) {
    lines.push('NEW (discovered during cross-review):');
    for (const f of newFindings) {
      const preset = this.registryGet(f.agentId)?.preset || f.agentId;
      lines.push(`  ★ [${preset}] "${f.finding}"`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════');
  lines.push(`Summary: ${confirmed.length} confirmed, ${disputed.length} disputed, ${unique.length} unique, ${newFindings.length} new`);
  lines.push('═══════════════════════════════════════════');

  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts tests/orchestrator/consensus-engine.test.ts
git commit -m "feat(consensus): synthesis with tagging, signals, and formatted report"
```

---

## Task 6: Consensus engine — full `run()` method

**Files:**
- Modify: `packages/orchestrator/src/consensus-engine.ts`
- Modify: `tests/orchestrator/consensus-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe('run()', () => {
  it('runs full consensus pipeline: extract → cross-review → synthesize → report', async () => {
    const mockLlm = {
      generate: jest.fn().mockResolvedValue({
        text: JSON.stringify([
          { action: 'agree', agentId: 'agent-a', finding: 'SQL injection', evidence: 'confirmed at auth.ts:47', confidence: 5 },
        ]),
      }),
    };

    const engine = new ConsensusEngine({
      llm: mockLlm as any,
      registryGet: (id) => ({
        id, provider: 'google' as const, model: 'm',
        preset: id === 'agent-a' ? 'reviewer' : 'tester', skills: ['security'],
      }),
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: '## Consensus Summary\n- SQL injection at auth.ts:47', startedAt: 0 },
      { id: 't2', agentId: 'agent-b', task: 'review', status: 'completed', result: '## Consensus Summary\n- Missing validation on /api/tasks', startedAt: 0 },
    ];

    const report = await engine.run(results);
    expect(report.agentCount).toBe(2);
    expect(report.rounds).toBe(2);
    expect(report.summary).toContain('CONSENSUS REPORT');
    expect(report.signals.length).toBeGreaterThan(0);
  });

  it('returns empty report when fewer than 2 successful agents', async () => {
    const engine = new ConsensusEngine({
      llm: null as any,
      registryGet: () => undefined,
    });

    const results: TaskEntry[] = [
      { id: 't1', agentId: 'agent-a', task: 'review', status: 'completed', result: 'stuff', startedAt: 0 },
    ];

    const report = await engine.run(results);
    expect(report.agentCount).toBe(0);
    expect(report.confirmed).toEqual([]);
    expect(report.summary).toContain('insufficient agents');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: FAIL — `run` is not a function

- [ ] **Step 3: Implement `run()`**

Add to `ConsensusEngine` class:

```typescript
/**
 * Run the full consensus pipeline.
 * Phase 2: cross-review → Phase 3: synthesis → signals.
 */
async run(results: TaskEntry[]): Promise<ConsensusReport> {
  const successful = results.filter(r => r.status === 'completed' && r.result);
  if (successful.length < 2) {
    return {
      agentCount: 0, rounds: 0,
      confirmed: [], disputed: [], unique: [], newFindings: [], signals: [],
      summary: 'Consensus skipped: insufficient agents (need ≥2 successful).',
    };
  }

  process.stderr.write(`[consensus] Starting cross-review for ${successful.length} agents\n`);
  const crossReviewEntries = await this.dispatchCrossReview(results);
  process.stderr.write(`[consensus] Cross-review complete: ${crossReviewEntries.length} entries\n`);

  const report = this.synthesize(results, crossReviewEntries);
  process.stderr.write(`[consensus] ${report.confirmed.length} confirmed, ${report.disputed.length} disputed, ${report.unique.length} unique, ${report.newFindings.length} new\n`);

  return report;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/orchestrator/consensus-engine.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/consensus-engine.ts tests/orchestrator/consensus-engine.test.ts
git commit -m "feat(consensus): full run() pipeline method"
```

---

## Task 7: Wire consensus into DispatchPipeline

**Files:**
- Modify: `packages/orchestrator/src/types.ts` — add `consensus` to `DispatchOptions`
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts` — change `collect()` return type, call consensus engine
- Modify: `packages/orchestrator/src/prompt-assembler.ts` — add consensus summary instruction
- Create: `tests/orchestrator/dispatch-pipeline-consensus.test.ts`

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/orchestrator/dispatch-pipeline-consensus.test.ts
import { DispatchPipeline } from '@gossip/orchestrator';
import type { CollectResult } from '@gossip/orchestrator';

function mockWorker(result = 'done') {
  return {
    executeTask: jest.fn().mockResolvedValue({ result, inputTokens: 0, outputTokens: 0 }),
    subscribeToBatch: jest.fn().mockResolvedValue(undefined),
    unsubscribeFromBatch: jest.fn().mockResolvedValue(undefined),
  };
}

describe('DispatchPipeline consensus integration', () => {
  it('collect() returns CollectResult shape', async () => {
    const workers = new Map([['agent-a', mockWorker('## Consensus Summary\n- Bug A')]]);
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-consensus-test-' + Date.now(),
      workers,
      registryGet: (id) => ({ id, provider: 'local' as const, model: 'mock', skills: [] }),
    });

    const { taskId } = pipeline.dispatch('agent-a', 'review code');
    const result: CollectResult = await pipeline.collect([taskId]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('completed');
    expect(result.consensus).toBeUndefined(); // no consensus requested
  });

  it('collect() with consensus: true runs consensus engine', async () => {
    const workerA = mockWorker('## Consensus Summary\n- SQL injection at auth.ts:47');
    const workerB = mockWorker('## Consensus Summary\n- Missing validation');

    const mockLlm = {
      generate: jest.fn().mockResolvedValue({
        text: JSON.stringify([
          { action: 'agree', agentId: 'agent-a', finding: 'SQL injection', evidence: 'confirmed', confidence: 5 },
        ]),
      }),
    };

    const workers = new Map([['agent-a', workerA], ['agent-b', workerB]]);
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-consensus-test-' + Date.now(),
      workers,
      registryGet: (id) => ({
        id, provider: 'google' as const, model: 'gemini-2.0-flash',
        preset: id === 'agent-a' ? 'reviewer' : 'tester', skills: [],
      }),
      llm: mockLlm as any,
    });

    const { taskIds } = await pipeline.dispatchParallel([
      { agentId: 'agent-a', task: 'review code' },
      { agentId: 'agent-b', task: 'review code' },
    ]);

    const result = await pipeline.collect(taskIds, 120_000, { consensus: true });
    expect(result.consensus).toBeDefined();
    expect(result.consensus!.agentCount).toBe(2);
    expect(result.consensus!.summary).toContain('CONSENSUS REPORT');
  });

  it('collect() still returns results when consensus engine throws', async () => {
    const workerA = mockWorker('## Consensus Summary\n- Finding A');
    const workerB = mockWorker('## Consensus Summary\n- Finding B');

    const mockLlm = {
      generate: jest.fn().mockRejectedValue(new Error('LLM provider down')),
    };

    const workers = new Map([['agent-a', workerA], ['agent-b', workerB]]);
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-consensus-test-' + Date.now(),
      workers,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'gemini-2.0-flash', skills: [] }),
      llm: mockLlm as any,
    });

    const { taskIds } = await pipeline.dispatchParallel([
      { agentId: 'agent-a', task: 'review code' },
      { agentId: 'agent-b', task: 'review code' },
    ]);

    const result = await pipeline.collect(taskIds, 120_000, { consensus: true });
    // Results should still be returned even though consensus failed
    expect(result.results).toHaveLength(2);
    expect(result.consensus).toBeUndefined();
  });

  it('collect() skips consensus when only one agent succeeds', async () => {
    const workerA = mockWorker('## Consensus Summary\n- Finding A');
    const workerB = { executeTask: jest.fn().mockRejectedValue(new Error('fail')), subscribeToBatch: jest.fn().mockResolvedValue(undefined), unsubscribeFromBatch: jest.fn().mockResolvedValue(undefined) };

    const mockLlm = { generate: jest.fn() };

    const workers = new Map<string, any>([['agent-a', workerA], ['agent-b', workerB]]);
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-consensus-test-' + Date.now(),
      workers,
      registryGet: (id) => ({ id, provider: 'google' as const, model: 'gemini-2.0-flash', skills: [] }),
      llm: mockLlm as any,
    });

    const { taskIds } = await pipeline.dispatchParallel([
      { agentId: 'agent-a', task: 'review code' },
      { agentId: 'agent-b', task: 'review code' },
    ]);

    const result = await pipeline.collect(taskIds, 120_000, { consensus: true });
    expect(result.consensus).toBeUndefined();
    expect(mockLlm.generate).not.toHaveBeenCalled(); // consensus never ran
  });

  it('collect() without consensus: true returns undefined consensus', async () => {
    const workers = new Map([
      ['agent-a', mockWorker('result A')],
      ['agent-b', mockWorker('result B')],
    ]);
    const pipeline = new DispatchPipeline({
      projectRoot: '/tmp/gossip-consensus-test-' + Date.now(),
      workers,
      registryGet: (id) => ({ id, provider: 'local' as const, model: 'mock', skills: [] }),
    });

    const { taskIds } = await pipeline.dispatchParallel([
      { agentId: 'agent-a', task: 'review code' },
      { agentId: 'agent-b', task: 'review code' },
    ]);

    const result = await pipeline.collect(taskIds);
    expect(result.consensus).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/dispatch-pipeline-consensus.test.ts --no-coverage`
Expected: FAIL — collect() still returns TaskEntry[]

- [ ] **Step 3: Add `consensus` to DispatchOptions**

In `packages/orchestrator/src/types.ts`, modify `DispatchOptions`:

```typescript
export interface DispatchOptions {
  writeMode?: 'sequential' | 'scoped' | 'worktree';
  scope?: string;
  timeoutMs?: number;
  planId?: string;
  step?: number;
  lens?: string;
  consensus?: boolean;  // NEW — enable cross-review consensus
}
```

- [ ] **Step 4: Add collect options and consensus to `collect()`**

In `packages/orchestrator/src/dispatch-pipeline.ts`:

1. Add imports at top:
```typescript
import { ConsensusEngine } from './consensus-engine';
import { PerformanceWriter } from './performance-writer';
import { CollectResult } from './consensus-types';
```

2. Change `collect()` signature (line 292) from:
```typescript
async collect(taskIds?: string[], timeoutMs: number = 120_000): Promise<TaskEntry[]> {
```
to:
```typescript
async collect(taskIds?: string[], timeoutMs: number = 120_000, options?: { consensus?: boolean }): Promise<CollectResult> {
```

3. Change the return at line 465 from:
```typescript
const results: TaskEntry[] = targets.map(t => ({
  ...
}));
// ... cleanup ...
return results;
```
to:
```typescript
const results: TaskEntry[] = targets.map(t => ({
  ...existing mapping...
}));

// Consensus round (after results are built, before cleanup)
let consensusReport: import('./consensus-types').ConsensusReport | undefined;
if (options?.consensus && this.llm && results.filter(r => r.status === 'completed').length >= 2) {
  try {
    const engine = new ConsensusEngine({ llm: this.llm, registryGet: this.registryGet });
    consensusReport = await engine.run(results);
    // Write performance signals
    if (consensusReport.signals.length > 0) {
      const perfWriter = new PerformanceWriter(this.projectRoot);
      perfWriter.appendSignals(consensusReport.signals);
    }
  } catch (err) {
    process.stderr.write(`[gossipcat] Consensus failed: ${(err as Error).message}\n`);
  }
}

// ... existing cleanup code (timed-out tasks, task deletion) ...

return { results, consensus: consensusReport };
```

**Important:** Every return path in `collect()` must return `CollectResult`. There are 3 return sites to update:
- Line 321 (orphan early return): `return orphanEntries;` → `return { results: orphanEntries };`
- Line 327 (empty targets early return): `return [];` → `return { results: [] };`
- Line 465+ (main return): `return results;` → `return { results, consensus: consensusReport };` (shown in code block above)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/orchestrator/dispatch-pipeline-consensus.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/types.ts packages/orchestrator/src/dispatch-pipeline.ts tests/orchestrator/dispatch-pipeline-consensus.test.ts
git commit -m "feat(consensus): wire ConsensusEngine into DispatchPipeline.collect()"
```

---

## Task 8: Fix existing tests for new collect() return type

**Files:**
- Modify: `tests/orchestrator/dispatch-pipeline.test.ts`
- Modify: `tests/orchestrator/dispatch-pipeline-gossip.test.ts`
- Modify: `tests/orchestrator/dispatch-pipeline-lens.test.ts`
- Modify: `packages/orchestrator/src/main-agent.ts`

The `collect()` return type changed from `TaskEntry[]` to `CollectResult`. All callers need updating.

- [ ] **Step 1: Update MainAgent pass-through**

In `packages/orchestrator/src/main-agent.ts` line 125, change:
```typescript
async collect(taskIds?: string[], timeoutMs?: number) { return this.pipeline.collect(taskIds, timeoutMs); }
```
to:
```typescript
async collect(taskIds?: string[], timeoutMs?: number, options?: { consensus?: boolean }) {
  return this.pipeline.collect(taskIds, timeoutMs, options);
}
```

- [ ] **Step 2: Update existing dispatch-pipeline tests**

In all existing tests that call `pipeline.collect()`, change from:
```typescript
const collected = await pipeline.collect(...);
// collected[0].status, collected.length, etc.
```
to:
```typescript
const { results: collected } = await pipeline.collect(...);
// collected[0].status, collected.length, etc.
```

Search for all uses: `const collected = await pipeline.collect` and `const result = await pipeline.collect` in:
- `tests/orchestrator/dispatch-pipeline.test.ts`
- `tests/orchestrator/dispatch-pipeline-gossip.test.ts`
- `tests/orchestrator/dispatch-pipeline-lens.test.ts`

Also update any `await pipeline.collect()` that doesn't assign to a variable (just awaiting for side effects).

- [ ] **Step 3: Run all dispatch-pipeline tests**

Run: `npx jest tests/orchestrator/dispatch-pipeline --no-coverage`
Expected: ALL PASS

- [ ] **Step 4: Run full test suite to catch any other breakage**

Run: `npx jest --no-coverage`
Expected: ALL PASS (or known-unrelated failures)

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/main-agent.ts tests/orchestrator/dispatch-pipeline.test.ts tests/orchestrator/dispatch-pipeline-gossip.test.ts tests/orchestrator/dispatch-pipeline-lens.test.ts
git commit -m "refactor: update collect() callers for CollectResult return type"
```

---

## Task 9: Inject consensus summary instruction into dispatch prompt

**Files:**
- Modify: `packages/orchestrator/src/prompt-assembler.ts`
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`
- Modify: `tests/orchestrator/prompt-assembler.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/orchestrator/prompt-assembler.test.ts`:

```typescript
it('includes consensus summary instruction when consensusSummary is true', () => {
  const result = assemblePrompt({ consensusSummary: true });
  expect(result).toContain('## Consensus Summary');
  expect(result).toContain('one line per finding');
});

it('does not include consensus instruction when consensusSummary is false', () => {
  const result = assemblePrompt({});
  expect(result).not.toContain('## Consensus Summary');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/prompt-assembler.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Add consensusSummary to assemblePrompt**

In `packages/orchestrator/src/prompt-assembler.ts`, add to the `parts` interface:
```typescript
consensusSummary?: boolean;
```

Add this block after the lens block (before skills):
```typescript
if (parts.consensusSummary) {
  blocks.push(`\n\n--- CONSENSUS OUTPUT FORMAT ---
End your response with a section titled "## Consensus Summary".
List one line per finding with file:line references where applicable.
Format: "- <finding description> (file:line)"
This section will be used for cross-review with peer agents.
--- END CONSENSUS OUTPUT FORMAT ---`);
}
```

- [ ] **Step 4: Wire consensus flag into dispatch()**

In `packages/orchestrator/src/dispatch-pipeline.ts`, in the `dispatch()` method around line 152, modify the `assemblePrompt` call:

```typescript
const promptContent = assemblePrompt({
  memory: memory || undefined,
  lens: options?.lens,
  skills,
  sessionContext: sessionContext || undefined,
  chainContext: chainContext || undefined,
  consensusSummary: options?.consensus,  // NEW
});
```

- [ ] **Step 5: Pass consensus flag through dispatchParallel**

In `packages/orchestrator/src/dispatch-pipeline.ts`, in the `dispatchParallel()` method, the consensus flag needs to propagate from the caller. Add `consensus` to the method signature:

```typescript
async dispatchParallel(
  taskDefs: Array<{ agentId: string; task: string; options?: DispatchOptions }>,
  options?: { consensus?: boolean },
): Promise<{ taskIds: string[]; errors: string[] }>
```

Then when dispatching each task (around line 584), merge the consensus flag:

```typescript
const { taskId, promise } = this.dispatch(def.agentId, def.task, {
  ...def.options,
  ...(lens ? { lens } : {}),
  ...(options?.consensus ? { consensus: true } : {}),
});
```

And update MainAgent's pass-through:
```typescript
async dispatchParallel(
  tasks: Array<{ agentId: string; task: string; options?: DispatchOptions }>,
  options?: { consensus?: boolean },
) {
  return this.pipeline.dispatchParallel(tasks, options);
}
```

- [ ] **Step 6: Run tests**

Run: `npx jest tests/orchestrator/prompt-assembler.test.ts tests/orchestrator/dispatch-pipeline --no-coverage`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/prompt-assembler.ts packages/orchestrator/src/dispatch-pipeline.ts packages/orchestrator/src/main-agent.ts tests/orchestrator/prompt-assembler.test.ts
git commit -m "feat(consensus): inject summary instruction into dispatch prompt when consensus enabled"
```

---

## Task 10: MCP tool integration

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

- [ ] **Step 1: Add `consensus` parameter to `gossip_collect` tool**

In `apps/cli/src/mcp-server-sdk.ts`, find the `gossip_collect` tool definition (line 484) and modify:

```typescript
server.tool(
  'gossip_collect',
  'Collect results from dispatched tasks. Waits for completion by default. Use consensus: true for cross-review round.',
  {
    task_ids: z.array(z.string()).optional().describe('Task IDs to collect. Omit for all.'),
    timeout_ms: z.number().optional().describe('Max wait time. Default 120000.'),
    consensus: z.boolean().optional().describe('Enable cross-review consensus. Agents review each others findings.'),
  },
  async ({ task_ids, timeout_ms, consensus }) => {
    let collected;
    try {
      collected = await mainAgent.collect(task_ids, timeout_ms, consensus ? { consensus: true } : undefined);
    } catch (err) {
      process.stderr.write(`[gossipcat] collect failed: ${(err as Error).message}\n`);
      return { content: [{ type: 'text' as const, text: `Collect error: ${(err as Error).message}` }] };
    }

    const { results, consensus: consensusReport } = collected;

    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: task_ids ? 'No matching tasks.' : 'No pending tasks.' }] };
    }

    const resultTexts = results.map((t: any) => {
      const dur = t.completedAt ? `${t.completedAt - t.startedAt}ms` : 'running';
      const modeTag = t.writeMode ? ` [${t.writeMode}${t.scope ? `:${t.scope}` : ''}]` : '';
      let text: string;
      if (t.status === 'completed') text = `[${t.id}] ${t.agentId}${modeTag} (${dur}):\n${t.result}`;
      else if (t.status === 'failed') text = `[${t.id}] ${t.agentId}${modeTag} (${dur}): ERROR: ${t.error}`;
      else text = `[${t.id}] ${t.agentId}${modeTag}: still running...`;

      if (t.worktreeInfo) {
        text += `\n📁 Worktree: ${t.worktreeInfo.path} (branch: ${t.worktreeInfo.branch})`;
      }
      if (t.skillWarnings?.length) {
        text += `\n\n⚠️ Skill coverage gaps:\n${t.skillWarnings.map((w: string) => `  - ${w}`).join('\n')}`;
      }
      return text;
    });

    let output = resultTexts.join('\n\n---\n\n');

    // Append consensus report if present
    if (consensusReport) {
      output += '\n\n' + consensusReport.summary;
    }

    return { content: [{ type: 'text' as const, text: output }] };
  }
);
```

- [ ] **Step 2: Add consensus flag to `gossip_dispatch_parallel`**

In the `gossip_dispatch_parallel` tool definition, add a `consensus` parameter:

```typescript
server.tool(
  'gossip_dispatch_parallel',
  'Fan out tasks to multiple agents simultaneously. Use consensus: true to enable cross-review when collecting.',
  {
    tasks: z.array(z.object({
      agent_id: z.string(),
      task: z.string(),
      write_mode: z.enum(['sequential', 'scoped', 'worktree']).optional(),
      scope: z.string().optional(),
    })).describe('Array of { agent_id, task, write_mode?, scope? }'),
    consensus: z.boolean().optional().describe('Enable consensus summary format in agent output. Pass consensus: true to gossip_collect later.'),
  },
  async ({ tasks: taskDefs, consensus }) => {
    await boot();
    await syncWorkersViaKeychain();

    for (const def of taskDefs) {
      if (!/^[a-zA-Z0-9_-]+$/.test(def.agent_id)) {
        return { content: [{ type: 'text' as const, text: `Invalid agent ID format: "${def.agent_id}"` }] };
      }
    }

    const { taskIds, errors } = await mainAgent.dispatchParallel(
      taskDefs.map((d: any) => ({
        agentId: d.agent_id,
        task: d.task,
        options: d.write_mode ? { writeMode: d.write_mode, scope: d.scope } : undefined,
      })),
      consensus ? { consensus: true } : undefined,
    );

    let msg = `Dispatched ${taskIds.length} tasks:\n${taskIds.map((tid: string) => {
      const t = mainAgent.getTask(tid);
      return `  ${tid} → ${t?.agentId || 'unknown'}`;
    }).join('\n')}`;
    if (consensus) msg += '\n\n📋 Consensus mode: agents will include structured summary for cross-review.';
    if (errors.length) msg += `\nErrors: ${errors.join(', ')}`;
    return { content: [{ type: 'text' as const, text: msg }] };
  }
);
```

- [ ] **Step 3: Verify MCP server compiles**

Run: `npx tsc --noEmit -p apps/cli/tsconfig.json` (or the relevant tsconfig)
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "feat(consensus): add consensus param to gossip_collect and gossip_dispatch_parallel MCP tools"
```

---

## Task 11: Final integration test and cleanup

**Files:**
- Modify: `packages/orchestrator/src/index.ts` (verify all exports)
- Run full test suite

- [ ] **Step 1: Verify all new modules are exported**

Check `packages/orchestrator/src/index.ts` has:
```typescript
export * from './consensus-types';
export { ConsensusEngine } from './consensus-engine';
export type { ConsensusEngineConfig } from './consensus-engine';
export { PerformanceWriter } from './performance-writer';
```

- [ ] **Step 2: Run full test suite**

Run: `npx jest --no-coverage`
Expected: ALL PASS

- [ ] **Step 3: Build to verify TypeScript compiles**

Run: `npm run build` (or `npx tsc -b`)
Expected: Clean build

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "feat(consensus): final cleanup and export verification"
```

---

## Known Limitations (MVP)

- **Finding matching is fuzzy** — `findMatchingFinding` uses exact match → substring → word overlap (>50%). LLMs rephrase freely, so some cross-review entries may fail to match their Phase 1 counterpart. Unmatched entries are silently dropped. This is acceptable for MVP — most findings will match on substring or word overlap. A future improvement would use embeddings or an LLM-based matching call.

## Deferred (v2)

These were explicitly scoped out of MVP during spec review:

- **Semantic finding matching** — replace string-based matching with embedding similarity or LLM-based matching
- **Agent filtering** — orchestrator decides which agents participate based on task similarity
- **Tiebreaker agents** — dispatch a third agent to resolve DISPUTED findings
- **Auto-consensus** — automatically enable consensus for ≥3 agents on high-stakes tasks
- **Full output mode** — option to send full Phase 1 output instead of summaries in cross-review
- **Agent() subagent support** — consensus for Claude Code Agent() dispatches (not relay-based)
- **Disagreement resolution** — automated resolution of DISPUTED findings (MVP: user decides)
