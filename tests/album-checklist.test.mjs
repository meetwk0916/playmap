import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, mkdir, symlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { collectAlbumChecklist } from '../scripts/album-checklist.mjs';
import { queryTencentCandidates } from '../scripts/album-tencent.mjs';

const albumUrl = 'https://photos.google.com/album/synthetic';
const first = `${albumUrl}/photo/one`;
const second = `${albumUrl}/photo/two`;

async function runFixture(html, urls = [first], options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'album-checklist-'));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    if (options.observedRequests) page.on('request', request => options.observedRequests.push(request.url()));
    await page.route('https://photos.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    const outputPath = join(dir, 'checklist.json');
    await collectAlbumChecklist({ page, albumUrl, itemUrls: urls, from: '2026-09-01', to: '2026-09-30', outputPath, repoRoot: resolve('.'), detailTimeoutMs: 300, ...options });
    return JSON.parse(await readFile(outputPath, 'utf8'));
  } finally {
    await browser?.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function fixture({ delay = 0, stale = false, noLocation = false } = {}) {
  return `<!doctype html><button aria-label="打开信息">info</button>
  <c-wiz><img alt="one.jpg"></c-wiz><script>
  const id = location.pathname.split('/').pop();
  document.querySelector('img').alt = id + '.jpg';
  document.querySelector('img').closest('c-wiz').setAttribute('data-media-key', id);
  document.querySelector('button').onclick = () => setTimeout(() => {
    const details = document.createElement('aside');
    details.setAttribute('aria-label', '信息');
    details.innerHTML = '<div>${stale ? 'one' : "' + id + '"}.jpg</div><div>2026年9月13日</div>${noLocation ? '<button aria-label="添加位置">添加位置</button>' : '<a href="https://www.google.com/maps?q=loc:31.2,121.5">位置</a>'}';
    const slide = document.createElement('c-wiz');
    slide.setAttribute('data-p', JSON.stringify([${stale ? "'one'" : 'id'}]));
    slide.append(details);
    document.body.append(slide);
  }, ${delay});
  </script>`;
}

test('private checklist preserves source identity and candidate location without ratings', async () => {
  const result = await runFixture(fixture());
  assert.deepEqual(result.items, [{ url: first, date: '2026-09-13', mediaType: 'photo', location: { latitude: 31.2, longitude: 121.5 }, locationProvenance: 'unknown', readStatus: 'read' }]);
});

test('stale details never become the next photo location', async () => {
  const result = await runFixture(fixture({ stale: true }), [second]);
  assert.equal(result.items[0].readStatus, 'pending-retry');
  assert.equal(result.items[0].location, null);
});

test('delayed details are awaited, explicit missing location is readable, and duplicate sources are deduplicated', async () => {
  const result = await runFixture(fixture({ delay: 100, noLocation: true }), [first, first]);
  assert.deepEqual(result.items, [{ url: first, date: '2026-09-13', mediaType: 'photo', location: null, locationProvenance: 'unknown', readStatus: 'read' }]);
});

test('unloaded location is pending, not an explicit missing location', async () => {
  const result = await runFixture(fixture().replace('<a href="https://www.google.com/maps?q=loc:31.2,121.5">位置</a>', ''));
  assert.equal(result.items[0].readStatus, 'pending-retry');
  assert.equal(result.items[0].location, null);
});

test('Google Photos labelled media and detail list produce a dated private record', async () => {
  const html = `<!doctype html><button aria-label="打开信息">info</button>
    <c-wiz data-media-key="one"><img jsname="uLHQEd" style="width:300px;height:300px" aria-label="照片 - 纵向 - 2026年9月13日 10:59:19"></c-wiz>
    <script>document.querySelector('button').onclick = () => {
      document.querySelector('button').remove();
      document.body.insertAdjacentHTML('beforeend', '<c-wiz data-p=&quot;one&quot;><dl><dt aria-label="文件名：synthetic.jpg">synthetic.jpg</dt><dt aria-label="拍摄日期：9月13日">9月13日</dt><dt aria-label="拍摄时间：周日，10:59">周日，10:59</dt><a href="https://www.google.com/maps?q=loc:31.2,121.5">位置</a></dl></c-wiz>');
    };</script>`;
  const result = await runFixture(html);
  assert.equal(result.items[0].date, '2026-09-13');
  assert.equal(result.items[0].readStatus, 'read');
});

test('calendar-invalid date intervals are rejected before browser access', async () => {
  await assert.rejects(collectAlbumChecklist({ page: {}, albumUrl, itemUrls: [], from: '2026-02-30', to: '2026-03-10', outputPath: '/tmp/no-output.json', repoRoot: resolve('.') }), /date interval/);
});

test('a symlinked output cannot write private sources into a repository', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'album-output-'));
  try {
    const repo = join(dir, 'repo');
    await mkdir(repo);
    const output = join(dir, 'checklist.json');
    await symlink(join(repo, 'leaked.json'), output);
    await assert.rejects(collectAlbumChecklist({ page: {}, albumUrl, itemUrls: [], from: '2026-09-01', to: '2026-09-30', outputPath: output, repoRoot: repo }), /symlink|repository/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('video is explicitly skipped without requesting or reading its details', async () => {
  const html = `<!doctype html><button aria-label="打开信息">info</button>
    <c-wiz data-media-key="old" data-p='["old"]' style="visibility:hidden"><img jsname="uLHQEd" aria-label="视频 - 2026年9月12日 09:00:00"><dl><dt aria-label="文件名：old.mp4">old.mp4</dt><dt aria-label="拍摄日期：9月12日">9月12日</dt><dt aria-label="拍摄时间：09:00">09:00</dt><a href="https://www.google.com/maps?q=loc:10,20">old</a></dl></c-wiz>
    <c-wiz data-media-key="one"><div style="display:none"><img jsname="uLHQEd" aria-label="视频 - 2026年9月13日 10:59:19"></div><iframe title="视频播放器"></iframe></c-wiz>
    <script>document.querySelector('button').onclick = () => {
      document.querySelector('button').remove();
      document.body.insertAdjacentHTML('beforeend', '<c-wiz data-p=&quot;one&quot;><dl><dt aria-label="文件名：current.mp4">current.mp4</dt><dt aria-label="拍摄日期：9月13日">9月13日</dt><dt aria-label="拍摄时间：10:59">10:59</dt><a href="https://www.google.com/maps?q=loc:31.2,121.5">位置</a></dl></c-wiz>');
    };</script>`;
  const observedRequests = [];
  const result = await runFixture(html.replace("document.querySelector('button').remove();", "fetch('/info-open'); document.querySelector('button').remove();"), [first], { observedRequests });
  assert.deepEqual(result.items[0], { url: first, date: null, mediaType: 'video', location: null, locationProvenance: 'unknown', readStatus: 'skipped-video' });
  assert.equal(observedRequests.some(url => url.endsWith('/info-open')), false);
});

test('an ignored initial info click is retried until the actual panel opens', async () => {
  const html = fixture().replace("document.querySelector('button').onclick = () => setTimeout(() => {", "let clicks = 0; document.querySelector('button').onclick = () => { if (++clicks === 1) return; setTimeout(() => {").replace('}, 0);', '}, 0); };');
  const result = await runFixture(html);
  assert.equal(result.items[0].readStatus, 'read');
});

test('same-minute stale details with the wrong media key remain pending', async () => {
  const html = fixture().replace("JSON.stringify([id])", "JSON.stringify(['wrong-media-id'])");
  const result = await runFixture(html);
  assert.equal(result.items[0].location, null);
  assert.equal(result.items[0].readStatus, 'pending-retry');
});

test('faded toolbar info button still opens despite a duplicate tooltip label', async () => {
  const html = fixture().replace('<button aria-label="打开信息">info</button>', '<div aria-label="打开信息">tooltip</div><div style="opacity:0"><button aria-label="打开信息">info</button></div>');
  const result = await runFixture(html);
  assert.equal(result.items[0].readStatus, 'read');
});

test('hidden close controls and hidden details cannot prevent reading sequential photos', async () => {
  const html = fixture().replace('<button aria-label="打开信息">info</button>', '<div style="display:none"><button aria-label="关闭信息">close old info</button><c-wiz data-p=&quot;old&quot;><dl><dt aria-label="文件名：old.jpg">old.jpg</dt></dl></c-wiz></div><button aria-label="打开信息">info</button>');
  const result = await runFixture(html.replaceAll("document.querySelector('button')", "document.querySelector('button[aria-label=\"打开信息\"]')"), [first, second]);
  assert.deepEqual(result.items.map(item => item.readStatus), ['read', 'read']);
});


test('interrupted photo reading resumes without rereading completed sources or losing pending scope', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'album-resume-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://photos.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture() }));
    const outputPath = join(dir, 'checklist.json');
    const options = { page, albumUrl, itemUrls: [first, second, first], from: '2026-09-01', to: '2026-09-30', outputPath, repoRoot: resolve('.'), detailTimeoutMs: 300 };
    const navigate = page.goto.bind(page);
    page.goto = async (url, config) => { if (url === second) throw new Error('Browser disconnected'); return navigate(url, config); };
    await assert.rejects(collectAlbumChecklist(options), /Browser disconnected/);
    const saved = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.deepEqual(saved.items.map(item => item.readStatus), ['read', 'pending-retry']);
    assert.equal(saved.indexedReadComplete, false);
    saved.review = { pending: [first], confirmedBatches: [] };
    await writeFile(outputPath, JSON.stringify(saved));
    const visited = [];
    page.goto = async (url, config) => { visited.push(url); return navigate(url, config); };
    const result = await collectAlbumChecklist(options);
    assert.deepEqual(visited, [second]);
    assert.equal(result.items.length, 2);
    assert.equal(result.indexedReadComplete, true);
    assert.equal(result.readComplete, false);
    assert.deepEqual(result.review, { pending: [first], confirmedBatches: [] });
    assert.deepEqual(result.sourceIndex, [first, second]);
    await assert.rejects(collectAlbumChecklist({ ...options, itemUrls: [first] }), /scope/);
    assert.equal((JSON.parse(await readFile(outputPath, 'utf8'))).items.length, 2);
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test('private output rejects another Git checkout and preserves unreadable progress', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'album-progress-'));
  const options = { page: {}, albumUrl, itemUrls: [], from: '2026-09-01', to: '2026-09-30', repoRoot: resolve('.') };
  try {
    const outputPath = join(dir, 'broken.json');
    await writeFile(outputPath, '{unfinished');
    await assert.rejects(collectAlbumChecklist({ ...options, outputPath }), /Cannot read existing/);
    assert.equal(await readFile(outputPath, 'utf8'), '{unfinished');
    const otherCheckout = join(dir, 'other-checkout');
    await mkdir(otherCheckout);
    await writeFile(join(otherCheckout, '.git'), 'gitdir: /synthetic/git/worktrees/other');
    await assert.rejects(collectAlbumChecklist({ ...options, outputPath: join(otherCheckout, 'private.json') }), /Git checkout/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('a failed progress save retains the last usable file and completed photo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'album-save-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://photos.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture() }));
    const outputPath = join(dir, 'checklist.json');
    const navigate = page.goto.bind(page);
    let lastSaved;
    page.goto = async (url, config) => {
      if (url === second) { lastSaved = await readFile(outputPath, 'utf8'); await chmod(dir, 0o500); }
      return navigate(url, config);
    };
    await assert.rejects(collectAlbumChecklist({ page, albumUrl, itemUrls: [first, second], from: '2026-09-01', to: '2026-09-30', outputPath, repoRoot: resolve('.'), detailTimeoutMs: 300 }), /EACCES/);
    assert.equal(await readFile(outputPath, 'utf8'), lastSaved);
    assert.deepEqual(JSON.parse(lastSaved).items.map(item => item.readStatus), ['read', 'pending-retry']);
  } finally { await chmod(dir, 0o700); await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test('pending details retry while out-of-window photos stay visible and do not imply full coverage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'album-retry-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let html = fixture({ stale: true });
    await page.route('https://photos.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    const options = { page, albumUrl, itemUrls: [first, second], from: '2026-09-01', to: '2026-09-30', outputPath: join(dir, 'checklist.json'), repoRoot: resolve('.'), detailTimeoutMs: 300 };
    const pending = await collectAlbumChecklist(options);
    assert.deepEqual(pending.items.map(item => item.readStatus), ['read', 'pending-retry']);
    html = fixture().replace('2026年9月13日', '2026年8月31日');
    const resumed = await collectAlbumChecklist(options);
    assert.deepEqual(resumed.items.map(item => item.readStatus), ['read', 'out-of-window']);
    assert.equal(resumed.items[1].date, '2026-08-31');
    assert.equal(resumed.indexedReadComplete, true);
    assert.equal(resumed.readComplete, false);
    assert.equal(resumed.review.status, 'not-started');
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});

test('malformed completed progress is preserved rather than treated as a finished photo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'album-invalid-'));
  try {
    const outputPath = join(dir, 'checklist.json');
    const corrupt = JSON.stringify({ albumUrl, from: '2026-09-01', to: '2026-09-30', sourceIndex: [first], items: [{ url: first, date: null, location: null, mediaType: 'photo', readStatus: 'read' }] });
    await writeFile(outputPath, corrupt);
    await assert.rejects(collectAlbumChecklist({ page: {}, albumUrl, itemUrls: [first], from: '2026-09-01', to: '2026-09-30', outputPath, repoRoot: resolve('.') }), /incompatible/);
    assert.equal(await readFile(outputPath, 'utf8'), corrupt);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('an invalid date in photo details stays pending and can safely resume', async () => {
  const result = await runFixture(fixture().replace('2026年9月13日', '2026年2月30日'));
  assert.equal(result.items[0].readStatus, 'pending-retry');
  assert.equal(result.items[0].date, null);
});

test('rereading pending photos retains exclusions and prevents formerly approved Tencent requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'album-excluded-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let html = fixture({ stale: true });
    await page.route('https://photos.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    for (const exclusion of [{ excluded: true }, { reviewStatus: 'excluded' }]) {
      html = fixture({ stale: true });
      const outputPath = join(dir, `${Object.keys(exclusion)[0]}.json`);
      const options = { page, albumUrl, itemUrls: [second], from: '2026-09-01', to: '2026-09-30', outputPath, repoRoot: resolve('.'), detailTimeoutMs: 300 };
      const pending = await collectAlbumChecklist(options);
      Object.assign(pending.items[0], exclusion, { note: 'Maintain exclusion after retry' });
      await writeFile(outputPath, JSON.stringify(pending));
      html = fixture();
      const checklist = await collectAlbumChecklist(options);
      assert.equal(checklist.items[0].readStatus, 'read');
      assert.equal(checklist.items[0].note, 'Maintain exclusion after retry');
      const result = await queryTencentCandidates({ page: { evaluate() { throw new Error('Unexpected external request'); } }, checklist,
        authorization: { recipient: 'tencent', purpose: 'candidate-poi-matching', approved: [{ url: second, latitude: 31.2, longitude: 121.5 }] },
        outputPath: join(dir, `${Object.keys(exclusion)[0]}-queries.json`), repoRoot: resolve('.') });
      assert.equal(result.items[0].status, 'excluded');
      assert.deepEqual(result.items[0].candidates, []);
    }
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
});
