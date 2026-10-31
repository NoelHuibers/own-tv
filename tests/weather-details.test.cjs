'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeWeather,normalizeRadar,forecastUrl}=require('../native/weather.cjs');
const map=require('../app/weather-map.js');
test('detailed forecasts select the next 24 UTC hours and seven days, preserving zero and missing values',()=>{
 const now=Date.parse('2026-11-01T12:30:00Z'),start=Math.floor(now/3600000)*3600;
 const data={current:{temperature_2m:0,weather_code:0,apparent_temperature:-2,relative_humidity_2m:0,wind_speed_10m:0,is_day:1},hourly:{time:Array.from({length:50},(_,i)=>start+(i-10)*3600),temperature_2m:Array(50).fill(0),precipitation_probability:Array(50).fill(0),precipitation:Array(50).fill(0.4)},daily:{time:Array.from({length:8},(_,i)=>start+i*86400),temperature_2m_max:[0],temperature_2m_min:[-2],sunrise:[],sunset:[]}};
 const result=normalizeWeather(data,'Sample city',now,true,now);
 assert.equal(result.hourly.length,24);assert.equal(result.hourly[0].time,start*1000);assert.equal(result.hourly[0].precipitation,.4);assert.equal(result.hourly[0].probability,0);assert.equal(result.daily.length,7);assert.equal(result.daily[0].high,0);assert.equal(result.daily[1].high,null);assert.equal(result.daily[0].sunrise,null);
 assert.equal(normalizeWeather(data,'Sample city',now).hourly,undefined);
 const url=new URL(forecastUrl({latitude:10,longitude:20}));assert.equal(url.hostname,'api.open-meteo.com');assert.equal(url.searchParams.get('forecast_days'),'8');assert.equal(url.searchParams.get('timeformat'),'unixtime');
});
test('radar metadata only accepts the fixed image host and valid past-frame paths',()=>{
 const frame={time:1700000000,path:'/v2/radar/abc123'};
 assert.equal(normalizeRadar({host:'https://tilecache.rainviewer.com',generated:1700000000,radar:{past:[frame,{time:1,path:'/../../etc/passwd'}],nowcast:[{time:1800000000,path:'/v2/radar/future'}]}}).frames.length,1);
 assert.throws(()=>normalizeRadar({host:'https://attacker.invalid',radar:{past:[frame]}}));
 assert.throws(()=>normalizeRadar({host:'https://tilecache.rainviewer.com',radar:{past:[]}}));
});
test('map projection round-trips and panning preserves longitude across the date line',()=>{
 for(const [lat,lon] of [[45.5,9.2],[0,0],[-34,-151],[60,179.9]])for(const z of [4,7]){const p=map.project(lat,lon,z),c=map.unproject(p,z);assert.ok(Math.abs(c.latitude-lat)<1e-9);assert.ok(Math.abs(c.longitude-lon)<1e-9);}
 const p=map.project(0,179.9,7);assert.ok(map.unproject({x:p.x+100,y:p.y},7).longitude<0);
 assert.match(map.tileUrl({latitude:10,longitude:20},7,'/v2/radar/abc',false),/^https:\/\/tilecache\.rainviewer\.com\/v2\/radar\/abc\/512\/7\/10\.0000\/20\.0000/);
 assert.throws(()=>map.tileUrl({latitude:10,longitude:20},8,'/v2/radar/abc',false));assert.throws(()=>map.tileUrl({latitude:10,longitude:20},7,'https://attacker.invalid',false));
});
test('cached daily forecasts roll over at the location midnight, including a 25-hour day',()=>{
 const start=Date.parse('2026-10-24T22:00:00Z')/1000,next=Date.parse('2026-10-25T23:00:00Z')/1000;
 const data={current:{temperature_2m:5,weather_code:3},daily:{time:[start,...Array.from({length:7},(_,i)=>next+i*86400)],temperature_2m_max:Array.from({length:8},(_,i)=>i+10)}};
 const before=normalizeWeather(data,'Sample city',start*1000,true,next*1000-1);assert.equal(before.daily[0].high,10);
 const after=normalizeWeather(data,'Sample city',start*1000,true,next*1000+300000);assert.equal(after.daily[0].high,11);assert.equal(after.daily.length,7);
});
test('weather source links cannot turn the TV browser launcher into an arbitrary URL action',async()=>{
 const {main}=require('../native/helper.cjs');for(const value of ['https://attacker.invalid','__proto__','x;reboot',null])await assert.rejects(main('weatherSource',value),/Unknown weather source/);
});
