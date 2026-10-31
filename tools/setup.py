#!/usr/bin/env python3
"""One-time SSH bootstrap for your own already-rooted TV on a trusted LAN.

Telnet is used only to install your public key. Private keys stay on this PC.
"""
import argparse
import base64
import ipaddress
from pathlib import Path
import shlex
import subprocess
import time
from telnet_bootstrap import run
ROOT=Path(__file__).resolve().parents[1]
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--tv',required=True);p.add_argument('--profile-dir',required=True);p.add_argument('--bootstrap-telnet',action='store_true',required=True);a=p.parse_args()
 ipaddress.ip_address(a.tv)
 profile=Path(a.profile_dir).expanduser().resolve()
 try:profile.relative_to(ROOT);raise SystemExit('Keep the private profile OUTSIDE this repository.')
 except ValueError:pass
 profile.mkdir(parents=True,exist_ok=True);profile.chmod(0o700)
 key=profile/'id_ed25519'
 if not key.exists():subprocess.run(['ssh-keygen','-q','-t','ed25519','-N','','-C','own-tv','-f',str(key)],check=True)
 code,out=run(a.tv,'id -u')
 if code or out.strip().splitlines()[-1:]!=['0']:raise SystemExit('Target did not provide the expected rooted shell. No changes made.')
 encoded=base64.b64encode(key.with_suffix('.pub').read_bytes()).decode()
 script="""set -e
umask 077
mkdir -p /home/root/.ssh /var/lib/webosbrew/sshd
printf '%s' | base64 -d > /tmp/own-tv-public-key
grep -qxFf /tmp/own-tv-public-key /home/root/.ssh/authorized_keys 2>/dev/null || cat /tmp/own-tv-public-key >> /home/root/.ssh/authorized_keys
rm -f /tmp/own-tv-public-key
chmod 700 /home/root/.ssh
chmod 600 /home/root/.ssh/authorized_keys
touch /var/luna/preferences/webosbrew_sshd_enabled
/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/dropbear -R -s
""" % encoded
 code,out=run(a.tv,script)
 if code:raise SystemExit('Could not start SSH; Telnet has not been disabled.')
 cfg=profile/'ssh_config'
 cfg.write_text('Host living-room\n  HostName '+a.tv+'\n  User root\n  IdentityFile '+str(key)+'\n  UserKnownHostsFile '+str(profile/'known_hosts')+'\n  StrictHostKeyChecking yes\n  BatchMode yes\n  ConnectTimeout 5\n')
 cfg.chmod(0o600)
 ssh=['ssh','-F',str(cfg),'-o','StrictHostKeyChecking=accept-new','living-room']
 # Initial host key trust is established on this explicitly trusted LAN.
 # Subsequent connections pin that key and fail if it changes.
 subprocess.run(ssh+['test "$(id -u)" = 0'],check=True)
 hook=(ROOT/'tools/10-own-tv-ssh').read_bytes()
 subprocess.run(ssh+['cat > /var/lib/webosbrew/init.d/10-own-tv-ssh && chmod 755 /var/lib/webosbrew/init.d/10-own-tv-ssh && sh /var/lib/webosbrew/init.d/10-own-tv-ssh'],input=hook,check=True)
 subprocess.run(ssh+['test "$(id -u)" = 0'],check=True)
 subprocess.run(ssh+['touch /var/luna/preferences/webosbrew_telnet_disabled; killall telnetd; sync'],check=True)
 print('SSH verified; Telnet closed. Reboot, then verify SSH and closed port 23 again.')
 print('Private SSH configuration:',cfg)
