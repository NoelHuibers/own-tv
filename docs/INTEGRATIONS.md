# Private integrations

Run `python3 tools/editor.py --ssh-config /path/to/private/ssh_config --host living-room`.
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

Paste the link only into `/integrations` in the private computer editor. URLs
stay in `/var/lib/own-tv/integrations.json` (0600), never in the TV dashboard,
appearance exports or Git. Blank form sections preserve existing integrations;
Disconnect removes only the selected integration. Revoke a link at its provider
if exposed. Never send your Google, Apple, Proton or Microsoft password to the TV.

webcal links are fetched over HTTPS. DNS must resolve entirely to public internet
addresses, pinned for the request. Private, loopback, link-local and reserved
addresses are refused. Each redirect is independently validated (maximum three).
Responses have a size limit and download deadline, and must be ICS calendars.

The helper expands recurrence, exceptions and time zones, returns 14 days of
agenda entries, and caps output at 30. Very old frequent recurrences can exceed
the iteration limit and be omitted. Feeds are cached for 15 minutes; provider
publication delays can be longer. Event titles default to Busy. Descriptions,
attendees and locations are never sent to the dashboard.

Provider instructions: [Google](https://support.google.com/calendar/answer/37648),
[Apple](https://support.apple.com/guide/iphone/share-icloud-calendars-iph7613c4fb/ios),
[Proton](https://proton.me/support/share-calendar-via-link),
[Outlook](https://support.microsoft.com/en-us/outlook/share-your-calendar-in-outlook-on-the-web).

## Smart home

The dashboard has an explicit setup state until you configure a smart-home
system. No sample lamp is shown as a real device. Home Assistant is a future
adapter: prefer a local integration with a dedicated limited credential. It is
not connected or implemented as a control backend in the first release.
