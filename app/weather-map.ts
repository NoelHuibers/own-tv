/* Web Mercator math and the fixed RainViewer tile URL. */

export interface Point {
  x: number;
  y: number;
}

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

const TILE = 256;
const MAX_LATITUDE = 85;
const MIN_ZOOM = 4;
const MAX_ZOOM = 7;
const FRAME_PATH = /^\/v2\/radar\/[a-zA-Z0-9_-]{1,80}$/;

export function project(lat: number, lon: number, zoom: number): Point {
  const size = TILE * 2 ** zoom;
  const sin = Math.sin((Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat)) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

export function unproject(p: Point, zoom: number): Coordinates {
  const size = TILE * 2 ** zoom;
  return {
    longitude: (((((p.x / size) * 360) % 360) + 360) % 360) - 180,
    latitude: Math.max(
      -80,
      Math.min(80, (Math.atan(Math.sinh(Math.PI * (1 - (2 * p.y) / size))) * 180) / Math.PI),
    ),
  };
}

export function tileUrl(
  center: Coordinates | null | undefined,
  zoom: number,
  path: string,
  coverage: boolean,
): string {
  if (
    !center ||
    !Number.isFinite(center.latitude) ||
    !Number.isFinite(center.longitude) ||
    Math.abs(center.latitude) > MAX_LATITUDE ||
    Math.abs(center.longitude) > 180 ||
    !Number.isInteger(zoom) ||
    zoom < MIN_ZOOM ||
    zoom > MAX_ZOOM
  ) {
    throw new Error('Invalid radar coordinates');
  }
  if (coverage ? path !== '/v2/coverage/0' : !FRAME_PATH.test(path)) {
    throw new Error('Invalid radar frame');
  }
  const lat = center.latitude.toFixed(4);
  const lon = center.longitude.toFixed(4);
  return `https://tilecache.rainviewer.com${path}/512/${zoom}/${lat}/${lon}${coverage ? '/0/0_0.png' : '/2/1_1.png'}`;
}
