import { ILLMProvider } from './llm-client';
import { IConsensusJudge } from './consensus-judge';
import { ConsensusReport } from './consensus-types';
import { AgentConfig, TaskEntry } from './types';
import { GossipPublisher } from './gossip-publisher';

export interface ConsensusCoordinatorConfig {
  llm: ILLMProvider | null;
  registryGet: (id: string) => AgentConfig | undefined;
  projectRoot: string;
  keyProvider: ((provider: string) => Promise<string | null>) | null;
}

type ConsensusPhase = 'idle' | 'review' | 'cross_review' | 'synthesis';

export class ConsensusCoordinator {
  protected llm: ILLMProvider | null;
  protected registryGet: (id: string) => AgentConfig | undefined;
  protected projectRoot: string;
  protected keyProvider: ((provider: string) => Promise<string | null>) | null;
  protected consensusJudge: IConsensusJudge | null = null;
  protected gossipPublisher: GossipPublisher | null = null;

  private currentPhase: ConsensusPhase = 'idle';

  readonly sessionConsensusHistory: ConsensusReport[] = [];

  constructor(config: ConsensusCoordinatorConfig) {
    this.llm = config.llm;
    this.registryGet = config.registryGet;
    this.projectRoot = config.projectRoot;
    this.keyProvider = config.keyProvider;
  }

  setConsensusJudge(judge: IConsensusJudge): void {
    this.consensusJudge = judge;
  }

  setGossipPublisher(publisher: GossipPublisher): void {
    this.gossipPublisher = publisher;
  }

  getCurrentPhase(): ConsensusPhase {
    return this.currentPhase;
  }

  async runConsensus(results: TaskEntry[]): Promise<ConsensusReport | undefined> {
    if (!this.llm || results.filter(r => r.status === 'completed').length < 2) {
      return undefined;
    }

    // Full consensus logic will be moved here in the next task.
    return undefined;
  }
}
