// Calls the Gemini API straight from the phone with the user's own free key.
// The key and the chosen model live in this browser's localStorage only.

const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_STORE = 'nd-gemini-key';
const MODEL_STORE = 'nd-gemini-model';
const CANDIDATES_STORE = 'nd-gemini-models';
// Preferred free-tier models, best first. A key can list a model it isn't allowed to use,
// so testKey() tries them in this order with a real request and keeps the first that answers.
const PREFERRED = [/^gemini-2\.5-flash$/, /^gemini-flash-latest$/, /^gemini-3(\.\d+)?-flash(-preview)?$/, /^gemini-2\.5-flash-lite$/, /^gemini-flash-lite-latest$/, /^gemini-2\.0-flash$/, /^gemini-2\.0-flash-lite$/];
const MAX_TRIES = 6;

const read = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const write = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };

export const getKey = () => read(KEY_STORE);
export const getModel = () => read(MODEL_STORE);
export const isSetUp = () => !!getKey() && !!getModel();
export function forget() { write(KEY_STORE, ''); write(MODEL_STORE, ''); write(CANDIDATES_STORE, ''); }
const candidates = () => { try { return JSON.parse(read(CANDIDATES_STORE) || '[]'); } catch (e) { return []; } };

export class GeminiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function call(path, { key = getKey(), body, signal } = {}) {
  if (!key) throw new GeminiError('no_key', 'Add your Gemini key in settings first.');
  let res;
  try {
    res = await fetch(`${API}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new GeminiError('cancelled', 'Stopped.');
    throw new GeminiError('offline', "Couldn't reach Gemini. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const says = ` (Google says: ${msg.slice(0, 160)})`;
    if (/location is not supported|not available in your country|region/i.test(msg)) throw new GeminiError('region', "Gemini's free tier isn't available where you are." + says);
    if ((res.status === 400 || res.status === 401 || res.status === 403) && /api.?key/i.test(msg)) throw new GeminiError('bad_key', 'Gemini says this key is not valid.' + says);
    if (res.status === 401) throw new GeminiError('bad_key', 'Gemini refused this key.' + says);
    // A free-tier limit of 0 means this model isn't offered on the free tier, not that the day's allowance ran out
    if (res.status === 429 && /limit:\s*0\b|"limit":\s*0\b/i.test(msg)) throw new GeminiError('model', 'That Gemini model is not available on your free plan.' + says);
    if (res.status === 429) throw new GeminiError('quota', "You've used today's free Gemini allowance. Try again later." + says);
    if (res.status === 404) throw new GeminiError('model', 'That Gemini model is not available for your key.' + says);
    if (res.status === 403) throw new GeminiError('denied', 'Gemini refused the request.' + says);
    // Google's servers are overloaded for a moment: worth waiting and trying again
    if ([500, 502, 503, 504].includes(res.status) || /overloaded|high demand|UNAVAILABLE|try again later/i.test(msg)) throw new GeminiError('busy', 'Gemini is busy right now. Try again in a minute.');
    throw new GeminiError('upstream', `Gemini error: ${msg}`);
  }
  return data;
}

// Waits between tries; a Stop press (signal) cancels the wait
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new GeminiError('cancelled', 'Stopped.')); return; }
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new GeminiError('cancelled', 'Stopped.')); }, { once: true });
});
const WAITS = [1500, 4000];

// Retries a request while Gemini reports it is busy (2 more tries, waiting longer each time)
async function withRetry(fn, signal) {
  for (let k = 0; ; k++) {
    try { return await fn(); }
    catch (e) {
      if (e.code !== 'busy' || k >= WAITS.length) throw e;
      await pause(WAITS[k] + Math.random() * 500, signal);
    }
  }
}

// One tiny request to see whether this key may actually use a model: 'ok', 'no' or 'busy'
async function works(model, key) {
  try {
    await call(`models/${model}:generateContent`, { key, body: { contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }], generationConfig: { maxOutputTokens: 5 } } });
    return 'ok';
  } catch (e) {
    if (e.code === 'model' || e.code === 'denied') return 'no';
    if (e.code === 'busy') return 'busy';
    throw e;
  }
}

// Checks the key and remembers the best free model it can use.
export async function testKey(key) {
  key = String(key || '').trim();
  const data = await call('models?pageSize=200', { key });
  const names = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name).replace(/^models\//, ''))
    .filter(n => /^gemini/.test(n) && !/(image|tts|live|audio|embedding|thinking-exp|vision|robotics|computer-use)/.test(n));
  const ordered = [];
  for (const re of PREFERRED) names.filter(n => re.test(n)).forEach(n => ordered.includes(n) || ordered.push(n));
  names.filter(n => /flash/.test(n) && !ordered.includes(n)).forEach(n => ordered.push(n));
  if (!ordered.length) throw new GeminiError('model', 'This key has no Gemini model that can read photos.');
  const tried = ordered.slice(0, MAX_TRIES);
  const usable = [];
  for (const model of tried) {
    const r = await works(model, key);
    if (r === 'no') continue;
    usable.push(model);
    if (r === 'ok') {
      // Busy models tested earlier stay first: they are allowed, just overloaded right now
      const backups = [...usable.filter(n => n !== model), ...tried.slice(tried.indexOf(model) + 1)];
      write(KEY_STORE, key); write(MODEL_STORE, model);
      write(CANDIDATES_STORE, JSON.stringify(backups));
      return { model };
    }
  }
  if (usable.length) throw new GeminiError('busy', 'Gemini is busy right now, so the key could not be checked. Try again in a minute.');
  throw new GeminiError('model', `None of the free Gemini models answered for this key (tried ${tried.join(', ')}). In AI Studio, check that the key's project is on the free tier, or create a new key.`);
}

function dataUrlPart(url) {
  const [head, b64] = String(url).split(',');
  return { inline_data: { mime_type: head.match(/data:([^;]+)/)?.[1] || 'image/jpeg', data: b64 } };
}

// Pull one JSON value out of a reply that may wrap it in prose or a code fence
export function parseJson(text) {
  const t = String(text || '').trim();
  const tries = [t, t.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]];
  const a = t.search(/[{[]/), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) { if (!s) continue; try { return JSON.parse(s); } catch (e) {} }
  throw new GeminiError('garbled', 'The answer came back garbled. Try again.');
}

const SEARCH = [{ google_search: {} }];

async function generateWith(model, body, tools, signal) {
  // Some free-tier models or quotas don't allow every tool: drop tools one at a time, then answer without any
  const attempts = [];
  for (let n = tools.length; n >= 0; n--) attempts.push(tools.slice(0, n));
  let lastErr;
  for (const t of attempts) {
    try { return await withRetry(() => call(`models/${model}:generateContent`, { body: { ...body, tools: t.length ? t : undefined }, signal }), signal); }
    catch (e) { lastErr = e; if (!['upstream', 'quota', 'denied', 'model'].includes(e.code) || !t.length) throw e; }
  }
  throw lastErr;
}

async function generate(parts, { tools = SEARCH, signal } = {}) {
  let model = getModel();
  if (!model) throw new GeminiError('no_key', 'Add your Gemini key in settings first.');
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2 } };
  let data;
  try { data = await generateWith(model, body, tools, signal); }
  catch (e) {
    if (e.code !== 'model' && e.code !== 'busy') throw e;
    // The saved model is unusable (switch for good) or overloaded (use a backup just this once)
    const rest = candidates();
    // When busy, try at most 2 backups so the wait stays short (each one retries too)
    for (const next of e.code === 'busy' ? rest.slice(0, 2) : rest) {
      try {
        data = await generateWith(next, body, tools, signal);
        if (e.code === 'model') { model = next; write(MODEL_STORE, next); write(CANDIDATES_STORE, JSON.stringify(rest.filter(n => n !== next))); }
        break;
      } catch (e2) { if (e2.code !== 'model' && e2.code !== 'busy') throw e2; }
    }
    // No backups saved (key added before this check existed): re-check the key once and retry
    if (!data && !rest.length && e.code === 'model') {
      const { model: found } = await testKey(getKey());
      if (found !== model) data = await generateWith(found, body, tools, signal);
    }
    if (!data) throw e;
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map(p => p.text || '').join('');
  if (!text.trim()) throw new GeminiError('empty', cand?.finishReason === 'SAFETY' ? "Gemini wouldn't work with this photo." : 'Gemini returned nothing. Try again.');
  const sources = (cand?.groundingMetadata?.groundingChunks || []).map(c => c.web).filter(Boolean).map(w => ({ url: w.uri, title: w.title || '' }));
  return { text, sources };
}

export async function recognizeItem({ prompt, photo, label, signal }) {
  const parts = [{ text: prompt }, dataUrlPart(photo)];
  if (label) parts.push(dataUrlPart(label));
  const { text, sources } = await generate(parts, { signal });
  const r = parseJson(text);
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new GeminiError('garbled', 'The answer came back garbled. Try again.');
  r.sources = sources;
  return r;
}

// Finds a product from a store link or a description ("Levi's 501 black") and returns its details
export async function lookupProduct({ url, text, categories, colors, tags = {}, signal }) {
  const given = url ? `this product page: ${url}` : `this description: "${text}"`;
  const prompt = `Find this clothing product and its details. The user gave ${given}.
${url ? 'Read that page. If you cannot open it, search the web for the product it points to.' : 'Search the web for the most likely exact product.'}
Reply with only a JSON object:
{"found": true or false,
 "name": "short name including brand and model, e.g. \"Levi's 501 Original Fit Jeans\"",
 "brand": "brand or null", "model": "exact model or null",
 "category": "one of ${categories.join(', ')}",
 "colors": ["1 or 2 of: ${colors.join(', ')}"],
 "seasons": ["any of: Spring, Summer, Fall, Winter"],
 "warmth": 1 for light, 2 for medium, 3 for warm,
 "washEvery": wears before washing (1, 2, 3, 5 or 10), or 0 if not machine washed,
 "fit": ["0 to 2 of: ${(tags.fit || []).join(', ')}"],
 "goodFor": ["any that clearly apply: ${(tags.goodFor || []).join(', ')}"],
 "style": ["1 or 2 of: ${(tags.style || []).join(', ')}"],
 "price": current price as a number or null, "currency": "3-letter code or null",
 "store": "site name", "url": "product page address",
 "images": ["up to 6 direct https addresses of this product's photos from the page or search results"],
 "confidence": "high, medium or low: how sure you are this is the exact product",
 "evidence": "under 12 words: where the details came from"}
If you cannot find it, reply {"found": false}. Never invent prices or image addresses.`;
  const { text: out, sources } = await generate([{ text: prompt }], { tools: url ? [...SEARCH, { url_context: {} }] : SEARCH, signal });
  const r = parseJson(out);
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new GeminiError('garbled', 'The answer came back garbled. Try again.');
  r.images = (Array.isArray(r.images) ? r.images : []).map(u => String(u || '').trim()).filter(u => /^https:\/\/\S+$/.test(u)).slice(0, 6);
  r.price = typeof r.price === 'number' && r.price >= 0 ? Math.round(r.price * 100) / 100 : null;
  r.sources = sources;
  return r;
}

export async function findProductPhotos({ brand, model, name, category, colors, signal }) {
  const what = [brand, model].filter(Boolean).join(' ') || name;
  const prompt = `Find official product photos of this exact clothing item: "${what}" (${category}${colors?.length ? ', ' + colors.join('/') : ''}).
Search the brand's own website and large retailers. Reply with only a JSON object:
{"images": [{"url": "direct https address of the image file itself (ending in .jpg, .jpeg, .png or .webp, or an image CDN address)", "source": "site name"}]}
Give up to 6 images, best match first, preferring plain product shots on a white or neutral background. Only include addresses that appeared in your search results. If you find none, reply {"images": []}.`;
  const { text } = await generate([{ text: prompt }], { signal });
  const r = parseJson(text);
  const list = Array.isArray(r?.images) ? r.images : [];
  const seen = new Set();
  return list
    .map(x => ({ url: String(x?.url || '').trim(), source: String(x?.source || '').slice(0, 40) }))
    .filter(x => /^https:\/\/\S+$/.test(x.url) && !seen.has(x.url) && seen.add(x.url))
    .slice(0, 6);
}
