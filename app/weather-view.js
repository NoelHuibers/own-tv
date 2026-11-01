/* Integrated weather UI. Providers and credentials stay behind the fixed bridge. */
(function (root) {
 'use strict';
 var EN={back:'Back',title:'Weather',today:'Today',hours:'24 hours',week:'7 days',radar:'Rain radar',location:'Location',refresh:'Refresh',loading:'Loading weather…',failed:'Weather is unavailable. Try refreshing.',setup:'Choose a city to see your forecast.',retry:'Retry',updated:'Forecast updated',stale:'Showing an older forecast · refresh unavailable',feels:'Feels like',humidity:'Humidity',wind:'Wind',rain:'Rain chance',amount:'Precipitation',sunrise:'Sunrise',sunset:'Sunset',next:'Next hours',day:'Day',high:'High',low:'Low',observations:'Past two hours · observed rain',radarNote:'Radar shows past observations. The hourly forecast shows what may happen next.',radarFailed:'Radar is unavailable. The forecast still works.',radarLoading:'Loading radar…',noCoverage:'Shaded areas have no radar coverage.',play:'Play',pause:'Pause',previous:'Previous frame',nextFrame:'Next frame',zoomIn:'Zoom in',zoomOut:'Zoom out',recenter:'Recenter',pan:'Map · OK enters pan mode, Back returns to controls',mapHelp:'Focus the map and press OK to pan with arrows. Back returns to controls. Use + / − to zoom.',light:'Light',heavy:'Heavy',frame:'Radar frame',old:'Radar data is over 30 minutes old',missing:'Frame unavailable · previous image retained',waiting:'Loading frame…',limits:'Regional radar · zoom up to 7',source:'Forecast: Open-Meteo',sample:'Sample preview · radar network requests are disabled',selected:'Selected day',map:'Radar map',notFound:'No forecast hours available',partial:'Some radar frames could not be loaded',rate:'Radar request limit reached. Wait a moment, then retry.'};
 var DE={back:'Zurück',title:'Wetter',today:'Heute',hours:'24 Stunden',week:'7 Tage',radar:'Regenradar',location:'Ort',refresh:'Aktualisieren',loading:'Wetter wird geladen…',failed:'Wetter nicht verfügbar. Bitte erneut laden.',setup:'Wähle einen Ort für deine Vorhersage.',retry:'Erneut laden',updated:'Vorhersage aktualisiert',stale:'Ältere Vorhersage · Aktualisierung nicht verfügbar',feels:'Gefühlt',humidity:'Luftfeuchte',wind:'Wind',rain:'Regenchance',amount:'Niederschlag',sunrise:'Sonnenaufgang',sunset:'Sonnenuntergang',next:'Nächste Stunden',day:'Tag',high:'Höchstwert',low:'Tiefstwert',observations:'Letzte zwei Stunden · gemessener Regen',radarNote:'Das Radar zeigt vergangene Messungen. Die stündliche Vorhersage zeigt, was als Nächstes passieren könnte.',radarFailed:'Radar nicht verfügbar. Die Vorhersage funktioniert weiterhin.',radarLoading:'Radar wird geladen…',noCoverage:'Schattierte Bereiche haben keine Radarabdeckung.',play:'Abspielen',pause:'Pause',previous:'Vorheriges Bild',nextFrame:'Nächstes Bild',zoomIn:'Vergrößern',zoomOut:'Verkleinern',recenter:'Zentrieren',pan:'Karte · OK aktiviert Verschieben, Zurück beendet',mapHelp:'Karte fokussieren und OK drücken: Pfeile verschieben. Zurück beendet. + / − ändert den Zoom.',light:'Leicht',heavy:'Stark',frame:'Radarbild',old:'Radardaten sind älter als 30 Minuten',missing:'Bild nicht verfügbar · vorheriges Bild bleibt sichtbar',waiting:'Radarbild wird geladen…',limits:'Regionales Radar · Zoom bis 7',source:'Vorhersage: Open-Meteo',sample:'Beispielvorschau · keine Radar-Netzwerkanfragen',selected:'Gewählter Tag',map:'Radarkarte',notFound:'Keine stündliche Vorhersage verfügbar',partial:'Einige Radarbilder konnten nicht geladen werden',rate:'Radar-Anfragelimit erreicht. Kurz warten und erneut versuchen.'};
 function el(tag,attrs,children){var n=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){if(k==='class')n.className=attrs[k];else if(k==='style')Object.keys(attrs[k]).forEach(function(key){n.style.setProperty(key,attrs[k][key]);});else if(k==='text')n.textContent=attrs[k];else if(attrs[k]!==null)n.setAttribute(k,attrs[k]);});[].concat(children||[]).forEach(function(c){if(c!==null&&c!==undefined)n.appendChild(typeof c==='object'?c:document.createTextNode(String(c)));});return n;}
 function svgIcon(name){var s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('class','icon');s.setAttribute('aria-hidden','true');var u=document.createElementNS(s.namespaceURI,'use');u.setAttribute('href','#i-'+name);s.appendChild(u);return s;}
 function iconCode(code,day){if(typeof code!=='number')return 'info';return code===0||code===1?(day===false?'moon':'sun'):code===2||code===3?'cloud':code===45||code===48?'fog':code>=71&&code<=77||code===85||code===86?'snow':code>=95?'storm':code>=51?'rain':'cloud';}
 function create(ctx){
  var host=ctx.host,words=ctx.language.split('-')[0]==='de'?DE:EN,lang=ctx.language==='en'?'en-GB':ctx.language;
  var data=null,busy=false,tab='today',selectedDay=0,dead=false,generation=0;
  var radar=null,radarBusy=false,radarError=false,mapData=null,mapPromise=null,mapScript=null,canvas=null,base=null,coverage=null,shown=null;
  var drag=null,suppressMapClick=false;
  var zoom=6,center=null,frameIndex=0,shownIndex=-1,playing=false,playTimer=null,paintTimer=null,metadataTimer=null,forecastTimer=null,serial=0,images=new Map(),requests=[],mapPan=false;
  function t(k){var fallback=words[k]||EN[k]||k;return ctx.translate?ctx.translate('weather:'+k,fallback):fallback;}
  function text(en,de){var fallback=ctx.language.split('-')[0]==='de'?de:en;return ctx.translate?ctx.translate('text:'+en,fallback):fallback;}
  function num(v,d){return typeof v==='number'&&isFinite(v)?v.toLocaleString(lang,{maximumFractionDigits:d||0}):'—';}
  function time(v){try{return new Intl.DateTimeFormat(lang,{hour:'2-digit',minute:'2-digit',timeZone:data&&data.timezone||undefined}).format(new Date(v));}catch{return '—';}}
  function day(v,long){try{return new Intl.DateTimeFormat(lang,{weekday:long?'long':'short',day:'numeric',month:'short',timeZone:data&&data.timezone||undefined}).format(new Date(v));}catch{return '—';}}
  function condition(code){if(typeof code!=='number')return '—';if(code>=0&&code<=3)return [text('Clear','Klar'),text('Mostly clear','Überwiegend klar'),text('Partly cloudy','Teils bewölkt'),text('Overcast','Bedeckt')][code];return code>=95?text('Thunderstorm','Gewitter'):code>=71&&code<=77||code===85||code===86?text('Snow','Schnee'):code>=51?text('Rain','Regen'):code===45||code===48?text('Fog','Nebel'):t('title');}

  function button(action,text,extra){return el('button',Object.assign({type:'button',class:'wx-btn','data-wx':action},extra||{}),text);}
  function metric(label,value){return el('div',{class:'wx-metric'},[el('dt',{},label),el('dd',{},value)]);}
  function reading(value,unit){return num(value,unit==='mm'?1:0)+(value==null?'':' '+unit);}
  function credit(){if(ctx.preview)return el('footer',{class:'wx-credit'},text('Sample data · no TV data','Beispieldaten · keine TV-Daten'));return el('footer',{class:'wx-credit'},[el('a',{href:'https://open-meteo.com/','data-source':'forecast',target:'_blank',rel:'noopener',tabindex:'-1'},t('source')),el('span',{},data&&data.updatedAt?t('updated')+' '+time(data.updatedAt):''),data&&data.error?el('span',{class:'wx-warning'},t('stale')):null]);}
  function render(){
   if(dead)return;
   var active=host.contains(document.activeElement)?document.activeElement.getAttribute('data-wx-key'):null;
   host.textContent='';canvas=null;base=null;
   host.appendChild(el('header',{class:'wx-header'},[
    button('close',[svgIcon('back'),t('back')],{'data-wx-key':'back'}),
    el('div',{class:'wx-heading'},[el('p',{},t('title')),el('h1',{},data&&data.city||ctx.city||t('title'))]),
    el('div',{class:'wx-actions'},[button('location',[svgIcon('pin'),t('location')],{'data-wx-key':'location'}),button('refresh',[svgIcon('refresh'),t('refresh')],{'data-wx-key':'refresh',disabled:busy?'':null})])
   ]));
   host.appendChild(el('nav',{class:'wx-tabs','aria-label':t('title')},['today','hours','week','radar'].map(function(k){return button('tab',t(k),{'data-tab':k,'data-wx-key':'tab:'+k,'aria-current':tab===k?'page':null});})));
   var content=el('main',{class:'wx-content','data-page':tab});host.appendChild(content);
   if(tab==='radar')renderRadar(content);
   else if(busy&&!data)content.appendChild(el('p',{class:'wx-empty',role:'status'},t('loading')));
   else if(!data||!data.configured||data.temperature==null)content.appendChild(el('div',{class:'wx-empty'},[el('p',{},data&&!data.configured?t('setup'):t('failed')),button(data&&!data.configured?'location':'refresh',t(data&&!data.configured?'location':'retry'),{'data-wx-key':'retry'})]));
   else if(tab==='today')renderToday(content);
   else if(tab==='hours')renderHours(content);
   else if(tab==='week')renderWeek(content);

   host.appendChild(credit());
   if(active){var same=host.querySelector('[data-wx-key="'+active+'"]');if(same)same.focus({preventScroll:true});}
  }
  function hourCell(h){return el('div',{class:'wx-hour'},[el('time',{},time(h.time)),svgIcon(iconCode(h.code)),el('strong',{},num(h.temperature)+'°'),el('span',{class:'wx-hour__chance'},num(h.probability)+' %'),el('small',{},reading(h.precipitation,'mm'))]);}
  function renderToday(node){
   var today=(data.daily||[])[0]||{},next=(data.hourly||[]).slice(0,6);
   node.appendChild(el('div',{class:'wx-today'},[
    el('section',{class:'wx-current'},[el('div',{class:'wx-current__icon'},svgIcon(iconCode(data.code,data.isDay))),el('div',{class:'wx-current__temperature'},[num(data.temperature),el('span',{},'°')]),el('p',{class:'wx-condition'},condition(data.code)),el('p',{class:'wx-muted'},t('feels')+' '+num(data.feelsLike)+'° · '+num(today.high)+'° / '+num(today.low)+'°'),
     el('dl',{class:'wx-current__metrics'},[metric(t('wind'),reading(data.wind,'km/h')),metric(t('humidity'),reading(data.humidity,'%')),metric(t('sunrise'),today.sunrise?time(today.sunrise):'—'),metric(t('sunset'),today.sunset?time(today.sunset):'—')])]),
    el('section',{class:'wx-next'},[el('div',{class:'wx-section-heading'},[el('h2',{},t('next')),button('tab',t('hours'),{'data-tab':'hours','data-wx-key':'more-hours'})]),el('div',{class:'wx-hour-grid wx-hour-grid--six'},next.map(hourCell)),el('div',{class:'wx-rain-heading'},[svgIcon('rain'),el('span',{},t('rain'))]),rainChart(data.hourly||[]),el('p',{class:'wx-muted'},t('radarNote'))])
   ]));
   node.appendChild(el('section',{class:'wx-day-strip','aria-label':t('week')},(data.daily||[]).map(function(d,i){return button('day',[el('span',{},i===0?t('today'):day(d.time)),svgIcon(iconCode(d.code)),el('strong',{},num(d.high)+'°'),el('small',{},num(d.low)+'°'),el('span',{class:'wx-day-chance'},num(d.probability)+' %')],{'data-day':i,'data-wx-key':'quick-day:'+i,class:'wx-day-small'});})));
  }
  function rainChart(hours){
   var chart=el('div',{class:'wx-rain-chart','aria-label':t('rain')});
   hours.slice(0,24).forEach(function(h,i){chart.appendChild(el('div',{class:'wx-rain-bar',title:time(h.time)+' · '+reading(h.probability,'%')},[el('i',{style:{height:Math.max(2,Math.min(100,h.probability||0))+'%'}}),i%4===0?el('time',{},time(h.time)):null]));});return chart;
  }
  function renderHours(node){
   node.appendChild(el('div',{class:'wx-section-heading'},[el('h2',{},t('hours')),el('span',{class:'wx-muted'},t('rain')+' % · '+t('amount')+' mm')]));
   var hours=data.hourly||[];
   node.appendChild(hours.length?el('div',{class:'wx-hour-grid wx-hour-grid--full'},hours.map(hourCell)):el('p',{class:'wx-empty'},t('notFound')));
  }
  function renderWeek(node){
   var days=data.daily||[],d=days[selectedDay]||days[0];
   node.appendChild(el('div',{class:'wx-week'},days.map(function(d,i){return button('day',[el('span',{},i===0?t('today'):day(d.time)),svgIcon(iconCode(d.code)),el('span',{class:'wx-week__temp'},[el('strong',{},num(d.high)+'°'),el('small',{},num(d.low)+'°')]),el('span',{class:'wx-week__condition'},condition(d.code)),el('span',{class:'wx-day-chance'},num(d.probability)+' %'),el('small',{},reading(d.precipitation,'mm'))],{'data-day':i,'data-wx-key':'day:'+i,class:'wx-day','aria-pressed':String(i===selectedDay)});})));
   if(d)node.appendChild(el('section',{class:'wx-day-detail'},[el('div',{},[el('p',{class:'wx-muted'},t('selected')),el('h2',{},day(d.time,true)),el('p',{},condition(d.code))]),el('dl',{},[metric(t('wind'),reading(d.wind,'km/h')),metric(t('amount'),reading(d.precipitation,'mm')),metric(t('sunrise'),d.sunrise?time(d.sunrise):'—'),metric(t('sunset'),d.sunset?time(d.sunset):'—')])]));
  }
  function world(lat,lon){return root.OwnTVWeatherMap.project(lat,lon,zoom);}
  function unworld(p){return root.OwnTVWeatherMap.unproject(p,zoom);}
  function loadMap(){
   if(mapData)return Promise.resolve(mapData);if(mapPromise)return mapPromise;
   mapPromise=new Promise(function(resolve,reject){mapScript=el('script',{src:'data/geography.js'});mapScript.onload=function(){if(dead){root.OwnTVMapData=null;return;}mapData=root.OwnTVMapData;resolve(mapData);};mapScript.onerror=function(){mapPromise=null;reject(Error('Map data unavailable'));};document.head.appendChild(mapScript);});return mapPromise;
  }
  function renderRadar(node){
   if(!center&&data&&data.location)center={latitude:Math.max(-85,Math.min(85,data.location.latitude)),longitude:data.location.longitude};
   if(ctx.preview){node.appendChild(el('div',{class:'wx-empty'},t('sample')));return;}
   if(!radar){node.appendChild(el('p',{class:'wx-empty',role:'status'},t(radarError?'radarFailed':'radarLoading')));if(!radarBusy&&!radarError)loadRadar();return;}
   var mapWrap=el('div',{class:'wx-map-wrap'});canvas=el('canvas',{class:'wx-map',width:'960',height:'600',tabindex:'0',role:'button','aria-label':t('pan'),'data-wx-key':'map'});mapWrap.appendChild(canvas);
   mapWrap.appendChild(el('div',{class:'wx-map-status',id:'wx-map-status',role:'status'},''));
   var control=el('aside',{class:'wx-radar-controls'},[
    el('div',{},[el('h2',{},t('radar')),el('p',{class:'wx-muted'},t('observations'))]),
    el('div',{class:'wx-radar-time'},[el('span',{},t('frame')),el('strong',{id:'wx-frame-time'},shownIndex>=0?time(radar.frames[shownIndex].time):'—'),el('small',{id:'wx-frame-age'},'')]),
    el('div',{class:'wx-player'},[button('previous',svgIcon('back'),{'aria-label':t('previous'),'data-wx-key':'previous'}),button('play',t(playing?'pause':'play'),{'data-wx-key':'play',id:'wx-play'}),button('next-frame','→',{'aria-label':t('nextFrame'),'data-wx-key':'next'})]),
    el('div',{class:'wx-timeline','aria-label':t('observations')},radar.frames.map(function(f,i){return button('frame','',{'data-frame':i,'data-wx-key':'frame:'+i,'aria-label':time(f.time),'aria-current':i===frameIndex?'true':null});})),
    el('div',{class:'wx-map-tools'},[button('zoom-out','−',{'aria-label':t('zoomOut'),'data-wx-key':'minus',disabled:zoom<=4?'':null}),button('center',t('recenter'),{'data-wx-key':'center'}),button('zoom-in','+',{'aria-label':t('zoomIn'),'data-wx-key':'plus',disabled:zoom>=7?'':null})]),
    el('p',{class:'wx-muted'},t('mapHelp')),el('div',{class:'wx-rain-legend'},[el('span',{},t('light')),el('i'),el('span',{},t('heavy'))]),el('p',{class:'wx-muted'},t('noCoverage')),el('p',{class:'wx-radar-note'},t('radarNote')),
    el('div',{class:'wx-radar-credit'},[el('a',{href:'https://www.rainviewer.com/','data-source':'radar',target:'_blank',rel:'noopener',tabindex:'-1'},'Weather data by RainViewer'),el('span',{},'Map: Natural Earth'),el('span',{},t('limits'))])
   ]);
   node.appendChild(el('section',{class:'wx-radar-layout'},[mapWrap,control]));
   armRadarRefresh();
   loadMap().then(function(){if(!dead&&tab==='radar'){paintBase();showFrame(frameIndex);}},function(){status(t('radarFailed'));});
  }
  function status(text){var n=host.querySelector('#wx-map-status');if(n)n.textContent=text;}
  function paintBase(){
   if(!canvas||!mapData||!center)return;
   base=document.createElement('canvas');base.width=canvas.width;base.height=canvas.height;var c=base.getContext('2d'),w=base.width,h=base.height,m=world(center.latitude,center.longitude),scale=w/256,worldSize=256*Math.pow(2,zoom),dayMode=document.documentElement.dataset.theme==='day';
   c.fillStyle=dayMode?'#d9e2df':'#0a151b';c.fillRect(0,0,w,h);
   function point(lon,lat){var p=world(lat,lon),dx=p.x-m.x;dx=((dx+worldSize/2)%worldSize+worldSize)%worldSize-worldSize/2;return {x:w/2+dx*scale,y:h/2+(p.y-m.y)*scale};}
   c.fillStyle=dayMode?'#eee9db':'#19252a';c.strokeStyle=dayMode?'#a5b2ab':'#415055';c.lineWidth=1;
   mapData.polygons.forEach(function(poly){c.beginPath();poly.forEach(function(ring){ring.forEach(function(p,i){var q=point(p[0],p[1]);if(i===0)c.moveTo(q.x,q.y);else c.lineTo(q.x,q.y);});c.closePath();});c.fill('evenodd');c.stroke();});
   c.strokeStyle=dayMode?'rgba(30,70,70,.06)':'rgba(160,200,200,.04)';c.lineWidth=1;for(var x=0;x<w;x+=80){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}for(var y=0;y<h;y+=80){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}
   var labels=[];c.font='15px system-ui';mapData.cities.forEach(function(city){var p=point(city[0],city[1]);if(p.x<18||p.x>w-100||p.y<20||p.y>h-20||labels.length>=18)return;var width=c.measureText(city[2]).width;if(labels.some(function(l){return Math.abs(l.x-p.x)<(l.w+width)/2+22&&Math.abs(l.y-p.y)<25;}))return;labels.push({x:p.x,y:p.y,w:width});c.fillStyle=dayMode?'#54706c':'#96aaa9';c.beginPath();c.arc(p.x,p.y,2.5,0,Math.PI*2);c.fill();c.strokeStyle=dayMode?'#eee9db':'#19252a';c.lineWidth=4;c.strokeText(city[2],p.x+7,p.y-5);c.fillText(city[2],p.x+7,p.y-5);});
   var marker=(data&&data.location)||(radar&&radar.location);
   if(marker){var p=point(marker.longitude,marker.latitude);c.fillStyle='#79d6c1';c.strokeStyle='#fff';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,6,0,Math.PI*2);c.fill();c.stroke();}
   var kmPerPixel=Math.cos(center.latitude*Math.PI/180)*40075/(256*Math.pow(2,zoom))/scale;
   var km=zoom>=7?50:zoom===6?100:zoom===5?200:500,len=km/kmPerPixel;
   c.strokeStyle=dayMode?'#425f5b':'#a8bcb8';c.fillStyle=c.strokeStyle;c.lineWidth=2;c.beginPath();c.moveTo(24,h-30);c.lineTo(24+len,h-30);c.moveTo(24,h-35);c.lineTo(24,h-25);c.moveTo(24+len,h-35);c.lineTo(24+len,h-25);c.stroke();c.font='13px system-ui';c.fillText(km+' km',24,h-42);
   c.fillText('N ↑',w-55,28);
   draw();
  }
  function draw(){if(!canvas||!base)return;var c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);c.drawImage(base,0,0);var crop=(512-512*h/w)/2;if(shown){c.globalAlpha=.85;c.drawImage(shown,0,crop,512,512*h/w,0,0,w,h);c.globalAlpha=1;}if(coverage){c.globalAlpha=.55;c.drawImage(coverage,0,crop,512,512*h/w,0,0,w,h);c.globalAlpha=1;}}
  function imageUrl(path,coverageTile){return root.OwnTVWeatherMap.tileUrl(center,zoom,path,coverageTile);}
  function loadImage(url){
   var cached=images.get(url);if(cached)return cached;
   var now=Date.now();requests=requests.filter(function(n){return now-n<60000;});if(requests.length>=70)return Promise.reject(Error('rate'));requests.push(now);
   var img=new Image(),timer;
   var p=new Promise(function(resolve,reject){timer=setTimeout(function(){img.src='';reject(Error('timeout'));},12000);img.onload=function(){clearTimeout(timer);resolve(img);};img.onerror=function(){clearTimeout(timer);reject(Error('image'));};img.referrerPolicy='no-referrer';img.src=url;});p.image=img;p.cancel=function(){clearTimeout(timer);img.onload=null;img.onerror=null;img.src='';};images.set(url,p);while(images.size>15){var first=images.keys().next().value,old=images.get(first);if(old.cancel)old.cancel();images.delete(first);}return p;
  }
  function showFrame(index){
   clearTimeout(playTimer);
   if(!canvas||!radar||!center||dead)return;
   frameIndex=Math.max(0,Math.min(radar.frames.length-1,index));var token=++serial;status(t('waiting'));
   host.querySelectorAll('[data-frame]').forEach(function(b){b.setAttribute('aria-current',String(Number(b.dataset.frame)===frameIndex));});
   var path=radar.frames[frameIndex].path;
   var mask=coverage?Promise.resolve(coverage):loadImage(imageUrl('/v2/coverage/0',true)).catch(function(){return null;});
   Promise.all([loadImage(imageUrl(path,false)),mask]).then(function(result){
    if(dead||token!==serial||tab!=='radar')return;shown=result[0];coverage=result[1];shownIndex=frameIndex;draw();
    var stamp=host.querySelector('#wx-frame-time'),age=host.querySelector('#wx-frame-age');if(stamp)stamp.textContent=time(radar.frames[shownIndex].time);if(age)age.textContent=Date.now()-radar.frames[shownIndex].time>1800000?t('old'):'';
    status(coverage?'':t('noCoverage')+' ('+(text('mask unavailable','Maske nicht verfügbar'))+')');
    if(playing)playTimer=setTimeout(function(){showFrame((frameIndex+1)%radar.frames.length);},1000);
   },function(e){if(dead||token!==serial)return;pause();status(t(e.message==='rate'?'rate':shown?'missing':'radarFailed'));});
  }
  function pause(){playing=false;clearTimeout(playTimer);var b=host.querySelector('#wx-play');if(b)b.textContent=t('play');}
  function clearRadar(){pause();clearTimeout(metadataTimer);mapPan=false;++serial;clearTimeout(paintTimer);images.forEach(function(p){if(p.cancel)p.cancel();});images.clear();coverage=null;shown=null;shownIndex=-1;canvas=null;base=null;}
  function armRadarRefresh(){
   clearTimeout(metadataTimer);metadataTimer=setTimeout(function(){
    if(dead||tab!=='radar')return;
    if(document.hidden){armRadarRefresh();return;}
    var keepTime=radar&&frameIndex<radar.frames.length-1?radar.frames[frameIndex].time:null;
    ctx.call('getRadar',[]).then(function(r){if(dead||tab!=='radar')return;var resume=playing;clearRadar();radar=r;playing=resume;frameIndex=r.frames.length-1;if(keepTime){var i=r.frames.findIndex(function(f){return f.time===keepTime;});if(i>=0)frameIndex=i;}render();},function(){if(!dead&&tab==='radar'){status(t('radarFailed'));armRadarRefresh();}});
   },300000);
  }
  function loadRadar(){
   radarBusy=true;radarError=false;
   ctx.call('getRadar',[]).then(function(r){if(dead)return;radar=r;if(!center&&r.location)center={latitude:Math.max(-85,Math.min(85,r.location.latitude)),longitude:r.location.longitude};frameIndex=r.frames.length-1;radarBusy=false;if(tab==='radar')render();},function(){if(dead)return;radarBusy=false;radarError=true;if(tab==='radar')render();});
  }
  function changeMap(){++serial;status(t('waiting'));clearTimeout(playTimer);shown=null;coverage=null;shownIndex=-1;paintBase();clearTimeout(paintTimer);paintTimer=setTimeout(function(){showFrame(frameIndex);},250);}
  function setTab(next){if(next===tab)return;clearRadar();tab=next;render();var b=host.querySelector('[data-tab="'+next+'"]');if(b)b.focus({preventScroll:true});}
  function armForecastRefresh(){clearTimeout(forecastTimer);forecastTimer=setTimeout(function(){if(dead)return;if(document.hidden){armForecastRefresh();return;}load(false);},600000);}
  function load(force){
   if(busy)return;busy=true;var token=++generation;render();ctx.call('getWeather',[force===true]).then(function(r){if(dead||token!==generation)return;data=r;busy=false;armForecastRefresh();if(data.location&&!center)center={latitude:Math.max(-85,Math.min(85,data.location.latitude)),longitude:data.location.longitude};render();},function(){if(dead||token!==generation)return;busy=false;if(data)data.error=true;armForecastRefresh();render();});
  }
  function clicked(e){var source=e.target.closest('[data-source]');if(source&&ctx.onTV){e.preventDefault();ctx.call('openWeatherSource',[source.dataset.source]).catch(function(){status(source.href);});return;}if(e.target===canvas){ctx.onInput();if(suppressMapClick){suppressMapClick=false;return;}mapPan=!mapPan;canvas.setAttribute('aria-pressed',String(mapPan));status(mapPan?(text('Arrows pan · OK or Back returns to controls','Pfeile verschieben · OK oder Zurück beendet')):'');return;}var b=e.target.closest('[data-wx]');if(!b||b.disabled)return;ctx.onInput();var a=b.dataset.wx;
   if(a==='close'){ctx.onClose();return;}if(a==='location'){ctx.onSetup();return;}
   if(a==='refresh'){clearRadar();radar=null;radarError=false;load(true);return;}
   if(a==='tab'){setTab(b.dataset.tab);return;}
   if(a==='day'){selectedDay=Number(b.dataset.day)||0;tab='week';clearRadar();render();var d=host.querySelector('[data-wx-key="day:'+selectedDay+'"]');if(d)d.focus({preventScroll:true});return;}
   if(a==='play'){if(playing)pause();else{playing=true;b.textContent=t('pause');showFrame(frameIndex===radar.frames.length-1?0:frameIndex);}return;}
   if(a==='previous'||a==='next-frame'||a==='frame'){pause();showFrame(a==='frame'?Number(b.dataset.frame):(frameIndex+(a==='previous'?-1:1)+radar.frames.length)%radar.frames.length);return;}
   if(a==='zoom-in'||a==='zoom-out'){zoom=Math.max(4,Math.min(7,zoom+(a==='zoom-in'?1:-1)));clearRadar();render();return;}
   if(a==='center'){var place=(data&&data.location)||(radar&&radar.location);if(place){center={latitude:Math.max(-85,Math.min(85,place.latitude)),longitude:place.longitude};changeMap();}}
  }
  function key(e){
   var cur=document.activeElement,k=e.keyCode;
   if(k===406){ctx.onSetup();return true;}
   if(cur===canvas){
    if(k===13){mapPan=!mapPan;canvas.setAttribute('aria-pressed',String(mapPan));status(mapPan?(text('Arrows pan · OK or Back returns to controls','Pfeile verschieben · OK oder Zurück beendet')):'');return true;}
    if(mapPan&&(k===8||k===27||k===461)){mapPan=false;canvas.setAttribute('aria-pressed','false');status('');return true;}
    if(mapPan&&k>=37&&k<=40){var p=world(center.latitude,center.longitude);p.x+=(k===37?-30:k===39?30:0);p.y+=(k===38?-30:k===40?30:0);center=unworld(p);changeMap();return true;}
   }

   if((k===37||k===39)&&cur&&cur.dataset.tab){var tabs=Array.prototype.slice.call(host.querySelectorAll('.wx-tabs [data-tab]'));var i=tabs.indexOf(cur);if(i>=0){var next=tabs[i+(k===39?1:-1)];if(next)next.focus({preventScroll:true});return true;}}
   if((k===37||k===39)&&cur&&cur.dataset.day){var days=Array.prototype.slice.call(host.querySelectorAll('[data-day]'));var i=days.indexOf(cur),next=days[i+(k===39?1:-1)];if(next)next.focus({preventScroll:true});return true;}
   return false;
  }
  function pointerDown(e){if(e.target!==canvas||!center)return;ctx.onInput();drag={x:e.clientX,y:e.clientY,center:world(center.latitude,center.longitude),moved:false};try{canvas.setPointerCapture(e.pointerId);}catch{}}
  function pointerMove(e){if(!drag||!canvas)return;var dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)<5)return;drag.moved=true;var r=canvas.getBoundingClientRect();center=unworld({x:drag.center.x-dx*256/r.width,y:drag.center.y-dy*256*canvas.height/canvas.width/r.height});changeMap();}
  function pointerUp(){if(!drag)return;suppressMapClick=drag.moved;drag=null;}
  function visibility(){if(document.hidden)pause();}
  host.addEventListener('click',clicked);host.addEventListener('pointerdown',pointerDown);host.addEventListener('pointermove',pointerMove);host.addEventListener('pointerup',pointerUp);host.addEventListener('pointercancel',pointerUp);document.addEventListener('visibilitychange',visibility);
  host.setAttribute('aria-label',t('title'));host.hidden=false;load(false);var first=host.querySelector('[data-wx-key="back"]');if(first)first.focus({preventScroll:true});
  return {key:key,suspend:pause,close:function(){dead=true;clearTimeout(forecastTimer);++generation;clearRadar();host.removeEventListener('click',clicked);host.removeEventListener('pointerdown',pointerDown);host.removeEventListener('pointermove',pointerMove);host.removeEventListener('pointerup',pointerUp);host.removeEventListener('pointercancel',pointerUp);document.removeEventListener('visibilitychange',visibility);host.hidden=true;host.textContent='';mapData=null;root.OwnTVMapData=null;if(mapScript)mapScript.remove();},themeChanged:function(){if(canvas)paintBase();}};
 }
 root.OwnTVWeather={create:create,strings:EN};
}(window));
