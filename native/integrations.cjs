'use strict';
function validateIntegrations(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid integrations');
 const out={};
 if(input.weather){const w=input.weather;if(!Number.isFinite(w.latitude)||!Number.isFinite(w.longitude)||Math.abs(w.latitude)>90||Math.abs(w.longitude)>180)throw new Error('Invalid weather coordinates');out.weather={latitude:w.latitude,longitude:w.longitude,label:String(w.label||'Local weather').slice(0,80)};}
 if(input.calendar){
  const c=input.calendar,parse=require('./calendar-feed.cjs').feedUrl;
  if(c.feeds!==undefined){
   if(!Array.isArray(c.feeds)||!c.feeds.length||c.feeds.length>16)throw Error('Use 1–16 calendar subscriptions.');
   const seen=new Set(),feeds=[];
   for(const [i,f] of c.feeds.entries()){
    if(!f||typeof f!=='object')throw Error('Invalid calendar subscription');
    const url=parse(f.feedUrl),label=String(f.label||'Calendar '+(i+1)).replace(/[\u0000-\u001f\u007f]/g,'').trim();
    if(label.length>60||/https?:|webcal:|[A-Za-z0-9_-]{40,}/i.test(label))throw Error('Use a short calendar name without a subscription link.');
    const catalogId=f.catalogId&&require('./holiday-catalog.json').calendars.find(c=>c.id===f.catalogId&&c.url===url)?.id;
    if(!seen.has(url)){seen.add(url);feeds.push({feedUrl:url,label,enabled:f.enabled!==false,...(catalogId?{catalogId}:{})});}
   }
   out.calendar={feeds,busyOnly:c.busyOnly!==false};
  }else out.calendar={feedUrl:parse(c.feedUrl),busyOnly:c.busyOnly!==false};
 }
 return out;
}
function expandCalendar(text, now=new Date(), days=14,busyOnly=true){
 const ICAL=require('ical.js');
 const root=new ICAL.Component(ICAL.parse(text));
 for(const zone of root.getAllSubcomponents('vtimezone')){const id=zone.getFirstPropertyValue('tzid');if(id)ICAL.TimezoneService.register(id,new ICAL.Timezone(zone));}
 const lower=now.getTime(),upper=lower+days*86400000,events=[];
 const components=root.getAllSubcomponents('vevent');
 const exceptions=components.filter(c=>c.hasProperty('recurrence-id')).map(c=>new ICAL.Event(c));
 for(const comp of components){if(comp.hasProperty('recurrence-id'))continue;const event=new ICAL.Event(comp,{exceptions:exceptions.filter(e=>e.uid===comp.getFirstPropertyValue('uid'))});if(event.component.getFirstPropertyValue('status')==='CANCELLED')continue;
  const append=(start,end,title,allDay,startDate,endDate)=>{if(end.getTime()>=lower&&start.getTime()<upper)events.push({title:busyOnly?'Busy':String(title||'Event').slice(0,180),start:allDay?startDate:start.toISOString(),end:allDay?endDate:end.toISOString(),allDay:!!allDay});};
  if(!event.isRecurring()){append(event.startDate.toJSDate(),event.endDate.toJSDate(),event.summary,event.startDate.isDate,event.startDate.toString(),event.endDate.toString());continue;}
  const it=event.iterator();let occurrence,count=0;
  // biome-ignore lint/suspicious/noAssignInExpressions: ical.js iterators signal the end with a null occurrence
  while((occurrence=it.next())&&count++<20000){if(occurrence.toJSDate().getTime()>=upper)break;const d=event.getOccurrenceDetails(occurrence);if(d.item.component.getFirstPropertyValue('status')==='CANCELLED')continue;append(d.startDate.toJSDate(),d.endDate.toJSDate(),d.item.summary,d.startDate.isDate,d.startDate.toString(),d.endDate.toString());if(events.length>=100)break;}
 }
 return events.sort((a,b)=>a.start.localeCompare(b.start)).slice(0,30);
}
module.exports={expandCalendar,validateIntegrations};
