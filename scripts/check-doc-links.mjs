import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import GithubSlugger from 'github-slugger';
import MarkdownIt from 'markdown-it';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trimEnd();
const files = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean);
const documents = new Map();
const markdown = new MarkdownIt('commonmark');

function readMarkdown(path) {
  if (!documents.has(path)) {
    const tokens = markdown.parse(readFileSync(path, 'utf8'), {});
    const slugger = new GithubSlugger();
    const headings = new Set();
    tokens.forEach((token, index) => {
      if (token.type !== 'heading_open') return;
      const text = tokens[index + 1].children.map(child => {
        if (child.type === 'text' || child.type === 'code_inline') return child.content;
        return child.type === 'softbreak' || child.type === 'hardbreak' ? ' ' : '';
      }).join('');
      headings.add(slugger.slug(text));
    });
    documents.set(path, { tokens, headings });
  }
  return documents.get(path);
}

let checked = 0;
for (const file of files) {
  const source = resolve(root, file);
  if (!existsSync(source)) continue; // A tracked document may be deleted in the working tree.
  for (const token of readMarkdown(source).tokens) {
    if (token.type !== 'inline') continue;
    for (const child of token.children) {
      const url = child.type === 'link_open' ? child.attrGet('href')
        : child.type === 'image' ? child.attrGet('src') : null;
      if (!url || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(url)) continue;
      checked++;
      try {
        const hash = url.indexOf('#');
        const resource = hash === -1 ? url : url.slice(0, hash);
        const targetPath = decodeURIComponent(resource.split('?', 1)[0]);
        const fragment = hash === -1 ? '' : decodeURIComponent(url.slice(hash + 1));
        const target = targetPath ? resolve(dirname(source), targetPath) : source;
        if (!existsSync(target)) throw new Error('missing target');
        if (fragment && extname(target) === '.md' && !readMarkdown(target).headings.has(fragment)) {
          throw new Error('missing heading');
        }
      } catch (error) {
        // Markdown-it provides the source line of the containing inline block.
        console.error(`${file}:${token.map[0] + 1}: ${url} (${error.message})`);
        process.exitCode = 1;
      }
    }
  }
}
if (!process.exitCode) console.log(`${checked} relative links checked across ${files.length} Markdown files.`);
