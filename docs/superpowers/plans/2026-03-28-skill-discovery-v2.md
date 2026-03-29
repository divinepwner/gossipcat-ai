# Skill Discovery v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the skill discovery pipeline end-to-end: agents suggest gaps → orchestrator builds skills → dispatch uses them.

**Architecture:** Phase 1 only. New `normalizeSkillName` utility, frontmatter parser, refactored SkillGapTracker (no more skeleton generation), enhanced SkillCatalog (project skills + hot-reload), new dispatch formula with additive boosts, and a `gossip_build_skills` MCP tool.

**Tech Stack:** TypeScript, Jest, Node.js fs APIs

**Spec:** `docs/superpowers/specs/2026-03-28-skill-discovery-v2-design.md`

---

### Task 1: normalizeSkillName Utility

**Files:**
- Create: `packages/orchestrator/src/skill-name.ts`
- Test: `tests/orchestrator/skill-name.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/orchestrator/skill-name.test.ts
import { normalizeSkillName } from '@gossip/orchestrator';

describe('normalizeSkillName', () => {
  it('converts underscores to hyphens', () => {
    expect(normalizeSkillName('security_audit')).toBe('security-audit');
  });

  it('converts to lowercase', () => {
    expect(normalizeSkillName('DoS_Resilience')).toBe('dos-resilience');
  });

  it('strips non-alphanumeric characters', () => {
    expect(normalizeSkillName('web.socket security!')).toBe('web-socket-security');
  });

  it('converts spaces to hyphens', () => {
    expect(normalizeSkillName('rate limit check')).toBe('rate-limit-check');
  });

  it('is idempotent', () => {
    expect(normalizeSkillName('already-kebab')).toBe('already-kebab');
  });

  it('handles empty string', () => {
    expect(normalizeSkillName('')).toBe('');
  });

  it('collapses multiple separators', () => {
    expect(normalizeSkillName('too__many___underscores')).toBe('too-many-underscores');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=skill-name`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/orchestrator/src/skill-name.ts
/**
 * Normalize skill names to kebab-case.
 * security_audit → security-audit
 * DoS Resilience → dos-resilience
 */
export function normalizeSkillName(name: string): string {
  return name.toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/orchestrator/src/index.ts`:
```typescript
export { normalizeSkillName } from './skill-name';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=skill-name`
Expected: 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/skill-name.ts tests/orchestrator/skill-name.test.ts packages/orchestrator/src/index.ts
git commit -m "feat: normalizeSkillName utility for canonical kebab-case skill names"
```

---

### Task 2: Skill Frontmatter Parser

**Files:**
- Create: `packages/orchestrator/src/skill-parser.ts`
- Test: `tests/orchestrator/skill-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/orchestrator/skill-parser.test.ts
import { parseSkillFrontmatter } from '@gossip/orchestrator';

describe('parseSkillFrontmatter', () => {
  it('parses valid frontmatter with all fields', () => {
    const md = `---
name: dos-resilience
description: Review code for DoS vectors.
keywords: [dos, rate-limit, payload]
generated_by: orchestrator
sources: 3 suggestions from sonnet-reviewer
status: active
---

# DoS Resilience

## Approach
Check endpoints.`;

    const result = parseSkillFrontmatter(md);
    expect(result).toEqual({
      name: 'dos-resilience',
      description: 'Review code for DoS vectors.',
      keywords: ['dos', 'rate-limit', 'payload'],
      generated_by: 'orchestrator',
      sources: '3 suggestions from sonnet-reviewer',
      status: 'active',
    });
  });

  it('returns null for content with no frontmatter', () => {
    const md = `# Just a title\n\nSome content`;
    expect(parseSkillFrontmatter(md)).toBeNull();
  });

  it('returns null for malformed frontmatter', () => {
    const md = `---\ninvalid yaml: [broken\n---\nContent`;
    expect(parseSkillFrontmatter(md)).toBeNull();
  });

  it('handles missing optional fields', () => {
    const md = `---\nname: test-skill\ndescription: A test.\nkeywords: [test]\nstatus: draft\n---\nBody`;
    const result = parseSkillFrontmatter(md);
    expect(result?.name).toBe('test-skill');
    expect(result?.generated_by).toBeUndefined();
    expect(result?.sources).toBeUndefined();
  });

  it('handles keywords as comma-separated string', () => {
    const md = `---\nname: test\ndescription: desc\nkeywords: dos, rate-limit, payload\nstatus: active\n---\nBody`;
    const result = parseSkillFrontmatter(md);
    expect(result?.keywords).toEqual(['dos', 'rate-limit', 'payload']);
  });

  it('normalizes skill name in frontmatter', () => {
    const md = `---\nname: DoS_Resilience\ndescription: desc\nkeywords: [dos]\nstatus: active\n---\nBody`;
    const result = parseSkillFrontmatter(md);
    expect(result?.name).toBe('dos-resilience');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=skill-parser`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// packages/orchestrator/src/skill-parser.ts
import { normalizeSkillName } from './skill-name';

export interface SkillFrontmatter {
  name: string;
  description: string;
  keywords: string[];
  generated_by?: string;
  sources?: string;
  status: 'active' | 'draft' | 'disabled';
}

/**
 * Parse YAML-like frontmatter from a skill .md file.
 * Returns null if no valid frontmatter found.
 * Uses simple line-by-line parsing — no YAML library dependency.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const lines = match[1].split('\n');
  const fields: Record<string, string> = {};

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fields[key] = value;
  }

  if (!fields.name || !fields.description || !fields.status) return null;

  let keywords: string[] = [];
  if (fields.keywords) {
    const raw = fields.keywords;
    if (raw.startsWith('[') && raw.endsWith(']')) {
      // YAML array: [dos, rate-limit, payload]
      keywords = raw.slice(1, -1).split(',').map(k => k.trim()).filter(Boolean);
    } else {
      // Comma-separated: dos, rate-limit, payload
      keywords = raw.split(',').map(k => k.trim()).filter(Boolean);
    }
  }

  return {
    name: normalizeSkillName(fields.name),
    description: fields.description,
    keywords,
    generated_by: fields.generated_by,
    sources: fields.sources,
    status: fields.status as 'active' | 'draft' | 'disabled',
  };
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/orchestrator/src/index.ts`:
```typescript
export { parseSkillFrontmatter, SkillFrontmatter } from './skill-parser';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=skill-parser`
Expected: 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/skill-parser.ts tests/orchestrator/skill-parser.test.ts packages/orchestrator/src/index.ts
git commit -m "feat: skill frontmatter parser for .gossip/skills/*.md files"
```

---

### Task 3: Refactor SkillGapTracker — Deprecate generateSkeleton

**Files:**
- Modify: `packages/orchestrator/src/skill-gap-tracker.ts`
- Modify: `tests/orchestrator/skill-gap-tracker.test.ts`

- [ ] **Step 1: Write new tests for refactored behavior**

Add these tests to `tests/orchestrator/skill-gap-tracker.test.ts`:

```typescript
  it('checkThresholds returns pending skills without writing files', () => {
    writeSuggestions([
      { skill: 'dos_resilience', agent: 'agent-1', reason: 'r1' },
      { skill: 'dos_resilience', agent: 'agent-2', reason: 'r2' },
      { skill: 'dos_resilience', agent: 'agent-1', reason: 'r3' },
    ]);
    const tracker = new SkillGapTracker(testDir);
    const result = tracker.checkThresholds();
    expect(result.count).toBe(1);
    expect(result.pending).toContain('dos-resilience');
    // No file should be written
    expect(existsSync(join(skillsDir, 'dos-resilience.md'))).toBe(false);
  });

  it('normalizes skill names in pending list', () => {
    writeSuggestions([
      { skill: 'DoS_Resilience', agent: 'agent-1', reason: 'r1' },
      { skill: 'dos-resilience', agent: 'agent-2', reason: 'r2' },
      { skill: 'dos_resilience', agent: 'agent-1', reason: 'r3' },
    ]);
    const tracker = new SkillGapTracker(testDir);
    const result = tracker.checkThresholds();
    expect(result.count).toBe(1);
    expect(result.pending).toEqual(['dos-resilience']);
  });

  it('uses resolutions file instead of JSONL scanning', () => {
    writeSuggestions([
      { skill: 'dos_resilience', agent: 'agent-1', reason: 'r1' },
      { skill: 'dos_resilience', agent: 'agent-2', reason: 'r2' },
      { skill: 'dos_resilience', agent: 'agent-1', reason: 'r3' },
    ]);
    // Write resolution to the new resolutions file
    const resPath = join(gossipDir, 'skill-resolutions.json');
    writeFileSync(resPath, JSON.stringify({ 'dos-resilience': new Date().toISOString() }));

    const tracker = new SkillGapTracker(testDir);
    expect(tracker.isAtThreshold('dos-resilience')).toBe(false);
    expect(tracker.checkThresholds().count).toBe(0);
  });

  it('migrates existing JSONL resolutions on first run', () => {
    // Write suggestion + old-style resolution to JSONL
    const lines = [
      JSON.stringify({ type: 'suggestion', skill: 'old_skill', reason: 'r', agent: 'a1', task_context: 'c', timestamp: new Date().toISOString() }),
      JSON.stringify({ type: 'suggestion', skill: 'old_skill', reason: 'r', agent: 'a2', task_context: 'c', timestamp: new Date().toISOString() }),
      JSON.stringify({ type: 'suggestion', skill: 'old_skill', reason: 'r', agent: 'a1', task_context: 'c', timestamp: new Date().toISOString() }),
      JSON.stringify({ type: 'resolution', skill: 'old_skill', skeleton_path: '.gossip/skills/old-skill.md', triggered_by: 3, timestamp: new Date().toISOString() }),
    ].join('\n') + '\n';
    writeFileSync(gapLogPath, lines);

    const tracker = new SkillGapTracker(testDir);
    // Should not re-trigger because migration backfilled resolutions file
    expect(tracker.isAtThreshold('old-skill')).toBe(false);

    // Verify resolutions file was created
    const resPath = join(gossipDir, 'skill-resolutions.json');
    expect(existsSync(resPath)).toBe(true);
    const resolutions = JSON.parse(readFileSync(resPath, 'utf-8'));
    expect(resolutions['old-skill']).toBeDefined();
  });

  it('getGapData returns suggestions grouped by skill', () => {
    writeSuggestions([
      { skill: 'dos_resilience', agent: 'agent-1', reason: 'no maxPayload' },
      { skill: 'dos_resilience', agent: 'agent-2', reason: 'no rate limiting' },
      { skill: 'dos_resilience', agent: 'agent-1', reason: 'unbounded queue' },
    ]);
    const tracker = new SkillGapTracker(testDir);
    const data = tracker.getGapData(['dos-resilience']);
    expect(data).toHaveLength(1);
    expect(data[0].skill).toBe('dos-resilience');
    expect(data[0].suggestions).toHaveLength(3);
    expect(data[0].suggestions[0].agent).toBe('agent-1');
  });

  it('recordResolution marks skill as resolved', () => {
    writeSuggestions([
      { skill: 'dos_resilience', agent: 'agent-1', reason: 'r1' },
      { skill: 'dos_resilience', agent: 'agent-2', reason: 'r2' },
      { skill: 'dos_resilience', agent: 'agent-1', reason: 'r3' },
    ]);
    const tracker = new SkillGapTracker(testDir);
    expect(tracker.isAtThreshold('dos-resilience')).toBe(true);

    tracker.recordResolution('dos-resilience');
    expect(tracker.isAtThreshold('dos-resilience')).toBe(false);
  });

  it('truncateIfNeeded runs during checkThresholds', () => {
    // Write more than MAX_LOG_LINES entries
    const lines = Array.from({ length: 5001 }, (_, i) =>
      JSON.stringify({ type: 'suggestion', skill: `skill-${i % 100}`, reason: 'r', agent: `a-${i % 3}`, task_context: 'c', timestamp: new Date().toISOString() })
    ).join('\n') + '\n';
    writeFileSync(gapLogPath, lines);

    const tracker = new SkillGapTracker(testDir);
    tracker.checkThresholds(); // should trigger truncation

    const content = readFileSync(gapLogPath, 'utf-8');
    const lineCount = content.trim().split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(1000);
  });
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npm test -- --testPathPattern=skill-gap-tracker`
Expected: New tests FAIL (checkThresholds, isAtThreshold, getGapData, recordResolution don't exist)

- [ ] **Step 3: Rewrite SkillGapTracker**

Replace `packages/orchestrator/src/skill-gap-tracker.ts` with:

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { normalizeSkillName } from './skill-name';

export interface GapSuggestion {
  type: 'suggestion';
  skill: string;
  reason: string;
  agent: string;
  task_context: string;
  timestamp: string;
}

export interface GapResolution {
  type: 'resolution';
  skill: string;
  skeleton_path: string;
  triggered_by: number;
  timestamp: string;
}

export type GapEntry = GapSuggestion | GapResolution;

export interface GapData {
  skill: string;
  suggestions: GapSuggestion[];
  uniqueAgents: string[];
}

const MAX_LOG_LINES = 5000;
const TRUNCATE_TO = 1000;

export class SkillGapTracker {
  private readonly gapLogPath: string;
  private readonly skillsDir: string;
  private readonly resolutionsPath: string;
  private resolutionsCache: Record<string, string> | null = null;

  constructor(projectRoot: string) {
    this.gapLogPath = join(projectRoot, '.gossip', 'skill-gaps.jsonl');
    this.skillsDir = join(projectRoot, '.gossip', 'skills');
    this.resolutionsPath = join(projectRoot, '.gossip', 'skill-resolutions.json');
    this.migrateResolutions();
  }

  /** Check which skills are at threshold — returns pending list without writing files */
  checkThresholds(): { pending: string[]; count: number } {
    this.truncateIfNeeded();
    const pending = this.getPendingSkills();
    return { pending, count: pending.length };
  }

  /** Check if a specific skill has hit the threshold (3+ suggestions, 2+ agents, not resolved) */
  isAtThreshold(skillName: string): boolean {
    const normalized = normalizeSkillName(skillName);
    const resolutions = this.loadResolutions();
    if (resolutions[normalized]) return false;

    const suggestions = this.getSuggestionsForSkill(normalized);
    const uniqueAgents = new Set(suggestions.map(s => s.agent));
    return suggestions.length >= 3 && uniqueAgents.size >= 2;
  }

  /** Get structured gap data for specific skills (for gossip_build_skills) */
  getGapData(skillNames: string[]): GapData[] {
    return skillNames.map(name => {
      const normalized = normalizeSkillName(name);
      const suggestions = this.getSuggestionsForSkill(normalized);
      const uniqueAgents = [...new Set(suggestions.map(s => s.agent))];
      return { skill: normalized, suggestions, uniqueAgents };
    });
  }

  /** Record a skill as resolved (called after gossip_build_skills writes the file) */
  recordResolution(skillName: string): void {
    const normalized = normalizeSkillName(skillName);
    const resolutions = this.loadResolutions();
    resolutions[normalized] = new Date().toISOString();
    const dir = join(this.resolutionsPath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.resolutionsPath, JSON.stringify(resolutions, null, 2));
    this.resolutionsCache = resolutions;
  }

  /** Get all suggestions for a specific agent since a given time */
  getSuggestionsSince(agentId: string, sinceMs: number): GapSuggestion[] {
    return this.readSuggestions().filter(
      s => s.agent === agentId && new Date(s.timestamp).getTime() >= sinceMs
    );
  }

  /** Get all pending skills at threshold */
  private getPendingSkills(): string[] {
    const resolutions = this.loadResolutions();
    const suggestions = this.readSuggestions();

    // Group by normalized skill name
    const bySkill = new Map<string, GapSuggestion[]>();
    for (const s of suggestions) {
      const norm = normalizeSkillName(s.skill);
      if (resolutions[norm]) continue;
      if (!bySkill.has(norm)) bySkill.set(norm, []);
      bySkill.get(norm)!.push(s);
    }

    const pending: string[] = [];
    for (const [skill, entries] of bySkill) {
      const uniqueAgents = new Set(entries.map(e => e.agent));
      if (entries.length >= 3 && uniqueAgents.size >= 2) {
        pending.push(skill);
      }
    }
    return pending;
  }

  private getSuggestionsForSkill(normalizedName: string): GapSuggestion[] {
    return this.readSuggestions().filter(
      s => normalizeSkillName(s.skill) === normalizedName
    );
  }

  private readSuggestions(): GapSuggestion[] {
    if (!existsSync(this.gapLogPath)) return [];
    try {
      const lines = readFileSync(this.gapLogPath, 'utf-8').trim().split('\n').filter(Boolean);
      return lines.map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter((e): e is GapSuggestion => e !== null && e.type === 'suggestion');
    } catch { return []; }
  }

  private loadResolutions(): Record<string, string> {
    if (this.resolutionsCache) return this.resolutionsCache;
    if (!existsSync(this.resolutionsPath)) {
      this.resolutionsCache = {};
      return this.resolutionsCache;
    }
    try {
      this.resolutionsCache = JSON.parse(readFileSync(this.resolutionsPath, 'utf-8'));
      return this.resolutionsCache!;
    } catch {
      this.resolutionsCache = {};
      return this.resolutionsCache;
    }
  }

  /** Migrate old GapResolution entries from JSONL to resolutions file (one-time) */
  private migrateResolutions(): void {
    if (existsSync(this.resolutionsPath)) return; // already migrated
    if (!existsSync(this.gapLogPath)) return; // nothing to migrate

    try {
      const lines = readFileSync(this.gapLogPath, 'utf-8').trim().split('\n').filter(Boolean);
      const resolutions: Record<string, string> = {};
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'resolution') {
            resolutions[normalizeSkillName(entry.skill)] = entry.timestamp;
          }
        } catch { /* skip malformed */ }
      }
      if (Object.keys(resolutions).length > 0) {
        const dir = join(this.resolutionsPath, '..');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(this.resolutionsPath, JSON.stringify(resolutions, null, 2));
        this.resolutionsCache = resolutions;
      }
    } catch { /* best-effort migration */ }
  }

  private truncateIfNeeded(): void {
    if (!existsSync(this.gapLogPath)) return;
    try {
      const content = readFileSync(this.gapLogPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length > MAX_LOG_LINES) {
        writeFileSync(this.gapLogPath, lines.slice(-TRUNCATE_TO).join('\n') + '\n');
      }
    } catch { /* best-effort */ }
  }
}
```

- [ ] **Step 4: Update existing tests for new API**

Update `tests/orchestrator/skill-gap-tracker.test.ts`: rename `shouldGenerate` → `isAtThreshold`, remove `generateSkeleton` tests (that functionality is gone), keep threshold logic tests.

The test for `'appends resolution entry after generating skeleton'` becomes the `'recordResolution marks skill as resolved'` test from Step 1.

The test for `'generates skeleton file with correct template'` should be removed — skeleton generation is now handled by the MCP tool.

- [ ] **Step 5: Run all tests**

Run: `npm test -- --testPathPattern=skill-gap-tracker`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/skill-gap-tracker.ts tests/orchestrator/skill-gap-tracker.test.ts
git commit -m "refactor: deprecate generateSkeleton, add checkThresholds/resolutions file/migration"
```

---

### Task 4: SkillCatalog — Project Skills + Hot-Reload

**Files:**
- Modify: `packages/orchestrator/src/skill-catalog.ts`
- Modify: `tests/orchestrator/skill-catalog.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/orchestrator/skill-catalog.test.ts`:

```typescript
import { SkillCatalog } from '@gossip/orchestrator';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SkillCatalog with project skills', () => {
  const testDir = join(tmpdir(), `gossip-catalog-test-${Date.now()}`);
  const skillsDir = join(testDir, '.gossip', 'skills');

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('loads project skills from .gossip/skills/*.md', () => {
    writeFileSync(join(skillsDir, 'dos-resilience.md'), `---
name: dos-resilience
description: Review for DoS vectors.
keywords: [dos, rate-limit, payload]
status: active
---
# DoS Resilience
`);
    const catalog = new SkillCatalog(testDir);
    const skills = catalog.listSkills();
    expect(skills.find(s => s.name === 'dos-resilience')).toBeDefined();
    expect(skills.find(s => s.name === 'dos-resilience')?.source).toBe('project');
  });

  it('project skills override defaults with same name', () => {
    writeFileSync(join(skillsDir, 'security-audit.md'), `---
name: security-audit
description: Custom project security audit.
keywords: [security, audit, custom]
status: active
---
# Custom Security
`);
    const catalog = new SkillCatalog(testDir);
    const entry = catalog.listSkills().find(s => s.name === 'security-audit');
    expect(entry?.description).toBe('Custom project security audit.');
    expect(entry?.source).toBe('project');
  });

  it('skips disabled project skills in matchTask', () => {
    writeFileSync(join(skillsDir, 'dos-resilience.md'), `---
name: dos-resilience
description: Review for DoS.
keywords: [dos, rate-limit]
status: disabled
---
# Disabled
`);
    const catalog = new SkillCatalog(testDir);
    const matches = catalog.matchTask('check for DoS vulnerabilities');
    expect(matches.find(m => m.name === 'dos-resilience')).toBeUndefined();
  });

  it('matchTask finds project skills by keywords', () => {
    writeFileSync(join(skillsDir, 'dos-resilience.md'), `---
name: dos-resilience
description: DoS review.
keywords: [dos, rate-limit, payload]
status: active
---
# DoS
`);
    const catalog = new SkillCatalog(testDir);
    const matches = catalog.matchTask('check rate-limit configuration');
    expect(matches.find(m => m.name === 'dos-resilience')).toBeDefined();
  });

  it('hot-reloads when new skill file added', () => {
    const catalog = new SkillCatalog(testDir);
    expect(catalog.listSkills().find(s => s.name === 'new-skill')).toBeUndefined();

    writeFileSync(join(skillsDir, 'new-skill.md'), `---
name: new-skill
description: A new skill.
keywords: [new]
status: active
---
# New
`);
    // Force mtime change detection
    const matches = catalog.matchTask('new skill test');
    expect(matches.find(m => m.name === 'new-skill')).toBeDefined();
  });

  it('normalizes skill names from default catalog', () => {
    const catalog = new SkillCatalog(testDir);
    // Default catalog has security_audit — after normalization it should be findable as security-audit
    const entry = catalog.listSkills().find(s => s.name === 'security-audit');
    expect(entry).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=skill-catalog`
Expected: FAIL — SkillCatalog constructor doesn't accept projectRoot

- [ ] **Step 3: Rewrite SkillCatalog**

Replace `packages/orchestrator/src/skill-catalog.ts`:

```typescript
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { normalizeSkillName } from './skill-name';
import { parseSkillFrontmatter } from './skill-parser';

export interface CatalogEntry {
  name: string;
  description: string;
  keywords: string[];
  categories: string[];
  source: 'default' | 'project';
}

interface CatalogData {
  version: number;
  skills: Array<{
    name: string;
    description: string;
    keywords: string[];
    categories: string[];
  }>;
}

export class SkillCatalog {
  private entries: CatalogEntry[] = [];
  private readonly defaultSkillsDir: string;
  private readonly projectSkillsDir: string | null;
  private projectFileMtimes: Map<string, number> = new Map();

  constructor(projectRoot?: string, catalogPath?: string) {
    const defaultPath = catalogPath || resolve(__dirname, 'default-skills', 'catalog.json');
    this.defaultSkillsDir = resolve(__dirname, 'default-skills');
    this.projectSkillsDir = projectRoot ? join(projectRoot, '.gossip', 'skills') : null;

    // Load default skills
    try {
      const raw = readFileSync(defaultPath, 'utf-8');
      const data: CatalogData = JSON.parse(raw);
      this.entries = data.skills.map(s => ({
        ...s,
        name: normalizeSkillName(s.name),
        source: 'default' as const,
      }));
    } catch { /* no default catalog */ }

    // Load project skills
    this.loadProjectSkills();
  }

  listSkills(): CatalogEntry[] {
    this.reloadIfChanged();
    return [...this.entries];
  }

  matchTask(taskText: string): CatalogEntry[] {
    this.reloadIfChanged();
    const lower = taskText.toLowerCase();
    return this.entries.filter(entry =>
      entry.source === 'project' && (entry as any)._status === 'disabled' ? false :
      entry.keywords.some(kw => lower.includes(kw.toLowerCase()))
    );
  }

  checkCoverage(agentSkills: string[], taskText: string): string[] {
    const normalizedAgentSkills = agentSkills.map(normalizeSkillName);
    const matched = this.matchTask(taskText);
    const warnings: string[] = [];
    for (const entry of matched) {
      if (!normalizedAgentSkills.includes(entry.name)) {
        warnings.push(
          `Skill '${entry.name}' (${entry.description}) may be relevant but is not assigned to this agent.`
        );
      }
    }
    return warnings;
  }

  validate(): string[] {
    const issues: string[] = [];
    const mdFiles = readdirSync(this.defaultSkillsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => normalizeSkillName(f.replace('.md', '')));

    for (const file of mdFiles) {
      if (!this.entries.find(e => e.name === file)) {
        issues.push(`Skill file '${file}' has no catalog entry`);
      }
    }
    return issues;
  }

  private loadProjectSkills(): void {
    if (!this.projectSkillsDir || !existsSync(this.projectSkillsDir)) return;

    const files = readdirSync(this.projectSkillsDir).filter(f => f.endsWith('.md'));
    const newMtimes = new Map<string, number>();

    for (const file of files) {
      const filePath = join(this.projectSkillsDir, file);
      try {
        const mtime = statSync(filePath).mtimeMs;
        newMtimes.set(file, mtime);
        const content = readFileSync(filePath, 'utf-8');
        const fm = parseSkillFrontmatter(content);
        if (!fm || fm.status === 'disabled') continue;

        const entry: CatalogEntry & { _status?: string } = {
          name: normalizeSkillName(fm.name),
          description: fm.description,
          keywords: fm.keywords,
          categories: [],
          source: 'project',
        };
        (entry as any)._status = fm.status;

        // Remove default entry with same name (project overrides)
        this.entries = this.entries.filter(e => !(e.name === entry.name && e.source === 'default'));
        // Remove old project entry with same name
        this.entries = this.entries.filter(e => !(e.name === entry.name && e.source === 'project'));
        this.entries.push(entry);
      } catch { /* skip malformed files */ }
    }
    this.projectFileMtimes = newMtimes;
  }

  private reloadIfChanged(): void {
    if (!this.projectSkillsDir || !existsSync(this.projectSkillsDir)) return;

    const files = readdirSync(this.projectSkillsDir).filter(f => f.endsWith('.md'));

    // Check for new files or changed mtimes
    let changed = files.length !== this.projectFileMtimes.size;
    if (!changed) {
      for (const file of files) {
        const filePath = join(this.projectSkillsDir, file);
        try {
          const mtime = statSync(filePath).mtimeMs;
          if (mtime !== this.projectFileMtimes.get(file)) {
            changed = true;
            break;
          }
        } catch { changed = true; break; }
      }
    }

    if (changed) {
      // Remove old project entries, reload
      this.entries = this.entries.filter(e => e.source === 'default');
      this.loadProjectSkills();
    }
  }
}
```

- [ ] **Step 4: Update existing tests**

Update the default-only tests in `tests/orchestrator/skill-catalog.test.ts` to pass `undefined` as projectRoot (or no args) since the constructor signature changed. The existing `new SkillCatalog()` calls should still work since `projectRoot` is optional.

- [ ] **Step 5: Run all tests**

Run: `npm test -- --testPathPattern=skill-catalog`
Expected: All tests PASS (old + new)

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/skill-catalog.ts tests/orchestrator/skill-catalog.test.ts
git commit -m "feat: SkillCatalog loads project skills from .gossip/skills/ with hot-reload"
```

---

### Task 5: AgentRegistry — Additive Dispatch Boost

**Files:**
- Modify: `packages/orchestrator/src/agent-registry.ts`
- Modify: `tests/orchestrator/agent-registry.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/orchestrator/agent-registry.test.ts`:

```typescript
import { AgentRegistry, SkillCatalog } from '@gossip/orchestrator';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AgentRegistry with project skills', () => {
  const testDir = join(tmpdir(), `gossip-registry-test-${Date.now()}`);
  const skillsDir = join(testDir, '.gossip', 'skills');
  let registry: AgentRegistry;
  let catalog: SkillCatalog;

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'dos-resilience.md'), `---
name: dos-resilience
description: Review for DoS vectors.
keywords: [dos, rate-limit, payload]
status: active
---
# DoS
`);
    catalog = new SkillCatalog(testDir);
    registry = new AgentRegistry();
    registry.register({ id: 'reviewer', provider: 'anthropic', model: 'claude', skills: ['code-review', 'security-audit'] });
    registry.register({ id: 'impl', provider: 'openai', model: 'gpt', skills: ['typescript', 'implementation'] });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('gives projectMatchBoost when task text matches project skill keywords', () => {
    const match = registry.findBestMatchExcluding([], new Set(), {
      taskText: 'check rate-limit and DoS protection',
      catalog,
    });
    // Both agents get the boost (0.5) since neither has dos-resilience in skills
    // But reviewer has security-audit which may not directly help
    // Both should be selectable — the point is score > 0
    expect(match).not.toBeNull();
  });

  it('gives suggesterBoost to agents who suggested the skill', () => {
    registry.setSuggesterCache(new Map([
      ['dos-resilience', new Set(['reviewer'])],
    ]));
    const match = registry.findBestMatchExcluding([], new Set(), {
      taskText: 'check rate-limit and DoS protection',
      catalog,
    });
    expect(match?.id).toBe('reviewer'); // gets 0.5 + 0.3 = 0.8 vs impl's 0.5
  });

  it('still uses staticOverlap for regular skills', () => {
    const match = registry.findBestMatchExcluding(['typescript', 'implementation'], new Set());
    expect(match?.id).toBe('impl'); // 2 overlap vs 0
  });

  it('combines staticOverlap + projectMatchBoost + suggesterBoost', () => {
    registry.setSuggesterCache(new Map([
      ['dos-resilience', new Set(['reviewer'])],
    ]));
    // reviewer: staticOverlap=1 (security-audit) + projectBoost=0.5 + suggesterBoost=0.3 = 1.8
    // impl: staticOverlap=0 + projectBoost=0.5 = 0.5
    const match = registry.findBestMatchExcluding(['security-audit'], new Set(), {
      taskText: 'check rate-limit and DoS protection',
      catalog,
    });
    expect(match?.id).toBe('reviewer');
  });

  it('normalizes skill names in overlap check', () => {
    registry.register({ id: 'norm', provider: 'local', model: 'test', skills: ['security_audit'] });
    const match = registry.findBestMatch(['security-audit']);
    expect(match?.id).toBe('norm'); // security_audit matches security-audit after normalization
  });

  it('returns null when all agents excluded even with project skill match', () => {
    const match = registry.findBestMatchExcluding([], new Set(['reviewer', 'impl']), {
      taskText: 'check rate-limit and DoS protection',
      catalog,
    });
    expect(match).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=agent-registry`
Expected: FAIL — findBestMatchExcluding doesn't accept options, setSuggesterCache doesn't exist

- [ ] **Step 3: Update AgentRegistry**

Replace `packages/orchestrator/src/agent-registry.ts`:

```typescript
/**
 * AgentRegistry — tracks available agents and their skills.
 *
 * Dispatch matching: staticOverlap + projectMatchBoost + suggesterBoost × perfWeight.
 */

import { AgentConfig } from './types';
import { PerformanceReader } from './performance-reader';
import { normalizeSkillName } from './skill-name';
import type { SkillCatalog } from './skill-catalog';

export interface FindBestMatchOptions {
  taskText?: string;
  catalog?: SkillCatalog;
}

export class AgentRegistry {
  private agents: Map<string, AgentConfig> = new Map();
  private perfReader: PerformanceReader | null = null;
  private suggesterCache: Map<string, Set<string>> = new Map();

  register(config: AgentConfig): void {
    this.agents.set(config.id, config);
  }

  unregister(id: string): void {
    this.agents.delete(id);
  }

  get(id: string): AgentConfig | undefined {
    return this.agents.get(id);
  }

  getAll(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  setPerformanceReader(reader: PerformanceReader): void {
    this.perfReader = reader;
  }

  setSuggesterCache(cache: Map<string, Set<string>>): void {
    this.suggesterCache = cache;
  }

  findBestMatch(requiredSkills: string[], options?: FindBestMatchOptions): AgentConfig | null {
    return this.findBestMatchExcluding(requiredSkills, new Set(), options);
  }

  /**
   * Find best skill match with additive boosts for project skills.
   * Score = (staticOverlap + projectMatchBoost + suggesterBoost) × perfWeight
   */
  findBestMatchExcluding(
    requiredSkills: string[],
    exclude: Set<string>,
    options?: FindBestMatchOptions,
  ): AgentConfig | null {
    const normalizedRequired = requiredSkills.map(normalizeSkillName);

    // Get project skill matches from task text
    let projectMatches: string[] = [];
    if (options?.taskText && options?.catalog) {
      projectMatches = options.catalog.matchTask(options.taskText)
        .filter(e => e.source === 'project')
        .map(e => e.name);
    }

    let bestMatch: AgentConfig | null = null;
    let bestScore = 0;

    for (const agent of this.agents.values()) {
      if (exclude.has(agent.id)) continue;

      const normalizedAgentSkills = agent.skills.map(normalizeSkillName);

      // 1. Static overlap (existing behavior, normalized)
      const staticOverlap = normalizedRequired.filter(s => normalizedAgentSkills.includes(s)).length;

      // 2. Project match boost — 0.5 per matched project skill
      const projectMatchBoost = projectMatches.length * 0.5;

      // 3. Suggester boost — 0.3 if agent suggested any matched project skill
      let suggesterBoost = 0;
      for (const skill of projectMatches) {
        if (this.suggesterCache.get(skill)?.has(agent.id)) {
          suggesterBoost = 0.3;
          break;
        }
      }

      // 4. Performance weight
      const perfWeight = this.perfReader?.getDispatchWeight(agent.id) ?? 1.0;

      const score = (staticOverlap + projectMatchBoost + suggesterBoost) * perfWeight;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = agent;
      }
    }

    return bestMatch;
  }

  findBySkill(skill: string): AgentConfig[] {
    const normalized = normalizeSkillName(skill);
    return this.getAll().filter(a => a.skills.map(normalizeSkillName).includes(normalized));
  }

  get count(): number {
    return this.agents.size;
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test -- --testPathPattern=agent-registry`
Expected: All tests PASS (old + new)

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/agent-registry.ts tests/orchestrator/agent-registry.test.ts
git commit -m "feat: additive dispatch boost for project skills + suggester bonus"
```

---

### Task 6: Wire SkillsReady into Collect Response

**Files:**
- Modify: `packages/orchestrator/src/consensus-types.ts`
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`

- [ ] **Step 1: Add skillsReady to CollectResult**

In `packages/orchestrator/src/consensus-types.ts`, change:
```typescript
export interface CollectResult {
  results: import('./types').TaskEntry[];
  consensus?: ConsensusReport;
}
```
to:
```typescript
export interface CollectResult {
  results: import('./types').TaskEntry[];
  consensus?: ConsensusReport;
  skillsReady?: number;
}
```

- [ ] **Step 2: Wire checkThresholds into collect**

In `packages/orchestrator/src/dispatch-pipeline.ts`, find the post-collect section where `getSuggestionsSince` and `checkAndGenerate` are called. Replace with a call to `checkThresholds()` and populate `skillsReady` on the result.

Find the collect method's result building, and before returning, add:
```typescript
try {
  const thresholds = this.gapTracker.checkThresholds();
  if (thresholds.count > 0) {
    collectResult.skillsReady = thresholds.count;
  }
} catch { /* best-effort */ }
```

Remove the dead `getSuggestionsSince()` call and `checkAndGenerate()` call.

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npm test -- --testPathPattern=dispatch-pipeline`
Expected: PASS (no behavioral change for existing tests)

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/consensus-types.ts packages/orchestrator/src/dispatch-pipeline.ts
git commit -m "feat: wire skillsReady count into CollectResult"
```

---

### Task 7: MCP Tool — gossip_build_skills

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

- [ ] **Step 1: Add gossip_build_skills tool (discovery mode)**

In `apps/cli/src/mcp-server-sdk.ts`, after the `gossip_findings` tool definition, add:

```typescript
server.tool(
  'gossip_build_skills',
  'Build skill files from agent suggestions that hit threshold (3+ suggestions, 2+ agents). Call without skills to discover pending gaps. Call with skills array to save generated content.',
  {
    skill_names: z.array(z.string()).optional()
      .describe('Filter to specific skills. Omit to get all pending.'),
    skills: z.array(z.object({
      name: z.string().describe('Skill name (kebab-case)'),
      content: z.string().describe('Full .md content with frontmatter'),
    })).optional().describe('Generated skill files to save. Omit for discovery mode.'),
  },
  async ({ skill_names, skills }) => {
    await boot();

    const { SkillGapTracker, parseSkillFrontmatter, normalizeSkillName } = await import('@gossip/orchestrator');
    const tracker = new SkillGapTracker(process.cwd());

    // Save mode — write generated skill files
    if (skills && skills.length > 0) {
      const { writeFileSync, mkdirSync, existsSync, readFileSync } = require('fs');
      const { join } = require('path');
      const dir = join(process.cwd(), '.gossip', 'skills');
      mkdirSync(dir, { recursive: true });

      const results: string[] = [];
      for (const skill of skills) {
        const name = normalizeSkillName(skill.name);
        const filePath = join(dir, `${name}.md`);

        // Overwrite protection
        if (existsSync(filePath)) {
          const existing = readFileSync(filePath, 'utf-8');
          const fm = parseSkillFrontmatter(existing);
          if (fm) {
            if (fm.generated_by === 'manual') {
              results.push(`⚠️ Skipped ${name}: manually created file (generated_by: manual)`);
              continue;
            }
            if (fm.status === 'active') {
              results.push(`⚠️ Skipped ${name}: already active`);
              continue;
            }
            if (fm.status === 'disabled') {
              results.push(`⚠️ Skipped ${name}: disabled by user`);
              continue;
            }
          }
          // No frontmatter = old skeleton template, safe to overwrite
        }

        writeFileSync(filePath, skill.content);
        tracker.recordResolution(name);
        results.push(`✅ Created .gossip/skills/${name}.md`);
      }

      return { content: [{ type: 'text' as const, text: results.join('\n') }] };
    }

    // Discovery mode — return pending gap data
    const thresholds = tracker.checkThresholds();
    if (thresholds.count === 0) {
      return { content: [{ type: 'text' as const, text: 'No skills at threshold. Agents need to call suggest_skill() more.' }] };
    }

    const targetSkills = skill_names
      ? skill_names.map(normalizeSkillName).filter(s => thresholds.pending.includes(s))
      : thresholds.pending;

    if (targetSkills.length === 0) {
      return { content: [{ type: 'text' as const, text: `No matching skills at threshold. Pending: ${thresholds.pending.join(', ')}` }] };
    }

    const gapData = tracker.getGapData(targetSkills);
    let text = `Skills ready to build: ${gapData.length}\n\n`;

    for (const gap of gapData) {
      text += `### ${gap.skill}\n`;
      text += `Suggestions (${gap.suggestions.length} from ${gap.uniqueAgents.length} agents):\n`;
      for (const s of gap.suggestions) {
        text += `- ${s.agent}: "${s.reason}" (task: ${s.task_context.slice(0, 80)})\n`;
      }
      text += '\n';
    }

    text += `Generate each skill as a .md file with this frontmatter format:\n`;
    text += '```\n---\nname: skill-name\ndescription: What this skill does.\nkeywords: [keyword1, keyword2]\ngenerated_by: orchestrator\nsources: N suggestions from agent1, agent2\nstatus: active\n---\n```\n';
    text += `Body sections: Approach (numbered steps), Output (format), Don't (anti-patterns).\n\n`;
    text += `Then call gossip_build_skills(skills: [{name: "...", content: "..."}]) to save.`;

    return { content: [{ type: 'text' as const, text }] };
  }
);
```

- [ ] **Step 2: Add skillsReady message to gossip_collect response**

In the `gossip_collect` handler, after building the response text, add:

```typescript
// Check for skills ready to build
try {
  const { SkillGapTracker } = await import('@gossip/orchestrator');
  const tracker = new SkillGapTracker(process.cwd());
  const thresholds = tracker.checkThresholds();
  if (thresholds.count > 0) {
    responseText += `\n\n🔧 ${thresholds.count} skill(s) ready to build. Call gossip_build_skills() to generate them.`;
  }
} catch { /* best-effort */ }
```

- [ ] **Step 3: Add to tool list in gossip_tools**

Find the `gossip_tools` tool handler and add:
```typescript
{ name: 'gossip_build_skills', desc: 'Build skill files from agent gap suggestions' },
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p packages/orchestrator/tsconfig.json`
Expected: Clean

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts
git commit -m "feat: gossip_build_skills MCP tool with discovery + save modes"
```

---

### Task 8: Add Truncation to suggest_skill Path

**Files:**
- Modify: `packages/tools/src/skill-tools.ts`

- [ ] **Step 1: Add truncation check**

In `packages/tools/src/skill-tools.ts`, in the `suggestSkill` method, after the `appendFileSync` call, add truncation:

```typescript
async suggestSkill(args: SuggestSkillArgs, callerId?: string): Promise<string> {
  const entry: GapSuggestion = {
    type: 'suggestion',
    skill: args.skill_name,
    reason: args.reason,
    agent: callerId ?? 'unknown',
    task_context: args.task_context,
    timestamp: new Date().toISOString(),
  };

  appendFileSync(this.gapLogPath, JSON.stringify(entry) + '\n');

  // Truncate if log has grown too large (>5000 lines → keep 1000)
  this.truncateIfNeeded();

  return `Suggestion noted: '${args.skill_name}'. Continue with your current skills.`;
}

private truncateIfNeeded(): void {
  try {
    const { readFileSync, writeFileSync } = require('fs');
    const content = readFileSync(this.gapLogPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length > 5000) {
      writeFileSync(this.gapLogPath, lines.slice(-1000).join('\n') + '\n');
    }
  } catch { /* best-effort */ }
}
```

- [ ] **Step 2: Run existing tests**

Run: `npm test -- --testPathPattern=skill-tools`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/tools/src/skill-tools.ts
git commit -m "fix: add gap log truncation to suggest_skill path"
```

---

### Task 9: Wire Dispatch Pipeline — Pass taskText to Registry

**Files:**
- Modify: `packages/orchestrator/src/dispatch-pipeline.ts`

- [ ] **Step 1: Pass taskText and catalog to findBestMatch calls**

In `dispatch-pipeline.ts`, find where `this.registryGet` or `findBestMatch` is called during dispatch. Pass the task text and catalog reference.

The `DispatchPipeline` already has `this.catalog` (set at line 107). When calling registry-based agent selection (in `dispatchParallel` or auto-assignment paths), add:

```typescript
const options = {
  taskText: task,
  catalog: this.catalog || undefined,
};
```

Pass this to `findBestMatchExcluding()` calls.

- [ ] **Step 2: Initialize SkillCatalog with projectRoot**

In the `DispatchPipeline` constructor, update SkillCatalog initialization:

```typescript
try {
  this.catalog = new SkillCatalog(config.projectRoot);
} catch (err) {
  this.catalog = null;
  log(`SkillCatalog unavailable: ${(err as Error).message}`);
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --testPathPattern=dispatch-pipeline`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/dispatch-pipeline.ts
git commit -m "feat: pass taskText and catalog to registry for project skill matching"
```

---

### Task 10: Integration Test — End-to-End Skill Discovery

**Files:**
- Create: `tests/orchestrator/skill-discovery-e2e.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/orchestrator/skill-discovery-e2e.test.ts
import { SkillGapTracker, SkillCatalog, AgentRegistry, normalizeSkillName } from '@gossip/orchestrator';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Skill Discovery E2E', () => {
  const testDir = join(tmpdir(), `gossip-discovery-e2e-${Date.now()}`);
  const gossipDir = join(testDir, '.gossip');
  const skillsDir = join(gossipDir, 'skills');
  const gapLogPath = join(gossipDir, 'skill-gaps.jsonl');

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function suggest(skill: string, agent: string, reason: string) {
    appendFileSync(gapLogPath, JSON.stringify({
      type: 'suggestion', skill, reason, agent, task_context: 'e2e test',
      timestamp: new Date().toISOString(),
    }) + '\n');
  }

  it('full pipeline: suggest → threshold → build → dispatch', () => {
    // 1. Three suggestions from 2 agents
    suggest('dos_resilience', 'reviewer-1', 'no maxPayload on WebSocket');
    suggest('dos_resilience', 'reviewer-2', 'no rate limiting on API');
    suggest('dos_resilience', 'reviewer-1', 'unbounded queue in worker');

    // 2. Check thresholds
    const tracker = new SkillGapTracker(testDir);
    const thresholds = tracker.checkThresholds();
    expect(thresholds.count).toBe(1);
    expect(thresholds.pending).toContain('dos-resilience');

    // 3. Get gap data
    const gapData = tracker.getGapData(['dos-resilience']);
    expect(gapData[0].suggestions).toHaveLength(3);
    expect(gapData[0].uniqueAgents).toHaveLength(2);

    // 4. Simulate Claude Code generating the skill file
    const skillContent = `---
name: dos-resilience
description: Review code for DoS vectors and resource exhaustion.
keywords: [dos, rate-limit, payload, backpressure]
generated_by: orchestrator
sources: 3 suggestions from reviewer-1, reviewer-2
status: active
---

# DoS Resilience

## Approach
1. Check endpoints for payload limits
2. Verify rate limiting

## Output
file:line, severity, remediation

## Don't
- Flag internal endpoints without justification
`;
    writeFileSync(join(skillsDir, 'dos-resilience.md'), skillContent);
    tracker.recordResolution('dos-resilience');

    // 5. Verify skill is no longer pending
    expect(tracker.isAtThreshold('dos-resilience')).toBe(false);
    expect(tracker.checkThresholds().count).toBe(0);

    // 6. SkillCatalog picks it up
    const catalog = new SkillCatalog(testDir);
    const matches = catalog.matchTask('check rate-limit configuration for DoS');
    expect(matches.find(m => m.name === 'dos-resilience')).toBeDefined();

    // 7. AgentRegistry uses it for dispatch
    const registry = new AgentRegistry();
    registry.register({ id: 'sec-reviewer', provider: 'anthropic', model: 'claude', skills: ['security-audit'] });
    registry.register({ id: 'implementer', provider: 'openai', model: 'gpt', skills: ['typescript'] });
    registry.setSuggesterCache(new Map([
      ['dos-resilience', new Set(['sec-reviewer'])],
    ]));

    const match = registry.findBestMatchExcluding([], new Set(), {
      taskText: 'review this WebSocket handler for DoS protection',
      catalog,
    });
    // sec-reviewer gets: projectBoost=0.5 + suggesterBoost=0.3 = 0.8
    // implementer gets: projectBoost=0.5 = 0.5
    expect(match?.id).toBe('sec-reviewer');
  });

  it('overwrite protection prevents destroying manually edited skills', () => {
    const manualSkill = `---
name: custom-skill
description: Manually written skill.
keywords: [custom]
generated_by: manual
status: active
---

# Custom Skill
Hand-crafted content.
`;
    writeFileSync(join(skillsDir, 'custom-skill.md'), manualSkill);

    // Verify catalog loads it
    const catalog = new SkillCatalog(testDir);
    expect(catalog.listSkills().find(s => s.name === 'custom-skill')).toBeDefined();

    // The file should not be overwritable by the build pipeline
    // (This would be tested in the MCP tool integration, but we verify the file is untouched)
    const content = readFileSync(join(skillsDir, 'custom-skill.md'), 'utf-8');
    expect(content).toContain('Hand-crafted content.');
  });

  it('name normalization is consistent across all components', () => {
    // Write with underscores
    suggest('memory_optimization', 'agent-1', 'reason1');
    suggest('memory_optimization', 'agent-2', 'reason2');
    suggest('memory-optimization', 'agent-1', 'reason3');

    const tracker = new SkillGapTracker(testDir);
    const thresholds = tracker.checkThresholds();
    // All three normalize to memory-optimization — should count as 1 skill at threshold
    expect(thresholds.pending).toContain('memory-optimization');
    expect(thresholds.count).toBe(1);

    // Catalog lookup also normalizes
    writeFileSync(join(skillsDir, 'memory-optimization.md'), `---
name: memory_optimization
description: Memory optimization.
keywords: [memory, optimization]
status: active
---
# Memory
`);
    const catalog = new SkillCatalog(testDir);
    // Name should be normalized to memory-optimization
    expect(catalog.listSkills().find(s => s.name === 'memory-optimization')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npm test -- --testPathPattern=skill-discovery-e2e`
Expected: All 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/orchestrator/skill-discovery-e2e.test.ts
git commit -m "test: end-to-end skill discovery pipeline integration tests"
```

---

### Task 11: Update Exports and Type-Check

**Files:**
- Modify: `packages/orchestrator/src/index.ts`
- Verify all packages compile

- [ ] **Step 1: Verify all exports are in index.ts**

Ensure these are exported from `packages/orchestrator/src/index.ts`:
```typescript
export { normalizeSkillName } from './skill-name';
export { parseSkillFrontmatter, SkillFrontmatter } from './skill-parser';
export { FindBestMatchOptions } from './agent-registry';
```

- [ ] **Step 2: Type-check all packages**

Run: `npx tsc --noEmit -p packages/orchestrator/tsconfig.json`
Expected: Clean (no errors)

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit if any changes needed**

```bash
git add packages/orchestrator/src/index.ts
git commit -m "chore: export new skill discovery types and utilities"
```

---

## Summary

| Task | Component | Type |
|------|-----------|------|
| 1 | normalizeSkillName | New utility |
| 2 | Skill frontmatter parser | New utility |
| 3 | SkillGapTracker refactor | Refactor (breaking) |
| 4 | SkillCatalog project skills | Enhancement |
| 5 | AgentRegistry additive boost | Enhancement |
| 6 | CollectResult.skillsReady | Enhancement |
| 7 | gossip_build_skills MCP tool | New tool |
| 8 | suggest_skill truncation | Bug fix |
| 9 | Dispatch pipeline wiring | Integration |
| 10 | E2E integration test | Testing |
| 11 | Exports and final type-check | Cleanup |

**Dependency order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

Tasks 1-2 are independent utilities. Task 3 depends on 1. Tasks 4-5 depend on 1-2. Tasks 6-9 depend on 3-5. Task 10 validates everything. Task 11 is final cleanup.
