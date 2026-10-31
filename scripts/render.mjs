// Step 3: Linked JSON → HTML
// Reads data/linked/*.json and writes a static website to dist/.
import fs from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";

const ROOT = path.resolve(import.meta.dirname, "..");
const IN = path.join(ROOT, "data", "linked");
const DIST = path.join(ROOT, "dist");
const config = JSON.parse(await fs.readFile(path.join(ROOT, "site.config.json"), "utf8"));
const baseUrl = (process.env.SITE_URL || config.baseUrl).replace(/\/$/, "") + "/";
// For GitHub Pages project sites the site lives under /repo-name/, so links need that prefix.
const basePath = new URL(baseUrl).pathname; // e.g. "/my-website/" or "/"
const href = (p = "") => basePath + p;

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const slugify = (s) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const fmtDate = (d) =>
  d ? new Date(d + "T00:00:00Z").toLocaleDateString(config.language, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "";

// Markdown renderer: heading anchors, and site-relative links get the base path.
const md = new Marked({
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
    link({ href: h, title, tokens }) {
      const target = h.startsWith("/") ? basePath + h.slice(1) : h;
      const ext = /^https?:/.test(h) ? ' rel="noopener"' : "";
      return `<a href="${esc(target)}"${title ? ` title="${esc(title)}"` : ""}${ext}>${this.parser.parseInline(tokens)}</a>`;
    },
    image({ href: h, title, text }) {
      const src = h.startsWith("/") ? basePath + h.slice(1) : h;
      return `<img src="${esc(src)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ""} loading="lazy">`;
    },
  },
});

function layout({ title, description, url, jsonld, body }) {
  return `<!doctype html>
<html lang="${esc(config.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title === config.title ? title : `${title} · ${config.title}`)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<link rel="stylesheet" href="${href("assets/style.css")}">
${jsonld ? `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2).replace(/</g, "\\u003c")}\n</script>` : ""}
</head>
<body>
<header class="site-header">
  <a class="site-title" href="${href()}">${esc(config.title)}</a>
  <nav><a href="${href()}">Home</a><a href="${href("posts/")}">Posts</a><a href="${href("tags/")}">Tags</a></nav>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <p>${esc(config.title)} · Built from Markdown with linked data (schema.org + Wikidata)</p>
</footer>
</body>
</html>
`;
}

function tagList(doc) {
  if (!doc.tags?.length) return "";
  return `<ul class="tags">${doc.tags
    .map((t) => {
      const wd = doc.links?.[t];
      return `<li><a href="${href(`tags/${slugify(t)}/`)}">${esc(t)}</a>${
        wd ? ` <a class="wd" href="${esc(wd)}" title="${esc(t)} on Wikidata" rel="noopener">WD</a>` : ""
      }</li>`;
    })
    .join("")}</ul>`;
}

function postCard(d) {
  return `<li class="card">
  <a href="${href(d.path)}"><h3>${esc(d.title)}</h3></a>
  ${d.date ? `<time datetime="${d.date}">${fmtDate(d.date)}</time>` : ""}
  <p>${esc(d.description)}</p>
</li>`;
}

async function write(relDir, html) {
  const dir = path.join(DIST, relDir);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), html);
}

// ---------- Load documents ----------
const docs = await Promise.all(
  (await fs.readdir(IN)).filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await fs.readFile(path.join(IN, f), "utf8")))
);
const posts = docs.filter((d) => d.type === "BlogPosting" || d.path.startsWith("posts/")).sort((a, b) => (b.date || "").localeCompare(a.date || ""));

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(DIST, { recursive: true });
await fs.cp(path.join(ROOT, "assets"), path.join(DIST, "assets"), { recursive: true });

// Attachments from content/ (images, PDFs…) go to dist/media/.
const mediaList = JSON.parse(await fs.readFile(path.join(ROOT, "data", "media.json"), "utf8").catch(() => "[]"));
for (const m of mediaList) {
  await fs.mkdir(path.dirname(path.join(DIST, m.dest)), { recursive: true });
  await fs.copyFile(path.join(ROOT, m.src), path.join(DIST, m.dest));
}

// ---------- Content pages ----------
for (const d of docs) {
  const isHome = d.path === "";
  const meta = [
    d.date && `<time datetime="${d.date}">${fmtDate(d.date)}</time>`,
    (d.author || (d.type === "BlogPosting" && config.author?.name)) && esc(d.author || config.author.name),
  ].filter(Boolean).join(" · ");

  // Use the Markdown H1 as page title if present; otherwise print the front-matter title.
  const hasH1 = d.headings?.some((h) => h.depth === 1);
  const metaHtml = meta ? `<p class="meta">${meta}</p>\n` : "";
  let content = md.parse(d.markdown);
  content = hasH1 ? content.replace(/(<\/h1>\n?)/, `$1${metaHtml}`) : `<h1>${esc(d.title)}</h1>\n${metaHtml}${content}`;
  let body = `<article>
${content}
${tagList(d)}
</article>`;

  if (isHome && posts.length) {
    body += `<section><h2>Latest posts</h2><ul class="cards">${posts.slice(0, 5).map(postCard).join("")}</ul></section>`;
  }
  await write(d.path, layout({ title: d.title, description: d.description, url: d.url, jsonld: d.jsonld, body }));
}

// ---------- Posts index ----------
if (!docs.some((d) => d.path === "posts/")) {
  const url = baseUrl + "posts/";
  await write("posts", layout({
    title: "Posts",
    description: `All posts on ${config.title}`,
    url,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: "Posts",
      isPartOf: { "@id": baseUrl + "#website" },
      hasPart: posts.map((p) => ({ "@id": p.url + "#main" })),
    },
    body: `<h1>Posts</h1><ul class="cards">${posts.map(postCard).join("")}</ul>`,
  }));
}

// ---------- Tag pages (each tag is linked to its Wikidata entity when found) ----------
const tags = new Map();
for (const d of docs) for (const t of d.tags || []) {
  if (!tags.has(t)) tags.set(t, { name: t, wikidata: d.links?.[t], docs: [] });
  tags.get(t).docs.push(d);
}
for (const t of tags.values()) {
  const slug = slugify(t.name);
  const url = baseUrl + `tags/${slug}/`;
  const thing = { "@type": "DefinedTerm", name: t.name, ...(t.wikidata && { sameAs: t.wikidata }) };
  await write(`tags/${slug}`, layout({
    title: `Tag: ${t.name}`,
    description: `Pages about ${t.name}`,
    url,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: `Pages about ${t.name}`,
      about: thing,
      hasPart: t.docs.map((d) => ({ "@id": d.url + "#main" })),
    },
    body: `<h1>${esc(t.name)}</h1>
${t.wikidata ? `<p class="meta">Linked to <a href="${esc(t.wikidata)}" rel="noopener">Wikidata ${esc(t.wikidata.split("/").pop())}</a></p>` : ""}
<ul class="cards">${t.docs.map(postCard).join("")}</ul>`,
  }));
}
await write("tags", layout({
  title: "Tags",
  description: `All tags on ${config.title}`,
  url: baseUrl + "tags/",
  body: `<h1>Tags</h1><ul class="tags big">${[...tags.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `<li><a href="${href(`tags/${slugify(t.name)}/`)}">${esc(t.name)} <span>${t.docs.length}</span></a></li>`)
    .join("")}</ul>`,
}));

// ---------- 404, sitemap, robots, raw linked data ----------
await fs.writeFile(path.join(DIST, "404.html"), layout({
  title: "Page not found",
  description: "This page does not exist.",
  url: baseUrl + "404.html",
  body: `<h1>Page not found</h1><p><a href="${href()}">Go to the home page</a></p>`,
}));

const urls = [...docs.map((d) => ({ loc: d.url, lastmod: d.updated || d.date })), { loc: baseUrl + "posts/" }, { loc: baseUrl + "tags/" }];
await fs.writeFile(path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`)
    .join("\n")}\n</urlset>\n`);
await fs.writeFile(path.join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${baseUrl}sitemap.xml\n`);

// All linked data in one file, so other systems can harvest it.
await fs.writeFile(path.join(DIST, "data.jsonld"), JSON.stringify({
  "@context": "https://schema.org",
  "@graph": docs.flatMap((d) => d.jsonld["@graph"].filter((n) => n["@type"] !== "WebSite")),
}, null, 2));
await fs.writeFile(path.join(DIST, ".nojekyll"), "");

console.log(`render: wrote ${docs.length} page(s) + ${tags.size} tag page(s) to dist/ (base ${baseUrl})`);
