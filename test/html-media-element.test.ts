import { describe, expect, it } from 'vitest';
import { fireNeedKey } from './fake-cdm';
import { attachedMediaKeys, createMediaKeys, createVideo, KID, nextEvent, pssh, WIDEVINE_SYSTEM_ID } from './helpers';

describe('HTMLMediaElement.mediaKeys and setMediaKeys()', () => {
  it('starts without MediaKeys', () => {
    expect(createVideo().mediaKeys).toBeNull();
  });

  it('attaches MediaKeys', async () => {
    const video = createVideo();
    const mediaKeys = await createMediaKeys();
    await expect(video.setMediaKeys(mediaKeys)).resolves.toBeUndefined();
    expect(video.mediaKeys).toBe(mediaKeys);
  });

  it('resolves when the MediaKeys are already attached', async () => {
    const { video, mediaKeys } = await attachedMediaKeys();
    await expect(video.setMediaKeys(mediaKeys)).resolves.toBeUndefined();
    expect(video.mediaKeys).toBe(mediaKeys);
  });

  it('detaches MediaKeys with null', async () => {
    const { video } = await attachedMediaKeys();
    await video.setMediaKeys(null);
    expect(video.mediaKeys).toBeNull();
  });

  it('replaces attached MediaKeys', async () => {
    const { video } = await attachedMediaKeys();
    const other = await createMediaKeys();
    await video.setMediaKeys(other);
    expect(video.mediaKeys).toBe(other);
  });

  // A plain, writable property.
  it.skip('has a read-only mediaKeys', async () => {
    const video = createVideo();
    try {
      (video as { mediaKeys: unknown }).mediaKeys = await createMediaKeys();
    } catch {
      // Throws in strict mode, which is fine.
    }
    expect(video.mediaKeys).toBeNull();
  });

  // Updated synchronously.
  it.skip('updates mediaKeys in a later task', async () => {
    const video = createVideo();
    const mediaKeys = await createMediaKeys();
    const promise = video.setMediaKeys(mediaKeys);
    expect(video.mediaKeys).toBeNull();
    await promise;
    expect(video.mediaKeys).toBe(mediaKeys);
  });

  // Both calls resolve.
  it.skip('rejects with InvalidStateError while another call is in progress', async () => {
    const video = createVideo();
    const first = video.setMediaKeys(await createMediaKeys());
    await expect(video.setMediaKeys(await createMediaKeys())).rejects.toMatchObject({ name: 'InvalidStateError' });
    await first;
  });

  // Resolves, and moves the MediaKeys to the second element.
  it.skip('rejects with QuotaExceededError for MediaKeys attached to another element', async () => {
    const { mediaKeys } = await attachedMediaKeys();
    await expect(createVideo().setMediaKeys(mediaKeys)).rejects.toMatchObject({ name: 'QuotaExceededError' });
  });

  // Throws synchronously instead.
  it.skip('rejects with TypeError for something that is not MediaKeys', async () => {
    const promise = Promise.resolve().then(() => createVideo().setMediaKeys({} as MediaKeys));
    await expect(promise).rejects.toBeInstanceOf(TypeError);
    expect(() => createVideo().setMediaKeys({} as MediaKeys)).not.toThrow();
  });
});

describe('HTMLMediaElement encrypted event', () => {
  it('fires for webkitneedkey, with the PSSH boxes as cenc init data', async () => {
    const { video } = await attachedMediaKeys();
    const initData = pssh(WIDEVINE_SYSTEM_ID, [KID]);
    const encrypted = nextEvent<MediaEncryptedEvent>(video, 'encrypted');
    fireNeedKey(video, initData);
    const event = await encrypted;
    expect(event.initDataType).toBe('cenc');
    expect(event.initData).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(event.initData as ArrayBuffer)).toEqual(initData);
  });

  it('does not bubble and is not cancelable', async () => {
    const { video } = await attachedMediaKeys();
    const encrypted = nextEvent<MediaEncryptedEvent>(video, 'encrypted');
    fireNeedKey(video, pssh(WIDEVINE_SYSTEM_ID, [KID]));
    const event = await encrypted;
    expect(event.bubbles).toBe(false);
    expect(event.cancelable).toBe(false);
  });

  // Only fires while MediaKeys are attached.
  it.skip('fires without MediaKeys attached', async () => {
    const video = createVideo();
    const encrypted = nextEvent<MediaEncryptedEvent>(video, 'encrypted');
    fireNeedKey(video, pssh(WIDEVINE_SYSTEM_ID, [KID]));
    await expect(encrypted).resolves.toBeDefined();
  });

  // Dropped instead.
  it.skip('fires with an empty initDataType and null initData when the init data is unknown', async () => {
    const { video } = await attachedMediaKeys();
    const encrypted = nextEvent<MediaEncryptedEvent>(video, 'encrypted');
    fireNeedKey(video, null);
    const event = await encrypted;
    expect(event.initDataType).toBe('');
    expect(event.initData).toBeNull();
  });

  // Not defined.
  it.skip('has onencrypted and onwaitingforkey event handlers', () => {
    const video = createVideo();
    expect('onencrypted' in video).toBe(true);
    expect('onwaitingforkey' in video).toBe(true);
  });
});

describe('EME interfaces', () => {
  // Only MediaKeys and MediaKeySystemAccess are exposed.
  it.skip('exposes MediaKeySession, MediaKeyStatusMap, MediaKeyMessageEvent and MediaEncryptedEvent', () => {
    for (const name of ['MediaKeySession', 'MediaKeyStatusMap', 'MediaKeyMessageEvent', 'MediaEncryptedEvent']) {
      expect(name in window).toBe(true);
    }
  });
});
