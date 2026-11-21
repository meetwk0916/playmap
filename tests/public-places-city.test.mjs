import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { cityGroupPatternFromHtml, placesWithoutCity, validateVisitHistory, validateVisitPhotos, visitPhotoAssetProblem, visitPhotoFormatProblem, visitPhotoRefs } from '../scripts/check-public-places.mjs';

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
    () => cityGroupPatternFromHtml('function cityOf(place) { return place.address; }\n'),
    /city regex|regex literal/
  );
});

test('publishing keeps draft visits but rejects malformed histories and duplicate exact dates', () => {
  const draftVisits = [{ visitedOn: '2025-02' }, { visitedOn: '2025-02' }, { photo: 'old-value' }, { visitedOn: '2025-04-01' }];
  assert.doesNotThrow(() => validateVisitHistory([{ visitedOn: '2025-01' }, { visits: [] }, { visits: draftVisits }]));
  assert.throws(() => validateVisitHistory([{ poiId: 'demo', visits: null }]), /demo.*visits/);
  assert.throws(() => validateVisitHistory([{ poiId: 'demo', visits: [null] }]), /demo.*visits/);
  assert.throws(() => validateVisitHistory([{ poiId: 'demo', visits: [...draftVisits, { visitedOn: '2025-04-01' }] }]),
    /demo.*2025-04-01/);
});

test('visit photo refs prefer visits array and keep legacy single visits', () => {
  const places = [
    { name: 'legacy', visitedOn: '2025-01-01', photo: 'assets/visits/legacy.jpg' },
    { name: 'multi', visitedOn: '1999-01-01', photo: 'assets/visits/ignored.jpg', visits: [{ visitedOn: '2025-01-02', photo: 'assets/visits/multi.jpg' }] },
    { name: 'dated-no-photo', visitedOn: '2025-01-03' },
    { name: 'none', visits: [] }
  ];
  assert.deepEqual(visitPhotoRefs(places).map(ref => ref.photo), ['assets/visits/legacy.jpg', 'assets/visits/multi.jpg']);
});

test('visit photo format rejects bad paths, bad types and oversized data URIs', () => {
  assert.equal(visitPhotoFormatProblem('assets/visits/ok-20250101.jpg'), null);
  assert.equal(visitPhotoFormatProblem(`data:image/jpeg;base64,${'A'.repeat(10)}`), null);
  assert.equal(visitPhotoFormatProblem('data:image/jpeg;base64,AAA'), null);
  assert.equal(visitPhotoFormatProblem('data:image/jpeg;base64,AA=='), null);
  assert.ok(visitPhotoFormatProblem('assets/visits/Bad.JPG'));
  assert.ok(visitPhotoFormatProblem('data:image/jpeg;base64,A'));
  assert.ok(visitPhotoFormatProblem('data:image/jpeg;base64,AAAAA'));
  assert.ok(visitPhotoFormatProblem('data:image/jpeg;base64,AAAAA='));
  assert.ok(visitPhotoFormatProblem(`data:image/jpeg;base64,${'A'.repeat(450001)}`));
  assert.ok(visitPhotoFormatProblem(123));
});

test('visit photo assets must exist as small JPEGs', () => {
  const root = new URL('../', import.meta.url);
  assert.equal(visitPhotoAssetProblem('assets/visits/definitely-missing.jpg', root), '照片文件不存在：assets/visits/definitely-missing.jpg');
  const places = JSON.parse(readFileSync(new URL('../public-places.json', import.meta.url), 'utf8')).places;
  const refs = visitPhotoRefs(places);
  assert.ok(refs.length > 0);
  assert.deepEqual(validateVisitPhotos(places, root), []);
});

test('visit photo assets decode data URIs and enforce JPEG size and dimensions', () => {
  const root = new URL('../', import.meta.url);
  const jpeg = readFileSync(new URL('../assets/visits/daishan-vienna-20250809.jpg', import.meta.url));
  assert.equal(visitPhotoAssetProblem(`data:image/jpeg;base64,${jpeg.toString('base64')}`, root), null);
  assert.match(visitPhotoAssetProblem(`data:image/jpeg;base64,${Buffer.from('not-a-jpeg').toString('base64')}`, root), /JPEG/);
  const sof = (width, height) => Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00, 0x3f, 0xff, 0xd9
  ]);
  assert.match(visitPhotoAssetProblem(`data:image/jpeg;base64,${sof(1280, 1280).toString('base64')}`, root), /960/);
  assert.equal(visitPhotoAssetProblem(`data:image/jpeg;base64,${sof(800, 600).toString('base64')}`, root), null);
  const headerOnly = Buffer.concat([sof(640, 480).subarray(0, 15), Buffer.from([0xff, 0xd9])]);
  assert.match(visitPhotoAssetProblem(`data:image/jpeg;base64,${headerOnly.toString('base64')}`, root), /图像数据/);
  assert.match(visitPhotoAssetProblem(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`, root), /尺寸/);
  assert.match(validateVisitPhotos([{ name: 'bad', visitedOn: '2025-01-01', photo: 'data:image/jpeg;base64,A' }], root)[0], /Base64/);
});

test('visit photo file assets enforce the published size ceiling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'playmap-places-'));
  try {
    mkdirSync(join(dir, 'assets', 'visits'), { recursive: true });
    writeFileSync(join(dir, 'assets', 'visits', 'oversize.jpg'), Buffer.alloc(331 * 1024));
    const root = pathToFileURL(`${dir}/`);
    assert.match(visitPhotoAssetProblem('assets/visits/oversize.jpg', root), /超过/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
