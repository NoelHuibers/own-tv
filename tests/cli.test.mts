// The argparse-style parser behind the host tools: required options, subcommands, switches,
// integers, positionals, unknown arguments, --help, and main()'s exit statuses and output.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { main, optionValue, type ProgramSpec, parse, UsageExit } from '../tools/cli.mjs';
import { ROOT } from '../tools/paths.mjs';

const TV: ProgramSpec = {
  prog: 'pnpm tv',
  description: 'Install and manage Own TV.',
  options: [
    { name: 'ssh-config', required: true },
    { name: 'host', required: true },
  ],
  commands: [
    { name: 'backup', options: [{ name: 'destination', required: true }] },
    { name: 'install' },
  ],
};

const EDITOR: ProgramSpec = {
  prog: 'pnpm editor',
  description: 'A loopback-only browser editor.',
  options: [
    { name: 'host', required: true },
    { name: 'port', integer: true, default: '18765', help: 'Port on 127.0.0.1' },
    { name: 'a-very-long-option-name', help: 'Wrapped onto its own line' },
    { name: 'dry-run', flag: true, help: 'Change nothing' },
    { name: 'verbose', flag: true },
  ],
};

const TELNET: ProgramSpec = {
  prog: 'telnet',
  description: 'Run commands over Telnet.',
  options: [],
  positional: 'HOST < COMMANDS',
};

/** The UsageExit `parse` throws for `argv`. */
function exit(spec: ProgramSpec, argv: string[]): UsageExit {
  try {
    parse(spec, argv);
  } catch (error) {
    assert.ok(error instanceof UsageExit, String(error));
    return error;
  }
  assert.fail(`parse accepted ${JSON.stringify(argv)}`);
}

const TV_USAGE = 'usage: pnpm tv [-h] --ssh-config SSH_CONFIG --host HOST {backup,install} ...';

describe('parse', () => {
  it('reads options in both spellings and a subcommand with its own options', () => {
    const parsed = parse(TV, ['--ssh-config=/p/c', '--host', 'tv', 'backup', '--destination', 'd']);
    assert.equal(parsed.command, 'backup');
    assert.deepEqual(Object.fromEntries(parsed.values), {
      'ssh-config': '/p/c',
      host: 'tv',
      destination: 'd',
    });
    assert.equal(optionValue(parsed, 'host'), 'tv');
    assert.throws(() => optionValue(parsed, 'port'), /^Error: Missing --port$/);
    // A repeated option keeps the last value; `=` allows an empty or dash-led value
    const again = parse(TV, ['--host', 'a', '--host=-b', '--ssh-config=', 'install']);
    assert.equal(again.values.get('host'), '-b');
    assert.equal(again.values.get('ssh-config'), '');
  });

  it('fills defaults, switches and integers', () => {
    const plain = parse(EDITOR, ['--host', 'h']);
    assert.equal(plain.command, null);
    assert.equal(plain.values.get('port'), '18765');
    assert.equal(plain.values.has('dry-run'), false);
    const set = parse(EDITOR, ['--host', 'h', '--port', '-1', '--dry-run', '--port=+80']);
    assert.equal(set.values.get('port'), '+80');
    assert.equal(set.values.get('dry-run'), '');
    assert.equal(parse(EDITOR, ['--host', 'h', '--port', '-1']).values.get('port'), '-1');
  });

  it('takes a positional and anything after --', () => {
    assert.equal(parse(TELNET, ['192.0.2.1']).values.get(''), '192.0.2.1');
    assert.equal(parse(TELNET, ['--', '-host']).values.get(''), '-host');
    assert.equal(parse(TELNET, ['-']).values.get(''), '-');
  });

  it('lists every missing required argument, exit status 2', () => {
    const none = exit(TV, []);
    assert.equal(none.status, 2);
    assert.equal(
      none.output,
      `${TV_USAGE}\npnpm tv: error: the following arguments are required: --ssh-config, --host, action\n`,
    );
    assert.match(exit(TV, ['--host', 'h', 'install']).output, /required: --ssh-config\n$/);
    assert.match(
      exit(TELNET, []).output,
      /^usage: telnet \[-h\] HOST < COMMANDS\ntelnet: error: the following arguments are required: HOST\n$/,
    );
  });

  it('names the subcommand in its own usage errors', () => {
    const missing = exit(TV, ['--ssh-config', 'c', '--host', 'h', 'backup']);
    assert.equal(missing.status, 2);
    assert.equal(
      missing.output,
      'usage: pnpm tv backup [-h] --destination DESTINATION\npnpm tv backup: error: the following arguments are required: --destination\n',
    );
    const value = exit(TV, ['--ssh-config', 'c', '--host', 'h', 'backup', '--destination']);
    assert.match(
      value.output,
      /pnpm tv backup: error: argument --destination: expected one argument\n$/,
    );
  });

  it('refuses unknown options, extra words and options of another level', () => {
    for (const [argv, rest] of [
      [['--ssh-config', 'c', '--host', 'h', 'install', '--extra'], '--extra'],
      [['--ssh-config', 'c', '--host', 'h', 'install', 'more', '-x'], 'more -x'],
      // No abbreviations: --ssh is not --ssh-config
      [['--ssh=c', '--ssh-config', 'c', '--host', 'h', 'install'], '--ssh=c'],
    ] as const) {
      const error = exit(TV, [...argv]);
      assert.equal(error.status, 2);
      assert.equal(error.output, `${TV_USAGE}\npnpm tv: error: unrecognized arguments: ${rest}\n`);
    }
    // As in argparse, main options after the subcommand belong to nobody
    assert.match(
      exit(TV, ['--ssh-config', 'c', 'install', '--host', 'h']).output,
      /pnpm tv: error: the following arguments are required: --host\n$/,
    );
    assert.match(
      exit(TV, ['--ssh-config', 'c', 'install', '--host=h', '--host=h']).output,
      /required: --host\n$/,
    );
    assert.match(exit(TELNET, ['a', 'b']).output, /unrecognized arguments: b\n$/);
  });

  it('refuses an invalid subcommand, integer, missing value and a value on a switch', () => {
    assert.match(
      exit(TV, ['--ssh-config', 'c', '--host', 'h', 'frob']).output,
      /error: argument action: invalid choice: 'frob' \(choose from 'backup', 'install'\)\n$/,
    );
    assert.match(
      exit(EDITOR, ['--host', 'h', '--port', 'abc']).output,
      /argument --port: invalid int value: 'abc'\n$/,
    );
    assert.match(exit(EDITOR, ['--host', 'h', '--port=1.5']).output, /invalid int value: '1\.5'/);
    assert.match(exit(EDITOR, ['--host']).output, /argument --host: expected one argument\n$/);
    assert.match(
      exit(EDITOR, ['--host', '--port', '1']).output,
      /argument --host: expected one argument/,
    );
    assert.match(
      exit(EDITOR, ['--host', 'h', '--dry-run=yes']).output,
      /argument --dry-run: ignored explicit argument 'yes'\n$/,
    );
  });

  it('prints help with status 0 at either level, before checking anything else', () => {
    const top = exit(TV, ['--help']);
    assert.equal(top.status, 0);
    assert.equal(
      top.output,
      `${TV_USAGE}

Install and manage Own TV.

options:
  -h, --help            show this help message and exit
  --ssh-config SSH_CONFIG
  --host HOST

commands:
  {backup,install}
`,
    );
    assert.equal(exit(TV, ['--bogus', '-h']).status, 0);
    const sub = exit(TV, ['--ssh-config', 'c', '--host', 'h', 'backup', '-h']);
    assert.equal(
      sub.output,
      'usage: pnpm tv backup [-h] --destination DESTINATION\n\noptions:\n  -h, --help            show this help message and exit\n  --destination DESTINATION\n',
    );
    assert.match(
      exit(TV, ['--ssh-config', 'c', '--host', 'h', 'install', '--help']).output,
      /^usage: pnpm tv install \[-h\]\n\noptions:\n/,
    );
    assert.equal(
      exit(EDITOR, ['-h']).output,
      `usage: pnpm editor [-h] --host HOST [--port PORT] [--a-very-long-option-name A_VERY_LONG_OPTION_NAME] [--dry-run] [--verbose]

A loopback-only browser editor.

options:
  -h, --help            show this help message and exit
  --host HOST
  --port PORT           Port on 127.0.0.1
  --a-very-long-option-name A_VERY_LONG_OPTION_NAME
                        Wrapped onto its own line
  --dry-run             Change nothing
  --verbose
`,
    );
    // After `--`, --help is a plain word
    assert.equal(parse(TELNET, ['--', '--help']).values.get(''), '--help');
  });
});

describe('main', () => {
  /** Runs main() with process output captured; restores the exit code afterwards. */
  async function capture(run: () => Promise<number | undefined> | number | undefined) {
    const written = { stdout: '', stderr: '' };
    const writes = { stdout: process.stdout.write, stderr: process.stderr.write };
    const error = console.error;
    process.stdout.write = ((chunk: string) => {
      written.stdout += chunk;
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      written.stderr += chunk;
      return true;
    }) as typeof process.stderr.write;
    console.error = (...args: unknown[]) => {
      written.stderr += `${args.join(' ')}\n`;
    };
    try {
      await main(run);
      return { ...written, code: process.exitCode };
    } finally {
      process.stdout.write = writes.stdout;
      process.stderr.write = writes.stderr;
      console.error = error;
      process.exitCode = undefined;
    }
  }

  it('passes a status through, and leaves success alone', async () => {
    assert.deepEqual(await capture(() => 3), { stdout: '', stderr: '', code: 3 });
    assert.deepEqual(await capture(() => Promise.resolve(0)), {
      stdout: '',
      stderr: '',
      code: undefined,
    });
    assert.deepEqual(await capture(() => undefined), { stdout: '', stderr: '', code: undefined });
  });

  it('prints usage errors on stderr with status 2 and help on stdout with status 0', async () => {
    const usage = await capture(() => parse(TV, []).values.size);
    assert.equal(usage.code, 2);
    assert.equal(usage.stdout, '');
    assert.match(
      usage.stderr,
      /^usage: pnpm tv .*\npnpm tv: error: the following arguments are required/s,
    );
    const help = await capture(() => parse(TV, ['-h']).values.size);
    assert.equal(help.code, 0);
    assert.equal(help.stderr, '');
    assert.match(help.stdout, /^usage: pnpm tv /);
  });

  it('reports other errors as one line with status 1', async () => {
    const thrown = await capture(() => {
      throw new Error('Keep private backups outside this repository.');
    });
    assert.deepEqual(thrown, {
      stdout: '',
      stderr: 'Keep private backups outside this repository.\n',
      code: 1,
    });
    const rejected = await capture(() => Promise.reject('plain'));
    assert.deepEqual(rejected, { stdout: '', stderr: 'plain\n', code: 1 });
  });

  it('exits 2 with the usage from the real tools', () => {
    for (const [tool, prog] of [
      ['tv', 'pnpm tv'],
      ['editor', 'pnpm editor'],
      ['bootstrap', 'pnpm bootstrap'],
      ['telnet', 'node build/node/tools/telnet.mjs'],
    ] as const) {
      const result = spawnSync(
        process.execPath,
        [path.join(ROOT, `build/node/tools/${tool}.mjs`)],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      assert.equal(result.status, 2, tool);
      assert.equal(result.stdout, '');
      assert.ok(result.stderr.startsWith(`usage: ${prog} [-h]`), result.stderr);
      assert.match(
        result.stderr,
        new RegExp(`\\n${prog}: error: the following arguments are required: `),
      );
    }
    const help = spawnSync(
      process.execPath,
      [path.join(ROOT, 'build/node/tools/package.mjs'), '--help'],
      {
        encoding: 'utf8',
      },
    );
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^usage: pnpm package \[-h\]\n/);
  });
});
