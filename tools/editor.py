#!/usr/bin/env python3
"""A loopback-only browser editor. All TV communication travels over SSH."""
import argparse
import base64
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import json
from pathlib import Path
import shlex
import subprocess
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[1]
ACTIONS={'state','launch','sleep','screenOff','lgHome','settings','preferences','configure','weather','firmwareCheck'}

def invoke(ssh_config,host,action,value=None):
    if action not in ACTIONS:raise ValueError('Unknown action')
    command=['/usr/bin/node','/var/lib/own-tv/helper.cjs',action]
    if value is not None:command.append(base64.b64encode(json.dumps(value).encode()).decode())
    result=subprocess.run(['ssh','-F',ssh_config,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',host,shlex.join(command)],capture_output=True,text=True,timeout=75)
    try: reply=json.loads(result.stdout)
    except (ValueError,TypeError):raise RuntimeError('TV connection failed. Check SSH and install the native helper.')
    if result.returncode or reply.get('ok') is False:raise RuntimeError(reply.get('error','TV operation failed'))
    return reply

class Editor(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT/'app'),**kwargs)
    def allowed_host(self):return self.headers.get('Host') in {f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
    def json(self,data,status=200):
        data=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if not self.allowed_host():return self.json({'ok':False,'error':'Invalid host'},403)
        if self.path=='/editor-mode.js':
            data=b'window.OWN_TV_EDITOR=true;';self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data);return
        if self.path=='/integrations':
            data=INTEGRATIONS.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data);return
        if self.path.startswith('/api/'):return self.json({'ok':False,'error':'POST required'},405)
        if urlsplit(self.path).path in {'/','/index.html'}:
            data=(ROOT/'app/index.html').read_text().replace('<script src="bridge.js"></script>','<script src="/editor-mode.js"></script><script src="bridge.js"></script>').encode()
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data);return
        return super().do_GET()
    def do_POST(self):
        origin=self.headers.get('Origin');expected={f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'}
        if not self.allowed_host() or origin not in expected or self.headers.get('X-OwnTV-Editor')!='1':return self.json({'ok':False,'error':'Untrusted request'},403)
        if self.path!='/api/action':return self.json({'ok':False,'error':'Not found'},404)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=65536:raise ValueError('Request too large')
            if self.headers.get('Content-Type')!='application/json':raise ValueError('JSON required')
            body=json.loads(self.rfile.read(length));action=body.get('action')
            self.json(invoke(self.server.ssh_config,self.server.tv_host,action,body.get('value')))
        except Exception as error:self.json({'ok':False,'error':str(error)},400)
    def log_message(self,format,*args):pass # no private URLs, payloads or viewing data in logs

INTEGRATIONS='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Own TV · Private integrations</title><style>body{font:18px/1.6 system-ui;background:#111719;color:#e4e9e4;max-width:640px;margin:60px auto;padding:24px}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin:8px 0;background:#202a2e;color:inherit;border:1px solid #506064;border-radius:8px}label{display:block;margin-top:20px}input[type=checkbox]{width:auto}button{cursor:pointer;background:#215748}small{color:#a7b6b2}</style><h1>Private integrations</h1><p>Saved to your TV over SSH. Nothing here enters Git, config exports, or an Own TV cloud.</p><form><fieldset><legend>Weather · Open-Meteo</legend><small>Optional. Your selected coordinates are sent to Open-Meteo. Use town-level coordinates.</small><label>Place name<input id="place" maxlength="80"></label><label>Latitude<input id="lat" type="number" min="-90" max="90" step="any"></label><label>Longitude<input id="lon" type="number" min="-180" max="180" step="any"></label></fieldset><fieldset><legend>Proton Calendar</legend><small>Requires a calendar sharing feed (paid Proton feature). Treat the URL as a password. Read-only; the TV cannot edit events.</small><label>Private HTTPS feed URL<input id="feed" type="password" autocomplete="off"></label><label><input id="busy" type="checkbox" checked> Only show “Busy”, hide event titles</label></fieldset><p>Saving replaces these integration settings. Empty fields disable that integration.</p><button>Save privately to TV</button></form><p id="result" role="status"></p><a href="/" style="color:#9ae2cf">Back to dashboard</a><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const value={};if(lat.value&&lon.value)value.weather={latitude:Number(lat.value),longitude:Number(lon.value),label:place.value};if(feed.value)value.calendar={feedUrl:feed.value,busyOnly:busy.checked};try{const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-OwnTV-Editor':'1'},body:JSON.stringify({action:'configure',value})});const d=await r.json();if(!d.ok)throw Error(d.error);result.textContent='Saved to TV. The dashboard refreshes within one minute.';feed.value='';}catch(e){result.textContent=e.message;}};</script></html>'''
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--ssh-config',required=True);parser.add_argument('--host',required=True);parser.add_argument('--port',type=int,default=18765);args=parser.parse_args()
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Editor);server.ssh_config=str(Path(args.ssh_config).resolve());server.tv_host=args.host
    print(f'Own TV editor: http://127.0.0.1:{args.port}/\nPrivate integrations: http://127.0.0.1:{args.port}/integrations',flush=True)
    server.serve_forever()
