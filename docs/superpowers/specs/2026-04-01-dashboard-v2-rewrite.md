# Dashboard v2: React + Vite Rewrite

## Context

The vanilla JS gossipcat dashboard hit a fundamental ceiling — string concatenation DOM manipulation, no component system, no state management. Multiple design iterations couldn't overcome the architectural limitations. Decision: full rewrite with a modern frontend stack.

## Stack

- **React 19** + **Vite** (client-side SPA, no SSR)
- **shadcn/ui** (copy-paste components, Tailwind-native)
- **Tailwind v4** (CSS framework)
- **Dark purple theme** (deep dark backgrounds, purple accent, polished)

## Theme: Dark Purple

Not the old Tailwind violet-400 default. A refined, deeper purple palette:

```css
--bg: #09090b;              /* zinc-950 — true dark */
--surface: #0f0f14;         /* custom — slightly purple-tinted */
--surface-raised: #16161e;  /* card backgrounds */
--border: rgba(139,92,246,0.08);  /* purple-tinted borders */
--accent: #8b5cf6;          /* violet-500 — deeper than old a78bfa */
--accent-glow: rgba(139,92,246,0.12);
--text: #fafafa;            /* zinc-50 */
--text-muted: #a1a1aa;      /* zinc-400 */
--green: #34d399;           /* emerald-400 — confirmed */
--red: #f87171;             /* red-400 — disputed */
--amber: #fbbf24;           /* amber-400 — unverified */
--purple: #c084fc;          /* purple-400 — unique */
```

Font: `Inter` for body, `JetBrains Mono` for data/IDs/metrics.

## Layout: Single-Page, 4 Sections

No routing. One page with 4 stacked sections. WebSocket for live updates.

```
┌──────────────────────────────────────────────────┐
│  Topbar: gossipcat logo + connection status       │
├──────────────────────────────────────────────────┤
│  1. FINDINGS METRICS                              │
│     All-time summary with stacked bar             │
├──────────────────────────────────────────────────┤
│  2. TEAM (max 5, "see team" for rest)            │
│     [52px avatar | id, model, status, metrics,    │
│      last task-id + time] per agent               │
│     Click row → modal with full agent detail      │
├──────────────────────────────────────────────────┤
│  3. TASKS                                         │
│     Table: status | task-id | agent-id |          │
│     description | duration | when                 │
│     Live tasks (running) + recent completed       │
├──────────────────────────────────────────────────┤
│  4. RECENT MEMORIES (last 20)                     │
│     Readable memory entries                       │
└──────────────────────────────────────────────────┘
```

---

## Section 1: Findings Metrics

All-time summary of consensus findings across all runs.

**Data source:** `GET /dashboard/api/consensus` → aggregate counts from all runs.

**Display:**
- 4 metric cards in a row: Confirmed (green), Disputed (red), Unverified (amber), Unique (purple)
- Each card: count + label
- Below cards: stacked horizontal bar showing proportions
- Total findings count as subtitle

**Component:** `<FindingsMetrics data={consensusData} />`

---

## Section 2: Team

Agent roster with NeuralAvatars and metrics.

**Data source:** `GET /dashboard/api/agents`

**Display:** Vertical list of agent rows. Max 5 visible. Each row:

| 52px NeuralAvatar | Agent info + metrics |
|---|---|
| Canvas, animated if online, dimmed if offline | **agent-id** (bold mono) |
| | model: `anthropic/claude-sonnet-4-6` (muted) |
| | ● ONLINE / ○ OFFLINE status |
| | Acc: 92% · Rel: 88% · Uniq: 65% (small progress bars or text) |
| | Last: `task-a1b2c3` · 3h ago |

If more than 5 agents, show "see team (N more)" button that expands to show all.

**Click row → Agent Detail Modal:**
- Full agent stats (accuracy, reliability, uniqueness, signals count, dispatch weight)
- Task history (all tasks for this agent, paginated)
- Performance over time (if data available)
- Skills list
- Memory entries for this agent

**Components:**
- `<TeamSection agents={agents} />`
- `<AgentRow agent={agent} />`
- `<NeuralAvatar agentId={string} size={52} online={boolean} />`
- `<AgentDetailModal agent={agent} open={boolean} onClose={fn} />`

---

## Section 3: Tasks

Table of live + recent tasks.

**Data source:** `GET /dashboard/api/tasks` (paginated, newest first)

**Display:** Table with columns:

| Status | Task ID | Agent | Description | Duration | When |
|--------|---------|-------|-------------|----------|------|
| ● (green) | `task-a1b2` | sonnet-reviewer | Review auth middleware... | 12s | 1h ago |
| ● (green) | `task-c3d4` | gemini-impl... | Fix scoring engine... | 45s | 2h ago |
| ◌ (amber pulse) | `task-e5f6` | haiku-research | Explore deps... | running | just now |
| ✕ (red) | `task-g7h8` | gemini-tester | Test consensus... | 8s | 3h ago |

- Status marks: ● completed (green), ◌ running (amber, pulsing), ✕ failed (red)
- Running tasks: elapsed time ticks live
- Task ID: monospace, clickable (could expand to show full task + result)
- Agent ID: monospace, colored by agent color
- Description: truncated, proportional font
- Duration: in seconds for completed, "running" for active
- When: relative time (`timeAgo`)

**Components:**
- `<TasksSection tasks={tasks} />`
- `<TaskRow task={task} />`

---

## Section 4: Recent Memories

Last 20 memory entries across all agents.

**Data source:** `GET /dashboard/api/knowledge` → aggregate recent entries

**Display:** List of memory cards, each showing:
- Agent avatar (small, 24px) + agent name
- Memory type badge (cognitive, skill, session)
- Memory content preview (first 2-3 lines, markdown rendered)
- Timestamp

Expandable: click to see full memory content.

**Components:**
- `<RecentMemories memories={memories} />`
- `<MemoryCard memory={memory} />`

---

## Auth

Keep the existing auth flow:
- Dashboard key generated in-memory on server boot
- Login form → POST `/dashboard/api/auth` → session cookie
- All API calls use cookie auth

Auth gate: if not authenticated, show login screen with gossipcat logo.

---

## NeuralAvatar

Port the canvas-based NeuralAvatar from crab-language as a React component.

**Source:** `/Users/goku/claude/crab-language/dashboard/frontend/lib/neural-avatar.ts`

**React component:** `<NeuralAvatar agentId={string} size={number} online={boolean} />`

- Canvas-based, deterministic graph from agent ID hash
- Animated when `online=true`, static when false
- IntersectionObserver to pause off-screen
- `useEffect` for animation loop, cleanup on unmount

---

## WebSocket

Connect to `ws://localhost:{port}/dashboard/ws` with session cookie.

Events to handle:
- `task_dispatched` → add to tasks, show as running
- `task_completed` → update task status, refresh metrics
- `task_failed` → update task status
- `consensus_complete` → refresh findings metrics
- `agent_connected` / `agent_disconnected` → update team online status

---

## Project Structure

```
packages/dashboard-v2/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── globals.css            (theme, CRT overlays)
│   ├── lib/
│   │   ├── api.ts             (fetch wrapper, auth)
│   │   ├── ws.ts              (WebSocket client)
│   │   ├── neural-avatar.ts   (canvas engine, ported)
│   │   └── utils.ts           (timeAgo, escapeHtml, formatters)
│   ├── components/
│   │   ├── ui/                (shadcn components)
│   │   ├── TopBar.tsx
│   │   ├── AuthGate.tsx
│   │   ├── FindingsMetrics.tsx
│   │   ├── TeamSection.tsx
│   │   ├── AgentRow.tsx
│   │   ├── AgentDetailModal.tsx
│   │   ├── NeuralAvatar.tsx
│   │   ├── TasksSection.tsx
│   │   ├── TaskRow.tsx
│   │   ├── RecentMemories.tsx
│   │   └── MemoryCard.tsx
│   └── hooks/
│       ├── useAuth.ts
│       ├── useDashboardData.ts
│       └── useWebSocket.ts
```

## Build Integration

The dashboard v2 builds to `dist-dashboard/` just like the old one, but via Vite instead of the custom `build.js` concatenation.

**Development:** `cd packages/dashboard-v2 && npm run dev` (Vite dev server with HMR, proxying API to relay)
**Production:** `npm run build` → outputs `dist-dashboard/index.html` + assets
**MCP integration:** The relay server serves `dist-dashboard/` as static files (unchanged)

## API Endpoints (existing, no backend changes)

| Endpoint | Returns |
|----------|---------|
| `POST /dashboard/api/auth` | Session cookie |
| `GET /dashboard/api/overview` | System stats |
| `GET /dashboard/api/agents` | Agent list with scores |
| `GET /dashboard/api/tasks` | Task history |
| `GET /dashboard/api/consensus` | Consensus runs with findings |
| `GET /dashboard/api/knowledge` | Agent memory entries |
| `WS /dashboard/ws` | Live events |

## Verification

1. `cd packages/dashboard-v2 && npm run build` — builds clean
2. Copy output to `dist-dashboard/` — relay serves it
3. Auth gate works with in-memory key
4. All 4 sections render with real data
5. WebSocket updates tasks and metrics live
6. Agent modal shows full detail on click
7. NeuralAvatars render and animate for online agents
8. Responsive at 1000px and 600px breakpoints
