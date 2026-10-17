import type { ClearKeyKeyIds } from './types/clearkey';
import type { Bytes } from './utils';
import { toUint8 } from './utils';

const PSSH_BOX_TYPE = 0x70737368; // 'pssh'
const WIDEVINE_SYSTEM_ID = 'edef8ba979d64acea3c827dcd51d21ed';
const PLAYREADY_SYSTEM_ID = '9a04f07998404286ab92e65be0885f95';
const WIDEVINE_KEY_ID_FIELD = 2;
const PLAYREADY_HEADER_RECORD = 1;

/**
 * Finds the key IDs that init data covers. Key statuses are looked up by key
 * ID, which v0.1b never reports.
 *
 * @param initDataType - `keyids` or `webm`; anything else is read as PSSH boxes,
 *   from which Widevine and PlayReady key IDs are read.
 * @param initData - The init data.
 * @returns The unique key IDs found. Malformed init data yields none instead of throwing.
 */
export function extractKeyIds(initDataType: string, initData: Bytes): Uint8Array[] {
  const bytes = toUint8(initData);
  try {
    if (initDataType === 'keyids') {
      const text = new TextDecoder().decode(bytes);
      const json = JSON.parse(text) as Partial<ClearKeyKeyIds>;
      const encodedKids = json.kids || [];
      return encodedKids.map((kid) => Uint8Array.fromBase64(kid, { alphabet: 'base64url' }));
    }
    if (initDataType === 'webm') {
      if (bytes.length === 16) {
        return [bytes];
      }
      return [];
    }
    return fromPssh(bytes);
  } catch {
    return [];
  }
}

/** Parses one or more concatenated `pssh` boxes. */
function fromPssh(bytes: Uint8Array): Uint8Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kids: Uint8Array[] = [];
  let boxOffset = 0;
  while (boxOffset + 32 <= bytes.length) {
    const boxSize = view.getUint32(boxOffset);
    if (boxSize < 32 || boxOffset + boxSize > bytes.length) {
      break;
    }
    const boxType = view.getUint32(boxOffset + 4);
    if (boxType === PSSH_BOX_TYPE) {
      const boxEnd = boxOffset + boxSize;
      const version = bytes[boxOffset + 8];
      const systemIdBytes = bytes.subarray(boxOffset + 12, boxOffset + 28);
      const systemId = systemIdBytes.toHex();
      let position = boxOffset + 28;
      if (version > 0) {
        const kidCount = view.getUint32(position);
        position += 4;
        for (let i = 0; i < kidCount && position + 16 <= boxEnd; i++, position += 16) {
          const kid = bytes.subarray(position, position + 16);
          kids.push(kid);
        }
      }
      if (position + 4 <= boxEnd) {
        const dataSize = view.getUint32(position);
        const dataStart = position + 4;
        const dataEnd = Math.min(dataStart + dataSize, boxEnd);
        const data = bytes.subarray(dataStart, dataEnd);
        if (systemId === WIDEVINE_SYSTEM_ID) {
          const widevineKids = fromWidevinePsshData(data);
          kids.push(...widevineKids);
        }
        if (systemId === PLAYREADY_SYSTEM_ID) {
          const playReadyKids = fromPlayReadyObject(data);
          kids.push(...playReadyKids);
        }
      }
    }
    boxOffset += boxSize;
  }
  return dedupe(kids);
}

/** Reads the repeated `key_id` field (2) from a WidevinePsshData protobuf. */
function fromWidevinePsshData(data: Uint8Array): Uint8Array[] {
  const kids: Uint8Array[] = [];
  let position = 0;
  const readVarint = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = data[position++];
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80 && position < data.length);
    return result;
  };
  while (position < data.length) {
    const tag = readVarint();
    const fieldNumber = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (wireType === 0) {
      readVarint();
    } else if (wireType === 1) {
      position += 8;
    } else if (wireType === 5) {
      position += 4;
    } else if (wireType === 2) {
      const fieldLength = readVarint();
      const fieldValue = data.subarray(position, position + fieldLength);
      if (fieldNumber === WIDEVINE_KEY_ID_FIELD && fieldLength === 16) {
        kids.push(fieldValue);
      }
      // Some packagers write the key ID as 32 hex characters.
      if (fieldNumber === WIDEVINE_KEY_ID_FIELD && fieldLength === 32) {
        const hex = new TextDecoder().decode(fieldValue);
        if (/^[0-9a-f]{32}$/i.test(hex)) {
          const kid = Uint8Array.fromHex(hex);
          kids.push(kid);
        }
      }
      position += fieldLength;
    } else {
      break;
    }
  }
  return kids;
}

/**
 * Reads KIDs from a PlayReady Object's rights management header (UTF-16LE XML):
 * `<KID>...</KID>` (v4.0) and `<KID ... VALUE="...">` (v4.1+). The bytes are kept in
 * PlayReady's little-endian GUID order.
 */
function fromPlayReadyObject(data: Uint8Array): Uint8Array[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const kids: Uint8Array[] = [];
  if (data.length < 6) {
    return kids;
  }
  const recordCount = view.getUint16(4, true);
  let position = 6;
  for (let i = 0; i < recordCount && position + 4 <= data.length; i++) {
    const recordType = view.getUint16(position, true);
    const recordLength = view.getUint16(position + 2, true);
    position += 4;
    if (recordType === PLAYREADY_HEADER_RECORD) {
      let xml = '';
      const recordEnd = position + recordLength;
      for (let charOffset = position; charOffset + 1 < recordEnd && charOffset + 1 < data.length; charOffset += 2) {
        const charCode = view.getUint16(charOffset, true);
        xml += String.fromCharCode(charCode);
      }
      const kidPattern = /<KID>([^<]+)<\/KID>|<KID[^>]*\sVALUE="([^"]+)"/g;
      let match = kidPattern.exec(xml);
      while (match) {
        const encodedKid = match[1] || match[2];
        const kid = Uint8Array.fromBase64(encodedKid);
        if (kid.length === 16) {
          kids.push(kid);
        }
        match = kidPattern.exec(xml);
      }
    }
    position += recordLength;
  }
  return kids;
}

function dedupe(kids: Uint8Array[]): Uint8Array[] {
  const seen = new Map<string, true>();
  return kids.filter((kid) => {
    const hex = kid.toHex();
    if (seen.has(hex)) {
      return false;
    }
    seen.set(hex, true);
    return true;
  });
}
