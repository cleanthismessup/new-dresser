// One-file backups: everything (photos included) in a JSON file the user saves to iCloud Drive.

export function buildBackup({ items, outfits, wish, settings }) {
  return JSON.stringify({ app: 'new-dresser', version: 1, exportedAt: new Date().toISOString(), items, outfits, wish, settings });
}

// Opens the iOS share sheet ("Save to Files"); falls back to a download on desktop browsers.
export async function shareBackup(json) {
  const name = `new-dresser-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'New Dresser backup' }); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}

export async function readBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw new Error("That file isn't a New Dresser backup."); }
  if (data?.app !== 'new-dresser' || !Array.isArray(data.items)) throw new Error("That file isn't a New Dresser backup.");
  const arr = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && typeof x.id === 'string') : []);
  return { exportedAt: data.exportedAt, items: arr(data.items), outfits: arr(data.outfits), wish: arr(data.wish), settings: data.settings && typeof data.settings === 'object' ? data.settings : null };
}
