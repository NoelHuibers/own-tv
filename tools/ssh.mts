// Running commands on the TV over SSH, shared by tv.mts and editor.mts.
//
// Every connection uses the private ssh_config, BatchMode (keys only, no prompts) and
// StrictHostKeyChecking=yes (the host key pinned during bootstrap). Remote commands are one
// string quoted like Python's shlex.join, so arguments reach the TV's shell unchanged.

import { spawn, spawnSync } from 'node:child_process';

/** Python's shlex.quote: POSIX single quotes unless the string is safe as it is. */
export function quote(word: string): string {
  if (word === '') {
    return "''";
  }
  if (!/[^\w@%+=:,./-]/.test(word)) {
    return word;
  }
  return `'${word.replaceAll("'", `'"'"'`)}'`;
}

/** Python's shlex.join. */
export function shellJoin(words: readonly string[]): string {
  return words.map(quote).join(' ');
}

/**
 * JSON like Python's json.dumps: non-ASCII characters escaped as \uXXXX, so command lines
 * and files stay plain ASCII whatever the TV returned.
 */
export function asciiJson(data: unknown, indent?: number): string {
  return (JSON.stringify(data, null, indent) ?? 'null').replace(
    /[\u0080-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Python's str.splitlines(). */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

/** The arguments for ssh. `-tt` (a forced PTY) only when asked for. */
export function sshArgs(config: string, host: string, command: string, tty = false): string[] {
  return [
    ...(tty ? ['-tt'] : []),
    '-F',
    config,
    '-o',
    'BatchMode=yes',
    '-o',
    // biome-ignore lint/security/noSecrets: an ssh option, not a credential
    'StrictHostKeyChecking=yes',
    host,
    command,
  ];
}

/** The remote command line for one helper action, its value as base64 JSON. */
export function helperCommand(action: string, value?: unknown): string {
  const command = ['/usr/bin/node', '/var/lib/own-tv/helper.cjs', action];
  if (value !== undefined && value !== null) {
    command.push(Buffer.from(asciiJson(value)).toString('base64'));
  }
  return shellJoin(command);
}

/** A command that ran past its timeout. The message never contains the command. */
export class TimeoutError extends Error {
  constructor(seconds: number) {
    super(`The TV connection timed out after ${seconds} seconds.`);
    this.name = 'TimeoutError';
  }
}

/** A remote command that failed; the message is its stderr (or stdout). */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface Result {
  readonly status: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

// Large enough for a backup archive; the timeout bounds everything else.
const MAX_OUTPUT = 2 ** 31 - 1;

/**
 * Runs ssh and waits, like Python's subprocess.run(capture_output=True, timeout=…): stdin is
 * `input` when given, otherwise inherited; the process is killed on timeout.
 */
export function runSync(
  program: string,
  args: readonly string[],
  input: Buffer | null,
  timeoutSeconds: number,
): Result {
  const result = spawnSync(program, args, {
    ...(input ? { input } : {}),
    stdio: [input ? 'pipe' : 'inherit', 'pipe', 'pipe'],
    timeout: timeoutSeconds * 1000,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_OUTPUT,
  });
  const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ETIMEDOUT') {
    throw new TimeoutError(timeoutSeconds);
  }
  // A command may exit without reading all of its input (`test -f … || cat > …`). Like
  // Python's subprocess.run, ignore the broken pipe and judge by the exit status.
  if (result.error && !(code === 'EPIPE' && (result.status !== null || result.signal))) {
    throw result.error;
  }
  return {
    status: result.signal ? -1 : result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** The same without blocking, for the editor's server. */
export function run(
  program: string,
  args: readonly string[],
  timeoutSeconds: number,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutSeconds * 1000);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new TimeoutError(timeoutSeconds));
        return;
      }
      resolve({
        status: signal ? -1 : status,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}
