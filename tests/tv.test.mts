// tv.mts against a stand-in `ssh` placed first on PATH: the exact remote commands and ssh
// flags of every action, backup permissions, the repository and symlink refusals, and
// INIT_CWD path resolution. The stand-in only records and answers; nothing reaches a host
// (the host name is also under .invalid, which never resolves).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { bootstrap } from '../tools/bootstrap.mjs';
import { isInside, isMain, NATIVE, ROOT, realResolve, userPath } from '../tools/paths.mjs';
import { CommandError, TimeoutError } from '../tools/ssh.mjs';
import { APP_ID, cli, HELPERS, TV } from '../tools/tv.mjs';

const HOST = 'fake-tv.invalid';
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'own-tv-tv-')));
const bin = path.join(temp, 'bin');
const fake = path.join(temp, 'fake');
const CONFIG = path.join(temp, 'private/ssh_config');
// biome-ignore lint/security/noSecrets: ssh options, not a credential
const PINNED = ['-F', CONFIG, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', HOST];

/**
 * The stand-in for ssh. It logs its arguments and stdin, then answers like the TV: canned
 * replies from replies.json first, then defaults that keep Home state in a file.
 */
const SSH = `#!${process.execPath}
'use strict';
const fs = require('fs');
const path = require('path');
const dir = process.env.OWN_TV_FAKE_SSH;
if (!dir) { process.stderr.write('fake ssh: OWN_TV_FAKE_SSH is not set'); process.exit(255); }
const argv = process.argv.slice(2);
const cmd = argv[argv.length - 1] || '';
let stdin = Buffer.alloc(0);
if (/cat >|tar -xf -/.test(cmd)) {
  const parts = [];
  const chunk = Buffer.alloc(65536);
  for (;;) {
    let n = 0;
    try { n = fs.readSync(0, chunk); } catch (e) {
      if (e.code === 'EAGAIN') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2); continue; }
      if (e.code === 'EOF') break;
      throw e;
    }
    if (!n) break;
    parts.push(Buffer.from(chunk.subarray(0, n)));
  }
  stdin = Buffer.concat(parts);
}
fs.appendFileSync(path.join(dir, 'log.jsonl'), JSON.stringify({ argv, stdin: stdin.toString('base64') }) + '\\n');
const file = (name) => path.join(dir, name);
const replies = fs.existsSync(file('replies.json')) ? JSON.parse(fs.readFileSync(file('replies.json'), 'utf8')) : [];
const reply = replies.find((r) => cmd.includes(r.match));
if (reply) {
  if (reply.sleep) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, reply.sleep);
  process.stdout.write(reply.stdout || '');
  process.stderr.write(reply.stderr || '');
  process.exit(reply.status || 0);
}
const home = () => (fs.existsSync(file('home')) ? fs.readFileSync(file('home'), 'utf8') : 'com.webos.app.home');
const out = (s) => process.stdout.write(s);
if (cmd.includes('getSystemSettings')) out('Luna noise\\r\\n{"returnValue":true,"settings":{"defaultApps":{"home":"' + home() + '","other":"x\\u00e9"}}}\\r\\n');
else if (cmd.includes('setSystemSettings')) { fs.writeFileSync(file('home'), /"home":"([^"]*)"/.exec(cmd)[1]); out('{"returnValue":true}\\r\\n'); }
else if (cmd.includes('appInstallService')) out('{"returnValue":true,"subscribed":false}\\r\\n');
else if (cmd.includes('getCurrentSWInformation')) out('{"returnValue":true,"model_name":"HE_DTV_W25O","country":"DE","device_id":"SECRET-ID"}\\r\\n');
else if (cmd.includes('applicationManager/launch')) out('{"returnValue":true,"processId":"1"}\\r\\n');
else if (cmd.includes('existsSync')) out('false');
else if (cmd.includes('mounted()')) out('false');
else if (cmd === 'cat /var/lib/own-tv/home-before.json') out('{"home":"com.example.saved"}');
else if (cmd.startsWith('/usr/bin/node /var/lib/own-tv/helper.cjs')) out(JSON.stringify({ ok: true, args: cmd.split(' ').slice(2) }));
else if (cmd.startsWith('tar -czf')) out(Buffer.from([0x1f, 0x8b, 8, 0, 0xff, 0x00]));
`;

interface Call {
  argv: string[];
  stdin: Buffer;
}

/** Every ssh invocation since the last reset. */
function calls(): Call[] {
  const log = path.join(fake, 'log.jsonl');
  if (!fs.existsSync(log)) {
    return [];
  }
  return fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const { argv, stdin } = JSON.parse(line) as { argv: string[]; stdin: string };
      return { argv, stdin: Buffer.from(stdin, 'base64') };
    });
}

/** The remote command of each call, `tty ` marking a forced PTY; checks the pinned flags. */
function commands(): string[] {
  return calls().map(({ argv }) => {
    const tty = argv[0] === '-tt';
    const rest = tty ? argv.slice(1) : argv;
    assert.deepEqual(
      rest.slice(0, -1),
      PINNED,
      'every call: private config, batch mode, pinned key',
    );
    assert.equal(rest.length, PINNED.length + 1);
    return `${tty ? 'tty ' : ''}${rest.at(-1)}`;
  });
}

function reply(
  ...replies: { match: string; stdout?: string; stderr?: string; status?: number; sleep?: number }[]
): void {
  fs.writeFileSync(path.join(fake, 'replies.json'), JSON.stringify(replies));
}

/** Console output of `run`, with console.log captured. */
function logged(run: () => unknown): string {
  const lines: string[] = [];
  const spy = mock.method(console, 'log', (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  try {
    run();
  } finally {
    spy.mock.restore();
  }
  return lines.join('\n');
}

const saved = {
  PATH: process.env.PATH,
  INIT_CWD: process.env.INIT_CWD,
  fake: process.env.OWN_TV_FAKE_SSH,
};
const tv = new TV(CONFIG, HOST);

before(() => {
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(temp, 'private'));
  fs.writeFileSync(path.join(bin, 'ssh'), SSH, { mode: 0o755 });
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
  process.env.OWN_TV_FAKE_SSH = fake;
  process.env.INIT_CWD = temp;
  // The stand-in must be the ssh every spawn finds, or nothing below may run
  fs.mkdirSync(fake);
  assert.equal(spawnSync('ssh', ['probe'], { stdio: 'ignore' }).status, 0);
  assert.deepEqual(calls()[0]?.argv, ['probe']);
});

beforeEach(() => {
  fs.rmSync(fake, { recursive: true, force: true });
  fs.mkdirSync(fake);
});

after(() => {
  for (const [key, value] of [
    ['PATH', saved.PATH],
    ['INIT_CWD', saved.INIT_CWD],
    ['OWN_TV_FAKE_SSH', saved.fake],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  fs.rmSync(temp, { recursive: true, force: true });
});

const DEFAULT_APPS = `tty luna-send -n 1 -w 30000 luna://com.webos.settingsservice/getSystemSettings '{"category":"general","keys":["defaultApps"]}'`;

describe('helper actions', () => {
  it('state prints the helper reply, without a PTY', () => {
    const output = logged(() =>
      cli(['--ssh-config', 'private/ssh_config', '--host', HOST, 'state']),
    );
    assert.deepEqual(commands(), ['/usr/bin/node /var/lib/own-tv/helper.cjs state']);
    assert.equal(output, JSON.stringify({ ok: true, args: ['state'] }, null, 2));
  });

  it('home-direct-enable and -disable send true and false', () => {
    const output = logged(() => {
      cli(['--ssh-config', CONFIG, '--host', HOST, 'home-direct-enable']);
      cli(['--ssh-config', CONFIG, '--host', HOST, 'home-direct-disable']);
    });
    assert.deepEqual(commands(), [
      `/usr/bin/node /var/lib/own-tv/helper.cjs directHome ${Buffer.from('true').toString('base64')}`,
      '/usr/bin/node /var/lib/own-tv/helper.cjs directHome ZmFsc2U=',
    ]);
    assert.equal(
      output,
      [true, false]
        .map((on) =>
          JSON.stringify({
            ok: true,
            args: ['directHome', Buffer.from(String(on)).toString('base64')],
          }),
        )
        .join('\n'),
    );
  });

  it('configure reads --file relative to INIT_CWD and sends it as base64 JSON', () => {
    const value = { calendar: { feedUrl: 'https://calendar.example/secret.ics' }, label: 'Café' };
    fs.mkdirSync(path.join(temp, 'in'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'in/settings.json'), JSON.stringify(value));
    logged(() =>
      cli([
        '--ssh-config',
        'private/ssh_config',
        '--host',
        HOST,
        'configure',
        '--file',
        'in/settings.json',
      ]),
    );
    const [command = ''] = commands();
    const words = command.split(' ');
    assert.deepEqual(words.slice(0, 3), [
      '/usr/bin/node',
      '/var/lib/own-tv/helper.cjs',
      'configure',
    ]);
    const json = Buffer.from(words[3] ?? '', 'base64').toString('utf8');
    assert.deepEqual(JSON.parse(json), value);
    assert.ok(json.includes('Caf\\u00e9'), 'non-ASCII escaped like json.dumps');
    // A JSON null sends no value at all
    fs.writeFileSync(path.join(temp, 'in/null.json'), 'null');
    logged(() =>
      cli(['--ssh-config', CONFIG, '--host', HOST, 'configure', '--file', 'in/null.json']),
    );
    assert.equal(commands()[1], '/usr/bin/node /var/lib/own-tv/helper.cjs configure');
  });

  it('open launches the app with luna-send under a PTY', () => {
    const output = logged(() => cli(['--ssh-config', CONFIG, '--host', HOST, 'open']));
    assert.deepEqual(commands(), [
      `tty luna-send -n 1 -w 30000 luna://com.webos.applicationManager/launch '{"id":"${APP_ID}"}'`,
    ]);
    assert.equal(output, '{"returnValue":true,"processId":"1"}');
  });
});

describe('backup', () => {
  it('writes a private archive and Home settings: directory 0700, files 0600', () => {
    const destination = path.join(temp, 'backups');
    fs.mkdirSync(destination, { mode: 0o755 });
    fs.chmodSync(destination, 0o755);
    const output = logged(() =>
      cli(['--ssh-config', CONFIG, '--host', HOST, 'backup', '--destination', 'backups']),
    );
    assert.deepEqual(commands(), [
      'tar -czf - /var/lib/webosbrew /var/luna/preferences /etc/hosts /home/root/.ssh/authorized_keys 2>/dev/null',
      DEFAULT_APPS,
    ]);
    assert.equal(fs.statSync(destination).mode & 0o777, 0o700);
    const files = fs.readdirSync(destination).sort();
    assert.equal(files.length, 2);
    const [archive = '', settings = ''] = files;
    assert.match(archive, /^\d{8}T\d{6}Z-baseline\.tar\.gz$/);
    assert.equal(settings, archive.replace('baseline.tar.gz', 'home-settings.json'));
    for (const file of files) {
      assert.equal(fs.statSync(path.join(destination, file)).mode & 0o777, 0o600, file);
    }
    assert.deepEqual(
      [...fs.readFileSync(path.join(destination, archive))],
      [0x1f, 0x8b, 8, 0, 0xff, 0x00],
    );
    const text = fs.readFileSync(path.join(destination, settings), 'utf8');
    assert.equal(
      text,
      '{\n  "returnValue": true,\n  "settings": {\n    "defaultApps": {\n      "home": "com.webos.app.home",\n      "other": "x\\u00e9"\n    }\n  }\n}',
    );
    assert.equal(output, `Private backup: ${path.join(destination, archive)}`);
  });

  it('creates a missing destination with mode 0700', () => {
    const destination = path.join(temp, 'new/nested/backups');
    logged(() => tv.backup(destination));
    assert.equal(fs.statSync(destination).mode & 0o777, 0o700);
  });

  it('refuses the repository, any directory inside it, and symlinks into it', () => {
    fs.symlinkSync(path.join(ROOT, 'docs'), path.join(temp, 'into-repo'));
    fs.symlinkSync(ROOT, path.join(temp, 'repo-link'));
    for (const destination of [
      ROOT,
      path.join(ROOT, 'backups'),
      path.join(ROOT, 'docs/new/deeper'),
      path.join(temp, 'into-repo/backups'),
      path.join(temp, 'repo-link'),
      path.join(ROOT, '../', path.basename(ROOT), 'x'),
    ]) {
      assert.throws(
        () => tv.backup(destination),
        /^Error: Keep private backups outside this repository\.$/,
        destination,
      );
    }
    // Relative to INIT_CWD: from inside the repository, a relative path is refused too
    process.env.INIT_CWD = ROOT;
    try {
      assert.throws(
        () => cli(['--ssh-config', CONFIG, '--host', HOST, 'backup', '--destination', 'backups']),
        /outside this repository/,
      );
    } finally {
      process.env.INIT_CWD = temp;
    }
    assert.ok(!fs.existsSync(path.join(ROOT, 'backups')));
    assert.ok(!fs.existsSync(path.join(ROOT, 'docs/new')));
    assert.deepEqual(calls(), [], 'refused before any connection');
  });
});

describe('install', () => {
  /** A minimal built dashboard for the IPK. */
  function app(): string {
    const dir = path.join(temp, 'app');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'index.html'), '<script src="app.js"></script>');
      fs.writeFileSync(path.join(dir, 'app.js'), 'window.app = 1;');
      fs.writeFileSync(
        path.join(dir, 'appinfo.json'),
        JSON.stringify({ id: APP_ID, version: '9.9.9' }),
      );
    }
    return dir;
  }
  const install = (): string =>
    logged(() => tv.install({ app: app(), out: path.join(temp, 'dist') }));

  const BEFORE_HOME = [
    'umask 077; mkdir -p /var/lib/own-tv; tar -xf - -C /var/lib/own-tv && chown -R 0:0 /var/lib/own-tv && chmod 700 /var/lib/own-tv',
    'cat > /tmp/own-tv.ipk',
    `tty luna-send -n 1 -w 30000 luna://com.webos.appInstallService/dev/install '{"id":"com.ares.defaultName","ipkUrl":"/tmp/own-tv.ipk","subscribe":false}'`,
    'cat > /var/lib/webosbrew/init.d/40-own-tv-permission && chmod 755 /var/lib/webosbrew/init.d/40-own-tv-permission && sh /var/lib/webosbrew/init.d/40-own-tv-permission',
    'rm -f /tmp/own-tv.ipk',
    `tty luna-send -n 1 -w 30000 luna://com.webos.service.update/getCurrentSWInformation '{}'`,
    'umask 077; cat > /var/lib/own-tv/device-capabilities.json',
    `/usr/bin/node -e "process.stdout.write(String(require('fs').existsSync('/var/lib/webosbrew/init.d/60-own-tv-home')))"`,
  ];

  it('deploys the helpers, the package and the permission hook, and keeps Home as it was', () => {
    const output = install();
    assert.deepEqual(commands(), BEFORE_HOME);
    const sent = calls();
    // The helper bundle: the compiled helpers first, extracted by tar on the TV
    const listing = spawnSync('tar', ['-tf', '-'], { input: sent[0]?.stdin, encoding: 'utf8' });
    assert.equal(listing.status, 0);
    const names = listing.stdout.trim().split('\n');
    assert.deepEqual(names.slice(0, HELPERS.length), [...HELPERS]);
    for (const name of [
      'holiday-catalog.json',
      'compatibility/firmware.json',
      'build.json',
      'node_modules/ical.js/package.json',
    ]) {
      assert.ok(names.includes(name), name);
    }
    assert.ok(
      sent[1]?.stdin.equals(fs.readFileSync(path.join(temp, 'dist', `${APP_ID}_9.9.9_all.ipk`))),
    );
    assert.ok(
      sent[3]?.stdin.equals(fs.readFileSync(path.join(ROOT, 'tools/40-own-tv-permission'))),
    );
    // Only the model and country leave the TV's reply; never the device id
    assert.equal(sent[6]?.stdin.toString(), '{"otaid":"HE_DTV_W25O","country":"DE"}');
    assert.equal(
      output,
      'Installed Own TV. Root permission repaired. Existing Home routing preserved.',
    );
  });

  it('reinstalls the Home router when it was enabled', () => {
    reply({ match: 'existsSync', stdout: 'true' });
    install();
    assert.deepEqual(commands(), [
      ...BEFORE_HOME,
      '/usr/bin/node /var/lib/own-tv/home-route.cjs --stop',
      'cat > /var/lib/webosbrew/init.d/60-own-tv-home',
      'chmod 755 /var/lib/webosbrew/init.d/60-own-tv-home',
      'sh /var/lib/webosbrew/init.d/60-own-tv-home',
      '/usr/bin/node /var/lib/own-tv/helper.cjs homeRefresh',
    ]);
    assert.ok(calls()[9]?.stdin.equals(fs.readFileSync(path.join(ROOT, 'tools/60-own-tv-home'))));
  });

  it('records no capabilities when the TV will not say', () => {
    reply({
      match: 'getCurrentSWInformation',
      stdout: '{"returnValue":false,"errorText":"denied"}\r\n',
    });
    install();
    assert.equal(calls()[6]?.stdin.toString(), '{"otaid":null,"country":null}');
  });

  it('stops when the TV refuses the package', () => {
    reply({
      match: 'appInstallService',
      stdout: `${JSON.stringify({ returnValue: true, details: { state: 'FAILED' } })}\r\n`,
    });
    assert.throws(
      install,
      (error: unknown) =>
        error instanceof CommandError && /^TV refused the package: /.test(error.message),
    );
    assert.equal(commands().length, 3, 'nothing after the refusal');
  });
});

describe('Home', () => {
  it('home-enable saves the old Home, routes Home to the app and installs the router', () => {
    const output = logged(() => cli(['--ssh-config', CONFIG, '--host', HOST, 'home-enable']));
    assert.deepEqual(commands(), [
      DEFAULT_APPS,
      'cat > /var/lib/own-tv/home-route.cjs',
      'cat > /var/lib/own-tv/performance.cjs',
      'test -f /var/lib/own-tv/home-before.json || cat > /var/lib/own-tv/home-before.json',
      `/usr/bin/node -e "process.stdout.write(String(require('/var/lib/own-tv/home-replacement.cjs').createHomeReplacement().mounted()))"`,
      `tty luna-send -n 1 -w 30000 luna://com.webos.settingsservice/setSystemSettings '{"category":"general","settings":{"defaultApps":{"home":"${APP_ID}","other":"x\\u00e9"}}}'`,
      DEFAULT_APPS,
      'cat > /var/lib/webosbrew/init.d/60-own-tv-home && chmod 755 /var/lib/webosbrew/init.d/60-own-tv-home && sh /var/lib/webosbrew/init.d/60-own-tv-home',
    ]);
    const sent = calls();
    assert.ok(sent[1]?.stdin.equals(fs.readFileSync(path.join(NATIVE, 'home-route.cjs'))));
    assert.ok(sent[2]?.stdin.equals(fs.readFileSync(path.join(NATIVE, 'performance.cjs'))));
    assert.equal(sent[3]?.stdin.toString(), '{"home":"com.webos.app.home","other":"x\\u00e9"}');
    assert.ok(sent[7]?.stdin.equals(fs.readFileSync(path.join(ROOT, 'tools/60-own-tv-home'))));
    assert.equal(output, `Home now opens: ${APP_ID}`);
  });

  it('keeps LG Home as the target when Direct Home is mounted', () => {
    reply({ match: 'mounted()', stdout: 'true' });
    const output = logged(() => tv.home());
    assert.match(commands()[5] ?? '', /"home":"com\.webos\.app\.home"/);
    assert.equal(output, 'Home now opens: com.webos.app.home');
  });

  it('home-restore puts back only the saved Home and removes the router', () => {
    fs.writeFileSync(path.join(fake, 'home'), APP_ID);
    const output = logged(() => cli(['--ssh-config', CONFIG, '--host', HOST, 'home-restore']));
    assert.deepEqual(commands(), [
      DEFAULT_APPS,
      'if [ -f /var/lib/own-tv/home-replacement.cjs ]; then /usr/bin/node /var/lib/own-tv/helper.cjs directHome ZmFsc2U=; fi',
      'if [ -f /var/lib/own-tv/performance.json ]; then /usr/bin/node /var/lib/own-tv/helper.cjs memoryMode ZmFsc2U=; fi',
      'cat /var/lib/own-tv/home-before.json',
      'if [ -f /var/lib/own-tv/home-route.cjs ]; then /usr/bin/node /var/lib/own-tv/home-route.cjs --stop; fi; rm -f /var/lib/webosbrew/init.d/60-own-tv-home',
      `tty luna-send -n 1 -w 30000 luna://com.webos.settingsservice/setSystemSettings '{"category":"general","settings":{"defaultApps":{"home":"com.example.saved","other":"x\\u00e9"}}}'`,
      DEFAULT_APPS,
    ]);
    assert.equal(output, 'Home now opens: com.example.saved');
  });

  it('restores LG Home when nothing was saved, and refuses a corrupt save', () => {
    reply({ match: 'cat /var/lib/own-tv/home-before.json', stdout: '{}' });
    assert.equal(
      logged(() => tv.home(true)),
      'Home now opens: com.webos.app.home',
    );
    reply({ match: 'cat /var/lib/own-tv/home-before.json', stdout: '["x"]' });
    assert.throws(() => tv.home(true), /saved Home setting on the TV is not a JSON object/);
  });

  it('refuses a TV without a defaultApps Home setting', () => {
    reply({ match: 'getSystemSettings', stdout: '{"returnValue":true,"settings":{}}\r\n' });
    assert.throws(() => tv.home(), /This TV has no supported defaultApps home setting/);
    assert.equal(commands().length, 1);
  });

  it('reports a Home change the TV did not apply', () => {
    reply({ match: 'setSystemSettings', stdout: '{"returnValue":true}\r\n' });
    assert.throws(() => tv.home(), /^CommandError: Home change was not applied$/);
    assert.ok(!commands().some((c) => c.includes('60-own-tv-home')), 'router not installed');
  });
});

describe('SSH results', () => {
  it('turns a failed command into its stderr, or stdout when stderr is empty', () => {
    reply({ match: 'state', stderr: 'Host key verification failed.', status: 255 });
    assert.throws(
      () => tv.helper('state'),
      (e: unknown) => e instanceof CommandError && e.message === 'Host key verification failed.',
    );
    reply({ match: 'state', stdout: 'only stdout', status: 1 });
    assert.throws(() => tv.helper('state'), /^CommandError: only stdout$/);
  });

  it('reads the first JSON object luna-send prints, and its errors', () => {
    reply({
      match: 'launch',
      stdout: `noise\r\n42\r\n${JSON.stringify({ returnValue: false, errorText: 'App not found' })}\r\n`,
    });
    assert.throws(
      () => tv.luna('com.webos.applicationManager/launch', { id: 'x' }),
      /^CommandError: App not found$/,
    );
    reply({ match: 'launch', stdout: '{"returnValue":false}\r\n' });
    assert.throws(
      () => tv.luna('com.webos.applicationManager/launch', {}),
      /^CommandError: \{"returnValue":false\}$/,
    );
    reply({ match: 'launch', stdout: 'no JSON here\r\n' });
    assert.throws(
      () => tv.luna('com.webos.applicationManager/launch', {}),
      /^CommandError: TV returned no Luna response$/,
    );
  });

  it('gives up after the timeout without naming the command', () => {
    reply({ match: 'slow', sleep: 5000 });
    assert.throws(
      () => tv.run('slow secret-argument', null, false, 0.3),
      (e: unknown) =>
        e instanceof TimeoutError && !e.message.includes('secret') && /timed out/.test(e.message),
    );
  });
});

describe('bootstrap refusals', () => {
  // Every case is refused before ssh-keygen, Telnet or ssh run; 192.0.2.1 is TEST-NET-1.
  const run = (tvIp: string, profile: string) =>
    bootstrap(['--tv', tvIp, '--profile-dir', profile, '--bootstrap-telnet']);

  it('refuses a TV address that is not an IP address', async () => {
    for (const address of ['living-room', '192.168.001.1', '1.2.3', '']) {
      await assert.rejects(
        run(address, path.join(temp, 'profile')),
        /does not appear to be an IPv4 or IPv6 address/,
      );
    }
  });

  it('refuses a profile inside the repository, also through a symlink or a relative path', async () => {
    fs.symlinkSync(path.join(ROOT, 'tools'), path.join(temp, 'tools-link'));
    for (const profile of [
      ROOT,
      path.join(ROOT, 'tv-private'),
      path.join(temp, 'tools-link/tv-private'),
    ]) {
      await assert.rejects(
        run('192.0.2.1', profile),
        /^Error: Keep the private profile OUTSIDE this repository\.$/,
      );
    }
    process.env.INIT_CWD = ROOT;
    try {
      await assert.rejects(run('192.0.2.1', 'tv-private'), /OUTSIDE this repository/);
    } finally {
      process.env.INIT_CWD = temp;
    }
    assert.ok(!fs.existsSync(path.join(ROOT, 'tv-private')));
    assert.ok(!fs.existsSync(path.join(ROOT, 'tools/tv-private')));
    assert.deepEqual(calls(), []);
  });
});

describe('paths', () => {
  it('resolves user paths from INIT_CWD, else the working directory, and expands ~', () => {
    assert.equal(userPath('a/b'), path.join(temp, 'a/b'));
    assert.equal(userPath('/abs/x'), '/abs/x');
    assert.equal(userPath('~'), os.homedir());
    assert.equal(userPath('~/x'), path.join(os.homedir(), 'x'));
    assert.equal(userPath('~user/x'), path.join(temp, '~user/x'));
    delete process.env.INIT_CWD;
    try {
      assert.equal(userPath('a'), path.join(process.cwd(), 'a'));
    } finally {
      process.env.INIT_CWD = temp;
    }
  });

  it('follows symlinks in the part of a path that exists', () => {
    fs.mkdirSync(path.join(temp, 'real'), { recursive: true });
    fs.symlinkSync(path.join(temp, 'real'), path.join(temp, 'link'));
    assert.equal(realResolve(path.join(temp, 'link/not/yet')), path.join(temp, 'real/not/yet'));
    assert.equal(realResolve(path.join(temp, 'link')), path.join(temp, 'real'));
    assert.equal(realResolve('/'), '/');
  });

  it('tells inside from outside', () => {
    assert.ok(isInside('/a/b', '/a/b'));
    assert.ok(isInside('/a/b/c', '/a/b'));
    assert.ok(!isInside('/a/bc', '/a/b'));
    assert.ok(!isInside('/a', '/a/b'));
    assert.ok(!isInside('/x/y', '/a/b'));
    assert.ok(isInside('/a/b/..c', '/a/b'));
  });

  it('knows which module node started', () => {
    assert.ok(!isMain('file:///nowhere.mjs'));
    const argv = [...process.argv];
    try {
      process.argv[1] = path.join(temp, 'missing.mjs');
      assert.ok(!isMain('file:///nowhere.mjs'));
      process.argv.splice(1);
      assert.ok(!isMain('file:///nowhere.mjs'));
    } finally {
      process.argv.splice(0, process.argv.length, ...argv);
    }
  });
});
