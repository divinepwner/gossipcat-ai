import { overviewHandler } from '@gossip/relay/dashboard/api-overview';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Overview API', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'gossip-dash-'));
    mkdirSync(join(projectRoot, '.gossip'), { recursive: true });
  });

  it('returns zero counts for fresh project', async () => {
    const result = await overviewHandler(projectRoot, { agentConfigs: [], relayConnections: 0 });
    expect(result).toEqual({
      agentsOnline: 0, relayCount: 0, nativeCount: 0,
      consensusRuns: 0, totalFindings: 0, confirmedFindings: 0, totalSignals: 0,
    });
  });

  it('counts agents by type', async () => {
    const configs = [
      { id: 'a', provider: 'anthropic', model: 'm', skills: [], native: true },
      { id: 'b', provider: 'google', model: 'm', skills: [] },
      { id: 'c', provider: 'google', model: 'm', skills: [] },
    ];
    const result = await overviewHandler(projectRoot, { agentConfigs: configs as any, relayConnections: 2 });
    expect(result.agentsOnline).toBe(3);
    expect(result.nativeCount).toBe(1);
    expect(result.relayCount).toBe(2);
  });

  it('counts signals from agent-performance.jsonl', async () => {
    const signals = [
      { type: 'consensus', signal: 'agreement', agentId: 'a', evidence: 'x', timestamp: new Date().toISOString() },
      { type: 'consensus', signal: 'agreement', agentId: 'b', evidence: 'y', timestamp: new Date().toISOString() },
      { type: 'consensus', signal: 'hallucination_caught', agentId: 'a', evidence: 'z', timestamp: new Date().toISOString() },
    ];
    writeFileSync(
      join(projectRoot, '.gossip', 'agent-performance.jsonl'),
      signals.map(s => JSON.stringify(s)).join('\n') + '\n'
    );
    const result = await overviewHandler(projectRoot, { agentConfigs: [], relayConnections: 0 });
    expect(result.totalSignals).toBe(3);
  });
});
