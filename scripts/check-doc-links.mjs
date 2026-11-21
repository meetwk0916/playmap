import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean);
const documents = new Map();

function readMarkdown(path) {
  if (documents.has(path)) return documents.get(path);
  let fence = '';
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence && marker) {
      fence = marker[1];
      return '';
    }
    if (!fence) return line;
    if (marker?.[1].startsWith(fence) && !marker[2].trim()) fence = '';
    return '';
  });
  documents.set(path, lines);
  return lines;
}

function headingIds(path) {
  const ids = new Set();
  for (const line of readMarkdown(path)) {
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
    if (!heading) continue;
    const base = heading[1].toLowerCase().replace(/ /g, '-').replace(/[^\p{L}\p{N}\p{M}_-]/gu, '');
    let id = base;
    for (let suffix = 1; ids.has(id); suffix++) id = `${base}-${suffix}`;
    ids.add(id);
  }
  return ids;
}

let checked = 0;
for (const file of files) {
  const source = resolve(root, file);
  if (!existsSync(source)) continue; // A tracked document may be deleted in the working tree.
  readMarkdown(source).forEach((line, index) => {
    const prose = line.replace(/(`+).*?\1/g, '');
    for (const [, enclosed, bare] of prose.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
      const raw = enclosed ?? bare;
      if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(raw)) continue;
      checked++;
      try {
        const [targetPath, fragment] = raw.split('#', 2).map(decodeURIComponent);
        const target = targetPath ? resolve(dirname(source), targetPath) : source;
        if (!existsSync(target)) throw new Error('missing target');
        if (fragment && extname(target) === '.md' && !headingIds(target).has(fragment)) {
          throw new Error('missing heading');
        }
      } catch (error) {
        console.error(`${file}:${index + 1}: ${raw} (${error.message})`);
        process.exitCode = 1;
      }
    }
  });
}
if (!process.exitCode) console.log(`${checked} relative links checked across ${files.length} Markdown files.`);
