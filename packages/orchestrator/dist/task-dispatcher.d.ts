/**
 * TaskDispatcher — decomposes tasks into sub-tasks and assigns agents.
 *
 * Uses LLM to analyze a task and produce a DispatchPlan.
 * Falls back to single sub-task if LLM returns invalid JSON.
 */
import { ILLMProvider } from './llm-client';
import { AgentRegistry } from './agent-registry';
import { DispatchPlan, PlannedTask } from './types';
export declare class TaskDispatcher {
    private llm;
    private registry;
    constructor(llm: ILLMProvider, registry: AgentRegistry);
    /**
     * Decompose a task into a DispatchPlan using the LLM.
     * On parse failure, falls back to a single sub-task.
     */
    decompose(task: string): Promise<DispatchPlan>;
    /**
     * Assign agents to each sub-task by skill match.
     * Modifies the plan in-place and returns it.
     * Populates plan.warnings for any required skill with no matching agent.
     */
    assignAgents(plan: DispatchPlan): DispatchPlan;
    /**
     * Classify each sub-task as read or write and suggest write modes.
     * Falls back to all-read on LLM failure.
     */
    classifyWriteModes(plan: DispatchPlan): Promise<PlannedTask[]>;
    /** Collect all unique skills from registered agents */
    private getAvailableSkills;
}
