/**
 * End-to-end flows that use the polyfill the way a typical EME player does:
 * request access, attach MediaKeys, run the license exchange, look up key
 * statuses by the player's own key ID, and tear down.
 */

import { describe, expect, it } from 'vitest';
import { requestMediaKeySystemAccess } from '../src';
import {
  callsTo,
  cdm,
  fireKeyError,
  fireKeyMessage,
  fireNeedKey,
  MEDIA_KEYERR_OUTPUT,
  MEDIA_KEYERR_UNKNOWN,
} from './fake-cdm';
import {
  CLEARKEY,
  createVideo,
  KID,
  KID_HEX,
  LICENSE,
  nextEvent,
  nextTask,
  OTHER_KID,
  OTHER_KID_HEX,
  PLAYREADY_SYSTEM_ID,
  playReadyObject,
  pssh,
  WIDEVINE,
  WIDEVINE_SYSTEM_ID,
} from './helpers';

const PLAYREADY = 'com.microsoft.playready';

const COMMON_SYSTEM_ID = '1077efecc0b24d02ace33c1e52e2fb4b';

const KEY_STATUS_TIMEOUT = 1000;

// Players often capture this when they load, which is after the test setup installed the polyfill.
const capturedRequestAccess = navigator.requestMediaKeySystemAccess.bind(navigator);

type RequestAccess = (keySystem: string, configs: MediaKeySystemConfiguration[]) => Promise<MediaKeySystemAccess>;

type LicenseServer = (request: Uint8Array) => Uint8Array<ArrayBuffer>;

interface Player {
  video: HTMLVideoElement;
  keySystem: string;
  mediaKeys: MediaKeys;
  licenseRequests: { messageType: MediaKeyMessageType; body: Uint8Array }[];
  errors: unknown[];
}

const answerWithLicense: LicenseServer = () => LICENSE;

/** A ClearKey license server that returns a key for each requested key ID. */
const answerWithClearKeys: LicenseServer = (request) => {
  const requestJson = new TextDecoder().decode(request);
  const { kids } = JSON.parse(requestJson) as { kids: string[] };
  const keys = kids.map((kid) => ({ kty: 'oct', k: 'AAECAwQFBgcICQoLDA0ODw', kid }));
  const licenseJson = JSON.stringify({ keys });
  return new TextEncoder().encode(licenseJson);
};

/** A typical player configuration: unquoted codecs, empty robustness and no encryption scheme. */
function playerConfigs(initDataTypes: string[]): MediaKeySystemConfiguration[] {
  return [
    {
      initDataTypes,
      persistentState: 'optional',
      distinctiveIdentifier: 'optional',
      sessionTypes: ['temporary'],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs=mp4a.40.2', robustness: '', encryptionScheme: null }],
      videoCapabilities: [{ contentType: 'video/mp4; codecs=avc1.42e01e', robustness: '', encryptionScheme: null }],
    },
  ];
}

async function startPlayer(
  keySystem: string,
  initDataTypes = ['cenc'],
  requestAccess: RequestAccess = capturedRequestAccess,
): Promise<Player> {
  const video = createVideo();
  const configs = playerConfigs(initDataTypes);
  const access = await requestAccess(keySystem, configs);
  const mediaKeys = await access.createMediaKeys();
  await video.setMediaKeys(mediaKeys);
  return { video, keySystem, mediaKeys, licenseRequests: [], errors: [] };
}

/** Converts between the little-endian GUID in PlayReady headers and the big-endian key ID. */
function swapGuidByteOrder(keyId: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const swapped = keyId.slice();
  swapped.set([keyId[3], keyId[2], keyId[1], keyId[0], keyId[5], keyId[4], keyId[7], keyId[6]]);
  return swapped;
}

/** Reads the key statuses into a table by hex key ID; 16-byte PlayReady key IDs are stored in both byte orders. */
function keyStatusTable(player: Player, session: MediaKeySession): Record<string, MediaKeyStatus> {
  const table: Record<string, MediaKeyStatus> = {};
  session.keyStatuses.forEach((status, keyId) => {
    const keyIdBytes = new Uint8Array(keyId as ArrayBuffer);
    const keyIdHex = keyIdBytes.toHex();
    table[keyIdHex] = status;
    if (player.keySystem === PLAYREADY && keyIdBytes.length === 16) {
      const swappedKeyId = swapGuidByteOrder(keyIdBytes);
      const swappedKeyIdHex = swappedKeyId.toHex();
      table[swappedKeyIdHex] = status;
    }
  });
  return table;
}

/** Sends each license request to `licenseServer` and passes its answer to the session. */
function listenForLicenseRequests(player: Player, session: MediaKeySession, licenseServer: LicenseServer): void {
  session.addEventListener('message', (event) => {
    const { messageType, message } = event as MediaKeyMessageEvent;
    if (messageType !== 'license-request' && messageType !== 'license-renewal') {
      const error = new Error(`Unexpected message type ${messageType}`);
      player.errors.push(error);
      return;
    }
    const body = new Uint8Array(message);
    player.licenseRequests.push({ messageType, body });
    const license = licenseServer(body);
    const update = session.update(license);
    update.catch((error) => {
      player.errors.push(error);
    });
  });
}

/**
 * Resolves once the key is usable. When the session reports no status for the
 * key, it falls back to has() / get() after the key status timeout.
 */
function waitForUsableKey(player: Player, session: MediaKeySession, keyId: Uint8Array<ArrayBuffer>): Promise<void> {
  const keyIdHex = keyId.toHex();
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const handleStatus = (status: MediaKeyStatus | undefined) => {
      if (status === 'usable') {
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (status && status !== 'status-pending') {
        const error = new Error(`Key status ${status}`);
        reject(error);
      }
    };
    session.addEventListener('keystatuseschange', () => {
      const table = keyStatusTable(player, session);
      const status = table[keyIdHex];
      if (status) {
        handleStatus(status);
        return;
      }
      if (!timeout) {
        timeout = setTimeout(() => {
          const fallbackStatus = session.keyStatuses.get(keyId);
          handleStatus(fallbackStatus);
        }, KEY_STATUS_TIMEOUT);
      }
    });
  });
}

/** Starts a session for `keyId` and resolves once its key is usable. */
async function loadKey(
  player: Player,
  keyId: Uint8Array<ArrayBuffer>,
  initDataType: string,
  initData: ArrayBuffer,
  licenseServer = answerWithLicense,
): Promise<MediaKeySession> {
  const session = player.mediaKeys.createSession();
  listenForLicenseRequests(player, session, licenseServer);
  const usable = waitForUsableKey(player, session, keyId);
  await session.generateRequest(initDataType, initData);
  await usable;
  return session;
}

async function destroy(player: Player, sessions: MediaKeySession[]): Promise<void> {
  await player.video.setMediaKeys(null);
  for (const session of sessions) {
    await session.close();
    await session.closed;
  }
}

/** A Widevine PSSH box as found in an EXT-X-KEY tag, with the key ID in the Widevine data. */
function widevinePssh(keyId: Uint8Array<ArrayBuffer>): ArrayBuffer {
  const widevineData = new Uint8Array([0x12, 0x10, ...keyId]);
  const box = pssh(WIDEVINE_SYSTEM_ID, [], widevineData, 0);
  return box.buffer;
}

/** A PlayReady PSSH box whose header stores `keyId`, which is a little-endian GUID there. */
function playReadyPssh(keyId: Uint8Array<ArrayBuffer>): ArrayBuffer {
  const encodedKeyId = keyId.toBase64();
  const header = `<WRMHEADER version="4.0.0.0"><DATA><KID>${encodedKeyId}</KID></DATA></WRMHEADER>`;
  const headerObject = playReadyObject(header);
  const box = pssh(PLAYREADY_SYSTEM_ID, [], headerObject, 0);
  return box.buffer;
}

describe('end to end', () => {
  it('plays Widevine content whose key is signalled in the playlist', async () => {
    const player = await startPlayer(WIDEVINE);
    const initData = widevinePssh(KID);
    const session = await loadKey(player, KID, 'cenc', initData);
    const table = keyStatusTable(player, session);
    const status = session.keyStatuses.get(KID);

    expect(player.video.mediaKeys).toBe(player.mediaKeys);
    expect(player.licenseRequests).toEqual([{ messageType: 'license-request', body: cdm.keyRequest }]);
    expect(table).toEqual({ [KID_HEX]: 'usable' });
    expect(status).toBe('usable');
    expect(player.errors).toEqual([]);
  });

  it('plays Widevine content with the polyfilled function passed in explicitly', async () => {
    const requestAccess = requestMediaKeySystemAccess as unknown as RequestAccess;
    const player = await startPlayer(WIDEVINE, ['cenc'], requestAccess);
    const initData = widevinePssh(KID);
    await loadKey(player, KID, 'cenc', initData);
    expect(player.errors).toEqual([]);
  });

  it('plays PlayReady content, whose header stores the key ID as a little-endian GUID', async () => {
    const player = await startPlayer(PLAYREADY);
    const initData = playReadyPssh(KID);
    const playerKeyId = swapGuidByteOrder(KID);
    const playerKeyIdHex = playerKeyId.toHex();
    const session = await loadKey(player, playerKeyId, 'cenc', initData);
    const table = keyStatusTable(player, session);

    expect(table[playerKeyIdHex]).toBe('usable');
    expect(player.errors).toEqual([]);
  });

  it('plays ClearKey content, starting the session from the encrypted event', async () => {
    const player = await startPlayer(CLEARKEY, ['cenc', 'keyids']);
    const nextEncrypted = nextEvent<MediaEncryptedEvent>(player.video, 'encrypted');
    const mediaInitData = pssh(COMMON_SYSTEM_ID, [KID]);
    fireNeedKey(player.video, mediaInitData);
    const { initDataType, initData } = await nextEncrypted;
    expect(initData).toBeInstanceOf(ArrayBuffer);

    const session = await loadKey(player, KID, initDataType, initData as ArrayBuffer, answerWithClearKeys);
    const requestJson = new TextDecoder().decode(player.licenseRequests[0].body);
    const request = JSON.parse(requestJson);
    const encodedKid = KID.toBase64({ alphabet: 'base64url', omitPadding: true });
    const table = keyStatusTable(player, session);

    expect(request).toEqual({ kids: [encodedKid], type: 'temporary' });
    expect(table).toEqual({ [KID_HEX]: 'usable' });
    expect(player.errors).toEqual([]);
  });

  it('keeps the sessions for different keys apart', async () => {
    const player = await startPlayer(WIDEVINE);
    const videoInitData = widevinePssh(KID);
    const audioInitData = widevinePssh(OTHER_KID);
    const videoKeyLoad = loadKey(player, KID, 'cenc', videoInitData);
    const audioKeyLoad = loadKey(player, OTHER_KID, 'cenc', audioInitData);
    const [videoSession, audioSession] = await Promise.all([videoKeyLoad, audioKeyLoad]);
    const videoTable = keyStatusTable(player, videoSession);
    const audioTable = keyStatusTable(player, audioSession);
    const videoSessionHasAudioKey = videoSession.keyStatuses.has(OTHER_KID);

    expect(videoTable).toEqual({ [KID_HEX]: 'usable' });
    expect(audioTable).toEqual({ [OTHER_KID_HEX]: 'usable' });
    expect(videoSessionHasAudioKey).toBe(false);
    expect(player.errors).toEqual([]);
  });

  it('uses a session that was created earlier but not used yet', async () => {
    const player = await startPlayer(WIDEVINE);
    const earlySession = player.mediaKeys.createSession();
    const otherInitData = widevinePssh(OTHER_KID);
    await loadKey(player, OTHER_KID, 'cenc', otherInitData);

    listenForLicenseRequests(player, earlySession, answerWithLicense);
    const usable = waitForUsableKey(player, earlySession, KID);
    const initData = widevinePssh(KID);
    await earlySession.generateRequest('cenc', initData);
    await usable;
    expect(player.errors).toEqual([]);
  });

  it('renews the license when the CDM asks for it', async () => {
    const player = await startPlayer(WIDEVINE);
    const initData = widevinePssh(KID);
    const session = await loadKey(player, KID, 'cenc', initData);
    fireKeyMessage(player.video, session.sessionId);
    await nextTask();
    const messageTypes = player.licenseRequests.map((request) => request.messageType);
    const addKeyCalls = callsTo('addKey');

    expect(messageTypes).toEqual(['license-request', 'license-renewal']);
    expect(addKeyCalls).toHaveLength(2);
    expect(player.errors).toEqual([]);
  });

  it('reports output restrictions under the key ID the player looks up', async () => {
    const player = await startPlayer(WIDEVINE);
    const initData = widevinePssh(KID);
    const session = await loadKey(player, KID, 'cenc', initData);
    fireKeyError(player.video, session.sessionId, { code: MEDIA_KEYERR_OUTPUT, systemCode: 0 });
    const table = keyStatusTable(player, session);
    expect(table[KID_HEX]).toBe('output-restricted');
  });

  it('reports expired keys under the key ID the player looks up', async () => {
    const player = await startPlayer(WIDEVINE);
    const initData = widevinePssh(KID);
    const session = await loadKey(player, KID, 'cenc', initData);
    fireKeyError(player.video, session.sessionId, { code: MEDIA_KEYERR_UNKNOWN, systemCode: 1 });
    const table = keyStatusTable(player, session);
    expect(table[KID_HEX]).toBe('expired');
  });

  it('makes the key usable after the key status timeout when the init data has no key IDs', async () => {
    const player = await startPlayer(WIDEVINE);
    const emptyWidevineData = new Uint8Array(0);
    const box = pssh(WIDEVINE_SYSTEM_ID, [], emptyWidevineData, 0);
    const startedAt = Date.now();
    await loadKey(player, KID, 'cenc', box.buffer);
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeGreaterThanOrEqual(KEY_STATUS_TIMEOUT);
    expect(player.errors).toEqual([]);
  });

  it('tears down without errors', async () => {
    const player = await startPlayer(WIDEVINE);
    const initData = widevinePssh(KID);
    const session = await loadKey(player, KID, 'cenc', initData);
    await destroy(player, [session]);
    const lastCall = cdm.calls.at(-1);

    expect(player.video.mediaKeys).toBeNull();
    await expect(session.closed).resolves.toBe('closed-by-application');
    expect(lastCall).toEqual({ method: 'cancelKeyRequest', args: [WIDEVINE, session.sessionId] });
    expect(player.errors).toEqual([]);
  });
});
