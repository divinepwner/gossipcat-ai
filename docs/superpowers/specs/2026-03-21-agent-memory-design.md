# Agent Memory System — Design Spec

> Worker agents accumulate knowledge, track task outcomes, and calibrate their own accuracy across sessions. Orchestrator writes all memories — workers never self-serve.

**Date:** 2026-03-21
**Status:** Draft
**Dependencies:** Skill Discovery System (shipped), Adaptive Team Intelligence (Phase 3, for calibration data)
**Inspiration:** Claude Code memory structure (file-per-topic + index) + crab-language warmth scoring + crab-language defeat/calibration tracking

---

## Problem Statement

Gossipcat worker agents are stateless. Every dispatch starts fresh — no knowledge of previous tasks, no awareness of their own accuracy, no accumulated project understanding. The `.gossip/agents/<id>/memory/` directory exists but is empty and unused.

This means:
- An agent that reviewed `relay/server.ts` five times learns nothing between reviews
- An agent that hallucinated file paths has no way to know it tends to do that
- Project knowledge (test patterns, architecture conventions) must be re-discovered every task

## Design Overview

Hybrid of Claude Code structure and crab-language intelligence:

```
.gossip/agents/<id>/memory/
├── MEMORY.md                  ← index (always injected into prompt)
├── knowledge/                 ← markdown, topic-based, updated in-place
│   ├── relay-server.md
│   └── test-patterns.md
├── calibration/               ← markdown, per-skill accuracy + weaknesses
│   └── accuracy.md
├── tasks.jsonl                ← JSONL, append-only, all task outcomes
└── archive.jsonl              ← cold memories evicted from tasks.jsonl
```

**Who writes memories:** The orchestrator — never the worker. After each task completes and is scored, the orchestrator extracts memory-worthy insights via a cheap LLM call, cross-references against actual code, and writes to the agent's memory directory.

**Who reads memories:** The worker — at dispatch time. The MCP server loads `MEMORY.md` + relevant knowledge files and injects them into the worker's system prompt alongside skills.

## Component 1: Memory Directory Structure

### File Purposes

| Path | Format | Purpose | Written by | Lifecycle |
|------|--------|---------|-----------|-----------|
| `MEMORY.md` | Markdown | Index of all memories — descriptions only, links to files. Always injected into prompt. Max 200 lines. | Orchestrator | Updated on every memory write |
| `knowledge/*.md` | Markdown | Accumulated project understanding. One file per topic. Updated in-place when new info arrives. | Orchestrator (distilled from task outcomes) | Long-lived, grows over time |
| `calibration/accuracy.md` | Markdown | Per-skill accuracy scores, known weaknesses, hallucination patterns. | Orchestrator (from Tier 3 scoring) | Updated after each scoring cycle |
| `tasks.jsonl` | JSONL | Every task outcome — structured data with warmth scores. Hot memories. | Orchestrator (after each task) | Append-only, oldest archived when over token budget |
| `archive.jsonl` | JSONL | Cold task memories evicted by warmth threshold. Never deleted. | Automatic (compaction) | Append-only, permanent |

### Why This Split

- **Knowledge** is markdown because it's low-volume, topic-based, human-readable, and updated in-place (like Claude Code memories)
- **Tasks** are JSONL because they're high-volume, structured, need programmatic scanning for warmth scoring, and get compacted
- **Calibration** is markdown because developers should be able to read and understand their agent's self-assessment

## Component 2: MEMORY.md — Index File

Always injected into the worker's system prompt. Contains only descriptions and pointers — not full memory content.

### Format

```markdown
# Agent Memory — gemini-reviewer

## Knowledge
- [relay-server](knowledge/relay-server.md) — auth via JSON frame, maxPayload 1MB, 4 DoS fixes applied
- [test-patterns](knowledge/test-patterns.md) — tests use tmpdir, mock fetch for providers, jest config

## Calibration
- [accuracy](calibration/accuracy.md) — security_audit: 4.2/5, code_review: 3.8/5, system_design: 2.1/5

## Recent Tasks (last 5)
- 2026-03-21: security review of relay/server.ts — found 4 bugs, 1 hallucinated
- 2026-03-21: spec review of CLI image support — flagged 3 real issues
- 2026-03-20: code review of skill-loader.ts — clean, no issues
```

### Token Budget

The index is small (~200-400 tokens). Full knowledge files are loaded selectively based on task relevance (see Component 5: Memory Injection).

## Component 3: Knowledge Files

### Format

```markdown
---
name: relay server internals
description: WebSocket relay architecture, auth, security fixes, routing
importance: 0.9
lastAccessed: 2026-03-21
accessCount: 7
---

- Relay uses initial JSON frame for auth (not URL params)
- maxPayload set to 1MB after security fix (commit 4faa386)
- Per-IP connection limit: 10, total: 500
- Auth attempts limited to 3 per connection
- PresenceTracker interval must be stopped on server.stop()
- Router stamps envelope.sid from authenticated session (prevents impersonation)
```

### Frontmatter (Warmth Metadata)

From crab-language's warmth system:

```typescript
interface MemoryFrontmatter {
  name: string;
  description: string;       // used for relevance matching
  importance: number;        // 0-1, set by orchestrator based on task outcomes
  lastAccessed: string;      // ISO date, updated on each read
  accessCount: number;       // incremented on each read
}
```

**Warmth formula:**
```
warmth = importance × (1 / (1 + daysSinceLastAccess / 30))
```

- `importance: 0.9` accessed yesterday → warmth 0.87
- `importance: 0.5` accessed 30 days ago → warmth 0.25
- `importance: 0.9` accessed 60 days ago → warmth 0.30

### Knowledge Creation

The orchestrator creates/updates knowledge files when task outcomes reveal project insights:

1. After task completes, orchestrator makes a cheap LLM call:
   ```
   Extract project knowledge from this agent's task output that would be
   useful for future tasks on the same codebase. Return only facts about
   the codebase — not opinions or recommendations.

   Agent output: {result}
   Existing knowledge files: {list of current knowledge file descriptions}

   Return JSON: { "update": "filename", "content": "..." } or { "create": "filename", "content": "..." } or { "none": true }
   ```

2. If updating: merge new facts into existing file, deduplicate
3. If creating: write new file, add to MEMORY.md index
4. Cross-reference: orchestrator can `file_read` actual source files to verify claims before writing (prevents hallucinated knowledge from persisting)

## Component 4: Task Outcomes (JSONL)

### Entry Format

```typescript
interface TaskMemoryEntry {
  taskId: string;
  task: string;                 // task description (truncated to 200 chars)
  skills: string[];             // skills active during this task
  lens?: string;                // lens focus if applied (Tier 2)
  findings: number;             // number of findings/outputs
  hallucinated: number;         // number of findings confirmed as wrong
  score: {
    relevance: number;          // 1-5 from orchestrator judgment
    accuracy: number;           // 1-5
    uniqueness: number;         // 1-5
  };
  warmth: number;               // current warmth score (updated on read)
  importance: number;           // 0-1, derived from score average
  timestamp: string;
}
```

### Importance Derivation

```typescript
// importance = normalized average of scores
const avg = (score.relevance + score.accuracy + score.uniqueness) / 3;
const importance = avg / 5; // normalize to 0-1
```

A task where the agent scored 5/5/5 gets importance 1.0. A task where it scored 2/2/2 gets importance 0.4.

### Recent Tasks in MEMORY.md

The last 5 task entries are summarized in MEMORY.md's "Recent Tasks" section. This gives the agent a quick sense of what it's been doing without loading the full JSONL.

## Component 5: Memory Injection

### At Dispatch Time

When `gossip_dispatch` or `gossip_dispatch_parallel` fires:

1. Load `MEMORY.md` (always — it's the index, ~200-400 tokens)
2. Match task text against knowledge file descriptions (keyword match, same as skill catalog)
3. Load relevant knowledge files (up to token budget)
4. Load `calibration/accuracy.md` (always — ~100 tokens)
5. Prepend to skill content:

```
--- MEMORY ---
{MEMORY.md content}

{relevant knowledge file contents}

{calibration content}
--- END MEMORY ---

--- SKILLS ---
{normal skill content}
--- END SKILLS ---
```

### Token Budget

Total memory injection budget calibrated from real API usage (no heuristic):

```typescript
interface TokenBudget {
  index: number;          // MEMORY.md — measured, typically ~200-400
  knowledge: number;      // relevant knowledge files — max ~2,000
  calibration: number;    // accuracy.md — measured, typically ~100
  total: number;          // sum, target ~2,600
}
```

**Calibration process:**
1. First 5 tasks: inject all memories, record `usage.input_tokens` from API response
2. Compare input tokens with-memory vs without-memory (baseline from skill-only prompts)
3. Derive actual tokens-per-memory ratio
4. Use ratio for budget enforcement going forward
5. Store calibration in `.gossip/agents/<id>/memory/token-calibration.json`:
   ```json
   { "avgTokensPerKnowledgeFile": 320, "indexTokens": 280, "calibrationTokens": 95, "samples": 5 }
   ```

### Knowledge File Selection

When multiple knowledge files exist but token budget is limited:

1. Score each file: `warmth × relevanceToTask`
2. Relevance: keyword overlap between task text and file `description` (same matcher as skill catalog)
3. Load files in descending score order until budget reached
4. Update `lastAccessed` and `accessCount` on loaded files

## Component 6: Calibration File

### Format

```markdown
---
name: self-calibration
description: Per-skill accuracy scores and known weaknesses for this agent
importance: 1.0
lastAccessed: 2026-03-21
accessCount: 15
---

## Accuracy by Skill (from orchestrator scoring)
- security_audit: 4.2/5 avg (12 tasks) — strong
- code_review: 3.8/5 avg (8 tasks) — good
- typescript: 3.5/5 avg (5 tasks) — adequate
- system_design: 2.1/5 avg (3 tasks) — weak

## Known Weaknesses
- Tend to hallucinate file paths when reviewing specs (not actual code)
- Miss DoS/resource exhaustion vectors unless dos_resilience skill assigned
- Overconfident on architecture recommendations with limited context

## Strengths
- Consistently find real security bugs in relay and tool-server code
- Good at cross-referencing findings across multiple files
```

### Update Mechanism

After each orchestrator scoring cycle (Adaptive Team Tier 3):
1. Read current calibration file
2. Update per-skill averages with new score data
3. If accuracy drops below 3.0 for any skill over 5+ tasks → add to "Known Weaknesses"
4. If accuracy rises above 4.0 for any skill over 5+ tasks → add to "Strengths"
5. Write updated file

The agent reads this on every dispatch — it literally knows "I'm weak at system_design" and can adjust its confidence accordingly.

## Component 7: Compaction — Warmth-Based Archival

### When Compaction Runs

Before memory injection, if `tasks.jsonl` exceeds the token budget:
1. Calculate warmth for all entries
2. Sort by warmth ascending (coldest first)
3. Move coldest entries to `archive.jsonl` until remaining entries fit budget
4. Notify: `[gossipcat] Compacted 8 memories for gemini-reviewer (3,200 → 1,800 tokens)`

### Compaction Also Triggers Knowledge Distillation

When task entries are archived, the orchestrator checks if they contain recurring patterns worth distilling into knowledge:

```
These task memories are being archived. Extract any recurring project
knowledge patterns worth preserving as long-term knowledge.

Archived entries: {entries}
Existing knowledge files: {descriptions}

Return: { "update": "filename", "additions": "..." } or { "none": true }
```

This is how knowledge files grow organically — the orchestrator notices "this agent keeps finding auth-related bugs in relay code" and distills that into `knowledge/relay-server.md`.

### Archive Format

```jsonl
{"archivedAt":"2026-04-01T...","reason":"warmth_below_threshold","warmth":0.12,"entry":{...original task entry...}}
```

Archives are permanent. They can be reviewed via `gossipcat agent-memory <id> --archive` but are never loaded into prompts.

## Component 8: Orchestrator Memory Writer

### Integration Point

In `gossip_collect` handler, after building results and scoring (Tier 3 async):

```typescript
// After scoring completes (async, non-blocking):
async function writeAgentMemory(agentId: string, task: string, result: string, score: AgentScore) {
  const memoryDir = join(process.cwd(), '.gossip', 'agents', agentId, 'memory');

  // 1. Append task outcome to tasks.jsonl
  const entry: TaskMemoryEntry = {
    taskId: score.taskId,
    task: task.slice(0, 200),
    skills: score.skills,
    findings: countFindings(result),
    hallucinated: 0, // updated later by outcome tracking
    score: score.scores,
    warmth: 1.0, // fresh = max warmth
    importance: (score.scores.relevance + score.scores.accuracy + score.scores.uniqueness) / 15,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(join(memoryDir, 'tasks.jsonl'), JSON.stringify(entry) + '\n');

  // 2. Extract knowledge (cheap LLM call)
  const knowledgeUpdate = await extractKnowledge(result, memoryDir);
  if (knowledgeUpdate) applyKnowledgeUpdate(memoryDir, knowledgeUpdate);

  // 3. Update calibration
  updateCalibration(memoryDir, agentId, score);

  // 4. Update MEMORY.md index
  rebuildIndex(memoryDir);

  // 5. Check compaction threshold
  await compactIfNeeded(memoryDir);
}
```

### Cost

Per task completion:
- 1 JSONL append (free)
- 1 cheap LLM call for knowledge extraction (~300 tokens in, ~100 out)
- 1 file read/write for calibration update (free)
- 1 index rebuild (free)
- Occasional compaction LLM call when archiving (~500 tokens)

Total: ~$0.0001 per task. Negligible.

## Files Changed/Created

| File | Action | Component |
|------|--------|-----------|
| `packages/orchestrator/src/agent-memory.ts` | Create | Memory reader: load index, select knowledge files, inject into prompt |
| `packages/orchestrator/src/memory-writer.ts` | Create | Orchestrator memory writer: task entries, knowledge extraction, calibration |
| `packages/orchestrator/src/memory-compactor.ts` | Create | Warmth calculation, archival, knowledge distillation |
| `packages/orchestrator/src/types.ts` | Edit | Add TaskMemoryEntry, MemoryFrontmatter, TokenBudget types |
| `apps/cli/src/mcp-server-sdk.ts` | Edit | Load memory at dispatch, write memory at collect |
| `packages/orchestrator/src/worker-agent.ts` | Edit | Accept memory content in system prompt (same pattern as skills) |
| `tests/orchestrator/agent-memory.test.ts` | Create | Memory loading, knowledge selection, token budget tests |
| `tests/orchestrator/memory-writer.test.ts` | Create | Task entry writing, knowledge extraction, calibration update tests |
| `tests/orchestrator/memory-compactor.test.ts` | Create | Warmth calculation, archival threshold, distillation tests |

## Reviewer Fixes

### Fix 1: Knowledge file write concurrency

`tasks.jsonl` is append-only — concurrent writes are safe under single-process MCP server serialization (same as `skill-gaps.jsonl`).

Knowledge files (`knowledge/*.md`) are read-modify-write — concurrent updates could clobber. Fix: the memory writer holds a simple per-agent in-memory lock (Map<agentId, Promise>) that serializes knowledge writes. No file locking needed since the MCP server is single-process.

```typescript
const memoryLocks = new Map<string, Promise<void>>();

async function withMemoryLock(agentId: string, fn: () => Promise<void>): Promise<void> {
  const prev = memoryLocks.get(agentId) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run after previous completes, even if it failed
  memoryLocks.set(agentId, next);
  await next;
}
```

### Fix 2: Cold start handling

When an agent's memory directory is empty (first dispatch):
- `MEMORY.md` doesn't exist → skip memory injection, prompt uses skills only
- Memory writer creates the directory structure on first write
- No errors, no special handling — graceful absence

### Fix 3: Memory review CLI command

Developers can review, edit, or delete agent memories:
```
gossipcat agent-memory <id>             # show MEMORY.md index
gossipcat agent-memory <id> --knowledge # list knowledge files with warmth
gossipcat agent-memory <id> --tasks     # show recent task entries
gossipcat agent-memory <id> --archive   # show archived cold memories
gossipcat agent-memory <id> --reset     # clear all memories (with confirmation)
```

This prevents memory poisoning — if a hallucinated fact gets written to knowledge, the developer can spot and remove it.

### Fix 4: Compaction failure fallback

If the LLM call for knowledge distillation during compaction fails:
1. Log warning: `[gossipcat] Knowledge distillation failed for <agentId>: <error>`
2. Archive the cold entries anyway (move to `archive.jsonl`)
3. Do NOT block compaction on distillation — archival is the critical path
4. Retry distillation on next compaction cycle

### Fix 5: Memory version field

Add `version: 1` to `tasks.jsonl` entries and knowledge file frontmatter. When the schema changes, the reader checks version and migrates old entries on read (lazy migration, not bulk).

## Security Constraints

- **Orchestrator writes, workers read** — workers cannot modify their own memories (prevents self-serving/hallucinated memories)
- **Knowledge is cross-referenced** — orchestrator can verify claims against actual source files before writing
- **Calibration is honest** — based on orchestrator scoring, not self-assessment
- **Archives are immutable** — cold memories are never modified, only appended
- **No PII in memories** — task descriptions are truncated, no user data stored

## Testing Strategy

- **Memory loading:** Unit test — given memory dir with index + knowledge files, verify correct injection format and token budget enforcement
- **Knowledge selection:** Unit test — given task text and knowledge file descriptions, verify warmth × relevance ranking
- **Task entry writing:** Unit test — verify JSONL format, importance derivation, warmth initialization
- **Knowledge extraction:** Unit test with mocked LLM — verify update vs create vs none decisions
- **Calibration update:** Unit test — verify per-skill average calculation, weakness detection threshold
- **Warmth calculation:** Unit test — verify decay formula with various importance/recency combinations
- **Compaction:** Unit test — verify coldest entries archived first, token budget respected
- **Token calibration:** Unit test — verify calibration from API usage data over 5 samples
- **Integration:** Dispatch agent → collect → verify memory written → dispatch again → verify memory injected into prompt
