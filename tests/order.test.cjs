const {test}=require('node:test');const assert=require('node:assert/strict');const {recentFirst}=require('../app/order.js');
test('Watch follows most recent use without losing stable order for unplayed apps',()=>{
 const items=[{launchId:'youtube'},{launchId:'netflix'},{launchId:'spotify'}];
 assert.deepEqual(recentFirst(items,[{id:'own-tv'},{id:'spotify'},{id:'netflix'},{id:'spotify'}]).map(x=>x.launchId),['spotify','netflix','youtube']);
 assert.deepEqual(recentFirst(items,[]),items);assert.deepEqual(recentFirst(items,[{id:'spotify'}],true),items);assert.equal(items[0].launchId,'youtube');
});
