'use strict';
const https=require('node:https'),dns=require('node:dns'),net=require('node:net');
function publicAddress(address){
 const family=net.isIP(address);
 if(family===4){const p=address.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&(p[1]===168||p[1]===0||(p[1]===88&&p[2]===99)))||(p[0]===198&&(p[1]===18||p[1]===19||(p[1]===51&&p[2]===100)))||(p[0]===203&&p[1]===0&&p[2]===113));}
 if(family===6){const n=new URL('http://['+address+']/').hostname.slice(1,-1);return /^[23]/.test(n)&&!/^2001:(?:0*:|db8:|10:|20:)/i.test(n)&&!n.startsWith('2002:');}
 return false;
}
function feedUrl(value){
 let u;try{if(typeof value!=='string'||value.length>8192)throw Error();u=new URL(value.trim().replace(/^webcal:\/\//i,'https://'));}catch{throw Error('Enter a calendar subscription link (HTTPS or webcal).');}
 const host=u.hostname.replace(/^\[|\]$/g,'');
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!host.includes('.')&&!net.isIP(host)||/(^|\.)(localhost|local|internal|home|lan)$/.test(host)||(net.isIP(host)&&!publicAddress(host)))throw Error('Use a public HTTPS calendar feed, without a login or custom port.');
 if(u.pathname==='/'&&!u.search)throw Error('Use the calendar subscription link, not the calendar website.');
 return u.href;
}
async function resolvePublic(host,resolver=dns.promises.lookup){
 const entries=net.isIP(host)?[{address:host,family:net.isIP(host)}]:await resolver(host,{all:true,verbatim:true});
 if(!entries.length||entries.some(e=>!publicAddress(e.address)))throw Error('Calendar host must resolve to a public internet address.');
 return entries;
}
async function fetchCalendar(value,redirects=0,expiresAt=Date.now()+15000){
 if(Date.now()>=expiresAt)throw Error('Calendar provider timed out.');
 const u=new URL(feedUrl(value)),host=u.hostname.replace(/^\[|\]$/g,'');
 let timer;const entries=await Promise.race([resolvePublic(host),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Calendar DNS timed out.')),Math.min(10000,Math.max(1,expiresAt-Date.now())));})]).finally(()=>clearTimeout(timer));
 return new Promise((resolve,reject)=>{
  // Answer asynchronously: on Node 20 a synchronous answer lets an immediate
  // connect error (ENETUNREACH while waking from standby) reach the socket
  // before the request listens, crashing the whole Home router.
  const lookup=(_,options,cb)=>setImmediate(()=>options.all?cb(null,entries):cb(null,entries[0].address,entries[0].family));
  const req=https.get(u,{lookup,timeout:15000,headers:{Accept:'text/calendar'}},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){
    res.resume();if(redirects>=3||!res.headers.location)return reject(Error('Calendar redirects could not be followed.'));
    let next;try{next=new URL(res.headers.location,u).href;}catch{return reject(Error('Invalid calendar redirect.'));}
    // Validate and pin DNS separately for every redirect, without forwarding credentials.
    resolve(fetchCalendar(next,redirects+1,expiresAt));return;
   }
   if(res.statusCode!==200){res.resume();return reject(Error('Calendar provider returned HTTP '+res.statusCode));}
   const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>2000000)req.destroy(Error('Calendar feed is too large.'));else chunks.push(chunk);});
   res.on('error',()=>reject(Error('Calendar connection failed.')));
   res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');if(!/^\s*BEGIN:VCALENDAR\b/.test(text))return reject(Error('This link did not return an ICS calendar.'));resolve(text);});
  });
  const deadline=setTimeout(()=>req.destroy(Error('Calendar download timed out.')),Math.max(1,expiresAt-Date.now()));req.on('close',()=>clearTimeout(deadline));
  req.on('timeout',()=>req.destroy(Error('Calendar provider timed out.')));req.on('error',()=>reject(Error('Calendar connection failed.')));
 });
}
module.exports={feedUrl,publicAddress,resolvePublic,fetchCalendar};
