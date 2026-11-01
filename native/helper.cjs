#!/usr/bin/env node
'use strict';
// No listener, shell execution, telemetry or account login. Invoked over SSH or
// through Homebrew Channel by the installed dashboard's fixed bridge.
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const {validateIntegrations} = require('./integrations.cjs');
const firmware=require('./firmware.cjs');
const {normalizeWeather,searchUrl,forecastUrl,normalizeRadar}=require('./weather.cjs');
const {parseMemory,releaseIdleApps,applyPreload}=require('./performance.cjs');
const {spawn}=require('node:child_process');
const {fetchCalendar}=require('./calendar-feed.cjs');
const {collectAgenda}=require('./calendar-agenda.cjs');
const {publicCatalog,changeCalendar}=require('./calendar-settings.cjs');
const {createHomeReplacement}=require('./home-replacement.cjs');
const ROOT = process.env.OWN_TV_DATA || '/var/lib/own-tv';
function read(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8')); } catch { return fallback; } }
function write(name, value) {
 fs.mkdirSync(ROOT, {recursive:true, mode:0o700});
 const p=path.join(ROOT,name);fs.writeFileSync(p+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(p+'.tmp',p);
}
function gh(route, body) {
 let cfg;try {cfg=JSON.parse(fs.readFileSync('/var/lib/tvweb/config.json','utf8'));}catch {throw new Error('Install Glasshouse first.');}
 return new Promise((resolve,reject)=>{
  const data=body?JSON.stringify(body):null;
  const req=http.request({hostname:'127.0.0.1',port:cfg.port||8080,path:route,method:data?'POST':'GET',headers:{Authorization:'Bearer '+cfg.token,'Content-Type':'application/json',...(data?{'Content-Length':Buffer.byteLength(data)}:{})}},res=>{
   let raw='';res.on('data',b=>{raw+=b;if(raw.length>4000000)req.destroy(new Error('Response too large'));});
   res.on('end',()=>{try{const value=JSON.parse(raw);if(res.statusCode>=400||value.ok===false)reject(new Error(value.error||'TV operation failed'));else resolve(value);}catch(e){reject(e);}});
  });req.setTimeout(30000,()=>req.destroy(new Error('TV operation timed out')));req.on('error',reject);if(data)req.write(data);req.end();
 });
}
async function appIcons(apps) {
 const cached=read('icons-cache.json',{at:0,items:{}});
 const priority=['youtube.leanback.v4','tv.twitch.tv.starshot.lg','spotify-beehive','netflix','amazon','com.disney.disneyplus-prod','com.netrtl.tvnow'];
 const ordered=[...apps].sort((a,b)=>(priority.includes(a.id)?priority.indexOf(a.id):-1+100)-(priority.includes(b.id)?priority.indexOf(b.id):-1+100));
 let budget=120000;const items={};let changed=Date.now()-cached.at>=86400000;
 for(const app of ordered){
  const hit=cached.items[app.id]&&cached.items[app.id].version===app.version&&Date.now()-cached.at<86400000;
  let data=hit?cached.items[app.id].data:null;
  if(!hit){changed=true;try{data=await ghIcon(app.id);}catch{data=null;}}
  if(!data||data.length<=budget){items[app.id]={version:app.version,data};if(data)budget-=data.length;}
 }
 if(changed)write('icons-cache.json',{at:Date.now(),items});return items;
}
function ghIcon(id) {
 return new Promise((resolve,reject)=>{
  const cfg=JSON.parse(fs.readFileSync('/var/lib/tvweb/config.json','utf8'));
  const req=http.get({hostname:'127.0.0.1',port:cfg.port||8080,path:'/api/apps/icon?id='+encodeURIComponent(id),headers:{Authorization:'Bearer '+cfg.token}},res=>{
   const type=String(res.headers['content-type']||'').split(';')[0];
   if(res.statusCode!==200||!['image/png','image/jpeg','image/webp'].includes(type)){res.resume();resolve(null);return;}
   const buffers=[];let size=0;res.on('data',b=>{size+=b.length;if(size>32768){req.destroy();resolve(null);}else buffers.push(b);});
   res.on('end',()=>resolve('data:'+type+';base64,'+Buffer.concat(buffers).toString('base64')));
  });req.setTimeout(1500,()=>{req.destroy();resolve(null);});req.on('error',()=>resolve(null));
 });
}
function getText(url, maxBytes=2000000) {
 return new Promise((resolve,reject)=>{
  const req=https.get(url,{timeout:15000},res=>{
   if(res.statusCode!==200){res.resume();reject(new Error('Provider returned HTTP '+res.statusCode));return;}
   let raw='';res.on('data',b=>{raw+=b;if(Buffer.byteLength(raw)>maxBytes)req.destroy(new Error('Provider response too large'));});res.on('end',()=>resolve(raw));
  });req.on('timeout',()=>req.destroy(new Error('Provider timed out')));req.on('error',()=>reject(new Error('Provider connection failed')));
 });
}
async function weatherData(details=false,force=false){
 const w=read('integrations.json',{}).weather;
 if(!w)return {configured:false};
 const cached=read('weather-cache.json',null);
 try{
  const d=!force&&cached?.schema===3&&Date.now()-cached.at<30*60*1000?cached:{schema:3,at:Date.now(),data:JSON.parse(await getText(forecastUrl(w)))};
  const result=normalizeWeather(d.data,w.label,d.at,details);
  if(d!==cached)write('weather-cache.json',d);
  if(details)result.location={latitude:w.latitude,longitude:w.longitude};
  return result;
 }catch{
  if(cached?.schema===3){const result=normalizeWeather(cached.data,w.label,cached.at,details);if(details)result.location={latitude:w.latitude,longitude:w.longitude};return {...result,error:true};}
  return {configured:true,city:w.label,error:true,...(details?{location:{latitude:w.latitude,longitude:w.longitude}}:{})};
 }
}
async function integrations(){
 const cfg=read('integrations.json',{}),old=read('calendar-cache.json',{});
 const agendaDeadline=Date.now()+45000;
 const [weather,agenda]=await Promise.all([weatherData(false),collectAgenda(cfg.calendar,old,url=>fetchCalendar(url,0,Math.min(agendaDeadline,Date.now()+15000)))]);
 if(cfg.calendar&&JSON.stringify(old)!==JSON.stringify(agenda.cache))write('calendar-cache.json',agenda.cache);
 return {weather,calendar:agenda.calendar,smartHome:{configured:false,devices:[]}};
}
function safeApp(id){return typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id);}
async function cachedGh(name,route,ttl){
 const cached=read(name,null);
 if(cached&&Date.now()-cached.at<ttl)return cached.data;
 const data=await gh(route);write(name,{at:Date.now(),data});return data;
}
async function state() {
 const results=await Promise.allSettled([gh('/api/stats'),cachedGh('apps-cache.json','/api/apps',300000),gh('/api/home/recents'),cachedGh('privacy-cache.json','/api/privacy',300000),cachedGh('inputs-cache.json','/api/hdmi',300000),integrations()]);
 const val=(n,fallback)=>results[n].status==='fulfilled'?results[n].value:fallback;
 const stats=val(0,{}), apps=val(1,{}),recent=val(2,{}),privacy=val(3,{}),hdmi=val(4,{});
 const installed=(apps.installed||stats.apps||[]).filter(a=>safeApp(a.id));
 const icons=await appIcons(installed);
 const list=installed.map(a=>({id:a.id,title:a.title||a.id,icon:icons[a.id]?.data}));
 const memory=stats.mem||{};
 const health={model:stats.device?.model,firmware:stats.system?.firmware,webos:stats.system?.webos,panelHours:stats.oled?.panel_usage_units!=null?stats.oled.panel_hours_exact:undefined,panelCompensationCycles:stats.oled?.comp_cycles,panelRefresherCycles:stats.oled?.refresher_cycles,temperature:typeof stats.temp==='number'?stats.temp:undefined,uptimeSeconds:stats.uptime,memoryUsedPercent:memory.usedPercent??memory.usedPct};
 const available=memory.available??memory.avail;
 if(health.memoryUsedPercent==null&&memory.total&&available!=null)health.memoryUsedPercent=Math.round((memory.total-available)*100/memory.total);
 try{Object.assign(health,parseMemory(fs.readFileSync('/proc/meminfo','utf8')));}catch{}
 health.lowMemoryMode=read('performance.json',{}).enabled===true;
 const direct=createHomeReplacement({root:ROOT,luna});health.directHome=direct.status().enabled===true&&direct.mounted();health.directHomeFailure=direct.status().failure||null;
 health.idleReleaseSupported=String(health.model||'').split('.')[0]==='OLED65C51LA';
 const inputs=Object.entries(stats.inputs||{}).map(([key,title])=>({id:'com.webos.app.'+key,title,connected:undefined}));
 const catalog=hdmi.inputs||hdmi.ports||[];
 if(Array.isArray(catalog))for(const input of inputs){const found=catalog.find(p=>p.id===input.id||p.appId===input.id);if(found&&typeof found.connected==='boolean')input.connected=found.connected;}
 return {apps:list,inputs,recent:(recent.apps||[]).map(a=>({id:a.id,title:a.title})),health,privacy:{trackingOff:typeof privacy.simple?.total==='number'?privacy.simple.total===0:undefined,adBlocking:privacy.adblock?privacy.adblock.mode==='ads'||privacy.adblock.mode==='full':undefined,summary:privacy.simple?privacy.simple.total===0?'Privacy controls applied':'Review privacy controls':'Privacy status unavailable'},sleepTimer:stats.sleepTimer==null?undefined:{minutesRemaining:Number(stats.sleepTimer)||0},preferencesRevision:(()=>{try{return fs.statSync(path.join(ROOT,'preferences.json')).mtimeMs;}catch{return 0;}})(),preferences:read('preferences.json',null),...val(5,{calendar:{configured:false,events:[]},weather:{configured:false},smartHome:{configured:false,devices:[]}}),errors:results.slice(0,5).filter(r=>r.status==='rejected').length};
}
function luna(uri,body){return new Promise((resolve,reject)=>{
 const child=spawn('/usr/bin/luna-send',['-n','1','-w','3000','luna://'+uri,JSON.stringify(body)],{stdio:['pipe','pipe','ignore']});
 let raw='';const timer=setTimeout(()=>{child.kill();reject(Error('TV command timed out'));},5000);
 child.stdout.on('data',b=>raw+=b);child.on('error',e=>{clearTimeout(timer);reject(e);});
 child.on('close',()=>{clearTimeout(timer);try{const r=JSON.parse(raw.trim());if(r.returnValue===false)throw Error(r.errorText||'TV command refused');resolve(r);}catch(e){reject(e);}});
});}
async function main(action, argument) {
 if(action==='state')return state();
 if(action==='directHomeRecover')return createHomeReplacement({root:ROOT,luna}).recover('Direct Home restarted after a router error.');
 if(action==='homeRefresh')return createHomeReplacement({root:ROOT,luna}).refresh();
 if(action==='directHome'){
  if(typeof argument!=='boolean')throw Error('Choose whether Direct Home is enabled.');
  const direct=createHomeReplacement({root:ROOT,luna});
  if(!argument)return direct.disable();
  const stats=await gh('/api/stats');
  if(String(stats.device?.model||'').split('.')[0]!=='OLED65C51LA'||stats.system?.firmware!=='43.21.77')throw Error('Direct Home has not been verified for this model and firmware.');
  const foreground=await luna('com.webos.applicationManager/getForegroundAppInfo',{});
  return direct.enable({launch:['com.webos.app.home','io.github.noelhuibers.owntv'].includes(foreground.appId)});
 }
 if(action==='weatherSource'){if(!['forecast','radar'].includes(argument))throw Error('Unknown weather source');return luna('com.webos.applicationManager/launch',{id:'com.webos.app.browser',params:{target:argument==='forecast'?'https://open-meteo.com/':'https://www.rainviewer.com/'}});}
 if(action==='weatherDetails')return weatherData(true,argument===true);
 if(action==='radar'){const w=read('integrations.json',{}).weather;if(!w)throw Error('Configure weather first.');const cached=read('radar-cache.json',null);let data;if(cached&&Date.now()-cached.at<300000)data=cached.data;else{data=normalizeRadar(JSON.parse(await getText('https://api.rainviewer.com/public/weather-maps.json',65536)));write('radar-cache.json',{at:Date.now(),data});}return {...data,location:{latitude:w.latitude,longitude:w.longitude},city:w.label};}
 if(action==='weatherSearch'){const r=JSON.parse(await getText(searchUrl(argument),65536));return {ok:true,places:(r.results||[]).map(p=>({label:String(p.name).slice(0,40),region:[p.admin1,p.country].filter(Boolean).join(', '),latitude:p.latitude,longitude:p.longitude}))};}
 if(action==='memoryMode'){
  if(typeof argument!=='boolean')throw Error('Invalid memory mode');
  const stats=await gh('/api/stats');if(String(stats.device?.model||'').split('.')[0]!=='OLED65C51LA')throw Error('Memory mode is unverified on this model.');
  const previous=read('performance.json',{enabled:false,before:{}});
  // Capture the originals before writing any policies, including across a restart.
  const policy=await luna('com.webos.service.preloadmanager/getPreloadPolicy',{});
  if(!Array.isArray(policy.applications))throw Error('Preload policy unavailable');
  const before={...previous.before};for(const p of policy.applications)if(['youtube.leanback.v4','netflix','amazon','com.webos.app.lgchannels'].includes(p.id)&&typeof p.isEnabled==='boolean'&&!(p.id in before))before[p.id]=p.isEnabled;
  if(!Object.keys(before).length)throw Error('No supported video preload policies');
  const next={enabled:argument,before};
  write('performance.json',next);
  try{await applyPreload(luna,next,!argument);write('performance.json',next);}catch(e){write('performance.json',previous);try{await applyPreload(luna,next,true);}catch{}throw e;}
  if(argument)try{await releaseIdleApps(luna);}catch{}
  return {ok:true,enabled:argument};
 }
 if(action==='releaseIdleApps'){const stats=await gh('/api/stats');if(String(stats.device?.model||'').split('.')[0]!=='OLED65C51LA')throw Error('Idle-app release is unverified on this model.');return releaseIdleApps(luna);}
 if(action==='firmwareCheck'){
  const stats=await gh('/api/stats'), apps=await gh('/api/apps'), device=read('device-capabilities.json',{});
  let hb={};try{hb=JSON.parse(fs.readFileSync('/media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/appinfo.json','utf8'));}catch{}
  const current={model:String(stats.device?.model||'').split('.')[0],country:device.country,otaid:device.otaid,firmware:stats.system?.firmware,components:{homebrew:hb.version,ownTv:read('build.json',{}).version,glasshouse:stats.tvwebVersion},apps:(apps.installed||[]).filter(a=>!a.id.startsWith('com.webos.')&&!a.id.startsWith('com.palm.')&&!a.id.startsWith('org.webosbrew.')&&a.id!=='io.github.noelhuibers.owntv').map(a=>({id:a.id,version:a.version}))};
  let catalog;try{catalog=JSON.parse(await getText('https://raw.githubusercontent.com/NoelHuibers/own-tv/main/compatibility/firmware.json',65536));}catch{return {...firmware.evaluate(current,null),catalogueReachable:false};}
  return {...firmware.evaluate(current,catalog),catalogueReachable:true};
 }

 if(action==='weather'){const cfg=read('integrations.json',{});const weather=validateIntegrations({weather:argument}).weather;cfg.weather=weather;write('integrations.json',cfg);try{fs.unlinkSync(path.join(ROOT,'weather-cache.json'));}catch{}return {ok:true};}
 if(action==='calendarCatalog')return publicCatalog(read('integrations.json',{}).calendar);
 if(action==='calendarSource'){const cfg=read('integrations.json',{});cfg.calendar=changeCalendar(cfg.calendar,argument);write('integrations.json',cfg);return {ok:true};}
 if(action==='configure'){const patch=validateIntegrations(argument),cfg={...read('integrations.json',{}),...patch};for(const name of ['calendar','weather'])if(argument[name]===null)delete cfg[name];write('integrations.json',cfg);for(const name of ['calendar','weather'])if(name in argument)try{fs.unlinkSync(path.join(ROOT,name+'-cache.json'));}catch{}return {ok:true};}
 if(action==='preferences'){if(!argument||typeof argument!=='object'||Array.isArray(argument)||JSON.stringify(argument).length>65536)throw new Error('Invalid preferences');if(argument.schema!==1)throw new Error('Unsupported preference schema');write('preferences.json',argument);return {ok:true,revision:fs.statSync(path.join(ROOT,'preferences.json')).mtimeMs};}
 if(action==='launch'){
  if(!safeApp(argument))throw new Error('Invalid app id');
  const apps=await gh('/api/apps');if(!(apps.installed||[]).some(a=>a.id===argument)&&!/^com\.webos\.app\.hdmi[1-4]$/.test(argument))throw new Error('App is not installed');
  return gh('/api/control',{action:'launchApp',value:argument});
 }
 if(action==='sleep'){if(![0,10,30,60,90,120].includes(argument))throw new Error('Unsupported sleep duration');return gh('/api/control',{action:'sleepTimer',value:argument===0?'off':String(argument)});}
 if(action==='screenOff')return gh('/api/control',{action:'screenOff'});
 if(action==='lgHome'){const direct=createHomeReplacement({root:ROOT,luna});if(direct.status().enabled&&direct.mounted())return direct.escape();fs.writeFileSync(path.join(ROOT,'allow-stock-until'),String(Date.now()+120000),{mode:0o600});return gh('/api/control',{action:'launchApp',value:'com.webos.app.home'});}
 if(action==='settings')return gh('/api/control',{action:'launchApp',value:'com.palm.app.settings'});
 throw new Error('Unknown command');
}
if(require.main===module){let arg;try{arg=process.argv[3]?JSON.parse(Buffer.from(process.argv[3],'base64').toString()):null;}catch{console.log(JSON.stringify({ok:false,error:'Invalid request'}));process.exit(1);}
 main(process.argv[2],arg).then(v=>console.log(JSON.stringify(v)),e=>{console.log(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;});}
module.exports={safeApp,main,gh};
