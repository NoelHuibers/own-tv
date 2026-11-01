import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  createHomeReplacement,
  type HomeReplacement,
  heartbeatExpired,
  isLgFlutter,
} from '../native/home-replacement.cjs';
import { field, readJson } from './json.cjs';

type LunaCall = [string, Readonly<Record<string, unknown>>];

// The dashboard bundle's only script tag
const INDEX = '<script src="app.js"></script>';

function groupId(): number {
  const gid = process.getgid?.();
  assert.ok(gid !== undefined, 'POSIX group id');
  return gid;
}

/** A temporary TV: the installed Own TV (source), LG's Home (stock) and an empty /proc. */
function fakeDirs(t: TestContext, index: string, schema: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-home-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source');
  const appDir = path.join(dir, 'stock');
  const schemaFile = path.join(dir, 'schema.json');
  const procDir = path.join(dir, 'proc');
  for (const p of [source, appDir, procDir]) {
    fs.mkdirSync(p);
  }
  fs.writeFileSync(
    path.join(source, 'appinfo.json'),
    JSON.stringify({ id: 'io.github.noelhuibers.owntv', type: 'web' }),
  );
  fs.writeFileSync(path.join(source, 'index.html'), index);
  fs.writeFileSync(
    path.join(appDir, 'appinfo.json'),
    JSON.stringify({ id: 'com.webos.app.home', type: 'flutter' }),
  );
  fs.writeFileSync(schemaFile, schema);
  return { dir, source, appDir, schemaFile, procDir };
}

test('only LG Home Flutter is stopped; standby, other apps and cold loading do not trip recovery', () => {
  assert.ok(isLgFlutter(['/usr/bin/flutter-client', '-i', 'com.webos.app.home']));
  for (const argv of [
    ['/usr/bin/flutter-client', '-i', 'com.webos.app.screensaver'],
    ['/usr/bin/flutter-client', '-i', 'com.webos.app.homeconnect'],
    ['/bin/sh', 'flutter-client', '-i', 'com.webos.app.home'],
  ]) {
    assert.equal(isLgFlutter(argv), false);
  }
  const state = {
    foreground: 'com.webos.app.home',
    power: 'Active',
    startedAt: 100000,
    lastBeat: 0,
    now: 159000,
  };
  assert.equal(heartbeatExpired(state), false);
  assert.equal(heartbeatExpired({ ...state, now: 161000 }), true);
  assert.equal(heartbeatExpired({ ...state, now: 200000, power: 'Active Standby' }), false);
  assert.equal(heartbeatExpired({ ...state, now: 200000, foreground: 'netflix' }), false);
  assert.equal(heartbeatExpired({ ...state, lastBeat: 155000, now: 180000 }), false);
});

test('failed registration unmounts and restores Home without restarting SAM', async (t) => {
  const { dir, ...paths } = fakeDirs(
    t,
    `<meta content="connect-src 'self';">${INDEX}`,
    JSON.stringify({ forceBlockSystemApp: true }),
  );
  let mounted = false;
  let rejectBlock = true;
  const calls: LunaCall[] = [];
  const commands: [string, readonly string[]][] = [];
  const home = createHomeReplacement({
    root: dir,
    ...paths,
    assetGroup: groupId(),
    isMounted: () => mounted,
    ping: () => Promise.resolve(),
    run: (file, args) => {
      commands.push([file, args]);
      if (file === '/bin/mount') {
        mounted = true;
      }
      if (file === '/bin/umount') {
        mounted = false;
      }
      return Promise.resolve();
    },
    luna: (uri, p) => {
      calls.push([uri, p]);
      if (uri.endsWith('/blockSystemApp') && rejectBlock) {
        rejectBlock = false;
        return Promise.reject(new Error('registration refused'));
      }
      if (uri.endsWith('/getAppInfo')) {
        return Promise.resolve({
          appInfo: { type: mounted ? 'web' : 'flutter', appCategory: ['home'] },
        });
      }
      if (uri.endsWith('/getSystemSettings')) {
        return Promise.resolve({
          settings: { defaultApps: { home: 'original', browser: 'browser' } },
        });
      }
      if (uri.endsWith('/getForegroundAppInfo')) {
        return Promise.resolve({ appId: 'youtube.leanback.v4' });
      }
      if (uri.endsWith('/getPreloadPolicy')) {
        return Promise.resolve({ applications: [{ id: 'com.webos.app.home', isEnabled: true }] });
      }
      return Promise.resolve({ returnValue: true });
    },
  });
  const launches = () => calls.filter((c) => c[0].endsWith('/launch')).length;
  await assert.rejects(home.enable(), /registration refused/);
  assert.equal(mounted, false);
  assert.equal(home.status().enabled, false);
  assert.ok(calls.filter((c) => c[0].endsWith('/releaseBlockSystemApp')).length >= 2);
  assert.ok(commands.every((c) => ['/bin/mount', '/bin/umount'].includes(c[0])));
  assert.ok(
    calls
      .filter((c) => c[0].endsWith('/setSystemSettings'))
      .every((c) => field(c[1], 'settings', 'defaultApps', 'browser') === 'browser'),
  );
  await home.enable();
  assert.equal(mounted, true);
  assert.equal(home.status().enabled, true);
  const stage = path.join(dir, 'home-system/app');
  assert.equal(
    field(readJson(fs.readFileSync(path.join(stage, 'appinfo.json'), 'utf8')), 'id'),
    'com.webos.app.home',
  );
  const html = fs.readFileSync(path.join(stage, 'index.html'), 'utf8');
  assert.ok(html.includes('http://127.0.0.1:18766'));
  assert.ok(html.includes(`<script src="home-runtime.js"></script>${INDEX}`));
  assert.equal(fs.statSync(path.join(stage, 'home-runtime.js')).mode & 0o777, 0o640);
  assert.equal(fs.statSync(path.join(dir, 'home-system/token.json')).mode & 0o777, 0o600);
  const before = launches();
  await home.refresh();
  assert.equal(launches(), before);
  await home.disable();
  assert.equal(mounted, false);
  assert.equal(home.status().enabled, false);
  assert.equal(launches(), before);
});

interface FakeTv {
  mounted: boolean;
  foreground: string;
  readonly home: HomeReplacement;
}

function fakeTv(t: TestContext, clock: { now: number }, index = INDEX): FakeTv {
  const { dir, ...paths } = fakeDirs(t, index, '{}');
  const tv: FakeTv = {
    mounted: false,
    foreground: 'netflix',
    home: createHomeReplacement({
      root: dir,
      ...paths,
      assetGroup: groupId(),
      now: () => clock.now,
      isMounted: () => tv.mounted,
      ping: () => Promise.resolve(),
      run: (file) => {
        if (file === '/bin/mount') {
          tv.mounted = true;
        }
        if (file === '/bin/umount') {
          tv.mounted = false;
        }
        return Promise.resolve();
      },
      luna: (uri) => {
        if (uri.endsWith('/getAppInfo')) {
          return Promise.resolve({
            appInfo: { type: tv.mounted ? 'web' : 'flutter', appCategory: ['home'] },
          });
        }
        if (uri.endsWith('/getSystemSettings')) {
          return Promise.resolve({ settings: { defaultApps: { home: 'original' } } });
        }
        if (uri.endsWith('/getForegroundAppInfo')) {
          return Promise.resolve({ appId: tv.foreground });
        }
        if (uri.endsWith('/getPreloadPolicy')) {
          return Promise.resolve({ applications: [] });
        }
        return Promise.resolve({ returnValue: true });
      },
    }),
  };
  return tv;
}

test('router-crash recovery restores LG identity but keeps Direct Home enabled', async (t) => {
  const tv = fakeTv(t, { now: 1000 });
  await tv.home.enable({ launch: false });
  assert.equal(tv.mounted, true);
  await tv.home.recover('router error');
  assert.equal(tv.mounted, false);
  assert.equal(tv.home.status().enabled, true);
  assert.equal(tv.home.status().phase, 'recovering');
  await tv.home.enable({ launch: false });
  assert.equal(tv.mounted, true);
  assert.equal(tv.home.status().phase, 'active');
  assert.equal(tv.home.status().failure, null);
  await tv.home.disable();
  assert.deepEqual(await tv.home.recover('late'), { ok: true, enabled: false });
  assert.equal(tv.home.status().enabled, false);
});

test('waking from standby with an hours-old heartbeat gets a fresh grace period', async (t) => {
  const clock = { now: 1000 };
  const tv = fakeTv(t, clock);
  await tv.home.enable({ launch: false });
  tv.home.heartbeat({ version: '1.0.0', rendered: true });
  clock.now += 4 * 3600000;
  await tv.home.guard('com.webos.app.home', 'Active Standby');
  clock.now += 5000;
  await tv.home.guard('com.webos.app.home', 'Active');
  assert.equal(tv.home.status().enabled, true);
  clock.now += 30000;
  await tv.home.guard('com.webos.app.home', 'Active');
  assert.equal(tv.home.status().enabled, true);
  clock.now += 31000;
  await tv.home.guard('com.webos.app.home', 'Active');
  assert.equal(tv.home.status().enabled, false);
});

test('Direct Home refuses an Own TV build whose index.html does not load app.js', async (t) => {
  const tv = fakeTv(t, { now: 1000 }, '<script src="bridge.js"></script>');
  await assert.rejects(tv.home.enable({ launch: false }), /does not load app\.js/);
  assert.equal(tv.mounted, false);
  assert.equal(tv.home.status().enabled, false);
});
