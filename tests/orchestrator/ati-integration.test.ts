import { CompetencyProfiler, extractCategories, DispatchDifferentiator, PerformanceWriter } from '@gossip/orchestrator';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ATI v3 — full loop integration', () => {
  const testDir = join(tmpdir(), 'gossip-ati-integration-' + Date.now());
  let writer: PerformanceWriter;
  const differ = new DispatchDifferentiator();

  beforeAll(() => {
    mkdirSync(join(testDir, '.gossip'), { recursive: true });
    writer = new PerformanceWriter(testDir);
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
        writer.appendSignal({ type: 'consensus', signal: 'category_confirmed', agentId: 'agent-a', taskId: 'review-1', category: cat, evidence: f, timestamp: new Date().toISOString() });
      }
    }
    for (const f of findingsB) {
      for (const cat of extractCategories(f)) {
        writer.appendSignal({ type: 'consensus', signal: 'category_confirmed', agentId: 'agent-b', taskId: 'review-1', category: cat, evidence: f, timestamp: new Date().toISOString() });
      }
    }

    // 3. Read profiles — force fresh read
    const freshProfiler = new CompetencyProfiler(testDir);
    const profileA = freshProfiler.getProfile('agent-a');
    const profileB = freshProfiler.getProfile('agent-b');
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
    // Each agent should get focus on their strengths
    const promptA = diffMap.get('agent-a')!;
    const promptB = diffMap.get('agent-b')!;
    expect(promptA).toBeDefined();
    expect(promptB).toBeDefined();

    // 5. Privacy check — no peer names in prompts
    expect(promptA).not.toContain('agent-b');
    expect(promptB).not.toContain('agent-a');
  });

  test('impl signals update implPassRate', () => {
    // Add impl signals
    for (let i = 0; i < 3; i++) {
      writer.appendSignal({ type: 'impl', signal: 'impl_test_pass', agentId: 'agent-a', taskId: `impl-${i}`, timestamp: new Date().toISOString() });
    }
    writer.appendSignal({ type: 'impl', signal: 'impl_test_fail', agentId: 'agent-a', taskId: 'impl-3', timestamp: new Date().toISOString() });

    // Force cache refresh
    const freshProfiler = new CompetencyProfiler(testDir);
    const profile = freshProfiler.getProfile('agent-a');
    expect(profile!.implPassRate).toBeCloseTo(0.75, 1); // 3 pass / 4 total
  });

  test('meta signals update speed and iterations', () => {
    // Add tool turns signal
    writer.appendSignal({ type: 'meta', signal: 'task_tool_turns', agentId: 'agent-a', taskId: 'a-0', value: 8, timestamp: new Date().toISOString() });

    const freshProfiler = new CompetencyProfiler(testDir);
    const profile = freshProfiler.getProfile('agent-a');
    expect(profile!.implIterations).toBeGreaterThan(0);
    expect(profile!.speed).toBeGreaterThan(0);
  });

  test('profileMultiplier is clamped 0.5-1.5', () => {
    const freshProfiler = new CompetencyProfiler(testDir);
    const mult = freshProfiler.getProfileMultiplier('agent-a', 'review');
    expect(mult).toBeGreaterThanOrEqual(0.5);
    expect(mult).toBeLessThanOrEqual(1.5);
  });
});
