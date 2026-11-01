#!/usr/bin/env node
'use strict';
// Extract only the repository's static UI text. Never reads device configuration.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'app/app.js'),'utf8'),weather=fs.readFileSync(path.join(root,'app/weather-view.js'),'utf8');
const start=app.indexOf('var STRINGS = ')+14,end=app.indexOf('\n  function t(',start),literal=app.slice(start,end).trim().replace(/;$/,'');
const strings={...vm.runInNewContext('('+literal+')').en};
const context={window:{}};vm.runInNewContext(weather,context);
for(const [key,value]of Object.entries(context.window.OwnTVWeather.strings))strings['weather:'+key]=value;
const pair=/\b(?:calText|text)\(('(?:[^'\\]|\\.)*')\s*,\s*('(?:[^'\\]|\\.)*')/g;
for(const source of [app,weather])for(const match of source.matchAll(pair)){const english=vm.runInNewContext(match[1]);strings['text:'+english]=english;}
for(const key of Object.keys(strings))strings[key]=strings[key].replace(/<[^>]+>/g,'');
const pack={kind:'own-tv-language',schema:1,locale:process.argv[2]||'und',name:process.argv[3]||'Translation template',strings};
require('../app/i18n.js').validatePack(pack);
process.stdout.write(JSON.stringify(pack,null,2)+'\n');
