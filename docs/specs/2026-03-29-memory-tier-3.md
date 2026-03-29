# Memory Tier 3 — Extraction Quality + Dynamic Caps

**Date:** 2026-03-29
**Status:** Spec v2 (updated after 3-agent consensus review)
**Context:** Tier 1 (real scores, failure extraction) and Tier 2 (cross-agent learning, decay fix, relevance fix) shipped 2026-03-28. Tier 3 addresses extraction quality and memory sizing.

---

## Problem

Agent memory knowledge files contain garbage from weak extraction heuristics:

```
Files: packages/orchestrator/src/skill-index.ts, skill-index.json, this.fileP,
       this.data, JSON.parse, skill-index.json.bak, Object.proto, e.g,
       Object.creat, this.save, this.dirty, JSON.strin, try...catch
```

The file regex matches code identifiers (`this.data`, `JSON.parse`, `Object.proto`) as file paths. Config files (`skill-index.json`, `*.lock`) are included alongside source files. Decision extraction only catches first-person language, missing third-person architectural decisions.

## Changes

### 1. Tighten file extraction regex

**File:** `packages/orchestrator/src/memory-writer.ts:110-118`

**Current regex:** `` /[`"'(]?([a-zA-Z0-9_/.:-]+\.\w{1,5})[`"')]?/g ``

This matches anything with a dot and a 1-5 char suffix: `this.data`, `JSON.parse`, `Object.proto`.

**Fix:** Two-part approach:

**a) New regex with proper boundaries:**

```typescript
const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cpp', 'h', 'hpp', 'cs',
  'html', 'css', 'scss', 'less', 'vue', 'svelte',
  'sh', 'bash', 'zsh',
  'sql', 'graphql', 'proto',
  'php', 'lua', 'xml',
]);

// Use lookahead boundary (not consuming) to avoid skipping back-to-back refs.
// Extension up to 7 chars to cover .graphql, .svelte.
// Include ] and > for markdown patterns like [src/foo.ts] and <src/foo.ts>.
const fileRegex = /(?:^|[\s`"'(\[<])([a-zA-Z0-9_/.-]+\.[a-z]{1,7})(?=[\s`"'):,\]>]|$)/gm;
```

Key fixes from agent review:
- `{1,7}` not `{1,5}` — covers `.graphql` (7) and `.svelte` (6)
- `\[<` in leading boundary, `\]>` in trailing — markdown patterns
- Trailing boundary uses **lookahead** `(?=...)` not consuming group — prevents skipping back-to-back refs

**b) Post-filter:** After matching, validate:
- Must contain `/` (is a path) OR extension must be in SOURCE_EXTENSIONS
- Reject if starts with common code prefixes (using `startsWith`, not substring):
  `this.`, `self.`, `Object.`, `JSON.`, `Math.`, `Array.`, `Promise.`, `console.`,
  `String.`, `Number.`, `Boolean.`, `process.`, `Buffer.`, `Error.`, `Date.`,
  `React.`, `Vue.`, `axios.`, `fs.`, `path.`, `crypto.`, `http.`, `https.`
- For path-qualified files (has `/`): additionally reject sensitive patterns:
  `.env` (anywhere in path), `node_modules/`
- For bare filenames (no `/`): reject non-source extensions:
  `json`, `lock`, `yaml`, `yml`, `toml`, `md`, `txt`, `env`, `log`, `bak`
- Keep existing skipExts filter for `e.g`, `i.e`, etc.

### 2. Broaden decision extraction regex

**File:** `packages/orchestrator/src/memory-writer.ts:135`

**Current regex:**
```typescript
/(?:I (?:chose|decided|used|picked|went with|created|set up|initialized|configured)|(?:using|chose|selected) .{5,60}(?:for|because|since|as))/gi
```

Only matches first-person: `"I chose React"`, `"I decided to use TypeScript"`.

**Fix:** Add third-person subjects. Remove the subjectless second branch (causes passive-voice false positives like "using a shared lock for thread safety"):

```typescript
const decisionPatterns = /(?:(?:I|we|they|the team|the project) (?:chose|decided|used|picked|went with|created|set up|initialized|configured|adopted|migrated to|switched to) .{3,80}(?:for|because|since|as|due to|instead of)?)/gi;
```

Changes:
- Added subjects: `we`, `they`, `the team`, `the project`
- Added verbs: `adopted`, `migrated to`, `switched to`
- **Removed the subjectless second branch** — it matched passive descriptions ("using X for Y") not decisions
- Reason clause (`for|because|...`) is now optional `?` — captures "we chose React" even without a reason
- Range widened to `.{3,80}` to catch shorter objects

**Keep limit:** Still cap at 5 decisions per extraction.

### 3. Dynamic memory cap based on findings count

**File:** `packages/orchestrator/src/dispatch-pipeline.ts` (both call sites)

**Current:** `maxEntries: number = 20` — hardcoded, same for every task.

**Fix:** Use `findings` count (already tracked in TaskMemoryEntry) as the primary signal, with result length as fallback:

```typescript
// In dispatch-pipeline.ts, at BOTH compactIfNeeded call sites:
const findings = taskEntry?.findings ?? 0;
const resultLength = result?.length ?? 0;
// Primary signal: findings count. Fallback: result length.
let maxEntries = 20; // default
if (findings >= 8) maxEntries = 30;       // complex review with many findings
else if (findings <= 1) maxEntries = 12;  // simple task, low retention
else if (resultLength > 10000) maxEntries = 25; // long output, moderate bump
```

**Why findings, not result length?** (from agent review)
- Verbose trivial task (500 lines "no issues") has long result but zero value → result length gives wrong signal
- Terse 8-finding security review at 1500 chars is high-value → result length would under-cap

**Both call sites:** `dispatch-pipeline.ts:501` (collect path) AND `dispatch-pipeline.ts:807` (writeMemoryForTask path). Both must use the dynamic cap.

## Non-goals

- **LLM-based summarization** — expensive, adds latency, not needed for Tier 3.
- **Embedding-based relevance** — future work, requires vector DB.
- **Per-file knowledge** — not splitting knowledge by file reference, too granular.
- **Knowledge file cap adjustment** — MAX_KNOWLEDGE_FILES stays at 10. Separate concern from task entry retention.

## Test plan

1. **File regex:** Test with real agent output containing `this.data`, `JSON.parse`, `Object.proto`, `skill-index.json`, `packages/foo/bar.ts`, `[src/foo.ts]` (markdown), `packages/foo/.env.local` (sensitive). Verify: source files pass, code identifiers rejected, config files without paths rejected, config files with paths pass, .env paths rejected, markdown-wrapped paths pass.
2. **Decision regex:** Test first-person, third-person, team, migration patterns. Verify: "we decided X because Y" matches, "the variable was decided" doesn't, "using X for Y" without subject doesn't.
3. **Dynamic cap:** Test with 0 findings (→12), 3 findings (→20), 10 findings (→30), long result with 2 findings (→25). Verify at both call sites.
4. **Backward compat:** Existing knowledge files are not affected. Only new extractions use the improved patterns.

## Risk

**Low.** All changes are in extraction (what gets written) and compaction (how much stays). No changes to memory reading, prompt assembly, or the warmth/relevance scoring. Existing memory files are untouched.
