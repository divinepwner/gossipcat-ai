import type { ConsensusReport, ConsensusFinding, ConsensusSignal, CollectResult } from '@gossip/orchestrator';
import { ConsensusEngine } from '@gossip/orchestrator';

describe('Consensus types', () => {
  it('CollectResult shape is valid', () => {
    const result: CollectResult = {
      results: [],
      consensus: undefined,
    };
    expect(result.results).toEqual([]);
    expect(result.consensus).toBeUndefined();
  });

  it('ConsensusReport shape is valid', () => {
    const signal: ConsensusSignal = {
      type: 'consensus',
      taskId: 't1',
      signal: 'agreement',
      agentId: 'a1',
      evidence: 'test',
      timestamp: new Date().toISOString(),
    };
    const finding: ConsensusFinding = {
      id: 'f1',
      originalAgentId: 'a1',
      finding: 'test finding',
      tag: 'confirmed',
      confirmedBy: ['a2'],
      disputedBy: [],
      confidence: 4,
    };
    const report: ConsensusReport = {
      agentCount: 2,
      rounds: 2,
      confirmed: [finding],
      disputed: [],
      unique: [],
      newFindings: [],
      signals: [signal],
      summary: 'test summary',
    };
    expect(report.agentCount).toBe(2);
    expect(report.confirmed).toHaveLength(1);
    expect(signal.type).toBe('consensus');
  });
});

describe('ConsensusEngine', () => {
  describe('extractSummary()', () => {
    it('extracts ## Consensus Summary section', () => {
      const result = `Some long analysis...\n\n## Consensus Summary\n- SQL injection at auth.ts:47\n- Missing rate limiting on /api/tasks\n\nSome trailing text`;
      const engine = new ConsensusEngine({
        llm: null as any,
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
      expect(summary).toBe(result);
    });

    it('truncates full result at sentence boundary when no summary section', () => {
      const sentences = Array.from({ length: 50 }, (_, i) => `Finding ${i}: something is wrong at file${i}.ts:${i}.`);
      const result = sentences.join(' ');
      const engine = new ConsensusEngine({
        llm: null as any,
        registryGet: () => undefined,
      });
      const summary = engine.extractSummary(result);
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
