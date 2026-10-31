'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {feedUrl,publicAddress,resolvePublic}=require('../native/calendar-feed.cjs');
test('calendar subscriptions accept normal providers and normalize webcal to HTTPS',()=>{
 for(const u of ['https://calendar.google.com/calendar/ical/sample/private-token/basic.ics','https://calendar.proton.me/api/calendar/v1/url/sample/calendar.ics','https://outlook.live.com/owa/calendar/sample/calendar.ics','https://calendar.example.com/feed.ics'])assert.equal(feedUrl(u),u);
 assert.equal(feedUrl('webcal://p01-caldav.icloud.com/published/2/sample'),'https://p01-caldav.icloud.com/published/2/sample');
 for(const u of ['http://calendar.example.com/feed.ics','https://user:pass@calendar.example.com/feed.ics','https://127.0.0.1/feed','https://[::1]/feed','https://calendar.local/feed','https://calendar.example.com:8443/feed','https://calendar.example.com/'])assert.throws(()=>feedUrl(u));
});
test('calendar DNS blocks private, mixed and reserved routes before any connection',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.20.1.1','192.168.1.1','100.64.1.1','198.18.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','fd00::1','fe80::1','2001:db8::1','2001::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
 await assert.rejects(resolvePublic('calendar.example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/public/);
 const entries=[{address:'8.8.8.8',family:4}];assert.deepEqual(await resolvePublic('calendar.example.com',async()=>entries),entries);
});
