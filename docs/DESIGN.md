# Own TV — Dashboard design

The dashboard is a personal home screen for an LG OLED C5 (webOS 11.2, Chromium).
It is plain HTML, CSS and JavaScript: no framework, no build step, no remote fonts, no
analytics and no external assets.

```
app/index.html   markup shell, CSP, inline SVG icon sprite, loads bridge.js → app.js
app/styles.css   theme tokens (Night/Day), style families, layout, focus, motion
app/app.js       state, rendering, colour extraction, D-pad navigation, settings, sync
app/bridge.js    parent-owned hardware bridge (window.OwnTVBridge) — not part of this design
```

## 1. Concept: media first, details on focus

The screen exists to open your apps quickly. Everything else stays compact and quiet
until you ask for it.

- **Your apps are the hero.** One row of large cards, each built from the TV's own
  installed icon. The card colour is read from that icon, so YouTube looks like YouTube
  without anything being redrawn. All seven favourites are visible at once, and one
  press opens any of them.
- **Light follows focus.** In the default style, a soft light behind the cards takes on
  the colour of the focused app and crossfades as you move. It is the screen's one
  atmospheric touch, and it is dim at night.
- **Widgets live in one compact shelf** under the apps: weather, calendar, recent
  apps, sleep timer, this TV, smart home (and HDMI inputs if you switch them on). Each
  shows one useful line.
- **Details unfold on focus.** Focusing a widget unfolds a small panel above it,
  into the quiet band between cards and shelf: later events, when the weather was
  fetched, uptime/model/firmware/privacy, what a setup step involves. Focusing a card
  names the app and says "Last used" or "Not in the TV's app list" when that is true.
  Nothing is shown just to fill space.
- **Deliberately absent:** live/status dots in normal operation, section numbers,
  taglines, a second clock, decorative wallpaper text, big empty setup boxes.

### Two independent axes

| Axis | Attribute | Values | Purpose |
| --- | --- | --- | --- |
| Theme | `html[data-theme]` | `night`, `day` | Light: OLED black or warm paper. Manual or Auto (schedule/system) |
| Style | `html[data-style]` | `ambient` (default), `quiet`, `compact` | Composition and character |

Every style works in both themes, so there are six combinations. All are verified at
1920×1080.

### Styles

| Style | Character | What changes |
| --- | --- | --- |
| **Ambient** (default) | Atmospheric, media first | Full colour cards (portrait, 11.18 × 16.2 rem), the atmosphere light, other cards step back slightly while the row has focus, glassy widget faces, detail panels float above the shelf |
| **Quiet** | Restrained, typographic | Neutral card surfaces where colour survives only as a short hairline under each icon. No atmosphere, no zoom (only a small lift). Widgets have no boxes and are separated by hairlines |
| **Compact** | Technical, everything visible | Smaller square tiles in a grid on the left. On the right, one panel of label/value rows with every reading inline (no pop-ups). If space runs short, the agenda's extra lines give way first, never the page |

Styles are pure CSS variations of the same DOM (`--card-w`, `--card-h`, `--icon`,
plus composition rules), so behaviour, navigation and accessibility are identical.
The owner gets a polished default and never has to pick one. Others can switch styles
in Settings → Appearance (each choice shows a live mini preview), or with the **Red**
key.

### Themes

**Night (OLED dark room)**
- Pure `#000` background, warm ivory ink `#ede6d9`, amber accent `#e5aa5e`.
- Card fields are the app colour mixed 50 % toward black, so seven cards never glare.
  The atmosphere glow is the colour at 30 %, shown at 72 % opacity.
- Focus is the most luminant thing on screen: a warm-white ring (`#f4ecde`) with a
  black gap.

**Day (warm and personal)**
- Warm paper `#f2ebdf` with one static soft light from the top left. Brown ink
  `#2a231c`, terracotta accent `#ad4c25`.
- Card fields are the app colour at 86 % over paper. Focus is a dark ink ring
  (`#231d17`).

Auto switches by schedule (default: day 07:00, night 19:30) or by the system
appearance. Yellow cycles Day → Night → Auto as a manual override.

## 2. App artwork

- The bridge supplies each app's installed icon as a `data:` URI. `artFor()` draws it
  on a 20×20 canvas, averages the opaque border pixels (the icon's own background),
  and also takes a saturation-weighted tone of the whole icon.
  - A colourful border becomes the card field.
  - Otherwise the icon's most colourful tone is used.
  - Neutral icons (black or white) get a neutral dark or light field.

  Results are cached per icon. Hex colours are precomputed, with no `color-mix`.
- The icon sits centred as a rounded tile (22 % radius) with a soft shadow.
- **Without an icon** (no bridge, a missing app, or an over-budget icon), the card
  shows the app's name set in bold type on a catalogue colour. No brand logos are
  reproduced, and the catalogue colours are only fallbacks.
- **Missing apps:** if the TV reports apps and a favourite isn't among them, the card
  is desaturated and marked "NOT FOUND". Launching still tries the best-known id, and
  any failure becomes a toast.
- The same artwork appears in Settings → Apps.

## 3. Layout (1920×1080)

`1rem = 20px` at 1920×1080. The page is a 96×54 rem canvas:
`font-size: clamp(10px, min(100vw/96, 100vh/54), 40px)`, so any 16:9 window renders
the same composition. Below 1100px wide, or in portrait (the computer editor, phones),
the layout stacks with a fixed 13px base. Cards wrap, widgets become a two-column
(then one-column) grid, and detail panels show inline.

```
┌ banner (preview / no-bridge only) ───────────────────────────────────┐
│ 20:15  Saturday 31 October  [· Good evening, Sam]    ◐ ⌂ ▣ ⏻ ≡       │ top bar
│                                                                       │
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                      │
│ │ ▶  │ │ ≡  │ │ ∿  │ │ ◯  │ │ ●  │ │Dis+│ │RTL+│   app cards          │
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘                      │
│ YouTube · Last used           (caption under the focused card only)   │
│          (quiet band: detail panels unfold here)                      │
│ [Weather][Calendar       ][Sleep timer   ][This TV][Smart home]   │ shelf
└───────────────────────────────────────────────────────────────────────┘
```

- Safe margins: 4.8rem horizontally, 2.4rem top and 2.8rem bottom.
- Seven cards exactly span the 86.4rem safe width. More apps scroll horizontally.
- Shelf widths are flex weights tuned so the sleep chips and two
  agenda lines fit in English and German.
- The clock appears once, in the top bar. The greeting appears only if you set a name.
- Top-bar actions are icon buttons whose label unfolds on focus.
- The bridge pill appears only when something needs attention: connecting, an error,
  stale data (over 3 minutes), preview, or no bridge. A healthy live TV shows no pill.

## 4. Interaction

### Remote
| Key | Action |
| --- | --- |
| ←↑→↓ | Geometric spatial navigation inside the active scope (home or settings) |
| OK (13) | Activate: open app, set sleep timer, or open the widget's settings section |
| Back (461) / Esc / Backspace | Settings content → section list → close. On home: back to the first app; if already there, a hint toast |
| Red (403) | Next style (Ambient → Quiet → Compact) |
| Yellow (405) | Cycle theme Day → Night → Auto |
| Blue (406) | Open / close dashboard settings |

- **Spatial navigation** prefers candidates that overlap on the orthogonal axis.
  - On the home screen, Left/Right never jump to another line. At the end of a row,
    nothing happens.
  - Up/Down may cross rows: cards ↔ shelf ↔ top bar.
- **Remembered positions.** Moving back into the card row lands on the last focused
  card. Moving left into the settings list lands on the current section.
- **Settings sections follow focus**, as in LG's menus. This is paused while a
  re-render restores focus, so a re-render never changes the section.
- In text fields, ←/→ move the caret and only leave the field at its edge.
- `appinfo.json` keeps `"disableBackHistoryAPI": true`, so Back arrives as keyCode 461.

### Widgets
| Widget | Face | Unfolds on focus | OK |
| --- | --- | --- | --- |
| Weather | 9° · condition · place | "Updated HH:MM" | Settings → Weather |
| Calendar | the next two events (now / time / day) | up to four more, "Proton Calendar · updated HH:MM" | Settings → Calendar |
| Sleep timer | state + chips 10/30/60/90/120/Off | what the state means | each chip sets it |
| This TV | temperature, memory % with meter | uptime, model, firmware, privacy summary and badges | Settings → About |
| Smart home | "Not set up" or the first device | what it will do / more devices | Settings → Widgets |
| Inputs (off by default) | HDMI chips with signal dot | — | each chip switches |

### Magic Remote and mouse
Hover moves focus, so the pointer and the D-pad share one focus ring. The webOS
`cursorStateChange` event switches hover-focus off while the pointer is hidden.
Hovering a widget reveals its details exactly as focus does.

### Toasts
One line, at most three at once. Errors last 6 s and use `role=alert`; others last
3.8 s and use `role=status`. Repeated poll failures toast once, plus once on recovery.

## 5. Motion, OLED care

- **Richer transitions, no persistent motion.**
  - Focus: cards lift and scale (340 ms, `cubic-bezier(.2,.8,.2,1)`).
  - Captions and detail panels fade and slide in. Top-bar labels unfold.
  - The atmosphere crossfades two opacity-only layers (1.2 s), debounced by 110 ms, so
    fast D-pad runs don't flicker.
  - Nothing moves on its own. The clock changes once a minute.
- **Idle dimming:** Never, 2, 5 (default), 10 or 20 minutes. A veil fades in with a
  small dim clock that jumps (never glides) once a minute, and the atmosphere fades to
  black. The first key or click only wakes the screen; nothing is launched by accident.
- **Pixel shift** (on by default): every 4 minutes the stage moves up to ±3px.
- **Reduced motion** (the system setting or "Reduced") removes every transition,
  animation, zoom and lift, and hides the atmosphere.

## 6. States: never fake a reading

| State | Shown as |
| --- | --- |
| No bridge | Widgets say "unavailable"; details say "Unavailable without the TV bridge." Hatched red edge and "Not live" banner. Sleep chips disabled. Actions toast "No TV bridge — can't … from here." |
| Bridge loading | "unavailable" with "Waiting for the TV…" in details |
| Bridge failing, no data yet | Pill "Bridge error", one toast |
| Data stale (over 3 minutes) | Pill "Last data HH:MM"; last values remain |
| Field missing | Italic "unavailable" (never 0, never blank) |
| Not configured | One accent line in the widget face ("Add your city", "Connect calendar", "Not set up"); the explanation unfolds on focus; OK opens the right settings section |
| Configured, failing | Weather: "Weather unavailable" plus why. Calendar: "unavailable" plus "Check the private integration". This is distinct from an empty agenda |
| Configured, empty | Plain sentence ("Nothing in the next days") |

- **Sleep timer:** if the bridge doesn't report its state, the widget says
  "Not reported", not "Off". After you set one here, it shows "Sleeps 21:30 · in 30 min
  · set here". That value is held in memory until the TV reports its own.
- **Weather** never guesses a location.
- **Calendar** shows its setup line until the bridge reports `configured: true`.
  Event titles from a busy-only feed show as "Busy"/"Belegt".
- **App ordering** uses recent launches, excluding Own TV itself. Manual ordering is optional.

## 7. Preview mode (browser only)

| URL | Simulates |
| --- | --- |
| `index.html?preview=sample` | Sample state. Every personal string is labelled "Sample …". Apps use abstract sample icons (plain geometric glyphs, not brand marks) to exercise colour extraction. Disney+ has no icon, to show the type fallback. RTL+ is absent, to show "not found" |
| `index.html?preview=empty` | A bridge with nothing configured; exercises every setup state |
| `index.html?preview=error` | A bridge where every call fails |

Guards:

- **Ignored on the TV.** The parameter is ignored when the UA matches webOS, when
  `PalmSystem` exists, or when `OwnTVBridge.onTV === true`.
- **Preview code stays private.** The preview bridge is never assigned to
  `window.OwnTVBridge`, and `bridge.js` declines to define it off-TV when `?preview=` is
  present.
- **Clear labelling.** Preview pages carry a hatched amber edge, a "PREVIEW" banner and
  a status pill.
- **Inert actions.** Actions only toast "Preview: … was not sent anywhere."
- **No sync.** Preferences are never synced in preview.

## 8. Bridge contract and preference sync

`window.OwnTVBridge` (parent-owned):

```js
getState() -> Promise<{
  apps:[{id,title,icon?}], inputs:[{id,title,connected?}], recent:[{id,title}],
  health:{temperature?,memoryUsedPercent?,uptimeSeconds?,model?,firmware?},
  privacy:{trackingOff?,adBlocking?,summary?},
  calendar:{configured,events:[{title,start,end,allDay?}],error?,updatedAt?},
  weather:{configured,temperature?,condition?,city?,error?,updatedAt?},
  smartHome:{configured,devices:[]}, sleepTimer:{minutesRemaining?},
  preferences: object|null, preferencesRevision: number
}>
launch(id), setSleepTimer(0|10|30|60|90|120), screenOff(), openLgHome(), openSettings(),
savePreferences(prefs) -> {ok, revision}, configureWeather({latitude,longitude,label}),
openEditor()   // computer editor only
capabilities, onTV, editor   // feature flags; a capability set to false hides that action
```

- **Polling:** `getState()` runs on start, then every 60 s while the document is
  visible. It also runs on becoming visible if the last read is over 30 s old, and from
  the pill.
- **Timeouts:** every call has a 65 s guard, because the helper cold-starts `node`.
- **Validation:** every field is type-checked.
  - Strings are clipped and numbers must be finite.
  - Lists are capped: apps 400, inputs 12, recent 20, events 200.
  - Icons are accepted only as `data:image/…` or local paths.
  - All bridge text is rendered with `textContent`.

### Revision-based preference sync

`lastRemoteRevision` and `prefsDirty` persist in `localStorage['owntv.sync.v1']`.

1. **Adopt newer remote preferences.** On every successful `getState()` in live mode,
   if `preferences` is a schema-1 object, the helper's revision is newer than
   `lastRemoteRevision`, and nothing local is unsaved or in flight, the dashboard
   sanitises the helper copy and adopts it. A copy containing anything secret-shaped is
   refused.
   - Changes made in the computer editor therefore reach the TV within one poll, even
     when the TV already has its own `localStorage`.
   - A screen with no stored preferences adopts the helper copy regardless of revision.
2. **Save local changes.** Any local change marks the preferences dirty and schedules a
   debounced (1.5 s) `savePreferences`.
   - Only one save is in flight at a time. Edits made during a save trigger another
     save afterwards.
   - Preferences are marked clean only when the save that carried the latest edit
     resolves. The returned `revision` is recorded.
3. **Avoid races.**
   - A poll that arrives while a change is pending never overwrites it; it nudges the
     save instead.
   - A poll started before a save carries an older revision, so it is ignored.
   - An unsaved change survives a reload (`dirty` is persisted) and is pushed on the
     next live poll.
4. **Seed an empty helper.** If the helper has no preferences yet and this screen
   does, the screen sends its preferences once.

## 9. Preferences

Stored in `localStorage['owntv.preferences.v1']`, non-secret only:

```json
{
  "schema": 1,
  "language": "en",
  "name": "",
  "style": "ambient",
  "theme": { "mode": "auto", "autoSource": "schedule", "dayStart": "07:00", "nightStart": "19:30" },
  "motion": "system",
  "idleDimMinutes": 5,
  "pixelShift": true,
  "apps": { "order": ["youtube","twitch","spotify","netflix","prime","disney","rtlplus"], "hidden": [], "labels": {} },
  "widgets": { "weather": true, "calendar": true, "recent": true, "sleep": true, "health": true, "smartHome": true, "inputs": false },
  "weather": { "label": "", "latitude": null, "longitude": null }
}
```

- **Sanitiser whitelist.** `style` must be one of `ambient|quiet|compact`.
  `widgets.dayRuler` from older exports is accepted silently and dropped. Unknown keys
  and invalid values are dropped with a note.
- **Blocking errors.** The whole import is refused, with nothing changed, for a wrong
  `kind`/`schema`, invalid JSON, or any string that looks like a link or secret
  (`://`, `webcal`, `.ics`, `token`, `secret`, `passw`, `api key`, `bearer`,
  `calendar.proton`, or 32+ key-like characters).
- **App keys** are catalogue keys or `app:<webOS id>`. The seven favourites can be
  hidden and reordered but never removed.
- **Export.** "Save JSON file" or "Show JSON", wrapped as
  `{kind:"owntv.preferences", schema:1, …, preferences}`. A switch decides whether the
  weather location is included.
- **Import.** From a file or paste, at most 64 KB.
- **Reset** needs a second press within 5 s.

The dashboard never asks for, stores, exports or displays a calendar link. Settings →
Calendar says so and explains how to configure the private backend.

## 10. Language

- English is the default; German is fully translated, including aria labels and toasts.
- Dates use `en-GB`/`de-DE` through `Intl`. Times are 24-hour.
- The optional name (≤ 24 characters) only adds a quiet greeting after the date.

## 11. Accessibility

- **Landmarks:** `header` (top bar), `main` with a labelled Apps region and an
  "At a glance" region, labelled widget sections, `nav` for TV actions and for the
  settings list. Settings is a `role=dialog aria-modal` sheet; the stage behind it is
  `inert`.
- **Controls:** every control is a real `<button>`/`<input>`. Switches use
  `role=switch`; style cards and segmented controls use `aria-pressed`.
- **Names and descriptions:**
  - Cards are named "Open Netflix" (plus ". Last used" or ". The TV did not list this
    app.").
  - Widget faces are buttons whose unfolded details are linked with `aria-describedby`,
    so screen readers get the details without focus tricks.
  - Icon-only top-bar buttons always carry `aria-label`.
- **Contrast:**
  - Night: ink is 16.9:1 and secondary ink 7.8:1.
  - Day: ink is 13:1 and secondary ink 6.1:1.
  - Small labels (`--ink-3`) are ≥ 4.5:1 in both themes.
  - Focus rings are the highest-contrast element in both themes.

## 12. Verifying

1. Serve: `python3 -m http.server 8765 --bind 127.0.0.1 -d own-tv/app`.
2. `index.html` with no bridge: the "Not live" banner, every widget "unavailable",
   sleep chips disabled.
3. `?preview=sample` at 1920×1080:
   - Arrow keys: cards ↔ shelf ↔ top bar; card memory; Right at the end of a row does
     nothing; Esc = Back.
   - Focus each widget and see its details. Red cycles styles; Yellow cycles themes;
     Blue opens settings.
   - For every language × style × theme (12 combinations): the page is exactly
     1920×1080, nothing is off-screen, and nothing spills out of a widget face.
4. `?preview=empty`: compact setup lines for weather, calendar and smart home; the
   apps keep the stage.
5. `?preview=error`: the error pill and concise toasts.
6. On the TV: no banner or pill while healthy. Back never exits from settings.
   `?preview` has no effect. An edit in the computer editor appears on the TV within a
   minute.

## Final owner-requested integration

Watch now defaults to most-recently-used order; its stable manual order remains an
option. The separate Recent Apps shelf was removed. Returning from another app
refreshes the order immediately. The TV panel-hours counter is exposed in This TV
details. This TV settings include a firmware compatibility check with no automatic
installer; see FIRMWARE.md. These changes were integrated after design review.


## Navigation and status refinement (0.1.1)

Horizontal app navigation follows the rail's order, using untransformed card
containers for scrolling. Focus zoom and outlines have reserved gutters; holding
Left or Right at either end stays on that app. Cards no longer animate filter or
focus-shadow paints. A rail replacement preserves its scroll position.

This TV has temperature and memory readouts, available RAM, and a short horizontal
report in the space above the widget. Its 1.3rem separation exceeds the 0.5rem
focus ring at every animation frame. The complete memory explanation lives in
About. Memory is for the whole TV, calculated from MemAvailable, including
reclaimable caches; process RSS values should not be added together.

Hidden dashboard pages stop clock/shelf redraws, pixel shifting and idle checks.
Slow-changing app inventories, privacy and HDMI data are cached for five minutes;
readings and recent launches remain fresh on each poll. Successful and absent
app icons are cached without rewriting the cache on each read. Calendar parsing
loads only when a calendar is configured. The OLED screensaver remains enabled.


Weather settings start with city search; manual coordinates expand on demand in
one two-column row. The compact form scales with the TV viewport. Calendar uses
provider-neutral ICS subscription links stored only in the backend.

The optional C5 More free RAM mode uses LG's live get/setPreloadPolicy methods;
this firmware does not export its supportAppList config key. It saves original
per-app policies privately, changes only Netflix, YouTube, Prime and LG Channels,
and uses the existing Home router to reapply on startup/wake. The first return to
Own TV after router startup releases those idle video processes. Spotify, system
services, inputs and OLED protection remain active. Turning the mode off restores
the saved policies. A separate manual release button is available in About.
