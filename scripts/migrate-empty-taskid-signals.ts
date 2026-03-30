#!/usr/bin/env ts-node
/**
 * One-time migration: retract all signals with empty taskId.
 *
 * These signals cannot be individually retracted via the normal tool because
 * the retraction key uses `agentId + ':' + (taskId || timestamp)`. For empty-taskId
 * signals, the reader keys by `agentId:timestamp`. So we write retraction entries
 * with `taskId = original.timestamp` to make the keys match.
 *
 * Usage: npx ts-node scripts/migrate-empty-taskid-signals.ts [project-root]
 */
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { PerformanceWriter } from '@gossip/orchestrator';

const projectRoot = resolve(process.argv[2] || process.cwd());
const filePath = join(projectRoot, '.gossip', 'agent-performance.jsonl');

if (!existsSync(filePath)) {
  console.log('No agent-performance.jsonl found. Nothing to migrate.');
  process.exit(0);
}

const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
const writer = new PerformanceWriter(projectRoot);

let retracted = 0;
const now = new Date().toISOString();

for (const line of lines) {
  try {
    const signal = JSON.parse(line);
    if (signal.type !== 'consensus') continue;
    if (signal.signal === 'signal_retracted') continue;
    if (typeof signal.taskId === 'string' && signal.taskId.length > 0) continue;

    // Empty taskId — write retraction with original's timestamp as taskId
    writer.appendSignal({
      type: 'consensus',
      taskId: signal.timestamp, // matches reader's fallback key
      signal: 'signal_retracted',
      agentId: signal.agentId,
      evidence: `Migration: retracted legacy signal with empty taskId (original timestamp: ${signal.timestamp})`,
      timestamp: now,
    });
    retracted++;
  } catch {
    // Skip malformed JSON lines
  }
}

console.log(`Migration complete: retracted ${retracted} empty-taskId signals.`);
