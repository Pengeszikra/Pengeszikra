# Maintaining the thought tree

This is a ready-to-publish GitHub profile repository for `Pengeszikra/Pengeszikra`.
The public profile is `README.md`; this file explains how to maintain it.

## Publication and updates

The root README appears on the GitHub profile. Automatic updates are disabled:
there is no scheduled or push-triggered GitHub Actions workflow. The current
profile stays as published until it is edited or refreshed manually.

## Commands (Node 22 or newer)

```sh
npm test
npm run build    # Regenerate deterministically from the checked-in snapshot
npm run update   # Fetch current DEV metadata, selected article details and covers
```

Run these commands locally only when you want to update the profile. Review the
resulting changes, then commit and push them manually.

## Curating connections

Edit `connections.json`. An article node uses its stable numeric DEV `articleId`;
a repository node has an HTTPS `repo` URL. Each connection has a short display
label, a reverse label for the other card, a `kind`, and a `reason` recording the
evidence behind it. The thematic terminal and Rust connections are intentionally
marked `related`: they do not claim a code dependency.

Add a node to a branch's `nodes` array to display it. Every mapped article gets
a cover, a date, a short manually edited summary and links to its neighbours.
Unmapped articles appear in the three-item notebook section until curated.
The full DEV archive remains one click away.

Repository URLs found in article bodies are stored as `detectedRepos` suggestions.
They do not create graph edges automatically. References to third-party projects
are excluded. Confirm the public repository and relationship before adding one.

## Images and preservation

The original DEV cover is copied into `assets/articles`; if a mapped article has
no cover, the first Markdown body image is tried. A post without either gets a
text-only card. Each image filename includes the DEV ID and content hash.
`data/articles.json` keeps the original image and article URLs for provenance.
The initial POC contains images from the author's published posts, including
three recent notebook entries. No replacement illustrations are generated.

The original bytes are retained. Images are only fetched again if their source
URL changes or the local file disappears. If an image changes in place at the
same URL, delete its `localImage` property and run `npm run update`. Old files
are retained so a transient service failure never deletes the previous covers.

Only the README block between `THOUGHT-TREE:START` and `THOUGHT-TREE:END` is generated.
Write your bio, contact links and other profile sections outside that block.
If a DEV request or required image fails, the command exits unsuccessfully before
rewriting the README. Cached data supports an offline rebuild at any time.

## Scope

The map starts with ten articles across terminal/pipeline experiments, typed
React state/JSDoc, and Rust/WASM. All published article metadata is cached, but
only the selected articles and latest three notebook entries appear as cards.
The page is English to match the public articles and GitHub audience.

GitHub's own Mermaid renderer draws the two larger branch diagrams. Ordinary
article and repository links beneath each diagram provide navigation without
depending on Mermaid click handlers. Small branches use cards and links directly.
