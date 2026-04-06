import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { PerformanceReader } from '../../packages/orchestrator/src/performance-reader';

const TMP = join(__dirname, '..', '..', '.test-tmp-diversity');

function writeSignals(signals: object[]): void {
  mkdirSync(join(TMP, '.gossip'), { recursive: true });
  writeFileSync(join(TMP, '.gossip', 'agent-performance.jsonl'), signals.map(s => JSON.stringify(s)).join('\n'));
}

const now = new Date().toISOString();
afterEach(() => { try { rmSync(TMP, { recursive: true }); } catch {} });

describe('peer diversity', () => {
  test('agent with diverse peers scores higher than agent with single peer', () => {
    const signals = [
      { type: 'consensus', taskId: 't1', signal: 'agreement', agentId: 'agent-diverse', counterpartId: 'peer-1', evidence: 'ok', timestamp: now },
      { type: 'consensus', taskId: 't2', signal: 'agreement', agentId: 'agent-diverse', counterpartId: 'peer-2', evidence: 'ok', timestamp: now },
      { type: 'consensus', taskId: 't3', signal: 'agreement', agentId: 'agent-diverse', counterpartId: 'peer-3', evidence: 'ok', timestamp: now },
      { type: 'consensus', taskId: 't1', signal: 'agreement', agentId: 'agent-echo', counterpartId: 'peer-1', evidence: 'ok', timestamp: now },
      { type: 'consensus', taskId: 't2', signal: 'agreement', agentId: 'agent-echo', counterpartId: 'peer-1', evidence: 'ok', timestamp: now },
      { type: 'consensus', taskId: 't3', signal: 'agreement', agentId: 'agent-echo', counterpartId: 'peer-1', evidence: 'ok', timestamp: now },
      { type: 'consensus', taskId: 't1', signal: 'agreement', agentId: 'peer-1', counterpartId: 'agent-diverse', evidence: 'ok', timestamp: now },
      { type: 'consensus', taskId: 't2', signal: 'agreement', agentId: 'peer-2', counterpartId: 'agent-diverse', evidence: 'ok', timestamp: now },
      { type: 'consensus', taskId: 't3', signal: 'agreement', agentId: 'peer-3', counterpartId: 'agent-diverse', evidence: 'ok', timestamp: now },
    ];
    writeSignals(signals);
    const reader = new PerformanceReader(TMP);
    const scores = reader.getScores();
    expect(scores.get('agent-diverse')!.reliability).toBeGreaterThan(scores.get('agent-echo')!.reliability);
  });

  test('peer diversity does not apply to non-agreement signals', () => {
    const signals = [
      { type: 'consensus', taskId: 't1', signal: 'unique_confirmed', agentId: 'agent-a', evidence: 'ok', timestamp: now },
      { type: 'consensus', taskId: 't2', signal: 'unique_confirmed', agentId: 'agent-b', evidence: 'ok', timestamp: now },
    ];
    writeSignals(signals);
    const reader = new PerformanceReader(TMP);
    const scores = reader.getScores();
    expect(scores.get('agent-a')!.reliability).toBeCloseTo(scores.get('agent-b')!.reliability, 5);
  });
});

describe('getImplScore', () => {
  test('returns null when no impl signals exist', () => {
    writeSignals([{ type: 'consensus', taskId: 't1', signal: 'agreement', agentId: 'a', evidence: 'ok', timestamp: now }]);
    const reader = new PerformanceReader(TMP);
    expect(reader.getImplScore('a')).toBeNull();
  });

  test('reliability decays toward 0.5 when last signal is old', () => {
    // Signal from 14 days ago — should decay ~50% toward neutral with 7-day half-life
    const oldTs = new Date(Date.now() - 14 * 86400000).toISOString();
    writeSignals([
      { type: 'impl', taskId: 't1', signal: 'impl_test_pass', agentId: 'a', evidence: 'ok', timestamp: oldTs },
      { type: 'impl', taskId: 't2', signal: 'impl_test_pass', agentId: 'a', evidence: 'ok', timestamp: oldTs },
      { type: 'impl', taskId: 't3', signal: 'impl_peer_approved', agentId: 'a', evidence: 'ok', timestamp: oldTs },
    ]);
    const reader = new PerformanceReader(TMP);
    const score = reader.getImplScore('a')!;
    // Raw reliability would be 1.0 (100% pass, 100% approval).
    // After 14-day decay with 7-day half-life: 0.5 + (1.0 - 0.5) * 0.25 = 0.625
    expect(score.reliability).toBeLessThan(0.9);
    expect(score.reliability).toBeGreaterThan(0.5);
    expect(score.passRate).toBeCloseTo(1.0);
  });

  test('recent signals are not decayed', () => {
    writeSignals([
      { type: 'impl', taskId: 't1', signal: 'impl_test_pass', agentId: 'a', evidence: 'ok', timestamp: now },
      { type: 'impl', taskId: 't2', signal: 'impl_peer_approved', agentId: 'a', evidence: 'ok', timestamp: now },
    ]);
    const reader = new PerformanceReader(TMP);
    const score = reader.getImplScore('a')!;
    // Signal is from now — decay factor ≈ 1.0, reliability should be near raw value
    expect(score.reliability).toBeGreaterThan(0.9);
  });

  test('expired signals (>30 days) are excluded', () => {
    const expiredTs = new Date(Date.now() - 31 * 86400000).toISOString();
    writeSignals([
      { type: 'impl', taskId: 't1', signal: 'impl_test_pass', agentId: 'a', evidence: 'ok', timestamp: expiredTs },
    ]);
    const reader = new PerformanceReader(TMP);
    expect(reader.getImplScore('a')).toBeNull();
  });
});
