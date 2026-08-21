/**
 * This lint-style check protects design-system discipline, not runtime behavior.
 * Browser behavior is covered separately by the Playwright suite.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const styleBlock = html.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? '';
const rootBlock = styleBlock.match(/:root\s*\{[\s\S]*?\}/)?.[0] ?? '';
const componentStyles = styleBlock.replace(rootBlock, '');
const failures = [];

if (/transition\s*:\s*all\b/i.test(styleBlock)) {
  failures.push('Use explicit transition properties instead of transition: all.');
}
if (/#[0-9a-f]{3,8}\b/i.test(componentStyles)) {
  failures.push('Hex colors must be declared as :root tokens.');
}
if (/\sstyle\s*=/i.test(html)) {
  failures.push('Inline style attributes are not allowed.');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Design discipline checks passed.');
}
