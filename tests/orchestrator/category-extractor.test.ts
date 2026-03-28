import { extractCategories, PerformanceWriter } from '@gossip/orchestrator';
import { mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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
        } as any);
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
