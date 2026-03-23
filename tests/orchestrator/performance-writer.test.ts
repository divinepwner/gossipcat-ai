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
