import { describe, expect, it } from 'vitest';
import { cdm, fireKeyError, MEDIA_KEYERR_OUTPUT, MEDIA_KEYERR_UNKNOWN } from './fake-cdm';
import {
  attachedMediaKeys,
  CLEARKEY,
  clearKeyLicense,
  generatedSession,
  KID,
  keyIdsInitData,
  licensedSession,
  nextEvent,
  OTHER_KID,
  pssh,
  WIDEVINE,
  WIDEVINE_SYSTEM_ID,
} from './helpers';

describe('translation to EME v0.1b', () => {
  it('generates the key request on the attached media element', async () => {
    const initData = pssh(WIDEVINE_SYSTEM_ID, [KID]);
    const { mediaKeys } = await attachedMediaKeys();
    await mediaKeys.createSession().generateRequest('cenc', initData);
    expect(cdm.calls).toEqual([{ method: 'generateKeyRequest', args: [WIDEVINE, initData] }]);
  });

  it('gives the v0.1b session ID to the session that generated a request, not to unused ones', async () => {
    const { mediaKeys } = await attachedMediaKeys();
    const unused = mediaKeys.createSession();
    const session = mediaKeys.createSession();
    await session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]));
    expect(session.sessionId).not.toBe('');
    expect(unused.sessionId).toBe('');
  });

  it('routes the v0.1b events of concurrent sessions by session ID', async () => {
    const { mediaKeys } = await attachedMediaKeys();
    const first = mediaKeys.createSession();
    const second = mediaKeys.createSession();
    await Promise.all([
      first.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID])),
      second.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [OTHER_KID])),
    ]);
    expect(first.sessionId).not.toBe(second.sessionId);
    await second.update(new Uint8Array([9]));
    expect(second.keyStatuses.get(OTHER_KID)).toBe('usable');
    expect(first.keyStatuses.size).toBe(0);
  });

  it('retries generateKeyRequest once after an InvalidStateError', async () => {
    cdm.throwOnGenerate = 'InvalidStateError';
    const { mediaKeys } = await attachedMediaKeys();
    await mediaKeys.createSession().generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]));
    expect(cdm.calls.filter((call) => call.method === 'generateKeyRequest')).toHaveLength(1);
  });

  it('rejects generateRequest() when generateKeyRequest throws', async () => {
    cdm.throwOnGenerate = 'NotSupportedError';
    const { mediaKeys } = await attachedMediaKeys();
    await expect(
      mediaKeys.createSession().generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID])),
    ).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('adds the license to the v0.1b session', async () => {
    const { session } = await generatedSession();
    const license = new Uint8Array([9]);
    await session.update(license);
    expect(cdm.calls.at(-1)).toEqual({ method: 'addKey', args: [WIDEVINE, license, null, session.sessionId] });
  });

  it('cancels the v0.1b key request on close()', async () => {
    const { session } = await generatedSession();
    await session.close();
    expect(cdm.calls.at(-1)).toEqual({ method: 'cancelKeyRequest', args: [WIDEVINE, session.sessionId] });
  });

  it('closes the session even when cancelKeyRequest throws', async () => {
    const { session } = await licensedSession();
    await expect(session.close()).resolves.toBeUndefined();
  });

  it('reports output-restricted for a MEDIA_KEYERR_OUTPUT key error', async () => {
    const { video, session } = await licensedSession();
    fireKeyError(video, session.sessionId, { code: MEDIA_KEYERR_OUTPUT, systemCode: 0 });
    expect(session.keyStatuses.get(KID)).toBe('output-restricted');
  });

  it('reports expired for a key error with system code 1', async () => {
    const { video, session } = await licensedSession();
    fireKeyError(video, session.sessionId, { code: MEDIA_KEYERR_UNKNOWN, systemCode: 1 });
    expect(session.keyStatuses.get(KID)).toBe('expired');
  });

  it('reports internal-error for other key errors', async () => {
    const { video, session } = await licensedSession();
    const change = nextEvent(session, 'keystatuseschange');
    fireKeyError(video, session.sessionId, { code: MEDIA_KEYERR_UNKNOWN, systemCode: 0 });
    await change;
    expect(session.keyStatuses.get(KID)).toBe('internal-error');
  });
});

describe('translation to EME v0.1b ClearKey', () => {
  it('uses the prefixed key system name', async () => {
    const { mediaKeys } = await attachedMediaKeys(CLEARKEY);
    await mediaKeys.createSession().generateRequest('keyids', keyIdsInitData([KID]));
    expect(cdm.calls[0].args[0]).toBe('webkit-org.w3.clearkey');
  });

  it('sends a JSON license request with the key IDs', async () => {
    const { mediaKeys } = await attachedMediaKeys(CLEARKEY);
    const session = mediaKeys.createSession();
    const message = nextEvent<MediaKeyMessageEvent>(session, 'message');
    await session.generateRequest('keyids', keyIdsInitData([KID, OTHER_KID]));
    const request = JSON.parse(new TextDecoder().decode((await message).message));
    expect(request).toEqual({
      kids: [KID, OTHER_KID].map((kid) => kid.toBase64({ alphabet: 'base64url', omitPadding: true })),
      type: 'temporary',
    });
  });

  it('adds each key of the JSON Web Key Set separately', async () => {
    const { mediaKeys } = await attachedMediaKeys(CLEARKEY);
    const session = mediaKeys.createSession();
    await session.generateRequest('keyids', keyIdsInitData([KID, OTHER_KID]));
    await session.update(clearKeyLicense([KID, OTHER_KID]));

    const addKeys = cdm.calls.filter((call) => call.method === 'addKey');
    expect(addKeys.map((call) => (call.args[2] as Uint8Array).toHex())).toEqual([KID.toHex(), OTHER_KID.toHex()]);
    expect((addKeys[0].args[1] as Uint8Array).toHex()).toBe('000102030405060708090a0b0c0d0e0f');
    expect(session.keyStatuses.get(KID)).toBe('usable');
    expect(session.keyStatuses.get(OTHER_KID)).toBe('usable');
  });
});
