/* Offline language packs. Text only: no scripts, markup, fonts or remote loads. */
(function(root){
 'use strict';
 function locale(value){
  if(typeof value!=='string'||value.length>64)return null;
  try{return Intl.getCanonicalLocales(value.trim().replace(/_/g,'-'))[0]||null;}catch{return null;}
 }
 function matches(pack,language){return !!pack&&(pack.locale===language||pack.locale.indexOf('-')<0&&pack.locale===language.split('-')[0]);}
 function direction(language){
  try{var script=new Intl.Locale(language).maximize().script;return /^(Arab|Hebr|Thaa|Nkoo|Adlm|Rohg|Syrc|Samr|Mand)$/.test(script)?'rtl':'ltr';}
  catch{return /^(ar|fa|he|ur|ps|dv|ckb)(-|$)/i.test(language)?'rtl':'ltr';}
 }
 function placeholders(text){return (text.match(/\{\w+\}/g)||[]).sort().join('|');}
 function validatePack(raw,base){
  if(!raw||raw.kind!=='own-tv-language'||raw.schema!==1||!locale(raw.locale)||!raw.strings||typeof raw.strings!=='object'||Array.isArray(raw.strings))throw Error('Use an Own TV language pack (schema 1).');
  var result={kind:'own-tv-language',schema:1,locale:locale(raw.locale),name:String(raw.name||raw.locale).trim(),strings:{}};
  if(!result.name||result.name.length>60||/[<>\u0000-\u001f\u007f]/.test(result.name))throw Error('Use a short, plain language name.');
  var keys=Object.keys(raw.strings);if(keys.length>1200)throw Error('Language pack has too many entries.');
  keys.forEach(function(key){
   var text=raw.strings[key];
   if(key==='__proto__'||key==='constructor'||key==='prototype'||key.length>1000||typeof text!=='string'||text.length>2400||/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))throw Error('Language packs must contain plain text only.');
   if(base&&(!Object.hasOwn(base,key)||placeholders(text)!==placeholders(base[key])))throw Error('Unknown key or changed placeholders: '+key.slice(0,70));
   if(text.trim())result.strings[key]=text;
  });
  if(JSON.stringify(result).length>48000)throw Error('Language pack is too large (48,000 characters maximum).');
  return result;
 }
 function translate(pack,language,key,fallback){return matches(pack,language)&&Object.hasOwn(pack.strings,key)?pack.strings[key]:fallback;}
 var api={locale:locale,direction:direction,matches:matches,validatePack:validatePack,translate:translate};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.OwnTVI18n=api;
})(typeof window!=='undefined'?window:globalThis);
