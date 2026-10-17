import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MediaKeySession } from '../src';
import { install, isInstalled } from '../src';
import { extractKeyIds } from '../src/extract-key-ids';
import { calls, cdm, installFakeCdm, pssh } from './fake-cdm';

const WIDEVINE = 'edef8ba979d64acea3c827dcd51d21ed';
const KID = Uint8Array.fromHex('0123456789abcdef0123456789abcdef');
const OTHER_KID = Uint8Array.fromHex('ffeeddccbbaa99887766554433221100');

const widevineConfig: MediaKeySystemConfiguration = {
  initDataTypes: ['cenc'],
  videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
  audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
};

function nextEvent<T extends Event>(target: Pick<EventTarget, 'addEventListener'>, type: string): Promise<T> {
  return new Promise((resolve) => target.addEventListener(type, (event) => resolve(event as T)));
}

async function setup(keySystem = 'com.widevine.alpha') {
  const video = document.createElement('video');
  document.body.appendChild(video);
  const access = await navigator.requestMediaKeySystemAccess(keySystem, [widevineConfig]);
  const mediaKeys = await access.createMediaKeys();
  await video.setMediaKeys(mediaKeys);
  return { video, mediaKeys };
}

beforeAll(() => {
  installFakeCdm();
  expect(install()).toBe(true);
  expect(isInstalled()).toBe(true);
});

beforeEach(() => {
  calls.length = 0;
  cdm.failAddKey = false;
});

describe('requestMediaKeySystemAccess', () => {
  it('resolves for a supported key system', async () => {
    const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [widevineConfig]);
    expect(access.keySystem).toBe('com.widevine.alpha');
    expect(access.getConfiguration().sessionTypes).toEqual(['temporary']);
    expect(access.getConfiguration().videoCapabilities).toHaveLength(1);
  });

  it('rejects with NotSupportedError for an unsupported key system', async () => {
    await expect(navigator.requestMediaKeySystemAccess('com.microsoft.playready', [widevineConfig])).rejects.toThrow(
      expect.objectContaining({ name: 'NotSupportedError' }),
    );
  });

  it('rejects configs requiring persistence', async () => {
    await expect(
      navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ ...widevineConfig, persistentState: 'required' }]),
    ).rejects.toThrow();
  });
});

describe('MediaKeySession', () => {
  it('runs a license exchange with spec message types and per-key-id statuses', async () => {
    const { mediaKeys } = await setup();
    const session = mediaKeys.createSession() as unknown as MediaKeySession;

    const message = nextEvent<MediaKeyMessageEvent>(session, 'message');
    const handled: MediaKeyMessageEvent[] = [];
    session.onmessage = (event) => {
      handled.push(event);
    };
    await session.generateRequest('cenc', pssh(WIDEVINE, [KID]));
    const event = await message;
    expect(handled).toEqual([event]);
    expect(event.messageType).toBe('license-request');
    expect(event.message).toBeInstanceOf(ArrayBuffer);
    expect(session.sessionId).toBe(String(cdm.nextSessionId - 1));

    const statusChange = nextEvent(session, 'keystatuseschange');
    await session.update(new Uint8Array([9]));
    await statusChange;
    expect(session.keyStatuses.get(KID)).toBe('usable');
    expect(session.keyStatuses.has(OTHER_KID)).toBe(false);

    const seen: string[] = [];
    session.keyStatuses.forEach((status, keyId) => {
      seen.push(`${new Uint8Array(keyId).toHex()}=${status}`);
    });
    expect(seen).toEqual([`${KID.toHex()}=usable`]);
    expect([...session.keyStatuses.entries()].map(([id, status]) => `${new Uint8Array(id).toHex()}=${status}`)).toEqual(
      seen,
    );
    expect([...session.keyStatuses.values()]).toEqual(['usable']);
    expect([...session.keyStatuses].length).toBe(1);
  });

  it('assigns session IDs only to sessions that generated a request', async () => {
    const { mediaKeys } = await setup();
    mediaKeys.createSession(); // created but never used
    const session = mediaKeys.createSession() as unknown as MediaKeySession;
    await session.generateRequest('cenc', pssh(WIDEVINE, [KID]));
    expect(session.sessionId).not.toBe('');
  });

  it('falls back to a wildcard status when key IDs are unknown', async () => {
    const { mediaKeys } = await setup();
    const session = mediaKeys.createSession() as unknown as MediaKeySession;
    await session.generateRequest('cenc', new Uint8Array([1, 2, 3]));
    await session.update(new Uint8Array([9]));
    expect(session.keyStatuses.get(KID)).toBe('usable');
    expect(session.keyStatuses.size).toBe(1);
  });

  it('rejects update() on a v0.1b keyerror', async () => {
    cdm.failAddKey = true;
    const { mediaKeys } = await setup();
    const session = mediaKeys.createSession() as unknown as MediaKeySession;
    await session.generateRequest('cenc', pssh(WIDEVINE, [KID]));
    await expect(session.update(new Uint8Array([9]))).rejects.toThrow(/key error/);
  });

  it('translates ClearKey to v0.1b: JSON license request, one addKey per JWK', async () => {
    const { mediaKeys } = await setup('org.w3.clearkey');
    const session = mediaKeys.createSession() as unknown as MediaKeySession;
    const kids = ['ASNFZ4mrze8BI0VniavN7w', '_-7dzLuqmYh3ZlVEMyIRAA'];
    const message = nextEvent<MediaKeyMessageEvent>(session, 'message');
    await session.generateRequest('keyids', new TextEncoder().encode(JSON.stringify({ kids })));
    const request = JSON.parse(new TextDecoder().decode((await message).message));
    expect(request).toEqual({ kids, type: 'temporary' });

    const jwks = {
      keys: [
        { kty: 'oct', k: 'AAECAwQFBgcICQoLDA0ODw', kid: kids[0] },
        { kty: 'oct', k: 'AAECAwQFBgcICQoLDA0ODw', kid: kids[1] },
      ],
    };
    await session.update(new TextEncoder().encode(JSON.stringify(jwks)));

    const addKeys = calls.filter((c) => c.method === 'addKey');
    expect(addKeys).toHaveLength(2);
    expect(addKeys[0].args[0]).toBe('webkit-org.w3.clearkey');
    expect((addKeys[0].args[1] as Uint8Array).toHex()).toBe('000102030405060708090a0b0c0d0e0f');
    expect((addKeys[0].args[2] as Uint8Array).toHex()).toBe(KID.toHex());
    expect(session.keyStatuses.get(KID)).toBe('usable');
    expect(session.keyStatuses.get(OTHER_KID)).toBe('usable');
  });

  it('close() cancels the key request and resolves `closed`', async () => {
    const { mediaKeys } = await setup();
    const session = mediaKeys.createSession() as unknown as MediaKeySession;
    await session.generateRequest('cenc', pssh(WIDEVINE, [KID]));
    await session.close();
    await expect(session.closed).resolves.toBe('closed-by-application');
    expect(calls.some((c) => c.method === 'cancelKeyRequest')).toBe(true);
  });

  it('close() on an uninitialized session still resolves `closed`', async () => {
    const { mediaKeys } = await setup();
    const session = mediaKeys.createSession() as unknown as MediaKeySession;
    await session.close();
    await expect(session.closed).resolves.toBe('closed-by-application');
  });
});

describe('encrypted event', () => {
  it('re-dispatches webkitneedkey as encrypted', async () => {
    const { video } = await setup();
    const encrypted = nextEvent<MediaEncryptedEvent>(video, 'encrypted');
    const needkey = Object.assign(new Event('webkitneedkey'), { initData: pssh(WIDEVINE, [KID]) });
    video.dispatchEvent(needkey);
    const event = await encrypted;
    expect(event.initDataType).toBe('cenc');
    expect(event.initData).toBeInstanceOf(ArrayBuffer);
  });

  it('stops listening once the MediaKeys are detached', async () => {
    const { video } = await setup();
    await video.setMediaKeys(null);
    let encrypted = false;
    video.addEventListener('encrypted', () => {
      encrypted = true;
    });
    video.dispatchEvent(Object.assign(new Event('webkitneedkey'), { initData: pssh(WIDEVINE, [KID]) }));
    expect(encrypted).toBe(false);
  });
});

describe('extractKeyIds', () => {
  it('reads Widevine PSSH v0 protobuf key_id fields', () => {
    // field 2 (key_id), wire type 2, length 16
    const data = new Uint8Array([0x12, 0x10, ...KID, 0x12, 0x10, ...OTHER_KID]);
    const kids = extractKeyIds('cenc', pssh(WIDEVINE, [], data, 0));
    expect(kids.map((kid) => kid.toHex())).toEqual([KID.toHex(), OTHER_KID.toHex()]);
  });

  it('reads PSSH v1 KIDs from any system', () => {
    const kids = extractKeyIds('cenc', pssh('9a04f07998404286ab92e65be0885f95', [KID]));
    expect(kids.map((kid) => kid.toHex())).toEqual([KID.toHex()]);
  });

  it('reads Widevine key_id fields written as hex text', () => {
    const data = new Uint8Array([0x12, 0x20, ...new TextEncoder().encode(KID.toHex())]);
    expect(extractKeyIds('cenc', pssh(WIDEVINE, [], data, 0)).map((kid) => kid.toHex())).toEqual([KID.toHex()]);
  });

  it('reads KIDs from a PlayReady header', () => {
    const kidB64 = btoa(String.fromCharCode(...KID));
    const xml = `<WRMHEADER version="4.1.0.0"><DATA><PROTECTINFO><KID ALGID="AESCTR" VALUE="${kidB64}"></KID></PROTECTINFO></DATA></WRMHEADER>`;
    const record = new Uint8Array(xml.length * 2);
    for (let i = 0; i < xml.length; i++) {
      record[i * 2] = xml.charCodeAt(i);
    }
    const pro = new Uint8Array(10 + record.length);
    const view = new DataView(pro.buffer);
    view.setUint32(0, pro.length, true);
    view.setUint16(4, 1, true);
    view.setUint16(6, 1, true);
    view.setUint16(8, record.length, true);
    pro.set(record, 10);
    const kids = extractKeyIds('cenc', pssh('9a04f07998404286ab92e65be0885f95', [], pro, 0));
    expect(kids.map((kid) => kid.toHex())).toEqual([KID.toHex()]);
  });

  it('returns nothing for garbage', () => {
    expect(extractKeyIds('cenc', new Uint8Array([1, 2, 3]))).toEqual([]);
  });
});
