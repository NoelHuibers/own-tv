/* App catalogue: the seven must-have favourites.
   The artwork is the TV's own installed icon (from the bridge). Without an icon, a card
   shows the app's name in type on its colour field; no brand logos are reproduced. `art`
   is that fallback field colour. `ids` are best-known webOS app ids; the bridge's app list
   always wins. */

export interface CatalogApp {
  readonly key: string;
  readonly title: string;
  readonly mono: string;
  readonly art: string;
  readonly ids: readonly [string, ...string[]];
  readonly names: readonly string[];
}

export const CATALOG: readonly CatalogApp[] = [
  {
    key: 'youtube',
    title: 'YouTube',
    mono: 'YT',
    art: '#c4302b',
    ids: ['youtube.leanback.v4', 'youtube.leanback.v3'],
    names: ['youtube'],
  },
  {
    key: 'twitch',
    title: 'Twitch',
    mono: 'Tw',
    art: '#7646d6',
    ids: ['tv.twitch.tv.starshot.lg', 'twitch'],
    names: ['twitch'],
  },
  {
    key: 'spotify',
    title: 'Spotify',
    mono: 'Sp',
    art: '#1c9a52',
    ids: ['spotify-beehive', 'com.spotify.app'],
    names: ['spotify', 'spotify - music and podcasts'],
  },
  {
    key: 'netflix',
    title: 'Netflix',
    mono: 'N',
    art: '#b3121b',
    ids: ['netflix'],
    names: ['netflix'],
  },
  {
    key: 'prime',
    title: 'Prime Video',
    mono: 'pv',
    art: '#1b78b8',
    ids: ['amazon', 'com.amazon.amazonvideo.webos'],
    names: ['prime video', 'amazon prime video'],
  },
  {
    key: 'disney',
    title: 'Disney+',
    mono: 'D+',
    art: '#1d3b8c',
    ids: ['com.disney.disneyplus-prod'],
    names: ['disney+', 'disney plus'],
  },
  {
    key: 'rtlplus',
    title: 'RTL+',
    mono: 'R+',
    art: '#d4502a',
    ids: ['com.netrtl.tvnow', 'de.rtl.rtlplus', 'de.rtl.tvnow', 'com.rtl.rtlplus'],
    names: ['rtl+', 'rtl plus', 'tvnow'],
  },
];

export const CATALOG_BY_KEY: ReadonlyMap<string, CatalogApp> = new Map(
  CATALOG.map((c) => [c.key, c]),
);

/** Field colours for apps outside the catalogue, picked by a hash of the app id. */
export const EXTRA_ART = [
  '#8a6a2a',
  '#2a7a72',
  '#8e3d78',
  '#5d6b22',
  '#3a5f8f',
  '#7a4a3a',
] as const;

export const APP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

/** A catalogue key, or `app:` + a webOS app id. */
export function validAppKey(k: unknown): k is string {
  if (typeof k !== 'string') {
    return false;
  }
  if (CATALOG_BY_KEY.has(k)) {
    return true;
  }
  return k.startsWith('app:') && APP_ID_RE.test(k.slice(4));
}
