/**
 * Unprefixed EME on top of webkit-prefixed EME v0.1b
 * (https://dvcs.w3.org/hg/html-media/raw-file/eme-v0.1b/encrypted-media/encrypted-media.html).
 */

import { MediaKeySystemAccess } from './media-key-system-access';
import { MediaKeys } from './media-keys';

let installed = false;

/**
 * Installs the polyfill when the platform has EME v0.1b but no unprefixed EME.
 * It replaces `navigator.requestMediaKeySystemAccess` and
 * `HTMLMediaElement.prototype.setMediaKeys`, and defines the `MediaKeys` and
 * `MediaKeySystemAccess` globals. Calling it again has no effect.
 *
 * @returns Whether the polyfill is installed.
 */
export function install(): boolean {
  if (installed) {
    return true;
  }
  if (!window.HTMLVideoElement) {
    return false;
  }
  // Chrome 42-43 have requestMediaKeySystemAccess but no getConfiguration; patch those too.
  if (
    'requestMediaKeySystemAccess' in navigator &&
    'MediaKeySystemAccess' in window &&
    'getConfiguration' in window.MediaKeySystemAccess.prototype
  ) {
    return false;
  }
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  if (!proto.webkitGenerateKeyRequest) {
    return false;
  }

  navigator.requestMediaKeySystemAccess =
    requestMediaKeySystemAccess as unknown as typeof navigator.requestMediaKeySystemAccess;
  // Replace the read-only `mediaKeys` accessor with a plain property.
  delete proto.mediaKeys;
  proto.mediaKeys = null;
  proto.setMediaKeys = setMediaKeys;
  const globals = window as unknown as Record<string, unknown>;
  globals.MediaKeys = MediaKeys;
  globals.MediaKeySystemAccess = MediaKeySystemAccess;

  installed = true;
  return true;
}

/**
 * Reports whether {@link install} has installed the polyfill.
 *
 * @returns Whether the polyfill is installed.
 */
export function isInstalled(): boolean {
  return installed;
}

/**
 * The polyfilled `navigator.requestMediaKeySystemAccess()`.
 *
 * Players may capture `navigator.requestMediaKeySystemAccess` when they load,
 * so either {@link install} before loading them, or pass them this function.
 *
 * @param keySystem - The key system, e.g. `com.widevine.alpha` or `org.w3.clearkey`.
 * @param supportedConfigurations - The configurations to try, in order of preference.
 * @returns A promise for access to the key system with the first supported
 *   configuration. Rejects with a `NotSupportedError` DOMException when none is supported.
 */
export function requestMediaKeySystemAccess(
  keySystem: string,
  supportedConfigurations: MediaKeySystemConfiguration[],
): Promise<MediaKeySystemAccess> {
  try {
    return Promise.resolve(new MediaKeySystemAccess(keySystem, supportedConfigurations));
  } catch (exception) {
    return Promise.reject(exception);
  }
}

function setMediaKeys(this: HTMLMediaElement, mediaKeys: MediaKeys | null): Promise<void> {
  const media = this as unknown as Record<string, unknown>;
  const oldMediaKeys = media.mediaKeys as MediaKeys | null;

  if (oldMediaKeys && oldMediaKeys !== mediaKeys) {
    oldMediaKeys.setMedia(null);
  }

  // Old engines define DOM attributes on the instance, shadowing our prototype property.
  delete media.mediaKeys;
  media.mediaKeys = mediaKeys;

  if (mediaKeys) {
    mediaKeys.setMedia(this);
  }

  return Promise.resolve();
}
