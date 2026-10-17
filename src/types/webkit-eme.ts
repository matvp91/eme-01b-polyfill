/** Types for the webkit-prefixed EME v0.1b API. */

/** A v0.1b MediaKeyError. */
export interface WebkitMediaKeyError {
  /** A `MEDIA_KEYERR_*` code, e.g. 4 for `MEDIA_KEYERR_OUTPUT`. */
  code: number;

  /** The CDM-specific error code, copied over from the event. */
  systemCode?: number;
}

/** A `webkitneedkey` / `webkitkeymessage` / `webkitkeyadded` / `webkitkeyerror` event. */
export interface WebkitMediaKeyEvent extends Event {
  /** The v0.1b key system name, e.g. `webkit-org.w3.clearkey`. */
  keySystem: string;

  /** The CDM's session ID. Empty for `webkitneedkey`, and for errors before a session exists. */
  sessionId: string;

  /** `webkitneedkey` only: the init data, e.g. PSSH boxes. */
  initData?: Uint8Array;

  /** `webkitkeymessage` only: the license request. */
  message?: Uint8Array;

  /** `webkitkeyerror` only: the error. */
  errorCode?: WebkitMediaKeyError;

  /** `webkitkeyerror` only: the CDM-specific error code. */
  systemCode?: number;
}

/** A media element with the v0.1b methods. */
export interface WebkitMediaElement extends HTMLMediaElement {
  /**
   * Starts a license exchange. The session ID arrives with the first
   * `webkitkeymessage`, or `webkitkeyerror` on failure.
   *
   * @param keySystem - The v0.1b key system name.
   * @param initData - The init data, e.g. PSSH boxes.
   */
  webkitGenerateKeyRequest(keySystem: string, initData: Uint8Array): void;

  /**
   * Passes a license to a session, answered by `webkitkeyadded` or `webkitkeyerror`.
   *
   * @param keySystem - The v0.1b key system name.
   * @param key - The license; for ClearKey, a raw key.
   * @param initData - For ClearKey, the key ID; otherwise `null`.
   * @param sessionId - The session to add the key to.
   */
  webkitAddKey(keySystem: string, key: Uint8Array, initData: Uint8Array | null, sessionId: string): void;

  /**
   * Ends a session and frees its CDM resources. Also deletes a persistent session's stored license.
   *
   * @param keySystem - The v0.1b key system name.
   * @param sessionId - The session to end.
   */
  webkitCancelKeyRequest(keySystem: string, sessionId: string): void;
}
