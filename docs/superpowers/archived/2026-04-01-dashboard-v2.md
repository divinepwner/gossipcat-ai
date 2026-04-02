# Dashboard v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React+Vite dashboard from scratch that replaces the vanilla JS gossipcat dashboard with a dark purple themed, 4-section single-page monitoring UI.

**Architecture:** Client-side SPA built with React 19 + Vite. shadcn/ui components themed with a dark purple palette. Single page with 4 stacked sections: Findings Metrics, Team, Tasks, Recent Memories. WebSocket for live updates. Auth via existing session cookie flow. Builds to `dist-dashboard/` for the relay server to serve as static files.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind v4, shadcn/ui, Canvas API (NeuralAvatar)

**Spec:** `docs/superpowers/specs/2026-04-01-dashboard-v2-rewrite.md`

---

## File Map

```
packages/dashboard-v2/
├── index.html                    # Vite entry HTML
├── vite.config.ts                # Vite config with proxy to relay
├── tailwind.config.ts            # Tailwind with dark purple theme
├── tsconfig.json                 # TypeScript config
├── package.json                  # Dependencies
├── components.json               # shadcn/ui config
├── postcss.config.js             # PostCSS for Tailwind
├── src/
│   ├── main.tsx                  # React entry point
│   ├── App.tsx                   # Root component with auth gate
│   ├── globals.css               # Theme vars, base styles, CRT overlays
│   ├── lib/
│   │   ├── api.ts                # Fetch wrapper with cookie auth
│   │   ├── ws.ts                 # WebSocket client
│   │   ├── neural-avatar.ts      # Canvas engine (ported from crab-language)
│   │   ├── utils.ts              # timeAgo, formatDuration, agentInitials, agentColor
│   │   └── cn.ts                 # shadcn cn() utility
│   ├── hooks/
│   │   ├── useAuth.ts            # Auth state + login
│   │   ├── useDashboardData.ts   # Fetch all sections, periodic refresh
│   │   └── useWebSocket.ts       # WS connection + event dispatch
│   └── components/
│       ├── ui/                   # shadcn components (card, dialog, badge, table, etc.)
│       ├── AuthGate.tsx          # Login screen with gossipcat logo
│       ├── TopBar.tsx            # Logo + connection status
│       ├── FindingsMetrics.tsx   # Section 1: metric cards + stacked bar
│       ├── TeamSection.tsx       # Section 2: agent rows (max 5) + "see team"
│       ├── AgentRow.tsx          # Single agent row with avatar + metrics
│       ├── NeuralAvatar.tsx      # React wrapper for canvas engine
│       ├── AgentDetailModal.tsx  # Full agent detail on click
│       ├── TasksSection.tsx      # Section 3: task table
│       ├── TaskRow.tsx           # Single task row
│       ├── RecentMemories.tsx    # Section 4: last 20 memory entries
│       └── MemoryCard.tsx        # Single memory entry
```

## API Response Types (from existing backend)

These types are fixed — the backend is not changing.

```typescript
// GET /dashboard/api/overview
interface OverviewResponse {
  agentsOnline: number;
  relayCount: number;
  relayConnected: number;
  nativeCount: number;
  consensusRuns: number;
  totalFindings: number;
  confirmedFindings: number;
  totalSignals: number;
  tasksCompleted: number;
  tasksFailed: number;
  avgDurationMs: number;
  lastConsensusTimestamp: string;
  actionableFindings: number;
}

// GET /dashboard/api/agents
interface AgentResponse {
  id: string;
  provider: string;
  model: string;
  preset?: string;
  native: boolean;
  skills: string[];
  skillSlots: { name: string; enabled: boolean; source: string; boundAt: string }[];
  online: boolean;
  totalTokens: number;
  lastTask: { task: string; timestamp: string } | null;
  scores: {
    accuracy: number; uniqueness: number; reliability: number;
    dispatchWeight: number; signals: number;
    agreements: number; disagreements: number; hallucinations: number;
  };
}

// GET /dashboard/api/tasks?limit=50&offset=0
interface TasksResponse {
  items: {
    taskId: string; agentId: string; task: string;
    status: 'completed' | 'failed' | 'cancelled' | 'running';
    duration?: number; timestamp: string;
    inputTokens?: number; outputTokens?: number;
  }[];
  total: number; offset: number; limit: number;
}

// GET /dashboard/api/consensus
interface ConsensusResponse {
  runs: {
    taskId: string; timestamp: string; agents: string[];
    signals: { signal: string; agentId: string; counterpartId?: string; evidence?: string }[];
    counts: { agreement: number; disagreement: number; unverified: number; unique: number; hallucination: number; new: number };
  }[];
  totalSignals: number;
}

// GET /dashboard/api/knowledge/:agentId
interface MemoryResponse {
  index: string;
  knowledge: { filename: string; frontmatter: Record<string, string>; content: string }[];
  tasks: Record<string, unknown>[];
  fileCount: number;
  cognitiveCount: number;
}
```

---

### Task 1: Scaffold Vite + React + TypeScript project

**Files:**
- Create: `packages/dashboard-v2/package.json`
- Create: `packages/dashboard-v2/vite.config.ts`
- Create: `packages/dashboard-v2/tsconfig.json`
- Create: `packages/dashboard-v2/index.html`
- Create: `packages/dashboard-v2/postcss.config.js`
- Create: `packages/dashboard-v2/src/main.tsx`
- Create: `packages/dashboard-v2/src/App.tsx`
- Create: `packages/dashboard-v2/src/vite-env.d.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "gossipcat-dashboard-v2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build --outDir ../../dist-dashboard --emptyOutDir",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "class-variance-authority": "^0.7.1",
    "lucide-react": "^0.469.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/dashboard/',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: {
      '/dashboard/api': 'http://localhost:24420',
      '/dashboard/ws': { target: 'ws://localhost:24420', ws: true },
    },
  },
});
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>gossipcat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 5: Create postcss.config.js**

```javascript
export default {};
```

- [ ] **Step 6: Create src/vite-env.d.ts**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 7: Create src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Create src/App.tsx (placeholder)**

```tsx
export function App() {
  return <div className="min-h-screen bg-background text-foreground p-8">
    <h1 className="text-2xl font-bold">gossipcat dashboard</h1>
    <p className="text-muted-foreground mt-2">Loading...</p>
  </div>;
}
```

- [ ] **Step 9: Install dependencies and verify**

```bash
cd packages/dashboard-v2 && npm install
npx vite build --outDir ../../dist-dashboard --emptyOutDir
```

Expected: builds clean, produces `dist-dashboard/index.html`.

- [ ] **Step 10: Commit**

```bash
git add packages/dashboard-v2
git commit -m "feat(dashboard-v2): scaffold Vite + React + TypeScript project"
```

---

### Task 2: Theme — Dark Purple + Tailwind + shadcn/ui setup

**Files:**
- Create: `packages/dashboard-v2/src/globals.css`
- Create: `packages/dashboard-v2/src/lib/cn.ts`
- Create: `packages/dashboard-v2/components.json`

- [ ] **Step 1: Create globals.css with dark purple theme**

```css
@import "tailwindcss";

@theme {
  --color-background: #09090b;
  --color-foreground: #fafafa;
  --color-card: #0f0f14;
  --color-card-foreground: #fafafa;
  --color-muted: #16161e;
  --color-muted-foreground: #a1a1aa;
  --color-border: rgba(139, 92, 246, 0.08);
  --color-input: rgba(139, 92, 246, 0.08);
  --color-ring: #8b5cf6;
  --color-primary: #8b5cf6;
  --color-primary-foreground: #fafafa;
  --color-secondary: #16161e;
  --color-secondary-foreground: #fafafa;
  --color-accent: #1a1a2e;
  --color-accent-foreground: #fafafa;
  --color-destructive: #f87171;
  --color-destructive-foreground: #fafafa;

  --color-confirmed: #34d399;
  --color-disputed: #f87171;
  --color-unverified: #fbbf24;
  --color-unique: #c084fc;

  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
}

body {
  background-color: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/* CRT scanlines */
html::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background: repeating-linear-gradient(
    0deg,
    transparent 0px, transparent 2px,
    rgba(0, 0, 0, 0.03) 2px, rgba(0, 0, 0, 0.03) 4px
  );
}

/* Vignette */
html::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9998;
  background: radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0, 0, 0, 0.25) 100%);
}

/* Scrollbar */
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(139, 92, 246, 0.15); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(139, 92, 246, 0.25); }
```

- [ ] **Step 2: Create cn utility**

Create `packages/dashboard-v2/src/lib/cn.ts`:

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Create components.json for shadcn**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/globals.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/cn",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 4: Install shadcn UI components**

```bash
cd packages/dashboard-v2
npx shadcn@latest add card badge dialog table separator avatar -y
```

- [ ] **Step 5: Verify build**

```bash
cd packages/dashboard-v2 && npx vite build --outDir ../../dist-dashboard --emptyOutDir
```

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard-v2
git commit -m "feat(dashboard-v2): dark purple theme + shadcn/ui setup"
```

---

### Task 3: Utilities — API client, WebSocket, helpers

**Files:**
- Create: `packages/dashboard-v2/src/lib/api.ts`
- Create: `packages/dashboard-v2/src/lib/ws.ts`
- Create: `packages/dashboard-v2/src/lib/utils.ts`
- Create: `packages/dashboard-v2/src/lib/types.ts`

- [ ] **Step 1: Create types.ts**

```typescript
export interface OverviewData {
  agentsOnline: number;
  relayCount: number;
  relayConnected: number;
  nativeCount: number;
  consensusRuns: number;
  totalFindings: number;
  confirmedFindings: number;
  totalSignals: number;
  tasksCompleted: number;
  tasksFailed: number;
  avgDurationMs: number;
  lastConsensusTimestamp: string;
  actionableFindings: number;
}

export interface AgentData {
  id: string;
  provider: string;
  model: string;
  preset?: string;
  native: boolean;
  skills: string[];
  skillSlots: { name: string; enabled: boolean; source: string; boundAt: string }[];
  online: boolean;
  totalTokens: number;
  lastTask: { task: string; timestamp: string } | null;
  scores: {
    accuracy: number; uniqueness: number; reliability: number;
    dispatchWeight: number; signals: number;
    agreements: number; disagreements: number; hallucinations: number;
  };
}

export interface TaskItem {
  taskId: string;
  agentId: string;
  task: string;
  status: 'completed' | 'failed' | 'cancelled' | 'running';
  duration?: number;
  timestamp: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface TasksData {
  items: TaskItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface ConsensusRun {
  taskId: string;
  timestamp: string;
  agents: string[];
  signals: { signal: string; agentId: string; counterpartId?: string; evidence?: string }[];
  counts: { agreement: number; disagreement: number; unverified: number; unique: number; hallucination: number; new: number };
}

export interface ConsensusData {
  runs: ConsensusRun[];
  totalSignals: number;
}

export interface MemoryFile {
  filename: string;
  frontmatter: Record<string, string>;
  content: string;
}

export interface MemoryData {
  index: string;
  knowledge: MemoryFile[];
  tasks: Record<string, unknown>[];
  fileCount: number;
  cognitiveCount: number;
}

export type DashboardEvent =
  | { type: 'task_dispatched'; taskId: string; agentId: string }
  | { type: 'task_completed'; taskId: string; agentId: string }
  | { type: 'task_failed'; taskId: string; agentId: string }
  | { type: 'consensus_complete'; taskId: string }
  | { type: 'agent_connected'; agentId: string }
  | { type: 'agent_disconnected'; agentId: string };
```

- [ ] **Step 2: Create api.ts**

```typescript
const BASE = '/dashboard/api';

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    credentials: 'include',
    ...options,
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function login(key: string): Promise<boolean> {
  const res = await fetch(`${BASE}/auth`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  return res.ok;
}

export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/overview`, { credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Create ws.ts**

```typescript
import type { DashboardEvent } from './types';

type Listener = (event: DashboardEvent) => void;

let ws: WebSocket | null = null;
const listeners = new Set<Listener>();

export function connectWs(): void {
  if (ws?.readyState === WebSocket.OPEN) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/dashboard/ws`);

  ws.onmessage = (e) => {
    try {
      const event: DashboardEvent = JSON.parse(e.data);
      listeners.forEach((fn) => fn(event));
    } catch { /* ignore malformed */ }
  };

  ws.onclose = () => {
    setTimeout(connectWs, 3000);
  };
}

export function onEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getWsState(): number {
  return ws?.readyState ?? WebSocket.CLOSED;
}
```

- [ ] **Step 4: Create utils.ts**

```typescript
export function timeAgo(ts: string | number): string {
  const now = Date.now();
  const then = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

export function formatDuration(ms?: number): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

export function agentInitials(id: string): string {
  const parts = id.split('-');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return id.slice(0, 2).toUpperCase();
}

const AGENT_COLORS = [
  '#8b5cf6', '#06b6d4', '#f97316', '#34d399',
  '#f43f5e', '#fbbf24', '#60a5fa', '#e879f9',
];

export function agentColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length];
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard-v2/src/lib
git commit -m "feat(dashboard-v2): API client, WebSocket, types, utilities"
```

---

### Task 4: Auth Gate + TopBar + App shell

**Files:**
- Create: `packages/dashboard-v2/src/components/AuthGate.tsx`
- Create: `packages/dashboard-v2/src/components/TopBar.tsx`
- Create: `packages/dashboard-v2/src/hooks/useAuth.ts`
- Create: `packages/dashboard-v2/src/hooks/useWebSocket.ts`
- Modify: `packages/dashboard-v2/src/App.tsx`

- [ ] **Step 1: Create useAuth hook**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { checkAuth, login as apiLogin } from '@/lib/api';

export function useAuth() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    checkAuth().then(setAuthed);
  }, []);

  const login = useCallback(async (key: string) => {
    setError(false);
    const ok = await apiLogin(key);
    if (ok) {
      setAuthed(true);
    } else {
      setError(true);
    }
  }, []);

  return { authed, login, error };
}
```

- [ ] **Step 2: Create useWebSocket hook**

```typescript
import { useEffect } from 'react';
import { connectWs, onEvent } from '@/lib/ws';
import type { DashboardEvent } from '@/lib/types';

export function useWebSocket(handler: (event: DashboardEvent) => void) {
  useEffect(() => {
    connectWs();
    return onEvent(handler);
  }, [handler]);
}
```

- [ ] **Step 3: Create AuthGate**

```tsx
import { useState, type FormEvent } from 'react';

interface AuthGateProps {
  onLogin: (key: string) => void;
  error: boolean;
}

export function AuthGate({ onLogin, error }: AuthGateProps) {
  const [key, setKey] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (key.trim()) onLogin(key.trim());
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-2xl">
        <img
          src="/dashboard/assets/gossipcat.png"
          alt="gossipcat"
          className="mx-auto mb-2 h-48 w-48 object-contain drop-shadow-[0_0_24px_rgba(139,92,246,0.3)]"
        />
        <p className="mb-6 text-sm text-muted-foreground">
          Authenticate to access the dashboard
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Dashboard key"
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-4 py-3 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="submit"
            className="mt-4 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Unlock
          </button>
        </form>
        {error && (
          <p className="mt-3 text-sm text-destructive">
            Invalid key. Check your terminal for the correct key.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create TopBar**

```tsx
import { getWsState } from '@/lib/ws';
import { useEffect, useState } from 'react';

export function TopBar() {
  const [online, setOnline] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setOnline(getWsState() === WebSocket.OPEN);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <nav className="flex items-center justify-between border-b border-border px-6 py-3">
      <div className="flex items-center gap-3">
        <img src="/dashboard/assets/gossipcat.png" alt="" className="h-8 w-8" />
        <span className="font-semibold text-primary">gossipcat</span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${online ? 'bg-confirmed shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-destructive'}`} />
        {online ? 'Connected' : 'Disconnected'}
      </div>
    </nav>
  );
}
```

- [ ] **Step 5: Update App.tsx**

```tsx
import { useCallback } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { TopBar } from '@/components/TopBar';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { DashboardEvent } from '@/lib/types';

export function App() {
  const { authed, login, error } = useAuth();

  const handleWsEvent = useCallback((_event: DashboardEvent) => {
    // Will be connected to section refresh in later tasks
  }, []);

  useWebSocket(handleWsEvent);

  if (authed === null) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  }

  if (!authed) {
    return <AuthGate onLogin={login} error={error} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <p className="text-muted-foreground">Dashboard sections will be added here.</p>
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Build and verify**

```bash
cd packages/dashboard-v2 && npx vite build --outDir ../../dist-dashboard --emptyOutDir
```

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard-v2
git commit -m "feat(dashboard-v2): auth gate, top bar, app shell"
```

---

### Task 5: Findings Metrics section

**Files:**
- Create: `packages/dashboard-v2/src/components/FindingsMetrics.tsx`
- Create: `packages/dashboard-v2/src/hooks/useDashboardData.ts`
- Modify: `packages/dashboard-v2/src/App.tsx`

- [ ] **Step 1: Create useDashboardData hook**

```typescript
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { OverviewData, AgentData, TasksData, ConsensusData } from '@/lib/types';

export interface DashboardState {
  overview: OverviewData | null;
  agents: AgentData[] | null;
  tasks: TasksData | null;
  consensus: ConsensusData | null;
  loading: boolean;
  error: string | null;
}

export function useDashboardData() {
  const [state, setState] = useState<DashboardState>({
    overview: null, agents: null, tasks: null, consensus: null,
    loading: true, error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const [overview, agents, tasks, consensus] = await Promise.all([
        api<OverviewData>('overview'),
        api<AgentData[]>('agents'),
        api<TasksData>('tasks?limit=50'),
        api<ConsensusData>('consensus'),
      ]);
      setState({ overview, agents, tasks, consensus, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, refresh };
}
```

- [ ] **Step 2: Create FindingsMetrics**

```tsx
import type { OverviewData, ConsensusData } from '@/lib/types';

interface FindingsMetricsProps {
  overview: OverviewData;
  consensus: ConsensusData;
}

export function FindingsMetrics({ overview, consensus }: FindingsMetricsProps) {
  const confirmed = overview.confirmedFindings;
  const total = overview.totalFindings;
  const actionable = overview.actionableFindings;
  const unverified = total - confirmed - actionable;

  // Aggregate unique from consensus runs
  const unique = consensus.runs.reduce((sum, r) => sum + (r.counts.unique || 0), 0);
  const disputed = actionable;

  const metrics = [
    { label: 'Confirmed', value: confirmed, color: 'bg-confirmed', textColor: 'text-confirmed' },
    { label: 'Disputed', value: disputed, color: 'bg-disputed', textColor: 'text-disputed' },
    { label: 'Unverified', value: Math.max(0, unverified), color: 'bg-unverified', textColor: 'text-unverified' },
    { label: 'Unique', value: unique, color: 'bg-unique', textColor: 'text-unique' },
  ];

  const barTotal = metrics.reduce((s, m) => s + m.value, 0) || 1;

  return (
    <section>
      <h2 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-foreground">
        Findings <span className="text-primary">{total}</span>
      </h2>

      <div className="grid grid-cols-4 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-md border border-border bg-card p-4">
            <div className={`font-mono text-2xl font-bold ${m.textColor}`}>{m.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex h-2 overflow-hidden rounded-sm">
        {metrics.map((m) => (
          m.value > 0 && (
            <div
              key={m.label}
              className={`${m.color} transition-all`}
              style={{ width: `${(m.value / barTotal) * 100}%` }}
            />
          )
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire into App.tsx**

Update `App.tsx` to use the data hook and render FindingsMetrics:

```tsx
import { useCallback } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { TopBar } from '@/components/TopBar';
import { FindingsMetrics } from '@/components/FindingsMetrics';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { DashboardEvent } from '@/lib/types';

export function App() {
  const { authed, login, error } = useAuth();
  const { overview, agents, tasks, consensus, loading, refresh } = useDashboardData();

  const handleWsEvent = useCallback((_event: DashboardEvent) => {
    refresh();
  }, [refresh]);

  useWebSocket(handleWsEvent);

  if (authed === null) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  }

  if (!authed) {
    return <AuthGate onLogin={login} error={error} />;
  }

  if (loading || !overview || !consensus) {
    return (
      <div className="min-h-screen bg-background">
        <TopBar />
        <div className="flex items-center justify-center py-20 text-muted-foreground">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-6">
        <FindingsMetrics overview={overview} consensus={consensus} />
        {/* Team, Tasks, Memories sections will be added in subsequent tasks */}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/dashboard-v2 && npx vite build --outDir ../../dist-dashboard --emptyOutDir
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard-v2
git commit -m "feat(dashboard-v2): findings metrics section with stacked bar"
```

---

### Task 6: Team Section + AgentRow + AgentDetailModal

**Files:**
- Create: `packages/dashboard-v2/src/components/TeamSection.tsx`
- Create: `packages/dashboard-v2/src/components/AgentRow.tsx`
- Create: `packages/dashboard-v2/src/components/AgentDetailModal.tsx`
- Modify: `packages/dashboard-v2/src/App.tsx` (add TeamSection)

- [ ] **Step 1: Create AgentRow**

```tsx
import type { AgentData } from '@/lib/types';
import { agentInitials, agentColor, timeAgo } from '@/lib/utils';

interface AgentRowProps {
  agent: AgentData;
  onClick: () => void;
}

export function AgentRow({ agent, onClick }: AgentRowProps) {
  const color = agentColor(agent.id);
  const s = agent.scores;
  const lastTaskId = agent.lastTask
    ? agent.lastTask.task.match(/task[_-]?([a-f0-9]{4,8})/i)?.[0] ?? '—'
    : '—';
  const lastTime = agent.lastTask?.timestamp ? timeAgo(agent.lastTask.timestamp) : '—';

  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-md border border-border bg-card p-3 text-left transition hover:border-primary/30 hover:bg-accent"
    >
      {/* Avatar placeholder — NeuralAvatar added in Task 7 */}
      <div
        className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-2"
        style={{ borderColor: color, color }}
      >
        <span className="font-mono text-sm font-bold">{agentInitials(agent.id)}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">{agent.id}</span>
          <span className={`inline-block h-2 w-2 rounded-full ${agent.online ? 'bg-confirmed shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-muted-foreground/30'}`} />
          <span className="font-mono text-xs text-muted-foreground">{agent.online ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{agent.provider}/{agent.model}</div>
        <div className="mt-1 flex items-center gap-3 font-mono text-xs">
          <span className="text-confirmed">Acc: {Math.round(s.accuracy * 100)}%</span>
          <span className="text-primary">Rel: {Math.round(s.reliability * 100)}%</span>
          <span className="text-unique">Uniq: {Math.round(s.uniqueness * 100)}%</span>
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">
          Last: <span className="text-foreground/70">{lastTaskId}</span> · {lastTime}
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Create AgentDetailModal**

```tsx
import type { AgentData } from '@/lib/types';
import { agentInitials, agentColor } from '@/lib/utils';

interface AgentDetailModalProps {
  agent: AgentData;
  open: boolean;
  onClose: () => void;
}

export function AgentDetailModal({ agent, open, onClose }: AgentDetailModalProps) {
  if (!open) return null;

  const s = agent.scores;
  const color = agentColor(agent.id);

  const stats = [
    { label: 'Accuracy', value: `${Math.round(s.accuracy * 100)}%` },
    { label: 'Reliability', value: `${Math.round(s.reliability * 100)}%` },
    { label: 'Uniqueness', value: `${Math.round(s.uniqueness * 100)}%` },
    { label: 'Dispatch Weight', value: s.dispatchWeight.toFixed(2) },
    { label: 'Signals', value: String(s.signals) },
    { label: 'Agreements', value: String(s.agreements) },
    { label: 'Disagreements', value: String(s.disagreements) },
    { label: 'Hallucinations', value: String(s.hallucinations) },
    { label: 'Total Tokens', value: agent.totalTokens.toLocaleString() },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 border-b border-border pb-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full border-2"
            style={{ borderColor: color, color }}
          >
            <span className="font-mono text-lg font-bold">{agentInitials(agent.id)}</span>
          </div>
          <div>
            <h3 className="font-mono text-lg font-bold text-foreground">{agent.id}</h3>
            <p className="text-sm text-muted-foreground">{agent.provider}/{agent.model}</p>
            <p className="text-xs text-muted-foreground">{agent.preset ?? 'no preset'} · {agent.native ? 'native' : 'relay'}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-md border border-border bg-background p-3">
              <div className="font-mono text-lg font-bold text-foreground">{stat.value}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        {agent.skills.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-2 font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">Skills</h4>
            <div className="flex flex-wrap gap-1.5">
              {agent.skills.map((skill) => (
                <span key={skill} className="rounded-sm border border-border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create TeamSection**

```tsx
import { useState } from 'react';
import type { AgentData } from '@/lib/types';
import { AgentRow } from './AgentRow';
import { AgentDetailModal } from './AgentDetailModal';

interface TeamSectionProps {
  agents: AgentData[];
}

export function TeamSection({ agents }: TeamSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<AgentData | null>(null);

  const sorted = [...agents].sort((a, b) =>
    (b.scores?.dispatchWeight || 0) - (a.scores?.dispatchWeight || 0)
  );
  const visible = expanded ? sorted : sorted.slice(0, 5);
  const remaining = sorted.length - 5;

  return (
    <section>
      <h2 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-foreground">
        Team <span className="text-primary">{agents.length} agents</span>
      </h2>

      <div className="space-y-2">
        {visible.map((agent) => (
          <AgentRow key={agent.id} agent={agent} onClick={() => setSelected(agent)} />
        ))}
      </div>

      {remaining > 0 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-3 w-full rounded-md border border-dashed border-border py-2 font-mono text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
        >
          see team ({remaining} more)
        </button>
      )}

      {selected && (
        <AgentDetailModal agent={selected} open={!!selected} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Add TeamSection to App.tsx**

In `App.tsx`, import and add after FindingsMetrics:

```tsx
import { TeamSection } from '@/components/TeamSection';
```

In the main section, after `<FindingsMetrics ... />`:

```tsx
{agents && <TeamSection agents={agents} />}
```

- [ ] **Step 5: Build and verify**

```bash
cd packages/dashboard-v2 && npx vite build --outDir ../../dist-dashboard --emptyOutDir
```

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard-v2
git commit -m "feat(dashboard-v2): team section with agent rows and detail modal"
```

---

### Task 7: NeuralAvatar React component

**Files:**
- Create: `packages/dashboard-v2/src/lib/neural-avatar.ts`
- Create: `packages/dashboard-v2/src/components/NeuralAvatar.tsx`
- Modify: `packages/dashboard-v2/src/components/AgentRow.tsx` (replace placeholder)

This task ports the canvas engine from `/Users/goku/claude/crab-language/dashboard/frontend/lib/neural-avatar.ts`. The engine is 90% self-contained — `SeededRNG`, `colorFromMind`, topology generators, and `NeuralAvatarEngine` class have zero external deps. Only `hashString` needs to be inlined.

- [ ] **Step 1: Port neural-avatar.ts engine**

Copy `/Users/goku/claude/crab-language/dashboard/frontend/lib/neural-avatar.ts` to `packages/dashboard-v2/src/lib/neural-avatar.ts`.

Then make these modifications:
1. Add `hashString` function at the top (inline from `mind-avatar.ts`):
```typescript
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}
```
2. Remove the import of `hashString` from `../lib/mind-avatar`
3. Keep all exports: `SeededRNG`, `colorFromMind`, `topologyFromWorldview`, `getEvoParams`, `applyTraitModifiers`, `computeVoidSectors`, `renderTierFromSize`, `TOPOLOGY_GENERATORS`, `NeuralAvatarEngine`, `AvatarParams`

- [ ] **Step 2: Create NeuralAvatar React component**

```tsx
import { useEffect, useRef } from 'react';
import {
  NeuralAvatarEngine, type AvatarParams,
  colorFromMind, hashString, getEvoParams,
  TOPOLOGY_GENERATORS, renderTierFromSize,
} from '@/lib/neural-avatar';

interface NeuralAvatarProps {
  agentId: string;
  size?: number;
  online?: boolean;
}

export function NeuralAvatar({ agentId, size = 52, online = false }: NeuralAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<NeuralAvatarEngine | null>(null);
  const rafRef = useRef<number>(0);
  const visibleRef = useRef(true);

  const color = colorFromMind(agentId);
  const seed = hashString(agentId);
  const evoParams = getEvoParams(0);
  const renderTier = renderTierFromSize(size);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = size * 2;
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(2, 2);

    const params: AvatarParams = {
      seed,
      primary: color.primary,
      secondary: color.secondary,
      nodeCount: evoParams.nodeCount,
      evolution: 0,
      topoGen: TOPOLOGY_GENERATORS.hub,
      voidSectors: [],
      renderTier,
    };

    const engine = new NeuralAvatarEngine(canvas, params);
    engineRef.current = engine;
    engine.rebuild();
    engine.draw();

    if (!online) return;

    const loop = () => {
      if (visibleRef.current) {
        engine.update(0.016);
        engine.draw();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      engineRef.current = null;
    };
  }, [agentId, size, online]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !online) return;

    const observer = new IntersectionObserver(
      ([entry]) => { visibleRef.current = entry.isIntersecting; },
      { threshold: 0.1 },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [online]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        opacity: online ? 1 : 0.4,
        transition: 'opacity 0.3s',
      }}
    />
  );
}
```

- [ ] **Step 3: Update AgentRow to use NeuralAvatar**

In `AgentRow.tsx`, replace the placeholder avatar div with:

```tsx
import { NeuralAvatar } from './NeuralAvatar';
```

Replace the `<div className="flex h-[52px] w-[52px]...">` block with:

```tsx
<NeuralAvatar agentId={agent.id} size={52} online={agent.online} />
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/dashboard-v2 && npx vite build --outDir ../../dist-dashboard --emptyOutDir
```

If the ported neural-avatar.ts has TypeScript errors, fix them (most likely: remove React-specific imports, adjust type exports).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard-v2
git commit -m "feat(dashboard-v2): NeuralAvatar canvas component ported from crab-language"
```

---

### Task 8: Tasks Section

**Files:**
- Create: `packages/dashboard-v2/src/components/TasksSection.tsx`
- Create: `packages/dashboard-v2/src/components/TaskRow.tsx`
- Modify: `packages/dashboard-v2/src/App.tsx`

- [ ] **Step 1: Create TaskRow**

```tsx
import type { TaskItem } from '@/lib/types';
import { timeAgo, formatDuration, agentColor } from '@/lib/utils';

interface TaskRowProps {
  task: TaskItem;
}

const STATUS_STYLES = {
  completed: { dot: 'bg-confirmed', label: '●' },
  failed: { dot: 'bg-destructive', label: '✕' },
  running: { dot: 'bg-unverified animate-pulse', label: '◌' },
  cancelled: { dot: 'bg-muted-foreground/40', label: '—' },
} as const;

export function TaskRow({ task }: TaskRowProps) {
  const status = STATUS_STYLES[task.status] ?? STATUS_STYLES.cancelled;
  const color = agentColor(task.agentId);

  return (
    <tr className="border-b border-border transition hover:bg-accent/50">
      <td className="py-2.5 pl-4 pr-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${status.dot}`} />
      </td>
      <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
        {task.taskId.slice(0, 8)}
      </td>
      <td className="py-2.5 pr-3 font-mono text-xs font-medium" style={{ color }}>
        {task.agentId}
      </td>
      <td className="max-w-md truncate py-2.5 pr-3 text-sm text-foreground/80">
        {task.task.replace(/\n.*/s, '').slice(0, 80)}
      </td>
      <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
        {task.status === 'running' ? 'running' : formatDuration(task.duration)}
      </td>
      <td className="py-2.5 pr-4 text-right font-mono text-xs text-muted-foreground">
        {timeAgo(task.timestamp)}
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: Create TasksSection**

```tsx
import type { TasksData } from '@/lib/types';
import { TaskRow } from './TaskRow';

interface TasksSectionProps {
  tasks: TasksData;
}

export function TasksSection({ tasks }: TasksSectionProps) {
  return (
    <section>
      <h2 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-foreground">
        Tasks <span className="text-primary">{tasks.total}</span>
      </h2>

      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border bg-card">
              <th className="py-2 pl-4 pr-2 text-xs font-medium text-muted-foreground" style={{ width: 32 }}></th>
              <th className="py-2 pr-3 font-mono text-xs font-medium text-muted-foreground">ID</th>
              <th className="py-2 pr-3 font-mono text-xs font-medium text-muted-foreground">Agent</th>
              <th className="py-2 pr-3 text-xs font-medium text-muted-foreground">Description</th>
              <th className="py-2 pr-3 font-mono text-xs font-medium text-muted-foreground">Duration</th>
              <th className="py-2 pr-4 text-right font-mono text-xs font-medium text-muted-foreground">When</th>
            </tr>
          </thead>
          <tbody>
            {tasks.items.map((task) => (
              <TaskRow key={task.taskId} task={task} />
            ))}
          </tbody>
        </table>
        {tasks.items.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">No tasks yet.</div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add to App.tsx**

Import and add after TeamSection:

```tsx
import { TasksSection } from '@/components/TasksSection';
```

```tsx
{tasks && <TasksSection tasks={tasks} />}
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/dashboard-v2 && npx vite build --outDir ../../dist-dashboard --emptyOutDir
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard-v2
git commit -m "feat(dashboard-v2): tasks section with status table"
```

---

### Task 9: Recent Memories section

**Files:**
- Create: `packages/dashboard-v2/src/components/RecentMemories.tsx`
- Create: `packages/dashboard-v2/src/components/MemoryCard.tsx`
- Modify: `packages/dashboard-v2/src/hooks/useDashboardData.ts`
- Modify: `packages/dashboard-v2/src/App.tsx`

- [ ] **Step 1: Add memory fetching to useDashboardData**

In `useDashboardData.ts`, add memory fetching. Memories are per-agent, so we fetch the first few agents' memories and merge:

Add to the types import: `MemoryData`

Add a new state field: `memories: MemoryFile[] | null`

Update the `refresh` function to also fetch memories:

```typescript
// After fetching agents, fetch memories for top agents
const agentIds = agents.slice(0, 5).map((a: AgentData) => a.id).concat(['_project']);
const memoryResults = await Promise.allSettled(
  agentIds.map((id: string) => api<MemoryData>(`knowledge/${id}`))
);
const allMemories: MemoryFile[] = [];
for (const result of memoryResults) {
  if (result.status === 'fulfilled' && result.value.knowledge) {
    for (const k of result.value.knowledge) {
      allMemories.push(k);
    }
  }
}
// Sort by frontmatter date or filename, take last 20
allMemories.sort((a, b) => (b.filename > a.filename ? 1 : -1));
const memories = allMemories.slice(0, 20);
```

Add `memories` to the state.

- [ ] **Step 2: Create MemoryCard**

```tsx
import { useState } from 'react';
import type { MemoryFile } from '@/lib/types';

interface MemoryCardProps {
  memory: MemoryFile;
}

export function MemoryCard({ memory }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const type = memory.frontmatter?.type ?? 'unknown';
  const name = memory.frontmatter?.name ?? memory.filename;
  const preview = memory.content.split('\n').slice(0, 3).join('\n');

  const typeColors: Record<string, string> = {
    cognitive: 'text-primary border-primary/30 bg-primary/5',
    skill: 'text-confirmed border-confirmed/30 bg-confirmed/5',
    session: 'text-unverified border-unverified/30 bg-unverified/5',
    unknown: 'text-muted-foreground border-border bg-card',
  };

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full rounded-md border border-border bg-card p-3 text-left transition hover:border-primary/20"
    >
      <div className="flex items-center gap-2">
        <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${typeColors[type] ?? typeColors.unknown}`}>
          {type}
        </span>
        <span className="font-mono text-xs font-semibold text-foreground">{name}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {expanded ? memory.content : preview}
        {!expanded && memory.content.split('\n').length > 3 && '...'}
      </p>
    </button>
  );
}
```

- [ ] **Step 3: Create RecentMemories**

```tsx
import type { MemoryFile } from '@/lib/types';
import { MemoryCard } from './MemoryCard';

interface RecentMemoriesProps {
  memories: MemoryFile[];
}

export function RecentMemories({ memories }: RecentMemoriesProps) {
  return (
    <section>
      <h2 className="mb-4 font-mono text-xs font-bold uppercase tracking-widest text-foreground">
        Recent Memories <span className="text-primary">{memories.length}</span>
      </h2>

      <div className="grid grid-cols-2 gap-2">
        {memories.map((m, i) => (
          <MemoryCard key={m.filename + i} memory={m} />
        ))}
      </div>

      {memories.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">No memories yet.</div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Add to App.tsx**

```tsx
import { RecentMemories } from '@/components/RecentMemories';
```

After TasksSection:

```tsx
{memories && <RecentMemories memories={memories} />}
```

- [ ] **Step 5: Build and verify**

```bash
cd packages/dashboard-v2 && npx vite build --outDir ../../dist-dashboard --emptyOutDir
```

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard-v2
git commit -m "feat(dashboard-v2): recent memories section"
```

---

### Task 10: Build integration + final verification

**Files:**
- Modify: `packages/dashboard-v2/package.json` (verify build script)
- Modify: root `package.json` (add build:dashboard-v2 script)

- [ ] **Step 1: Add build script to root package.json**

Add to root `package.json` scripts:

```json
"build:dashboard-v2": "cd packages/dashboard-v2 && npm run build"
```

Also update `build:dashboard` to point to the new dashboard or keep both.

- [ ] **Step 2: Full build**

```bash
npm run build:dashboard-v2 && npm run build:mcp
```

Expected: both build clean. `dist-dashboard/` now contains the Vite output.

- [ ] **Step 3: Copy gossipcat.png to dist**

The auth gate and topbar reference `/dashboard/assets/gossipcat.png`. Vite needs this in the public directory or copied to dist:

```bash
mkdir -p packages/dashboard-v2/public/dashboard/assets
cp packages/dashboard/src/gossipcat.png packages/dashboard-v2/public/dashboard/assets/gossipcat.png
```

Rebuild: `npm run build:dashboard-v2`

- [ ] **Step 4: Reconnect and test**

Reconnect MCP, get dashboard key, open in browser:

1. Auth gate shows with gossipcat logo, purple button
2. Login works with key from `gossip_status`
3. Findings metrics: 4 cards + stacked bar with correct colors
4. Team: up to 5 agents with avatars, metrics, online status
5. Click agent → modal with full detail
6. Tasks table: status dots, agent colors, durations, timestamps
7. Recent memories: expandable cards with type badges
8. WebSocket: tasks update live when agents are dispatched

- [ ] **Step 5: Run existing tests**

```bash
npx jest tests/relay/dashboard-auth.test.ts tests/relay/dashboard-routes.test.ts --no-coverage
```

Expected: all 31 pass (backend unchanged).

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(dashboard-v2): complete React dashboard rewrite with dark purple theme"
```
