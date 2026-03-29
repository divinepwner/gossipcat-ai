import { SessionGossipEntry, SessionGossipSnapshot } from '@gossip/types';
import { ISessionGossipManager } from './session-gossip-manager';

interface SessionData extends Omit<SessionGossipEntry, 'sessionId' | 'timestamp'> {
  timestamp: number;
}

export class SessionGossipManagerImpl implements ISessionGossipManager {
  private readonly sessions = new Map<string, SessionData>();

  public update(entry: SessionGossipEntry): void {
    const existing = this.sessions.get(entry.sessionId);
    if (existing && existing.timestamp >= entry.timestamp) {
      return;
    }

    const { sessionId, ...rest } = entry;
    this.sessions.set(sessionId, rest);
  }

  public getSnapshot(): SessionGossipSnapshot {
    const snapshot: SessionGossipSnapshot = {};
    for (const [sessionId, data] of this.sessions.entries()) {
      const { timestamp, ...rest } = data;
      snapshot[sessionId] = rest;
    }
    return snapshot;
  }
}
