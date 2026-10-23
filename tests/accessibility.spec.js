const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const tmapStub = `
  window.TMap = {
    LatLng: function (lat, lng) {
      this.lat = lat;
      this.lng = lng;
      this.getLat = function () { return lat; };
      this.getLng = function () { return lng; };
    },
    Map: function (element, options) {
      window.__mapOptions = options;
      this.getZoom = function () { return 12; };
      this.getCenter = function () { return new window.TMap.LatLng(31.23, 121.47); };
      this.getBounds = function () {
        return {
          getSouthWest: function () { return new window.TMap.LatLng(31.20, 121.40); },
          getNorthEast: function () { return new window.TMap.LatLng(31.30, 121.55); }
        };
      };
      this.easeTo = function (options) {
        window.__mapEaseToCalls = window.__mapEaseToCalls || [];
        window.__mapEaseToCalls.push(options);
      };
      this.on = function (event, callback) {
        window.__mapEvents = window.__mapEvents || {};
        window.__mapEvents[event] = callback;
        if (event === 'tilesloaded' && !window.__skipMapTilesLoaded) setTimeout(callback, 0);
      };
      this.destroy = function () { window.__mapDestroyed = true; };
    },
    MarkerStyle: function (options) {
      window.__markerStyleOptions = window.__markerStyleOptions || [];
      window.__markerStyleOptions.push(options);
      Object.assign(this, options);
    },
    MultiMarker: function (options) {
      this.options = options;
      this.geometries = [];
      window.__markerLayers = window.__markerLayers || [];
      window.__markerLayers.push(this);
      this.setGeometries = function (geometries) { this.geometries = geometries; };
      this.on = function (event, callback) {
        if (event === 'click') {
          const layer = this;
          window.__openTestPlace = function () {
            callback({ geometry: layer.geometries[0] });
          };
          window.__openMarkerById = function (id) {
            callback({ geometry: layer.geometries.find(geometry => geometry.id === id) });
          };
        }
      };
    },
    service: {
      Search: function () {
        this.searchNearby = function () {
          return Promise.resolve({
            status: 0,
            data: [{
              id: 'tencent-poi-1',
              title: '搜索公园',
              address: '测试路 1 号',
              location: { lat: 31.24, lng: 121.48 }
            }]
          });
        };
      }
    }
  };
`;


const visit = { provider: 'tencent', poiId: 'visit-1', name: '测试到访公园', category: 'park',
  address: '测试路11号', lat: 31.23, lng: 121.47, score: 4.3, visitedOn: '2026-09-12',
  photo: 'assets/visits/disney-20260912.jpg' };
async function serveVisits(page, places = [visit], avatar = 'assets/11-avatar.jpg') {
  await page.route('**/public-places.json', route => route.fulfill({ json: { avatar, places } }));
}
test.beforeEach(async ({ page }) => {
  await serveVisits(page);
  await page.route('**/map.qq.com/api/gljs**', route => route.fulfill({ contentType: 'application/javascript', body: tmapStub }));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => typeof window.__openTestPlace)).toBe('function');
});
async function screenshotWhenReady(page, options) {
  const images = page.locator('img:visible');
  await expect.poll(() => images.evaluateAll(items => items.every(img => img.complete && img.naturalWidth > 0)),
    { message: 'Visible images must load before capturing verification evidence', timeout: 15000 }).toBe(true);
  await images.evaluateAll(items => Promise.all(items.map(img => img.decode())));
  await page.screenshot(options);
}
async function openVisit(page, name = visit.name) {
  await page.getByRole('button', { name: '地点列表', exact: true }).click();
  await page.locator('#placeList').getByRole('button', { name: new RegExp(name) }).click();
}
test('only complete public visits appear in map and filtered list; personal data remains byte-for-byte intact', async ({ page }) => {
  const raw = JSON.stringify({ version: 1, places: [{ ...visit, poiId: 'personal-only', name: '私人地点', visits: [{ note: '保留原始照片和评分' }] }] });
  await page.addInitScript(raw => localStorage.setItem('baby_playmap_v1', raw), raw);
  await serveVisits(page, [visit, { ...visit, poiId: 'no-photo', photo: undefined }, { ...visit, poiId: 'no-score', name: '未评分公园', score: undefined }, { ...visit, poiId: 'no-date', visitedOn: undefined }]);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '地点列表', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '地点列表', exact: true }).click();
  await expect(page.locator('#placeList button')).toHaveCount(2);
  await expect(page.locator('#placeList')).toContainText('未评分公园');
  expect(await page.evaluate(() => window.__markerLayers[0].geometries.length)).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBe(raw);
});

test('visit detail keeps one photo, date and age in the corner, with navigation last and no personal actions', async ({ page }) => {
  await page.goto('/');
  await openVisit(page);
  const detail = page.getByRole('dialog', { name: visit.name, exact: true });
  await expect(detail.getByText('11’s 玩后感', { exact: true })).toHaveCount(0);
  await expect(detail.getByRole('img', { name: /评分/ })).toHaveCount(0);
  await expect(detail.locator('time')).toHaveText('2026.09.12');
  await expect(detail.locator('.stamp-age')).toHaveText('2岁3个月打卡');
  await expect(detail.locator('.visit-photo')).toHaveCount(1);
  await expect(detail.getByRole('button', { name: /复制|添加|删除/ })).toHaveCount(0);
  const nav = detail.getByRole('button', { name: '🧭 导航去这里', exact: true });
  await expect(nav).toBeVisible();
  const layout = await detail.evaluate(el => {
    const photo = el.querySelector('.visit-photo').getBoundingClientRect();
    const stamp = el.querySelector('.visit-stamp').getBoundingClientRect();
    const nav = el.querySelector('#btnNav').getBoundingClientRect();
    return { stampBottom: stamp.bottom, photoTop: photo.top, navTop: nav.top, photoBottom: photo.bottom };
  });
  expect(layout.stampBottom).toBeLessThanOrEqual(layout.photoTop);
  expect(layout.navTop).toBeGreaterThanOrEqual(layout.photoBottom);
  await page.evaluate(() => { window.__opened = null; window.open = url => { window.__opened = url; return {}; }; });
  await nav.click();
  expect(await page.evaluate(() => window.__opened)).toContain('coord:31.23,121.47');
});

async function readLocationMapState(page) {
  return page.evaluate(() => {
    const call = window.__mapEaseToCalls.at(-1);
    const locationLayer = window.__markerLayers.find(layer =>
      layer.geometries.some(geometry => geometry.id === 'user-location')
    );
    const marker = locationLayer.geometries[0];
    return {
      center: [call.center.getLat(), call.center.getLng()],
      zoom: call.zoom,
      marker: [marker.position.getLat(), marker.position.getLng()]
    };
  });
}


test('location is requested only after the user activates the map control', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCalls = 0;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success) {
          window.__geoCalls += 1;
          success({ coords: { latitude: 31.221, longitude: 121.441 } });
        }
      }
    });
  });
  await page.reload();

  await expect.poll(() => page.evaluate(() => window.__geoCalls)).toBe(0);
  const locate = page.getByRole('button', { name: '找到我的位置' });
  await locate.click();

  await expect.poll(() => page.evaluate(() => window.__geoCalls)).toBe(1);
  await expect(locate).toHaveAttribute('aria-pressed', 'true');
  const mapState = await readLocationMapState(page);
  expect(mapState.zoom).toBe(15);
  expect(mapState.center[0]).toBeCloseTo(31.21913, 5);
  expect(mapState.center[1]).toBeCloseTo(121.44561, 5);
  expect(mapState.marker).toEqual(mapState.center);
});

test('eastern Shanghai operating locations use GCJ-02 coordinates', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoPoint = { latitude: 30.9255, longitude: 121.9070 };
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success) {
          success({ coords: window.__geoPoint });
        }
      }
    });
  });
  await page.reload();

  for (const point of [
    { latitude: 30.9255, longitude: 121.9070 },
    { latitude: 30.9169, longitude: 121.9167 }
  ]) {
    await page.evaluate(value => { window.__geoPoint = value; }, point);
    await page.getByRole('button', { name: '找到我的位置' }).click();
    const mapState = await readLocationMapState(page);
    expect(mapState.center[0]).not.toBe(point.latitude);
    expect(mapState.center[1]).not.toBe(point.longitude);
    expect(mapState.marker).toEqual(mapState.center);
  }
});

test('location permission denial is explained and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCalls = 0;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success, failure) {
          window.__geoCalls += 1;
          if (window.__geoCalls === 1) {
            failure({ code: 1 });
          } else {
            success({ coords: { latitude: 31.215, longitude: 121.455 } });
          }
        }
      }
    });
  });
  await page.reload();

  const locate = page.getByRole('button', { name: '找到我的位置' });
  await locate.click();
  await expect(page.getByRole('status')).toContainText('请在浏览器设置中允许定位');
  await expect(locate).toBeEnabled();
  await expect(locate).toHaveAttribute('aria-busy', 'false');

  await locate.click();

  await expect.poll(() => page.evaluate(() => window.__geoCalls)).toBe(2);
  await expect(locate).toHaveAttribute('aria-pressed', 'true');
  const mapState = await readLocationMapState(page);
  expect(mapState.zoom).toBe(15);
  expect(mapState.center[0]).toBeCloseTo(31.21310, 5);
  expect(mapState.center[1]).toBeCloseTo(121.45958, 5);
  expect(mapState.marker).toEqual(mapState.center);
});

test('nearby location outside mainland China keeps browser coordinates unchanged', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success) {
          success({ coords: { latitude: 37.5665, longitude: 126.978 } });
        }
      }
    });
  });
  await page.reload();

  await page.getByRole('button', { name: '找到我的位置' }).click();

  const mapState = await readLocationMapState(page);
  expect(mapState).toEqual({
    center: [37.5665, 126.978],
    zoom: 15,
    marker: [37.5665, 126.978]
  });
});

test('location recentering is immediate when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success) {
          success({ coords: { latitude: 31.218, longitude: 121.458 } });
        }
      }
    });
  });
  await page.reload();

  await page.getByRole('button', { name: '找到我的位置' }).click();

  await expect.poll(() => page.evaluate(() => window.__mapEaseToCalls.at(-1).duration)).toBe(0);
});


test('reduced motion uses short opacity-only transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.locator('.chip').first().evaluate(element => {
    const style = getComputedStyle(element);
    return {
      properties: style.transitionProperty.split(',').map(value => value.trim()),
      durations: style.transitionDuration.split(',').map(value => Number.parseFloat(value) * 1000)
    };
  });

  expect(motion.properties).toEqual(['opacity']);
  expect(Math.max(...motion.durations)).toBeLessThanOrEqual(150);
});


test('public map has no search or add controls and categories never fetch online candidates', async ({ page }) => {
  await expect(page.locator('#searchBox')).toBeHidden();
  await expect(page.getByRole('button', { name: /添加地点|我的地图/ })).toHaveCount(0);
  let requests = 0;
  await page.route('**/apis.map.qq.com/**', route => { requests += 1; return route.abort(); });
  await page.getByRole('button', { name: '🌳 公园', exact: true }).click();
  await page.evaluate(() => window.__mapEvents.idle?.());
  await page.getByRole('button', { name: '🐠 水族馆', exact: true }).click();
  await page.getByRole('button', { name: '地点列表', exact: true }).click();
  await expect(page.locator('#placeList')).toContainText('暂无完整');
  expect(requests).toBe(0);
  expect(await page.evaluate(() => window.__markerLayers[0].geometries)).toEqual([]);
  expect(await page.evaluate(() => window.__mapOptions.baseMap.features)).toEqual(['base', 'label']);
});

test('invalid photo, date and POI identities stay out of markers and lists', async ({ page }) => {
  const invalid = [
    { photo: 'https://example.com/private.jpg' }, { photo: 'assets/visits/../other.jpg' },
    { visitedOn: '2026-09' }, { visitedOn: '2026-02-30' }, { visitedOn: '2024-06-10' },
    { visitedOn: '9999-01-01' }, { provider: 'other' }, { lat: 99 }
  ].map((patch, i) => ({ ...visit, poiId: 'invalid-' + i, ...patch }));
  await serveVisits(page, [...invalid, visit]);
  await page.reload();
  await page.getByRole('button', { name: '地点列表', exact: true }).click();
  await expect(page.locator('#placeList button')).toHaveCount(1);
  expect(await page.evaluate(() => window.__markerLayers[0].geometries.map(g => g.id))).toEqual(['public:visit-1']);
});

for (const [date, age] of [
  ['2024-06-11', '0岁0个月'], ['2025-06-10', '0岁11个月'],
  ['2025-06-11', '1岁0个月'], ['2026-09-10', '2岁2个月']
]) {
  test(`visit age uses completed months on ${date}`, async ({ page }) => {
    await serveVisits(page, [{ ...visit, visitedOn: date }]);
    await page.reload(); await openVisit(page);
    await expect(page.locator('.stamp-age')).toHaveText(age + '打卡');
  });
}

for (const raw of ['{broken json', JSON.stringify({ version: 999, places: [{ private: true }] }), JSON.stringify({ version: 1, places: [{ name: '归属不明', photos: ['private-photo'], rating: 5 }] })]) {
  test(`old private storage is never normalized: ${raw.slice(0, 26)}`, async ({ page }) => {
    await page.evaluate(raw => localStorage.setItem('baby_playmap_v1', raw), raw);
    await page.reload(); await openVisit(page);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBe(raw);
  });
}

test('only explicit double confirmation clears old private data while keeping public visits', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('baby_playmap_v1', '{private archive'));
  await page.reload();
  await page.getByRole('button', { name: '数据与隐私', exact: true }).click();
  await page.getByRole('button', { name: '清空我的地点', exact: true }).click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBe('{private archive');
  await page.getByRole('button', { name: '清空我的地点', exact: true }).click();
  await page.locator('#confirmYes').click(); await page.locator('#confirmYes').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('baby_playmap_v1')).places)).toEqual([]);
  await page.keyboard.press('Escape'); await openVisit(page);
  await expect(page.locator('.visit-photo')).toBeVisible();
});

test('map failure keeps complete public visits filterable and allows explicit map retry', async ({ page }) => {
  await page.route('**/map.qq.com/api/gljs**', route => route.abort());
  await page.reload();
  await expect(page.locator('#mapFallback')).toBeVisible();
  await page.locator('#fallbackList').getByRole('button', { name: visit.name + ' · 11 去过', exact: true }).click();
  await expect(page.locator('#drawerDetail')).toContainText('2岁3个月');
  await page.keyboard.press('Escape');
  await page.route('**/map.qq.com/api/gljs**', route => route.fulfill({ contentType: 'application/javascript', body: tmapStub }));
  await page.getByRole('button', { name: '重试地图', exact: true }).click();
  await expect(page.locator('#mapFallback')).toBeHidden();
});

test('tile loading timeout enters the public list fallback', async ({ page }) => {
  await page.addInitScript(() => { window.__skipMapTilesLoaded = true; });
  await page.reload();
  await expect(page.locator('#mapFallback')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#fallbackList')).toContainText(visit.name);
});

test('blocked navigation preserves the detail with retry and direct map link', async ({ page }) => {
  await openVisit(page);
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button', { name: '🧭 导航去这里', exact: true }).click();
  await expect(page.locator('#navigationFallback')).toContainText('导航没有打开');
  await expect(page.getByRole('link', { name: '打开腾讯地图', exact: true })).toHaveAttribute('href', /coord:31.23,121.47/);
  await expect(page.getByRole('button', { name: /复制目的地/ })).toHaveCount(0);
  await expect(page.locator('.visit-photo')).toBeVisible();
});

test('detail focus is trapped and Escape restores the list opener', async ({ page }) => {
  await openVisit(page);
  const nav = page.getByRole('button', { name: '🧭 导航去这里', exact: true });
  await expect(nav).toBeFocused();
  await page.keyboard.press('Tab'); await expect(nav).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(nav).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawerDetail')).not.toHaveClass(/open/);
  await expect(page.getByRole('button', { name: '地点列表', exact: true })).toBeFocused();
});

for (const width of [320, 375, 768, 1440]) {
  test(`detail and corner stamp fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await serveVisits(page, [{ ...visit, name: '一个名称很长但仍然需要完整阅读的到访地点名称' }]);
    await page.reload(); await openVisit(page, '一个名称很长');
    const metrics = await page.locator('#drawerDetail').evaluate(el => {
      const rect = el.getBoundingClientRect(), stamp = el.querySelector('.visit-stamp').getBoundingClientRect();
      const name = el.querySelector('.d-name').getBoundingClientRect();
      return { width: rect.width, scroll: el.scrollWidth, client: el.clientWidth, nameRight: name.right, stampLeft: stamp.left, stampRight: stamp.right, right: rect.right };
    });
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.client);
    expect(metrics.nameRight).toBeLessThanOrEqual(metrics.stampLeft + 4);
    expect(metrics.stampRight).toBeLessThanOrEqual(metrics.right);
    if (width >= 768) expect(metrics.width).toBeLessThanOrEqual(420);
  });
}

test('local POI maintenance remains online and never writes personal map data', async ({ page }) => {
  await page.goto('/?maintain=1');
  await expect(page.locator('#searchBox')).toBeVisible();
  await page.locator('#searchInput').fill('搜索公园');
  await page.locator('.sr-item').filter({ hasText: '搜索公园' }).click();
  await page.getByRole('button', { name: '选择类别并填写到访记录', exact: true }).click();
  await page.getByRole('button', { name: '11 去过，填写到访记录', exact: true }).click();
  await expect(page).toHaveURL(/maintainer.html$/);
  await expect(page.locator('#heading')).toContainText('搜索公园');
  expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBeNull();
});

test('public origins cannot enable the local POI search mode', async ({ page }) => {
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  await page.route('https://playmap.example/**', route => {
    if (route.request().url().includes('public-places.json')) return route.fulfill({ json: { places: [visit] } });
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://playmap.example/?maintain=1');
  await expect(page.locator('#searchBox')).toBeHidden();
  await expect(page.getByRole('button', { name: '地点列表', exact: true })).toBeVisible();
});

test('public record fetch failure is explained without touching old storage', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('baby_playmap_v1', 'unreadable private data'));
  await page.route('**/public-places.json', route => route.fulfill({ status: 503, body: '' }));
  await page.reload();
  await expect(page.locator('#toast')).toContainText('公开到访记录暂时无法读取');
  expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBe('unreadable private data');
});

test('local maintenance falls back through JSONP suggestion and city search when SDK search fails', async ({ page }) => {
  await page.route('**/map.qq.com/api/gljs**', route => route.fulfill({ contentType: 'application/javascript',
    body: tmapStub + '\nTMap.service.Search = function () { this.searchNearby = () => Promise.reject(new Error("SDK unavailable")); };' }));
  const hops = [];
  await page.route('**/apis.map.qq.com/ws/place/v1/**', route => {
    const url = new URL(route.request().url());
    hops.push(url.pathname);
    const data = url.pathname.endsWith('/suggestion') ? [] : [{ id: 'jsonp-poi', title: '降级检索公园', address: '测试路', location: { lat: 31.24, lng: 121.48 } }];
    return route.fulfill({ contentType: 'application/javascript', body: `${url.searchParams.get('callback')}(${JSON.stringify({ status: 0, data })})` });
  });
  await page.goto('/?maintain=1');
  await page.locator('#searchInput').fill('降级检索公园');
  const result = page.locator('.sr-item').filter({ hasText: '降级检索公园' });
  await expect(result).toBeVisible({ timeout: 5000 }); await result.click();
  await page.getByRole('button', { name: '选择类别并填写到访记录', exact: true }).click();
  await page.getByRole('button', { name: '11 去过，填写到访记录', exact: true }).click();
  await expect(page.locator('#heading')).toContainText('降级检索公园');
  expect(hops).toEqual(['/ws/place/v1/suggestion', '/ws/place/v1/search']);
});

test.describe('map and maintenance interpret the same visit in Shanghai time', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  for (const [label, patch, age] of [
    ['birth day', { visitedOn: '2024-06-11' }, '0岁0个月'],
    ['day before month birthday', { visitedOn: '2026-09-10' }, '2岁2个月'],
    ['month birthday', { visitedOn: '2026-09-11' }, '2岁3个月'],
    ['leap day', { visitedOn: '2028-02-29' }, '3岁8个月'],
    ['Shanghai today while device is yesterday', { visitedOn: '2028-03-01' }, '3岁8个月'],
    ['Shanghai tomorrow', { visitedOn: '2028-03-02' }, null],
    ['before birth', { visitedOn: '2024-06-10' }, null],
    ['impossible leap day', { visitedOn: '2027-02-29' }, null],
    ['unsupported photo', { photo: 'https://example.invalid/visit.jpg' }, null],
    ['unsupported data image', { photo: 'data:image/png;base64,AAAA' }, null],
    ['oversized JPEG', { photo: 'data:image/jpeg;base64,' + 'A'.repeat(450000) }, null],
    ['supported JPEG', { photo: 'data:image/jpeg;base64,AAAA' }, '2岁3个月'],
    ['minimum score', { score: 1 }, '2岁3个月'],
    ['maximum score', { score: 5 }, '2岁3个月'],
    ['no score', { score: undefined }, '2岁3个月'],
    ['invalid legacy score', { score: { old: true } }, '2岁3个月']
  ]) {
    test(label, async ({ page }) => {
      await page.clock.setFixedTime(new Date('2028-02-29T16:30:00Z'));
      const record = { ...visit, ...patch, history: { retained: ['original'] } };
      await serveVisits(page, [record]);
      await page.reload();
      await page.getByRole('button', { name: '地点列表', exact: true }).click();
      await expect(page.locator('#placeList button')).toHaveCount(age === null ? 0 : 1);
      if (age !== null) {
        await page.locator('#placeList button').click();
        await expect(page.locator('.stamp-age')).toHaveText(age + '打卡');
      }
      await page.goto('/maintainer.html');
      await page.locator('#start').click();
      await expect(page.getByLabel('到访日期')).toHaveAttribute('max', '2028-03-01');
      await page.locator('#next').click();
      await expect(page.locator('#review')).toBeVisible();
      if (age === null) await expect(page.locator('#reviewDate')).toContainText('暂不上图');
      else {
        await expect(page.locator('#reviewDate')).toContainText(age);
        await expect(page.locator('#reviewDate')).not.toContainText('暂不上图');
      }
      if (label.includes('photo') || label.includes('image') || label.includes('oversized')) {
        await expect(page.locator('#reviewPhoto')).toBeHidden();
      }
      expect(JSON.parse(await page.locator('#output').inputValue()).places[0]).toEqual(record);
      if (label === 'unsupported photo') {
        await screenshotWhenReady(page, { path: '/tmp/playmap-37-invalid-photo-preview.png', fullPage: true });
      }
    });
  }
});

for (const [label, reflection, displayed] of [
  ['short sentence', '  这是测试示意：玩得开心，也有一点遗憾。  ', '这是测试示意：玩得开心，也有一点遗憾。'],
  ['trimmed literal HTML', '  <img src=x onerror="window.reflectionExecuted=true">  ', '<img src=x onerror="window.reflectionExecuted=true">'],
  ['80 characters', '玩'.repeat(80), '玩'.repeat(80)],
  ['absent', undefined, ''], ['blank', '   ', ''], ['invalid type', { text: '不能显示' }, ''],
  ['overlong', '玩'.repeat(81), ''], ['multiline', '第一行\n第二行', '']
]) {
  test(`reflection ${label} displays safely without changing visit context`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await serveVisits(page, [{ ...visit, score: 'invalid historical score', reflection }]);
    await page.reload();
    await openVisit(page);
    const detail = page.getByRole('dialog', { name: visit.name, exact: true });
    await detail.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    await expect(detail.getByText('11’s 玩后感', { exact: true })).toHaveCount(displayed ? 1 : 0);
    if (displayed) await expect(detail.locator('.visit-reflection')).toHaveText(displayed);
    else await expect(detail.locator('.visit-heading')).toHaveCount(0);
    await expect(detail.locator('.visit-avatar')).toHaveCount(displayed ? 1 : 0);
    await expect(detail.locator('.rating-stars')).toHaveCount(0);
    await expect(detail.locator('.visit-photo')).toBeVisible();
    await expect(detail.locator('time')).toHaveText('2026.09.12');
    await expect(detail.getByRole('button', { name: '🧭 导航去这里', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.reflectionExecuted)).toBeUndefined();
    expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const layout = await detail.evaluate(el => {
      const photo = el.querySelector('.visit-photo').getBoundingClientRect();
      const stamp = el.querySelector('.visit-stamp').getBoundingClientRect();
      const nav = el.querySelector('#btnNav').getBoundingClientRect();
      return { stampBottom: stamp.bottom, photoTop: photo.top, navTop: nav.top, photoBottom: photo.bottom };
    });
    expect(layout.stampBottom).toBeLessThanOrEqual(layout.photoTop);
    expect(layout.navTop).toBeGreaterThanOrEqual(layout.photoBottom);
    if (label === '80 characters' || label === 'short sentence' || label === 'absent') {
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(390);
      await expect.poll(async () => (await detail.boundingBox()).width).toBe(390);
      await screenshotWhenReady(page, { path: '/tmp/playmap-39-logs/synthetic-' + label.replaceAll(' ', '-') + '-390.png' });
    }
    if (label === '80 characters') {
      await page.setViewportSize({ width: 320, height: 844 });
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(320);
      await expect.poll(async () => (await detail.boundingBox()).width).toBe(320);
      await expect(detail.locator('.visit-photo')).toBeVisible();
      expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const narrow = await detail.evaluate(el => {
        const photo = el.querySelector('.visit-photo').getBoundingClientRect();
        const stamp = el.querySelector('.visit-stamp').getBoundingClientRect();
        const nav = el.querySelector('#btnNav').getBoundingClientRect();
        return { stampBottom: stamp.bottom, photoTop: photo.top, navTop: nav.top, photoBottom: photo.bottom };
      });
      expect(narrow.stampBottom).toBeLessThanOrEqual(narrow.photoTop);
      expect(narrow.navTop).toBeGreaterThanOrEqual(narrow.photoBottom);
      await screenshotWhenReady(page, { path: '/tmp/playmap-39-logs/synthetic-80-characters-320.png' });
      await detail.getByRole('button', { name: '🧭 导航去这里', exact: true }).scrollIntoViewIfNeeded();
      await expect(detail.getByRole('button', { name: '🧭 导航去这里', exact: true })).toBeInViewport();
      await screenshotWhenReady(page, { path: '/tmp/playmap-39-logs/synthetic-80-characters-320-navigation.png' });
    }
  });
}
