# Compatibility and verification

## Confirmed hardware baseline

- LG OLED65C51LA (European C5)
- webOS SDK 11.2.0; firmware 43.21.77
- Node 20.12.2; Homebrew Channel 0.7.3
- SlopBro commit 21023d56ca424607bb03d2939609cc658c655fc7
- SlopBro needed com.webos.app.tinybrowser/contentTarget rather than its
  default voiceweb launcher.

The root shell, key-only SSH and closure of Telnet were verified. Uptime reset
after an orderly reboot and SSH returned. Glasshouse was deployed on loopback
with a private token. Its main privacy checklist returned zero remaining items.
This is a settings verification, not a packet-capture proof of zero tracking.

YouTube, Spotify, Netflix, Prime Video, Disney+ and RTL+ were observed as the
foreground app after launch. Twitch accepted launch but foreground verification
was inconclusive. Streaming playback, audio, DRM and subscription status still
require the owner's normal playback test.

The first release must be tested as an ordinary app before enabling the Home
mapping. Other webOS generations have not been validated. Do not infer support
from a similar model name or from rooting alone.

## Test your own model

Report model family, webOS version, firmware, Node version, and the specific
feature tested. Remove serial numbers, addresses, Wi-Fi details, account names,
calendar feeds and tokens. A screenshot can expose viewing or calendar data.

The launcher uses webOS APIs and does not change firmware partitions or OLED
panel settings. Its default Home mapping may not be available on every model.
