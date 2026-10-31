# Integrated weather

Press OK on the configured Weather tile to open Own TV Weather. Back returns to
the dashboard. Location opens the existing city settings.

- Today: current conditions, feels-like temperature, humidity, wind, sunrise and
  sunset, the next six hours and a quick seven-day strip.
- 24 hours: hourly temperatures, precipitation chance and precipitation amounts.
- 7 days: daily high/low temperatures, precipitation chance and amounts. Select
  a day for its wind and sun times.
- Rain radar: observed precipitation over the past two hours, with a timestamp
  for every frame, playback, manual frame selection, regional zoom and panning.
  Focus the map and press OK to enter pan mode. Arrow keys pan; OK or Back leaves
  pan mode. Back outside pan mode returns to Own TV.

Forecasts come from [Open-Meteo](https://open-meteo.com/en/docs), in Celsius,
km/h and mm. UTC timestamps are formatted in the forecast location's time zone.
Hourly forecasts include the current hour and the following 23 hours. The daily
view includes today and six following days. Missing data stays unavailable.
Forecasts are cached for 30 minutes; Refresh requests a new forecast. While open,
the app checks for updates every ten minutes, and radar metadata every five.
It does not keep refreshing hidden forecast pages. Cached daily forecasts roll
over using local-day boundaries, including daylight-saving changes. A failed
refresh can show an explicitly marked older forecast.

## Radar and maps

[RainViewer](https://www.rainviewer.com/api/weather-maps-api.html) supplies radar
metadata and images. The current free service is for personal/educational use,
provides past observations (not future-rain nowcasts), and limits zoom to 7.
See its [transition policy](https://www.rainviewer.com/api/transition-faq.html).
A public Own TV repository does not grant commercial rights to provider services.

Only the Rain radar page requests radar imagery. Metadata is cached for five
minutes. The client draws one coordinate-centered 512px image per frame, over a
bundled vector basemap, and a coverage mask. No basemap tile server is contacted.
There are at most 15 image entries; new loads are capped below the provider's
100 requests/IP/minute limit. Playback is paced by completed loads, stops when
hidden or idle, and releases images on exit. Forecast failure and radar failure
are handled independently. A failed image retains the previous image and its
original timestamp. Radar older than 30 minutes is labelled. Coverage gaps are
shaded; an empty tile is not a guarantee of dry weather. The widget never calls
radar endpoints while sitting on the dashboard.

The TV/browser contacts only tilecache.rainviewer.com for radar images, using
approximate coordinates from the selected weather location. The strict CSP
permits that image host; no remote scripts or map framework are loaded.

## Bundled geography

Country polygons (110m) and populated-place points (10m, at least 20,000 people
or national capitals) come from the public-domain Natural Earth dataset:
https://github.com/nvkelso/natural-earth-vector/tree/ca96624a56bd078437bca8184e78163e5039ad19/geojson

Source revision: `ca96624a56bd078437bca8184e78163e5039ad19`.
Files: `ne_110m_admin_0_countries.geojson`, `ne_10m_populated_places.geojson`.
The bundled file strips unused properties, rounds coordinates to three decimal
places and sorts labels by population. It is a regional orientation map, not a
street map. [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/).
The geography script is loaded on demand and released when weather closes.
