import { describe, expect, it } from 'vitest';
import { AUDIO_CAPABILITY, CLEARKEY, CLEARKEY_CONFIG, CONFIG, VIDEO_CAPABILITY, WIDEVINE } from './helpers';

function request(keySystem: string, configs: MediaKeySystemConfiguration[]): Promise<MediaKeySystemAccess> {
  return navigator.requestMediaKeySystemAccess(keySystem, configs);
}

describe('navigator.requestMediaKeySystemAccess()', () => {
  it('resolves with access to a supported key system', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    expect(access.keySystem).toBe(WIDEVINE);
  });

  it('rejects with NotSupportedError for an unsupported key system', async () => {
    await expect(request('com.example.unsupported', [CONFIG])).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('returns a rejected promise instead of throwing', async () => {
    const promise = request('com.example.unsupported', [CONFIG]);
    expect(promise).toBeInstanceOf(Promise);
    await promise.catch(() => undefined);
  });

  // Resolves instead.
  it.skip('rejects with TypeError for an empty key system', async () => {
    await expect(request('', [CONFIG])).rejects.toBeInstanceOf(TypeError);
  });

  // Rejects with NotSupportedError instead.
  it.skip('rejects with TypeError for an empty list of configurations', async () => {
    await expect(request(WIDEVINE, [])).rejects.toBeInstanceOf(TypeError);
  });

  it('picks the first supported configuration', async () => {
    const unsupported = { ...CONFIG, label: 'first', videoCapabilities: [{ contentType: 'video/webm' }] };
    const access = await request(WIDEVINE, [unsupported, { ...CONFIG, label: 'second' }]);
    expect(access.getConfiguration().label).toBe('second');
  });

  it('rejects configurations that require persistent state', async () => {
    await expect(request(WIDEVINE, [{ ...CONFIG, persistentState: 'required' }])).rejects.toMatchObject({
      name: 'NotSupportedError',
    });
  });

  it('rejects configurations that ask for other session types than temporary', async () => {
    await expect(request(WIDEVINE, [{ ...CONFIG, sessionTypes: ['persistent-license'] }])).rejects.toMatchObject({
      name: 'NotSupportedError',
    });
  });

  it('drops the unsupported capabilities', async () => {
    const config = { ...CONFIG, videoCapabilities: [VIDEO_CAPABILITY, { contentType: 'video/webm' }] };
    const access = await request(WIDEVINE, [config]);
    expect(access.getConfiguration().videoCapabilities).toEqual([VIDEO_CAPABILITY]);
  });

  it('rejects a configuration whose capabilities are all unsupported', async () => {
    const config = { ...CONFIG, videoCapabilities: [{ contentType: 'video/webm' }] };
    await expect(request(WIDEVINE, [config])).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  // Falls back to checking whether video/mp4 is supported.
  it.skip('rejects a configuration without audio and video capabilities', async () => {
    await expect(request(WIDEVINE, [{ initDataTypes: ['cenc'] }])).rejects.toMatchObject({
      name: 'NotSupportedError',
    });
  });

  // Skips the capability instead.
  it.skip('rejects a configuration with an empty contentType', async () => {
    const config = { ...CONFIG, videoCapabilities: [VIDEO_CAPABILITY, { contentType: '' }] };
    await expect(request(WIDEVINE, [config])).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  // Accepted, as only canPlayType() is checked.
  it.skip('drops video capabilities with an audio content type', async () => {
    const config = { ...CONFIG, videoCapabilities: [VIDEO_CAPABILITY, AUDIO_CAPABILITY] };
    const access = await request(WIDEVINE, [config]);
    expect(access.getConfiguration().videoCapabilities).toEqual([VIDEO_CAPABILITY]);
  });

  // Robustness is ignored.
  it.skip('drops capabilities with an unsupported robustness', async () => {
    const config = { ...CONFIG, videoCapabilities: [{ ...VIDEO_CAPABILITY, robustness: 'NOT_A_ROBUSTNESS' }] };
    await expect(request(WIDEVINE, [config])).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  // The encryption scheme is ignored.
  it.skip('drops capabilities with an unsupported encryption scheme', async () => {
    const config = { ...CONFIG, videoCapabilities: [{ ...VIDEO_CAPABILITY, encryptionScheme: 'not-a-scheme' }] };
    await expect(request(WIDEVINE, [config])).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  // The requested init data types are copied as is.
  it.skip('keeps only the supported init data types', async () => {
    const access = await request(WIDEVINE, [{ ...CONFIG, initDataTypes: ['cenc', 'not-a-type'] }]);
    expect(access.getConfiguration().initDataTypes).toEqual(['cenc']);
  });

  // Resolves instead.
  it.skip('rejects a configuration without supported init data types', async () => {
    await expect(request(WIDEVINE, [{ ...CONFIG, initDataTypes: ['not-a-type'] }])).rejects.toMatchObject({
      name: 'NotSupportedError',
    });
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
    expect(access.getConfiguration().sessionTypes).toEqual(['temporary']);
  });

  // Reports `optional`, as v0.1b can't tell.
  it.skip('reports distinctiveIdentifier and persistentState as required or not-allowed', async () => {
    const { distinctiveIdentifier, persistentState } = (await request(WIDEVINE, [CONFIG])).getConfiguration();
    expect(distinctiveIdentifier).not.toBe('optional');
    expect(persistentState).not.toBe('optional');
  });

  // Always reports ['temporary'].
  it.skip('reports an empty list of session types when that was requested', async () => {
    const access = await request(WIDEVINE, [{ ...CONFIG, sessionTypes: [] }]);
    expect(access.getConfiguration().sessionTypes).toEqual([]);
  });

  it('keeps the label', async () => {
    const access = await request(WIDEVINE, [{ ...CONFIG, label: 'main' }]);
    expect(access.getConfiguration().label).toBe('main');
  });

  // The label is undefined when none was given.
  it.skip('defaults the label to an empty string', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    expect(access.getConfiguration().label).toBe('');
  });

  // Returns the same object each time.
  it.skip('returns a new configuration object from each getConfiguration() call', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    expect(access.getConfiguration()).not.toBe(access.getConfiguration());
    expect(access.getConfiguration()).toEqual(access.getConfiguration());
  });

  it('creates new MediaKeys on each createMediaKeys() call', async () => {
    const access = await request(WIDEVINE, [CONFIG]);
    expect(await access.createMediaKeys()).not.toBe(await access.createMediaKeys());
  });

  // The polyfill's class can be constructed.
  it.skip('cannot be constructed directly', () => {
    const MediaKeySystemAccessClass = window.MediaKeySystemAccess as unknown as new (...args: unknown[]) => unknown;
    expect(() => new MediaKeySystemAccessClass(WIDEVINE, [CONFIG])).toThrow(TypeError);
  });
});
