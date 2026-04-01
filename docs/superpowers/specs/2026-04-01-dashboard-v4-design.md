# Dashboard v4 — Grid Data Rows + Hub Layout

**Date:** 2026-04-01
**Status:** Design approved
**Approach:** Hybrid — hub stays as curated inbox, detail views upgraded to grid-based data rows
**Research:** 3-agent parallel research (sonnet-reviewer, gemini-reviewer, haiku-researcher)
**Supersedes:** v3 detail-view freeze ("detail views unchanged") — v4 intentionally rewrites all detail views
**Consensus review:** 3 agents, 7 confirmed, 2 disputed, 8 unverified — all confirmed findings addressed below

---

## Problem

The v3 dashboard hub works well as an inbox ("what's happening, what needs attention") but the detail views (#/team, #/tasks, #/signals, #/consensus) are weak:

- **5-6x lower information density** than industry tools (GitHub Actions, Datadog, Vercel)
- No column sorting, no sticky headers, no inline row expansion
- Numbers not right-aligned, no visual structure without grid lines
- Unbounded API payloads — `/tasks` and `/signals` fetch entire history
- Hidden data not surfaced: skills, task-to-consensus links, token breakdown, cost, `counts.new` pill
- Hub layout stacks everything vertically — wastes horizontal space
- Timestamps are static snapshots — don't auto-update

## Approach

1. **Hub**: keep v3 inbox design, add grid layout (team + runs side-by-side), live timestamps, aggregate metrics, NEW pill
2. **Detail views**: replace card/div layouts with CSS Grid data rows — aligned columns, rich cell content, inline expansion, sorting, pagination

No HTML `<table>` elements. All data views built with `div` + `grid-template-columns` for full control over hover effects, animations, inline components (trust rings, sparklines, pills, progress bars).

---

## Hub Changes

### Layout Grid

Replace stacked sections with a CSS Grid:

```
┌─────────────────────────────────────────────────────┐
│  Status Bar (full width)                            │
├─────────────────────────────────────────────────────┤
│  Live Task Strip (full width, conditional)          │
├──────────────────────────┬──────────────────────────┤
│  Team (left 60%)         │  Recent Runs (right 40%) │
│  Agent grid 3x2          │  Expandable run cards    │
│                          │                          │
├──────────────────────────┴──────────────────────────┤
│  Knowledge (full width, compact row)                │
└─────────────────────────────────────────────────────┘
```

- Team + Recent Runs side-by-side above 1000px, stacked below
- Both visible without scrolling on 1080p
- CSS class: `.hub-grid` with `grid-template-columns: 3fr 2fr` for the middle row

### Status Bar Additions

Add inline aggregate metrics to the existing status bar:
- Total tasks completed (from overview API, already available)
- Consensus rate (confirmed / total findings)

### Live Timestamps

- Active task elapsed time: updates every 1s via `setInterval`
- Relative timestamps ("2m ago"): refresh every 30s on all `[data-timestamp]` elements

### NEW Pill

Add blue "NEW" pill to Recent Runs cards. Data source: `counts.new` from consensus API (already calculated, never rendered).

**Lifecycle:** The NEW pill is purely data-driven — it appears when `counts.new > 0` for a consensus run. It does not clear on view or expire. It reflects findings discovered during cross-review (not present in any agent's initial pass). This is a permanent property of the run, not a notification state.

---

## Detail Views — Grid Data Rows

### Shared Infrastructure

All detail views use a common grid data row system:

**Header row:**
- `position: sticky; top: 0` with background matching surface color
- Sortable labels — click toggles asc/desc, arrow indicator (▲/▼)
- Subtle bottom border separator

**Data rows:**
- `div.data-row` with consistent `grid-template-columns` per view
- 40px row height, 12px cell padding
- Hover: `rgba(255,255,255,0.03)` background lift
- Selection: left purple accent border on click
- No visible grid lines — spacing and alignment create structure (Linear-style)

**Expansion:**
- Click row → detail panel slides open below the row (CSS transition)
- No page navigation — stays in the same view
- Only one row expanded at a time (clicking another collapses the previous)

**Row groups:**
- Optional date separator rows ("Today", "Yesterday", "Mar 30") as thin label dividers
- Used in tasks and signals views when time gap > 1 hour

**Viewport fill:**
- Detail views use `calc(100vh - 50px)` for the data area (50px = topbar height)
- Scroll within the data rows, header stays fixed

**Pagination:**
- Server-side `?limit=50&offset=0`
- "Load more" button at bottom of data area (not numbered pages)
- Button hidden when `offset + items.length >= total` (all items loaded)
- Response includes `total` count for context
- Loaded items accumulate in memory (append on "Load more", don't re-fetch)

**Search + pagination interaction:** Search is client-side, filtering only the currently loaded items. The search input shows "(searching N loaded of M total)" when `total > loaded count` to signal that not all data is visible. This avoids server-side search complexity while being transparent about scope.

**Empty states:** When a view has no data, show centered muted text: "No tasks yet" / "No signals recorded" / "No agents configured". When filters produce no matches: "No matching items" with a "Clear filters" link. No illustrations.

**Loading states:** Show a single-line "Loading..." text in muted color centered in the data area. No skeleton loaders (too much complexity for vanilla JS).

**Error states:** On API fetch failure, show "Failed to load — Retry" with a clickable retry link that re-fetches. No toast notifications.

### #/team — Agent Rows

```
grid-template-columns: 48px 1fr 100px 90px 90px 90px 80px 100px

[ring] [name + provider]     [weight] [acc]  [rel]  [uniq] [signals] [tokens]
 SR    sonnet-reviewer        ██ 1.82   72%    88%    41%     34       1.2M
       Anthropic · Sonnet
```

- **Ring cell**: 32px inline trust ring with 2-letter initials, color by dispatch weight
- **Name cell**: agent ID bold, provider/model as secondary text below (smaller, muted)
- **Weight cell**: tiny inline bar (width proportional to weight) + number
- **Metric cells**: right-aligned, monospace, JetBrains Mono
- **Default sort**: dispatch weight descending

**Expanded row shows:**
- Skills list (bound skills with enabled/disabled state)
- Competency categories as horizontal bars
- Last 5 tasks as compact mini-rows (status icon, description, duration)
- Signal breakdown as horizontal stacked bar (green/red/amber/gray)

### #/tasks — Task Rows

```
grid-template-columns: 32px 120px 1fr 80px 80px 70px 80px

[status] [agent]        [task description]              [duration] [tokens] [cost] [time]
  ✓      gemini-test    Review signal validation spec…     42s      12.4K   $0.02   2m ago
  ✗      haiku-res      Analyze dispatch pipeline…         18s       4.1K   $0.01   5m ago
  ◎      sonnet-rev     Running cross-review…              1m12s      —       —      now
```

- **Status cell**: colored icon — green check (completed), red cross (failed), amber spinner (running), gray dash (cancelled)
- **Running tasks**: subtle pulsing left border animation
- **Filter pills** above data rows: All | Running | Completed | Failed | Cancelled
- **Search input**: client-side filter by agent ID or task description
- **Default sort**: time descending (most recent first)

**Expanded row shows:**
- Full task description (untruncated)
- Result text (if completed)
- Input/output token split
- Link to consensus run (if part of one)

**Date group headers** between rows when time gap > 1 hour.

### #/signals — Signal Rows

```
grid-template-columns: 120px 120px 120px 1fr 80px 80px

[type pill]    [agent]       [counterpart]  [evidence]                    [task]   [time]
 agreement     gemini-test    sonnet-rev     Race condition at line 142…   abc123    2m ago
 halluc_caught haiku-res      gemini-rev     Claims file doesn't exist…    def456    5m ago
```

- **Type cell**: colored pill badge matching consensus tag colors (green/red/amber/gray/blue)
- **Task cell**: short task ID (8 chars), clickable link to `#/consensus/:id`
- **Filter pills** above: All | Agreement | Disagreement | Unique | Hallucination
- **Sparkline chart**: 14-day trend bar chart above the data rows (kept from current design)
- **Default sort**: time descending

**Expanded row shows:**
- Full evidence text
- Link to consensus run

### #/consensus/:id — Finding Rows

```
grid-template-columns: 110px 1fr 140px 140px

[tag]        [finding]                              [found by]       [verified by]
 CONFIRMED   Race condition in dispatch-pipeline…    gemini-tester    sonnet-reviewer
 DISPUTED    Unbounded memory growth in task-gr…     gemini-reviewer  sonnet-reviewer
```

- Summary pills row at top (unchanged from v3)
- **DISPUTED expanded**: two-column layout showing claim vs counterargument side-by-side
- **UNVERIFIED expanded**: full evidence text, dimmed "not verified by peers" label
- **CONFIRMED expanded**: full evidence + list of confirming agents

### #/knowledge/:id — Minimal Changes

- MEMORY.md rendering: unchanged (markdown)
- Knowledge files: unchanged (collapsible list)
- **Task history**: upgraded to grid data rows (Date | Task | Importance) instead of plain divs

---

## API Changes

### Server-side pagination

Add `?limit=50&offset=0` query params to:
- `GET /dashboard/api/tasks`
- `GET /dashboard/api/signals`

Response shape:
```json
{
  "items": [...],
  "total": 412,
  "offset": 0,
  "limit": 50
}
```

Default limit: 50. Max limit: 200.

### Data corrections (from consensus review)

**Already returned (no backend change needed):**
- `GET /api/tasks` — `inputTokens`, `outputTokens` already in response (api-tasks.ts:12-13). Frontend just needs to render them in the new grid.
- `GET /api/signals` — `taskId` already in SignalEntry interface (api-signals.ts:9). Frontend needs to render it as a link.

**Needs backend change:**

| Endpoint | Change | Detail |
|----------|--------|--------|
| `GET /api/agents` | Replace `skills: string[]` with `skillSlots: SkillSlot[]` | Current `skills` field is raw config strings (api-agents.ts:138). Need to integrate SkillIndex to return `{ name, enabled, source, boundAt }` per slot. Fallback: return empty array if agent has no SkillIndex entries. Keep existing `skills: string[]` for backwards compat, add `skillSlots` alongside it. |
| `GET /api/tasks` | Add pagination params | Thread `limit`/`offset` from query params through routes.ts to tasksHandler. Currently routes.ts:148 doesn't pass query to handler. |
| `GET /api/signals` | Add pagination params | Same router threading needed. Currently reads entire file and slices. |

### Router layer change

`routes.ts` must forward query params to `tasksHandler` and `signalsHandler`. Currently only `api-signals.ts` receives `query?.get('agent')`. Both handlers need `limit` and `offset` params threaded through.

### Hub section refresh fix

`app.js:292-295` selects sections by DOM index for WS-driven refresh. Adding the `.hub-grid` wrapper div will break this index-based selection. Implementation must switch to class-based or data-attribute selection (e.g., `section.querySelector('.hub-team')` instead of `sections[2]`).

### No new endpoints

All changes are modifications to existing API responses and router wiring.

---

## CSS Architecture

### New shared classes

```css
/* Data row system */
.data-view          /* viewport-fill container */
.data-header        /* sticky grid header with sort indicators */
.data-row           /* base row: hover, select, expand states */
.data-row--expanded /* open state with detail panel */
.data-cell          /* base cell */
.data-cell--right   /* right-aligned (numbers) */
.data-cell--center  /* center-aligned (status icons) */
.data-group         /* date separator row */
.data-expand        /* expansion panel below row */
.data-pill          /* inline colored badge */
.data-ring          /* trust ring component (reused from hub) */
.data-bar           /* tiny inline metric bar */
.data-sort          /* sort arrow indicator */
.data-load-more     /* pagination button */

/* Hub grid */
.hub-grid           /* 2-column layout for team + runs */
```

### Removed

- `.sig-row`, `.sig-*` styles (replaced by `.data-row`)
- All hardcoded `max-height` inline overrides on panel bodies
- Any remaining chart-related CSS not used by sparklines

### Design tokens

No changes to existing color tokens. The grid data rows use the same surface stack and semantic colors from v3.

---

## lib/data-rows.js — Shared API

The shared data row library exports these functions. All detail views consume this API.

```javascript
/**
 * Create a complete data view (header + scrollable row area + load-more).
 * Returns the container DOM element. Caller appends it to their section.
 *
 * @param {Object} options
 * @param {Array<{key: string, label: string, width: string, align?: 'left'|'right'|'center'}>} options.columns
 * @param {string} options.defaultSort - Column key to sort by initially
 * @param {'asc'|'desc'} options.defaultOrder - Initial sort direction
 * @param {Function} options.onSort - Called with (key, direction) when user clicks header
 * @param {Function} options.onLoadMore - Called when "Load more" clicked. Returns promise.
 * @param {number} options.total - Total item count (for "Load more" visibility)
 */
export function createDataView(options) → HTMLElement

/**
 * Render a single data row. Returns the row element.
 * Caller is responsible for cell content (can be text, pills, rings, etc).
 *
 * @param {Array<{content: string|HTMLElement, className?: string}>} cells
 * @param {Function} onExpand - Called when row clicked. Receives the row element.
 *                              Return an HTMLElement for the expansion panel content,
 *                              or null to collapse.
 */
export function createDataRow(cells, onExpand) → HTMLElement

/**
 * Render a date group separator row.
 * @param {string} label - e.g., "Today", "Yesterday", "Mar 30"
 */
export function createDateGroup(label) → HTMLElement

/**
 * Expansion state manager. Only one row expanded at a time.
 * Call expand(row) to open a row and close the previous one.
 * Call collapse() to close the current row.
 */
export function createExpansionManager() → { expand(row), collapse(), current() }

/**
 * Utility: format a number for display in metric cells.
 * 1234 → "1.2K", 1234567 → "1.2M"
 */
export function formatMetric(n) → string

/**
 * Utility: compute estimated cost from token counts.
 * Uses hardcoded per-provider rates (see COST_RATES below).
 */
export function estimateCost(provider, inputTokens, outputTokens) → string
```

**Cost rates** (hardcoded in `lib/data-rows.js`):
```javascript
const COST_RATES = {
  anthropic: { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },   // Claude Sonnet
  google:    { input: 1.25 / 1_000_000, output: 10.0 / 1_000_000 },   // Gemini Pro
  default:   { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
};
```

These are rough estimates for display only — not billing-accurate. The `default` rate applies when provider is unknown.

---

## Files to Change

### Frontend (packages/dashboard/src/)

| File | Change |
|------|--------|
| `style.css` | Add data row system classes, hub-grid, remove dead styles |
| `app.js` | Hub grid layout, live timestamp intervals (1s + 30s), fix section refresh to use class-based selectors |
| `hub/overview.js` | Add aggregate metrics to status bar |
| `hub/activity.js` | Add NEW pill, adapt to side-by-side layout |
| `hub/team.js` | Adapt to hub-grid left column |
| `detail/agent.js` | Rewrite as grid data rows with inline expansion |
| `detail/tasks.js` | Rewrite as grid data rows with filters, search, pagination |
| `detail/signals.js` | Rewrite as grid data rows with task ID links |
| `detail/consensus.js` | Rewrite findings as grid data rows with dispute comparison |
| `detail/knowledge.js` | Task history section → grid data rows |
| `lib/data-rows.js` | **New**: shared data row rendering (see API below) |

### Backend (packages/relay/src/dashboard/)

| File | Change |
|------|--------|
| `api-tasks.ts` | Add pagination (`limit`/`offset` params) |
| `api-signals.ts` | Add pagination (`limit`/`offset` params) |
| `api-agents.ts` | Add `skillSlots` field from SkillIndex integration |
| `routes.ts` | Thread query params to tasksHandler and signalsHandler |

### Build

| File | Change |
|------|--------|
| `packages/dashboard/build.js` | Include new `lib/data-rows.js` in bundle |

---

## Out of Scope

- Task dispatch from dashboard (use MCP tools)
- Drag-to-resize columns
- Column visibility toggle
- Export to CSV
- Keyboard navigation between rows
- Virtual scrolling for 1000+ rows (pagination handles this)
- Cost model configuration beyond hardcoded estimates (see COST_RATES in lib/data-rows.js)
- Mobile-specific layouts (current breakpoints sufficient)
- Action buttons on findings (Mark Verified, Escalate)
- Competency radar charts (bars are sufficient)
- Agent-to-agent comparison view

---

## Test Plan

### Hub
- Hub grid renders team + runs side-by-side above 1000px, stacks below
- Status bar shows aggregate metrics (total tasks, consensus rate)
- NEW pill appears on runs with `counts.new > 0`
- Active task elapsed time updates every 1s
- Relative timestamps refresh every 30s

### Detail views
- All data views render with correct grid column alignment
- Sort: clicking header toggles asc/desc, arrow indicator updates
- Sticky headers stay visible on scroll
- Row expansion: click opens detail panel below, click again closes
- Only one row expanded at a time
- Hover state visible on all rows
- Numbers right-aligned in monospace

### Agent view
- Trust ring + initials render inline in first cell
- Expanded row shows skills, competencies, recent tasks
- Default sort by dispatch weight

### Tasks view
- Filter pills filter rows by status
- Search filters by agent ID and description
- Running tasks show pulsing border
- Expanded row shows full description and result
- "Load more" fetches next 50 tasks
- Date group headers appear at time gaps

### Signals view
- Type pills use correct consensus tag colors
- Task ID links navigate to consensus detail
- Sparkline renders above data rows
- Expanded row shows full evidence

### Consensus detail
- DISPUTED rows expand to side-by-side comparison
- UNVERIFIED rows show dimmed label
- Summary pills match finding counts

### API
- `/api/tasks?limit=50&offset=0` returns paginated results with `total`
- `/api/signals?limit=50&offset=0` returns paginated results with `total`
- `/api/tasks` response includes `inputTokens`, `outputTokens`
- `/api/agents` response includes `skills` array
- `/api/signals` response includes `taskId`

### Edge cases
- Empty state: views with no data show muted placeholder text
- Empty filter: "No matching items" with "Clear filters" link when filters produce zero results
- API error: "Failed to load — Retry" shown, retry link re-fetches
- Pagination exhaustion: "Load more" button hidden when all items loaded
- Search scope: "(searching N loaded of M total)" shown when not all data is loaded
- Long task descriptions: truncated with ellipsis in grid row, full text in expansion panel
- Hub section refresh: WS events correctly target sections after hub-grid wrapper added

### Performance
- Hub loads in < 500ms with 400+ tasks in history
- Detail views render 50 rows in < 200ms
- Pagination prevents payload bloat
