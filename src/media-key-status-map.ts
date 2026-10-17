import type { Bytes } from './utils';
import { toUint8 } from './utils';

const DUMMY_KEY_ID = new Uint8Array([0]);

/**
 * The key statuses of a `MediaKeySession`.
 *
 * v0.1b only reports success or failure per session, so all of a session's
 * keys share one status.
 *
 * When the init data had no extractable key IDs, the map reports a dummy key
 * ID `00`, but `has()` / `get()` match *any* key ID.
 */
export class MediaKeyStatusMap {
  /** The number of key IDs with a status; 0 until the session has a status. */
  size = 0;

  private status_: MediaKeyStatus | undefined;

  private keyIds_: Uint8Array[] = [];

  /** @internal */
  setKeyIds(keyIds: Uint8Array[]): void {
    this.keyIds_ = keyIds;
    this.updateSize_();
  }

  /** @internal */
  getKeyIds(): Uint8Array[] {
    return this.keyIds_;
  }

  /** @internal */
  setStatus(status: MediaKeyStatus | undefined): void {
    this.status_ = status;
    this.updateSize_();
  }

  /** @internal */
  getStatus(): MediaKeyStatus | undefined {
    return this.status_;
  }

  /**
   * Checks whether a key has a status.
   *
   * @param keyId - The key ID.
   * @returns Whether the key has a status. Any key ID matches when the session's key IDs are unknown.
   */
  has(keyId: Bytes): boolean {
    if (!this.status_) {
      return false;
    }
    if (!this.keyIds_.length) {
      return true;
    }
    const keyIdBytes = toUint8(keyId);
    const hex = keyIdBytes.toHex();
    return this.keyIds_.some((id) => id.toHex() === hex);
  }

  /**
   * Looks up a key's status.
   *
   * @param keyId - The key ID.
   * @returns The key's status, or `undefined` when it has none.
   */
  get(keyId: Bytes): MediaKeyStatus | undefined {
    if (!this.has(keyId)) {
      return undefined;
    }
    return this.status_;
  }

  /**
   * Calls `callback` for each key.
   *
   * @param callback - Receives the status, a copy of the key ID, and this map.
   */
  forEach(callback: (status: MediaKeyStatus, keyId: ArrayBuffer, parent: MediaKeyStatusMap) => void): void {
    for (const keyId of this.reportedKeyIds_()) {
      callback(this.status_ as MediaKeyStatus, keyId, this);
    }
  }

  // Generators need Chrome 39; apps targeting Chrome 38 compile them to ES5.
  /**
   * Iterates over the keys and their statuses.
   *
   * @returns An iterator of `[keyId, status]` pairs, with copies of the key IDs.
   */
  *entries(): IterableIterator<[ArrayBuffer, MediaKeyStatus]> {
    for (const keyId of this.reportedKeyIds_()) {
      yield [keyId, this.status_ as MediaKeyStatus];
    }
  }

  /**
   * Iterates over the key IDs.
   *
   * @returns An iterator of copies of the key IDs.
   */
  *keys(): IterableIterator<ArrayBuffer> {
    for (const keyId of this.reportedKeyIds_()) {
      yield keyId;
    }
  }

  /**
   * Iterates over the statuses, one per key.
   *
   * @returns An iterator of statuses.
   */
  *values(): IterableIterator<MediaKeyStatus> {
    for (const _ of this.reportedKeyIds_()) {
      yield this.status_ as MediaKeyStatus;
    }
  }

  // Symbol.iterator only exists from Chrome 43; before that this defines an
  // (unused) "undefined" method, which is harmless.
  /**
   * Same as {@link MediaKeyStatusMap.entries}.
   *
   * @returns An iterator of `[keyId, status]` pairs.
   */
  [Symbol.iterator](): IterableIterator<[ArrayBuffer, MediaKeyStatus]> {
    return this.entries();
  }

  /** Copies, so callers can't modify the session's key IDs. */
  private reportedKeyIds_(): ArrayBuffer[] {
    if (!this.status_) {
      return [];
    }
    let keyIds = this.keyIds_;
    if (!keyIds.length) {
      keyIds = [DUMMY_KEY_ID];
    }
    return keyIds.map((id) => id.slice().buffer);
  }

  private updateSize_(): void {
    if (!this.status_) {
      this.size = 0;
      return;
    }
    this.size = Math.max(this.keyIds_.length, 1);
  }
}
