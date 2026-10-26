// Syntax-checks every inline <script> and every local .js file the site's pages load, and checks that local
// script and stylesheet files exist, so a broken page can't reach GitHub Pages unnoticed.
import {readFileSync, writeFileSync, mkdtempSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';

const pages = ['index.html', 'beta/online-lobby.html'];
const dir = mkdtempSync(join(tmpdir(), 'glep-check-'));
let failed = 0, checked = 0, files = 0;
const check = (file, label) => {
  try { execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'}); }
  catch (e) { failed++; console.error(`✗ ${label}\n${e.stderr}`); }
};
const local = (page, url) => !/^(https?:)?\/\//i.test(url) && join(dirname(page), url.split(/[?#]/)[0]);
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  scripts.forEach(([, attrs = '', code], i) => {
    const src = attrs.match(/\ssrc=["']?([^"'\s>]+)/i);
    if (src) {
      const file = local(page, src[1]);
      if (!file) return;
      files++;
      if (!existsSync(file)) { failed++; console.error(`✗ ${page} loads missing script ${src[1]}`); return; }
      return check(file, `${page} → ${file}`);
    }
    if (/type=["']?(application\/(ld\+)?json|text\/template)/i.test(attrs)) return;
    const file = join(dir, `${page.replace(/\W/g, '_')}_${i}.${/type=["']?module/i.test(attrs) ? 'mjs' : 'cjs'}`);
    writeFileSync(file, code);
    checked++;
    check(file, `${page} script #${i + 1}`);
  });
  for (const [, href] of html.matchAll(/<link[^>]*rel=["']?stylesheet["']?[^>]*href=["']?([^"'\s>]+)/gi)) {
    const file = local(page, href);
    if (file && !existsSync(file)) { failed++; console.error(`✗ ${page} loads missing stylesheet ${href}`); }
  }
}
console.log(`${checked} inline scripts and ${files} script files checked, ${failed} problems`);
process.exit(failed ? 1 : 0);
