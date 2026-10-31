(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.OwnTVWeatherMap=factory();}(typeof window!=='undefined'?window:this,function(){
 'use strict';
 function project(lat,lon,zoom){var size=256*Math.pow(2,zoom),sin=Math.sin(Math.max(-85,Math.min(85,lat))*Math.PI/180);return {x:(lon+180)/360*size,y:(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*size};}
 function unproject(p,zoom){var size=256*Math.pow(2,zoom);return {longitude:((p.x/size*360)%360+360)%360-180,latitude:Math.max(-80,Math.min(80,Math.atan(Math.sinh(Math.PI*(1-2*p.y/size)))*180/Math.PI))};}
 function tileUrl(center,zoom,path,coverage){
  if(!center||!Number.isFinite(center.latitude)||!Number.isFinite(center.longitude)||Math.abs(center.latitude)>85||Math.abs(center.longitude)>180||!Number.isInteger(zoom)||zoom<4||zoom>7)throw Error('Invalid radar coordinates');
  if(coverage?path!=='/v2/coverage/0':!/^\/v2\/radar\/[a-zA-Z0-9_-]{1,80}$/.test(path))throw Error('Invalid radar frame');
  return 'https://tilecache.rainviewer.com'+path+'/512/'+zoom+'/'+center.latitude.toFixed(4)+'/'+center.longitude.toFixed(4)+(coverage?'/0/0_0.png':'/2/1_1.png');
 }
 return {project:project,unproject:unproject,tileUrl:tileUrl};
}));
