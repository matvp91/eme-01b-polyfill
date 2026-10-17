import { describe, expect, it } from 'vitest';
import { extractKeyIds } from '../src/extract-key-ids';
import {
  KID,
  keyIdsInitData,
  OTHER_KID,
  PLAYREADY_SYSTEM_ID,
  playReadyObject,
  pssh,
  WIDEVINE_SYSTEM_ID,
} from './helpers';

function hexes(kids: Uint8Array[]): string[] {
  return kids.map((kid) => kid.toHex());
}

describe('extractKeyIds()', () => {
  it('reads PSSH v1 key IDs of any system', () => {
    expect(hexes(extractKeyIds('cenc', pssh(PLAYREADY_SYSTEM_ID, [KID, OTHER_KID])))).toEqual([
      KID.toHex(),
      OTHER_KID.toHex(),
    ]);
  });

  it('reads the key_id fields of Widevine PSSH data', () => {
    // field 2 (key_id), wire type 2, length 16
    const data = new Uint8Array([0x12, 0x10, ...KID, 0x12, 0x10, ...OTHER_KID]);
    expect(hexes(extractKeyIds('cenc', pssh(WIDEVINE_SYSTEM_ID, [], data, 0)))).toEqual([
      KID.toHex(),
      OTHER_KID.toHex(),
    ]);
  });

  it('reads Widevine key_id fields written as hex text', () => {
    const data = new Uint8Array([0x12, 0x20, ...new TextEncoder().encode(KID.toHex())]);
    expect(hexes(extractKeyIds('cenc', pssh(WIDEVINE_SYSTEM_ID, [], data, 0)))).toEqual([KID.toHex()]);
  });

  it('reads key IDs from a PlayReady 4.0 header', () => {
    const xml = `<WRMHEADER version="4.0.0.0"><DATA><KID>${KID.toBase64()}</KID></DATA></WRMHEADER>`;
    expect(hexes(extractKeyIds('cenc', pssh(PLAYREADY_SYSTEM_ID, [], playReadyObject(xml), 0)))).toEqual([KID.toHex()]);
  });

  it('reads key IDs from a PlayReady 4.1+ header', () => {
    const xml = `<WRMHEADER version="4.1.0.0"><DATA><PROTECTINFO><KID ALGID="AESCTR" VALUE="${KID.toBase64()}"></KID></PROTECTINFO></DATA></WRMHEADER>`;
    expect(hexes(extractKeyIds('cenc', pssh(PLAYREADY_SYSTEM_ID, [], playReadyObject(xml), 0)))).toEqual([KID.toHex()]);
  });

  it('reads key IDs from several PSSH boxes, once each', () => {
    const boxes = new Uint8Array([...pssh(WIDEVINE_SYSTEM_ID, [KID]), ...pssh(PLAYREADY_SYSTEM_ID, [KID, OTHER_KID])]);
    expect(hexes(extractKeyIds('cenc', boxes))).toEqual([KID.toHex(), OTHER_KID.toHex()]);
  });

  it('reads keyids init data', () => {
    expect(hexes(extractKeyIds('keyids', keyIdsInitData([KID, OTHER_KID])))).toEqual([KID.toHex(), OTHER_KID.toHex()]);
  });

  it('reads webm init data as a key ID', () => {
    expect(hexes(extractKeyIds('webm', KID))).toEqual([KID.toHex()]);
  });

  it('returns no key IDs for malformed init data', () => {
    expect(extractKeyIds('cenc', new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(extractKeyIds('keyids', new TextEncoder().encode('not json'))).toEqual([]);
  });
});
