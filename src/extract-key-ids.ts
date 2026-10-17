import type { ClearKeyKeyIds } from './types/clearkey';
import type { Bytes } from './utils';
import { toUint8 } from './utils';

const PSSH_BOX_TYPE = 0x70737368; // 'pssh'
const WIDEVINE_SYSTEM_ID = 'edef8ba979d64acea3c827dcd51d21ed';
const PLAYREADY_SYSTEM_ID = '9a04f07998404286ab92e65be0885f95';

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
      const json = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ClearKeyKeyIds>;
      return (json.kids || []).map((kid) => Uint8Array.fromBase64(kid, { alphabet: 'base64url' }));
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
  let offset = 0;
  while (offset + 32 <= bytes.length) {
    const size = view.getUint32(offset);
    if (size < 32 || offset + size > bytes.length) {
      break;
    }
    if (view.getUint32(offset + 4) === PSSH_BOX_TYPE) {
      const end = offset + size;
      const version = bytes[offset + 8];
      const systemId = bytes.subarray(offset + 12, offset + 28).toHex();
      let p = offset + 28;
      if (version > 0) {
        const count = view.getUint32(p);
        p += 4;
        for (let i = 0; i < count && p + 16 <= end; i++, p += 16) {
          kids.push(bytes.subarray(p, p + 16));
        }
      }
      if (p + 4 <= end) {
        const data = bytes.subarray(p + 4, Math.min(p + 4 + view.getUint32(p), end));
        if (systemId === WIDEVINE_SYSTEM_ID) {
          kids.push(...fromWidevinePsshData(data));
        }
        if (systemId === PLAYREADY_SYSTEM_ID) {
          kids.push(...fromPlayReadyObject(data));
        }
      }
    }
    offset += size;
  }
  return dedupe(kids);
}

/** Reads the repeated `key_id` field (2) from a WidevinePsshData protobuf. */
function fromWidevinePsshData(data: Uint8Array): Uint8Array[] {
  const kids: Uint8Array[] = [];
  let p = 0;
  const varint = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = data[p++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80 && p < data.length);
    return result;
  };
  while (p < data.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) {
      varint();
    } else if (wire === 1) {
      p += 8;
    } else if (wire === 5) {
      p += 4;
    } else if (wire === 2) {
      const len = varint();
      const value = data.subarray(p, p + len);
      if (field === 2 && len === 16) {
        kids.push(value);
      }
      // Some packagers write the key ID as 32 hex characters.
      if (field === 2 && len === 32) {
        const hex = new TextDecoder().decode(value);
        if (/^[0-9a-f]{32}$/i.test(hex)) {
          kids.push(Uint8Array.fromHex(hex));
        }
      }
      p += len;
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
  const count = view.getUint16(4, true);
  let p = 6;
  for (let i = 0; i < count && p + 4 <= data.length; i++) {
    const type = view.getUint16(p, true);
    const length = view.getUint16(p + 2, true);
    p += 4;
    if (type === 1) {
      let xml = '';
      for (let j = p; j + 1 < p + length && j + 1 < data.length; j += 2) {
        xml += String.fromCharCode(view.getUint16(j, true));
      }
      const re = /<KID>([^<]+)<\/KID>|<KID[^>]*\sVALUE="([^"]+)"/g;
      let match = re.exec(xml);
      while (match) {
        const kid = Uint8Array.fromBase64(match[1] || match[2]);
        if (kid.length === 16) {
          kids.push(kid);
        }
        match = re.exec(xml);
      }
    }
    p += length;
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
