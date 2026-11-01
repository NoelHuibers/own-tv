import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';

export interface HomeApiOptions {
  /** The bridge token the dashboard must present. */
  readonly token: () => string;
  readonly main: (action: string, value: unknown) => Promise<unknown>;
  readonly heartbeat: (value: unknown) => void;
  readonly port?: number;
}

const ACTIONS = new Set([
  'state',
  'launch',
  'sleep',
  'screenOff',
  'lgHome',
  'settings',
  'preferences',
  'configure',
  'weather',
  'firmwareCheck',
  'releaseIdleApps',
  'memoryMode',
  'weatherSearch',
  'weatherDetails',
  'radar',
  'weatherSource',
  'calendarCatalog',
  'calendarSource',
  'directHome',
  'homeHeartbeat',
  'homePing',
]);
export const PORT = 18766;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

export function createHomeApi({
  token,
  main,
  heartbeat,
  port = PORT,
}: HomeApiOptions): http.Server {
  let pending = 0;
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    function reply(status: number, data: unknown): void {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(origin === 'null' ? { 'Access-Control-Allow-Origin': 'null', Vary: 'Origin' } : {}),
      });
      res.end(JSON.stringify(data));
    }
    const address = server.address();
    const listening = typeof address === 'object' && address !== null ? address.port : undefined;
    if (host !== `127.0.0.1:${listening || port}` || (origin !== undefined && origin !== 'null')) {
      return reply(403, { ok: false, error: 'Untrusted origin' });
    }
    if (req.url !== '/action') {
      return reply(404, { ok: false, error: 'Not found' });
    }
    if (req.method === 'OPTIONS') {
      const requested = String(req.headers['access-control-request-headers'] || '')
        .toLowerCase()
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (
        origin !== 'null' ||
        req.headers['access-control-request-method'] !== 'POST' ||
        requested.some((h) => !['authorization', 'content-type'].includes(h))
      ) {
        return reply(403, { ok: false });
      }
      res.writeHead(204, {
        'Access-Control-Allow-Origin': 'null',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Private-Network': 'true',
        Vary: 'Origin',
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    const actual = Buffer.from(String(req.headers.authorization || ''));
    const expected = Buffer.from(`Bearer ${token()}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return reply(401, { ok: false, error: 'Unauthorized' });
    }
    if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') {
      return reply(400, { ok: false, error: 'JSON POST required' });
    }
    if (pending >= 8) {
      return reply(429, { ok: false, error: 'Try again shortly' });
    }
    pending++;
    let size = 0;
    let body = '';
    let rejected = false;
    let finished = false;
    function finish(): void {
      if (!finished) {
        finished = true;
        pending--;
      }
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) {
        if (!rejected) {
          rejected = true;
          reply(413, { ok: false, error: 'Request too large' });
        }
        return;
      }
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        if (rejected) {
          return;
        }
        const data: unknown = JSON.parse(body);
        const action = field(data, 'action');
        if (!data || typeof action !== 'string' || !ACTIONS.has(action)) {
          return reply(400, { ok: false, error: 'Unknown action' });
        }
        if (action === 'homeHeartbeat') {
          heartbeat(field(data, 'value'));
          return reply(200, { ok: true });
        }
        if (action === 'homePing') {
          return reply(200, { ok: true, service: 'own-tv-home' });
        }
        reply(200, await main(action, field(data, 'value')));
      } catch (e) {
        reply(400, {
          ok: false,
          error:
            e instanceof SyntaxError
              ? 'Invalid JSON'
              : field(e, 'message') || 'TV operation failed',
        });
      } finally {
        finish();
      }
    });
    req.on('error', finish);
    req.on('aborted', finish);
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
