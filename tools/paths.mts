// Paths shared by the host tools. They run compiled from build/node/tools.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The repository, with symlinks resolved (build/node/tools → the repository). */
export const ROOT = fs.realpathSync(path.resolve(import.meta.dirname, '../../..'));
/** The built dashboard: the IPK root and what the editor serves. */
export const APP = path.join(ROOT, 'build/app');
/** The compiled TV helpers. */
export const NATIVE = path.join(ROOT, 'build/node/native');

/** True when the module at `url` is the program node was started with. */
export function isMain(url: string): boolean {
  const script = process.argv[1];
  if (!script) {
    return false;
  }
  try {
    return pathToFileURL(fs.realpathSync(script)).href === url;
  } catch {
    return false;
  }
}

/**
 * Resolves a path the user typed. `pnpm tv …` runs from the repository root, so a relative
 * path is taken from the directory pnpm was started in (INIT_CWD), like Python's cwd was.
 */
export function userPath(input: string): string {
  let expanded = input;
  if (input === '~' || input.startsWith('~/')) {
    expanded = path.join(os.homedir(), input.slice(1));
  }
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), expanded);
}

/** Like Python's Path.resolve(): follows symlinks for the part of the path that exists. */
export function realResolve(input: string): string {
  const absolute = path.resolve(input);
  const rest: string[] = [];
  let existing = absolute;
  for (;;) {
    try {
      return path.join(fs.realpathSync(existing), ...rest);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) {
        return absolute;
      }
      rest.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

/** True when `child` is `parent` or lies inside it (both already resolved). */
export function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
  );
}
