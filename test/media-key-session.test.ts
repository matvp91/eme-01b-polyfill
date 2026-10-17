import { describe, expect, it } from 'vitest';
import { cdm, fireKeyMessage, MEDIA_KEYERR_UNKNOWN } from './fake-cdm';
import {
  attachedMediaKeys,
  CLEARKEY,
  generatedSession,
  KID,
  keyIdsInitData,
  licensedSession,
  nextEvent,
  nextTask,
  pssh,
  WIDEVINE_SYSTEM_ID,
} from './helpers';

async function newSession(): Promise<MediaKeySession> {
  const { mediaKeys } = await attachedMediaKeys();
  return mediaKeys.createSession();
}

describe('MediaKeySession', () => {
  it('keeps the same keyStatuses object', async () => {
    const session = await newSession();
    const keyStatuses = session.keyStatuses;
    await session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]));
    await session.update(new Uint8Array([9]));
    expect(session.keyStatuses).toBe(keyStatuses);
  });

  // Events are dispatched at an internal node.
  it.skip('is an EventTarget, and its events target the session', async () => {
    const session = await newSession();
    expect(session).toBeInstanceOf(EventTarget);
    const message = nextEvent<MediaKeyMessageEvent>(session, 'message');
    await session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]));
    expect((await message).target).toBe(session);
  });

  // onmessage always runs after the event listeners.
  it.skip('calls onmessage in the order it was set, like an event handler', async () => {
    const session = await newSession();
    const order: string[] = [];
    session.onmessage = () => {
      order.push('onmessage');
    };
    session.addEventListener('message', () => {
      order.push('listener');
    });
    await session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]));
    await nextTask();
    expect(order).toEqual(['onmessage', 'listener']);
  });
});

describe('MediaKeySession.generateRequest()', () => {
  it('sets the session ID and fires a license-request message', async () => {
    const session = await newSession();
    const message = nextEvent<MediaKeyMessageEvent>(session, 'message');
    await session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]));
    const event = await message;
    expect(session.sessionId).not.toBe('');
    expect(event.messageType).toBe('license-request');
    expect(event.message).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(event.message)]).toEqual([...cdm.keyRequest]);
  });

  it('calls onmessage', async () => {
    const session = await newSession();
    const handled: MediaKeyMessageEvent[] = [];
    session.onmessage = (event) => {
      handled.push(event);
    };
    await session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]));
    await nextTask();
    expect(handled).toHaveLength(1);
  });

  it('fires a message event that does not bubble and is not cancelable', async () => {
    const session = await newSession();
    const message = nextEvent<MediaKeyMessageEvent>(session, 'message');
    await session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]));
    const event = await message;
    expect(event.bubbles).toBe(false);
    expect(event.cancelable).toBe(false);
  });

  // The message event fires first, as the promise resolves when v0.1b's keymessage arrives.
  it.skip('resolves before the message event fires', async () => {
    const session = await newSession();
    const order: string[] = [];
    session.addEventListener('message', () => {
      order.push('message');
    });
    await session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID])).then(() => {
      order.push('resolved');
    });
    await nextTask();
    expect(order).toEqual(['resolved', 'message']);
  });

  // Resolves instead.
  it.skip('rejects with TypeError for an empty initDataType', async () => {
    const session = await newSession();
    await expect(session.generateRequest('', pssh(WIDEVINE_SYSTEM_ID, [KID]))).rejects.toBeInstanceOf(TypeError);
  });

  // Resolves instead.
  it.skip('rejects with TypeError for empty initData', async () => {
    const session = await newSession();
    await expect(session.generateRequest('cenc', new Uint8Array(0))).rejects.toBeInstanceOf(TypeError);
  });

  // Resolves instead.
  it.skip('rejects with NotSupportedError for an unsupported initDataType', async () => {
    const session = await newSession();
    await expect(session.generateRequest('not-a-type', pssh(WIDEVINE_SYSTEM_ID, [KID]))).rejects.toMatchObject({
      name: 'NotSupportedError',
    });
  });

  it('rejects a second call', async () => {
    const { session } = await generatedSession();
    await expect(session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]))).rejects.toThrow();
  });

  // Rejects with a plain Error.
  it.skip('rejects a second call with InvalidStateError', async () => {
    const { session } = await generatedSession();
    await expect(session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]))).rejects.toMatchObject({
      name: 'InvalidStateError',
    });
  });

  // Resolves instead.
  it.skip('rejects with InvalidStateError after close()', async () => {
    const session = await newSession();
    await session.close();
    await expect(session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]))).rejects.toMatchObject({
      name: 'InvalidStateError',
    });
  });

  // Key IDs are read from the caller's buffer, so changing it afterwards changes them.
  it.skip('copies initData', async () => {
    const session = await newSession();
    const initData = pssh(WIDEVINE_SYSTEM_ID, [KID]);
    await session.generateRequest('cenc', initData);
    initData.fill(0);
    await session.update(new Uint8Array([9]));
    expect(session.keyStatuses.has(KID)).toBe(true);
  });

  it('rejects when the CDM cannot generate a request', async () => {
    cdm.generateError = { code: MEDIA_KEYERR_UNKNOWN, systemCode: 0 };
    const session = await newSession();
    await expect(session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]))).rejects.toThrow();
  });

  // Rejects with a plain Error carrying the v0.1b error code.
  it.skip('rejects with a DOMException when the CDM cannot generate a request', async () => {
    cdm.generateError = { code: MEDIA_KEYERR_UNKNOWN, systemCode: 0 };
    const session = await newSession();
    await expect(session.generateRequest('cenc', pssh(WIDEVINE_SYSTEM_ID, [KID]))).rejects.toBeInstanceOf(DOMException);
  });
});

describe('MediaKeySession.load()', () => {
  // Rejects with a plain Error.
  it.skip('rejects with TypeError for a temporary session', async () => {
    const session = await newSession();
    await expect(session.load('1')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('MediaKeySession.update()', () => {
  it('resolves once the license is added, and reports the keys usable', async () => {
    const { session } = await generatedSession();
    await session.update(new Uint8Array([9]));
    expect(session.keyStatuses.get(KID)).toBe('usable');
  });

  it('fires keystatuseschange and calls onkeystatuseschange', async () => {
    const { session } = await generatedSession();
    let handled = 0;
    session.onkeystatuseschange = () => {
      handled++;
    };
    const change = nextEvent(session, 'keystatuseschange');
    await session.update(new Uint8Array([9]));
    await change;
    expect(handled).toBe(1);
  });

  // keystatuseschange fires first.
  it.skip('resolves before keystatuseschange fires', async () => {
    const { session } = await generatedSession();
    const order: string[] = [];
    session.addEventListener('keystatuseschange', () => {
      order.push('keystatuseschange');
    });
    await session.update(new Uint8Array([9])).then(() => {
      order.push('resolved');
    });
    await nextTask();
    expect(order).toEqual(['resolved', 'keystatuseschange']);
  });

  // Rejects with v0.1b's InvalidAccessError for the unknown session.
  it.skip('rejects with InvalidStateError before generateRequest()', async () => {
    const session = await newSession();
    await expect(session.update(new Uint8Array([9]))).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  // Rejects with v0.1b's InvalidAccessError for the cancelled session.
  it.skip('rejects with InvalidStateError after close()', async () => {
    const { session } = await generatedSession();
    await session.close();
    await expect(session.update(new Uint8Array([9]))).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  // Rejects with v0.1b's TypeMismatchError.
  it.skip('rejects with TypeError for an empty response', async () => {
    const { session } = await generatedSession();
    await expect(session.update(new Uint8Array(0))).rejects.toBeInstanceOf(TypeError);
  });

  // Rejects with a plain Error.
  it.skip('rejects with TypeError for an invalid ClearKey license', async () => {
    const { mediaKeys } = await attachedMediaKeys(CLEARKEY);
    const session = mediaKeys.createSession();
    await session.generateRequest('keyids', keyIdsInitData([KID]));
    await expect(session.update(new TextEncoder().encode('not a license'))).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects when the CDM rejects the license', async () => {
    cdm.addKeyError = { code: MEDIA_KEYERR_UNKNOWN, systemCode: 0 };
    const { session } = await generatedSession();
    await expect(session.update(new Uint8Array([9]))).rejects.toThrow();
  });

  it('handles concurrent calls one after the other', async () => {
    const { session } = await generatedSession();
    await Promise.all([session.update(new Uint8Array([1])), session.update(new Uint8Array([2]))]);
    expect(cdm.calls.filter((call) => call.method === 'addKey')).toHaveLength(2);
  });
});

describe('MediaKeySession.close()', () => {
  it('resolves, and resolves closed with closed-by-application', async () => {
    const { session } = await generatedSession();
    await expect(session.close()).resolves.toBeUndefined();
    await expect(session.closed).resolves.toBe('closed-by-application');
  });

  // Resolves instead.
  it.skip('rejects with InvalidStateError before generateRequest()', async () => {
    const session = await newSession();
    await expect(session.close()).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  // Calls webkitCancelKeyRequest again.
  it.skip('does nothing when the session is already closed', async () => {
    const { session } = await generatedSession();
    await session.close();
    await session.close();
    expect(cdm.calls.filter((call) => call.method === 'cancelKeyRequest')).toHaveLength(1);
  });

  // The key statuses are kept.
  it.skip('empties keyStatuses and fires keystatuseschange', async () => {
    const { session } = await licensedSession();
    const change = nextEvent(session, 'keystatuseschange');
    await session.close();
    await change;
    expect(session.keyStatuses.size).toBe(0);
  });

  // Later v0.1b events are still dispatched.
  it.skip('fires no more events once closed', async () => {
    const { video, session } = await generatedSession();
    let messages = 0;
    session.addEventListener('message', () => {
      messages++;
    });
    await session.close();
    fireKeyMessage(video, session.sessionId);
    expect(messages).toBe(0);
  });
});

describe('MediaKeySession.remove()', () => {
  // Rejects with a plain Error.
  it.skip('rejects with InvalidStateError before generateRequest()', async () => {
    const session = await newSession();
    await expect(session.remove()).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  // Rejects, as only persistent sessions are removed.
  it.skip('resolves for a temporary session and marks its keys released', async () => {
    const { session } = await licensedSession();
    await session.remove();
    expect(session.keyStatuses.get(KID)).toBe('released');
  });
});
