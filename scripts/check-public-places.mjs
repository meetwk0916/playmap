/**
 * Public place addresses must match the city regex in index.html cityOf.
 * The pattern is read from that function so the list and this check stay on one expression.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function functionSource(html, name) {
  const start = html.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`${name} not found`);
  const open = html.indexOf('{', start);
  if (open < 0) throw new Error(`${name} has no body`);
  let depth = 0;
  for (let i = open; i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    else if (html[i] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is unterminated`);
}

export function parseRegexLiteral(literal) {
  if (!literal.startsWith('/')) throw new Error('city group matcher must be a regex literal');
  let pattern = '';
  for (let i = 1; i < literal.length; i += 1) {
    if (literal[i] === '\\') {
      pattern += literal[i] + (literal[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (literal[i] === '/') {
      const flags = literal.slice(i + 1).match(/^[gimsuy]*/)?.[0] ?? '';
      return new RegExp(pattern, flags);
    }
    pattern += literal[i];
  }
  throw new Error('unterminated city group regex');
}

export function cityGroupPatternFromHtml(html) {
  const source = functionSource(html, 'cityOf');
  const marker = 'place.address.trim().match(';
  const at = source.indexOf(marker);
  if (at < 0) throw new Error('cityOf must match place.address.trim() with the city regex');
  const after = source.slice(at + marker.length);
  const slash = after.search(/\//);
  if (slash < 0 || after.slice(0, slash).trim() !== '') throw new Error('city group matcher must be a regex literal');
  return parseRegexLiteral(after.slice(slash));
}

export function placesWithoutCity(places, pattern) {
  if (!Array.isArray(places)) throw new Error('places must be an array');
  return places.filter(place => {
    const address = place && typeof place.address === 'string' ? place.address : '';
    return !address.trim().match(pattern);
  });
}

export function validateVisitHistory(places) {
  for (const place of places) {
    if (!Object.hasOwn(place, 'visits')) continue;
    const { poiId, visits } = place;
    if (!Array.isArray(visits) || visits.some(visit => !visit || typeof visit !== 'object' || Array.isArray(visit))) {
      throw new Error(`公开地点 ${poiId} 的 visits 必须是到访对象数组。`);
    }
    const dates = new Set();
    for (const { visitedOn } of visits) {
      if (typeof visitedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(visitedOn)) continue;
      const date = new Date(visitedOn);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== visitedOn) continue;
      if (dates.has(visitedOn)) throw new Error(`公开地点 ${poiId} 有重复到访日期 ${visitedOn}。`);
      dates.add(visitedOn);
    }
  }
}

const VISIT_PHOTO_FILE = /^assets\/visits\/[a-z0-9-]+\.jpg$/;
const VISIT_PHOTO_DATA_URI = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const VISIT_PHOTO_DATA_URI_PREFIX = 'data:image/jpeg;base64,';
const VISIT_PHOTO_DATA_URI_MAX = 450000;
const VISIT_PHOTO_FILE_MAX_BYTES = 330 * 1024;
const VISIT_PHOTO_MAX_EDGE = 960;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export function visitPhotoRefs(places) {
  if (!Array.isArray(places)) throw new Error('places must be an array');
  const refs = [];
  for (const place of places) {
    const visits = Array.isArray(place?.visits)
      ? place.visits
      : (place?.visitedOn !== undefined || place?.photo !== undefined || place?.reflection !== undefined
        ? [{ visitedOn: place.visitedOn, photo: place.photo, reflection: place.reflection }]
        : []);
    for (const visit of visits) {
      if (visit && typeof visit === 'object' && !Array.isArray(visit) && Object.hasOwn(visit, 'photo') && visit.photo != null) {
        refs.push({ place, visit, photo: visit.photo });
      }
    }
  }
  return refs;
}

export function visitPhotoFormatProblem(photo) {
  if (typeof photo !== 'string' || photo.length === 0) return '照片必须是非空字符串';
  if (VISIT_PHOTO_FILE.test(photo)) return null;
  if (VISIT_PHOTO_DATA_URI.test(photo) && photo.length <= VISIT_PHOTO_DATA_URI_MAX) {
    try {
      atob(photo.slice(VISIT_PHOTO_DATA_URI_PREFIX.length));
      return null;
    } catch {
      return '照片 data URI 的 Base64 无法解码';
    }
  }
  return '照片路径或 data URI 不符合到访规则';
}

function jpegLongestEdge(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (marker === 0xda || offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 7) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      return Math.max(width, height);
    }
    offset += length;
  }
  return null;
}

export function visitPhotoAssetProblem(photo, root) {
  let bytes;
  if (VISIT_PHOTO_FILE.test(photo)) {
    const file = fileURLToPath(new URL(photo, root));
    if (!existsSync(file)) return `照片文件不存在：${photo}`;
    bytes = readFileSync(file);
  } else if (VISIT_PHOTO_DATA_URI.test(photo)) {
    bytes = Buffer.from(photo.slice(VISIT_PHOTO_DATA_URI_PREFIX.length), 'base64');
  } else {
    return null;
  }
  if (bytes.length > VISIT_PHOTO_FILE_MAX_BYTES) return `照片超过 ${VISIT_PHOTO_FILE_MAX_BYTES} 字节：${photo}`;
  if (!bytes.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)) return `照片不是 JPEG：${photo}`;
  const edge = jpegLongestEdge(bytes);
  if (edge === null) return `照片尺寸无法解析：${photo}`;
  if (edge > VISIT_PHOTO_MAX_EDGE) return `照片最长边超过 ${VISIT_PHOTO_MAX_EDGE} 像素：${photo}`;
  return null;
}

export function validateVisitPhotos(places, root) {
  const problems = [];
  for (const { place, visit, photo } of visitPhotoRefs(places)) {
    const where = [place?.name || place?.poiId || '未命名地点', visit?.visitedOn].filter(Boolean).join(' ');
    const format = visitPhotoFormatProblem(photo);
    if (format) {
      problems.push(`${where || '未命名到访'} ${format}`);
      continue;
    }
    const asset = visitPhotoAssetProblem(photo, root);
    if (asset) problems.push(`${where || '未命名到访'} ${asset}`);
  }
  return problems;
}

function main() {
  try {
    const root = new URL('..', import.meta.url);
    const html = readFileSync(new URL('index.html', root), 'utf8');
    const data = JSON.parse(readFileSync(new URL('public-places.json', root), 'utf8'));
    if (!data || !Array.isArray(data.places)) throw new Error('public-places.json has no places array');
    const missing = placesWithoutCity(data.places, cityGroupPatternFromHtml(html));
    if (missing.length) {
      console.error(`公开地点地址无法解析出城市（${missing.length}，规则与 index.html cityOf 相同）：`);
      for (const place of missing) {
        const name = (place && (place.name || place.poiId)) || '未命名地点';
        console.error(`- ${name}：${JSON.stringify(place && place.address)}`);
      }
      process.exitCode = 1;
      return;
    }
    validateVisitHistory(data.places);
    const photoProblems = validateVisitPhotos(data.places, root);
    if (photoProblems.length) {
      console.error(`公开到访照片资产检查失败（${photoProblems.length}）：`);
      for (const problem of photoProblems) console.error(`- ${problem}`);
      process.exitCode = 1;
      return;
    }
    console.log(`公开地点地址均可解析出城市（${data.places.length}）。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
