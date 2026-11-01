#!/usr/bin/env python3
"""Install and manage Own TV over a verified SSH connection."""
import argparse
import base64
import io
import json
from pathlib import Path
import shlex
import subprocess
import tarfile
from datetime import datetime,timezone

ROOT=Path(__file__).resolve().parents[1]
APP='io.github.noelhuibers.owntv'
class TV:
    def __init__(self,config,host):self.ssh=['ssh','-F',str(Path(config).resolve()),'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',host]
    def run(self,command,data=None,tty=False,timeout=90):
        args=self.ssh[:1]+(['-tt'] if tty else [])+self.ssh[1:]+[command]
        result=subprocess.run(args,input=data,capture_output=True,timeout=timeout)
        if result.returncode:raise RuntimeError(result.stderr.decode(errors='replace') or result.stdout.decode(errors='replace'))
        return result.stdout
    def helper(self,action,value=None):
        command=['/usr/bin/node','/var/lib/own-tv/helper.cjs',action]
        if value is not None:command.append(base64.b64encode(json.dumps(value).encode()).decode())
        return json.loads(self.run(shlex.join(command)))
    def luna(self,uri,payload):
        # A PTY is needed for reliable one-shot luna-send results over SSH on
        # the tested C5; otherwise it exits silently with stdin at EOF.
        result=self.run(shlex.join(['luna-send','-n','1','-w','30000','luna://'+uri,json.dumps(payload)]),tty=True).decode().replace('\r','')
        for line in result.splitlines():
            try:
                d=json.loads(line)
                if d.get('returnValue') is False:raise RuntimeError(d.get('errorText',str(d)))
                return d
            except json.JSONDecodeError:continue
        raise RuntimeError('TV returned no Luna response')
    def backup(self,destination):
        p=Path(destination).resolve()
        try:p.relative_to(ROOT);raise ValueError('Keep private backups outside this repository.')
        except ValueError as error:
            if str(error).startswith('Keep private'):raise
        p.mkdir(parents=True,exist_ok=True);p.chmod(0o700)
        stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        data=self.run('tar -czf - /var/lib/webosbrew /var/luna/preferences /etc/hosts /home/root/.ssh/authorized_keys 2>/dev/null')
        archive=p/(stamp+'-baseline.tar.gz');archive.write_bytes(data);archive.chmod(0o600)
        settings=self.luna('com.webos.settingsservice/getSystemSettings',{'category':'general','keys':['defaultApps']})
        f=p/(stamp+'-home-settings.json');f.write_text(json.dumps(settings,indent=2));f.chmod(0o600)
        print('Private backup:',archive)
    def install(self):
        from package import package
        ipk=package();bundle=io.BytesIO()
        # Explicit list: credentials, config files and unrelated node_modules
        # never enter the TV helper deployment or a public release package.
        with tarfile.open(fileobj=bundle,mode='w',format=tarfile.USTAR_FORMAT) as tar:
            for name in ['helper.cjs','integrations.cjs','firmware.cjs','home-route.cjs','home-replacement.cjs','home-api.cjs','weather.cjs','performance.cjs','calendar-feed.cjs','calendar-agenda.cjs','calendar-settings.cjs','holiday-catalog.json']:tar.add(ROOT/'native'/name,arcname=name)
            tar.add(ROOT/'compatibility/firmware.json',arcname='compatibility/firmware.json')
            build=json.dumps({'version':json.loads((ROOT/'package.json').read_text())['version']}).encode();info=tarfile.TarInfo('build.json');info.size=len(build);info.mode=0o600;tar.addfile(info,io.BytesIO(build))
            dependency=ROOT/'node_modules/ical.js'
            if not dependency.exists():raise RuntimeError('Run npm ci first')
            tar.add(dependency,arcname='node_modules/ical.js')
        self.run('umask 077; mkdir -p /var/lib/own-tv; tar -xf - -C /var/lib/own-tv && chown -R 0:0 /var/lib/own-tv && chmod 700 /var/lib/own-tv',bundle.getvalue())
        self.run('cat > /tmp/own-tv.ipk',ipk.read_bytes())
        reply=self.luna('com.webos.appInstallService/dev/install',{'id':'com.ares.defaultName','ipkUrl':'/tmp/own-tv.ipk','subscribe':False})
        if 'failed' in json.dumps(reply).lower():raise RuntimeError('TV refused the package: '+str(reply))
        data=(ROOT/'tools/40-own-tv-permission').read_bytes()
        self.run('cat > /var/lib/webosbrew/init.d/40-own-tv-permission && chmod 755 /var/lib/webosbrew/init.d/40-own-tv-permission && sh /var/lib/webosbrew/init.d/40-own-tv-permission',data)
        self.run('rm -f /tmp/own-tv.ipk')
        try:meta=self.luna('com.webos.service.update/getCurrentSWInformation',{})
        except (RuntimeError,subprocess.TimeoutExpired):meta={}
        safe={'otaid':meta.get('model_name'),'country':meta.get('country')}
        self.run('umask 077; cat > /var/lib/own-tv/device-capabilities.json',json.dumps(safe).encode())
        router=self.run("/usr/bin/node -e \"process.stdout.write(String(require('fs').existsSync('/var/lib/webosbrew/init.d/60-own-tv-home')))\"").decode()=='true'
        if router:
            self.run('/usr/bin/node /var/lib/own-tv/home-route.cjs --stop')
            self.run('cat > /var/lib/webosbrew/init.d/60-own-tv-home',(ROOT/'tools/60-own-tv-home').read_bytes())
            self.run('chmod 755 /var/lib/webosbrew/init.d/60-own-tv-home')
            self.run('sh /var/lib/webosbrew/init.d/60-own-tv-home')
            self.helper('homeRefresh')
        print('Installed Own TV. Root permission repaired. Existing Home routing preserved.')
    def home(self,restore=False):
        before=self.luna('com.webos.settingsservice/getSystemSettings',{'category':'general','keys':['defaultApps']})
        current=before.get('settings',{}).get('defaultApps')
        if not isinstance(current,dict):raise RuntimeError('This TV has no supported defaultApps home setting. Use the app as a normal launcher; do not patch system partitions.')
        if not restore:
            for native_file in ['home-route.cjs','performance.cjs']:
                self.run('cat > /var/lib/own-tv/'+native_file,(ROOT/'native'/native_file).read_bytes())
            self.run('test -f /var/lib/own-tv/home-before.json || cat > /var/lib/own-tv/home-before.json',json.dumps(current).encode())
            direct=self.run("/usr/bin/node -e \"process.stdout.write(String(require('/var/lib/own-tv/home-replacement.cjs').createHomeReplacement().mounted()))\"").decode()=='true'
            current={**current,'home':'com.webos.app.home' if direct else APP}
        else:
            self.run('if [ -f /var/lib/own-tv/home-replacement.cjs ]; then /usr/bin/node /var/lib/own-tv/helper.cjs directHome ZmFsc2U=; fi')
            self.run('if [ -f /var/lib/own-tv/performance.json ]; then /usr/bin/node /var/lib/own-tv/helper.cjs memoryMode ZmFsc2U=; fi')
            saved=json.loads(self.run('cat /var/lib/own-tv/home-before.json'))
            # Restore only Home, preserve any other settings changed meanwhile.
            current['home']=saved.get('home','com.webos.app.home')
            self.run('if [ -f /var/lib/own-tv/home-route.cjs ]; then /usr/bin/node /var/lib/own-tv/home-route.cjs --stop; fi; rm -f /var/lib/webosbrew/init.d/60-own-tv-home')
        result=self.luna('com.webos.settingsservice/setSystemSettings',{'category':'general','settings':{'defaultApps':current}})
        verify=self.luna('com.webos.settingsservice/getSystemSettings',{'category':'general','keys':['defaultApps']})
        if verify.get('settings',{}).get('defaultApps',{}).get('home')!=current.get('home'):raise RuntimeError('Home change was not applied')
        if not restore:self.run('cat > /var/lib/webosbrew/init.d/60-own-tv-home && chmod 755 /var/lib/webosbrew/init.d/60-own-tv-home && sh /var/lib/webosbrew/init.d/60-own-tv-home',(ROOT/'tools/60-own-tv-home').read_bytes())
        print('Home now opens:',current.get('home','LG default'))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--ssh-config',required=True);p.add_argument('--host',required=True)
    sub=p.add_subparsers(dest='action',required=True)
    backup=sub.add_parser('backup');backup.add_argument('--destination',required=True)
    sub.add_parser('install');sub.add_parser('state');sub.add_parser('home-enable');sub.add_parser('home-restore');sub.add_parser('home-direct-enable');sub.add_parser('home-direct-disable');sub.add_parser('open')
    configure=sub.add_parser('configure');configure.add_argument('--file',required=True)
    a=p.parse_args();tv=TV(a.ssh_config,a.host)
    if a.action=='backup':tv.backup(a.destination)
    elif a.action=='install':tv.install()
    elif a.action=='state':print(json.dumps(tv.helper('state'),indent=2))
    elif a.action=='home-enable':tv.home()
    elif a.action=='home-restore':tv.home(True)
    elif a.action=='home-direct-enable':print(tv.helper('directHome',True))
    elif a.action=='home-direct-disable':print(tv.helper('directHome',False))
    elif a.action=='open':print(tv.luna('com.webos.applicationManager/launch',{'id':APP}))
    elif a.action=='configure':print(tv.helper('configure',json.loads(Path(a.file).read_text())))
