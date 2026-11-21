const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
// Layout-bearing defaults from Tencent GL JS; app CSS must enlarge the native targets.
const tmapControlCss = `
  .rotate-circle { position:relative; width:60px; height:60px; padding:20px 20px 7px; box-sizing:content-box; }
  .rotate-circle * { box-sizing:content-box; }
  .rotate-panel { position:relative; left:0; top:-60px; }
  .rotate-left, .rotate-top, .rotate-right, .rotate-bottom { position:absolute; width:30px; height:30px; }
  .rotate-left { top:15px; left:-6px; transform:rotate(-45deg); }
  .rotate-top { top:-6px; left:15px; transform:rotate(45deg); }
  .rotate-right { top:15px; left:36px; transform:rotate(45deg); }
  .rotate-bottom { top:36px; left:15px; transform:rotate(45deg); }
  .compass-circle, .compass-circle-background { position:relative; width:28px; height:28px; border:1px solid transparent; left:15px; }
  .compass-circle { top:-15px; z-index:100; }
  .compass-circle-background { top:15px; }
  .compass-img { height:28px; position:relative; left:30%; }
  .tmap-zoom-control { display:flex; flex-direction:column; justify-content:center; align-items:center; position:relative; width:40px; height:80px; margin:10px 30px 20px; }
  .tmap-zoom-content { flex:auto; order:1; flex-grow:0; margin:8px 0; }
  .tmap-zoom-in, .tmap-zoom-out { position:absolute; width:24px; height:24px; left:8px; }
  .tmap-zoom-in { top:8px; } .tmap-zoom-out { top:48px; }
  .tmap-zoom-spliter { width:40px; }
`;
const tmapStub = `
  window.TMap = {
    constants: { DEFAULT_CONTROL_ID: { ROTATION: 'rotation', ZOOM: 'zoom' }, CONTROL_POSITION: { TOP_RIGHT: 'topRight' } },
    Point: function (x, y) { this.x = x; this.y = y; },
    LatLng: function (lat, lng) {
      this.lat = lat;
      this.lng = lng;
      this.getLat = function () { return lat; };
      this.getLng = function () { return lng; };
    },
    LatLngBounds: function () {
      const points = [];
      this.extend = function (point) { points.push(point); return this; };
      this.toJSON = function () { return points.map(point => [point.lat, point.lng]); };
      this.isEmpty = function () { return points.length === 0; };
      this.getCenter = function () {
        return new window.TMap.LatLng(
          points.reduce((sum, point) => sum + point.lat, 0) / points.length,
          points.reduce((sum, point) => sum + point.lng, 0) / points.length
        );
      };
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
      const style = document.createElement('style');
      style.textContent = ${JSON.stringify(tmapControlCss)};
      document.head.append(style);
      const rotation = document.createElement('div');
      rotation.innerHTML = '<div class="rotate-circle"><div class="compass-circle-background"></div><div class="compass-circle"><img class="compass-img"></div><div class="rotate-panel"><div class="rotate-left clickable-rotate-left"></div><div class="rotate-top clickable-rotate-top"></div><div class="rotate-right clickable-rotate-right"></div><div class="rotate-bottom clickable-rotate-bottom"></div></div></div>';
      const zoom = document.createElement('div');
      zoom.innerHTML = '<div class="tmap-zoom-control"><div class="tmap-zoom-content"><div class="tmap-zoom-in"></div><div class="tmap-zoom-number" style="display:none"></div><div class="tmap-zoom-spliter"></div><div class="tmap-zoom-out"></div></div></div>';
      rotation.querySelector('img').src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="12" height="28"><path d="M6 0L12 28H0Z"/></svg>';
      zoom.querySelector('.tmap-zoom-in').onclick = () => { zoomLevel++; };
      zoom.querySelector('.tmap-zoom-out').onclick = () => { zoomLevel--; };
      controls.append(rotation, zoom);
      element.appendChild(controls);
      this.getControl = function (id) {
        const control = id === 'rotation' ? rotation : zoom;
        return {
          setClassName: function (name) { control.className = name; },
          setPosition: function () {}
        };
      };
      this.getZoom = function () { return zoomLevel; };
      this.getRotation = function () { return window.__rotation || 0; };
      this.getPitch = function () { return window.__pitch || 0; };
      this.setZoom = function (zoom) { zoomLevel = zoom; };
      this.getCenter = function () { return new window.TMap.LatLng(31.23, 121.47); };
      this.getBounds = function () {
        return {
          getSouthWest: function () { return new window.TMap.LatLng(31.20, 121.40); },
          getNorthEast: function () { return new window.TMap.LatLng(31.30, 121.55); }
        };
      };
      this.fitBounds = function (bounds, options) {
        window.__mapFitBoundsCalls = window.__mapFitBoundsCalls || [];
        window.__mapFitBoundsCalls.push({ bounds: bounds.toJSON(), options: options });
        center = bounds.getCenter();
        window.__renderMapMarkers.forEach(render => render());
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
  await page.getByRole('button', { name: /足迹/ }).click();
  await page.locator('#placeList').getByRole('button', { name: new RegExp(name) }).click();
}
// 胶卷取代了旧的紧凑浮标：选中状态的可见载体是当前画格。
const selectedFrame = page => page.locator('#filmstrip .film-frame.is-current');
const filmFrames = page => page.locator('#filmstrip .film-frame');
test('initial all-city framing, complete counts and adjacent filtered places agree', async ({page}) => {
  await serveVisits(page, [
    {...visit, poiId:'a', name:'新地点', address:'上海市黄浦区', visits:[
      {visitedOn:'2026-09-12', photo:visit.photo}, {visitedOn:'2025-05-01', photo:visit.photo},
      {visitedOn:'2025-04-01', photo:''}]},
    {...visit, poiId:'b', name:'早地点', address:'上海市黄浦区', visitedOn:'2026-05-01'},
    {...visit, poiId:'c', name:'远地点', address:'北京市朝阳区', lat:39.9, lng:116.4, visitedOn:'2025-06-01'}
  ]);
  await page.reload();
  await expect(page.locator('#btnPlaceList')).toHaveText('足迹 3');
  expect(await page.evaluate(() => window.__mapFitBoundsCalls[0].bounds.length)).toBe(3);
  expect(await page.evaluate(() => window.__mapFitBoundsCalls[0].options.padding.bottom)).toBeGreaterThan(148);
  await page.locator('#cityFilter').selectOption('上海市');
  await page.locator('#btnPlaceList').click();
  await expect(page.locator('#placeListTitle')).toHaveText('2 处 · 3 次');
  await page.keyboard.press('Escape');
  await filmFrames(page).first().click();
  await expect(page.locator('#btnPreviousPlace')).toBeDisabled();
  await expect(page.locator('#btnNextPlacePrimary')).toBeEnabled();
  await page.locator('#btnNextPlacePrimary').click();
  await expect(page.locator('#detailTitle')).toHaveText('早地点');
  await expect(page.locator('#btnNextPlacePrimary')).toBeDisabled();
  await expect(page.locator('#btnPreviousPlace')).toBeFocused();
  await page.locator('#btnPreviousPlace').click();
  await expect(page.locator('#detailTitle')).toHaveText('新地点');
  await expect(page.locator('#btnNextPlacePrimary')).toBeFocused();
  await expect(page.locator('#detailContent').getByRole('button', {name:'下一个地点 →', exact:true})).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(selectedFrame(page)).toBeFocused();
  await expect(page.locator('#btnVisitPhoto')).toHaveCount(0);
});

test('a single initial place is centered without selecting it', async ({page}) => {
  const center = await page.evaluate(() => ({
    calls:window.__mapEaseToCalls.map(call => ({lat:call.center.lat, lng:call.center.lng})),
    fits:window.__mapFitBoundsCalls || []
  }));
  expect(center.calls).toEqual([{lat:visit.lat, lng:visit.lng}]);
  expect(center.fits).toEqual([]);
  await expect(selectedFrame(page)).toHaveCount(0);
});

test('detail stepping retains the pressed control until its boundary', async ({page}) => {
  await serveVisits(page, [visit,
    {...visit, poiId:'middle', visitedOn:'2026-08-01'},
    {...visit, poiId:'last', visitedOn:'2026-07-01'}]);
  await page.reload();
  await filmFrames(page).first().click();
  await page.locator('#btnNextPlacePrimary').click();
  await expect(page.locator('#btnNextPlacePrimary')).toBeFocused();
  await page.locator('#btnNextPlacePrimary').click();
  await expect(page.locator('#btnPreviousPlace')).toBeFocused();
  await page.locator('#btnPreviousPlace').click();
  await expect(page.locator('#btnPreviousPlace')).toBeFocused();
  await page.locator('#btnPreviousPlace').click();
  await expect(page.locator('#btnNextPlacePrimary')).toBeFocused();
});

for (const height of [844, 480]) {
  test(`list entry survives place stepping and Escape or Close at 390x${height}`, async ({page}) => {
    await page.setViewportSize({width:390, height});
    await serveVisits(page, Array.from({length:15}, (_, i) => ({...visit,
      poiId:'step-' + i, name:'地点' + i, visitedOn:'2026-09-' + String(28 - i).padStart(2, '0')})));
    await page.reload();
    await page.locator('#btnPlaceList').click();
    const list = page.locator('#drawerPlaces');
    const row = list.getByRole('button', {name:'地点10', exact:true});
    for (const exit of ['escape', 'close']) {
      await expect.poll(() => list.evaluate(el => Math.round(el.getBoundingClientRect().bottom))).toBe(height);
      await row.scrollIntoViewIfNeeded();
      const scroll = await list.evaluate(el => el.scrollTop);
      await row.click();
      await page.locator('#btnNextPlacePrimary').click();
      await expect(page.locator('#detailTitle')).toHaveText('地点11');
      await page.locator('#btnPreviousPlace').click();
      await page.locator('#btnPreviousPlace').click();
      await expect(page.locator('#detailTitle')).toHaveText('地点9');
      if (exit === 'escape') await page.keyboard.press('Escape');
      else await page.getByRole('button', {name:'关闭地点详情', exact:true}).click();
      await expect(list).toHaveClass(/open/);
      await expect(row).toBeFocused();
      expect(await list.evaluate(el => el.scrollTop)).toBe(scroll);
    }
  });
}

test('closing a filmstrip detail after resizing to a short viewport uses the Footprints fallback', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await filmFrames(page).first().click();
  await page.setViewportSize({width:390, height:480});
  await expect(page.locator('#filmstrip')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#btnPlaceList')).toBeFocused();
});

test('scrollable multi-visit details clip their paint to the drawer, not the map above', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await serveVisits(page, [{...visit, visits:[
    {visitedOn:'2026-09-12', photo:visit.photo}, {visitedOn:'2025-05-01', photo:visit.photo}]}]);
  await page.reload();
  await filmFrames(page).first().click();
  const detail = page.locator('#drawerDetail');
  await expect(detail).toHaveCSS('clip-path', 'inset(0px round 24px 24px 0px 0px)');
  const pin = await page.locator('[data-map-pin="public:visit-1"]').boundingBox();
  const drawer = await detail.boundingBox();
  expect(pin.y + pin.height).toBeLessThanOrEqual(drawer.y - 4);
  expect(pin.y).toBeGreaterThan((await page.locator('#mapCatStrip').boundingBox()).y + 44);
  await expect(detail.locator('.visit-track')).toHaveCSS('overflow-x', 'auto');
  await expect(detail).toHaveCSS('overflow-y', 'auto');
});

test('compass normalizes north and samples the SDK state after the last change event', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  const compass = page.locator('.map-orientation-control');
  await page.evaluate(() => { window.__rotation=360.2; window.__pitch=-0.2; window.__mapEvents.rotation_changed(); });
  await expect(compass).toBeHidden();
  await page.evaluate(() => { window.__rotation=-359; window.__mapEvents.rotation_changed(); });
  await expect(compass).toBeVisible();
  await page.evaluate(() => {
    window.__mapEvents.rotation_changed();
    window.__rotation=0;
    window.__pitch=0;
  });
  await expect(compass).toBeHidden();
  for (const event of ['idle', 'moveend', 'rotateend']) {
    await page.evaluate(() => { window.__rotation=45; window.__mapEvents.rotation_changed(); });
    await expect(compass).toBeVisible();
    await page.evaluate(event => { window.__rotation=0; window.__mapEvents[event](); }, event);
    await expect(compass).toBeHidden();
  }
});

test('the final two-digit replay station and revisit label fit at 390px', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.emulateMedia({reducedMotion:'reduce'});
  await serveVisits(page, [{...visit, visits:[
    {visitedOn:'2026-09-12', photo:visit.photo}, {visitedOn:'2025-05-01', photo:visit.photo}]},
    ...Array.from({length:9}, (_, i) => ({...visit, poiId:'replay-' + i,
      visitedOn:new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10)}))]);
  await page.reload();
  await page.clock.install();
  await page.locator('#routePlay').click();
  await expect(filmFrames(page)).toHaveCount(11);
  await page.clock.runFor(2300 * 10 + 100);
  const title = page.locator('#filmstripTitle');
  await expect(title).toHaveText('11/11 站 · 第 2 次来');
  expect(await title.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(page.locator('#filmstrip')).toHaveCSS('height', '184px');
  await expect(page.locator('#routePlay')).toHaveText('重播');
});

test('mobile compass appears only for orientation changes and More stays next to its button', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.map-zoom-control')).toBeHidden();
  await expect(page.locator('.map-orientation-control')).toBeHidden();
  await page.evaluate(() => { window.__rotation=30; window.__mapEvents.rotation_changed(); });
  await expect(page.locator('.map-orientation-control')).toBeVisible();
  await page.evaluate(() => { window.__rotation=0; window.__pitch=20; window.__mapEvents.pitch_changed(); });
  await expect(page.locator('.map-orientation-control')).toBeVisible();
  await page.evaluate(() => { window.__pitch=0; window.__mapEvents.pitch_changed(); });
  await expect(page.locator('.map-orientation-control')).toBeHidden();
  for (const width of [390,1440]) {
    await page.setViewportSize({width,height:900});
    await page.locator('#btnMore').click();
    const button=await page.locator('#btnMore').boundingBox(), menu=await page.locator('#moreMenu').boundingBox();
    expect(menu.x-button.x-button.width).toBeCloseTo(8,0);
    expect(menu.y+menu.height).toBeCloseTo(button.y+button.height,0);
    await page.keyboard.press('Escape');
  }
});
test('More exposes privacy with keyboard, restores focus and remains available without the map', async ({ page }) => {
  await page.addInitScript(() => {
    window.locationRequests = 0;
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition() { window.locationRequests++; } } });
  });
  await page.evaluate(() => localStorage.setItem('baby_playmap_v1', '{private archive'));
  await page.reload();
  for (const mapAvailable of [true, false]) {
    if (!mapAvailable) {
      await page.route('**/map.qq.com/api/gljs**', route => route.abort());
      await page.reload();
      await expect(page.locator('#mapFallback')).toBeVisible();
    }
    const more = page.getByRole('button', { name: '更多', exact: true });
    await expect(page.getByRole('menuitem', { name: '数据与隐私', exact: true })).toBeHidden();
    await more.focus(); await page.keyboard.press('Enter');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const privacy = page.getByRole('menuitem', { name: '数据与隐私', exact: true });
    await expect(privacy).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(privacy).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused(); await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click(); await privacy.click();
    await expect(page.getByRole('dialog', { name: '数据与隐私', exact: true })).toBeVisible();
    expect(await page.locator('main').evaluate(el => el.inert)).toBe(true);
    await page.keyboard.press('Escape'); await expect(more).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBe('{private archive');
    expect(await page.evaluate(() => window.locationRequests)).toBe(0);
  }
});

test('opening footprints from an open More menu returns focus to footprints', async ({ page }) => {
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const footprints = page.getByRole('button', { name: /足迹/ });
  await footprints.click();
  await expect(page.locator('#drawerPlaces')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(footprints).toBeFocused();
  await expect(page.getByRole('button', { name: '更多', exact: true })).toHaveAttribute('aria-expanded', 'false');
});

for (const [width, height] of [[375, 812], [390, 844]]) {
test(`footprint rows select their map pin above details and restore list context at ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  const places = [visit, ...Array.from({ length: 14 }, (_, i) => ({ ...visit, poiId: 'return-' + i,
    name: '连续到访' + i, lat:visit.lat + (i + 1) * 0.004, lng:visit.lng + (i + 1) * 0.004,
    photo: i === 13 ? 'assets/visits/bfc-20260919.jpg' : visit.photo }))];
  await serveVisits(page, places);
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.__openMarkerById)).toBe('function');
  await page.evaluate(() => window.__openMarkerById('public:visit-1'));
  await page.getByRole('button', { name: /足迹/ }).click();
  const list = page.locator('#drawerPlaces');
  for (const exit of ['close', 'escape']) {
    await expect(list).toHaveClass(/open/);
    // 抽屉入场动画会把行推到屏幕外；等它落位再量行位置，否则点击时的自动滚动会污染对照值。
    await expect.poll(() => list.evaluate(el => Math.round(el.getBoundingClientRect().bottom))).toBe(height);
    const row = list.getByRole('button', { name: exit === 'escape' ? '连续到访12' : '连续到访13', exact: true });
    await row.scrollIntoViewIfNeeded();
    const scroll = await list.evaluate(el => el.scrollTop);
    await row.click();
    const detail = page.getByRole('dialog', { name: exit === 'escape' ? '连续到访12' : '连续到访13', exact: true });
    await expect(detail).toHaveClass(/open/);
    await expect(detail.locator('.visit-photo')).toHaveAttribute('src', exit === 'escape' ? visit.photo : places[14].photo);
    await expect(selectedFrame(page)).toBeHidden();
    const selectedId = exit === 'escape' ? 'public:return-12' : 'public:return-13';
    const pin = page.locator('[data-map-pin="' + selectedId + '"]');
    await expect(pin).toHaveCSS('width', '60px');
    for (const other of await page.locator('[data-map-pin]:not([data-map-pin="' + selectedId + '"])').all()) {
      await expect(other).toHaveCSS('width', '44px');
    }
    await expect.poll(() => detail.locator('.visit-photo').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await detail.locator('.visit-photo').evaluate(img => img.decode());
    await detail.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    const pinBox = await pin.boundingBox(), detailBox = await detail.boundingBox();
    const categories = await page.locator('#mapCatStrip').boundingBox();
    expect(pinBox.y).toBeGreaterThanOrEqual(categories.y + categories.height + 4);
    expect(pinBox.y + pinBox.height).toBeLessThanOrEqual(detailBox.y - 4);
    expect(pinBox.x + pinBox.width / 2).toBeCloseTo(width / 2, 1);
    if (exit === 'close') await detail.getByRole('button', { name: '关闭地点详情', exact: true }).click();
    if (exit === 'escape') await page.keyboard.press('Escape');
    await expect(list).toHaveClass(/open/);
    await expect(row).toBeFocused();
    expect(await list.evaluate(el => el.scrollTop)).toBe(scroll);
  }
});

}

test('one map click from footprint details returns to the same selected pin and film frame', async ({ page }) => {
  await page.getByRole('button', { name:/足迹/ }).click();
  await page.locator('#placeList').getByRole('button', { name:visit.name, exact:true }).click();
  await expect(page.locator('#drawerDetail')).toHaveClass(/open/);
  await page.locator('#mask').click({ position:{ x:8, y:8 } });
  await expect(selectedFrame(page)).toBeVisible();
  await expect(selectedFrame(page)).toContainText(visit.name);
  await expect(page.locator('#drawerDetail')).not.toHaveClass(/open/);
  await expect(page.locator('#drawerPlaces')).not.toHaveClass(/open/);
  await expect(page.locator('[data-map-pin="public:visit-1"]')).toHaveCSS('width', '60px');
  await expect(selectedFrame(page)).toBeFocused();
  await expect(page.locator('main')).not.toHaveAttribute('inert');
});

test('map pins, footprint rows and map return share a gentle camera transition with reduced-motion support', async ({ page }) => {
  for (const [reducedMotion, duration] of [['no-preference', 600], ['reduce', 0]]) {
    await page.emulateMedia({ reducedMotion });
    await page.evaluate(() => { window.__mapEaseToCalls = []; });
    await page.locator('[data-map-pin="public:visit-1"]').click();
    await expect.poll(() => page.evaluate(() => window.__mapEaseToCalls.at(-1)?.duration)).toBe(duration);
    await page.getByRole('button', { name:/足迹/ }).click();
    await page.evaluate(() => { window.__mapEaseToCalls = []; });
    await page.locator('#placeList').getByRole('button', { name:visit.name, exact:true }).click();
    await expect.poll(() => page.evaluate(() => window.__mapEaseToCalls.at(-1)?.duration)).toBe(duration);
    await page.evaluate(() => { window.__mapEaseToCalls = []; });
    await page.locator('#mask').click({ position:{ x:8, y:8 } });
    await expect(selectedFrame(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__mapEaseToCalls.at(-1)?.duration)).toBe(duration);
  }
});

test('footprint details reveal the map without the outgoing list during the drawer transition', async ({ page }) => {
  await page.getByRole('button', { name:/足迹/ }).click();
  const list = page.locator('#drawerPlaces');
  const detail = page.locator('#drawerDetail');
  const row = list.getByRole('button', { name:visit.name, exact:true });
  for (const exit of ['close', 'escape']) {
    await list.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
    await row.click();
    const progress = await page.evaluate(async () => {
      const list = document.querySelector('#drawerPlaces');
      const detail = document.querySelector('#drawerDetail');
      const entering = detail.getAnimations()[0];
      for (const animation of [...list.getAnimations(), ...detail.getAnimations()]) {
        animation.pause();
        animation.currentTime = animation.effect.getTiming().duration / 4;
      }
      await new Promise(requestAnimationFrame);
      return entering?.effect.getComputedTiming().progress;
    });
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(1);
    await expect(detail).toBeVisible();
    await expect(list).toBeHidden();
    if (exit === 'close') await detail.getByRole('button', { name:'关闭地点详情', exact:true }).click();
    else await page.keyboard.press('Escape');
    await expect(list).toBeVisible();
    await expect(row).toBeFocused();
  }
});

test('a cold footprint photo refits the selected pin above the final detail layout', async ({ page }) => {
  const coldVisit = { ...visit, poiId:'cold-photo', name:'慢速照片地点', lat:31.28, lng:121.52, photo:'assets/visits/bfc-20260919.jpg' };
  let releasePhoto;
  const heldPhoto = new Promise(resolve => { releasePhoto = resolve; });
  await page.route('**/assets/visits/bfc-20260919.jpg', async route => {
    await heldPhoto;
    await route.fulfill({ path:join(__dirname, '../assets/visits/bfc-20260919.jpg') });
  });
  await serveVisits(page, [visit, coldVisit]);
  await page.reload();
  await page.getByRole('button', { name:/足迹/ }).click();
  await page.locator('#placeList').getByRole('button', { name:coldVisit.name, exact:true }).click();
  const detail = page.getByRole('dialog', { name:coldVisit.name, exact:true });
  const photo = detail.locator('.visit-photo');
  const pin = page.locator('[data-map-pin="public:cold-photo"]');
  await expect(detail).toHaveClass(/open/);
  await expect(photo).toHaveJSProperty('complete', false);
  await expect(pin).toHaveCSS('width', '60px');
  releasePhoto();
  await expect.poll(() => photo.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await photo.evaluate(img => img.decode());
  await detail.evaluate(el => Promise.all(el.getAnimations({ subtree:true }).map(animation => animation.finished)));
  const pinBox = await pin.boundingBox(), detailBox = await detail.boundingBox();
  const categories = await page.locator('#mapCatStrip').boundingBox();
  expect(pinBox.y).toBeGreaterThanOrEqual(categories.y + categories.height + 4);
  expect(pinBox.y + pinBox.height).toBeLessThanOrEqual(detailBox.y - 4);
});

for (const destination of ['list', 'another detail']) {
  test(`a late footprint photo cannot move the map after returning to ${destination}`, async ({ page }) => {
    const coldVisit = { ...visit, poiId:'late-photo', name:'尚未加载照片的地点', lat:31.28, lng:121.52, photo:'assets/visits/bfc-20260919.jpg' };
    let releasePhoto;
    const heldPhoto = new Promise(resolve => { releasePhoto = resolve; });
    await page.route('**/assets/visits/bfc-20260919.jpg', async route => {
      await heldPhoto;
      await route.fulfill({ path:join(__dirname, '../assets/visits/bfc-20260919.jpg') });
    });
    await serveVisits(page, [visit, coldVisit]);
    await page.reload();
    await page.getByRole('button', { name:/足迹/ }).click();
    await page.locator('#placeList').getByRole('button', { name:coldVisit.name, exact:true }).click();
    const oldPhoto = await page.locator('#drawerDetail .visit-photo').elementHandle();
    await expect(page.locator('#drawerDetail .visit-photo')).toHaveJSProperty('complete', false);
    await page.keyboard.press('Escape');
    if (destination === 'another detail') {
      await page.locator('#placeList').getByRole('button', { name:visit.name, exact:true }).click();
      await expect.poll(() => page.locator('#drawerDetail .visit-photo').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    const selectedId = destination === 'list' ? 'public:late-photo' : 'public:visit-1';
    const pin = page.locator('[data-map-pin="' + selectedId + '"]');
    const before = await pin.boundingBox();
    releasePhoto();
    await expect.poll(() => oldPhoto.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await oldPhoto.evaluate(img => img.decode());
    await expect(pin).toHaveCSS('width', '60px');
    const after = await pin.boundingBox();
    expect(after.x).toBeCloseTo(before.x, 1); expect(after.y).toBeCloseTo(before.y, 1);
    if (destination === 'list') await expect(page.locator('#drawerPlaces')).toBeVisible();
    else await expect(page.getByRole('dialog', { name:visit.name, exact:true })).toBeVisible();
    await expect(selectedFrame(page)).toBeHidden();
  });
}

for (const [width, height] of [[320, 860], [375, 860], [414, 860], [768, 860], [1249, 860], [768, 375], [375, 430], [320, 375], [320, 568], [375, 667]]) {
  test(`native map tools fit and remain clear of the filmstrip at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const targets = page.locator('[data-sdk-controls] .compass-circle:visible, [data-sdk-controls] .rotate-panel > div:visible, [data-sdk-controls] .tmap-zoom-in:visible, [data-sdk-controls] .tmap-zoom-out:visible, #btnLocate');
    const metrics = await page.evaluate(() => {
      const rect = el => el.getBoundingClientRect().toJSON();
      const strip = rect(document.querySelector('#mapCatStrip'));
      return { header:rect(document.querySelector('#visitHeader')),
        categories:[...document.querySelectorAll('#mapCatStrip button')].map(el => {
          const box = rect(el), x = Math.max(box.x, strip.x);
          return { ...box, x, width:Math.max(0, Math.min(box.right, strip.right) - x) };
        }),
        groups:['.map-orientation-control', '.map-zoom-control', '#btnLocate'].map(selector => rect(document.querySelector(selector))).filter(box => box.width) };
    });
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    await expect(targets).toHaveCount(width < 768 ? 1 : 8);
    for (const target of await targets.all()) {
      const box = await target.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(metrics.header.y + metrics.header.height + 4);
      expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height - 24);
      for (const chip of metrics.categories.filter(box => box.width)) expect(overlaps(box, chip)).toBe(false);
      await target.click({ trial: true });
    }
    const centers = metrics.groups.map(box => box.x + box.width / 2);
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
    for (let i = 1; i < metrics.groups.length; i++) {
      const gap = metrics.groups[i].y - metrics.groups[i - 1].y - metrics.groups[i - 1].height;
      expect(gap).toBeGreaterThanOrEqual(4); expect(gap).toBeLessThanOrEqual(16);
    }
    if (width >= 768) {
    const originalZoom = await page.evaluate(() => window.__testMap.getZoom());
    await page.locator('.tmap-zoom-in').click();
    expect(await page.evaluate(() => window.__testMap.getZoom())).toBe(originalZoom + 1);
    await page.locator('.tmap-zoom-out').click();
    expect(await page.evaluate(() => window.__testMap.getZoom())).toBe(originalZoom);
    }
    await page.locator('[data-map-pin="public:visit-1"]').click();
    const strip = page.locator('#filmstrip');
    const frame = selectedFrame(page);
    if (await strip.isVisible()) {
      await expect(frame).toBeVisible();
      const stripBox = await strip.boundingBox();
      for (const target of await targets.all()) expect(overlaps(await target.boundingBox(), stripBox)).toBe(false);
      const frameBox = await frame.boundingBox();
      expect(frameBox.height).toBeGreaterThanOrEqual(44);
      await frame.click({ trial: true });
    } else {
      // 极短视口下胶卷整体收起（仍在 DOM 里，只是不显示），选中状态只体现在图钉上。
      await expect(strip).toBeHidden();
      await expect(frame).toBeHidden();
      await expect(page.getByRole('button', { name:'看照片', exact:true })).toBeHidden();
    }
  });
}
test('only complete public visits appear in map and filtered list; personal data remains byte-for-byte intact', async ({ page }) => {
  const raw = JSON.stringify({ version: 1, places: [{ ...visit, poiId: 'personal-only', name: '私人地点', visits: [{ note: '保留原始照片和评分' }] }] });
  await page.addInitScript(raw => localStorage.setItem('baby_playmap_v1', raw), raw);
  await serveVisits(page, [visit, { ...visit, poiId: 'no-photo', photo: undefined }, { ...visit, poiId: 'no-score', name: '未评分公园', score: undefined }, { ...visit, poiId: 'no-date', visitedOn: undefined }]);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /足迹/ })).toBeVisible();
  await page.getByRole('button', { name: /足迹/ }).click();
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
    await page.getByRole('button', { name: /足迹/ }).click();
    const list = page.locator('#placeList');
    await expect(list.locator('h3')).toHaveText(['南宁市1处', '泉州市1处', '上海市2处', '城市待补充1处']);
    await expect(list.getByRole('region', { name: '上海市', exact: true }).locator('button strong')).toHaveText(['上海公园', '上海商场']);
    expect(await list.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await list.getByRole('button', { name: '泉州公园', exact: true }).click();
    await expect(page.locator('#drawerDetail')).toContainText('泉州公园');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('#mapCatStrip [data-cat="mall"]').click();
    await page.getByRole('button', { name: /足迹/ }).click();
    await expect(list.locator('h3')).toHaveText(['上海市1处']);
    await expect(list.locator('button strong')).toHaveText(['上海商场']);
    await page.keyboard.press('Escape');
    await page.route('**/map.qq.com/api/gljs**', route => route.abort());
    await page.reload();
    await expect(page.locator('#mapFallback')).toBeVisible();
    await expect(page.locator('#fallbackList h3')).toHaveText(['南宁市1处', '泉州市1处', '上海市2处', '城市待补充1处']);
    await page.locator('#fallbackList').getByRole('button', { name: '泉州公园 · 11 去过', exact: true }).click();
    await expect(page.locator('#drawerDetail')).toContainText('泉州公园');
  });
}

for (const width of [320, 375, 414, 768]) {
  test(`drawers expose close controls and isolate background at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await serveVisits(page, [visit, ...Array.from({ length: 11 }, (_, i) => ({ ...visit, poiId: 'list-' + i, name: i === 10 ? '末项公园' : '到访公园' + i }))]);
    await page.reload();
    const opener = page.getByRole('button', { name: /足迹/ });
    await opener.click();
    const list = page.locator('#drawerPlaces');
    const closeList = list.getByRole('button', { name: '关闭地点列表', exact: true });
    await expect(closeList).toBeFocused();
    for (const id of ['btnMore', 'btnLocate']) {
      expect(await page.locator('#' + id).evaluate(el => {
        el.focus();
        return document.activeElement !== el && getComputedStyle(el).visibility === 'hidden';
      })).toBe(true);
    }
    await list.getByRole('button', { name: '末项公园', exact: true }).click();
    const detail = page.getByRole('dialog', { name: '末项公园', exact: true });
    await expect(detail.locator('.grabber')).toHaveCount(1);
    await expect(detail.locator('.grabber')).toHaveAttribute('aria-hidden', 'true');
    const close = detail.getByRole('button', { name: '关闭地点详情', exact: true });
    await expect(close).toBeFocused();
    const nav = detail.getByRole('button', { name: '导航去这里', exact: true });
    await nav.scrollIntoViewIfNeeded();
    await page.evaluate(() => { window.open = () => null; });
    await nav.click();
    await expect(detail.getByRole('status')).toContainText('导航没有打开');
    await close.click();
    await expect(list.getByRole('button', { name: '末项公园', exact: true })).toBeFocused();
    await closeList.click();
    await expect(opener).toBeFocused();
    await expect(page.getByRole('button', { name: '更多', exact: true })).toBeVisible();
    await opener.click(); await closeList.click(); await expect(opener).toBeFocused();
    await opener.click(); await page.locator('#mask').click({ position: { x: 8, y: 8 } });
    await expect(opener).toBeFocused();
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '数据与隐私', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '数据与隐私', exact: true })).toBeVisible();
  });
}

for (const width of [320, 375, 414, 768]) {
  test(`primary controls have clear 44px targets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    for (const button of await page.locator('#btnPlaceList, #mapCatStrip button, #btnMore, #btnLocate').all()) {
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
      expect(Math.round(box.width)).toBeGreaterThanOrEqual(44); expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const width of [320, 375, 414, 768]) {
  test(`categories and counts describe only complete visits and retain keyboard selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await serveVisits(page, [
      { ...visit, address: '上海市黄浦区' },
      { ...repeatPlace, poiId: 'park-with-rides', name: '主题乐园', category: 'playground' },
      { ...visit, poiId: 'mall', name: '商场到访', category: 'mall', address: '上海市黄浦区' },
      { ...visit, poiId: 'water', name: '独立沙滩', category: 'water', address: '上海市浦东新区' },
      { ...visit, poiId: 'hotel', name: '上海民宿', category: 'hotel', address: '上海市浦东新区' },
      { ...repeatPlace, poiId: 'scenic-repeat', name: '上海古镇', category: 'scenic' },
      { ...visit, poiId: 'scenic-single', name: '上海园林', category: 'scenic', address: '上海市黄浦区',
        visitedOn: '2026-05-01', lng: 121.49 },
      { ...visit, poiId: 'other', name: '泉州咖啡馆', category: 'other', address: '福建省泉州市' },
      { ...visit, poiId: 'scenic-pending', category: 'scenic', photo: undefined, address: '福建省泉州市' }
    ]);
    await page.reload();
    const strip = page.locator('#mapCatStrip');
    const city = page.getByLabel('选择城市');
    const shanghaiCategories = ['✨ 全部', '🌳 公园', '🎠 乐园', '🛍️ 商场', '🏖️ 沙滩', '🏨 酒店', '⛰️ 景区景点'];
    await expect(strip.getByRole('button')).toHaveText([...shanghaiCategories, '📍 其他']);
    await city.selectOption('上海市');
    await expect(strip.getByRole('button')).toHaveText(shanghaiCategories);
    await expect(page.locator('#btnPlaceList')).toHaveText('足迹 7');
    await expect(filmFrames(page)).toHaveCount(7);
    const scenic = strip.getByRole('button', { name: '⛰️ 景区景点', exact: true });
    await scenic.focus(); await page.keyboard.press('Enter');
    await expect(scenic).toBeFocused(); await expect(scenic).toHaveAttribute('aria-pressed', 'true');
    await expect(strip.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(strip.getByRole('button')).toHaveText(shanghaiCategories);
    expect(await strip.getByRole('button').evaluateAll(buttons =>
      buttons.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#btnPlaceList')).toHaveText('足迹 2');
    await expect(page.locator('.film-name')).toHaveText(['上海古镇', '上海园林']);
    await expect(page.locator('[data-map-pin]')).toHaveCount(2);
    await expect(page.locator('[data-map-pin="public:scenic-repeat"]')).toBeVisible();
    await expect(page.locator('[data-map-pin="public:scenic-single"]')).toBeVisible();
    expect(await page.locator('#visitHeader').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.locator('#btnPlaceList').click();
    await expect(page.locator('#placeList h3')).toHaveText(['上海市2处']);
    await expect(page.locator('#placeList button strong')).toHaveText(['上海古镇', '上海园林']);
    await page.keyboard.press('Escape');
    await filmFrames(page).first().click();
    const repeatDetail = page.getByRole('dialog', { name: '上海古镇', exact: true });
    await expect(repeatDetail.locator('.d-cat-tag')).toHaveText('⛰️景区景点');
    await repeatDetail.getByRole('button', { name: '较早一次' }).click();
    await expect(repeatDetail).toContainText('2025.05.01');
    await expect(repeatDetail.locator('.d-cat-tag')).toHaveText('⛰️景区景点');
    await repeatDetail.getByRole('button', { name: '下一个地点 →' }).click();
    const nextDetail = page.getByRole('dialog', { name: '上海园林', exact: true });
    await expect(nextDetail.locator('.d-cat-tag')).toHaveText('⛰️景区景点');
    await nextDetail.getByRole('button', { name: '← 上一个' }).click();
    await expect(repeatDetail).toBeVisible();
    await page.keyboard.press('Escape');
    await city.selectOption('泉州市');
    await expect(strip.getByRole('button')).toHaveText(['✨ 全部', '📍 其他']);
    await expect(strip.getByRole('button', { name: '✨ 全部' })).toHaveAttribute('aria-pressed', 'true');
    await page.route('**/map.qq.com/api/gljs**', route => route.abort()); await page.reload();
    await city.selectOption('上海市');
    const fallback = page.locator('#fallbackList');
    await scenic.click();
    await expect(fallback.locator('button strong')).toHaveText(['上海古镇', '上海园林']);
    await fallback.getByRole('button', { name: '上海古镇 · 11 去过', exact: true }).click();
    await expect(repeatDetail.locator('.d-cat-tag')).toHaveText('⛰️景区景点');
    await page.keyboard.press('Escape');
    for (const [chip, place, tag] of [
      ['🛍️ 商场', '商场到访', '🛍️商场'],
      ['🏖️ 沙滩', '独立沙滩', '🏖️沙滩'],
      ['🏨 酒店', '上海民宿', '🏨酒店']
    ]) {
      await strip.getByRole('button', { name: chip, exact: true }).click();
      await expect(page.locator('#btnPlaceList')).toHaveText('足迹 1');
      await expect(page.locator('.film-name')).toHaveText([place]);
      await fallback.getByRole('button', { name: `${place} · 11 去过`, exact: true }).click();
      await expect(page.getByRole('dialog', { name: place, exact: true }).locator('.d-cat-tag')).toHaveText(tag);
      await page.keyboard.press('Escape');
    }
    await city.selectOption('泉州市');
    await expect(strip.getByRole('button')).toHaveText(['✨ 全部', '📍 其他']);
    await expect(strip.getByRole('button', { name: '✨ 全部' })).toHaveAttribute('aria-pressed', 'true');
    await expect(fallback.locator('button strong')).toHaveText(['泉州咖啡馆']);
  });
}

test('filmstrip lists filtered visits newest first and fits the map to every match', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveVisits(page, [
    { ...visit, poiId: 'old', name: '旧公园', visitedOn: '2025-03-02', address: '上海市黄浦区' },
    { ...visit, poiId: 'new', name: '新公园', visitedOn: '2026-09-12', address: '上海市黄浦区' },
    { ...visit, poiId: 'mall', name: '泉州商场', visitedOn: '2026-01-05', category: 'mall', address: '福建省泉州市' }
  ]);
  await page.reload();
  await expect(filmFrames(page)).toHaveCount(3);
  await expect(page.locator('.film-name')).toHaveText(['新公园', '泉州商场', '旧公园']);
  await expect(page.locator('#btnPlaceList')).toHaveText('足迹 3');
  await expect(page.locator('#btnPlaceList')).toHaveAttribute('aria-label', /当前 3 个地点/);

  await page.getByLabel('选择城市').selectOption('上海市');
  await expect(filmFrames(page)).toHaveCount(2);
  await expect(page.locator('.film-name')).toHaveText(['新公园', '旧公园']);
  await expect(page.locator('#btnPlaceList')).toHaveText('足迹 2');
  const fit = await page.evaluate(() => window.__mapFitBoundsCalls.at(-1));
  expect(fit.bounds).toHaveLength(2);
  expect(fit.options.padding.top).toBeGreaterThan(120);
  expect(fit.options.padding.bottom).toBeGreaterThan(120);

  await page.getByLabel('选择城市').selectOption('泉州市');
  await expect(filmFrames(page)).toHaveCount(1);
  await expect(page.locator('#btnPlaceList')).toHaveText('足迹 1');
  await expect(page.locator('#mapCatStrip').getByRole('button')).toHaveText(['✨ 全部', '🛍️ 商场']);
});

const olderVisit = { visitedOn: '2025-05-01', photo: 'assets/visits/disney-20260912.jpg' };
const newerVisit = {
  visitedOn: '2026-09-12', photo: 'assets/visits/legoland-20260927.jpg', reflection: '又来玩了一次'
};
const repeatPlace = { ...visit, address: '上海市黄浦区', visits: [olderVisit, newerVisit] };

test('a repeat place opens its latest complete visit and can browse earlier visits', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1120, height: 900 });
  await serveVisits(page, [
    { ...repeatPlace, visits: [
      olderVisit, { visitedOn: '2026-10-01' }, newerVisit, { photo: newerVisit.photo },
      { ...olderVisit, reflection: '重复日期' }
    ] },
    { ...visit, poiId: 'split', name: '资料待补', category: 'mall',
      visits: [{ visitedOn: newerVisit.visitedOn }, { photo: newerVisit.photo }] },
    { ...visit, poiId: 'empty', name: '没有公开到访', visits: [] },
    { ...visit, poiId: 'middle', name: '另一座公园', visitedOn: '2026-05-21', address: '上海市黄浦区' }
  ]);
  await page.addInitScript(() => { window.open = url => { window.testNavigation = url; return {}; }; });
  await page.reload();

  await expect(page.locator('[data-map-pin]')).toHaveCount(2);
  await expect(filmFrames(page)).toHaveCount(2);
  await expect(page.locator('.film-name')).toHaveText([visit.name, '另一座公园']);
  await expect(filmFrames(page).first().locator('img')).toHaveAttribute('src', newerVisit.photo);
  await expect(page.locator('#mapCatStrip').getByRole('button')).toHaveText(['✨ 全部', '🌳 公园']);
  await page.locator('#mapCatStrip').getByRole('button', { name: /公园/ }).click();

  await page.getByRole('button', { name: /足迹/ }).click();
  await expect(page.locator('#placeList h3')).toHaveText(['上海市2处']);
  await expect(page.locator('#placeList time')).toHaveText(['2026.09.12', '2026.05.21']);
  const row = page.locator('#placeList').getByRole('button', { name: visit.name, exact: true });
  await row.click();
  const detail = page.getByRole('dialog', { name: visit.name });
  const controls = detail.getByRole('group', { name: '切换到访' });
  const earlier = controls.getByRole('button', { name: '较早一次' });
  const later = controls.getByRole('button', { name: '较新一次' });
  const photo = detail.getByRole('img', { name: '11 在' + visit.name + '的到访打卡照' });
  await expect(controls).toHaveText(/1 \/ 2/);
  await expect(detail.getByText('公园', { exact: true })).toBeVisible();
  await expect(photo).toHaveAttribute('src', newerVisit.photo);
  await photo.hover();
  await page.mouse.wheel(760, 0);
  await expect(controls).toHaveText(/2 \/ 2/);
  await photo.hover();
  await page.mouse.wheel(-760, 0);
  await expect(controls).toHaveText(/1 \/ 2/);
  await expect(detail.getByText('又来玩了一次')).toBeVisible();
  await expect(detail.locator('.visit-date')).toHaveText('2026.09.12 · 2岁3个月打卡');

  await earlier.click();
  await expect(controls).toHaveText(/2 \/ 2/);
  await expect(detail.getByText('公园', { exact: true })).toBeVisible();
  await expect(photo).toHaveAttribute('src', olderVisit.photo);
  await expect(detail.getByRole('region', { name: '11 的到访记录' }).getByText('11’s 玩后感')).toBeHidden();
  await expect(detail.locator('.visit-date')).toHaveText('2025.05.01 · 0岁10个月打卡');
  await expect(earlier).toBeFocused();
  await expect(earlier).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(controls).toHaveText(/1 \/ 2/);
  await expect(later).toHaveAttribute('aria-disabled', 'true');

  await detail.getByRole('button', { name: /导航去这里/ }).click();
  await expect.poll(() => page.evaluate(() => window.testNavigation)).toContain('coord:31.23,121.47');
  await page.keyboard.press('Escape');
  await expect(row).toBeFocused();
  await page.keyboard.press('Escape');
  await selectedFrame(page).click();
  await expect(controls).toHaveText(/1 \/ 2/);
  await page.keyboard.press('Escape');
  await expect(selectedFrame(page)).toBeFocused();
});

test.describe('touch visit history', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('swipes between complete visits even when the map is unavailable', async ({ page, context }) => {
    await page.route('**/map.qq.com/api/gljs**', route => route.abort());
    await serveVisits(page, [repeatPlace]);
    await page.addInitScript(() => { window.open = () => { window.navigationTaps = (window.navigationTaps || 0) + 1; return {}; }; });
    await page.reload();
    const fallback = page.locator('#fallbackList').getByRole('button', { name: visit.name + ' · 11 去过' });
    await fallback.tap();
    const detail = page.getByRole('dialog', { name: visit.name });
    const controls = detail.getByRole('group', { name: '切换到访' });
    const image = detail.getByRole('img', { name: '11 在' + visit.name + '的到访打卡照' });
    await expect(image).toHaveAttribute('src', newerVisit.photo);
    const client = await context.newCDPSession(page);
    async function swipe(direction) {
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeInViewport({ ratio: 0.98 });
      const box = await image.boundingBox();
      const start = box.x + box.width * (direction < 0 ? 0.9 : 0.1);
      const y = Math.round(box.y + box.height / 2);
      const touch = (type, x) => client.send('Input.dispatchTouchEvent', {
        type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y }]
      });
      await touch('touchStart', start);
      for (let step = 1; step <= 8; step++) {
        await touch('touchMove', start + direction * box.width * step / 10);
      }
      await touch('touchEnd');
    }
    const nav = detail.getByRole('button', { name: /导航去这里/ });
    await expect(detail.getByText('又来玩了一次')).toBeInViewport({ ratio: 0.98 });
    await nav.tap();
    await swipe(-1);
    await expect(controls).toHaveText(/2 \/ 2/);
    await expect(image).toHaveAttribute('src', olderVisit.photo);
    await expect(detail.getByRole('region', { name: '11 的到访记录' }).getByText('11’s 玩后感')).toBeHidden();
    await nav.tap();
    await swipe(1);
    await expect(controls).toHaveText(/1 \/ 2/);
    await expect(image).toHaveAttribute('src', newerVisit.photo);
    await expect(detail.getByText('又来玩了一次')).toBeInViewport({ ratio: 0.98 });
    await nav.tap();
    expect(await page.evaluate(() => window.navigationTaps)).toBe(3);

    await serveVisits(page, [{ ...repeatPlace, visits: [olderVisit, { visitedOn: newerVisit.visitedOn }] }]);
    await page.reload();
    await fallback.tap();
    await expect(image).toHaveAttribute('src', olderVisit.photo);
    await expect(controls).toHaveCount(0);

    await serveVisits(page, [{ ...repeatPlace, visits: [{ visitedOn: newerVisit.visitedOn }] }]);
    await page.reload();
    await expect(fallback).toHaveCount(0);
    await expect(page.locator('#fallbackList')).toContainText('暂无完整的到访记录');
  });
});

test('filmstrip keeps one tab stop, moves with arrow keys and opens the visit photo', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveVisits(page, [
    { ...visit, poiId: 'a', name: '第一公园', visitedOn: '2026-09-12', address: '上海市黄浦区' },
    { ...visit, poiId: 'b', name: '第二公园', visitedOn: '2026-05-01', address: '上海市黄浦区' },
    { ...visit, poiId: 'c', name: '第三公园', visitedOn: '2025-11-20', address: '上海市黄浦区' }
  ]);
  await page.reload();
  await expect(filmFrames(page)).toHaveCount(3);
  await expect(page.locator('#filmstrip .film-frame[tabindex="0"]')).toHaveCount(1);

  await filmFrames(page).first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(filmFrames(page).nth(1)).toBeFocused();
  await expect(selectedFrame(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(selectedFrame(page)).toHaveText(/第二公园/);
  await expect(selectedFrame(page)).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#drawerDetail')).toHaveClass(/open/);
  await page.keyboard.press('Escape');

  await page.keyboard.press('End');
  await expect(filmFrames(page).last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(filmFrames(page).first()).toBeFocused();

  await filmFrames(page).nth(1).click();
  await expect(page.locator('#drawerDetail')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(selectedFrame(page)).toBeFocused();
  await expect(page.locator('#filmstrip .film-frame[tabindex="0"]')).toHaveCount(1);
});

for (const [label, prepare] of [
  ['no complete visits', async page => { await serveVisits(page, []); await page.reload(); }],
  ['unreadable public data', async page => {
    await page.route('**/public-places.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
    await page.reload();
  }]
]) {
  test(`filmstrip stays collapsed with ${label} and the footprint entry carries the state`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await prepare(page);
    await expect(page.locator('#filmstrip')).toBeHidden();
    await expect(filmFrames(page)).toHaveCount(0);
    if (label === 'no complete visits') await expect(page.locator('#btnPlaceList')).toHaveText('足迹');
    else await expect(page.locator('#btnPlaceList')).toHaveAttribute('aria-label', /暂不可用/);
  });
}

test('an empty library offers all-category recovery and read failure stays distinct', async ({ page }) => {
  await serveVisits(page, []); await page.reload();
  await expect(page.locator('#mapCatStrip').getByRole('button')).toHaveText(['✨ 全部']);
  await expect(page.getByText('暂无完整的到访记录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看全部', exact: true }).click();
  await expect(page.locator('#mapCatStrip').getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mapCatStrip').getByRole('button')).toBeFocused();
  await page.getByRole('button', { name: /足迹/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '查看全部', exact: true }).click();
  await expect(page.locator('#mapCatStrip').getByRole('button')).toBeFocused();
  await page.route('**/map.qq.com/api/gljs**', route => route.abort()); await page.reload();
  await expect(page.locator('#fallbackList')).toContainText('暂无完整的到访记录');
  await page.locator('#fallbackList').getByRole('button', { name: '查看全部', exact: true }).click();
  await page.route('**/public-places.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
  await page.reload();
  await expect(page.locator('#fallbackList')).toContainText('公开到访记录暂时无法读取，请刷新重试');
  await expect(page.locator('#btnPlaceList')).toHaveText('足迹');
  await expect(filmFrames(page)).toHaveCount(0);
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
  const nav = detail.getByRole('button', { name: '导航去这里', exact: true });
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

test('detail print hugs the photo, keeps the date imprint decorative and the next-place action in view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveVisits(page, [visit, { ...visit, poiId: 'second', name: '第二公园', visitedOn: '2026-05-01' }]);
  await page.reload();
  await filmFrames(page).first().click();
  const detail = page.locator('#drawerDetail');
  const photo = detail.locator('.visit-photo');
  await expect.poll(() => photo.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect(detail.locator('.photo-imprint')).toHaveText("'26 09 12");
  await expect(detail.locator('.photo-imprint')).toHaveAttribute('aria-hidden', 'true');
  await expect(detail.locator('time')).toHaveCount(1);
  const metrics = await detail.evaluate(el => {
    const wrap = el.querySelector('.visit-photo-wrap').getBoundingClientRect();
    const image = el.querySelector('.visit-photo').getBoundingClientRect();
    const imprint = el.querySelector('.photo-imprint').getBoundingClientRect();
    return { border: wrap.width - image.width, inside: imprint.right <= image.right && imprint.bottom <= image.bottom &&
      imprint.left >= image.left, scroll: el.scrollHeight, client: el.clientHeight };
  });
  expect(metrics.border).toBeCloseTo(16, 0);
  expect(metrics.inside).toBe(true);
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.client);
  await expect(page.locator('#btnNextPlacePrimary')).toBeInViewport({ ratio: 1 });
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
  await page.getByRole('button', { name: /足迹/ }).click();
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
  await page.getByRole('button', { name: /足迹/ }).click();
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
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name: '数据与隐私', exact: true }).click();
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
  await expect(page.getByRole('button', {name:'播放', exact:true})).toHaveCount(0);
  await page.locator('#fallbackList').getByRole('button', { name: visit.name + ' · 11 去过', exact: true }).click();
  await expect(page.locator('#drawerDetail')).toContainText('2岁3个月');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name:/足迹/ }).click();
  const row = page.locator('#placeList').getByRole('button', { name:visit.name, exact:true });
  await row.click();
  await page.locator('#mask').click({ position:{ x:8, y:8 } });
  await expect(page.locator('#drawerPlaces')).toHaveClass(/open/);
  await expect(row).toBeFocused();
  await expect(selectedFrame(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await page.route('**/map.qq.com/api/gljs**', route => route.fulfill({ contentType: 'application/javascript', body: tmapStub }));
  await page.getByRole('button', { name: '重试地图', exact: true }).click();
  await expect(page.locator('#mapFallback')).toBeHidden();
  await expect(page.getByRole('button', {name:'播放', exact:true})).toBeVisible();
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
  await page.getByRole('button', { name: '导航去这里', exact: true }).click();
  await expect(page.locator('#navigationFallback')).toContainText('导航没有打开');
  await expect(page.getByRole('link', { name: '打开腾讯地图', exact: true })).toHaveAttribute('href', /coord:31.23,121.47/);
  await expect(page.getByRole('button', { name: /复制目的地/ })).toHaveCount(0);
  await expect(page.locator('.visit-photo')).toBeVisible();
});

test('detail focus is trapped and Escape returns to the same film frame', async ({ page }) => {
  await page.locator('[data-map-pin="public:visit-1"]').click();
  await selectedFrame(page).click();
  const nav = page.getByRole('button', { name: '导航去这里', exact: true });
  const close = page.getByRole('button', { name: '关闭地点详情', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(nav).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  await page.keyboard.press('Tab'); await expect(nav).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawerDetail')).not.toHaveClass(/open/);
  await expect(selectedFrame(page)).toBeFocused();
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

async function openLocalCategoryPicker(page) {
  await page.goto('/?maintain=1');
  await expect(page.locator('#searchBox')).toBeVisible();
  await page.locator('#searchInput').fill('搜索公园');
  await page.locator('.sr-item[data-idx]').filter({ hasText: '搜索公园' }).click();
  await page.getByRole('button', { name: '选择类别并填写到访记录', exact: true }).click();
}

test('local POI maintenance exports scenic only after explicit selection and retains it on repeat handoff', async ({ page }) => {
  const picker = page.getByRole('dialog', { name: '添加地点', exact: true });
  const continueButton = picker.getByRole('button', { name: '11 去过，填写到访记录', exact: true });
  await page.setViewportSize({ width: 320, height: 812 });
  await openLocalCategoryPicker(page);
  await expect(continueButton).toBeDisabled();
  const categories = picker.getByRole('group', { name: '选择类别' });
  const categoryNames = ['公园', '乐园', '动物园', '水族馆', '博物馆', '科技馆', '图书馆', '商场', '沙滩', '酒店', '景区景点', '其他'];
  const checkPicker = async () => {
    await expect(categories.getByRole('button', { pressed: false })).toHaveCount(categoryNames.length);
    for (const name of categoryNames) {
      await expect(categories.getByRole('button', { name, exact: true })).toBeVisible();
    }
    const layout = await categories.getByRole('button').evaluateAll(buttons => buttons.map(el => ({
      left: el.getBoundingClientRect().left, top: el.getBoundingClientRect().top,
      fits: el.scrollWidth <= el.clientWidth
    })));
    expect(layout.every(button => button.fits)).toBe(true);
    // The local picker contract is three rows of four on both mobile and desktop.
    expect(new Set(layout.map(button => button.left)).size).toBe(4);
    expect([...new Set(layout.map(button => button.top))].map(top =>
      layout.filter(button => button.top === top).length)).toEqual([4, 4, 4]);
  };
  await checkPicker();
  await expect(categories.getByRole('button', { pressed: true })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: '公园', exact: true })).toBeFocused();
  const scenic = picker.getByRole('button', { name: '景区景点', exact: true });
  await scenic.press('Space');
  await expect(scenic).toBeFocused();
  await expect(scenic).toHaveAttribute('aria-pressed', 'true');
  await continueButton.click();
  await expect(page).toHaveURL(/maintainer.html$/);
  await expect(page.locator('#heading')).toContainText('搜索公园');

  const place = { provider: 'tencent', poiId: 'tencent-poi-1', name: '搜索公园', address: '测试路 1 号',
    category: 'scenic', lat: 31.24, lng: 121.48, visitedOn: '2026-09-12' };
  await page.getByLabel('到访日期').fill(place.visitedOn);
  await page.getByRole('button', { name: '预览记录' }).click();
  await page.getByRole('button', { name: '保存到本地草稿' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载待发布 JSON' }).click();
  expect(JSON.parse(readFileSync(await (await download).path(), 'utf8')).places).toEqual([visit, place]);

  await page.setViewportSize({ width: 1120, height: 900 });
  await openLocalCategoryPicker(page);
  await checkPicker();
  await picker.getByRole('button', { name: '公园', exact: true }).click();
  await continueButton.click();
  await expect(page.locator('#heading')).toContainText('搜索公园');
  await expect(page.getByLabel('到访日期')).toHaveValue(place.visitedOn);
  await page.getByLabel('11’s 玩后感').fill('下次还想去');
  await page.getByRole('button', { name: '预览记录' }).click();
  await page.getByRole('button', { name: '保存到本地草稿' }).click();
  expect(JSON.parse(await page.locator('#batchOutput').inputValue()).places).toEqual([
    visit, { ...place, reflection: '下次还想去' }
  ]);
  expect(await page.evaluate(() => localStorage.getItem('baby_playmap_v1'))).toBeNull();
});

test('local POI handoff keeps the original category of an already published place', async ({ page }) => {
  const published = { ...visit, poiId: 'tencent-poi-1', name: '搜索公园', category: 'park' };
  await serveVisits(page, [published]);
  await openLocalCategoryPicker(page);
  await page.getByRole('button', { name: '景区景点', exact: true }).click();
  await page.getByRole('button', { name: '11 去过，填写到访记录', exact: true }).click();
  await expect(page.locator('#heading')).toContainText(published.name);
  await expect(page.getByLabel('到访日期')).toHaveValue(published.visitedOn);
  await page.getByLabel('11’s 玩后感').fill('沿用已发布地点');
  await page.getByRole('button', { name: '预览记录' }).click();
  await page.getByRole('button', { name: '保存到本地草稿' }).click();
  expect(JSON.parse(await page.locator('#batchOutput').inputValue()).places).toEqual([
    { ...published, reflection: '沿用已发布地点' }
  ]);
});

test('public origins cannot enable the local POI search mode', async ({ page }) => {
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  await page.route('https://playmap.example/**', route => {
    if (route.request().url().includes('public-places.json')) return route.fulfill({ json: { places: [visit] } });
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://playmap.example/?maintain=1');
  await expect(page.locator('#searchBox')).toBeHidden();
  await expect(page.getByRole('button', { name: /足迹/ })).toBeVisible();
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
  await page.getByRole('button', { name: '公园', exact: true }).click();
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
      await page.getByRole('button', { name: /足迹/ }).click();
      await expect(page.locator('#placeList [data-place-id]')).toHaveCount(age === null ? 0 : 1);
      if (age !== null) {
        await page.locator('#placeList [data-place-id]').click();
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
    await expect(detail.getByRole('button', { name: '导航去这里', exact: true })).toBeVisible();
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
      await detail.getByRole('button', { name: '导航去这里', exact: true }).scrollIntoViewIfNeeded();
      await expect(detail.getByRole('button', { name: '导航去这里', exact: true })).toBeInViewport();
      await screenshotWhenReady(page, { path: '/tmp/playmap-39-logs/synthetic-80-characters-320-navigation.png' });
    }
  });
}

test('map selection highlights a film frame and details return to the same selection', async ({ page }) => {
  await expect(selectedFrame(page)).toHaveCount(0);
  await page.evaluate(() => window.__openTestPlace());
  await expect(selectedFrame(page)).toBeVisible();
  await expect(selectedFrame(page)).toContainText(visit.name);
  await expect(page.locator('#drawerDetail')).not.toHaveClass(/open/);
  await selectedFrame(page).click();
  await expect(page.locator('#drawerDetail')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  // 关闭详情回到同一画格（而非片头按钮），键盘才能接着用方向键换地点。
  await expect(selectedFrame(page)).toBeFocused();
  await selectedFrame(page).click();
  await page.locator('#mask').click({ position:{ x:8, y:8 } });
  await expect(page.locator('#drawerDetail')).not.toHaveClass(/open/);
  await expect(selectedFrame(page)).toBeVisible();
  await expect(selectedFrame(page)).toBeFocused();
  await page.waitForTimeout(450);
  await page.evaluate(() => window.__mapEvents.click());
  await expect(selectedFrame(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name:'看照片', exact:true })).toBeHidden();
});

for (const width of [320, 375, 414, 768, 1249]) {
  test(`selected pin and film frame stay apart with long names at ${width}px`, async ({ page }) => {
    await page.setViewportSize({width, height:812});
    await serveVisits(page, [{...visit, name:'上海BFC外滩金融中心南区商场与附近到访活动的完整地点名称'}]);
    await page.reload();
    await expect(page.locator('[data-map-pin="public:visit-1"]')).toBeVisible();
    await page.evaluate(() => window.__testMap.setZoom(17));
    await page.locator('[data-map-pin="public:visit-1"]').click();
    const pin = page.locator('[data-map-pin="public:visit-1"]');
    const frame = selectedFrame(page);
    await expect(frame).toContainText('上海BFC外滩金融中心');
    const pinBox = await pin.boundingBox(), frameBox = await frame.boundingBox();
    const strip = await page.locator('#filmstrip').boundingBox();
    const chips = await page.locator('#mapCatStrip').boundingBox();
    expect(pinBox.y).toBeGreaterThanOrEqual(chips.y+chips.height+4);
    if (pinBox.x < frameBox.x+frameBox.width && pinBox.x+pinBox.width > frameBox.x) {
      expect(pinBox.y+pinBox.height).toBeLessThanOrEqual(strip.y-4);
    }
    expect(await page.evaluate(() => window.__testMap.getZoom())).toBe(17);
    // 长名称在画格内单行省略：画格本身不产生横向溢出，名称被截断而不是撑破片基。
    expect(await frame.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const nameStyle = await frame.locator('.film-name').evaluate(el => {
      const style = getComputedStyle(el);
      return { clamp: style.webkitLineClamp, whiteSpace: style.whiteSpace, clipped: el.scrollHeight > el.clientHeight };
    });
    expect(nameStyle.clamp).toBe('2');
    expect(nameStyle.whiteSpace).toBe('normal');
    expect(nameStyle.clipped).toBe(true);
    expect(frameBox.height).toBeGreaterThanOrEqual(44);
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
  await expect(selectedFrame(page)).toContainText(visit.name);
  await expect(page.locator('[data-map-pin="public:visit-1"]')).toHaveCSS('width','60px');
  await expect(page.locator('[data-map-pin="public:mall"]')).toHaveCSS('width','44px');
  await page.locator('[data-map-pin="public:mall"]').click();
  await expect(selectedFrame(page)).toContainText('上海商场');
  await expect(page.locator('[data-map-pin="public:visit-1"]')).toHaveCSS('width','44px');
  await expect(page.locator('[data-map-pin="public:mall"]')).toHaveCSS('width','60px');
  // The SDK bubbles a marker click to the map; selection must survive that click.
  await expect(selectedFrame(page)).toBeVisible();
  await page.locator('#mapCatStrip [data-cat="mall"]').click();
  await expect(page.locator('[data-map-pin]')).toHaveCount(1);
  await expect(page.locator('#mapCatStrip [data-cat="mall"]')).toHaveAttribute('aria-pressed','true');
  await page.getByLabel('选择城市').selectOption('泉州市');
  await expect(selectedFrame(page)).toBeHidden();
  await expect(page.locator('[data-map-pin]')).toHaveCount(1);
  // 泉州没有商场记录：类别条只剩这个城市能产生的类别，原类别回落到「全部」。
  await expect(page.locator('#mapCatStrip').getByRole('button')).toHaveText(['✨ 全部', '🌳 公园']);
  await expect(page.locator('#mapCatStrip [data-cat="all"]')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:/足迹/}).click();
  await expect(page.locator('#placeList h3')).toHaveText(['泉州市1处']);
  await page.keyboard.press('Escape');
  await page.getByLabel('选择城市').selectOption('all');
  await expect(page.locator('[data-map-pin]')).toHaveCount(4);
  await page.getByLabel('选择城市').selectOption('城市待补充');
  await page.getByRole('button',{name:/足迹/}).click();
  await expect(page.locator('#placeList h3')).toHaveText(['城市待补充1处']);
  await expect(page.locator('#placeList time')).toHaveText(['2026.09.12']);
  await page.locator('#placeList').getByRole('button',{name:'待补城市',exact:true}).click();
  await expect(page.getByRole('dialog', {name:'待补城市',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#placeList').getByRole('button', {name:'待补城市',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  // 胶卷是常驻的选中面：关掉档案列表不会顺手丢掉选中，画格与图钉都还在。
  await expect(page.locator('#drawerPlaces')).not.toHaveClass(/open/);
  await expect(selectedFrame(page)).toHaveAttribute('data-place-id', 'public:unknown');
  await expect(page.getByRole('button',{name:/足迹/})).toBeFocused();
});

test('map gestures preserve selection and blank-map click clears its highlight', async ({page}) => {
  await page.clock.install();
  await page.locator('[data-map-pin="public:visit-1"]').click();
  await expect(selectedFrame(page)).toBeVisible();
  await page.evaluate(() => {window.__mapEvents.dragstart?.(); window.__mapEvents.dragend?.(); window.__mapEvents.zoom?.();});
  await expect(selectedFrame(page)).toBeVisible();
  await expect(page.locator('#drawerDetail')).not.toHaveClass(/open/);
  await page.clock.runFor(450);
  await page.evaluate(() => window.__mapEvents.click());
  await expect(selectedFrame(page)).toBeHidden();
  await expect(page.locator('[data-map-pin="public:visit-1"]')).toHaveCSS('width','44px');
});


for (const viewingPhoto of [false, true]) {
test(`map timeout clears selection before fallback details and retry (photo ${viewingPhoto})`, async ({page}) => {
  await page.clock.install();
  await page.addInitScript(() => { window.__skipMapTilesLoaded = true; });
  await serveVisits(page, [visit, {...visit, poiId:'fallback-other', name:'另一个到访地点', lng:121.478}]);
  await page.reload();
  await page.locator('[data-map-pin="public:visit-1"]').click();
  await expect(selectedFrame(page)).toContainText(visit.name);
  await selectedFrame(page).focus();
  if (viewingPhoto) await page.keyboard.press('Enter');
  await page.clock.runFor(8001);
  await expect(page.locator('#mapFallback')).toBeVisible();
  await expect(selectedFrame(page)).toBeHidden();
  await expect(page.locator('[data-map-pin]')).toHaveCount(0);
  if (viewingPhoto) {
    await expect(page.getByRole('dialog', {name:visit.name, exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await expect(page.getByRole('button', {name:/足迹/})).toBeFocused();
  const fallbackPlace = page.locator('#fallbackList').getByRole('button', {name:'另一个到访地点 · 11 去过', exact:true});
  await fallbackPlace.click();
  await expect(page.getByRole('dialog', {name:'另一个到访地点', exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(fallbackPlace).toBeFocused();
  await expect(selectedFrame(page)).toBeHidden();
  await page.evaluate(() => { window.__skipMapTilesLoaded = false; });
  await page.getByRole('button', {name:'重试地图', exact:true}).click();
  await page.clock.runFor(1);
  await expect(page.locator('#mapFallback')).toBeHidden();
  await expect(page.locator('[data-map-pin]')).toHaveCount(2);
  for (const pin of await page.locator('[data-map-pin]').all()) await expect(pin).toHaveCSS('width','44px');
  await expect(selectedFrame(page)).toBeHidden();
});
}

test('one click plays the full chronology with distinct return arcs and each visit photo', async ({page}) => {
  const collage = 'assets/visits/bfc-20260919.jpg';
  const lastPhoto = 'assets/visits/dongming-gongyuan-20250501.jpg';
  await serveVisits(page, [
    {...visit, name:'上海古镇', category:'scenic', address:'上海市甲路', visits:[
      {visitedOn:'2026-09-14', photo:lastPhoto},
      {visitedOn:'2025-06-10', photo:visit.photo},
      {visitedOn:'2025-06-10', photo:collage},
      {visitedOn:'2026-09-13', photo:collage},
      {visitedOn:'2025-01-01'}
    ]},
    // Same city: only the category filter should hide this stop outside playback.
    {...visit, poiId:'middle', name:'中途站', address:'上海市乙路', category:'zoo', lng:121.521},
    {...visit, poiId:'another', name:'上海园林', category:'scenic', address:'上海市丙路', lng:121.483, visitedOn:'2026-09-15'}
  ]);
  await page.setViewportSize({width:390, height:844});
  await page.goto('/');
  const play = page.getByRole('button', {name:'播放', exact:true});
  await expect(play).toBeVisible();
  await page.locator('#cityFilter').selectOption('上海市');
  const scenic = page.locator('#mapCatStrip').getByRole('button', {name:'⛰️ 景区景点', exact:true});
  await scenic.click();
  await page.clock.install();
  const frames = page.locator('#filmstripItems .film-frame');
  const rider = page.locator('#rider');
  const current = selectedFrame(page);
  await expect(frames.locator('time')).toHaveText(['2026.09.15', '2026.09.14']);
  await play.click();
  await expect(page.getByRole('region', {name:/胶卷/})).toHaveCount(1);
  await expect(frames).toHaveCount(5);
  await expect(current.locator('time')).toHaveText('2025.06.10');
  await expect(current.locator('img')).toHaveAttribute('src', visit.photo);
  const departure = await rider.getAttribute('transform');

  await page.clock.fastForward(10_000);
  await expect(current.locator('time')).toHaveText('2025.06.10');
  await page.clock.runFor(1100);
  await expect(rider).not.toHaveAttribute('transform', departure);
  await page.clock.runFor(1350);
  await expect(current).toContainText('中途站');
  const guides = page.locator('#routeLegs path:nth-child(odd)');
  const outward = await guides.nth(0).getAttribute('d');
  const returning = await guides.nth(1).getAttribute('d');
  const curveControl = path => path.split(' Q')[1].split(' ').slice(0, 2);
  expect(curveControl(outward)).not.toEqual(curveControl(returning));
  await page.clock.runFor(2300);
  await expect(current.locator('time')).toHaveText('2026.09.13');
  await expect(current.locator('img')).toHaveAttribute('src', collage);
  const returned = await rider.getAttribute('transform');

  await page.clock.runFor(1100);
  await expect(rider).toHaveAttribute('transform', returned);
  await page.clock.runFor(1200);
  await expect(current.locator('time')).toHaveText('2026.09.14');
  await expect(current.locator('img')).toHaveAttribute('src', lastPhoto);
  const pause = page.getByRole('button', {name:'暂停', exact:true});
  await pause.click();
  await expect(current).toBeInViewport({ratio:.95});
  await expect(current).toHaveCSS('background-color', 'rgb(255, 214, 91)');
  expect(await current.locator('.film-number').evaluate(number =>
    getComputedStyle(number, '::before').borderLeftWidth
  )).toBe('6px');

  await page.getByRole('button', {name:'继续', exact:true}).click();
  await page.clock.runFor(2300);
  await expect(current.locator('time')).toHaveText('2026.09.15');
  await page.getByRole('button', {name:'重播', exact:true}).click();
  await expect(current.locator('time')).toHaveText('2025.06.10');
  await page.getByRole('button', {name:'结束', exact:true}).click();
  await expect(play).toBeFocused();
  await expect(frames.locator('time')).toHaveText(['2026.09.15', '2026.09.14']);
  await expect(page.locator('#cityFilter')).toHaveValue('上海市');
  await expect(scenic).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__mapFitBoundsCalls.at(-1).bounds)).toEqual([[31.23,121.47],[31.23,121.483]]);

  await play.click();
  await page.evaluate(() => window.__mapEvents.click());
  await expect(play).toBeVisible();
  expect(await page.evaluate(() => window.__mapFitBoundsCalls.at(-1).bounds)).toEqual([[31.23,121.47],[31.23,121.483]]);

  await play.click();
  const placeList = page.getByRole('button', {name:/足迹/});
  await placeList.click();
  await expect(page.locator('#drawerPlaces')).toBeVisible();
  expect(await page.evaluate(() => window.__mapFitBoundsCalls.at(-1).bounds)).toEqual([[31.23,121.47],[31.23,121.483]]);
  await page.keyboard.press('Escape');

  await play.click();
  const hiddenByFilter = page.getByRole('button', {name:/中途站.*到访，在地图上选中/});
  await hiddenByFilter.focus();
  const previousCameraMoves = await page.evaluate(() => window.__mapEaseToCalls?.length ?? 0);
  await page.keyboard.press('Enter');
  await expect(play).toBeFocused();
  await expect(current).toHaveCount(0);
  await expect(page.getByRole('button', {name:'看照片', exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => window.__mapEaseToCalls?.length ?? 0)).toBe(previousCameraMoves);
  expect(await page.evaluate(() => window.__mapFitBoundsCalls.at(-1).bounds)).toEqual([[31.23,121.47],[31.23,121.483]]);

  const townPin = page.locator('[data-map-pin="public:visit-1"]');
  const gardenPin = page.locator('[data-map-pin="public:another"]');
  // Inspect the rendered pin image, not the adapter's style IDs or full SVG.
  const pinArt = pin => pin.evaluate(async image => {
    const svg = new DOMParser().parseFromString(await (await fetch(image.src)).text(), 'image/svg+xml');
    return {
      labels: Array.from(svg.querySelectorAll('text'), label => label.textContent),
      strokes: Array.from(svg.querySelectorAll('[stroke]'), shape => shape.getAttribute('stroke'))
    };
  });
  await expect(page.locator('[data-map-pin]')).toHaveCount(2);
  await expect(townPin).toBeVisible();
  await expect(gardenPin).toBeVisible();
  expect((await pinArt(townPin)).labels).toContain('⛰️');
  const idle = await pinArt(gardenPin);
  expect(idle.labels).toContain('⛰️');
  const pinWidth = pin => pin.evaluate(image => image.getBoundingClientRect().width);
  const idleWidth = await pinWidth(gardenPin);
  await gardenPin.click();
  await expect(current).toContainText('上海园林');
  const selected = await pinArt(gardenPin);
  expect(selected.labels).toContain('⛰️');
  expect(selected.strokes.some(stroke => !idle.strokes.includes(stroke))).toBe(true);
  expect(await pinWidth(gardenPin)).toBeGreaterThan(idleWidth);
  expect(await pinWidth(townPin)).toBe(idleWidth);
});

test('playback can pause and continue before the first animation frame', async ({page}) => {
  await serveVisits(page, [visit, {...visit, poiId:'earlier', visitedOn:'2025-06-10'}]);
  await page.goto('/');
  await expect(page.getByRole('button', {name:'播放', exact:true})).toBeVisible();
  await page.clock.install({time: new Date('2026-11-19T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-11-19T12:00:01Z'));

  const play = page.locator('#routePlay');
  await play.focus();
  await page.keyboard.press('Enter');
  await expect(play).toHaveText('暂停');
  await page.keyboard.press('Enter');
  await expect(play).toHaveText('继续');
  await expect(play).toBeFocused();
  await page.clock.runFor(3000);
  await expect(selectedFrame(page).locator('time')).toHaveText('2025.06.10');
  await page.keyboard.press('Enter');
  await page.clock.runFor(2400);
  await expect(selectedFrame(page).locator('time')).toHaveText('2026.09.12');
  await expect(play).toHaveText('重播');
});

test('choosing a playback frame with Enter restores focus to the ordinary frame', async ({page}) => {
  await serveVisits(page, [visit, {...visit, poiId:'earlier', name:'早期地点', visitedOn:'2025-06-10'}]);
  await page.goto('/');
  await page.getByRole('button', {name:'播放', exact:true}).click();

  const earlier = page.getByRole('button', {name:/早期地点.*到访，在地图上选中/});
  await earlier.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#drawerDetail')).not.toHaveClass(/open/);
  await expect(page.getByRole('button', {name:'播放', exact:true})).toBeVisible();
  await expect(page.locator('#routeInk')).toBeHidden();
  await expect(earlier).toBeFocused();
  await expect(earlier).toHaveAttribute('aria-current', 'true');
});

test('playback gives control back to the list when a short viewport hides the filmstrip', async ({page}) => {
  await page.getByRole('button', {name:'播放', exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name:'重播', exact:true})).toBeFocused();

  await page.setViewportSize({width:812, height:375});
  await expect(page.getByRole('button', {name:/足迹/})).toBeFocused();
  await expect(page.locator('#routeInk')).toBeHidden();
  await page.setViewportSize({width:375, height:812});
  await expect(page.getByRole('button', {name:'播放', exact:true})).toBeVisible();
});

test('reduced-motion playback announces stations and switches vehicle around 500 km', async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'});
  await serveVisits(page, [
    {...visit, lat:0, lng:121.47, visitedOn:'2026-09-10'},
    {...visit, poiId:'under-500-km', name:'短程到访', lat:4.49, lng:121.47, visitedOn:'2026-09-11'},
    {...visit, poiId:'over-500-km', name:'长程到访', lat:8.99, lng:121.47}
  ]);
  await page.goto('/');
  await expect(page.getByRole('button', {name:'播放', exact:true})).toBeVisible();
  await page.clock.install();
  await page.locator('#routePlay').focus();
  await page.keyboard.press('Enter');

  const rider = page.locator('#rider');
  const start = await rider.getAttribute('transform');
  await expect(page.locator('#riderCar')).toBeVisible();
  await expect(page.locator('#riderPlane')).toBeHidden();
  expect(await page.evaluate(() => window.__mapFitBoundsCalls.at(-1).bounds)).toEqual([[0,121.47],[4.49,121.47]]);
  await page.clock.runFor(1700);
  await expect(rider).toHaveAttribute('transform', start);
  await page.clock.runFor(700);
  await expect(page.locator('#riderPlane')).toBeVisible();
  await expect(page.locator('#riderCar')).toBeHidden();
  expect(await page.evaluate(() => window.__mapFitBoundsCalls.at(-1).bounds)).toEqual([[4.49,121.47],[8.99,121.47]]);
  await expect(page.getByRole('region', {name:'11 的足迹胶卷'}).getByRole('status')).toHaveText('第 2 站，共 3 站，短程到访，2026-09-11');
  await expect(page.getByRole('button', {name:'暂停', exact:true})).toBeFocused();
  await expect(page.locator('#filmstripItems .film-frame').first()).toHaveCSS('transform', 'none');
  await expect(selectedFrame(page)).toHaveCSS('transition-duration', '0s');
});

test('playback is absent without complete stops and a single visit can replay', async ({page}) => {
  await page.getByRole('button', {name:'播放', exact:true}).click();
  await expect(selectedFrame(page).locator('time')).toHaveText('2026.09.12');
  const replay = page.getByRole('button', {name:'重播', exact:true});
  await replay.click();
  await expect(replay).toBeVisible();
  await expect(selectedFrame(page)).toHaveCount(1);
  await page.getByRole('button', {name:'结束', exact:true}).click();
  await expect(selectedFrame(page)).toHaveCount(0);

  await serveVisits(page, [{...visit, visits:[{visitedOn:'2026-09-12'}]}]);
  await page.reload();
  await expect(page.locator('#visitEmpty')).toContainText('暂无完整的到访记录');
  await expect(page.getByRole('button', {name:'播放', exact:true})).toHaveCount(0);
  await expect(page.getByRole('button', {name:/足迹/})).toBeVisible();
});
