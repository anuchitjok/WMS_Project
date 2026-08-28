'use client';

// Client for the existing socket.io gateway (backend/src/realtime).
//
// The gateway broadcasts coarse "something changed" events — `inventory:update`
// and `request:update` — and the payloads are NOT consistent: only some carry a
// stock item, most carry just a refNumber or taskId, and relocating stock emits
// nothing at all. So this hook deliberately does not try to interpret payloads.
// It debounces the events into a single "go re-read your data" signal, and the
// caller re-fetches through the normal authenticated REST API.
//
// That also keeps the socket from being a data channel: the gateway has no auth
// and broadcasts to every connected client, so nothing here trusts it for
// content — only for timing.

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || '';

export interface RealtimeOptions {
  /** Coalesce bursts (a receiving run fires many events) into one refresh. */
  debounceMs?: number;
  /** Belt-and-braces poll, in case an event is missed or never sent at all. */
  pollMs?: number;
  enabled?: boolean;
}

/**
 * Calls `onSignal` when the server reports a change, and on a slow fallback
 * timer. Both are debounced together, so a burst of events plus a due poll
 * still results in a single refresh.
 */
export function useRealtime(
  events: string[],
  onSignal: () => void,
  { debounceMs = 1200, pollMs = 60_000, enabled = true }: RealtimeOptions = {},
) {
  // Keep the callback in a ref so re-renders don't tear down the socket.
  const cb = useRef(onSignal);
  cb.current = onSignal;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventKey = events.join(',');

  useEffect(() => {
    if (!enabled) return;

    const fire = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => cb.current(), debounceMs);
    };

    let socket: Socket | null = null;
    if (SOCKET_URL) {
      // Namespace and transport match the gateway (@WebSocketGateway namespace '/ws').
      socket = io(`${SOCKET_URL}/ws`, {
        transports: ['websocket', 'polling'],
        reconnectionDelay: 2_000,
        reconnectionDelayMax: 30_000,
        timeout: 8_000,
      });
      // A dropped socket must not stall the UI — the poll below still runs, so a
      // failed connection degrades to periodic refresh rather than stale data.
      socket.on('connect_error', () => {});
      for (const e of events) socket.on(e, fire);
    }

    // Fallback poll. Skipped while the tab is hidden: a background tab does not
    // need refreshing, and the API is behind a 100 req/min throttle.
    const poll = pollMs > 0
      ? setInterval(() => { if (!document.hidden) fire(); }, pollMs)
      : null;

    // Coming back to the tab is exactly when the data is most likely stale.
    const onVisible = () => { if (!document.hidden) fire(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (poll) clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      if (socket) {
        for (const e of events) socket.off(e, fire);
        socket.disconnect();
      }
    };
    // `events` is compared by content via eventKey so a new array literal on
    // each render does not reconnect the socket every time.
  }, [eventKey, debounceMs, pollMs, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
