/** Any binary data. Wider than `BufferSource`, which TS 7 narrows to non-shared buffers. */
export type Bytes = ArrayBuffer | ArrayBufferView;

/**
 * Views binary data as a Uint8Array, without copying.
 *
 * @param data - The binary data.
 * @returns A Uint8Array over the same bytes.
 */
export function toUint8(data: Bytes): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

/**
 * Joins two byte arrays.
 *
 * @param a - The first bytes.
 * @param b - The bytes to append.
 * @returns A new array with the bytes of `a` followed by those of `b`.
 */
export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * Returns a video element to query. Creating video elements is memory-expensive
 * on some embedded devices, so this borrows one when possible.
 *
 * @returns The document's first video element, or a new one.
 */
export function getVideoElement(): HTMLVideoElement {
  const videos = document.getElementsByTagName('video');
  if (videos.length) {
    return videos[0];
  }
  return document.createElement('video');
}

/**
 * Creates an Event carrying extra (normally read-only) fields such as `message`.
 * The MediaKeyMessageEvent / MediaEncryptedEvent constructors need Chrome 42.
 *
 * @param type - The event type.
 * @param fields - Read-only fields to define on the event.
 * @returns The event, typed with the extra fields.
 */
export function createEvent<T extends object>(type: string, fields?: T): Event & T {
  const event = new Event(type);
  if (fields) {
    for (const key of Object.keys(fields) as (keyof T)[]) {
      Object.defineProperty(event, key, { value: fields[key], enumerable: true });
    }
  }
  return event as Event & T;
}
