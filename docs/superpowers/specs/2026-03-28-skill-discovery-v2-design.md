# Skill Discovery v2 — Design Spec

> Agents discover skill gaps → orchestrator generates skills → dispatch uses them → performance tracks per-skill accuracy.

**Date:** 2026-03-28
**Status:** Reviewed
**Supersedes:** 2026-03-21-skill-discovery-design.md
**Reviewed by:** sonnet-reviewer, haiku-researcher, gemini-reviewer (3-agent consensus)

---

## Problem Statement

The skill discovery pipeline is 60% built but disconnected:

1. **Skeletons are useless** — `checkAndGenerate()` produces TODO templates no one fills
2. **SkillCatalog is blind to project skills** — only reads hardcoded `catalog.json`, ignores `.gossip/skills/`
3. **Dispatch can't use new skills** — `findBestMatchExcluding()` scores 0 for skills not in `agent.skills[]`
4. **Performance is skill-blind** — `AgentScore.accuracy` is global; an agent great at security but bad at implementation gets one number
5. **Existing bugs** — `generateSkeleton()` overwrites human edits, skill name `_` vs `-` causes silent misses, `MAX_SCAN_LINES=500` can miss resolutions, `SkillCatalog.validate()` converts kebab→underscore creating false positives

## Design Overview

```
Agent calls suggest_skill() during task
         ↓
Appends to .gossip/skill-gaps.jsonl
         ↓
gossip_collect() → checks thresholds
         ↓
Threshold hit (3+ suggestions, 2+ agents)
         ↓
collect() response includes: "N skills ready to build"
         ↓
Claude Code calls gossip_build_skills(skill_names?)
         ↓
MCP tool reads gap data, Claude Code generates content,
tool writes .md file + records resolution (single atomic call)
         ↓
SkillCatalog hot-reloads from .gossip/skills/
         ↓
Next dispatch: AgentRegistry uses new skill in matching
         ↓
Phase 2: per-skill performance scoring
```

---

## Phase 1: Skill Generation + Dispatch Integration

### 1.1 Skill File Format

Location: `.gossip/skills/{name}.md`

```markdown
---
name: dos-resilience
description: Review code for DoS vectors — unbounded payloads, missing rate limits, resource exhaustion, queue backpressure.
keywords: [dos, rate-limit, payload, backpressure, resource-exhaustion, unbounded]
generated_by: orchestrator
sources: 3 suggestions from sonnet-reviewer, haiku-researcher
status: active
---

# DoS Resilience

## Approach
1. Check HTTP endpoints for payload size limits (body, query, headers)
2. Verify rate limiting on public-facing routes
3. Look for unbounded allocations (arrays, buffers, streams without limits)
4. Check queue/worker patterns for backpressure handling
5. Verify timeout configuration on external calls

## Output
For each finding: file:line, severity (critical/high/medium/low), specific remediation.

## Don't
- Flag internal-only endpoints without justification
- Suggest rate limits without considering the use case
- Report theoretical DoS on endpoints behind auth + rate limits
```

**Frontmatter fields:**
- `name` (string, kebab-case) — canonical skill identifier
- `description` (string) — human-readable purpose, shown in agent prompts
- `keywords` (string[]) — explicit terms for task matching. More predictable than auto-extraction from description. Gives skill author precise control over when the skill is matched.
- `generated_by` (string) — `"orchestrator"` or `"manual"`
- `sources` (string) — traceability to gap suggestions
- `status` (`"active"` | `"draft"` | `"disabled"`) — disabled skills skipped in matching

**Design decision (from gemini-reviewer):** Explicit `keywords` array instead of auto-extracting from description. Decouples descriptive prose from matching logic, avoids stop-word filtering ambiguity.

### 1.2 MCP Tool: `gossip_build_skills`

**Purpose:** Atomic tool that reads pending skill gaps, accepts generated content from Claude Code, writes files, and records resolutions in a single call.

**Design decision (from gemini-reviewer):** Single atomic tool instead of two-step (build + save). A failure between two steps would leave inconsistent state. The single tool encapsulates the full workflow.

**Input:**
```typescript
{
  skill_names?: string[];  // Optional filter — build specific skills, not all
}
```

**Behavior:**

**When called without content (discovery mode):**
1. Read `.gossip/skill-gaps.jsonl` for pending skills at threshold
2. If `skill_names` provided, filter to only those skills
3. Return structured gap data to Claude Code:
   ```
   Skills ready to build: 2

   1. dos-resilience
      Suggestions:
      - sonnet-reviewer: "no maxPayload on WebSocket handler" (task: security review of relay)
      - haiku-researcher: "unbounded queue in dispatch pipeline" (task: architecture review)
      - sonnet-reviewer: "no rate limiting on public endpoints" (task: API review)

   2. memory-optimization
      ...

   Generate each skill as markdown with frontmatter (name, description, keywords, status: active)
   and body (Approach, Output, Don't). Then call gossip_build_skills again with the skills array.
   ```

**When called with content (save mode):**
```typescript
{
  skills: Array<{
    name: string;       // kebab-case
    content: string;    // full .md content with frontmatter
  }>;
}
```
1. For each skill: validate frontmatter, run overwrite protection (§1.3)
2. Write to `.gossip/skills/{name}.md`
3. Record resolution in `.gossip/skill-resolutions.json`
4. Return confirmation with file paths

This keeps Claude Code in the loop while being a single logical tool with two modes.

### 1.3 Overwrite Protection

**Bug found by sonnet-reviewer:** `generateSkeleton()` uses `writeFileSync` with no guard — overwrites human-edited files. Old skeletons have no frontmatter, making protection logic unreadable.

**Fix:**
- **Deprecate `generateSkeleton()`** — remove from `checkAndGenerate()`. The `gossip_build_skills` path replaces it entirely. `checkAndGenerate()` becomes `checkThresholds()` — only returns pending skill count, never writes files.
- Before writing in `gossip_build_skills`:
  - If file exists and has `status: "active"` or `status: "disabled"` → skip, warn Claude Code
  - If file exists with no frontmatter (old skeleton) → overwrite is safe (it was a TODO template)
  - If file exists with `generated_by: "manual"` → skip, warn Claude Code
  - If file exists with `status: "draft"` → overwrite (still a draft)
  - If file doesn't exist → write

### 1.4 Skill Name Normalization

**Bug found by sonnet-reviewer:** `_` vs `-` causes silent dispatch misses. `agent.skills.includes(s)` is exact match. Additionally, `SkillCatalog.validate()` at line 57 converts kebab→underscore, producing false positives after normalization.

**Fix:** Canonical form is **kebab-case** everywhere.

Add a shared `normalizeSkillName(name: string): string` utility:
```typescript
export function normalizeSkillName(name: string): string {
  return name.toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]/g, '');
}
```

**Normalization sites (all code paths):**
- `SkillGapTracker`: normalize on write (`security_audit` → `security-audit`)
- `SkillCatalog`: normalize on load (both default and project)
- `SkillCatalog.validate()`: fix kebab→underscore conversion at line 57 to use normalized names
- `SkillCatalog.checkCoverage()`: normalize both sides before comparison
- `AgentRegistry.findBestMatchExcluding()`: normalize both sides before comparison
- `gossip_setup`: normalize skills in config.json
- `configToAgentConfigs()` / `loadConfig()`: normalize on config read (not just write-time)

### 1.5 SkillCatalog: Merge Default + Project Skills

**Current:** `SkillCatalog` constructor loads only `catalog.json` from package source. `skillsDir` is hardcoded to `__dirname` (skill-catalog.ts:25), ignoring `catalogPath` for directory scanning.

**Change:**
- Constructor takes required `projectRoot` parameter (in addition to optional `catalogPath`)
- Separate `defaultSkillsDir` (package `__dirname/default-skills`) from `projectSkillsDir` (`projectRoot/.gossip/skills/`)
- On load: read `catalog.json` (default skills), then scan `.gossip/skills/*.md` (project skills)
- Parse frontmatter from `.md` files using `skill-parser.ts` to extract `CatalogEntry` fields
- Project skills override defaults by name (more specific)
- Add `source: 'default' | 'project'` to `CatalogEntry`
- Hot-reload: check individual file mtimes in `.gossip/skills/` (not just directory mtime — macOS doesn't update dir mtime on content edits, only on add/delete)
- Fix `validate()` to use normalized names and scan both directories

```typescript
interface CatalogEntry {
  name: string;
  description: string;
  keywords: string[];
  categories: string[];
  source: 'default' | 'project';
}
```

### 1.6 Dispatch Integration

**Current formula:** `score = skillOverlap × perfWeight`
**Problem:** New project skills score 0 because they're not in `agent.skills[]` yet.

**New formula:**
```
score = (staticOverlap + projectMatchBoost + suggesterBoost) × perfWeight
```

Where:
- `staticOverlap` = count of matching skills from `agent.skills[]` (existing behavior, normalized)
- `projectMatchBoost` = 0.5 for each project skill whose keywords match the task text (via `SkillCatalog.matchTask()`). Applied to ALL agents — any agent can handle a project skill.
- `suggesterBoost` = 0.3 if this agent suggested the skill (looked up from gap log cache)
- `perfWeight` = existing 0.5-1.5 from `PerformanceReader`

**Key insight from sonnet-reviewer:** The boost MUST be additive, not multiplicative. `0 × anything = 0`, so a pure multiplicative approach can never surface agents for skills they don't formally have.

**Implementation in `AgentRegistry`:**
1. `findBestMatchExcluding()` receives optional `taskText` parameter and `SkillCatalog` reference
2. If `taskText` provided, call `catalog.matchTask(taskText)` to get project skill matches
3. For each matched project skill, add `projectMatchBoost` (0.5) to ALL non-excluded agents
4. Check suggester cache for additional `suggesterBoost` (0.3)
5. Multiply total by `perfWeight`

**Suggester cache:**
- `AgentRegistry` holds a `suggesterCache: Map<string, Set<string>>` (skill → agent IDs who suggested it)
- Loaded from `.gossip/skill-gaps.jsonl` once on first dispatch, invalidated on file mtime change (same pattern as `PerformanceReader`)
- Cheap: gap log is small, read once per session

**Pre-dispatch step in `DispatchPipeline.dispatch()`:**
- Pass `task` text to `findBestMatchExcluding()` alongside `requiredSkills`

### 1.7 Collect Response: Skill-Ready Signal

**Bug found by sonnet-reviewer:** No `CollectResult.skillsReady` field exists. `collect()` discards `getSuggestionsSince()` return value.

**Fix:** Add to `CollectResult` type:
```typescript
interface CollectResult {
  // ... existing fields ...
  skillsReady?: number;  // count of skills at threshold, ready for gossip_build_skills
}
```

In `gossip_collect` MCP handler, after building the response:
1. Call `gapTracker.checkThresholds()` (renamed from `checkAndGenerate()` — no longer writes files)
2. If pending > 0, append to response text:
   ```
   🔧 2 skills ready to build. Call gossip_build_skills() to generate them.
   ```
3. Remove the dead `getSuggestionsSince()` call

### 1.8 Gap Log Fixes

**Bug: `MAX_SCAN_LINES=500` misses resolutions**
- **Solution:** Separate `.gossip/skill-resolutions.json` file — simple object: `{ [skillName]: timestamp }`
- O(1) lookup, immune to log growth, no scanning edge cases
- **Migration:** On first run, if `skill-resolutions.json` doesn't exist, scan FULL `skill-gaps.jsonl` for existing `GapResolution` entries and backfill. Write the resolutions file. This prevents re-triggering already-resolved skills on upgrade.

**Bug: `truncateIfNeeded()` only runs in `generateSkeleton()`**
- Move truncation to `checkThresholds()` (runs unconditionally on every collect)
- Also add truncation check in `SkillTools.suggestSkill()` as a safety net

**Bug: `collect()` discards `getSuggestionsSince()` return value**
- Remove the dead call. Replace with `checkThresholds()` that returns pending count.

### 1.9 Deprecate `generateSkeleton()`

**Bug found by sonnet-reviewer:** Old skeletons have no frontmatter — overwrite protection can't read `generated_by` or `status`. The two code paths (`generateSkeleton` + `gossip_build_skills`) create confusion.

**Fix:**
- Remove `generateSkeleton()` from `SkillGapTracker`
- Rename `checkAndGenerate()` → `checkThresholds()` — returns `{ pending: string[]; count: number }` without writing any files
- All skill file creation happens through `gossip_build_skills` MCP tool
- `shouldGenerate()` renamed to `isAtThreshold()` for clarity

---

## Phase 2: Per-Skill Performance Scoring

### 2.1 Signal Schema

**Key finding by haiku-researcher:** `ConsensusSignal` already has an optional `skill?` field (consensus-types.ts:59). It's just never populated.

**Change:** When consensus-engine creates signals, extract skill context from the task:
1. Look up `taskId` → `TaskCreatedEvent.skills[]` (via TaskGraph)
2. Also run `SkillCatalog.matchTask(taskDescription)` to include project skill matches
3. Set `signal.skill = matchedSkill` (the primary skill relevant to the finding)
4. If multiple skills match, pick the most specific (project > default)

**Where:** `ConsensusEngine.synthesize()` and `gossip_record_signals` MCP tool (for native agent synthesis).

### 2.2 PerformanceReader: Per-Skill Scores

```typescript
interface AgentScore {
  // ... existing global fields unchanged ...
  skillScores?: Map<string, {
    accuracy: number;
    uniqueness: number;
    reliability: number;
    totalSignals: number;
  }>;
}
```

**In `computeScores()`:**
- For signals with `skill` field: update both global AND per-skill scores
- For signals without `skill` field: update global only (backward compatible)
- Per-skill `reliability = accuracy * 0.7 + uniqueness * 0.3` (same formula)
- `skillScores` is optional (`Map` or `undefined`) — backward compatible with existing consumers

### 2.3 Dispatch Weight: Skill-Specific

**Design decision (from haiku-researcher):** Multiplicative per-skill boost (0.8-1.2 range), not additive or replacement. Preserves redundancy penalization, gentle on cold-start.

New method:
```typescript
getSkillDispatchWeight(agentId: string, skill: string): number {
  const score = this.getAgentScore(agentId);
  if (!score) return 1.0;

  // Per-skill score if enough data (min 5 signals)
  const skillScore = score.skillScores?.get(skill);
  if (skillScore && skillScore.totalSignals >= 5) {
    return 0.5 + skillScore.reliability;
  }

  // Fall back to global (min 3 signals)
  if (score.totalSignals >= 3) {
    return 0.5 + score.reliability;
  }

  return 1.0; // cold start — neutral
}
```

**Integration in `AgentRegistry.findBestMatchExcluding()`:**
- For each matched skill, use `getSkillDispatchWeight(agentId, skill)` instead of global `getDispatchWeight(agentId)`
- Average across matched skills if multiple
- Keep global `getDispatchWeight()` method — Phase 2 adds `getSkillDispatchWeight()` alongside it, doesn't replace

### 2.4 Cold-Start Handling

| Scenario | Behavior |
|----------|----------|
| New skill, new agent | Neutral (1.0) |
| New skill, experienced agent | Global reliability as proxy |
| Established skill, new agent | Neutral until 5 per-skill signals |
| Established skill, experienced agent | Per-skill weight |

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `packages/orchestrator/src/skill-name.ts` | `normalizeSkillName()` utility |
| `packages/orchestrator/src/skill-parser.ts` | Parse frontmatter from `.gossip/skills/*.md` |

### Modified Files
| File | Changes |
|------|---------|
| `apps/cli/src/mcp-server-sdk.ts` | Add `gossip_build_skills` MCP tool (single tool, two modes). Add `skillsReady` to collect response. |
| `packages/orchestrator/src/skill-catalog.ts` | Accept `projectRoot`, load project skills from `.gossip/skills/`, hot-reload via file mtimes, add `source` to `CatalogEntry`, fix `validate()` normalization |
| `packages/orchestrator/src/skill-gap-tracker.ts` | Deprecate `generateSkeleton()`, rename `checkAndGenerate()` → `checkThresholds()`, separate resolutions file with migration, normalize names, fix truncation |
| `packages/orchestrator/src/agent-registry.ts` | Accept `taskText` + `SkillCatalog` in `findBestMatchExcluding()`, add project match boost + suggester boost (additive), suggester cache |
| `packages/orchestrator/src/dispatch-pipeline.ts` | Pre-dispatch skill matching, pass taskText to registry, wire skillsReady into collect, remove dead `getSuggestionsSince()` call |
| `packages/orchestrator/src/performance-reader.ts` | Per-skill scores in `AgentScore` (optional Map), `getSkillDispatchWeight()` method (Phase 2) |
| `packages/orchestrator/src/consensus-engine.ts` | Populate `skill` field on signals during synthesis (Phase 2) |
| `packages/tools/src/skill-tools.ts` | Add truncation check on suggest_skill path |
| `packages/orchestrator/src/types.ts` | Update `CatalogEntry`, `CollectResult` types |

---

## Testing Strategy

### Phase 1
1. **Skill generation e2e**: suggest_skill 3x from 2 agents → collect → gossip_build_skills → verify .md written with correct frontmatter
2. **Overwrite protection**: generate skill, manually edit to `generated_by: manual`, re-trigger → verify no overwrite + warning returned
3. **Overwrite protection (no frontmatter)**: old skeleton file with no frontmatter → overwrite is allowed (was a TODO template)
4. **Catalog merge**: default + project skills loaded, project overrides default by name
5. **Dispatch integration**: new project skill matches task text → agent selected despite not having skill in config
6. **Name normalization**: `security_audit` and `security-audit` treated as identical in gap tracker, catalog, registry, config, and validate()
7. **Resolutions file migration**: existing project with GapResolution in JSONL → first run backfills resolutions.json → skills not re-triggered
8. **gossip_build_skills idempotency**: called twice for same skill → second call skips (already active), no duplicate resolution
9. **gossip_build_skills filter**: called with `skill_names: ["dos-resilience"]` → only that skill returned, others pending
10. **All agents excluded**: all agents in exclude set + project skill present → returns null (not accidental selection)

### Phase 2
11. **Per-skill signals**: consensus round → signals have skill field populated from task skills
12. **Per-skill dispatch weight**: agent with high security accuracy preferred for security tasks over agent with high global but low security accuracy
13. **Cold-start**: new skill defaults to global reliability, transitions to per-skill after 5 signals
14. **Backward compat**: old signals without skill field → only update global scores, no error

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Claude Code doesn't call `gossip_build_skills` | Clear message in collect response + rules file instruction |
| Skill content quality varies | User can edit .md files; `status: draft` until reviewed |
| Gap log grows unbounded | Truncation in `checkThresholds()` + `suggestSkill()`, separate resolutions file |
| Per-skill data too sparse | Fall back to global; min 5 signals before trusting per-skill |
| Name collisions (project vs default) | Project wins by convention; warn in logs |
| Upgrade re-triggers resolved skills | Migration step: backfill resolutions.json from JSONL on first run |
| macOS dir mtime misses file edits | Track individual file mtimes, not directory mtime |

---

## Out of Scope

- Remote skill registry / npm distribution (deferred)
- Automatic skill assignment to agents (manual via config for now; dispatch boost handles routing)
- Skill versioning / changelog
- Cross-project skill sharing
