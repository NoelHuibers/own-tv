#!/usr/bin/env python3
"""Build an unsigned webOS IPK with Python's standard library, no SDK needed."""
import gzip
import io
import json
from html.parser import HTMLParser
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
def archive(files):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w', format=tarfile.USTAR_FORMAT) as tar:
        for name, body in sorted(files.items()):
            info=tarfile.TarInfo('./'+name);info.size=len(body);info.mode=0o644;info.mtime=0;info.uid=info.gid=0
            tar.addfile(info,io.BytesIO(body))
    return gzip.compress(raw.getvalue(),mtime=0)
def member(name,data):
    header=f'{name+"/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(data):<10}`\n'.encode('ascii')
    return header+data+(b'\n' if len(data)%2 else b'')
def package():
    app=ROOT/'app';meta=json.loads((app/'appinfo.json').read_text());app_id=meta['id'];version=meta['version']
    class References(HTMLParser):
        def handle_starttag(self, tag, attrs):
            attributes=dict(attrs)
            ref=attributes.get('src') if tag=='script' else attributes.get('href') if tag=='link' else None
            if ref and not ref.startswith(('https:', 'http:', '#', 'data:')) and not (app/ref).is_file():
                raise FileNotFoundError('Missing app asset: '+ref)
    References().feed((app/'index.html').read_text())
    files={}
    for p in app.rglob('*'):
        if not p.is_file():continue
        relative=p.relative_to(app)
        if any(x.startswith('.') for x in relative.parts) or p.name in ['device.json','runtime.js'] or p.suffix in ['.map','.key']:continue
        files['usr/palm/applications/'+app_id+'/'+relative.as_posix()]=p.read_bytes()
    packageinfo={'id':app_id,'version':version,'app':app_id}
    files['usr/palm/packages/'+app_id+'/packageinfo.json']=json.dumps(packageinfo).encode()
    control=f'Package: {app_id}\nVersion: {version}\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: {sum(map(len,files.values()))//1024+1}\nMaintainer: Own TV contributors\nDescription: A personal webOS dashboard\nwebOS-Package-Format-Version: 2\nwebOS-Packager-Version: own-tv-1\n'
    data=b'!<arch>\n'+member('debian-binary',b'2.0\n')+member('control.tar.gz',archive({'control':control.encode()}))+member('data.tar.gz',archive(files))
    out=ROOT/'dist';out.mkdir(exist_ok=True);p=out/f'{app_id}_{version}_all.ipk';p.write_bytes(data);return p
if __name__=='__main__':print(package())
