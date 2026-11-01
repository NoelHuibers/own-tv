# Offline languages

Own TV accepts any valid BCP 47 locale, including regional and script variants
such as `fr-CA`, `pt-BR`, `zh-Hant-TW`, `ar` and `he-IL`. In Settings → Language,
enter the locale and choose Apply locale. Dates, times and numbers use that
locale when the TV's Intl runtime supports it. Arabic, Hebrew and other RTL
scripts use a right-to-left layout. The physical app rail keeps stable remote
scroll coordinates.

English and German interface translations are built in. **Selecting another
locale does not automatically translate the interface.** Install an offline
language pack; missing entries use English. Calendar event titles remain in
their original language. Nothing is sent to a translation service.

## Create or contribute a translation

Generate a template from the current dashboard, calendar, About and weather text:

```sh
pnpm --silent language-template fr Français > /tmp/own-tv-fr.json
```

Translate the values in `strings`. Keep the keys and `{placeholders}` unchanged.
You can remove untranslated entries to make a partial pack. The language panel
shows the number of installed entries and explains the English fallback.

```json
{
  "kind": "own-tv-language",
  "schema": 1,
  "locale": "fr",
  "name": "Français",
  "strings": {
    "set.nav.calendar": "Calendrier",
    "weather:today": "Aujourd’hui",
    "text:My calendars": "Mes calendriers"
  }
}
```

On your computer, open the local editor → Settings → Language → Install language
pack and select the JSON file. Appearance preferences synchronize it to the TV
over SSH. The TV uses the pack offline; no browser editor is needed afterwards.
One custom pack is installed at a time; installing another replaces that pack.
Switching to English or German keeps the installed pack available.

Packs contain plain text, not HTML, JavaScript, fonts or external resources.
Limits: 48,000 characters after JSON serialization, 1,200 entries and 2,400
characters per translation. Packs are included in appearance backups. Only put
interface translations in them, never calendar events, credentials or personal
information. A pack does not translate LG's menus or streaming apps.

To contribute a reviewed pack, add it under `languages/` and open a pull request.
Include its locale, whether it is complete, and how it was checked by a fluent
speaker. The template is a list of supported keys, not a claim of translation
coverage. Regenerate it when the interface changes.
