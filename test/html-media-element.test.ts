import { describe, expect, it } from 'vitest';
import { fireNeedKey } from './fake-cdm';
import { attachedMediaKeys, createMediaKeys, createVideo, KID, nextEvent, pssh, WIDEVINE_SYSTEM_ID } from './helpers';

const INIT_DATA = pssh(WIDEVINE_SYSTEM_ID, [KID]);

describe('HTMLMediaElement.mediaKeys and setMediaKeys()', () => {
  it('starts without MediaKeys', () => {
    const video = createVideo();
    expect(video.mediaKeys).toBeNull();
  });

  it('attaches MediaKeys', async () => {
    const video = createVideo();
    const mediaKeys = await createMediaKeys();
    const result = video.setMediaKeys(mediaKeys);
    await expect(result).resolves.toBeUndefined();
    expect(video.mediaKeys).toBe(mediaKeys);
  });

  it('resolves when the MediaKeys are already attached', async () => {
    const { video, mediaKeys } = await attachedMediaKeys();
    const result = video.setMediaKeys(mediaKeys);
    await expect(result).resolves.toBeUndefined();
    expect(video.mediaKeys).toBe(mediaKeys);
  });

  it('detaches MediaKeys with null', async () => {
    const { video } = await attachedMediaKeys();
    await video.setMediaKeys(null);
    expect(video.mediaKeys).toBeNull();
  });

  it('replaces attached MediaKeys', async () => {
    const { video } = await attachedMediaKeys();
    const otherMediaKeys = await createMediaKeys();
    await video.setMediaKeys(otherMediaKeys);
    expect(video.mediaKeys).toBe(otherMediaKeys);
  });

  // A plain, writable property.
  it.skip('has a read-only mediaKeys', async () => {
    const video = createVideo();
    const mediaKeys = await createMediaKeys();
    try {
      (video as { mediaKeys: unknown }).mediaKeys = mediaKeys;
    } catch {
      // Throws in strict mode, which is fine.
    }
    expect(video.mediaKeys).toBeNull();
  });

  // Updated synchronously.
  it.skip('updates mediaKeys in a later task', async () => {
    const video = createVideo();
    const mediaKeys = await createMediaKeys();
    const result = video.setMediaKeys(mediaKeys);
    expect(video.mediaKeys).toBeNull();
    await result;
    expect(video.mediaKeys).toBe(mediaKeys);
  });

  // Both calls resolve.
  it.skip('rejects with InvalidStateError while another call is in progress', async () => {
    const video = createVideo();
    const firstMediaKeys = await createMediaKeys();
    const secondMediaKeys = await createMediaKeys();
    const firstResult = video.setMediaKeys(firstMediaKeys);
    const secondResult = video.setMediaKeys(secondMediaKeys);
    await expect(secondResult).rejects.toMatchObject({ name: 'InvalidStateError' });
    await firstResult;
  });

  // Resolves, and moves the MediaKeys to the second element.
  it.skip('rejects with QuotaExceededError for MediaKeys attached to another element', async () => {
    const { mediaKeys } = await attachedMediaKeys();
    const otherVideo = createVideo();
    const result = otherVideo.setMediaKeys(mediaKeys);
    await expect(result).rejects.toMatchObject({ name: 'QuotaExceededError' });
  });

  // Throws synchronously instead.
  it.skip('rejects with TypeError for something that is not MediaKeys', async () => {
    const video = createVideo();
    const notMediaKeys = {} as MediaKeys;
    let result: Promise<void> | undefined;
    expect(() => {
      result = video.setMediaKeys(notMediaKeys);
    }).not.toThrow();
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });
});

describe('HTMLMediaElement encrypted event', () => {
  it('fires for webkitneedkey, with the PSSH boxes as cenc init data', async () => {
    const { video } = await attachedMediaKeys();
    const nextEncrypted = nextEvent<MediaEncryptedEvent>(video, 'encrypted');
    fireNeedKey(video, INIT_DATA);
    const encrypted = await nextEncrypted;
    const initDataBytes = new Uint8Array(encrypted.initData as ArrayBuffer);
    expect(encrypted.initDataType).toBe('cenc');
    expect(encrypted.initData).toBeInstanceOf(ArrayBuffer);
    expect(initDataBytes).toEqual(INIT_DATA);
  });

  it('does not bubble and is not cancelable', async () => {
    const { video } = await attachedMediaKeys();
    const nextEncrypted = nextEvent<MediaEncryptedEvent>(video, 'encrypted');
    fireNeedKey(video, INIT_DATA);
    const encrypted = await nextEncrypted;
    expect(encrypted.bubbles).toBe(false);
    expect(encrypted.cancelable).toBe(false);
  });

  // Only fires while MediaKeys are attached.
  it.skip('fires without MediaKeys attached', async () => {
    const video = createVideo();
    const nextEncrypted = nextEvent<MediaEncryptedEvent>(video, 'encrypted');
    fireNeedKey(video, INIT_DATA);
    await expect(nextEncrypted).resolves.toBeDefined();
  });

  // Dropped instead.
  it.skip('fires with an empty initDataType and null initData when the init data is unknown', async () => {
    const { video } = await attachedMediaKeys();
    const nextEncrypted = nextEvent<MediaEncryptedEvent>(video, 'encrypted');
    fireNeedKey(video, null);
    const encrypted = await nextEncrypted;
    expect(encrypted.initDataType).toBe('');
    expect(encrypted.initData).toBeNull();
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
