# Recovery

Keep your SSH key and verified host key outside this repository. Do not disable
SSH or remove Homebrew Channel while troubleshooting the launcher.

## Restore LG Home

```sh
pnpm tv --ssh-config /path/to/private/ssh_config --host living-room home-restore
```

This first releases Direct Home, restores LG's original app identity and video
preload policies, then stops the supervised router and removes its boot hook. It restores
the saved Home app mapping (LG Home if no mapping was set before). It leaves other default apps as
they are. Then open LG Home and uninstall Own TV through Homebrew Channel.
Remove `/var/lib/webosbrew/init.d/40-own-tv-permission` if no longer needed.

To disable Direct Home while retaining ordinary Own TV foreground routing:

```sh
pnpm tv --ssh-config /path/to/private/ssh_config --host living-room home-direct-disable
```

If the computer tool is unavailable, run this in the TV's root SSH shell before
stopping the router or removing its files:

```sh
node /var/lib/own-tv/helper.cjs directHome ZmFsc2U=
```

It unmounts the replacement, has SAM reread LG's manifest and releases any
temporary system-app block. The original app files remain underneath the
mount. Do not delete `home-system` while it is mounted. Reboot clears the mount;
disable the saved mode and boot hook first if you want it to stay off.

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


## Restore video-app preloading

`home-restore` restores video preloading before stopping the router. You can also
turn off **More free RAM** in Own TV Settings → About before uninstalling the helper. This restores the original policies kept in
`/var/lib/own-tv/performance.json`. Recovery over SSH is also possible:

```sh
node /var/lib/own-tv/helper.cjs memoryMode ZmFsc2U=
```

`ZmFsc2U=` is the fixed base64 encoding of JSON `false`, not a credential.
Do not delete the saved original policies until they have been restored. The
memory mode is currently enabled only for the tested OLED65C51LA. It uses the
Home router to reapply after wake/startup; other models remain unverified.
