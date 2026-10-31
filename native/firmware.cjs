'use strict';
// Compatibility evidence is not a firmware flasher or a promise of zero risk.
const REQUIRED=['rootPersistence','homebrew','launcher','privacy','ssh','oledProtection','streamingPlayback'];
function version(v){return typeof v==='string'&&/^\d{2}\.\d{2}\.\d{2}$/.test(v)?v.split('.').map(Number):null;}
function newer(a,b){const x=version(a),y=version(b);if(!x||!y)return false;for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
function evaluate(current,catalog,now=new Date()){
 const base={currentFirmware:current.firmware,model:current.model,eligible:false,installable:false,availableOnLg:null,status:'unverified',message:'No verified compatible upgrade for this complete setup.',requiredChecks:REQUIRED};
 if(!catalog||catalog.schema!==1||!Array.isArray(catalog.records))return {...base,message:'Compatibility catalogue unavailable or invalid.'};
 const records=catalog.records.filter(r=>r&&r.verified===true&&r.model===current.model&&r.country===current.country&&r.otaid===current.otaid&&r.fromFirmware===current.firmware&&newer(r.targetFirmware,current.firmware));
 for(const r of records){
  if(!current.otaid||!current.country)continue;
  const expiry=Date.parse(r.validUntil);if(!Number.isFinite(expiry)||expiry<now.getTime())continue;
  if(!r.components||!['homebrew','ownTv','glasshouse'].every(k=>typeof current.components?.[k]==='string'&&current.components[k]===r.components[k]))continue;
  if(!r.checks||!REQUIRED.every(k=>r.checks[k]===true))continue;
  if(!Array.isArray(r.evidence)||!r.evidence.length||!r.evidence.every(u=>typeof u==='string'&&/^https:\/\//.test(u)))continue;
  if(!Array.isArray(current.apps)||!current.apps.length||!r.apps||!current.apps.every(a=>r.apps[a.id]?.working===true&&r.apps[a.id]?.version===a.version))continue;
  return {...base,eligible:true,status:'verified-report',targetFirmware:r.targetFirmware,evidence:r.evidence,message:'A matching compatibility report exists. Automatic installation is not implemented; LG availability and final preflight still need verification.'};
 }
 return base;
}
module.exports={evaluate,newer,REQUIRED};
