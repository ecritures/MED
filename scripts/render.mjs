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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=Marcellus&display=swap">
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
  <p>${esc(config.description)}</p>
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

// Fact box for the post's main Wikidata subject (front matter: wikidata + wikidata_properties).
function wikidataBox(wd) {
  if (!wd) return "";
  const value = (v) => {
    switch (v.kind) {
      case "item": return `<a href="${esc(v.url)}" rel="noopener">${esc(v.text)}</a>`;
      case "date": return v.date ? `<time datetime="${esc(v.date)}">${esc(v.text)}</time>` : esc(v.text);
      case "url": return `<a href="${esc(v.url)}" rel="noopener">${esc(v.text.replace(/^https?:\/\/(www\.)?/, ""))}</a>`;
      case "image": return `<a href="${esc(v.url)}" rel="noopener"><img src="${esc(v.image)}" alt="${esc(v.text)}" loading="lazy"></a>`;
      default: return esc(v.text);
    }
  };
  const rows = wd.properties
    .filter((p) => !(p.id === "P18" && wd.image)) // the main image is shown at the top
    .map((p) => `<dt><a href="https://www.wikidata.org/wiki/Property:${p.id}" rel="noopener" title="${p.id}">${esc(p.label)}</a></dt><dd>${p.values.map(value).join(", ")}</dd>`)
    .join("\n");
  return `<aside class="wd-card">
${wd.image ? `<img class="wd-image" src="${esc(wd.image)}" alt="${esc(wd.label)}" loading="lazy">` : ""}
<p class="wd-title"><a href="${esc(wd.url)}" rel="noopener">${esc(wd.label)}</a> <span class="wd-id">${esc(wd.id)}</span></p>
${wd.description ? `<p class="wd-desc">${esc(wd.description)}</p>` : ""}
${rows ? `<dl>\n${rows}\n</dl>` : ""}
<p class="wd-source">Data from <a href="${esc(wd.url)}" rel="noopener">Wikidata</a></p>
</aside>`;
}

// ---------- Location map (static, built from OpenStreetMap tiles) ----------
// The frame always shows about `widthKm` kilometres from left to right, at any screen size:
// tile sizes are set in container-width units (cqw), so the map scales with its column.
// The coordinates sit exactly in the centre, under the marker. No JavaScript needed.
function locationMap({ latitude: lat, longitude: lon }, label, widthKm = 100) {
  const EARTH = 40075016.686; // metres around the equator
  const rad = (lat * Math.PI) / 180;
  const tileMetres = (z) => (EARTH * Math.cos(rad)) / 2 ** z;
  // Pick the zoom level where 2–4 tiles span the frame, so tiles are shown at or below their native size.
  let zoom = 1;
  while (zoom < 18 && (widthKm * 1000) / tileMetres(zoom + 1) < 4) zoom++;
  const across = (widthKm * 1000) / tileMetres(zoom); // tiles across the frame
  const tw = 100 / across; // one tile, in cqw
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const half = Math.ceil(across / 2) + 1;
  const tiles = [];
  for (let ty = Math.floor(y) - half; ty <= Math.floor(y) + half; ty++)
    for (let tx = Math.floor(x) - half; tx <= Math.floor(x) + half; tx++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      tiles.push(`<img src="https://tile.openstreetmap.org/${zoom}/${wx}/${ty}.png" alt="" loading="lazy" style="left:${((tx - x) * tw).toFixed(3)}cqw;top:${((ty - y) * tw).toFixed(3)}cqw;width:${tw.toFixed(3)}cqw;height:${tw.toFixed(3)}cqw">`);
    }
  // Scale bar: a round distance close to a quarter of the frame width.
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  const barKm = steps.reduce((best, v) => (Math.abs(v - widthKm / 4) < Math.abs(best - widthKm / 4) ? v : best));
  const f = (v) => v.toFixed(5);
  const osm = `https://www.openstreetmap.org/?mlat=${f(lat)}&mlon=${f(lon)}#map=${zoom + 1}/${f(lat)}/${f(lon)}`;
  return `<figure class="h-map">
  <a class="h-map-frame" href="${osm}" rel="noopener" aria-label="Open the location of ${esc(label)} on OpenStreetMap">
    <span class="h-map-tiles">${tiles.join("")}</span>
    <svg class="h-pin" viewBox="0 0 32 44" width="32" height="44" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 43 16 43s15-16 15-27.2C31 7.6 24.3 1 16 1z"/><circle cx="16" cy="15.5" r="5.5"/></svg>
    <span class="h-scale" style="width:${((barKm / widthKm) * 100).toFixed(2)}%">${barKm} km</span>
  </a>
  <figcaption>${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}. Map data © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> contributors</figcaption>
</figure>`;
}

// ---------- World Heritage record ----------
function heritageArticle(d, contentHtml) {
  const h = d.heritage;
  const list = (items) => items.join(", ");
  const countries = list(h.countries.map((c) =>
    `<span class="h-country">${c.flag ? `<img class="h-flag" src="${esc(c.flag)}" alt="" width="30" height="20">` : ""}<a href="${esc(c.url)}" rel="noopener">${esc(c.label)}</a></span>`));
  const regions = h.regions.length ? esc(h.regions.join(", ")) : `<span class="h-missing">Not known for this country</span>`;
  const figures = h.images
    .map((img, i) => {
      const credit = [img.author && `Photo by ${esc(img.author)}`, img.license && esc(img.license)].filter(Boolean).join(", ");
      return `<figure>
  <a href="${esc(img.page)}" rel="noopener"><img src="${esc(img.src)}" alt="${esc(img.caption || h.label)}"${i ? ' loading="lazy"' : ""}></a>
  <figcaption>${credit ? `${credit}. ` : ""}<a href="${esc(img.page)}" rel="noopener">Wikimedia Commons</a></figcaption>
</figure>`;
    })
    .join("\n") + (h.coordinates ? "\n" + locationMap(h.coordinates, h.label, Number(d.frontmatter?.map_km) || config.mapWidthKm || 100) : "");
  return `<article class="heritage">
<header class="h-head">
  <h1>${esc(d.title)}</h1>
  ${h.description ? `<p class="h-sub">${esc(h.description)}</p>` : ""}
</header>
<div class="h-body${figures ? "" : " no-images"}">
  <div class="h-text">
    <div class="h-text-scroll prose" tabindex="0" aria-label="Article text">
${contentHtml}
    </div>
  </div>
  ${figures ? `<aside class="h-images" aria-label="Image and location">\n${figures}\n</aside>` : ""}
</div>
<section class="h-facts" aria-label="World Heritage listing">
  <div class="h-facts-top">
  <dl class="h-meta">
    <div><dt>UNESCO region</dt><dd>${regions}</dd></div>
    <div><dt>${h.countries.length > 1 ? "Countries" : "Country"}</dt><dd>${countries || '<span class="h-missing">Not on Wikidata</span>'}</dd></div>
    <div><dt>Inscribed</dt><dd class="h-year">${h.year ?? '<span class="h-missing">Not on Wikidata</span>'}</dd></div>
  </dl>
  </div>
  <div class="h-facts-bottom">
    ${h.listedAs ? `<p class="h-part">Part of the World Heritage site <a href="${esc(h.listedAs.url)}" rel="noopener">${esc(h.listedAs.label)}</a></p>` : ""}
    <a class="h-unesco" href="${esc(h.unescoUrl)}" rel="noopener"><svg class="h-chevron" viewBox="0 0 12 16" width="10" height="14" aria-hidden="true"><path d="M2 1.5 9.5 8 2 14.5"/></svg>View on the UNESCO World Heritage List</a>
  </div>
</section>
${tagList(d)}
</article>`;
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
  const metaHtml = (meta ? `<p class="meta">${meta}</p>\n` : "") + wikidataBox(d.wikidata);
  let content = md.parse(d.markdown);
  if (d.heritage) {
    content = content.replace(/<h1[^>]*>[\s\S]*?<\/h1>\n?/, ""); // the template prints the title
    await write(d.path, layout({ title: d.title, description: d.description, url: d.url, jsonld: d.jsonld, body: heritageArticle(d, content) }));
    continue;
  }
  content = hasH1 ? content.replace(/(<\/h1>\n?)/, `$1${metaHtml}`) : `<h1>${esc(d.title)}</h1>\n${metaHtml}${content}`;
  let body = `<article class="prose">
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
