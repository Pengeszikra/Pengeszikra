// Finds the code behind the posts: which of my GitHub repos and npm packages each dev.to article points to.
//
// Evidence, strongest first:
//   - a link in the article body to github.com/Pengeszikra/<repo> or npmjs.com/package/<name>
//   - an `npm i <name>` / `npm install <name>` / `npx <name>` line naming one of my packages
//   - an npm package whose `repository` is a repo the article links (package ↔ repo)
// Third-party repos and packages are ignored: only names that exist in my account count.

const OWNER = 'Pengeszikra';
const NPM_USER = 'pengeszikra';

const lc = s => String(s || '').toLowerCase();
const repoNameFromUrl = url => {
  const m = String(url || '').match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|$)/i);
  return m && lc(m[1]) === lc(OWNER) ? m[2] : null;
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, headers = {}, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Pengeszikra-profile-postmap', Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) return await res.json();
      const wait = Number(res.headers.get('retry-after'));
      if (res.status === 429 && wait > 0) await sleep(Math.min(wait, 60) * 1000);
      if (res.status !== 429 && res.status < 500) throw Object.assign(new Error(`${res.status} ${res.statusText}`), { fatal: true });
      throw new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      if (err.fatal || i >= tries) throw new Error(`${err.message} — ${url}`);
      console.warn(`retry ${i}: ${err.message} — ${url}`);
      await sleep(3000 * i);
    }
  }
}

export async function fetchRepos(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const repos = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await getJson(`https://api.github.com/users/${OWNER}/repos?per_page=100&page=${page}&type=owner&sort=pushed`, headers);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.filter(r => !r.private).map(r => ({
    name: r.name, url: r.html_url, description: r.description || '', homepage: r.homepage || '',
    language: r.language || '', stars: r.stargazers_count, fork: r.fork, archived: r.archived,
    pushedAt: r.pushed_at, topics: r.topics || [],
  }));
}

export async function fetchPackages() {
  const found = [];
  for (let from = 0; from < 1000; from += 250) {
    const res = await getJson(`https://registry.npmjs.org/-/v1/search?text=maintainer:${NPM_USER}&size=250&from=${from}`);
    found.push(...res.objects);
    if (found.length >= res.total || !res.objects.length) break;
  }
  return found.map(({ package: p }) => ({
    name: p.name, version: p.version, description: p.description || '', date: p.date,
    url: `https://www.npmjs.com/package/${p.name}`,
    repo: repoNameFromUrl(p.links?.repository) || null,
    homepage: p.links?.homepage || '',
  }));
}

// What an article body mentions, before checking which names really are mine.
export function extractMentions(body) {
  const repos = new Set(), packages = new Set();
  for (const m of body.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)/gi)) {
    if (lc(m[1]) === lc(OWNER)) repos.add(lc(m[2].replace(/\.git$/, '')));
  }
  for (const m of body.matchAll(/npmjs\.com\/package\/((?:@[\w.-]+\/)?[\w.-]+)/gi)) packages.add(lc(m[1]));
  for (const m of body.matchAll(/\b(?:npm\s+(?:i|install|add)(?:\s+-[-\w]+)*|npx|pnpm\s+add|yarn\s+add)\s+((?:@[\w.-]+\/)?[\w.-]+)/gi)) {
    packages.add(lc(m[1]).replace(/(.)@[^/]*$/, '$1'));
  }
  return { repos: [...repos].sort(), packages: [...packages].sort() };
}

// Article bodies are fetched only for new or edited articles; dev.to rate-limits bursts.
export async function fetchMentions(articles, cache = {}) {
  const out = {};
  for (const a of articles) {
    const stamp = a.editedAt || a.publishedAt;
    const hit = cache[a.id];
    if (hit && hit.stamp === stamp) { out[a.id] = hit; continue; }
    const detail = await getJson(`https://dev.to/api/articles/${a.id}`);
    out[a.id] = { stamp, ...extractMentions(detail.body_markdown || '') };
    await sleep(1200);
  }
  return out;
}

// pure: mentions per article + my repos + my packages → { [articleId]: { repos: [name], packages: [name] } }
export function linkArticles(articles, mentions, repos, packages) {
  const repoByLc = new Map(repos.map(r => [lc(r.name), r.name]));
  const pkgByLc = new Map(packages.map(p => [lc(p.name), p.name]));
  const pkgsOfRepo = new Map();
  for (const p of packages) if (p.repo && repoByLc.has(lc(p.repo))) {
    const key = lc(p.repo);
    pkgsOfRepo.set(key, [...(pkgsOfRepo.get(key) || []), p.name]);
  }

  const links = {};
  for (const a of articles) {
    const m = mentions[a.id];
    if (!m) continue;
    const repoSet = new Set(m.repos.map(r => repoByLc.get(r)).filter(Boolean));
    const pkgSet = new Set(m.packages.map(p => pkgByLc.get(p)).filter(Boolean));
    for (const r of repoSet) for (const p of pkgsOfRepo.get(lc(r)) || []) pkgSet.add(p);
    if (repoSet.size || pkgSet.size) links[a.id] = { url: a.url, title: a.title, repos: [...repoSet].sort(), packages: [...pkgSet].sort() };
  }
  return links;
}

export async function collectCode(articles, { token, previous } = {}) {
  const [repos, packages] = await Promise.all([fetchRepos(token), fetchPackages()]);
  const mentions = await fetchMentions(articles, previous?.mentions);
  return { generatedAt: new Date().toISOString(), repos, packages, mentions, links: linkArticles(articles, mentions, repos, packages) };
}
