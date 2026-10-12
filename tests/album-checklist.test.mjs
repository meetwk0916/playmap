import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { collectAlbumChecklist } from '../scripts/album-checklist.mjs';

const albumUrl = 'https://photos.google.com/album/synthetic';
const first = `${albumUrl}/photo/one`;
const second = `${albumUrl}/photo/two`;

async function runFixture(html, urls = [first], options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'album-checklist-'));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
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
  document.querySelector('c-wiz').setAttribute('data-media-key', id);
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

test('playing video uses active slide identity rather than hidden neighboring media and details', async () => {
  const html = `<!doctype html><button aria-label="打开信息">info</button>
    <c-wiz data-media-key="old" data-p='["old"]' style="visibility:hidden"><img jsname="uLHQEd" aria-label="视频 - 2026年9月12日 09:00:00"><dl><dt aria-label="文件名：old.mp4">old.mp4</dt><dt aria-label="拍摄日期：9月12日">9月12日</dt><dt aria-label="拍摄时间：09:00">09:00</dt><a href="https://www.google.com/maps?q=loc:10,20">old</a></dl></c-wiz>
    <c-wiz data-media-key="one"><div style="display:none"><img jsname="uLHQEd" aria-label="视频 - 2026年9月13日 10:59:19"></div><iframe title="视频播放器"></iframe></c-wiz>
    <script>document.querySelector('button').onclick = () => {
      document.querySelector('button').remove();
      document.body.insertAdjacentHTML('beforeend', '<c-wiz data-p=&quot;one&quot;><dl><dt aria-label="文件名：current.mp4">current.mp4</dt><dt aria-label="拍摄日期：9月13日">9月13日</dt><dt aria-label="拍摄时间：10:59">10:59</dt><a href="https://www.google.com/maps?q=loc:31.2,121.5">位置</a></dl></c-wiz>');
    };</script>`;
  const result = await runFixture(html);
  assert.deepEqual(result.items[0], { url: first, date: '2026-09-13', mediaType: 'video', location: { latitude: 31.2, longitude: 121.5 }, locationProvenance: 'unknown', readStatus: 'read' });
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
