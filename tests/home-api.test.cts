import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createHomeApi } from '../native/home-api.cjs';

interface Reply {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  text: string;
}

test('Home bridge rejects web origins, rebinding, missing tokens, oversized bodies and arbitrary commands', async (t) => {
  const calls: [string, unknown][] = [];
  const token = 'a'.repeat(64);
  let beats = 0;
  const server = createHomeApi({
    token: () => token,
    main: (action, value) => {
      calls.push([action, value]);
      return Promise.resolve({ ok: true });
    },
    heartbeat: () => {
      beats++;
    },
    port: 0,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  function request(
    body: unknown,
    headers: http.OutgoingHttpHeaders = {},
    method = 'POST',
  ): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const r = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/action',
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Origin: 'null',
            ...headers,
          },
        },
        (res) => {
          let text = '';
          res.on('data', (b: Buffer) => {
            text += b.toString();
          });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        },
      );
      r.on('error', reject);
      r.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  }
  assert.equal(
    (await request({ action: 'state' }, { Origin: 'https://attacker.invalid' })).status,
    403,
  );
  assert.equal((await request({ action: 'state' }, { Host: 'attacker.invalid' })).status, 403);
  assert.equal((await request({ action: 'state' }, { Authorization: '' })).status, 401);
  assert.equal((await request({ action: 'exec', value: 'reboot' })).status, 400);
  assert.equal((await request('x'.repeat(65537))).status, 413);
  assert.equal(calls.length, 0);
  const ok = await request({ action: 'state' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['access-control-allow-origin'], 'null');
  assert.equal(calls.length, 1);
  await request({ action: 'homeHeartbeat' });
  assert.equal(beats, 1);
  const cors = await request(
    '',
    {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type',
    },
    'OPTIONS',
  );
  assert.equal(cors.status, 204);
});
