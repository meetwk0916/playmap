import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

test('production verifier compares commit bytes and fails closed', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'playmap-release-'));
  const files = { 'index.html': '<html>fixture</html>', 'public-places.json': '{"places":[]}', 'assets/test.jpg': 'photo', 'assets/visit-rules.js': 'window.VisitRules = {};' };
  let mode = 'normal';
  let attempts = 0;
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname.replace('/playmap/', '');
    if (path === 'assets/test.jpg') attempts++;
    if (path === 'assets/test.jpg' && mode === 'transient' && attempts === 1) { res.writeHead(503).end(); return; }
    if (path === 'maintainer.html') { res.writeHead(mode === 'exposed' ? 200 : 404).end(); return; }
    res.end(mode === 'stale' && path === 'index.html' ? 'old page' :
      mode === 'stale-rules' && path === 'assets/visit-rules.js' ? 'old rules' : files[path]);
  });
  try {
    await mkdir(join(cwd, 'assets'));
    for (const [path, bytes] of Object.entries(files)) await writeFile(join(cwd, path), bytes);
    const git = (...args) => execFileSync('git', args, { cwd });
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
    const commit = git('rev-parse', 'HEAD').toString().trim();
    await writeFile(join(cwd, 'index.html'), 'uncommitted edit');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const script = fileURLToPath(new URL('../scripts/verify-production.mjs', import.meta.url));
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, commit, `http://127.0.0.1:${server.address().port}/playmap/`], { cwd });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.on('error', reject);
      child.on('close', code => { try { resolve({ code, report: JSON.parse(stdout) }); } catch { reject(new Error(stderr || stdout)); } });
    });
    for (const scenario of ['normal', 'transient', 'stale', 'stale-rules', 'exposed']) {
      await t.test(scenario, async () => {
        mode = scenario; attempts = 0;
        const { code, report } = await run();
        assert.equal(code, ['normal', 'transient'].includes(mode) ? 0 : 1);
        assert.equal(report.filesVerified, code === 0);
        assert.equal(report.commit, commit);
        assert.equal(report.browserInteraction, 'not-checked');
        if (mode === 'transient') assert.equal(attempts, 2);
        const rules = report.results.find(result => result.path === 'assets/visit-rules.js');
        assert.equal(rules.ok, mode !== 'stale-rules');
        if (mode === 'stale-rules') assert.equal(rules.attempts, 3);
      });
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  }
});
