import { readFile, writeFile, mkdir, access, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const START = '<!-- THOUGHT-TREE:START -->';
export const END = '<!-- THOUGHT-TREE:END -->';
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const httpsUrl = value => { const url = new URL(value); if (url.protocol !== 'https:') throw Error('Expected HTTPS URL'); return url.href; };
const link = (url, text) => `<a href="${escapeHtml(httpsUrl(url))}">${escapeHtml(text)}</a>`;
const mermaidText = text => String(text).replace(/&/g, '#38;').replace(/"/g, '#34;').replace(/</g, '#60;').replace(/>/g, '#62;').replace(/[\r\n]/g, ' ');
const readJson = async path => JSON.parse(await readFile(join(root, path), 'utf8'));

export function replaceSection(readme, generated) {
  if (readme.split(START).length !== 2 || readme.split(END).length !== 2 || readme.indexOf(END) < readme.indexOf(START)) throw Error('README must contain exactly one ordered marker pair');
  return readme.slice(0, readme.indexOf(START) + START.length) + '\n\n' + generated.trim() + '\n\n' + readme.slice(readme.indexOf(END));
}

export function validate(config, articles) {
  const ids = new Set();
  for (const node of config.nodes) {
    if (!/^[a-z][a-z0-9_]*$/.test(node.id) || ids.has(node.id)) throw Error(`Invalid or duplicate node: ${node.id}`);
    ids.add(node.id);
    if (node.articleId && !articles.some(a => a.id === node.articleId)) throw Error(`Missing article: ${node.articleId}`);
    if (node.repo) httpsUrl(node.repo);
    if (node.articleId && (!node.summary || !node.label)) throw Error(`Missing editorial text: ${node.id}`);
  }
  for (const edge of config.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || !edge.reason) throw Error('Invalid edge or missing rationale');
  }
  for (const branch of config.branches) {
    for (const id of branch.nodes) if (!ids.has(id)) throw Error(`Unknown branch node: ${id}`);
  }
}

export function detectRepositoryLinks(body, username) {
  const links = [...body.matchAll(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/gi)];
  return [...new Set(links.filter(m => m[1].toLowerCase() === username.toLowerCase()).map(m => `https://github.com/${username}/${m[2].replace(/\.git$/, '')}`))].sort();
}

function diagram(config, branch) {
  const nodes = branch.nodes.map(id => config.nodes.find(n => n.id === id));
  const edges = config.edges.filter(e => branch.nodes.includes(e.from) && branch.nodes.includes(e.to));
  if (edges.length < 3) return '';
  return ['```mermaid', 'flowchart TD', ...nodes.map(n => `    ${n.id}${n.repo ? '(["' : '["'}${mermaidText(n.label)}${n.repo ? '"])' : '"]'}`), ...edges.map(e => `    ${e.from} ${e.kind === 'related' ? '-.->' : '-->'}|"${mermaidText(e.label)}"| ${e.to}`), '```', ''].join('\n');
}

function card(article, node, config, articles) {
  const summary = node?.summary || (/[_=─]{8,}/.test(article.description) ? '' : article.description);
  const image = article.localImage ? `<a href="${escapeHtml(httpsUrl(article.url))}"><img src="${escapeHtml(article.localImage)}" alt="${escapeHtml(article.title)} — article cover" width="280"></a>` : '';
  const related = node ? config.edges.filter(e => e.from === node.id || e.to === node.id).map(e => {
    const outward = e.from === node.id;
    const other = config.nodes.find(n => n.id === (outward ? e.to : e.from));
    const url = other.repo || articles.find(a => a.id === other.articleId)?.url;
    return url ? `${escapeHtml(outward ? e.label : e.reverseLabel || 'Connected to')}: ${link(url, other.label)}` : '';
  }).filter(Boolean) : [];
  return `<tr>\n<td width="290" valign="top">${image}</td>\n<td valign="top"><sub>${escapeHtml(article.publishedAt.slice(0, 10))}</sub><br><strong>${link(article.url, article.title)}</strong>${summary ? `<p>${escapeHtml(summary)}</p>` : ''}${related.join('<br>')}<p>${link(article.url, 'Read on DEV →')}</p></td>\n</tr>`;
}

export function render(config, articles) {
  validate(config, articles);
  const used = new Set(config.nodes.filter(n => n.articleId).map(n => n.articleId));
  const output = ['## Ideas → experiments → code', '', 'Follow the connections between my articles and the projects they became. Dates show when I wrote them; the branches show how the ideas connect.', '', 'Rectangles are articles; rounded nodes are repositories. Solid arrows follow a continuation or implementation. Dotted arrows mark a related theme.', ''];
  for (const branch of config.branches) {
    output.push(`### ${branch.title}`, '', branch.description, '', diagram(config, branch));
    const nodes = branch.nodes.map(id => config.nodes.find(n => n.id === id)).filter(n => n.articleId).sort((a,b) => articles.find(x => x.id === a.articleId).publishedAt.localeCompare(articles.find(x => x.id === b.articleId).publishedAt));
    output.push('<table>', ...nodes.map(n => card(articles.find(a => a.id === n.articleId), n, config, articles)), '</table>', '');
    const repos = branch.nodes.map(id => config.nodes.find(n => n.id === id)).filter(n => n.repo);
    if (repos.length) output.push('**Explore the code:** ' + repos.map(n => `[${n.label}](${n.repo})`).join(' · '), '');
  }
  const inbox = articles.filter(a => !used.has(a.id)).slice(0, config.inboxLimit);
  if (inbox.length) output.push('### More from my notebook', '', 'Recent articles waiting for a place on the map.', '', '<table>', ...inbox.map(a => card(a, null, config, articles)), '</table>', '');
  output.push(`[All ${articles.length} articles on DEV](https://dev.to/${config.username})`, '', '<sub>Article images are copied from their original DEV posts. The map, article metadata and covers are maintained manually.</sub>', '');
  return output.join('\n');
}

async function request(url, binary = false) {
  httpsUrl(url);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': 'Pengeszikra-profile-thought-tree', Accept: binary ? 'image/png,image/jpeg,image/webp,image/gif' : 'application/json' }, signal: AbortSignal.timeout(30000) });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
    return binary ? { bytes: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type')?.split(';')[0] } : response.json();
  }
}

export async function main(offline = process.argv.includes('--offline')) {
  const config = await readJson('connections.json');
  const old = await readJson('data/articles.json').catch(() => []);
  let articles = old;
  const pendingImages = [];
  if (!offline) {
    const collected = [];
    for (let page = 1; ; page++) {
      const batch = await request(`https://dev.to/api/articles?username=${encodeURIComponent(config.username)}&per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw Error('Invalid article list');
      collected.push(...batch);
      if (batch.length < 100) break;
      if (page >= 100) throw Error('Unexpected pagination size');
    }
    if (!collected.length) throw Error('Empty DEV response; preserving existing profile');
    articles = collected.map(a => ({ id:a.id, title:a.title, url:httpsUrl(a.url), publishedAt:a.published_at, description:a.description || '', coverImage:a.cover_image || null, tags:a.tag_list || [] })).sort((a,b) => b.publishedAt.localeCompare(a.publishedAt) || b.id-a.id);
    const selected = new Set(config.nodes.filter(n => n.articleId).map(n => n.articleId));
    for (const article of articles.filter(a => selected.has(a.id))) {
      const detail = await request(`https://dev.to/api/articles/${article.id}`);
      article.detectedRepos = detectRepositoryLinks(detail.body_markdown || '', config.githubOwner);
      if (!article.coverImage) article.coverImage = (detail.body_markdown || '').match(/!\[[^\]]*\]\((https:\/\/[^\s)]+)/)?.[1] || null;
      await new Promise(r => setTimeout(r, 250));
    }
    const visible = [...articles.filter(a => selected.has(a.id)), ...articles.filter(a => !selected.has(a.id)).slice(0, config.inboxLimit)];
    for (const article of visible) {
      if (!article.coverImage) continue;
      const previous = old.find(a => a.id === article.id);
      if (previous?.coverImage === article.coverImage && previous.localImage && await access(join(root, previous.localImage)).then(() => true, () => false)) {
        article.localImage = previous.localImage;
        continue;
      }
      const { bytes, type } = await request(article.coverImage, true);
      const ext = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/gif':'gif' }[type];
      if (!ext || bytes.length > 10 * 1024 * 1024) throw Error(`Unsupported or oversized cover for ${article.id}`);
      article.localImage = `assets/articles/${article.id}-${createHash('sha256').update(bytes).digest('hex').slice(0,12)}.${ext}`;
      pendingImages.push([article.localImage, bytes]);
    }
  }
  validate(config, articles);
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const next = replaceSection(readme, render(config, articles));
  // Fetch and validate everything before touching the published profile.
  for (const [path, bytes] of pendingImages) { await mkdir(dirname(join(root, path)), { recursive:true }); await writeFile(join(root, path), bytes); }
  for (const article of articles.filter(a => a.localImage)) await access(join(root, article.localImage));
  const writeAtomic = async (path, content) => { const target = join(root,path); await mkdir(dirname(target),{recursive:true}); await writeFile(target+'.tmp',content); await rename(target+'.tmp',target); };
  await writeAtomic('data/articles.json', JSON.stringify(articles,null,2)+'\n');
  await writeAtomic('README.md', next);
  console.log(`Rendered ${config.nodes.filter(n => n.articleId).length} mapped articles from ${articles.length} DEV posts.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
