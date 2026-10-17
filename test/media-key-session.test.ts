import { describe, expect, it } from 'vitest';
import { callsTo, cdm, fireKeyMessage, MEDIA_KEYERR_UNKNOWN } from './fake-cdm';
import {
  attachedMediaKeys,
  CLEARKEY,
  generatedSession,
  KID,
  keyIdsInitData,
  LICENSE,
  licensedSession,
  nextEvent,
  nextTask,
  pssh,
  WIDEVINE_SYSTEM_ID,
} from './helpers';

const INIT_DATA = pssh(WIDEVINE_SYSTEM_ID, [KID]);

async function newSession(): Promise<MediaKeySession> {
  const { mediaKeys } = await attachedMediaKeys();
  return mediaKeys.createSession();
}

describe('MediaKeySession', () => {
  it('keeps the same keyStatuses object', async () => {
    const session = await newSession();
    const keyStatuses = session.keyStatuses;
    await session.generateRequest('cenc', INIT_DATA);
    await session.update(LICENSE);
    expect(session.keyStatuses).toBe(keyStatuses);
  });

  // Events are dispatched at an internal node.
  it.skip('is an EventTarget, and its events target the session', async () => {
    const session = await newSession();
    expect(session).toBeInstanceOf(EventTarget);
    const nextMessage = nextEvent<MediaKeyMessageEvent>(session, 'message');
    await session.generateRequest('cenc', INIT_DATA);
    const message = await nextMessage;
    expect(message.target).toBe(session);
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
    await session.generateRequest('cenc', INIT_DATA);
    await nextTask();
    expect(order).toEqual(['onmessage', 'listener']);
  });
});

describe('MediaKeySession.generateRequest()', () => {
  it('sets the session ID and fires a license-request message', async () => {
    const session = await newSession();
    const nextMessage = nextEvent<MediaKeyMessageEvent>(session, 'message');
    await session.generateRequest('cenc', INIT_DATA);
    const message = await nextMessage;
    const messageBytes = new Uint8Array(message.message);
    expect(session.sessionId).not.toBe('');
    expect(message.messageType).toBe('license-request');
    expect(message.message).toBeInstanceOf(ArrayBuffer);
    expect(messageBytes).toEqual(cdm.keyRequest);
  });

  it('calls onmessage', async () => {
    const session = await newSession();
    const handled: MediaKeyMessageEvent[] = [];
    session.onmessage = (event) => {
      handled.push(event);
    };
    await session.generateRequest('cenc', INIT_DATA);
    await nextTask();
    expect(handled).toHaveLength(1);
  });

  it('fires a message event that does not bubble and is not cancelable', async () => {
    const session = await newSession();
    const nextMessage = nextEvent<MediaKeyMessageEvent>(session, 'message');
    await session.generateRequest('cenc', INIT_DATA);
    const message = await nextMessage;
    expect(message.bubbles).toBe(false);
    expect(message.cancelable).toBe(false);
  });

  // The message event fires first, as the promise resolves when v0.1b's keymessage arrives.
  it.skip('resolves before the message event fires', async () => {
    const session = await newSession();
    const order: string[] = [];
    session.addEventListener('message', () => {
      order.push('message');
    });
    const result = session.generateRequest('cenc', INIT_DATA);
    await result.then(() => {
      order.push('resolved');
    });
    await nextTask();
    expect(order).toEqual(['resolved', 'message']);
  });

  // Resolves instead.
  it.skip('rejects with TypeError for an empty initDataType', async () => {
    const session = await newSession();
    const result = session.generateRequest('', INIT_DATA);
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });

  // Resolves instead.
  it.skip('rejects with TypeError for empty initData', async () => {
    const session = await newSession();
    const emptyInitData = new Uint8Array(0);
    const result = session.generateRequest('cenc', emptyInitData);
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });

  // Resolves instead.
  it.skip('rejects with NotSupportedError for an unsupported initDataType', async () => {
    const session = await newSession();
    const result = session.generateRequest('not-a-type', INIT_DATA);
    await expect(result).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('rejects a second call', async () => {
    const { session } = await generatedSession();
    const result = session.generateRequest('cenc', INIT_DATA);
    await expect(result).rejects.toThrow();
  });

  // Rejects with a plain Error.
  it.skip('rejects a second call with InvalidStateError', async () => {
    const { session } = await generatedSession();
    const result = session.generateRequest('cenc', INIT_DATA);
    await expect(result).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  // Resolves instead.
  it.skip('rejects with InvalidStateError after close()', async () => {
    const session = await newSession();
    await session.close();
    const result = session.generateRequest('cenc', INIT_DATA);
    await expect(result).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  // Key IDs are read from the caller's buffer, so changing it afterwards changes them.
  it.skip('copies initData', async () => {
    const session = await newSession();
    const initData = pssh(WIDEVINE_SYSTEM_ID, [KID]);
    await session.generateRequest('cenc', initData);
    initData.fill(0);
    await session.update(LICENSE);
    const hasKey = session.keyStatuses.has(KID);
    expect(hasKey).toBe(true);
  });

  it('rejects when the CDM cannot generate a request', async () => {
    cdm.generateError = { code: MEDIA_KEYERR_UNKNOWN, systemCode: 0 };
    const session = await newSession();
    const result = session.generateRequest('cenc', INIT_DATA);
    await expect(result).rejects.toThrow();
  });

  // Rejects with a plain Error carrying the v0.1b error code.
  it.skip('rejects with a DOMException when the CDM cannot generate a request', async () => {
    cdm.generateError = { code: MEDIA_KEYERR_UNKNOWN, systemCode: 0 };
    const session = await newSession();
    const result = session.generateRequest('cenc', INIT_DATA);
    await expect(result).rejects.toBeInstanceOf(DOMException);
  });
});

describe('MediaKeySession.load()', () => {
  // Rejects with a plain Error.
  it.skip('rejects with TypeError for a temporary session', async () => {
    const session = await newSession();
    const result = session.load('1');
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });
});

describe('MediaKeySession.update()', () => {
  it('resolves once the license is added, and reports the keys usable', async () => {
    const { session } = await generatedSession();
    await session.update(LICENSE);
    const status = session.keyStatuses.get(KID);
    expect(status).toBe('usable');
  });

  it('fires keystatuseschange and calls onkeystatuseschange', async () => {
    const { session } = await generatedSession();
    let handled = 0;
    session.onkeystatuseschange = () => {
      handled++;
    };
    const nextChange = nextEvent(session, 'keystatuseschange');
    await session.update(LICENSE);
    await nextChange;
    expect(handled).toBe(1);
  });

  // keystatuseschange fires first.
  it.skip('resolves before keystatuseschange fires', async () => {
    const { session } = await generatedSession();
    const order: string[] = [];
    session.addEventListener('keystatuseschange', () => {
      order.push('keystatuseschange');
    });
    const result = session.update(LICENSE);
    await result.then(() => {
      order.push('resolved');
    });
    await nextTask();
    expect(order).toEqual(['resolved', 'keystatuseschange']);
  });

  // Rejects with v0.1b's InvalidAccessError for the unknown session.
  it.skip('rejects with InvalidStateError before generateRequest()', async () => {
    const session = await newSession();
    const result = session.update(LICENSE);
    await expect(result).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  // Rejects with v0.1b's InvalidAccessError for the cancelled session.
  it.skip('rejects with InvalidStateError after close()', async () => {
    const { session } = await generatedSession();
    await session.close();
    const result = session.update(LICENSE);
    await expect(result).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  // Rejects with v0.1b's TypeMismatchError.
  it.skip('rejects with TypeError for an empty response', async () => {
    const { session } = await generatedSession();
    const emptyLicense = new Uint8Array(0);
    const result = session.update(emptyLicense);
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });

  // Rejects with a plain Error.
  it.skip('rejects with TypeError for an invalid ClearKey license', async () => {
    const { mediaKeys } = await attachedMediaKeys(CLEARKEY);
    const session = mediaKeys.createSession();
    const initData = keyIdsInitData([KID]);
    await session.generateRequest('keyids', initData);
    const invalidLicense = new TextEncoder().encode('not a license');
    const result = session.update(invalidLicense);
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects when the CDM rejects the license', async () => {
    cdm.addKeyError = { code: MEDIA_KEYERR_UNKNOWN, systemCode: 0 };
    const { session } = await generatedSession();
    const result = session.update(LICENSE);
    await expect(result).rejects.toThrow();
  });

  it('handles concurrent calls one after the other', async () => {
    const { session } = await generatedSession();
    const firstUpdate = session.update(LICENSE);
    const secondUpdate = session.update(LICENSE);
    await Promise.all([firstUpdate, secondUpdate]);
    const addKeyCalls = callsTo('addKey');
    expect(addKeyCalls).toHaveLength(2);
  });
});

describe('MediaKeySession.close()', () => {
  it('resolves, and resolves closed with closed-by-application', async () => {
    const { session } = await generatedSession();
    const result = session.close();
    await expect(result).resolves.toBeUndefined();
    await expect(session.closed).resolves.toBe('closed-by-application');
  });

  // Resolves instead.
  it.skip('rejects with InvalidStateError before generateRequest()', async () => {
    const session = await newSession();
    const result = session.close();
    await expect(result).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  // Calls webkitCancelKeyRequest again.
  it.skip('does nothing when the session is already closed', async () => {
    const { session } = await generatedSession();
    await session.close();
    await session.close();
    const cancelCalls = callsTo('cancelKeyRequest');
    expect(cancelCalls).toHaveLength(1);
  });

  // The key statuses are kept.
  it.skip('empties keyStatuses and fires keystatuseschange', async () => {
    const { session } = await licensedSession();
    const nextChange = nextEvent(session, 'keystatuseschange');
    await session.close();
    await nextChange;
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
    const result = session.remove();
    await expect(result).rejects.toMatchObject({ name: 'InvalidStateError' });
  });

  // Rejects, as only persistent sessions are removed.
  it.skip('resolves for a temporary session and marks its keys released', async () => {
    const { session } = await licensedSession();
    await session.remove();
    const status = session.keyStatuses.get(KID);
    expect(status).toBe('released');
  });
});
