// The local editor's boundary, without a TV or SSH credentials: Host, Origin and header
// checks, the request limits, index.html in editor mode, the static file root, and that a
// failed or slow SSH connection never reports the command or its payload.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ACTIONS, createEditor, editorIndex, invoke, translate } from '../tools/editor.mjs';
import { helperCommand, quote, shellJoin, sshArgs } from '../tools/ssh.mjs';

// Batch mode and the pinned host key, on every editor connection
// biome-ignore lint/security/noSecrets: ssh options, not a credential
const PINNED = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
const TAG = '<script src="app.js"></script>';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'own-tv-editor-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));

/** A built-dashboard stand-in, with a private file next to it that must stay unreachable. */
function fixtureApp(name: string, index: string): string {
  const app = path.join(temp, name);
  fs.mkdirSync(path.join(app, 'data'), { recursive: true });
  fs.writeFileSync(path.join(app, 'index.html'), index);
  fs.writeFileSync(path.join(app, 'app.js'), 'window.app = 1;');
  fs.writeFileSync(path.join(app, 'data/map.js'), 'window.map = 1;');
  fs.writeFileSync(path.join(temp, 'secret.txt'), 'private');
  return app;
}

interface Reply {
  status: number;
  type: string | undefined;
  body: string;
}

function request(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path ?? '/',
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            type: res.headers['content-type'],
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}

async function start(app: string, calls: unknown[][]): Promise<[http.Server, number]> {
  const server = createEditor({
    sshConfig: 'unused',
    host: 'unused',
    app,
    invoke: (...args) => {
      calls.push(args);
      return Promise.resolve({ ok: true });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return [server, (server.address() as AddressInfo).port];
}

describe('editor boundary', () => {
  const calls: unknown[][] = [];
  let server: http.Server;
  let port = 0;
  let origin = '';
  const action = (headers: Record<string, string>, body = '{"action":"state"}'): Promise<Reply> =>
    request(port, { method: 'POST', path: '/api/action', headers, body });

  before(async () => {
    const app = fixtureApp('app', `<html><head></head><body>${TAG}</body></html>`);
    [server, port] = await start(app, calls);
    origin = `http://127.0.0.1:${port}`;
  });
  after(() => server.close());

  it('refuses cross-site and DNS-rebinding requests', async () => {
    const cases: Record<string, string>[] = [
      {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.invalid',
        'X-OwnTV-Editor': '1',
      },
      {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-OwnTV-Editor': '1',
        Host: 'attacker.invalid',
      },
      { 'Content-Type': 'application/json', Origin: origin },
      { 'Content-Type': 'application/json', 'X-OwnTV-Editor': '1' },
      { 'Content-Type': 'application/json', Origin: origin, 'X-OwnTV-Editor': 'true' },
    ];
    for (const headers of cases) {
      const reply = await action(headers);
      assert.equal(reply.status, 403, JSON.stringify(headers));
      assert.deepEqual(JSON.parse(reply.body), { ok: false, error: 'Untrusted request' });
    }
    assert.deepEqual(calls, []);
  });

  it('runs a same-origin editor request', async () => {
    const reply = await action({
      'Content-Type': 'application/json',
      Origin: origin,
      'X-OwnTV-Editor': '1',
    });
    assert.equal(reply.status, 200);
    assert.equal(JSON.parse(reply.body).ok, true);
    assert.equal(calls[0]?.[2], 'state');
    assert.equal(calls[0]?.[3], undefined);
    const local = await action(
      {
        'Content-Type': 'application/json',
        Origin: `http://localhost:${port}`,
        Host: `localhost:${port}`,
        'X-OwnTV-Editor': '1',
      },
      '{"action":"configure","value":{"weather":null}}',
    );
    assert.equal(local.status, 200);
    assert.deepEqual(calls[1]?.slice(2), ['configure', { weather: null }]);
    calls.length = 0;
  });

  it('requires JSON of a bounded size', async () => {
    const trusted = { Origin: origin, 'X-OwnTV-Editor': '1' };
    const refused: [Record<string, string>, string, string][] = [
      [{ ...trusted, 'Content-Type': 'text/plain' }, '{"action":"state"}', 'JSON required'],
      [
        { ...trusted, 'Content-Type': 'application/json; charset=utf-8' },
        '{"action":"state"}',
        'JSON required',
      ],
      [{ ...trusted, 'Content-Type': 'application/json' }, '', 'Request too large'],
      [
        { ...trusted, 'Content-Type': 'application/json' },
        `{"action":"state","x":"${'a'.repeat(65_536)}"}`,
        'Request too large',
      ],
      [{ ...trusted, 'Content-Type': 'application/json' }, '[1]', 'JSON object required'],
    ];
    for (const [headers, body, error] of refused) {
      const reply = await action(headers, body);
      assert.equal(reply.status, 400);
      assert.equal(JSON.parse(reply.body).error, error);
    }
    const wrongPath = await request(port, {
      method: 'POST',
      path: '/api/other',
      headers: { ...trusted, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(wrongPath.status, 404);
    assert.deepEqual(calls, []);
  });

  it('checks the Host header on every page', async () => {
    for (const page of ['/', '/editor-mode.js', '/integrations', '/app.js']) {
      const reply = await request(port, { path: page, headers: { Host: 'attacker.invalid' } });
      assert.equal(reply.status, 403, page);
      assert.equal(JSON.parse(reply.body).error, 'Invalid host');
    }
    const api = await request(port, { path: '/api/action' });
    assert.equal(api.status, 405);
    const put = await request(port, { method: 'PUT', path: '/api/action', body: '{}' });
    assert.equal(put.status, 501);
  });

  it('serves the dashboard in editor mode', async () => {
    for (const page of ['/', '/index.html', '/?preview=sample']) {
      const index = await request(port, { path: page });
      assert.equal(index.status, 200);
      assert.match(
        index.body,
        /<script src="\/editor-mode\.js"><\/script><script src="app\.js"><\/script>/,
      );
    }
    const flag = await request(port, { path: '/editor-mode.js' });
    assert.equal(flag.body, 'window.OWN_TV_EDITOR=true;');
    assert.equal(flag.type, 'text/javascript');
    const integrations = await request(port, { path: '/integrations' });
    assert.match(integrations.body, /<h1>Private integrations<\/h1>/);
    assert.equal((await request(port, { path: '/app.js' })).body, 'window.app = 1;');
    assert.equal((await request(port, { path: '/data/map.js?v=1' })).body, 'window.map = 1;');
  });

  it('serves nothing outside the app and lists no directories', async () => {
    for (const page of [
      '/../secret.txt',
      '/..%2fsecret.txt',
      '/data/../../secret.txt',
      '/data/',
      '/missing.js',
      '/app.js/',
    ]) {
      const reply = await request(port, { path: page });
      assert.equal(reply.status, 404, page);
      assert.doesNotMatch(reply.body, /private|map\.js/);
    }
    const redirect = await request(port, { path: '/data' });
    assert.equal(redirect.status, 301);
  });
});

describe('editor index', () => {
  it('fails closed when index.html has no app.js tag', async () => {
    const app = fixtureApp(
      'untagged',
      `<html><body>${TAG.replace('app.js', 'other.js')}</body></html>`,
    );
    const [server, port] = await start(app, []);
    try {
      const reply = await request(port, { path: '/' });
      assert.equal(reply.status, 500);
      assert.doesNotMatch(reply.body, /other\.js/);
    } finally {
      server.close();
    }
  });

  it('injects the flag before every app.js tag only', () => {
    assert.equal(editorIndex('<p></p>'), null);
    assert.equal(
      editorIndex('<script src="app.js"></script>'),
      '<script src="/editor-mode.js"></script><script src="app.js"></script>',
    );
  });

  it('keeps request paths inside the root', () => {
    assert.equal(translate('/srv/app', '/a/../../b.js?x#y'), '/srv/app/a/b.js');
    assert.equal(translate('/srv/app', '/%2e%2e/%2e%2e/etc/passwd'), '/srv/app/etc/passwd');
    assert.equal(translate('/srv/app', '/data/'), '/srv/app/data/');
    assert.equal(translate('/srv/app', '/%00'), null);
    assert.equal(translate('/srv/app', '/%zz'), null);
  });
});

describe('editor SSH', () => {
  /** A stand-in for ssh: a Node script that receives ssh's arguments. */
  function fakeSsh(name: string, body: string): string {
    const file = path.join(temp, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
    return file;
  }
  const secret = { calendar: { feedUrl: 'https://calendar.example/secret.ics' } };

  it('reports a timeout without the SSH command or the subscription', async () => {
    const slow = fakeSsh('slow-ssh', 'setTimeout(() => {}, 30000);');
    const error: unknown = await invoke('unused', 'unused', 'configure', secret, {
      ssh: slow,
      timeout: 0.3,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(error instanceof Error);
    assert.match(error.message, /timed out/);
    const payload = helperCommand('configure', secret).split(' ').at(-1) ?? '';
    for (const leak of ['secret.ics', 'calendar.example', payload, 'helper.cjs', 'unused', slow]) {
      assert.ok(!error.message.includes(leak), leak);
    }
  });

  it('runs exactly one fixed helper command over pinned, batch-mode SSH', async () => {
    const echo = fakeSsh(
      'echo-ssh',
      'process.stdout.write(JSON.stringify({ ok: true, argv: process.argv.slice(2) }));',
    );
    const reply = (await invoke('/private/ssh_config', 'living-room', 'configure', secret, {
      ssh: echo,
    })) as {
      argv: string[];
    };
    const command = reply.argv.at(-1) ?? '';
    assert.deepEqual(reply.argv.slice(0, -1), [
      '-F',
      '/private/ssh_config',
      ...PINNED,
      'living-room',
    ]);
    const [node, helper, name, encoded = ''] = command.split(' ');
    assert.deepEqual(
      [node, helper, name],
      ['/usr/bin/node', '/var/lib/own-tv/helper.cjs', 'configure'],
    );
    assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), secret);
    const state = (await invoke('c', 'h', 'state', undefined, { ssh: echo })) as { argv: string[] };
    assert.equal(state.argv.at(-1), '/usr/bin/node /var/lib/own-tv/helper.cjs state');
  });

  it('refuses unknown actions before connecting', async () => {
    for (const action of ['shell', 'state; reboot', 42, null, ['state']]) {
      await assert.rejects(
        invoke('c', 'h', action, undefined, { ssh: '/nonexistent/ssh' }),
        /^Error: Unknown action$/,
      );
    }
    assert.ok(ACTIONS.has('directHome'));
    assert.equal(ACTIONS.size, 19);
  });

  it('turns helper failures into short errors', async () => {
    const failing = fakeSsh(
      'fail-ssh',
      'process.stdout.write(JSON.stringify({ ok: false, error: "No feed" }));',
    );
    await assert.rejects(
      invoke('c', 'h', 'state', undefined, { ssh: failing }),
      /^Error: No feed$/,
    );
    const broken = fakeSsh(
      'broken-ssh',
      'process.stderr.write("Permission denied"); process.exit(255);',
    );
    await assert.rejects(
      invoke('c', 'h', 'state', undefined, { ssh: broken }),
      /TV connection failed/,
    );
    const status = fakeSsh('status-ssh', 'process.stdout.write("{}"); process.exit(1);');
    await assert.rejects(
      invoke('c', 'h', 'state', undefined, { ssh: status }),
      /^Error: TV operation failed$/,
    );
    await assert.rejects(
      invoke('c', 'h', 'state', undefined, { ssh: '/nonexistent/ssh' }),
      /Could not run ssh/,
    );
  });
});

describe('shell quoting', () => {
  it('quotes like shlex.quote', () => {
    const cases: [string, string][] = [
      ['', "''"],
      ['state', 'state'],
      ['@%+=:,./-_Az09', '@%+=:,./-_Az09'],
      ['a b', "'a b'"],
      ["it's", `'it'"'"'s'`],
      ['$(id)', "'$(id)'"],
      ['`id`', "'`id`'"],
      ['a\nb', "'a\nb'"],
      ['caf\u00e9', "'caf\u00e9'"],
      ['~root', "'~root'"],
      ['*', "'*'"],
    ];
    for (const [word, quoted] of cases) {
      assert.equal(quote(word), quoted, word);
    }
  });

  it('joins like shlex.join', () => {
    assert.equal(
      shellJoin(['luna-send', '-n', '1', 'luna://com.webos.service/x', '{"id": "a\'b"}']),
      `luna-send -n 1 luna://com.webos.service/x '{"id": "a'"'"'b"}'`,
    );
  });

  it('forces a PTY only when asked', () => {
    assert.deepEqual(sshArgs('cfg', 'tv', 'cmd'), ['-F', 'cfg', ...PINNED, 'tv', 'cmd']);
    assert.deepEqual(sshArgs('cfg', 'tv', 'cmd', true).slice(0, 2), ['-tt', '-F']);
  });
});
