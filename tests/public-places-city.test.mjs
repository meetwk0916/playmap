import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cityGroupPatternFromHtml, placesWithoutCity } from '../scripts/check-public-places.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pattern = cityGroupPatternFromHtml(html);

function cityOf(address) {
  const match = String(address).trim().match(pattern);
  return match ? match[1] : '城市待补充';
}

test('city pattern is the list grouping expression', () => {
  assert.equal(pattern.source, '^(?:.*?(?:省|自治区))?([^省市区县]+市)');
  assert.equal(pattern.flags, '');
  assert.equal(cityOf('上海市浦东新区测试路1号'), '上海市');
  assert.equal(cityOf('福建省泉州市鲤城区测试路1号'), '泉州市');
  assert.equal(cityOf('江苏省苏州市吴中区启园路39号'), '苏州市');
  assert.equal(cityOf('广西壮族自治区南宁市青秀区测试路1号'), '南宁市');
  assert.equal(cityOf('浙江省湖州市南浔区人瑞路51号'), '湖州市');
  assert.equal(cityOf(''), '城市待补充');
  assert.equal(cityOf('遵义路100号'), '城市待补充');
  assert.equal(cityOf('秦楼街道碧海路501号'), '城市待补充');
  assert.equal(cityOf('观光旅游大道附近'), '城市待补充');
});

test('every published place address parses to a city', () => {
  const places = JSON.parse(readFileSync(new URL('../public-places.json', import.meta.url), 'utf8')).places;
  assert.ok(places.length > 0);
  assert.deepEqual(placesWithoutCity(places, pattern), []);
  for (const place of places) assert.notEqual(cityOf(place.address), '城市待补充');
});

test('road-only and blank addresses fail the check', () => {
  const missing = placesWithoutCity([
    { name: '有市', address: '江苏省南通市崇川区通刘路299号' },
    { name: '只有路', address: '通刘路299号' },
    { name: '空白', address: '  ' },
    { name: '缺字段' }
  ], pattern);
  assert.deepEqual(missing.map(place => place.name), ['只有路', '空白', '缺字段']);
});

test('a page without the city matcher fails closed', () => {
  assert.throws(
    () => cityGroupPatternFromHtml('function renderCityPlaceList(places) { return places.length; }\n'),
    /city regex|regex literal/
  );
});
