import { useEffect, useRef } from 'react';
import type { Frame } from './types';

// Keeps one WebSocket open for a workspace. After a drop it reconnects with
// `after=<last seq seen>`, so the server replays only what was missed, and any
// frame at or below the last seq is ignored.
export function useLive(workspace: string | null, onFrame: (f: Frame) => void): void {
  const handler = useRef(onFrame);
  handler.current = onFrame;

  useEffect(() => {
    if (!workspace) return;
    let last: number | null = null; // null: first connect, live only
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let delay = 500;
    let reconnected = false;

    const connect = () => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const after = last === null ? '' : `&after=${last}`;
      socket = new WebSocket(`${scheme}://${location.host}/ws?workspace=${encodeURIComponent(workspace)}${after}`);
      socket.onopen = () => {
        delay = 500;
        // After a drop the screen may be stale (e.g. nothing was seen before the
        // drop, so there was no seq to replay from): ask it to refresh once.
        if (reconnected) handler.current({ seq: -1, type: 'reconnected' });
        reconnected = true;
      };
      socket.onmessage = (m) => {
        const f = JSON.parse(String(m.data)) as Frame;
        if (typeof f.seq !== 'number' || (last !== null && f.seq <= last)) return;
        last = f.seq;
        handler.current(f);
      };
      socket.onclose = () => {
        if (stopped) return;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 8000);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [workspace]);
}
