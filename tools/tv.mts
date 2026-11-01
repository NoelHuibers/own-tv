// Install and manage Own TV over a verified SSH connection.
//
//   pnpm tv --ssh-config PATH --host HOST ACTION
//
// Actions: backup --destination DIR, install, state, home-enable, home-restore,
// home-direct-enable, home-direct-disable, open, configure --file JSON.

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { diskEntries, type Entry, tar } from './archive.mjs';
import { main, optionValue, parse } from './cli.mjs';
import { buildPackage, type PackageOptions } from './package.mjs';
import { isInside, isMain, NATIVE, ROOT, realResolve, userPath } from './paths.mjs';
import {
  asciiJson,
  CommandError,
  helperCommand,
  runSync,
  shellJoin,
  splitLines,
  sshArgs,
  TimeoutError,
} from './ssh.mjs';

export const APP_ID = 'io.github.noelhuibers.owntv';

// Explicit list: credentials, config files and unrelated node_modules never enter the TV
// helper deployment or a public release package.
export const HELPERS = [
  'helper.cjs',
  'integrations.cjs',
  'firmware.cjs',
  'home-route.cjs',
  'home-replacement.cjs',
  'home-api.cjs',
  'weather.cjs',
  'performance.cjs',
  'calendar-feed.cjs',
  'calendar-agenda.cjs',
  'calendar-settings.cjs',
] as const;

type Json = Record<string, unknown>;

const isRecord = (x: unknown): x is Json =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const field = (x: unknown, key: string): unknown => (isRecord(x) ? x[key] : undefined);

const DEFAULT_APPS = { category: 'general', keys: ['defaultApps'] };

/** A compiled TV helper; tv.mts runs after `pnpm build`, which produces them. */
function compiled(name: string): string {
  const file = path.join(NATIVE, name);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${path.relative(ROOT, file)}. Run pnpm build`);
  }
  return file;
}

/** The tar archive extracted into /var/lib/own-tv: the helpers and what they need. */
export function helperBundle(): Buffer {
  const entries: Entry[] = HELPERS.flatMap((name) => diskEntries(compiled(name), name));
  // tsc copies the catalog next to the helpers that import it
  entries.push(
    ...diskEntries(compiled('holiday-catalog.json'), 'holiday-catalog.json'),
    ...diskEntries(path.join(ROOT, 'compatibility/firmware.json'), 'compatibility/firmware.json'),
  );
  const pkg: unknown = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  entries.push({
    name: 'build.json',
    type: 'file',
    body: Buffer.from(JSON.stringify({ version: field(pkg, 'version') ?? null })),
    mode: 0o600,
  });
  // pnpm links node_modules/ical.js into its store: ship the real files
  let dependency: string;
  try {
    dependency = fs.realpathSync(path.join(ROOT, 'node_modules/ical.js'));
  } catch {
    throw new Error('Run pnpm install first');
  }
  if (!fs.existsSync(path.join(dependency, 'package.json'))) {
    throw new Error('Run pnpm install first');
  }
  entries.push(...diskEntries(dependency, 'node_modules/ical.js'));
  return tar(entries);
}

export class TV {
  private readonly config: string;
  private readonly host: string;

  constructor(config: string, host: string) {
    this.config = config;
    this.host = host;
  }

  run(command: string, data: Buffer | null = null, tty = false, timeout = 90): Buffer {
    const result = runSync('ssh', sshArgs(this.config, this.host, command, tty), data, timeout);
    if (result.status !== 0) {
      throw new CommandError(result.stderr.toString('utf8') || result.stdout.toString('utf8'));
    }
    return result.stdout;
  }

  /** The output of a remote command, as text. */
  text(command: string): string {
    return this.run(command).toString('utf8');
  }

  helper(action: string, value?: unknown): unknown {
    return JSON.parse(this.text(helperCommand(action, value)));
  }

  luna(uri: string, payload: unknown): Json {
    // A PTY is needed for reliable one-shot luna-send results over SSH on the tested C5;
    // otherwise it exits silently with stdin at EOF.
    const command = shellJoin([
      'luna-send',
      '-n',
      '1',
      '-w',
      '30000',
      `luna://${uri}`,
      asciiJson(payload),
    ]);
    const result = this.run(command, null, true).toString('utf8').replaceAll('\r', '');
    for (const line of splitLines(result)) {
      let reply: unknown;
      try {
        reply = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(reply)) {
        continue;
      }
      if (reply.returnValue === false) {
        const text = reply.errorText;
        throw new CommandError(text === undefined ? JSON.stringify(reply) : String(text));
      }
      return reply;
    }
    throw new CommandError('TV returned no Luna response');
  }

  backup(destination: string): void {
    const dir = realResolve(destination);
    if (isInside(dir, ROOT)) {
      throw new Error('Keep private backups outside this repository.');
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const stamp = new Date()
      .toISOString()
      .replace(/\.\d+Z$/, 'Z')
      .replaceAll(/[-:]/g, '');
    const data = this.run(
      'tar -czf - /var/lib/webosbrew /var/luna/preferences /etc/hosts /home/root/.ssh/authorized_keys 2>/dev/null',
    );
    const archive = path.join(dir, `${stamp}-baseline.tar.gz`);
    fs.writeFileSync(archive, data, { mode: 0o600 });
    fs.chmodSync(archive, 0o600);
    const settings = this.luna('com.webos.settingsservice/getSystemSettings', DEFAULT_APPS);
    const file = path.join(dir, `${stamp}-home-settings.json`);
    fs.writeFileSync(file, asciiJson(settings, 2), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    console.log('Private backup:', archive);
  }

  install(packageOptions: PackageOptions = {}): void {
    const ipk = buildPackage(packageOptions);
    this.run(
      'umask 077; mkdir -p /var/lib/own-tv; tar -xf - -C /var/lib/own-tv && chown -R 0:0 /var/lib/own-tv && chmod 700 /var/lib/own-tv',
      helperBundle(),
    );
    this.run('cat > /tmp/own-tv.ipk', fs.readFileSync(ipk));
    const reply = this.luna('com.webos.appInstallService/dev/install', {
      id: 'com.ares.defaultName',
      ipkUrl: '/tmp/own-tv.ipk',
      subscribe: false,
    });
    if (asciiJson(reply).toLowerCase().includes('failed')) {
      throw new CommandError(`TV refused the package: ${JSON.stringify(reply)}`);
    }
    this.run(
      'cat > /var/lib/webosbrew/init.d/40-own-tv-permission && chmod 755 /var/lib/webosbrew/init.d/40-own-tv-permission && sh /var/lib/webosbrew/init.d/40-own-tv-permission',
      fs.readFileSync(path.join(ROOT, 'tools/40-own-tv-permission')),
    );
    this.run('rm -f /tmp/own-tv.ipk');
    let meta: Json = {};
    try {
      meta = this.luna('com.webos.service.update/getCurrentSWInformation', {});
    } catch (error) {
      if (!(error instanceof CommandError || error instanceof TimeoutError)) {
        throw error;
      }
    }
    const safe = { otaid: meta.model_name ?? null, country: meta.country ?? null };
    this.run(
      'umask 077; cat > /var/lib/own-tv/device-capabilities.json',
      Buffer.from(asciiJson(safe)),
    );
    const router =
      this.text(
        `/usr/bin/node -e "process.stdout.write(String(require('fs').existsSync('/var/lib/webosbrew/init.d/60-own-tv-home')))"`,
      ) === 'true';
    if (router) {
      this.run('/usr/bin/node /var/lib/own-tv/home-route.cjs --stop');
      this.run(
        'cat > /var/lib/webosbrew/init.d/60-own-tv-home',
        fs.readFileSync(path.join(ROOT, 'tools/60-own-tv-home')),
      );
      this.run('chmod 755 /var/lib/webosbrew/init.d/60-own-tv-home');
      this.run('sh /var/lib/webosbrew/init.d/60-own-tv-home');
      this.helper('homeRefresh');
    }
    console.log('Installed Own TV. Root permission repaired. Existing Home routing preserved.');
  }

  home(restore = false): void {
    const before = this.luna('com.webos.settingsservice/getSystemSettings', DEFAULT_APPS);
    const apps = field(before.settings, 'defaultApps');
    if (!isRecord(apps)) {
      throw new CommandError(
        'This TV has no supported defaultApps home setting. Use the app as a normal launcher; do not patch system partitions.',
      );
    }
    let current: Json = apps;
    if (restore) {
      this.run(
        'if [ -f /var/lib/own-tv/home-replacement.cjs ]; then /usr/bin/node /var/lib/own-tv/helper.cjs directHome ZmFsc2U=; fi',
      );
      this.run(
        'if [ -f /var/lib/own-tv/performance.json ]; then /usr/bin/node /var/lib/own-tv/helper.cjs memoryMode ZmFsc2U=; fi',
      );
      const saved: unknown = JSON.parse(this.text('cat /var/lib/own-tv/home-before.json'));
      if (!isRecord(saved)) {
        throw new CommandError('The saved Home setting on the TV is not a JSON object');
      }
      // Restore only Home, preserve any other settings changed meanwhile.
      current = { ...current, home: 'home' in saved ? saved.home : 'com.webos.app.home' };
      this.run(
        'if [ -f /var/lib/own-tv/home-route.cjs ]; then /usr/bin/node /var/lib/own-tv/home-route.cjs --stop; fi; rm -f /var/lib/webosbrew/init.d/60-own-tv-home',
      );
    } else {
      for (const name of ['home-route.cjs', 'performance.cjs']) {
        this.run(`cat > /var/lib/own-tv/${name}`, fs.readFileSync(compiled(name)));
      }
      this.run(
        'test -f /var/lib/own-tv/home-before.json || cat > /var/lib/own-tv/home-before.json',
        Buffer.from(asciiJson(current)),
      );
      const direct =
        this.text(
          `/usr/bin/node -e "process.stdout.write(String(require('/var/lib/own-tv/home-replacement.cjs').createHomeReplacement().mounted()))"`,
        ) === 'true';
      current = { ...current, home: direct ? 'com.webos.app.home' : APP_ID };
    }
    this.luna('com.webos.settingsservice/setSystemSettings', {
      category: 'general',
      settings: { defaultApps: current },
    });
    const verify = this.luna('com.webos.settingsservice/getSystemSettings', DEFAULT_APPS);
    if (
      !isDeepStrictEqual(
        field(field(verify.settings, 'defaultApps'), 'home') ?? null,
        current.home ?? null,
      )
    ) {
      throw new CommandError('Home change was not applied');
    }
    if (!restore) {
      this.run(
        'cat > /var/lib/webosbrew/init.d/60-own-tv-home && chmod 755 /var/lib/webosbrew/init.d/60-own-tv-home && sh /var/lib/webosbrew/init.d/60-own-tv-home',
        fs.readFileSync(path.join(ROOT, 'tools/60-own-tv-home')),
      );
    }
    console.log('Home now opens:', 'home' in current ? String(current.home) : 'LG default');
  }
}

const PROGRAM = {
  prog: 'pnpm tv',
  description: 'Install and manage Own TV over a verified SSH connection.',
  options: [
    { name: 'ssh-config', required: true },
    { name: 'host', required: true },
  ],
  commands: [
    { name: 'backup', options: [{ name: 'destination', required: true }] },
    { name: 'install' },
    { name: 'state' },
    { name: 'home-enable' },
    { name: 'home-restore' },
    { name: 'home-direct-enable' },
    { name: 'home-direct-disable' },
    { name: 'open' },
    { name: 'configure', options: [{ name: 'file', required: true }] },
  ],
} as const;

export function cli(argv: readonly string[]): number {
  const parsed = parse(PROGRAM, argv);
  const tv = new TV(userPath(optionValue(parsed, 'ssh-config')), optionValue(parsed, 'host'));
  switch (parsed.command) {
    case 'backup':
      tv.backup(userPath(optionValue(parsed, 'destination')));
      break;
    case 'install':
      tv.install();
      break;
    case 'state':
      console.log(asciiJson(tv.helper('state'), 2));
      break;
    case 'home-enable':
      tv.home();
      break;
    case 'home-restore':
      tv.home(true);
      break;
    case 'home-direct-enable':
      console.log(JSON.stringify(tv.helper('directHome', true)));
      break;
    case 'home-direct-disable':
      console.log(JSON.stringify(tv.helper('directHome', false)));
      break;
    case 'open':
      console.log(JSON.stringify(tv.luna('com.webos.applicationManager/launch', { id: APP_ID })));
      break;
    case 'configure':
      console.log(
        JSON.stringify(
          tv.helper(
            'configure',
            JSON.parse(fs.readFileSync(userPath(optionValue(parsed, 'file')), 'utf8')),
          ),
        ),
      );
      break;
    default:
      throw new Error(`Unknown action: ${parsed.command}`);
  }
  return 0;
}

if (isMain(import.meta.url)) {
  await main(() => cli(process.argv.slice(2)));
}
