import { validatePrivateOutput, readPrivateJson, writePrivateJson } from './private-checklist.mjs';

const validCoordinate = value => value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
const validSource = value => {
  try { const url = new URL(value); return url.origin === 'https://photos.google.com' && /^\/album\/[^/]+\/photo\/[^/]+$/.test(url.pathname) && !url.search && !url.hash; } catch { return false; }
};
const identity = item => JSON.stringify([item.url, item.location.latitude, item.location.longitude]);
const validCandidate = poi => poi?.provider === 'tencent' && typeof poi.poiId === 'string' && poi.poiId && typeof poi.name === 'string' && typeof poi.address === 'string' && validCoordinate({ latitude: poi.lat, longitude: poi.lng });

// Authorization is a trusted caller's record of explicit session approval, never inferred from photo metadata.
export async function queryTencentCandidates({ page, checklist, authorization, browserKey, outputPath, repoRoot, retryDelaysMs = [1200, 2400], timeoutMs = 10000 }) {
  if (!checklist || !Array.isArray(checklist.items)) throw new Error('Expected a private photo checklist');
  if (!Array.isArray(retryDelaysMs) || retryDelaysMs.length > 3 || retryDelaysMs.some(delay => !Number.isFinite(delay) || delay < 0 || delay > 60000)) throw new Error('Expected at most three bounded retry delays');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) throw new Error('Expected a bounded request timeout');
  const target = await validatePrivateOutput(outputPath, repoRoot);
  const saved = await readPrivateJson(target);
  if (saved && (saved.version !== 1 || saved.recipient !== 'tencent' || saved.purpose !== 'candidate-poi-matching' || !Array.isArray(saved.items) || new Set(saved.items.map(record => record?.url)).size !== saved.items.length || saved.items.some(record => !record || !validSource(record.url) || !validCoordinate(record.location) || !Array.isArray(record.candidates) || !Array.isArray(record.responses) || record.candidates.some(poi => !validCandidate(poi)) || !Number.isInteger(record.attempts) || record.attempts < 0 || record.attempts !== record.responses.length || (record.status === 'success' && record.responses.at(-1)?.status !== 0) || !['success', 'blocked', 'pending-retry', 'unauthorized', 'excluded', 'skipped'].includes(record.status)))) throw new Error('Invalid private query checkpoint; preserved without overwrite');
  const result = { version: 1, recipient: 'tencent', purpose: 'candidate-poi-matching', maxAttempts: retryDelaysMs.length + 1, items: [] };
  const approved = authorization?.recipient === 'tencent' && authorization?.purpose === result.purpose && Array.isArray(authorization.approved) ? authorization.approved : [];
  const seen = new Set();
  for (const item of checklist.items) {
    if (!item || !validSource(item.url)) throw new Error('Invalid checklist source identity');
    if (seen.has(item.url)) throw new Error('Duplicate checklist source identity');
    seen.add(item.url);
    if (!validCoordinate(item.location)) continue;
    let record = { url: item.url, location: { ...item.location }, status: 'pending-retry', candidates: [], responses: [], attempts: 0 };
    result.items.push(record);
    if (item.excluded === true || item.reviewStatus === 'excluded') record.status = 'excluded';
    else if (item.mediaType !== 'photo' || item.readStatus !== 'read') { record.status = 'skipped'; record.reason = 'Only completed photo reads are eligible'; }
    else if (!approved.some(scope => scope.url === item.url && scope.latitude === item.location.latitude && scope.longitude === item.location.longitude)) {
      record.status = 'unauthorized'; record.reason = 'Explicit Tencent coordinate approval required';
    } else {
      const cached = saved?.items.find(previous => identity(previous) === identity(item) && previous.status === 'success');
      if (cached && cached.responses.at(-1)?.status === 0) {
        record = { ...cached, reused: true }; result.items[result.items.length - 1] = record;
      }
    }
  }
  for (const record of result.items) {
    if (record.status !== 'pending-retry' || record.reason || record.reused) continue;
    const item = record;
    if (typeof browserKey !== 'string' || !browserKey.trim()) throw new Error('A public Tencent browser key is required');
    if (await page.evaluate(() => location.origin) !== 'http://127.0.0.1:4173') throw new Error('Tencent query requires the authorized local origin http://127.0.0.1:4173');
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      if (attempt) await new Promise(resolveWait => setTimeout(resolveWait, retryDelaysMs[attempt - 1]));
      const response = await page.evaluate(({ latitude, longitude, key, timeout }) => new Promise(resolveResponse => {
        const callback = `playmapGeocode_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const script = document.createElement('script');
        let timer;
        const finish = response => { clearTimeout(timer); script.remove(); delete window[callback]; resolveResponse(response); };
        window[callback] = finish;
        script.onerror = () => finish({ status: null, message: 'Tencent network request failed' });
        timer = setTimeout(() => finish({ status: null, message: 'Tencent request timed out' }), timeout);
        const endpoint = new URL('https://apis.map.qq.com/ws/geocoder/v1/');
        endpoint.search = new URLSearchParams({ location: `${latitude},${longitude}`, coord_type: '1', get_poi: '1', key, output: 'jsonp', callback }).toString();
        script.src = endpoint.href;
        document.head.append(script);
      }), { ...item.location, key: browserKey, timeout: timeoutMs });
      record.attempts++;
      record.responses.push(response);
      if (response?.status === 0 && Array.isArray(response.result?.pois)) {
        const pois = new Map();
        for (const poi of response.result.pois) {
          if (typeof poi.id !== 'string' || !poi.id || typeof poi.title !== 'string' || !Number.isFinite(poi.location?.lat) || Math.abs(poi.location.lat) > 90 || !Number.isFinite(poi.location?.lng) || Math.abs(poi.location.lng) > 180) continue;
          if (!pois.has(poi.id)) pois.set(poi.id, { provider: 'tencent', poiId: poi.id, name: poi.title, address: typeof poi.address === 'string' ? poi.address : '', lat: poi.location.lat, lng: poi.location.lng });
        }
        record.candidates = [...pois.values()]; record.status = 'success'; delete record.reason;
      } else if (response?.status === 120) { record.status = 'pending-retry'; record.reason = 'Tencent rate limit; bounded attempts exhausted'; }
      else { record.status = 'blocked'; record.reason = `Tencent query blocked: ${response?.status ?? 'network/invalid-response'} ${response?.message || ''}`; }
      await writePrivateJson(target, result);
      if (response?.status !== 120) break;
    }
    await writePrivateJson(target, result);
  }
  await writePrivateJson(target, result);
  return result;
}
