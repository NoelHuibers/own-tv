# Security and privacy

Own TV has no cloud account, analytics, remote fonts or advertisement SDK.
Weather and calendar make external connections only after explicit setup. Opening
Rain radar additionally loads images from tilecache.rainviewer.com; the map
geography and all scripts are bundled locally.

- Install requires an already-rooted TV and verified key-based SSH. Use a
  dedicated key; verify it after reboot before disabling Telnet. Homebrew
  Channel's failsafe can reopen Telnet after a failed boot: recheck the ports.
- The launcher can invoke Homebrew Channel as root. Treat every update as
  trusted code. Do not install arbitrary third-party repositories.
- The native helper starts no network listener and offers fixed actions only.
  It calls Glasshouse over TV loopback. Configure Glasshouse to bind to
  `127.0.0.1`, set a unique token, and leave experimental features off.
- The computer editor binds only to `127.0.0.1`. It uses verified SSH, validates
  Host and Origin and requires a custom request header. Do not reverse-proxy it
  to your LAN or the internet. Untrusted programs on your computer remain able
  to use your logged-in SSH access.
- The TV's native helper and integration secrets are in `/var/lib/own-tv`.
  Calendar sharing URLs stay in a mode-0600 file, never in the app, browser
  localStorage, exports or Git. A sharing URL grants read access to its holder.
- Calendar URLs use HTTPS with DNS address checks and pinning, including every
  redirect. Private and reserved networks are blocked. Calendar feeds are read-only.
- Calendar defaults to redacting event titles as Busy. Weather shares selected
  coordinates with Open-Meteo. Use approximate town-level coordinates.
- Public packages exclude device files. Keep backups outside the repository:
  they contain personal settings. Review every staged file before publishing.
- LG domain blocking does not block every third-party app's telemetry or ads,
  and is not proof that all tracking has stopped. Firmware updates can reset
  settings and affect compatibility. Use planned updates, not indefinite neglect.

Report security issues privately through the repository owner's GitHub contact
before publishing sensitive details. Never attach tokens, feeds or raw backups.
