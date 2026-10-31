'use strict';
function weatherLabel(code){if(code===0)return 'Clear';if(code===1)return 'Mostly clear';if(code===2)return 'Partly cloudy';if(code===3)return 'Overcast';if(code===45||code===48)return 'Fog';if(code>=51&&code<=57)return 'Drizzle';if(code>=61&&code<=67)return 'Rain';if(code>=71&&code<=77)return 'Snow';if(code>=80&&code<=82)return 'Rain showers';if(code>=85&&code<=86)return 'Snow showers';if(code>=95)return 'Thunderstorm';return 'Weather';}
function normalizeWeather(data,city,updatedAt,details=false,now=Date.now()){
 if(!data?.current||!Number.isFinite(data.current.temperature_2m)||!Number.isFinite(data.current.weather_code))throw Error('Invalid weather response');
 const daily=data.daily||{},times=daily.time||[];
 const solar=times.slice(0,-1).map((start,i)=>({start:start*1000,end:times[i+1]*1000,sunrise:daily.sunrise?.[i]*1000,sunset:daily.sunset?.[i]*1000})).filter(d=>Object.values(d).every(Number.isFinite)&&d.start<d.sunrise&&d.sunrise<d.sunset&&d.sunset<d.end);
 const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const value={configured:true,city,temperature:data.current.temperature_2m,condition:weatherLabel(data.current.weather_code),code:data.current.weather_code,updatedAt,timezone:data.timezone,solar};
 if(details){
  const c=data.current,h=data.hourly||{},d=data.daily||{};
  Object.assign(value,{feelsLike:number(c.apparent_temperature),humidity:number(c.relative_humidity_2m),wind:number(c.wind_speed_10m),windDirection:number(c.wind_direction_10m),isDay:c.is_day===1,
   hourly:(h.time||[]).map((time,i)=>({time:time*1000,temperature:number(h.temperature_2m?.[i]),code:number(h.weather_code?.[i]),probability:number(h.precipitation_probability?.[i]),precipitation:number(h.precipitation?.[i]),wind:number(h.wind_speed_10m?.[i])})).filter(h=>h.time>=Math.floor(now/3600000)*3600000).slice(0,24),
   daily:(d.time||[]).map((time,i)=>({time:time*1000,code:number(d.weather_code?.[i]),low:number(d.temperature_2m_min?.[i]),high:number(d.temperature_2m_max?.[i]),probability:number(d.precipitation_probability_max?.[i]),precipitation:number(d.precipitation_sum?.[i]),wind:number(d.wind_speed_10m_max?.[i]),sunrise:d.sunrise?.[i]>0?d.sunrise[i]*1000:null,sunset:d.sunset?.[i]>0?d.sunset[i]*1000:null})).filter((day,i)=>(d.time[i+1]?d.time[i+1]*1000:day.time+86400000)>now).slice(0,7)});
 }
 return value;
}
function searchUrl(query){
 if(typeof query!=='string'||query.trim().length<2||query.length>80||/[\u0000-\u001f\u007f]/.test(query))throw Error('Enter a city or town name (2–80 characters).');
 return 'https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(query.trim())+'&count=4&language=en&format=json';
}
function forecastUrl(w){
 const params=new URLSearchParams({latitude:w.latitude,longitude:w.longitude,current:'temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,is_day',hourly:'temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m',daily:'sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',timezone:'auto',timeformat:'unixtime',forecast_days:'8',temperature_unit:'celsius',wind_speed_unit:'kmh',precipitation_unit:'mm'});
 return 'https://api.open-meteo.com/v1/forecast?'+params;
}
function normalizeRadar(raw){
 if(raw?.host!=='https://tilecache.rainviewer.com')throw Error('Radar image host is unsupported.');
 const frames=(raw.radar?.past||[]).filter(f=>Number.isFinite(f.time)&&/^\/v2\/radar\/[a-zA-Z0-9_-]{1,80}$/.test(f.path)).map(f=>({time:f.time*1000,path:f.path})).sort((a,b)=>a.time-b.time).slice(-13);
 if(!frames.length)throw Error('No radar frames available.');
 return {host:raw.host,generated:raw.generated*1000,frames};
}
module.exports={normalizeWeather,searchUrl,forecastUrl,normalizeRadar};
