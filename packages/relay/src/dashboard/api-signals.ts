import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface SignalEntry {
  type: string;
  signal: string;
  agentId: string;
  counterpartId?: string;
  taskId?: string;
  evidence?: string;
  finding?: string;
  timestamp: string;
}

export interface SignalsResponse {
  signals: SignalEntry[];
  total: number;
}

const MAX_SIGNALS = 100;

export async function signalsHandler(projectRoot: string, agentFilter: string | null): Promise<SignalsResponse> {
  const perfPath = join(projectRoot, '.gossip', 'agent-performance.jsonl');
  if (!existsSync(perfPath)) return { signals: [], total: 0 };

  const all: SignalEntry[] = [];
  try {
    const lines = readFileSync(perfPath, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'consensus') continue;
        if (agentFilter && entry.agentId !== agentFilter) continue;
        all.push(entry);
      } catch { /* skip malformed */ }
    }
  } catch { return { signals: [], total: 0 }; }

  all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { signals: all.slice(0, MAX_SIGNALS), total: all.length };
}
