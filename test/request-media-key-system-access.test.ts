import { describe, expect, it } from 'vitest';
import { AUDIO_CAPABILITY, CLEARKEY, CLEARKEY_CONFIG, CONFIG, VIDEO_CAPABILITY, WIDEVINE } from './helpers';

const UNSUPPORTED_KEY_SYSTEM = 'com.example.unsupported';

const UNSUPPORTED_CAPABILITY: MediaKeySystemMediaCapability = { contentType: 'video/webm' };

function request(keySystem: string, configs: MediaKeySystemConfiguration[]): Promise<MediaKeySystemAccess> {
  return navigator.requestMediaKeySystemAccess(keySystem, configs);
}

describe('navigator.requestMediaKeySystemAccess()', () => {
  it('resolves with access to a supported key system', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    expect(access.keySystem).toBe(WIDEVINE);
  });

  it('rejects with NotSupportedError for an unsupported key system', async () => {
    const result = request(UNSUPPORTED_KEY_SYSTEM, [CONFIG]);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('returns a rejected promise instead of throwing', async () => {
    const result = request(UNSUPPORTED_KEY_SYSTEM, [CONFIG]);
    expect(result).toBeInstanceOf(Promise);
    await result.catch(() => undefined);
  });

  // Resolves instead.
  it.skip('rejects with TypeError for an empty key system', async () => {
    const result = request('', [CONFIG]);
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });

  // Rejects with NotSupportedError instead.
  it.skip('rejects with TypeError for an empty list of configurations', async () => {
    const result = request(WIDEVINE, []);
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });

  it('picks the first supported configuration', async () => {
    const unsupportedConfig = { ...CONFIG, label: 'first', videoCapabilities: [UNSUPPORTED_CAPABILITY] };
    const supportedConfig = { ...CONFIG, label: 'second' };
    const access = await request(WIDEVINE, [unsupportedConfig, supportedConfig]);
    const configuration = access.getConfiguration();
    expect(configuration.label).toBe('second');
  });

  it('rejects configurations that require persistent state', async () => {
    const config: MediaKeySystemConfiguration = { ...CONFIG, persistentState: 'required' };
    const result = request(WIDEVINE, [config]);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('rejects configurations that ask for other session types than temporary', async () => {
    const config = { ...CONFIG, sessionTypes: ['persistent-license'] };
    const result = request(WIDEVINE, [config]);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('drops the unsupported capabilities', async () => {
    const config = { ...CONFIG, videoCapabilities: [VIDEO_CAPABILITY, UNSUPPORTED_CAPABILITY] };
    const access = await request(WIDEVINE, [config]);
    const configuration = access.getConfiguration();
    expect(configuration.videoCapabilities).toEqual([VIDEO_CAPABILITY]);
  });

  it('rejects a configuration whose capabilities are all unsupported', async () => {
    const config = { ...CONFIG, videoCapabilities: [UNSUPPORTED_CAPABILITY] };
    const result = request(WIDEVINE, [config]);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  // Falls back to checking whether video/mp4 is supported.
  it.skip('rejects a configuration without audio and video capabilities', async () => {
    const config = { initDataTypes: ['cenc'] };
    const result = request(WIDEVINE, [config]);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  // Skips the capability instead.
  it.skip('rejects a configuration with an empty contentType', async () => {
    const config = { ...CONFIG, videoCapabilities: [VIDEO_CAPABILITY, { contentType: '' }] };
    const result = request(WIDEVINE, [config]);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  // Accepted, as only canPlayType() is checked.
  it.skip('drops video capabilities with an audio content type', async () => {
    const config = { ...CONFIG, videoCapabilities: [VIDEO_CAPABILITY, AUDIO_CAPABILITY] };
    const access = await request(WIDEVINE, [config]);
    const configuration = access.getConfiguration();
    expect(configuration.videoCapabilities).toEqual([VIDEO_CAPABILITY]);
  });

  // Robustness is ignored.
  it.skip('drops capabilities with an unsupported robustness', async () => {
    const capability = { ...VIDEO_CAPABILITY, robustness: 'NOT_A_ROBUSTNESS' };
    const config = { ...CONFIG, videoCapabilities: [capability] };
    const result = request(WIDEVINE, [config]);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  // The encryption scheme is ignored.
  it.skip('drops capabilities with an unsupported encryption scheme', async () => {
    const capability = { ...VIDEO_CAPABILITY, encryptionScheme: 'not-a-scheme' };
    const config = { ...CONFIG, videoCapabilities: [capability] };
    const result = request(WIDEVINE, [config]);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  // The requested init data types are copied as is.
  it.skip('keeps only the supported init data types', async () => {
    const config = { ...CONFIG, initDataTypes: ['cenc', 'not-a-type'] };
    const access = await request(WIDEVINE, [config]);
    const configuration = access.getConfiguration();
    expect(configuration.initDataTypes).toEqual(['cenc']);
  });

  // Resolves instead.
  it.skip('rejects a configuration without supported init data types', async () => {
    const config = { ...CONFIG, initDataTypes: ['not-a-type'] };
    const result = request(WIDEVINE, [config]);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });
});

describe('MediaKeySystemAccess', () => {
  it('reports the requested key system, not the v0.1b name', async () => {
    const access = await request(CLEARKEY, [CLEARKEY_CONFIG]);
    expect(access.keySystem).toBe(CLEARKEY);
  });

  // A plain, writable property.
  it.skip('has a read-only keySystem', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    try {
      (access as { keySystem: string }).keySystem = 'changed';
    } catch {
      // Throws in strict mode, which is fine.
    }
    expect(access.keySystem).toBe(WIDEVINE);
  });

  it('reports temporary as the only session type', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    const configuration = access.getConfiguration();
    expect(configuration.sessionTypes).toEqual(['temporary']);
  });

  // Reports `optional`, as v0.1b can't tell.
  it.skip('reports distinctiveIdentifier and persistentState as required or not-allowed', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    const configuration = access.getConfiguration();
    expect(configuration.distinctiveIdentifier).not.toBe('optional');
    expect(configuration.persistentState).not.toBe('optional');
  });

  // Always reports ['temporary'].
  it.skip('reports an empty list of session types when that was requested', async () => {
    const config = { ...CONFIG, sessionTypes: [] };
    const access = await request(WIDEVINE, [config]);
    const configuration = access.getConfiguration();
    expect(configuration.sessionTypes).toEqual([]);
  });

  it('keeps the label', async () => {
    const config = { ...CONFIG, label: 'main' };
    const access = await request(WIDEVINE, [config]);
    const configuration = access.getConfiguration();
    expect(configuration.label).toBe('main');
  });

  // The label is undefined when none was given.
  it.skip('defaults the label to an empty string', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    const configuration = access.getConfiguration();
    expect(configuration.label).toBe('');
  });

  // Returns the same object each time.
  it.skip('returns a new configuration object from each getConfiguration() call', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    const firstConfiguration = access.getConfiguration();
    const secondConfiguration = access.getConfiguration();
    expect(firstConfiguration).not.toBe(secondConfiguration);
    expect(firstConfiguration).toEqual(secondConfiguration);
  });

  it('creates new MediaKeys on each createMediaKeys() call', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    const firstMediaKeys = await access.createMediaKeys();
    const secondMediaKeys = await access.createMediaKeys();
    expect(firstMediaKeys).not.toBe(secondMediaKeys);
  });

  // The polyfill's class can be constructed.
  it.skip('cannot be constructed directly', () => {
    const MediaKeySystemAccessClass = window.MediaKeySystemAccess as unknown as new (...args: unknown[]) => unknown;
    expect(() => new MediaKeySystemAccessClass(WIDEVINE, [CONFIG])).toThrow(TypeError);
  });
});
