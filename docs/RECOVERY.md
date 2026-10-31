# Recovery

Keep your SSH key and verified host key outside this repository. Do not disable
SSH or remove Homebrew Channel while troubleshooting the launcher.

## Restore LG Home

```sh
python3 tools/tv.py --ssh-config /path/to/private/ssh_config --host living-room home-restore
```

This stops the Own TV foreground router and removes its boot hook, then restores
the saved Home app mapping (LG Home if no mapping was set before). It leaves other default apps as
they are. Then open LG Home and uninstall Own TV through Homebrew Channel.
Remove `/var/lib/webosbrew/init.d/40-own-tv-permission` if no longer needed.

If no saved mapping is available, inspect the current `defaultApps` setting
first. Do not replace the entire object with a guessed value. The normal LG
Home app ID is `com.webos.app.home`, but confirm on your model.

## Privacy rollback

Glasshouse's Privacy tab can disable its hosts blocker; its Apps/service controls
can re-enable individual services. Its token and loopback binding are independent
of privacy switches. Restore only the specific setting causing a problem, then
re-test the affected app. Avoid copying an entire preferences backup over a live TV.

The optional voice hook is `15-own-tv-optional-services`. To undo it, remove the
hook, remove `/run/systemd/transient/voiceconductor.service`, reload systemd and reboot.
Do not disable Always Ready system daemons or video-plane services to remove ads.

The key-only SSH hook is `10-own-tv-ssh`. Removing it returns management to
Homebrew Channel's normal SSH startup. Leave the SSH-enabled preference and your
public key present. Never re-enable passwordless Telnet as a permanent fix.

## If SSH is unreachable

Check the TV is on, the address is correct and Homebrew Channel root status is OK.
An orderly reboot can help. The Homebrew Channel failsafe may enable Telnet after
a failed boot; use it only for local recovery, then close it again. Re-rooting may
be needed if persistence was lost. Do not factory-reset as a first troubleshooting
step, flash firmware partitions, or install LG Developer Mode on the rooted TV.
