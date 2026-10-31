/* Stable app ordering shared by the TV and browser preview. */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OwnTVOrder=api;})(typeof window!=='undefined'?window:this,function(){
 'use strict';
 function recentFirst(items,recent,manual){
  if(manual)return items.slice();
  var ranks=Object.create(null);
  (recent||[]).forEach(function(a,i){if(a&&typeof a.id==='string'&&ranks[a.id]===undefined)ranks[a.id]=i;});
  return items.map(function(a,i){return {app:a,index:i,rank:ranks[a.launchId]===undefined?Infinity:ranks[a.launchId]};}).sort(function(a,b){return a.rank-b.rank||a.index-b.index;}).map(function(a){return a.app;});
 }
 return {recentFirst:recentFirst};
});
