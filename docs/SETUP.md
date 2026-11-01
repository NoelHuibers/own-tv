# Setup

## 1. Secure root access

If SSH keys already work, keep them and skip the Telnet bootstrap. Otherwise,
for your own already-rooted TV on a trusted local network:

```sh
python3 tools/setup.py --tv YOUR_TV_IP --profile-dir /path/outside/repo/tv-private --bootstrap-telnet
```

It generates a dedicated SSH key outside the repository, installs only the
public key on the TV, verifies SSH, adds the key-only startup hook, then closes
Telnet. It pins the first SSH host key seen on the trusted network. An active
attacker on that network could interfere with initial Telnet/key establishment.
Reboot and verify key-only SSH again before installing anything else.

Do not delete your key or change Homebrew Channel root/SSH settings casually.
Homebrew Channel's failsafe may reopen Telnet after a boot problem.

## 2. Install Glasshouse privately

Follow the upstream setup with the TV's SSH connection already working. Before
the FIRST deploy, create `server/config.json` in its separate clone:

```json
{
  "host": "127.0.0.1",
  "port": 8080,
  "token": "REPLACE_WITH_A_LONG_RANDOM_SECRET",
  "allowControl": true,
  "allowExperimentalHome": false,
  "allowTileHiding": false,
  "mqtt": {"enabled": false}
}
```

Generate the real token locally. Never commit that configuration or publish it.
Review upstream updates before deploying. The initial integration was tested
against commit `48d712a7b62045def55ec19de97d2b3e40cb49f1`.

Make sure upstream uses your verified SSH configuration and does not fall back
to Telnet. Its normal deploy command is `bash server/deploy.sh YOUR_TV_IP`.
The dashboard must listen on `127.0.0.1`, not `0.0.0.0` or `::`.

Use an SSH tunnel if you want its management dashboard on your computer:

```sh
ssh -F /path/to/private/ssh_config -N -L 127.0.0.1:18080:127.0.0.1:8080 living-room
```

## 3. Back up, reduce tracking, verify

Use Own TV's backup command before changing settings. In Glasshouse, apply its
privacy controls and Ads & telemetry tier. Avoid the Everything tier if you
need the LG Content Store. Disable unused voice services only if desired.
Do not stop arbitrary services based on their names: some affect video playback.

Reboot; check SSH, Telnet/debugger exposure, privacy settings and each streaming
app. No domain list proves all tracking is blocked. Read [LG data deletion](LG-DATA-DELETION.md)
for historical records.

## 4. Install Own TV

Follow the README. Install first as an ordinary app and test D-pad, pointer,
settings, app launches and Back. Only then use `home-enable`. It changes the
supported `defaultApps.home` setting, preserves the other mappings and saves
the original. A reversible Node foreground router also catches webOS paths that
launch LG Home directly. It starts at boot and adds no network listener. The
explicit LG Home button temporarily bypasses that router. If the setting is unsupported, it refuses rather than patching
system partitions.

Own TV also declares the `home` app category so `launchDefaultApp` can open it
directly. Foreground routing still allows a brief LG Home flash when an app
exits on the tested C5 firmware. Optional **Direct Home** removes that redirect
by mounting the complete Own TV dashboard under LG Home's system identity.
See [Direct Home](HOME.md) for activation, scope and recovery. It is restricted
to the tested C5/firmware combination and does not modify LG's Flutter files.

Re-run install after updates: the TV regenerates client permissions on each
install. The scoped permission repair restores only Own TV's Homebrew Channel
group. The boot hook does the same after reboot.

## Uninstall

Restore Home with `home-restore` first. Then uninstall the Own TV app from
Homebrew Channel. Remove the Own TV permission hook if no longer needed.
Integration secrets and native helper remain in `/var/lib/own-tv` until you
remove them explicitly over SSH. Keep backups separately. See RECOVERY.md.
