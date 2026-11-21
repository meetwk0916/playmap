import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('../scripts/check-doc-links.mjs', import.meta.url));

function check(t, markdown, files = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'playmap-doc-links-'));
  t.after(() => rmSync(cwd, { recursive: true }));
  for (const [name, content] of Object.entries({ 'README.md': markdown, ...files })) {
    writeFileSync(join(cwd, name), content);
  }
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['add', '--', 'README.md', ...Object.keys(files)], { cwd });
  return spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });
}

test('reports a missing file even when the link title uses single quotes', t => {
  const result = check(t, "[验证](missing.md '说明')\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md:1: missing\.md \(missing target\)/);
});

test('accepts a file name containing balanced parentheses', t => {
  const result = check(t, '[示例](guide(v2).md)\n', { 'guide(v2).md': '# 示例\n' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^1 relative links checked/);
});

test('ignores a nested fenced example but still reports the link that follows it', t => {
  const result = check(t, [
    '- 示例', '', '    ```markdown', '    [详情](placeholder.md)', '    ```', '', '[详情](missing.md)'
  ].join('\n'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md:7: missing\.md \(missing target\)/);
  assert.doesNotMatch(result.stderr, /placeholder\.md/);
});

test('ignores the query when checking an existing document and its heading', t => {
  const result = check(t, '# 验证\n\n[返回](README.md?plain=1#验证)\n');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^1 relative links checked/);
});

test('rejects a missing heading in an existing document', t => {
  const result = check(t, '[现役规则](guide.md?plain=1#评分兼容与显示)\n', { 'guide.md': '# 现役规则\n' });
  assert.equal(result.status, 1);
  assert.match(decodeURI(result.stderr), /guide\.md\?plain=1#评分兼容与显示 \(missing heading\)/);
});

test('accepts anchors for both levels of Setext headings', t => {
  const result = check(t, '[运行](guide.md#运行) [验证](guide.md#验证)\n', {
    'guide.md': '运行\n===\n\n验证\n---\n'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^2 relative links checked/);
});

test('uses the visible heading label, not the link destination, for the anchor', t => {
  const result = check(t, '[验证](guide.md#验证)\n', {
    'guide.md': '## [验证](README.md)\n'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^2 relative links checked/);
});

test('accepts the GitHub suffix for a duplicate heading but rejects nonexistent duplicates', t => {
  const files = { 'guide.md': '# 验证\n\n验证\n---\n' };
  const valid = check(t, '[第一节](guide.md#验证) [第二节](guide.md#验证-1)\n', files);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /^2 relative links checked/);

  const invalid = check(t, '[第三节](guide.md#验证-2)\n', files);
  assert.equal(invalid.status, 1);
  assert.match(decodeURI(invalid.stderr), /guide\.md#验证-2 \(missing heading\)/);
});
