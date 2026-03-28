# Agent Skill Development — Design Spec

> The orchestrator generates superpowers-quality skill files per agent based on competency gaps, improving weak areas over time. Skills are portable (exportable) and measurable (effectiveness tracked).

**Date:** 2026-03-28
**Status:** Ready for implementation
**Dependencies:** ATI v3 Phase 1 (shipped), Skill Discovery v2 (shipped), CompetencyProfiler (shipped)

---

## Problem Statement

Agents have static skills declared in config. When an agent is weak in a category (e.g., `injection_vectors`), it stays weak forever. The system detects the weakness via ATI profiler but has no mechanism to improve it.

Superpowers-quality skills (like `systematic-debugging`, `test-driven-development`) dramatically improve agent performance because they encode methodology — checklists, iron laws, anti-patterns. But these are hand-authored and generic. We need the orchestrator to generate similar-quality skills that are agent-specific and project-aware.

---

## Design

### Trigger

Exposed as `gossip_develop_skill` MCP tool:

```typescript
gossip_develop_skill({ agent_id: "gemini-reviewer", category: "injection_vectors" })
```

Not auto-triggered — the user or orchestrator calls it explicitly when they observe a weak area. Auto-triggering is a future enhancement.

### Skill Generation (`skill-generator.ts`)

A single class with one public method:

```typescript
export class SkillGenerator {
  constructor(
    private llm: ILLMProvider,
    private profiler: CompetencyProfiler,
    private projectRoot: string,
  ) {}

  async generate(agentId: string, category: string): Promise<{ path: string; content: string }>;
}
```

**Inputs assembled before the LLM call:**

1. **Reference templates** — 2 superpowers skills read from disk as structural examples. Template resolution order:
   - Check `.gossip/skill-templates/` for user-provided templates
   - Check superpowers plugin cache at `~/.claude/plugins/cache/claude-plugins-official/superpowers/*/skills/` (reads `systematic-debugging/SKILL.md` and `test-driven-development/SKILL.md`)
   - Fall back to a bundled minimal template hardcoded in `skill-generator.ts` (a ~30 line skeleton with all required sections)

   Only the structure is used — the content is generated fresh.

2. **Category findings** — all `category_confirmed` signals for this category from `agent-performance.jsonl` via `CompetencyProfiler`. Includes finding text, originating agent, and evidence (file:line references).

3. **Agent gap data** — this agent's `reviewStrengths[category]` score, peer scores in the same category, and findings peers made that this agent missed (derived by comparing confirmed findings across agents in co-dispatched tasks).

4. **Project context** — `.gossip/bootstrap.md` content (architecture overview, package structure).

**LLM prompt:**

```
System: You are a prompt engineer specializing in AI agent skill files.
You produce structured, opinionated methodology documents that
dramatically improve an agent's performance on specific review tasks.

Study these reference skills — they represent the quality bar:

<reference_skill_1>
{skill content}
</reference_skill_1>

<reference_skill_2>
{skill content}
</reference_skill_2>

User: Generate a skill file for agent "{agent_id}" to improve its
"{category}" review performance.

<project_context>
{bootstrap.md content, truncated to 2000 chars}
</project_context>

<findings_in_category>
{confirmed findings with file:line, agent, evidence — max 20}
</findings_in_category>

<agent_performance>
Agent: {agent_id}
Current {category} score: {score}
Peer scores: {other agents' scores}
Findings agent missed: {peer findings this agent didn't produce}
</agent_performance>

Output a skill markdown file following this exact structure:

1. Frontmatter: name, category, agent, generated timestamp, effectiveness: 0.0, version: 1
2. Iron Law: one absolute rule for this category (MUST/NEVER language)
3. When This Skill Activates: task patterns that trigger it
4. Methodology: 5-8 step checklist, specific to this review category
5. Key Patterns: important code patterns to look for (cite real examples from findings if available)
6. Anti-Patterns: table of "Thought → Reality" traps
7. Quality Gate: pre-report checklist

Requirements:
- Write with authority — MUST, NEVER, NO EXCEPTIONS
- Methodology steps must be actionable, not vague
- Keep under 150 lines
- Make it portable — methodology should work on any codebase
- Key Patterns section can reference project-specific examples but the methodology itself must be universal
```

**Output:** A markdown file saved to `.gossip/agents/{agent_id}/skills/{category}.md`.

### Skill File Format

```markdown
---
name: injection-audit
category: injection_vectors
agent: gemini-reviewer
generated: 2026-03-28T16:00:00Z
effectiveness: 0.0
version: 1
---

# Injection Audit

## Iron Law

NO input path assessment without tracing from entry point to where
the input is used in prompts, queries, or command construction.

## When This Skill Activates

- Task mentions: injection, sanitization, input handling, prompt construction
- Code touches: LLM prompt assembly, SQL queries, shell commands, template rendering

## Methodology

1. **Map all entry points** — identify where external input enters the system
   (API parameters, file reads, user messages, agent outputs, config files)
2. **Trace each input path** — follow the data from entry to usage point.
   Note every transformation, validation, and boundary crossing.
3. **Check sanitization at boundaries** — at each point where data crosses
   a trust boundary, verify sanitization exists and is sufficient.
   Check: does it strip structural tokens, not just known tags?
4. **Test with adversarial input** — for each path, consider: what happens
   if the input contains the structural tokens of the consuming system?
   (e.g., XML tags in LLM prompts, semicolons in SQL, backticks in shell)
5. **Verify defense in depth** — a single sanitization point is not enough.
   Check for: input validation, output encoding, parameterized queries,
   and structural isolation (data tags, role separation).
6. **Check for indirect injection** — data that passes through storage
   (files, databases, caches) and is later used in a sensitive context.
   The sanitization must happen at the USE point, not just the WRITE point.

## Key Patterns

- LLM prompt assembly: check for raw string interpolation of external data
- Cross-review prompts: verify peer summaries are wrapped in data fences
- Gossip messages: check if team updates are sanitized before injection
- Config-driven values: verify preset names, model IDs aren't user-controlled

## Anti-Patterns

| Thought | Reality |
|---------|---------|
| "It's wrapped in XML tags" | LLMs treat XML as advisory, not structural |
| "We sanitize on input" | Input sanitization alone is insufficient; sanitize at use |
| "Only our agents produce this data" | Agent output is LLM-generated, not trusted |
| "The regex catches injection" | Regex denylists are trivially bypassed with paraphrasing |

## Quality Gate

Before reporting findings:
- [ ] Each finding cites specific file:line
- [ ] Evidence shows the actual vulnerable code path, not assumed risk
- [ ] Severity reflects exploitability, not theoretical possibility
- [ ] Recommendations are concrete (show fixed code, not "add validation")
```

### Skill Injection at Dispatch

Modify the skill loading in `dispatch-pipeline.ts` to also load agent-specific skills:

```typescript
// Existing: load team skills from .gossip/skills/
const skills = loadSkills(agentId, agentSkills, this.projectRoot);

// New: also load agent-specific skills from .gossip/agents/{id}/skills/
const agentSkillsDir = join(this.projectRoot, '.gossip', 'agents', agentId, 'skills');
if (existsSync(agentSkillsDir)) {
  const agentSkillFiles = readdirSync(agentSkillsDir).filter(f => f.endsWith('.md'));
  for (const file of agentSkillFiles) {
    skills += '\n\n' + readFileSync(join(agentSkillsDir, file), 'utf-8');
  }
}
```

### Effectiveness Tracking

After generating a skill, record the agent's current `reviewStrengths[category]` score as the baseline. After 5 subsequent dispatches where the agent reviews code in that category:

1. Read the new `reviewStrengths[category]` score
2. Compute `effectiveness = newScore - baselineScore`
3. Update the skill's frontmatter `effectiveness` field
4. If `effectiveness <= 0` after 5 dispatches, log a warning: skill needs regeneration

This is tracked in the skill file's frontmatter — no separate data store needed. The `CompetencyProfiler` already tracks per-category scores, so the comparison is a simple read.

Implementation: a `checkEffectiveness()` method on `SkillGenerator` called periodically (e.g., from `gossip_collect` post-processing, alongside category extraction).

---

## Architecture

### New Files

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `packages/orchestrator/src/skill-generator.ts` | LLM-based skill generation from templates + profiler data | ~150 |
| `tests/orchestrator/skill-generator.test.ts` | Unit tests with mocked LLM | ~100 |

### Modified Files

| File | Change |
|------|--------|
| `packages/orchestrator/src/dispatch-pipeline.ts` | Load agent-specific skills from `.gossip/agents/{id}/skills/` |
| `apps/cli/src/mcp-server-sdk.ts` | Add `gossip_develop_skill` MCP tool handler |
| `dist-mcp/mcp-server.js` | Rebuild via `npm run build:mcp` |
| `packages/orchestrator/src/index.ts` | Export `SkillGenerator` |

### MCP Tool

```typescript
// gossip_develop_skill
{
  name: 'gossip_develop_skill',
  description: 'Generate a skill file for an agent to improve performance in a specific category. Uses ATI profiler data + superpowers-quality templates.',
  inputSchema: {
    agent_id: { type: 'string', description: 'Agent to develop skill for' },
    category: { type: 'string', description: 'Category to improve (e.g., injection_vectors, concurrency, trust_boundaries)' },
  }
}
```

Returns: path to generated skill file + preview of content.

---

## Testing Strategy

### SkillGenerator (unit, mocked LLM)

- Given agent with low `injection_vectors` score + peer findings → generates skill with correct frontmatter, methodology, and anti-patterns
- Given no findings in category → generates generic methodology skill (still useful)
- Given invalid category → returns error, doesn't generate
- Generated skill is under 150 lines
- Generated skill has all required sections (Iron Law, Methodology, Anti-Patterns, Quality Gate)
- Frontmatter has correct fields (name, category, agent, generated, effectiveness: 0.0, version: 1)

### Skill Injection (unit)

- Agent-specific skill dir exists with `.md` files → files loaded into prompt
- Agent-specific skill dir doesn't exist → no error, existing behavior unchanged
- Multiple skill files → all loaded and concatenated

### Effectiveness Tracking (unit)

- Baseline recorded at generation time
- After 5 dispatches, effectiveness computed correctly
- Negative effectiveness → warning logged
- Skill regeneration flag set when effectiveness <= 0

### Integration

- Generate skill → dispatch agent → verify skill appears in agent's prompt context
- Generate skill → 5 dispatches → check effectiveness updated in frontmatter

---

## Security Constraints

- **Skill content is LLM-generated** — treat as untrusted data when injecting into prompts. Wrap in data tags or clearly delineate from system instructions.
- **No arbitrary file writes** — skills only written to `.gossip/agents/{id}/skills/`, validated path.
- **Reference templates are read-only** — the generator reads superpowers skills but never modifies them.
- **Category must be from known set** — reject unknown categories to prevent skill file name injection.

---

## Future (not in scope)

- **Auto-trigger** — automatically generate skills when profiler detects weak categories
- **Export/import registry** — publish skills to a shared registry, import from other projects
- **Project bindings** — separate portable skill from project-specific patterns as two files
- **Skill versioning** — track which version of a skill was active during which dispatches
- **Multi-category skills** — a single skill covering related categories (e.g., "input security" covering injection + validation)
