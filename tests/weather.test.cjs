'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const solar=require('../app/solar.js');
const {normalizeWeather}=require('../native/weather.cjs');
const {parseMemory}=require('../native/performance.cjs');
test('solar themes respect sunrise, sunset and local-day boundaries, including a 25-hour day',()=>{
 const start=Date.parse('2026-10-24T22:00:00Z'),end=Date.parse('2026-10-25T23:00:00Z');
 const sunrise=Date.parse('2026-10-25T06:45:00Z'),sunset=Date.parse('2026-10-25T16:10:00Z');
 const w={configured:true,updatedAt:start,solar:[{start,end,sunrise,sunset}]};
 assert.equal(solar.theme(w,start),'night');assert.equal(solar.theme(w,sunrise),'day');
 assert.equal(solar.theme(w,sunset-1),'day');assert.equal(solar.theme(w,sunset),'night');
 assert.equal(solar.theme(w,end-1),'night');assert.equal(solar.theme(w,end),null);
 assert.equal(solar.theme({...w,error:true},sunrise),null);
 assert.equal(solar.theme({...w,updatedAt:start-40*3600000},sunrise),null);
 assert.equal(solar.theme({...w,solar:[{start,end,sunrise:null,sunset:null}]},sunrise),null);
 assert.equal(solar.theme(null,sunrise),null);
});
test('provider timestamps remain UTC and malformed or polar sun times do not produce a theme',()=>{
 const data={current:{temperature_2m:0,weather_code:3},timezone:'Europe/Berlin',daily:{time:[100,86500,172900],sunrise:[25000,0],sunset:[65000,0]}};
 const w=normalizeWeather(data,'Sample city',100000);
 assert.equal(w.temperature,0);assert.equal(w.condition,'Overcast');assert.equal(w.solar.length,1);
 assert.deepEqual(w.solar[0],{start:100000,end:86500000,sunrise:25000000,sunset:65000000});
 assert.throws(()=>normalizeWeather({current:{}},'Sample city',100000));
});
test('whole-TV memory uses available RAM, not just unused RAM or a sum of process RSS',()=>{
 const m=parseMemory('MemTotal: 2048000 kB\nMemFree: 10240 kB\nMemAvailable: 409600 kB\nCached: 307200 kB\nSwapTotal: 204800 kB\nSwapFree: 102400 kB\n');
 assert.equal(m.memoryUsedPercent,80);assert.equal(m.memoryAvailableMB,400);assert.equal(m.memoryTotalMB,2000);assert.equal(m.memoryCachedMB,300);assert.equal(m.swapUsedMB,100);
 assert.deepEqual(parseMemory('MemFree: 0 kB'),{});
});
const {releaseIdleApps}=require('../native/performance.cjs');
test('idle-app release preserves Spotify and system apps, and stops if the viewer switches apps',async()=>{
 const closed=[];let reads=0;
 const luna=async(uri,body)=>{
  if(uri.endsWith('/running'))return {running:[{id:'spotify-beehive'},{id:'com.webos.app.home'},{id:'netflix'},{id:'amazon'},{id:'com.webos.app.screensaver'}]};
  if(uri.endsWith('/getForegroundAppInfo'))return {appId:++reads<=2?'io.github.noelhuibers.owntv':'amazon'};
  if(uri.endsWith('/closeByAppId')){closed.push(body.id);return {returnValue:true};}
  throw Error('Unexpected command');
 };
 assert.deepEqual((await releaseIdleApps(luna)).closed,['netflix']);assert.deepEqual(closed,['netflix']);
 await assert.rejects(releaseIdleApps(async()=>({appId:'netflix'})),/Open Own TV/);
});
test('city lookup uses one fixed provider and encodes queries as data',()=>{
 const {searchUrl}=require('../native/weather.cjs');
 const u=new URL(searchUrl('München &count=999'));assert.equal(u.hostname,'geocoding-api.open-meteo.com');assert.equal(u.searchParams.get('name'),'München &count=999');assert.equal(u.searchParams.get('count'),'4');
 for(const q of ['', 'x', 'a\nb', 'x'.repeat(81),null])assert.throws(()=>searchUrl(q));
});
test('memory mode changes only the four video preload policies and restores original choices',async()=>{
 const {applyPreload}=require('../native/performance.cjs');const writes=[];
 const apps=[{id:'netflix',isEnabled:true},{id:'youtube.leanback.v4',isEnabled:false},{id:'com.webos.app.home',isEnabled:true},{id:'com.webos.app.hdmi1',isEnabled:true},{id:'spotify-beehive',isEnabled:true}];
 const luna=async(uri,body)=>{if(uri.endsWith('getPreloadPolicy'))return {applications:apps};writes.push(body.application);apps.find(a=>a.id===body.application.id).isEnabled=body.application.isEnabled;return {returnValue:true};};
 const state=await applyPreload(luna,{});assert.deepEqual(writes,[{id:'netflix',isEnabled:false}]);writes.length=0;
 await applyPreload(luna,state,true);assert.deepEqual(writes,[{id:'netflix',isEnabled:true}]);assert.equal(apps[1].isEnabled,false);
});
