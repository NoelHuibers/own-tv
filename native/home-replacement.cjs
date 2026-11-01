'use strict';
// Based on the Home identity/rescan technique documented by Glasshouse and Luma.
// LG's files remain under a temporary bind mount. No SAM restart or layout edit.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {randomBytes}=require('node:crypto'),{execFile}=require('node:child_process');
const {promisify}=require('node:util');
const LG='com.webos.app.home',APP='io.github.noelhuibers.owntv',PORT=18766;
function isLgFlutter(argv){return path.basename(argv[0]||'')==='flutter-client'&&argv.some((a,i)=>a==='-i'&&argv[i+1]===LG);}
function heartbeatExpired({foreground,power,startedAt,lastBeat,now}){return foreground===LG&&power==='Active'&&now-Math.max(startedAt,lastBeat||0)>(lastBeat>=startedAt?45000:60000);}
function createHomeReplacement(options={}){
 const root=options.root||'/var/lib/own-tv',dir=path.join(root,'home-system'),stage=path.join(dir,'app');
 const appDir=options.appDir||'/usr/palm/applications/'+LG,source=options.source||'/media/developer/apps/usr/palm/applications/'+APP,proc=options.procDir||'/proc';
 const luna=options.luna,run=options.run||promisify(execFile),now=options.now||Date.now;
 function read(name,fallback){try{return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));}catch{return fallback;}}
 function write(name,data){fs.mkdirSync(dir,{recursive:true,mode:0o700});const p=path.join(dir,name);fs.writeFileSync(p+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(p+'.tmp',p);}
 function status(){return read('state.json',{enabled:false});}
 function mounted(){if(options.isMounted)return options.isMounted();try{const a=fs.statSync(stage),b=fs.statSync(appDir);return a.dev===b.dev&&a.ino===b.ino;}catch{return false;}}
 function token(){let t=read('token.json',null);if(!t){t=randomBytes(32).toString('hex');write('token.json',t);}return t;}
 function heartbeat(value){const v=value&&typeof value==='object'?value:{};write('heartbeat.json',{at:now(),version:typeof v.version==='string'&&/^\d+\.\d+\.\d+$/.test(v.version)?v.version:null,rendered:v.rendered===true,connected:v.connected===true,apps:Number.isInteger(v.apps)?Math.max(0,Math.min(500,v.apps)):0});}
 function processes(){const ids=[];for(const pid of fs.readdirSync(proc)){if(!/^\d+$/.test(pid))continue;try{if(isLgFlutter(fs.readFileSync(path.join(proc,pid,'cmdline'),'utf8').split('\0')))ids.push(Number(pid));}catch{}}return ids;}
 function stopFlutter(){for(const pid of processes())try{(options.kill||process.kill)(pid,'SIGTERM');}catch{}}
 async function reread(type){
  const schema=fs.readFileSync(options.schemaFile||'/etc/palm/schemas/sam/applicationManager.blockSystemApp.schema','utf8');
  const payload={id:LG,...(schema.includes('"forceBlockSystemApp"')?{forceBlockSystemApp:false}:{})};
  let blockError=null;try{await luna('com.webos.applicationManager/blockSystemApp',payload);}catch(e){blockError=e;}
  let released=false;for(let i=0;i<3&&!released;i++)try{await luna('com.webos.applicationManager/releaseBlockSystemApp',{id:LG});released=true;}catch{}
  if(!released)throw Error('LG Home could not be released; run the recovery command.');
  if(blockError)throw blockError;
  for(let i=0;i<16;i++){
   const info=(await luna('com.webos.applicationManager/getAppInfo',{id:LG})).appInfo;
   if(info?.type===type&&(type!=='web'||info.appCategory?.includes('home')))return;
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('The TV did not register the Home manifest.');
 }
 async function ping(){
  if(options.ping)return options.ping();
  return new Promise((resolve,reject)=>{const data=JSON.stringify({action:'homePing'});const req=http.request({hostname:'127.0.0.1',port:PORT,path:'/action',method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>{try{if(JSON.parse(body).service==='own-tv-home'&&res.statusCode===200)resolve();else reject(Error('Home bridge did not authenticate'));}catch{reject(Error('Home bridge unavailable'));}});});req.setTimeout(3000,()=>req.destroy(Error('Start the Own TV Home router before enabling Direct Home.')));req.on('error',reject);req.end(data);});
 }
 function prepare(){
  const current=status();
  if(!mounted()){
   const manifest=JSON.parse(fs.readFileSync(path.join(appDir,'appinfo.json'),'utf8'));
   if(manifest.id!==LG||manifest.type!=='flutter')throw Error('Direct Home is only prepared for the tested Flutter Home.');
   if(!fs.existsSync(path.join(dir,'stock-manifest.json')))write('stock-manifest.json',manifest);
  }
  if(!fs.existsSync(path.join(source,'index.html')))throw Error('Install Own TV before enabling Direct Home.');
  fs.mkdirSync(stage,{recursive:true,mode:0o700});
  fs.cpSync(source,stage,{recursive:true,filter:p=>!path.basename(p).startsWith('.')});
  const info=JSON.parse(fs.readFileSync(path.join(stage,'appinfo.json'),'utf8'));
  Object.assign(info,{id:LG,title:'Own TV',visible:false,type:'web',main:'index.html',appCategory:['home']});
  fs.writeFileSync(path.join(stage,'appinfo.json'),JSON.stringify(info),{mode:0o600});
  const runtime='window.OWN_TV_SYSTEM_HOME=true;window.OWN_TV_HOME_BRIDGE='+JSON.stringify({port:PORT,token:token()})+';';
  fs.writeFileSync(path.join(stage,'home-runtime.js'),runtime,{mode:0o600});
  const html=fs.readFileSync(path.join(stage,'index.html'),'utf8').replace("connect-src 'self';","connect-src 'self' http://127.0.0.1:"+PORT+";").replace('<script src="bridge.js"></script>','<script src="home-runtime.js"></script><script src="bridge.js"></script>');
  fs.writeFileSync(path.join(stage,'index.html'),html,{mode:0o600});
  // WAM runs as uid/gid 505 on the gated C5. Root retains write access;
  // only that runtime group can read the mounted assets and bridge token.
  function readable(p){const isDir=fs.lstatSync(p).isDirectory();fs.chownSync(p,-1,options.assetGroup??505);fs.chmodSync(p,isDir?0o750:0o640);if(isDir)for(const f of fs.readdirSync(p))readable(path.join(p,f));}
  readable(stage);
  return current;
 }
 async function setDefault(id){const r=await luna('com.webos.settingsservice/getSystemSettings',{category:'general',keys:['defaultApps']});const apps=r.settings?.defaultApps;if(!apps)throw Error('Home settings unavailable');await luna('com.webos.settingsservice/setSystemSettings',{category:'general',settings:{defaultApps:{...apps,home:id}}});}
 async function enable({launch=true}={}){
  if(mounted()&&status().enabled)return {ok:true,enabled:true};
  const previous=prepare();await ping();
  try{fs.unlinkSync(path.join(root,'allow-stock-until'));}catch{}
  const before=await luna('com.webos.service.preloadmanager/getPreloadPolicy',{});
  const preload=previous.preload??before.applications?.find(a=>a.id===LG)?.isEnabled;
  write('state.json',{...previous,enabled:true,phase:'preparing',preload,startedAt:now(),failure:null});
  try{
   await run('/bin/mount',['--bind',stage,appDir],{timeout:4000});if(!mounted())throw Error('The Home mount did not take.');
   await reread('web');
   try{await luna('com.webos.service.preloadmanager/setPreloadPolicy',{application:{id:LG,isEnabled:false}});}catch{}
   stopFlutter();
   await setDefault(LG);
   write('state.json',{...status(),enabled:true,phase:'active',startedAt:now(),normalClosed:false});
   if(launch)await luna('com.webos.applicationManager/launch',{id:LG});
   return {ok:true,enabled:true};
  }catch(e){try{await disable('Activation failed: '+e.message);}catch{}throw e;}
 }
 async function disable(reason=null,{keepEnabled=false,launch='ifHome'}={}){
  let foreground=null;try{foreground=(await luna('com.webos.applicationManager/getForegroundAppInfo',{})).appId;}catch{}
  const saved=status();write('state.json',{...saved,enabled:keepEnabled,phase:keepEnabled?'escaped':'off',failure:reason});
  if(mounted()){
   try{await run('/bin/umount',[appDir],{timeout:4000});}catch{await run('/bin/umount',['-l',appDir],{timeout:4000});}
   if(mounted())throw Error('Could not unmount Own TV Home.');
  }
  const stock=read('stock-manifest.json',null);
  if(stock){await reread(stock.type);try{await luna('com.palm.webappmanager/killApp',{appId:LG});}catch{}}
  if(typeof saved.preload==='boolean')try{await luna('com.webos.service.preloadmanager/setPreloadPolicy',{application:{id:LG,isEnabled:saved.preload}});}catch{}
  await setDefault(keepEnabled?LG:APP);
  if(launch===true||launch==='ifHome'&&[LG,APP].includes(foreground))await luna('com.webos.applicationManager/launch',{id:LG});
  return {ok:true,enabled:keepEnabled};
 }
 async function guard(foreground,power){
  if(!status().enabled||!mounted())return;
  stopFlutter();
  const saved=status(),lastBeat=read('heartbeat.json',{}).at||0;
  if(saved.phase==='preparing'&&now()-saved.startedAt>60000)return disable('Home activation was interrupted. LG Home restored.');
  if(foreground===LG&&power==='Active'&&lastBeat>=saved.startedAt&&!saved.normalClosed){
   try{await luna('com.palm.webappmanager/killApp',{appId:APP});}catch{}
   const current=status();if(current.enabled&&current.startedAt===saved.startedAt)write('state.json',{...current,normalClosed:true});
  }
  if(heartbeatExpired({foreground,power,startedAt:saved.startedAt,lastBeat,now:now()}))await disable('Dashboard heartbeat was lost. LG Home restored.');
 }
 async function refresh(){
  if(!status().enabled||!mounted())return {ok:true,refreshed:false};
  prepare();const foreground=await luna('com.webos.applicationManager/getForegroundAppInfo',{});
  write('state.json',{...status(),startedAt:now(),normalClosed:false});
  await luna('com.palm.webappmanager/killApp',{appId:LG});
  if(foreground.appId===LG)await luna('com.webos.applicationManager/launch',{id:LG});
  return {ok:true,refreshed:true};
 }
 async function escape({launch=true}={}){fs.writeFileSync(path.join(root,'allow-stock-until'),String(now()+120000),{mode:0o600});return disable(null,{keepEnabled:true,launch});}
 return {status,mounted,token,heartbeat,prepare,enable,disable,guard,escape,stopFlutter,refresh};
}
module.exports={createHomeReplacement,isLgFlutter,heartbeatExpired,LG,APP};
