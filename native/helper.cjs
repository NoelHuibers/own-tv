#!/usr/bin/env node
'use strict';
// No listener, shell execution, telemetry or account login. Invoked over SSH or
// through Homebrew Channel by the installed dashboard's fixed bridge.
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const {expandCalendar, validateIntegrations} = require('./integrations.cjs');
const firmware=require('./firmware.cjs');
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
 let budget=120000;const items={};
 for(const app of ordered){
  let data=cached.items[app.id]?.version===app.version&&Date.now()-cached.at<86400000?cached.items[app.id].data:null;
  if(!data){try{data=await ghIcon(app.id);}catch{continue;}}
  if(data&&data.length<=budget){items[app.id]={version:app.version,data};budget-=data.length;}
 }
 write('icons-cache.json',{at:Date.now(),items});return items;
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
function weatherLabel(code){if(code===0)return 'Clear';if(code===1)return 'Mostly clear';if(code===2)return 'Partly cloudy';if(code===3)return 'Overcast';if(code===45||code===48)return 'Fog';if(code>=51&&code<=57)return 'Drizzle';if(code>=61&&code<=67)return 'Rain';if(code>=71&&code<=77)return 'Snow';if(code>=80&&code<=82)return 'Rain showers';if(code>=85&&code<=86)return 'Snow showers';if(code>=95)return 'Thunderstorm';return 'Weather';}
async function integrations() {
 const cfg=read('integrations.json',{}), result={calendar:{configured:false,events:[]},weather:{configured:false},smartHome:{configured:false,devices:[]}};
 if(cfg.weather){
  const w=cfg.weather;result.weather={configured:true,city:w.label};
  try {
   const cached=read('weather-cache.json',null);
   const d=cached&&Date.now()-cached.at<30*60*1000?cached: {at:Date.now(),data:JSON.parse(await getText('https://api.open-meteo.com/v1/forecast?latitude='+w.latitude+'&longitude='+w.longitude+'&current=temperature_2m,weather_code&timezone=auto'))};
   write('weather-cache.json',d);result.weather.temperature=d.data.current.temperature_2m;result.weather.condition=weatherLabel(d.data.current.weather_code);result.weather.updatedAt=d.at;
  }catch{result.weather.error='Weather unavailable';}
 }
 if(cfg.calendar){
  result.calendar.configured=true;
  try {
   const cached=read('calendar-cache.json',null);
   const d=cached&&Date.now()-cached.at<15*60*1000?cached:{at:Date.now(),events:expandCalendar(await getText(cfg.calendar.feedUrl),new Date(),14,cfg.calendar.busyOnly!==false)};
   write('calendar-cache.json',d);result.calendar.events=d.events;result.calendar.updatedAt=d.at;
  }catch{result.calendar.error='Calendar unavailable';}
 }
 return result;
}
function safeApp(id){return typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id);}
async function state() {
 const results=await Promise.allSettled([gh('/api/stats'),gh('/api/apps'),gh('/api/home/recents'),gh('/api/privacy'),gh('/api/hdmi'),integrations()]);
 const val=(n,fallback)=>results[n].status==='fulfilled'?results[n].value:fallback;
 const stats=val(0,{}), apps=val(1,{}),recent=val(2,{}),privacy=val(3,{}),hdmi=val(4,{});
 const installed=(apps.installed||stats.apps||[]).filter(a=>safeApp(a.id));
 const icons=await appIcons(installed);
 const list=installed.map(a=>({id:a.id,title:a.title||a.id,icon:icons[a.id]?.data}));
 const memory=stats.mem||{};
 const health={model:stats.device?.model,firmware:stats.system?.firmware,webos:stats.system?.webos,panelHours:stats.oled?.panel_usage_units!=null?stats.oled.panel_hours_exact:undefined,panelCompensationCycles:stats.oled?.comp_cycles,panelRefresherCycles:stats.oled?.refresher_cycles,temperature:typeof stats.temp==='number'?stats.temp:undefined,uptimeSeconds:stats.uptime,memoryUsedPercent:memory.usedPercent??memory.usedPct};
 const available=memory.available??memory.avail;
 if(health.memoryUsedPercent==null&&memory.total&&available!=null)health.memoryUsedPercent=Math.round((memory.total-available)*100/memory.total);
 const inputs=Object.entries(stats.inputs||{}).map(([key,title])=>({id:'com.webos.app.'+key,title,connected:undefined}));
 const catalog=hdmi.inputs||hdmi.ports||[];
 if(Array.isArray(catalog))for(const input of inputs){const found=catalog.find(p=>p.id===input.id||p.appId===input.id);if(found&&typeof found.connected==='boolean')input.connected=found.connected;}
 return {apps:list,inputs,recent:(recent.apps||[]).map(a=>({id:a.id,title:a.title})),health,privacy:{trackingOff:typeof privacy.simple?.total==='number'?privacy.simple.total===0:undefined,adBlocking:privacy.adblock?privacy.adblock.mode==='ads'||privacy.adblock.mode==='full':undefined,summary:privacy.simple?privacy.simple.total===0?'Privacy controls applied':'Review privacy controls':'Privacy status unavailable'},sleepTimer:stats.sleepTimer==null?undefined:{minutesRemaining:Number(stats.sleepTimer)||0},preferencesRevision:(()=>{try{return fs.statSync(path.join(ROOT,'preferences.json')).mtimeMs;}catch{return 0;}})(),preferences:read('preferences.json',null),...val(5,{calendar:{configured:false,events:[]},weather:{configured:false},smartHome:{configured:false,devices:[]}}),errors:results.slice(0,5).filter(r=>r.status==='rejected').length};
}
async function main(action, argument) {
 if(action==='state')return state();
 if(action==='firmwareCheck'){
  const stats=await gh('/api/stats'), apps=await gh('/api/apps'), device=read('device-capabilities.json',{});
  let hb={};try{hb=JSON.parse(fs.readFileSync('/media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/appinfo.json','utf8'));}catch{}
  const current={model:String(stats.device?.model||'').split('.')[0],country:device.country,otaid:device.otaid,firmware:stats.system?.firmware,components:{homebrew:hb.version,ownTv:read('build.json',{}).version,glasshouse:stats.tvwebVersion},apps:(apps.installed||[]).filter(a=>!a.id.startsWith('com.webos.')&&!a.id.startsWith('com.palm.')&&!a.id.startsWith('org.webosbrew.')&&a.id!=='io.github.noelhuibers.owntv').map(a=>({id:a.id,version:a.version}))};
  let catalog;try{catalog=JSON.parse(await getText('https://raw.githubusercontent.com/NoelHuibers/own-tv/main/compatibility/firmware.json',65536));}catch{return {...firmware.evaluate(current,null),catalogueReachable:false};}
  return {...firmware.evaluate(current,catalog),catalogueReachable:true};
 }

 if(action==='weather'){const cfg=read('integrations.json',{});const weather=validateIntegrations({weather:argument}).weather;cfg.weather=weather;write('integrations.json',cfg);try{fs.unlinkSync(path.join(ROOT,'weather-cache.json'));}catch{}return {ok:true};}
 if(action==='configure'){const cfg=validateIntegrations(argument);write('integrations.json',cfg);for(const name of ['calendar-cache.json','weather-cache.json'])try{fs.unlinkSync(path.join(ROOT,name));}catch{}return {ok:true};}
 if(action==='preferences'){if(!argument||typeof argument!=='object'||Array.isArray(argument)||JSON.stringify(argument).length>65536)throw new Error('Invalid preferences');if(argument.schema!==1)throw new Error('Unsupported preference schema');write('preferences.json',argument);return {ok:true,revision:fs.statSync(path.join(ROOT,'preferences.json')).mtimeMs};}
 if(action==='launch'){
  if(!safeApp(argument))throw new Error('Invalid app id');
  const apps=await gh('/api/apps');if(!(apps.installed||[]).some(a=>a.id===argument)&&!/^com\.webos\.app\.hdmi[1-4]$/.test(argument))throw new Error('App is not installed');
  return gh('/api/control',{action:'launchApp',value:argument});
 }
 if(action==='sleep'){if(![0,10,30,60,90,120].includes(argument))throw new Error('Unsupported sleep duration');return gh('/api/control',{action:'sleepTimer',value:argument===0?'off':String(argument)});}
 if(action==='screenOff')return gh('/api/control',{action:'screenOff'});
 if(action==='lgHome'){fs.writeFileSync(path.join(ROOT,'allow-stock-until'),String(Date.now()+120000),{mode:0o600});return gh('/api/control',{action:'launchApp',value:'com.webos.app.home'});}
 if(action==='settings')return gh('/api/control',{action:'launchApp',value:'com.palm.app.settings'});
 throw new Error('Unknown command');
}
if(require.main===module){let arg;try{arg=process.argv[3]?JSON.parse(Buffer.from(process.argv[3],'base64').toString()):null;}catch{console.log(JSON.stringify({ok:false,error:'Invalid request'}));process.exit(1);}
 main(process.argv[2],arg).then(v=>console.log(JSON.stringify(v)),e=>{console.log(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;});}
module.exports={safeApp,main,gh};
