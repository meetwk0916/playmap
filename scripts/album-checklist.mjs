import { validatePrivateOutput, readPrivateJson, writePrivateJson } from './private-checklist.mjs';

// This helper reads an explicitly supplied source index; it never claims album traversal is complete.
export async function collectAlbumChecklist({ page, albumUrl, itemUrls, from, to, outputPath, repoRoot, detailTimeoutMs = 10000 }) {
  const album = new URL(albumUrl);
  if (album.origin !== 'https://photos.google.com' || !/^\/album\/[^/]+$/.test(album.pathname)) throw new Error('Expected a Google Photos album URL');
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to) || from > to) throw new Error('Expected an inclusive ISO date interval');
  if (!Number.isFinite(detailTimeoutMs) || detailTimeoutMs <= 0) throw new Error('Expected a positive detail timeout');
  const actualTarget = await validatePrivateOutput(outputPath, repoRoot);
  const urls = [...new Set(itemUrls)];
  for (const url of urls) {
    const item = new URL(url);
    if (item.origin !== album.origin || !item.pathname.startsWith(`${album.pathname}/photo/`) || item.pathname.slice(`${album.pathname}/photo/`.length).includes('/')) throw new Error('Item outside the specified album');
  }
  const prior = await readPrivateJson(actualTarget);
  if (prior && (prior.albumUrl !== album.href || prior.from !== from || prior.to !== to || !Array.isArray(prior.sourceIndex) || prior.sourceIndex.length !== urls.length || new Set(prior.sourceIndex).size !== urls.length || prior.sourceIndex.some(url => !urls.includes(url)))) throw new Error('Existing progress has a different source scope; use a separate output file');
  const validRecord = item => {
    if (!item || !urls.includes(item.url) || !['photo', 'video', 'unknown'].includes(item.mediaType) || item.locationProvenance !== 'unknown') return false;
    const location = item.location;
    const validLocation = location === null || (location && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180);
    if (!validLocation || (item.date !== null && !validDate(item.date))) return false;
    if (item.readStatus === 'pending-retry') return item.location === null;
    if (item.readStatus === 'skipped-video') return item.mediaType === 'video' && item.date === null && item.location === null;
    if (item.mediaType !== 'photo' || !validDate(item.date)) return false;
    const inWindow = item.date >= from && item.date <= to;
    return (item.readStatus === 'read' && inWindow) || (item.readStatus === 'out-of-window' && !inWindow);
  };
  if (prior && (!Array.isArray(prior.items) || prior.items.length !== urls.length || new Set(prior.items.map(item => item?.url)).size !== urls.length || prior.items.some(item => !validRecord(item)))) throw new Error('Existing progress is incompatible; original file preserved');
  const emptyRecord = url => ({ url, date: null, mediaType: 'unknown', location: null, locationProvenance: 'unknown', readStatus: 'pending-retry' });
  const result = prior || { albumUrl: album.href, from, to, sourceIndex: urls, review: { status: 'not-started', confirmedBatches: [] }, items: urls.map(emptyRecord) };
  const save = async () => {
    result.readComplete = false;
    result.indexedReadComplete = result.items.every(item => item.readStatus !== 'pending-retry');
    await writePrivateJson(actualTarget, result);
  };
  await save();
  for (const url of result.sourceIndex) {
    const index = result.items.findIndex(item => item.url === url);
    if (result.items[index].readStatus !== 'pending-retry') continue;
    let record = { ...result.items[index], ...emptyRecord(url) };
    delete record.error;
    try {
      // A fresh document prevents a previous photo's asynchronous detail panel surviving navigation.
      const sentinel = `album-read-${Date.now()}-${Math.random()}`;
      await page.evaluate(value => { window.__playmapAlbumDocument = value; }, sentinel);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (await page.evaluate(value => window.__playmapAlbumDocument === value, sentinel)) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        if (await page.evaluate(value => window.__playmapAlbumDocument === value, sentinel)) throw new Error('Could not establish a fresh photo document');
      }
      const deadline = Date.now() + detailTimeoutMs;
      let nextOpenAt = 0;

      while (Date.now() < deadline) {
        const state = await page.evaluate(({ expectedId, canOpen }) => {
          const visible = node => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !node.closest('[aria-hidden="true"]');
          // A playing video hides its poster; the active slide still supplies its date and type.
          const labelled = [...document.querySelectorAll('img[jsname="uLHQEd"], video[aria-label]')].filter(node => visible(node.closest('c-wiz') || node));
          const media = labelled.length === 1 ? labelled[0] : labelled.length === 0 ? [...document.querySelectorAll('img[alt]')].find(node => /\.(jpg|jpeg|png|heic|mp4|mov)$/i.test(node.alt)) : null;
          const label = media?.getAttribute('aria-label') || '';
          const mediaId = media?.closest('c-wiz')?.getAttribute('data-media-key');
          const mediaType = media?.tagName === 'VIDEO' || /视频|Video/i.test(label) ? 'video' : media ? 'photo' : 'unknown';
          if (mediaId === expectedId && mediaType === 'video') return { url: location.href, skippedVideo: true };
          const open = [...document.querySelectorAll('button[aria-label="打开信息"], button[aria-label="Open info"]')].find(node => node.checkVisibility({ checkVisibilityCSS: true }));
          const files = [...document.querySelectorAll('[aria-label^="文件名："], [aria-label^="File name:"]')].filter(visible);
          const file = files.length === 1 ? files[0] : null;
          const panel = file?.closest('dl') || [...document.querySelectorAll('aside[aria-label="信息"], aside[aria-label="Info"]')].find(visible);
          const close = [...document.querySelectorAll('button[aria-label="关闭信息"], button[aria-label="Close info"]')].find(visible);
          const didOpen = Boolean(canOpen && mediaId === expectedId && open && !close && !panel);
          if (didOpen) open.click();
          const text = panel?.innerText || '';
          const mediaDate = label.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
          const detailDateText = panel?.querySelector('[aria-label^="拍摄日期："], [aria-label="Date taken:"]')?.textContent || text;
          const fullDate = detailDateText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/) || detailDateText.match(/(\d{4})-(\d{2})-(\d{2})/);
          const shortDate = detailDateText.match(/(\d{1,2})月(\d{1,2})日/);
          const dateParts = fullDate || (mediaDate && shortDate ? [null, mediaDate[1], shortDate[1], shortDate[2]] : null);
          const date = dateParts ? `${dateParts[1]}-${dateParts[2].padStart(2, '0')}-${dateParts[3].padStart(2, '0')}` : null;
          const panelData = panel?.closest('c-wiz')?.getAttribute('data-p') || '';
          const identityMatches = Boolean(mediaId === expectedId && panelData.split('"').includes(expectedId));
          const map = panel?.querySelector('a[href*="maps?q=loc:"]');
          const coordinate = map?.href.match(/loc:([-\d.]+),([-\d.]+)/);
          const noLocation = Boolean(panel?.querySelector('[aria-label="添加位置"], [aria-label="添加位置信息"], [aria-label="Add a location"]'));
          const candidate = coordinate ? { latitude: Number(coordinate[1]), longitude: Number(coordinate[2]) } : null;
          const validLocation = candidate && Number.isFinite(candidate.latitude) && Math.abs(candidate.latitude) <= 90 && Number.isFinite(candidate.longitude) && Math.abs(candidate.longitude) <= 180;
          return { url: location.href, didOpen, identityMatches, date, mediaType, location: validLocation ? candidate : null, locationReady: Boolean(validLocation || noLocation) };
        }, { expectedId: new URL(url).pathname.split('/').at(-1), canOpen: Date.now() >= nextOpenAt });
        if (state.didOpen) nextOpenAt = Date.now() + 100;
        if (state.url === url && state.skippedVideo) {
          record = { ...record, mediaType: 'video', readStatus: 'skipped-video' };
          break;
        }
        if (state.url === url && state.identityMatches && state.mediaType === 'photo' && validDate(state.date)) {
          record = { ...record, date: state.date, mediaType: state.mediaType };
          if (state.locationReady) {
            record = { ...record, location: state.location, readStatus: 'read' };
            break;
          }
        }
        await new Promise(resolveWait => setTimeout(resolveWait, 50));
      }
      if (record.readStatus === 'read' && (record.date < from || record.date > to)) record.readStatus = 'out-of-window';
    } catch (error) {
      result.items[index] = { ...record, readStatus: 'pending-retry', error: error.message };
      await save();
      throw error;
    }
    result.items[index] = record;
    await save();
  }
  return result;
}
