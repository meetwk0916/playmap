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
      this.easeTo = function () {};
      this.on = function () {};
    },
    MarkerStyle: function (options) {
      window.__markerStyleOptions = window.__markerStyleOptions || [];
      window.__markerStyleOptions.push(options);
      Object.assign(this, options);
    },
    MultiMarker: function () {
      this.setGeometries = function () {};
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
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeHidden();
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect(page.getByRole('button', { name: '添加地点' })).toBeVisible();
  await expect(page.locator('#mapCatStrip')).toBeVisible();
});

test('production placeholders do not configure an invalid map proxy', async ({ page }) => {
  const mapConfig = await page.evaluate(() => ({
    securityConfig: window._TMapSecurityConfig,
    anchors: window.__markerStyleOptions.map(options => options.anchor)
  }));

  expect(mapConfig.securityConfig).toBeUndefined();
  expect(mapConfig.anchors).toHaveLength(16);
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

  for (const category of ['playground', 'zoo', 'museum', 'library', 'mall', 'water']) {
    expect(categories[category]).toBe(3);
  }
  expect(categories.other || 0).toBe(0);
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

test('online search can navigate before saving a place', async ({ page }) => {
  await page.locator('#searchInput').fill('搜索公园');
  await expect(page.getByText('搜索公园', { exact: true })).toBeVisible();
  await page.getByText('搜索公园', { exact: true }).click();

  const dialog = page.getByRole('dialog', { name: '搜索公园' });
  await expect(dialog.getByRole('button', { name: '导航去这里' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '添加到我的地图' })).toBeVisible();
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
