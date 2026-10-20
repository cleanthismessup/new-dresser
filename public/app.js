import * as Gemini from './gemini.js';
import * as Weather from './weather.js';
import * as Backup from './backup.js';
import * as Cutout from './cutout.js';

// ---------- Reference data ----------
const CATS = [
  { id: 'top', label: 'Tops', one: 'Top' },
  { id: 'bottom', label: 'Bottoms', one: 'Bottom' },
  { id: 'dress', label: 'Dresses', one: 'Dress' },
  { id: 'outer', label: 'Outerwear', one: 'Outerwear' },
  { id: 'shoes', label: 'Shoes', one: 'Shoes' },
  { id: 'bag', label: 'Bags', one: 'Bag' },
  { id: 'acc', label: 'Accessories', one: 'Accessory' },
];
const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
const COLORS = {
  black: '#1d1d1f', white: '#f7f7f4', grey: '#9a9ca0', navy: '#25304f', blue: '#4a78c2',
  green: '#3f8a5a', olive: '#6f7342', beige: '#d8c6a5', brown: '#7a5232', red: '#c0392b',
  pink: '#e8a0b4', purple: '#7d5ba6', yellow: '#e8c547', orange: '#e07b39', silver: '#c4c7cc',
};
const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
const SEASON_ABBR = { Spring: 'SP', Summer: 'SU', Fall: 'FA', Winter: 'WI' };
const OCCASIONS = ['Casual', 'School', 'Party', 'Work', 'Sport', 'Formal'];
// Piece attributes. Each list can be extended by the user ("+ Add"); custom values live in settings.tags
const TAGS = {
  fit: { label: 'Fit', options: ['Slim', 'Regular', 'Relaxed', 'Boxy', 'Oversized', 'Cropped', 'Tailored', 'Wide'] },
  goodFor: { label: 'Good for', options: ['Rain', 'Wind', 'Cold', 'Heat', 'Snow', 'Sport', 'Travel'] },
  style: { label: 'Style', options: ['Casual', 'Streetwear', 'Minimal', 'Classic', 'Sporty', 'Smart', 'Chic', 'Vintage', 'Preppy', 'Edgy'] },
};
const COMFY = ['Not comfy', 'A bit stiff', 'Okay', 'Comfy', 'Like pajamas'];
const tagOptions = key => [...TAGS[key].options, ...((state.settings.tags || {})[key] || [])];
const WARMTH = [{ v: 1, label: 'Light' }, { v: 2, label: 'Medium' }, { v: 3, label: 'Warm' }];
const WASH_OPTS = [[1, 'After every wear'], [2, 'Every 2 wears'], [3, 'Every 3 wears'], [5, 'Every 5 wears'], [10, 'Every 10 wears'], [0, "Doesn't go in the wash"]];
const WASH_DEFAULT = { top: 1, bottom: 4, dress: 2, outer: 10, shoes: 0, bag: 0, acc: 0 };
const WARMTH_DEFAULT = { top: 1, bottom: 1, dress: 1, outer: 3, shoes: 1, bag: 1, acc: 1 };
const LOADS = {
  whites: { label: 'Whites & lights', hint: 'Warm wash' },
  darks: { label: 'Darks', hint: 'Cold wash, inside out' },
  colors: { label: 'Colors', hint: 'Cold wash' },
  delicates: { label: 'Delicates', hint: 'Hand wash or gentle cycle' },
};
// Manual weather presets, used offline or before location is allowed
const WEATHER = [
  { id: 'freezing', temp: 2, cond: 'Clear and cold', rain: false },
  { id: 'cool', temp: 11, cond: 'Cloudy', rain: false },
  { id: 'rain', temp: 12, cond: 'Rain all day', rain: true },
  { id: 'mild', temp: 19, cond: 'Sunny', rain: false },
  { id: 'hot', temp: 29, cond: 'Hot and humid', rain: false },
];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD'];

// Garment silhouettes, viewBox 0 0 100 100
const SIL = {
  top: '<path d="M32 16 L43 12 Q50 20 57 12 L68 16 L88 33 L78 45 L70 38 L70 88 L30 88 L30 38 L22 45 L12 33 Z"/>',
  bottom: '<path d="M30 12 L70 12 L74 90 L56 90 L50 38 L44 90 L26 90 Z"/>',
  dress: '<path d="M40 10 L46 10 Q50 16 54 10 L60 10 L60 30 L78 90 L22 90 L40 30 Z"/>',
  outer: '<path d="M36 10 L44 10 L50 26 L56 10 L64 10 L86 24 L84 64 L76 64 L76 90 L54 90 L50 32 L46 90 L24 90 L24 64 L16 64 L14 24 Z"/>',
  shoes: '<path d="M12 64 L12 44 L30 44 Q38 57 56 60 L80 64 Q90 66 90 75 L90 80 L12 80 Z"/>',
  bag: '<path d="M38 40 Q38 18 50 18 Q62 18 62 40" fill="none" stroke-width="5"/><path d="M22 40 L78 40 L84 88 L16 88 Z"/>',
  acc: '<path d="M22 62 Q24 30 50 28 Q76 30 78 62 Z"/><path d="M10 62 L90 62 L90 72 L10 72 Z"/>',
};

// ---------- Storage (IndexedDB, memory fallback) ----------
const STORES = ['items', 'outfits', 'wish', 'meta'];
const Store = (() => {
  let db = null;
  const mem = Object.fromEntries(STORES.map(s => [s, new Map()]));
  let stalled = false;
  function open() {
    return new Promise(resolve => {
      let done = false;
      const finish = ok => { if (!done) { done = true; resolve(ok); } };
      // Some iOS Safari versions never answer the first open: don't wait forever
      setTimeout(() => { if (!done) { stalled = true; finish(false); } }, 3000);
      try {
        const req = indexedDB.open('new-dresser', 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
        };
        req.onsuccess = () => {
          // Answered too late: this session already runs from memory, so don't mix the two
          if (done) { try { req.result.close(); } catch (e) {} return; }
          db = req.result; finish(true);
        };
        req.onerror = () => finish(false);
        req.onblocked = () => finish(false);
      } catch (e) { finish(false); }
    });
  }
  function all(store) {
    if (!db) return Promise.resolve([...mem[store].values()]);
    return new Promise(resolve => {
      try {
        const req = db.transaction(store).objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) { resolve([]); }
    });
  }
  function write(store, op) {
    if (!db) return Promise.resolve(true);
    return new Promise(resolve => {
      try {
        const t = db.transaction(store, 'readwrite');
        op(t.objectStore(store));
        t.oncomplete = () => resolve(true);
        t.onerror = () => resolve(false);
        t.onabort = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }
  return {
    open, all,
    persistent: () => !!db,
    stalled: () => stalled,
    put: (store, obj) => { mem[store].set(obj.id, obj); return write(store, s => s.put(obj)); },
    del: (store, id) => { mem[store].delete(id); return write(store, s => s.delete(id)); },
    clear: (store) => { mem[store].clear(); return write(store, s => s.clear()); },
  };
})();

// ---------- State ----------
const VIEWS = ['today', 'closet', 'outfits', 'laundry', 'wish'];
const state = {
  view: 'today',
  items: [], outfits: [], wish: [],
  settings: { id: 'settings', currency: 'USD', unit: 'C' },
  closet: { q: '', cat: 'all', color: null, sort: 'new', cleanOnly: false },
  today: { weather: 'cool', occasion: 'School', live: false, day: 0 },
};
try {
  const v = localStorage.getItem('nd-view'); if (VIEWS.includes(v)) state.view = v;
  const t = JSON.parse(localStorage.getItem('nd-today') || 'null'); if (t) Object.assign(state.today, t);
} catch (e) {}

// ---------- Theme (light / dark / follow the phone) ----------
const root = document.documentElement;
const hostTheme = root.getAttribute('data-theme');
const darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let themePref = 'system';
try { const t = localStorage.getItem('nd-theme'); if (['light', 'dark', 'system'].includes(t)) themePref = t; } catch (e) {}
function applyTheme() {
  if (themePref === 'system') { if (hostTheme) root.setAttribute('data-theme', hostTheme); else root.removeAttribute('data-theme'); }
  else root.setAttribute('data-theme', themePref);
  const attr = root.getAttribute('data-theme');
  const dark = attr ? attr === 'dark' : !!darkMq?.matches;
  root.classList.toggle('is-dark', dark);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}
function setTheme(t) { themePref = t; try { localStorage.setItem('nd-theme', t); } catch (e) {} applyTheme(); }
darkMq?.addEventListener?.('change', applyTheme);
applyTheme();

const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => isoDate(new Date());
const itemById = id => state.items.find(i => i.id === id);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function daysSince(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((now - new Date(y, m - 1, d)) / 86400000);
}
function daysAgo(iso) {
  const n = daysSince(iso);
  if (n == null) return 'Never';
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 30) return `${n} days ago`;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function money(v) {
  if (v == null || v === '' || isNaN(v)) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, maximumFractionDigits: v % 1 ? 2 : 0 }).format(v); }
  catch (e) { return '$' + Number(v).toFixed(2); }
}
const temp = c => state.settings.unit === 'F' ? `${Math.round(c * 9 / 5 + 32)}°F` : `${c}°C`;
const parsePrice = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) || n < 0 ? null : Math.round(n * 100) / 100; };

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
async function save(store, obj) {
  const ok = await Store.put(store, obj);
  if (!ok) toast("Couldn't save to this device. Storage may be full.");
  return ok;
}

// Fill fields added after v1 so older saved items keep working
function normalizeItem(i) {
  return {
    colors: [], seasons: [], brand: '', notes: '', photo: null, fav: false, wornCount: 0, lastWorn: null,
    model: '', link: '', price: null, warmth: WARMTH_DEFAULT[i.category] || 1, washEvery: WASH_DEFAULT[i.category] ?? 1,
    wearsSinceWash: 0, status: 'clean', delicate: false, lastWashed: null,
    fit: [], comfy: null, goodFor: [], style: [], ...i,
  };
}
function normalizeOutfit(o) {
  const occ = o.occasions || (o.occasion ? [o.occasion] : []);
  return { wornDates: [], ...o, occasions: occ };
}
function loadFor(i) {
  if (i.delicate) return 'delicates';
  const c = i.colors?.[0];
  if (['white', 'beige', 'silver', 'yellow'].includes(c)) return 'whites';
  if (['black', 'navy', 'brown', 'olive', 'grey', 'purple'].includes(c)) return 'darks';
  return 'colors';
}
const washable = i => i.washEvery > 0;
const isDirty = i => i.status === 'dirty';

// ---------- Visuals ----------
let silN = 0;
function silhouette(item) {
  const c1 = COLORS[item.colors?.[0]] || COLORS.grey;
  const c2 = item.colors?.[1] ? COLORS[item.colors[1]] : null;
  let fill = c1, defs = '';
  if (c2) {
    const pid = 'p' + (++silN);
    defs = `<defs><pattern id="${pid}" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="${c1}"/><rect width="12" height="5" fill="${c2}"/></pattern></defs>`;
    fill = `url(#${pid})`;
  }
  const light = [COLORS.white, COLORS.beige, COLORS.silver].includes(c1);
  return `<svg class="sil" viewBox="0 0 100 100" aria-hidden="true">${defs}<g fill="${fill}" stroke="${light ? 'rgba(0,0,0,.28)' : 'rgba(0,0,0,.12)'}" stroke-width="1.5" stroke-linejoin="round">${(SIL[item.category] || SIL.top).replace('fill="none" stroke-width="5"', `fill="none" stroke="${c1}" stroke-width="5"`)}</g></svg>`;
}
// Official photos are links: shown when online, falling back to the saved photo (or outline) when they fail
function pic(item) {
  if (item.officialUrl && navigator.onLine !== false) {
    const fb = item.photo ? `data-fb-src="${esc(item.photo)}"` : `data-fb-item="${esc(item.id)}"`;
    return `<img src="${esc(item.officialUrl)}" alt="${esc(item.name)}" loading="lazy" referrerpolicy="no-referrer" ${fb}>`;
  }
  return item.photo ? `<img src="${item.photo}" alt="${esc(item.name)}" loading="lazy">` : silhouette(item);
}
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.fbSrc) { const src = img.dataset.fbSrc; delete img.dataset.fbSrc; img.src = src; }
  else if (img.dataset.fbItem) {
    const id = img.dataset.fbItem; delete img.dataset.fbItem;
    const it = itemById(id) || state.wish.find(w => w.id === id);
    if (it) img.outerHTML = silhouette(it);
  }
}, true);
const dots = colors => `<span class="dots">${(colors || []).map(c => `<span class="dot" style="background:${COLORS[c]}" title="${c}"></span>`).join('')}</span>`;
function itemTag(item) {
  const parts = [CAT[item.category]?.one || ''];
  if (item.price != null) parts.push(money(item.price));
  parts.push(`${item.wornCount || 0}× worn`);
  return parts.join(' · ');
}
function collage(ids, showDirty = true) {
  const its = ids.map(itemById).filter(Boolean).slice(0, 4);
  if (!its.length) return `<div class="collage n0"><div><span class="count">No items</span></div></div>`;
  return `<div class="collage n${its.length}">${its.map(i => `<div class="${showDirty && isDirty(i) ? 'dirty' : ''}">${pic(i)}${showDirty && isDirty(i) ? '<span class="pill warn mark">Hamper</span>' : ''}</div>`).join('')}</div>`;
}
function spark(prices, target, cls = 'spark') {
  const w = 200, h = cls === 'spark' ? 34 : 90, pad = 5;
  const vals = prices.map(p => p.price);
  const dom = target != null ? [...vals, target] : vals;
  const min = Math.min(...dom), max = Math.max(...dom), span = max - min || 1;
  const y = v => pad + (max - v) / span * (h - pad * 2);
  const x = i => vals.length < 2 ? w / 2 : pad + i / (vals.length - 1) * (w - pad * 2);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = vals.length < 2 ? `${pad},${y(vals[0])} ${w - pad},${y(vals[0])}` : pts.join(' ');
  const area = vals.length < 2 ? '' : `<polygon points="${pad},${h} ${pts.join(' ')} ${w - pad},${h}" fill="var(--accent-soft)"/>`;
  const tgt = target != null ? `<line x1="0" x2="${w}" y1="${y(target)}" y2="${y(target)}" stroke="var(--good)" stroke-width="1.2" stroke-dasharray="4 4"/>` : '';
  const last = vals.length < 2 ? [w - pad, y(vals[0])] : [x(vals.length - 1), y(vals[vals.length - 1])];
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${area}${tgt}<polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="var(--accent)"/></svg>`;
}

// ---------- Recommendation (rule-based scoring) ----------
function weatherNow() {
  const d = state.today.live && state.forecast?.days?.[state.today.day || 0];
  if (d) return { id: 'live', ...d };
  return WEATHER.find(w => w.id === state.today.weather) || WEATHER[1];
}
async function refreshWeather(ask) {
  state.weatherBusy = true; render();
  try {
    state.forecast = await Weather.forecast({ askLocation: ask });
    state.today.live = true; persistToday();
  } catch (e) {
    const msgs = {
      denied: 'Location is off for this app. Turn it on in iPhone Settings → Privacy → Location Services → Safari Websites, or set the weather by hand.',
      unavailable: "Couldn't find your location. Try again outside or set the weather by hand.",
      no_geo: "This browser can't share your location. Set the weather by hand.",
      offline: state.forecast ? "Couldn't update the forecast. Showing the last one." : "Couldn't get the forecast. Check your internet connection.",
    };
    toast(msgs[e.message] || msgs.offline);
  }
  state.weatherBusy = false; render();
}
function weatherCard(w) {
  const f = state.forecast;
  if (state.today.live && f) {
    const upd = new Date(f.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `<div class="weather">
      <div class="row between"><span class="temp">${temp(w.temp)}</span>
        <div class="chips" style="padding:0">${['Today', 'Tomorrow'].map((l, k) => `<button class="chip" data-action="weather-day" data-v="${k}" aria-pressed="${(state.today.day || 0) === k}">${l}</button>`).join('')}</div></div>
      <span class="cond">${esc(w.cond)} · high ${temp(w.high)}, low ${temp(w.low)} · ${w.chance}% chance of rain</span>
      <div class="row" style="margin-top:6px"><span class="count">${state.weatherBusy ? 'Updating…' : `Updated ${upd}`}</span>
        <button class="linkbtn" data-action="weather-refresh">Refresh</button>
        <button class="linkbtn" data-action="weather-manual">Set by hand</button></div>
    </div>`;
  }
  return `<div class="weather">
    <div class="row between"><span class="temp">${temp(w.temp)}</span><span class="pill">Set by hand</span></div>
    <span class="cond">${esc(w.cond)}</span>
    <div class="chips" role="group" aria-label="Weather">
      ${WEATHER.map(x => `<button class="chip" data-action="weather" data-v="${x.id}" aria-pressed="${x.id === w.id}">${temp(x.temp)} ${x.rain ? 'rain' : x.cond.split(' ')[0].toLowerCase()}</button>`).join('')}
    </div>
    <div class="row"><button class="btn small" data-action="weather-live" ${state.weatherBusy ? 'disabled' : ''}>${state.weatherBusy ? 'Getting the forecast…' : f ? 'Use live weather' : 'Use my location for live weather'}</button></div>
  </div>`;
}
function backupBanner() {
  if (!state.items.some(i => !i.sample)) return '';
  const days = state.lastBackup ? Math.floor((Date.now() - state.lastBackup) / 86400000) : null;
  if (days != null && days < 14) return '';
  return `<div class="banner"><span>${days == null ? "Your closet isn't backed up yet." : `Last backup was ${days} days ago.`} Save a copy to iCloud Drive.</span><button class="linkbtn" data-action="backup-now">Back up now</button></div>`;
}
function weatherTarget(w) {
  const t = w.temp;
  return {
    seasons: t < 8 ? ['Winter'] : t < 16 ? ['Fall', 'Spring', 'Winter'] : t < 24 ? ['Spring', 'Fall', 'Summer'] : ['Summer'],
    warmth: t < 8 ? 3 : t < 16 ? 2.3 : t < 24 ? 1.5 : 1,
    needsLayer: t < 14 || w.rain,
  };
}
function scoreOutfit(o, w, occasion) {
  const its = o.itemIds.map(itemById).filter(Boolean);
  if (!its.length) return null;
  const tgt = weatherTarget(w);
  const reasons = [], cautions = [];
  let score = 0, maxScore = 60;
  const dirty = its.filter(isDirty);

  if (occasion) {
    maxScore += 40;
    if (o.occasions.includes(occasion)) { score += 40; reasons.push(`Tagged for ${occasion.toLowerCase()}`); }
    else cautions.push(`Not tagged for ${occasion.toLowerCase()}`);
  }
  const clothing = its.filter(i => ['top', 'bottom', 'dress', 'outer'].includes(i.category));
  const warmth = clothing.length ? Math.max(...clothing.map(i => i.warmth)) : 1;
  const diff = Math.abs(warmth - tgt.warmth);
  score += Math.max(0, 30 - diff * 15);
  if (diff < 0.8) reasons.push(`Right warmth for ${temp(w.temp)}`);
  else cautions.push(warmth > tgt.warmth ? `Probably too warm for ${temp(w.temp)}` : `Probably too cold for ${temp(w.temp)}`);
  if (tgt.needsLayer && !its.some(i => i.category === 'outer')) { score -= 10; cautions.push(w.rain ? 'No jacket for the rain' : 'No jacket or coat'); }

  const has = tag => its.filter(i => (i.goodFor || []).includes(tag));
  if (w.rain) {
    const dry = has('Rain');
    if (dry.length) { score += 8; reasons.push(`${dry[0].name} handles rain`); }
  }
  if (w.temp < 8 && has('Cold').length) { score += 6; reasons.push(`${has('Cold')[0].name} is made for the cold`); }
  if (w.temp >= 24) {
    if (has('Heat').length) { score += 6; reasons.push(`${has('Heat')[0].name} is good in the heat`); }
    if (has('Cold').length) { score -= 8; cautions.push(`${has('Cold')[0].name} is made for cold weather`); }
  }
  const rated = its.filter(i => i.comfy);
  if (rated.length) {
    const avg = rated.reduce((n, i) => n + i.comfy, 0) / rated.length;
    score += (avg - 3) * 3;
    if (avg >= 4) reasons.push(`Comfy: ${avg.toFixed(1)} out of 5`);
    else if (avg <= 2) cautions.push(`Not very comfy: ${avg.toFixed(1)} out of 5`);
  }

  const seasonal = its.filter(i => (i.seasons || []).some(s => tgt.seasons.includes(s))).length / its.length;
  score += seasonal * 10;

  const ds = daysSince((o.wornDates || []).slice(-1)[0]);
  score += Math.min(ds == null ? 21 : ds, 21) / 21 * 20;
  if (ds == null) reasons.push('You haven\'t worn it yet');
  else if (ds >= 7) reasons.push(`Last worn ${ds} days ago`);
  else cautions.push(ds === 0 ? 'You wore it today' : `Worn ${ds === 1 ? 'yesterday' : ds + ' days ago'}`);

  if (!dirty.length) reasons.unshift('Every piece is clean');
  return { o, its, dirty, reasons, cautions, pct: Math.max(0, Math.min(100, Math.round(score / maxScore * 100))) };
}
function recommendations() {
  const w = weatherNow();
  const scored = state.outfits.map(o => scoreOutfit(o, w, state.today.occasion)).filter(Boolean);
  const ready = scored.filter(s => !s.dirty.length).sort((a, b) => b.pct - a.pct);
  const blocked = scored.filter(s => s.dirty.length).sort((a, b) => b.pct - a.pct);
  return { w, ready, blocked };
}

// ---------- Views ----------
function render() {
  silN = 0;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-current', t.dataset.tab === state.view ? 'page' : 'false'));
  const hamper = state.items.filter(isDirty).length;
  const hc = $('#hamperCount'); hc.hidden = !hamper; hc.textContent = hamper;
  const fabs = { closet: 'Add item', outfits: 'New outfit', wish: 'Add to wishlist' };
  $('#fab').hidden = !fabs[state.view];
  $('#fabLabel').textContent = fabs[state.view] || '';
  const v = $('#view');
  const warn = Store.stalled() ? `<div class="banner"><span>This phone's storage didn't respond, so nothing you change is saved right now. Close the app completely and open it again.</span></div>` : '';
  v.innerHTML = warn + ({ today: todayView, closet: closetView, outfits: outfitsView, laundry: laundryView, wish: wishView })[state.view]();
}

function examplesBanner() {
  const has = state.items.some(i => i.sample) || state.outfits.some(o => o.sample) || state.wish.some(w => w.sample);
  return has ? `<div class="banner"><span>Pieces marked Example are here so you can try things out.</span><button class="linkbtn" data-action="remove-samples">Remove examples</button></div>` : '';
}

function todayView() {
  const { w, ready, blocked } = recommendations();
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const top = ready[0];
  const alts = ready.slice(1, 4);
  const pickHtml = top ? `
    <div class="pick">
      ${collage(top.o.itemIds)}
      <div class="body">
        <div class="row between"><span class="pill accent">Top pick · ${top.pct}% match</span>${top.o.sample ? '<span class="pill">Example</span>' : ''}</div>
        <div class="name">${esc(top.o.name)}</div>
        <ul class="reasons">
          ${top.reasons.map(r => `<li><span class="ok">✓</span><span>${esc(r)}</span></li>`).join('')}
          ${top.cautions.map(r => `<li><span class="no">!</span><span>${esc(r)}</span></li>`).join('')}
        </ul>
        <div class="actions" style="margin-top:4px">
          ${state.today.live && state.today.day ? '' : `<button class="btn primary" data-action="wear-outfit" data-id="${top.o.id}">Wear this today</button>`}
          <button class="btn" data-action="open-outfit" data-id="${top.o.id}">See pieces</button>
        </div>
      </div>
    </div>` : state.outfits.length ? `<div class="empty"><strong>Nothing clean to suggest</strong><span>Every saved outfit has a piece in the hamper.</span><button class="btn" data-tab="laundry">Open laundry</button></div>`
    : `<div class="empty"><strong>No outfits saved yet</strong><span>Save a few outfits and this page will pick one for you each day.</span><button class="btn primary" data-action="new-outfit">New outfit</button></div>`;
  return `
    ${backupBanner()}
    <h2 class="view-title">${(state.today.live && state.today.day) ? 'Tomorrow' : dateStr}</h2>
    ${weatherCard(w)}
    <div class="section-lbl">Where are you going?</div>
    <div class="chips" role="group" aria-label="Occasion" style="padding-top:0">
      ${['', ...OCCASIONS].map(x => `<button class="chip" data-action="occasion" data-v="${x}" aria-pressed="${state.today.occasion === x}">${x || 'Anywhere'}</button>`).join('')}
    </div>
    <div class="section-lbl">What to wear</div>
    ${pickHtml}
    ${alts.length ? `<div class="section-lbl">Other good options</div><div class="alt-row">${alts.map(s => `
      <button class="ocard" data-action="open-outfit" data-id="${s.o.id}">${collage(s.o.itemIds)}
        <div class="body"><span class="name">${esc(s.o.name)}</span><span class="tag">${s.pct}% match</span></div></button>`).join('')}</div>` : ''}
    ${blocked.length ? `<div class="section-lbl">Waiting on laundry</div>${blocked.slice(0, 4).map(s => `
      <button class="blocked" data-tab="laundry"><span><b>${esc(s.o.name)}</b><br><span class="sub">${esc(s.dirty.map(i => i.name).join(', '))} in the hamper</span></span><span class="pill warn">${s.pct}%</span></button>`).join('')}` : ''}
  `;
}

function filteredItems() {
  const { q, cat, color, sort, cleanOnly } = state.closet;
  const needle = q.trim().toLowerCase();
  const list = state.items.filter(i =>
    (cat === 'all' || (cat === 'fav' ? i.fav : i.category === cat)) &&
    (!color || (i.colors || []).includes(color)) &&
    (!cleanOnly || !isDirty(i)) &&
    (!needle || [i.name, i.brand, i.model, i.notes, CAT[i.category]?.one, ...(i.fit || []), ...(i.goodFor || []), ...(i.style || [])].join(' ').toLowerCase().includes(needle))
  );
  const cpw = i => i.price == null ? Infinity : i.price / Math.max(1, i.wornCount || 0);
  const by = {
    new: (a, b) => b.created - a.created,
    most: (a, b) => (b.wornCount || 0) - (a.wornCount || 0),
    least: (a, b) => (a.wornCount || 0) - (b.wornCount || 0),
    stale: (a, b) => (a.lastWorn || '').localeCompare(b.lastWorn || ''),
    price: (a, b) => (b.price || 0) - (a.price || 0),
    cpw: (a, b) => cpw(b) - cpw(a),
    comfy: (a, b) => (b.comfy || 0) - (a.comfy || 0),
  };
  return list.sort(by[sort] || by.new);
}
function wardrobeStats() {
  const priced = state.items.filter(i => i.price != null);
  const value = priced.reduce((s, i) => s + i.price, 0);
  const wears = priced.reduce((s, i) => s + (i.wornCount || 0), 0);
  return { value, cpw: wears ? value / wears : null, priced: priced.length };
}

function closetView() {
  const c = state.closet;
  if (!state.items.length) {
    return `<div class="empty"><strong>Your closet is empty</strong><span>Take a photo of something you own to add your first piece.</span><button class="btn primary" data-action="add-item">Add item</button><button class="linkbtn" data-action="load-examples">Or try the app with example pieces</button></div>`;
  }
  const st = wardrobeStats();
  const usedColors = Object.keys(COLORS).filter(k => state.items.some(i => (i.colors || []).includes(k)));
  const list = filteredItems();
  return `
    ${examplesBanner()}
    <div class="stats">
      <div class="stat"><b>${money(st.value)}</b><span>closet value</span></div>
      <div class="stat"><b>${state.items.length}</b><span>pieces</span></div>
      <div class="stat"><b>${st.cpw == null ? '—' : money(st.cpw)}</b><span>avg per wear</span></div>
    </div>
    <div style="margin-top:12px"><input class="search" id="q" type="search" placeholder="Search name, brand, fit, style…" value="${esc(c.q)}" autocomplete="off"></div>
    <div class="chips" role="group" aria-label="Category">
      ${[{ id: 'all', label: 'All' }, { id: 'fav', label: '♥ Favorites' }, ...CATS].map(x => `<button class="chip" data-action="cat" data-v="${x.id}" aria-pressed="${c.cat === x.id}">${x.label}</button>`).join('')}
    </div>
    <div class="row between">
      <div class="swatches" role="group" aria-label="Color">
        ${usedColors.map(k => `<button class="sw" data-action="color" data-v="${k}" style="background:${COLORS[k]}" aria-label="${k}" aria-pressed="${c.color === k}"></button>`).join('')}
      </div>
      <div class="row">
        <button class="chip" data-action="clean-only" aria-pressed="${c.cleanOnly}">Clean only</button>
        <select class="sort" id="sort" aria-label="Sort">
          ${[['new', 'Newest'], ['most', 'Most worn'], ['least', 'Least worn'], ['stale', 'Not worn lately'], ['price', 'Highest price'], ['cpw', 'Highest cost per wear'], ['comfy', 'Most comfy']].map(([v, l]) => `<option value="${v}" ${c.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="count" style="margin-top:4px">${list.length} shown</div>
    ${list.length ? `<div class="grid">${list.map(itemCard).join('')}</div>` :
      `<div class="empty"><strong>Nothing matches</strong><span>Try another category or color.</span><button class="btn" data-action="reset-filters">Clear filters</button></div>`}
  `;
}

function itemCard(i) {
  return `<button class="card ${isDirty(i) ? 'dirty' : ''}" data-action="open-item" data-id="${i.id}">
    <div class="pic">${pic(i)}</div>
    <span class="badges">${i.sample ? '<span class="badge">Example</span>' : ''}${isDirty(i) ? '<span class="badge hamper">In hamper</span>' : ''}</span>
    ${i.fav ? '<span class="fav" aria-label="Favorite">♥</span>' : ''}
    <div class="body"><span class="name">${esc(i.name)}</span><span class="tag">${itemTag(i)}</span></div>
  </button>`;
}

function outfitsView() {
  if (!state.outfits.length) {
    return `<div class="empty"><strong>No outfits yet</strong><span>Combine pieces from your closet into looks you can reuse.</span><button class="btn primary" data-action="new-outfit">New outfit</button></div>`;
  }
  const f = state.outfitFilter || '';
  const list = state.outfits.filter(o => !f || o.occasions.includes(f)).sort((a, b) => b.created - a.created);
  return `
    ${examplesBanner()}
    <div class="chips" role="group" aria-label="Type of outing">
      ${['', ...OCCASIONS].map(x => `<button class="chip" data-action="outfit-filter" data-v="${x}" aria-pressed="${f === x}">${x || 'All outings'}</button>`).join('')}
    </div>
    ${list.length ? `<div class="olist">${list.map(o => {
      const dirty = o.itemIds.map(itemById).filter(i => i && isDirty(i)).length;
      const cost = o.itemIds.map(itemById).reduce((s, i) => s + (i?.price || 0), 0);
      return `<button class="ocard" data-action="open-outfit" data-id="${o.id}">
        ${collage(o.itemIds)}
        ${o.sample ? '<span class="badges"><span class="badge">Example</span></span>' : ''}
        <div class="body"><span class="name">${esc(o.name)}</span>
        <span class="taglist">${o.occasions.map(x => `<span class="pill">${esc(x)}</span>`).join('')}${dirty ? `<span class="pill warn">${dirty} in hamper</span>` : '<span class="pill good">Ready</span>'}</span>
        <span class="tag">${plural(o.itemIds.length, 'piece')} · ${money(cost)} · last worn ${daysAgo((o.wornDates || []).slice(-1)[0]).toLowerCase()}</span></div>
      </button>`;
    }).join('')}</div>` : `<div class="empty"><strong>No ${esc(f.toLowerCase())} outfits</strong><span>Tag an outfit with ${esc(f)} when you create or edit it.</span></div>`}
  `;
}

function laundryPlan() {
  const dirty = state.items.filter(isDirty);
  const groups = {};
  dirty.forEach(i => { (groups[loadFor(i)] ||= []).push(i); });
  // How many saved outfits each load would make wearable again
  const loads = Object.entries(groups).map(([k, its]) => {
    const ids = new Set(its.map(i => i.id));
    const unblocks = state.outfits.filter(o => {
      const d = o.itemIds.map(itemById).filter(i => i && isDirty(i));
      return d.length && d.every(i => ids.has(i.id));
    }).length;
    const touches = state.outfits.filter(o => o.itemIds.some(id => ids.has(id))).length;
    return { key: k, its, unblocks, touches };
  }).sort((a, b) => b.unblocks - a.unblocks || b.touches - a.touches || b.its.length - a.its.length);
  const soon = state.items.filter(i => !isDirty(i) && washable(i) && i.washEvery > 1 && i.wearsSinceWash >= i.washEvery - 1);
  return { dirty, loads, soon };
}

function laundryView() {
  const { dirty, loads, soon } = laundryPlan();
  const mini = i => `<button class="mini dirty" data-action="open-item" data-id="${i.id}"><div class="pic">${pic(i)}</div><span>${esc(i.name)}</span></button>`;
  return `
    <h2 class="view-title">Laundry</h2>
    <p class="sub">${dirty.length ? `${plural(dirty.length, 'piece')} in the hamper, sorted into ${plural(loads.length, 'load')}.` : 'The hamper is empty. Everything is clean.'}</p>
    ${loads.map((l, n) => `
      <div class="section-lbl">${n === 0 ? 'Do this load next' : 'Then'}</div>
      <div class="load ${n === 0 ? 'next' : ''}">
        <div class="row between"><h4>${LOADS[l.key].label}</h4><span class="pill">${plural(l.its.length, 'piece')}</span></div>
        <span class="sub">${LOADS[l.key].hint}${l.unblocks ? ` · makes ${plural(l.unblocks, 'outfit')} wearable again` : l.touches ? ` · used in ${plural(l.touches, 'outfit')}` : ''}</span>
        <div class="mini-row">${l.its.map(mini).join('')}</div>
        <button class="btn ${n === 0 ? 'primary' : ''}" data-action="wash-load" data-v="${l.key}">Washed this load</button>
      </div>`).join('')}
    ${soon.length ? `<div class="section-lbl">Needs a wash after the next wear</div><div class="mini-row">${soon.map(i => `<button class="mini" data-action="open-item" data-id="${i.id}"><div class="pic">${pic(i)}</div><span>${esc(i.name)}</span></button>`).join('')}</div>` : ''}
    <div class="banner note" style="margin-top:22px"><span>Pieces go in the hamper on their own after the number of wears you set for each one. You can also put something in by hand from its page.</span></div>
  `;
}

function wishView() {
  if (!state.wish.length) {
    return `<div class="empty"><strong>Your wishlist is empty</strong><span>Save clothes you want to buy and track their price over time.</span><button class="btn primary" data-action="add-wish">Add to wishlist</button></div>`;
  }
  const total = state.wish.reduce((s, w) => s + (w.prices.slice(-1)[0]?.price || 0), 0);
  const atTarget = state.wish.filter(w => w.target != null && w.prices.slice(-1)[0]?.price <= w.target).length;
  return `
    ${examplesBanner()}
    <div class="stats">
      <div class="stat"><b>${state.wish.length}</b><span>pieces wanted</span></div>
      <div class="stat"><b>${money(total)}</b><span>to buy them all</span></div>
      <div class="stat"><b>${atTarget}</b><span>at your price</span></div>
    </div>
    <div class="wlist">${state.wish.map(w => {
      const first = w.prices[0]?.price, cur = w.prices.slice(-1)[0]?.price;
      const ch = first ? (cur - first) / first : 0;
      const hit = w.target != null && cur <= w.target;
      return `<button class="wcard" data-action="open-wish" data-id="${w.id}">
        <div class="pic">${pic(w)}</div>
        <div class="body">
          <span class="name">${esc(w.name)}</span>
          <span class="tag">${esc(w.store || CAT[w.category]?.one || '')}</span>
          <div class="row between"><span class="price">${money(cur)}</span>
            <span class="taglist">${hit ? '<span class="pill good">At your price</span>' : ''}${Math.abs(ch) >= 0.005 ? `<span class="pill ${ch < 0 ? 'good' : 'bad'}">${ch < 0 ? '↓' : '↑'} ${Math.round(Math.abs(ch) * 100)}%</span>` : ''}</span></div>
          ${spark(w.prices, w.target)}
        </div>
      </button>`;
    }).join('')}</div>
    <div class="banner note" style="margin-top:16px"><span>For now you update prices by hand. Automatic price checks need the app to run on a server, which comes later.</span></div>
  `;
}

// ---------- Sheets ----------
let sheetCleanup = null;
function openSheet(html, onMount) {
  silN = 1000;
  const root = $('#sheetRoot'), sheet = $('#sheet');
  if (typeof sheetCleanup === 'function') sheetCleanup();
  sheet.innerHTML = `<div class="grab"></div>${html}`;
  root.hidden = false;
  document.body.style.overflow = 'hidden';
  sheet.scrollTop = 0;
  sheetCleanup = onMount ? onMount(sheet) : null;
}
function closeSheet() {
  $('#sheetRoot').hidden = true;
  $('#sheet').innerHTML = '';
  document.body.style.overflow = '';
  if (typeof sheetCleanup === 'function') sheetCleanup();
  sheetCleanup = null;
}
const head = title => `<div class="sheet-head"><h3>${title}</h3><button class="x" data-action="close-sheet" aria-label="Close">✕</button></div>`;

function openItem(id) {
  const i = itemById(id); if (!i) return;
  const inOutfits = state.outfits.filter(o => o.itemIds.includes(id));
  const cpw = i.price != null ? i.price / Math.max(1, i.wornCount || 0) : null;
  const laundry = !washable(i) ? "Doesn't go in the wash" : isDirty(i) ? `In the hamper · ${LOADS[loadFor(i)].label.toLowerCase()} load` : `Clean · ${i.wearsSinceWash} of ${i.washEvery} wears before a wash`;
  openSheet(`
    ${head(esc(i.name))}
    <div class="hero-pic">${pic(i)}</div>
    <dl class="label-card">
      <div><dt>Category</dt><dd>${CAT[i.category]?.one || ''}</dd></div>
      <div><dt>Color</dt><dd>${dots(i.colors)} ${(i.colors || []).join(', ')}</dd></div>
      ${i.fit?.length ? `<div><dt>Fit</dt><dd>${esc(i.fit.join(', '))}</dd></div>` : ''}
      ${i.comfy ? `<div><dt>Comfort</dt><dd><span class="comfy-dots" aria-label="${i.comfy} out of 5">${'●'.repeat(i.comfy)}${'○'.repeat(5 - i.comfy)}</span> ${COMFY[i.comfy - 1]}</dd></div>` : ''}
      ${i.goodFor?.length ? `<div><dt>Good for</dt><dd>${esc(i.goodFor.join(', '))}</dd></div>` : ''}
      ${i.style?.length ? `<div><dt>Style</dt><dd>${esc(i.style.join(', '))}</dd></div>` : ''}
      <div><dt>Season</dt><dd>${(i.seasons || []).length === 4 ? 'All year' : (i.seasons || []).map(s => SEASON_ABBR[s]).join(' / ') || '—'} · ${WARMTH.find(x => x.v === i.warmth)?.label || ''}</dd></div>
      ${i.brand ? `<div><dt>Brand</dt><dd>${esc(i.brand)}</dd></div>` : ''}
      ${i.model ? `<div><dt>Model</dt><dd>${esc(i.model)}</dd></div>` : ''}
      ${/^https?:\/\//.test(i.link || '') ? `<div><dt>Link</dt><dd><a href="${esc(i.link)}" target="_blank" rel="noopener" style="color:var(--fg)">Open product page</a></dd></div>` : ''}
      <div><dt>Price</dt><dd>${money(i.price)}</dd></div>
      <div><dt>Cost per wear</dt><dd>${cpw == null ? '—' : money(cpw)}</dd></div>
      <div><dt>Worn</dt><dd>${i.wornCount || 0}× · last ${daysAgo(i.lastWorn).toLowerCase()}</dd></div>
      <div><dt>Laundry</dt><dd>${laundry}</dd></div>
    </dl>
    ${washable(i) && !isDirty(i) ? `<div class="meter" aria-hidden="true"><div style="width:${Math.min(100, i.wearsSinceWash / i.washEvery * 100)}%"></div></div>` : ''}
    ${i.notes ? `<div class="notes">${esc(i.notes)}</div>` : ''}
    ${inOutfits.length ? `<div class="section-lbl">In ${plural(inOutfits.length, 'outfit')}</div>
      <div class="mini-row">${inOutfits.map(o => `<button class="mini" data-action="open-outfit" data-id="${o.id}"><div class="pic">${collage(o.itemIds, false)}</div><span>${esc(o.name)}</span></button>`).join('')}</div>` : ''}
    <div class="actions">
      <button class="btn primary" data-action="wear-item" data-id="${i.id}">Wore it today</button>
      ${washable(i) ? `<button class="btn" data-action="toggle-dirty" data-id="${i.id}">${isDirty(i) ? 'Mark clean' : 'Put in hamper'}</button>` : ''}
    </div>
    <div class="actions" style="margin-top:10px">
      <button class="btn" data-action="fav" data-id="${i.id}">${i.fav ? '♥ Favorited' : '♡ Favorite'}</button>
      <button class="btn" data-action="edit-item" data-id="${i.id}">Edit</button>
      <button class="btn danger" data-action="delete-item" data-id="${i.id}" data-confirm="Tap again to delete">Delete</button>
    </div>
  `);
}

function itemForm({ existing, prefill, fromWishId } = {}) {
  const baseCat = state.closet.cat !== 'all' && state.closet.cat !== 'fav' ? state.closet.cat : 'top';
  const i = normalizeItem(existing || { name: '', category: baseCat, ...(prefill || {}) });
  const ph = { photo: i.photo, official: i.officialUrl || null, refresh: () => {} };
  let washTouched = !!existing;
  openSheet(`
    ${head(existing ? 'Edit item' : fromWishId ? 'Add your new piece' : 'Add item')}
    <form id="itemForm" novalidate>
      ${existing ? '' : `<div class="lookup" id="lookupBox">
        <label class="lbl" for="f-lookup">Add from a link or name</label>
        <div class="row" style="flex-wrap:nowrap"><input class="input" id="f-lookup" autocomplete="off" placeholder="Paste a store link, or type e.g. Levi's 501 black">
          <button type="button" class="btn" id="lookupBtn" style="flex:none">Find</button></div>
        <div id="lookupOut"></div>
      </div>
      <div class="or">or start from a photo (optional)</div>`}
      <label class="photo-pick" for="f-photo" id="photoPick"></label>
      <input type="file" id="f-photo" accept="image/*" hidden>
      <div style="margin-top:8px" id="rmWrap" ${ph.photo ? '' : 'hidden'}><button type="button" class="linkbtn" id="rmPhoto">Remove photo</button></div>
      <input type="file" id="f-label" accept="image/*" hidden>
      <div class="ai" id="aiBox" hidden></div>
      <div class="field"><label for="f-name">Name</label>
        <input class="input" id="f-name" name="name" value="${esc(i.name)}" placeholder="e.g. Navy wool sweater" required maxlength="80"></div>
      <div class="field"><span class="lbl">Category</span>
        <div class="chips wrapping">${CATS.map(c => `<input class="chip-input" type="radio" name="category" id="f-cat-${c.id}" value="${c.id}" ${i.category === c.id ? 'checked' : ''}><label class="chip" for="f-cat-${c.id}">${c.one}</label>`).join('')}</div></div>
      <div class="field"><span class="lbl">Colors (up to 2)</span>
        <div class="swatches">${Object.entries(COLORS).map(([k, hex]) => `<input class="chip-input" type="checkbox" name="colors" id="f-col-${k}" value="${k}" ${i.colors.includes(k) ? 'checked' : ''}><label class="sw" for="f-col-${k}" style="background:${hex}" title="${k}" aria-label="${k}"></label>`).join('')}</div></div>
      <div class="two">
        <div class="field"><label for="f-price">Price paid</label><input class="input" id="f-price" name="price" inputmode="decimal" value="${i.price ?? ''}" placeholder="0.00"></div>
        <div class="field"><label for="f-brand">Brand</label><input class="input" id="f-brand" name="brand" value="${esc(i.brand)}" maxlength="60" placeholder="Optional"></div>
      </div>
      <div class="field"><label for="f-model">Model</label><input class="input" id="f-model" name="model" value="${esc(i.model || '')}" maxlength="80" placeholder="e.g. Air Force 1 '07 (optional)"></div>
      <div class="field"><label for="f-link">Product link</label><input class="input" id="f-link" name="link" value="${esc(i.link || '')}" inputmode="url" autocomplete="off" placeholder="Optional"></div>
      <div class="field"><span class="lbl">Seasons</span>
        <div class="chips wrapping">${SEASONS.map(s => `<input class="chip-input" type="checkbox" name="seasons" id="f-sea-${s}" value="${s}" ${i.seasons.includes(s) ? 'checked' : ''}><label class="chip" for="f-sea-${s}">${s}</label>`).join('')}</div></div>
      <div class="field"><span class="lbl">How warm is it?</span>
        <div class="chips wrapping">${WARMTH.map(x => `<input class="chip-input" type="radio" name="warmth" id="f-warm-${x.v}" value="${x.v}" ${i.warmth === x.v ? 'checked' : ''}><label class="chip" for="f-warm-${x.v}">${x.label}</label>`).join('')}</div></div>
      ${tagField('fit', i.fit)}
      <div class="field"><span class="lbl">Comfort</span>
        <div class="chips wrapping comfy-pick">${[1, 2, 3, 4, 5].map(n => `<input class="chip-input" type="radio" name="comfy" id="f-comfy-${n}" value="${n}" ${i.comfy === n ? 'checked' : ''}><label class="chip" for="f-comfy-${n}" title="${COMFY[n - 1]}">${n}</label>`).join('')}
          <span class="sub" id="comfyHint">${i.comfy ? COMFY[i.comfy - 1] : '1 = not comfy · 5 = like pajamas'}</span></div></div>
      ${tagField('goodFor', i.goodFor)}
      ${tagField('style', i.style)}
      <div class="field"><label for="f-wash">Wash it</label>
        <select class="input" id="f-wash" name="washEvery">${WASH_OPTS.map(([v, l]) => `<option value="${v}" ${i.washEvery === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="checkline"><input type="checkbox" name="delicate" id="f-delicate" ${i.delicate ? 'checked' : ''}> Delicate (hand wash or gentle cycle)</label>
      <div class="field"><label for="f-notes">Notes</label><textarea class="input" id="f-notes" name="notes" maxlength="500" placeholder="Size, fit, where you bought it…">${esc(i.notes)}</textarea></div>
      <div class="actions"><button class="btn primary block" type="submit" id="saveItem">${existing ? 'Save changes' : 'Add to closet'}</button></div>
    </form>
  `, sheet => {
    const form = $('#itemForm', sheet);
    const fileIn = $('#f-photo', sheet);
    const refreshPreview = () => {
      const fd = new FormData(form);
      const cols = fd.getAll('colors');
      const shown = ph.official || ph.photo;
      $('#photoPick', sheet).innerHTML = (shown ? `<img src="${esc(shown)}" alt="" referrerpolicy="no-referrer" ${ph.official && ph.photo ? `data-fb-src="${esc(ph.photo)}"` : ''}>` : silhouette({ category: fd.get('category'), colors: cols.length ? cols : ['grey'] })) +
        `<span class="hint">${shown ? 'Change photo' : 'Take or choose a photo'}</span>`;
      $('#rmWrap', sheet).hidden = !shown;
      ai.draw();
    };
    ph.refresh = refreshPreview;
    const ai = photoTools(sheet, form, ph, fill => { washTouched = washTouched || fill; });
    if (!existing) lookupTools(sheet, ai);
    refreshPreview();
    wireTagFields(sheet);
    form.addEventListener('change', e => {
      if (e.target.name === 'comfy') $('#comfyHint', sheet).textContent = COMFY[Number(e.target.value) - 1];
      if (e.target.name === 'colors' && form.querySelectorAll('input[name="colors"]:checked').length > 2) { e.target.checked = false; toast('Pick up to 2 colors'); }
      if (e.target.name === 'washEvery') washTouched = true;
      if (e.target.name === 'category') {
        const cat = e.target.value;
        if (!washTouched) $('#f-wash', sheet).value = String(WASH_DEFAULT[cat] ?? 1);
        if (!existing) { const r = $(`#f-warm-${WARMTH_DEFAULT[cat] || 1}`, sheet); if (r) r.checked = true; }
      }
      if ((e.target.name === 'colors' || e.target.name === 'category') && !ph.photo && !ph.official) refreshPreview();
    });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0]; if (!f) return;
      $('#saveItem', sheet).disabled = true;
      try { ph.photo = await compress(f); ph.official = null; ai.reset(); refreshPreview(); }
      catch (e) { toast("That photo couldn't be read. Try a JPG or PNG."); }
      $('#saveItem', sheet).disabled = false;
      fileIn.value = '';
    });
    $('#rmPhoto', sheet).addEventListener('click', () => { ph.photo = null; ph.official = null; ai.reset(); refreshPreview(); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim();
      if (!name) { toast('Give it a name first'); $('#f-name', sheet).focus(); return; }
      const washEvery = Number(fd.get('washEvery'));
      const rec = {
        ...(existing || { id: uid(), created: Date.now() }), ...normalizeItem(existing || {}),
        id: existing?.id || uid(), created: existing?.created || Date.now(),
        name, category: fd.get('category') || 'top', colors: fd.getAll('colors'), seasons: fd.getAll('seasons'),
        brand: String(fd.get('brand') || '').trim(), model: String(fd.get('model') || '').trim(), notes: String(fd.get('notes') || '').trim(), photo: ph.photo, officialUrl: ph.official,
        link: /^https?:\/\//i.test(String(fd.get('link') || '').trim()) ? String(fd.get('link')).trim() : '',
        price: parsePrice(fd.get('price')), warmth: Number(fd.get('warmth')) || 1, washEvery, delicate: fd.get('delicate') === 'on',
        fit: fd.getAll('fit'), goodFor: fd.getAll('goodFor'), style: fd.getAll('style'), comfy: Number(fd.get('comfy')) || null,
      };
      if (!washEvery) { rec.status = 'clean'; rec.wearsSinceWash = 0; }
      delete rec.sample;
      if (existing) { rec.sample = existing.sample; state.items[state.items.findIndex(x => x.id === rec.id)] = rec; }
      else state.items.push(rec);
      await save('items', rec);
      if (fromWishId) { state.wish = state.wish.filter(w => w.id !== fromWishId); await Store.del('wish', fromWishId); state.view = 'closet'; persistView(); }
      closeSheet(); render();
      toast(existing ? 'Saved' : fromWishId ? 'Moved from wishlist to closet' : 'Added to closet');
    });
  });
}

// ---------- Recognition (Gemini looks at the photo and fills the form) ----------
function dataUrlToBlob(url) {
  const [head, b64] = url.split(',');
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return new Blob([bytes], { type: head.match(/data:([^;]+)/)?.[1] || 'image/jpeg' });
}
const blobToDataUrl = blob => new Promise((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('read')); r.readAsDataURL(blob);
});

const RECOGNIZE_PROMPT = labelToo => `You are identifying one clothing item for a personal wardrobe app. Image 1 is the item${labelToo ? '; image 2 is its label or tag' : ''}.
You may search the web to confirm the exact product.
Reply with only a JSON object in this shape:
{"name": "short name a person would use, include brand and model when known, e.g. \\"Nike Air Force 1 '07\\" or \\"Navy wool crewneck\\"",
 "category": "one of top, bottom, dress, outer, shoes, bag, acc",
 "colors": ["1 or 2 of: ${Object.keys(COLORS).join(', ')}"],
 "seasons": ["any of: Spring, Summer, Fall, Winter"],
 "warmth": 1 for light, 2 for medium, 3 for warm,
 "brand": "brand name or null",
 "model": "exact product or model name or null",
 "confidence": "high, medium or low: how sure you are of the brand and model",
 "evidence": "under 12 words: what you identified it from, e.g. logo on tongue, label text, signature stitching",
 "washEvery": wears before washing (1, 2, 3, 5 or 10), or 0 if it is not machine washed (shoes, bags, coats),
 "fit": ["0 to 2 of: ${TAGS.fit.options.join(', ')}"],
 "goodFor": ["any that clearly apply: ${TAGS.goodFor.options.join(', ')}"],
 "style": ["1 or 2 of: ${TAGS.style.options.join(', ')}"]}
Rules: only give a brand or model when something visible supports it (a logo, label text, or an unmistakable signature design). Never invent style numbers. If you cannot tell, use null and confidence "low". Colors and category must come from the lists.`;

// Try to keep the official photo on the phone; most stores allow it, some block it
async function saveRemoteImage(url) {
  try {
    const res = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await compress(blob);
  } catch (e) { return null; }
}

// Everything around the item's photo: recognize, pick an official photo, cutouts
function photoTools(sheet, form, ph, markWash) {
  const box = $('#aiBox', sheet);
  const labelIn = $('#f-label', sheet);
  let st = 'idle', result = null, err = '', label = null, ctl = null, photos = [], photoSt = 'idle', cutSt = '';

  function draw() {
    const hasPhoto = !!ph.photo;
    const setUp = Gemini.isSetUp();
    const tools = `<div class="row">
        <button type="button" class="btn small" data-ai="paste">Paste cutout</button>
        ${hasPhoto ? `<button type="button" class="btn small" data-ai="cut" ${cutSt ? 'disabled' : ''}>${cutSt || 'Remove background'}</button>` : ''}
      </div>`;
    const labelRow = `<div class="row">${label ? `<img class="label-thumb" src="${label}" alt="Label photo">` : ''}
      <button type="button" class="linkbtn" data-ai="label">${label ? 'Change label photo' : 'Add a photo of the label for a better match'}</button></div>`;
    let ai = '';
    if (!hasPhoto && !(st === 'done' && result)) ai = '';
    else if (!setUp) ai = `<span class="sub">Add your free Gemini key in settings to recognize brand and model automatically.</span><div class="row"><button type="button" class="btn small" data-action="settings">Open settings</button></div>`;
    else if (st === 'thinking') ai = `<span class="thinking">Looking at your photo and searching for the model…</span><div class="row"><button type="button" class="btn small" data-ai="stop">Stop</button></div>`;
    else if (st === 'done' && result) {
      const r = result, known = r.brand || r.model;
      ai = `
        <div class="row between"><span class="sub">${result.fromLookup ? `From ${esc(r.store || 'the web')}` : known ? 'Looks like' : 'Couldn\'t pin down the exact model'}</span><span class="pill ${r.confidence === 'high' ? 'good' : r.confidence === 'medium' ? '' : 'warn'}">${esc(r.confidence)} confidence</span></div>
        <div class="who">${esc(known ? [r.brand, r.model].filter(Boolean).join(' · ') : r.name)}</div>
        ${r.evidence ? `<span class="sub">From: ${esc(r.evidence)}</span>` : ''}
        <span class="sub">I filled in the fields below. Check them before saving.</span>
        ${photoPicker()}
        ${hasPhoto ? `${labelRow}<div class="row"><button type="button" class="btn small" data-ai="run">${result.fromLookup ? 'Recognize my photo instead' : 'Try again'}</button></div>` : ''}`;
    } else ai = `
        <span class="sub">${st === 'error' ? esc(err) : 'Recognize the brand, model, colors and type from your photo.'}</span>
        ${labelRow}
        <div class="row"><button type="button" class="btn primary small" data-ai="run">Recognize it</button></div>`;
    box.hidden = false;
    box.innerHTML = tools + ai;
  }

  function photoPicker() {
    if (photoSt === 'searching') return `<span class="sub thinking">Looking for the official product photo…</span>`;
    if (photoSt === 'none') return ph.photo ? `<span class="sub">No official photo found. Keep yours, or make it look like a product shot with Remove background or Paste cutout.</span>` : `<span class="sub">No product photo found. You can add your own photo above, or save without one.</span>`;
    if (photoSt !== 'found') return '';
    return `<div class="section-lbl" style="margin:4px 0 0">Use the official photo?</div>
      <div class="cand-row">${photos.map((p, k) => `<button type="button" class="cand ${ph.official === p.url ? 'sel' : ''}" data-ai="pick" data-k="${k}"><img src="${esc(p.url)}" alt="" referrerpolicy="no-referrer" loading="lazy"><span>${esc(p.source)}</span></button>`).join('')}</div>
      <div class="row"><button type="button" class="linkbtn" data-ai="keep">${!ph.official && !ph.photo ? 'No photo' : ph.photo && !ph.official ? 'Keep my photo' : 'Don\'t use this photo'}</button></div>`;
  }

  function apply(r) {
    const set = (id, v) => { const el = $(id, sheet); if (el && v != null && v !== '') el.value = v; };
    if (r.name) set('#f-name', String(r.name).slice(0, 80));
    if (r.brand) set('#f-brand', String(r.brand).slice(0, 60));
    if (r.model) set('#f-model', String(r.model).slice(0, 80));
    // Category first: its change handler resets warmth/wash defaults, which the answer then overrides
    if (CAT[r.category]) { const c = $(`#f-cat-${r.category}`, sheet); if (c) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } }
    const cols = (Array.isArray(r.colors) ? r.colors : []).map(String).filter(c => COLORS[c]).slice(0, 2);
    if (cols.length) {
      form.querySelectorAll('input[name="colors"]').forEach(el => { el.checked = cols.includes(el.value); });
      $(`#f-col-${cols[0]}`, sheet).dispatchEvent(new Event('change', { bubbles: true }));
    }
    const seas = (Array.isArray(r.seasons) ? r.seasons : []).filter(s => SEASONS.includes(s));
    if (seas.length) form.querySelectorAll('input[name="seasons"]').forEach(el => { el.checked = seas.includes(el.value); });
    const w = Number(r.warmth); if ([1, 2, 3].includes(w)) { const el = $(`#f-warm-${w}`, sheet); if (el) el.checked = true; }
    const we = Number(r.washEvery); if (WASH_OPTS.some(([v]) => v === we)) { set('#f-wash', String(we)); markWash(true); }
    for (const key of Object.keys(TAGS)) {
      const vals = (Array.isArray(r[key]) ? r[key] : []).map(String);
      if (vals.length) form.querySelectorAll(`input[name="${key}"]`).forEach(el => { if (vals.includes(el.value)) el.checked = true; });
    }
  }

  // Keep only candidates that actually load as images
  const loads = url => new Promise(res => { const im = new Image(); im.referrerPolicy = 'no-referrer'; im.onload = () => res(im.naturalWidth >= 120); im.onerror = () => res(false); im.src = url; setTimeout(() => res(false), 8000); });

  async function searchPhotos(r, signal) {
    if (!r.brand && !r.model) { photoSt = 'none'; return; }
    photoSt = 'searching'; draw();
    try {
      const found = await Gemini.findProductPhotos({ ...r, category: CAT[r.category]?.one || r.category, signal });
      const ok = await Promise.all(found.map(p => loads(p.url)));
      photos = found.filter((p, k) => ok[k]);
      photoSt = photos.length ? 'found' : 'none';
    } catch (e) { photoSt = e.code === 'cancelled' ? 'idle' : 'none'; }
  }

  async function run() {
    if (!ph.photo || !Gemini.isSetUp()) return;
    ctl?.abort(); ctl = new AbortController();
    st = 'thinking'; photoSt = 'idle'; photos = []; draw();
    try {
      const r = await Gemini.recognizeItem({ prompt: RECOGNIZE_PROMPT(!!label), photo: ph.photo, label, signal: ctl.signal });
      r.confidence = ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low';
      result = r; st = 'done'; apply(r); draw();
      await searchPhotos(r, ctl.signal);
    } catch (e) {
      err = e?.code === 'cancelled' ? 'Stopped. Tap Recognize it to try again.' : (e?.message || 'Something went wrong. Try again.');
      st = 'error';
    }
    draw();
  }

  async function setPhoto(dataUrl) { ph.photo = dataUrl; ph.official = null; ph.refresh(); }

  async function pasteCutout() {
    const blob = await Cutout.readClipboardImage();
    if (blob) { try { await setPhoto(await compress(blob)); toast('Cutout added'); } catch (e) { toast("That image couldn't be read."); } return; }
    openPasteBox();
  }

  // Fallback when the clipboard can't be read directly: a box the user long-presses and pastes into
  function openPasteBox() {
    const wrap = document.createElement('div');
    wrap.className = 'pastebox';
    wrap.innerHTML = `<b>Add a cutout</b>
      <ol><li>In Photos, open the picture and touch and hold the item until it lifts.</li><li>Tap <b>Copy</b>.</li><li>Come back, touch and hold the box below, and tap <b>Paste</b>.</li></ol>
      <div class="paste-target" contenteditable="true" aria-label="Paste your cutout here">Touch and hold here, then Paste</div>
      <button type="button" class="linkbtn">Cancel</button>`;
    box.after(wrap);
    const target = wrap.querySelector('.paste-target');
    target.addEventListener('paste', async e => {
      e.preventDefault();
      const f = Cutout.imageFromPaste(e);
      if (!f) { toast('No image found. Copy the lifted item first.'); return; }
      try { await setPhoto(await compress(f)); wrap.remove(); toast('Cutout added'); } catch (err) { toast("That image couldn't be read."); }
    });
    target.addEventListener('input', () => { target.textContent = 'Touch and hold here, then Paste'; });
    wrap.querySelector('.linkbtn').addEventListener('click', () => wrap.remove());
  }

  async function cut() {
    if (!ph.photo || cutSt) return;
    cutSt = 'Getting ready…'; draw();
    try {
      const out = await Cutout.removeBackground(dataUrlToBlob(ph.photo), pct => { cutSt = pct < 100 ? `Downloading ${pct}%` : 'Removing…'; draw(); });
      cutSt = ''; await setPhoto(await compress(out)); toast('Background removed');
    } catch (e) {
      cutSt = ''; draw();
      toast(e?.message === 'offline' ? 'Background removal needs internet the first time.' : "Couldn't remove the background from this photo.");
    }
  }

  box.addEventListener('click', async e => {
    const t = e.target.closest('[data-ai]'); if (!t) return;
    const a = t.dataset.ai;
    if (a === 'run') run();
    else if (a === 'stop') ctl?.abort();
    else if (a === 'label') labelIn.click();
    else if (a === 'paste') pasteCutout();
    else if (a === 'cut') cut();
    else if (a === 'keep') { ph.official = null; ph.refresh(); }
    else if (a === 'pick') {
      const p = photos[Number(t.dataset.k)]; if (!p) return;
      t.disabled = true;
      const saved = await saveRemoteImage(p.url);
      if (saved) { ph.official = null; ph.photo = saved; toast('Official photo saved on your phone'); }
      else { ph.official = p.url; toast('This store blocks saving, so the photo shows when online. Your photo is kept for offline.'); }
      ph.refresh();
    }
  });
  labelIn.addEventListener('change', async () => {
    const f = labelIn.files && labelIn.files[0]; if (!f) return;
    try { label = await compress(f, 1200); if (st === 'done') st = 'idle'; draw(); }
    catch (e) { toast("That photo couldn't be read."); }
    labelIn.value = '';
  });
  // Details found from a link or name: fill the form and offer the product's own photos
  async function useLookup(r) {
    ctl?.abort(); ctl = new AbortController();
    result = { ...r, fromLookup: true }; st = 'done'; apply(r);
    photos = []; photoSt = r.images.length ? 'searching' : 'idle'; draw();
    if (r.images.length) {
      const ok = await Promise.all(r.images.map(loads));
      photos = r.images.filter((u, k) => ok[k]).map(url => ({ url, source: r.store || '' }));
      photoSt = photos.length ? 'found' : 'idle';
    }
    if (!photos.length) await searchPhotos(r, ctl.signal);
    draw();
  }

  return { draw, useLookup, loads, reset() { ctl?.abort(); st = 'idle'; result = null; label = null; photos = []; photoSt = 'idle'; } };
}

// "Add from a link or name": look the product up, show it, and fill the form only after the user confirms
function lookupTools(sheet, tools) {
  const input = $('#f-lookup', sheet), btn = $('#lookupBtn', sheet), out = $('#lookupOut', sheet);
  let ctl = null, found = null;
  const isUrl = v => /^https?:\/\/\S+$/i.test(v);

  async function find() {
    const v = input.value.trim();
    if (!v) { toast('Paste a link or type a name first'); input.focus(); return; }
    if (!Gemini.isSetUp()) {
      if (isUrl(v)) { $('#f-link', sheet).value = v; out.innerHTML = `<p class="sub">Link saved below. Add your free Gemini key in settings to fill in the details automatically, or fill them in by hand.</p>`; }
      else out.innerHTML = `<p class="sub">Looking up a name needs your free Gemini key. <button type="button" class="linkbtn" data-action="settings">Open settings</button></p>`;
      return;
    }
    ctl?.abort(); ctl = new AbortController();
    btn.disabled = true;
    out.innerHTML = `<div class="row"><span class="sub thinking">${isUrl(v) ? 'Reading the product page…' : 'Searching for it…'}</span><button type="button" class="linkbtn" data-lk="stop">Stop</button></div>`;
    try {
      const r = await Gemini.lookupProduct({ url: isUrl(v) ? v : null, text: isUrl(v) ? null : v, categories: CATS.map(c => c.id), colors: Object.keys(COLORS), tags: Object.fromEntries(Object.entries(TAGS).map(([k, t]) => [k, t.options])), signal: ctl.signal });
      if (!r.found || !r.name) { out.innerHTML = `<p class="sub">Couldn't find that product. Check the link, or try a more exact name with the brand.</p>`; return; }
      if (isUrl(v) && !r.url) r.url = v;
      r.confidence = ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low';
      found = r;
      const ok = await Promise.all(r.images.slice(0, 3).map(tools.loads));
      const thumb = r.images.slice(0, 3).find((u, k) => ok[k]);
      const cat = CAT[r.category] ? r.category : 'top';
      const cols = (r.colors || []).filter(c => COLORS[c]);
      let priceNote = '';
      if (r.price != null) {
        try { priceNote = new Intl.NumberFormat(undefined, { style: 'currency', currency: /^[A-Z]{3}$/.test(r.currency || '') ? r.currency : state.settings.currency }).format(r.price); }
        catch (e) { priceNote = String(r.price); }
      }
      out.innerHTML = `<div class="found">
        <div class="pic">${thumb ? `<img src="${esc(thumb)}" alt="" referrerpolicy="no-referrer">` : silhouette({ category: cat, colors: cols.length ? cols : ['grey'] })}</div>
        <div class="body">
          <span class="pill ${r.confidence === 'high' ? 'good' : r.confidence === 'medium' ? '' : 'warn'}">${esc(r.confidence)} confidence</span>
          <b>${esc(r.name)}</b>
          <span class="sub">${[r.brand, CAT[cat].one, priceNote, r.store].filter(Boolean).map(esc).join(' · ')}</span>
        </div>
      </div>
      <p class="sub" style="margin:8px 0 0">Is this your piece?</p>
      <div class="row"><button type="button" class="btn primary small" data-lk="yes">Yes, use these details</button><button type="button" class="btn small" data-lk="no">Not it</button></div>`;
    } catch (e) {
      out.innerHTML = e?.code === 'cancelled' ? '' : `<p class="sub">${esc(e?.message || 'Something went wrong. Try again.')}</p>`;
    } finally { btn.disabled = false; }
  }

  btn.addEventListener('click', find);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
  out.addEventListener('click', e => {
    const a = e.target.closest('[data-lk]')?.dataset.lk;
    if (a === 'stop') ctl?.abort();
    else if (a === 'no') { found = null; out.innerHTML = `<p class="sub">Try a different link or a more exact name.</p>`; input.focus(); }
    else if (a === 'yes' && found) {
      const r = found;
      const price = $('#f-price', sheet);
      if (r.price != null && !price.value) price.value = r.price;
      if (r.url && isUrl(r.url)) $('#f-link', sheet).value = r.url;
      out.innerHTML = `<p class="sub">Filled in from ${esc(r.store || 'the web')}. Check the details below, then tap Add to closet.</p>`;
      tools.useLookup(r);
    }
  });
}

// Multi-choice chips with "+ Add" for the user's own values (saved for next time)
function tagField(key, selected = []) {
  const opts = [...new Set([...tagOptions(key), ...selected])];
  return `<div class="field" data-tags="${key}"><span class="lbl">${TAGS[key].label}</span>
    <div class="chips wrapping">${opts.map(o => tagChip(key, o, selected.includes(o))).join('')}
      <button type="button" class="chip add-tag" data-add-tag="${key}">+ Add</button></div></div>`;
}
let tagN = 0;
const tagChip = (key, value, on) => { const id = `f-${key}-${++tagN}`; return `<input class="chip-input" type="checkbox" name="${key}" id="${id}" value="${esc(value)}" ${on ? 'checked' : ''}><label class="chip" for="${id}">${esc(value)}</label>`; };
function wireTagFields(sheet) {
  sheet.querySelectorAll('[data-add-tag]').forEach(btn => btn.addEventListener('click', () => {
    const key = btn.dataset.addTag;
    const input = document.createElement('input');
    input.className = 'chip tag-input'; input.maxLength = 24; input.placeholder = `New ${TAGS[key].label.toLowerCase()}`;
    input.setAttribute('aria-label', `New ${TAGS[key].label.toLowerCase()}`);
    btn.replaceWith(input); input.focus();
    let finished = false;
    const done = async commit => {
      if (finished) return;
      finished = true;
      const v = input.value.trim().replace(/\s+/g, ' ');
      if (commit && v) {
        const exists = [...sheet.querySelectorAll(`input[name="${key}"]`)].find(el => el.value.toLowerCase() === v.toLowerCase());
        if (exists) exists.checked = true;
        else {
          input.insertAdjacentHTML('beforebegin', tagChip(key, v, true));
          state.settings.tags = { ...(state.settings.tags || {}) };
          state.settings.tags[key] = [...(state.settings.tags[key] || []), v];
          await save('meta', state.settings);
        }
      }
      input.replaceWith(btn);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
  }));
}

// Shrinks a photo for storage. Keeps PNG when the image has transparency (cutouts), else JPEG.
function compress(file, max = 1100) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * scale)); cv.height = Math.max(1, Math.round(img.height * scale));
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      let alpha = false;
      if (/png|webp|gif/.test(file.type || '')) {
        try {
          const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
          const step = Math.max(4, Math.floor(px.length / 4 / 4000) * 4);
          for (let k = 3; k < px.length; k += step) if (px[k] < 250) { alpha = true; break; }
        } catch (e) { alpha = true; }
      }
      resolve(alpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

function openOutfit(id) {
  const o = state.outfits.find(x => x.id === id); if (!o) return;
  const its = o.itemIds.map(itemById).filter(Boolean);
  const worn = o.wornDates || [];
  const dirty = its.filter(isDirty);
  const cost = its.reduce((s, i) => s + (i.price || 0), 0);
  openSheet(`
    ${head(esc(o.name))}
    <div style="border-radius:var(--radius);overflow:hidden">${collage(o.itemIds)}</div>
    ${dirty.length ? `<div class="banner" style="background:var(--warn-soft)"><span>${esc(dirty.map(i => i.name).join(', '))} ${dirty.length === 1 ? 'is' : 'are'} in the hamper.</span></div>` : ''}
    <dl class="label-card">
      <div><dt>Outings</dt><dd>${o.occasions.length ? esc(o.occasions.join(', ')) : '—'}</dd></div>
      <div><dt>Total cost</dt><dd>${money(cost)}</dd></div>
      <div><dt>Worn</dt><dd>${worn.length}× · last ${daysAgo(worn.slice(-1)[0]).toLowerCase()}</dd></div>
    </dl>
    <div class="section-lbl">${plural(its.length, 'piece')}</div>
    <div class="mini-row">${its.map(i => `<button class="mini ${isDirty(i) ? 'dirty' : ''}" data-action="open-item" data-id="${i.id}"><div class="pic">${pic(i)}</div><span>${esc(i.name)}</span></button>`).join('')}</div>
    <div class="actions"><button class="btn primary block" data-action="wear-outfit" data-id="${o.id}">Wore this today</button></div>
    <div class="actions" style="margin-top:10px">
      <button class="btn" data-action="edit-outfit" data-id="${o.id}">Edit</button>
      <button class="btn danger" data-action="delete-outfit" data-id="${o.id}" data-confirm="Tap again to delete">Delete</button>
    </div>
  `);
}

function outfitForm(existing) {
  if (!state.items.length) { toast('Add some clothes to your closet first'); return; }
  const sel = new Set(existing ? existing.itemIds : []);
  const occ = existing ? existing.occasions : (state.outfitFilter ? [state.outfitFilter] : []);
  let filter = 'all';
  openSheet(`
    ${head(existing ? 'Edit outfit' : 'New outfit')}
    <form id="outfitForm" novalidate>
      <div class="field" style="margin-top:4px"><label for="o-name">Name</label>
        <input class="input" id="o-name" name="name" value="${esc(existing?.name || '')}" placeholder="e.g. Rainy school day" maxlength="60"></div>
      <div class="field"><span class="lbl">Type of outing (pick any)</span>
        <div class="chips wrapping">${OCCASIONS.map(x => `<input class="chip-input" type="checkbox" name="occasions" id="o-occ-${x}" value="${x}" ${occ.includes(x) ? 'checked' : ''}><label class="chip" for="o-occ-${x}">${x}</label>`).join('')}</div></div>
      <div class="field"><span class="lbl">Pieces · <span id="selCount">${sel.size}</span> selected</span>
        <div class="chips" id="pickFilter">${[{ id: 'all', label: 'All' }, ...CATS.filter(c => state.items.some(i => i.category === c.id))].map(c => `<button type="button" class="chip" data-f="${c.id}" aria-pressed="${c.id === 'all'}">${c.label}</button>`).join('')}</div>
        <div class="picker-grid" id="picker"></div></div>
      <div class="actions"><button class="btn primary block" type="submit">${existing ? 'Save outfit' : 'Create outfit'}</button></div>
    </form>
  `, sheet => {
    const picker = $('#picker', sheet);
    const drawPicker = () => {
      silN = 2000;
      const list = state.items.filter(i => filter === 'all' || i.category === filter).sort((a, b) => CATS.findIndex(c => c.id === a.category) - CATS.findIndex(c => c.id === b.category));
      picker.innerHTML = list.map(i => `<button type="button" class="card ${sel.has(i.id) ? 'sel' : ''}" data-pick="${i.id}" aria-pressed="${sel.has(i.id)}">
        <div class="pic">${pic(i)}</div><span class="check">${sel.has(i.id) ? '✓' : ''}</span>
        <div class="body"><span class="name">${esc(i.name)}</span></div></button>`).join('');
      $('#selCount', sheet).textContent = sel.size;
    };
    drawPicker();
    $('#pickFilter', sheet).addEventListener('click', e => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      filter = b.dataset.f;
      sheet.querySelectorAll('#pickFilter .chip').forEach(c => c.setAttribute('aria-pressed', c === b));
      drawPicker();
    });
    picker.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      const id = b.dataset.pick;
      sel.has(id) ? sel.delete(id) : sel.add(id);
      drawPicker();
    });
    $('#outfitForm', sheet).addEventListener('submit', async e => {
      e.preventDefault();
      if (!sel.size) { toast('Pick at least one piece'); return; }
      const fd = new FormData(e.target);
      const name = String(fd.get('name') || '').trim() || `Outfit ${state.outfits.length + 1}`;
      const rec = { ...(existing || { id: uid(), created: Date.now(), wornDates: [] }), name, occasions: fd.getAll('occasions'), itemIds: [...sel] };
      delete rec.occasion;
      if (existing) state.outfits[state.outfits.findIndex(x => x.id === rec.id)] = rec;
      else state.outfits.push(rec);
      await save('outfits', rec);
      closeSheet(); if (state.view !== 'today') { state.view = 'outfits'; persistView(); } render();
      toast(existing ? 'Outfit saved' : 'Outfit created');
    });
  });
}

function openWish(id) {
  const w = state.wish.find(x => x.id === id); if (!w) return;
  const cur = w.prices.slice(-1)[0]?.price;
  const low = Math.min(...w.prices.map(p => p.price));
  openSheet(`
    ${head(esc(w.name))}
    <div class="row between"><span class="price" style="font-size:1.8rem">${money(cur)}</span>${w.target != null ? `<span class="pill ${cur <= w.target ? 'good' : ''}">Your price ${money(w.target)}</span>` : ''}</div>
    <div style="margin-top:10px;background:var(--surface);border-radius:var(--radius);padding:10px">${spark(w.prices, w.target, 'spark spark-lg')}</div>
    <dl class="label-card">
      ${w.store ? `<div><dt>Store</dt><dd>${esc(w.store)}</dd></div>` : ''}
      ${w.link ? `<div><dt>Link</dt><dd>${/^https?:\/\//.test(w.link) ? `<a href="${esc(w.link)}" target="_blank" rel="noopener" style="color:var(--accent)">Open product page</a>` : esc(w.link)}</dd></div>` : ''}
      <div><dt>Lowest seen</dt><dd>${money(low)}</dd></div>
      <div><dt>Added</dt><dd>${daysAgo(w.prices[0]?.date)}</dd></div>
    </dl>
    <form id="priceForm" class="row" style="margin-top:14px;flex-wrap:nowrap" novalidate>
      <input class="input" id="w-newprice" name="price" inputmode="decimal" placeholder="Today's price" aria-label="Today's price">
      <button class="btn" type="submit" style="flex:none">Log price</button>
    </form>
    <div class="section-lbl">Price history</div>
    <div class="hist">${[...w.prices].reverse().map(p => `<div><span>${daysAgo(p.date)}</span><span>${money(p.price)}</span></div>`).join('')}</div>
    <div class="actions"><button class="btn primary block" data-action="bought-wish" data-id="${w.id}">I bought it · move to closet</button></div>
    <div class="actions" style="margin-top:10px">
      <button class="btn" data-action="edit-wish" data-id="${w.id}">Edit</button>
      <button class="btn danger" data-action="delete-wish" data-id="${w.id}" data-confirm="Tap again to remove">Remove</button>
    </div>
  `, sheet => {
    $('#priceForm', sheet).addEventListener('submit', async e => {
      e.preventDefault();
      const p = parsePrice($('#w-newprice', sheet).value);
      if (p == null) { toast('Enter a price, like 49.99'); return; }
      const last = w.prices[w.prices.length - 1];
      if (last && last.date === today()) last.price = p; else w.prices.push({ date: today(), price: p });
      await save('wish', w); render(); openWish(w.id);
      toast(w.target != null && p <= w.target ? 'At or below your price!' : 'Price logged');
    });
  });
}

function wishForm(existing) {
  const w = existing || { name: '', category: 'top', colors: [], store: '', link: '', target: null, prices: [], photo: null };
  let photo = w.photo;
  openSheet(`
    ${head(existing ? 'Edit wish' : 'Add to wishlist')}
    <form id="wishForm" novalidate>
      <label class="photo-pick" for="w-photo" id="wPick" style="aspect-ratio:16/9"></label>
      <input type="file" id="w-photo" accept="image/*" hidden>
      <div class="field"><label for="w-name">What is it?</label><input class="input" id="w-name" name="name" value="${esc(w.name)}" placeholder="e.g. Black leather jacket" maxlength="80"></div>
      <div class="field"><span class="lbl">Category</span>
        <div class="chips wrapping">${CATS.map(c => `<input class="chip-input" type="radio" name="category" id="w-cat-${c.id}" value="${c.id}" ${w.category === c.id ? 'checked' : ''}><label class="chip" for="w-cat-${c.id}">${c.one}</label>`).join('')}</div></div>
      <div class="two">
        <div class="field"><label for="w-price">${existing ? 'Current price' : 'Price now'}</label><input class="input" id="w-price" name="price" inputmode="decimal" value="${w.prices.slice(-1)[0]?.price ?? ''}" placeholder="0.00"></div>
        <div class="field"><label for="w-target">Buy if under</label><input class="input" id="w-target" name="target" inputmode="decimal" value="${w.target ?? ''}" placeholder="Optional"></div>
      </div>
      <div class="field"><label for="w-store">Store</label><input class="input" id="w-store" name="store" value="${esc(w.store)}" maxlength="60" placeholder="Optional"></div>
      <div class="field"><label for="w-link">Link</label><input class="input" id="w-link" name="link" value="${esc(w.link)}" inputmode="url" placeholder="Paste the product page (optional)"></div>
      <div class="actions"><button class="btn primary block" type="submit" id="saveWish">${existing ? 'Save' : 'Add to wishlist'}</button></div>
    </form>
  `, sheet => {
    const form = $('#wishForm', sheet);
    const draw = () => {
      const cat = new FormData(form).get('category') || 'top';
      $('#wPick', sheet).innerHTML = (photo ? `<img src="${photo}" alt="">` : silhouette({ category: cat, colors: ['grey'] })) + `<span class="hint">${photo ? 'Change photo' : 'Add a photo or screenshot'}</span>`;
    };
    draw();
    form.addEventListener('change', e => { if (e.target.name === 'category') draw(); });
    $('#w-photo', sheet).addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { photo = await compress(f); draw(); } catch (err) { toast("That image couldn't be read."); }
      e.target.value = '';
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim();
      const price = parsePrice(fd.get('price'));
      if (!name) { toast('Give it a name first'); return; }
      if (price == null) { toast('Add the current price'); return; }
      const rec = { ...(existing || { id: uid(), created: Date.now(), prices: [], colors: [] }), name, category: fd.get('category') || 'top', store: String(fd.get('store') || '').trim(), link: String(fd.get('link') || '').trim(), target: parsePrice(fd.get('target')), photo };
      const last = rec.prices[rec.prices.length - 1];
      if (!last || last.price !== price) {
        if (last && last.date === today()) last.price = price; else rec.prices.push({ date: today(), price });
      }
      if (existing) state.wish[state.wish.findIndex(x => x.id === rec.id)] = rec; else state.wish.unshift(rec);
      await save('wish', rec); closeSheet(); render();
      toast(existing ? 'Saved' : 'Added to wishlist');
    });
  });
}

function openSettings() {
  const counts = CATS.map(c => {
    const its = state.items.filter(i => i.category === c.id);
    return { ...c, n: its.length, v: its.reduce((s, i) => s + (i.price || 0), 0) };
  }).filter(c => c.n);
  const max = Math.max(1, ...counts.map(c => c.v));
  const st = wardrobeStats();
  const never = state.items.filter(i => !i.wornCount);
  const hasSamples = state.items.some(i => i.sample) || state.outfits.some(o => o.sample) || state.wish.some(w => w.sample);
  openSheet(`
    ${head('Wardrobe')}
    <div class="stats" style="margin-top:0">
      <div class="stat"><b>${money(st.value)}</b><span>total value</span></div>
      <div class="stat"><b>${state.outfits.length}</b><span>outfits</span></div>
      <div class="stat"><b>${never.length}</b><span>never worn</span></div>
    </div>
    ${counts.length ? `<div class="section-lbl">Value by category</div><div class="bars">${counts.map(c => `<div class="bar"><span>${c.label}</span><div class="track"><div class="fill" style="width:${(c.v / max) * 100}%"></div></div><span class="n">${money(c.v)}</span></div>`).join('')}</div>` : ''}
    ${never.length ? `<div class="section-lbl">Never worn</div><div class="mini-row">${never.map(i => `<button class="mini" data-action="open-item" data-id="${i.id}"><div class="pic">${pic(i)}</div><span>${esc(i.name)}</span></button>`).join('')}</div>` : ''}
    <div class="section-lbl">Settings</div>
    <div class="panel">
      <div class="row between"><span>Appearance</span><div class="chips" style="padding:0">${[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button class="chip" data-action="set-theme" data-v="${v}" aria-pressed="${themePref === v}">${l}</button>`).join('')}</div></div>
      <div class="row between"><span>Currency</span><div class="chips" style="padding:0">${CURRENCIES.map(c => `<button class="chip" data-action="set-currency" data-v="${c}" aria-pressed="${state.settings.currency === c}">${c}</button>`).join('')}</div></div>
      <div class="row between"><span>Temperature</span><div class="chips" style="padding:0">${['C', 'F'].map(u => `<button class="chip" data-action="set-unit" data-v="${u}" aria-pressed="${state.settings.unit === u}">°${u}</button>`).join('')}</div></div>
    </div>
    <div class="section-lbl">Photo recognition</div>
    <form class="panel" id="keyForm" novalidate>
      <p>${Gemini.isSetUp() ? `Connected · ${esc(Gemini.getModel())}` : 'Uses a free Google Gemini key. Get one at aistudio.google.com → Get API key, then paste it here.'}</p>
      <div class="row" style="flex-wrap:nowrap"><input class="input" id="g-key" type="password" autocomplete="off" placeholder="${Gemini.isSetUp() ? 'Key saved on this phone' : 'Paste your Gemini API key'}" aria-label="Gemini API key">
        <button class="btn" type="submit" style="flex:none" id="g-test">${Gemini.isSetUp() ? 'Replace' : 'Save'}</button></div>
      <p>The key stays on this phone. On Google's free tier, photos you send may be used to improve Google's products.</p>
      ${Gemini.isSetUp() ? '<button type="button" class="btn danger" data-action="forget-key">Remove key</button>' : ''}
    </form>
    <div class="section-lbl">Backup</div>
    <div class="panel">
      <p>${state.lastBackup ? `Last backup ${daysAgo(isoDate(new Date(state.lastBackup))).toLowerCase()}.` : 'Not backed up yet.'} Your closet lives only on this phone. Back up to iCloud Drive (Save to Files) so you don't lose it.</p>
      <button class="btn primary" data-action="backup-now">Back up now</button>
      <button class="btn" data-action="restore">Restore from a backup</button>
      <input type="file" id="restoreFile" accept="application/json,.json" hidden>
    </div>
    <div class="section-lbl">Your data</div>
    <div class="panel">
      <p>${Store.persistent() ? 'Everything is saved on this phone only.' : 'This browser blocked storage, so changes last only until you close the app.'}</p>
      ${hasSamples ? '<button class="btn" data-action="remove-samples">Remove all examples</button>' : '<button class="btn" data-action="load-examples">Load example pieces to try the app</button>'}
      <button class="btn danger" data-action="wipe" data-confirm="Tap again to erase everything">Erase everything</button>
    </div>
  `, sheet => {
    $('#keyForm', sheet).addEventListener('submit', async e => {
      e.preventDefault();
      const key = $('#g-key', sheet).value.trim();
      if (!key) { toast('Paste your key first'); return; }
      const btn = $('#g-test', sheet); btn.disabled = true; btn.textContent = 'Checking…';
      try { const { model } = await Gemini.testKey(key); toast(`Key works · using ${model}`); openSettings(); }
      catch (err) { toast(err.message || "That key didn't work."); btn.disabled = false; btn.textContent = 'Save'; }
    });
    $('#restoreFile', sheet).addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { openRestore(await Backup.readBackup(f)); } catch (err) { toast(err.message); }
      e.target.value = '';
    });
  });
}

async function backupNow() {
  const json = Backup.buildBackup({ items: state.items, outfits: state.outfits, wish: state.wish, settings: state.settings });
  const how = await Backup.shareBackup(json);
  if (how === 'cancelled') return;
  state.lastBackup = Date.now();
  await save('meta', { id: 'backup', at: state.lastBackup });
  render();
  toast(how === 'shared' ? 'Backup ready. Pick Save to Files → iCloud Drive.' : 'Backup file downloaded');
}

function openRestore(data) {
  const when = data.exportedAt ? new Date(data.exportedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'an unknown date';
  openSheet(`
    ${head('Restore backup')}
    <div class="panel">
      <p>Backup from ${esc(when)}</p>
      <div class="stats" style="margin-top:0">
        <div class="stat"><b>${data.items.length}</b><span>pieces</span></div>
        <div class="stat"><b>${data.outfits.length}</b><span>outfits</span></div>
        <div class="stat"><b>${data.wish.length}</b><span>wishlist</span></div>
      </div>
      <p>This replaces everything currently on this phone (${plural(state.items.length, 'piece')}, ${plural(state.outfits.length, 'outfit')}).</p>
      <button class="btn primary" id="doRestore" data-confirm="Tap again to replace everything">Replace with this backup</button>
    </div>
  `, sheet => {
    $('#doRestore', sheet).addEventListener('click', async e => {
      if (!confirmed(e.currentTarget)) return;
      for (const st of ['items', 'outfits', 'wish']) await Store.clear(st);
      state.items = data.items.map(normalizeItem); state.outfits = data.outfits.map(normalizeOutfit); state.wish = data.wish;
      for (const i of state.items) await Store.put('items', i);
      for (const o of state.outfits) await Store.put('outfits', o);
      for (const w of state.wish) await Store.put('wish', w);
      if (data.settings) { state.settings = { ...state.settings, ...data.settings, id: 'settings' }; await save('meta', state.settings); }
      closeSheet(); render(); toast('Backup restored');
    });
  });
}

// ---------- Actions ----------
async function wearItems(ids) {
  const d = today(), toHamper = [];
  for (const id of ids) {
    const i = itemById(id); if (!i) continue;
    i.wornCount = (i.wornCount || 0) + 1; i.lastWorn = d;
    if (washable(i)) {
      i.wearsSinceWash = (i.wearsSinceWash || 0) + 1;
      if (i.wearsSinceWash >= i.washEvery && !isDirty(i)) { i.status = 'dirty'; toHamper.push(i.name); }
    }
    await save('items', i);
  }
  return toHamper;
}
const hamperNote = names => names.length ? ` ${names.length === 1 ? names[0] + ' goes' : plural(names.length, 'piece') + ' go'} in the hamper.` : '';

async function setClean(i) { i.status = 'clean'; i.wearsSinceWash = 0; i.lastWashed = today(); await save('items', i); }

async function removeSamples() {
  const ids = new Set(state.items.filter(i => i.sample).map(i => i.id));
  for (const id of ids) await Store.del('items', id);
  state.items = state.items.filter(i => !i.sample);
  for (const o of state.outfits.filter(o => o.sample)) await Store.del('outfits', o.id);
  state.outfits = state.outfits.filter(o => !o.sample);
  for (const w of state.wish.filter(w => w.sample)) await Store.del('wish', w.id);
  state.wish = state.wish.filter(w => !w.sample);
  for (const o of state.outfits) {
    const before = o.itemIds.length;
    o.itemIds = o.itemIds.filter(id => !ids.has(id));
    if (o.itemIds.length !== before) await save('outfits', o);
  }
}

function persistView() { try { localStorage.setItem('nd-view', state.view); } catch (e) {} }
function persistToday() { try { localStorage.setItem('nd-today', JSON.stringify(state.today)); } catch (e) {} }

// Two-step confirm for destructive buttons (dialogs aren't available)
function confirmed(btn) {
  if (btn.dataset.armed === '1') return true;
  btn.dataset.armed = '1'; btn.dataset.orig = btn.textContent; btn.textContent = btn.dataset.confirm; btn.classList.add('armed');
  setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = btn.dataset.orig; btn.classList.remove('armed'); } }, 3500);
  return false;
}

document.addEventListener('click', async e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { if (!$('#sheetRoot').hidden) closeSheet(); state.view = tab.dataset.tab; persistView(); render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest('[data-action]'); if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.action) {
    case 'close-sheet': closeSheet(); break;
    case 'settings': openSettings(); break;
    case 'toggle-theme': setTheme(root.classList.contains('is-dark') ? 'light' : 'dark'); break;
    case 'set-theme': setTheme(b.dataset.v); openSettings(); break;
    case 'add-item': itemForm(); break;
    case 'new-outfit': outfitForm(); break;
    case 'add-wish': wishForm(); break;
    case 'weather': state.today.weather = b.dataset.v; persistToday(); render(); break;
    case 'weather-live': refreshWeather(!state.forecast); break;
    case 'weather-refresh': refreshWeather(false); break;
    case 'weather-manual': state.today.live = false; state.today.day = 0; persistToday(); render(); break;
    case 'weather-day': state.today.day = Number(b.dataset.v) || 0; persistToday(); render(); break;
    case 'occasion': state.today.occasion = b.dataset.v; persistToday(); render(); break;
    case 'cat': state.closet.cat = b.dataset.v; render(); break;
    case 'color': state.closet.color = state.closet.color === b.dataset.v ? null : b.dataset.v; render(); break;
    case 'clean-only': state.closet.cleanOnly = !state.closet.cleanOnly; render(); break;
    case 'outfit-filter': state.outfitFilter = b.dataset.v; render(); break;
    case 'reset-filters': state.closet = { q: '', cat: 'all', color: null, sort: state.closet.sort, cleanOnly: false }; render(); break;
    case 'open-item': openItem(id); break;
    case 'edit-item': itemForm({ existing: itemById(id) }); break;
    case 'fav': { const i = itemById(id); i.fav = !i.fav; await save('items', i); render(); openItem(id); break; }
    case 'toggle-dirty': {
      const i = itemById(id);
      if (isDirty(i)) { await setClean(i); toast('Marked clean'); }
      else { i.status = 'dirty'; await save('items', i); toast('Put in the hamper'); }
      render(); openItem(id); break;
    }
    case 'wear-item': {
      const i = itemById(id);
      if (i.lastWorn === today()) { toast('Already logged for today'); break; }
      const moved = await wearItems([id]); render(); openItem(id); toast('Logged for today.' + hamperNote(moved)); break;
    }
    case 'delete-item': {
      if (!confirmed(b)) break;
      state.items = state.items.filter(i => i.id !== id); await Store.del('items', id);
      for (const o of state.outfits.filter(o => o.itemIds.includes(id))) { o.itemIds = o.itemIds.filter(x => x !== id); await save('outfits', o); }
      closeSheet(); render(); toast('Deleted'); break;
    }
    case 'open-outfit': openOutfit(id); break;
    case 'edit-outfit': outfitForm(state.outfits.find(o => o.id === id)); break;
    case 'wear-outfit': {
      const o = state.outfits.find(x => x.id === id);
      o.wornDates = o.wornDates || [];
      if (o.wornDates.includes(today())) { toast('Already logged for today'); break; }
      o.wornDates.push(today()); await save('outfits', o);
      const moved = await wearItems(o.itemIds.filter(x => itemById(x)?.lastWorn !== today()));
      render(); openOutfit(id); toast(`Wearing ${o.name} today.` + hamperNote(moved)); break;
    }
    case 'delete-outfit': {
      if (!confirmed(b)) break;
      state.outfits = state.outfits.filter(o => o.id !== id); await Store.del('outfits', id);
      closeSheet(); render(); toast('Outfit deleted'); break;
    }
    case 'wash-load': {
      const its = state.items.filter(i => isDirty(i) && loadFor(i) === b.dataset.v);
      for (const i of its) await setClean(i);
      render(); toast(`${LOADS[b.dataset.v].label}: ${plural(its.length, 'piece')} clean again`); break;
    }
    case 'open-wish': openWish(id); break;
    case 'edit-wish': wishForm(state.wish.find(w => w.id === id)); break;
    case 'delete-wish': {
      if (!confirmed(b)) break;
      state.wish = state.wish.filter(w => w.id !== id); await Store.del('wish', id);
      closeSheet(); render(); toast('Removed from wishlist'); break;
    }
    case 'bought-wish': {
      const w = state.wish.find(x => x.id === id);
      itemForm({ prefill: { name: w.name, category: w.category, colors: w.colors || [], price: w.prices.slice(-1)[0]?.price ?? null, photo: w.photo, brand: w.store || '' }, fromWishId: id });
      break;
    }
    case 'set-currency': state.settings.currency = b.dataset.v; await save('meta', state.settings); render(); openSettings(); break;
    case 'set-unit': state.settings.unit = b.dataset.v; await save('meta', state.settings); render(); openSettings(); break;
    case 'backup-now': await backupNow(); break;
    case 'restore': $('#restoreFile')?.click(); break;
    case 'forget-key': Gemini.forget(); openSettings(); toast('Key removed'); break;
    case 'load-examples': await loadExamples(); closeSheet(); render(); toast('Examples added. Remove them anytime in settings.'); break;
    case 'remove-samples': await removeSamples(); if (!$('#sheetRoot').hidden) closeSheet(); render(); toast('Examples removed'); break;
    case 'wipe': {
      if (!confirmed(b)) break;
      for (const s of ['items', 'outfits', 'wish']) await Store.clear(s);
      state.items = []; state.outfits = []; state.wish = []; closeSheet(); render(); toast('Everything erased'); break;
    }
  }
});

$('#fab').addEventListener('click', () => ({ closet: () => itemForm(), outfits: () => outfitForm(), wish: () => wishForm() })[state.view]?.());
document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    state.closet.q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = $('#q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (err) {} }
  }
});
document.addEventListener('change', e => { if (e.target.id === 'sort') { state.closet.sort = e.target.value; render(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetRoot').hidden) closeSheet(); });

// ---------- Examples ----------
function sampleData() {
  const t = Date.now();
  const d = n => { const x = new Date(); x.setDate(x.getDate() - n); return isoDate(x); };
  const all = SEASONS;
  let n = 0;
  const mk = (name, category, colors, seasons, price, wornCount, lastWornDays, extra = {}) => normalizeItem({
    id: 's' + (++n), name, category, colors, seasons, price, wornCount, brand: '',
    lastWorn: lastWornDays == null ? null : d(lastWornDays), created: t - n * 1000, sample: true, ...extra,
  });
  const items = [
    mk('White oxford shirt', 'top', ['white'], all, 39.9, 14, 6, { brand: 'Uniqlo', fav: true, notes: 'Size M. Iron on medium.', fit: ['Regular'], style: ['Classic', 'Smart'], comfy: 3 }),
    mk('Navy crewneck sweater', 'top', ['navy'], ['Fall', 'Winter'], 69, 9, 8, { warmth: 2, washEvery: 3, wearsSinceWash: 2 }),
    mk('Breton striped top', 'top', ['white', 'navy'], ['Spring', 'Summer'], 55, 6, 2, { status: 'dirty', wearsSinceWash: 1 }),
    mk('Black tee', 'top', ['black'], all, 12, 21, 1, { status: 'dirty', wearsSinceWash: 1 }),
    mk('Grey hoodie', 'top', ['grey'], ['Fall', 'Winter', 'Spring'], 45, 17, 3, { warmth: 2, washEvery: 3, wearsSinceWash: 1, fav: true, fit: ['Oversized'], style: ['Casual', 'Streetwear'], comfy: 5 }),
    mk('Silver party top', 'top', ['silver'], all, 35, 2, 24, { delicate: true, fit: ['Cropped'], style: ['Chic'], comfy: 2 }),
    mk('Dark wash jeans', 'bottom', ['blue'], all, 89, 25, 1, { brand: "Levi's", fav: true, notes: '501, W30 L32.', wearsSinceWash: 3 }),
    mk('Beige chinos', 'bottom', ['beige'], ['Spring', 'Summer', 'Fall'], 49, 7, 2, { wearsSinceWash: 2 }),
    mk('Black joggers', 'bottom', ['black'], all, 30, 11, 5, { wearsSinceWash: 4, status: 'dirty', fit: ['Relaxed'], style: ['Sporty'], goodFor: ['Sport'], comfy: 5 }),
    mk('Black midi dress', 'dress', ['black'], all, 79, 3, 40),
    mk('Camel wool coat', 'outer', ['beige'], ['Fall', 'Winter'], 180, 11, 8, { washEvery: 0 }),
    mk('Black puffer jacket', 'outer', ['black'], ['Winter'], 120, 6, 30, { washEvery: 0, goodFor: ['Cold', 'Wind', 'Snow'], comfy: 4 }),
    mk('Olive field jacket', 'outer', ['olive'], ['Spring', 'Fall'], 95, 0, null, { warmth: 2, goodFor: ['Rain', 'Wind'], style: ['Classic'] }),
    mk('White leather sneakers', 'shoes', ['white'], ['Spring', 'Summer', 'Fall'], 110, 30, 1),
    mk('Brown Chelsea boots', 'shoes', ['brown'], ['Fall', 'Winter'], 150, 12, 8),
    mk('Black canvas tote', 'bag', ['black'], all, 25, 18, 1),
    mk('Grey beanie', 'acc', ['grey'], ['Winter'], 15, 0, null, { warmth: 3 }),
  ];
  const id = name => items.find(i => i.name === name).id;
  const o = (name, occasions, names, wornDaysAgo) => ({ id: 'so-' + name.replace(/\W/g, ''), name, occasions, itemIds: names.map(id), wornDates: wornDaysAgo.map(d).sort(), created: t - 10000 + names.length, sample: true });
  const outfits = [
    o('Hoodie school day', ['School', 'Casual'], ['Grey hoodie', 'Dark wash jeans', 'White leather sneakers', 'Black canvas tote'], [3, 10]),
    o('Cold school morning', ['School'], ['Navy crewneck sweater', 'Dark wash jeans', 'Black puffer jacket', 'Grey beanie'], [30]),
    o('Rainy day layers', ['School', 'Casual'], ['White oxford shirt', 'Beige chinos', 'Olive field jacket', 'Brown Chelsea boots'], []),
    o('Party night', ['Party'], ['Silver party top', 'Dark wash jeans', 'Brown Chelsea boots'], [24]),
    o('Dinner out', ['Party', 'Formal'], ['Black midi dress', 'Camel wool coat', 'Brown Chelsea boots'], [40]),
    o('Weekend coffee', ['Casual'], ['Breton striped top', 'Beige chinos', 'White leather sneakers'], [2, 16]),
    o('Lazy Sunday', ['Casual', 'Sport'], ['Black tee', 'Black joggers', 'White leather sneakers'], [5]),
    o('Smart and simple', ['Work', 'School'], ['White oxford shirt', 'Beige chinos', 'Camel wool coat', 'Brown Chelsea boots'], [8]),
  ];
  const w = (name, category, store, target, prices) => ({ id: 'sw-' + name.replace(/\W/g, ''), name, category, colors: [], store, link: '', target, photo: null, created: t, sample: true, prices: prices.map(([days, price]) => ({ date: d(days), price })) });
  const wish = [
    w('Black leather jacket', 'outer', 'AllSaints', 250, [[60, 349], [38, 349], [21, 299], [6, 279]]),
    w('Retro court sneakers', 'shoes', 'Sneaker store', 110, [[45, 130], [20, 130], [3, 109]]),
    w('Linen summer shirt', 'top', 'Online', 45, [[30, 49.9], [9, 59.9]]),
    w('Wide-leg trousers', 'bottom', 'Mall', null, [[2, 65]]),
  ];
  return { items, outfits, wish };
}

async function loadExamples() {
  if (state.items.some(i => i.sample)) return;
  const data = sampleData();
  state.items.push(...data.items); state.outfits.push(...data.outfits); state.wish.push(...data.wish);
  for (const i of data.items) await Store.put('items', i);
  for (const o of data.outfits) await Store.put('outfits', o);
  for (const w of data.wish) await Store.put('wish', w);
}

async function boot() {
  window.__ndStarted = true;
  render();
  await Store.open();
  state.items = (await Store.all('items')).map(normalizeItem);
  state.outfits = (await Store.all('outfits')).map(normalizeOutfit);
  state.wish = await Store.all('wish');
  const meta = await Store.all('meta');
  const s = meta.find(m => m.id === 'settings'); if (s) state.settings = { ...state.settings, ...s };
  state.lastBackup = meta.find(m => m.id === 'backup')?.at || null;
  state.forecast = Weather.cached();
  render();
  // Ask iOS to keep this app's storage instead of clearing it when space runs low
  try { await navigator.storage?.persist?.(); } catch (e) {}
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (state.today.live && !Weather.isFresh(state.forecast)) refreshWeather(false);
}
window.addEventListener('online', () => render());
window.addEventListener('offline', () => render());
boot();
