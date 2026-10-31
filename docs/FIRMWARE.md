# Firmware compatibility checks

A newer version is not evidence that root or this setup will keep working.
Own TV therefore offers a compatibility check, not an unrestricted firmware
flasher. The first release has **no automatic firmware installation**.

The button reads the project's public compatibility catalogue only when asked.
Your model, OTA identifier, country and component versions are compared locally;
they are not sent as a device report. If the catalogue cannot be read, is empty,
is expired, or lacks a matching report, the result is Unverified. This is NOT a
claim that LG has no newer firmware. LG's current rollout availability is unknown
until separately verified through the supported LG update workflow.

A matching report requires:

- Exact model, country and OTA identifier, current and target firmware.
- Matching Homebrew Channel, Own TV and Glasshouse versions.
- Matching installed third-party app versions with successful playback checks.
- Explicit checks for root persistence after reboot, Homebrew Channel, launcher,
  privacy controls, SSH, OLED protection and streaming playback.
- Public evidence links and an unexpired review period.

There are currently **no verified upgrade records** in the catalogue. Do not add
one from a version comparison, an untested rumour, or a report for a different
model/region. Compatibility reports reduce uncertainty; they cannot guarantee
future streaming-service behaviour or that a factory reset will remain rootable.

## Installation policy

A real one-button installer also needs trustworthy LG candidate-version discovery,
a final preflight against that exact candidate, a fresh private backup, explicit
user confirmation, and the supported LG updater. None of this should write
firmware partitions directly or run an arbitrary downloaded shell command.
A preferences backup is not a firmware image or a guarantee of downgrade recovery.

Until that complete path is implemented and tested, `installable` is always false,
even when a matching report exists. This deliberately prevents a promising-looking
report from becoming permission to flash the TV.

For a TV configured to avoid unreviewed firmware, Glasshouse's Block TV software
updates feature blocks LG's known update endpoints and persists via Homebrew
Channel. Keep the Content Store reachable. It is not a substitute for checking
whether a firmware package was already downloaded or for reviewing security fixes.
Plan updates and review compatibility rather than forgetting about firmware.

https://www.webosbrew.org/rooting/
