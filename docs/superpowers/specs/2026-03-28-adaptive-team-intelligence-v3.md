# Adaptive Team Intelligence v3 — Design Spec

> The orchestrator learns what agents are actually good at from their performance data, uses that to make smarter dispatch decisions, differentiate overlapping agents, and optimize for token cost — getting smarter with every dispatch cycle.

**Date:** 2026-03-28
**Status:** Ready for implementation (Phase 1: Scoring + Dynamic Prompts)
**Supersedes:** `2026-03-23-adaptive-team-intelligence-v2.md`
**Dependencies:** Consensus Protocol (shipped), Skill Discovery (shipped), Citation Verification (shipped today)
**Reviewed by:** 5-agent consensus (sonnet-reviewer, haiku-researcher, gemini-reviewer, gemini-tester, gemini-implementer) across correctness, security, efficiency, testability, implementability. Findings incorporated below.

---

## What Changed from v2

| Aspect | v2 | v3 |
|--------|----|----|
| Agent differentiation | LLM-generated lenses from declared skills | Learned competency profiles from consensus data |
| Implementation scoring | Deferred | Phase 1 — verify_write signals feed profiles |
| Cost awareness | None | Cost-effectiveness ratio in dispatch scoring |
| Self-improvement | Deferred to Tier 3 | Continuous — profiles update every collect cycle |
| Category extraction | Not designed | Automatic from confirmed finding text |
| Consensus gating | All-or-nothing | Selective — skip for high-confidence low-stakes tasks |

---

## Problem Statement

The orchestrator dispatches agents based on declared skills and a flat reliability score. This misses three things:

1. **Declared skills don't reflect actual competency.** An agent declared as `security_audit` may be strong on input validation but weak on trust boundaries. Only consensus outcomes reveal this.
2. **Implementation quality is invisible.** The system scores review quality (via consensus) but not implementation quality (test pass rates, peer approval, iteration count).
3. **Token cost is ignored.** A $0.05/task agent that finds 10 issues and a $0.01/task agent that finds 6 have different cost-effectiveness ratios. The orchestrator should factor this in.

---

## Design Overview — Two Phases

```
Phase 1 (this spec):
  Competency profiles + implementation scoring + cost-aware dispatch + dynamic differentiation

Phase 2 (future):
  Self-restructuring — propose team changes, create/retire agents, adjust configs
```

---

## 1. Competency Profile

The core data structure that replaces the flat `AgentScore` in `performance-reader.ts`.

```typescript
interface CompetencyProfile {
  agentId: string;

  // Review competencies — learned from consensus
  reviewStrengths: Record<string, number>;   // category → score (0-1)
  // reviewWeaknesses: DEFERRED to Phase 2
  //   Requires "missed finding" attribution (comparing co-dispatched agents'
  //   outputs to identify categories where an agent produced no findings but
  //   peers did). Needs its own signal type (e.g., `category_miss`) and a
  //   concrete algorithm for attributing misses fairly. Too complex for Phase 1.

  // Implementation competencies — learned from verify_write
  implPassRate: number;       // first-try test pass rate (0-1)
  implIterations: number;     // avg tool turns per task
  implPeerApproval: number;   // peer review approval rate (0-1)

  // Meta
  speed: number;              // avg completion time in ms
  hallucinationRate: number;  // fabricated citations / total disputes
  avgTokenCost: number;       // avg token cost per task
  totalTasks: number;         // count of task_completed signals (not totalSignals)

  // Overall
  reviewReliability: number;  // computed from review signals
  implReliability: number;    // computed from impl signals
}
```

Finding categories (e.g., `trust_boundaries`, `input_validation`, `concurrency`) are extracted from confirmed finding text, not pre-defined. Categories emerge from what agents actually find.

**Where it lives:** In-memory only. Computed from `agent-performance.jsonl` on boot and refreshed when the JSONL file's mtime changes (same pattern as `PerformanceReader`'s existing cache at `performance-reader.ts:47-49`). **Not cached to disk** — this prevents tampering with a `.gossip/agent-profiles.json` file between boots and eliminates race conditions from concurrent profile writes.

---

## 2. Signal Collection

### Review Signals (exist today, need categorization)

| Signal | Source | Profile Effect |
|--------|--------|----------------|
| `agreement` | consensus cross-review | +strength in finding's category |
| `disagreement` | consensus cross-review | -strength in disputed category |
| `unique_confirmed` | consensus synthesis | +strength, big boost |
| `unique_unconfirmed` | consensus synthesis | +strength, small boost |
| `new_finding` | consensus cross-review | +uniqueness, +strength in finding's category |
| `hallucination_caught` | detectHallucination / verifyCitations | +hallucinationRate |

> **Note:** `fabricated_citation` is an `outcome` field value on `hallucination_caught` signals, not a separate signal type. The profiler must check `signal === 'hallucination_caught' && outcome === 'fabricated_citation'` to distinguish keyword-detected hallucinations from citation-verified ones. Both increment `hallucinationRate`.

### Implementation Signals (new — must be wired)

| Signal | Source | Profile Effect |
|--------|--------|----------------|
| `impl_test_pass` | verify_write test result | +implPassRate |
| `impl_test_fail` | verify_write test result | -implPassRate |
| `impl_peer_approved` | verify_write peer review | +implPeerApproval |
| `impl_peer_rejected` | verify_write peer review | -implPeerApproval |

> **Wiring requirement:** `ToolServer.handleVerifyWrite()` currently returns a formatted string and has no connection to `PerformanceWriter`. Implementation must:
> 1. Pass a `PerformanceWriter` instance to `ToolServer` via constructor injection
> 2. After `handleVerifyWrite()` determines test pass/fail (line 322: `testStatus`), emit `impl_test_pass` or `impl_test_fail`
> 3. After peer review response is received (line 316: `reviewResult`), parse approval/rejection and emit `impl_peer_approved` or `impl_peer_rejected`
> 4. These signals use a new type discriminant `type: 'impl'` (not `type: 'consensus'`) to avoid polluting the `ConsensusSignal` union — see Signal Types section below.
>
> **Deferred to Phase 2:** `impl_bug_attributed` (reviewer finds bug in agent's code → attribute back to implementer). This requires cross-task attribution logic that is not yet designed.

### Meta Signals (new)

| Signal | Source | Profile Effect |
|--------|--------|----------------|
| `task_completed` | worker-agent completion | +totalTasks, speed |
| `task_tool_turns` | worker-agent loop count | implIterations |

All new signal types are appended to `agent-performance.jsonl` using `PerformanceWriter`.

### Signal Types

Implementation and meta signals cannot share the `ConsensusSignal` interface (which is typed `type: 'consensus'`). Instead, introduce a discriminated union:

```typescript
// consensus-types.ts
type PerformanceSignal = ConsensusSignal | ImplSignal | MetaSignal;

interface ImplSignal {
  type: 'impl';
  signal: 'impl_test_pass' | 'impl_test_fail' | 'impl_peer_approved' | 'impl_peer_rejected';
  agentId: string;
  taskId: string;
  evidence?: string;
  timestamp: string;
}

interface MetaSignal {
  type: 'meta';
  signal: 'task_completed' | 'task_tool_turns';
  agentId: string;
  taskId: string;
  value?: number;   // tool turn count or completion time in ms
  timestamp: string;
}
```

`PerformanceWriter.appendSignals()` accepts `PerformanceSignal[]`. `PerformanceReader` / `CompetencyProfiler` reads all three types from the same JSONL file and dispatches by `type` field.

### Category Extraction

When a finding is confirmed in consensus, extract categories from the finding text using keyword clustering:

```typescript
// category-extractor.ts
const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  trust_boundaries: [/trust.?boundar/i, /authenticat/i, /authoriz/i, /impersonat/i],
  injection_vectors: [/inject/i, /sanitiz/i, /escape/i, /xss/i, /sql.?inject/i],
  input_validation: [/validat/i, /input.?check/i, /type.?guard/i, /schema/i],
  concurrency: [/race.?condition/i, /deadlock/i, /atomic/i, /concurrent/i, /mutex/i],
  resource_exhaustion: [/dos\b/i, /unbounded/i, /memory.?leak/i, /exhaust/i, /timeout/i],
  type_safety: [/type.?safe/i, /typescript/i, /type.?narrow/i, /any\[\]/i],
  error_handling: [/error.?handl/i, /exception/i, /fallback/i, /try.?catch/i],
  data_integrity: [/data.?corrupt/i, /integrity/i, /consistency/i, /idempoten/i],
};

function extractCategories(findingText: string): string[];
```

Categories not in the predefined map are ignored (conservative approach). The map can grow over time based on what agents actually find.

### Anti-Gaming Measures

**Agreement anomaly detection:** A single agent's agreements are weighted by peer diversity. If agent A agrees with agent B on >90% of findings across 10+ tasks, agreements between them are discounted:

```typescript
const peerDiversity = uniquePeersAgreedWith / totalAgentsInTeam;
const agreementWeight = SIGNAL_WEIGHTS.agreement.accuracy * peerDiversity;
// Minimum diversity: 0.3 (agrees with at least 30% of team)
```

This prevents colluding agents from inflating each other's scores via mutual agreement.

**Category extraction from consensus, not original findings:** Categories are extracted from findings that have been *confirmed by peers* (appear in `ConsensusReport.confirmed`), not from the originating agent's raw output. This prevents an agent from injecting category keywords into its own findings to inflate `reviewStrengths` in unearned categories.

**Score ceiling per round:** No single consensus round can move an agent's accuracy by more than ±0.3, regardless of how many agree/disagree signals are emitted. This bounds the impact of any single compromised session.

### Score Decay

Older signals weight less than recent ones. Exponential decay with a half-life of 50 tasks:

```typescript
const weight = Math.pow(0.5, tasksSinceSignal / 50);
```

This ensures the profile reflects current agent performance, not stale history.

---

## 3. Dispatch Intelligence

### Agent Selection

Today: `(skillOverlap + projectBoost + suggesterBoost) * perfWeight`

With ATI, task-type-aware scoring:

```typescript
// For review tasks (detected from task text verbs):
profileMultiplier = reviewReliability * (1 - hallucinationRate) * costEfficiency;

// For implementation tasks:
profileMultiplier = implReliability * implPassRate * costEfficiency;

// Clamp profileMultiplier to 0.5-1.5 (matching current system's range)
profileMultiplier = clamp(profileMultiplier, 0.5, 1.5);

// Final score (same structure as today, just with richer multiplier):
taskScore = (skillOverlap + projectBoost + suggesterBoost) * profileMultiplier;
```

**Cost-effectiveness (division-safe):**
```typescript
// costEfficiency defaults to 1.0 when:
//   - agent has < 10 completed tasks (cold start)
//   - avgTokenCost is 0 (no cost data yet)
//   - median team cost is 0 (single agent)
// Otherwise:
costEfficiency = clamp(reliability / (avgTokenCost / medianTeamCost), 0.5, 1.5);
```

Task type detection reuses the existing verb classification in `classifyWriteModes` (action verbs = impl, observation verbs = review).

**Minimum data threshold:** No profile-based scoring until agent has 10+ `task_completed` signals (not `totalSignals` — these are different metrics). Below that, `profileMultiplier = 1.0`. This supersedes the current `PerformanceReader.getDispatchWeight` threshold of 3 signals — the new threshold is higher because profiles require more data to be meaningful.

### Prompt Differentiation

When 2+ agents are co-dispatched with overlapping skills, generate differentiation from their profiles:

```typescript
// dispatch-differentiator.ts
function generateDifferentiation(
  agents: CompetencyProfile[],
  task: string,
): Map<string, string>;  // agentId → differentiation prompt
```

This is deterministic (no LLM call) — it reads each agent's `reviewStrengths` and assigns focus areas accordingly:

```
Agent A (strong: trust_boundaries, injection_vectors):
  → "Focus your review on trust boundaries and injection vectors.
     Other aspects are covered by your peers."

Agent B (strong: input_validation, type_safety):
  → "Focus your review on input validation and type safety.
     Other aspects are covered by your peers."
```

**Privacy rule:** Differentiation prompts must NOT:
- Name other agents or reveal their identities
- Reveal peer strengths or weaknesses
- Expose profile scores or metrics

Each agent only sees its own focus assignment. This prevents adversarial agents from exploiting knowledge of peer weaknesses to craft targeted disagreements.

The differentiation is generated from profiles, not hardcoded. As profiles change (agent B starts catching more injection bugs), differentiation adapts.

**Fallback:** If both agents have identical profiles (cold start), fall back to the v2 LLM-generated lens approach via `lens-generator.ts`.

---

## 4. Token Cost Efficiency

### Cost-Effectiveness Ratio

Each agent tracks `avgTokenCost` per task. The dispatch score includes:

```typescript
costEfficiency = reliability / normalizedCost;
// normalizedCost = agent's avg cost / median cost across all agents
// Clamped to 0.5-1.5 range
```

For routine reviews, this favors cheaper agents. For critical tasks, reliability dominates (because it multiplies cost efficiency).

### Selective Consensus

Not every dispatch needs cross-review. Consensus may be skipped when ALL of the following conditions are met (conjunctive, not disjunctive):

1. **Low stakes:** Task text contains only observation verbs (research, summarize, document). Tasks containing security-related keywords (`security`, `vulnerab`, `auth`, `inject`, `exploit`) NEVER skip consensus.
2. **High agreement history:** Agents have >80% agreement rate in the last 20 tasks, AND the agreements come from ≥3 unique peer pairings (prevents colluding agents from gaming this threshold).
3. **High reliability:** All agents have >0.9 reliability (raised from 0.8 — higher bar for skipping verification).
4. **Not in `thorough` cost mode.**

```typescript
function shouldSkipConsensus(task: string, agents: CompetencyProfile[], costMode: string): boolean {
  if (costMode === 'thorough') return false;
  if (/security|vulnerab|auth|inject|exploit|breach/i.test(task)) return false;
  if (agents.some(a => a.reviewReliability < 0.9)) return false;
  if (agents.some(a => a.totalTasks < 10)) return false;
  // Check agreement diversity
  const hist = getAgreementHistory(agents, 20);
  if (hist.rate < 0.8 || hist.uniquePeerPairings < 3) return false;
  // Low-stakes verb check
  return isObservationOnly(task);
}
```

Every consensus skip is logged with the reason for audit: `[gossipcat] Consensus skipped: low-stakes + high agreement (85%, 4 peer pairs) + all agents >0.9 reliability`.

Estimated savings: 30-50% fewer consensus LLM calls on routine dispatches (lower than original estimate due to stricter conditions).

### Summary Compression for Cross-Review

When sending findings to peers in cross-review, filter by competency overlap:

- Only send findings in categories where the reviewing peer has competency (score > 0.3)
- Skip findings in categories where the peer has no track record (they can't meaningfully review them)

This reduces cross-review prompt size without losing signal quality.

### Cost Mode Config

Add `costMode` to `.gossip/config.json`:

```json
{
  "costMode": "balanced"
}
```

| Mode | Behavior |
|------|----------|
| `balanced` (default) | Quality-first with cost awareness |
| `aggressive` | Minimize cost, skip consensus when possible. **Security-gated:** tasks with security keywords always get full consensus regardless of cost mode. Every consensus skip in aggressive mode is logged with reason for audit. |
| `thorough` | Always full consensus, ignore cost |

---

## 5. Self-Improvement Loop

### Continuous Learning (Phase 1)

After every `gossip_collect`:

1. Emit consensus signals (already happens via `perfWriter.appendSignals`)
2. **New pipeline step:** After `ConsensusEngine.run()` returns the report, iterate `report.confirmed` findings. For each, call `categoryExtractor.extractCategories(finding.finding)` and append a `category_confirmed` entry to `agent-performance.jsonl`:
   ```typescript
   // In dispatch-pipeline.ts, after line 611 (perfWriter.appendSignals):
   for (const finding of consensusReport.confirmed) {
     const categories = extractCategories(finding.finding);
     for (const category of categories) {
       perfWriter.append({
         type: 'consensus', signal: 'category_confirmed',
         agentId: finding.originalAgentId, category, timestamp: now,
       });
     }
   }
   ```
3. Score decay applied during profile computation (not as a separate step — the `CompetencyProfiler.computeProfiles()` method applies decay weights when reading signals)
4. Profiles recomputed in-memory (triggered by JSONL mtime change on next `getProfile()` call)

After every `verify_write`:

1. Emit `impl_test_pass` or `impl_test_fail` signal
2. Emit `impl_peer_approved` or `impl_peer_rejected` signal
3. Record tool turn count from worker-agent

### Self-Restructuring (Phase 2, future)

After every N dispatch cycles (configurable, default 20):

```
gossip_team_eval() →
  - Compute overlap matrix (which agents produce duplicate findings)
  - Identify coverage gaps (finding categories no agent is strong in)
  - Propose changes:
    - "Split gemini-reviewer into security-specialist and quality-reviewer"
    - "Agent haiku-researcher has 0.3 implPassRate — demote from impl tasks"
    - "No agent covers concurrency — suggest adding skill or agent"
  - Write proposals to .gossip/team-proposals.json
  - User approves/rejects via gossip_apply_proposal()
```

The system never auto-restructures without user approval. It proposes, the user decides.

---

## Architecture

### New Files

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `competency-profiler.ts` | Reads `PerformanceSignal[]` from JSONL, computes `CompetencyProfile` per agent with decay. Owns the in-memory cache. Delegates raw signal reading to `PerformanceReader` (composition, not extension). | ~150 |
| `category-extractor.ts` | Pure function: `extractCategories(findingText: string): string[]`. One constant map + one function. | ~50 |
| `dispatch-differentiator.ts` | Deterministic focus assignment from profiles + overlap detection. Falls back to v2 `lens-generator.ts` on cold start. | ~100 |

> **Architectural clarification:** `competency-profiler.ts` is a new module that *composes* `PerformanceReader`, not a replacement. `PerformanceReader` continues to own raw signal reading and `AgentScore` computation (backward compat). `CompetencyProfiler` adds the category-level, impl-scoring, and decay logic on top. This avoids bloating `performance-reader.ts` beyond 300 lines while keeping a clear single-responsibility split.

### Modified Files

| File | Change |
|------|--------|
| `agent-registry.ts` | Task-type-aware `findBestMatch` using `CompetencyProfiler.getProfile()` instead of raw `getDispatchWeight()` |
| `dispatch-pipeline.ts` | Post-consensus category extraction hook, inject differentiation prompts, selective consensus logic |
| `tool-server.ts` | Accept `PerformanceWriter` via constructor, emit `ImplSignal` after verify_write test/peer review |
| `worker-agent.ts` | Emit `MetaSignal` (task_completed, task_tool_turns) on task completion |
| `consensus-types.ts` | Add `PerformanceSignal` union (`ConsensusSignal | ImplSignal | MetaSignal`), add `category_confirmed` to consensus signal types |
| `performance-writer.ts` | Accept `PerformanceSignal` (not just `ConsensusSignal`) |

### Relationship with v2 Components

| v2 File | v3 Status |
|---------|-----------|
| `overlap-detector.ts` | **Composed** — still used by `dispatch-differentiator.ts` to detect skill overlap |
| `lens-generator.ts` | **Fallback** — used when profiles are identical (cold start). Not replaced. |

### Data Flow

```
consensus signals ──────→ agent-performance.jsonl ──→ competency-profiler (in-memory)
verify_write ImplSignals ┘                                     │
worker-agent MetaSignals ┘                                     ▼
                                                      dispatch-differentiator
                                                               │
                                                      ┌────────┴────────┐
                                                      ▼                 ▼
                                               agent selection    prompt injection
                                               (who to pick)    (how to focus them)
```

All signals flow through `agent-performance.jsonl` as the single source of truth. `CompetencyProfiler` reads the JSONL and computes profiles in-memory with mtime-based cache invalidation (same pattern as `PerformanceReader`).

---

## Testing Strategy

### CompetencyProfiler (unit)

- Given 10+ agreement signals in `injection_vectors` category → agent's `reviewStrengths.injection_vectors` > 0.7
- Given 5 `impl_test_pass` + 2 `impl_test_fail` → `implPassRate` ≈ 0.71
- Given signals older than 100 tasks → decayed weight < 0.25
- Given < 10 `task_completed` signals → profile returns neutral values (profileMultiplier = 1.0)
- Given mixed signals → reliability computed as `accuracy * 0.7 + uniqueness * 0.3`
- **Zero-value edge case:** 0 impl signals → `implPassRate` defaults to 0.5 (neutral), not 0 or NaN
- **Score ceiling:** Single consensus round with 50 agreements → accuracy moves by at most ±0.3
- **Decay at boundaries:** `tasksSinceSignal = 0` → weight 1.0; `= 50` → weight 0.5; `= 200` → weight ~0.06
- **Corrupted signals:** Malformed JSONL lines (missing agentId, non-numeric values) are skipped without crashing
- **Removed agent:** Profile only computed for agents currently in `AgentRegistry`. Stale data in JSONL is ignored.

### CategoryExtractor (unit)

- "Prompt injection via unsanitized input" → `["injection_vectors"]`
- "Race condition in scope validation" → `["concurrency"]`
- "Missing type guard on LLM response" → `["type_safety", "input_validation"]` (multi-category)
- "Generic finding with no category match" → `[]`
- **Case insensitivity:** "DOS attack", "dos attack", "DoS" all match `resource_exhaustion`

### DispatchDifferentiator (unit)

- Two agents with different strengths → complementary focus prompts generated
- Two agents with identical profiles → fallback to LLM lens generation (v2 `lens-generator.ts`)
- Single agent → no differentiation
- Agent with no profile data → excluded from differentiation
- **3+ agents:** Focus areas distributed across all agents, not just pairwise
- **Privacy:** Generated prompts contain no peer names, peer profiles, or peer scores
- **Partial overlap:** Agent A [a,b,c], Agent B [c,d,e] → differentiation only on shared skill c

### Agent Selection (unit)

- Review task + agent with high reviewReliability → selected over lower-scoring peer
- Impl task + agent with high implPassRate → selected
- Two equal agents, one cheaper → cheaper wins in `balanced` mode
- Agent below data threshold (< 10 tasks) → profileMultiplier = 1.0
- **Clamping:** profileMultiplier never below 0.5 or above 1.5, regardless of input values
- **Zero cost:** Agent with `avgTokenCost = 0` → costEfficiency = 1.0 (neutral)
- **costMode "aggressive":** cheaper agent favored more heavily
- **costMode "thorough":** cost has no impact on selection

### Anti-Gaming (unit)

- Agent A agrees with agent B on 100% of findings → agreement weight discounted by peer diversity factor
- Two colluding agents (only agree with each other, never others) → agreements weighted near zero
- Score ceiling: 50 agreements in single round → accuracy moves by max ±0.3

### Selective Consensus (unit)

- All conditions met (low-stakes + high diverse agreement + high reliability) → consensus skipped, reason logged
- Any condition missing → consensus runs
- Security keywords in task → consensus ALWAYS runs, even in `aggressive` cost mode
- `costMode: "thorough"` → consensus always runs regardless
- Agreement diversity < 3 unique peer pairings → consensus runs (prevents collusion)
- Cold-start (agents with < 10 tasks) → consensus runs

### Integration

- Full dispatch → collect → category extraction → profile update cycle: verify `reviewStrengths` change after consensus
- verify_write → ImplSignal emission → profile update: verify `implPassRate` changes
- Two overlapping agents dispatched → verify differentiation prompts injected (no peer names)
- **Cold-start end-to-end:** Two new agents (0 tasks) dispatched → verify `lens-generator.ts` fallback used
- **Concurrent collect():** Two `collect()` calls via `Promise.all()` → both write to JSONL → profile reflects combined signals (JSONL append is atomic per line via `appendFileSync`)
- **Profile refresh:** Run collect → generate signals → immediately dispatch → verify new dispatch uses updated profiles

---

## Security Constraints

- **Profiles are in-memory only** — computed from `agent-performance.jsonl` on boot and refreshed via mtime. Never cached to disk. Cannot be tampered with between boots.
- **No auto-restructuring in Phase 1** — all agent config changes require user approval (Phase 2)
- **Differentiation prompts are opaque** — agents see their own focus areas only. No peer names, peer profiles, or peer weaknesses are revealed.
- **Agreement anomaly detection** — peer diversity requirement prevents colluding agents from inflating each other's scores
- **Score ceiling per round** — no single consensus round moves accuracy by more than ±0.3
- **Category extraction from consensus only** — categories come from confirmed findings (peer-validated), not from raw agent output
- **Cost mode doesn't bypass safety** — `aggressive` is security-gated: tasks with security keywords always get full consensus. Every skip is logged for audit.
- **Category extraction is conservative** — unknown categories are ignored, not invented
- **Consensus skip requires ALL conditions** — conjunctive, not disjunctive. Requires low-stakes + high diverse agreement + high reliability.

---

## Migration

- `AgentScore` interface remains as-is. `CompetencyProfile` is a separate interface (composition, not inheritance). `PerformanceReader.getScores()` returns `AgentScore` (unchanged). `CompetencyProfiler.getProfile(agentId)` returns `CompetencyProfile`. Existing consumers (e.g., `getDispatchWeight`) continue to work until `agent-registry.ts` is updated to use `CompetencyProfiler`.
- New signal types (`ImplSignal`, `MetaSignal`) use a `type` discriminant field. Old `ConsensusSignal` entries (without `type` or with `type: 'consensus'`) are processed as before. The profiler ignores unknown signal types gracefully.
- Profiles are in-memory only — no file migration needed.
- `costMode` defaults to `"balanced"` if not set in config.
- v2 `overlap-detector.ts` and `lens-generator.ts` remain functional — composed into the new flow, not replaced. Users with v2 deployed see no breaking changes. The behavioral change (deterministic differentiation vs LLM lenses) only activates once agents have 10+ tasks of profile data.
- `PerformanceWriter.appendSignals()` is extended to accept `PerformanceSignal[]` — backward compatible since `ConsensusSignal` is a member of the union.
