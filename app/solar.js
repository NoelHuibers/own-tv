/* Weather timestamps are UTC milliseconds, including local-day boundaries. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OwnTVSolar = factory();
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function period(weather, now) {
    now = Number(now);
    if (!weather || !weather.configured || weather.error || !Number.isFinite(now) ||
        !Number.isFinite(weather.updatedAt) || now < weather.updatedAt - 300000 || now - weather.updatedAt > 36 * 3600000) return null;
    var days = Array.isArray(weather.solar) ? weather.solar : [];
    for (var i = 0; i < days.length; i++) {
      var d = days[i];
      if (d && [d.start, d.end, d.sunrise, d.sunset].every(function (v) { return typeof v === 'number' && Number.isFinite(v); }) &&
          d.start <= now && now < d.end && d.start < d.sunrise && d.sunrise < d.sunset && d.sunset < d.end) return d;
    }
    return null;
  }
  function theme(weather, now) {
    var d = period(weather, now);
    return d ? (now >= d.sunrise && now < d.sunset ? 'day' : 'night') : null;
  }
  return { period: period, theme: theme };
}));
