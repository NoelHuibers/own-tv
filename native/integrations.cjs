'use strict';
function validateIntegrations(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid integrations');
 const out={};
 if(input.weather){const w=input.weather;if(!Number.isFinite(w.latitude)||!Number.isFinite(w.longitude)||Math.abs(w.latitude)>90||Math.abs(w.longitude)>180)throw new Error('Invalid weather coordinates');out.weather={latitude:w.latitude,longitude:w.longitude,label:String(w.label||'Local weather').slice(0,80)};}
 if(input.calendar){out.calendar={feedUrl:require('./calendar-feed.cjs').feedUrl(input.calendar.feedUrl),busyOnly:input.calendar.busyOnly!==false};}
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
  const append=(start,end,title,allDay)=>{if(end.getTime()>=lower&&start.getTime()<upper)events.push({title:busyOnly?'Busy':String(title||'Event').slice(0,180),start:start.toISOString(),end:end.toISOString(),allDay:!!allDay});};
  if(!event.isRecurring()){append(event.startDate.toJSDate(),event.endDate.toJSDate(),event.summary,event.startDate.isDate);continue;}
  const it=event.iterator();let occurrence,count=0;
  while((occurrence=it.next())&&count++<20000){if(occurrence.toJSDate().getTime()>=upper)break;const d=event.getOccurrenceDetails(occurrence);if(d.item.component.getFirstPropertyValue('status')==='CANCELLED')continue;append(d.startDate.toJSDate(),d.endDate.toJSDate(),d.item.summary,d.startDate.isDate);if(events.length>=100)break;}
 }
 return events.sort((a,b)=>a.start.localeCompare(b.start)).slice(0,30);
}
module.exports={expandCalendar,validateIntegrations};
