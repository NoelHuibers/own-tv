// Reading untyped JSON (helper replies, files on the fake TV) in assertions.
import assert from 'node:assert/strict';

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** `value.a.b`, or undefined as soon as a step is not an object. */
export function field(value: unknown, ...keys: (string | number)[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/** The value, which must be a list. */
export function list(value: unknown): readonly unknown[] {
  assert.ok(Array.isArray(value), 'expected a list');
  return value;
}

/** The value, which must be a JSON object. */
export function record(value: unknown): Readonly<Record<string, unknown>> {
  assert.ok(isObject(value) && !Array.isArray(value), 'expected an object');
  return value;
}

/** The first list entry whose `key` equals `expected`. */
export function find(value: unknown, key: string, expected: unknown): unknown {
  return list(value).find((item) => field(item, key) === expected);
}

/** Parsed JSON from a file. */
export function readJson(text: string): unknown {
  return JSON.parse(text);
}
