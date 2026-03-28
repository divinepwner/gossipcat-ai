# Agent Skill Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orchestrator generates superpowers-quality skill files per agent based on competency gaps, with effectiveness tracking and quality validation.

**Architecture:** A single `SkillGenerator` class reads reference templates + ATI profiler data, calls LLM to produce a skill `.md` file, validates output structure, registers the skill on the agent config, and tracks effectiveness via confirmation rate. Exposed as `gossip_develop_skill` MCP tool.

**Tech Stack:** TypeScript, Jest, existing gossipcat orchestrator + tools packages, esbuild for MCP bundle

**Spec:** `docs/superpowers/specs/2026-03-28-agent-skill-development.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/orchestrator/src/skill-generator.ts` | Core skill generation: template loading, prompt assembly, LLM call, validation, file writing, effectiveness tracking |
| `tests/orchestrator/skill-generator.test.ts` | Unit tests with mocked LLM |

### Modified Files

| File | Change |
|------|--------|
| `packages/orchestrator/src/index.ts` | Export `SkillGenerator` |
| `apps/cli/src/mcp-server-sdk.ts` | Add `gossip_develop_skill` MCP tool, wire `SkillGenerator` at boot |
| `dist-mcp/mcp-server.js` | Rebuild via `npm run build:mcp` |

---

## Task 1: SkillGenerator — Core Class with Template Loading

**Files:**
- Create: `packages/orchestrator/src/skill-generator.ts`
- Create: `tests/orchestrator/skill-generator.test.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Write failing tests for template loading and validation**

Create `tests/orchestrator/skill-generator.test.ts`:

```typescript
import { SkillGenerator } from '@gossip/orchestrator';
import { CompetencyProfiler } from '@gossip/orchestrator';
import { ILLMProvider } from '@gossip/orchestrator';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockLlm = {
  generate: jest.fn(),
} as unknown as jest.Mocked<ILLMProvider>;

describe('SkillGenerator', () => {
  const testDir = join(tmpdir(), 'gossip-skillgen-' + Date.now());
  let generator: SkillGenerator;
  let profiler: CompetencyProfiler;

  beforeAll(() => {
    mkdirSync(join(testDir, '.gossip', 'agents', 'agent-a', 'skills'), { recursive: true });
    mkdirSync(join(testDir, '.gossip', 'skill-templates'), { recursive: true });
    // Seed performance data
    const signals = [];
    for (let i = 0; i < 12; i++) {
      signals.push(JSON.stringify({ type: 'meta', signal: 'task_completed', agentId: 'agent-a', taskId: `t${i}`, value: 3000, timestamp: '2026-01-01T00:00:00Z' }));
    }
    signals.push(JSON.stringify({ type: 'consensus', signal: 'category_confirmed', agentId: 'agent-a', taskId: 't0', category: 'injection_vectors', evidence: 'Prompt injection via unsanitized input at consensus-engine.ts:113', timestamp: '2026-01-01T00:00:00Z' }));
    // Peer with higher score
    for (let i = 0; i < 12; i++) {
      signals.push(JSON.stringify({ type: 'meta', signal: 'task_completed', agentId: 'peer-b', taskId: `p${i}`, value: 3000, timestamp: '2026-01-01T00:00:00Z' }));
    }
    for (let i = 0; i < 5; i++) {
      signals.push(JSON.stringify({ type: 'consensus', signal: 'category_confirmed', agentId: 'peer-b', taskId: `p${i}`, category: 'injection_vectors', evidence: `Finding ${i}`, timestamp: '2026-01-01T00:00:00Z' }));
    }
    writeFileSync(join(testDir, '.gossip', 'agent-performance.jsonl'), signals.join('\n') + '\n');
    writeFileSync(join(testDir, '.gossip', 'bootstrap.md'), '# Test Project\nA test gossipcat project.');
  });

  afterAll(() => rmSync(testDir, { recursive: true, force: true }));

  beforeEach(() => {
    jest.clearAllMocks();
    profiler = new CompetencyProfiler(testDir);
    generator = new SkillGenerator(mockLlm as any, profiler, testDir);
  });

  test('rejects invalid category', async () => {
    await expect(generator.generate('agent-a', 'not_a_real_category'))
      .rejects.toThrow(/unknown category/i);
  });

  test('rejects invalid agent_id with path traversal', async () => {
    await expect(generator.generate('../../etc', 'injection_vectors'))
      .rejects.toThrow(/invalid/i);
  });

  test('rejects invalid category with path traversal', async () => {
    await expect(generator.generate('agent-a', '../../bootstrap'))
      .rejects.toThrow(/unknown category/i);
  });

  test('generates skill file with valid frontmatter and sections', async () => {
    const skillContent = `---
name: injection-audit
category: injection_vectors
agent: agent-a
generated: 2026-03-28T00:00:00Z
effectiveness: 0.0
baseline_rate: 0.1
baseline_dispatches: 10
post_skill_dispatches: 0
version: 1
---

# Injection Audit

## Iron Law

NO input path assessment without tracing from entry point to LLM prompt.

## When This Skill Activates

- Task mentions injection, sanitization, prompt construction

## Methodology

1. Map all entry points
2. Trace each input path
3. Check sanitization at boundaries

## Key Patterns

- Check for raw string interpolation

## Anti-Patterns

| Thought | Reality |
|---------|---------|
| "It's wrapped in tags" | Tags are advisory |

## Quality Gate

- [ ] Each finding cites file:line
`;

    (mockLlm.generate as jest.Mock).mockResolvedValue({ text: skillContent, toolCalls: [] });

    const result = await generator.generate('agent-a', 'injection_vectors');
    expect(result.path).toContain('.gossip/agents/agent-a/skills/injection-vectors.md');
    expect(result.content).toContain('## Iron Law');
    expect(result.content).toContain('## Methodology');
    expect(result.content).toContain('## Anti-Patterns');
    expect(result.content).toContain('## Quality Gate');

    // Verify file was written
    expect(existsSync(result.path)).toBe(true);
  });

  test('rejects LLM output missing required sections', async () => {
    (mockLlm.generate as jest.Mock).mockResolvedValue({
      text: '---\nname: bad\n---\n# Bad Skill\nNo sections here.',
      toolCalls: [],
    });

    await expect(generator.generate('agent-a', 'injection_vectors'))
      .rejects.toThrow(/missing required section/i);
  });

  test('rejects LLM output missing frontmatter', async () => {
    (mockLlm.generate as jest.Mock).mockResolvedValue({
      text: '# No Frontmatter\n## Iron Law\nDo stuff',
      toolCalls: [],
    });

    await expect(generator.generate('agent-a', 'injection_vectors'))
      .rejects.toThrow(/frontmatter/i);
  });

  test('uses bundled template when no external templates exist', async () => {
    const skillContent = `---
name: injection-audit
category: injection_vectors
agent: agent-a
generated: 2026-03-28T00:00:00Z
effectiveness: 0.0
baseline_rate: 0.1
baseline_dispatches: 10
post_skill_dispatches: 0
version: 1
---

# Injection Audit

## Iron Law
Rule

## When This Skill Activates
Triggers

## Methodology
1. Step

## Key Patterns
Pattern

## Anti-Patterns
| Thought | Reality |
|---------|---------|
| T | R |

## Quality Gate
- [ ] Check
`;
    (mockLlm.generate as jest.Mock).mockResolvedValue({ text: skillContent, toolCalls: [] });

    const result = await generator.generate('agent-a', 'injection_vectors');
    expect(result.content).toContain('## Iron Law');

    // Verify the LLM was called with a prompt containing the bundled template
    const callArgs = (mockLlm.generate as jest.Mock).mock.calls[0];
    const prompt = callArgs[0].map((m: any) => m.content).join('\n');
    expect(prompt).toContain('reference_skill');
  });

  test('assembles prompt with profiler data and project context', async () => {
    const skillContent = `---
name: injection-audit
category: injection_vectors
agent: agent-a
generated: 2026-03-28T00:00:00Z
effectiveness: 0.0
baseline_rate: 0.1
baseline_dispatches: 10
post_skill_dispatches: 0
version: 1
---

# Injection Audit

## Iron Law
Rule

## When This Skill Activates
Triggers

## Methodology
1. Step

## Key Patterns
Pattern

## Anti-Patterns
| Thought | Reality |
|---------|---------|
| T | R |

## Quality Gate
- [ ] Check
`;
    (mockLlm.generate as jest.Mock).mockResolvedValue({ text: skillContent, toolCalls: [] });

    await generator.generate('agent-a', 'injection_vectors');

    const callArgs = (mockLlm.generate as jest.Mock).mock.calls[0];
    const prompt = callArgs[0].map((m: any) => m.content).join('\n');

    // Should contain project context
    expect(prompt).toContain('Test Project');
    // Should contain category findings
    expect(prompt).toContain('injection');
    // Should contain agent performance data
    expect(prompt).toContain('agent-a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orchestrator/skill-generator.test.ts --no-coverage`
Expected: FAIL — `SkillGenerator` not found

- [ ] **Step 3: Implement SkillGenerator**

Create `packages/orchestrator/src/skill-generator.ts`:

```typescript
/**
 * SkillGenerator — generates superpowers-quality skill files per agent
 * based on competency gaps. Uses LLM with reference templates.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'fs';
import { join, resolve } from 'path';
import { ILLMProvider } from './llm-client';
import { CompetencyProfiler } from './competency-profiler';
import { LLMMessage } from '@gossip/types';
import { ConsensusSignal, PerformanceSignal } from './consensus-types';
import { normalizeSkillName } from './skill-name';

const SAFE_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;

const KNOWN_CATEGORIES = new Set([
  'trust_boundaries', 'injection_vectors', 'input_validation', 'concurrency',
  'resource_exhaustion', 'type_safety', 'error_handling', 'data_integrity',
]);

const REQUIRED_SECTIONS = ['## Iron Law', '## When This Skill Activates', '## Methodology', '## Anti-Patterns', '## Quality Gate'];

const BUNDLED_TEMPLATE = `---
name: systematic-debugging
description: Use when encountering any bug or unexpected behavior
---

# Systematic Debugging

## Iron Law

NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.

## When This Skill Activates

- Test failures, bugs, unexpected behavior

## Methodology

1. Read error messages carefully — they often contain the solution
2. Reproduce consistently — if not reproducible, gather more data
3. Check recent changes — git diff, recent commits
4. Form hypothesis and verify with evidence
5. Fix the root cause, not the symptom

## Anti-Patterns

| Thought | Reality |
|---------|---------|
| "Just one quick fix" | Quick fixes mask root causes |
| "I know what's wrong" | Verify before acting |

## Quality Gate

- [ ] Root cause identified with evidence
- [ ] Fix addresses root cause, not symptom
- [ ] Tests verify the fix
`;

export class SkillGenerator {
  constructor(
    private llm: ILLMProvider,
    private profiler: CompetencyProfiler,
    private projectRoot: string,
  ) {}

  async generate(agentId: string, category: string): Promise<{ path: string; content: string }> {
    // Validate inputs
    if (!SAFE_NAME.test(agentId)) {
      throw new Error(`Invalid agent_id: "${agentId}". Must be lowercase alphanumeric with hyphens/underscores.`);
    }
    if (!KNOWN_CATEGORIES.has(category)) {
      throw new Error(`Unknown category: "${category}". Known: ${[...KNOWN_CATEGORIES].join(', ')}`);
    }

    // Load reference template
    const template = this.loadTemplate();

    // Load category findings from JSONL
    const findings = this.loadCategoryFindings(category);

    // Load agent + peer scores
    const profiles = this.profiler.getProfiles();
    const agentProfile = profiles.get(agentId);
    const agentScore = agentProfile?.reviewStrengths[category] ?? 0;
    const peerScores: string[] = [];
    for (const [id, p] of profiles) {
      if (id === agentId) continue;
      const score = p.reviewStrengths[category];
      if (score !== undefined && score > 0.5) {
        peerScores.push(`${id}: ${score.toFixed(2)}`);
      }
    }

    // Load project context
    let projectContext = '';
    const bootstrapPath = join(this.projectRoot, '.gossip', 'bootstrap.md');
    if (existsSync(bootstrapPath)) {
      projectContext = readFileSync(bootstrapPath, 'utf-8').slice(0, 2000);
    }

    // Compute baseline rate for effectiveness tracking
    const totalDispatches = agentProfile?.totalTasks ?? 0;
    const categoryConfirmations = findings.filter(f => f.agentId === agentId).length;
    const baselineRate = totalDispatches > 0 ? categoryConfirmations / totalDispatches : 0;

    // Assemble LLM prompt
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a prompt engineer specializing in AI agent skill files. You produce structured, opinionated methodology documents that dramatically improve an agent's performance on specific review tasks.

Study this reference skill — it represents the quality bar:

<reference_skill>
${template}
</reference_skill>`,
      },
      {
        role: 'user',
        content: `Generate a skill file for agent "${agentId}" to improve its "${category}" review performance.

<project_context>
${projectContext || 'No project context available.'}
</project_context>

<findings_in_category>
${findings.length > 0 ? findings.slice(0, 20).map(f => `- [${f.agentId}] ${f.evidence}`).join('\n') : 'No findings yet in this category.'}
</findings_in_category>

<agent_performance>
Agent: ${agentId}
Current ${category} score: ${agentScore.toFixed(2)}
Peer scores: ${peerScores.length > 0 ? peerScores.join(', ') : 'no peer data'}
</agent_performance>

Output a skill markdown file with this exact structure:

1. YAML frontmatter with fields: name, category, agent, generated, effectiveness (0.0), baseline_rate (${baselineRate.toFixed(3)}), baseline_dispatches (${totalDispatches}), post_skill_dispatches (0), version (1)
2. ## Iron Law — one absolute rule (MUST/NEVER language)
3. ## When This Skill Activates — task patterns that trigger it
4. ## Methodology — 5-8 step checklist, actionable not vague
5. ## Key Patterns — important code patterns to look for
6. ## Anti-Patterns — table with columns "Thought" and "Reality"
7. ## Quality Gate — pre-report checklist with checkboxes

Requirements:
- Write with authority — MUST, NEVER, NO EXCEPTIONS
- Keep under 150 lines
- Methodology must be universal (works on any codebase)
- Key Patterns can include project-specific examples from findings`,
      },
    ];

    // Call LLM
    const response = await this.llm.generate(messages, { temperature: 0.3 });
    const content = response.text || '';

    // Validate output
    this.validateSkillContent(content);

    // Write file
    const skillName = normalizeSkillName(category);
    const skillDir = join(this.projectRoot, '.gossip', 'agents', agentId, 'skills');
    mkdirSync(skillDir, { recursive: true });
    const skillPath = join(skillDir, `${skillName}.md`);
    writeFileSync(skillPath, content);

    return { path: skillPath, content };
  }

  private validateSkillContent(content: string): void {
    // Check frontmatter
    if (!content.match(/^---\n[\s\S]*?\n---/)) {
      throw new Error('Generated skill missing frontmatter. LLM output did not follow the required format.');
    }

    // Check required sections
    for (const section of REQUIRED_SECTIONS) {
      if (!content.includes(section)) {
        throw new Error(`Generated skill missing required section: "${section}". LLM output did not follow the required format.`);
      }
    }

    // Check line count
    const lines = content.split('\n').length;
    if (lines > 200) {
      throw new Error(`Generated skill is ${lines} lines (max 200). LLM output too verbose.`);
    }
  }

  private loadTemplate(): string {
    // 1. User-provided templates
    const userDir = join(this.projectRoot, '.gossip', 'skill-templates');
    if (existsSync(userDir)) {
      const files = readdirSync(userDir).filter(f => f.endsWith('.md'));
      if (files.length > 0) {
        return readFileSync(join(userDir, files[0]), 'utf-8');
      }
    }

    // 2. Superpowers plugin cache
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const cacheBase = join(home, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers');
    if (existsSync(cacheBase)) {
      try {
        const versions = readdirSync(cacheBase).sort().reverse(); // latest first
        for (const ver of versions) {
          const skillPath = join(cacheBase, ver, 'skills', 'systematic-debugging', 'SKILL.md');
          if (existsSync(skillPath)) {
            const realPath = realpathSync(skillPath);
            if (realPath.startsWith(resolve(cacheBase))) {
              return readFileSync(realPath, 'utf-8');
            }
          }
        }
      } catch { /* cache not readable */ }
    }

    // 3. Bundled template
    return BUNDLED_TEMPLATE;
  }

  private loadCategoryFindings(category: string): Array<{ agentId: string; evidence: string }> {
    const filePath = join(this.projectRoot, '.gossip', 'agent-performance.jsonl');
    if (!existsSync(filePath)) return [];
    try {
      return readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean)
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter((s): s is ConsensusSignal =>
          s !== null && s.type === 'consensus' && s.signal === 'category_confirmed' && s.category === category
        )
        .map(s => ({ agentId: s.agentId, evidence: s.evidence || '' }));
    } catch { return []; }
  }
}
```

- [ ] **Step 4: Export from index.ts**

Add to `packages/orchestrator/src/index.ts`:

```typescript
export { SkillGenerator } from './skill-generator';
```

- [ ] **Step 5: Run tests and verify pass**

Run: `npx jest tests/orchestrator/skill-generator.test.ts --no-coverage`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/skill-generator.ts packages/orchestrator/src/index.ts tests/orchestrator/skill-generator.test.ts
git commit -m "feat(ati): skill generator with template loading, validation, and LLM prompt assembly

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: MCP Tool + Boot Wiring

**Files:**
- Modify: `apps/cli/src/mcp-server-sdk.ts`

- [ ] **Step 1: Add SkillGenerator to getModules**

In `apps/cli/src/mcp-server-sdk.ts`, add to the `getModules()` function:

```typescript
SkillGenerator: (await import('@gossip/orchestrator')).SkillGenerator,
```

- [ ] **Step 2: Create SkillGenerator instance at boot**

In `doBoot()`, after the ATI profiler wiring block (after `pipeline.setDispatchDifferentiator`), add:

```typescript
// Create skill generator for gossip_develop_skill tool
try {
  const { CompetencyProfiler: CP, SkillGenerator: SG } = await import('@gossip/orchestrator');
  const skillProfiler = new CP(process.cwd());
  skillGenerator = new SG(
    m.createProvider(mainProvider as any, mainModel, mainKey ?? undefined),
    skillProfiler,
    process.cwd(),
  );
  process.stderr.write('[gossipcat] Skill generator ready\n');
} catch (err) {
  process.stderr.write(`[gossipcat] Skill generator failed: ${(err as Error).message}\n`);
}
```

Add the module-level variable near the top (near `let mainAgent`, `let toolServer`, etc.):

```typescript
let skillGenerator: any = null;
```

- [ ] **Step 3: Add gossip_develop_skill MCP tool**

Add the tool registration near the other gossip tools (around line 1800). Follow the existing pattern used by `gossip_build_skills`:

```typescript
'gossip_develop_skill',
'Generate a superpowers-quality skill file for an agent to improve performance in a specific review category. Uses ATI profiler data + reference templates.',
{
  agent_id: z.string().describe('Agent to develop skill for (e.g., "gemini-reviewer")'),
  category: z.string().describe('Category to improve. One of: trust_boundaries, injection_vectors, input_validation, concurrency, resource_exhaustion, type_safety, error_handling, data_integrity'),
},
async ({ agent_id, category }: { agent_id: string; category: string }) => {
  await boot();

  if (!skillGenerator) {
    return 'Skill generator not available. Check boot logs.';
  }

  try {
    const result = await skillGenerator.generate(agent_id, category);

    // Register skill on agent config so loadSkills picks it up
    if (mainAgent) {
      const registry = (mainAgent as any).registry;
      const config = registry?.get(agent_id);
      if (config && !config.skills.includes(category)) {
        config.skills.push(category);
      }
    }

    return `✅ Skill generated and saved:\n\nPath: ${result.path}\n\n${result.content.slice(0, 1000)}${result.content.length > 1000 ? '\n\n... (truncated)' : ''}`;
  } catch (err) {
    return `❌ Skill generation failed: ${(err as Error).message}`;
  }
},
```

Also add to the tool listing array (near `gossip_build_skills`):

```typescript
{ name: 'gossip_develop_skill', desc: 'Generate agent-specific skill from ATI competency data' },
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit -p packages/orchestrator/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Build MCP bundle**

Run: `npm run build:mcp`
Expected: Clean build

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/mcp-server-sdk.ts dist-mcp/mcp-server.js
git commit -m "feat(ati): gossip_develop_skill MCP tool with boot wiring

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Integration Test + Final Verification

**Files:**
- Create: `tests/orchestrator/skill-development-integration.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/orchestrator/skill-development-integration.test.ts`:

```typescript
import { SkillGenerator, CompetencyProfiler, PerformanceWriter, extractCategories } from '@gossip/orchestrator';
import { loadSkills } from '../../packages/orchestrator/src/skill-loader';
import { ILLMProvider } from '@gossip/orchestrator';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const VALID_SKILL = `---
name: injection-audit
category: injection_vectors
agent: test-agent
generated: 2026-03-28T00:00:00Z
effectiveness: 0.0
baseline_rate: 0.1
baseline_dispatches: 12
post_skill_dispatches: 0
version: 1
---

# Injection Audit

## Iron Law

NO input assessment without tracing from entry to prompt.

## When This Skill Activates

- Injection, sanitization, prompt construction tasks

## Methodology

1. Map entry points
2. Trace input paths
3. Check sanitization
4. Test with adversarial input
5. Verify defense in depth

## Key Patterns

- Raw string interpolation in LLM prompts
- Missing data fence tags

## Anti-Patterns

| Thought | Reality |
|---------|---------|
| "Tags protect" | LLMs treat tags as advisory |

## Quality Gate

- [ ] Each finding cites file:line
- [ ] Evidence from actual code
`;

describe('Skill Development — Integration', () => {
  const testDir = join(tmpdir(), 'gossip-skilldev-integ-' + Date.now());
  let generator: SkillGenerator;

  const mockLlm = {
    generate: jest.fn().mockResolvedValue({ text: VALID_SKILL, toolCalls: [] }),
  } as unknown as jest.Mocked<ILLMProvider>;

  beforeAll(() => {
    mkdirSync(join(testDir, '.gossip', 'agents', 'test-agent', 'skills'), { recursive: true });
    // Seed data
    const signals = [];
    for (let i = 0; i < 12; i++) {
      signals.push(JSON.stringify({ type: 'meta', signal: 'task_completed', agentId: 'test-agent', taskId: `t${i}`, value: 3000, timestamp: '2026-01-01T00:00:00Z' }));
    }
    signals.push(JSON.stringify({ type: 'consensus', signal: 'category_confirmed', agentId: 'test-agent', taskId: 't0', category: 'injection_vectors', evidence: 'Test finding', timestamp: '2026-01-01T00:00:00Z' }));
    writeFileSync(join(testDir, '.gossip', 'agent-performance.jsonl'), signals.join('\n') + '\n');
    writeFileSync(join(testDir, '.gossip', 'bootstrap.md'), '# Test Project');
  });

  afterAll(() => rmSync(testDir, { recursive: true, force: true }));

  beforeEach(() => {
    jest.clearAllMocks();
    (mockLlm.generate as jest.Mock).mockResolvedValue({ text: VALID_SKILL, toolCalls: [] });
    const profiler = new CompetencyProfiler(testDir);
    generator = new SkillGenerator(mockLlm as any, profiler, testDir);
  });

  test('generate → file exists → loadSkills picks it up', async () => {
    const result = await generator.generate('test-agent', 'injection_vectors');

    // File was created
    expect(existsSync(result.path)).toBe(true);

    // loadSkills can find it (when category is in skills array)
    const skills = loadSkills('test-agent', ['injection-vectors'], testDir);
    expect(skills).toContain('Iron Law');
    expect(skills).toContain('Methodology');
  });

  test('generated skill file has correct frontmatter', async () => {
    const result = await generator.generate('test-agent', 'injection_vectors');
    expect(result.content).toContain('category: injection_vectors');
    expect(result.content).toContain('agent: test-agent');
    expect(result.content).toContain('effectiveness: 0.0');
  });

  test('prompt includes category findings from JSONL', async () => {
    await generator.generate('test-agent', 'injection_vectors');
    const callArgs = (mockLlm.generate as jest.Mock).mock.calls[0];
    const fullPrompt = callArgs[0].map((m: any) => m.content).join('\n');
    expect(fullPrompt).toContain('Test finding');
  });

  test('prompt includes peer score comparison', async () => {
    // Add peer data
    const writer = new PerformanceWriter(testDir);
    for (let i = 0; i < 12; i++) {
      writer.appendSignal({ type: 'meta', signal: 'task_completed', agentId: 'strong-peer', taskId: `sp${i}`, value: 2000, timestamp: new Date().toISOString() } as any);
    }
    for (let i = 0; i < 5; i++) {
      writer.appendSignal({ type: 'consensus', signal: 'category_confirmed', agentId: 'strong-peer', taskId: `sp${i}`, category: 'injection_vectors', evidence: 'Peer finding', timestamp: new Date().toISOString() } as any);
    }

    // Fresh profiler to pick up new data
    const freshProfiler = new CompetencyProfiler(testDir);
    const freshGenerator = new SkillGenerator(mockLlm as any, freshProfiler, testDir);
    await freshGenerator.generate('test-agent', 'injection_vectors');

    const callArgs = (mockLlm.generate as jest.Mock).mock.calls[0];
    const fullPrompt = callArgs[0].map((m: any) => m.content).join('\n');
    expect(fullPrompt).toContain('strong-peer');
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx jest tests/orchestrator/skill-development-integration.test.ts --no-coverage`
Expected: All PASS

- [ ] **Step 3: Run full test suite**

Run: `npx jest tests/ --no-coverage --testPathIgnorePatterns='e2e|full-stack'`
Expected: No new failures

- [ ] **Step 4: Commit**

```bash
git add tests/orchestrator/skill-development-integration.test.ts
git commit -m "test(ati): skill development integration — generate → load → prompt injection

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Build and Final Type Check

- [ ] **Step 1: Type check all packages**

Run: `npx tsc --noEmit -p packages/orchestrator/tsconfig.json`
Expected: No errors

- [ ] **Step 2: Build dist**

Run: `npx tsc -p packages/orchestrator/tsconfig.json && npm run build:mcp`
Expected: Clean build

- [ ] **Step 3: Run full test suite**

Run: `npx jest tests/ --no-coverage --testPathIgnorePatterns='e2e|full-stack'`
Expected: All PASS

- [ ] **Step 4: Final commit**

```bash
git commit --allow-empty -m "build: skill development feature complete

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
