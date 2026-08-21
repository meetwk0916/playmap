const { test, expect } = require('@playwright/test');

const place = {
  id: 'place-1',
  name: '测试公园',
  category: 'park',
  status: 'wish',
  rating: 0,
  lat: 31.23,
  lng: 121.47,
  tags: [],
  practicalNotes: '',
  visits: [{
    id: 'visit-1',
    date: '2026-08-21',
    durationMinutes: 60,
    note: '测试记录',
    photos: ['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==']
  }],
  createdAt: '2026-08-21T00:00:00.000Z'
};

const tmapStub = `
  window.TMap = {
    LatLng: function (lat, lng) {
      this.lat = lat;
      this.lng = lng;
      this.getLat = function () { return lat; };
      this.getLng = function () { return lng; };
    },
    Map: function () {
      this.getZoom = function () { return 12; };
      this.getCenter = function () { return new window.TMap.LatLng(31.23, 121.47); };
      this.easeTo = function (options) {
        window.__mapEaseToCalls = window.__mapEaseToCalls || [];
        window.__mapEaseToCalls.push(options);
      };
      this.on = function () {};
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
          window.__openTestPlace = function () {
            callback({ geometry: { properties: { placeId: 'place-1' } } });
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

test.beforeEach(async ({ page }) => {
  await page.route('**/map.qq.com/api/gljs**', route => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: tmapStub });
  });
  await page.addInitScript(seed => {
    if (sessionStorage.getItem('playmap_test_keep_storage') === '1') return;
    localStorage.setItem('baby_playmap_v1', JSON.stringify({ version: 1, places: [seed] }));
    localStorage.setItem('baby_playmap_seeded_v1', '1');
    localStorage.setItem('baby_playmap_onboarded', '1');
  }, place);
  await page.goto('/index.html');
});

test('map exposes only the essential decision controls', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeHidden();
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect(page.locator('#fab')).toHaveCount(0);
  await expect(page.locator('#mapCatStrip')).toBeVisible();
  const locate = page.getByRole('button', { name: '找到我的位置' });
  await expect(locate).toBeVisible();
  const locateBox = await locate.boundingBox();
  expect(locateBox).toMatchObject({ width: 48, height: 48 });
  expect(375 - locateBox.x - locateBox.width).toBeCloseTo(16, 0);
  expect(812 - locateBox.y - locateBox.height).toBeCloseTo(18, 0);
});

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
  const mapState = await page.evaluate(() => {
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
  expect(mapState).toEqual({
    center: [31.221, 121.441],
    zoom: 15,
    marker: [31.221, 121.441]
  });
});

test('location permission denial is explained and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success, failure) {
          failure({ code: 1 });
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
});

test('production placeholders do not configure an invalid map proxy', async ({ page }) => {
  const mapConfig = await page.evaluate(() => ({
    securityConfig: window._TMapSecurityConfig,
    anchors: window.__markerStyleOptions.map(options => options.anchor)
  }));

  expect(mapConfig.securityConfig).toBeUndefined();
  expect(mapConfig.anchors).toHaveLength(20);
  expect(mapConfig.anchors.every(anchor => anchor.x === 22 && anchor.y === 52)).toBe(true);
});

test('configured browser key is included in the GL JS request', async ({ page }) => {
  const sdkKey = await page.evaluate(() => {
    const sdkUrl = new URL(document.getElementById('tmapSdk').src);
    return sdkUrl.searchParams.get('key');
  });

  expect(sdkKey).toMatch(/^[A-Z0-9-]+$/);
});

test('existing maps receive representative points for every explicit category', async ({ page }) => {
  const categories = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('baby_playmap_v1'));
    return stored.places.reduce((counts, item) => {
      counts[item.category] = (counts[item.category] || 0) + 1;
      return counts;
    }, {});
  });

  expect(categories).toMatchObject({
    playground: 3,
    zoo: 2,
    aquarium: 1,
    museum: 2,
    science: 1,
    library: 3,
    mall: 3,
    water: 3
  });
  expect(categories.other || 0).toBe(0);
});

test('combined venue categories are exposed as independent filters', async ({ page }) => {
  for (const label of ['动物园', '水族馆', '博物馆', '科技馆']) {
    await expect(page.locator('#mapCatStrip').getByRole('button').filter({ hasText: label })).toBeVisible();
  }
  await expect(page.locator('#mapCatStrip')).not.toContainText('动物园/水族馆');
  await expect(page.locator('#mapCatStrip')).not.toContainText('博物馆/科技馆');
});

test('legacy combined categories split only when the place name is explicit', async ({ page }) => {
  await page.evaluate(() => {
    sessionStorage.setItem('playmap_test_keep_storage', '1');
    const base = { status: 'wish', rating: 0, lat: 31.23, lng: 121.47, tags: [] };
    localStorage.setItem('baby_playmap_v1', JSON.stringify({ version: 1, places: [
      { ...base, id: 'aquarium', name: '旧海洋水族馆', category: 'zoo' },
      { ...base, id: 'zoo', name: '旧动物乐园', category: 'zoo' },
      { ...base, id: 'science', name: '旧天文馆', category: 'museum' },
      { ...base, id: 'museum', name: '旧自然展馆', category: 'museum' }
    ] }));
    localStorage.setItem('baby_playmap_seeded_categories_v1', 'true');
  });
  await page.reload();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('baby_playmap_v1')));
  const categories = Object.fromEntries(stored.places.map(item => [item.id, item.category]));
  expect(stored.version).toBe(2);
  expect(categories).toEqual({
    aquarium: 'aquarium',
    zoo: 'zoo',
    science: 'science',
    museum: 'museum'
  });
});

test('current category choices are preserved regardless of place name', async ({ page }) => {
  await page.evaluate(() => {
    sessionStorage.setItem('playmap_test_keep_storage', '1');
    const base = { status: 'wish', rating: 0, lat: 31.23, lng: 121.47, tags: [] };
    localStorage.setItem('baby_playmap_v1', JSON.stringify({ version: 2, places: [
      { ...base, id: 'zoo', name: '海洋馆里的动物园', category: 'zoo' },
      { ...base, id: 'museum', name: '天文馆里的博物馆', category: 'museum' }
    ] }));
    localStorage.setItem('baby_playmap_seeded_categories_v1', 'true');
  });
  await page.reload();

  const categories = await page.evaluate(() => Object.fromEntries(
    JSON.parse(localStorage.getItem('baby_playmap_v1')).places.map(item => [item.id, item.category])
  ));
  expect(categories).toEqual({ zoo: 'zoo', museum: 'museum' });
});

test('category seed upgrade does not repopulate a deliberately empty map', async ({ page }) => {
  await page.evaluate(() => {
    sessionStorage.setItem('playmap_test_keep_storage', '1');
    localStorage.setItem('baby_playmap_v1', JSON.stringify({ version: 1, places: [] }));
    localStorage.setItem('baby_playmap_seeded_v1', '1');
    localStorage.removeItem('baby_playmap_seeded_categories_v1');
  });
  await page.reload();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('baby_playmap_v1')));
  expect(stored.places).toHaveLength(0);
  await expect.poll(() => page.evaluate(
    () => localStorage.getItem('baby_playmap_seeded_categories_v1')
  )).toBe('true');
});

test('online search results are the only way to add a place', async ({ page }) => {
  await page.locator('#searchInput').fill('搜索公园');
  await expect(page.getByText('搜索公园', { exact: true })).toBeVisible();
  await page.getByText('搜索公园', { exact: true }).click();

  const dialog = page.getByRole('dialog', { name: '搜索公园' });
  await expect(dialog.getByRole('button', { name: '导航去这里' })).toBeVisible();
  await dialog.getByRole('button', { name: '添加到我的地图' }).click();

  const addDialog = page.getByRole('dialog', { name: '添加地点' });
  await expect(addDialog.locator('#addName')).toHaveValue('搜索公园');
  await expect(addDialog.locator('#addName')).toHaveAttribute('readonly', '');
  await addDialog.locator('#btnSubmitAdd').click();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('baby_playmap_v1')).places
    .find(item => item.name === '搜索公园'));
  expect(saved).toMatchObject({ name: '搜索公园', lat: 31.24, lng: 121.48 });
});

test('detail drawer traps focus and closes with Escape', async ({ page }) => {
  await page.evaluate(() => window.__openTestPlace());
  const dialog = page.getByRole('dialog', { name: '测试公园' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('delete confirmation traps focus and Escape returns to the invoking control', async ({ page }) => {
  await page.evaluate(() => window.__openTestPlace());
  const remove = page.getByRole('button', { name: '删除这个地点' });
  await remove.click();

  const alert = page.getByRole('alertdialog');
  await expect(alert).toBeVisible();
  await expect(page.getByRole('button', { name: '取消' }).last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(alert).toBeHidden();
  await expect(remove).toBeFocused();
});

test('detail prioritizes navigation and hides archive controls', async ({ page }) => {
  await page.evaluate(() => {
    window.__navigationUrl = '';
    window.open = url => { window.__navigationUrl = url; };
    window.__openTestPlace();
  });
  const dialog = page.getByRole('dialog', { name: '测试公园' });
  await expect(dialog).toBeVisible();

  await expect(dialog.getByRole('button', { name: '导航去这里' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /星/ })).toHaveCount(0);
  await expect(dialog.getByText('测试记录')).toBeHidden();
  await dialog.getByRole('button', { name: '导航去这里' }).click();
  await expect.poll(() => page.evaluate(() => window.__navigationUrl)).toContain('routeplan');
});

test('legacy archive data remains intact when viewing a place', async ({ page }) => {
  await page.evaluate(() => window.__openTestPlace());
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('baby_playmap_v1')));
  expect(stored.places[0].visits).toHaveLength(1);
  expect(stored.places[0].visits[0].photos).toHaveLength(1);
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

for (const width of [320, 375, 768, 1440]) {
  test(`layout has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      drawer: document.querySelector('.drawer').getBoundingClientRect()
    }));

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    if (width >= 768) {
      expect(metrics.drawer.width).toBeLessThanOrEqual(420);
    }
  });
}
