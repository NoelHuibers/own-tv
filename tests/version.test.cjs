'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),json=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
test('the app and its package carry one release version',()=>{
 const version=json('package.json').version;
 assert.match(version,/^\d+\.\d+\.\d+$/);
 assert.equal(json('app/appinfo.json').version,version,'app/appinfo.json');
 const shown=/var VERSION = '([^']+)';/.exec(fs.readFileSync(path.join(root,'app/app.js'),'utf8'));
 assert.ok(shown,'app.js declares VERSION');assert.equal(shown[1],version,'app/app.js VERSION');
});
test('the TV runtime ships no development dependencies',()=>{
 assert.deepEqual(Object.keys(json('package.json').dependencies),['ical.js']);
});
