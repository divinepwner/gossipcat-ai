// Filename: tests/orchestrator/adaptive-intelligence-missing-tests.test.ts
// This file contains the missing test cases identified during the review of the implementation plan.

// --- Missing tests for overlap-detector.test.ts ---

describe('OverlapDetector extended cases', () => {
  const detector = new OverlapDetector();

  function agent(id: string, preset: string | undefined, skills: string[]): AgentConfig {
    const config: AgentConfig = { id, provider: 'google', model: 'gemini-2.5-pro', skills };
    if (preset) {
      config.preset = preset;
    }
    return config;
  }

  it('handles agents with no skills', () => {
    const agents = [
      agent('a', 'reviewer', ['code_review']),
      agent('b', 'tester', []),
    ];
    const result = detector.detect(agents);
    expect(result.hasOverlaps).toBe(false);
  });

  it('handles agent with no preset (defaults to custom)', () => {
    const agents = [
      agent('a', 'reviewer', ['code_review']),
      agent('b', undefined, ['code_review']),
    ];
    const result = detector.detect(agents);
    expect(result.hasOverlaps).toBe(true);
    expect(result.pairs[0].type).toBe('complementary'); // 'reviewer' vs 'custom'
    expect(result.agents.find(a => a.id === 'b')?.preset).toBe('custom');
  });

  it('detects three-way overlaps correctly as pairs', () => {
    const agents = [
      agent('a', 'reviewer', ['code_review', 'security']),
      agent('b', 'reviewer', ['code_review', 'ts']),
      agent('c', 'tester', ['code_review', 'testing']),
    ];
    const result = detector.detect(agents);
    expect(result.hasOverlaps).toBe(true);
    // Should find (a,b), (a,c), and (b,c)
    expect(result.pairs).toHaveLength(3);
    const shared = result.pairs.map(p => p.shared[0]).sort();
    expect(shared).toEqual(['code_review', 'code_review', 'code_review']);
  });
});


// --- Missing tests for lens-generator.test.ts ---

describe('LensGenerator extended cases', () => {
  const agents = [
    { id: 'rev', preset: 'reviewer', skills: ['code_review'] },
    { id: 'tst', preset: 'tester', skills: ['code_review'] },
  ];
  const task = 'Review the auth module';
  const sharedSkills = ['code_review'];

  function mockLLM(response: string): ILLMProvider {
    return {
      generate: jest.fn().mockResolvedValue({ text: response, toolCalls: [] } as LLMResponse),
    } as any;
  }

  it('returns empty array when LLM returns non-array JSON', async () => {
    const llm = mockLLM(JSON.stringify({ error: 'invalid prompt' }));
    const gen = new LensGenerator(llm);
    const lenses = await gen.generateLenses(agents, task, sharedSkills);
    expect(lenses).toHaveLength(0);
  });

  it('filters out lenses with missing agentId or focus', async () => {
    const llm = mockLLM(JSON.stringify([
      { agentId: 'rev', focus: 'Focus on security' },
      { agentId: 'tst' /* missing focus */ },
      { focus: 'some focus' /* missing agentId */ },
    ]));
    const gen = new LensGenerator(llm);
    // Implementation should return [] because valid.length !== agents.length
    const lenses = await gen.generateLenses(agents, task, sharedSkills);
    expect(lenses).toHaveLength(0);
  });

  it('parses JSON from within a markdown code block', async () => {
    const json = JSON.stringify([
      { agentId: 'rev', focus: 'Focus on vulnerability identification', avoidOverlap: '' },
      { agentId: 'tst', focus: 'Focus on testing gaps', avoidOverlap: '' },
    ]);
    const llm = mockLLM('Here is the JSON:\n```json\n' + json + '\n```');
    const gen = new LensGenerator(llm);
    const lenses = await gen.generateLenses(agents, task, sharedSkills);
    expect(lenses).toHaveLength(2);
    expect(lenses[0].agentId).toBe('rev');
  });

  it('returns empty array if no shared skills are provided', async () => {
    const llm = mockLLM('[]'); // This should not even be called
    const gen = new LensGenerator(llm);
    const lenses = await gen.generateLenses(agents, task, []);
    expect(lenses).toHaveLength(0);
    expect(llm.generate).not.toHaveBeenCalled();
  });
});
