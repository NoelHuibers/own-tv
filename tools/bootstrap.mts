// One-time SSH bootstrap for your own already-rooted TV on a trusted LAN.
//
//   pnpm bootstrap --tv YOUR_TV_IP --profile-dir /path/outside/repo/tv-private --bootstrap-telnet
//
// Telnet is used only to install your public key. Private keys stay on this PC.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { main, optionValue, parse } from './cli.mjs';
import { isInside, isMain, ROOT, realResolve, userPath } from './paths.mjs';
import { splitLines } from './ssh.mjs';
import { run as telnet } from './telnet.mjs';

/** The root shell script that installs the public key and starts key-only Dropbear. */
export function sshScript(publicKey: Buffer): string {
  const encoded = publicKey.toString('base64');
  return `set -e
umask 077
mkdir -p /home/root/.ssh /var/lib/webosbrew/sshd
printf '${encoded}' | base64 -d > /tmp/own-tv-public-key
grep -qxFf /tmp/own-tv-public-key /home/root/.ssh/authorized_keys 2>/dev/null || cat /tmp/own-tv-public-key >> /home/root/.ssh/authorized_keys
rm -f /tmp/own-tv-public-key
chmod 700 /home/root/.ssh
chmod 600 /home/root/.ssh/authorized_keys
touch /var/luna/preferences/webosbrew_sshd_enabled
/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/dropbear -R -s
`;
}

/** The private ssh_config for the TV. */
export function sshConfig(tv: string, key: string, profile: string): string {
  return `Host living-room\n  HostName ${tv}\n  User root\n  IdentityFile ${key}\n  UserKnownHostsFile ${path.join(profile, 'known_hosts')}\n  StrictHostKeyChecking yes\n  BatchMode yes\n  ConnectTimeout 5\n`;
}

/** Runs a local command with the terminal attached; throws unless it exits 0. */
function check(program: string, args: readonly string[], input?: Buffer): void {
  const result = spawnSync(program, args, {
    stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'],
    ...(input ? { input } : {}),
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.signal ?? `exit status ${result.status}`}): ${program} ${args.join(' ')}`,
    );
  }
}

export async function bootstrap(argv: readonly string[]): Promise<number> {
  const parsed = parse(
    {
      prog: 'pnpm bootstrap',
      description:
        'One-time SSH bootstrap for your own already-rooted TV on a trusted LAN. Telnet is used only to install your public key. Private keys stay on this PC.',
      options: [
        { name: 'tv', required: true },
        { name: 'profile-dir', required: true },
        { name: 'bootstrap-telnet', flag: true, required: true },
      ],
    },
    argv,
  );
  const tv = optionValue(parsed, 'tv');
  if (net.isIP(tv) === 0) {
    throw new Error(`'${tv}' does not appear to be an IPv4 or IPv6 address`);
  }
  const profile = realResolve(userPath(optionValue(parsed, 'profile-dir')));
  if (isInside(profile, ROOT)) {
    throw new Error('Keep the private profile OUTSIDE this repository.');
  }
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  fs.chmodSync(profile, 0o700);
  const key = path.join(profile, 'id_ed25519');
  if (!fs.existsSync(key)) {
    check('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'own-tv', '-f', key]);
  }

  const [idStatus, idOutput] = await telnet(tv, 'id -u');
  if (idStatus || splitLines(idOutput.trim()).at(-1) !== '0') {
    throw new Error('Target did not provide the expected rooted shell. No changes made.');
  }
  const [status] = await telnet(tv, sshScript(fs.readFileSync(`${key}.pub`)));
  if (status) {
    throw new Error('Could not start SSH; Telnet has not been disabled.');
  }

  const cfg = path.join(profile, 'ssh_config');
  fs.writeFileSync(cfg, sshConfig(tv, key, profile), { mode: 0o600 });
  fs.chmodSync(cfg, 0o600);
  // Initial host key trust is established on this explicitly trusted LAN, by this first
  // verified connection only. Every later connection pins that key and fails if it changes.
  const ssh = (trust: 'accept-new' | 'yes'): string[] => [
    '-F',
    cfg,
    '-o',
    `StrictHostKeyChecking=${trust}`,
    'living-room',
  ];
  check('ssh', [...ssh('accept-new'), 'test "$(id -u)" = 0']);
  const hook = fs.readFileSync(path.join(ROOT, 'tools/10-own-tv-ssh'));
  check(
    'ssh',
    [
      ...ssh('yes'),
      'cat > /var/lib/webosbrew/init.d/10-own-tv-ssh && chmod 755 /var/lib/webosbrew/init.d/10-own-tv-ssh && sh /var/lib/webosbrew/init.d/10-own-tv-ssh',
    ],
    hook,
  );
  check('ssh', [...ssh('yes'), 'test "$(id -u)" = 0']);
  // Telnet closes only after key-only SSH was verified again under the new hook
  check('ssh', [
    ...ssh('yes'),
    'touch /var/luna/preferences/webosbrew_telnet_disabled; killall telnetd; sync',
  ]);
  console.log('SSH verified; Telnet closed. Reboot, then verify SSH and closed port 23 again.');
  console.log('Private SSH configuration:', cfg);
  return 0;
}

if (isMain(import.meta.url)) {
  await main(() => bootstrap(process.argv.slice(2)));
}
