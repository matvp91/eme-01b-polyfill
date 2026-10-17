import { MediaKeys } from './media-keys';
import { getVideoElement } from './utils';

/** Access to a key system, as returned by `navigator.requestMediaKeySystemAccess()`. */
export class MediaKeySystemAccess {
  /** The key system as requested, e.g. `org.w3.clearkey` rather than v0.1b's `webkit-org.w3.clearkey`. */
  readonly keySystem: string;

  private internalKeySystem_: string;

  private configuration_!: MediaKeySystemConfiguration;

  /**
   * Picks the first configuration the platform supports, using v0.1b's
   * `canPlayType()` check.
   *
   * @param keySystem - The key system to access.
   * @param supportedConfigurations - The configurations to try, in order of preference.
   * @throws A `NotSupportedError` DOMException when no configuration is supported.
   */
  constructor(keySystem: string, supportedConfigurations: MediaKeySystemConfiguration[]) {
    this.keySystem = keySystem;
    this.internalKeySystem_ = keySystem;
    if (keySystem === 'org.w3.clearkey') {
      // v0.1b prefixes ClearKey's name.
      this.internalKeySystem_ = 'webkit-org.w3.clearkey';
    }

    const video = getVideoElement();

    // v0.1b checks key system support through an extra canPlayType() argument.
    const canPlayType = video.canPlayType as (type: string, keySystem: string) => CanPlayTypeResult;
    const canPlay = (contentType: string) => !!canPlayType.call(video, contentType, this.internalKeySystem_);

    for (const config of supportedConfigurations) {
      const newConfig: MediaKeySystemConfiguration = {
        audioCapabilities: [],
        videoCapabilities: [],
        // v0.1b can't tell us these, so (against spec) report them as optional
        // and the requested init data types as supported.
        persistentState: 'optional',
        distinctiveIdentifier: 'optional',
        initDataTypes: config.initDataTypes,
        sessionTypes: ['temporary'],
        label: config.label,
      };

      // Per spec, each requested capability list needs at least one match.
      let ranAudioTests = false;
      let ranVideoTests = false;
      for (const capability of config.audioCapabilities || []) {
        if (capability.contentType) {
          ranAudioTests = true;
          // Chrome <= 40 reports Widevine audio as unsupported when codecs are given.
          const [mimeType] = capability.contentType.split(';');
          if (canPlay(mimeType)) {
            newConfig.audioCapabilities?.push(capability);
          }
        }
      }
      for (const capability of config.videoCapabilities || []) {
        if (capability.contentType) {
          ranVideoTests = true;
          if (canPlay(capability.contentType)) {
            newConfig.videoCapabilities?.push(capability);
          }
        }
      }

      let success: boolean;
      if (!ranAudioTests && !ranVideoTests) {
        success = canPlay('video/mp4') || canPlay('video/webm');
      } else {
        success =
          (!ranAudioTests || !!newConfig.audioCapabilities?.length) &&
          (!ranVideoTests || !!newConfig.videoCapabilities?.length);
      }
      // v0.1b can't tell whether persistence works.
      if (config.persistentState === 'required') {
        success = false;
      }
      // v0.1b has no session types.
      if (config.sessionTypes?.some((type) => type !== 'temporary')) {
        success = false;
      }

      if (success) {
        this.configuration_ = newConfig;
        return;
      }
    }

    let message = 'Unsupported keySystem';
    if (keySystem === 'org.w3.clearkey' || keySystem === 'com.widevine.alpha') {
      message = 'None of the requested configurations were supported.';
    }
    throw new DOMException(message, 'NotSupportedError');
  }

  /**
   * Creates MediaKeys for this key system.
   *
   * @returns A promise for the new MediaKeys.
   */
  createMediaKeys(): Promise<MediaKeys> {
    const mediaKeys = new MediaKeys(this.internalKeySystem_);
    return Promise.resolve(mediaKeys);
  }

  /**
   * Returns the configuration that was picked.
   *
   * @returns The picked configuration, limited to the supported capabilities.
   *   Persistent state and distinctive identifier are always reported as
   *   `optional`, as v0.1b can't tell.
   */
  getConfiguration(): MediaKeySystemConfiguration {
    return this.configuration_;
  }
}
