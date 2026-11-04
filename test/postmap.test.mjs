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
