# Private integrations

Run `python3 tools/editor.py --ssh-config /path/to/private/ssh_config --host living-room`.
Open the printed loopback URL and add `/integrations` for private setup. The
computer sends the configuration over SSH; no feed appears in the repository,
app package or exported appearance settings. Keep that local editor private.

## Weather

Select approximate latitude/longitude and a display name. Open-Meteo receives
those coordinates when weather is enabled. Results are cached for 30 minutes.
Weather is off until configured. No device geolocation or LG account is used.

## Proton Calendar

Proton offers read-only sharing links on paid plans. In Proton Calendar on the
web, open your calendar's sharing settings and generate a sharing feed. Enter it
only in the private editor, never in an issue, commit or chat. The link itself
grants read access: revoke it in Proton if exposed.

Own TV fetches directly from `https://calendar.proton.me`, checks TLS, follows no
redirects and stores the feed only in `/var/lib/own-tv/integrations.json` (0600).
It expands recurrence and exceptions with ical.js, returns the upcoming 14 days
and caps the agenda at 30 entries. A maximum iteration count bounds pathological
recurrence rules. Very old, very frequent recurrences may exceed that bound and
be omitted. Feeds are cached for 15 minutes. Provider feed updates may take longer.

Titles are redacted to Busy by default. The editor can enable event titles.
Descriptions, attendees, locations and the feed URL never reach the dashboard.
The integration cannot create or edit events. If you do not have sharing links,
leave this unconfigured; do not give the TV your Proton password.

https://proton.me/support/share-calendar-via-link

## Smart home

The dashboard has an explicit setup state until you configure a smart-home
system. No sample lamp is shown as a real device. Home Assistant is a future
adapter: prefer a local integration with a dedicated limited credential. It is
not connected or implemented as a control backend in the first release.
