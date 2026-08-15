import { env } from '../config/env.js';

// WeatherProvider interface (spec section 28): getCurrentWeather(zone) and
// getForecast(zone). Only this file knows whether we're running against a
// real API or a mock — every caller (environmentalController etc.) is
// agnostic to that.
//
// MOCK mode is active whenever WEATHER_API_KEY is unset. It generates
// plausible-looking but clearly-labelled synthetic data (source: 'MOCK')
// deterministically seeded by zone id + hour, so repeated calls in the
// same hour return stable numbers instead of flickering on every refresh.
//
// Real mode calls OpenWeatherMap (free tier: https://openweathermap.org/api,
// "Current Weather Data" + "5 Day / 3 Hour Forecast" — both included in the
// free plan). Uses Node's built-in fetch (Node 18+), no extra dependency.

const OWM_BASE = 'https://api.openweathermap.org/data/2.5';

function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function hourSeed(zoneId) {
  const hour = new Date().getUTCHours();
  let hash = 0;
  for (const ch of zoneId) hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  return hash + hour;
}

async function owmFetch(path, zone) {
  const url = `${OWM_BASE}${path}?lat=${zone.latitude}&lon=${zone.longitude}&units=metric&appid=${env.weatherApiKey}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`OpenWeatherMap injoignable (${err.message})`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`OpenWeatherMap ${res.status} — ${body.message || 'erreur inconnue'}`);
  }
  return res.json();
}

// OpenWeatherMap's 3-hour forecast entries don't expose a standalone
// "rain in the next 3h" figure consistently across weather conditions —
// `rain['3h']` is only present when it's actually raining. Missing = 0mm.
function rainOf(entry) {
  return entry.rain?.['1h'] ?? entry.rain?.['3h'] ?? 0;
}

export const weatherService = {
  isMock: !env.weatherApiKey,

  async getCurrentWeather(zone) {
    if (!this.isMock) {
      const data = await owmFetch('/weather', zone);
      return {
        source: 'OpenWeatherMap',
        zoneId: zone.id,
        timestamp: new Date().toISOString(),
        rainfall: rainOf(data),
        temperature: data.main?.temp ?? null,
        humidity: data.main?.humidity ?? null,
        windSpeed: data.wind?.speed ?? null,
        rawData: data,
      };
    }
    const r = seededRandom(hourSeed(zone.id));
    return {
      source: 'MOCK',
      zoneId: zone.id,
      timestamp: new Date().toISOString(),
      rainfall: Math.round(r * 90 * 10) / 10, // mm
      temperature: Math.round((24 + r * 8) * 10) / 10,
      humidity: Math.round(55 + r * 40),
      windSpeed: Math.round((5 + r * 20) * 10) / 10,
    };
  },

  async getForecast(zone, days = 5) {
    if (!this.isMock) {
      const data = await owmFetch('/forecast', zone);
      // OpenWeatherMap's free forecast endpoint returns 3-hour steps for
      // 5 days (40 entries) — collapse to one summary per day.
      const byDay = new Map();
      for (const entry of data.list || []) {
        const day = entry.dt_txt.slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(entry);
      }
      return [...byDay.entries()].slice(0, days).map(([day, entries], i) => {
        const temps = entries.map((e) => e.main?.temp).filter((t) => t != null);
        const rainChances = entries.map((e) => e.pop ?? 0);
        return {
          source: 'OpenWeatherMap',
          dayOffset: i,
          date: day,
          precipChance: Math.round(Math.max(...rainChances) * 100),
          tempMin: temps.length ? Math.round(Math.min(...temps)) : null,
          tempMax: temps.length ? Math.round(Math.max(...temps)) : null,
        };
      });
    }
    return Array.from({ length: days }, (_, i) => {
      const r = seededRandom(hourSeed(zone.id) + i * 7);
      return {
        source: 'MOCK',
        dayOffset: i,
        precipChance: Math.round(r * 100),
        tempMin: Math.round(21 + r * 4),
        tempMax: Math.round(28 + r * 5),
      };
    });
  },
};