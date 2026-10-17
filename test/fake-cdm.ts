/**
 * A fake webkit-prefixed EME v0.1b CDM on top of happy-dom's HTMLMediaElement,
 * following the v0.1b spec: synchronous exceptions, one task per event, and
 * session IDs that belong to the media element.
 */

export const SUPPORTED_KEY_SYSTEMS = ['com.widevine.alpha', 'webkit-org.w3.clearkey'];

export const MEDIA_KEYERR_UNKNOWN = 1;

export const MEDIA_KEYERR_OUTPUT = 4;

export interface Call {
  method: 'generateKeyRequest' | 'addKey' | 'cancelKeyRequest';
  args: unknown[];
}

export interface CdmError {
  code: number;
  systemCode: number;
}

interface Session {
  keySystem: string;
  keyAdded: boolean;
}

/** Knobs and recorded calls; reset before each test. */
export const cdm = {
  calls: [] as Call[],
  /** The key request sent in `webkitkeymessage` (ClearKey sends the init data instead). */
  keyRequest: new Uint8Array([1, 2, 3]),
  /** Makes the next generateKeyRequest fail with a `webkitkeyerror`. */
  generateError: null as CdmError | null,
  /** Makes addKey calls fail with a `webkitkeyerror`. */
  addKeyError: null as CdmError | null,
  /** Makes the next generateKeyRequest call throw synchronously. */
  throwOnGenerate: null as string | null,
};

const sessions = new WeakMap<HTMLMediaElement, Map<string, Session>>();

let nextSessionId = 1;

export function resetCdm(): void {
  cdm.calls = [];
  cdm.keyRequest = new Uint8Array([1, 2, 3]);
  cdm.generateError = null;
  cdm.addKeyError = null;
  cdm.throwOnGenerate = null;
}

function sessionsOf(media: HTMLMediaElement): Map<string, Session> {
  let map = sessions.get(media);
  if (!map) {
    map = new Map();
    sessions.set(media, map);
  }
  return map;
}

function fire(media: HTMLMediaElement, type: string, fields: Record<string, unknown>): void {
  const event = new Event(`webkit${type}`);
  Object.assign(event, fields);
  setTimeout(() => media.dispatchEvent(event), 0);
}

function checkKeySystem(media: HTMLMediaElement, keySystem: string | null): void {
  if (!keySystem) {
    throw new DOMException('Invalid key system.', 'SyntaxError');
  }
  // Stands in for the spec's NETWORK_EMPTY check: happy-dom always reports networkState 0.
  if (!media.src) {
    throw new DOMException('The media element has no source.', 'InvalidStateError');
  }
  if (!SUPPORTED_KEY_SYSTEMS.includes(keySystem)) {
    throw new DOMException(`Unsupported key system ${keySystem}.`, 'NotSupportedError');
  }
}

export function installFakeCdm(): void {
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  delete (navigator as unknown as Record<string, unknown>).requestMediaKeySystemAccess;

  proto.canPlayType = (type: string, keySystem?: string | null) => {
    if (keySystem) {
      const supported = SUPPORTED_KEY_SYSTEMS.some((ks) => ks === keySystem || ks.startsWith(`${keySystem}.`));
      if (!supported) {
        return '';
      }
    }
    if (!/^(video|audio)\/mp4/.test(type)) {
      return '';
    }
    if (type.includes('codecs=')) {
      return 'probably';
    }
    return 'maybe';
  };

  proto.webkitGenerateKeyRequest = function (this: HTMLMediaElement, keySystem: string | null, initData: Uint8Array) {
    checkKeySystem(this, keySystem);
    if (cdm.throwOnGenerate) {
      const name = cdm.throwOnGenerate;
      cdm.throwOnGenerate = null;
      throw new DOMException('Generating the key request failed.', name);
    }
    cdm.calls.push({ method: 'generateKeyRequest', args: [keySystem, initData] });

    if (cdm.generateError) {
      const { code, systemCode } = cdm.generateError;
      cdm.generateError = null;
      fire(this, 'keyerror', { keySystem, sessionId: null, errorCode: { code }, systemCode });
      return;
    }
    const sessionId = String(nextSessionId++);
    sessionsOf(this).set(sessionId, { keySystem: keySystem as string, keyAdded: false });
    let message: Uint8Array = cdm.keyRequest;
    if (keySystem === 'webkit-org.w3.clearkey') {
      message = initData;
    }
    fire(this, 'keymessage', { keySystem, sessionId, message, defaultURL: null });
  };

  proto.webkitAddKey = function (
    this: HTMLMediaElement,
    keySystem: string | null,
    key: Uint8Array | null,
    initData: Uint8Array | null,
    sessionId: string | null,
  ) {
    if (!key) {
      throw new DOMException('Invalid key.', 'SyntaxError');
    }
    if (!key.length) {
      throw new DOMException('Empty key.', 'TypeMismatchError');
    }
    checkKeySystem(this, keySystem);
    let session: Session | undefined;
    if (sessionId !== null) {
      session = sessionsOf(this).get(sessionId);
      if (!session) {
        throw new DOMException(`Unknown session ${sessionId}.`, 'InvalidAccessError');
      }
    }
    cdm.calls.push({ method: 'addKey', args: [keySystem, key, initData, sessionId] });

    if (cdm.addKeyError) {
      const { code, systemCode } = cdm.addKeyError;
      fire(this, 'keyerror', { keySystem, sessionId, errorCode: { code }, systemCode });
      return;
    }
    if (session) {
      session.keyAdded = true;
    }
    fire(this, 'keyadded', { keySystem, sessionId });
  };

  proto.webkitCancelKeyRequest = function (this: HTMLMediaElement, keySystem: string | null, sessionId: string | null) {
    cdm.calls.push({ method: 'cancelKeyRequest', args: [keySystem, sessionId] });
    if (!keySystem) {
      throw new DOMException('Invalid key system.', 'SyntaxError');
    }
    if (sessionId === null) {
      return;
    }
    const session = sessionsOf(this).get(sessionId);
    if (!session || session.keySystem !== keySystem) {
      throw new DOMException(`Unknown session ${sessionId}.`, 'InvalidAccessError');
    }
    if (session.keyAdded) {
      throw new DOMException('Keys were already added.', 'InvalidStateError');
    }
    sessionsOf(this).delete(sessionId);
  };
}

/** Fires `webkitneedkey`, as the media element does when it finds init data. */
export function fireNeedKey(media: HTMLMediaElement, initData: Uint8Array | null): void {
  media.dispatchEvent(Object.assign(new Event('webkitneedkey'), { keySystem: null, sessionId: null, initData }));
}

/** Fires a `webkitkeymessage` the CDM sends on its own, e.g. to renew a license. */
export function fireKeyMessage(media: HTMLMediaElement, sessionId: string): void {
  const event = Object.assign(new Event('webkitkeymessage'), {
    keySystem: 'com.widevine.alpha',
    sessionId,
    message: cdm.keyRequest,
    defaultURL: null,
  });
  media.dispatchEvent(event);
}

/** Fires a `webkitkeyerror` the CDM reports on its own, e.g. when a key expires. */
export function fireKeyError(media: HTMLMediaElement, sessionId: string, error: CdmError): void {
  const event = Object.assign(new Event('webkitkeyerror'), {
    keySystem: 'com.widevine.alpha',
    sessionId,
    errorCode: { code: error.code },
    systemCode: error.systemCode,
  });
  media.dispatchEvent(event);
}
