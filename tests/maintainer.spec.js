const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const publicData = require('../public-places.json');

test('guided questionnaire preserves unrelated data and exports matching scores', async ({ page }) => {
  const data = structuredClone(publicData);
  data.places[0].child.ages = '3–5 岁';
  data.places[0].extra = { retained: true };
  data.places.push({ ...structuredClone(data.places[0]), poiId: 'other-poi', name: '另一个地点' });
  await page.route('**/public-places.json', route => route.fulfill({ json: data }));
  await page.goto('/maintainer.html');
  await page.evaluate(() => localStorage.setItem('baby_playmap_v1', 'personal data untouched'));
  await page.getByRole('button', { name: '开始填写' }).click();
  await expect(page.getByRole('heading', { name: '是否好玩' })).toBeFocused();
  await expect(page.locator('#level')).toHaveValue('high');
  await page.locator('#reason').fill('孩子喜欢跑跳。');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '儿童友好' })).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.locator('#recommendation').selectOption('no');
  await page.getByRole('button', { name: '预览评分' }).click();
  await expect(page.locator('#score')).toHaveText('4.3 / 5 星');
  await expect(page.locator('#recommendationPreview')).toHaveText('不推荐');
  await expect(page.locator('#download')).toBeDisabled();
  await page.locator('#save').click();
  await expect(page.locator('#pendingCount')).toContainText('1 个地点');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载待发布 JSON' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('public-places.draft.json');
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  const expected = structuredClone(data);
  expected.places[0].fun.reason = '孩子喜欢跑跳。';
  expected.places[0].recommendation = 'no';
  expect(exported).toEqual(expected);
  expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBe('personal data untouched');
  await page.getByRole('button', { name: '保存并维护其他地点' }).click();
  await page.locator('#place').selectOption('0');
  await page.getByRole('button', { name: '开始填写' }).click();
  await expect(page.locator('#reason')).toHaveValue('孩子喜欢跑跳。');
});

test('unknown assessment suppresses score and explanations are required for ratings', async ({ page }) => {
  await page.goto('/maintainer.html');
  await page.getByRole('button', { name: '开始填写' }).click();
  await page.locator('#reason').fill('   ');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByRole('heading', { name: '是否好玩' })).toBeVisible();
  await page.locator('#level').selectOption('');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '预览评分' }).click();
  await expect(page.locator('#score')).toHaveText('暂无评分');
  expect(JSON.parse(await page.locator('#output').inputValue()).places[0].fun.level).toBe('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('unreadable public data blocks draft generation', async ({ page }) => {
  await page.route('**/public-places.json', route => route.fulfill({ status: 500, body: '' }));
  await page.goto('/maintainer.html');
  await expect(page.getByRole('alert')).toContainText('未能读取');
  await expect(page.getByRole('button', { name: '开始填写' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下载待发布 JSON' })).toBeHidden();
});

test('handoff of an existing POI edits the original record without duplication', async ({ page }) => {
  const p = publicData.places[0];
  await page.addInitScript(p => sessionStorage.setItem('playmap_rating_poi', JSON.stringify(p)), p);
  await page.goto('/maintainer.html');
  await expect(page.getByRole('heading', { name: '是否好玩' })).toBeVisible();
  await expect(page.locator('#level')).toHaveValue('high');
  for (let i = 0; i < 3; i++) await page.locator('#next').click();
  const draft = JSON.parse(await page.locator('#output').inputValue());
  expect(draft).toEqual(publicData);
});

test('maintenance is disabled away from loopback and rejects invalid coordinates', async ({ page }) => {
  const html = await readFile(require('node:path').join(__dirname, '../maintainer.html'), 'utf8');
  await page.route('https://playmap.example/maintainer.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://playmap.example/maintainer.html');
  await expect(page.getByRole('alert')).toContainText('仅限本机');
  await expect(page.getByRole('button', { name: '开始填写' })).toBeHidden();
  await page.addInitScript(p => sessionStorage.setItem('playmap_rating_poi', JSON.stringify({ ...p, lat: 999 })), publicData.places[0]);
  await page.goto('/maintainer.html');
  await expect(page.getByRole('alert')).toContainText('未能读取');
  await expect(page.getByRole('button', { name: '开始填写' })).toBeDisabled();
});

const draftKey = 'playmap_maintainer_draft_v1';
async function preview(page, reason) {
  await page.locator('#start').click();
  await page.locator('#reason').fill(reason);
  for (let i = 0; i < 3; i++) await page.locator('#next').click();
}

test('saved drafts resume and accumulate multiple places while unsaved edits stay out of batch', async ({ page }) => {
  const data = structuredClone(publicData);
  data.places.push({ ...structuredClone(data.places[0]), poiId: 'second', name: '第二个地点' });
  await page.route('**/public-places.json', route => route.fulfill({ json: data }));
  await page.goto('/maintainer.html');
  await preview(page, '第一处真实体验');
  await page.locator('#save').click();
  await page.reload();
  await expect(page.locator('#pendingCount')).toContainText('1 个地点');
  await page.locator('#place').selectOption('1');
  await preview(page, '第二处真实体验');
  expect(JSON.parse(await page.locator('#batchOutput').inputValue()).places[1].fun.reason).toBe(data.places[1].fun.reason);
  await page.locator('#save').click();
  await page.reload();
  await expect(page.locator('#pendingCount')).toContainText('2 个地点');
  const batch = JSON.parse(await page.locator('#batchOutput').inputValue());
  expect(batch.places.map(p => p.fun.reason)).toEqual(['第一处真实体验', '第二处真实体验']);
  await page.locator('#pendingList button').first().click();
  await expect(page.locator('#reason')).toHaveValue('第一处真实体验');
});

test('failed and concurrent writes preserve saved drafts', async ({ page }) => {
  await page.goto('/maintainer.html');
  await preview(page, '已保存的体验');
  await page.locator('#save').click();
  const original = await page.evaluate(key => localStorage.getItem(key), draftKey);
  await page.locator('#edit').click();
  await page.locator('#reason').fill('未保存的修改');
  for (let i = 0; i < 3; i++) await page.locator('#next').click();
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  });
  await page.locator('#save').click();
  await expect(page.locator('#error')).toContainText('本地保存失败');
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBe(original);
  expect(JSON.parse(await page.locator('#output').inputValue()).places[0].fun.reason).toBe('未保存的修改');
  await page.evaluate(key => { Storage.prototype.setItem = window.originalSetItem; localStorage.setItem(key, 'another tab'); }, draftKey);
  await page.locator('#save').click();
  await expect(page.locator('#error')).toContainText('另一个页面');
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBe('another tab');
});

test('incompatible drafts are preserved and changed public baseline is flagged', async ({ page }) => {
  await page.goto('/maintainer.html');
  await page.evaluate(key => localStorage.setItem(key, '{broken'), draftKey);
  await page.reload();
  await expect(page.locator('#error')).toContainText('原数据已保留');
  await preview(page, '保留当前填写');
  await page.locator('#save').click();
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBe('{broken');
  const draft = structuredClone(publicData);
  draft.places[0].fun.reason = '本地草稿体验';
  await page.evaluate(({key, data, draft}) => localStorage.setItem(key, JSON.stringify({version: 1, base: data, draft})), {key: draftKey, data: publicData, draft});
  const latest = structuredClone(publicData);
  latest.places[0].address = '更新的公开地址';
  await page.route('**/public-places.json', route => route.fulfill({json: latest}));
  await page.reload();
  await expect(page.locator('#baseWarning')).toBeVisible();
  expect(JSON.parse(await page.locator('#batchOutput').inputValue())).toEqual(draft);
  await page.route('**/public-places.json', route => route.fulfill({json: draft}));
  await page.reload();
  await expect(page.locator('#pendingCount')).toHaveText('暂无待发布修改');
});
