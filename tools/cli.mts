// A small command-line parser with the conventions of the Python argparse CLIs these tools
// replace: long options (`--name VALUE` or `--name=VALUE`), required options, optional
// subcommands, -h/--help, and usage errors on stderr with exit status 2.

export interface OptionSpec {
  readonly name: string;
  /** A switch without a value. */
  readonly flag?: boolean;
  readonly required?: boolean;
  /** Value must be an integer. */
  readonly integer?: boolean;
  readonly default?: string;
  readonly help?: string;
}

export interface CommandSpec {
  readonly name: string;
  readonly options?: readonly OptionSpec[];
}

export interface ProgramSpec {
  /** How the user starts the program, e.g. `pnpm tv`. */
  readonly prog: string;
  readonly description: string;
  readonly options: readonly OptionSpec[];
  readonly commands?: readonly CommandSpec[];
  /** Extra usage words after the options, e.g. `HOST < COMMANDS`. */
  readonly positional?: string;
}

export interface Parsed {
  readonly command: string | null;
  /** Option values by name (without dashes); switches that were given hold ''. */
  readonly values: ReadonlyMap<string, string>;
}

export class UsageExit extends Error {
  readonly status: number;
  readonly output: string;
  constructor(status: number, output: string) {
    super(output);
    this.status = status;
    this.output = output;
  }
}

const metavar = (option: OptionSpec): string => option.name.toUpperCase().replaceAll('-', '_');

function optionUsage(options: readonly OptionSpec[]): string {
  return [
    '[-h]',
    ...options.map((o) => {
      const text = o.flag ? `--${o.name}` : `--${o.name} ${metavar(o)}`;
      return o.required ? text : `[${text}]`;
    }),
  ].join(' ');
}

function usage(spec: ProgramSpec, command: CommandSpec | null): string {
  if (command) {
    return `usage: ${spec.prog} ${command.name} ${optionUsage(command.options ?? [])}`;
  }
  const commands = spec.commands ? ` {${spec.commands.map((c) => c.name).join(',')}} ...` : '';
  const positional = spec.positional ? ` ${spec.positional}` : '';
  return `usage: ${spec.prog} ${optionUsage(spec.options)}${commands}${positional}`;
}

function optionHelp(options: readonly OptionSpec[]): string[] {
  const lines = ['options:', '  -h, --help            show this help message and exit'];
  for (const o of options) {
    const text = o.flag ? `--${o.name}` : `--${o.name} ${metavar(o)}`;
    if (!o.help) {
      lines.push(`  ${text}`);
    } else if (text.length <= 20) {
      lines.push(`  ${text.padEnd(22)}${o.help}`);
    } else {
      lines.push(`  ${text}`, `                        ${o.help}`);
    }
  }
  return lines;
}

function help(spec: ProgramSpec, command: CommandSpec | null): string {
  const lines = [usage(spec, command), ''];
  if (!command) {
    lines.push(spec.description, '');
  }
  lines.push(...optionHelp(command ? (command.options ?? []) : spec.options));
  if (!command && spec.commands) {
    lines.push('', 'commands:', `  {${spec.commands.map((c) => c.name).join(',')}}`);
  }
  return `${lines.join('\n')}\n`;
}

function fail(spec: ProgramSpec, command: CommandSpec | null, message: string): never {
  const prog = command ? `${spec.prog} ${command.name}` : spec.prog;
  throw new UsageExit(2, `${usage(spec, command)}\n${prog}: error: ${message}\n`);
}

const looksLikeOption = (token: string): boolean =>
  token.startsWith('-') && token !== '-' && !/^-(?:\d+|\d*\.\d+)$/.test(token);

/** Parses `argv`; throws UsageExit for --help (status 0) and usage errors (status 2). */
export function parse(spec: ProgramSpec, argv: readonly string[]): Parsed {
  const values = new Map<string, string>();
  const unrecognized: string[] = [];
  let command: CommandSpec | null = null;
  let onlyPositionals = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? '';
    const options = command ? (command.options ?? []) : spec.options;
    if (!onlyPositionals && token === '--') {
      onlyPositionals = true;
    } else if (!onlyPositionals && (token === '-h' || token === '--help')) {
      throw new UsageExit(0, help(spec, command));
    } else if (!onlyPositionals && looksLikeOption(token)) {
      const equals = token.indexOf('=');
      const name = (equals === -1 ? token : token.slice(0, equals)).replace(/^--/, '');
      const option = token.startsWith('--') ? options.find((o) => o.name === name) : undefined;
      if (!option) {
        unrecognized.push(token);
        continue;
      }
      if (option.flag) {
        if (equals !== -1) {
          fail(
            spec,
            command,
            `argument --${name}: ignored explicit argument '${token.slice(equals + 1)}'`,
          );
        }
        values.set(name, '');
        continue;
      }
      let value: string;
      if (equals === -1) {
        const next = argv[i + 1];
        if (next === undefined || looksLikeOption(next)) {
          fail(spec, command, `argument --${name}: expected one argument`);
        }
        value = next;
        i += 1;
      } else {
        value = token.slice(equals + 1);
      }
      if (option.integer && !/^\s*[-+]?\d+\s*$/.test(value)) {
        fail(spec, command, `argument --${name}: invalid int value: '${value}'`);
      }
      values.set(name, value);
    } else if (!command && spec.commands) {
      const chosen = spec.commands.find((c) => c.name === token);
      if (!chosen) {
        const choices = spec.commands.map((c) => `'${c.name}'`).join(', ');
        fail(spec, null, `argument action: invalid choice: '${token}' (choose from ${choices})`);
      }
      command = chosen;
    } else if (spec.positional && !values.has('')) {
      values.set('', token);
    } else {
      unrecognized.push(token);
    }
  }
  const missing = (options: readonly OptionSpec[]): string[] =>
    options.filter((o) => o.required && !values.has(o.name)).map((o) => `--${o.name}`);
  if (command) {
    const absent = missing(command.options ?? []);
    if (absent.length > 0) {
      fail(spec, command, `the following arguments are required: ${absent.join(', ')}`);
    }
  }
  const absent = missing(spec.options);
  if (spec.commands && !command) {
    absent.push('action');
  }
  if (spec.positional && !values.has('')) {
    absent.push(spec.positional.split(' ')[0] ?? 'argument');
  }
  if (absent.length > 0) {
    fail(spec, null, `the following arguments are required: ${absent.join(', ')}`);
  }
  if (unrecognized.length > 0) {
    fail(spec, null, `unrecognized arguments: ${unrecognized.join(' ')}`);
  }
  for (const o of [...spec.options, ...(command?.options ?? [])]) {
    if (o.default !== undefined && !values.has(o.name)) {
      values.set(o.name, o.default);
    }
  }
  return { command: command?.name ?? null, values };
}

/** A parsed option that was required (parse() already checked it is present). */
export function optionValue(parsed: Parsed, name: string): string {
  const found = parsed.values.get(name);
  if (found === undefined) {
    throw new Error(`Missing --${name}`);
  }
  return found;
}

/**
 * Runs a CLI's main function: usage output and exit status for UsageExit, and for any other
 * error its message on stderr and status 1 (Python printed a traceback).
 */
export async function main(
  run: () => Promise<number | undefined> | number | undefined,
): Promise<void> {
  try {
    const status = await run();
    if (status) {
      process.exitCode = status;
    }
  } catch (error) {
    if (error instanceof UsageExit) {
      (error.status === 0 ? process.stdout : process.stderr).write(error.output);
      process.exitCode = error.status;
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
