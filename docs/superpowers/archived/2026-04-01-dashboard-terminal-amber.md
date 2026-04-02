# Dashboard Terminal Amber — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the gossipcat dashboard from generic purple-on-dark to a cohesive Terminal Amber CRT aesthetic with roster-row agent layout.

**Architecture:** Pure CSS variable swap + JS layout changes. No new dependencies. Dashboard is vanilla JS/CSS built via file concatenation in `build.js`. All changes are in `packages/dashboard/src/`. Build produces `dist-dashboard/index.html` (single file with inlined CSS/JS).

**Tech Stack:** Vanilla JS, CSS custom properties, HTML Canvas (Phase 2 only), esbuild for optional minification.

**Spec:** `docs/superpowers/specs/2026-04-01-dashboard-redesign.md`

---

## File Map

| File | Role | Action |
|------|------|--------|
| `packages/dashboard/src/style.css` | All styles — colors, typography, layout, animations | Modify |
| `packages/dashboard/src/index.html` | HTML shell, font imports, auth gate markup | Modify |
| `packages/dashboard/src/app.js` | Router, section helper (`makeSection`), hub renderer | Modify |
| `packages/dashboard/src/hub/team.js` | Agent team section (currently card grid) | Rewrite |
| `packages/dashboard/src/hub/overview.js` | Status bar section | Modify |
| `packages/dashboard/src/hub/activity.js` | Consensus run timeline | Modify (minor) |

---

### Task 1: Color Palette — Replace Violet with Terminal Amber

**Files:**
- Modify: `packages/dashboard/src/style.css:4-25` (`:root` block)

- [ ] **Step 1: Replace the `:root` CSS variables**

In `packages/dashboard/src/style.css`, replace the entire `:root` block (lines 4-25):

```css
:root {
  --bg: #08090e;
  --surface: #0f0e0a;
  --surface-raised: #1a1714;
  --surface-hover: #221f1a;
  --border: rgba(255,179,71,0.06);
  --border-active: rgba(255,179,71,0.25);
  --text: #efe9e0;
  --text-2: #9d8a78;
  --text-3: #6b5f52;
  --accent: #ffb347;
  --accent-glow: rgba(255,179,71,0.12);
  --green: #34d399;
  --green-glow: rgba(52,211,153,0.12);
  --red: #f87171;
  --red-glow: rgba(248,113,113,0.1);
  --amber: #facc15;
  --amber-glow: rgba(250,204,21,0.1);
  --blue: #60a5fa;
  --blue-glow: rgba(96,165,250,0.1);
  --body: 'JetBrains Mono', monospace;
  --mono: 'JetBrains Mono', monospace;
  --prose: 'Outfit', system-ui, sans-serif;
}
```

- [ ] **Step 2: Replace all hardcoded violet rgba values**

Find and replace all `rgba(167,139,250,...)` occurrences in `style.css` with amber equivalents. There are 20 occurrences. Use these replacements:

| Line | Old | New |
|------|-----|-----|
| 11 | `--border-active: rgba(167,139,250,0.25)` | Already handled in Step 1 |
| 49 | `rgba(167,139,250,0.04)` | `rgba(255,179,71,0.04)` |
| 76 | `rgba(167,139,250,0.08)` | `rgba(255,179,71,0.08)` |
| 80 | `rgba(167,139,250,0.15)` | `rgba(255,179,71,0.15)` |
| 85 | `rgba(167,139,250,0.06)` | `rgba(255,179,71,0.06)` |
| 105 | `rgba(167,139,250,0.3)` | `rgba(255,179,71,0.3)` |
| 120-131 | All `tvFlicker` drop-shadows | Replace `167,139,250` with `255,179,71` |
| 148 | `rgba(167,139,250,0.15)` | `rgba(255,179,71,0.15)` |
| 156 | `rgba(167,139,250,0.3)` | `rgba(255,179,71,0.3)` |
| 161 | `rgba(167,139,250,0.4)` | `rgba(255,179,71,0.4)` |
| 302 | `.run-card.run-open` border | `rgba(255,179,71,0.3)` |
| 314 | `.pill-b` background | `var(--accent-glow)` |
| 323 | `.tag-u` background | `var(--accent-glow)` |
| 324 | `.tag-b` background | `var(--accent-glow)` |
| 408 | `.filter-btn.active` background | `rgba(255,179,71,0.08)` |

Efficient approach — do a global find-replace of `167,139,250` with `255,179,71` in `style.css`.

- [ ] **Step 3: Update auth button gradient**

In `style.css`, find `.auth-card button` (around line 149-157) and replace:

Old: `background: linear-gradient(135deg, var(--accent), #818cf8);`
New: `background: linear-gradient(135deg, var(--accent), #ff9d42);`

Old: `box-shadow: 0 2px 12px rgba(167,139,250,0.3);` (already replaced in Step 2)

Also update `.auth-card button:hover`:
Old: `box-shadow: 0 4px 20px rgba(167,139,250,0.4);` (already replaced in Step 2)

- [ ] **Step 4: Build and verify**

Run: `npm run build:dashboard`
Expected: `Dashboard built → .../dist-dashboard/index.html`

Verify: `grep -c "167,139,250" dist-dashboard/index.html`
Expected: `0` (no violet remnants)

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/style.css
git commit -m "feat(dashboard): replace violet palette with Terminal Amber"
```

---

### Task 2: CRT Atmosphere — Scanlines + Vignette

**Files:**
- Modify: `packages/dashboard/src/style.css:42-57` (body pseudo-elements)

- [ ] **Step 1: Replace body pseudo-elements with html CRT overlays**

In `style.css`, find and replace the `body::before` block (lines ~43-50, the radial gradient atmosphere):

```css
/* OLD — remove this entire block */
body::before {
  content: '';
  position: fixed; inset: 0;
  pointer-events: none; z-index: -2;
  background:
    radial-gradient(ellipse 60% 45% at 20% -8%, rgba(255,179,71,0.04) 0%, transparent 65%),
    radial-gradient(ellipse 45% 35% at 85% 105%, rgba(52,211,153,0.02) 0%, transparent 55%);
}
```

Replace with:

```css
html::before {
  content: '';
  position: fixed; inset: 0;
  pointer-events: none; z-index: 9999;
  background: repeating-linear-gradient(
    0deg,
    transparent 0px, transparent 2px,
    rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px
  );
}
```

Then find and replace the `body::after` block (lines ~51-57, the SVG noise texture):

```css
/* OLD — remove this entire block */
body::after {
  content: '';
  position: fixed; inset: 0;
  pointer-events: none; z-index: -1;
  background-image: url("data:image/svg+xml,...");
  opacity: 0.012;
}
```

Replace with:

```css
html::after {
  content: '';
  position: fixed; inset: 0;
  pointer-events: none; z-index: 9998;
  background: radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.3) 100%);
}
```

- [ ] **Step 2: Update fadeUp stagger timing**

In `style.css`, find the `.section:nth-child` animation rules (around line 432-436) and update delays:

Old:
```css
.section:nth-child(1) { animation: fadeUp 0.35s ease-out; }
.section:nth-child(2) { animation: fadeUp 0.35s ease-out 0.04s both; }
.section:nth-child(3) { animation: fadeUp 0.35s ease-out 0.08s both; }
.section:nth-child(4) { animation: fadeUp 0.35s ease-out 0.12s both; }
.section:nth-child(5) { animation: fadeUp 0.35s ease-out 0.16s both; }
```

New:
```css
.section:nth-child(1) { animation: fadeUp 0.35s ease-out; }
.section:nth-child(2) { animation: fadeUp 0.35s ease-out 0.08s both; }
.section:nth-child(3) { animation: fadeUp 0.35s ease-out 0.16s both; }
.section:nth-child(4) { animation: fadeUp 0.35s ease-out 0.24s both; }
.section:nth-child(5) { animation: fadeUp 0.35s ease-out 0.32s both; }
```

- [ ] **Step 3: Build and verify**

Run: `npm run build:dashboard`
Expected: builds clean. Open dashboard in browser — scanlines visible as faint horizontal lines, vignette darkens edges.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/style.css
git commit -m "feat(dashboard): add CRT scanlines and vignette atmosphere"
```

---

### Task 3: Typography + Layout — Monospace Primary, Wider Container, Sharp Corners

**Files:**
- Modify: `packages/dashboard/src/style.css` (multiple sections)
- Modify: `packages/dashboard/src/index.html:7` (font import)

- [ ] **Step 1: Update Google Fonts import**

In `index.html` line 7, replace:

Old:
```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

New:
```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
```

(Keep Outfit for `--prose` but trim weights. Add weight 700 to JetBrains Mono for headers.)

- [ ] **Step 2: Update body font and add font-feature-settings**

In `style.css`, find the `body` rule (around line 30-39) and update:

Old:
```css
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--body);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  overflow-x: hidden;
  isolation: isolate;
}
```

New:
```css
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--body);
  font-size: 13px;
  line-height: 1.55;
  font-feature-settings: "zero";
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  overflow-x: hidden;
  isolation: isolate;
}
```

- [ ] **Step 3: Widen page container**

In `style.css`, find `.page` (around line 206-210):

Old: `max-width: 1200px;`
New: `max-width: 1400px;`

- [ ] **Step 4: Replace border-radius on all component classes**

In `style.css`, apply these replacements:

| Selector | Old `border-radius` | New |
|----------|---------------------|-----|
| `.auth-card` | `16px` | `16px` (keep — auth is exempt) |
| `.ag` | `12px` | `3px` |
| `.panel` | `12px` | `3px` |
| `.run-card` | `10px` | `3px` |
| `.detail-stat` | `10px` | `3px` |
| `.status-bar` | `10px` | `3px` |
| `.auth-card input` | `10px` | `10px` (keep — auth exempt) |
| `.auth-card button` | `10px` | `10px` (keep — auth exempt) |
| `.pill` | `5px` | `3px` |
| `.filter-btn` | `6px` | `3px` |
| `.know-card` | `8px` | `3px` |
| `.live-strip` | `10px` | `3px` |

- [ ] **Step 5: Update section header styling**

In `style.css`, find `.sh-title` (around line 220):

Old: `font-size: 13px; font-weight: 600; color: var(--text); letter-spacing: 0.01em;`
New: `font-size: 11px; font-weight: 700; color: var(--text); letter-spacing: 0.08em; text-transform: uppercase;`

Find `.sh-count` (around line 221-225):

Old:
```css
.sh-count {
  font-size: 10px; font-family: var(--mono); font-weight: 500;
  color: var(--text-3); background: var(--surface-raised);
  padding: 2px 8px; border-radius: 4px;
}
```

New:
```css
.sh-count {
  font-size: 10px; font-family: var(--mono); font-weight: 500;
  color: var(--accent);
}
```

- [ ] **Step 6: Build and verify**

Run: `npm run build:dashboard`
Expected: builds clean. Dashboard shows JetBrains Mono everywhere, wider layout, sharp corners, uppercase section headers.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/style.css packages/dashboard/src/index.html
git commit -m "feat(dashboard): monospace typography, wider layout, sharp corners, terminal headers"
```

---

### Task 4: Agent Roster Rows — Replace Card Grid

**Files:**
- Rewrite: `packages/dashboard/src/hub/team.js`
- Modify: `packages/dashboard/src/style.css` (add roster styles, update agent-grid)

- [ ] **Step 1: Add roster row CSS**

In `style.css`, find the `/* ── Agent Cards */` section (around line 247). Replace the `.agent-grid` rule and add roster styles. Keep the old `.ag` styles for now (the detail page may still use them). Add BEFORE the existing `.ag` rule:

```css
/* ── Agent Roster ──────────────────────────────── */
.roster { display: flex; flex-direction: column; gap: 2px; }
.roster-row {
  display: grid;
  grid-template-columns: 36px 180px 120px 80px 1fr 70px;
  gap: 8px; align-items: center;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
}
.roster-row:hover {
  background: var(--surface-raised);
  border-left-color: var(--accent);
}
.roster-row.roster-active { border-left-color: var(--green); }
.roster-badge {
  font-family: var(--mono); font-size: 11px; font-weight: 700;
  width: 32px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 3px;
  background: var(--surface-hover);
}
.roster-name {
  font-family: var(--mono); font-size: 13px; font-weight: 600;
  color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.roster-bar-wrap {
  display: flex; align-items: center; gap: 6px;
}
.roster-bar {
  flex: 1; height: 4px; background: rgba(255,255,255,0.06);
  border-radius: 2px; overflow: hidden;
}
.roster-bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
.roster-pct { font-family: var(--mono); font-size: 11px; color: var(--text-3); min-width: 32px; }
.roster-status {
  display: flex; align-items: center; gap: 5px;
  font-family: var(--mono); font-size: 11px; color: var(--text-3);
}
.roster-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.roster-dot.online { background: var(--green); box-shadow: 0 0 6px rgba(52,211,153,0.5); }
.roster-dot.idle { background: var(--text-3); opacity: 0.4; }
.roster-dot.error { background: var(--red); }
.roster-task {
  font-family: var(--prose); font-size: 12px; color: var(--text-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.roster-time { font-family: var(--mono); font-size: 11px; color: var(--text-3); text-align: right; }
.roster-tooltip {
  display: none; position: absolute; top: 100%; left: 36px; z-index: 100;
  background: var(--surface-hover); border: 1px solid var(--border); border-radius: 3px;
  padding: 6px 10px; font-family: var(--mono); font-size: 11px; color: var(--text-2);
  white-space: nowrap; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}
.roster-row:hover .roster-tooltip { display: block; }

@media (max-width: 1000px) {
  .roster-row { grid-template-columns: 36px 180px 120px 80px; }
  .roster-task, .roster-time { display: none; }
}
@media (max-width: 600px) {
  .roster-row { grid-template-columns: 36px 1fr 80px; gap: 6px; }
  .roster-bar-wrap { display: none; }
}
```

- [ ] **Step 2: Rewrite team.js with roster rows**

Replace the entire contents of `packages/dashboard/src/hub/team.js`:

```javascript
// packages/dashboard/src/hub/team.js — Agent roster rows

function renderTeamSection(agents, liveTaskAgents) {
  const { escapeHtml: e, navigate, makeSection, timeAgo, agentInitials } = window._dash;
  const section = makeSection('Team', agents.length + ' agents', 'all agents \u2192', '#/team');

  var roster = document.createElement('div');
  roster.className = 'roster';

  var sorted = agents.slice().sort(function(a, b) {
    return (b.scores?.dispatchWeight || 0) - (a.scores?.dispatchWeight || 0);
  });

  var liveSet = new Set(liveTaskAgents || []);

  for (var i = 0; i < sorted.length; i++) {
    var agent = sorted[i];
    var row = document.createElement('div');
    row.className = 'roster-row';
    row.dataset.agentId = agent.id;

    var w = agent.scores?.dispatchWeight ?? 1;
    var signals = agent.scores?.signals ?? 0;
    var accuracy = agent.scores?.accuracy ?? 0.5;
    var reliability = agent.scores?.reliability ?? 0.5;
    var uniqueness = agent.scores?.uniqueness ?? 0.5;

    var tierColor = signals === 0 ? 'var(--text-3)'
      : w >= 1.5 ? 'var(--green)'
      : w >= 0.8 ? 'var(--amber)'
      : 'var(--red)';

    // Health bar: normalize dispatchWeight from [0.3, 2.0] to [0, 1]
    var health = Math.min(1, Math.max(0, (w - 0.3) / 1.7));
    var healthPct = Math.round(health * 100);

    // Status: active if in live tasks, error if last task failed, else idle
    var isActive = liveSet.has(agent.id);
    var isError = agent.lastTask?.status === 'failed';
    var statusDot = isActive ? 'online' : isError ? 'error' : 'idle';
    var statusText = isActive ? 'ACTIVE' : isError ? 'ERROR' : 'IDLE';

    var lastTask = agent.lastTask;
    var lastText = lastTask
      ? e((lastTask.task || '').replace(/\n.*/s, '').slice(0, 60))
      : '';
    var lastTime = lastTask?.timestamp ? timeAgo(lastTask.timestamp) : '';

    row.innerHTML =
      '<span class="roster-badge" style="color:' + tierColor + '">' + agentInitials(agent.id) + '</span>' +
      '<span class="roster-name">' + e(agent.id) + '</span>' +
      '<div class="roster-bar-wrap">' +
        '<div class="roster-bar"><div class="roster-bar-fill" style="width:' + healthPct + '%;background:' + tierColor + '"></div></div>' +
        '<span class="roster-pct">' + healthPct + '%</span>' +
      '</div>' +
      '<div class="roster-status">' +
        '<span class="roster-dot ' + statusDot + '"></span>' +
        '<span>' + statusText + '</span>' +
      '</div>' +
      '<span class="roster-task">' + lastText + '</span>' +
      '<span class="roster-time">' + lastTime + '</span>' +
      '<div class="roster-tooltip">Acc: ' + Math.round(accuracy * 100) + '% | Rel: ' + Math.round(reliability * 100) + '% | Uniq: ' + Math.round(uniqueness * 100) + '%</div>';

    row.addEventListener('click', (function(id) {
      return function() { navigate('#/team/' + encodeURIComponent(id)); };
    })(agent.id));

    if (isActive) row.classList.add('roster-active');
    roster.appendChild(row);
  }

  section.appendChild(roster);
  return section;
}
```

- [ ] **Step 3: Update hub renderer to pass live task agents**

In `packages/dashboard/src/app.js`, find where `renderTeamSection` is called (around line 248). The current call is:

```javascript
const teamEl = renderTeamSection(agents);
```

We need to pass the list of agents with active tasks. Find the `renderHub` function (around line 225) and update:

After `const [overview, agents, consensus] = await Promise.all([...]);` (line 228-230), add:

```javascript
    // Collect agent IDs with active live tasks
    var liveTaskAgents = [];
    try {
      var tasksData = await api('tasks?status=running');
      if (tasksData && tasksData.tasks) {
        liveTaskAgents = tasksData.tasks.map(function(t) { return t.agentId; });
      }
    } catch(e) { /* best-effort */ }
```

Then update the two `renderTeamSection` calls:

Line ~248: `const teamEl = renderTeamSection(agents, liveTaskAgents);`
Line ~331 (in the WS refresh handler): `const teamEl = renderTeamSection(ag, []);`

(The WS handler doesn't have live data readily available, so pass empty — it will refresh on next event.)

- [ ] **Step 4: Build and verify**

Run: `npm run build:dashboard`
Expected: builds clean. Dashboard team section shows horizontal roster rows with health bars, status dots, tooltips on hover.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/style.css packages/dashboard/src/hub/team.js packages/dashboard/src/app.js
git commit -m "feat(dashboard): replace agent card grid with roster rows"
```

---

### Task 5: Status Bar — Flip Priority

**Files:**
- Modify: `packages/dashboard/src/hub/overview.js`

- [ ] **Step 1: Rewrite the status bar renderer**

Replace the entire contents of `packages/dashboard/src/hub/overview.js`:

```javascript
// packages/dashboard/src/hub/overview.js — Status bar

function renderOverviewSection(data) {
  var timeAgo = window._dash.timeAgo;
  var section = document.createElement('div');
  section.className = 'section status-bar';

  var connected = data.relayConnected || 0;
  var native = data.nativeCount || 0;
  var actionable = data.actionableFindings || 0;

  var lastRun = data.lastConsensusTimestamp;
  var lastRunText = lastRun ? timeAgo(lastRun) : 'never';

  var totalTasks = data.totalTasks != null ? data.totalTasks : null;
  var confirmedFindings = data.confirmedFindings != null ? data.confirmedFindings : null;
  var totalFindings = data.totalFindings != null ? data.totalFindings : null;
  var consensusRate = (confirmedFindings != null && totalFindings != null && totalFindings > 0)
    ? Math.round((confirmedFindings / totalFindings) * 100) + '%'
    : null;

  // LEFT: actionable info first
  var leftHtml;
  if (actionable > 0) {
    leftHtml = '<span class="sb-action">' + actionable + ' findings need attention</span>';
  } else {
    leftHtml = '<span class="sb-dot online"></span><span class="sb-clear">ALL CLEAR</span>';
  }

  // RIGHT: system stats
  var rightParts = [
    '<span class="sb-stat">' + data.nativeCount + ' native &middot; ' + data.relayCount + ' relay</span>',
    '<span class="sb-sep">&middot;</span>',
    '<span class="sb-stat">last run ' + lastRunText + '</span>',
  ];
  if (totalTasks != null) {
    rightParts.push('<span class="sb-sep">&middot;</span><span class="sb-stat">' + totalTasks + ' tasks</span>');
  }
  if (consensusRate != null) {
    rightParts.push('<span class="sb-sep">&middot;</span><span class="sb-stat">' + consensusRate + ' consensus</span>');
  }

  section.innerHTML =
    '<div class="sb-left">' + leftHtml + '</div>' +
    '<div class="sb-right">' + rightParts.join('') + '</div>';

  return section;
}
```

- [ ] **Step 2: Update sb-action styling for amber glow**

In `style.css`, find `.sb-action` (around line 243):

Old: `color: var(--amber); font-size: 13px; font-weight: 600; font-family: var(--mono);`
New: `color: var(--amber); font-size: 13px; font-weight: 600; font-family: var(--mono); background: var(--amber-glow); padding: 2px 8px; border-radius: 3px;`

- [ ] **Step 3: Build and verify**

Run: `npm run build:dashboard`
Expected: Status bar shows "ALL CLEAR" or "N findings need attention" on the LEFT, system stats on the RIGHT.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/hub/overview.js packages/dashboard/src/style.css
git commit -m "feat(dashboard): flip status bar priority — actionable info first"
```

---

### Task 6: Run Timeline — Amber Accent Updates

**Files:**
- Modify: `packages/dashboard/src/hub/activity.js` (minor)

- [ ] **Step 1: Verify activity.js accent references**

Read `packages/dashboard/src/hub/activity.js`. The file uses CSS classes (`pill-g`, `pill-r`, `pill-y`, `pill-b`, `bar-seg-g`, etc.) which reference CSS variables. Since we updated `--accent` and all `rgba(167,139,250,...)` values in Task 1, the activity section should already render in amber.

Check: does `activity.js` contain any hardcoded violet color strings?

Run: `grep "167,139,250\|a78bfa\|818cf8" packages/dashboard/src/hub/activity.js`
Expected: no matches. If matches found, replace them.

- [ ] **Step 2: Build and verify**

Run: `npm run build:dashboard`
Expected: Run timeline cards show amber accent on open state, amber pills for "unique" findings.

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add packages/dashboard/src/hub/activity.js
git commit -m "fix(dashboard): remove any remaining violet hardcodes from activity"
```

---

### Task 7: Final Build + Full Verification

**Files:**
- All modified files from Tasks 1-6

- [ ] **Step 1: Full rebuild**

```bash
npm run build:dashboard && npm run build:mcp
```

Expected: Both build clean, no errors.

- [ ] **Step 2: Verify no violet remnants**

```bash
grep -c "167,139,250\|a78bfa\|818cf8" dist-dashboard/index.html
```

Expected: `0`

- [ ] **Step 3: Run tests**

```bash
npx jest tests/relay/dashboard-auth.test.ts tests/relay/dashboard-routes.test.ts --no-coverage
```

Expected: All tests pass (auth tests don't depend on CSS).

- [ ] **Step 4: Manual visual verification**

Reconnect MCP (`/mcp`), get dashboard key from `gossip_status`, open dashboard:

1. Auth page: amber button, amber input focus glow, amber card border, CRT flicker with amber drop-shadows
2. Login → Overview: CRT scanlines visible, vignette darkens edges, status bar has actionable info on left
3. Team section: roster rows with health bars, hover shows acc/rel/uniq tooltip
4. Runs section: amber accent on expanded cards, amber pills
5. No purple/violet visible anywhere
6. Resize to 1000px: roster hides task/time columns
7. Resize to 600px: roster stacks

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(dashboard): Terminal Amber Phase 1 complete — CRT aesthetic, roster rows, amber palette"
```
