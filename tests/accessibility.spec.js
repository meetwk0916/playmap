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
    LatLng: function (lat, lng) { this.lat = lat; this.lng = lng; },
    Map: function () {
      this.getZoom = function () { return 12; };
      this.easeTo = function () {};
      this.on = function () {};
    },
    MarkerStyle: function (options) { Object.assign(this, options); },
    MultiMarker: function () {
      this.setGeometries = function () {};
      this.on = function (event, callback) {
        if (event === 'click') {
          window.__openTestPlace = function () {
            callback({ geometry: { properties: { placeId: 'place-1' } } });
          };
        }
      };
    }
  };
`;

test.beforeEach(async ({ page }) => {
  await page.route('**/map.qq.com/api/gljs**', route => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: tmapStub });
  });
  await page.addInitScript(seed => {
    localStorage.setItem('baby_playmap_v1', JSON.stringify({ version: 1, places: [seed] }));
    localStorage.setItem('baby_playmap_seeded_v1', '1');
    localStorage.setItem('baby_playmap_onboarded', '1');
  }, place);
  await page.goto('/index.html');
});

test('tabs expose and synchronize selection state', async ({ page }) => {
  const mapTab = page.getByRole('tab', { name: '地图' });
  const listTab = page.getByRole('tab', { name: '清单' });

  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
  await expect(mapTab).toHaveAttribute('aria-selected', 'true');
  await listTab.click();
  await expect(listTab).toHaveAttribute('aria-selected', 'true');
  await expect(mapTab).toHaveAttribute('aria-selected', 'false');
  const listPanel = page.getByRole('tabpanel', { name: '清单' });
  await expect(listPanel).toBeVisible();
  await expect(listPanel.getByRole('button', { name: '设置' })).toBeVisible();
  await expect(listPanel.getByText('测试公园')).toBeVisible();
});

test('drawer traps focus, closes with Escape, and restores its trigger', async ({ page }) => {
  await page.getByRole('tab', { name: '清单' }).click();
  const trigger = page.getByRole('button', { name: '设置' });
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: '设置' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('confirmation traps focus and Escape returns to the invoking control', async ({ page }) => {
  await page.getByRole('tab', { name: '清单' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  const clear = page.getByRole('button', { name: '清空', exact: true });
  await clear.click();

  const alert = page.getByRole('alertdialog');
  await expect(alert).toBeVisible();
  await expect(page.getByRole('button', { name: '取消' }).last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(alert).toBeHidden();
  await expect(clear).toBeFocused();
});

test('rating and visit status expose current pressed state', async ({ page }) => {
  await page.evaluate(() => window.__openTestPlace());
  const dialog = page.getByRole('dialog', { name: '测试公园' });
  await expect(dialog).toBeVisible();

  const thirdStar = page.getByRole('button', { name: '3 星' });
  await thirdStar.click();
  await expect(thirdStar).toHaveAttribute('aria-pressed', 'true');

  const status = page.getByRole('button', { name: '标记为已去过' });
  await status.click();
  await expect(page.getByRole('button', { name: '标记为待探索' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: '停车方便' }).click();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
});

test('photo viewer owns Escape without closing its detail drawer', async ({ page }) => {
  await page.evaluate(() => window.__openTestPlace());
  const detail = page.getByRole('dialog', { name: '测试公园' });
  await detail.locator('.visit-photo').click();

  const viewer = page.getByRole('dialog', { name: '游玩照片预览' });
  await expect(viewer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(detail).toBeVisible();
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
      tabbar: document.querySelector('.tabbar').getBoundingClientRect(),
      drawer: document.querySelector('.drawer').getBoundingClientRect()
    }));

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    if (width >= 768) {
      expect(metrics.tabbar.width).toBeLessThanOrEqual(420);
      expect(metrics.drawer.width).toBeLessThanOrEqual(420);
      expect(Math.abs(metrics.tabbar.x - (width - metrics.tabbar.width) / 2)).toBeLessThan(1);
    }
  });
}
