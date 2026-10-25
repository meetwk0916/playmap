/**
 * Public place addresses must match the city regex in index.html renderCityPlaceList.
 * The pattern is read from that function so the list and this check stay on one expression.
 */
import { readFileSync } from 'node:fs';
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
  const source = functionSource(html, 'renderCityPlaceList');
  const marker = 'place.address.trim().match(';
  const at = source.indexOf(marker);
  if (at < 0) throw new Error('renderCityPlaceList must match place.address.trim() with the city regex');
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

function main() {
  try {
    const root = new URL('..', import.meta.url);
    const html = readFileSync(new URL('index.html', root), 'utf8');
    const data = JSON.parse(readFileSync(new URL('public-places.json', root), 'utf8'));
    if (!data || !Array.isArray(data.places)) throw new Error('public-places.json has no places array');
    const missing = placesWithoutCity(data.places, cityGroupPatternFromHtml(html));
    if (missing.length) {
      console.error(`公开地点地址无法解析出城市（${missing.length}，规则与 index.html renderCityPlaceList 相同）：`);
      for (const place of missing) {
        const name = (place && (place.name || place.poiId)) || '未命名地点';
        console.error(`- ${name}：${JSON.stringify(place && place.address)}`);
      }
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
