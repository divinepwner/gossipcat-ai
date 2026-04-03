import { MemorySearcher } from '@gossip/orchestrator';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const makeDir = () => join(tmpdir(), `gossip-searcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function setupAgent(testDir: string, agentId: string): { memDir: string; knowledgeDir: string } {
  const memDir = join(testDir, '.gossip', 'agents', agentId, 'memory');
  const knowledgeDir = join(memDir, 'knowledge');
  mkdirSync(knowledgeDir, { recursive: true });
  return { memDir, knowledgeDir };
}

describe('MemorySearcher', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns results sorted by relevance score descending', () => {
    const { knowledgeDir } = setupAgent(testDir, 'agent1');

    writeFileSync(join(knowledgeDir, 'relay.md'), [
      '---',
      'name: relay server',
      'description: relay server internals and connection handling',
      'importance: 0.8',
      'lastAccessed: 2026-03-21',
      'accessCount: 5',
      '---',
      '',
      'The relay server manages websocket connections.',
      'Each relay connection uses a unique frame ID.',
    ].join('\n'));

    writeFileSync(join(knowledgeDir, 'dispatch.md'), [
      '---',
      'name: dispatch pipeline',
      'description: task dispatch and agent selection',
      'importance: 0.6',
      'lastAccessed: 2026-03-20',
      'accessCount: 2',
      '---',
      '',
      'The dispatch pipeline routes tasks to agents.',
    ].join('\n'));

    const searcher = new MemorySearcher(testDir);
    const results = searcher.search('agent1', 'relay server connection');

    expect(results.length).toBeGreaterThan(0);
    // relay.md should rank higher — more keyword matches
    expect(results[0].name).toBe('relay server');
    // scores should be sorted descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('returns empty array for empty query', () => {
    setupAgent(testDir, 'agent1');
    const searcher = new MemorySearcher(testDir);
    expect(searcher.search('agent1', '')).toEqual([]);
    expect(searcher.search('agent1', '   ')).toEqual([]);
  });

  it('returns empty array for unknown agent', () => {
    const searcher = new MemorySearcher(testDir);
    expect(searcher.search('nonexistent-agent', 'relay connection')).toEqual([]);
  });

  it('snippets contain the matching keyword', () => {
    const { knowledgeDir } = setupAgent(testDir, 'agent1');

    writeFileSync(join(knowledgeDir, 'auth.md'), [
      '---',
      'name: authentication',
      'description: auth token validation',
      'importance: 0.7',
      'lastAccessed: 2026-03-21',
      'accessCount: 3',
      '---',
      '',
      'Token validation uses HMAC signatures.',
      'Invalid tokens are rejected immediately.',
      'Session cookies store the token after login.',
    ].join('\n'));

    const searcher = new MemorySearcher(testDir);
    const results = searcher.search('agent1', 'token validation');

    expect(results.length).toBeGreaterThan(0);
    const result = results[0];
    expect(result.snippets.length).toBeGreaterThan(0);
    // At least one snippet should contain "token" or "validation"
    const hasKeyword = result.snippets.some(s =>
      s.toLowerCase().includes('token') || s.toLowerCase().includes('valid')
    );
    expect(hasKeyword).toBe(true);
  });

  it('tasks.jsonl entries are searchable', () => {
    const { memDir } = setupAgent(testDir, 'agent1');

    const entries = [
      { taskId: 'task-1', task: 'Review the relay server authentication code', skills: ['security', 'relay'] },
      { taskId: 'task-2', task: 'Fix memory compaction bug in knowledge store', skills: ['memory', 'storage'] },
    ];

    writeFileSync(
      join(memDir, 'tasks.jsonl'),
      entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    );

    const searcher = new MemorySearcher(testDir);
    const results = searcher.search('agent1', 'memory compaction knowledge');

    expect(results.length).toBeGreaterThan(0);
    // The memory compaction task should be found
    const found = results.find(r => r.source === 'tasks.jsonl' && r.name === 'task-2');
    expect(found).toBeDefined();
  });

  it('respects max_results limit', () => {
    const { knowledgeDir } = setupAgent(testDir, 'agent1');

    // Create 5 files all matching the query
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(knowledgeDir, `file${i}.md`), [
        '---',
        `name: relay topic ${i}`,
        'description: relay server internals',
        `importance: ${0.5 + i * 0.1}`,
        'lastAccessed: 2026-03-21',
        'accessCount: 1',
        '---',
        '',
        'relay connection websocket frame',
      ].join('\n'));
    }

    const searcher = new MemorySearcher(testDir);
    const results = searcher.search('agent1', 'relay connection', 2);

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('max_results is capped at 10', () => {
    const { knowledgeDir } = setupAgent(testDir, 'agent1');

    for (let i = 0; i < 15; i++) {
      writeFileSync(join(knowledgeDir, `file${i}.md`), [
        '---',
        `name: relay topic ${i}`,
        'description: relay server connection internals',
        `importance: 0.5`,
        'lastAccessed: 2026-03-21',
        'accessCount: 1',
        '---',
        '',
        'relay connection frame',
      ].join('\n'));
    }

    const searcher = new MemorySearcher(testDir);
    // Pass 20, should be capped at 10
    const results = searcher.search('agent1', 'relay connection', 20);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('returns empty array when query has only short words', () => {
    setupAgent(testDir, 'agent1');
    const searcher = new MemorySearcher(testDir);
    // All words are <= 3 chars, extractKeywords returns []
    expect(searcher.search('agent1', 'the an or')).toEqual([]);
  });

  it('importance boosts score — higher importance ranks first', () => {
    const { knowledgeDir } = setupAgent(testDir, 'agent1');

    // Both files match "relay" once in description; higher importance should win
    writeFileSync(join(knowledgeDir, 'high.md'), [
      '---',
      'name: relay high',
      'description: relay internals',
      'importance: 0.9',
      'lastAccessed: 2026-03-21',
      'accessCount: 1',
      '---',
      '',
      'content here',
    ].join('\n'));

    writeFileSync(join(knowledgeDir, 'low.md'), [
      '---',
      'name: relay low',
      'description: relay internals',
      'importance: 0.1',
      'lastAccessed: 2026-03-21',
      'accessCount: 1',
      '---',
      '',
      'content here',
    ].join('\n'));

    const searcher = new MemorySearcher(testDir);
    const results = searcher.search('agent1', 'relay internals');

    expect(results.length).toBe(2);
    expect(results[0].name).toBe('relay high');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});
