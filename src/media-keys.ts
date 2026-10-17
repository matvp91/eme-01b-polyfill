import { MediaKeySession } from './media-key-session';
import type { ClearKeyLicenseRequest } from './types/clearkey';
import type { WebkitMediaElement, WebkitMediaKeyEvent } from './types/webkit-eme';
import { createEvent } from './utils';

/** The keys for a key system, attached to a media element with `setMediaKeys()`. */
export class MediaKeys {
  private keySystem_: string;

  private media_: HTMLMediaElement | null = null;

  private newSessions_: MediaKeySession[] = [];

  private sessionMap_ = new Map<string, MediaKeySession>();

  /**
   * Created by `MediaKeySystemAccess.createMediaKeys()`.
   *
   * @param keySystem - The v0.1b key system name, e.g. `webkit-org.w3.clearkey`.
   */
  constructor(keySystem: string) {
    this.keySystem_ = keySystem;
  }

  /** @internal */
  setMedia(media: HTMLMediaElement | null): void {
    if (this.media_) {
      this.media_.removeEventListener('webkitneedkey', this.onWebkitNeedKey_);
      this.media_.removeEventListener('webkitkeymessage', this.onWebkitKeyMessage_);
      this.media_.removeEventListener('webkitkeyadded', this.onWebkitKeyAdded_);
      this.media_.removeEventListener('webkitkeyerror', this.onWebkitKeyError_);
    }
    this.media_ = media;
    if (media) {
      media.addEventListener('webkitneedkey', this.onWebkitNeedKey_);
      media.addEventListener('webkitkeymessage', this.onWebkitKeyMessage_);
      media.addEventListener('webkitkeyadded', this.onWebkitKeyAdded_);
      media.addEventListener('webkitkeyerror', this.onWebkitKeyError_);
    }
  }

  /**
   * Creates a session for a license exchange.
   *
   * @param sessionType - `temporary` (the default) or `persistent-license`.
   * @returns The new session.
   * @throws A TypeError for any other session type.
   */
  createSession(sessionType: MediaKeySessionType = 'temporary'): MediaKeySession {
    if (sessionType !== 'temporary' && sessionType !== 'persistent-license') {
      throw new TypeError(`Session type ${sessionType} is unsupported on this platform.`);
    }

    // Unlike unprefixed EME, v0.1b needs a media element with a `src` to create sessions on.
    const media = this.media_ || document.createElement('video');
    if (!media.src) {
      media.src = 'about:blank';
    }

    const session = new MediaKeySession(media as WebkitMediaElement, this.keySystem_, sessionType);
    this.newSessions_.push(session);
    return session;
  }

  /**
   * Server certificates aren't supported, as v0.1b has no equivalent.
   *
   * @param _serverCertificate - Ignored.
   * @returns A promise for `false`.
   */
  setServerCertificate(_serverCertificate: BufferSource): Promise<boolean> {
    return Promise.resolve(false);
  }

  /**
   * Always reports `usable`, as v0.1b can't check key policies such as HDCP.
   *
   * @param _policy - Ignored.
   * @returns A promise for `usable`.
   */
  getStatusForPolicy(_policy?: unknown): Promise<MediaKeyStatus> {
    return Promise.resolve('usable');
  }

  private onWebkitNeedKey_ = (event: Event): void => {
    const { initData } = event as WebkitMediaKeyEvent;
    if (!this.media_ || !initData) {
      return;
    }
    // v0.1b doesn't report the init data type; for MP4 it's PSSH boxes, i.e. 'cenc'.
    const encryptedEvent = createEvent('encrypted', {
      initDataType: 'cenc',
      initData: initData.slice().buffer,
    });
    this.media_.dispatchEvent(encryptedEvent);
  };

  private onWebkitKeyMessage_ = (event: Event): void => {
    const { sessionId, message: rawMessage } = event as WebkitMediaKeyEvent;
    const session = this.findSession_(sessionId);
    if (!session) {
      return;
    }

    const isNew = session.keyStatuses.getStatus() === undefined;
    const keyIds = session.keyStatuses.getKeyIds();

    let messageBytes = rawMessage;
    if (!messageBytes) {
      messageBytes = new Uint8Array(0);
    }
    let message = messageBytes.slice().buffer;
    if (this.keySystem_ === 'webkit-org.w3.clearkey' && keyIds.length) {
      // v0.1b ClearKey sends the raw init data, but ClearKey servers expect the
      // JSON license request of unprefixed EME.
      const request: ClearKeyLicenseRequest = {
        kids: keyIds.map((keyId) => keyId.toBase64({ alphabet: 'base64url', omitPadding: true })),
        type: 'temporary',
      };
      const requestJson = JSON.stringify(request);
      message = new TextEncoder().encode(requestJson).buffer;
    }

    let messageType: MediaKeyMessageType = 'license-renewal';
    if (isNew) {
      messageType = 'license-request';
    }
    const messageEvent = createEvent('message', { messageType, message });

    session.generated();
    session.dispatchEvent(messageEvent);
    if (session.onmessage) {
      session.onmessage(messageEvent as MediaKeyMessageEvent);
    }
  };

  private onWebkitKeyAdded_ = (event: Event): void => {
    const { sessionId } = event as WebkitMediaKeyEvent;
    const session = this.findSession_(sessionId);
    if (session) {
      session.ready();
    }
  };

  private onWebkitKeyError_ = (event: Event): void => {
    const keyEvent = event as WebkitMediaKeyEvent;
    const session = this.findSession_(keyEvent.sessionId);
    if (session) {
      session.handleError(keyEvent);
    }
  };

  private findSession_(sessionId: string): MediaKeySession | null {
    const known = this.sessionMap_.get(sessionId);
    if (known) {
      return known;
    }

    // Sessions can be created and never used, so the ID goes to the oldest
    // session that actually called generateKeyRequest.
    for (let i = 0; i < this.newSessions_.length; i++) {
      const session = this.newSessions_[i];
      if (session.isGenerating()) {
        this.newSessions_.splice(i, 1);
        // Mapping '' would route every later error without an ID to this session.
        if (sessionId) {
          session.sessionId = sessionId;
          this.sessionMap_.set(sessionId, session);
        }
        return session;
      }
    }
    return null;
  }
}
