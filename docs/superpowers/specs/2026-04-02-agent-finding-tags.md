# Structured Finding Tags for Consensus Engine

**Date:** 2026-04-02
**Status:** Draft (revised after 2-agent consensus review)
**Origin:** Dashboard showed 22+ UNIQUE "findings" from a qualitative audit because the consensus engine splits on every `- ` bullet line.

## Problem

The consensus engine parses findings by splitting agent output on lines starting with `- `:

```typescript
const lines = summary.split('\n').filter(l => l.trimStart().startsWith('-'));
```

When an agent writes a detailed review with bullet-point formatting throughout, every bullet becomes a "finding." A review with 5 real findings produces 22+ entries on the dashboard.

The `extractSummary` function falls back to the entire output when no `## Consensus Summary` header is present, making the problem worse.

## Goal

Replace bullet-line parsing with structured `<agent_finding>` tags. Agents wrap each finding in a tag with metadata. The engine parses tags instead of splitting on `- `. No ambiguity, no noise.

## Non-Goals

- Removing bullet-line parsing entirely (keep as per-agent fallback)
- Changing how cross-review works (only Phase 1 parsing changes)
- Using JSON format (too brittle with LLMs — one syntax error invalidates all findings)

## Design

### Agent Output Format

Agents wrap each finding in an `<agent_finding>` tag:

```
<agent_finding type="finding" severity="high">
Missing Secure cookie flag <cite tag="file">routes.ts:126</cite>
</agent_finding>

<agent_finding type="suggestion">
Consider changing SameSite=Lax to SameSite=Strict for single-origin dashboard
</agent_finding>

<agent_finding type="insight">
Session tokens use 256-bit entropy — sufficient for production use
</agent_finding>
```

**Tag attributes:**
- `type`: `finding` | `suggestion` | `insight` (required)
- `severity`: `critical` | `high` | `medium` | `low` (optional, for findings only)
- Attributes may appear in **any order** — the parser must not depend on attribute ordering

**Tag content:** The finding text, including any `<cite>` tags for references. Max 2000 chars.

### Engine Parsing (synthesize)

In `consensus-engine.ts`, the `synthesize()` seeding loop gets a new primary parser **inside** the `for (const r of successful)` loop — per-agent, not global:

```typescript
for (const r of successful) {
  const summary = this.extractSummary(r.result!);
  let agentFindingsFound = 0;

  // Primary: parse <agent_finding> tags from the raw summary text
  const tagPattern = /<agent_finding\s+([^>]*)>([\s\S]*?)<\/agent_finding>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(summary)) !== null) {
    const attrs = tagMatch[1];
    const content = tagMatch[2].trim();
    if (!content || content.length < 10 || content.length > 2000) continue;

    // Extract attributes permissively — any order
    const typeMatch = attrs.match(/type="(finding|suggestion|insight)"/);
    const severityMatch = attrs.match(/severity="(critical|high|medium|low)"/);
    if (!typeMatch) continue; // type is required

    const findingType = typeMatch[1] as 'finding' | 'suggestion' | 'insight';
    const severity = severityMatch?.[1] as 'critical' | 'high' | 'medium' | 'low' | undefined;

    const key = `${r.agentId}::${content}`;
    const hasAnchor = /[\w./-]+\.(ts|js|tsx|jsx|py|go|rs|java|rb|md|json|yaml|yml|toml|sh):\d+/.test(content);
    findingMap.set(key, {
      originalAgentId: r.agentId,
      finding: content,
      findingType,
      severity,
      confirmedBy: [],
      disputedBy: [],
      unverifiedBy: [],
      confidences: hasAnchor ? [] : [2], // anchor confidence penalty preserved
    });
    agentFindingsFound++;
  }

  // Per-agent fallback: if THIS agent produced no tags, use legacy bullet parsing
  if (agentFindingsFound === 0) {
    const lines = summary.split('\n').filter(l => l.trimStart().startsWith('-'));
    for (const line of lines) {
      // ... existing bullet parser with [FINDING]/[SUGGESTION]/[INSIGHT] prefix support
    }
  }
}
```

**Key design decisions from consensus review:**

1. **Attribute order permissive** — parse `attrs` string with separate regex matches, not positional capture groups. `severity="high" type="finding"` works the same as `type="finding" severity="high"`.

2. **Per-agent fallback** — the bullet fallback triggers when THIS agent's output has no `<agent_finding>` tags. One agent using tags doesn't suppress fallback for other agents still using bullets.

3. **Content length cap** — max 2000 chars per finding content prevents a missing close tag from consuming the entire output. The `[\s\S]*?` lazy match is also bounded by the next `</agent_finding>` or end of string.

4. **Anchor confidence penalty preserved** — the `hasAnchor` check from the existing bullet parser is ported to the tag parser. Findings without file:line citations still get pre-seeded confidence of 2.

### Severity in Dedup

When `deduplicateFindings` merges two findings with different severities, the **highest severity wins**:

```typescript
const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// During merge (in deduplicateFindings):
if (entryB.severity && (!entryA.severity || SEVERITY_RANK[entryB.severity] > SEVERITY_RANK[entryA.severity])) {
  entryA.severity = entryB.severity;
}
```

Rationale: if one agent says `medium` and another says `critical` for the same finding, the more cautious assessment should surface.

### Prompt Update

In `prompt-assembler.ts`, the consensus output format teaches agents the tag:

```
FINDING FORMAT:
Wrap each finding in an <agent_finding> tag:

<agent_finding type="finding" severity="high">
Your finding here with <cite tag="file">file.ts:123</cite> references
</agent_finding>

<agent_finding type="suggestion">
Your recommendation here
</agent_finding>

Types: finding (factual, verifiable), suggestion (recommendation), insight (observation)
Severity (for findings only): critical, high, medium, low
Attributes can appear in any order.
```

### Severity on ConsensusFinding

Add optional `severity` to `ConsensusFinding` in `consensus-types.ts`:

```typescript
export interface ConsensusFinding {
  // existing fields...
  findingType?: 'finding' | 'suggestion' | 'insight';
  severity?: 'critical' | 'high' | 'medium' | 'low';
  // ...
}
```

### Dashboard Rendering

Severity badges for visual priority:
- `critical` — red badge
- `high` — orange badge
- `medium` — yellow badge
- `low` — gray badge
- `suggestion` / `insight` — blue/purple badge (existing)

### Backward Compatibility

- If no `<agent_finding>` tags found in an agent's output, fall back to bullet-line parser **for that agent only**
- `[FINDING]`/`[SUGGESTION]`/`[INSIGHT]` prefix parsing still works in the bullet fallback
- Legacy `<fn>` and `<cite>` tags work inside `<agent_finding>` content
- The tag subsumes the `[FINDING]` prefix — agents don't need both

## File Changes

| File | Change |
|------|--------|
| `packages/orchestrator/src/consensus-engine.ts:258-280` | Add `<agent_finding>` tag parser as primary (per-agent), demote bullets to per-agent fallback |
| `packages/orchestrator/src/consensus-engine.ts` (dedup) | Add severity merge rule (highest wins) |
| `packages/orchestrator/src/consensus-types.ts` | Add `severity?` to `ConsensusFinding` |
| `packages/orchestrator/src/prompt-assembler.ts` | Teach agents the `<agent_finding>` format |
| `tests/orchestrator/consensus-engine.test.ts` | Tests for tag parsing, per-agent fallback, severity extraction, dedup merge |
| Dashboard consensus view | Render severity badges |

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Agents don't adopt tag format | Medium | Per-agent bullet fallback keeps everything working |
| Missing close tag consumes content | Medium | 2000 char content cap + lazy match bounded by next tag |
| `</agent_finding>` in code examples causes early termination | Low | Rare — agents would need to quote the exact tag name |
| Severity inflation (agents mark everything critical) | Low | Highest-severity-wins in dedup; cross-review can dispute |
| Attribute order varies across agents | None | Parser is order-independent |

## Success Criteria

- Agents produce `<agent_finding>` tags in their output
- Dashboard shows 5-7 findings per review instead of 22+
- Severity badges visible on dashboard
- Mixed-format consensus (some agents tagged, some bullet) works correctly
- Anchor confidence penalty applies to both tagged and bullet findings
