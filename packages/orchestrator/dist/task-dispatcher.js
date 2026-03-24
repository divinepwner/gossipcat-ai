"use strict";
/**
 * TaskDispatcher — decomposes tasks into sub-tasks and assigns agents.
 *
 * Uses LLM to analyze a task and produce a DispatchPlan.
 * Falls back to single sub-task if LLM returns invalid JSON.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskDispatcher = void 0;
const crypto_1 = require("crypto");
class TaskDispatcher {
    llm;
    registry;
    constructor(llm, registry) {
        this.llm = llm;
        this.registry = registry;
    }
    /**
     * Decompose a task into a DispatchPlan using the LLM.
     * On parse failure, falls back to a single sub-task.
     */
    async decompose(task) {
        const availableSkills = this.getAvailableSkills();
        const skillList = availableSkills.length > 0 ? availableSkills.join(', ') : 'general';
        const messages = [
            {
                role: 'system',
                content: `You are a task decomposition engine. Break the user's task into sub-tasks.
For each sub-task, specify required skills from: ${skillList}.
Respond in JSON format:
{
  "strategy": "single" | "parallel" | "sequential",
  "subTasks": [{ "description": "...", "requiredSkills": ["..."] }]
}
If the task is simple enough for one agent, use strategy "single" with one sub-task.`,
            },
            { role: 'user', content: task },
        ];
        const response = await this.llm.generate(messages, { temperature: 0 });
        try {
            const jsonMatch = response.text.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                throw new Error('No JSON in response');
            const plan = JSON.parse(jsonMatch[0]);
            return {
                originalTask: task,
                strategy: plan.strategy || 'single',
                subTasks: (plan.subTasks || []).map((st) => ({
                    id: (0, crypto_1.randomUUID)(),
                    description: st.description,
                    requiredSkills: st.requiredSkills || [],
                    status: 'pending',
                })),
                warnings: [],
            };
        }
        catch {
            // Fallback: single sub-task with no specific skills
            return {
                originalTask: task,
                strategy: 'single',
                subTasks: [{
                        id: (0, crypto_1.randomUUID)(),
                        description: task,
                        requiredSkills: [],
                        status: 'pending',
                    }],
                warnings: [],
            };
        }
    }
    /**
     * Assign agents to each sub-task by skill match.
     * Modifies the plan in-place and returns it.
     * Populates plan.warnings for any required skill with no matching agent.
     */
    assignAgents(plan) {
        if (!plan.warnings)
            plan.warnings = [];
        for (const subTask of plan.subTasks) {
            const match = this.registry.findBestMatch(subTask.requiredSkills);
            if (match) {
                subTask.assignedAgent = match.id;
            }
            else {
                for (const skill of subTask.requiredSkills) {
                    const hasAgent = this.registry.findBySkill(skill).length > 0;
                    if (!hasAgent) {
                        plan.warnings.push(`Skill '${skill}' is required but no agent has it assigned. ` +
                            `Add it to an agent's skills in gossip.agents.json.`);
                    }
                }
            }
        }
        return plan;
    }
    /**
     * Classify each sub-task as read or write and suggest write modes.
     * Falls back to all-read on LLM failure.
     */
    async classifyWriteModes(plan) {
        const subTaskList = plan.subTasks
            .map((st, i) => `${i}. [agent: ${st.assignedAgent || 'unassigned'}] ${st.description}`)
            .join('\n');
        try {
            const messages = [
                {
                    role: 'system',
                    content: `Classify each sub-task as read-only or write. For write tasks, suggest a write mode and scope.

Rules:
- Tasks with action verbs (fix, implement, add, create, refactor, update, delete, write, build, migrate) → write
- Tasks with observation verbs (review, analyze, check, verify, list, explain, summarize, audit, trace) → read
- If the task mentions a specific directory or package path → write_mode: scoped, scope: that path
- If the task is broad with no clear directory boundary → write_mode: sequential
- If the task says "experiment", "try", "prototype", or "spike" → write_mode: worktree

Respond as JSON array:
[{ "index": 0, "access": "write", "write_mode": "scoped", "scope": "packages/tools/" }, { "index": 1, "access": "read" }]`,
                },
                { role: 'user', content: `Sub-tasks:\n${subTaskList}` },
            ];
            const response = await this.llm.generate(messages, { temperature: 0 });
            const jsonMatch = response.text.match(/\[[\s\S]*\]/);
            if (!jsonMatch)
                throw new Error('No JSON array in response');
            const classifications = JSON.parse(jsonMatch[0]);
            const validModes = new Set(['sequential', 'scoped', 'worktree']);
            return plan.subTasks.map((st, i) => {
                const c = classifications.find(cl => cl.index === i);
                const isWrite = c?.access === 'write';
                const mode = isWrite && c?.write_mode && validModes.has(c.write_mode)
                    ? c.write_mode
                    : undefined;
                return {
                    agentId: st.assignedAgent || '',
                    task: st.description,
                    access: isWrite ? 'write' : 'read',
                    writeMode: mode,
                    scope: isWrite ? c?.scope : undefined,
                };
            });
        }
        catch {
            // Fallback: all read-only
            return plan.subTasks.map(st => ({
                agentId: st.assignedAgent || '',
                task: st.description,
                access: 'read',
            }));
        }
    }
    /** Collect all unique skills from registered agents */
    getAvailableSkills() {
        const skills = new Set();
        for (const agent of this.registry.getAll()) {
            agent.skills.forEach(s => skills.add(s));
        }
        return Array.from(skills);
    }
}
exports.TaskDispatcher = TaskDispatcher;
//# sourceMappingURL=task-dispatcher.js.map