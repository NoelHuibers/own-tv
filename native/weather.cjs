'use strict';
function weatherLabel(code){if(code===0)return 'Clear';if(code===1)return 'Mostly clear';if(code===2)return 'Partly cloudy';if(code===3)return 'Overcast';if(code===45||code===48)return 'Fog';if(code>=51&&code<=57)return 'Drizzle';if(code>=61&&code<=67)return 'Rain';if(code>=71&&code<=77)return 'Snow';if(code>=80&&code<=82)return 'Rain showers';if(code>=85&&code<=86)return 'Snow showers';if(code>=95)return 'Thunderstorm';return 'Weather';}
function normalizeWeather(data,city,updatedAt){
 if(!data?.current||!Number.isFinite(data.current.temperature_2m)||!Number.isFinite(data.current.weather_code))throw Error('Invalid weather response');
 const daily=data.daily||{},times=daily.time||[];
 const solar=times.slice(0,-1).map((start,i)=>({start:start*1000,end:times[i+1]*1000,sunrise:daily.sunrise?.[i]*1000,sunset:daily.sunset?.[i]*1000})).filter(d=>Object.values(d).every(Number.isFinite)&&d.start<d.sunrise&&d.sunrise<d.sunset&&d.sunset<d.end);
 return {configured:true,city,temperature:data.current.temperature_2m,condition:weatherLabel(data.current.weather_code),updatedAt,timezone:data.timezone,solar};
}
function searchUrl(query){
 if(typeof query!=='string'||query.trim().length<2||query.length>80||/[\u0000-\u001f\u007f]/.test(query))throw Error('Enter a city or town name (2–80 characters).');
 return 'https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(query.trim())+'&count=4&language=en&format=json';
}
module.exports={normalizeWeather,searchUrl};
