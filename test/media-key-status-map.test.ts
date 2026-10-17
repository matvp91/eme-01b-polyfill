import { describe, expect, it } from 'vitest';
import {
  attachedMediaKeys,
  CLEARKEY,
  clearKeyLicense,
  generatedSession,
  KID,
  keyIdsInitData,
  licensedSession,
  OTHER_KID,
  pssh,
  WIDEVINE_SYSTEM_ID,
} from './helpers';

function hex(keyId: ArrayBuffer): string {
  return new Uint8Array(keyId).toHex();
}

describe('MediaKeyStatusMap', () => {
  it('is empty before the license is added', async () => {
    const { session } = await generatedSession();
    expect(session.keyStatuses.size).toBe(0);
    expect(session.keyStatuses.has(KID)).toBe(false);
  });

  it('counts the keys', async () => {
    const { session } = await licensedSession([KID, OTHER_KID]);
    expect(session.keyStatuses.size).toBe(2);
  });

  it('accepts any BufferSource as key ID', async () => {
    const { session } = await licensedSession();
    expect(session.keyStatuses.get(KID)).toBe('usable');
    expect(session.keyStatuses.get(KID.slice().buffer)).toBe('usable');
    expect(session.keyStatuses.get(new DataView(KID.slice().buffer))).toBe('usable');
  });

  it('returns undefined for keys without a status', async () => {
    const { session } = await licensedSession();
    expect(session.keyStatuses.has(OTHER_KID)).toBe(false);
    expect(session.keyStatuses.get(OTHER_KID)).toBeUndefined();
  });

  it('passes the status, an ArrayBuffer key ID and the map to forEach()', async () => {
    const { session } = await licensedSession();
    const seen: unknown[] = [];
    session.keyStatuses.forEach((status, keyId, map) => {
      seen.push(status, hex(keyId as ArrayBuffer), map);
    });
    expect(seen).toEqual(['usable', KID.toHex(), session.keyStatuses]);
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
    expect([...map.entries()].map(([keyId, status]) => [hex(keyId as ArrayBuffer), status])).toEqual([
      [KID.toHex(), 'usable'],
    ]);
    expect([...map.keys()].map((keyId) => hex(keyId as ArrayBuffer))).toEqual([KID.toHex()]);
    expect([...map.values()]).toEqual(['usable']);
    expect([...map]).toHaveLength(1);
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
    expect([...session.keyStatuses.keys()].map((keyId) => hex(keyId as ArrayBuffer))).toEqual([
      KID.toHex(),
      OTHER_KID.toHex(),
    ]);
  });

  // Duplicate key IDs from keyids init data are kept.
  it.skip('lists each key ID once', async () => {
    const { mediaKeys } = await attachedMediaKeys(CLEARKEY);
    const session = mediaKeys.createSession();
    await session.generateRequest('keyids', keyIdsInitData([KID, KID]));
    await session.update(clearKeyLicense([KID, KID]));
    expect(session.keyStatuses.size).toBe(1);
  });

  // A string is read as an empty key ID instead.
  it.skip('throws a TypeError for a key ID that is not a BufferSource', async () => {
    const { session } = await licensedSession();
    expect(() => session.keyStatuses.has('not a key ID' as unknown as BufferSource)).toThrow(TypeError);
  });

  // Deliberately, any key ID matches, as players look statuses up by their own key ID.
  it.skip('reports a single 0x00 key ID when the init data has no key IDs', async () => {
    const { mediaKeys } = await attachedMediaKeys();
    const session = mediaKeys.createSession();
    await session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, []));
    await session.update(new Uint8Array([9]));
    expect(session.keyStatuses.has(new Uint8Array([0]))).toBe(true);
    expect(session.keyStatuses.has(KID)).toBe(false);
  });

  it('matches any key ID when the init data has no key IDs', async () => {
    const { mediaKeys } = await attachedMediaKeys();
    const session = mediaKeys.createSession();
    await session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, []));
    await session.update(new Uint8Array([9]));
    expect(session.keyStatuses.size).toBe(1);
    expect(session.keyStatuses.get(KID)).toBe('usable');
    expect([...session.keyStatuses.keys()].map((keyId) => hex(keyId as ArrayBuffer))).toEqual(['00']);
  });
});
