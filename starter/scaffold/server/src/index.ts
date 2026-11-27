import express from 'express';
import { createServer } from 'node:http';
import { config } from './config.js';
import { apiRoutes } from './api/routes.js';
import { authRoutes } from './auth/routes.js';
import { graderRoutes } from './grader/routes.js';
import { attachSockets } from './realtime/socket.js';
import { pigeonWebhook } from './pigeon/webhook.js';
import { getStores } from './pigeon/store.js';
import { startWorker } from './pigeon/worker.js';

const app = express();

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// No global body parser: the webhook needs the raw bytes for its signature.
// It parses its own body (express.raw), and the grader router parses its own JSON.
pigeonWebhook(app);
app.use(graderRoutes());
app.use(authRoutes());
app.use(apiRoutes());

// Everything else is yours.

// A plain http server, so you can attach WebSockets to it.
const server = createServer(app);
attachSockets(server);
server.listen(config.port, () => {
  console.log(`server on http://localhost:${config.port}`);
});

// Create indexes, then start the outbound worker (once per process).
getStores()
  .then(() => startWorker())
  .catch((err) => {
    console.error('startup failed', err);
    process.exit(1);
  });
