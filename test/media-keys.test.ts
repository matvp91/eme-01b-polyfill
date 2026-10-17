import { describe, expect, it } from 'vitest';
import { createMediaKeys, createVideo, KID, pssh, WIDEVINE_SYSTEM_ID } from './helpers';

describe('MediaKeys', () => {
  it('creates a new session without ID, expiration or key statuses', async () => {
    const mediaKeys = await createMediaKeys();
    const session = mediaKeys.createSession();
    expect(session.sessionId).toBe('');
    expect(session.expiration).toBeNaN();
    expect(session.keyStatuses.size).toBe(0);
  });

  it('creates a different session on each createSession() call', async () => {
    const mediaKeys = await createMediaKeys();
    const firstSession = mediaKeys.createSession();
    const secondSession = mediaKeys.createSession();
    expect(firstSession).not.toBe(secondSession);
  });

  it('throws a TypeError for an invalid session type', async () => {
    const mediaKeys = await createMediaKeys();
    expect(() => mediaKeys.createSession('not-a-type' as MediaKeySessionType)).toThrow(TypeError);
  });

  // Accepted, although the configuration only allows temporary sessions.
  it.skip('throws NotSupportedError for a session type the configuration does not support', async () => {
    const mediaKeys = await createMediaKeys();
    const notSupportedError = expect.objectContaining({ name: 'NotSupportedError' });
    expect(() => mediaKeys.createSession('persistent-license')).toThrow(notSupportedError);
  });

  // The session runs on a detached element nobody listens to, so this never settles.
  it.skip('lets sessions generate requests before the MediaKeys are attached', async () => {
    const mediaKeys = await createMediaKeys();
    const session = mediaKeys.createSession();
    const initData = pssh(WIDEVINE_SYSTEM_ID, [KID]);
    const result = session.generateRequest('cenc', initData);
    await expect(result).resolves.toBeUndefined();
  });

  // Sets `src` to about:blank, as v0.1b needs a source.
  it.skip('leaves the attached media element untouched', async () => {
    const video = createVideo();
    const mediaKeys = await createMediaKeys();
    await video.setMediaKeys(mediaKeys);
    mediaKeys.createSession();
    const source = video.getAttribute('src');
    expect(source).toBeNull();
  });

  it('resolves setServerCertificate() with false, as v0.1b has no server certificates', async () => {
    const mediaKeys = await createMediaKeys();
    const certificate = new Uint8Array([1]);
    const result = mediaKeys.setServerCertificate(certificate);
    await expect(result).resolves.toBe(false);
  });

  it('resolves setServerCertificate() with false for an empty certificate', async () => {
    const mediaKeys = await createMediaKeys();
    const certificate = new Uint8Array(0);
    const result = mediaKeys.setServerCertificate(certificate);
    await expect(result).resolves.toBe(false);
  });

  // Resolves with `usable` for any policy.
  it.skip('rejects getStatusForPolicy() with TypeError without a minHdcpVersion', async () => {
    const mediaKeys = await createMediaKeys();
    const result = mediaKeys.getStatusForPolicy({});
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });

  // Resolves with `usable`, as v0.1b can't check HDCP.
  it.skip('rejects getStatusForPolicy() with NotSupportedError when the status is unknown', async () => {
    const mediaKeys = await createMediaKeys();
    const result = mediaKeys.getStatusForPolicy({ minHdcpVersion: '2.2' });
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });
});
