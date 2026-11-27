import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { isMember, sessionFromRequest } from '../auth/middleware.js';
import { currentSeq } from './events.js';
import { startPump } from './pump.js';

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

// GET /ws?workspace=<id>[&after=<seq>]. Same session cookie as the API.
export function attachSockets(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') return refuse(socket, '404 Not Found');

      let session;
      try {
        session = await sessionFromRequest(req);
      } catch {
        return refuse(socket, '503 Service Unavailable');
      }
      if (!session) return refuse(socket, '401 Unauthorized');

      const workspace = url.searchParams.get('workspace');
      if (!workspace || !isMember(session, workspace)) return refuse(socket, '403 Forbidden');

      const afterParam = url.searchParams.get('after');
      if (afterParam !== null && !/^\d{1,15}$/.test(afterParam)) return refuse(socket, '400 Bad Request');

      let start: number;
      try {
        // No `after`: live only, from the current position.
        start = afterParam !== null ? Number(afterParam) : await currentSeq(workspace);
      } catch {
        return refuse(socket, '503 Service Unavailable');
      }
      wss.handleUpgrade(req, socket, head, (ws) => startPump(ws, workspace, start));
    })();
  });
}
