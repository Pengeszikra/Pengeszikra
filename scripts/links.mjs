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

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Pengeszikra-profile-postmap', Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

export async function fetchBodies(articles) {
  const bodies = {};
  for (const a of articles) {
    const detail = await getJson(`https://dev.to/api/articles/${a.id}`);
    bodies[a.id] = detail.body_markdown || '';
    await sleep(150);
  }
  return bodies;
}

// pure: article bodies + my repos + my packages → { [articleId]: { repos: [name], packages: [name] } }
export function linkArticles(articles, bodies, repos, packages) {
  const repoByLc = new Map(repos.map(r => [lc(r.name), r.name]));
  const pkgByLc = new Map(packages.map(p => [lc(p.name), p.name]));
  const pkgsOfRepo = new Map();
  for (const p of packages) if (p.repo && repoByLc.has(lc(p.repo))) {
    const key = lc(p.repo);
    pkgsOfRepo.set(key, [...(pkgsOfRepo.get(key) || []), p.name]);
  }

  const links = {};
  for (const a of articles) {
    const body = bodies[a.id] || '';
    const repoSet = new Set(), pkgSet = new Set();

    for (const m of body.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)/gi)) {
      if (lc(m[1]) !== lc(OWNER)) continue;
      const name = repoByLc.get(lc(m[2].replace(/\.git$/, '')));
      if (name) repoSet.add(name);
    }
    for (const m of body.matchAll(/npmjs\.com\/package\/((?:@[\w.-]+\/)?[\w.-]+)/gi)) {
      const name = pkgByLc.get(lc(m[1]));
      if (name) pkgSet.add(name);
    }
    for (const m of body.matchAll(/\b(?:npm\s+(?:i|install|add)(?:\s+-[-\w]+)*|npx|pnpm\s+add|yarn\s+add)\s+((?:@[\w.-]+\/)?[\w.-]+)/gi)) {
      const name = pkgByLc.get(lc(m[1]).replace(/@[^/]*$/, ''));
      if (name) pkgSet.add(name);
    }
    for (const r of repoSet) for (const p of pkgsOfRepo.get(lc(r)) || []) pkgSet.add(p);

    if (repoSet.size || pkgSet.size) links[a.id] = { repos: [...repoSet].sort(), packages: [...pkgSet].sort() };
  }
  return links;
}

export async function collectCode(articles, { token } = {}) {
  const [repos, packages, bodies] = await Promise.all([fetchRepos(token), fetchPackages(), fetchBodies(articles)]);
  return { generatedAt: new Date().toISOString(), repos, packages, links: linkArticles(articles, bodies, repos, packages) };
}
