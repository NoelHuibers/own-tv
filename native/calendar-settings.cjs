'use strict';
const {createHash}=require('node:crypto');
const catalog=require('./holiday-catalog.json');
function sourceId(feed){return createHash('sha256').update(feed.feedUrl).digest('hex').slice(0,24);}
function feedsOf(calendar){return calendar?.feeds|| (calendar?.feedUrl?[{feedUrl:calendar.feedUrl,label:'Calendar'}]:[]);}
function publicCatalog(calendar){
 const feeds=feedsOf(calendar);
 return {provider:catalog.provider,source:catalog.source,coverage:catalog.coverage,calendars:catalog.calendars.map(c=>({id:c.id,name:c.name,selected:feeds.some(f=>f.catalogId===c.id&&f.enabled!==false)}))};
}
function changeCalendar(calendar,change){
 if(!change||typeof change.enabled!=='boolean')throw Error('Choose a calendar and whether to show it.');
 let feeds=feedsOf(calendar).map(f=>({...f}));
 if(change.publicId){
  const item=catalog.calendars.find(c=>c.id===change.publicId);if(!item)throw Error('Unknown public calendar.');
  feeds=feeds.filter(f=>f.catalogId!==item.id);
  if(change.enabled){if(feeds.length>=16)throw Error('You can connect up to 16 calendars. Remove one before adding another.');feeds.push({feedUrl:item.url,label:item.name+' holidays',catalogId:item.id,enabled:true});}
 }else{
  const item=feeds.find(f=>sourceId(f)===change.id);if(!item)throw Error('Calendar no longer exists. Refresh and retry.');item.enabled=change.enabled;
 }
 return {...calendar,feeds,busyOnly:calendar?.busyOnly!==false};
}
module.exports={sourceId,feedsOf,publicCatalog,changeCalendar};
