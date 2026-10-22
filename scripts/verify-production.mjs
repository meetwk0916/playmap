import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const git = (...args) => execFileSync('git', args, { maxBuffer: 20 * 1024 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

try {
  const args = process.argv.slice(2);
  const waitForPages = args.includes('--wait-for-pages');
  const positional = args.filter(arg => arg !== '--wait-for-pages');
  const [ref, address = 'https://meetwk.site/playmap/'] = positional;
  if (!ref || positional.length > 2) throw new Error('Usage: npm run --silent verify:production -- <commit> [base-url] [--wait-for-pages]');
  const commit = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`).toString().trim();
  const base = new URL(address.endsWith('/') ? address : `${address}/`);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Expected HTTP(S) base URL');
  const assets = git('ls-tree', '-r', '--name-only', commit, 'assets/').toString().trim().split('\n').filter(Boolean);
  const expectedFiles = ['index.html', 'public-places.json', ...assets, 'maintainer.html'].map(path => ({ path, bytes: path === 'maintainer.html' ? null : git('show', `${commit}:${path}`) }));
  const deadline = Date.now() + 180000;
  let results, deployment;
  while (true) {
    const nextCheck = Date.now() + 10000;
    if (waitForPages) {
      try {
        const build = JSON.parse(execFileSync('gh', ['api', 'repos/{owner}/{repo}/pages/builds/latest'], { timeout: Math.max(1, Math.min(15000, deadline - Date.now())), stdio: ['ignore', 'pipe', 'pipe'] }));
        deployment = { status: build.status, commit: build.commit, verified: build.status === 'built' && build.commit === commit };
      } catch (error) {
        deployment = { status: 'unavailable', commit: null, verified: false, error: (error.stderr?.toString().trim() || error.message).slice(0, 300) };
      }
    }
    results = [];
    for (const { path, bytes: expected } of expectedFiles) {
      let result;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (waitForPages && Date.now() >= deadline) { result = { path, ok: false, error: 'Deployment wait timed out' }; break; }
        const started = Date.now();
        const timeout = waitForPages ? Math.max(1, Math.min(60000, deadline - started)) : 60000;
        let stage = 'response';
        try {
          const url = new URL(path, base);
          url.searchParams.set('verify', `${commit}-${attempt}-${Date.now()}`);
          const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(timeout) });
          stage = 'body';
          const bytes = Buffer.from(await response.arrayBuffer());
          const ok = expected === null ? response.status === 404 : response.status === 200 && bytes.equals(expected);
          result = { path, status: response.status, ok, attempts: attempt, ...(!ok ? { stage: 'comparison' } : {}), ...(expected === null ? {} : { sha256: hash(bytes), expectedSha256: hash(expected) }) };
        } catch (error) {
          result = { path, ok: false, attempts: attempt, stage, timeoutMs: timeout, elapsedMs: Date.now() - started, error: error.message };
        }
        if (result.ok) break;
      }
      results.push(result);
    }
    const filesVerified = results.every(result => result.ok);
    if (!waitForPages) break;
    console.error(JSON.stringify({ deployment, filesVerified }));
    if ((deployment.verified && filesVerified) || (deployment.status === 'errored' && deployment.commit === commit) || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(nextCheck, deadline) - Date.now())));
  }
  const filesVerified = results.every(result => result.ok);
  console.log(JSON.stringify({ commit, base: base.href, filesVerified, ...(waitForPages ? { deployment } : {}), browserInteraction: 'not-checked', results }, null, 2));
  process.exitCode = filesVerified && (!waitForPages || deployment.verified) ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
