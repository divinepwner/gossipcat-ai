import {
  buildCacheableSystem,
  markToolsCacheable,
  CACHE_MIN_CHARS,
  AnthropicProvider,
} from '@gossip/orchestrator';
import type { ToolDefinition, TextContent } from '@gossip/types';

describe('buildCacheableSystem', () => {
  const longStatic = 'x'.repeat(CACHE_MIN_CHARS + 100);
  const shortStatic = 'short template';

  it('returns empty array when both inputs are empty', () => {
    expect(buildCacheableSystem('')).toEqual([]);
    expect(buildCacheableSystem('', '')).toEqual([]);
  });

  it('returns a single uncached block when static is below threshold', () => {
    const blocks = buildCacheableSystem(shortStatic, 'dynamic tail');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe(shortStatic + 'dynamic tail');
    expect(blocks[0].cacheControl).toBeUndefined();
  });

  it('marks static prefix cacheable when over threshold', () => {
    const blocks = buildCacheableSystem(longStatic, 'tail');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: 'text',
      text: longStatic,
      cacheControl: 'ephemeral',
    });
    expect(blocks[1]).toEqual({ type: 'text', text: 'tail' });
    expect(blocks[1].cacheControl).toBeUndefined();
  });

  it('omits dynamic block when dynamic is absent or empty', () => {
    expect(buildCacheableSystem(longStatic)).toHaveLength(1);
    expect(buildCacheableSystem(longStatic, '')).toHaveLength(1);
    expect(buildCacheableSystem(longStatic, undefined)).toHaveLength(1);
  });

  it('is byte-deterministic across repeated calls', () => {
    const a = buildCacheableSystem(longStatic, 'skills content');
    const b = buildCacheableSystem(longStatic, 'skills content');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('preserves caller whitespace verbatim (no trim / normalize)', () => {
    const staticWithTrailingNewline = longStatic + '\n';
    const blocks = buildCacheableSystem(staticWithTrailingNewline, '  \nskills');
    expect(blocks[0].text).toBe(staticWithTrailingNewline);
    expect(blocks[1].text).toBe('  \nskills');
  });

  it('returns a single dynamic block when static is empty but dynamic is set', () => {
    const blocks = buildCacheableSystem('', 'only dynamic');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'text', text: 'only dynamic' });
  });
});

describe('markToolsCacheable', () => {
  const tools: ToolDefinition[] = [
    { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } },
    { name: 'b', description: 'B', parameters: { type: 'object', properties: {} } },
    { name: 'c', description: 'C', parameters: { type: 'object', properties: {} } },
  ];

  it('returns empty array for empty input', () => {
    expect(markToolsCacheable([])).toEqual([]);
  });

  it('marks only the last tool as cacheable', () => {
    const out = markToolsCacheable(tools);
    expect(out).toHaveLength(3);
    expect(out[0].cacheControl).toBeUndefined();
    expect(out[1].cacheControl).toBeUndefined();
    expect(out[2].cacheControl).toBe('ephemeral');
  });

  it('does not mutate the input array', () => {
    const copy: ToolDefinition[] = JSON.parse(JSON.stringify(tools));
    markToolsCacheable(tools);
    expect(tools).toEqual(copy);
  });

  it('is stable across repeated calls (same output shape)', () => {
    const a = markToolsCacheable(tools);
    const b = markToolsCacheable(tools);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('AnthropicProvider — prompt caching wire format', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  async function captureBody(
    system: string | TextContent[],
    options?: Parameters<AnthropicProvider['generate']>[1],
  ): Promise<any> {
    let sentBody: any = null;
    global.fetch = jest.fn().mockImplementation(async (_url: string, opts: any) => {
      sentBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      };
    }) as unknown as typeof fetch;

    const provider = new AnthropicProvider('test-key', 'claude-3');
    await provider.generate(
      [
        { role: 'system', content: system },
        { role: 'user', content: 'hi' },
      ],
      options,
    );
    return sentBody;
  }

  it('emits system as a string when content is a plain string (legacy path)', async () => {
    const body = await captureBody('You are helpful.');
    expect(typeof body.system).toBe('string');
    expect(body.system).toBe('You are helpful.');
  });

  it('emits system as an array with cache_control when content carries marker', async () => {
    const blocks: TextContent[] = [
      { type: 'text', text: 'static prefix', cacheControl: 'ephemeral' },
      { type: 'text', text: 'dynamic tail' },
    ];
    const body = await captureBody(blocks);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0]).toEqual({
      type: 'text',
      text: 'static prefix',
      cache_control: { type: 'ephemeral' },
    });
    expect(body.system[1]).toEqual({ type: 'text', text: 'dynamic tail' });
  });

  it('omits system entirely when content array is empty', async () => {
    const body = await captureBody([]);
    expect(body.system).toBeUndefined();
  });

  it('forwards cache_control on tool definitions to Anthropic tools array', async () => {
    const tools: ToolDefinition[] = [
      { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } },
      { name: 'b', description: 'B', parameters: { type: 'object', properties: {} } },
    ];
    const body = await captureBody('sys', { tools: markToolsCacheable(tools) });
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('leaves tools unmarked when caller passes raw ToolDefinition[]', async () => {
    const tools: ToolDefinition[] = [
      { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } },
    ];
    const body = await captureBody('sys', { tools });
    expect(body.tools[0].cache_control).toBeUndefined();
  });
});

describe('AnthropicProvider — cache usage parsing', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('surfaces cache_creation_input_tokens and cache_read_input_tokens on response.usage', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 1200,
          cache_read_input_tokens: 3400,
        },
      }),
    }) as unknown as typeof fetch;

    const provider = new AnthropicProvider('test-key', 'claude-3');
    const res = await provider.generate([{ role: 'user', content: 'hi' }]);

    expect(res.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 1200,
      cacheReadTokens: 3400,
    });
  });

  it('omits cache token fields when the API response does not include them', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    }) as unknown as typeof fetch;

    const provider = new AnthropicProvider('test-key', 'claude-3');
    const res = await provider.generate([{ role: 'user', content: 'hi' }]);

    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(res.usage).not.toHaveProperty('cacheCreationTokens');
    expect(res.usage).not.toHaveProperty('cacheReadTokens');
  });
});
