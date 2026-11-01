/* Window globals the dashboard reads. None of them is defined by the bundle itself:
   - OWN_TV_EDITOR: the computer editor's injected script (tools/editor), before app.js
   - OWN_TV_HOME_BRIDGE, OWN_TV_SYSTEM_HOME: Direct Home's injected runtime script
   - PalmServiceBridge, PalmSystem: the webOS web runtime
   - OwnTVMapData: data/geography.js, which the weather view loads on demand */

/** Direct Home's loopback bridge to the TV helper. */
interface OwnTvHomeBridge {
  readonly port: number;
  readonly token: string;
}

/** One Luna service call through the webOS web runtime. */
interface PalmServiceBridge {
  onservicecallback: ((raw: string) => void) | null;
  call(uri: string, payload: string): void;
  cancel(): void;
}

/** A point as [longitude, latitude]. */
type OwnTvMapPoint = readonly [number, number];

/** Natural Earth land polygons (rings of points) and cities as [longitude, latitude, name, population]. */
interface OwnTvMapData {
  readonly polygons: readonly (readonly (readonly OwnTvMapPoint[])[])[];
  readonly cities: readonly (readonly [number, number, string, number])[];
}

interface Window {
  OWN_TV_EDITOR?: boolean;
  OWN_TV_HOME_BRIDGE?: OwnTvHomeBridge;
  OWN_TV_SYSTEM_HOME?: boolean;
  PalmServiceBridge?: new () => PalmServiceBridge;
  PalmSystem?: unknown;
  OwnTVMapData?: OwnTvMapData | null;
}
