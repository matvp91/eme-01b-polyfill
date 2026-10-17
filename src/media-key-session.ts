import { EventTargetShim } from './event-target-shim';
import { extractKeyIds } from './extract-key-ids';
import { MediaKeyStatusMap } from './media-key-status-map';
import type { ClearKeyJwkSet } from './types/clearkey';
import type { WebkitMediaElement, WebkitMediaKeyError, WebkitMediaKeyEvent } from './types/webkit-eme';
import { concat, createEvent, toUint8 } from './utils';

const MEDIA_KEYERR_OUTPUT = 4;

/**
 * A license exchange with the CDM, translated to the v0.1b `webkit*` methods
 * and events of the media element.
 */
export class MediaKeySession extends EventTargetShim {
  /** The CDM's session ID, empty until the first `message` event. */
  sessionId = '';

  /** Always `NaN`, as v0.1b doesn't report when a license expires. */
  expiration = Number.NaN;

  /** The status of each key. All keys of a session share one status. */
  readonly keyStatuses = new MediaKeyStatusMap();

  /** Handler for `message` events, called after the event listeners. */
  onmessage: ((event: MediaKeyMessageEvent) => void) | null = null;

  /** Handler for `keystatuseschange` events, called after the event listeners. */
  onkeystatuseschange: ((event: Event) => void) | null = null;

  private media_: WebkitMediaElement;

  private keySystem_: string;

  private type_: MediaKeySessionType;

  private initialized_ = false;

  private generatePromise_: PromiseWithResolvers<void> | null = null;

  private updatePromise_: PromiseWithResolvers<void> | null = null;

  /** ClearKey needs an addKey call per key, and fires a keyadded event for each. */
  private pendingKeys_ = 0;

  private closed_ = Promise.withResolvers<MediaKeySessionClosedReason>();

  /**
   * Created by `MediaKeys.createSession()`.
   *
   * @param media - The media element whose v0.1b methods and events the session uses.
   * @param keySystem - The v0.1b key system name, e.g. `webkit-org.w3.clearkey`.
   * @param type - The session type.
   */
  constructor(media: WebkitMediaElement, keySystem: string, type: MediaKeySessionType) {
    super();
    this.media_ = media;
    this.keySystem_ = keySystem;
    this.type_ = type;
  }

  /** Resolves with `closed-by-application` once the session is closed. Never rejects. */
  get closed(): Promise<MediaKeySessionClosedReason> {
    return this.closed_.promise;
  }

  /** @internal Whether it's waiting for its first keymessage, which carries its v0.1b session ID. */
  isGenerating(): boolean {
    return !!this.generatePromise_;
  }

  /** @internal */
  generated(): void {
    if (this.generatePromise_) {
      this.generatePromise_.resolve();
      this.generatePromise_ = null;
    }
  }

  /** @internal */
  ready(): void {
    if (--this.pendingKeys_ > 0) {
      return;
    }

    this.updateKeyStatus_('usable');

    if (this.updatePromise_) {
      this.updatePromise_.resolve();
    }
    this.updatePromise_ = null;
  }

  /** @internal */
  handleError(event: WebkitMediaKeyEvent): void {
    // v0.1b error codes don't map onto DOMException names, so expose them as is.
    const error = new Error('EME v0.1b key error') as Error & { errorCode?: WebkitMediaKeyError };
    const errorCode = event.errorCode;
    if (errorCode) {
      errorCode.systemCode = event.systemCode;
    }
    error.errorCode = errorCode;

    // Route by the pending promise, not by event.sessionId: errors during
    // generation can already carry a session ID.
    if (this.generatePromise_) {
      if (event.systemCode === 45) {
        error.message = 'Unsupported session type.';
      }
      this.generatePromise_.reject(error);
      this.generatePromise_ = null;
    } else if (this.updatePromise_) {
      this.updatePromise_.reject(error);
      this.updatePromise_ = null;
    } else {
      // A best-effort mapping, as v0.1b has no key statuses.
      const code = event.errorCode?.code;
      if (code === MEDIA_KEYERR_OUTPUT) {
        this.updateKeyStatus_('output-restricted');
      } else if (event.systemCode === 1) {
        this.updateKeyStatus_('expired');
      } else {
        this.updateKeyStatus_('internal-error');
      }
    }
  }

  private generate_(initData: Uint8Array | null, offlineSessionId: string | null): Promise<void> {
    if (this.initialized_) {
      return Promise.reject(new Error('The session is already initialized.'));
    }

    this.initialized_ = true;

    // v0.1b has no session types; CDMs that support persistence recognize these prefixes.
    let mangledInitData: Uint8Array;
    if (this.type_ === 'persistent-license') {
      if (!offlineSessionId) {
        mangledInitData = concat(new TextEncoder().encode('PERSISTENT|'), initData as Uint8Array);
      } else {
        mangledInitData = new TextEncoder().encode(`LOAD_SESSION|${offlineSessionId}`);
      }
    } else {
      mangledInitData = initData as Uint8Array;
    }

    const generatePromise = Promise.withResolvers<void>();
    this.generatePromise_ = generatePromise;

    // createSession() may have just set `src`, which isn't always processed yet,
    // making generateKeyRequest throw an InvalidStateError. Retry once after 10 ms.
    try {
      this.media_.webkitGenerateKeyRequest(this.keySystem_, mangledInitData);
    } catch (exception) {
      if ((exception as Error).name !== 'InvalidStateError') {
        this.generatePromise_ = null;
        return Promise.reject(exception);
      }

      setTimeout(() => {
        try {
          this.media_.webkitGenerateKeyRequest(this.keySystem_, mangledInitData);
        } catch (exception2) {
          generatePromise.reject(exception2);
          this.generatePromise_ = null;
        }
      }, 10);
    }

    return generatePromise.promise;
  }

  private update_(promise: PromiseWithResolvers<void>, response: Uint8Array): void {
    if (this.updatePromise_) {
      // keyadded / keyerror events don't say which addKey call they belong to,
      // so only one update can be in flight.
      this.updatePromise_.promise.then(
        () => this.update_(promise, response),
        () => this.update_(promise, response),
      );
      return;
    }

    let keys: [Uint8Array, Uint8Array | null][];
    if (this.keySystem_ === 'webkit-org.w3.clearkey') {
      // Unprefixed ClearKey licenses are a JWK set; v0.1b takes raw keys and key IDs.
      try {
        const jwkSet = JSON.parse(new TextDecoder().decode(response)) as ClearKeyJwkSet;
        keys = jwkSet.keys.map((jwk) => {
          if (jwk.kty !== 'oct') {
            throw new Error('kty');
          }
          return [
            Uint8Array.fromBase64(jwk.k, { alphabet: 'base64url' }),
            Uint8Array.fromBase64(jwk.kid, { alphabet: 'base64url' }),
          ];
        });
        if (!keys.length) {
          throw new Error('no keys');
        }
      } catch {
        promise.reject(new Error('Response is not a valid JSON Web Key Set.'));
        return;
      }
      this.keyStatuses.setKeyIds(keys.map(([, keyId]) => keyId as Uint8Array));
    } else {
      keys = [[response, null]];
    }

    this.updatePromise_ = promise;
    this.pendingKeys_ = keys.length;

    try {
      for (const [key, keyId] of keys) {
        this.media_.webkitAddKey(this.keySystem_, key, keyId, this.sessionId);
      }
    } catch (exception) {
      this.updatePromise_.reject(exception);
      this.updatePromise_ = null;
    }
  }

  private updateKeyStatus_(status: MediaKeyStatus): void {
    this.keyStatuses.setStatus(status);
    const event = createEvent('keystatuseschange');
    this.dispatchEvent(event);

    if (this.onkeystatuseschange) {
      this.onkeystatuseschange(event);
    }
  }

  /**
   * Generates a license request, which follows in a `message` event.
   *
   * @param initDataType - The init data format, e.g. `cenc` or `keyids`. v0.1b
   *   ignores it; it's only used to find the session's key IDs.
   * @param initData - The init data, e.g. PSSH boxes.
   * @returns A promise that resolves once the license request is generated.
   */
  generateRequest(initDataType: string, initData: BufferSource): Promise<void> {
    const promise = this.generate_(toUint8(initData), null);
    if (!this.keyStatuses.getKeyIds().length) {
      this.keyStatuses.setKeyIds(extractKeyIds(initDataType, initData));
    }
    return promise;
  }

  /**
   * Loads a stored persistent session.
   *
   * @param sessionId - The ID of the stored session.
   * @returns A promise for `true` once the CDM responds. Rejects for temporary sessions.
   */
  load(sessionId: string): Promise<boolean> {
    if (this.type_ === 'persistent-license') {
      return this.generate_(null, sessionId).then(() => true);
    }
    return Promise.reject(new Error('Not a persistent session.'));
  }

  /**
   * Passes a license to the CDM. Calls are queued, as v0.1b handles one at a time.
   *
   * @param response - The license; for ClearKey, a JSON Web Key Set.
   * @returns A promise that resolves once all keys are added.
   */
  update(response: BufferSource): Promise<void> {
    const nextUpdatePromise = Promise.withResolvers<void>();
    this.update_(nextUpdatePromise, toUint8(response));
    return nextUpdatePromise.promise;
  }

  /**
   * Closes the session. For temporary sessions this also frees the CDM's resources.
   *
   * @returns A promise that resolves once the session is closed. Never rejects.
   */
  close(): Promise<void> {
    // cancelKeyRequest is the only way to free CDM resources in v0.1b, but it
    // also deletes a persistent session.
    if (this.type_ !== 'persistent-license' && this.sessionId) {
      try {
        this.media_.webkitCancelKeyRequest(this.keySystem_, this.sessionId);
      } catch {
        // close() must not fail; the session counts as closed either way.
      }
    }

    // Per spec `closed` only ever resolves, also for a session without ID.
    this.closed_.resolve('closed-by-application');
    return this.closed_.promise.then(() => undefined);
  }

  /**
   * Closes a persistent session. The stored license is kept: v0.1b can only
   * delete it through `webkitCancelKeyRequest`, which isn't called here.
   *
   * @returns A promise that resolves once the session is closed. Rejects for temporary sessions.
   */
  remove(): Promise<void> {
    if (this.type_ !== 'persistent-license') {
      return Promise.reject(new Error('Not a persistent session.'));
    }
    return this.close();
  }
}
