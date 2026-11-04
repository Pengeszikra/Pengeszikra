import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { animateSvg, readThreads, readPosts, renderLatest, replaceBlock, START, END } from '../scripts/postmap.mjs';

const svg = await readFile(new URL('../assets/mindmap.svg', import.meta.url), 'utf8');
const articles = JSON.parse(await readFile(new URL('../data/articles.json', import.meta.url), 'utf8'));

test('reads every thread hub and post card from the map', () => {
  const threads = readThreads(svg);
  assert.ok(threads.length >= 2);
  const posts = readPosts(svg);
  assert.equal(posts.size, (svg.match(/<rect class="c"/g) || []).length);
  for (const p of posts.values()) assert.ok(p.thread);
});

test('animated SVG keeps every link and card, and has a reduced-motion fallback', () => {
  const out = animateSvg(svg);
  assert.equal((out.match(/<a /g) || []).length, (svg.match(/<a /g) || []).length);
  assert.equal((out.match(/<rect class="c"/g) || []).length, (svg.match(/<rect class="c"/g) || []).length);
  assert.ok(out.includes('prefers-reduced-motion: no-preference'));
  assert.ok(!out.includes('<metadata>'));
  assert.ok(!/<script/i.test(out));
});

test('latest block lists the newest posts, newest first, with links', () => {
  const block = renderLatest(articles, readPosts(svg), { latest: 5 });
  assert.ok(block.startsWith(START) && block.endsWith(END));
  assert.equal((block.match(/<details>/g) || []).length, 5);
  const dates = [...block.matchAll(/<code>(\d{4}-\d{2}-\d{2})<\/code>/g)].map(m => m[1]);
  assert.deepEqual(dates, [...dates].sort().reverse());
  const newest = [...articles].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  assert.ok(block.includes(newest.url));
});

test('block replacement keeps handwritten content, is idempotent, and refuses bad markers', () => {
  const block = `${START}\nnew\n${END}`;
  const before = `intro\n${START}\nold\n${END}\noutro`;
  const after = replaceBlock(before, block);
  assert.equal(after, `intro\n${block}\noutro`);
  assert.equal(replaceBlock(after, block), after);
  for (const bad of ['nothing', `${END}${START}`, `${START}${START}${END}`]) assert.throws(() => replaceBlock(bad, block));
});

import { linkArticles, extractMentions } from '../scripts/links.mjs';
import { renderCode } from '../scripts/postmap.mjs';

test('links only my own repos and packages, by link, install line, or package repository', () => {
  const arts = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const bodies = {
    1: 'See https://github.com/Pengeszikra/TypeScript and https://github.com/microsoft/TypeScript',
    2: '```sh\nnpm i -D jsdoc-duck@1.2.0\nnpm install react\n```',
    3: 'nothing here, just https://www.npmjs.com/package/left-pad',
  };
  const repos = [{ name: 'TypeScript' }, { name: 'jsdoc-duck' }];
  const packages = [{ name: 'jsdoc-duck', repo: 'jsdoc-duck' }, { name: 'ts-pipe', repo: 'TypeScript' }];
  const mentions = Object.fromEntries(Object.entries(bodies).map(([id, b]) => [id, extractMentions(b)]));
  assert.deepEqual(linkArticles(arts, mentions, repos, packages), {
    1: { url: undefined, title: undefined, repos: ['TypeScript'], packages: ['ts-pipe'] },
    2: { url: undefined, title: undefined, repos: [], packages: ['jsdoc-duck'] },
  });
});

test('code section groups by thread and lists unmentioned npm packages', () => {
  const posts = readPosts(svg);
  const [url, info] = [...posts.entries()][1];
  const arts = [{ id: 7, title: 'T', url, publishedAt: '2026-01-01' }];
  const code = {
    repos: [{ name: 'r1', url: 'https://github.com/Pengeszikra/r1', description: 'd' }],
    packages: [{ name: 'p1', repo: 'r1' }, { name: 'lonely' }],
    links: { 7: { repos: ['r1'], packages: ['p1'] } },
  };
  const out = renderCode(arts, posts, code);
  assert.ok(out.includes(info.thread.replace(/&/g, '&amp;').replace(/>/g, '&gt;')));
  assert.ok(out.includes('More on npm') && out.includes('lonely') && out.includes('p1'));
  assert.equal(renderCode(arts, posts, null), '');
});

import { foldPackages } from '../scripts/postmap.mjs';
test('platform builds fold into their main package', () => {
  const all = ['@p/ts', '@p/ts-linux-x64', '@p/ts-win32-arm64', 'solo-linux-x64'].map(name => ({ name }));
  assert.deepEqual(foldPackages(all.map(p => p.name), all), [{ name: '@p/ts', builds: 2 }, { name: 'solo-linux-x64', builds: 0 }]);
});
