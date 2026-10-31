'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('saving or disconnecting a calendar preserves weather, and vice versa',async(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'own-tv-config-'));process.env.OWN_TV_DATA=dir;
 t.after(()=>{delete process.env.OWN_TV_DATA;fs.rmSync(dir,{recursive:true,force:true});});
 const {main}=require('../native/helper.cjs');
 const weather={latitude:10,longitude:20,label:'Sample city'};
 await main('configure',{weather});
 await main('configure',{calendar:{feedUrl:'https://calendar.example.com/feed.ics'}});
 let config=JSON.parse(fs.readFileSync(path.join(dir,'integrations.json')));assert.deepEqual(config.weather,weather);assert.equal(config.calendar.busyOnly,true);
 await main('configure',{calendar:null});config=JSON.parse(fs.readFileSync(path.join(dir,'integrations.json')));assert.deepEqual(config.weather,weather);assert.equal(config.calendar,undefined);
 await main('configure',{calendar:{feedUrl:'webcal://calendar.example.com/feed.ics'}});await main('configure',{weather:null});
 config=JSON.parse(fs.readFileSync(path.join(dir,'integrations.json')));assert.equal(config.weather,undefined);assert.equal(config.calendar.feedUrl,'https://calendar.example.com/feed.ics');
});
