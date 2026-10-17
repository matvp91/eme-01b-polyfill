export const WIDEVINE = 'com.widevine.alpha';

export const CLEARKEY = 'org.w3.clearkey';

export const WIDEVINE_SYSTEM_ID = 'edef8ba979d64acea3c827dcd51d21ed';

export const PLAYREADY_SYSTEM_ID = '9a04f07998404286ab92e65be0885f95';

export const KID_HEX = '0123456789abcdef0123456789abcdef';

export const OTHER_KID_HEX = 'ffeeddccbbaa99887766554433221100';

export const KID = Uint8Array.fromHex(KID_HEX);

export const OTHER_KID = Uint8Array.fromHex(OTHER_KID_HEX);

/** A license the fake CDM accepts for any key system but ClearKey. */
export const LICENSE = new Uint8Array([9]);

export const VIDEO_CAPABILITY: MediaKeySystemMediaCapability = { contentType: 'video/mp4; codecs="avc1.42E01E"' };

export const AUDIO_CAPABILITY: MediaKeySystemMediaCapability = { contentType: 'audio/mp4; codecs="mp4a.40.2"' };

export const CONFIG: MediaKeySystemConfiguration = {
  initDataTypes: ['cenc'],
  videoCapabilities: [VIDEO_CAPABILITY],
  audioCapabilities: [AUDIO_CAPABILITY],
};

export const CLEARKEY_CONFIG: MediaKeySystemConfiguration = { ...CONFIG, initDataTypes: ['keyids'] };

/** Resolves with the next event of `type` dispatched at `target`. */
export function nextEvent<T extends Event = Event>(
  target: Pick<EventTarget, 'addEventListener'>,
  type: string,
): Promise<T> {
  return new Promise((resolve) => {
    target.addEventListener(type, (event) => resolve(event as T));
  });
}

/** Resolves after the tasks queued so far, such as the fake CDM's events, have run. */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return bytes.toHex();
}

export function createVideo(): HTMLVideoElement {
  const video = document.createElement('video');
  document.body.appendChild(video);
  return video;
}

export async function createMediaKeys(keySystem = WIDEVINE): Promise<MediaKeys> {
  let config = CONFIG;
  if (keySystem === CLEARKEY) {
    config = CLEARKEY_CONFIG;
  }
  const access = await navigator.requestMediaKeySystemAccess(keySystem, [config]);
  return access.createMediaKeys();
}

/** MediaKeys attached to a new video element. */
export async function attachedMediaKeys(
  keySystem = WIDEVINE,
): Promise<{ video: HTMLVideoElement; mediaKeys: MediaKeys }> {
  const video = createVideo();
  const mediaKeys = await createMediaKeys(keySystem);
  await video.setMediaKeys(mediaKeys);
  return { video, mediaKeys };
}

/** A Widevine session that generated a license request for `kids`. */
export async function generatedSession(kids = [KID]): Promise<{ video: HTMLVideoElement; session: MediaKeySession }> {
  const { video, mediaKeys } = await attachedMediaKeys();
  const session = mediaKeys.createSession();
  const initData = pssh(WIDEVINE_SYSTEM_ID, kids);
  await session.generateRequest('cenc', initData);
  await nextTask();
  return { video, session };
}

/** A Widevine session with a license for `kids`. */
export async function licensedSession(kids = [KID]): Promise<{ video: HTMLVideoElement; session: MediaKeySession }> {
  const { video, session } = await generatedSession(kids);
  await session.update(LICENSE);
  return { video, session };
}

/** Builds a `pssh` box. */
export function pssh(
  systemIdHex: string,
  kids: Uint8Array[],
  data = new Uint8Array(0),
  version = 1,
): Uint8Array<ArrayBuffer> {
  let size = 32 + data.length;
  if (version) {
    size += 4 + kids.length * 16;
  }
  const box = new Uint8Array(size);
  const view = new DataView(box.buffer);
  view.setUint32(0, size);
  box.set([0x70, 0x73, 0x73, 0x68], 4);
  box[8] = version;
  const systemId = Uint8Array.fromHex(systemIdHex);
  box.set(systemId, 12);
  let offset = 28;
  if (version) {
    view.setUint32(offset, kids.length);
    offset += 4;
    for (const kid of kids) {
      box.set(kid, offset);
      offset += 16;
    }
  }
  view.setUint32(offset, data.length);
  box.set(data, offset + 4);
  return box;
}

/** Builds a PlayReady Object with one rights management header record. */
export function playReadyObject(xml: string): Uint8Array<ArrayBuffer> {
  const record = new Uint8Array(xml.length * 2);
  for (let i = 0; i < xml.length; i++) {
    record[i * 2] = xml.charCodeAt(i);
  }
  const data = new Uint8Array(10 + record.length);
  const view = new DataView(data.buffer);
  view.setUint32(0, data.length, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 1, true);
  view.setUint16(8, record.length, true);
  data.set(record, 10);
  return data;
}

/** Builds `keyids` init data. */
export function keyIdsInitData(kids: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const encodedKids = kids.map((kid) => kid.toBase64({ alphabet: 'base64url', omitPadding: true }));
  const json = JSON.stringify({ kids: encodedKids });
  return new TextEncoder().encode(json);
}

/** Builds a ClearKey license with the same key for each of `kids`. */
export function clearKeyLicense(kids: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const keys = kids.map((kid) => ({
    kty: 'oct',
    k: 'AAECAwQFBgcICQoLDA0ODw',
    kid: kid.toBase64({ alphabet: 'base64url', omitPadding: true }),
  }));
  const json = JSON.stringify({ keys });
  return new TextEncoder().encode(json);
}
