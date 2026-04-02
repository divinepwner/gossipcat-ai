/**
 * Handler for gossip_relay_cross_review — accepts native agent cross-review
 * results and triggers consensus synthesis when all agents have responded.
 */
import { ctx } from '../mcp-context';

export async function handleRelayCrossReview(
  consensus_id: string,
  agent_id: string,
  result: string,
) {
  const round = ctx.pendingConsensusRounds.get(consensus_id);
  if (!round) {
    return {
      content: [{
        type: 'text' as const,
        text: `Error: No pending consensus round with ID "${consensus_id}". It may have expired or already completed.`,
      }],
    };
  }

  if (!round.pendingNativeAgents.has(agent_id)) {
    return {
      content: [{
        type: 'text' as const,
        text: `Error: Agent "${agent_id}" is not a pending native reviewer for consensus ${consensus_id}. Pending: ${[...round.pendingNativeAgents].join(', ')}`,
      }],
    };
  }

  // Parse the cross-review response
  try {
    const { ConsensusEngine } = await import('@gossip/orchestrator');
    const engine = new ConsensusEngine({
      llm: ctx.mainAgent.getLlm(),
      registryGet: (id: string) => ctx.mainAgent.getAgentConfig(id),
      projectRoot: process.cwd(),
    });
    const entries = engine.parseCrossReviewResponse(agent_id, result, 50);
    round.nativeCrossReviewEntries.push(...entries);
  } catch (err) {
    process.stderr.write(`[gossipcat] Failed to parse cross-review from ${agent_id}: ${(err as Error).message}\n`);
  }

  // Mark agent as done
  round.pendingNativeAgents.delete(agent_id);
  process.stderr.write(`[gossipcat] Cross-review received from ${agent_id}. Remaining: ${round.pendingNativeAgents.size}\n`);

  // Check if all native agents have responded
  if (round.pendingNativeAgents.size > 0) {
    return {
      content: [{
        type: 'text' as const,
        text: `Cross-review from ${agent_id} received. Waiting for ${round.pendingNativeAgents.size} more agent(s): ${[...round.pendingNativeAgents].join(', ')}`,
      }],
    };
  }

  // All agents responded — synthesize
  process.stderr.write(`[gossipcat] All native cross-reviews received. Synthesizing consensus for ${consensus_id}...\n`);

  try {
    const { ConsensusEngine, PerformanceWriter } = await import('@gossip/orchestrator');
    const engine = new ConsensusEngine({
      llm: ctx.mainAgent.getLlm(),
      registryGet: (id: string) => ctx.mainAgent.getAgentConfig(id),
      projectRoot: process.cwd(),
    });

    const allCrossReviewEntries = [
      ...round.relayCrossReviewEntries,
      ...round.nativeCrossReviewEntries,
    ];

    const report = await engine.synthesizeWithCrossReview(
      round.allResults,
      allCrossReviewEntries,
      round.consensusId,
    );

    // Clean up pending round
    ctx.pendingConsensusRounds.delete(consensus_id);

    // Persist report for dashboard
    try {
      const { writeFileSync, mkdirSync } = require('fs');
      const { join } = require('path');
      const reportsDir = join(process.cwd(), '.gossip', 'consensus-reports');
      mkdirSync(reportsDir, { recursive: true });
      const reportPath = join(reportsDir, `${consensus_id}.json`);
      writeFileSync(reportPath, JSON.stringify({
        id: consensus_id,
        timestamp: new Date().toISOString(),
        agentCount: report.agentCount,
        rounds: report.rounds,
        confirmed: report.confirmed || [],
        disputed: report.disputed || [],
        unverified: report.unverified || [],
        unique: report.unique || [],
        insights: report.insights || [],
        newFindings: report.newFindings || [],
      }, null, 2));
    } catch { /* best-effort */ }

    // Write performance signals
    try {
      const writer = new PerformanceWriter(process.cwd());
      if (report.signals.length > 0) {
        writer.appendSignals(report.signals);
      }
    } catch { /* best-effort */ }

    return {
      content: [{
        type: 'text' as const,
        text: report.summary || `Consensus complete: ${report.confirmed.length} confirmed, ${report.disputed.length} disputed, ${report.unverified.length} unverified, ${report.unique.length} unique.`,
      }],
    };
  } catch (err) {
    ctx.pendingConsensusRounds.delete(consensus_id);
    return {
      content: [{
        type: 'text' as const,
        text: `Error synthesizing consensus: ${(err as Error).message}`,
      }],
    };
  }
}
