import { Keychain } from '../../apps/cli/src/keychain';

describe('Keychain', () => {
  it('stores and retrieves keys in memory', async () => {
    const keychain = new Keychain();
    await keychain.setKey('test-provider', 'test-key-123');
    const key = await keychain.getKey('test-provider');
    expect(key).toBe('test-key-123');
  });

  it('returns null for non-existent key', async () => {
    const keychain = new Keychain();
    expect(await keychain.getKey('nonexistent')).toBeNull();
  });
});
