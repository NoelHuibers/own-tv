'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHomeReplacement,isLgFlutter,heartbeatExpired}=require('../native/home-replacement.cjs');
test('only LG Home Flutter is stopped; standby, other apps and cold loading do not trip recovery',()=>{
 assert.ok(isLgFlutter(['/usr/bin/flutter-client','-i','com.webos.app.home']));
 for(const argv of [['/usr/bin/flutter-client','-i','com.webos.app.screensaver'],['/usr/bin/flutter-client','-i','com.webos.app.homeconnect'],['/bin/sh','flutter-client','-i','com.webos.app.home']])assert.equal(isLgFlutter(argv),false);
 const state={foreground:'com.webos.app.home',power:'Active',startedAt:100000,lastBeat:0,now:159000};assert.equal(heartbeatExpired(state),false);assert.equal(heartbeatExpired({...state,now:161000}),true);
 assert.equal(heartbeatExpired({...state,now:200000,power:'Active Standby'}),false);assert.equal(heartbeatExpired({...state,now:200000,foreground:'netflix'}),false);assert.equal(heartbeatExpired({...state,lastBeat:155000,now:180000}),false);
});
test('failed registration unmounts and restores Home without restarting SAM',async(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'own-home-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'source'),appDir=path.join(dir,'stock'),schemaFile=path.join(dir,'schema.json'),procDir=path.join(dir,'proc');for(const p of [source,appDir,procDir])fs.mkdirSync(p);
 fs.writeFileSync(path.join(source,'appinfo.json'),JSON.stringify({id:'io.github.noelhuibers.owntv',type:'web'}));fs.writeFileSync(path.join(source,'index.html'),'<meta content="connect-src \'self\';"><script src="bridge.js"></script>');
 fs.writeFileSync(path.join(appDir,'appinfo.json'),JSON.stringify({id:'com.webos.app.home',type:'flutter'}));fs.writeFileSync(schemaFile,'{"forceBlockSystemApp":true}');
 let mounted=false,rejectBlock=true;const calls=[],commands=[];
 const home=createHomeReplacement({root:dir,source,appDir,schemaFile,procDir,assetGroup:process.getgid(),isMounted:()=>mounted,ping:async()=>{},run:async(file,args)=>{commands.push([file,args]);if(file==='/bin/mount')mounted=true;if(file==='/bin/umount')mounted=false;},luna:async(uri,p)=>{
  calls.push([uri,p]);if(uri.endsWith('/blockSystemApp')&&rejectBlock){rejectBlock=false;throw Error('registration refused');}
  if(uri.endsWith('/getAppInfo'))return {appInfo:{type:mounted?'web':'flutter',appCategory:['home']}};
  if(uri.endsWith('/getSystemSettings'))return {settings:{defaultApps:{home:'original',browser:'browser'}}};
  if(uri.endsWith('/getForegroundAppInfo'))return {appId:'youtube.leanback.v4'};
  if(uri.endsWith('/getPreloadPolicy'))return {applications:[{id:'com.webos.app.home',isEnabled:true}]};return {returnValue:true};
 }});
 await assert.rejects(home.enable(),/registration refused/);assert.equal(mounted,false);assert.equal(home.status().enabled,false);assert.ok(calls.filter(c=>c[0].endsWith('/releaseBlockSystemApp')).length>=2);
 assert.ok(commands.every(c=>['/bin/mount','/bin/umount'].includes(c[0])));assert.ok(calls.filter(c=>c[0].endsWith('/setSystemSettings')).every(c=>c[1].settings.defaultApps.browser==='browser'));
 await home.enable();assert.equal(mounted,true);assert.equal(home.status().enabled,true);
 const stage=path.join(dir,'home-system/app');assert.equal(JSON.parse(fs.readFileSync(path.join(stage,'appinfo.json'))).id,'com.webos.app.home');assert.ok(fs.readFileSync(path.join(stage,'index.html'),'utf8').includes('http://127.0.0.1:18766'));assert.equal(fs.statSync(path.join(stage,'home-runtime.js')).mode&0o777,0o640);assert.equal(fs.statSync(path.join(dir,'home-system/token.json')).mode&0o777,0o600);
 const launches=calls.filter(c=>c[0].endsWith('/launch')).length;
 await home.refresh();assert.equal(calls.filter(c=>c[0].endsWith('/launch')).length,launches);
 await home.disable();assert.equal(mounted,false);assert.equal(home.status().enabled,false);assert.equal(calls.filter(c=>c[0].endsWith('/launch')).length,launches);
});
