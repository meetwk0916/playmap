import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trimEnd();
const files = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean);
const documents = new Map();
const parserOptions = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] };

function* walk(node) {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

function headingText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'break') return ' ';
  return (node.children ?? []).map(headingText).join('');
}

function readMarkdown(path) {
  if (!documents.has(path)) {
    const tree = fromMarkdown(readFileSync(path, 'utf8'), parserOptions);
    const slugger = new GithubSlugger();
    const headings = new Set();
    const definitions = new Map();
    const links = [];
    for (const node of walk(tree)) {
      if (node.type === 'heading') headings.add(slugger.slug(headingText(node).replace(/\n/g, ' ')));
      if (node.type === 'definition' && !definitions.has(node.identifier)) {
        definitions.set(node.identifier, node.url);
      }
      if (['link', 'image', 'linkReference', 'imageReference'].includes(node.type)) links.push(node);
    }
    documents.set(path, { links, definitions, headings });
  }
  return documents.get(path);
}

let checked = 0;
for (const file of files) {
  const source = resolve(root, file);
  if (!existsSync(source)) continue; // A tracked document may be deleted in the working tree.
  const { links, definitions } = readMarkdown(source);
  for (const link of links) {
    const url = (link.url ?? definitions.get(link.identifier))?.replace(/%(?![\da-f]{2})/gi, '%25');
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
      console.error(`${file}:${link.position.start.line}: ${url} (${error.message})`);
      process.exitCode = 1;
    }
  }
}
if (!process.exitCode) console.log(`${checked} relative links checked across ${files.length} Markdown files.`);
