// Step 3: Linked JSON → HTML
// Reads data/linked/*.json and writes a static website to dist/.
import fs from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";
import { mapLayer } from "../assets/map.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const IN = path.join(ROOT, "data", "linked");
const DIST = path.join(ROOT, "dist");
const config = JSON.parse(await fs.readFile(path.join(ROOT, "site.config.json"), "utf8"));
const baseUrl = (process.env.SITE_URL || config.baseUrl).replace(/\/$/, "") + "/";
// For GitHub Pages project sites the site lives under /repo-name/, so links need that prefix.
const basePath = new URL(baseUrl).pathname; // e.g. "/my-website/" or "/"
const href = (p = "") => basePath + p;

// ---------- Interface text (site.config.json → "language") ----------
const TEXT = {
  nl: {
    home: "Home", posts: "Artikelen", tags: "Trefwoorden",
    latest: "Nieuwste artikelen", allPosts: (s) => `Alle artikelen op ${s}`, allTags: (s) => `Alle trefwoorden op ${s}`,
    tag: (t) => `Trefwoord: ${t}`, pagesAbout: (t) => `Pagina's over ${t}`, linkedTo: "Gekoppeld aan",
    notFound: "Pagina niet gevonden", notFoundText: "Deze pagina bestaat niet.", goHome: "Naar de homepage",
    dataFrom: "Gegevens van",
    region: "UNESCO-regio", country: "Land", countries: "Landen", inscribed: "Ingeschreven",
    notOnWikidata: "Niet op Wikidata", regionUnknown: "Onbekend voor dit land",
    partOf: "Onderdeel van het werelderfgoed", viewUnesco: "Bekijk op de Werelderfgoedlijst van UNESCO",
    photo: (a) => `Foto: ${a}`, articleText: "Artikeltekst", imageAndLocation: "Afbeelding en locatie",
    listing: "Werelderfgoed", openMap: (l) => `Open de locatie van ${l} op OpenStreetMap`,
    mapData: "Kaartgegevens ©", mapContributors: "OpenStreetMap-bijdragers",
    lat: (v) => (v >= 0 ? "NB" : "ZB"), lon: (v) => (v >= 0 ? "OL" : "WL"),
    regions: { "Europe and North America": "Europa en Noord-Amerika", "Arab States": "Arabische Staten" },
    heritageIn: (c) => `UNESCO-werelderfgoed in ${c.length > 1 ? c.slice(0, -1).join(", ") + " en " + c.at(-1) : c[0]}`,
    gallery: "Fotogalerij", galleryPrev: "Vorige foto's", galleryNext: "Volgende foto's", of: "van",
    galleryCredit: "Foto's via Wikimedia Commons. Klik op een foto voor de maker en de licentie.",
    distance: "Afstand tot de Middellandse Zee", onCoast: "aan de kust",
    readMore: "Naar het artikel", onWikidata: "Bekijk op Wikidata",
    zoomIn: "Inzoomen", zoomOut: "Uitzoomen", openOsm: "Open in OpenStreetMap", mapOf: (l) => `Kaart van de omgeving van ${l}`,
    articleNav: "Artikelnavigatie", prev: "Vorig artikel", next: "Volgend artikel", current: "Huidig artikel",
  },
  en: {
    home: "Home", posts: "Posts", tags: "Tags",
    latest: "Latest posts", allPosts: (s) => `All posts on ${s}`, allTags: (s) => `All tags on ${s}`,
    tag: (t) => `Tag: ${t}`, pagesAbout: (t) => `Pages about ${t}`, linkedTo: "Linked to",
    notFound: "Page not found", notFoundText: "This page does not exist.", goHome: "Go to the home page",
    dataFrom: "Data from",
    region: "UNESCO region", country: "Country", countries: "Countries", inscribed: "Inscribed",
    notOnWikidata: "Not on Wikidata", regionUnknown: "Not known for this country",
    partOf: "Part of the World Heritage site", viewUnesco: "View on the UNESCO World Heritage List",
    photo: (a) => `Photo by ${a}`, articleText: "Article text", imageAndLocation: "Image and location",
    listing: "World Heritage listing", openMap: (l) => `Open the location of ${l} on OpenStreetMap`,
    mapData: "Map data ©", mapContributors: "OpenStreetMap contributors",
    lat: (v) => (v >= 0 ? "N" : "S"), lon: (v) => (v >= 0 ? "E" : "W"),
    regions: {},
    heritageIn: (c) => `UNESCO World Heritage Site in ${c.length > 1 ? c.slice(0, -1).join(", ") + " and " + c.at(-1) : c[0]}`,
    gallery: "Photo gallery", galleryPrev: "Previous photos", galleryNext: "Next photos", of: "of",
    galleryCredit: "Photos via Wikimedia Commons. Click a photo for its author and licence.",
    distance: "Distance to the Mediterranean", onCoast: "on the coast",
    readMore: "Read the article", onWikidata: "View on Wikidata",
    zoomIn: "Zoom in", zoomOut: "Zoom out", openOsm: "Open in OpenStreetMap", mapOf: (l) => `Map of the area around ${l}`,
    articleNav: "Article navigation", prev: "Previous article", next: "Next article", current: "Current article",
  },
};
const T = TEXT[config.language] || TEXT.en;
const num = (v, digits) => v.toLocaleString(config.language, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const slugify = (s) =>
  // apostrophes are dropped: "Gorham's" → "gorhams"
  s.toLowerCase().normalize("NFKD").replace(/['’]/g, "").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
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

function layout({ title, description, url, jsonld, body, map = false }) {
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
${map ? `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>` : ""}
<link rel="stylesheet" href="${href("assets/style.css")}">
<script type="module" src="${href("assets/map.js")}"></script>
<script type="module" src="${href("assets/gallery.js")}"></script>
${jsonld ? `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2).replace(/</g, "\\u003c")}\n</script>` : ""}
</head>
<body>
<header class="site-header">
  <a class="site-title" href="${href()}">${esc(config.title)}</a>
  <nav><a href="${href()}">${T.home}</a><a href="${href("posts/")}">${T.posts}</a><a href="${href("tags/")}">${T.tags}</a></nav>
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
<p class="wd-source">${T.dataFrom} <a href="${esc(wd.url)}" rel="noopener">Wikidata</a></p>
</aside>`;
}

// ---------- Location map (static, built from OpenStreetMap tiles) ----------
// The frame always shows about `widthKm` kilometres (default 200) from left to right, at any screen size:
// tile sizes are set in container-width units (cqw), so the map scales with its column.
// The coordinates sit exactly in the centre, under the marker. No JavaScript needed.
function locationMap({ latitude: lat, longitude: lon }, label, widthKm = 200, qid = "") {
  const layer = mapLayer(lat, lon, widthKm);
  const f = (v) => v.toFixed(5);
  const osm = `https://www.openstreetmap.org/?mlat=${f(lat)}&mlon=${f(lon)}#map=${layer.zoom + 1}/${f(lat)}/${f(lon)}`;
  return `<figure class="h-map">
  <div class="h-map-frame" data-lat="${lat}" data-lon="${lon}" data-km="${widthKm}" data-q="${esc(qid)}" data-points="${href("assets/map-points.json")}" data-base="${href()}" data-text="${esc(JSON.stringify({ zoomIn: T.zoomIn, zoomOut: T.zoomOut, readMore: T.readMore, onWikidata: T.onWikidata }))}" role="img" aria-label="${esc(T.mapOf(label))}">
    <span class="h-map-tiles">${layer.tiles}</span>
    <svg class="h-pin" viewBox="0 0 22 22" width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="9"/></svg>
    <span class="h-scale" style="width:${layer.barWidth}">${layer.barLabel}</span>
    <div class="h-zoom" hidden>
      <button type="button" data-zoom="in" aria-label="${T.zoomIn}" title="${T.zoomIn}">+</button>
      <button type="button" data-zoom="out" aria-label="${T.zoomOut}" title="${T.zoomOut}">−</button>
    </div>
  </div>
  <figcaption>${num(Math.abs(lat), 4)}° ${T.lat(lat)}, ${num(Math.abs(lon), 4)}° ${T.lon(lon)}. <a href="${osm}" rel="noopener">${T.openOsm}</a>. ${T.mapData} <a href="https://www.openstreetmap.org/copyright" rel="noopener">${T.mapContributors}</a></figcaption>
</figure>`;
}

// ---------- Gallery: square Commons photos, three at a time ----------
function galleryHtml(images = [], label = "") {
  if (!images?.length) return "";
  const items = images.map((img) => {
    const credit = [img.author && T.photo(img.author), img.license].filter(Boolean).join(", ");
    return `<li><a href="${esc(img.page)}" rel="noopener" title="${esc(credit ? credit + ". Wikimedia Commons" : "Wikimedia Commons")}">` +
      `<img src="${esc(img.src)}" alt="${esc(img.caption || label)}" loading="lazy"></a></li>`;
  }).join("");
  const nav = images.length > 3 ? `<div class="h-gallery-nav" hidden>
    <button type="button" data-dir="-1" aria-label="${T.galleryPrev}"><svg viewBox="0 0 12 16" width="10" height="14" aria-hidden="true"><path d="M9.5 1.5 3 8l6.5 6.5"/></svg></button>
    <span class="h-gallery-count" aria-live="polite"></span>
    <button type="button" data-dir="1" aria-label="${T.galleryNext}"><svg viewBox="0 0 12 16" width="10" height="14" aria-hidden="true"><path d="M2.5 1.5 9 8l-6.5 6.5"/></svg></button>
  </div>` : "";
  return `<figure class="h-gallery" data-of="${esc(T.of)}">
  <ul class="h-gallery-track" aria-label="${T.gallery}">${items}</ul>
  ${nav}
  <figcaption>${T.galleryCredit}</figcaption>
</figure>`;
}

// ---------- World Heritage record ----------
// « previous · current · next », following the `order` numbers in the notes (1 comes before 2).
function articleNav(d, seq) {
  const i = seq.indexOf(d);
  if (i < 0) return "";
  const prev = seq[i - 1], next = seq[i + 1];
  const chev = (dir) =>
    `<svg class="h-nav-chev" viewBox="0 0 20 16" width="16" height="13" aria-hidden="true"><path d="${dir < 0 ? "M10 1.5 3.5 8 10 14.5M17 1.5 10.5 8 17 14.5" : "M3 1.5 9.5 8 3 14.5M10 1.5 16.5 8 10 14.5"}"/></svg>`;
  return `<nav class="h-nav" aria-label="${T.articleNav}">
  <span class="h-nav-prev">${prev ? `<a href="${href(prev.path)}" rel="prev" aria-label="${esc(T.prev)}: ${esc(prev.title)}">${chev(-1)}<span>${esc(prev.title)}</span></a>` : ""}</span>
  <span class="h-nav-current" aria-current="page"><span class="visually-hidden">${T.current}: </span>${esc(d.title)}</span>
  <span class="h-nav-next">${next ? `<a href="${href(next.path)}" rel="next" aria-label="${esc(T.next)}: ${esc(next.title)}"><span>${esc(next.title)}</span>${chev(1)}</a>` : ""}</span>
</nav>`;
}

// Distance to the Mediterranean, from `distance` in the note (kilometres; 0 = on the coast).
function distanceHtml(value) {
  if (value === undefined || value === null || value === "") return "";
  const km = Number(value);
  const shown = !Number.isFinite(km) ? esc(value) : km === 0 ? T.onCoast : `≈${num(km, 0)} km`;
  return `<div><dt>${T.distance}</dt><dd class="h-year h-distance">${shown}</dd></div>`;
}

function heritageArticle(d, contentHtml, seq = []) {
  // Subtitle: `subtitle` in the note; otherwise the Wikidata description in the site language;
  // otherwise "World Heritage in <country>".
  const countryNames = d.heritage.countries.map((c) => c.label);
  const subtitle = d.frontmatter?.subtitle || d.heritage.description || (countryNames.length ? T.heritageIn(countryNames) : "");
  const h = d.heritage;
  const list = (items) => items.join(", ");
  const countries = list(h.countries.map((c) =>
    `<span class="h-country">${c.flag ? `<img class="h-flag" src="${esc(c.flag)}" alt="" width="30" height="20">` : ""}<a href="${esc(c.url)}" rel="noopener">${esc(c.label)}</a></span>`));
  const regions = h.regions.length ? esc(h.regions.map((r) => T.regions[r] || r).join(", ")) : `<span class="h-missing">${T.regionUnknown}</span>`;
  const figures = h.images
    .map((img, i) => {
      const credit = [img.author && T.photo(esc(img.author)), img.license && esc(img.license)].filter(Boolean).join(", ");
      return `<figure>
  <a href="${esc(img.page)}" rel="noopener"><img src="${esc(img.src)}" alt="${esc(img.caption || h.label)}"${i ? ' loading="lazy"' : ""}></a>
  <figcaption>${credit ? `${credit}. ` : ""}<a href="${esc(img.page)}" rel="noopener">Wikimedia Commons</a></figcaption>
</figure>`;
    })
    .join("\n") + (h.coordinates ? "\n" + locationMap(h.coordinates, h.label, Number(d.frontmatter?.map_km) || config.mapWidthKm || 200, h.id) : "")
    + galleryHtml(d.gallery, h.label);
  return `<article class="heritage">
<header class="h-head">
  <h1>${esc(d.title)}</h1>
  ${subtitle ? `<p class="h-sub">${esc(subtitle)}</p>` : ""}
</header>
<div class="h-body${figures ? "" : " no-images"}">
  <div class="h-main">
    <div class="h-text">
      <div class="h-text-scroll prose" tabindex="0" aria-label="${T.articleText}">
${contentHtml}
      </div>
    </div>
    ${articleNav(d, seq)}
  </div>
  ${figures ? `<aside class="h-images" aria-label="${T.imageAndLocation}">\n${figures}\n</aside>` : ""}
</div>
<section class="h-facts" aria-label="${T.listing}">
  <div class="h-facts-top">
  <dl class="h-meta">
    <div><dt>${T.region}</dt><dd>${regions}</dd></div>
    <div><dt>${h.countries.length > 1 ? T.countries : T.country}</dt><dd>${countries || `<span class="h-missing">${T.notOnWikidata}</span>`}</dd></div>
    <div><dt>${T.inscribed}</dt><dd class="h-year">${h.year ?? `<span class="h-missing">${T.notOnWikidata}</span>`}</dd></div>
    ${distanceHtml(d.frontmatter?.distance)}
  </dl>
  </div>
  <div class="h-facts-bottom">
    ${h.listedAs ? `<p class="h-part">${T.partOf} <a href="${esc(h.listedAs.url)}" rel="noopener">${esc(h.listedAs.label)}</a></p>` : ""}
    <a class="h-unesco" href="${esc(h.unescoUrl)}" rel="noopener"><svg class="h-chevron" viewBox="0 0 12 16" width="10" height="14" aria-hidden="true"><path d="M2 1.5 9.5 8 2 14.5"/></svg>${T.viewUnesco}</a>
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
// Records with an `order` number, in that order.
const ordered = docs
  .filter((d) => d.frontmatter?.order !== undefined && Number.isFinite(Number(d.frontmatter.order)))
  .sort((a, b) => Number(a.frontmatter.order) - Number(b.frontmatter.order));
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
    await write(d.path, layout({ title: d.title, description: d.description, url: d.url, jsonld: d.jsonld, body: heritageArticle(d, content, ordered), map: Boolean(d.heritage.coordinates) }));
    continue;
  }
  content = hasH1 ? content.replace(/(<\/h1>\n?)/, `$1${metaHtml}`) : `<h1>${esc(d.title)}</h1>\n${metaHtml}${content}`;
  let body = `<article class="prose">
${content}
${tagList(d)}
</article>`;

  if (isHome && posts.length) {
    body += `<section><h2>${T.latest}</h2><ul class="cards">${posts.slice(0, 5).map(postCard).join("")}</ul></section>`;
  }
  await write(d.path, layout({ title: d.title, description: d.description, url: d.url, jsonld: d.jsonld, body }));
}

// ---------- Posts index ----------
if (!docs.some((d) => d.path === "posts/")) {
  const url = baseUrl + "posts/";
  await write("posts", layout({
    title: T.posts,
    description: T.allPosts(config.title),
    url,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: T.posts,
      isPartOf: { "@id": baseUrl + "#website" },
      hasPart: posts.map((p) => ({ "@id": p.url + "#main" })),
    },
    body: `<h1>${T.posts}</h1><ul class="cards">${posts.map(postCard).join("")}</ul>`,
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
    title: T.tag(t.name),
    description: T.pagesAbout(t.name),
    url,
    jsonld: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": url,
      url,
      name: T.pagesAbout(t.name),
      about: thing,
      hasPart: t.docs.map((d) => ({ "@id": d.url + "#main" })),
    },
    body: `<h1>${esc(t.name)}</h1>
${t.wikidata ? `<p class="meta">${T.linkedTo} <a href="${esc(t.wikidata)}" rel="noopener">Wikidata ${esc(t.wikidata.split("/").pop())}</a></p>` : ""}
<ul class="cards">${t.docs.map(postCard).join("")}</ul>`,
  }));
}
await write("tags", layout({
  title: T.tags,
  description: T.allTags(config.title),
  url: baseUrl + "tags/",
  body: `<h1>${T.tags}</h1><ul class="tags big">${[...tags.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `<li><a href="${href(`tags/${slugify(t.name)}/`)}">${esc(t.name)} <span>${t.docs.length}</span></a></li>`)
    .join("")}</ul>`,
}));

// ---------- 404, sitemap, robots, raw linked data ----------
await fs.writeFile(path.join(DIST, "404.html"), layout({
  title: T.notFound,
  description: T.notFoundText,
  url: baseUrl + "404.html",
  body: `<h1>${T.notFound}</h1><p><a href="${href()}">${T.goHome}</a></p>`,
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
// Locations for the interactive map (written by transform.mjs).
await fs.copyFile(path.join(ROOT, "data", "map-points.json"), path.join(DIST, "assets", "map-points.json")).catch(() => {});

console.log(`render: wrote ${docs.length} page(s) + ${tags.size} tag page(s) to dist/ (base ${baseUrl})`);
