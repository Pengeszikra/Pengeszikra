#!/usr/bin/env node
// Builds the profile's post-map block:
//   1. assets/postmap-animated.svg: the static map from Pengeszikra/devto-post-map with CSS animation
//   2. a README block between POSTMAP:START / POSTMAP:END: the animated map, linked to the live app,
//      plus the newest dev.to posts as expandable <details> entries.
//
//   node scripts/postmap.mjs            # fetch the map SVG and the dev.to API
//   node scripts/postmap.mjs --offline  # use assets/mindmap.svg and data/articles.json
import { readFile, writeFile } from 'node:fs/promises';

export const START = '<!-- POSTMAP:START -->';
export const END = '<!-- POSTMAP:END -->';

export const CONFIG = {
  username: 'pengeszikra',
  appUrl: 'https://devto-post-map.vercel.app/',
  svgUrl: 'https://raw.githubusercontent.com/Pengeszikra/devto-post-map/main/mindmap.svg',
  latest: 8,
};

const root = new URL('../', import.meta.url);
const SOURCE_SVG = new URL('assets/mindmap.svg', root);
const ANIMATED_SVG = new URL('assets/postmap-animated.svg', root);
const README = new URL('README.md', root);
const CACHE = new URL('data/articles.json', root);

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
const cleanUrl = u => String(u || '').replace(/[?#].*$/, '').replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Map structure: the eight thread hubs and which thread each post card belongs to

export function readThreads(svg) {
  const threads = [];
  for (const m of svg.matchAll(/<g><title>([^<]*)<\/title><rect ([^>]*)><\/rect><text [^>]*>([^<]*)<\/text>/g)) {
    threads.push({ description: unesc(m[1]), color: attr(' ' + m[2], 'stroke'), name: unesc(m[3]) });
  }
  if (threads.length < 2) throw new Error('No thread hubs found in the map SVG — has its format changed?');
  return threads;
}

export function readPosts(svg) {
  const threads = readThreads(svg);
  const byColor = new Map(threads.map((t, i) => [t.color, i]));
  const posts = new Map();
  for (const m of svg.matchAll(/<a href="([^"]+)"[^>]*><title>([^<]*)<\/title><rect class="c" ([^>]*)>/g)) {
    const thread = byColor.get(attr(' ' + m[3], 'stroke'));
    posts.set(cleanUrl(m[1]), { title: unesc(m[2]), thread: thread === undefined ? 'root of the map' : threads[thread].name });
  }
  return posts;
}

// ---------------------------------------------------------------------------
// Animation: branches draw out from the root, hubs and cards fade in, then a slow
// spotlight walks through the threads one by one. All motion sits behind
// prefers-reduced-motion, so the static picture is the fallback.

const STEP = 3; // seconds the spotlight stays on each thread

function style(threadCount) {
  const cycle = threadCount * STEP;
  const on = (100 * 0.15) / threadCount, hold = (100 * 0.75) / threadCount, off = (100 * 1) / threadCount;
  const spot = props => `@keyframes ${props.name}{0%,${off.toFixed(2)}%,100%{}${on.toFixed(2)}%,${hold.toFixed(2)}%{${props.css}}}`;
  return `<style>
@media (prefers-reduced-motion: no-preference) {
  .b{stroke-dasharray:1;stroke-dashoffset:1;animation:draw .8s ease-out var(--d) forwards,bspot ${cycle}s ease-in-out var(--s) infinite}
  .e{animation:fade 1.2s ease-out var(--d) both}
  .h{animation:fade .6s ease-out var(--d) both}
  .h rect{animation:hspot ${cycle}s ease-in-out var(--s) infinite}
  .k{animation:rise .5s ease-out var(--d) both}
  .k rect.c{animation:kspot ${cycle}s ease-in-out var(--s) infinite}
  .r{transform-box:fill-box;transform-origin:center;animation:pop .7s cubic-bezier(.2,.9,.3,1.2) .1s both}
  .r rect.c{animation:breathe 6s ease-in-out 2s infinite}
  .hint{animation:fade 1s ease-out 4.5s both,blink 4s ease-in-out 6s infinite}
  @keyframes draw{to{stroke-dashoffset:0}}
  @keyframes fade{from{opacity:0}}
  @keyframes rise{from{opacity:0;transform:translateY(6px)}}
  @keyframes pop{from{opacity:0;transform:scale(.8)}}
  @keyframes breathe{50%{stroke-opacity:1}}
  @keyframes blink{50%{opacity:.45}}
  ${spot({ name: 'bspot', css: 'opacity:1' })}
  ${spot({ name: 'hspot', css: 'stroke-width:3.5;fill:#2b241c' })}
  ${spot({ name: 'kspot', css: 'stroke-opacity:1;fill:#2b241c' })}
}
</style>`;
}

export function animateSvg(svg) {
  const threads = readThreads(svg);
  const byColor = new Map(threads.map((t, i) => [t.color, i]));
  const spotDelay = i => `${(5 + i * STEP).toFixed(1)}s`;
  const counters = new Map();
  const nextIn = key => { const n = counters.get(key) || 0; counters.set(key, n + 1); return n; };
  let hubIndex = 0, edgeIndex = 0;

  let out = svg
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')
    .replace(/\s+xmlns:c2pa="[^"]*"/, '');

  // connection lines (they carry a <title>) and tree branches (no <title>)
  out = out.replace(/<path ([^>]*)>(<title>)?/g, (whole, attrs, title) => {
    if (title) {
      const d = (3.2 + edgeIndex++ * 0.015).toFixed(2);
      return `<path class="e" style="--d:${d}s" ${attrs}>${title}`;
    }
    const t = byColor.get(attr(' ' + attrs, 'stroke'));
    if (t === undefined) return whole;
    const trunk = attr(' ' + attrs, 'stroke-width') === '2.2';
    const d = trunk ? 0.5 + t * 0.08 : 1.1 + t * 0.12 + nextIn('b' + t) * 0.04;
    return `<path class="b" pathLength="1" style="--d:${d.toFixed(2)}s;--s:${spotDelay(t)}" ${attrs}>`;
  });

  // thread hubs
  out = out.replace(/<g><title>/g, () => {
    const i = hubIndex++;
    return `<g class="h" style="--d:${(0.9 + i * 0.1).toFixed(2)}s;--s:${spotDelay(i)}"><title>`;
  });

  // post cards and the root card
  out = out.replace(/<a ([^>]*)><title>([^<]*)<\/title><rect class="c" ([^>]*)>/g, (whole, a, title, rect) => {
    const t = byColor.get(attr(' ' + rect, 'stroke'));
    const head = t === undefined
      ? `<a class="r" ${a}>`
      : `<a class="k" style="--d:${(1.4 + t * 0.12 + nextIn('k' + t) * 0.06).toFixed(2)}s;--s:${spotDelay(t)}" ${a}>`;
    return `${head}<title>${title}</title><rect class="c" ${rect}>`;
  });

  // on GitHub the picture is one link, so the footer points to the interactive version
  out = out.replace(/(<text [^>]*>)Click a post to open it on dev\.to[^<]*(<\/text>)/,
    (_, open, close) => `${open.replace('<text ', '<text class="hint" ')}Click the map to open the interactive version → devto-post-map.vercel.app${close}`);

  return out.replace(/(<svg [^>]*>)/, `$1\n${style(threads.length)}`);
}

// ---------------------------------------------------------------------------
// README block

const dateOf = iso => String(iso).slice(0, 10);

export function renderLatest(articles, posts, { latest = CONFIG.latest, username = CONFIG.username, appUrl = CONFIG.appUrl } = {}) {
  const newest = [...articles].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, latest);
  const items = newest.map(a => {
    const known = posts.get(cleanUrl(a.url));
    const thread = known?.thread ? ` · <sub>${esc(known.thread)}</sub>` : ' · <sub>new — not on the map yet</sub>';
    const meta = [
      a.readingTime ? `${a.readingTime} min read` : '',
      Number.isFinite(a.reactions) ? `♡ ${a.reactions}` : '',
      a.tags?.length ? a.tags.map(t => `#${esc(t)}`).join(' ') : '',
    ].filter(Boolean).join(' · ');
    const cover = a.coverImage
      ? `<a href="${esc(a.url)}"><img src="${esc(a.coverImage)}" alt="" width="420"></a><br>\n`
      : '';
    const description = a.description ? `${esc(a.description.replace(/\s+/g, ' ').trim())}<br>\n` : '';
    return `<details>
<summary><code>${dateOf(a.publishedAt)}</code> <b>${esc(a.title)}</b>${thread}</summary>
<br>
${cover}${description}<sub>${meta}</sub><br>
<a href="${esc(a.url)}">Read on dev.to →</a>
<br><br>
</details>`;
  });

  return `${START}
<!-- Generated by scripts/postmap.mjs — edit outside this block. -->
<a href="${appUrl}"><img src="assets/postmap-animated.svg" alt="Mind map of my dev.to posts: thematic threads and why the posts connect. Click to open the interactive version." width="100%"></a>

<details open>
<summary><b>📰 Latest on dev.to</b> — the ${newest.length} newest posts, click one for the gist</summary>
<br>

${items.join('\n\n')}

<sub>All posts: <a href="${appUrl}">interactive map</a> · <a href="https://dev.to/${username}">dev.to/${username}</a></sub>
</details>
${END}`;
}

export function replaceBlock(readme, block) {
  const s = readme.indexOf(START), e = readme.indexOf(END);
  if (s === -1 && e === -1) throw new Error(`README has no ${START} … ${END} block`);
  if (s === -1 || e === -1 || e < s || readme.indexOf(START, s + 1) !== -1 || readme.indexOf(END, e + 1) !== -1) {
    throw new Error('README POSTMAP markers are malformed; nothing was changed');
  }
  return readme.slice(0, s) + block + readme.slice(e + END.length);
}

// ---------------------------------------------------------------------------
// I/O

async function request(url, accept) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Pengeszikra-profile-postmap', Accept: accept }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res;
}

async function fetchArticles(username) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await (await request(`https://dev.to/api/articles?username=${encodeURIComponent(username)}&per_page=100&page=${page}`, 'application/json')).json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.map(a => ({
    id: a.id, title: a.title, url: a.url, publishedAt: a.published_at, description: a.description,
    coverImage: a.cover_image, tags: a.tag_list, reactions: a.public_reactions_count, readingTime: a.reading_time_minutes,
  }));
}

async function main() {
  const offline = process.argv.includes('--offline');
  const svg = offline ? await readFile(SOURCE_SVG, 'utf8') : await (await request(CONFIG.svgUrl, 'image/svg+xml')).text();
  const articles = offline ? JSON.parse(await readFile(CACHE, 'utf8')) : await fetchArticles(CONFIG.username);
  if (!articles.length) throw new Error('No articles returned; README left unchanged');

  const animated = animateSvg(svg);
  const readme = replaceBlock(await readFile(README, 'utf8'), renderLatest(articles, readPosts(svg)));

  if (!offline) await writeFile(SOURCE_SVG, svg);
  await writeFile(ANIMATED_SVG, animated);
  await writeFile(README, readme);
  console.log(`postmap: ${readThreads(svg).length} threads, ${readPosts(svg).size} mapped posts, ${articles.length} articles`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`postmap: ${err.message}`); process.exit(1); });
}
