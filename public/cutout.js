// Cutouts: paste one made with iOS "Lift subject", or remove the background on the phone.

// Reads an image the user copied (e.g. Photos → long-press → Copy). Resolves a Blob, or null.
export async function readClipboardImage() {
  if (!navigator.clipboard?.read) return null;
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) return await item.getType(type);
    }
  } catch (e) { /* denied or empty: caller falls back to a paste box */ }
  return null;
}

// Image from a paste event (the fallback paste box)
export function imageFromPaste(e) {
  const items = [...(e.clipboardData?.items || [])];
  const it = items.find(i => i.kind === 'file' && i.type.startsWith('image/'));
  return it ? it.getAsFile() : null;
}

// On-device background removal (IMG.LY, AGPL). The ~40 MB model downloads on first use, then is cached.
const LIB = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
let lib = null;
export async function removeBackground(blob, onProgress) {
  lib ||= import(LIB);
  const mod = await lib.catch(e => { lib = null; throw new Error('offline'); });
  const run = mod.removeBackground || mod.default;
  return run(blob, {
    model: 'isnet_quint8',
    output: { format: 'image/png' },
    progress: (key, current, total) => { if (onProgress && total) onProgress(Math.round(current / total * 100)); },
  });
}
