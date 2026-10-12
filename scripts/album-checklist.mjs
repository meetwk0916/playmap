import { mkdir, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

// This helper reads an explicitly supplied source index; it never claims album traversal is complete.
export async function collectAlbumChecklist({ page, albumUrl, itemUrls, from, to, outputPath, repoRoot, detailTimeoutMs = 10000 }) {
  const album = new URL(albumUrl);
  if (album.origin !== 'https://photos.google.com' || !/^\/album\/[^/]+$/.test(album.pathname)) throw new Error('Expected a Google Photos album URL');
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to) || from > to) throw new Error('Expected an inclusive ISO date interval');
  if (!Number.isFinite(detailTimeoutMs) || detailTimeoutMs <= 0) throw new Error('Expected a positive detail timeout');
  const target = resolve(outputPath);
  const root = await realpath(repoRoot);
  const lexical = relative(root, target);
  if (!lexical.startsWith(`..${sep}`) && lexical !== '..' && !lexical.startsWith(sep)) throw new Error('Private checklist must be outside the repository');
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const actualTarget = resolve(await realpath(dirname(target)), target.split(sep).at(-1));
  const within = relative(root, actualTarget);
  if (!within.startsWith(`..${sep}`) && within !== '..' && !within.startsWith(sep)) throw new Error('Private checklist must be outside the repository');
  const urls = [...new Set(itemUrls)];
  for (const url of urls) {
    const item = new URL(url);
    if (item.origin !== album.origin || !item.pathname.startsWith(`${album.pathname}/photo/`) || item.pathname.slice(`${album.pathname}/photo/`.length).includes('/')) throw new Error('Item outside the specified album');
  }
  const result = { albumUrl: album.href, from, to, readComplete: false, items: [] };
  for (const url of urls) {
    // A fresh document prevents a previous photo's asynchronous detail panel surviving navigation.
    const sentinel = `album-read-${Date.now()}-${Math.random()}`;
    await page.evaluate(value => { window.__playmapAlbumDocument = value; }, sentinel);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (await page.evaluate(value => window.__playmapAlbumDocument === value, sentinel)) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      if (await page.evaluate(value => window.__playmapAlbumDocument === value, sentinel)) throw new Error('Could not establish a fresh photo document');
    }
    const deadline = Date.now() + detailTimeoutMs;
    let opened = false;
    let record = { url, date: null, mediaType: 'unknown', location: null, locationProvenance: 'unknown', readStatus: 'pending-retry' };
    while (Date.now() < deadline) {
      const state = await page.evaluate(({ opened }) => {
        const visible = node => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !node.closest('[aria-hidden="true"]');
        const open = [...document.querySelectorAll('[aria-label="打开信息"], [aria-label="Open info"]')].find(visible);
        if (open && !opened) { open.click(); opened = true; }
        const files = [...document.querySelectorAll('[aria-label^="文件名："], [aria-label^="File name:"]')].filter(visible);
        const file = files.length === 1 ? files[0] : null;
        const panel = file?.closest('dl') || [...document.querySelectorAll('aside[aria-label="信息"], aside[aria-label="Info"]')].find(visible);
        // A playing video hides its poster; the active slide still supplies its date and type.
        const labelled = [...document.querySelectorAll('img[jsname="uLHQEd"], video[aria-label]')].filter(node => visible(node.closest('c-wiz') || node));
        const media = labelled.length === 1 ? labelled[0] : labelled.length === 0 ? [...document.querySelectorAll('img[alt]')].find(node => /\.(jpg|jpeg|png|heic|mp4|mov)$/i.test(node.alt)) : null;
        const label = media?.getAttribute('aria-label') || '';
        const text = panel?.innerText || '';
        const mediaDate = label.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        const detailDateText = panel?.querySelector('[aria-label^="拍摄日期："], [aria-label="Date taken:"]')?.textContent || text;
        const fullDate = detailDateText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/) || detailDateText.match(/(\d{4})-(\d{2})-(\d{2})/);
        const shortDate = detailDateText.match(/(\d{1,2})月(\d{1,2})日/);
        const dateParts = fullDate || (mediaDate && shortDate ? [null, mediaDate[1], shortDate[1], shortDate[2]] : null);
        const date = dateParts ? `${dateParts[1]}-${dateParts[2].padStart(2, '0')}-${dateParts[3].padStart(2, '0')}` : null;
        const sameDate = mediaDate && dateParts && mediaDate.slice(1).every((part, index) => Number(part) === Number(dateParts[index + 1]));
        const mediaTime = label.match(/(\d{1,2}:\d{2})(?::\d{2})?/);
        const detailTime = panel?.querySelector('[aria-label^="拍摄时间："], [aria-label="Time taken:"]')?.textContent.match(/\d{1,2}:\d{2}/)?.[0];
        const identityMatches = Boolean(media && panel && (media.alt ? text.includes(media.alt) : file && sameDate && mediaTime && mediaTime[1] === detailTime));
        const map = panel?.querySelector('a[href*="maps?q=loc:"]');
        const coordinate = map?.href.match(/loc:([-\d.]+),([-\d.]+)/);
        const noLocation = Boolean(panel?.querySelector('[aria-label="添加位置"], [aria-label="添加位置信息"], [aria-label="Add a location"]'));
        const candidate = coordinate ? { latitude: Number(coordinate[1]), longitude: Number(coordinate[2]) } : null;
        const validLocation = candidate && Number.isFinite(candidate.latitude) && Math.abs(candidate.latitude) <= 90 && Number.isFinite(candidate.longitude) && Math.abs(candidate.longitude) <= 180;
        return { url: location.href, opened, identityMatches, date, mediaType: media?.tagName === 'VIDEO' || /视频|Video/i.test(label) ? 'video' : media ? 'photo' : 'unknown', location: validLocation ? candidate : null, locationReady: Boolean(validLocation || noLocation) };
      }, { opened });
      opened = state.opened;
      if (state.url === url && state.identityMatches && state.date) {
        record = { ...record, date: state.date, mediaType: state.mediaType };
        if (state.locationReady) {
          record = { ...record, location: state.location, readStatus: 'read' };
          break;
        }
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 50));
    }
    if (!record.date || (record.date >= from && record.date <= to)) result.items.push(record);
  }
  let file;
  try {
    file = await open(actualTarget, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    await file.chmod(0o600);
    await file.writeFile(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (error.code === 'ELOOP') throw new Error('Private output must not be a symlink');
    throw error;
  } finally { await file?.close(); }
  return result;
}
