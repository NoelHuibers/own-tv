# Private integrations

Run `pnpm editor --ssh-config /path/to/private/ssh_config --host living-room`.
Open the printed loopback URL and add `/integrations` for private setup. The
computer sends the configuration over SSH; no feed appears in the repository,
app package or exported appearance settings. Keep that local editor private.

## Weather

Select approximate latitude/longitude and a display name. Open-Meteo receives
those coordinates when weather is enabled. Results are cached for 30 minutes.
Weather is off until configured. No device geolocation, API key or LG account is used.

In TV Settings → Weather (or the computer editor), search for your city, choose a matching place, then choose Save.
Coordinates are optional advanced controls. Saving enables the weather widget. Keep location
preferences outside Git. Changing this location preserves the private calendar feed.

Settings → Appearance → Auto follows → Sunrise / sunset uses the same forecast
location. The helper fetches four local days of sun times as UTC timestamps;
the UI uses each local day's boundaries, including daylight-saving changes.
If the weather or sun times are missing, invalid or stale, Auto uses your saved
Day/Night schedule. Manual Day and Night always override Auto. This also provides
a fallback for polar days and nights. Weather details show the current day's
sunrise/sunset. The calendar and weather caches are written only after a fetch.

## Calendar subscriptions

Own TV reads ICS subscriptions from Google, Apple/iCloud, Proton, Outlook and
other public HTTPS feed providers. It does not sign into calendar accounts, edit
events or implement CalDAV/OAuth. A provider must offer a subscription feed.

| Provider | Subscription link |
| --- | --- |
| Google | Calendar settings → Integrate calendar → Secret address in iCal format. Workspace administrators may restrict this. |
| Apple/iCloud | Calendar sharing → Public Calendar → Copy Link. This publishes a bearer-link feed; use a separate calendar if you do not want your full calendar published. Private iCloud invitations are not ICS feeds. |
| Proton | Calendar settings → Share with anyone → Create link. Requires a plan with sharing links. |
| Outlook | Calendar settings → Shared calendars → Publish a calendar → ICS link. Account/organization policy may restrict publishing. |
| Other | An HTTPS or webcal ICS subscription URL that works without an interactive login. |

Paste the link only into `/integrations` in the private computer editor. The
editor also accepts an Own TV calendar bundle: a JSON object with
`kind: "own-tv-calendar-subscriptions"`, a `feeds` array of `{label, feedUrl}`,
and an optional `busyOnly` boolean. Importing a bundle replaces the calendar
connections, so include every subscription you want to keep. Never commit a
real bundle or put it into a chat. Up to 16 calendars can be connected. URLs
stay in `/var/lib/own-tv/integrations.json` (0600), never in the TV dashboard,
appearance exports or Git. Blank form sections preserve existing integrations;
Disconnect removes only the selected integration. Revoke a link at its provider
if exposed. Never send your Google, Apple, Proton or Microsoft password to the TV.

webcal links are fetched over HTTPS. DNS must resolve entirely to public internet
addresses, pinned for the request. Private, loopback, link-local and reserved
addresses are refused. Each redirect is independently validated (maximum three).
Responses have a size limit and download deadline, and must be ICS calendars.

The helper expands recurrence, exceptions and time zones, returns 14 days of
agenda entries, and caps each feed at 30 events and the merged agenda at 100.
All-day dates stay calendar dates instead of shifting with time zones.
Very old frequent recurrences can exceed
the iteration limit and be omitted. Feeds are cached for 15 minutes; provider
publication delays can be longer. Event titles default to Busy. Descriptions,
attendees and locations are never sent to the dashboard. Four feeds load in
parallel, each with a 15-second total deadline including DNS and redirects.
The complete agenda refresh has a 45-second network deadline.
One unavailable feed does not hide the others; previously cached entries are
marked stale. Changing title privacy never reuses the previous mode's cache.

On the TV, open **Calendar → Agenda** to browse upcoming events and their
source calendars. **My calendars** has individual switches: off hides events
and stops fetching that subscription without forgetting its connection.
The widget itself can be hidden separately in Settings → Widgets.

**Public holidays** offers all 86 country/language calendars currently listed
by [Thunderbird](https://www.thunderbird.net/en-US/calendar/holidays/), with
search and remote-friendly pages. These feeds currently cover 2025–2028;
their metadata is bundled in `native/holiday-catalog.json`. Keep the catalogue
and coverage range current when publishing new releases. Only selected feeds
are contacted. Switching a catalogue calendar off removes that public
subscription and frees a connection slot. Public holiday titles remain visible
when private calendars use Busy. Regional observances and provider coverage
vary; these are separate feeds, not copies of a user's Proton holiday calendars.
Any other provider's public ICS feed can be connected using the private editor.

Provider instructions: [Google](https://support.google.com/calendar/answer/37648),
[Apple](https://support.apple.com/guide/iphone/share-icloud-calendars-iph7613c4fb/ios),
[Proton](https://proton.me/support/share-calendar-via-link),
[Outlook](https://support.microsoft.com/en-us/outlook/share-your-calendar-in-outlook-on-the-web).

## Smart home

The dashboard has an explicit setup state until you configure a smart-home
system. No sample lamp is shown as a real device. Home Assistant is a future
adapter: prefer a local integration with a dedicated limited credential. It is
not connected or implemented as a control backend in the first release.
