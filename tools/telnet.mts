// Temporary transport for an owner-authorized, already-rooted webOS TV.
//
// Use only to establish SSH. Telnet sends everything unencrypted.
//
//   node build/node/tools/telnet.mjs HOST < commands.sh

import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { main, optionValue, parse } from './cli.mjs';
import { isMain } from './paths.mjs';
import { splitLines } from './ssh.mjs';

const IAC = 0xff;
const DO = 0xfd;
const WONT = 0xfc;
const DONT = 0xfe;

/** A socket read like Python's sock.recv(max) with a timeout: null on timeout, empty at EOF. */
class Reader {
  private readonly buffered: Buffer[] = [];
  private ended = false;
  private failure: Error | null = null;
  private wake: (() => void) | null = null;

  constructor(socket: net.Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffered.push(chunk);
      this.wake?.();
    });
    socket.on('end', () => {
      this.ended = true;
      this.wake?.();
    });
    socket.on('error', (error) => {
      this.failure = error;
      this.wake?.();
    });
  }

  async recv(max: number, timeoutMs: number): Promise<Buffer | null> {
    if (this.buffered.length === 0 && !this.ended && !this.failure) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wake = null;
    }
    if (this.failure) {
      throw this.failure;
    }
    const chunk = this.buffered.shift();
    if (!chunk) {
      return this.ended ? Buffer.alloc(0) : null;
    }
    if (chunk.length > max) {
      this.buffered.unshift(chunk.subarray(max));
      return chunk.subarray(0, max);
    }
    return chunk;
  }
}

function connect(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('timed out'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Answers every option negotiation (IAC WILL/WONT/DO/DONT option) with a refusal: WONT for
 * DO, DONT for the rest, so the remote shell stays a plain byte stream.
 */
export function refusals(initial: Buffer): Buffer[] {
  const replies: Buffer[] = [];
  for (let i = 0; i + 2 < initial.length; i += 1) {
    const verb = initial[i + 1] ?? 0;
    const option = initial[i + 2] ?? 0;
    // Python's regex `.` does not match a newline byte
    if (initial[i] === IAC && verb >= 0xfb && verb <= DONT && option !== 0x0a) {
      replies.push(Buffer.from([IAC, verb === DO ? WONT : DONT, option]));
      i += 2;
    }
  }
  return replies;
}

/** The shell line that runs `command` (as base64, so nothing in it is interpreted early). */
export function wire(command: string, marker: string): string {
  const encoded = Buffer.from(command, 'utf8').toString('base64');
  return `stty -echo; echo '${encoded}' | base64 -d | /bin/sh; printf '\\n${marker}:%s\\n' "$?"\r\n`;
}

const strip = (text: string): string =>
  text.replace(/^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/g, '');

/**
 * Parses what the TV sent so far: null until the completion marker has arrived, then the
 * exit status and the output, without the terminal's echo of the command line.
 */
export function completion(output: Buffer, marker: string): [number, string] | null {
  // latin1 keeps one character per byte, so match offsets are byte offsets
  const match = new RegExp(`\\r?\\n${marker}:([0-9]+)\\r?\\n`).exec(output.toString('latin1'));
  if (!match) {
    return null;
  }
  const lines = splitLines(output.subarray(0, match.index).toString('utf8'));
  const echo = lines.findIndex((line) => line.includes(marker));
  return [Number(match[1]), strip(lines.slice(echo + 1).join('\n'))];
}

/** Runs `command` in the TV's root shell over Telnet: [exit status, output]. */
export async function run(
  host: string,
  command: string,
  timeout = 30,
  port = 23,
): Promise<[number, string]> {
  const marker = `OWNTV_${randomBytes(12).toString('hex')}`;
  const socket = await connect(host, port, 5000);
  try {
    const reader = new Reader(socket);
    // Python: sock.settimeout(1); sock.recv(4096) raises when nothing arrives in a second
    const initial = await reader.recv(4096, 1000);
    if (initial === null) {
      throw new Error('timed out');
    }
    for (const reply of refusals(initial)) {
      socket.write(reply);
    }
    socket.write(wire(command, marker));
    let output = Buffer.alloc(0);
    const deadline = performance.now() + timeout * 1000;
    while (performance.now() < deadline) {
      const chunk = await reader.recv(65_536, 1000);
      if (chunk === null) {
        continue;
      }
      if (chunk.length === 0) {
        break;
      }
      output = Buffer.concat([output, chunk]);
      const done = completion(output, marker);
      if (done) {
        return done;
      }
    }
    throw new Error('TV did not return a command completion marker');
  } finally {
    socket.destroy();
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

if (isMain(import.meta.url)) {
  await main(async () => {
    const parsed = parse(
      {
        prog: 'node build/node/tools/telnet.mjs',
        description:
          'Run the commands on stdin in the root shell of an already-rooted TV over Telnet. Use only to establish SSH; Telnet sends everything unencrypted.',
        options: [],
        positional: 'HOST',
      },
      process.argv.slice(2),
    );
    const [status, output] = await run(optionValue(parsed, ''), await readStdin());
    console.log(output);
    return status;
  });
}
