const {test}=require('node:test');
const assert=require('node:assert/strict');
const {expandCalendar,validateIntegrations}=require('../native/integrations.cjs');
const {safeApp}=require('../native/helper.cjs');
test('private integration URLs cannot turn into arbitrary outbound requests',()=>{
 for(const url of ['http://calendar.proton.me/api/calendar/x','https://example.com/private.ics','https://calendar.proton.me@127.0.0.1/api/calendar/x','https://calendar.proton.me:8443/api/calendar/x','https://calendar.proton.me/'])assert.throws(()=>validateIntegrations({calendar:{feedUrl:url}}));
 assert.equal(validateIntegrations({calendar:{feedUrl:'https://calendar.proton.me/api/calendar/v1/url/secret/calendar.ics'}}).calendar.busyOnly,true);
 assert.throws(()=>validateIntegrations({weather:{latitude:100,longitude:0}}));
});
test('recurrence exceptions and privacy mode survive calendar expansion',()=>{
 const ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meeting\r\nDTSTART:20261101T100000Z\r\nDTEND:20261101T110000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261102T100000Z\r\nSUMMARY:Private appointment\r\nEND:VEVENT\r\nEND:VCALENDAR';
 const result=expandCalendar(ics,new Date('2026-11-01T00:00:00Z'),7);
 assert.equal(result.length,2);assert.equal(result[0].title,'Busy');assert.ok(!JSON.stringify(result).includes('Private appointment'));
 assert.equal(result[1].start,'2026-11-03T10:00:00.000Z');
 assert.equal(expandCalendar(ics,new Date('2026-11-01T00:00:00Z'),7,false)[0].title,'Private appointment');
});
test('shell-shaped app ids are rejected before any operation',()=>{
 assert.equal(safeApp('youtube.leanback.v4'),true);
 for(const id of ['x;reboot','$(id)','../etc/passwd','a b',''])assert.equal(safeApp(id),false);
});
test('moved recurrence exceptions apply only to their own calendar series',()=>{
 const ics=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:a','DTSTART:20261101T100000Z','DTEND:20261101T110000Z','RRULE:FREQ=DAILY;COUNT=2','SUMMARY:A','END:VEVENT','BEGIN:VEVENT','UID:a','RECURRENCE-ID:20261102T100000Z','DTSTART:20261102T120000Z','DTEND:20261102T130000Z','SUMMARY:Moved A','END:VEVENT','BEGIN:VEVENT','UID:b','DTSTART:20261101T150000Z','DTEND:20261101T160000Z','SUMMARY:B','END:VEVENT','END:VCALENDAR'].join('\r\n');
 const result=expandCalendar(ics,new Date('2026-11-01T00:00:00Z'),7,false);
 assert.equal(result.length,3);assert.equal(result.find(e=>e.title==='Moved A').start,'2026-11-02T12:00:00.000Z');assert.ok(result.some(e=>e.title==='B'));
});
const firmware=require('../native/firmware.cjs');
test('firmware is never approved from a version number or a partial report',()=>{
 const current={model:'TEST',country:'DE',otaid:'TEST_OTA',firmware:'43.21.77',components:{homebrew:'0.7.3',ownTv:'0.1.0',glasshouse:'test'},apps:[{id:'app',version:'1'}]};
 assert.equal(firmware.evaluate(current,{schema:1,records:[]}).eligible,false);
 const record={verified:true,model:'TEST',country:'DE',otaid:'TEST_OTA',fromFirmware:'43.21.77',targetFirmware:'43.21.99',validUntil:'2030-01-01',components:current.components,checks:Object.fromEntries(firmware.REQUIRED.map(k=>[k,true])),evidence:['https://example.org/report'],apps:{app:{version:'1',working:true}}};
 assert.equal(firmware.evaluate(current,{schema:1,records:[record]}).eligible,true);
 assert.equal(firmware.evaluate(current,{schema:1,records:[record]}).installable,false);
 for(const change of [{otaid:'OTHER'},{country:'US'},{checks:{...record.checks,rootPersistence:false}},{components:{...record.components,ownTv:'0.2.0'}},{validUntil:'2020-01-01'},{apps:{app:{version:'2',working:true}}}])assert.equal(firmware.evaluate(current,{schema:1,records:[{...record,...change}]}).eligible,false);
});
