// Live forecast from Open-Meteo (free, no key). The last forecast is kept for 3 hours.

const CACHE = 'nd-forecast';
const MAX_AGE = 3 * 60 * 60 * 1000;

// WMO weather codes → words
function describe(code) {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}
const wet = code => (code >= 51 && code <= 67) || (code >= 71 && code <= 86) || code >= 95;

export function cached() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
    return c && c.days ? c : null;
  } catch (e) { return null; }
}
export const isFresh = c => !!c && Date.now() - c.at < MAX_AGE;

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('no_geo')); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) }),
      e => reject(new Error(e.code === 1 ? 'denied' : 'unavailable')),
      { maximumAge: 30 * 60 * 1000, timeout: 15000 }
    );
  });
}

// Uses the saved spot unless askLocation is true (first time or "update location")
export async function forecast({ askLocation = false } = {}) {
  const prev = cached();
  const spot = !askLocation && prev?.lat != null ? { lat: prev.lat, lon: prev.lon } : await position();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat}&longitude=${spot.lon}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=2';
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('http');
    data = await res.json();
  } catch (e) { throw new Error('offline'); }
  const d = data.daily;
  const days = [0, 1].map(k => {
    const hi = Math.round(d.temperature_2m_max[k]), lo = Math.round(d.temperature_2m_min[k]);
    const code = d.weather_code[k], chance = d.precipitation_probability_max?.[k] ?? 0;
    return {
      // Dress for the warm part of the day, leaning a little toward the low
      temp: Math.round(hi * 0.65 + lo * 0.35), high: hi, low: lo, chance,
      cond: describe(code), rain: wet(code) || chance >= 50,
    };
  });
  const out = { at: Date.now(), lat: spot.lat, lon: spot.lon, days };
  try { localStorage.setItem(CACHE, JSON.stringify(out)); } catch (e) {}
  return out;
}
