import { ILLMProvider } from './llm-client';
import { AgentConfig } from './types';
// ConsensusReport, ConsensusFinding, ConsensusNewFinding, ConsensusSignal, CrossReviewEntry
// are used in later tasks (dispatchCrossReview, synthesize, run)
export type {
  ConsensusReport,
  ConsensusFinding,
  ConsensusNewFinding,
  ConsensusSignal,
  CrossReviewEntry,
} from './consensus-types';

const SUMMARY_HEADER = '## Consensus Summary';
const FALLBACK_MAX_LENGTH = 2000;

export interface ConsensusEngineConfig {
  llm: ILLMProvider;
  registryGet: (agentId: string) => AgentConfig | undefined;
}

export class ConsensusEngine {
  // config fields (llm, registryGet) are used in later tasks (dispatchCrossReview, synthesize, run)
  protected readonly config: ConsensusEngineConfig;

  constructor(config: ConsensusEngineConfig) {
    this.config = config;
  }

  extractSummary(result: string): string {
    const idx = result.indexOf(SUMMARY_HEADER);
    if (idx !== -1) {
      const afterHeader = result.slice(idx + SUMMARY_HEADER.length).trimStart();
      const nextHeader = afterHeader.search(/\n##\s/);
      const nextBlankLine = afterHeader.indexOf('\n\n');
      let end = afterHeader.length;
      if (nextHeader !== -1) end = Math.min(end, nextHeader);
      if (nextBlankLine !== -1) end = Math.min(end, nextBlankLine);
      return afterHeader.slice(0, end).trim();
    }

    if (result.length <= FALLBACK_MAX_LENGTH) return result;
    const truncated = result.slice(0, FALLBACK_MAX_LENGTH);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > FALLBACK_MAX_LENGTH * 0.5) {
      return truncated.slice(0, lastPeriod + 1);
    }
    return truncated;
  }
}
