import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { render, replaceSection, detectRepositoryLinks, START, END } from '../scripts/update.mjs';

const config = JSON.parse(await readFile(new URL('../connections.json', import.meta.url)));
const articles = JSON.parse(await readFile(new URL('../data/articles.json', import.meta.url)));

test('regeneration preserves handwritten content and is idempotent', () => {
  const before = `My introduction\n${START}\nold content\n${END}\nMy contact links`;
  const generated = render(config, articles);
  const after = replaceSection(before, generated);
  assert.ok(after.startsWith('My introduction\n'));
  assert.ok(after.endsWith('\nMy contact links'));
  assert.equal(replaceSection(after, generated), after);
});

test('malformed markers stop the update instead of replacing unrelated content', () => {
  for (const input of ['no markers', `${END}${START}`, `${START}${START}${END}`]) assert.throws(() => replaceSection(input, 'new'));
});

test('every mapped article, repo and local cover is reachable', async () => {
  const text = render(config, articles);
  for (const node of config.nodes) {
    const url = node.repo || articles.find(a => a.id === node.articleId).url;
    assert.ok(text.includes(url), `Missing link: ${url}`);
  }
  for (const article of articles.filter(a => a.localImage)) {
    await access(new URL('../' + article.localImage, import.meta.url));
    assert.ok(text.includes(article.localImage));
  }
});

test('metadata and summaries are HTML-escaped', () => {
  const edited = structuredClone(articles);
  edited.find(a => a.id === config.nodes[0].articleId).title = '<img src=x onerror="alert(1)">';
  const text = render(config, edited);
  assert.ok(text.includes('&lt;img'));
  assert.ok(!text.includes('<img src=x'));
});

test('repository extraction only suggests own repositories and never invents edges', () => {
  const body = 'https://github.com/Pengeszikra/TypeScript/issues/1 https://github.com/pengeszikra/TypeScript https://github.com/microsoft/TypeScript';
  assert.deepEqual(detectRepositoryLinks(body, 'Pengeszikra'), ['https://github.com/Pengeszikra/TypeScript']);
});

test('missing curated articles or broken edges fail before publication', () => {
  assert.throws(() => render(config, []), /Missing article/);
  const broken = structuredClone(config);
  broken.edges[0].to = 'missing';
  assert.throws(() => render(broken, articles), /Invalid edge/);
});
