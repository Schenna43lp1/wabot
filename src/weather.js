// Weather from Open-Meteo: free, no key. Only the place name and its coordinates leave the PC.
import { UserError } from './errors.js';

const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 10_000;
const UNAVAILABLE = 'Das Wetter ist gerade nicht abrufbar. Versuch es später noch einmal.';

// WMO weather codes
const CODES = {
  0: ['☀️', 'klar'], 1: ['🌤️', 'überwiegend klar'], 2: ['⛅', 'teils bewölkt'], 3: ['☁️', 'bewölkt'],
  45: ['🌫️', 'Nebel'], 48: ['🌫️', 'Nebel mit Reif'],
  51: ['🌦️', 'leichter Nieselregen'], 53: ['🌦️', 'Nieselregen'], 55: ['🌧️', 'starker Nieselregen'],
  56: ['🌧️', 'gefrierender Niesel'], 57: ['🌧️', 'gefrierender Niesel'],
  61: ['🌧️', 'leichter Regen'], 63: ['🌧️', 'Regen'], 65: ['🌧️', 'starker Regen'],
  66: ['🌧️', 'gefrierender Regen'], 67: ['🌧️', 'gefrierender Regen'],
  71: ['🌨️', 'leichter Schneefall'], 73: ['🌨️', 'Schneefall'], 75: ['❄️', 'starker Schneefall'], 77: ['🌨️', 'Schneegriesel'],
  80: ['🌦️', 'leichte Regenschauer'], 81: ['🌧️', 'Regenschauer'], 82: ['⛈️', 'heftige Regenschauer'],
  85: ['🌨️', 'Schneeschauer'], 86: ['🌨️', 'starke Schneeschauer'],
  95: ['⛈️', 'Gewitter'], 96: ['⛈️', 'Gewitter mit Hagel'], 99: ['⛈️', 'Gewitter mit Hagel'],
};
const describe = (code) => CODES[code] ?? ['🌡️', 'wechselhaft'];
const degrees = (value) => `${Math.round(value)}`.replace('-', '−');

export function createWeather({ fetch = globalThis.fetch } = {}) {
  async function getJson(url) {
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
    } catch {
      throw new UserError(UNAVAILABLE, 'temporary');
    }
    if (!response.ok) throw new UserError(UNAVAILABLE, 'temporary');
    return response.json();
  }

  /** "Wien" → { place: 'Wien, Österreich', lat, lon } or null */
  async function findPlace(name) {
    const url = new URL(GEOCODING);
    url.search = new URLSearchParams({ name, count: '1', language: 'de', format: 'json' });
    const found = (await getJson(url)).results?.[0];
    if (!found) return null;
    const place = [found.name, found.country].filter(Boolean).join(', ');
    return { place, lat: found.latitude, lon: found.longitude };
  }

  /** Today and tomorrow at the place. */
  async function forecast({ lat, lon }) {
    const url = new URL(FORECAST);
    url.search = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'temperature_2m,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
      forecast_days: '2',
    });
    const data = await getJson(url);
    const day = (i) => ({
      code: data.daily?.weather_code?.[i],
      min: data.daily?.temperature_2m_min?.[i],
      max: data.daily?.temperature_2m_max?.[i],
      rain: data.daily?.precipitation_probability_max?.[i],
    });
    if (day(0).min == null) throw new UserError(UNAVAILABLE, 'temporary');
    return { now: { temperature: data.current?.temperature_2m, code: data.current?.weather_code }, today: day(0), tomorrow: day(1) };
  }

  return { findPlace, forecast };
}

function dayText({ code, min, max, rain }) {
  const [icon, text] = describe(code);
  const chance = rain != null ? `, Regen ${rain} %` : '';
  return { icon, text: `${degrees(min)} bis ${degrees(max)} °C, ${text}${chance}` };
}

/** One line for the briefing, plus a tip if needed. */
export function todayText(place, weather) {
  const today = dayText(weather.today);
  const lines = [`${today.icon} *${place.split(',')[0]}:* ${today.text}`];
  if (weather.today.rain >= 50) lines.push('☂️ Schirm mitnehmen');
  if (weather.today.min <= 0) lines.push('🧊 Frost, Vorsicht bei Glätte');
  return lines.join('\n');
}

/** The answer to "wetter". Asked about tomorrow, tomorrow comes first. */
export function weatherText(place, weather, { tomorrowFirst = false } = {}) {
  const lines = [todayText(place, weather).replace(':*', ' heute:*')];
  if (weather.now.temperature != null) {
    lines.push(`Jetzt ${degrees(weather.now.temperature)} °C, ${describe(weather.now.code)[1]}`);
  }
  if (weather.tomorrow.min != null) {
    const tomorrow = dayText(weather.tomorrow);
    if (tomorrowFirst) return [`${tomorrow.icon} *${place.split(',')[0]} morgen:* ${tomorrow.text}`, '', ...lines].join('\n');
    lines.push(`${tomorrow.icon} *Morgen:* ${tomorrow.text}`);
  }
  return lines.join('\n');
}
