import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
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
    if (path === 'assets/test.jpg' && mode === 'slow-body') {
      res.writeHead(200); res.flushHeaders();
      setTimeout(() => res.end(files[path]), 16000);
      return;
    }
    if (path === 'assets/test.jpg' && mode === 'broken-body') {
      res.writeHead(200, { 'Content-Length': 100 }); res.write('partial');
      setTimeout(() => res.destroy(), 20);
      return;
    }
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
    const run = (args = [], env = {}) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, commit, `http://127.0.0.1:${server.address().port}/playmap/`, ...args], { cwd, env: { ...process.env, ...env } });
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
        if (mode === 'stale-rules') assert.equal(rules.stage, 'comparison');
      });
    }
    await t.test('accepts a body slower than the former 15 second limit', async () => {
      mode = 'slow-body'; attempts = 0;
      const { code, report } = await run();
      assert.equal(code, 0);
      assert.equal(report.filesVerified, true);
      assert.equal(attempts, 1);
    });
    await t.test('reports interrupted bodies and fails after three attempts', async () => {
      mode = 'broken-body'; attempts = 0;
      const { code, report } = await run();
      assert.equal(code, 1);
      assert.equal(report.filesVerified, false);
      const photo = report.results.find(result => result.path === 'assets/test.jpg');
      assert.equal(photo.stage, 'body');
      assert.equal(photo.timeoutMs, 60000);
      assert.equal(photo.attempts, 3);
      assert.equal(attempts, 3);
      assert.ok(photo.error);
    });
    await t.test('Pages wait retries API failure and rejects a different built commit', async () => {
      mode = 'normal';
      const gh = join(cwd, 'gh');
      await writeFile(gh, `#!${process.execPath}\n` + `
const fs = require('node:fs');
const count = fs.existsSync('calls') ? Number(fs.readFileSync('calls', 'utf8')) : 0;
fs.writeFileSync('calls', String(count + 1));
if (count === 0) { console.error('GitHub API: EOF'); process.exit(1); }
console.log(JSON.stringify({ status: 'built', commit: count === 1 ? 'old-commit' : process.env.TARGET_COMMIT }));
`);
      await chmod(gh, 0o755);
      const { code, report } = await run(['--wait-for-pages'], { PATH: `${cwd}:${process.env.PATH}`, TARGET_COMMIT: commit });
      assert.equal(code, 0);
      assert.equal(report.filesVerified, true);
      assert.deepEqual(report.deployment, { status: 'built', commit, verified: true });
      assert.equal(await readFile(join(cwd, 'calls'), 'utf8'), '3');
      await writeFile(gh, `#!${process.execPath}\nconsole.log(JSON.stringify({status:'errored',commit:process.env.TARGET_COMMIT}));\n`);
      const failed = await run(['--wait-for-pages'], { PATH: `${cwd}:${process.env.PATH}`, TARGET_COMMIT: commit });
      assert.equal(failed.code, 1);
      assert.equal(failed.report.filesVerified, true);
      assert.deepEqual(failed.report.deployment, { status: 'errored', commit, verified: false });
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  }
});

test('local preview accepts its own directory and rejects a different server', async () => {
  const checkServer = (await import('../scripts/check-local-server.cjs')).default;
  const root = fileURLToPath(new URL('../', import.meta.url));
  let sameDirectory = true;
  const server = createServer(async (req, res) => {
    try { res.end(sameDirectory ? await readFile(join(root, req.url)) : 'another checkout'); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = { projects: [{ use: { baseURL: `http://127.0.0.1:${server.address().port}/` } }] };
  try {
    await checkServer(config);
    sameDirectory = false;
    await assert.rejects(checkServer(config), /另一份工作目录/);
  } finally { await new Promise(resolve => server.close(resolve)); }
  await assert.rejects(checkServer(config), /尚未启动/);
});
