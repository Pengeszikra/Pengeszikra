// Adds two outer columns to the post map: GitHub repos, then npm packages, on whichever side
// most of the posts that point to them sit. Lines join post → repo, repo → package it publishes,
// and post → package when the post names the package without linking its repo.
import { foldPackages } from './postmap.mjs';

const MONO = 'ui-monospace,Menlo,Consolas,monospace';
const SANS = "'IBM Plex Sans Condensed','Arial Narrow',system-ui,sans-serif";
const CARD_W = 210, CARD_H = 36, GAP = 8;
const COL_GAP = 120;       // from the post cards' outer edge to the repo column
const NPM_GAP = 60;        // between the repo column and the npm column
const REPO = { stroke: '#9aa4b1', pill: '#3a4048', label: 'repo' };
const NPM = { stroke: '#e0605a', pill: '#cb3837', label: 'npm' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
const num = (tag, name) => Number(attr(tag, name));
const cleanUrl = u => String(u || '').replace(/[?#].*$/, '').replace(/\/$/, '');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function readCards(svg) {
  const cards = new Map();
  for (const m of svg.matchAll(/<a href="([^"]+)"[^>]*><title>[^<]*<\/title><rect class="c" ([^>]*)>/g)) {
    const r = ' ' + m[2];
    const x = num(r, 'x'), y = num(r, 'y'), w = num(r, 'width'), h = num(r, 'height');
    cards.set(cleanUrl(m[1]), { x, y, w, h, cy: y + h / 2, color: attr(r, 'stroke') });
  }
  return cards;
}

// Put boxes as close to their wanted y as possible without overlapping.
function stack(items, top) {
  items.sort((a, b) => a.want - b.want);
  let prev = top - Infinity;
  for (const it of items) { it.y = Math.max(it.want - CARD_H / 2, prev + GAP); prev = it.y + CARD_H; }
  return items;
}

const curve = (x1, y1, x2, y2) => {
  const dx = (x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
};

function card(kind, item, x, side, i) {
  const k = kind === 'repo' ? REPO : NPM;
  const pillX = side === 'right' ? x + 8 : x + CARD_W - 8 - 30;
  const textX = side === 'right' ? x + 46 : x + CARD_W - 46;
  const anchor = side === 'right' ? 'start' : 'end';
  const d = (2.4 + i * 0.05).toFixed(2);
  return `<a class="x" style="--d:${d}s" href="${esc(item.url)}" target="_blank"><title>${esc(item.tip)}</title>`
    + `<rect class="cc" x="${x}" y="${item.y}" width="${CARD_W}" height="${CARD_H}" rx="6" fill="#16191d" stroke="${k.stroke}" stroke-opacity="0.55"></rect>`
    + `<rect x="${pillX}" y="${item.y + 11}" width="30" height="14" rx="3" fill="${k.pill}"></rect>`
    + `<text x="${pillX + 15}" y="${item.y + 21.5}" fill="#fff" font-size="9" font-weight="600" text-anchor="middle" font-family="${MONO}">${k.label}</text>`
    + `<text x="${textX}" y="${item.y + 16}" fill="#efe7d9" font-size="13" font-weight="500" text-anchor="${anchor}" font-family="${SANS}">${esc(clip(item.name, 23))}</text>`
    + `<text x="${textX}" y="${item.y + 29}" fill="#a49d94" font-size="10" text-anchor="${anchor}" font-family="${MONO}">${esc(clip(item.meta, 24))}</text></a>`;
}

export function addCodeColumns(svg, code) {
  if (!code?.links || !Object.keys(code.links).length) return svg;
  const cards = readCards(svg);
  const xs = [...cards.values()].map(c => c.x);
  const mid = (Math.min(...xs) + Math.max(...[...cards.values()].map(c => c.x + c.w))) / 2;
  const sideOf = c => (c.x + c.w / 2 < mid ? 'left' : 'right');
  const leftEdge = Math.min(...xs);
  const rightEdge = Math.max(...[...cards.values()].map(c => c.x + c.w));

  // posts on the map that point to code (the root card has no thread colour: skipped)
  const threadColors = new Set([...svg.matchAll(/<g><title>[^<]*<\/title><rect [^>]*stroke="([^"]+)"/g)].map(m => m[1]));
  const posts = Object.values(code.links)
    .map(l => ({ ...l, card: cards.get(cleanUrl(l.url)) }))
    .filter(p => p.card && threadColors.has(p.card.color));

  const repoInfo = name => code.repos.find(r => r.name === name) || { name, url: `https://github.com/Pengeszikra/${name}` };
  const pkgInfo = name => code.packages.find(p => p.name === name) || { name };

  const repos = new Map(), pkgs = new Map();
  for (const p of posts) {
    for (const r of p.repos) {
      if (!repos.has(r)) repos.set(r, { name: r, posts: [] });
      repos.get(r).posts.push(p);
    }
    for (const { name, builds } of foldPackages(p.packages, code.packages)) {
      if (!pkgs.has(name)) pkgs.set(name, { name, builds, posts: [], direct: [] });
      const e = pkgs.get(name);
      e.posts.push(p);
      const home = pkgInfo(name).repo;
      if (!home || !p.repos.some(r => r.toLowerCase() === home.toLowerCase())) e.direct.push(p);
    }
  }
  if (!repos.size && !pkgs.size) return svg;

  const majority = list => (list.filter(p => sideOf(p.card) === 'left').length > list.length / 2 ? 'left' : 'right');
  const meanY = list => list.reduce((s, p) => s + p.card.cy, 0) / list.length;

  for (const r of repos.values()) {
    const info = repoInfo(r.name);
    Object.assign(r, {
      side: majority(r.posts), want: meanY(r.posts), url: info.url,
      meta: [info.fork ? 'fork' : '', info.language, info.stars ? `★ ${info.stars}` : ''].filter(Boolean).join(' · ') || 'GitHub',
      tip: `${info.name}${info.description ? ` — ${info.description}` : ''}\n← ${[...new Set(r.posts.map(p => p.title))].join(', ')}`,
    });
  }
  for (const p of pkgs.values()) {
    const info = pkgInfo(p.name);
    const home = info.repo && [...repos.values()].find(r => r.name.toLowerCase() === info.repo.toLowerCase());
    p.home = home || null;
    p.side = home ? home.side : majority(p.posts);
    p.url = `https://www.npmjs.com/package/${p.name}`;
    p.meta = [info.version ? `v${info.version.replace(/-.*/, '')}` : '', p.builds ? `+${p.builds} builds` : ''].filter(Boolean).join(' · ') || 'npm';
    p.tip = `${p.name}${info.description ? ` — ${info.description}` : ''}\n← ${[...new Set(p.posts.map(x => x.title))].join(', ')}`;
  }

  const top = Math.min(...[...cards.values()].map(c => c.y));
  const cols = {
    left: { repo: leftEdge - COL_GAP - CARD_W, npm: leftEdge - COL_GAP - 2 * CARD_W - NPM_GAP },
    right: { repo: rightEdge + COL_GAP, npm: rightEdge + COL_GAP + CARD_W + NPM_GAP },
  };
  for (const side of ['left', 'right']) {
    stack([...repos.values()].filter(r => r.side === side), top);
    for (const p of pkgs.values()) if (p.side === side) p.want = p.home ? p.home.y + CARD_H / 2 : meanY(p.posts);
    stack([...pkgs.values()].filter(p => p.side === side), top);
  }

  // lines
  const edges = [];
  const postEdge = (post, x) => (sideOf(post.card) === 'left' ? [post.card.x, post.card.cy] : [post.card.x + post.card.w, post.card.cy]);
  const inner = (side, x) => (side === 'right' ? x : x + CARD_W);
  const outer = (side, x) => (side === 'right' ? x + CARD_W : x);
  for (const r of repos.values()) {
    const x = cols[r.side].repo;
    for (const p of r.posts) {
      const [x1, y1] = postEdge(p);
      edges.push(`<path d="${curve(x1, y1, inner(r.side, x), r.y + CARD_H / 2)}" stroke="${p.card.color}" stroke-width="1.3" opacity="0.5" fill="none"><title>${esc(p.title)} → ${esc(r.name)}: the post links this repo</title></path>`);
    }
  }
  for (const p of pkgs.values()) {
    const x = cols[p.side].npm;
    if (p.home) {
      const hx = outer(p.home.side, cols[p.home.side].repo);
      edges.push(`<path d="${curve(hx, p.home.y + CARD_H / 2, inner(p.side, x), p.y + CARD_H / 2)}" stroke="${NPM.stroke}" stroke-width="1.3" opacity="0.6" fill="none"><title>${esc(p.home.name)} → ${esc(p.name)}: published from this repo</title></path>`);
    }
    for (const post of p.direct) {
      const [x1, y1] = postEdge(post);
      edges.push(`<path d="${curve(x1, y1, inner(p.side, x), p.y + CARD_H / 2)}" stroke="${post.card.color}" stroke-width="1.3" opacity="0.5" fill="none"><title>${esc(post.title)} → ${esc(p.name)}: the post installs or links this package</title></path>`);
    }
  }

  // cards and column headings
  let i = 0;
  const boxes = [];
  for (const r of [...repos.values()].sort((a, b) => a.y - b.y)) boxes.push(card('repo', r, cols[r.side].repo, r.side, i++));
  for (const p of [...pkgs.values()].sort((a, b) => a.y - b.y)) boxes.push(card('npm', p, cols[p.side].npm, p.side, i++));
  const heads = [];
  for (const side of ['left', 'right']) {
    if ([...repos.values()].some(r => r.side === side)) heads.push([cols[side].repo, 'GITHUB REPOS']);
    if ([...pkgs.values()].some(p => p.side === side)) heads.push([cols[side].npm, 'NPM PACKAGES']);
  }
  const headY = top - 16;
  const headSvg = heads.map(([x, t]) => `<text class="hint" x="${x + CARD_W / 2}" y="${headY}" fill="#a49d94" font-size="11" letter-spacing="1.5" text-anchor="middle" font-family="${MONO}">${t}</text>`).join('');

  // grow the canvas to fit the new columns
  const used = { left: heads.some(([x]) => x < leftEdge), right: heads.some(([x]) => x > rightEdge) };
  const [vx, vy, vw, vh] = attr(svg.match(/<svg [^>]*>/)[0], 'viewBox').split(/\s+/).map(Number);
  const leftmost = used.left ? Math.min(...heads.map(([x]) => x)) - 40 : vx;
  const rightmost = used.right ? Math.max(...heads.map(([x]) => x + CARD_W)) + 40 : vx + vw;
  const nx = Math.min(vx, leftmost), nw = Math.max(vx + vw, rightmost) - nx;

  const style = `<style>
@media (prefers-reduced-motion: no-preference) {
  .x{animation:xin .5s ease-out var(--d) both}
  @keyframes xin{from{opacity:0;transform:translateY(6px)}}
}
</style>`;

  return svg
    .replace(/<svg ([^>]*)>/, (tag, a) => `<svg ${a.replace(/viewBox="[^"]*"/, `viewBox="${nx} ${vy} ${nw} ${vh}"`).replace(/\swidth="[^"]*"/, ` width="${nw}"`)}>\n${style}`)
    .replace(/<rect x="[^"]*" y="([^"]*)" width="[^"]*" height="([^"]*)" fill="#110e0b">/, `<rect x="${nx}" y="$1" width="${nw}" height="$2" fill="#110e0b">`)
    .replace(/(<a href=)/, `<g class="code-edges">${edges.join('')}</g>\n$1`)
    .replace(/(<text [^>]*>Click a post[^<]*<\/text>)/, `${headSvg}\n${boxes.join('\n')}\n$1`);
}
