import { describe, it, expect } from 'vitest';
import { ConsensusEngine } from '../../packages/orchestrator/src/consensus-engine';

describe('ConsensusEngine — category attribute parsing', () => {
  it('extracts category from <agent_finding> tag attribute', () => {
    const engine = new ConsensusEngine({} as any);
    const raw = `## Consensus Summary
<agent_finding type="finding" severity="high" category="injection_vectors">
SQL injection at db.ts:42
</agent_finding>`;
    const findings = (engine as any).parseAgentFindings('agent-x', raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('injection_vectors');
  });

  it('returns undefined category when attribute is absent', () => {
    const engine = new ConsensusEngine({} as any);
    const raw = `<agent_finding type="finding" severity="high">No category here at all</agent_finding>`;
    const findings = (engine as any).parseAgentFindings('agent-x', raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBeUndefined();
  });
});
