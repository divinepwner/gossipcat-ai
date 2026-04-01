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
