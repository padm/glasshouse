/* Carousel View: the layout keeps it as a view, and its weather is looked up
 * by name once, read from Open-Meteo at most every 15 minutes, and not served
 * for another place or unit, nor once three hours old.
 * Strict ES5: also runs on node 0.10. */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var home = require('../server/lib/home');
var weather = require('../server/lib/home-weather');

var dir = path.join(os.tmpdir(), 'home-carousel-' + process.pid);
var clock = 1000000;
var asked = [];
var answers = {};

function getJson(url, cb) {
  asked.push(url);
  var host = /geocoding-api/.test(url) ? 'geocode' : 'forecast';
  var a = answers[host];
  process.nextTick(function () {
    if (a instanceof Error) return cb(a);
    cb(null, a);
  });
}

function reset() {
  asked = [];
  answers = {
    geocode: { results: [{ name: 'Sherbrooke', admin1: 'Quebec', country: 'Canada', latitude: 45.40008, longitude: -71.89908 }] },
    forecast: { current: { temperature_2m: 4.6, weather_code: 0, is_day: 0 } }
  };
}

try { fs.mkdirSync(dir); } catch (e) {}
process.on('exit', function () {
  try { fs.unlinkSync(path.join(dir, 'home-weather.json')); } catch (e) {}
  try { fs.rmdirSync(dir); } catch (e) {}
});

assert.strictEqual(home.normalise({ view: 'carousel' }).view, 'carousel');
assert.strictEqual(home.normalise({ view: 'alternative' }).view, 'alternative');
assert.strictEqual(home.normalise({ view: 'gallery' }).view, 'standard');

weather.init({ stateDir: dir, getJson: getJson, now: function () { return clock; } });

var steps = [
  function (next) {
    reset();
    weather.status(function (r) {
      assert.deepEqual(r, { ok: true, place: null, unit: 'celsius', weather: null });
      assert.equal(asked.length, 0, 'nothing is sent without a place');
      next();
    });
  },
  function (next) {
    reset();
    weather.setPlace({ place: '  Sherbrooke ', lang: 'fr' }, function (r) {
      assert.equal(r.ok, true);
      assert.deepEqual(r.place, { name: 'Sherbrooke', region: 'Quebec', country: 'Canada', latitude: 45.4001, longitude: -71.8991 });
      assert.ok(/language=fr&name=Sherbrooke$/.test(asked[0]), asked[0]);
      assert.ok(/latitude=45.4001&longitude=-71.8991&current=/.test(asked[1]), asked[1]);
      assert.deepEqual(r.weather, { temp: 4.6, code: 0, isDay: false, at: clock });
      var saved = JSON.parse(fs.readFileSync(path.join(dir, 'home-weather.json'), 'utf8'));
      assert.equal(saved.place.name, 'Sherbrooke');
      next();
    });
  },
  function (next) {
    reset();
    clock += 10 * 60000;
    weather.status(function (r) {
      assert.equal(asked.length, 0, 'a reading under 15 minutes old is kept');
      assert.equal(r.weather.temp, 4.6);
      next();
    });
  },
  function (next) {
    reset();
    weather.setPlace({ unit: 'fahrenheit' }, function (r) {
      assert.equal(r.unit, 'fahrenheit');
      assert.equal(r.place.name, 'Sherbrooke', 'the place stays when only the unit is sent');
      assert.equal(asked.length, 1, 'no new lookup');
      assert.ok(/temperature_unit=fahrenheit/.test(asked[0]), 'a new unit is read again');
      next();
    });
  },
  function (next) {
    reset();
    clock += 20 * 60000;
    answers.forecast = new Error('timed out');
    weather.status(function (r) {
      assert.equal(asked.length, 1);
      assert.equal(r.weather.temp, 4.6, 'a failed refresh keeps the last reading for now');
      clock += 3 * 60 * 60000;
      weather.status(function (r2) {
        assert.equal(r2.weather, null, 'a reading three hours old is not shown');
        next();
      });
    });
  },
  function (next) {
    reset();
    answers.geocode = { generationtime_ms: 0.4 };
    weather.setPlace({ place: 'Nowhere at all' }, function (r) {
      assert.equal(r.ok, false);
      assert.ok(/Nowhere at all/.test(r.error));
      weather.status(function (r2) {
        assert.equal(r2.place.name, 'Sherbrooke', 'a place not found leaves the saved one');
        next();
      });
    });
  },
  function (next) {
    reset();
    weather.setPlace({ place: '' }, function (r) {
      assert.equal(r.place, null);
      assert.equal(r.weather, null);
      assert.equal(asked.length, 0);
      next();
    });
  }
];

(function next() {
  var step = steps.shift();
  if (step) return step(next);
  console.log('Carousel View passed.');
})();
