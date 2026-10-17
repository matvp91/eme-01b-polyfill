import { describe, expect, it } from 'vitest';
import { extractKeyIds } from '../src/extract-key-ids';
import {
  KID,
  KID_HEX,
  keyIdsInitData,
  OTHER_KID,
  OTHER_KID_HEX,
  PLAYREADY_SYSTEM_ID,
  playReadyObject,
  pssh,
  WIDEVINE_SYSTEM_ID,
} from './helpers';

function extractKeyIdHexes(initDataType: string, initData: Uint8Array): string[] {
  const keyIds = extractKeyIds(initDataType, initData);
  return keyIds.map((keyId) => keyId.toHex());
}

describe('extractKeyIds()', () => {
  it('reads PSSH v1 key IDs of any system', () => {
    const initData = pssh(PLAYREADY_SYSTEM_ID, [KID, OTHER_KID]);
    const keyIdHexes = extractKeyIdHexes('cenc', initData);
    expect(keyIdHexes).toEqual([KID_HEX, OTHER_KID_HEX]);
  });

  it('reads the key_id fields of Widevine PSSH data', () => {
    // field 2 (key_id), wire type 2, length 16
    const widevineData = new Uint8Array([0x12, 0x10, ...KID, 0x12, 0x10, ...OTHER_KID]);
    const initData = pssh(WIDEVINE_SYSTEM_ID, [], widevineData, 0);
    const keyIdHexes = extractKeyIdHexes('cenc', initData);
    expect(keyIdHexes).toEqual([KID_HEX, OTHER_KID_HEX]);
  });

  it('reads Widevine key_id fields written as hex text', () => {
    const keyIdText = new TextEncoder().encode(KID_HEX);
    const widevineData = new Uint8Array([0x12, 0x20, ...keyIdText]);
    const initData = pssh(WIDEVINE_SYSTEM_ID, [], widevineData, 0);
    const keyIdHexes = extractKeyIdHexes('cenc', initData);
    expect(keyIdHexes).toEqual([KID_HEX]);
  });

  it('reads key IDs from a PlayReady 4.0 header', () => {
    const encodedKid = KID.toBase64();
    const header = `<WRMHEADER version="4.0.0.0"><DATA><KID>${encodedKid}</KID></DATA></WRMHEADER>`;
    const headerObject = playReadyObject(header);
    const initData = pssh(PLAYREADY_SYSTEM_ID, [], headerObject, 0);
    const keyIdHexes = extractKeyIdHexes('cenc', initData);
    expect(keyIdHexes).toEqual([KID_HEX]);
  });

  it('reads key IDs from a PlayReady 4.1+ header', () => {
    const encodedKid = KID.toBase64();
    const header = `<WRMHEADER version="4.1.0.0"><DATA><PROTECTINFO><KID ALGID="AESCTR" VALUE="${encodedKid}"></KID></PROTECTINFO></DATA></WRMHEADER>`;
    const headerObject = playReadyObject(header);
    const initData = pssh(PLAYREADY_SYSTEM_ID, [], headerObject, 0);
    const keyIdHexes = extractKeyIdHexes('cenc', initData);
    expect(keyIdHexes).toEqual([KID_HEX]);
  });

  it('reads key IDs from several PSSH boxes, once each', () => {
    const widevineBox = pssh(WIDEVINE_SYSTEM_ID, [KID]);
    const playReadyBox = pssh(PLAYREADY_SYSTEM_ID, [KID, OTHER_KID]);
    const initData = new Uint8Array([...widevineBox, ...playReadyBox]);
    const keyIdHexes = extractKeyIdHexes('cenc', initData);
    expect(keyIdHexes).toEqual([KID_HEX, OTHER_KID_HEX]);
  });

  it('reads keyids init data', () => {
    const initData = keyIdsInitData([KID, OTHER_KID]);
    const keyIdHexes = extractKeyIdHexes('keyids', initData);
    expect(keyIdHexes).toEqual([KID_HEX, OTHER_KID_HEX]);
  });

  it('reads webm init data as a key ID', () => {
    const keyIdHexes = extractKeyIdHexes('webm', KID);
    expect(keyIdHexes).toEqual([KID_HEX]);
  });

  it('returns no key IDs for malformed init data', () => {
    const malformedPssh = new Uint8Array([1, 2, 3]);
    const malformedKeyIds = new TextEncoder().encode('not json');
    const psshKeyIds = extractKeyIds('cenc', malformedPssh);
    const keyIdsKeyIds = extractKeyIds('keyids', malformedKeyIds);
    expect(psshKeyIds).toEqual([]);
    expect(keyIdsKeyIds).toEqual([]);
  });
});
