// Calls the Gemini API straight from the phone with the user's own free key.
// The key and the chosen model live in this browser's localStorage only.

const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_STORE = 'nd-gemini-key';
const MODEL_STORE = 'nd-gemini-model';
// Preferred free-tier models, best first. testKey() picks the first one this key can use.
const PREFERRED = [/^gemini-2\.5-flash$/, /^gemini-flash-latest$/, /^gemini-3(\.\d+)?-flash/, /^gemini-2\.5-flash-lite$/, /^gemini-2\.0-flash$/];

const read = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const write = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} };

export const getKey = () => read(KEY_STORE);
export const getModel = () => read(MODEL_STORE);
export const isSetUp = () => !!getKey() && !!getModel();
export function forget() { write(KEY_STORE, ''); write(MODEL_STORE, ''); }

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
    if (res.status === 400 && /api key/i.test(msg)) throw new GeminiError('bad_key', 'Gemini says this key is not valid.');
    if (res.status === 401 || res.status === 403) throw new GeminiError('bad_key', 'Gemini refused this key.');
    if (res.status === 429) throw new GeminiError('quota', "You've used today's free Gemini allowance. Try again later.");
    if (res.status === 404) throw new GeminiError('model', 'That Gemini model is not available for your key.');
    throw new GeminiError('upstream', `Gemini error: ${msg}`);
  }
  return data;
}

// Checks the key and remembers the best free model it can use.
export async function testKey(key) {
  key = String(key || '').trim();
  const data = await call('models?pageSize=200', { key });
  const names = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name).replace(/^models\//, ''))
    .filter(n => !/(image|tts|live|audio|embedding|thinking-exp|vision)/.test(n));
  let model = '';
  for (const re of PREFERRED) { model = names.find(n => re.test(n)); if (model) break; }
  if (!model) model = names.find(n => /flash/.test(n)) || names[0];
  if (!model) throw new GeminiError('model', 'This key has no Gemini model that can read photos.');
  write(KEY_STORE, key); write(MODEL_STORE, model);
  return { model };
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

async function generate(parts, { search = true, signal } = {}) {
  const model = getModel();
  if (!model) throw new GeminiError('no_key', 'Add your Gemini key in settings first.');
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2 } };
  if (search) body.tools = [{ google_search: {} }];
  let data;
  try { data = await call(`models/${model}:generateContent`, { body, signal }); }
  catch (e) {
    // Some free-tier models or quotas don't allow search: answer from the photo alone
    if (search && (e.code === 'upstream' || e.code === 'quota')) data = await call(`models/${model}:generateContent`, { body: { ...body, tools: undefined }, signal });
    else throw e;
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
