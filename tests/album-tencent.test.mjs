import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { queryTencentCandidates } from '../scripts/album-tencent.mjs';

const url = 'https://photos.google.com/album/synthetic/photo/one';
const item = { url, date: '2026-09-13', mediaType: 'photo', readStatus: 'read', location: { latitude: 31.2, longitude: 121.5 } };
const approval = { recipient: 'tencent', purpose: 'candidate-poi-matching', approved: [{ url, ...item.location }] };
const success = { status: 0, result: { pois: [{ id: '123', title: '测试商场', address: '测试地址', location: { lat: 31.21, lng: 121.51 } }, { id: '123', title: '重复', location: { lat: 31.21, lng: 121.51 } }] } };

async function fixture(run, responses = [success]) {
  const dir = await mkdtemp(join(tmpdir(), 'album-tencent-'));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('http://127.0.0.1:4173/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>local query' }));
    await page.goto('http://127.0.0.1:4173/');
    const requests = [];
    await page.route('https://apis.map.qq.com/**', route => {
      const request = new URL(route.request().url());
      requests.push(request);
      const response = responses[Math.min(requests.length - 1, responses.length - 1)];
      if (response === 'close-page') return page.close();
      return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: `${request.searchParams.get('callback')}(${JSON.stringify(response)})` });
    });
    const options = { page, checklist: { items: [item] }, authorization: approval, browserKey: 'public-browser-key', outputPath: join(dir, 'candidates.json'), repoRoot: resolve('.'), retryDelaysMs: [1, 1] };
    await run(options, requests);
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
}

test('authorized photos produce private deduplicated candidates using only coordinates', async () => {
  await fixture(async (options, requests) => {
    const result = await queryTencentCandidates(options);
    assert.equal(requests.length, 1);
    assert.deepEqual([...requests[0].searchParams.keys()].sort(), ['callback', 'coord_type', 'get_poi', 'key', 'location', 'output']);
    assert.equal(requests[0].searchParams.get('location'), '31.2,121.5');
    assert.deepEqual(result.items[0].candidates, [{ provider: 'tencent', poiId: '123', name: '测试商场', address: '测试地址', lat: 31.21, lng: 121.51 }]);
    assert.deepEqual(JSON.parse(await readFile(options.outputPath, 'utf8')), result);
  });
});

test('unapproved, excluded, video, unknown and pending entries issue no query', async () => {
  await fixture(async (options, requests) => {
    for (const change of [{ authorization: null }, { checklist: { items: [{ ...item, excluded: true }] } }, { checklist: { items: [{ ...item, mediaType: 'video' }] } }, { checklist: { items: [{ ...item, mediaType: 'unknown' }] } }, { checklist: { items: [{ ...item, readStatus: 'pending-retry' }] } }, { authorization: { ...approval, approved: [{ url, latitude: 31.3, longitude: 121.5 }] } }]) await queryTencentCandidates({ ...options, ...change });
    assert.equal(requests.length, 0);
  });
});

test('rate limit retries to success; later rerun reuses it only for unchanged approved coordinates', async () => {
  await fixture(async (options, requests) => {
    assert.equal((await queryTencentCandidates(options)).items[0].status, 'success');
    assert.equal(requests.length, 2);
    assert.equal((await queryTencentCandidates(options)).items[0].reused, true);
    assert.equal(requests.length, 2);
    assert.equal((await queryTencentCandidates({ ...options, authorization: null })).items[0].status, 'unauthorized');
    assert.equal(requests.length, 2);
  }, [{ status: 120, message: 'rate limit' }, success]);
});

test('persistent rate limit stops at the bound; permission rejection never retries', async () => {
  await fixture(async (options, requests) => {
    const result = await queryTencentCandidates(options);
    assert.equal(result.items[0].status, 'pending-retry');
    assert.equal(result.items[0].attempts, 3);
    assert.equal(requests.length, 3);
  }, [{ status: 120, message: 'rate limit' }]);
  await fixture(async (options, requests) => {
    const result = await queryTencentCandidates(options);
    assert.equal(result.items[0].status, 'blocked');
    assert.match(result.items[0].reason, /110.*domain denied/);
    assert.equal(requests.length, 1);
  }, [{ status: 110, message: 'domain denied' }]);
});

test('private result stays outside repositories and rejects symlink files before requests', async () => {
  await fixture(async (options, requests) => {
    await assert.rejects(queryTencentCandidates({ ...options, outputPath: resolve('candidates-private.json') }), /outside|repository/i);
    await symlink(resolve('public-places.json'), options.outputPath);
    await assert.rejects(queryTencentCandidates(options), /symlink/i);
    assert.equal(requests.length, 0);
  });
});

test('changed coordinate must be separately approved and cannot reuse the previous candidate', async () => {
  await fixture(async (options, requests) => {
    await queryTencentCandidates(options);
    const changed = { ...item, location: { latitude: 31.3, longitude: 121.5 } };
    const result = await queryTencentCandidates({ ...options, checklist: { items: [changed] }, authorization: { ...approval, approved: [{ url, ...changed.location }] } });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].searchParams.get('location'), '31.3,121.5');
    assert.equal(result.items[0].reused, undefined);
    assert.equal((await queryTencentCandidates(options)).items[0].reused, true);
    assert.equal(requests.length, 2);
  });
});

test('invalid saved progress is preserved and no coordinate is sent', async () => {
  await fixture(async (options, requests) => {
    const corrupt = '{"version":1,"recipient":"tencent","items":[{}]}';
    await writeFile(options.outputPath, corrupt);
    await assert.rejects(queryTencentCandidates(options), /checkpoint/i);
    assert.equal(await readFile(options.outputPath, 'utf8'), corrupt);
    assert.equal(requests.length, 0);
  });
});

test('browser interruption retains completed results and remaining source identities', async () => {
  await fixture(async (options) => {
    const second = { ...item, url: 'https://photos.google.com/album/synthetic/photo/two' };
    const authorization = { ...approval, approved: [...approval.approved, { url: second.url, ...second.location }] };
    await assert.rejects(queryTencentCandidates({ ...options, checklist: { items: [item, second] }, authorization }), /closed|Target|evaluate/i);
    const saved = JSON.parse(await readFile(options.outputPath, 'utf8'));
    assert.equal(saved.items[0].status, 'success');
    assert.equal(saved.items[1].url, second.url);
    assert.equal(saved.items[1].status, 'pending-retry');
    const resumedPage = await options.page.context().newPage();
    await resumedPage.route('http://127.0.0.1:4173/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>local query' }));
    let resumedRequests = 0;
    await resumedPage.route('https://apis.map.qq.com/**', route => {
      resumedRequests++;
      const callback = new URL(route.request().url()).searchParams.get('callback');
      return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: `${callback}(${JSON.stringify(success)})` });
    });
    await resumedPage.goto('http://127.0.0.1:4173/');
    const resumed = await queryTencentCandidates({ ...options, page: resumedPage, checklist: { items: [item, second] }, authorization });
    assert.equal(resumed.items[0].reused, true);
    assert.equal(resumed.items[1].status, 'success');
    assert.equal(resumedRequests, 1);

  }, [success, 'close-page']);
});

test('success survives empty or smaller scope and temporary authorization or exclusion changes', async () => {
  await fixture(async (options, requests) => {
    const second = { ...item, url: 'https://photos.google.com/album/synthetic/photo/two' };
    const checklist = { items: [item, second] };
    const authorization = { ...approval, approved: [...approval.approved, { url: second.url, ...second.location }] };
    const full = { ...options, checklist, authorization };
    await queryTencentCandidates(full);
    assert.equal(requests.length, 2);
    // An existing version-one checkpoint need not already contain a separate cache.
    const legacy = JSON.parse(await readFile(options.outputPath, 'utf8'));
    delete legacy.successfulQueries;
    await writeFile(options.outputPath, JSON.stringify(legacy));
    for (const change of [
      { checklist: { items: [] } },
      { checklist: { items: [second] } },
      { authorization: null },
      { checklist: { items: [{ ...item, excluded: true }, { ...second, reviewStatus: 'excluded' }] } },
    ]) {
      const gated = await queryTencentCandidates({ ...full, ...change });
      for (const record of gated.items.filter(record => record.status !== 'success')) assert.deepEqual(record.candidates, []);
      assert.equal(requests.length, 2);
      const restored = await queryTencentCandidates(full);
      assert.deepEqual(restored.items.map(record => record.reused), [true, true]);
      assert.equal(requests.length, 2);
    }
  });
});

test('malformed or duplicate successful cache entries preserve the checkpoint and send nothing', async () => {
  await fixture(async (options, requests) => {
    const result = await queryTencentCandidates(options);
    for (const successfulQueries of [{}, [{}], [{ ...result.items[0], status: 'blocked' }], [result.items[0], result.items[0]]]) {
      const corrupt = JSON.stringify({ ...result, successfulQueries });
      await writeFile(options.outputPath, corrupt);
      await assert.rejects(queryTencentCandidates(options), /checkpoint/i);
      assert.equal(await readFile(options.outputPath, 'utf8'), corrupt);
      assert.equal(requests.length, 1);
    }
  });
});
