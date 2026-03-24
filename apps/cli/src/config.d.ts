import { AgentConfig } from '@gossip/orchestrator';
export interface GossipConfig {
    main_agent: {
        provider: string;
        model: string;
    };
    utility_model?: {
        provider: string;
        model: string;
    };
    agents?: Record<string, {
        provider: string;
        model: string;
        preset?: string;
        skills: string[];
    }>;
}
export declare function findConfigPath(projectRoot?: string): string | null;
export declare function loadConfig(configPath: string): GossipConfig;
export declare function validateConfig(raw: any): GossipConfig;
export declare function configToAgentConfigs(config: GossipConfig): AgentConfig[];
