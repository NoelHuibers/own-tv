'use strict';
const {createHash}=require('node:crypto');
const {expandCalendar}=require('./integrations.cjs');
const {sourceId,feedsOf}=require('./calendar-settings.cjs');
// Every feed fails independently; old entries are never used after a privacy-mode change.
async function collectAgenda(calendar,cached={},fetchFeed,now=Date.now()){
 if(!calendar)return {calendar:{configured:false,events:[]},cache:{schema:2,entries:{}}};
 const feeds=feedsOf(calendar),entries={},events=[],sources=[];
 let next=0;
 async function worker(){
  while(next<feeds.length){const index=next++,feed=feeds[index],busyOnly=calendar.busyOnly!==false&&!feed.catalogId,key=createHash('sha256').update(String(busyOnly)+'\n'+feed.feedUrl).digest('hex');
   const source={id:sourceId(feed),name:feed.label||'Calendar',enabled:feed.enabled!==false,catalogId:feed.catalogId||null};
   if(feed.enabled===false){sources[index]={...source,connected:false,stale:false,updatedAt:null};continue;}
   const old=cached.schema===2?cached.entries?.[key]:null;let item=old,error=false,stale=false;
   if(!old||now-old.at>=15*60*1000){
    try{item={at:now,events:expandCalendar(await fetchFeed(feed.feedUrl),new Date(now),14,busyOnly)};}
    catch{error=true;stale=!!old;}
   }
   if(item){entries[key]=item;for(const event of item.events)if(Date.parse(event.end)>now)events.push({...event,calendar:feed.label||'Calendar'});}
   sources[index]={...source,connected:!error,stale,updatedAt:item?.at??null};
  }
 }
 await Promise.all(Array.from({length:Math.min(4,feeds.length)},worker));
 const active=sources.filter(s=>s.enabled),failures=active.filter(s=>!s.connected).length;
 const updated=sources.map(s=>s.updatedAt).filter(Number.isFinite);
 return {calendar:{configured:feeds.length>0,busyOnly:calendar.busyOnly!==false,events:events.sort((a,b)=>a.start.localeCompare(b.start)).slice(0,100),sources,sourceCount:feeds.length,activeSources:active.length,failedSources:failures,partial:failures>0,error:active.length>0&&failures===active.length&&!events.length,updatedAt:updated.length?Math.min(...updated):null},cache:{schema:2,entries}};
}
module.exports={collectAgenda};
