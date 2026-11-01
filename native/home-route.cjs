'use strict';
// Reversible foreground routing; no network listener or firmware-file changes.
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {applyPreload,releaseIdleApps}=require('./performance.cjs');
const {createHomeReplacement}=require('./home-replacement.cjs');
const {createHomeApi,PORT}=require('./home-api.cjs');
const ROOT='/var/lib/own-tv';
const APP='io.github.noelhuibers.owntv';
const STOCK=new Set(['com.webos.app.home','com.webos.app.fullhome']);
const PID='/var/run/own-tv-home.pid';
if(process.argv.includes('--stop')){
 try{const pid=Number(fs.readFileSync('/var/run/own-tv-home-supervisor.pid','utf8'));if(Number.isInteger(pid)&&pid>1&&fs.readFileSync('/proc/'+pid+'/cmdline','utf8').includes('/var/lib/webosbrew/init.d/60-own-tv-home'))process.kill(pid,'SIGTERM');}catch{}
 try{const pid=Number(fs.readFileSync(PID,'utf8'));if(Number.isInteger(pid)&&pid>1&&fs.readFileSync('/proc/'+pid+'/cmdline','utf8').includes('/var/lib/own-tv/home-route.cjs'))process.kill(pid,'SIGTERM');}catch{}
 process.exit(0);
}
let subscription=null,stopping=false,inFlight=false,lastLaunch=0,failures=0,observedStock=false;
fs.writeFileSync(PID,String(process.pid),{mode:0o600});
function once(uri,body){return new Promise((resolve,reject)=>{
 const child=spawn('/usr/bin/luna-send',['-n','1','-w','3000','luna://'+uri,JSON.stringify(body)],{stdio:['pipe','pipe','ignore']});
 let raw='';const timer=setTimeout(()=>{child.kill();reject(Error('Luna timeout'));},5000);
 child.stdout.on('data',b=>raw+=b);
 child.on('error',e=>{clearTimeout(timer);reject(e);});
 child.on('close',()=>{clearTimeout(timer);try{const d=JSON.parse(raw.trim());if(d.returnValue===false)reject(Error(d.errorText||'Luna refused'));else resolve(d);}catch(e){reject(e);}});
});}
const replacement=createHomeReplacement({luna:once});
const api=createHomeApi({token:replacement.token,main:require('./helper.cjs').main,heartbeat:replacement.heartbeat});
api.on('error',()=>console.error('Own TV private Home bridge could not start. Direct Home will refuse activation.'));
api.listen(PORT,'127.0.0.1');
let directBusy=false;
async function directForeground(appId){
 const s=replacement.status();if(!s.enabled)return false;
 if(s.phase==='preparing'&&Date.now()-s.startedAt>60000&&!directBusy){await replacement.disable('Home activation was interrupted.');return false;}
 if(s.phase==='preparing'||directBusy||replacement.mounted())return true;
 if(s.phase==='escaped'){
  if(STOCK.has(appId)&&stockAllowed())return true;
  if(!observedStock&&Date.now()<Number((()=>{try{return fs.readFileSync(ROOT+'/allow-stock-until','utf8');}catch{return 0;}})()))return true;
 }
 directBusy=true;
 try{try{fs.unlinkSync(ROOT+'/allow-stock-until');}catch{}observedStock=false;const power=await once('com.webos.service.tvpower/power/getPowerState',{});await replacement.enable({launch:power.state==='Active'&&(STOCK.has(appId)||appId===APP)});}
 catch(e){console.error('Direct Home could not start; foreground routing retained.');}
 finally{directBusy=false;}
 return replacement.status().enabled;
}
function stockAllowed(){try{const allowed=Number(fs.readFileSync(ROOT+'/allow-stock-until','utf8'))>Date.now();if(allowed)observedStock=true;return allowed;}catch{return false;}}
async function foreground(appId){
 if(!appId)return;
 if(await directForeground(appId))return;
 if(!STOCK.has(appId)){
  if(appId!==APP||observedStock){try{fs.unlinkSync(ROOT+'/allow-stock-until');}catch{}observedStock=false;}
  if(appId===APP)failures=0;
  return;
 }
 if(stockAllowed()||inFlight||Date.now()-lastLaunch<1500||failures>=3)return;
 inFlight=true;lastLaunch=Date.now();
 try{await once('com.webos.applicationManager/launch',{id:APP});failures=0;}
 catch{failures++;console.error('Own TV launch failed; LG Home remains available.');}
 finally{inFlight=false;}
}
function subscribe(){
 if(stopping)return;
 subscription=spawn('/usr/bin/luna-send',['-i','luna://com.webos.applicationManager/getForegroundAppInfo','{"subscribe":true}'],{stdio:['pipe','pipe','ignore']});
 let pending='';subscription.stdout.on('data',b=>{pending+=b.toString();if(pending.length>65536)pending='';let i;while((i=pending.indexOf('\n'))!==-1){const line=pending.slice(0,i).trim();pending=pending.slice(i+1);try{const d=JSON.parse(line);if(d.appId)foreground(d.appId);}catch{}}});
 subscription.on('error',()=>{});subscription.on('close',()=>{subscription=null;if(!stopping)setTimeout(subscribe,5000);});
}
let memoryBusy=false,memoryPrepared=false;
async function enforceMemory(appId){
 if(memoryBusy||stopping)return;
 let settings;try{settings=JSON.parse(fs.readFileSync(ROOT+'/performance.json','utf8'));}catch{return;}
 if(settings.enabled!==true){memoryPrepared=false;return;}
 memoryBusy=true;try{await applyPreload(once,settings);
  const current=JSON.parse(fs.readFileSync(ROOT+'/performance.json','utf8'));
  if(current.enabled!==true){await applyPreload(once,settings,true);return;}
  if(!memoryPrepared&&(appId===APP||appId==='com.webos.app.home'&&replacement.mounted())){await releaseIdleApps(once);memoryPrepared=true;}
 }catch{}finally{memoryBusy=false;}
}
async function check(){if(stopping)return;try{const d=await once('com.webos.applicationManager/getForegroundAppInfo',{});await foreground(d.appId);if(replacement.mounted()&&!directBusy){const power=await once('com.webos.service.tvpower/power/getPowerState',{});await replacement.guard(d.appId,power.state);}enforceMemory(d.appId);}catch{}}
function stop(){stopping=true;if(subscription)subscription.kill();try{if(fs.readFileSync(PID,'utf8').trim()===String(process.pid))fs.unlinkSync(PID);}catch{}process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
subscribe();check();setInterval(check,10000);
setInterval(()=>{if(replacement.status().enabled&&replacement.status().phase==='active'&&replacement.mounted())replacement.stopFlutter();},2000);
