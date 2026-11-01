/* The dashboard exposes fixed actions, never a shell or arbitrary URL runner. */
(function () {
 'use strict';
 var onTV=typeof window.PalmServiceBridge==='function';
 var editor=window.OWN_TV_EDITOR===true;
 var home=window.OWN_TV_HOME_BRIDGE;
 if(!onTV&&!editor&&!home)return;
 if(!onTV&&/[?&]preview=(sample|empty|error)(?:&|$)/.test(location.search))return;
 function call(action,value){
  if(home)return fetch('http://127.0.0.1:'+home.port+'/action',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+home.token},body:JSON.stringify({action:action,value:value})}).then(function(r){return r.json();}).then(check);
  if(editor&&!onTV)return fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-OwnTV-Editor':'1'},body:JSON.stringify({action:action,value:value})}).then(function(r){return r.json();}).then(check);
  if(!onTV)return Promise.reject(new Error('Preview only. Connect a TV through the local editor.'));
  return new Promise(function(resolve,reject){
   var bridge=new window.PalmServiceBridge(),finished=false;
   var timer=setTimeout(function(){if(!finished){finished=true;try{bridge.cancel();}catch(e){}reject(new Error('TV did not respond'));}},60000);
   var args=value===undefined?'':' '+btoa(unescape(encodeURIComponent(JSON.stringify(value))));
   if(!/^[a-zA-Z]+$/.test(action)){reject(new Error('Invalid action'));return;}
   bridge.onservicecallback=function(raw){
    if(finished)return;finished=true;clearTimeout(timer);
    try{var r=JSON.parse(raw);if(r.returnValue===false)throw new Error('Own TV needs its Homebrew Channel permission. Run the permission repair tool.');
     resolve(check(JSON.parse(r.stdoutString||'{}')));
    }catch(e){reject(e);}finally{try{bridge.cancel();}catch(e){}}
   };
   bridge.call('luna://org.webosbrew.hbchannel.service/exec',JSON.stringify({command:'/usr/bin/node /var/lib/own-tv/helper.cjs '+action+args}));
  });
 }
 function check(r){if(r.ok===false)throw new Error(r.error||'TV operation failed');return r;}
 window.OwnTVBridge={
  getState:function(){return call('state');},
  getCalendarCatalog:function(){return call('calendarCatalog');},
  setCalendarSource:function(value){return call('calendarSource',value);},
  getWeather:function(force){return call('weatherDetails',force===true);},
  getRadar:function(){return call('radar');},
  openWeatherSource:function(source){return call('weatherSource',source);},
  checkFirmware:function(){return call('firmwareCheck');},
  releaseIdleApps:function(){return call('releaseIdleApps');},
  setMemoryMode:function(enabled){return call('memoryMode',enabled);},
  setDirectHome:function(enabled){return call('directHome',enabled);},
  homeHeartbeat:function(value){return call('homeHeartbeat',value);},
  searchWeather:function(query){return call('weatherSearch',query);},
  launch:function(id){if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id))return Promise.reject(new Error('Invalid app'));return call('launch',id);},
  setSleepTimer:function(minutes){return call('sleep',Number(minutes));},
  screenOff:function(){return call('screenOff');},
  openLgHome:function(){return call('lgHome');},
  openSettings:function(){return call('settings');},
  savePreferences:function(prefs){return call('preferences',prefs);},
  configureWeather:function(weather){return call('weather',weather);},
  clearWeather:function(){return call('configure',{weather:null});},
  openEditor:function(){if(editor){location.href='/integrations';return Promise.resolve({ok:true});}return Promise.reject(new Error('On your computer, run: python3 tools/editor.py --ssh-config PATH --host YOUR_TV_ALIAS'));}
 };
 window.OwnTVBridge.capabilities={configureWeather:true,openEditor:editor};
 window.OwnTVBridge.onTV=onTV||!!home;
 window.OwnTVBridge.editor=editor;
})();
