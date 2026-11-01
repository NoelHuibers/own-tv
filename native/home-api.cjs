'use strict';
const http=require('node:http'),{timingSafeEqual}=require('node:crypto');
const ACTIONS=new Set(['state','launch','sleep','screenOff','lgHome','settings','preferences','configure','weather','firmwareCheck','releaseIdleApps','memoryMode','weatherSearch','weatherDetails','radar','weatherSource','calendarCatalog','calendarSource','directHome','homeHeartbeat','homePing']);
const PORT=18766;
function createHomeApi({token,main,heartbeat,port=PORT}){
 let pending=0;
 const server=http.createServer((req,res)=>{
  const origin=req.headers.origin,host=req.headers.host;
  function reply(status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...(origin==='null'?{'Access-Control-Allow-Origin':'null','Vary':'Origin'}:{})});res.end(JSON.stringify(data));}
  if(host!=='127.0.0.1:'+(server.address()?.port||port)||origin!==undefined&&origin!=='null')return reply(403,{ok:false,error:'Untrusted origin'});
  if(req.url!=='/action')return reply(404,{ok:false,error:'Not found'});
  if(req.method==='OPTIONS'){
   const requested=String(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
   if(origin!=='null'||req.headers['access-control-request-method']!=='POST'||requested.some(h=>!['authorization','content-type'].includes(h)))return reply(403,{ok:false});
   res.writeHead(204,{'Access-Control-Allow-Origin':'null','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Private-Network':'true','Vary':'Origin','Cache-Control':'no-store'});return res.end();
  }
  const actual=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from('Bearer '+token());
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return reply(401,{ok:false,error:'Unauthorized'});
  if(req.method!=='POST'||req.headers['content-type']!=='application/json')return reply(400,{ok:false,error:'JSON POST required'});
  if(pending>=8)return reply(429,{ok:false,error:'Try again shortly'});
  pending++;let size=0,body='',rejected=false,finished=false;function finish(){if(!finished){finished=true;pending--;}}
  req.on('data',chunk=>{size+=chunk.length;if(size>65536){if(!rejected){rejected=true;reply(413,{ok:false,error:'Request too large'});}return;}body+=chunk;});
  req.on('end',async()=>{try{
   if(rejected)return;
   const data=JSON.parse(body);if(!data||!ACTIONS.has(data.action))return reply(400,{ok:false,error:'Unknown action'});
   if(data.action==='homeHeartbeat'){heartbeat(data.value);return reply(200,{ok:true});}
   if(data.action==='homePing')return reply(200,{ok:true,service:'own-tv-home'});
   reply(200,await main(data.action,data.value));
  }catch(e){reply(400,{ok:false,error:e instanceof SyntaxError?'Invalid JSON':e.message||'TV operation failed'});}finally{finish();}});
  req.on('error',finish);req.on('aborted',finish);
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 return server;
}
module.exports={createHomeApi,PORT};
