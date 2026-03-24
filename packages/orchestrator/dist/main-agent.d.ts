/**
 * MainAgent — the developer's single point of contact.
 *
 * Receives natural language tasks, decomposes them via TaskDispatcher,
 * fans out to WorkerAgents, and synthesizes results.
 */
import { ILLMProvider } from './llm-client';
import { WorkerAgent } from './worker-agent';
import { AgentConfig, DispatchOptions, PlanState, ChatResponse } from './types';
import { ContentBlock } from '@gossip/types';
import { ToolServerCallbacks } from './dispatch-pipeline';
import { TaskGraphSync } from './task-graph-sync';
export interface MainAgentConfig {
    provider: string;
    model: string;
    apiKey?: string;
    relayUrl: string;
    agents: AgentConfig[];
    apiKeys?: Record<string, string>;
    projectRoot?: string;
    llm?: ILLMProvider;
    bootstrapPrompt?: string;
    syncFactory?: () => TaskGraphSync | null;
    toolServer?: ToolServerCallbacks | null;
}
export declare class MainAgent {
    private llm;
    private registry;
    private dispatcher;
    private workers;
    private relayUrl;
    private apiKeys;
    private projectRoot;
    private pipeline;
    private bootstrapPrompt;
    private orchestratorAgent;
    constructor(config: MainAgentConfig);
    /** Start all worker agents (connect to relay) */
    start(): Promise<void>;
    /** Set externally-created workers (used by MCP server to avoid duplicate connections) */
    setWorkers(externalWorkers: Map<string, WorkerAgent>): void;
    dispatch(agentId: string, task: string, options?: DispatchOptions): {
        taskId: string;
        promise: Promise<string>;
    };
    collect(taskIds?: string[], timeoutMs?: number, options?: {
        consensus?: boolean;
    }): Promise<import("./consensus-types").CollectResult>;
    dispatchParallel(tasks: Array<{
        agentId: string;
        task: string;
        options?: DispatchOptions;
    }>, options?: {
        consensus?: boolean;
    }): Promise<{
        taskIds: string[];
        errors: string[];
    }>;
    registerPlan(plan: PlanState): void;
    getWorker(agentId: string): WorkerAgent | undefined;
    getTask(taskId: string): import("./types").TaskEntry | undefined;
    setGossipPublisher(publisher: any): void;
    setOverlapDetector(detector: any): void;
    setLensGenerator(generator: any): void;
    /** Register new agent configs (for hot-reload from config changes) */
    registerAgent(config: AgentConfig): void;
    syncWorkers(keyProvider: (provider: string) => Promise<string | null>): Promise<number>;
    /** Stop all worker agents */
    stop(): Promise<void>;
    /** Handle a user message: decompose, dispatch, synthesize. Returns structured ChatResponse. */
    handleMessage(userMessage: string | ContentBlock[]): Promise<ChatResponse>;
    /** Handle a user's choice selection — continues the conversation with context */
    handleChoice(originalMessage: string, choiceValue: string): Promise<ChatResponse>;
    /**
     * Parse LLM response for structured elements.
     * Detects choice blocks in the format:
     *   [CHOICES]
     *   message: How should I proceed?
     *   - option_value | Display Label | Optional hint
     *   - option_value | Display Label
     *   [/CHOICES]
     */
    private parseResponse;
    private handleReviewRequest;
    private executeSubTask;
    private synthesize;
}
