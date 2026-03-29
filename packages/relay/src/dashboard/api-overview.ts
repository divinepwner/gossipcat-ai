import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface AgentConfigLike {
  id: string;
  native?: boolean;
}

interface OverviewContext {
  agentConfigs: AgentConfigLike[];
  relayConnections: number;
}

export interface OverviewResponse {
  agentsOnline: number;
  relayCount: number;
  nativeCount: number;
  consensusRuns: number;
  totalFindings: number;
  confirmedFindings: number;
  totalSignals: number;
}

export async function overviewHandler(projectRoot: string, ctx: OverviewContext): Promise<OverviewResponse> {
  const nativeCount = ctx.agentConfigs.filter(a => a.native).length;
  const relayCount = ctx.relayConnections;
  const agentsOnline = ctx.agentConfigs.length;

  let totalSignals = 0;
  let totalFindings = 0;
  let confirmedFindings = 0;
  let consensusRuns = 0;

  const perfPath = join(projectRoot, '.gossip', 'agent-performance.jsonl');
  if (existsSync(perfPath)) {
    try {
      const lines = readFileSync(perfPath, 'utf-8').trim().split('\n').filter(Boolean);
      totalSignals = lines.length;
    } catch { /* empty */ }
  }

  const historyPath = join(projectRoot, '.gossip', 'consensus-history.jsonl');
  if (existsSync(historyPath)) {
    try {
      const lines = readFileSync(historyPath, 'utf-8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          consensusRuns++;
          totalFindings += (entry.confirmed ?? 0) + (entry.disputed ?? 0)
            + (entry.unverified ?? 0) + (entry.unique ?? 0) + (entry.newFindings ?? 0);
          confirmedFindings += entry.confirmed ?? 0;
        } catch { /* skip malformed */ }
      }
    } catch { /* empty */ }
  }

  return { agentsOnline, relayCount, nativeCount, consensusRuns, totalFindings, confirmedFindings, totalSignals };
}
