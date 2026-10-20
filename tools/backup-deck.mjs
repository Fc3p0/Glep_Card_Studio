// Copies the public game data (approved cards, shared gallery records and their images) out of Supabase into ./deck-backup.
// Uses only the site's public publishable key, so it sees exactly what the live site shows; private data needs a Supabase backup.
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join, extname} from 'node:path';

const ROOT = 'https://chfzvfyigycpkcsxbscu.supabase.co';
const KEY = 'sb_publishable_0zmkCJDMk_qAex_bnopfsA_CQP21oxN';
const OUT = process.argv[2] || 'deck-backup';
const STORAGE = ROOT + '/storage/v1/object/public/glep-artwork/';

async function rest(query) {
  const res = await fetch(`${ROOT}/rest/v1/${query}`, {headers: {apikey: KEY}});
  if (!res.ok) throw Error(`${query.split('?')[0]}: HTTP ${res.status}`);
  return res.json();
}
async function save(url, file) {
  if (existsSync(file)) return false;
  const res = await fetch(url);
  if (!res.ok) { console.warn(`skipped ${url}: HTTP ${res.status}`); return false; }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}
// id plus the stored file name, so a replaced image is saved again instead of being skipped
const safe = (id, url) => (String(id) + '-' + new URL(url).pathname.split('/').pop()).replace(/[^\w.-]/g, '_').slice(0, 120) + (extname(new URL(url).pathname) ? '' : '.png');

mkdirSync(join(OUT, 'images', 'cards'), {recursive: true});
mkdirSync(join(OUT, 'images', 'gallery'), {recursive: true});
const cards = await rest('glep_cards?select=id,name,card_type,card_data,artwork_url,creator_name,created_at&review_status=eq.approved&order=created_at.asc&limit=1000');
const artworks = await rest('glep_artworks?select=id,name,tags,image_path,creator_name,created_at&order=created_at.asc&limit=1000');
writeFileSync(join(OUT, 'approved-cards.json'), JSON.stringify(cards, null, 2) + '\n');
writeFileSync(join(OUT, 'gallery.json'), JSON.stringify(artworks, null, 2) + '\n');
let added = 0;
for (const c of cards) if (c.artwork_url) added += await save(c.artwork_url, join(OUT, 'images', 'cards', safe(c.id, c.artwork_url)));
for (const a of artworks) if (a.image_path) added += await save(STORAGE + a.image_path, join(OUT, 'images', 'gallery', safe(a.id, STORAGE + a.image_path)));
console.log(`${cards.length} approved cards, ${artworks.length} gallery images, ${added} new image files`);
