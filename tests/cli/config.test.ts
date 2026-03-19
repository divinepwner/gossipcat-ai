import { validateConfig } from '../../apps/cli/src/config';

describe('Config Validation', () => {
  it('accepts valid config', () => {
    const config = validateConfig({
      main_agent: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      agents: {
        arch: { provider: 'anthropic', model: 'claude', skills: ['typescript'] }
      }
    });
    expect(config.main_agent.provider).toBe('anthropic');
  });

  it('rejects missing main_agent', () => {
    expect(() => validateConfig({})).toThrow('main_agent');
  });

  it('rejects missing main_agent.provider', () => {
    expect(() => validateConfig({ main_agent: { model: 'x' } })).toThrow('provider');
  });

  it('rejects invalid provider', () => {
    expect(() => validateConfig({ main_agent: { provider: 'invalid', model: 'x' } })).toThrow('Invalid provider');
  });

  it('rejects agent with no skills', () => {
    expect(() => validateConfig({
      main_agent: { provider: 'anthropic', model: 'claude' },
      agents: { a: { provider: 'anthropic', model: 'claude', skills: [] } }
    })).toThrow('at least one skill');
  });

  it('accepts config without agents (main agent only)', () => {
    const config = validateConfig({ main_agent: { provider: 'anthropic', model: 'claude' } });
    expect(config.agents).toBeUndefined();
  });
});
