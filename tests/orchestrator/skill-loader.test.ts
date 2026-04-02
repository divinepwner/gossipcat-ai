import { loadSkills } from '@gossip/orchestrator';
import { listAvailableSkills } from '../../packages/orchestrator/src/skill-loader';
import { SkillIndex } from '../../packages/orchestrator/src/skill-index';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SkillLoader', () => {
  it('loads default skills by name', () => {
    const result = loadSkills('test-agent', ['typescript'], process.cwd());
    expect(result.content).toContain('TypeScript');
    expect(result.content).toContain('SKILLS');
    expect(result.loaded).toContain('typescript');
  });

  it('returns empty for no skills', () => {
    const result = loadSkills('test-agent', [], process.cwd());
    expect(result.content).toBe('');
    expect(result.loaded).toEqual([]);
  });

  it('returns empty for unknown skill', () => {
    const result = loadSkills('test-agent', ['nonexistent-skill-xyz'], process.cwd());
    expect(result.content).toBe('');
  });

  it('lists available default skills', () => {
    const skills = listAvailableSkills('test-agent', process.cwd());
    expect(skills).toContain('typescript');
    expect(skills).toContain('code-review');
    expect(skills).toContain('debugging');
  });

  it('wraps multiple skills with delimiters', () => {
    const result = loadSkills('test-agent', ['typescript'], process.cwd());
    expect(result.content).toMatch(/^[\s\S]*--- SKILLS ---[\s\S]*--- END SKILLS ---[\s\S]*$/);
  });

  it('resolves underscore skill names to hyphenated filenames', () => {
    const tmpDir = join(tmpdir(), `gossip-test-${Date.now()}`);
    const skillDir = join(tmpDir, '.gossip', 'skills');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'code-review.md'), '# Code Review Skill');

    try {
      const result = loadSkills('test-agent', ['code_review'], tmpDir);
      expect(result.content).toContain('Code Review Skill');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Contextual Skill Loading', () => {
  let tmpDir: string;
  let index: SkillIndex;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `gossip-ctx-${Date.now()}`);
    mkdirSync(join(tmpDir, '.gossip', 'agents', 'test-agent', 'skills'), { recursive: true });
    mkdirSync(join(tmpDir, '.gossip', 'skills'), { recursive: true });

    // Create a contextual skill with keywords
    writeFileSync(join(tmpDir, '.gossip', 'agents', 'test-agent', 'skills', 'trust-boundaries.md'),
`---
name: trust-boundary-validation
description: Trust boundary review
keywords: [auth, authentication, session, cookie, injection]
category: trust_boundaries
mode: contextual
status: active
---

## Iron Law
Never trust user input.
`);

    // Create a permanent skill
    writeFileSync(join(tmpDir, '.gossip', 'skills', 'typescript.md'),
`---
name: typescript
description: TypeScript patterns
keywords: []
mode: permanent
status: active
---

## TypeScript Guide
Use strict types.
`);

    index = new SkillIndex(tmpDir);
    index.bind('test-agent', 'typescript', { source: 'config', mode: 'permanent' });
    index.bind('test-agent', 'trust-boundaries', { source: 'auto', mode: 'contextual' });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('always loads permanent skills regardless of task', () => {
    const result = loadSkills('test-agent', [], tmpDir, index, 'fix a CSS bug');
    expect(result.loaded).toContain('typescript');
    expect(result.content).toContain('TypeScript');
  });

  it('activates contextual skill when task matches 2+ keywords', () => {
    const result = loadSkills('test-agent', [], tmpDir, index, 'Review the auth handler for session management');
    expect(result.loaded).toContain('trust-boundaries');
    expect(result.activatedContextual).toContain('trust-boundaries');
    expect(result.content).toContain('trust user input');
  });

  it('skips contextual skill when task matches fewer than 2 keywords', () => {
    const result = loadSkills('test-agent', [], tmpDir, index, 'Review the CSS layout');
    expect(result.loaded).not.toContain('trust-boundaries');
    expect(result.activatedContextual).toEqual([]);
  });

  it('skips contextual skill with single keyword hit', () => {
    // Only "auth" matches — needs 2+ hits
    const result = loadSkills('test-agent', [], tmpDir, index, 'Check the auth flow');
    expect(result.activatedContextual).toEqual([]);
  });

  it('uses word-boundary matching to prevent false positives', () => {
    // "auth" should NOT match "author"
    const result = loadSkills('test-agent', [], tmpDir, index, 'Check the author name and authentication');
    // "authentication" matches, "author" should NOT match "auth"
    // Only 1 hit (authentication) — below 2-hit minimum
    expect(result.activatedContextual).toEqual([]);
  });

  it('respects MAX_CONTEXTUAL_SKILLS budget', () => {
    // Add 4 more contextual skills
    for (const cat of ['injection-vectors', 'concurrency', 'error-handling', 'data-integrity']) {
      writeFileSync(join(tmpDir, '.gossip', 'agents', 'test-agent', 'skills', `${cat}.md`),
`---
name: ${cat}
description: ${cat} skill
keywords: [review, code, security, bug]
category: ${cat.replace(/-/g, '_')}
mode: contextual
status: active
---

## ${cat} guide
Check everything.
`);
      index.bind('test-agent', cat, { source: 'auto', mode: 'contextual' });
    }

    const result = loadSkills('test-agent', [], tmpDir, index, 'Review the code for security bugs');
    // All 4 new skills match (review + code + security + bug = 4 hits each)
    // Plus trust-boundaries doesn't match (no 2+ keyword hits for this task)
    // Budget: max 3 contextual
    expect(result.activatedContextual.length).toBeLessThanOrEqual(3);
    expect(result.dropped.length).toBeGreaterThan(0);
  });

  it('skips contextual skills when no task provided', () => {
    const result = loadSkills('test-agent', [], tmpDir, index);
    expect(result.loaded).toContain('typescript');
    expect(result.activatedContextual).toEqual([]);
  });
});
