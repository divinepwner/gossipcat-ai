# ATI v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build competency profiles from consensus + implementation signals, use them for task-type-aware dispatch scoring and deterministic agent differentiation, with anti-gaming measures and token cost optimization.

**Architecture:** Extend the existing performance signal pipeline with new signal types (`ImplSignal`, `MetaSignal`), a `CompetencyProfiler` that computes in-memory profiles from the JSONL, a `CategoryExtractor` for finding categorization, and a `DispatchDifferentiator` for profile-based prompt differentiation. All profiles are in-memory only (no disk cache).

**Tech Stack:** TypeScript, Jest, existing gossipcat orchestrator + tools packages

**Spec:** `docs/superpowers/specs/2026-03-28-adaptive-team-intelligence-v3.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/orchestrator/src/category-extractor.ts` | Pure function: extract finding categories from text via regex patterns |
| `packages/orchestrator/src/competency-profiler.ts` | Compute `CompetencyProfile` per agent from signals with decay + anti-gaming |
| `packages/orchestrator/src/dispatch-differentiator.ts` | Generate per-agent focus prompts from profiles + overlap detection |
| `tests/orchestrator/category-extractor.test.ts` | Unit tests for category extraction |
| `tests/orchestrator/competency-profiler.test.ts` | Unit tests for profile computation |
| `tests/orchestrator/dispatch-differentiator.test.ts` | Unit tests for differentiation |
| `tests/orchestrator/impl-signals.test.ts` | Integration tests for impl signal emission |

### Modified Files

| File | Change |
|------|--------|
| `packages/orchestrator/src/consensus-types.ts` | Add `ImplSignal`, `MetaSignal`, `PerformanceSignal` union, `category_confirmed` signal |
| `packages/orchestrator/src/performance-writer.ts` | Accept `PerformanceSignal` instead of just `ConsensusSignal` |
| `packages/orchestrator/src/worker-agent.ts` | Emit `MetaSignal` on task completion |
| `packages/tools/src/tool-server.ts` | Accept `PerformanceWriter`, emit `ImplSignal` after verify_write |
| `packages/orchestrator/src/dispatch-pipeline.ts` | Post-consensus category extraction, profile-based differentiation, selective consensus |
| `packages/orchestrator/src/agent-registry.ts` | Task-type-aware scoring via `CompetencyProfiler` |

---

## Task 1: Signal Type Foundation

**Files:**
- Modify: `packages/orchestrator/src/consensus-types.ts`
- Modify: `packages/orchestrator/src/performance-writer.ts`
- Test: `tests/orchestrator/citation-verification.test.ts` (verify no regressions)

- [ ] **Step 1: Write failing test for new signal types**

Create `tests/orchestrator/signal-types.test.ts`:

```typescript
import { PerformanceWriter } from '@gossip/orchestrator';
import { readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PerformanceWriter — PerformanceSignal support', () => {
  const testDir = join(tmpdir(), 'gossip-signal-types-' + Date.now());
  const filePath = join(testDir, '.gossip', 'agent-performance.jsonl');
  let writer: PerformanceWriter;

  beforeAll(() => {
    mkdirSync(join(testDir, '.gossip'), { recursive: true });
    writer = new PerformanceWriter(testDir);
  });

  afterAll(() => rmSync(testDir, { recursive: true, force: true }));

  test('writes ImplSignal to JSONL', () => {
    writer.appendSignal({
      type: 'impl',
      signal: 'impl_test_pass',
      agentId: 'agent-a',
      taskId: 'task-1',
      timestamp: new Date().toISOString(),
    });
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.type).toBe('impl');
    expect(last.signal).toBe('impl_test_pass');
  });

  test('writes MetaSignal to JSONL', () => {
    writer.appendSignal({
      type: 'meta',
      signal: 'task_completed',
      agentId: 'agent-a',
      taskId: 'task-1',
      value: 5200,
      timestamp: new Date().toISOString(),
    });
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.type).toBe('meta');
    expect(last.value).toBe(5200);
  });

  test('appendSignals accepts mixed PerformanceSignal array', () => {
    writer.appendSignals([
      { type: 'consensus', taskId: 't1', signal: 'agreement', agentId: 'a', evidence: 'ok', timestamp: new Date().toISOString() },
      { type: 'impl', signal: 'impl_test_fail', agentId: 'b', taskId: 't2', timestamp: new Date().toISOString() },
    ]);
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/signal-types.test.ts --no-coverage`
Expected: FAIL — `ImplSignal` type doesn't exist yet

- [ ] **Step 3: Add new types to consensus-types.ts**

Add after the existing `ConsensusSignal` interface in `packages/orchestrator/src/consensus-types.ts`:

```typescript
/** Implementation quality signal from verify_write */
export interface ImplSignal {
  type: 'impl';
  signal: 'impl_test_pass' | 'impl_test_fail' | 'impl_peer_approved' | 'impl_peer_rejected';
  agentId: string;
  taskId: string;
  evidence?: string;
  timestamp: string;
}

/** Meta signal from worker-agent telemetry */
export interface MetaSignal {
  type: 'meta';
  signal: 'task_completed' | 'task_tool_turns';
  agentId: string;
  taskId: string;
  value?: number;
  timestamp: string;
}

/** Union of all performance signal types */
export type PerformanceSignal = ConsensusSignal | ImplSignal | MetaSignal;
```

Also add `'category_confirmed'` to the `ConsensusSignal.signal` union:

```typescript
signal: 'agreement' | 'disagreement' | 'unique_confirmed' | 'unique_unconfirmed' | 'new_finding' | 'hallucination_caught' | 'category_confirmed';
```

And add a `category` field to `ConsensusSignal`:

```typescript
category?: string;
```

- [ ] **Step 4: Update PerformanceWriter to accept PerformanceSignal**

In `packages/orchestrator/src/performance-writer.ts`, change the import and method signatures:

```typescript
import { PerformanceSignal } from './consensus-types';

export class PerformanceWriter {
  private readonly filePath: string;

  constructor(projectRoot: string) {
    const dir = join(projectRoot, '.gossip');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'agent-performance.jsonl');
  }

  appendSignal(signal: PerformanceSignal): void {
    appendFileSync(this.filePath, JSON.stringify(signal) + '\n');
  }

  appendSignals(signals: PerformanceSignal[]): void {
    if (signals.length === 0) return;
    const data = signals.map(s => JSON.stringify(s)).join('\n') + '\n';
    appendFileSync(this.filePath, data);
  }
}
```

- [ ] **Step 5: Update exports in index.ts**

Add to `packages/orchestrator/src/index.ts`:

```typescript
export type { ImplSignal, MetaSignal, PerformanceSignal } from './consensus-types';
```

- [ ] **Step 6: Run tests and verify pass**

Run: `npx jest tests/orchestrator/signal-types.test.ts tests/orchestrator/consensus-engine.test.ts tests/orchestrator/citation-verification.test.ts --no-coverage`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/consensus-types.ts packages/orchestrator/src/performance-writer.ts packages/orchestrator/src/index.ts tests/orchestrator/signal-types.test.ts
git commit -m "feat(ati): add ImplSignal, MetaSignal types and PerformanceSignal union"
```

---

## Task 2: Category Extractor

**Files:**
- Create: `packages/orchestrator/src/category-extractor.ts`
- Test: `tests/orchestrator/category-extractor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/orchestrator/category-extractor.test.ts`:

```typescript
import { extractCategories } from '@gossip/orchestrator';

describe('extractCategories', () => {
  test('extracts injection_vectors from injection-related finding', () => {
    expect(extractCategories('Prompt injection via unsanitized input')).toContain('injection_vectors');
  });

  test('extracts concurrency from race condition finding', () => {
    expect(extractCategories('Race condition in scope validation')).toContain('concurrency');
  });

  test('extracts multiple categories from compound finding', () => {
    const cats = extractCategories('Missing type guard on LLM response allows injection');
    expect(cats).toContain('type_safety');
    expect(cats).toContain('injection_vectors');
  });

  test('returns empty array for unrecognized finding', () => {
    expect(extractCategories('The button color is wrong')).toEqual([]);
  });

  test('is case insensitive', () => {
    expect(extractCategories('DOS attack via unbounded allocation')).toContain('resource_exhaustion');
    expect(extractCategories('dos attack via unbounded allocation')).toContain('resource_exhaustion');
  });

  test('extracts trust_boundaries from auth finding', () => {
    expect(extractCategories('No authentication on relay connection')).toContain('trust_boundaries');
  });

  test('extracts error_handling from exception finding', () => {
    expect(extractCategories('Unhandled exception in fallback path')).toContain('error_handling');
  });

  test('extracts data_integrity from corruption finding', () => {
    expect(extractCategories('Data corruption from non-atomic write')).toContain('data_integrity');
  });

  test('returns deduplicated categories', () => {
    const cats = extractCategories('SQL injection with unsanitized input injection');
    const unique = new Set(cats);
    expect(cats.length).toBe(unique.size);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/category-extractor.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement category-extractor.ts**

Create `packages/orchestrator/src/category-extractor.ts`:

```typescript
/**
 * CategoryExtractor — extracts finding categories from confirmed finding text.
 * Pure function, no side effects. Categories are predefined via regex patterns.
 */

const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  trust_boundaries: [/trust.?boundar/i, /authenticat/i, /authoriz/i, /impersonat/i, /identity/i, /credential/i],
  injection_vectors: [/inject/i, /sanitiz/i, /escape/i, /\bxss\b/i, /sql.?inject/i, /prompt.?inject/i],
  input_validation: [/validat/i, /input.?check/i, /type.?guard/i, /\bschema\b/i, /malform/i],
  concurrency: [/race.?condition/i, /deadlock/i, /\batomic\b/i, /concurrent/i, /\bmutex\b/i, /\btoctou\b/i],
  resource_exhaustion: [/\bdos\b/i, /unbounded/i, /memory.?leak/i, /exhaust/i, /\btimeout\b/i, /infinite.?loop/i],
  type_safety: [/type.?safe/i, /typescript/i, /type.?narrow/i, /\bany\[?\]?\b/i, /type.?assert/i],
  error_handling: [/error.?handl/i, /\bexception\b/i, /\bfallback\b/i, /try.?catch/i, /unhandled/i],
  data_integrity: [/data.?corrupt/i, /\bintegrity\b/i, /\bconsistency\b/i, /idempoten/i, /non.?atomic/i],
};

export function extractCategories(findingText: string): string[] {
  const matched = new Set<string>();
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(findingText)) {
        matched.add(category);
        break; // one match per category is enough
      }
    }
  }
  return Array.from(matched);
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/orchestrator/src/index.ts`:

```typescript
export { extractCategories } from './category-extractor';
```

- [ ] **Step 5: Run tests and verify pass**

Run: `npx jest tests/orchestrator/category-extractor.test.ts --no-coverage`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/category-extractor.ts packages/orchestrator/src/index.ts tests/orchestrator/category-extractor.test.ts
git commit -m "feat(ati): category extractor for finding classification"
```

---

## Task 3: Competency Profiler

**Files:**
- Create: `packages/orchestrator/src/competency-profiler.ts`
- Test: `tests/orchestrator/competency-profiler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/orchestrator/competency-profiler.test.ts`:

```typescript
import { CompetencyProfiler } from '@gossip/orchestrator';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function writeSignals(dir: string, signals: object[]): void {
  const data = signals.map(s => JSON.stringify(s)).join('\n') + '\n';
  writeFileSync(join(dir, '.gossip', 'agent-performance.jsonl'), data);
}

describe('CompetencyProfiler', () => {
  const testDir = join(tmpdir(), 'gossip-profiler-' + Date.now());
  let profiler: CompetencyProfiler;

  beforeAll(() => {
    mkdirSync(join(testDir, '.gossip'), { recursive: true });
  });

  afterAll(() => rmSync(testDir, { recursive: true, force: true }));

  beforeEach(() => {
    profiler = new CompetencyProfiler(testDir);
  });

  test('returns neutral profile for agent with < 10 tasks', () => {
    writeSignals(testDir, [
      { type: 'meta', signal: 'task_completed', agentId: 'agent-a', taskId: 't1', value: 5000, timestamp: '2026-01-01T00:00:00Z' },
    ]);
    const profile = profiler.getProfile('agent-a');
    expect(profile).not.toBeNull();
    expect(profile!.totalTasks).toBe(1);
    expect(profile!.reviewReliability).toBe(0.5); // neutral
    expect(profile!.implReliability).toBe(0.5);
  });

  test('computes reviewStrengths from category_confirmed signals', () => {
    const signals = [];
    // 12 task_completed signals to pass threshold
    for (let i = 0; i < 12; i++) {
      signals.push({ type: 'meta', signal: 'task_completed', agentId: 'agent-a', taskId: `t${i}`, value: 3000, timestamp: '2026-01-01T00:00:00Z' });
    }
    // category confirmations
    for (let i = 0; i < 5; i++) {
      signals.push({ type: 'consensus', signal: 'category_confirmed', agentId: 'agent-a', category: 'injection_vectors', evidence: '', timestamp: '2026-01-01T00:00:00Z', taskId: `t${i}` });
    }
    writeSignals(testDir, signals);
    const profile = profiler.getProfile('agent-a');
    expect(profile!.reviewStrengths['injection_vectors']).toBeGreaterThan(0.5);
  });

  test('computes implPassRate from impl signals', () => {
    const signals = [];
    for (let i = 0; i < 12; i++) {
      signals.push({ type: 'meta', signal: 'task_completed', agentId: 'agent-a', taskId: `t${i}`, value: 3000, timestamp: '2026-01-01T00:00:00Z' });
    }
    // 5 pass, 2 fail
    for (let i = 0; i < 5; i++) {
      signals.push({ type: 'impl', signal: 'impl_test_pass', agentId: 'agent-a', taskId: `t${i}`, timestamp: '2026-01-01T00:00:00Z' });
    }
    for (let i = 0; i < 2; i++) {
      signals.push({ type: 'impl', signal: 'impl_test_fail', agentId: 'agent-a', taskId: `f${i}`, timestamp: '2026-01-01T00:00:00Z' });
    }
    writeSignals(testDir, signals);
    const profile = profiler.getProfile('agent-a');
    expect(profile!.implPassRate).toBeCloseTo(5 / 7, 1);
  });

  test('applies score decay — older signals weight less', () => {
    const signals = [];
    for (let i = 0; i < 60; i++) {
      signals.push({ type: 'meta', signal: 'task_completed', agentId: 'agent-a', taskId: `t${i}`, value: 3000, timestamp: '2026-01-01T00:00:00Z' });
    }
    // Old category signal (task index 0, 59 tasks ago)
    signals.push({ type: 'consensus', signal: 'category_confirmed', agentId: 'agent-a', category: 'concurrency', evidence: '', timestamp: '2026-01-01T00:00:00Z', taskId: 't0' });
    // Recent category signal (task index 59, 0 tasks ago)
    signals.push({ type: 'consensus', signal: 'category_confirmed', agentId: 'agent-a', category: 'injection_vectors', evidence: '', timestamp: '2026-01-01T00:00:00Z', taskId: 't59' });
    writeSignals(testDir, signals);
    const profile = profiler.getProfile('agent-a');
    // Recent signal should have more impact than old one
    expect(profile!.reviewStrengths['injection_vectors']).toBeGreaterThan(profile!.reviewStrengths['concurrency'] || 0);
  });

  test('caps score change per round at ±0.3', () => {
    const signals = [];
    for (let i = 0; i < 12; i++) {
      signals.push({ type: 'meta', signal: 'task_completed', agentId: 'agent-a', taskId: `t${i}`, value: 3000, timestamp: '2026-01-01T00:00:00Z' });
    }
    // 50 agreements in one task (same taskId = same round)
    for (let i = 0; i < 50; i++) {
      signals.push({ type: 'consensus', signal: 'agreement', agentId: 'agent-a', counterpartId: 'agent-b', evidence: 'ok', timestamp: '2026-01-01T00:00:00Z', taskId: 't0' });
    }
    writeSignals(testDir, signals);
    const profile = profiler.getProfile('agent-a');
    // accuracy starts at 0.5, max change ±0.3 per round = max 0.8
    expect(profile!.reviewReliability).toBeLessThanOrEqual(0.8 * 0.7 + 0.5 * 0.3 + 0.01); // with float tolerance
  });

  test('returns null for unknown agent', () => {
    writeSignals(testDir, []);
    expect(profiler.getProfile('nonexistent')).toBeNull();
  });

  test('handles zero impl signals — implPassRate defaults to 0.5', () => {
    const signals = [];
    for (let i = 0; i < 12; i++) {
      signals.push({ type: 'meta', signal: 'task_completed', agentId: 'agent-a', taskId: `t${i}`, value: 3000, timestamp: '2026-01-01T00:00:00Z' });
    }
    writeSignals(testDir, signals);
    const profile = profiler.getProfile('agent-a');
    expect(profile!.implPassRate).toBe(0.5);
  });

  test('skips malformed JSONL lines without crashing', () => {
    const data = '{"type":"meta","signal":"task_completed","agentId":"a","taskId":"t1","value":100,"timestamp":"2026-01-01T00:00:00Z"}\nnot valid json\n{"type":"meta","signal":"task_completed","agentId":"a","taskId":"t2","value":200,"timestamp":"2026-01-01T00:00:00Z"}\n';
    writeFileSync(join(testDir, '.gossip', 'agent-performance.jsonl'), data);
    const profile = profiler.getProfile('a');
    expect(profile).not.toBeNull();
    expect(profile!.totalTasks).toBe(2);
  });

  test('applies agreement diversity discount', () => {
    const signals = [];
    for (let i = 0; i < 12; i++) {
      signals.push({ type: 'meta', signal: 'task_completed', agentId: 'agent-a', taskId: `t${i}`, value: 3000, timestamp: '2026-01-01T00:00:00Z' });
    }
    // 10 agreements, all with same peer (low diversity)
    for (let i = 0; i < 10; i++) {
      signals.push({ type: 'consensus', signal: 'agreement', agentId: 'agent-a', counterpartId: 'agent-b', evidence: 'ok', timestamp: '2026-01-01T00:00:00Z', taskId: `t${i}` });
    }
    writeSignals(testDir, signals);
    const lowDiversity = profiler.getProfile('agent-a');

    // Same but diverse peers
    const signals2 = [...signals.slice(0, 12)];
    const peers = ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
    for (let i = 0; i < 10; i++) {
      signals2.push({ type: 'consensus', signal: 'agreement', agentId: 'agent-a', counterpartId: `agent-${peers[i]}`, evidence: 'ok', timestamp: '2026-01-01T00:00:00Z', taskId: `t${i}` });
    }
    writeSignals(testDir, signals2);
    profiler = new CompetencyProfiler(testDir); // fresh cache
    const highDiversity = profiler.getProfile('agent-a');

    expect(highDiversity!.reviewReliability).toBeGreaterThan(lowDiversity!.reviewReliability);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/competency-profiler.test.ts --no-coverage`
Expected: FAIL — `CompetencyProfiler` not found

- [ ] **Step 3: Implement competency-profiler.ts**

Create `packages/orchestrator/src/competency-profiler.ts`:

```typescript
/**
 * CompetencyProfiler — computes per-agent CompetencyProfile from
 * agent-performance.jsonl with score decay and anti-gaming measures.
 *
 * In-memory only — no disk cache. Uses mtime-based invalidation.
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { ConsensusSignal, ImplSignal, MetaSignal, PerformanceSignal } from './consensus-types';

export interface CompetencyProfile {
  agentId: string;
  reviewStrengths: Record<string, number>;
  implPassRate: number;
  implIterations: number;
  implPeerApproval: number;
  speed: number;
  hallucinationRate: number;
  avgTokenCost: number;
  totalTasks: number;
  reviewReliability: number;
  implReliability: number;
}

const DECAY_HALF_LIFE = 50;
const MIN_TASKS_THRESHOLD = 10;
const MAX_ACCURACY_CHANGE_PER_ROUND = 0.3;
const AGREEMENT_WEIGHT = 0.1;
const DISAGREEMENT_WEIGHT = -0.15;
const HALLUCINATION_WEIGHT = -0.3;

export class CompetencyProfiler {
  private readonly filePath: string;
  private cachedProfiles: Map<string, CompetencyProfile> | null = null;
  private cachedMtimeMs = 0;

  constructor(private projectRoot: string) {
    this.filePath = join(projectRoot, '.gossip', 'agent-performance.jsonl');
  }

  getProfile(agentId: string): CompetencyProfile | null {
    const profiles = this.getProfiles();
    return profiles.get(agentId) ?? null;
  }

  getProfiles(): Map<string, CompetencyProfile> {
    let mtimeMs = 0;
    try { mtimeMs = statSync(this.filePath).mtimeMs; } catch { /* file doesn't exist */ }
    if (this.cachedProfiles && mtimeMs === this.cachedMtimeMs) {
      return this.cachedProfiles;
    }
    this.cachedProfiles = this.computeProfiles();
    this.cachedMtimeMs = mtimeMs;
    return this.cachedProfiles;
  }

  /** Get profileMultiplier for dispatch (clamped 0.5–1.5, neutral if < threshold) */
  getProfileMultiplier(agentId: string, taskType: 'review' | 'impl'): number {
    const profile = this.getProfile(agentId);
    if (!profile || profile.totalTasks < MIN_TASKS_THRESHOLD) return 1.0;
    if (taskType === 'review') {
      const raw = profile.reviewReliability * (1 - profile.hallucinationRate);
      return clamp(raw * 2, 0.5, 1.5); // scale 0-1 range to 0.5-1.5
    }
    const raw = profile.implReliability * profile.implPassRate;
    return clamp(raw * 2, 0.5, 1.5);
  }

  private computeProfiles(): Map<string, CompetencyProfile> {
    const signals = this.readSignals();
    const profiles = new Map<string, CompetencyProfile>();

    // Count tasks per agent (for decay ordering and threshold)
    const tasksByAgent = new Map<string, string[]>();
    for (const s of signals) {
      if (s.type === 'meta' && s.signal === 'task_completed') {
        const tasks = tasksByAgent.get(s.agentId) || [];
        tasks.push(s.taskId);
        tasksByAgent.set(s.agentId, tasks);
      }
    }

    const ensure = (id: string): CompetencyProfile => {
      if (!profiles.has(id)) {
        profiles.set(id, {
          agentId: id,
          reviewStrengths: {},
          implPassRate: 0.5,
          implIterations: 0,
          implPeerApproval: 0.5,
          speed: 0,
          hallucinationRate: 0,
          avgTokenCost: 0,
          totalTasks: 0,
          reviewReliability: 0.5,
          implReliability: 0.5,
        });
      }
      return profiles.get(id)!;
    };

    // Pass 1: count tasks and compute meta stats
    for (const s of signals) {
      if (s.type === 'meta') {
        const p = ensure(s.agentId);
        if (s.signal === 'task_completed') {
          p.totalTasks++;
          if (s.value) {
            p.speed = p.speed === 0 ? s.value : (p.speed * (p.totalTasks - 1) + s.value) / p.totalTasks;
          }
        }
        if (s.signal === 'task_tool_turns' && s.value) {
          p.implIterations = p.implIterations === 0 ? s.value : (p.implIterations + s.value) / 2;
        }
      }
    }

    // Pass 2: compute review scores with decay + anti-gaming
    const peerDiversity = this.computePeerDiversity(signals);
    const roundChanges = new Map<string, Map<string, number>>(); // agentId → taskId → accumulated change

    let accuracy = new Map<string, number>();
    let uniqueness = new Map<string, number>();
    let hallucinations = new Map<string, { caught: number; total: number }>();

    for (const s of signals) {
      if (s.type !== 'consensus') continue;
      const cs = s as ConsensusSignal;
      const p = ensure(cs.agentId);
      const totalTasks = tasksByAgent.get(cs.agentId)?.length ?? 0;
      const taskIndex = tasksByAgent.get(cs.agentId)?.indexOf(cs.taskId) ?? -1;
      const tasksSince = taskIndex >= 0 ? totalTasks - taskIndex - 1 : 0;
      const decay = Math.pow(0.5, tasksSince / DECAY_HALF_LIFE);

      // Track per-round changes for ceiling
      if (!roundChanges.has(cs.agentId)) roundChanges.set(cs.agentId, new Map());
      const agentRounds = roundChanges.get(cs.agentId)!;
      const currentRoundChange = agentRounds.get(cs.taskId) ?? 0;

      if (cs.signal === 'agreement') {
        const diversity = peerDiversity.get(cs.agentId) ?? 1;
        const change = AGREEMENT_WEIGHT * decay * diversity;
        if (Math.abs(currentRoundChange + change) <= MAX_ACCURACY_CHANGE_PER_ROUND) {
          const acc = accuracy.get(cs.agentId) ?? 0.5;
          accuracy.set(cs.agentId, clamp(acc + change, 0, 1));
          agentRounds.set(cs.taskId, currentRoundChange + change);
        }
      }

      if (cs.signal === 'disagreement') {
        const change = DISAGREEMENT_WEIGHT * decay;
        if (Math.abs(currentRoundChange + change) <= MAX_ACCURACY_CHANGE_PER_ROUND) {
          const acc = accuracy.get(cs.agentId) ?? 0.5;
          accuracy.set(cs.agentId, clamp(acc + change, 0, 1));
          agentRounds.set(cs.taskId, currentRoundChange + change);
        }
      }

      if (cs.signal === 'unique_confirmed' || cs.signal === 'new_finding') {
        const boost = cs.signal === 'unique_confirmed' ? 0.2 : 0.15;
        const u = uniqueness.get(cs.agentId) ?? 0.5;
        uniqueness.set(cs.agentId, clamp(u + boost * decay, 0, 1));
      }

      if (cs.signal === 'unique_unconfirmed') {
        const u = uniqueness.get(cs.agentId) ?? 0.5;
        uniqueness.set(cs.agentId, clamp(u + 0.05 * decay, 0, 1));
      }

      if (cs.signal === 'hallucination_caught') {
        const h = hallucinations.get(cs.agentId) ?? { caught: 0, total: 0 };
        h.caught++;
        hallucinations.set(cs.agentId, h);
      }

      if (cs.signal === 'category_confirmed' && cs.category) {
        const strength = p.reviewStrengths[cs.category] ?? 0.5;
        p.reviewStrengths[cs.category] = clamp(strength + 0.15 * decay, 0, 1);
      }
    }

    // Pass 3: impl signals
    const implStats = new Map<string, { pass: number; fail: number; approved: number; rejected: number }>();
    for (const s of signals) {
      if (s.type !== 'impl') continue;
      const is = s as ImplSignal;
      const stats = implStats.get(is.agentId) ?? { pass: 0, fail: 0, approved: 0, rejected: 0 };
      if (is.signal === 'impl_test_pass') stats.pass++;
      if (is.signal === 'impl_test_fail') stats.fail++;
      if (is.signal === 'impl_peer_approved') stats.approved++;
      if (is.signal === 'impl_peer_rejected') stats.rejected++;
      implStats.set(is.agentId, stats);
    }

    // Finalize profiles
    for (const [id, p] of profiles) {
      const acc = accuracy.get(id) ?? 0.5;
      const uniq = uniqueness.get(id) ?? 0.5;
      p.reviewReliability = clamp(acc * 0.7 + uniq * 0.3, 0, 1);

      const h = hallucinations.get(id);
      if (h && h.caught > 0) {
        const totalDisputes = signals.filter(s => s.type === 'consensus' && (s as ConsensusSignal).signal === 'disagreement' && s.agentId === id).length;
        p.hallucinationRate = totalDisputes > 0 ? h.caught / totalDisputes : 0;
      }

      const impl = implStats.get(id);
      if (impl) {
        const implTotal = impl.pass + impl.fail;
        p.implPassRate = implTotal > 0 ? impl.pass / implTotal : 0.5;
        const peerTotal = impl.approved + impl.rejected;
        p.implPeerApproval = peerTotal > 0 ? impl.approved / peerTotal : 0.5;
        p.implReliability = clamp(p.implPassRate * 0.6 + p.implPeerApproval * 0.4, 0, 1);
      }
    }

    return profiles;
  }

  private computePeerDiversity(signals: PerformanceSignal[]): Map<string, number> {
    const peerSets = new Map<string, Set<string>>();
    const allAgents = new Set<string>();
    for (const s of signals) {
      allAgents.add(s.agentId);
      if (s.type === 'consensus' && (s as ConsensusSignal).signal === 'agreement' && (s as ConsensusSignal).counterpartId) {
        const peers = peerSets.get(s.agentId) || new Set();
        peers.add((s as ConsensusSignal).counterpartId!);
        peerSets.set(s.agentId, peers);
      }
    }
    const result = new Map<string, number>();
    for (const [agentId, peers] of peerSets) {
      const teamSize = Math.max(allAgents.size - 1, 1); // exclude self
      result.set(agentId, Math.max(0.3, peers.size / teamSize));
    }
    return result;
  }

  private readSignals(): PerformanceSignal[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return readFileSync(this.filePath, 'utf-8').trim().split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line) as PerformanceSignal; }
        catch { return null; }
      }).filter((s): s is PerformanceSignal => s !== null && typeof s.agentId === 'string' && s.agentId.length > 0);
    } catch { return []; }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/orchestrator/src/index.ts`:

```typescript
export { CompetencyProfiler } from './competency-profiler';
export type { CompetencyProfile } from './competency-profiler';
```

- [ ] **Step 5: Run tests and verify pass**

Run: `npx jest tests/orchestrator/competency-profiler.test.ts --no-coverage`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/competency-profiler.ts packages/orchestrator/src/index.ts tests/orchestrator/competency-profiler.test.ts
git commit -m "feat(ati): competency profiler with decay, anti-gaming, impl scoring"
```

---

## Task 4: Meta Signal Emission (worker-agent)

**Files:**
- Modify: `packages/orchestrator/src/worker-agent.ts`
- Test: existing worker tests for regression

- [ ] **Step 1: Write failing test**

Create `tests/orchestrator/meta-signals.test.ts`:

```typescript
import { PerformanceWriter } from '@gossip/orchestrator';
import { MetaSignal } from '@gossip/orchestrator';

describe('MetaSignal emission contract', () => {
  test('MetaSignal has required fields', () => {
    const signal: MetaSignal = {
      type: 'meta',
      signal: 'task_completed',
      agentId: 'test-agent',
      taskId: 'task-123',
      value: 5000,
      timestamp: new Date().toISOString(),
    };
    expect(signal.type).toBe('meta');
    expect(signal.signal).toBe('task_completed');
    expect(signal.value).toBe(5000);
  });

  test('task_tool_turns MetaSignal has value field', () => {
    const signal: MetaSignal = {
      type: 'meta',
      signal: 'task_tool_turns',
      agentId: 'test-agent',
      taskId: 'task-123',
      value: 8,
      timestamp: new Date().toISOString(),
    };
    expect(signal.value).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (type contract only)

Run: `npx jest tests/orchestrator/meta-signals.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Add onTaskComplete callback to WorkerAgent**

In `packages/orchestrator/src/worker-agent.ts`, add a callback type and wire it into the constructor:

After line 20 (`const MAX_TOOL_TURNS = 15;`), the `WorkerAgent` needs to accept an optional `onTaskComplete` callback. Find the constructor and add:

```typescript
private onTaskComplete?: (signal: { agentId: string; taskId: string; toolCalls: number; durationMs: number }) => void;
```

In the `executeTask` method, after the final return statements (the three places where it returns `TaskExecutionResult`), emit the callback:

```typescript
// At the end of successful completion (after "no tool calls" return):
this.onTaskComplete?.({
  agentId: this.agentId,
  taskId: taskId || randomUUID(),
  toolCalls: toolCallCount,
  durationMs: Date.now() - startTime,
});
```

Add `const startTime = Date.now();` at the top of `executeTask`.

- [ ] **Step 4: Run existing tests**

Run: `npx jest tests/ --no-coverage --testPathIgnorePatterns='e2e|full-stack' 2>&1 | tail -5`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/worker-agent.ts tests/orchestrator/meta-signals.test.ts
git commit -m "feat(ati): meta signal callback in worker-agent for task telemetry"
```

---

## Task 5: Impl Signal Emission (tool-server)

**Files:**
- Modify: `packages/tools/src/tool-server.ts`
- Test: `tests/orchestrator/impl-signals.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/orchestrator/impl-signals.test.ts`:

```typescript
import { ImplSignal } from '@gossip/orchestrator';

describe('ImplSignal — verify_write signal emission', () => {
  test('impl_test_pass signal is well-formed', () => {
    const signal: ImplSignal = {
      type: 'impl',
      signal: 'impl_test_pass',
      agentId: 'agent-a',
      taskId: 'task-1',
      timestamp: new Date().toISOString(),
    };
    expect(signal.type).toBe('impl');
    expect(signal.signal).toBe('impl_test_pass');
  });

  test('impl_test_fail signal is well-formed', () => {
    const signal: ImplSignal = {
      type: 'impl',
      signal: 'impl_test_fail',
      agentId: 'agent-a',
      taskId: 'task-1',
      evidence: 'Tests failed: 3 failures',
      timestamp: new Date().toISOString(),
    };
    expect(signal.evidence).toBe('Tests failed: 3 failures');
  });

  test('impl_peer_approved signal is well-formed', () => {
    const signal: ImplSignal = {
      type: 'impl',
      signal: 'impl_peer_approved',
      agentId: 'agent-a',
      taskId: 'task-1',
      timestamp: new Date().toISOString(),
    };
    expect(signal.signal).toBe('impl_peer_approved');
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (type contract)

Run: `npx jest tests/orchestrator/impl-signals.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Add PerformanceWriter to ToolServerConfig**

In `packages/tools/src/tool-server.ts`, add optional `perfWriter` to the config interface and constructor:

```typescript
// In ToolServerConfig interface:
perfWriter?: { appendSignal(signal: unknown): void };
```

Store it in the class:

```typescript
private perfWriter?: { appendSignal(signal: unknown): void };

// In constructor:
this.perfWriter = config.perfWriter;
```

- [ ] **Step 4: Emit impl signals in handleVerifyWrite**

In `handleVerifyWrite`, after line 322 (`const testStatus = ...`), add signal emission:

```typescript
// Emit impl signal based on test result
if (this.perfWriter) {
  const now = new Date().toISOString();
  this.perfWriter.appendSignal({
    type: 'impl',
    signal: testStatus === 'PASS' ? 'impl_test_pass' : 'impl_test_fail',
    agentId: callerId,
    taskId: callerId, // use callerId as task proxy (worker maps to one task)
    evidence: testStatus === 'FAIL' ? testResult.slice(-500) : undefined,
    timestamp: now,
  });

  // Emit peer review signal if review was received
  if (reviewResult && !reviewResult.includes('unavailable')) {
    const approved = !reviewResult.toLowerCase().includes('reject') && !reviewResult.toLowerCase().includes('fail');
    this.perfWriter.appendSignal({
      type: 'impl',
      signal: approved ? 'impl_peer_approved' : 'impl_peer_rejected',
      agentId: callerId,
      taskId: callerId,
      evidence: reviewResult.slice(0, 500),
      timestamp: now,
    });
  }
}
```

- [ ] **Step 5: Run existing tool tests**

Run: `npx jest tests/tools/ --no-coverage`
Expected: All PASS (perfWriter is optional, no existing tests break)

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/tool-server.ts tests/orchestrator/impl-signals.test.ts
git commit -m "feat(ati): emit impl signals from tool-server verify_write"
```

---

## Task 6: Post-Consensus Category Extraction Hook

**Files:**
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/orchestrator/category-extractor.test.ts`:

```typescript
import { extractCategories } from '@gossip/orchestrator';
import { PerformanceWriter } from '@gossip/orchestrator';
import { mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Post-consensus category extraction integration', () => {
  const testDir = join(tmpdir(), 'gossip-cat-hook-' + Date.now());

  beforeAll(() => mkdirSync(join(testDir, '.gossip'), { recursive: true }));
  afterAll(() => rmSync(testDir, { recursive: true, force: true }));

  test('extractCategories + PerformanceWriter produces category_confirmed signals', () => {
    const writer = new PerformanceWriter(testDir);
    const confirmedFindings = [
      { originalAgentId: 'agent-a', finding: 'Prompt injection via unsanitized input' },
      { originalAgentId: 'agent-b', finding: 'Race condition in scope validation' },
    ];

    for (const f of confirmedFindings) {
      const categories = extractCategories(f.finding);
      for (const category of categories) {
        writer.appendSignal({
          type: 'consensus',
          signal: 'category_confirmed',
          agentId: f.originalAgentId,
          taskId: 'test-task',
          category,
          evidence: f.finding,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const lines = readFileSync(join(testDir, '.gossip', 'agent-performance.jsonl'), 'utf-8').trim().split('\n');
    const signals = lines.map(l => JSON.parse(l));
    const catSignals = signals.filter((s: any) => s.signal === 'category_confirmed');
    expect(catSignals.length).toBeGreaterThanOrEqual(2);
    expect(catSignals.some((s: any) => s.category === 'injection_vectors')).toBe(true);
    expect(catSignals.some((s: any) => s.category === 'concurrency')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx jest tests/orchestrator/category-extractor.test.ts --no-coverage`
Expected: PASS (this tests the contract, not the pipeline wiring)

- [ ] **Step 3: Wire category extraction into dispatch-pipeline collect()**

In `packages/orchestrator/src/dispatch-pipeline.ts`, add import at the top:

```typescript
import { extractCategories } from './category-extractor';
```

After line 610 (`perfWriter.appendSignals(consensusReport.signals);`), add:

```typescript
// Post-consensus: extract categories from confirmed findings
const now = new Date().toISOString();
for (const finding of consensusReport.confirmed) {
  const categories = extractCategories(finding.finding);
  for (const category of categories) {
    perfWriter.appendSignal({
      type: 'consensus',
      signal: 'category_confirmed' as any,
      agentId: finding.originalAgentId,
      taskId: finding.id || '',
      category,
      evidence: finding.finding,
      timestamp: now,
    });
  }
}
```

- [ ] **Step 4: Run full test suite**

Run: `npx jest tests/orchestrator/ --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/dispatch-pipeline.ts tests/orchestrator/category-extractor.test.ts
git commit -m "feat(ati): post-consensus category extraction hook in collect pipeline"
```

---

## Task 7: Dispatch Differentiator

**Files:**
- Create: `packages/orchestrator/src/dispatch-differentiator.ts`
- Test: `tests/orchestrator/dispatch-differentiator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/orchestrator/dispatch-differentiator.test.ts`:

```typescript
import { DispatchDifferentiator } from '@gossip/orchestrator';
import { CompetencyProfile } from '@gossip/orchestrator';

function makeProfile(id: string, strengths: Record<string, number>): CompetencyProfile {
  return {
    agentId: id,
    reviewStrengths: strengths,
    implPassRate: 0.5, implIterations: 5, implPeerApproval: 0.5,
    speed: 3000, hallucinationRate: 0, avgTokenCost: 0,
    totalTasks: 20, reviewReliability: 0.7, implReliability: 0.5,
  };
}

describe('DispatchDifferentiator', () => {
  const differ = new DispatchDifferentiator();

  test('generates complementary focus for two agents with different strengths', () => {
    const profiles = [
      makeProfile('agent-a', { trust_boundaries: 0.9, injection_vectors: 0.8 }),
      makeProfile('agent-b', { input_validation: 0.85, type_safety: 0.7 }),
    ];
    const result = differ.differentiate(profiles, 'security review');
    expect(result.size).toBe(2);
    expect(result.get('agent-a')).toContain('trust');
    expect(result.get('agent-b')).toContain('validation');
  });

  test('returns empty map for single agent', () => {
    const profiles = [makeProfile('agent-a', { trust_boundaries: 0.9 })];
    const result = differ.differentiate(profiles, 'review');
    expect(result.size).toBe(0);
  });

  test('returns empty map when profiles are identical (cold start fallback)', () => {
    const profiles = [
      makeProfile('agent-a', {}),
      makeProfile('agent-b', {}),
    ];
    const result = differ.differentiate(profiles, 'review');
    expect(result.size).toBe(0); // caller should fall back to lens-generator
  });

  test('does not reveal peer names in differentiation prompts', () => {
    const profiles = [
      makeProfile('agent-a', { trust_boundaries: 0.9 }),
      makeProfile('agent-b', { input_validation: 0.85 }),
    ];
    const result = differ.differentiate(profiles, 'review');
    const promptA = result.get('agent-a')!;
    const promptB = result.get('agent-b')!;
    expect(promptA).not.toContain('agent-b');
    expect(promptB).not.toContain('agent-a');
  });

  test('handles 3+ agents', () => {
    const profiles = [
      makeProfile('a', { trust_boundaries: 0.9 }),
      makeProfile('b', { input_validation: 0.85 }),
      makeProfile('c', { concurrency: 0.8, resource_exhaustion: 0.7 }),
    ];
    const result = differ.differentiate(profiles, 'review');
    expect(result.size).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/dispatch-differentiator.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement dispatch-differentiator.ts**

Create `packages/orchestrator/src/dispatch-differentiator.ts`:

```typescript
/**
 * DispatchDifferentiator — generates per-agent focus prompts from
 * competency profiles. Deterministic (no LLM call).
 *
 * Privacy rule: prompts never reveal peer names, scores, or weaknesses.
 */

import { CompetencyProfile } from './competency-profiler';

const CATEGORY_LABELS: Record<string, string> = {
  trust_boundaries: 'trust boundaries and authentication',
  injection_vectors: 'injection vectors and input sanitization',
  input_validation: 'input validation and schema enforcement',
  concurrency: 'concurrency, race conditions, and atomicity',
  resource_exhaustion: 'resource exhaustion and DoS vectors',
  type_safety: 'type safety and TypeScript strictness',
  error_handling: 'error handling and fallback paths',
  data_integrity: 'data integrity and consistency',
};

export class DispatchDifferentiator {
  /**
   * Generate differentiation prompts for co-dispatched agents.
   * Returns empty map if:
   *   - single agent (no differentiation needed)
   *   - all profiles have empty strengths (cold start — caller should fall back to lens-generator)
   */
  differentiate(profiles: CompetencyProfile[], task: string): Map<string, string> {
    if (profiles.length < 2) return new Map();

    // Get top strengths per agent
    const agentStrengths = new Map<string, string[]>();
    for (const p of profiles) {
      const sorted = Object.entries(p.reviewStrengths)
        .filter(([, score]) => score > 0.5)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([cat]) => cat);
      agentStrengths.set(p.agentId, sorted);
    }

    // If all agents have empty strengths, return empty (cold start)
    const allEmpty = [...agentStrengths.values()].every(s => s.length === 0);
    if (allEmpty) return new Map();

    // Assign focus areas — each agent gets its strongest categories
    // Categories assigned to one agent are deprioritized for others
    const assigned = new Set<string>();
    const focusMap = new Map<string, string[]>();

    // Sort agents by most specialized first (most unique strengths)
    const sortedAgents = [...agentStrengths.entries()]
      .sort(([, a], [, b]) => b.length - a.length);

    for (const [agentId, strengths] of sortedAgents) {
      const focus: string[] = [];
      for (const cat of strengths) {
        if (!assigned.has(cat)) {
          focus.push(cat);
          assigned.add(cat);
        }
      }
      // If agent has no unique strengths, give it unassigned categories
      if (focus.length === 0) {
        const unassigned = Object.keys(CATEGORY_LABELS).filter(c => !assigned.has(c));
        if (unassigned.length > 0) {
          focus.push(unassigned[0]);
          assigned.add(unassigned[0]);
        }
      }
      focusMap.set(agentId, focus);
    }

    // Generate prompts
    const result = new Map<string, string>();
    for (const [agentId, focus] of focusMap) {
      if (focus.length === 0) continue;
      const labels = focus.map(c => CATEGORY_LABELS[c] || c).join(', ');
      result.set(agentId,
        `Focus your review on ${labels}. ` +
        `Other aspects are covered by your peers. ` +
        `Prioritize depth over breadth in your focus area.`
      );
    }

    return result;
  }
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/orchestrator/src/index.ts`:

```typescript
export { DispatchDifferentiator } from './dispatch-differentiator';
```

- [ ] **Step 5: Run tests and verify pass**

Run: `npx jest tests/orchestrator/dispatch-differentiator.test.ts --no-coverage`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/dispatch-differentiator.ts packages/orchestrator/src/index.ts tests/orchestrator/dispatch-differentiator.test.ts
git commit -m "feat(ati): dispatch differentiator with privacy-safe focus prompts"
```

---

## Task 8: Wire Profiler into Agent Registry

**Files:**
- Modify: `packages/orchestrator/src/agent-registry.ts`
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`

- [ ] **Step 1: Write failing test**

Create `tests/orchestrator/profile-dispatch.test.ts`:

```typescript
import { AgentRegistry } from '@gossip/orchestrator';
import { CompetencyProfiler, CompetencyProfile } from '@gossip/orchestrator';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AgentRegistry — profile-aware dispatch', () => {
  const testDir = join(tmpdir(), 'gossip-profile-dispatch-' + Date.now());
  let registry: AgentRegistry;

  beforeAll(() => {
    mkdirSync(join(testDir, '.gossip'), { recursive: true });
  });
  afterAll(() => rmSync(testDir, { recursive: true, force: true }));

  beforeEach(() => {
    registry = new AgentRegistry();
    registry.register({ id: 'fast-agent', provider: 'google', model: 'flash', preset: 'reviewer', skills: ['code_review'] });
    registry.register({ id: 'deep-agent', provider: 'anthropic', model: 'sonnet', preset: 'reviewer', skills: ['code_review'] });
  });

  test('agents with same skills but different profile multipliers get different scores', () => {
    // Create profiler with data showing deep-agent is more reliable
    const signals = [];
    for (let i = 0; i < 15; i++) {
      signals.push({ type: 'meta', signal: 'task_completed', agentId: 'deep-agent', taskId: `t${i}`, value: 5000, timestamp: '2026-01-01T00:00:00Z' });
      signals.push({ type: 'meta', signal: 'task_completed', agentId: 'fast-agent', taskId: `f${i}`, value: 1000, timestamp: '2026-01-01T00:00:00Z' });
    }
    // deep-agent has high accuracy
    for (let i = 0; i < 10; i++) {
      signals.push({ type: 'consensus', signal: 'agreement', agentId: 'deep-agent', counterpartId: `peer-${i}`, evidence: 'ok', timestamp: '2026-01-01T00:00:00Z', taskId: `t${i}` });
    }
    writeFileSync(join(testDir, '.gossip', 'agent-performance.jsonl'), signals.map(s => JSON.stringify(s)).join('\n') + '\n');

    const profiler = new CompetencyProfiler(testDir);
    registry.setCompetencyProfiler(profiler);

    const match = registry.findBestMatch(['code_review']);
    // deep-agent should win due to higher reliability
    expect(match?.id).toBe('deep-agent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/profile-dispatch.test.ts --no-coverage`
Expected: FAIL — `setCompetencyProfiler` doesn't exist

- [ ] **Step 3: Add CompetencyProfiler to AgentRegistry**

In `packages/orchestrator/src/agent-registry.ts`, add:

```typescript
import { CompetencyProfiler } from './competency-profiler';
```

Add a field and setter:

```typescript
private competencyProfiler: CompetencyProfiler | null = null;

setCompetencyProfiler(profiler: CompetencyProfiler): void {
  this.competencyProfiler = profiler;
}
```

In `findBestMatchExcluding`, replace the `perfWeight` line:

```typescript
// 4. Performance weight — prefer competency profiler if available
let perfWeight = 1.0;
if (this.competencyProfiler) {
  perfWeight = this.competencyProfiler.getProfileMultiplier(agent.id, 'review');
} else if (this.perfReader) {
  perfWeight = this.perfReader.getDispatchWeight(agent.id);
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/orchestrator/profile-dispatch.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Run full test suite for regressions**

Run: `npx jest tests/orchestrator/ --no-coverage`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/agent-registry.ts tests/orchestrator/profile-dispatch.test.ts
git commit -m "feat(ati): wire competency profiler into agent registry dispatch scoring"
```

---

## Task 9: Wire Differentiator into Dispatch Pipeline

**Files:**
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`

- [ ] **Step 1: Add imports and field**

In `packages/orchestrator/src/dispatch-pipeline.ts`, add imports:

```typescript
import { CompetencyProfiler } from './competency-profiler';
import { DispatchDifferentiator } from './dispatch-differentiator';
```

Add fields to the class:

```typescript
private competencyProfiler: CompetencyProfiler | null = null;
private dispatchDifferentiator: DispatchDifferentiator | null = null;
```

Add setter methods:

```typescript
setCompetencyProfiler(profiler: CompetencyProfiler): void {
  this.competencyProfiler = profiler;
}

setDispatchDifferentiator(differ: DispatchDifferentiator): void {
  this.dispatchDifferentiator = differ;
}
```

- [ ] **Step 2: Wire differentiation into dispatchParallel**

In `dispatchParallel`, after the existing lens generation block (around line 711), add a profile-based differentiation path:

```typescript
// Profile-based differentiation (preferred over LLM lenses)
if (!lensMap && this.competencyProfiler && this.dispatchDifferentiator) {
  const profiles = taskDefs
    .map(d => this.competencyProfiler!.getProfile(d.agentId))
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (profiles.length >= 2) {
    const diffMap = this.dispatchDifferentiator.differentiate(profiles, taskDefs[0]?.task || '');
    if (diffMap.size > 0) {
      lensMap = diffMap;
      log(`Applied profile-based differentiation:\n${[...diffMap].map(([id, focus]) => `  ${id} → ${focus.slice(0, 80)}`).join('\n')}`);
    }
  }
}
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit -p packages/orchestrator/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Run full test suite**

Run: `npx jest tests/orchestrator/ --no-coverage`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/dispatch-pipeline.ts
git commit -m "feat(ati): wire profile-based differentiation into dispatch pipeline"
```

---

## Task 10: Selective Consensus

**Files:**
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`
- Test: `tests/orchestrator/selective-consensus.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/orchestrator/selective-consensus.test.ts`:

```typescript
import { shouldSkipConsensus } from '@gossip/orchestrator';
import { CompetencyProfile } from '@gossip/orchestrator';

function makeProfile(id: string, reliability: number, totalTasks: number): CompetencyProfile {
  return {
    agentId: id, reviewStrengths: {}, implPassRate: 0.5, implIterations: 5,
    implPeerApproval: 0.5, speed: 3000, hallucinationRate: 0, avgTokenCost: 0,
    totalTasks, reviewReliability: reliability, implReliability: 0.5,
  };
}

describe('shouldSkipConsensus', () => {
  const highReliability = [makeProfile('a', 0.95, 20), makeProfile('b', 0.92, 20)];
  const lowReliability = [makeProfile('a', 0.7, 20), makeProfile('b', 0.6, 20)];
  const coldStart = [makeProfile('a', 0.95, 5), makeProfile('b', 0.92, 5)];

  test('skips for low-stakes + high reliability + balanced mode', () => {
    expect(shouldSkipConsensus('summarize the architecture', highReliability, 'balanced', { rate: 0.85, uniquePeerPairings: 4 })).toBe(true);
  });

  test('never skips for security tasks', () => {
    expect(shouldSkipConsensus('security review of auth module', highReliability, 'balanced', { rate: 0.85, uniquePeerPairings: 4 })).toBe(false);
  });

  test('never skips in thorough mode', () => {
    expect(shouldSkipConsensus('summarize the architecture', highReliability, 'thorough', { rate: 0.85, uniquePeerPairings: 4 })).toBe(false);
  });

  test('does not skip when reliability too low', () => {
    expect(shouldSkipConsensus('summarize the architecture', lowReliability, 'balanced', { rate: 0.85, uniquePeerPairings: 4 })).toBe(false);
  });

  test('does not skip during cold start', () => {
    expect(shouldSkipConsensus('summarize the architecture', coldStart, 'balanced', { rate: 0.85, uniquePeerPairings: 4 })).toBe(false);
  });

  test('does not skip when agreement diversity is low', () => {
    expect(shouldSkipConsensus('summarize the architecture', highReliability, 'balanced', { rate: 0.85, uniquePeerPairings: 1 })).toBe(false);
  });

  test('does not skip when agreement rate is low', () => {
    expect(shouldSkipConsensus('summarize the architecture', highReliability, 'balanced', { rate: 0.5, uniquePeerPairings: 4 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/selective-consensus.test.ts --no-coverage`
Expected: FAIL — `shouldSkipConsensus` not found

- [ ] **Step 3: Implement shouldSkipConsensus**

Add to `packages/orchestrator/src/dispatch-pipeline.ts` (as an exported function at the bottom):

```typescript
const SECURITY_KEYWORDS = /security|vulnerab|auth|inject|exploit|breach|attack|malicious/i;
const OBSERVATION_VERBS = /^(summarize|research|analyze|check|verify|list|explain|document|review|audit|trace|investigate)\b/i;

export function shouldSkipConsensus(
  task: string,
  agents: Array<{ reviewReliability: number; totalTasks: number }>,
  costMode: string,
  agreementHistory: { rate: number; uniquePeerPairings: number },
): boolean {
  if (costMode === 'thorough') return false;
  if (SECURITY_KEYWORDS.test(task)) return false;
  if (agents.some(a => a.reviewReliability < 0.9)) return false;
  if (agents.some(a => a.totalTasks < 10)) return false;
  if (agreementHistory.rate < 0.8 || agreementHistory.uniquePeerPairings < 3) return false;
  // Low-stakes: first word is an observation verb
  const firstWord = task.trim().split(/\s+/)[0] || '';
  return OBSERVATION_VERBS.test(firstWord);
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/orchestrator/src/index.ts`:

```typescript
export { shouldSkipConsensus } from './dispatch-pipeline';
```

- [ ] **Step 5: Run tests**

Run: `npx jest tests/orchestrator/selective-consensus.test.ts --no-coverage`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/dispatch-pipeline.ts packages/orchestrator/src/index.ts tests/orchestrator/selective-consensus.test.ts
git commit -m "feat(ati): selective consensus with security gate and diversity check"
```

---

## Task 11: Integration Test — Full ATI Loop

**Files:**
- Test: `tests/orchestrator/ati-integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/orchestrator/ati-integration.test.ts`:

```typescript
import { CompetencyProfiler, extractCategories, DispatchDifferentiator, PerformanceWriter } from '@gossip/orchestrator';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ATI v3 — full loop integration', () => {
  const testDir = join(tmpdir(), 'gossip-ati-integration-' + Date.now());
  let writer: PerformanceWriter;
  let profiler: CompetencyProfiler;
  const differ = new DispatchDifferentiator();

  beforeAll(() => {
    mkdirSync(join(testDir, '.gossip'), { recursive: true });
    writer = new PerformanceWriter(testDir);
    profiler = new CompetencyProfiler(testDir);
  });

  afterAll(() => rmSync(testDir, { recursive: true, force: true }));

  test('consensus → category extraction → profile update → differentiation', () => {
    // 1. Simulate 12 completed tasks for two agents
    for (let i = 0; i < 12; i++) {
      writer.appendSignal({ type: 'meta', signal: 'task_completed', agentId: 'agent-a', taskId: `a-${i}`, value: 5000, timestamp: new Date().toISOString() });
      writer.appendSignal({ type: 'meta', signal: 'task_completed', agentId: 'agent-b', taskId: `b-${i}`, value: 2000, timestamp: new Date().toISOString() });
    }

    // 2. Simulate confirmed findings with categories
    const findingsA = ['Prompt injection via unsanitized input', 'Authentication bypass on relay'];
    const findingsB = ['Race condition in scope validation', 'Unbounded memory allocation'];

    for (const f of findingsA) {
      for (const cat of extractCategories(f)) {
        writer.appendSignal({ type: 'consensus', signal: 'category_confirmed' as any, agentId: 'agent-a', taskId: 'review-1', category: cat, evidence: f, timestamp: new Date().toISOString() });
      }
    }
    for (const f of findingsB) {
      for (const cat of extractCategories(f)) {
        writer.appendSignal({ type: 'consensus', signal: 'category_confirmed' as any, agentId: 'agent-b', taskId: 'review-1', category: cat, evidence: f, timestamp: new Date().toISOString() });
      }
    }

    // 3. Read profiles
    const profileA = profiler.getProfile('agent-a');
    const profileB = profiler.getProfile('agent-b');
    expect(profileA).not.toBeNull();
    expect(profileB).not.toBeNull();

    // agent-a should be strong in injection/trust, agent-b in concurrency/resource
    expect(profileA!.reviewStrengths['injection_vectors']).toBeGreaterThan(0.5);
    expect(profileA!.reviewStrengths['trust_boundaries']).toBeGreaterThan(0.5);
    expect(profileB!.reviewStrengths['concurrency']).toBeGreaterThan(0.5);
    expect(profileB!.reviewStrengths['resource_exhaustion']).toBeGreaterThan(0.5);

    // 4. Differentiate
    const diffMap = differ.differentiate([profileA!, profileB!], 'security review');
    expect(diffMap.size).toBe(2);
    expect(diffMap.get('agent-a')).toContain('injection');
    expect(diffMap.get('agent-b')).toContain('concurrency');

    // 5. Privacy check
    expect(diffMap.get('agent-a')).not.toContain('agent-b');
    expect(diffMap.get('agent-b')).not.toContain('agent-a');
  });

  test('impl signals update implPassRate', () => {
    // Simulate impl signals
    for (let i = 0; i < 3; i++) {
      writer.appendSignal({ type: 'impl', signal: 'impl_test_pass', agentId: 'agent-a', taskId: `impl-${i}`, timestamp: new Date().toISOString() });
    }
    writer.appendSignal({ type: 'impl', signal: 'impl_test_fail', agentId: 'agent-a', taskId: 'impl-3', timestamp: new Date().toISOString() });

    // Force cache refresh
    const freshProfiler = new CompetencyProfiler(testDir);
    const profile = freshProfiler.getProfile('agent-a');
    expect(profile!.implPassRate).toBeCloseTo(0.75, 1); // 3 pass / 4 total
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx jest tests/orchestrator/ati-integration.test.ts --no-coverage`
Expected: All PASS

- [ ] **Step 3: Run full test suite**

Run: `npx jest tests/ --no-coverage --testPathIgnorePatterns='e2e|full-stack'`
Expected: All PASS (no regressions)

- [ ] **Step 4: Commit**

```bash
git add tests/orchestrator/ati-integration.test.ts
git commit -m "test(ati): full loop integration — consensus → categories → profiles → differentiation"
```

---

## Task 12: Build and Type Check

- [ ] **Step 1: Type check all packages**

Run: `npx tsc --noEmit -p packages/orchestrator/tsconfig.json && npx tsc --noEmit -p packages/tools/tsconfig.json`
Expected: No errors

- [ ] **Step 2: Build dist**

Run: `npx tsc -p packages/orchestrator/tsconfig.json && npx tsc -p packages/tools/tsconfig.json`
Expected: Clean build

- [ ] **Step 3: Run full test suite one final time**

Run: `npx jest tests/ --no-coverage --testPathIgnorePatterns='e2e|full-stack'`
Expected: All PASS

- [ ] **Step 4: Final commit**

```bash
git add packages/orchestrator/dist/ packages/tools/dist/
git commit -m "build: compile ATI v3 phase 1"
```
