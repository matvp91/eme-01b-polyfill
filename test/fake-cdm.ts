/** A fake webkit-prefixed EME v0.1b CDM on top of happy-dom's HTMLMediaElement. */

export const SUPPORTED_KEY_SYSTEMS = ['com.widevine.alpha', 'webkit-org.w3.clearkey'];

export interface Call {
  method: string;
  args: unknown[];
}

export const calls: Call[] = [];
export const cdm = { failAddKey: false, nextSessionId: 1 };

function fire(media: HTMLMediaElement, type: string, fields: Record<string, unknown>): void {
  const event = new Event(`webkit${type}`);
  Object.assign(event, fields);
  setTimeout(() => media.dispatchEvent(event), 0);
}

export function installFakeCdm(): void {
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  // Pretend the platform has no unprefixed EME.
  delete (navigator as unknown as Record<string, unknown>).requestMediaKeySystemAccess;

  proto.canPlayType = function (this: HTMLMediaElement, type: string, keySystem?: string) {
    if (keySystem && !SUPPORTED_KEY_SYSTEMS.includes(keySystem)) {
      return '';
    }
    if (/^(video|audio)\/mp4/.test(type)) {
      return 'probably';
    }
    return '';
  };
  proto.webkitGenerateKeyRequest = function (this: HTMLMediaElement, keySystem: string, initData: Uint8Array) {
    calls.push({ method: 'generateKeyRequest', args: [keySystem, initData] });
    fire(this, 'keymessage', {
      keySystem,
      sessionId: String(cdm.nextSessionId++),
      message: new Uint8Array([1, 2, 3]),
    });
  };
  proto.webkitAddKey = function (
    this: HTMLMediaElement,
    keySystem: string,
    key: Uint8Array,
    keyId: Uint8Array | null,
    sessionId: string,
  ) {
    calls.push({ method: 'addKey', args: [keySystem, key, keyId, sessionId] });
    if (cdm.failAddKey) {
      fire(this, 'keyerror', { keySystem, sessionId, errorCode: { code: 1 }, systemCode: 0 });
    } else {
      fire(this, 'keyadded', { keySystem, sessionId });
    }
  };
  proto.webkitCancelKeyRequest = (keySystem: string, sessionId: string) => {
    calls.push({ method: 'cancelKeyRequest', args: [keySystem, sessionId] });
  };
}

/** Builds a `pssh` box. */
export function pssh(systemIdHex: string, kids: Uint8Array[], data = new Uint8Array(0), version = 1) {
  let size = 32 + data.length;
  if (version) {
    size += 4 + kids.length * 16;
  }
  const box = new Uint8Array(size);
  const view = new DataView(box.buffer);
  view.setUint32(0, size);
  box.set([0x70, 0x73, 0x73, 0x68], 4);
  box[8] = version;
  box.set(Uint8Array.fromHex(systemIdHex), 12);
  let p = 28;
  if (version) {
    view.setUint32(p, kids.length);
    p += 4;
    for (const kid of kids) {
      box.set(kid, p);
      p += 16;
    }
  }
  view.setUint32(p, data.length);
  box.set(data, p + 4);
  return box;
}
