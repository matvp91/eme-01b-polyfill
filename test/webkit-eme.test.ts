import { describe, expect, it } from 'vitest';
import { callsTo, cdm, fireKeyError, MEDIA_KEYERR_OUTPUT, MEDIA_KEYERR_UNKNOWN } from './fake-cdm';
import {
  attachedMediaKeys,
  CLEARKEY,
  clearKeyLicense,
  generatedSession,
  KID,
  KID_HEX,
  keyIdsInitData,
  LICENSE,
  licensedSession,
  nextEvent,
  OTHER_KID,
  OTHER_KID_HEX,
  pssh,
  WIDEVINE,
  WIDEVINE_SYSTEM_ID,
} from './helpers';

const INIT_DATA = pssh(WIDEVINE_SYSTEM_ID, [KID]);

describe('translation to EME v0.1b', () => {
  it('generates the key request on the attached media element', async () => {
    const { mediaKeys } = await attachedMediaKeys();
    const session = mediaKeys.createSession();
    await session.generateRequest('cenc', INIT_DATA);
    expect(cdm.calls).toEqual([{ method: 'generateKeyRequest', args: [WIDEVINE, INIT_DATA] }]);
  });

  it('gives the v0.1b session ID to the session that generated a request, not to unused ones', async () => {
    const { mediaKeys } = await attachedMediaKeys();
    const unusedSession = mediaKeys.createSession();
    const session = mediaKeys.createSession();
    await session.generateRequest('cenc', INIT_DATA);
    expect(session.sessionId).not.toBe('');
    expect(unusedSession.sessionId).toBe('');
  });

  it('routes the v0.1b events of concurrent sessions by session ID', async () => {
    const { mediaKeys } = await attachedMediaKeys();
    const firstSession = mediaKeys.createSession();
    const secondSession = mediaKeys.createSession();
    const otherInitData = pssh(WIDEVINE_SYSTEM_ID, [OTHER_KID]);
    const firstRequest = firstSession.generateRequest('cenc', INIT_DATA);
    const secondRequest = secondSession.generateRequest('cenc', otherInitData);
    await Promise.all([firstRequest, secondRequest]);
    expect(firstSession.sessionId).not.toBe(secondSession.sessionId);

    await secondSession.update(LICENSE);
    const secondStatus = secondSession.keyStatuses.get(OTHER_KID);
    expect(secondStatus).toBe('usable');
    expect(firstSession.keyStatuses.size).toBe(0);
  });

  it('retries generateKeyRequest once after an InvalidStateError', async () => {
    cdm.throwOnGenerate = 'InvalidStateError';
    const { mediaKeys } = await attachedMediaKeys();
    const session = mediaKeys.createSession();
    await session.generateRequest('cenc', INIT_DATA);
    const generateCalls = callsTo('generateKeyRequest');
    expect(generateCalls).toHaveLength(1);
  });

  it('rejects generateRequest() when generateKeyRequest throws', async () => {
    cdm.throwOnGenerate = 'NotSupportedError';
    const { mediaKeys } = await attachedMediaKeys();
    const session = mediaKeys.createSession();
    const result = session.generateRequest('cenc', INIT_DATA);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('adds the license to the v0.1b session', async () => {
    const { session } = await generatedSession();
    await session.update(LICENSE);
    const lastCall = cdm.calls.at(-1);
    expect(lastCall).toEqual({ method: 'addKey', args: [WIDEVINE, LICENSE, null, session.sessionId] });
  });

  it('cancels the v0.1b key request on close()', async () => {
    const { session } = await generatedSession();
    await session.close();
    const lastCall = cdm.calls.at(-1);
    expect(lastCall).toEqual({ method: 'cancelKeyRequest', args: [WIDEVINE, session.sessionId] });
  });

  it('closes the session even when cancelKeyRequest throws', async () => {
    const { session } = await licensedSession();
    const result = session.close();
    await expect(result).resolves.toBeUndefined();
  });

  it('reports output-restricted for a MEDIA_KEYERR_OUTPUT key error', async () => {
    const { video, session } = await licensedSession();
    fireKeyError(video, session.sessionId, { code: MEDIA_KEYERR_OUTPUT, systemCode: 0 });
    const status = session.keyStatuses.get(KID);
    expect(status).toBe('output-restricted');
  });

  it('reports expired for a key error with system code 1', async () => {
    const { video, session } = await licensedSession();
    fireKeyError(video, session.sessionId, { code: MEDIA_KEYERR_UNKNOWN, systemCode: 1 });
    const status = session.keyStatuses.get(KID);
    expect(status).toBe('expired');
  });

  it('reports internal-error for other key errors', async () => {
    const { video, session } = await licensedSession();
    const nextChange = nextEvent(session, 'keystatuseschange');
    fireKeyError(video, session.sessionId, { code: MEDIA_KEYERR_UNKNOWN, systemCode: 0 });
    await nextChange;
    const status = session.keyStatuses.get(KID);
    expect(status).toBe('internal-error');
  });
});

describe('translation to EME v0.1b ClearKey', () => {
  it('uses the prefixed key system name', async () => {
    const { mediaKeys } = await attachedMediaKeys(CLEARKEY);
    const session = mediaKeys.createSession();
    const initData = keyIdsInitData([KID]);
    await session.generateRequest('keyids', initData);
    const [generateCall] = callsTo('generateKeyRequest');
    expect(generateCall.args[0]).toBe('webkit-org.w3.clearkey');
  });

  it('sends a JSON license request with the key IDs', async () => {
    const { mediaKeys } = await attachedMediaKeys(CLEARKEY);
    const session = mediaKeys.createSession();
    const initData = keyIdsInitData([KID, OTHER_KID]);
    const nextMessage = nextEvent<MediaKeyMessageEvent>(session, 'message');
    await session.generateRequest('keyids', initData);
    const message = await nextMessage;
    const requestJson = new TextDecoder().decode(message.message);
    const request = JSON.parse(requestJson);
    const encodedKids = [KID, OTHER_KID].map((kid) => kid.toBase64({ alphabet: 'base64url', omitPadding: true }));
    expect(request).toEqual({ kids: encodedKids, type: 'temporary' });
  });

  it('adds each key of the JSON Web Key Set separately', async () => {
    const { mediaKeys } = await attachedMediaKeys(CLEARKEY);
    const session = mediaKeys.createSession();
    const initData = keyIdsInitData([KID, OTHER_KID]);
    const license = clearKeyLicense([KID, OTHER_KID]);
    await session.generateRequest('keyids', initData);
    await session.update(license);

    const addKeyCalls = callsTo('addKey');
    const addedKeyIdHexes = addKeyCalls.map((call) => (call.args[2] as Uint8Array).toHex());
    const firstKey = addKeyCalls[0].args[1] as Uint8Array;
    const firstKeyHex = firstKey.toHex();
    const status = session.keyStatuses.get(KID);
    const otherStatus = session.keyStatuses.get(OTHER_KID);
    expect(addedKeyIdHexes).toEqual([KID_HEX, OTHER_KID_HEX]);
    expect(firstKeyHex).toBe('000102030405060708090a0b0c0d0e0f');
    expect(status).toBe('usable');
    expect(otherStatus).toBe('usable');
  });
});
