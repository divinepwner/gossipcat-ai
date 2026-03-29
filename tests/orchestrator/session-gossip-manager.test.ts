import { ISessionGossipManager } from '../../packages/orchestrator/src/session-gossip-manager';
import { SessionGossipManagerImpl } from '../../packages/orchestrator/src/session-gossip-manager-impl';
import { SessionGossipEntry, SessionState, Plan, PlanState } from '@gossip/types';

describe('SessionGossipManager', () => {
  let manager: ISessionGossipManager;
  let plan: Plan;

  beforeEach(() => {
    manager = new SessionGossipManagerImpl();
    plan = {
      agentId: 'agent-a',
      state: PlanState.IN_PROGRESS,
      steps: [{ id: 'step-1', description: 'write code', state: 'PENDING' }],
    };
  });

  it('should be empty initially', () => {
    expect(manager.getSnapshot()).toEqual({});
  });

  it('should add a new session entry', () => {
    const entry: SessionGossipEntry = {
      sessionId: 'session-1',
      agentId: 'agent-a',
      state: SessionState.CODING,
      plan,
      timestamp: Date.now(),
    };

    manager.update(entry);

    const snapshot = manager.getSnapshot();
    expect(snapshot).toHaveProperty('session-1');
    expect(snapshot['session-1']).toEqual({
      agentId: 'agent-a',
      state: SessionState.CODING,
      plan,
    });
  });

  it('should update an existing session entry with a newer timestamp', () => {
    const now = Date.now();
    const entry1: SessionGossipEntry = {
      sessionId: 'session-1',
      agentId: 'agent-a',
      state: SessionState.CODING,
      plan,
      timestamp: now,
    };
    manager.update(entry1);

    const entry2: SessionGossipEntry = {
      sessionId: 'session-1',
      agentId: 'agent-a',
      state: SessionState.TESTING,
      plan,
      timestamp: now + 1,
    };
    manager.update(entry2);

    const snapshot = manager.getSnapshot();
    expect(snapshot['session-1'].state).toBe(SessionState.TESTING);
  });

  it('should not update an existing session entry with an older or equal timestamp', () => {
    const now = Date.now();
    const entry1: SessionGossipEntry = {
      sessionId: 'session-1',
      agentId: 'agent-a',
      state: SessionState.CODING,
      plan,
      timestamp: now,
    };
    manager.update(entry1);

    const entry2: SessionGossipEntry = {
      sessionId: 'session-1',
      agentId: 'agent-a',
      state: SessionState.TESTING,
      plan,
      timestamp: now - 1,
    };
    manager.update(entry2);

    let snapshot = manager.getSnapshot();
    expect(snapshot['session-1'].state).toBe(SessionState.CODING);

    const entry3: SessionGossipEntry = {
      sessionId: 'session-1',
      agentId: 'agent-a',
      state: SessionState.REFACTORING,
      plan,
      timestamp: now,
    };
    manager.update(entry3);

    snapshot = manager.getSnapshot();
    expect(snapshot['session-1'].state).toBe(SessionState.CODING);
  });
});
