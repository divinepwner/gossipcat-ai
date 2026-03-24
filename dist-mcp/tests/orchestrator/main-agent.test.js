"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const orchestrator_1 = require("@gossip/orchestrator");
/**
 * Test MainAgent orchestration logic with mock LLM.
 * We test the decompose -> assign -> synthesize flow without real relay/workers.
 */
describe('MainAgent orchestration flow', () => {
    it('decomposes task, assigns agents, and synthesizes results', async () => {
        // Mock LLM that decomposes into parallel tasks
        const mockLLM = {
            async generate(messages) {
                // Decomposition request
                if (messages[0]?.content?.toString().includes('task decomposition engine')) {
                    return {
                        text: JSON.stringify({
                            strategy: 'parallel',
                            subTasks: [
                                { description: 'write tests', requiredSkills: ['testing'] },
                                { description: 'write code', requiredSkills: ['typescript'] },
                            ],
                        }),
                    };
                }
                // Synthesis request
                if (messages[0]?.content?.toString().includes('Synthesize')) {
                    return { text: 'Combined result: tests and code written successfully.' };
                }
                return { text: 'fallback' };
            },
        };
        const registry = new orchestrator_1.AgentRegistry();
        registry.register({ id: 'tester', provider: 'openai', model: 'gpt', skills: ['testing'] });
        registry.register({ id: 'coder', provider: 'anthropic', model: 'claude', skills: ['typescript'] });
        const dispatcher = new orchestrator_1.TaskDispatcher(mockLLM, registry);
        const plan = await dispatcher.decompose('build a feature with tests');
        dispatcher.assignAgents(plan);
        expect(plan.subTasks[0].assignedAgent).toBe('tester');
        expect(plan.subTasks[1].assignedAgent).toBe('coder');
        expect(plan.strategy).toBe('parallel');
    });
    it('falls back to single task on LLM failure', async () => {
        const failingLLM = {
            async generate() { return { text: 'I cannot parse this into JSON' }; },
        };
        const dispatcher = new orchestrator_1.TaskDispatcher(failingLLM, new orchestrator_1.AgentRegistry());
        const plan = await dispatcher.decompose('do something');
        expect(plan.strategy).toBe('single');
        expect(plan.subTasks).toHaveLength(1);
        expect(plan.subTasks[0].description).toBe('do something');
    });
    it('handles task where all sub-tasks are unassigned', async () => {
        const mockLLM = {
            async generate() {
                return {
                    text: '{"strategy":"single","subTasks":[{"description":"do rust thing","requiredSkills":["rust"]}]}',
                };
            },
        };
        // No rust agents registered
        const registry = new orchestrator_1.AgentRegistry();
        registry.register({ id: 'ts', provider: 'local', model: 'qwen', skills: ['typescript'] });
        const dispatcher = new orchestrator_1.TaskDispatcher(mockLLM, registry);
        const plan = await dispatcher.decompose('do rust thing');
        dispatcher.assignAgents(plan);
        // Sub-task should remain unassigned (no rust skill)
        expect(plan.subTasks[0].assignedAgent).toBeUndefined();
    });
});
//# sourceMappingURL=main-agent.test.js.map