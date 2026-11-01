# Direct Home

LG app exits use `com.webos.app.home`, even when `defaultApps.home` names a
different app. A foreground watcher can only redirect after LG Home appears.
Direct Home temporarily mounts the full Own TV app under that system identity,
so app exits and Home launches draw Own TV itself.

The technique follows [Glasshouse's Home takeover](https://github.com/rorygallagher2024/glasshouse/blob/main/server/lib/home-takeover.js)
and [Luma](https://github.com/ecklf/lg-luma#replacing-lg-home). On webOS 11,
SAM's `blockSystemApp` requires `forceBlockSystemApp: false`; release immediately
afterwards makes SAM read the mounted manifest without restarting SAM. The
original LG files remain under the mount. No persistent LG layout is blanked.

## Enable and disable

Direct Home is gated to OLED65C51LA firmware 43.21.77. Other combinations need
their own tests before widening the gate. First install the app and enable the
ordinary Home router:

```sh
python3 tools/tv.py --ssh-config /path/to/private/ssh_config --host living-room install
python3 tools/tv.py --ssh-config /path/to/private/ssh_config --host living-room home-enable
python3 tools/tv.py --ssh-config /path/to/private/ssh_config --host living-room home-direct-enable
```

Settings → About → TV & system details also provides the Direct Home switch.
Turning it off restores ordinary foreground routing. **LG Home** temporarily
unmounts Own TV so the real LG screen remains accessible; leaving it resumes
Direct Home. Its temporary bypass expires after two minutes. If another app is
already playing, activation, rollback and recovery preserve its foreground.

```sh
# Keep Own TV, return to foreground routing:
python3 tools/tv.py --ssh-config /path/to/private/ssh_config --host living-room home-direct-disable
# Restore LG Home fully, before uninstalling:
python3 tools/tv.py --ssh-config /path/to/private/ssh_config --host living-room home-restore
```

## What runs

`/var/lib/own-tv/home-system/app` contains only the installed app's assets and a
private generated runtime bridge configuration. It mounts over
`/usr/palm/applications/com.webos.app.home`. Preferences, calendar links, caches
and other integration data stay in their usual private files.

The Home router supplies fixed actions at `127.0.0.1:18766`, authenticated with
a random bearer token stored mode 0600 in the private data directory. The
staged page's CSP allows that loopback endpoint; shipped app packages contain
no token. This avoids adding Homebrew permissions to LG's system app.

The visible dashboard sends a heartbeat every ten seconds. While Home is in
front and power is Active, sixty seconds without the first heartbeat, or
forty-five seconds without a later one, disables Direct Home and restores LG's
identity. Other apps, screensaver and standby do not trigger that timeout.
Heartbeat metadata is limited to version, render/connection flags and app-card
count; it contains no calendar text. An independent shell supervisor restores LG's identity if the Node router
exits unexpectedly, then restarts ordinary routing. Recovery failures retain
the saved state for diagnosis. Only the exact Flutter process launched with
`-i com.webos.app.home` is stopped; other Flutter apps are preserved.

The mount disappears on reboot and the boot hook reapplies it when enabled.
LG Home can still appear during a cold boot before Homebrew startup hooks run.
Streaming-app logins and OLED protection settings are preserved. The C5 web
runtime runs as uid/gid 505, so mounted assets grant that group read access;
root retains write access. The separate token/config files remain root-only.

## Verification

On OLED65C51LA, webOS 11.2.0 / firmware 43.21.77, 1 November 2026:

- The owner confirmed that normal app exit followed by Home shows no LG Home flash.
- Releasing the mount returned SAM's Home type to `flutter`; enabling it returned `web` with the Home category.
- Forced Node-router termination restored LG's identity and restarted ordinary routing. The foreground streaming app remained unchanged.
- The stock-Home escape and reactivation preserved a running streaming app during background checks.
- The bridge listens only on TV IPv4 loopback. Tests reject untrusted origins, Host rebinding, missing credentials, oversized requests and arbitrary shell actions.

Cold-boot and long-term standby behavior still need broader observation; a
successful app-exit test does not establish compatibility with other firmware.
