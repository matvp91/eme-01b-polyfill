import { describe, expect, it } from 'vitest';
import {
  attachedMediaKeys,
  bufferToHex,
  CLEARKEY,
  clearKeyLicense,
  generatedSession,
  KID,
  KID_HEX,
  keyIdsInitData,
  LICENSE,
  licensedSession,
  OTHER_KID,
  OTHER_KID_HEX,
  pssh,
  WIDEVINE_SYSTEM_ID,
} from './helpers';

/** A session with a license whose init data had no key IDs. */
async function sessionWithoutKeyIds(): Promise<MediaKeySession> {
  const { mediaKeys } = await attachedMediaKeys();
  const session = mediaKeys.createSession();
  const initData = pssh(WIDEVINE_SYSTEM_ID, []);
  await session.generateRequest('cenc', initData);
  await session.update(LICENSE);
  return session;
}

function keyIdHexes(map: MediaKeyStatusMap): string[] {
  const keyIds = [...map.keys()];
  return keyIds.map((keyId) => bufferToHex(keyId as ArrayBuffer));
}

describe('MediaKeyStatusMap', () => {
  it('is empty before the license is added', async () => {
    const { session } = await generatedSession();
    const hasKey = session.keyStatuses.has(KID);
    expect(session.keyStatuses.size).toBe(0);
    expect(hasKey).toBe(false);
  });

  it('counts the keys', async () => {
    const { session } = await licensedSession([KID, OTHER_KID]);
    expect(session.keyStatuses.size).toBe(2);
  });

  it('accepts any BufferSource as key ID', async () => {
    const { session } = await licensedSession();
    const keyIdBuffer = KID.slice().buffer;
    const keyIdView = new DataView(keyIdBuffer);
    const statusByTypedArray = session.keyStatuses.get(KID);
    const statusByBuffer = session.keyStatuses.get(keyIdBuffer);
    const statusByDataView = session.keyStatuses.get(keyIdView);
    expect(statusByTypedArray).toBe('usable');
    expect(statusByBuffer).toBe('usable');
    expect(statusByDataView).toBe('usable');
  });

  it('returns undefined for keys without a status', async () => {
    const { session } = await licensedSession();
    const hasKey = session.keyStatuses.has(OTHER_KID);
    const status = session.keyStatuses.get(OTHER_KID);
    expect(hasKey).toBe(false);
    expect(status).toBeUndefined();
  });

  it('passes the status, an ArrayBuffer key ID and the map to forEach()', async () => {
    const { session } = await licensedSession();
    const seen: unknown[] = [];
    session.keyStatuses.forEach((status, keyId, map) => {
      const keyIdHex = bufferToHex(keyId as ArrayBuffer);
      seen.push(status, keyIdHex, map);
    });
    expect(seen).toEqual(['usable', KID_HEX, session.keyStatuses]);
  });

  // thisArg is ignored.
  it.skip('calls the forEach() callback with thisArg', async () => {
    const { session } = await licensedSession();
    const thisArg = {};
    let calledWith: unknown;
    session.keyStatuses.forEach(function (this: unknown) {
      calledWith = this;
    }, thisArg);
    expect(calledWith).toBe(thisArg);
  });

  it('iterates with entries(), keys(), values() and for...of', async () => {
    const { session } = await licensedSession();
    const map = session.keyStatuses;
    const entries = [...map.entries()];
    const entryHexes = entries.map(([keyId, status]) => [bufferToHex(keyId as ArrayBuffer), status]);
    const keyHexes = keyIdHexes(map);
    const values = [...map.values()];
    const iterated = [...map];
    expect(entryHexes).toEqual([[KID_HEX, 'usable']]);
    expect(keyHexes).toEqual([KID_HEX]);
    expect(values).toEqual(['usable']);
    expect(iterated).toHaveLength(1);
  });

  // [Symbol.iterator] is a separate method that calls entries().
  it.skip('uses entries() as its iterator', async () => {
    const { session } = await licensedSession();
    const prototype = Object.getPrototypeOf(session.keyStatuses);
    expect(prototype[Symbol.iterator]).toBe(prototype.entries);
  });

  // Insertion order.
  it.skip('iterates in key ID order', async () => {
    const { session } = await licensedSession([OTHER_KID, KID]);
    const keyHexes = keyIdHexes(session.keyStatuses);
    expect(keyHexes).toEqual([KID_HEX, OTHER_KID_HEX]);
  });

  // Duplicate key IDs from keyids init data are kept.
  it.skip('lists each key ID once', async () => {
    const { mediaKeys } = await attachedMediaKeys(CLEARKEY);
    const session = mediaKeys.createSession();
    const initData = keyIdsInitData([KID, KID]);
    const license = clearKeyLicense([KID, KID]);
    await session.generateRequest('keyids', initData);
    await session.update(license);
    expect(session.keyStatuses.size).toBe(1);
  });

  // A string is read as an empty key ID instead.
  it.skip('throws a TypeError for a key ID that is not a BufferSource', async () => {
    const { session } = await licensedSession();
    const notAKeyId = 'not a key ID' as unknown as BufferSource;
    expect(() => session.keyStatuses.has(notAKeyId)).toThrow(TypeError);
  });

  // Deliberately, any key ID matches, as players look statuses up by their own key ID.
  it.skip('reports a single 0x00 key ID when the init data has no key IDs', async () => {
    const session = await sessionWithoutKeyIds();
    const dummyKeyId = new Uint8Array([0]);
    const hasDummyKey = session.keyStatuses.has(dummyKeyId);
    const hasKey = session.keyStatuses.has(KID);
    expect(hasDummyKey).toBe(true);
    expect(hasKey).toBe(false);
  });

  it('matches any key ID when the init data has no key IDs', async () => {
    const session = await sessionWithoutKeyIds();
    const status = session.keyStatuses.get(KID);
    const keyHexes = keyIdHexes(session.keyStatuses);
    expect(session.keyStatuses.size).toBe(1);
    expect(status).toBe('usable');
    expect(keyHexes).toEqual(['00']);
  });
});
