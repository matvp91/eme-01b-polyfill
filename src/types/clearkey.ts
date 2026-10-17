/** ClearKey JSON formats (https://www.w3.org/TR/encrypted-media/#clear-key). */

/** The `keyids` init data format. */
export interface ClearKeyKeyIds {
  /** The key IDs, base64url-encoded. */
  kids: string[];
}

/** The license request sent in a `message` event. */
export interface ClearKeyLicenseRequest extends ClearKeyKeyIds {
  /** The session type the license is for. */
  type: MediaKeySessionType;
}

/** A key in a {@link ClearKeyJwkSet}. */
export interface ClearKeyJwk {
  /** The key type, which must be `oct`. */
  kty: string;

  /** The key, base64url-encoded. */
  k: string;

  /** The key ID, base64url-encoded. */
  kid: string;
}

/** The license (a JSON Web Key Set) passed to `update()`. */
export interface ClearKeyJwkSet {
  /** The keys. */
  keys: ClearKeyJwk[];
}
