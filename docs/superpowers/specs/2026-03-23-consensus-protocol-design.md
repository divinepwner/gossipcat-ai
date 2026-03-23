# Multi-Agent Consensus Protocol — Design Spec

> When multiple agents review the same work, a structured cross-review round surfaces agreements, contradictions, and blind spots — then feeds that signal back to the orchestrator for team evolution.

**Date:** 2026-03-23
**Status:** Draft
**Dependencies:** Adaptive Team Intelligence Tier 1+2 (shipped), gossip_dispatch_parallel (shipped)
**Enables:** Tier 3 Evolutionary Reshaping (replaces LLM-as-judge with ground-truth signal)

---

## Problem Statement

Today, parallel agent dispatch produces N independent reports. The orchestrator (or user) must manually:

1. **Identify duplicates** — same finding, different wording
2. **Resolve contradictions** — "this is a bug" vs "this is fine"
3. **Assess confidence** — is this finding real or hallucinated?
4. **Evaluate agents** — which agent produced the most valuable findings?

This is error-prone, slow, and wastes the most valuable signal: what happens when agents examine each other's work.

## Design Overview

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: INDEPENDENT WORK (existing)                       │
│                                                             │
│  gossip_dispatch_parallel → each agent works alone          │
│  → N independent reports                                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  PHASE 2: CROSS-REVIEW (new — 1 LLM call per agent)        │
│                                                             │
│  Each agent receives a summary of ALL other agents' reports │
│  → Agrees / Disagrees / Adds missed findings                │
│  → Cites evidence for disagreements                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  PHASE 3: SYNTHESIS (new — orchestrator)                    │
│                                                             │
│  Merge all phase 2 responses:                               │
│  → Tag findings: CONFIRMED / DISPUTED / UNIQUE              │
│  → Generate structured consensus report                     │
│  → Extract feedback signals for agent performance            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Activation:** `gossip_dispatch_parallel(tasks, { consensus: true })` or `gossip_orchestrate` with `consensus: true`.

**Default:** Off. Only activated when explicitly requested or for high-stakes dispatches (security reviews, architecture decisions).

---

## Phase 1: Independent Work (Existing)

No changes. Agents are dispatched and produce results as they do today. Lenses (from Adaptive Team Intelligence Tier 2) are still applied to differentiate their focus areas.

---

## Phase 2: Cross-Review

After all agents complete Phase 1, the orchestrator:

1. **Summarizes** each agent's findings (truncated to ~500 tokens per agent)
2. **Dispatches** a cross-review task to each agent with all summaries
3. **Collects** structured responses

### Cross-Review Prompt

Each agent receives:

```
You previously reviewed code and produced findings. Now review your peers' findings.

YOUR FINDINGS (Phase 1):
{agent's own summarized output}

PEER FINDINGS:
Agent "{peer1_id}" ({peer1_preset}):
{peer1_summarized_output}

Agent "{peer2_id}" ({peer2_preset}):
{peer2_summarized_output}

For each peer finding, respond with one of:
- AGREE: You independently confirm this finding is correct. Cite your evidence.
- DISAGREE: You believe this finding is incorrect. Explain why with evidence (file:line references).
- NEW: Something ALL agents missed that you now realize after seeing peer work.

Return a JSON array:
[
  { "action": "agree"|"disagree"|"new", "agentId": "peer_id", "finding": "summary", "evidence": "your reasoning", "confidence": 1-5 }
]
```

### Cross-Review Cost

- Input: ~500 tokens per peer summary × (N-1) peers + ~500 tokens own summary + ~200 tokens prompt = ~1700 tokens for 4 agents
- Output: ~300 tokens
- Total per agent: ~2000 tokens
- Total for 4-agent review: 4 × ~2000 = ~8000 tokens ≈ $0.01

Less than the cost of a single Phase 1 dispatch. Negligible.

### Cross-Review Uses Same Agent

Each agent cross-reviews using the same LLM provider/model it used in Phase 1. This is important — a Gemini agent should evaluate findings from its Gemini perspective, a Claude agent from its Claude perspective. Cross-provider disagreements are especially valuable signals.

### Graceful Degradation

If any agent's cross-review call fails:
- Log warning
- That agent's cross-review is skipped
- Remaining agents' cross-reviews still contribute
- Phase 3 synthesis proceeds with available data

---

## Phase 3: Synthesis

The orchestrator processes all Phase 2 responses to produce:

### 1. Tagged Findings

Each finding from Phase 1 gets a consensus tag:

```typescript
interface ConsensusFinding {
  id: string;
  originalAgentId: string;
  finding: string;
  tag: 'confirmed' | 'disputed' | 'unique';
  confirmedBy: string[];    // agent IDs that agreed
  disputedBy: Array<{       // agents that disagreed, with reasoning
    agentId: string;
    reason: string;
    evidence: string;
  }>;
  confidence: number;       // 1-5, averaged from cross-review responses
}
```

**Tagging rules:**
- **CONFIRMED:** ≥1 peer explicitly agreed (or independently found the same thing in Phase 1)
- **DISPUTED:** ≥1 peer explicitly disagreed with evidence
- **UNIQUE:** No peer agreed or disagreed — only one agent found this

### 2. New Findings

Findings tagged `NEW` in cross-review are added to the report. These are things agents only realized after seeing peers' work — the highest-value output of consensus.

### 3. Consensus Report Format

```
═══════════════════════════════════════════
CONSENSUS REPORT (4 agents, 2 rounds)
═══════════════════════════════════════════

CONFIRMED (high confidence — act on these):
  ✓ [gemini-reviewer + gemini-tester] SQL injection in auth handler (line 47)
  ✓ [gemini-reviewer + gemini-implementer] Missing input validation on /api/tasks

DISPUTED (agents disagree — review the evidence):
  ⚡ [gemini-reviewer says bug, gemini-tester says safe]
    "Rate limiting bypass via concurrent requests"
    → reviewer: "no rate limit middleware on /api/auth"
    → tester: "rate limiting is at the nginx level, not app level"

UNIQUE (one agent only — verify before acting):
  ? [gemini-implementer] "getTask() scans entire JSONL on every call"

NEW (discovered during cross-review):
  ★ [gemini-tester] "After seeing reviewer's auth findings, realized
     the test suite has zero tests for auth error paths"

═══════════════════════════════════════════
Summary: 2 confirmed, 1 disputed, 1 unique, 1 new
═══════════════════════════════════════════
```

---

## Feedback Signals → Agent Performance

This is the key innovation: consensus disagreements are **ground truth** for agent evaluation.

### Signal Types

```typescript
interface ConsensusSignal {
  type: 'consensus';
  taskId: string;
  signal: 'agreement' | 'disagreement' | 'unique_confirmed' | 'unique_unconfirmed' | 'new_finding' | 'hallucination_caught';
  agentId: string;          // the agent being evaluated
  counterpartId?: string;   // the agent they agreed/disagreed with
  skill?: string;           // which skill was active
  outcome?: 'correct' | 'incorrect' | 'unresolved';
  evidence: string;
  timestamp: string;
}
```

### What Each Signal Means

| Signal | What happened | Agent A impact | Agent B impact |
|--------|--------------|----------------|----------------|
| `agreement` | A and B found the same thing | +accuracy for both | +accuracy for both |
| `disagreement` (A wins) | A found real bug, B said it was fine | +accuracy A | -accuracy B |
| `disagreement` (B wins) | A hallucinated, B called it out | -accuracy A | +accuracy B, +uniqueness B |
| `disagreement` (unresolved) | Neither agent proved their case | no change | no change |
| `unique_confirmed` | Only A found it, peers later confirmed | +uniqueness A | (peers missed it) |
| `unique_unconfirmed` | Only A found it, no peer confirmed | neutral (might be real, might not) | — |
| `new_finding` | B realized something new after seeing A's work | +relevance A (inspired it) | +uniqueness B |
| `hallucination_caught` | A cited nonexistent code, B caught it | -accuracy A | +accuracy B |

### Storage

Appended to `.gossip/agent-performance.jsonl` alongside existing score entries:

```jsonl
{"type":"consensus","taskId":"abc123","signal":"disagreement","agentId":"gemini-reviewer","counterpartId":"gemini-tester","skill":"security_audit","outcome":"correct","evidence":"reviewer correctly identified missing rate limiting; tester was wrong about nginx handling it","timestamp":"2026-03-23T18:00:00Z"}
{"type":"consensus","taskId":"abc123","signal":"hallucination_caught","agentId":"gemini-reviewer","counterpartId":"gemini-implementer","evidence":"reviewer cited validateInput at line 47 but line 47 is a comment","timestamp":"2026-03-23T18:00:00Z"}
```

### Why This Replaces LLM-as-Judge

The ATI v2 spec deferred Tier 3 because LLM scoring was questionable:
- A cheap model scoring expensive model output → false precision
- No codebase access in the scoring prompt → can't verify findings
- Scoring bias toward same-provider agents

Consensus signals solve all three:
- **Agents evaluate each other**, not a cheap judge
- **Agents have codebase access** during cross-review (they can read files to verify)
- **Cross-provider disagreements are the strongest signal** (Gemini catches Claude's hallucination or vice versa)

This makes Tier 3's reshape engine viable. Instead of "haiku thinks gemini-reviewer scored 3.2 on accuracy," we have "gemini-reviewer was wrong in 4 out of 6 disagreements with sonnet-debugger on security topics."

---

## Integration Points

### DispatchPipeline Changes

The consensus protocol lives in the `collect()` method, not in `dispatchParallel()`:

```typescript
async collect(taskIds?: string[], timeoutMs?: number, options?: { consensus?: boolean }): Promise<CollectResult> {
  // ... existing collect logic ...

  if (options?.consensus && results.length >= 2) {
    const consensusReport = await this.runConsensus(results);
    // Append consensus signals to performance JSONL
    // Return enriched results with consensus tags
  }
}
```

### New Files

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/orchestrator/src/consensus-engine.ts` | Create | Summarize phase 1, dispatch cross-reviews, synthesize |
| `packages/orchestrator/src/types.ts` | Modify | Add ConsensusFinding, ConsensusSignal, CollectOptions |
| `packages/orchestrator/src/dispatch-pipeline.ts` | Modify | Add consensus option to collect() |
| `tests/orchestrator/consensus-engine.test.ts` | Create | Unit tests with mocked agents |

### MCP Tool Changes

```typescript
// gossip_collect gains a consensus option
gossip_collect({ task_ids, timeout_ms, consensus: true })

// Or a dedicated tool
gossip_consensus({ task_ids })  // runs cross-review on already-collected results
```

---

## When to Use Consensus

### Recommended (high value / cost ratio)

- **Pre-ship security reviews** — hallucination filtering is critical
- **Architecture decisions** — trade-off surfacing between competing approaches
- **Bug diagnosis with competing hypotheses** — agents eliminate each other's wrong theories
- **Spec reviews** — catch contradictions and missing requirements
- **Database schema design** — normalize vs denormalize debates get evidence

### Not recommended

- **Simple code reviews** — independent findings are sufficient
- **Implementation tasks** — single agent, nothing to cross-review
- **Routine linting/formatting** — no disagreement possible

### Auto-consensus (future)

The orchestrator could automatically enable consensus when:
- `dispatchParallel` with ≥3 agents on the same task
- Task contains keywords: "security", "architecture", "design", "review"
- Previous consensus on similar tasks had high disagreement rate

---

## Hallucination Detection

A specific high-value output of cross-review: **catching hallucinated findings**.

Gemini agents are known to hallucinate file paths, function names, and line numbers. When Agent A says "vulnerability at server.ts:47" and Agent B responds "DISAGREE — line 47 is a comment, the function is at line 92," that's a hallucination caught in real-time.

The `hallucination_caught` signal is the strongest negative signal for agent accuracy. Over time, the reshape engine can:
- Track hallucination rates per agent per skill
- Recommend removing skills from high-hallucination agents
- Recommend adding verification skills to hallucination-prone agents

---

## Cost Analysis

| Scenario | Phase 1 | Phase 2 | Total | Increase |
|----------|---------|---------|-------|----------|
| 2-agent review | 2 calls | 2 calls | 4 calls | 2x |
| 3-agent review | 3 calls | 3 calls | 6 calls | 2x |
| 4-agent review | 4 calls | 4 calls | 8 calls | 2x |
| 5-agent review | 5 calls | 5 calls | 10 calls | 2x |

Always exactly 2x. Phase 2 calls are cheaper (shorter input — summaries not full codebase).

For a typical 4-agent security review:
- Phase 1: ~$0.08 (4 × Gemini Pro calls with codebase context)
- Phase 2: ~$0.01 (4 × shorter calls with summaries only)
- **Total with consensus: ~$0.09 vs ~$0.08 without**

The cross-review phase is ~12% of the total cost, not 100%. The "2x calls" is misleading because the calls are much cheaper.

---

## Relationship to Existing Features

| Feature | Role | How consensus uses it |
|---------|------|----------------------|
| Lenses (Tier 2) | Differentiate agent focus | Phase 1 findings are more complementary → less redundancy in cross-review |
| Gossip protocol | Mid-task communication | Gossip is fire-and-forget during execution; consensus is structured post-completion |
| Agent memory | Per-agent task history | Consensus signals feed into memory for reshape recommendations |
| TaskGraph | Event tracking | Consensus results recorded as events for Supabase sync |
| Overlap detector | Identify shared skills | Consensus is most valuable when agents have overlapping skills |

---

## Open Questions

1. **Who resolves DISPUTED findings?** Options: (a) user decides, (b) a tiebreaker agent, (c) the orchestrator uses a more capable model. Recommendation: (a) for MVP.

2. **Should Phase 2 agents see Phase 1 agents' full output or just summaries?** Full output gives better cross-review but costs more. Summaries are cheaper but might miss context. Recommendation: summaries for MVP, full output as an option.

3. **Can consensus work with Claude Code Agent() subagents?** Currently they don't go through the gossipcat relay. Consensus would need to work with whatever dispatch mechanism is used. Recommendation: implement in DispatchPipeline first, extend to Agent() later.

4. **Should disagreements auto-trigger a verification step?** When two agents disagree, the orchestrator could dispatch a third agent specifically to verify the disputed finding. This is a "tiebreaker" pattern. Cost: 1 additional call per dispute. Recommendation: defer to v2.
