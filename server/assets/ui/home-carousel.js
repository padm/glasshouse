// The Home tab's Carousel View (home-carousel.js on the TV) and the weather it
// shows (lib/home-weather.js). Apart from home.js, which calls renderHomeCarousel.

let homeWeather = null;  // { place, unit, weather } as the server has them
let homeWeatherBusy = false;

function homeCarousel() {
  homeSaveLayout({ view: homeLayout.view === 'carousel' ? 'standard' : 'carousel' });
}

function renderHomeCarousel(st) {
  const row = q('home-carousel-row');
  if (row) row.hidden = !st.supported.ok;
  const btn = q('home-carousel');
  if (btn) {
    const on = !!st.layout && st.layout.view === 'carousel';
    updateToggle(btn, { cls: on ? 'good' : 'idle', label: on ? t('common.on', 'On') : t('common.off', 'Off') });
    btn.disabled = !homeWritable();
  }
  const weatherRow = q('home-weather-row');
  if (weatherRow) weatherRow.hidden = !st.supported.ok;
  if (!homeWeather && !homeWeatherBusy && st.supported.ok) loadHomeWeather();
  renderHomeWeather(false);
}

async function loadHomeWeather() {
  homeWeatherBusy = true;
  try { homeWeather = await homeGet('/api/home/weather'); } catch (e) { homeWeather = { place: null, unit: 'celsius', weather: null }; }
  homeWeatherBusy = false;
  renderHomeWeather(true);
}

function homeWeatherPlaceName(p) {
  return [p.name, p.region, p.country].filter(Boolean).join(', ');
}

// fill: put the saved place and unit back in the form, as after loading or saving.
function renderHomeWeather(fill) {
  const place = q('home-weather-place'), unit = q('home-weather-unit'), now = q('home-weather-now'), save = q('home-weather-save');
  if (!place || !homeWeather) return;
  const p = homeWeather.place, w = homeWeather.weather;
  if (fill) {
    place.value = p ? p.name : '';
    unit.value = homeWeather.unit || 'celsius';
  }
  now.textContent = !p ? t('home.weatherNone', 'No place chosen, so no weather shows.')
    : w ? t('home.weatherNow', '{place}: {temp} now', { place: homeWeatherPlaceName(p), temp: Math.round(w.temp) + (homeWeather.unit === 'fahrenheit' ? '°F' : '°C') })
    : t('home.weatherWaiting', '{place}: Open-Meteo has not answered yet', { place: homeWeatherPlaceName(p) });
  const locked = homeWeatherBusy || !homeWritable();
  save.disabled = locked;
  unit.disabled = locked;
  place.disabled = locked;
}

// unitOnly: the unit changed, the place stays as saved rather than looked up again.
async function homeWeatherSave(unitOnly) {
  if (!homeWritable() || homeWeatherBusy) return;
  const typed = q('home-weather-place').value.trim();
  const body = { unit: q('home-weather-unit').value, lang: document.documentElement.getAttribute('lang') || 'en' };
  const saved = homeWeather && homeWeather.place;
  if (unitOnly !== true && !(saved && typed === saved.name)) body.place = typed;
  homeWeatherBusy = true;
  renderHomeWeather(false);
  try {
    homeWeather = await homePost('/api/home/weather', body);
    homeWeatherBusy = false;
    renderHomeWeather(true);
  } catch (e) {
    homeWeatherBusy = false;
    showErr(e.message);
    renderHomeWeather(false);
  }
}
