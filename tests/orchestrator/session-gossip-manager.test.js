"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const session_gossip_manager_impl_1 = require("../../packages/orchestrator/src/session-gossip-manager-impl");
const types_1 = require("@gossip/types");
describe('SessionGossipManager', () => {
    let manager;
    let plan;
    beforeEach(() => {
        manager = new session_gossip_manager_impl_1.SessionGossipManagerImpl();
        plan = {
            agentId: 'agent-a',
            state: types_1.PlanState.IN_PROGRESS,
            steps: [{ id: 'step-1', description: 'write code', state: 'PENDING' }],
        };
    });
    it('should be empty initially', () => {
        expect(manager.getSnapshot()).toEqual({});
    });
    it('should add a new session entry', () => {
        const entry = {
            sessionId: 'session-1',
            agentId: 'agent-a',
            state: types_1.SessionState.CODING,
            plan,
            timestamp: Date.now(),
        };
        manager.update(entry);
        const snapshot = manager.getSnapshot();
        expect(snapshot).toHaveProperty('session-1');
        expect(snapshot['session-1']).toEqual({
            agentId: 'agent-a',
            state: types_1.SessionState.CODING,
            plan,
        });
    });
    it('should update an existing session entry with a newer timestamp', () => {
        const now = Date.now();
        const entry1 = {
            sessionId: 'session-1',
            agentId: 'agent-a',
            state: types_1.SessionState.CODING,
            plan,
            timestamp: now,
        };
        manager.update(entry1);
        const entry2 = {
            sessionId: 'session-1',
            agentId: 'agent-a',
            state: types_1.SessionState.TESTING,
            plan,
            timestamp: now + 1,
        };
        manager.update(entry2);
        const snapshot = manager.getSnapshot();
        expect(snapshot['session-1'].state).toBe(types_1.SessionState.TESTING);
    });
    it('should not update an existing session entry with an older or equal timestamp', () => {
        const now = Date.now();
        const entry1 = {
            sessionId: 'session-1',
            agentId: 'agent-a',
            state: types_1.SessionState.CODING,
            plan,
            timestamp: now,
        };
        manager.update(entry1);
        const entry2 = {
            sessionId: 'session-1',
            agentId: 'agent-a',
            state: types_1.SessionState.TESTING,
            plan,
            timestamp: now - 1,
        };
        manager.update(entry2);
        let snapshot = manager.getSnapshot();
        expect(snapshot['session-1'].state).toBe(types_1.SessionState.CODING);
        const entry3 = {
            sessionId: 'session-1',
            agentId: 'agent-a',
            state: types_1.SessionState.REFACTORING,
            plan,
            timestamp: now,
        };
        manager.update(entry3);
        snapshot = manager.getSnapshot();
        expect(snapshot['session-1'].state).toBe(types_1.SessionState.CODING);
    });
});
//# sourceMappingURL=session-gossip-manager.test.js.map