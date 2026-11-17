const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const publicData = require('../public-places.json');
const draftKey = 'playmap_maintainer_draft_v1';

async function preview(page, reflection = '玩得开心，也有一点遗憾。') {
  await page.locator('#start').click();
  await page.getByLabel('11’s 玩后感').fill(reflection);
  await page.locator('#next').click();
}

test('reflection and one photo export without changing unrelated data', async ({ page }) => {
  const data = structuredClone(publicData);
  data.places[0].extra = { retained: true };
  await page.route('**/public-places.json', route => route.fulfill({ json: data }));
  await page.goto('/maintainer.html');
  await page.evaluate(() => localStorage.setItem('baby_playmap_v1', 'personal data untouched'));
  await page.locator('#start').click();
  await page.getByLabel('11’s 玩后感').fill('  玩得开心，也有一点遗憾。  ');
  await page.locator('#photoInput').setInputFiles({
    name: 'visit.jpg', mimeType: 'image/jpeg',
    buffer: await readFile(require('node:path').join(__dirname, '../assets/11-avatar.jpg'))
  });
  await expect(page.locator('#photoPreview')).toBeVisible();
  await page.locator('#next').click();
  await expect(page.locator('#reviewReflection')).toHaveText('玩得开心，也有一点遗憾。');
  await page.locator('#save').click();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#download').click();
  const exported = JSON.parse(await readFile(await (await downloadEvent).path(), 'utf8'));
  expect(exported.places[0]).toMatchObject({ score: data.places[0].score, reflection: '玩得开心，也有一点遗憾。', extra: { retained: true } });
  expect(exported.places[0].photo).toMatch(/^data:image\/jpeg;base64,/);
  expect(exported.places[0].fun).toEqual(data.places[0].fun);
  expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBe('personal data untouched');
});

test('reflection is optional and never creates a score or inferred opinion', async ({ page }) => {
  const data = structuredClone(publicData);
  delete data.places[0].score;
  await page.route('**/public-places.json', route => route.fulfill({ json: data }));
  await page.goto('/maintainer.html');
  await page.locator('#start').click();
  await expect(page.getByLabel('11’s 玩后感')).toHaveValue('');
  await expect(page.locator('input[type="number"]')).toHaveCount(0);
  await page.getByLabel('11’s 玩后感').fill('   ');
  await page.locator('#next').click();
  await expect(page.locator('#reviewReflection')).toBeHidden();
  expect(JSON.parse(await page.locator('#output').inputValue()).places[0]).toEqual(data.places[0]);
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
  await expect(page.getByLabel('11’s 玩后感')).toHaveValue('');
  await page.getByLabel('11’s 玩后感').fill('还想再来。');
  await page.locator('#next').click();
  const draft = JSON.parse(await page.locator('#output').inputValue());
  expect(draft.places).toHaveLength(publicData.places.length);
  expect(draft.places[0]).toMatchObject({ poiId: p.poiId, score: p.score, reflection: '还想再来。' });
  const html = await readFile(require('node:path').join(__dirname, '../maintainer.html'), 'utf8');
  await page.route('https://playmap.example/maintainer.html', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('https://playmap.example/maintainer.html');
  await expect(page.getByRole('alert')).toContainText('仅限本机');
});

test('POI handoff reuses the published place when a saved draft predates it', async ({ page }) => {
  const base = { avatar: publicData.avatar, places: [publicData.places[0]] };
  const oldDraft = { ...base, places: [{ ...base.places[0], reflection: '保留已有草稿' }] };
  const publishedPlace = {
    provider: 'tencent', poiId: 'newly-published', name: '已发布乐园', address: '上海市黄浦区',
    lat: 31.23, lng: 121.47, category: 'playground', score: 4.7, visitedOn: '2026-09-12',
    photo: 'assets/visits/disney-20260912.jpg'
  };
  const incoming = { ...publishedPlace, name: '检索结果名称', address: '腾讯检索地址', category: 'other' };
  await page.addInitScript(({ key, base, oldDraft, incoming }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, base, draft: oldDraft }));
    sessionStorage.setItem('playmap_rating_poi', JSON.stringify(incoming));
  }, { key: draftKey, base, oldDraft, incoming });
  await page.route('**/public-places.json', route => route.fulfill({
    json: { ...base, places: [...base.places, publishedPlace] }
  }));
  await page.goto('/maintainer.html');
  await expect(page.locator('#heading')).toContainText(publishedPlace.name);
  await expect(page.getByLabel('到访日期')).toHaveValue(publishedPlace.visitedOn);
  await page.getByLabel('11’s 玩后感').fill('还想再去。');
  await page.getByRole('button', { name: '预览记录' }).click();
  await page.getByRole('button', { name: '保存到本地草稿' }).click();
  await expect(page.locator('#baseWarning')).toBeVisible();
  expect(JSON.parse(await page.locator('#batchOutput').inputValue()).places).toEqual([
    ...oldDraft.places, { ...publishedPlace, reflection: '还想再去。' }
  ]);
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
  await preview(page, '下次会避开人多的时候。');
  await page.locator('#save').click();
  await page.reload();
  const original = await page.evaluate(key => localStorage.getItem(key), draftKey);
  expect(JSON.parse(original).draft.places.map(p => p.reflection)).toEqual(['玩得开心，也有一点遗憾。', '下次会避开人多的时候。']);
  await page.locator('#start').click();
  await page.getByLabel('11’s 玩后感').fill('修改后的体验。');
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

test('a legacy draft for a migrated place stays exportable without reopening the old editor', async ({ page }) => {
  const data = structuredClone(publicData);
  const draft = structuredClone(data);
  draft.places[0].reflection = '保留给 Agent 核对的旧草稿';
  const existing = JSON.stringify({ version: 1, base: data, draft });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: draftKey, value: existing });
  const published = structuredClone(data);
  published.places[0].visits = [];
  await page.route('**/public-places.json', route => route.fulfill({ json: published }));
  await page.goto('/maintainer.html');
  await page.locator('#start').click();
  await expect(page.getByRole('alert').filter({ hasText: '请交给 Agent 更新' })).toBeVisible();
  await expect(page.locator('#question')).toBeHidden();
  await expect(page.locator('#download')).toBeEnabled();
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBe(existing);
  await page.locator('#place').selectOption('1');
  await preview(page);
  const legacyPlace = data.places[1].name;
  await expect(page.locator('#reviewTitle')).toContainText(legacyPlace);
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#pendingList').getByRole('button', { name: data.places[0].name + ' · 修改' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请交给 Agent 更新' })).toBeVisible();
  await expect(page.locator('#reviewTitle')).toContainText(legacyPlace);
  await page.locator('#edit').click();
  await expect(page.locator('#heading')).toContainText(legacyPlace);
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

test('visit date can be maintained, previewed, exported and resumed without dropping incomplete records', async ({ page }) => {
  await page.goto('/maintainer.html');
  await page.locator('#start').click();
  await page.getByLabel('到访日期').fill('2026-09-10');
  await page.locator('#next').click();
  await expect(page.locator('#reviewDate')).toContainText('2026.09.10 · 2岁2个月');
  await page.locator('#save').click();
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), draftKey);
  expect(stored.draft.places[0].visitedOn).toBe('2026-09-10');
  expect(stored.draft.places).toHaveLength(publicData.places.length);
  await page.reload();
  await page.locator('#start').click();
  await expect(page.getByLabel('到访日期')).toHaveValue('2026-09-10');
  await page.getByLabel('到访日期').fill('');
  await page.locator('#next').click();
  expect(JSON.parse(await page.locator('#output').inputValue()).places[0].visitedOn).toBeUndefined();
  await expect(page.locator('#reviewDate')).toContainText('暂不上图');
});

test('editing a reflection preserves an old partial date until the date itself is edited', async ({ page }) => {
  const data = structuredClone(publicData);
  data.places[0].visitedOn = '2026-09';
  await page.route('**/public-places.json', route => route.fulfill({ json: data }));
  await page.goto('/maintainer.html'); await preview(page);
  const draft = JSON.parse(await page.locator('#output').inputValue());
  expect(draft.places[0].visitedOn).toBe('2026-09');
  await expect(page.locator('#reviewDate')).toContainText('暂不上图');
});


test('invalid historical dates stay in the draft and are explained without an age', async ({ page }) => {
  const data = structuredClone(publicData);
  data.places[0].visitedOn = '2026-02-30';
  data.places[0].extra = { retained: true };
  await page.route('**/public-places.json', route => route.fulfill({ json: data }));
  await page.goto('/maintainer.html');
  await preview(page);
  await expect(page.locator('#reviewDate')).toContainText('到访日期无效');
  await expect(page.locator('#reviewDate')).toContainText('暂不上图');
  await expect(page.locator('#reviewDate')).not.toContainText('岁');
  await page.locator('#save').click();
  await page.reload();
  const exported = JSON.parse(await page.locator('#batchOutput').inputValue());
  expect(exported.places[0]).toEqual({ ...data.places[0], reflection: '玩得开心，也有一点遗憾。' });
});

test('reflection supports 80 characters, rejects overflow visibly, resumes and clears without losing history', async ({ page }) => {
  const data = structuredClone(publicData);
  const original = data.places[0];
  original.reflection = '旧的玩后感';
  original.extra = { retained: ['original'] };
  await page.route('**/public-places.json', route => route.fulfill({ json: data }));
  await page.goto('/maintainer.html');
  await page.locator('#start').click();
  const input = page.getByLabel('11’s 玩后感');
  await expect(input).toHaveValue('旧的玩后感');
  await input.fill('玩'.repeat(81));
  await page.locator('#next').click();
  await expect(page.locator('#question')).toBeVisible();
  await expect(page.locator('#reflectionError')).toContainText('最多 80 字');
  await expect(input).toHaveValue('玩'.repeat(81));
  await input.fill('玩'.repeat(80));
  await page.locator('#next').click();
  await expect(page.locator('#reviewReflection')).toHaveText('玩'.repeat(80));
  await page.locator('#save').click();
  await page.reload();
  await page.locator('#start').click();
  await expect(input).toHaveValue('玩'.repeat(80));
  await input.fill('');
  await page.locator('#next').click();
  await expect(page.locator('#reviewReflectionCard')).toBeHidden();
  await page.locator('#save').click();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#download').click();
  const exported = JSON.parse(await readFile(await (await downloadEvent).path(), 'utf8'));
  const { reflection, ...untouched } = original;
  expect(exported.places[0]).toEqual(untouched);
});

for (const invalid of [{ unsupported: true }, '玩'.repeat(81), '第一行\n第二行']) {
  test(`invalid unedited reflection ${JSON.stringify(invalid).slice(0, 30)} stays intact until edited`, async ({ page }) => {
    const data = structuredClone(publicData);
    data.places[0].reflection = invalid;
    await page.route('**/public-places.json', route => route.fulfill({ json: data }));
    await page.goto('/maintainer.html');
    await page.locator('#start').click();
    await expect(page.getByLabel('11’s 玩后感')).toHaveValue('');
    await page.getByLabel('到访日期').fill('2026-09-10');
    await page.locator('#next').click();
    await expect(page.locator('#reviewReflectionCard')).toBeHidden();
    expect(JSON.parse(await page.locator('#output').inputValue()).places[0]).toEqual({ ...data.places[0], visitedOn: '2026-09-10' });
    await page.locator('#save').click();
    await page.reload();
    await page.locator('#start').click();
    await page.getByLabel('11’s 玩后感').fill('先填再清空');
    await page.getByLabel('11’s 玩后感').fill('');
    await page.locator('#next').click();
    expect(JSON.parse(await page.locator('#output').inputValue()).places[0].reflection).toBeUndefined();
  });
}
