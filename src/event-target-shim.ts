/**
 * `new EventTarget()` needs Chrome 64 and can't be polyfilled, so this delegates
 * to a detached DOM node, which gives native dispatch semantics. Differences
 * from a real EventTarget:
 * - `event.target`, `event.currentTarget` and `this` in listeners are that node.
 * - Before Chrome 49 an options object counts as `useCapture: true`, and
 *   `once` / `passive` are ignored, as for any EventTarget on those engines.
 */
export class EventTargetShim {
  private node_: Node = document.createTextNode('');

  /**
   * Adds an event listener.
   *
   * @param type - The event type.
   * @param listener - The listener; `null` is ignored.
   * @param options - Capture flag or options, as far as the engine supports them.
   */
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.node_.addEventListener(type, listener, options);
  }

  /**
   * Removes an event listener added with the same type, listener and capture flag.
   *
   * @param type - The event type.
   * @param listener - The listener; `null` is ignored.
   * @param options - Capture flag or options, as far as the engine supports them.
   */
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    this.node_.removeEventListener(type, listener, options);
  }

  /**
   * Dispatches an event to the listeners.
   *
   * @param event - The event, which must not have been dispatched before.
   * @returns `false` if a listener called `preventDefault()` on a cancelable event.
   */
  dispatchEvent(event: Event): boolean {
    return this.node_.dispatchEvent(event);
  }
}
