/**
 * Comprehensive tests for gossipcat MCP tool handlers.
 *
 * Tests cover:
 *   - PerformanceWriter.appendSignals (used by gossip_signals handler)
 *   - handleDispatchSingle
 *   - handleCollect
 *   - handleNativeRelay
 *   - evictStaleNativeTasks + persistNativeTaskMap
 *
 * Mocking strategy: import the real ctx object and mutate its properties
 * between tests. This avoids jest.mock hoisting issues with modules that
 * import ctx at the top level.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PerformanceWriter } from '@gossip/orchestrator';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `gossip-mcp-test-${label}-`));
}

// ── PerformanceWriter (gossip_signals) ────────────────────────────────────────

describe('PerformanceWriter — gossip_signals backing store', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTmpDir('signals');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('writes a valid agreement signal to disk', () => {
    const writer = new PerformanceWriter(testDir);
    const signal = {
      type: 'consensus' as const,
      signal: 'agreement' as const,
      agentId: 'agent-a',
      taskId: 'task-001',
      evidence: 'Both agents agree on the race condition',
      timestamp: new Date().toISOString(),
    };
    expect(() => writer.appendSignal(signal)).not.toThrow();

    const filePath = join(testDir, '.gossip', 'agent-performance.jsonl');
    expect(existsSync(filePath)).toBe(true);
    const line = JSON.parse(readFileSync(filePath, 'utf-8').trim());
    expect(line.signal).toBe('agreement');
    expect(line.agentId).toBe('agent-a');
  });

  it('writes a valid unique_confirmed signal', () => {
    const writer = new PerformanceWriter(testDir);
    const signal = {
      type: 'consensus' as const,
      signal: 'unique_confirmed' as const,
      agentId: 'gemini-reviewer',
      taskId: 'task-42',
      evidence: 'Verified: unbounded file growth confirmed in native-tasks.ts',
      timestamp: new Date().toISOString(),
    };
    writer.appendSignal(signal);

    const raw = readFileSync(join(testDir, '.gossip', 'agent-performance.jsonl'), 'utf-8').trim();
    const parsed = JSON.parse(raw);
    expect(parsed.signal).toBe('unique_confirmed');
    expect(parsed.agentId).toBe('gemini-reviewer');
  });

  it('writes a valid hallucination_caught signal', () => {
    const writer = new PerformanceWriter(testDir);
    const signal = {
      type: 'consensus' as const,
      signal: 'hallucination_caught' as const,
      agentId: 'haiku-researcher',
      taskId: 'task-99',
      evidence: 'Agent claimed ScopeTracker persists to disk — it does not',
      timestamp: new Date().toISOString(),
    };
    expect(() => writer.appendSignal(signal)).not.toThrow();
    const raw = readFileSync(join(testDir, '.gossip', 'agent-performance.jsonl'), 'utf-8').trim();
    expect(JSON.parse(raw).signal).toBe('hallucination_caught');
  });

  it('appends multiple signals in one batch', () => {
    const writer = new PerformanceWriter(testDir);
    const ts = new Date().toISOString();
    writer.appendSignals([
      { type: 'consensus' as const, signal: 'agreement' as const, agentId: 'a1', taskId: 't1', evidence: 'e1', timestamp: ts },
      { type: 'consensus' as const, signal: 'disagreement' as const, agentId: 'a2', taskId: 't2', evidence: 'e2', timestamp: ts },
    ]);

    const lines = readFileSync(join(testDir, '.gossip', 'agent-performance.jsonl'), 'utf-8')
      .trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).agentId).toBe('a1');
    expect(JSON.parse(lines[1]).agentId).toBe('a2');
  });

  it('rejects a signal with missing agentId', () => {
    const writer = new PerformanceWriter(testDir);
    expect(() => writer.appendSignal({
      type: 'consensus' as const,
      signal: 'agreement' as const,
      agentId: '',
      taskId: 'task-1',
      evidence: 'x',
      timestamp: new Date().toISOString(),
    })).toThrow(/agentId/);
  });

  it('rejects a signal with an unknown signal value', () => {
    const writer = new PerformanceWriter(testDir);
    expect(() => writer.appendSignal({
      type: 'consensus' as const,
      signal: 'not_a_real_signal' as any,
      agentId: 'agent-x',
      taskId: 'task-1',
      evidence: 'x',
      timestamp: new Date().toISOString(),
    })).toThrow(/unknown consensus signal/);
  });

  it('rejects a signal with an invalid timestamp', () => {
    const writer = new PerformanceWriter(testDir);
    expect(() => writer.appendSignal({
      type: 'consensus' as const,
      signal: 'agreement' as const,
      agentId: 'agent-x',
      taskId: 'task-1',
      evidence: 'x',
      timestamp: 'not-a-date',
    })).toThrow(/timestamp/);
  });
});

// ── Handler tests using real ctx mutation ─────────────────────────────────────
//
// All handler modules import `ctx` from mcp-context at the top of their file.
// Rather than trying to mock the module (which requires hoisting), we import
// the real ctx and mutate its properties before each test, then restore after.

import { ctx } from '../../apps/cli/src/mcp-context';
import {
  handleDispatchSingle,
} from '../../apps/cli/src/handlers/dispatch';
import { handleCollect } from '../../apps/cli/src/handlers/collect';
import {
  handleNativeRelay,
  evictStaleNativeTasks,
  persistNativeTaskMap,
  restoreNativeTaskMap,
} from '../../apps/cli/src/handlers/native-tasks';

// Snapshot original ctx so we can restore between tests
const originalCtx = {
  mainAgent: ctx.mainAgent,
  relay: ctx.relay,
  workers: ctx.workers,
  keychain: ctx.keychain,
  skillGenerator: ctx.skillGenerator,
  nativeTaskMap: ctx.nativeTaskMap,
  nativeResultMap: ctx.nativeResultMap,
  nativeAgentConfigs: ctx.nativeAgentConfigs,
  pendingConsensusRounds: ctx.pendingConsensusRounds,
  booted: ctx.booted,
  boot: ctx.boot,
  syncWorkersViaKeychain: ctx.syncWorkersViaKeychain,
};

function makeMainAgent(overrides: Record<string, any> = {}): any {
  return {
    dispatch: jest.fn().mockReturnValue({ taskId: 'default-task-id' }),
    collect: jest.fn().mockResolvedValue({ results: [] }),
    runConsensus: jest.fn().mockResolvedValue({
      summary: '', signals: [], confirmed: [], disputed: [],
      unverified: [], unique: [], insights: [], agentCount: 0, rounds: 0,
    }),
    getAgentConfig: jest.fn().mockReturnValue(null),
    getLlm: jest.fn().mockReturnValue(null),
    getLLM: jest.fn().mockReturnValue(null),
    getAgentList: jest.fn().mockReturnValue([]),
    getSkillGapSuggestions: jest.fn().mockReturnValue([]),
    getSkillIndex: jest.fn().mockReturnValue(null),
    getSessionGossip: jest.fn().mockReturnValue([]),
    getSessionConsensusHistory: jest.fn().mockReturnValue([]),
    recordNativeTask: jest.fn(),
    recordNativeTaskCompleted: jest.fn(),
    recordPlanStepResult: jest.fn(),
    publishNativeGossip: jest.fn().mockResolvedValue(undefined),
    getChainContext: jest.fn().mockReturnValue(''),
    dispatchParallel: jest.fn().mockResolvedValue({ taskIds: [], errors: [] }),
    getTask: jest.fn().mockReturnValue(null),
    pipeline: null,
    projectRoot: '/tmp/gossip-test-project',
    ...overrides,
  };
}

function resetCtx(mainAgentOverrides: Record<string, any> = {}, projectRoot?: string) {
  ctx.mainAgent = makeMainAgent({ ...(projectRoot ? { projectRoot } : {}), ...mainAgentOverrides });
  ctx.nativeTaskMap = new Map();
  ctx.nativeResultMap = new Map();
  ctx.nativeAgentConfigs = new Map();
  ctx.pendingConsensusRounds = new Map();
  ctx.booted = true;
  ctx.boot = jest.fn().mockResolvedValue(undefined) as any;
  ctx.syncWorkersViaKeychain = jest.fn().mockResolvedValue(undefined) as any;
  (ctx as any).skillGenerator = null;
}

function restoreCtx() {
  Object.assign(ctx, originalCtx);
}

// ── handleDispatchSingle ─────────────────────────────────────────────────────

describe('handleDispatchSingle', () => {
  beforeEach(() => resetCtx());
  afterEach(() => restoreCtx());

  it('dispatches to relay agent and returns task ID', async () => {
    ctx.mainAgent = makeMainAgent({ dispatch: jest.fn().mockReturnValue({ taskId: 'abc12345' }) });
    const result = await handleDispatchSingle('relay-agent', 'Review server.ts');
    expect(result.content[0].text).toContain('Dispatched to relay-agent');
    expect(result.content[0].text).toContain('abc12345');
  });

  it('rejects an agent ID with invalid characters', async () => {
    const result = await handleDispatchSingle('agent with spaces!', 'some task');
    expect(result.content[0].text).toContain('Invalid agent ID format');
  });

  it('includes write_mode label in dispatch response', async () => {
    ctx.mainAgent = makeMainAgent({ dispatch: jest.fn().mockReturnValue({ taskId: 'wmode1' }) });
    const result = await handleDispatchSingle('relay-agent', 'Do work', 'sequential');
    expect(result.content[0].text).toContain('[sequential]');
  });

  it('dispatches to native agent and returns NATIVE_DISPATCH instructions', async () => {
    ctx.nativeAgentConfigs.set('native-claude', {
      model: 'claude-opus-4-5',
      instructions: 'You are a reviewer.',
      description: 'Native reviewer',
    });
    const result = await handleDispatchSingle('native-claude', 'Audit memory system');
    const text = result.content[0].text;
    expect(text).toContain('NATIVE_DISPATCH');
    expect(text).toContain('gossip_relay');
    expect(text).toContain('native-claude');
    expect(text).toContain('claude-opus-4-5');
  });

  it('returns error when plan_id given without step', async () => {
    const result = await handleDispatchSingle(
      'relay-agent', 'task', undefined, undefined, undefined, 'plan-abc',
    );
    expect(result.content[0].text).toContain('plan_id requires step');
  });

  it('propagates dispatch error message as text response', async () => {
    ctx.mainAgent = makeMainAgent({
      dispatch: jest.fn().mockImplementation(() => { throw new Error('Agent not configured'); }),
    });
    const result = await handleDispatchSingle('unknown-agent', 'some task');
    expect(result.content[0].text).toContain('Agent not configured');
  });
});

// ── handleCollect ─────────────────────────────────────────────────────────────

describe('handleCollect', () => {
  beforeEach(() => resetCtx());
  afterEach(() => restoreCtx());

  it('returns "No pending tasks" when nothing was dispatched', async () => {
    const result = await handleCollect([], 5000, false);
    expect(result.content[0].text).toContain('No pending tasks');
  });

  it('returns error if consensus mode requested with no task IDs', async () => {
    const result = await handleCollect([], 5000, true);
    expect(result.content[0].text).toContain('consensus mode requires explicit task_ids');
  });

  it('returns error when relay collect throws and there are no native tasks', async () => {
    ctx.mainAgent = makeMainAgent({
      collect: jest.fn().mockRejectedValue(new Error('relay is down')),
    });
    const result = await handleCollect(['task-1'], 5000, false);
    expect(result.content[0].text).toContain('relay is down');
  });

  it('formats a completed relay result', async () => {
    const now = Date.now();
    ctx.mainAgent = makeMainAgent({
      collect: jest.fn().mockResolvedValue({
        results: [{
          id: 'abc123',
          agentId: 'gemini-reviewer',
          task: 'Audit server.ts',
          status: 'completed',
          result: 'Found 2 issues.',
          startedAt: now - 1000,
          completedAt: now,
        }],
      }),
    });
    const result = await handleCollect(['abc123'], 5000, false);
    expect(result.content[0].text).toContain('[abc123]');
    expect(result.content[0].text).toContain('Found 2 issues');
    expect(result.content[0].text).toContain('gemini-reviewer');
  });

  it('formats a failed relay result with gossip_run re-dispatch hint', async () => {
    const now = Date.now();
    ctx.mainAgent = makeMainAgent({
      collect: jest.fn().mockResolvedValue({
        results: [{
          id: 'fail01',
          agentId: 'sonnet-reviewer',
          task: 'Review auth.ts',
          status: 'failed',
          error: 'Context window exceeded',
          startedAt: now - 2000,
          completedAt: now,
        }],
      }),
    });
    const result = await handleCollect(['fail01'], 5000, false);
    expect(result.content[0].text).toContain('ERROR');
    expect(result.content[0].text).toContain('gossip_run');
  });

  it('includes native result from nativeResultMap when collected by ID', async () => {
    const now = Date.now();
    ctx.mainAgent = makeMainAgent({ collect: jest.fn().mockResolvedValue({ results: [] }) });
    ctx.nativeResultMap.set('native-t1', {
      id: 'native-t1',
      agentId: 'native-claude',
      task: 'Review code',
      status: 'completed',
      result: 'All good!',
      startedAt: now - 500,
      completedAt: now,
    });
    ctx.nativeTaskMap.set('native-t1', {
      agentId: 'native-claude',
      task: 'Review code',
      startedAt: now - 500,
    });
    ctx.nativeAgentConfigs.set('native-claude', {
      model: 'claude-opus-4-5',
      instructions: '',
      description: '',
    });

    const result = await handleCollect(['native-t1'], 5000, false);
    expect(result.content[0].text).toContain('All good!');
    expect(result.content[0].text).toContain('native-claude');
  });
});

// ── handleNativeRelay ─────────────────────────────────────────────────────────

describe('handleNativeRelay', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTmpDir('relay');
    resetCtx({}, testDir);
  });

  afterEach(() => {
    restoreCtx();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('relays result for a known task ID', async () => {
    const now = Date.now();
    ctx.nativeTaskMap.set('task-abc', {
      agentId: 'native-claude',
      task: 'Review x',
      startedAt: now - 1000,
      timeoutMs: 30000,
    });

    const result = await handleNativeRelay('task-abc', 'Found 3 bugs.');
    expect(result.content[0].text).toContain('completed');
    expect(result.content[0].text).toContain('native-claude');
    expect(result.content[0].text).toContain('task-abc');
  });

  it('stores result in nativeResultMap after successful relay', async () => {
    const now = Date.now();
    ctx.nativeTaskMap.set('task-store', {
      agentId: 'native-claude',
      task: 'Review x',
      startedAt: now - 500,
      timeoutMs: 30000,
    });

    await handleNativeRelay('task-store', 'All clear.');

    const stored = ctx.nativeResultMap.get('task-store');
    expect(stored).toBeDefined();
    expect(stored!.status).toBe('completed');
    expect(stored!.result).toBe('All clear.');
  });

  it('returns error for unknown task ID', async () => {
    const result = await handleNativeRelay('unknown-xyz', 'some result');
    expect(result.content[0].text).toContain('Unknown task ID');
  });

  it('records failed status when error argument is provided', async () => {
    const now = Date.now();
    ctx.nativeTaskMap.set('task-err', {
      agentId: 'native-claude',
      task: 'Something',
      startedAt: now - 200,
      timeoutMs: 30000,
    });

    await handleNativeRelay('task-err', '', 'LLM context overflow');

    const stored = ctx.nativeResultMap.get('task-err');
    expect(stored!.status).toBe('failed');
    expect(stored!.error).toBe('LLM context overflow');
  });

  it('late relay overwrites a timed_out result', async () => {
    const now = Date.now();
    // Task not in taskMap (evicted on timeout), but present as timed_out in resultMap
    ctx.nativeResultMap.set('task-late', {
      id: 'task-late',
      agentId: 'native-claude',
      task: 'Review y',
      status: 'timed_out',
      error: 'Timed out after 30000ms',
      startedAt: now - 35000,
      completedAt: now - 5000,
    });

    const result = await handleNativeRelay('task-late', 'Better late than never!');
    expect(result.content[0].text).not.toContain('Unknown task ID');
    expect(result.content[0].text).toContain('completed');

    const stored = ctx.nativeResultMap.get('task-late');
    expect(stored!.status).toBe('completed');
    expect(stored!.result).toBe('Better late than never!');
  });
});

// ── evictStaleNativeTasks ─────────────────────────────────────────────────────

describe('evictStaleNativeTasks', () => {
  const TTL = 2 * 60 * 60 * 1000;

  beforeEach(() => resetCtx());
  afterEach(() => restoreCtx());

  it('evicts tasks older than TTL from nativeTaskMap', () => {
    const now = Date.now();
    ctx.nativeTaskMap.set('old-task', { agentId: 'a', task: 't', startedAt: now - TTL - 1000 });
    ctx.nativeTaskMap.set('new-task', { agentId: 'b', task: 'u', startedAt: now - 1000 });

    evictStaleNativeTasks();

    expect(ctx.nativeTaskMap.has('old-task')).toBe(false);
    expect(ctx.nativeTaskMap.has('new-task')).toBe(true);
  });

  it('evicts stale results from nativeResultMap', () => {
    const now = Date.now();
    ctx.nativeResultMap.set('old-res', {
      id: 'old-res', agentId: 'a', task: 't', status: 'completed' as const,
      startedAt: now - TTL - 1000, completedAt: now - TTL,
    });
    ctx.nativeResultMap.set('new-res', {
      id: 'new-res', agentId: 'b', task: 'u', status: 'completed' as const,
      startedAt: now - 1000, completedAt: now,
    });

    evictStaleNativeTasks();

    expect(ctx.nativeResultMap.has('old-res')).toBe(false);
    expect(ctx.nativeResultMap.has('new-res')).toBe(true);
  });
});

// ── persistNativeTaskMap + restoreNativeTaskMap ──────────────────────────────

describe('persistNativeTaskMap + restore', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTmpDir('persist');
    resetCtx({}, testDir);
  });

  afterEach(() => {
    restoreCtx();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('writes native-tasks.json with task metadata', () => {
    const now = Date.now();
    ctx.nativeTaskMap.set('t1', {
      agentId: 'claude-reviewer',
      task: 'Review code',
      startedAt: now,
    });

    persistNativeTaskMap();

    const filePath = join(testDir, '.gossip', 'native-tasks.json');
    expect(existsSync(filePath)).toBe(true);
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.tasks['t1']).toBeDefined();
    expect(data.tasks['t1'].agentId).toBe('claude-reviewer');
  });

  it('persists result metadata but strips full result text (slim format)', () => {
    const now = Date.now();
    const longResult = 'x'.repeat(100_000);
    ctx.nativeResultMap.set('r1', {
      id: 'r1', agentId: 'a', task: 'do stuff',
      status: 'completed' as const, result: longResult,
      startedAt: now - 500, completedAt: now,
    });

    persistNativeTaskMap();

    const filePath = join(testDir, '.gossip', 'native-tasks.json');
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.results['r1']).toBeDefined();
    // Full result text is not stored — only status metadata
    expect(data.results['r1'].result).toBeUndefined();
    expect(data.results['r1'].status).toBe('completed');
  });

  it('restores non-expired tasks from disk', () => {
    const TTL = 2 * 60 * 60 * 1000;
    const now = Date.now();
    const gossipDir = join(testDir, '.gossip');
    mkdirSync(gossipDir, { recursive: true });
    writeFileSync(join(gossipDir, 'native-tasks.json'), JSON.stringify({
      tasks: {
        'valid-task': {
          agentId: 'a', task: 'valid',
          startedAt: now - 1000, timeoutMs: TTL,
        },
        'expired-task': {
          agentId: 'b', task: 'old',
          startedAt: now - TTL - 5000, timeoutMs: TTL,
        },
      },
      results: {},
    }));

    restoreNativeTaskMap(testDir);

    expect(ctx.nativeTaskMap.has('valid-task')).toBe(true);
    expect(ctx.nativeTaskMap.has('expired-task')).toBe(false);
  });

  it('marks task as timed_out on restore if individual task timeout has elapsed', () => {
    const now = Date.now();
    const shortTimeout = 5000;
    const gossipDir = join(testDir, '.gossip');
    mkdirSync(gossipDir, { recursive: true });
    writeFileSync(join(gossipDir, 'native-tasks.json'), JSON.stringify({
      tasks: {
        'timed-task': {
          agentId: 'c', task: 'expired work',
          startedAt: now - shortTimeout - 1000, // started 6s ago, 5s timeout
          timeoutMs: shortTimeout,
        },
      },
      results: {},
    }));

    restoreNativeTaskMap(testDir);

    const timedOut = ctx.nativeResultMap.get('timed-task');
    expect(timedOut).toBeDefined();
    expect(timedOut!.status).toBe('timed_out');
  });
});
