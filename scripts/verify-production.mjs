import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const git = (...args) => execFileSync('git', args, { maxBuffer: 20 * 1024 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

try {
  const [ref, address = 'https://meetwk.site/playmap/'] = process.argv.slice(2);
  if (!ref) throw new Error('Usage: npm run verify:production -- <commit> [base-url]');
  const commit = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).toString().trim();
  const base = new URL(address.endsWith('/') ? address : `${address}/`);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Expected HTTP(S) base URL');
  const assets = git('ls-tree', '-r', '--name-only', commit, 'assets/').toString().trim().split('\n').filter(Boolean);
  const results = [];
  for (const path of ['index.html', 'public-places.json', ...assets, 'maintainer.html']) {
    const expected = path === 'maintainer.html' ? null : git('show', `${commit}:${path}`);
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const url = new URL(path, base);
        url.searchParams.set('verify', `${commit}-${attempt}-${Date.now()}`);
        const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
        const bytes = Buffer.from(await response.arrayBuffer());
        const ok = expected === null ? response.status === 404 : response.status === 200 && bytes.equals(expected);
        result = { path, status: response.status, ok, attempts: attempt, ...(expected === null ? {} : { sha256: hash(bytes), expectedSha256: hash(expected) }) };
      } catch (error) {
        result = { path, ok: false, attempts: attempt, error: error.message };
      }
      if (result.ok) break;
    }
    results.push(result);
  }
  const filesVerified = results.every(result => result.ok);
  console.log(JSON.stringify({ commit, base: base.href, filesVerified, browserInteraction: 'not-checked', results }, null, 2));
  process.exitCode = filesVerified ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
