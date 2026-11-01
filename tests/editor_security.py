"""Test the local editor's boundary without a TV or SSH credentials."""
import importlib.util
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request
import json
from unittest.mock import patch
import subprocess
from http.server import ThreadingHTTPServer
spec=importlib.util.spec_from_file_location('editor',Path(__file__).resolve().parents[1]/'tools/editor.py')
editor=importlib.util.module_from_spec(spec);spec.loader.exec_module(editor)
REAL_INVOKE=editor.invoke
class EditorSecurity(unittest.TestCase):
 def setUp(self):
  self.called=[]
  editor.invoke=lambda *args:self.called.append(args) or {'ok':True}
  self.server=ThreadingHTTPServer(('127.0.0.1',0),editor.Editor);self.server.ssh_config='unused';self.server.tv_host='unused'
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  self.origin=f'http://127.0.0.1:{self.server.server_port}'
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
 def request(self,origin,host=None,header=True):
  h={'Content-Type':'application/json','Origin':origin}
  if header:h['X-OwnTV-Editor']='1'
  if host:h['Host']=host
  r=urllib.request.Request(self.origin+'/api/action',data=b'{"action":"state"}',headers=h)
  return urllib.request.urlopen(r,timeout=2)
 def test_cross_site_and_rebinding_requests_are_refused(self):
  for origin,host,header in [('https://attacker.invalid',None,True),(self.origin,'attacker.invalid',True),(self.origin,None,False)]:
   with self.assertRaises(urllib.error.HTTPError) as cm:self.request(origin,host,header)
   self.assertEqual(cm.exception.code,403);cm.exception.close()
  self.assertFalse(self.called)
 def test_same_origin_editor_request_works(self):
  with self.request(self.origin) as r:self.assertTrue(json.load(r)['ok'])
  self.assertEqual(self.called[0][2],'state')
class TimeoutPrivacy(unittest.TestCase):
 def test_timeout_does_not_expose_the_ssh_command_or_subscription(self):
  error=subprocess.TimeoutExpired(['ssh','sensitive-payload'],75)
  with patch.object(editor.subprocess,'run',side_effect=error):
   with self.assertRaises(RuntimeError) as cm:REAL_INVOKE('unused','unused','configure',{'calendar':{'feedUrl':'https://calendar.example/secret.ics'}})
  self.assertNotIn('sensitive-payload',str(cm.exception));self.assertNotIn('secret.ics',str(cm.exception));self.assertIn('timed out',str(cm.exception))
if __name__=='__main__':unittest.main()
