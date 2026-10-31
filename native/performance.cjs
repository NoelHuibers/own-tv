'use strict';
function parseMemory(text){
 const m={};for(const line of text.split('\n')){const match=line.match(/^(\w+):\s+(\d+)\s+kB$/);if(match)m[match[1]]=Number(match[2]);}
 if(!m.MemTotal||!Number.isFinite(m.MemAvailable))return {};
 return {memoryUsedPercent:Math.round((m.MemTotal-m.MemAvailable)*100/m.MemTotal),memoryAvailableMB:Math.round(m.MemAvailable/1024),memoryTotalMB:Math.round(m.MemTotal/1024),memoryCachedMB:Math.round((m.Cached||0)/1024),swapUsedMB:Math.round(((m.SwapTotal||0)-(m.SwapFree||0))/1024)};
}
// Deliberately excludes Spotify, inputs, Home, the screensaver and all services.
const VIDEO_APPS=new Set(['youtube.leanback.v4','netflix','amazon','com.disney.disneyplus-prod','com.netrtl.tvnow','com.webos.app.lgchannels']);
async function releaseIdleApps(luna){
 const allowedForeground=new Set(['io.github.noelhuibers.owntv','com.webos.app.screensaver']);
 const foreground=await luna('com.webos.applicationManager/getForegroundAppInfo',{});
 if(!allowedForeground.has(foreground.appId))throw Error('Open Own TV on the TV before releasing idle apps.');
 const running=await luna('com.webos.applicationManager/running',{}),closed=[],failed=[];
 for(const app of running.running||[]){
  if(!VIDEO_APPS.has(app.id))continue;
  // Stop if the viewer changes apps while this operation is in progress.
  const current=await luna('com.webos.applicationManager/getForegroundAppInfo',{});
  if(!allowedForeground.has(current.appId))break;
  try{await luna('com.webos.applicationManager/closeByAppId',{id:app.id});closed.push(app.id);}catch{failed.push(app.id);}
 }
 return {ok:true,closed,failed};
}
const PRELOAD_APPS=new Set(['youtube.leanback.v4','netflix','amazon','com.webos.app.lgchannels']);
async function applyPreload(luna,settings,restore=false){
 const policy=await luna('com.webos.service.preloadmanager/getPreloadPolicy',{});
 if(!Array.isArray(policy.applications))throw Error('This TV does not expose preload policies.');
 const before=settings.before||{};let matched=0;
 for(const app of policy.applications){
  if(!PRELOAD_APPS.has(app.id)||typeof app.isEnabled!=='boolean')continue;
  matched++;
  if(!(app.id in before))before[app.id]=app.isEnabled;
  const enabled=restore?before[app.id]:false;
  if(app.isEnabled!==enabled)await luna('com.webos.service.preloadmanager/setPreloadPolicy',{application:{id:app.id,isEnabled:enabled}});
 }
 if(!matched)throw Error('Video preload policies are not ready yet.');
 return {enabled:!restore,before};
}
module.exports={parseMemory,releaseIdleApps,applyPreload};
