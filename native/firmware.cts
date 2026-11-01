// Compatibility evidence is not a firmware flasher or a promise of zero risk.

/** One installed third-party app and its version. */
export interface AppVersion {
  readonly id: string;
  readonly version: unknown;
}

/** The TV's current setup, as far as the helper could read it. */
export interface CurrentSetup {
  readonly model: string;
  readonly country: unknown;
  readonly otaid: unknown;
  readonly firmware: unknown;
  readonly components: Readonly<Record<string, unknown>>;
  readonly apps: readonly AppVersion[];
}

export interface FirmwareReport {
  readonly currentFirmware: unknown;
  readonly model: string;
  readonly eligible: boolean;
  readonly installable: false;
  readonly availableOnLg: null;
  readonly status: 'unverified' | 'verified-report';
  readonly message: string;
  readonly requiredChecks: readonly string[];
  readonly targetFirmware?: unknown;
  readonly evidence?: readonly string[];
}

export const REQUIRED: readonly string[] = [
  'rootPersistence',
  'homebrew',
  'launcher',
  'privacy',
  'ssh',
  'oledProtection',
  'streamingPlayback',
];

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function version(v: unknown): number[] | null {
  return typeof v === 'string' && /^\d{2}\.\d{2}\.\d{2}$/.test(v) ? v.split('.').map(Number) : null;
}

export function newer(a: unknown, b: unknown): boolean {
  const x = version(a);
  const y = version(b);
  if (!(x && y)) {
    return false;
  }
  for (const [i, part] of x.entries()) {
    const other = y[i] ?? 0;
    if (part !== other) {
      return part > other;
    }
  }
  return false;
}

function isEvidence(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((u) => typeof u === 'string' && /^https:\/\//.test(u))
  );
}

/** The report's evidence links when it covers this complete setup, otherwise null. */
function matchingEvidence(
  current: CurrentSetup,
  r: Readonly<Record<string, unknown>>,
  now: Date,
): readonly string[] | null {
  if (!(current.otaid && current.country)) {
    return null;
  }
  const expiry = Date.parse(String(r.validUntil));
  if (!Number.isFinite(expiry) || expiry < now.getTime()) {
    return null;
  }
  const components = r.components;
  if (
    !components ||
    !['homebrew', 'ownTv', 'glasshouse'].every(
      (k) =>
        typeof current.components[k] === 'string' && current.components[k] === field(components, k),
    )
  ) {
    return null;
  }
  const checks = r.checks;
  if (!checks || !REQUIRED.every((k) => field(checks, k) === true)) {
    return null;
  }
  const evidence = r.evidence;
  if (!isEvidence(evidence)) {
    return null;
  }
  const apps = r.apps;
  const working =
    Array.isArray(current.apps) &&
    current.apps.length > 0 &&
    Boolean(apps) &&
    current.apps.every(
      (a) =>
        field(field(apps, a.id), 'working') === true &&
        field(field(apps, a.id), 'version') === a.version,
    );
  return working ? evidence : null;
}

export function evaluate(
  current: CurrentSetup,
  catalog: unknown,
  now: Date = new Date(),
): FirmwareReport {
  const base: FirmwareReport = {
    currentFirmware: current.firmware,
    model: current.model,
    eligible: false,
    installable: false,
    availableOnLg: null,
    status: 'unverified',
    message: 'No verified compatible upgrade for this complete setup.',
    requiredChecks: REQUIRED,
  };
  if (!isObject(catalog) || catalog.schema !== 1 || !Array.isArray(catalog.records)) {
    return { ...base, message: 'Compatibility catalogue unavailable or invalid.' };
  }
  const records = catalog.records.filter(
    (r: unknown): r is Readonly<Record<string, unknown>> =>
      isObject(r) &&
      r.verified === true &&
      r.model === current.model &&
      r.country === current.country &&
      r.otaid === current.otaid &&
      r.fromFirmware === current.firmware &&
      newer(r.targetFirmware, current.firmware),
  );
  for (const r of records) {
    const evidence = matchingEvidence(current, r, now);
    if (!evidence) {
      continue;
    }
    return {
      ...base,
      eligible: true,
      status: 'verified-report',
      targetFirmware: r.targetFirmware,
      evidence,
      message:
        'A matching compatibility report exists. Automatic installation is not implemented; LG availability and final preflight still need verification.',
    };
  }
  return base;
}
