/**
 * End-to-end flows that use the polyfill the way a typical EME player does:
 * request access, attach MediaKeys, run the license exchange, look up key
 * statuses by the player's own key ID, and tear down.
 */

import { describe, expect, it } from 'vitest';
import { requestMediaKeySystemAccess } from '../src';
import { cdm, fireKeyError, fireKeyMessage, fireNeedKey, MEDIA_KEYERR_OUTPUT, MEDIA_KEYERR_UNKNOWN } from './fake-cdm';
import {
  CLEARKEY,
  createVideo,
  KID,
  nextEvent,
  nextTask,
  OTHER_KID,
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

interface Player {
  video: HTMLVideoElement;
  keySystem: string;
  mediaKeys: MediaKeys;
  licenseRequests: { messageType: MediaKeyMessageType; body: Uint8Array }[];
  errors: unknown[];
}

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
) {
  const video = createVideo();
  const access = await requestAccess(keySystem, playerConfigs(initDataTypes));
  const mediaKeys = await access.createMediaKeys();
  await video.setMediaKeys(mediaKeys);
  const player: Player = { video, keySystem, mediaKeys, licenseRequests: [], errors: [] };
  return player;
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
    const bytes = new Uint8Array(keyId as ArrayBuffer);
    table[bytes.toHex()] = status;
    if (player.keySystem === PLAYREADY && bytes.length === 16) {
      table[swapGuidByteOrder(bytes).toHex()] = status;
    }
  });
  return table;
}

/** A license server that answers each request with the bytes `respond` returns. */
function listenForLicenseRequests(
  player: Player,
  session: MediaKeySession,
  respond: (body: Uint8Array) => Uint8Array<ArrayBuffer>,
): void {
  session.addEventListener('message', (event) => {
    const { messageType, message } = event as MediaKeyMessageEvent;
    if (messageType !== 'license-request' && messageType !== 'license-renewal') {
      player.errors.push(new Error(`Unexpected message type ${messageType}`));
      return;
    }
    const body = new Uint8Array(message);
    player.licenseRequests.push({ messageType, body });
    session.update(respond(body)).catch((error) => {
      player.errors.push(error);
    });
  });
}

/**
 * Resolves once the key is usable. When the session reports no status for the
 * key, it falls back to has() / get() after the key status timeout.
 */
function waitForUsableKey(player: Player, session: MediaKeySession, keyId: Uint8Array<ArrayBuffer>): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const handleStatus = (status: MediaKeyStatus | undefined) => {
      if (status === 'usable') {
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (status && status !== 'status-pending') {
        reject(new Error(`Key status ${status}`));
      }
    };
    session.addEventListener('keystatuseschange', () => {
      const status = keyStatusTable(player, session)[keyId.toHex()];
      if (status) {
        handleStatus(status);
        return;
      }
      if (!timeout) {
        timeout = setTimeout(() => {
          handleStatus(session.keyStatuses.get(keyId));
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
  respond: (body: Uint8Array) => Uint8Array<ArrayBuffer> = () => new Uint8Array([9]),
): Promise<MediaKeySession> {
  const session = player.mediaKeys.createSession();
  listenForLicenseRequests(player, session, respond);
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
  return pssh(WIDEVINE_SYSTEM_ID, [], new Uint8Array([0x12, 0x10, ...keyId]), 0).buffer;
}

describe('end to end', () => {
  it('plays Widevine content whose key is signalled in the playlist', async () => {
    const player = await startPlayer(WIDEVINE);
    const session = await loadKey(player, KID, 'cenc', widevinePssh(KID));

    expect(player.video.mediaKeys).toBe(player.mediaKeys);
    expect(player.licenseRequests).toEqual([{ messageType: 'license-request', body: cdm.keyRequest }]);
    expect(keyStatusTable(player, session)).toEqual({ [KID.toHex()]: 'usable' });
    expect(session.keyStatuses.get(KID)).toBe('usable');
    expect(player.errors).toEqual([]);
  });

  it('plays Widevine content with the polyfilled function passed in explicitly', async () => {
    const player = await startPlayer(WIDEVINE, ['cenc'], requestMediaKeySystemAccess as unknown as RequestAccess);
    await loadKey(player, KID, 'cenc', widevinePssh(KID));
    expect(player.errors).toEqual([]);
  });

  it('plays PlayReady content, whose header stores the key ID as a little-endian GUID', async () => {
    const player = await startPlayer(PLAYREADY);
    const header = `<WRMHEADER version="4.0.0.0"><DATA><KID>${KID.toBase64()}</KID></DATA></WRMHEADER>`;
    const initData = pssh(PLAYREADY_SYSTEM_ID, [], playReadyObject(header), 0).buffer;
    const playerKeyId = swapGuidByteOrder(KID);

    const session = await loadKey(player, playerKeyId, 'cenc', initData);
    expect(keyStatusTable(player, session)[playerKeyId.toHex()]).toBe('usable');
    expect(player.errors).toEqual([]);
  });

  it('plays ClearKey content, starting the session from the encrypted event', async () => {
    const player = await startPlayer(CLEARKEY, ['cenc', 'keyids']);
    const encrypted = nextEvent<MediaEncryptedEvent>(player.video, 'encrypted');
    fireNeedKey(player.video, pssh(COMMON_SYSTEM_ID, [KID]));
    const { initDataType, initData } = await encrypted;
    expect(initData).toBeInstanceOf(ArrayBuffer);

    const answerWithKeys = (body: Uint8Array) => {
      const { kids } = JSON.parse(new TextDecoder().decode(body)) as { kids: string[] };
      const keys = kids.map((kid) => ({ kty: 'oct', k: 'AAECAwQFBgcICQoLDA0ODw', kid }));
      return new TextEncoder().encode(JSON.stringify({ keys }));
    };
    const session = await loadKey(player, KID, initDataType, initData as ArrayBuffer, answerWithKeys);

    const request = JSON.parse(new TextDecoder().decode(player.licenseRequests[0].body));
    expect(request).toEqual({ kids: [KID.toBase64({ alphabet: 'base64url', omitPadding: true })], type: 'temporary' });
    expect(keyStatusTable(player, session)).toEqual({ [KID.toHex()]: 'usable' });
    expect(player.errors).toEqual([]);
  });

  it('keeps the sessions for different keys apart', async () => {
    const player = await startPlayer(WIDEVINE);
    const [video, audio] = await Promise.all([
      loadKey(player, KID, 'cenc', widevinePssh(KID)),
      loadKey(player, OTHER_KID, 'cenc', widevinePssh(OTHER_KID)),
    ]);
    expect(keyStatusTable(player, video)).toEqual({ [KID.toHex()]: 'usable' });
    expect(keyStatusTable(player, audio)).toEqual({ [OTHER_KID.toHex()]: 'usable' });
    expect(video.keyStatuses.has(OTHER_KID)).toBe(false);
    expect(player.errors).toEqual([]);
  });

  it('uses a session that was created earlier but not used yet', async () => {
    const player = await startPlayer(WIDEVINE);
    const early = player.mediaKeys.createSession();
    await loadKey(player, OTHER_KID, 'cenc', widevinePssh(OTHER_KID));

    listenForLicenseRequests(player, early, () => new Uint8Array([9]));
    const usable = waitForUsableKey(player, early, KID);
    await early.generateRequest('cenc', widevinePssh(KID));
    await usable;
    expect(player.errors).toEqual([]);
  });

  it('renews the license when the CDM asks for it', async () => {
    const player = await startPlayer(WIDEVINE);
    const session = await loadKey(player, KID, 'cenc', widevinePssh(KID));
    fireKeyMessage(player.video, session.sessionId);
    await nextTask();

    expect(player.licenseRequests.map((request) => request.messageType)).toEqual([
      'license-request',
      'license-renewal',
    ]);
    expect(cdm.calls.filter((call) => call.method === 'addKey')).toHaveLength(2);
    expect(player.errors).toEqual([]);
  });

  it('reports output restrictions under the key ID the player looks up', async () => {
    const player = await startPlayer(WIDEVINE);
    const session = await loadKey(player, KID, 'cenc', widevinePssh(KID));
    fireKeyError(player.video, session.sessionId, { code: MEDIA_KEYERR_OUTPUT, systemCode: 0 });
    expect(keyStatusTable(player, session)[KID.toHex()]).toBe('output-restricted');
  });

  it('reports expired keys under the key ID the player looks up', async () => {
    const player = await startPlayer(WIDEVINE);
    const session = await loadKey(player, KID, 'cenc', widevinePssh(KID));
    fireKeyError(player.video, session.sessionId, { code: MEDIA_KEYERR_UNKNOWN, systemCode: 1 });
    expect(keyStatusTable(player, session)[KID.toHex()]).toBe('expired');
  });

  it('makes the key usable after the key status timeout when the init data has no key IDs', async () => {
    const player = await startPlayer(WIDEVINE);
    const started = Date.now();
    await loadKey(player, KID, 'cenc', pssh(WIDEVINE_SYSTEM_ID, [], new Uint8Array(0), 0).buffer);
    expect(Date.now() - started).toBeGreaterThanOrEqual(KEY_STATUS_TIMEOUT);
    expect(player.errors).toEqual([]);
  });

  it('tears down without errors', async () => {
    const player = await startPlayer(WIDEVINE);
    const session = await loadKey(player, KID, 'cenc', widevinePssh(KID));
    await destroy(player, [session]);

    expect(player.video.mediaKeys).toBeNull();
    await expect(session.closed).resolves.toBe('closed-by-application');
    expect(cdm.calls.at(-1)).toEqual({ method: 'cancelKeyRequest', args: [WIDEVINE, session.sessionId] });
    expect(player.errors).toEqual([]);
  });
});
