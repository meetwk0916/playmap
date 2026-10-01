const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const publicData = require('../public-places.json');
const draftKey = 'playmap_maintainer_draft_v1';

async function preview(page, score = '4.7') {
  await page.locator('#start').click();
  await page.locator('#rating').fill(score);
  await page.locator('#next').click();
}

test('direct score and one photo export without changing unrelated data', async ({ page }) => {
  const data = structuredClone(publicData);
  data.places[0].extra = { retained: true };
  await page.route('**/public-places.json', route => route.fulfill({ json: data }));
  await page.goto('/maintainer.html');
  await page.evaluate(() => localStorage.setItem('baby_playmap_v1', 'personal data untouched'));
  await page.locator('#start').click();
  await page.locator('#rating').fill('4.7');
  await page.locator('#photoInput').setInputFiles({
    name: 'visit.jpg', mimeType: 'image/jpeg',
    buffer: await readFile(require('node:path').join(__dirname, '../assets/11-avatar.jpg'))
  });
  await expect(page.locator('#photoPreview')).toBeVisible();
  await page.locator('#next').click();
  await expect(page.locator('#score')).toHaveText('4.7 / 5 星');
  await page.locator('#save').click();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#download').click();
  const exported = JSON.parse(await readFile(await (await downloadEvent).path(), 'utf8'));
  expect(exported.places[0]).toMatchObject({ score: 4.7, extra: { retained: true } });
  expect(exported.places[0].photo).toMatch(/^data:image\/jpeg;base64,/);
  expect(exported.places[0].fun).toEqual(data.places[0].fun);
  expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBe('personal data untouched');
});

test('rating is optional, bounded, and does not infer from old dimensions', async ({ page }) => {
  const data = structuredClone(publicData);
  delete data.places[0].score;
  await page.route('**/public-places.json', route => route.fulfill({ json: data }));
  await page.goto('/maintainer.html');
  await page.locator('#start').click();
  await expect(page.locator('#rating')).toHaveValue('');
  await page.locator('#rating').fill('5.1');
  await page.locator('#next').click();
  await expect(page.locator('#question')).toBeVisible();
  await page.locator('#rating').fill('');
  await page.locator('#next').click();
  await expect(page.locator('#score')).toHaveText('暂无评分');
  expect(JSON.parse(await page.locator('#output').inputValue()).places[0].score).toBeUndefined();
});

test('unreadable public data blocks draft generation', async ({ page }) => {
  await page.route('**/public-places.json', route => route.fulfill({ status: 500, body: '' }));
  await page.goto('/maintainer.html');
  await expect(page.getByRole('alert')).toContainText('未能读取');
  await expect(page.locator('#start')).toBeDisabled();
});

test('existing POI handoff preserves identity and local-only boundary', async ({ page }) => {
  const p = publicData.places[0];
  await page.addInitScript(p => sessionStorage.setItem('playmap_rating_poi', JSON.stringify(p)), p);
  await page.goto('/maintainer.html');
  await expect(page.locator('#heading')).toContainText(p.name);
  await expect(page.locator('#rating')).toHaveValue(String(p.score));
  await page.locator('#rating').fill('3.5');
  await page.locator('#next').click();
  const draft = JSON.parse(await page.locator('#output').inputValue());
  expect(draft.places).toHaveLength(publicData.places.length);
  expect(draft.places[0]).toMatchObject({ poiId: p.poiId, score: 3.5 });
  const html = await readFile(require('node:path').join(__dirname, '../maintainer.html'), 'utf8');
  await page.route('https://playmap.example/maintainer.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://playmap.example/maintainer.html');
  await expect(page.getByRole('alert')).toContainText('仅限本机');
});

test('drafts resume, accumulate, and resist failed or concurrent writes', async ({ page }) => {
  const data = structuredClone(publicData);
  data.places = [data.places[0], { ...structuredClone(data.places[0]), poiId: 'second', name: '第二个地点' }];
  await page.route('**/public-places.json', route => route.fulfill({ json: data }));
  await page.goto('/maintainer.html');
  await preview(page);
  await page.locator('#save').click();
  await page.reload();
  await expect(page.locator('#pendingCount')).toContainText('1 个地点');
  await page.locator('#place').selectOption('1');
  await preview(page, '3.2');
  await page.locator('#save').click();
  await page.reload();
  const original = await page.evaluate(key => localStorage.getItem(key), draftKey);
  expect(JSON.parse(original).draft.places.map(p => p.score)).toEqual([4.7, 3.2]);
  await page.locator('#start').click();
  await page.locator('#rating').fill('4.1');
  await page.locator('#next').click();
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  });
  await page.locator('#save').click();
  await expect(page.locator('#error')).toContainText('本地保存失败');
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBe(original);
  await page.evaluate(key => { Storage.prototype.setItem = window.originalSetItem; localStorage.setItem(key, 'another tab'); }, draftKey);
  await page.locator('#save').click();
  await expect(page.locator('#error')).toContainText('另一个页面');
});

test('incompatible drafts are preserved and changed baseline is flagged', async ({ page }) => {
  await page.goto('/maintainer.html');
  await page.evaluate(key => localStorage.setItem(key, '{broken'), draftKey);
  await page.reload();
  await expect(page.locator('#error')).toContainText('原数据已保留');
  await preview(page);
  await page.locator('#save').click();
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBe('{broken');
  const draft = structuredClone(publicData);
  draft.places[0].score = 4.7;
  await page.evaluate(({ key, data, draft }) => localStorage.setItem(key, JSON.stringify({ version: 1, base: data, draft })), { key: draftKey, data: publicData, draft });
  const latest = structuredClone(publicData);
  latest.places[0].address = '更新的公开地址';
  await page.route('**/public-places.json', route => route.fulfill({ json: latest }));
  await page.reload();
  await expect(page.locator('#baseWarning')).toBeVisible();
  expect(JSON.parse(await page.locator('#batchOutput').inputValue())).toEqual(draft);
});
