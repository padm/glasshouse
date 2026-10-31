/*
 * lib/home-weather.js - the weather Glasshouse Home's Carousel View shows
 * beside its clock, from Open-Meteo, which needs no account or key.
 *
 * The place is chosen by name on the dashboard and looked up once with
 * Open-Meteo's geocoding; its coordinates are kept in home-weather.json,
 * apart from home.json, whose layout drops what it does not know. Only those
 * coordinates are sent, and only while a place is chosen.
 *
 * Strict ES5: runs on node 0.12.
 */
var fs = require('fs');
var path = require('path');
var msg = require('./say').msg;
var writeJsonAtomic = require('./util').writeJsonAtomic;

var GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
var FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
var UNITS = ['celsius', 'fahrenheit'];
// Open-Meteo updates its current conditions every 15 minutes.
var FRESH_MS = 15 * 60 * 1000;
// A reading this old is not shown, rather than shown as now.
var STALE_MS = 3 * 60 * 60 * 1000;
// After a failed refresh, the next is tried no sooner than this.
var RETRY_MS = 2 * 60 * 1000;

var stateDir = '/var/lib/tvweb';
var getJsonFn = null;
var nowFn = Date.now;
var settings = null;
var reading = null;      // { temp, code, isDay, at, key }
var failedAt = 0;
var waiting = null;      // callbacks while a refresh is out

function init(opts) {
  opts = opts || {};
  if (opts.stateDir) stateDir = opts.stateDir;
  if (opts.getJson) getJsonFn = opts.getJson;
  if (opts.now) nowFn = opts.now;
  settings = null;
  reading = null;
  failedAt = 0;
  waiting = null;
}

function getJson(url, cb) {
  // Loaded on first use, so the module can be tested without a fetch client.
  if (!getJsonFn) getJsonFn = require('./fetch').getJson;
  getJsonFn(url, cb);
}

function settingsFile() { return path.join(stateDir, 'home-weather.json'); }

function validPlace(p) {
  return !!(p && typeof p.name === 'string' && p.name &&
    typeof p.latitude === 'number' && Math.abs(p.latitude) <= 90 &&
    typeof p.longitude === 'number' && Math.abs(p.longitude) <= 180);
}

function readSettings() {
  if (settings) return settings;
  var raw = null;
  try { raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) {}
  settings = {
    place: raw && validPlace(raw.place) ? {
      name: raw.place.name,
      region: typeof raw.place.region === 'string' ? raw.place.region : '',
      country: typeof raw.place.country === 'string' ? raw.place.country : '',
      latitude: raw.place.latitude,
      longitude: raw.place.longitude
    } : null,
    unit: raw && UNITS.indexOf(raw.unit) !== -1 ? raw.unit : 'celsius'
  };
  return settings;
}

// What the reading was taken for: a new place or unit is not served an old one.
function readingKey(s) {
  return s.place ? s.place.latitude + ',' + s.place.longitude + ',' + s.unit : '';
}

function status(cb) {
  var s = readSettings();
  refresh(function () {
    var key = readingKey(s);
    var r = reading && reading.key === key && nowFn() - reading.at < STALE_MS ? reading : null;
    cb({ ok: true, place: s.place, unit: s.unit,
      weather: r ? { temp: r.temp, code: r.code, isDay: r.isDay, at: r.at } : null });
  });
}

// Reads the current conditions when the last reading is old, once at a time.
function refresh(cb) {
  var s = readSettings(), key = readingKey(s), now = nowFn();
  if (!s.place) return cb();
  if (reading && reading.key === key && now - reading.at < FRESH_MS) return cb();
  if (failedAt && now - failedAt < RETRY_MS) return cb();
  if (waiting) return waiting.push(cb);
  waiting = [cb];
  var url = FORECAST_URL + '?latitude=' + s.place.latitude + '&longitude=' + s.place.longitude +
    '&current=temperature_2m,weather_code,is_day&timezone=auto' +
    (s.unit === 'fahrenheit' ? '&temperature_unit=fahrenheit' : '');
  getJson(url, function (err, doc) {
    var cur = !err && doc && doc.current;
    if (cur && typeof cur.temperature_2m === 'number' && typeof cur.weather_code === 'number') {
      reading = { temp: cur.temperature_2m, code: cur.weather_code, isDay: cur.is_day !== 0, at: nowFn(), key: key };
      failedAt = 0;
    } else {
      failedAt = nowFn();
      console.log('home-weather: no reading from Open-Meteo' + (err ? ': ' + err.message : ''));
    }
    var done = waiting;
    waiting = null;
    done.forEach(function (f) { f(); });
  });
}

function save(next) {
  try {
    writeJsonAtomic(settingsFile(), next);
  } catch (e) {
    return false;
  }
  settings = next;
  return true;
}

/*
 * { place, unit, lang }: place is a name to look up, '' for no weather. lang
 * is the dashboard's, for the name as that language writes it.
 */
function setPlace(body, cb) {
  var s = readSettings();
  var unit = body && UNITS.indexOf(body.unit) !== -1 ? body.unit : s.unit;
  var query = body && typeof body.place === 'string' ? body.place.replace(/\s+/g, ' ').trim().slice(0, 80) : null;
  var lang = body && /^[a-z]{2}$/.test(String(body.lang || '')) ? body.lang : 'en';
  var answer = function () { status(cb); };
  if (query === null) {
    if (!save({ place: s.place, unit: unit })) return cb({ ok: false, error: msg('srv.home.weather.saveFailed', 'could not save the weather settings') });
    return answer();
  }
  if (!query) {
    if (!save({ place: null, unit: unit })) return cb({ ok: false, error: msg('srv.home.weather.saveFailed', 'could not save the weather settings') });
    return answer();
  }
  getJson(GEOCODE_URL + '?count=1&format=json&language=' + lang + '&name=' + encodeURIComponent(query), function (err, doc) {
    if (err) return cb({ ok: false, error: msg('srv.home.weather.lookupFailed', 'Open-Meteo did not answer: {error}', { error: err.message }) });
    var hit = doc && doc.results && doc.results[0];
    var place = hit && {
      name: String(hit.name || ''),
      region: typeof hit.admin1 === 'string' ? hit.admin1 : '',
      country: typeof hit.country === 'string' ? hit.country : '',
      latitude: Math.round(hit.latitude * 1e4) / 1e4,
      longitude: Math.round(hit.longitude * 1e4) / 1e4
    };
    if (!validPlace(place)) return cb({ ok: false, error: msg('srv.home.weather.notFound', 'No place called {place} was found', { place: query }) });
    if (!save({ place: place, unit: unit })) return cb({ ok: false, error: msg('srv.home.weather.saveFailed', 'could not save the weather settings') });
    answer();
  });
}

module.exports = {
  init: init,
  status: status,
  setPlace: setPlace
};
