const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const tmapStub = `
  window.TMap = {
    constants: { DEFAULT_CONTROL_ID: { ROTATION: 'rotation' } },
    Point: function (x, y) { this.x = x; this.y = y; },
    LatLng: function (lat, lng) {
      this.lat = lat;
      this.lng = lng;
      this.getLat = function () { return lat; };
      this.getLng = function () { return lng; };
    },
    Map: function (element, options) {
      window.__mapOptions = options;
      const controls = document.createElement('div');
      controls.dataset.sdkControls = '';
      window.__renderMapMarkers = [];
      let center = options.center;
      let zoomLevel = options.zoom;
      this.projectToContainer = function (point) { return {x:innerWidth / 2 + (point.lng-center.lng)*10000, y:innerHeight/2 - (point.lat-center.lat)*10000}; };
      this.unprojectFromContainer = function (point) { return new window.TMap.LatLng(center.lat-(point.y-innerHeight/2)/10000, center.lng+(point.x-innerWidth/2)/10000); };
      window.__testMap = this;
      controls.style.cssText = 'position:absolute;top:0;right:0';
      const rotation = document.createElement('div');
      rotation.innerHTML = '<button aria-label="地图方向" style="display:block;width:100px;height:87px">方向</button>';
      const zoom = document.createElement('button');
      zoom.textContent = '地图缩放';
      zoom.style.cssText = 'display:block;width:40px;height:80px;margin:10px 30px';
      controls.append(rotation, zoom);
      element.appendChild(controls);
      this.getControl = function () {
        return { setClassName: function (name) { rotation.className = name; } };
      };
      this.getZoom = function () { return zoomLevel; };
      this.setZoom = function (zoom) { zoomLevel = zoom; };
      this.getCenter = function () { return new window.TMap.LatLng(31.23, 121.47); };
      this.getBounds = function () {
        return {
          getSouthWest: function () { return new window.TMap.LatLng(31.20, 121.40); },
          getNorthEast: function () { return new window.TMap.LatLng(31.30, 121.55); }
        };
      };
      this.easeTo = function (options, ease) {
        center = options.center;
        if (options.zoom !== undefined) zoomLevel = options.zoom;
        window.__renderMapMarkers.forEach(render => render());
        window.__mapEaseToCalls = window.__mapEaseToCalls || [];
        window.__mapEaseToCalls.push({...options, ...ease});
      };
      this.on = function (event, callback) {
        window.__mapEvents = window.__mapEvents || {};
        window.__mapEvents[event] = callback;
        if (event === 'tilesloaded' && !window.__skipMapTilesLoaded) setTimeout(callback, 0);
      };
      this.destroy = function () { window.__mapDestroyed = true; element.replaceChildren(); };
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
      const layer = this;
      const surface = document.createElement('div');
      options.map && document.querySelector('#map').append(surface);
      function render() {
        surface.replaceChildren();
        layer.geometries.slice().sort((a,b) => (a.rank || 0) - (b.rank || 0)).forEach(geometry => {
          const style = options.styles[geometry.styleId];
          if (!style) return;
          const point = options.map.projectToContainer(geometry.position);
          const pin = document.createElement('img');
          pin.src = style.src; pin.alt = geometry.id;
          pin.dataset.mapPin = geometry.id;
          pin.style.cssText = 'position:absolute;pointer-events:auto;width:' + style.width + 'px;height:' + style.height + 'px;left:' + (point.x - style.anchor.x) + 'px;top:' + (point.y - style.anchor.y) + 'px;z-index:' + (geometry.rank || 0);
          pin.onclick = function () { layer.click?.({geometry}); window.__mapEvents.click?.(); };
          surface.append(pin);
        });
      }
      window.__renderMapMarkers.push(render);
      this.setGeometries = function (geometries) { this.geometries = geometries; render(); };
      this.on = function (event, callback) {
        if (event === 'click') {
          this.click = callback;
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
  await page.getByRole('button', { name: '足迹', exact: true }).click();
  await page.locator('#placeList').getByRole('button', { name: new RegExp(name) }).click();
  await page.getByRole('button', { name: '到访照片', exact: true }).click();
}
for (const width of [320, 375, 414, 768, 1249]) {
  test(`map SDK controls stay below the header and category strip at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    const metrics = await page.evaluate(() => {
      const header = document.querySelector('#visitHeader').getBoundingClientRect();
      const categories = document.querySelector('#mapCatStrip').getBoundingClientRect();
      return { toolbarBottom: Math.max(header.bottom, categories.bottom), controls: Array.from(document.querySelectorAll('[data-sdk-controls] button')).map(el => el.getBoundingClientRect().toJSON()) };
    });
    expect(metrics.controls).toHaveLength(2);
    for (const box of metrics.controls) expect(box.top).toBeGreaterThanOrEqual(metrics.toolbarBottom + 4);
    expect(metrics.controls[1].top).toBeGreaterThanOrEqual(metrics.controls[0].bottom + 4);
    await page.getByRole('button', { name: '地图方向', exact: true }).click();
    await page.getByRole('button', { name: '地图缩放', exact: true }).click();
  });
}
test('only complete public visits appear in map and filtered list; personal data remains byte-for-byte intact', async ({ page }) => {
  const raw = JSON.stringify({ version: 1, places: [{ ...visit, poiId: 'personal-only', name: '私人地点', visits: [{ note: '保留原始照片和评分' }] }] });
  await page.addInitScript(raw => localStorage.setItem('baby_playmap_v1', raw), raw);
  await serveVisits(page, [visit, { ...visit, poiId: 'no-photo', photo: undefined }, { ...visit, poiId: 'no-score', name: '未评分公园', score: undefined }, { ...visit, poiId: 'no-date', visitedOn: undefined }]);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '足迹', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '足迹', exact: true }).click();
  await expect(page.locator('#placeList button')).toHaveCount(2);
  await expect(page.locator('#placeList')).toContainText('未评分公园');
  expect(await page.evaluate(() => window.__markerLayers[0].geometries.length)).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBe(raw);
});

for (const width of [320, 375, 414, 768]) {
  test(`city groups preserve counts, category filtering and detail access at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await serveVisits(page, [
      { ...visit, poiId: 'sh-1', name: '上海公园', address: '上海市浦东新区测试路1号' },
      { ...visit, poiId: 'qz', name: '泉州公园', address: '福建省泉州市鲤城区测试路1号' },
      { ...visit, poiId: 'sh-2', name: '上海商场', category: 'mall', address: '上海市黄浦区测试路2号' },
      { ...visit, poiId: 'nn', name: '南宁公园', address: '广西壮族自治区南宁市青秀区测试路1号' },
      { ...visit, poiId: 'unknown', name: '地址待补公园', address: '' },
      { ...visit, poiId: 'incomplete', address: '浙江省杭州市西湖区', photo: undefined }
    ]);
    await page.goto('/');
    await page.getByRole('button', { name: '足迹', exact: true }).click();
    const list = page.locator('#placeList');
    await expect(list.locator('h3')).toHaveText(['上海市2处', '泉州市1处', '南宁市1处', '城市待补充1处']);
    await expect(list.getByRole('region', { name: '上海市', exact: true }).locator('button strong')).toHaveText(['上海公园', '上海商场']);
    expect(await list.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await list.getByRole('button', { name: '泉州公园', exact: true }).click();
    await page.getByRole('button', {name:'到访照片', exact:true}).click();
    await expect(page.locator('#drawerDetail')).toContainText('泉州公园');
    await page.keyboard.press('Escape');
    await page.locator('#mapCatStrip [data-cat="mall"]').click();
    await page.getByRole('button', { name: '足迹', exact: true }).click();
    await expect(list.locator('h3')).toHaveText(['上海市1处']);
    await expect(list.locator('button strong')).toHaveText(['上海商场']);
    await page.keyboard.press('Escape');
    await page.route('**/map.qq.com/api/gljs**', route => route.abort());
    await page.reload();
    await expect(page.locator('#mapFallback')).toBeVisible();
    await expect(page.locator('#fallbackList h3')).toHaveText(['上海市2处', '泉州市1处', '南宁市1处', '城市待补充1处']);
    await page.locator('#fallbackList').getByRole('button', { name: '泉州公园 · 11 去过', exact: true }).click();
    await expect(page.locator('#drawerDetail')).toContainText('泉州公园');
  });
}

for (const width of [320, 375, 414, 768]) {
  test(`drawers expose close controls and isolate background at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await serveVisits(page, [visit, ...Array.from({ length: 11 }, (_, i) => ({ ...visit, poiId: 'list-' + i, name: i === 10 ? '末项公园' : '到访公园' + i }))]);
    await page.reload();
    const opener = page.getByRole('button', { name: '足迹', exact: true });
    await opener.click();
    const list = page.getByRole('dialog', { name: '11 去过的地方', exact: true });
    const closeList = list.getByRole('button', { name: '关闭地点列表', exact: true });
    await expect(closeList).toBeFocused();
    for (const id of ['btnOpenPrivacy', 'btnLocate']) {
      expect(await page.locator('#' + id).evaluate(el => {
        el.focus();
        return document.activeElement !== el && getComputedStyle(el).visibility === 'hidden';
      })).toBe(true);
    }
    await list.getByRole('button', { name: '末项公园', exact: true }).click();
    await expect(page.getByRole('button', {name:'到访照片', exact:true})).toBeFocused();
    await page.keyboard.press('Enter');
    const detail = page.getByRole('dialog', { name: '末项公园', exact: true });
    await expect(detail.locator('.grabber')).toHaveCount(1);
    await expect(detail.locator('.grabber')).toHaveAttribute('aria-hidden', 'true');
    const close = detail.getByRole('button', { name: '关闭地点详情', exact: true });
    await expect(close).toBeFocused();
    const nav = detail.getByRole('button', { name: '🧭 导航去这里', exact: true });
    await nav.scrollIntoViewIfNeeded();
    await page.evaluate(() => { window.open = () => null; });
    await nav.click();
    await expect(detail.getByRole('status')).toContainText('导航没有打开');
    await close.click();
    await expect(page.getByRole('button', {name:'到访照片', exact:true})).toBeFocused();
    await page.getByRole('button', {name:'收起地点', exact:true}).click();
    await expect(opener).toBeFocused();
    await expect(page.getByRole('button', { name: '数据与隐私', exact: true })).toBeVisible();
    await opener.click(); await closeList.click(); await expect(opener).toBeFocused();
    await opener.click(); await page.locator('#mask').click({ position: { x: 8, y: 8 } });
    await expect(opener).toBeFocused();
    await page.getByRole('button', { name: '数据与隐私', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '数据与隐私', exact: true })).toBeVisible();
  });
}

for (const width of [320, 375, 414, 768]) {
  test(`primary controls have clear 44px targets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    for (const button of await page.locator('#btnPlaceList, #mapCatStrip button, #btnOpenPrivacy').all()) {
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      await button.click({ trial: true });
    }
    const header = await page.locator('#visitHeader').boundingBox();
    const strip = await page.locator('#mapCatStrip').boundingBox();
    expect(header.y + header.height).toBeLessThanOrEqual(strip.y);
    await openVisit(page);
    for (const button of await page.locator('#drawerDetail button').all()) {
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const width of [320, 375, 414, 768]) {
  test(`categories and counts describe only complete visits and retain keyboard selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await serveVisits(page, [visit,
      { ...visit, poiId: 'mall', name: '商场到访', category: 'mall', address: '上海市黄浦区' },
      { ...visit, poiId: 'museum', category: 'museum', photo: undefined }]);
    await page.reload();
    const strip = page.locator('#mapCatStrip');
    await expect(strip.getByRole('button')).toHaveText(['✨ 全部', '🌳 公园', '🛍️ 商场儿童区']);
    await expect(page.locator('#visitCount')).toHaveText('2 个地点');
    const mall = strip.getByRole('button', { name: '🛍️ 商场儿童区', exact: true });
    await mall.focus(); await page.keyboard.press('Enter');
    await expect(mall).toBeFocused(); await expect(mall).toHaveAttribute('aria-pressed', 'true');
    await expect(strip.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#visitCount')).toHaveText('商场儿童区 · 1 个地点');
    expect(await page.locator('#visitHeader').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: '足迹', exact: true }).click();
    await expect(page.locator('#placeList h3')).toHaveText(['上海市1处']);
    await expect(page.locator('#placeList button strong')).toHaveText(['商场到访']);
    await page.keyboard.press('Escape');
    await page.route('**/map.qq.com/api/gljs**', route => route.abort()); await page.reload();
    await page.locator('#mapCatStrip').getByRole('button', { name: '🛍️ 商场儿童区', exact: true }).click();
    await expect(page.locator('#visitCount')).toHaveText('商场儿童区 · 1 个地点');
    await expect(page.locator('#fallbackList h3')).toHaveText(['上海市1处']);
  });
}

test('an empty library offers all-category recovery and read failure stays distinct', async ({ page }) => {
  await serveVisits(page, []); await page.reload();
  await expect(page.locator('#mapCatStrip').getByRole('button')).toHaveText(['✨ 全部']);
  await expect(page.getByText('暂无完整的到访记录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  await expect(page.locator('#mapCatStrip').getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mapCatStrip').getByRole('button')).toBeFocused();
  await page.getByRole('button', { name: '足迹', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '查看全部', exact: true }).click();
  await expect(page.locator('#mapCatStrip').getByRole('button')).toBeFocused();
  await page.route('**/map.qq.com/api/gljs**', route => route.abort()); await page.reload();
  await expect(page.locator('#fallbackList')).toContainText('暂无完整的到访记录');
  await page.locator('#fallbackList').getByRole('button', { name: '查看全部', exact: true }).click();
  await page.route('**/public-places.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.reload();
  await expect(page.locator('#fallbackList')).toContainText('公开到访记录暂时无法读取，请刷新重试');
  await expect(page.locator('#visitCount')).toHaveText('记录暂不可用');
  await expect(page.getByText('暂无完整的到访记录', { exact: true })).toHaveCount(0);
});

test('BFC full title fits two lines at 320px without colliding with the date stamp', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await serveVisits(page, [{ ...visit, name: '上海BFC外滩金融中心南区商场', category: 'mall' }]);
  await page.reload(); await openVisit(page, '上海BFC外滩金融中心南区商场');
  const detail = page.getByRole('dialog', { name: '上海BFC外滩金融中心南区商场', exact: true });
  const photo = detail.locator('.visit-photo');
  await expect.poll(() => photo.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  await photo.evaluate(el => el.decode());
  await expect(photo).toHaveCSS('object-fit', 'contain');
  await detail.evaluate(el => Promise.all(el.getAnimations({ subtree: true })
    .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
    .map(animation => animation.finished)));
  const metrics = await detail.evaluate(el => {
    const title = el.querySelector('#detailTitle'), style = getComputedStyle(title);
    const name = title.getBoundingClientRect(), stamp = el.querySelector('.detail-berry').getBoundingClientRect();
    const photo = el.querySelector('.visit-photo').getBoundingClientRect(), nav = el.querySelector('#btnNav').getBoundingClientRect();
    return { height: name.height, line: parseFloat(style.lineHeight), overflow: style.textOverflow,
      clamp: style.webkitLineClamp, nameRight: name.right, stampLeft: stamp.left, photoBottom: photo.bottom, navTop: nav.top };
  });
  expect(metrics.height).toBeLessThanOrEqual(metrics.line * 2 + 1);
  expect(metrics.overflow).not.toBe('ellipsis'); expect(metrics.clamp).toBe('none');
  expect(metrics.nameRight).toBeLessThanOrEqual(metrics.stampLeft + 4);
  expect(metrics.navTop).toBeGreaterThanOrEqual(metrics.photoBottom);
});

test('visit detail keeps one photo, readable date and age with a small strawberry, with navigation last and no personal actions', async ({ page }) => {
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
    const stamp = el.querySelector('.detail-berry').getBoundingClientRect();
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
  await expect(page.getByRole('button', { name: '🐠 水族馆', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '足迹', exact: true }).click();
  await expect(page.locator('#placeList')).toContainText(visit.name);
  expect(requests).toBe(0);
  expect(await page.evaluate(() => window.__markerLayers[0].geometries.length)).toBe(1);
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
  await page.getByRole('button', { name: '足迹', exact: true }).click();
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

test('detail focus is trapped and Escape restores the photo action', async ({ page }) => {
  await openVisit(page);
  const nav = page.getByRole('button', { name: '🧭 导航去这里', exact: true });
  const close = page.getByRole('button', { name: '关闭地点详情', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(nav).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  await page.keyboard.press('Tab'); await expect(nav).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawerDetail')).not.toHaveClass(/open/);
  await expect(page.getByRole('button', { name: '到访照片', exact: true })).toBeFocused();
});

for (const width of [320, 375, 768, 1440]) {
  test(`detail and corner stamp fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await serveVisits(page, [{ ...visit, name: '一个名称很长但仍然需要完整阅读的到访地点名称' }]);
    await page.reload(); await openVisit(page, '一个名称很长');
    const metrics = await page.locator('#drawerDetail').evaluate(el => {
      const rect = el.getBoundingClientRect(), stamp = el.querySelector('.detail-berry').getBoundingClientRect();
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
  await expect(page.getByRole('button', { name: '足迹', exact: true })).toBeVisible();
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
      await page.getByRole('button', { name: '足迹', exact: true }).click();
      await expect(page.locator('#placeList [data-place-id]')).toHaveCount(age === null ? 0 : 1);
      if (age !== null) {
        await page.locator('#placeList [data-place-id]').click();
        await page.getByRole('button', {name:'到访照片', exact:true}).click();
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
      const stamp = el.querySelector('.detail-berry').getBoundingClientRect();
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
        const stamp = el.querySelector('.detail-berry').getBoundingClientRect();
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

test('map selection opens a compact card and details return to the same selection', async ({ page }) => {
  await expect(page.locator('#placeCard')).toBeHidden();
  await page.evaluate(() => window.__openTestPlace());
  await expect(page.locator('#placeCard')).toBeVisible();
  await expect(page.locator('#placeCard')).toContainText(visit.name);
  await expect(page.locator('#drawerDetail')).not.toHaveClass(/open/);
  await page.getByRole('button', {name:'到访照片', exact:true}).click();
  await expect(page.locator('#drawerDetail')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name:'到访照片', exact:true})).toBeFocused();
  await page.getByRole('button', {name:'收起地点', exact:true}).click();
  await expect(page.locator('#placeCard')).toBeHidden();
});

for (const width of [320, 375, 414, 768, 1249]) {
  test(`selected pin and compact card stay apart with long names at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width, height:430});
    await serveVisits(page, [{...visit, name:'上海BFC外滩金融中心南区商场与附近到访活动的完整地点名称'}]);
    await page.reload();
    await expect(page.locator('[data-map-pin="public:visit-1"]')).toBeVisible();
    await page.evaluate(() => window.__testMap.setZoom(17));
    await page.locator('[data-map-pin="public:visit-1"]').click();
    const pin = page.locator('[data-map-pin="public:visit-1"]');
    const card = page.locator('#placeCard');
    await expect(card).toContainText('上海BFC外滩金融中心');
    const pinBox = await pin.boundingBox(), cardBox = await card.boundingBox();
    const strip = await page.locator('#mapCatStrip').boundingBox();
    expect(pinBox.y).toBeGreaterThanOrEqual(strip.y+strip.height+4);
    if (pinBox.x < cardBox.x+cardBox.width && pinBox.x+pinBox.width > cardBox.x) expect(pinBox.y+pinBox.height).toBeLessThanOrEqual(cardBox.y-4);
    expect(await page.evaluate(() => window.__testMap.getZoom())).toBe(17);
    for (const button of await card.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

test('city and category filters share results and clear selected markers, with unknown-city recovery', async ({page}) => {
  await serveVisits(page, [
    {...visit, address:'上海市黄浦区'},
    {...visit, poiId:'mall', name:'上海商场', category:'mall', address:'上海市黄浦区', lng:121.478},
    {...visit, poiId:'other-city', name:'泉州公园', address:'福建省泉州市'},
    {...visit, poiId:'unknown', name:'待补城市', address:''}
  ]);
  await page.reload();
  await page.getByLabel('选择城市').selectOption('上海市');
  await page.locator('[data-map-pin="public:visit-1"]').click();
  await expect(page.locator('#placeCard')).toContainText(visit.name);
  await expect(page.locator('[data-map-pin="public:visit-1"]')).toHaveCSS('width','60px');
  await expect(page.locator('[data-map-pin="public:mall"]')).toHaveCSS('width','44px');
  await page.locator('[data-map-pin="public:mall"]').click();
  await expect(page.locator('#placeCard')).toContainText('上海商场');
  await expect(page.locator('[data-map-pin="public:visit-1"]')).toHaveCSS('width','44px');
  await expect(page.locator('[data-map-pin="public:mall"]')).toHaveCSS('width','60px');
  // The SDK bubbles a marker click to the map; selection must survive that click.
  await expect(page.locator('#placeCard')).toBeVisible();
  await page.getByLabel('选择城市').selectOption('泉州市');
  await expect(page.locator('#placeCard')).toBeHidden();
  await expect(page.locator('[data-map-pin]')).toHaveCount(1);
  await page.getByRole('button',{name:'🛍️ 商场儿童区',exact:true}).click();
  await expect(page.locator('[data-map-pin]')).toHaveCount(0);
  await expect(page.locator('#visitEmpty')).toBeVisible();
  await page.getByRole('button',{name:'足迹',exact:true}).click();
  await expect(page.locator('#placeList')).toContainText('暂无完整的到访记录');
  await page.locator('#placeList').getByRole('button',{name:'查看全部',exact:true}).click();
  await expect(page.getByLabel('选择城市')).toHaveValue('all');
  await expect(page.locator('[data-map-pin]')).toHaveCount(4);
  await page.getByLabel('选择城市').selectOption('城市待补充');
  await page.getByRole('button',{name:'足迹',exact:true}).click();
  await expect(page.locator('#placeList h3')).toHaveText(['城市待补充1处']);
  await expect(page.locator('#placeList time')).toHaveText(['2026.09.12']);
  await page.locator('#placeList').getByRole('button',{name:'待补城市',exact:true}).click();
  await expect(page.getByRole('button',{name:'到访照片',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#placeCard')).toBeHidden();
  await expect(page.getByRole('button',{name:'足迹',exact:true})).toBeFocused();
});

test('map gestures preserve selection and blank-map click clears its highlight', async ({page}) => {
  await page.clock.install();
  await page.locator('[data-map-pin="public:visit-1"]').click();
  await expect(page.locator('#placeCard')).toBeVisible();
  await page.evaluate(() => {window.__mapEvents.dragstart?.(); window.__mapEvents.dragend?.(); window.__mapEvents.zoom?.();});
  await expect(page.locator('#placeCard')).toBeVisible();
  await expect(page.locator('#drawerDetail')).not.toHaveClass(/open/);
  await page.clock.runFor(450);
  await page.evaluate(() => window.__mapEvents.click());
  await expect(page.locator('#placeCard')).toBeHidden();
  await expect(page.locator('[data-map-pin="public:visit-1"]')).toHaveCSS('width','44px');
});


for (const viewingPhoto of [false, true]) {
test(`map timeout clears selection before fallback details and retry (photo ${viewingPhoto})`, async ({page}) => {
  await page.clock.install();
  await page.addInitScript(() => { window.__skipMapTilesLoaded = true; });
  await serveVisits(page, [visit, {...visit, poiId:'fallback-other', name:'另一个到访地点', lng:121.478}]);
  await page.reload();
  await page.locator('[data-map-pin="public:visit-1"]').click();
  await expect(page.locator('#placeCard')).toContainText(visit.name);
  await page.getByRole('button', {name:'到访照片', exact:true}).focus();
  if (viewingPhoto) await page.keyboard.press('Enter');
  await page.clock.runFor(8001);
  await expect(page.locator('#mapFallback')).toBeVisible();
  await expect(page.locator('#placeCard')).toBeHidden();
  await expect(page.locator('[data-map-pin]')).toHaveCount(0);
  if (viewingPhoto) {
    await expect(page.getByRole('dialog', {name:visit.name, exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('button', {name:'足迹', exact:true})).toBeFocused();
  const fallbackPlace = page.locator('#fallbackList').getByRole('button', {name:'另一个到访地点 · 11 去过', exact:true});
  await fallbackPlace.click();
  await expect(page.getByRole('dialog', {name:'另一个到访地点', exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(fallbackPlace).toBeFocused();
  await expect(page.locator('#placeCard')).toBeHidden();
  await page.evaluate(() => { window.__skipMapTilesLoaded = false; });
  await page.getByRole('button', {name:'重试地图', exact:true}).click();
  await page.clock.runFor(1);
  await expect(page.locator('#mapFallback')).toBeHidden();
  await expect(page.locator('[data-map-pin]')).toHaveCount(2);
  for (const pin of await page.locator('[data-map-pin]').all()) await expect(pin).toHaveCSS('width','44px');
  await expect(page.locator('#placeCard')).toBeHidden();
});
}
