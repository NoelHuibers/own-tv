# Own TV

A personal dashboard for rooted LG webOS TVs. Your apps, agenda and TV
status, with a calm night theme and a warm daytime theme. English and German
are built in; any locale can use an offline language pack with English fallback.
Local configuration, no Own TV account and no analytics.

**Initial hardware target:** LG C5, webOS 11.2.0, firmware 43.21.77, Node 20.
Other models are unverified. A successful SlopBro run on a model is not a guarantee
that every launcher feature works there. This project does not root your TV.

## What it does

- Remote-friendly home dashboard and customization controls.
- Offline language packs, regional date/time/number formats and right-to-left layouts.
- Ambient, Quiet and Compact styles; day/night appearance with sunrise/sunset, schedule or system switching.
- Recent-first app favorites (or manual order), optional HDMI inputs, panel hours, health readings and sleep timer.
- Integrated weather app: current conditions, 24-hour and seven-day forecasts, and observed rain radar.
- Optional Open-Meteo weather and a merged read-only calendar agenda (Google, Apple/iCloud, Proton, Outlook, ICS), with individual calendar switches and 86 selectable public holiday calendars.
- Private computer editor over SSH; integration credentials never enter Git.
- Default Home routing that catches direct LG Home launches, private backups and explicit rollback.
- Optional Direct Home on the tested C5: the full dashboard replaces LG Home through a temporary mount, avoiding the LG screen flash on app exit, with heartbeat and crash recovery.
- A conservative firmware-compatibility checker; it never installs unverified firmware.
- Optional C5 memory mode to prevent video-app preloading, with restore and idle-app release controls.
- A smart-home setup panel; actual smart-home control is not implemented yet.

Live widgets show unavailable/setup states when disconnected. They do not invent
sensor values, calendar events or connected devices. App launching does not imply
that the app's streaming service or subscription has been tested.

## Requirements

- A rooted TV with Homebrew Channel and key-based root SSH.
- [Glasshouse](https://github.com/rorygallagher2024/glasshouse), listening only
  on TV loopback, with a unique token. It supplies the TV controls and readings.
  See [the setup guide](docs/SETUP.md).
- Computer: Node 20.12 (the TV's version, pinned in `.node-version`), pnpm,
  OpenSSH and Git. No global LG SDK required.
- TV: Node 18+ and a browser supporting the dashboard. Only the C5 above has
  been tested so far; do not assume old webOS models are compatible.

## Quick start

```sh
git clone https://github.com/NoelHuibers/own-tv.git
cd own-tv
pnpm install
pnpm test
pnpm tv --ssh-config /path/to/private/ssh_config --host living-room backup --destination /path/to/private/backups
pnpm tv --ssh-config /path/to/private/ssh_config --host living-room install
pnpm tv --ssh-config /path/to/private/ssh_config --host living-room open
```

Try the app and remote controls before changing the Home button:

```sh
pnpm tv --ssh-config /path/to/private/ssh_config --host living-room home-enable
# Roll back:
pnpm tv --ssh-config /path/to/private/ssh_config --host living-room home-restore
```

## Customize it yourself

Use the dashboard's settings for appearance, language, app order and widgets.
For a computer-sized editor:

```sh
pnpm editor --ssh-config /path/to/private/ssh_config --host living-room
```

Open the loopback URL printed by the command. Add `/integrations` to configure
weather and a private calendar subscription. No public server is needed. The
editor must stay running while you use it; the TV itself runs independently.

`pnpm preview` serves a disconnected browser preview. `pnpm package` creates
a deterministic unsigned IPK under `dist/`, with no SDK or extra dependencies.
Keep personal profiles, backups and integration files outside this repository.

## Read before modifying the TV

- [Setup and security](docs/SETUP.md)
- [Security model](SECURITY.md)
- [Recovery and uninstall](docs/RECOVERY.md)
- [Direct Home](docs/HOME.md)
- [Private integrations](docs/INTEGRATIONS.md)
- [Languages and translation packs](docs/LANGUAGES.md)
- [Weather and radar](docs/WEATHER.md)
- [LG data deletion](docs/LG-DATA-DELETION.md)
- [Firmware compatibility policy](docs/FIRMWARE.md)

A replacement launcher does not erase LG-held data or remove ads from every
streaming app. Keep OLED protections enabled. Do not install LG Developer Mode
on a rooted TV. Plan firmware updates and recheck privacy settings afterward.

## Development

Everything is TypeScript. The dashboard is in `app/`, bundled by esbuild into one
`app.js` for the TV's Chromium 132 (`build/app`). The fixed-action TV helpers are in
`native/`, compiled by tsc to CommonJS for the TV's Node 20.12 (`build/node/native`).
The packaging and SSH tooling is in `tools/`. There is no privileged web server added by
Own TV. Contributions should include the model/webOS/firmware tested and no private data.

```sh
pnpm install                        # tooling; only ical.js ships to the TV
pnpm exec playwright install chromium   # once, for the browser tests
pnpm build                          # tsc for helpers/tools, esbuild for the dashboard
pnpm preview                        # the built dashboard on http://127.0.0.1:5173
pnpm lint                           # Biome: lint rules and formatting
pnpm format                         # apply Biome's safe fixes and formatting
pnpm typecheck                      # tsc over helpers, tools, dashboard and browser tests
pnpm test                           # unit tests of helpers, tools and dashboard modules
pnpm test:e2e                       # dashboard previews at 1080p/720p in Chromium
pnpm coverage                       # line coverage, checked against the baseline
pnpm check                          # lint, types, unit and browser tests together
```

Development and CI use the TV's own Node 20.12.2, so nothing passes on the
computer that the TV can't run. CI runs on every pull request and on `main`:
[Biome](https://biomejs.dev/) with strict rules, tsc in strict mode, ShellCheck
(the boot hooks), unit tests on Node 20.12, coverage against
`scripts/coverage-baseline.json`, a reproducible IPK build (downloadable from the
run) and the browser tests. `main` only changes through pull requests that pass
the **CI** check. Docs-only pull requests skip the builds. When coverage
intentionally changes, store the new numbers with `pnpm coverage --update`.

## Credits and license

MIT for Own TV. Calendar parsing uses [ical.js](https://github.com/kewisch/ical.js)
(MPL-2.0); its package and license are included in native deployments. Glasshouse
is an independent project with its own license; it is not vendored here.
SlopBro and Homebrew Channel enable the underlying root access. Hearth's
webOS 11 permission documentation informed the scoped permission repair tool.
Weather uses Open-Meteo; radar imagery uses RainViewer for personal/educational use.
Bundled geography is Natural Earth public-domain data. See [weather sources](docs/WEATHER.md).
UI design implementation was delegated to Claude Opus 5.5 at High effort.
