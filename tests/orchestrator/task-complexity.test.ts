import { MainAgent, AgentRegistry, ILLMProvider } from '@gossip/orchestrator';

describe('classifyTaskComplexity', () => {
  let mockLLM: ILLMProvider;
  let registry: AgentRegistry;

  beforeEach(() => {
    mockLLM = {
      generate: jest.fn(),
    };

    registry = new AgentRegistry();
    registry.register({
      id: 'implementer',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      preset: 'implementer',
      skills: ['typescript', 'react'],
    });
  });

  function makeAgent(): MainAgent {
    return new MainAgent({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      relayUrl: 'ws://localhost:9000',
      agents: [],
      llm: mockLLM,
    });
  }

  it('returns "single" for simple single-concern tasks when LLM returns "single"', async () => {
    (mockLLM.generate as jest.Mock).mockResolvedValue({ text: 'single' });

    const agent = makeAgent();
    const result = await agent.classifyTaskComplexity('Fix the typo in the README');

    expect(result).toBe('single');
  });

  it('returns "multi" for complex multi-concern tasks when LLM returns "multi"', async () => {
    (mockLLM.generate as jest.Mock).mockResolvedValue({ text: 'multi' });

    const agent = makeAgent();
    const result = await agent.classifyTaskComplexity(
      'Add auth system, refactor the database layer, and write E2E tests for the API'
    );

    expect(result).toBe('multi');
  });

  it('defaults to "single" when LLM returns verbose unparseable text', async () => {
    (mockLLM.generate as jest.Mock).mockResolvedValue({
      text: 'I think this task is quite complex and involves multiple concerns across the codebase.',
    });

    const agent = makeAgent();
    const result = await agent.classifyTaskComplexity('Do something');

    expect(result).toBe('single');
  });
});
