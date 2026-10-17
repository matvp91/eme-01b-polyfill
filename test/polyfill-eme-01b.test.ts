import { afterEach, describe, expect, it, vi } from 'vitest';
import { install, isInstalled } from '../src';

async function freshInstall(): Promise<boolean> {
  vi.resetModules();
  const polyfill = await import('../src/polyfill-eme-01b');
  return polyfill.install();
}

describe('install()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('installs the polyfill, and keeps reporting true', () => {
    const installed = isInstalled();
    const installedAgain = install();
    expect(installed).toBe(true);
    expect(installedAgain).toBe(true);
  });

  it('replaces requestMediaKeySystemAccess and setMediaKeys', () => {
    expect(typeof navigator.requestMediaKeySystemAccess).toBe('function');
    expect(typeof HTMLMediaElement.prototype.setMediaKeys).toBe('function');
    expect(HTMLMediaElement.prototype.mediaKeys).toBeNull();
  });

  it('does nothing on platforms with unprefixed EME', async () => {
    // The polyfill installed for the other tests looks just like native EME.
    const installed = await freshInstall();
    expect(installed).toBe(false);
  });

  it('does nothing on platforms without EME v0.1b', async () => {
    const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
    const globals = window as unknown as Record<string, unknown>;
    const saved = {
      requestMediaKeySystemAccess: navigator.requestMediaKeySystemAccess,
      mediaKeySystemAccess: globals.MediaKeySystemAccess,
      webkitGenerateKeyRequest: proto.webkitGenerateKeyRequest,
    };
    delete (navigator as unknown as Record<string, unknown>).requestMediaKeySystemAccess;
    delete globals.MediaKeySystemAccess;
    delete proto.webkitGenerateKeyRequest;
    try {
      const installed = await freshInstall();
      expect(installed).toBe(false);
    } finally {
      navigator.requestMediaKeySystemAccess = saved.requestMediaKeySystemAccess;
      globals.MediaKeySystemAccess = saved.mediaKeySystemAccess;
      proto.webkitGenerateKeyRequest = saved.webkitGenerateKeyRequest;
    }
  });
});
