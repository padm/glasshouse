// @ts-nocheck: part of home.html, whose own script tsc does not see, with t() from i18n.js.
/*
 * Glasshouse Home's Carousel View: what it adds to home.html's own view, which
 * marks the stage with carousel when the layout's view is. A greeting over the
 * clock, the weather beside it (lib/home-weather.js), each app tile on its
 * icon's own colour, and All apps along the foot: a panel of every app not
 * hidden, those in More apps too. The styles are home-carousel.css.
 *
 * Kept apart from home.html so the view can follow Glasshouse's own changes to
 * it: this file reads the page's markup and asks the server, and takes the
 * remote's keys before the page does only while All apps has them.
 *
 * Strict ES5, as every page the TV's own browser shows.
 */
(function () {
  var KEY = { left: 37, up: 38, right: 39, down: 40, ok: 13, back: 461 };
  var WEATHER_MS = 10 * 60000;
  var ALL_COLS = 5;
  var LG_HOME_TILE = 'lg-home';

  var stage = document.getElementById('stage');
  if (!stage) return;
  var greet = null, weather = null, bar = null, panel = null, grid = null;
  // bar: All apps has the focus; all: its panel is open, on a tile or (back) its Back button.
  var focus = { bar: false };
  var all = { open: false, apps: [], col: 0, back: false, opening: false };
  var swallowed = {};
  var weatherAt = 0, weatherBusy = false;

  function $(id) { return document.getElementById(id); }
  function on() { return /(^|\s)carousel(\s|$)/.test(stage.className); }
  // Something of the page's own over the rows: arranging, Recent apps, search or More apps.
  function covered() { return /(^|\s)(arranging|recents|finding|folder)(\s|$)/.test(stage.className); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getJson(url, cb) {
    var x = new XMLHttpRequest();
    x.open('GET', url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now(), true);
    x.timeout = 8000;
    x.onload = function () {
      var j = null;
      try { j = JSON.parse(x.responseText); } catch (e) {}
      cb(x.status >= 200 && x.status < 300 ? j : null);
    };
    x.onerror = x.ontimeout = function () { cb(null); };
    x.send(null);
  }
  function postJson(url, body, cb) {
    var x = new XMLHttpRequest();
    x.open('POST', url, true);
    x.timeout = 8000;
    x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function () {
      var j = null;
      try { j = JSON.parse(x.responseText); } catch (e) {}
      cb(j);
    };
    x.onerror = x.ontimeout = function () { cb(null); };
    x.send(JSON.stringify(body));
  }
  function bodyClass() {
    var c = document.body.className.replace(/(^|\s)gh-(bar|all)\b/g, '');
    document.body.className = c + (focus.bar ? ' gh-bar' : '') + (all.open ? ' gh-all' : '');
  }

  // ---------------------------------------------------------------- greeting

  function greeting(h) {
    if (h >= 5 && h < 12) return t('home.carousel.morning', 'Good morning');
    if (h >= 12 && h < 18) return t('home.carousel.afternoon', 'Good afternoon');
    if (h >= 18 && h < 23) return t('home.carousel.evening', 'Good evening');
    return t('home.carousel.night', 'Good night');
  }
  function renderGreeting() {
    if (greet) greet.textContent = greeting(new Date().getHours());
  }

  // ---------------------------------------------------------------- weather

  // Open-Meteo's WMO weather codes, as words and the icon drawn for them.
  function condition(code) {
    if (code === 0) return ['clear', t('home.carousel.clear', 'Clear sky')];
    if (code === 1) return ['clear', t('home.carousel.mainlyClear', 'Mainly clear')];
    if (code === 2) return ['partly', t('home.carousel.partlyCloudy', 'Partly cloudy')];
    if (code === 3) return ['cloud', t('home.carousel.overcast', 'Overcast')];
    if (code === 45 || code === 48) return ['fog', t('home.carousel.fog', 'Fog')];
    if (code >= 51 && code <= 57) return ['rain', t('home.carousel.drizzle', 'Drizzle')];
    if (code === 66 || code === 67) return ['rain', t('home.carousel.freezingRain', 'Freezing rain')];
    if (code >= 61 && code <= 65) return ['rain', t('home.carousel.rain', 'Rain')];
    if (code >= 71 && code <= 77) return ['snow', t('home.carousel.snow', 'Snow')];
    if (code >= 80 && code <= 82) return ['rain', t('home.carousel.showers', 'Rain showers')];
    if (code === 85 || code === 86) return ['snow', t('home.carousel.snowShowers', 'Snow showers')];
    if (code >= 95) return ['storm', t('home.carousel.thunderstorm', 'Thunderstorm')];
    return ['cloud', ''];
  }

  var SUN = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>';
  var MOON = '<path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z"/>';
  var CLOUD = '<path d="M7 18.5h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7 18.5z"/>';
  var ICONS = {
    partly: '<path d="M8.6 7.4A4 4 0 0 0 4 11.3M8.5 2.8v1.4M3.2 5l1 1M2 10h1.4"/>' +
      '<path d="M8.5 19.5h9a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.2 3 3 0 0 0 .2 6z"/>',
    cloud: CLOUD,
    fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
    rain: '<path d="M7 15h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7 15z"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/>',
    snow: '<path d="M7 15h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7 15z"/><path d="M8 19h.01M12 20h.01M16 19h.01"/>',
    storm: '<path d="M7 15h10.2a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.8 1.4A3.3 3.3 0 0 0 7 15z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>'
  };
  function icon(kind, isDay) {
    var path = kind === 'clear' ? (isDay ? SUN : MOON) : ICONS[kind] || CLOUD;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  // Every ten minutes; without a reading, as before a place is chosen on the
  // dashboard, at each minute's call.
  function refreshWeather() {
    if (!weather || weatherBusy || !on() || document.hidden) return;
    if (weather.className && Date.now() - weatherAt < WEATHER_MS) return;
    weatherBusy = true;
    getJson('/api/home/weather', function (r) {
      weatherBusy = false;
      weatherAt = Date.now();
      var w = r && r.ok && r.place && r.weather;
      if (!w) { weather.className = ''; return; }
      var c = condition(w.code);
      weather.innerHTML = '<div class="top">' + icon(c[0], w.isDay) +
        '<span class="temp">' + esc(Math.round(w.temp) + (r.unit === 'fahrenheit' ? '°F' : '°C')) + '</span></div>' +
        '<div class="place">' + esc(r.place.name) + '</div>' +
        (c[1] ? '<div class="cond">' + esc(c[1]) + '</div>' : '') +
        '<div class="src" translate="no">Open-Meteo</div>';
      weather.className = 'on';
    });
  }

  // ---------------------------------------------------------------- tile colours

  /*
   * Most TV apps' icons are their logo on a square of the brand's colour.
   * Where an icon's four corners are one solid colour, the tile takes it and
   * the icon fills its height, so the tile reads as the logo on a wide card;
   * an icon with clear or mixed corners stays as it is, on the glass.
   */
  var fills = {};
  var probe = null;
  function sample(img) {
    var src = img.getAttribute('src');
    if (Object.prototype.hasOwnProperty.call(fills, src)) return fills[src];
    if (!img.complete || !img.naturalWidth) return undefined;
    var colour = null;
    try {
      probe = probe || document.createElement('canvas');
      probe.width = probe.height = 16;
      var cx = probe.getContext('2d');
      cx.clearRect(0, 0, 16, 16);
      cx.drawImage(img, 0, 0, 16, 16);
      var px = cx.getImageData(0, 0, 16, 16).data;
      var corners = [0, 15, 16 * 15, 16 * 16 - 1].map(function (i) { return [px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]]; });
      var first = corners[0];
      var same = corners.every(function (p) {
        return p[3] > 240 && Math.abs(p[0] - first[0]) + Math.abs(p[1] - first[1]) + Math.abs(p[2] - first[2]) < 36;
      });
      if (same) colour = 'rgb(' + first[0] + ',' + first[1] + ',' + first[2] + ')';
    } catch (e) {}
    fills[src] = colour;
    return colour;
  }
  function decorate(root) {
    if (!on() || !root) return;
    var imgs = root.querySelectorAll('.tile.app > img');
    for (var i = 0; i < imgs.length; i++) paintTile(imgs[i]);
  }
  function paintTile(img) {
    var colour = sample(img);
    if (colour === undefined) {
      if (!img.ghWaiting) {
        img.ghWaiting = true;
        img.addEventListener('load', function () { paintTile(img); });
      }
      return;
    }
    var tile = img.parentNode;
    if (colour) {
      if (!/\bgh-fill\b/.test(tile.className)) tile.className += ' gh-fill';
      tile.style.backgroundColor = colour;
    }
  }

  // ---------------------------------------------------------------- all apps

  function lastRowActive() {
    var rows = document.querySelectorAll('#rows .row'), last = null, active = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].offsetHeight) last = rows[i];
      if (/\bactive\b/.test(rows[i].className)) active = rows[i];
    }
    return !!active && active === last;
  }
  function setBar(v) {
    if (focus.bar === v) return;
    focus.bar = v;
    bodyClass();
  }

  function openAll() {
    if (all.opening) return;
    all.opening = true;
    getJson('/api/home/catalogue', function (r) {
      all.opening = false;
      if (!r || !r.ok || !on()) return;
      var hidden = (r.layout && r.layout.hidden && r.layout.hidden.app) || [];
      var byId = {};
      (r.apps || []).forEach(function (a) { byId[a.id] = a; });
      all.apps = [];
      ((r.order && r.order.app) || []).forEach(function (id) {
        if (id !== LG_HOME_TILE && byId[id] && hidden.indexOf(id) === -1) { all.apps.push(byId[id]); delete byId[id]; }
      });
      all.col = 0;
      all.back = !all.apps.length;
      all.open = true;
      setBar(false);
      bodyClass();
      renderAll();
    });
  }
  function closeAll() {
    if (!all.open) return;
    all.open = false;
    bodyClass();
  }
  function renderAll() {
    var html = '';
    all.apps.forEach(function (a, i) {
      html += '<div class="tile app" data-a="' + i + '">' +
        (a.icon ? '<img src="' + esc(a.icon) + '" alt="">' : '<span class="mono">' + esc(a.title) + '</span>') +
        '<div class="nm">' + esc(a.title) + '</div></div>';
    });
    grid.innerHTML = html;
    $('ghAllMsg').textContent = '';
    focusAll();
  }
  // Keeps the focused line in view by moving the grid, as More apps does.
  function focusAll() {
    var tiles = grid.querySelectorAll('.tile');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].className = tiles[i].className.replace(/ focus\b/g, '') + (!all.back && i === all.col ? ' focus' : '');
    }
    $('ghAllBack').className = 'back' + (all.back ? ' focus' : '');
    var cur = tiles[all.col];
    if (!cur) return;
    var viewH = grid.parentNode.clientHeight - 20;
    var y = +(grid.getAttribute('data-y') || 0);
    if (cur.offsetTop + cur.offsetHeight > y + viewH) y = cur.offsetTop + cur.offsetHeight - viewH;
    if (cur.offsetTop < y) y = cur.offsetTop;
    if (all.back) y = 0;
    grid.setAttribute('data-y', y);
    grid.style.webkitTransform = grid.style.transform = 'translateY(' + (-y) + 'px)';
  }
  function openApp(a) {
    postJson('/api/home/open', { kind: 'app', id: a.id }, function (r) {
      if (r && r.ok) return closeAll();
      $('ghAllMsg').textContent = t('home.openFailed', 'That did not open') + (r && r.error ? ': ' + r.error : '');
    });
  }
  function allKey(k) {
    var n = all.apps.length, c = all.col;
    if (k === KEY.back) return closeAll();
    if (all.back) {
      if (k === KEY.ok) return closeAll();
      if (k === KEY.down && n) all.back = false;
      return focusAll();
    }
    if (k === KEY.ok) return n && openApp(all.apps[c]);
    if (k === KEY.left && c % ALL_COLS > 0) c--;
    else if (k === KEY.right && c % ALL_COLS < ALL_COLS - 1 && c + 1 < n) c++;
    else if (k === KEY.up) { if (c - ALL_COLS >= 0) c -= ALL_COLS; else all.back = true; }
    // Down from above a short last line goes to its last tile.
    else if (k === KEY.down && Math.floor(c / ALL_COLS) < Math.floor((n - 1) / ALL_COLS)) c = Math.min(n - 1, c + ALL_COLS);
    all.col = c;
    focusAll();
  }

  // ---------------------------------------------------------------- input

  /*
   * Taken on the window, ahead of the page's own listener on the document,
   * and only while All apps has the focus or is being given it: Down from the
   * last row. The key's release is taken too, so the page does not act on
   * an OK it never saw pressed.
   */
  function onKeyDown(e) {
    var k = e.keyCode;
    if (!on()) return;
    var mine = false;
    if (all.open) {
      mine = true;
      if (!e.repeat || k !== KEY.ok) allKey(k);
    } else if (focus.bar) {
      mine = true;
      if (covered()) { setBar(false); mine = false; }
      else if (k === KEY.ok && !e.repeat) openAll();
      else if (k === KEY.up || k === KEY.back) setBar(false);
    } else if (k === KEY.down && !covered() && !$('rail').className && lastRowActive()) {
      mine = true;
      setBar(true);
    }
    if (!mine) return;
    swallowed[k] = true;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function onKeyUp(e) {
    if (!swallowed[e.keyCode]) return;
    swallowed[e.keyCode] = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function within(el, node) {
    while (node && node !== document.body) { if (node === el) return true; node = node.parentNode; }
    return false;
  }
  function tileIn(node) {
    while (node && node !== grid) {
      if (node.hasAttribute && node.hasAttribute('data-a')) return node;
      node = node.parentNode;
    }
    return null;
  }
  function onPointer(e) {
    if (!on()) return;
    if (all.open) {
      // The rows under the panel keep the focus they had.
      e.stopImmediatePropagation();
      var tile = tileIn(e.target);
      if (tile && (+tile.getAttribute('data-a') !== all.col || all.back)) { all.col = +tile.getAttribute('data-a'); all.back = false; focusAll(); }
      else if (within($('ghAllBack'), e.target) && !all.back) { all.back = true; focusAll(); }
      return;
    }
    setBar(within(bar, e.target) && !covered());
  }
  function onClick(e) {
    if (!on()) return;
    if (all.open) {
      e.stopImmediatePropagation();
      var tile = tileIn(e.target);
      if (tile) return openApp(all.apps[+tile.getAttribute('data-a')]);
      if (within($('ghAllBack'), e.target) || !within(panel, e.target)) closeAll();
      return;
    }
    if (within(bar, e.target) && !covered()) { e.stopImmediatePropagation(); openAll(); }
  }

  // ---------------------------------------------------------------- start

  function build() {
    var when = $('when'), now = $('now');
    if (!when || !now) return;
    greet = document.createElement('div');
    greet.id = 'ghGreet';
    when.insertBefore(greet, when.firstChild);
    weather = document.createElement('div');
    weather.id = 'ghWeather';
    now.appendChild(weather);
    bar = document.createElement('div');
    bar.id = 'ghBar';
    bar.textContent = t('home.carousel.allApps', 'All apps');
    stage.appendChild(bar);
    panel = document.createElement('section');
    panel.id = 'ghAll';
    panel.innerHTML = '<div class="head"><div><h2>' + esc(t('home.carousel.allApps', 'All apps')) + '</h2>' +
      '<p>' + esc(t('home.carousel.allAppsDesc', 'Every app on this TV not hidden, those off the Apps row too.')) + '</p>' +
      '<div class="msg" id="ghAllMsg"></div></div>' +
      '<span class="back" id="ghAllBack">' + esc(t('home.carousel.back', 'Back to the carousel')) + ' ↑</span></div>' +
      '<div class="gwrap"><div id="ghAllGrid"></div></div>';
    stage.appendChild(panel);
    grid = $('ghAllGrid');
  }

  build();
  renderGreeting();
  // The rows and More apps are rebuilt by the page; their new tiles are coloured as they come.
  if (window.MutationObserver) {
    var watch = new MutationObserver(function () { decorate($('rows')); decorate($('folderGrid')); decorate(grid); });
    ['rows', 'folderGrid', 'ghAllGrid'].forEach(function (id) { if ($(id)) watch.observe($(id), { childList: true, subtree: true }); });
    // The view switched to from another: weather and colours at once.
    new MutationObserver(function () {
      if (!on()) { closeAll(); setBar(false); return; }
      decorate($('rows'));
      refreshWeather();
    }).observe(stage, { attributes: true, attributeFilter: ['class'] });
  }
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('mousemove', onPointer, true);
  window.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { closeAll(); setBar(false); return; }
    renderGreeting();
    refreshWeather();
  });
  document.addEventListener('webOSRelaunch', function () { closeAll(); setBar(false); });
  setInterval(function () { renderGreeting(); refreshWeather(); }, 60000);
})();
