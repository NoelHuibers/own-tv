/* Colour helpers for app artwork. Card colour comes from the TV's own icon: a tiny canvas
   reads the icon's edge and its most colourful tone. Precomputed hex (no color-mix) for
   older engines. */

export type Rgb = readonly [number, number, number];

export interface Tone {
  readonly tone: string;
  readonly neutral: boolean;
}

export function hexToRgb(hx: string): Rgb {
  const n = Number.parseInt(hx.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(c: readonly number[]): string {
  return `#${c
    .map((v) => {
      const b = Math.max(0, Math.min(255, Math.round(v)));
      return (b < 16 ? '0' : '') + b.toString(16);
    })
    .join('')}`;
}

export function mix(a: string, b: string, w: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v * w + (B[i] ?? 0) * (1 - w)));
}

export function satOf(c: Rgb): number {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  return mx === 0 ? 0 : (mx - mn) / mx;
}

export function lumOf(hx: string): number {
  const [r, g, b] = hexToRgb(hx).map((v) => {
    const s = v / 255;
    return s <= 0.039_28 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

export function hashStr(s: string): number {
  let x = 0;
  for (let i = 0; i < s.length; i++) {
    x = (x * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(x);
}

/** Two letters for a card without an icon: the initials, or the start of one word. */
export function monoFor(title: string): string {
  const words = String(title)
    .replace(/[^\p{L}\p{N}+ ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const [first, second] = words;
  if (first === undefined) {
    return '?';
  }
  if (second === undefined) {
    return first.slice(0, 2);
  }
  return (first[0] ?? '') + (second[0] ?? '');
}

/** The icon's colourful background, else its most colourful tone, else its neutral base. */
export function readTone(img: HTMLImageElement): Tone | null {
  try {
    const n = 20;
    const cv = document.createElement('canvas');
    cv.width = n;
    cv.height = n;
    const cx = cv.getContext('2d');
    if (!cx) {
      return null;
    }
    cx.drawImage(img, 0, 0, n, n);
    const d = cx.getImageData(0, 0, n, n).data;
    const edge: [number, number, number] = [0, 0, 0];
    let edgeN = 0;
    let edgeTotal = 0;
    const body: [number, number, number] = [0, 0, 0];
    let bodyW = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        const a = d[i + 3] ?? 0;
        const isEdge = x < 2 || y < 2 || x >= n - 2 || y >= n - 2;
        if (isEdge) {
          edgeTotal++;
        }
        if (a < 170) {
          continue;
        }
        const px: Rgb = [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0];
        if (isEdge) {
          edge[0] += px[0];
          edge[1] += px[1];
          edge[2] += px[2];
          edgeN++;
        }
        const s = satOf(px);
        const w = 0.05 + s * s * 4;
        body[0] += px[0] * w;
        body[1] += px[1] * w;
        body[2] += px[2] * w;
        bodyW += w;
      }
    }
    const edgeHex = edgeN / edgeTotal > 0.7 ? rgbToHex(edge.map((v) => v / edgeN)) : null;
    const bodyHex = bodyW ? rgbToHex(body.map((v) => v / bodyW)) : null;
    // Prefer the icon's own colourful background; otherwise its most colourful tone.
    if (edgeHex && satOf(hexToRgb(edgeHex)) > 0.28) {
      return { tone: edgeHex, neutral: false };
    }
    if (bodyHex && satOf(hexToRgb(bodyHex)) > 0.28) {
      return { tone: bodyHex, neutral: false };
    }
    const base = edgeHex || bodyHex;
    return base ? { tone: base, neutral: true } : null;
  } catch {
    return null;
  }
}
