# Dashboard Redesign: Terminal Amber

## Context

The current gossipcat dashboard uses generic dark-theme styling (Tailwind violet-400 accent, Outfit font, soft-cornered cards) that is visually indistinguishable from dozens of AI tools. Three-agent review confirmed: the accent color is the single biggest liability, typography has no identity, and the layout lacks personality. The auth page has CRT personality that doesn't carry into the dashboard.

This redesign establishes a cohesive "retro terminal" aesthetic using Terminal Amber (#ffb347) on deep dark, monospace-first typography, and CRT atmosphere throughout. Agent cards become horizontal roster rows with a NeuralAvatar hero strip above.

## Implementation Phases

**Phase 1: CSS Reskin + Roster Rows** (~6-8 hours)
Sections 1-3, 4b-4c, 5-9. Color palette, typography, layout, roster rows, CRT atmosphere, auth page.

**Phase 2: NeuralAvatar Strip** (~1-2 days, follow-on)
Section 4a. Port canvas engine from crab-language, integrate hero strip above roster.

---

## 1. Color Palette

Replace all Tailwind defaults with warm Terminal Amber palette.

```css
:root {
  --bg: #08090e;                          /* keep — strong deep dark */
  --surface: #0f0e0a;                     /* warm dark surface (was #0e1017) */
  --surface-raised: #1a1714;              /* warm raised (was #131620) */
  --surface-hover: #221f1a;               /* warm hover (was #181c28) */
  --border: rgba(255,179,71,0.06);        /* amber-tinted border (was white 0.05) */
  --border-active: rgba(255,179,71,0.25); /* amber active border */
  --text: #efe9e0;                        /* warm cream (was #e4e6ef) */
  --text-2: #9d8a78;                      /* warm taupe (was #a0a4b8) */
  --text-3: #6b5f52;                      /* warm muted (was #7c8099) */
  --accent: #ffb347;                      /* Terminal Amber (was #a78bfa) */
  --accent-glow: rgba(255,179,71,0.12);   /* amber glow — use for pill-b, tag-u, tag-b backgrounds, status bar attention bg */
  --green: #34d399;                       /* keep for confirmed */
  --green-glow: rgba(52,211,153,0.12);    /* keep */
  --red: #f87171;                         /* keep for disputed */
  --red-glow: rgba(248,113,113,0.1);      /* keep */
  --amber: #facc15;                       /* SHIFTED more yellow (was #fbbf24) — visual separation from --accent */
  --amber-glow: rgba(250,204,21,0.1);     /* updated to match new --amber */
  --blue: #60a5fa;                        /* keep for unique */
  --blue-glow: rgba(96,165,250,0.1);      /* keep */
}
```

**IMPORTANT:** Replace ALL hardcoded `rgba(167,139,250,...)` (violet) throughout style.css with appropriate `var(--accent-glow)` or amber rgba equivalents. This includes:
- `pill-b` background (line ~314)
- `tag-u` and `tag-b` backgrounds (lines ~323-324)
- `tvFlicker` and `crtFlicker` keyframe `drop-shadow` values (lines ~118-131)
- `auth-card` border, box-shadow
- `.run-card.run-open` border-color
- `border-active` references

## 2. Typography

Monospace-first, with proportional fallback for prose readability.

```css
:root {
  --body: 'JetBrains Mono', monospace;    /* was Outfit — primary font */
  --mono: 'JetBrains Mono', monospace;    /* keep */
  --prose: 'Outfit', system-ui, sans-serif; /* proportional for task descriptions */
}

body {
  font-size: 13px;
  font-feature-settings: "zero";          /* slashed zeros */
  -webkit-font-smoothing: antialiased;
}
```

- Section headers: 11px, uppercase, `letter-spacing: 0.08em`, `font-weight: 700`
- Data text: 13px mono, weight 400
- Labels/meta: 11px mono, `--text-3` color
- **Task descriptions / prose fields**: use `var(--prose)` — proportional for readability
- Keep Outfit in Google Fonts import (for prose), but JetBrains Mono is primary

## 3. Layout Changes

### 3a. Page container
- `max-width: 1400px` (was 1200px)

### 3b. Border radius
- Apply `border-radius: 3px` on component classes (`.ag`, `.run-card`, `.panel`, `.detail-stat`, `.pill`, `.filter-btn`, etc.)
- Do NOT use a universal `*` selector — it would override the auth card
- Auth card: keep `border-radius: 16px` (standalone branded element)

### 3c. Hub grid
- Already full-width stacked (done). No changes needed.

## 4. Agent Section: Hero Strip + Roster Rows

### 4a. NeuralAvatar Hero Strip (PHASE 2)
Above the roster, a horizontal strip of **64px** NeuralAvatars:
- Canvas-based, ported from crab-language `NeuralAvatar` component
- Source: `/Users/goku/claude/crab-language/dashboard/frontend/lib/neural-avatar.ts` (90% self-contained, only needs `hashString()` inlined from `mind-avatar.ts`)
- Simplified for vanilla JS: `SeededRNG`, `colorFromMind`, topology generators, `NeuralAvatarEngine` class — zero external deps
- Active agents: animated (breathing glow, node movement)
- Idle agents: static render, dimmed opacity (0.5)
- Clicking an avatar highlights the corresponding roster row via `data-agent-id` attribute + `document.querySelector`
- Strip: `display: flex; gap: 12px; overflow-x: auto; padding: 12px 0;`
- Scroll indicator: right-edge fade gradient when overflowing
- Canvas setup: `width="128" height="128"` (64px × 2 for retina), CSS `width: 64px; height: 64px; border-radius: 50%;`
- IntersectionObserver wrapper to pause off-screen animations

**Build order:** `neural-avatar.js` must be inserted in `build.js` concat list BEFORE `hub/team.js` (position 3 or earlier).

### 4b. Roster Rows (replace card grid) — PHASE 1
Each agent = one horizontal row in a table-like layout:

```
[GT]  gemini-tester       ████░░ 78%   ● IDLE    Review the scoring sys...   3h ago
[GI]  gemini-implementer  ██████ 95%   ◉ ACTIVE  Review consensus engine...  2h ago
```

Columns:
1. **Initials badge** — 2-letter mono badge, colored by performance tier
2. **Agent name** — mono, `--text` color, clickable → detail page
3. **Health bar** — single horizontal bar using `dispatchWeight` normalized: `(w - 0.3) / 1.7` maps [0.3, 2.0] → [0, 1]. Color by tier: green (w >= 1.5), amber (w >= 0.8), red (w < 0.8)
4. **Status** — dot + label. Derived from: `ACTIVE` if agent has an in-progress task in live strip data, `ERROR` if `lastTask.status === 'failed'`, `IDLE` otherwise. Green pulse for active, dim for idle, red for error.
5. **Last task** — truncated to ~60 chars, `--text-2`, uses `var(--prose)` font for readability
6. **Timestamp** — `timeAgo()`, `--text-3`

**Hover interaction:** subtle amber background wash + left amber border. Also shows tooltip: `Acc: 92% | Rel: 88% | Uniq: 65%` (from `agent.scores.accuracy`, `.reliability`, `.uniqueness`).

CSS: `display: grid; grid-template-columns: 36px 180px 120px 90px 1fr 70px; gap: 8px; align-items: center;`

**Responsive behavior:**
- **< 1000px (tablet):** Hide "Last task" and "Timestamp" columns. Grid becomes: `36px 180px 120px 90px`.
- **< 600px (mobile):** Collapse to stacked layout — agent name + health bar on one line, status below.

### 4c. Remove from current design
- SVG trust ring circles
- 3 separate stat bars (acc/rel/uniq) from card view (preserved in hover tooltip)
- Card `border-radius: 12px` styling
- "+N more" overflow button (show all agents)

## 5. CRT Atmosphere

### 5a. Global scanlines (from crab-language)
Apply to `html::before`. **Remove existing `body::before`** (violet radial gradient atmosphere — no longer needed with warm palette):
```css
html::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background: repeating-linear-gradient(
    0deg,
    transparent 0px, transparent 2px,
    rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px
  );
}
```

### 5b. Vignette (from crab-language)
Apply to `html::after`. **Remove existing `body::after`** (SVG noise texture — replaced by vignette):
```css
html::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9998;
  background: radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.3) 100%);
}
```

### 5c. Keep existing (with amber updates)
- Auth logo CRT flicker + TV glitch on hover — **update drop-shadow colors from violet to amber**: `rgba(255,179,71,0.3)` etc.
- Auth card scanline overlay
- WebSocket green glow dot

### 5d. New motion
- `fadeUp` stagger: increase delay to 80ms between sections (was 40ms)
- Active agent roster rows: subtle amber `text-shadow` pulse
- Run card expand: use `grid-template-rows: 0fr → 1fr` with `min-height: 0` on child element (required for animation to work, not just snap)

## 6. Status Bar

Flip priority — actionable info first:
```
LEFT:  [●] ALL CLEAR   or   [!] 5 findings need attention
RIGHT: 4 native · 3 relay  ·  last run 3h ago  ·  47 tasks  ·  82% consensus
```

- "ALL CLEAR" in `--green`
- "N findings need attention" in `--amber` with `var(--accent-glow)` background
- Move agent counts to right side
- **Keep `consensusRate` stat** (currently shown, was silently dropped in prior draft)

## 7. Section Headers

Terminal-style uppercase labels:
```
TEAM  7 AGENTS                                    all agents →
────────────────────────────────────────────────────────────────
```

- Title: 11px, uppercase, `letter-spacing: 0.08em`, `font-weight: 700`, `--text`
- Count badge: `--accent` color, no background box (was a small pill)
- Action link: `--text-3`, mono, hover → `--accent`
- Bottom border: `1px solid var(--border)` (replaces current `.sh` border-bottom — same element, updated styling)

## 8. Run Timeline

- Keep expandable card pattern (it works)
- Sharp corners (`border-radius: 3px`)
- Open state: amber border `rgba(255,179,71,0.3)` (was purple)
- Pills stay (green/red/amber/blue system works)
- Update `pill-b` background to `var(--accent-glow)`, color to `var(--accent)`
- Update `tag-u` and `tag-b` backgrounds to `var(--accent-glow)`
- Keep stacked bar chart

## 9. Auth Page

- Update CRT flicker/TV glitch drop-shadow colors from violet to amber
- Update button gradient to amber: `linear-gradient(135deg, #ffb347, #ff9d42)`
- Update input focus: amber border + amber glow `box-shadow: 0 0 0 3px rgba(255,179,71,0.15)`
- Update card border to amber-tinted: `rgba(255,179,71,0.15)`
- Keep gossipcat logo at 300px

## 10. Files to Modify

### Phase 1 (CSS Reskin + Roster Rows)

| File | Changes |
|------|---------|
| `packages/dashboard/src/style.css` | Color vars, typography, border-radius (per-class), layout widths, remove body::before/::after, add html::before/::after, section headers, roster row styles, update all violet hardcodes to amber, auth page amber |
| `packages/dashboard/src/hub/team.js` | Replace card grid with roster rows, add hover tooltip for acc/rel/uniq |
| `packages/dashboard/src/hub/overview.js` | Flip status bar priority (actionable left, counts right), keep consensusRate |
| `packages/dashboard/src/hub/activity.js` | Update accent color references |
| `packages/dashboard/src/index.html` | Keep both Outfit and JetBrains Mono in Google Fonts |
| `packages/dashboard/src/app.js` | Section header rendering (uppercase, letter-spacing) |

### Phase 2 (NeuralAvatar Strip)

| File | Changes |
|------|---------|
| `packages/dashboard/src/lib/neural-avatar.js` | NEW — vanilla JS port of crab-language NeuralAvatarEngine (~200-350 lines) |
| `packages/dashboard/src/hub/team.js` | Add hero strip above roster rows |
| `packages/dashboard/build.js` | Add neural-avatar.js to concat list BEFORE hub/team.js |

## 11. Verification

### Phase 1
1. `npm run build:dashboard && npm run build:mcp` — builds clean
2. Reconnect MCP, open dashboard — auth page shows amber button/borders/CRT glows
3. Login — overview shows CRT scanlines + vignette, warm amber throughout
4. Team section: roster rows with health bars, hover tooltip shows acc/rel/uniq
5. No violet/purple visible anywhere in the UI
6. Run timeline: amber accent on open cards, amber pills
7. Status bar: actionable info on left, consensusRate on right
8. `npx jest tests/relay/dashboard-auth.test.ts tests/relay/dashboard-routes.test.ts` — all pass
9. Responsive: check 1000px (hide task/time columns) and 600px (stacked layout) breakpoints

### Phase 2
10. NeuralAvatar strip renders above roster with 64px canvases
11. Active agents animate, idle agents static + dimmed
12. Click avatar → highlights roster row
13. Horizontal scroll with fade indicator when > 7 agents
