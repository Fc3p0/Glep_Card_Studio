// Syntax-checks every inline <script> in the site's pages, so a broken page can't reach GitHub Pages unnoticed.
import {readFileSync, writeFileSync, mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const pages = ['index.html', 'beta/online-lobby.html', 'pixel-collection.html'];
const dir = mkdtempSync(join(tmpdir(), 'glep-check-'));
let failed = 0, checked = 0;
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  scripts.forEach(([, attrs = '', code], i) => {
    if (/\ssrc=/i.test(attrs) || /type=["']?(application\/(ld\+)?json|text\/template)/i.test(attrs)) return;
    const file = join(dir, `${page.replace(/\W/g, '_')}_${i}.${/type=["']?module/i.test(attrs) ? 'mjs' : 'cjs'}`);
    writeFileSync(file, code);
    checked++;
    try { execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'}); }
    catch (e) { failed++; console.error(`✗ ${page} script #${i + 1}\n${e.stderr}`); }
  });
}
console.log(`${checked} inline scripts checked, ${failed} with syntax errors`);
process.exit(failed ? 1 : 0);
