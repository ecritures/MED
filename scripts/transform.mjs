// Step 2: Linked-data transformer
// Reads data/json/*.json, adds schema.org JSON-LD and links tags/entities to Wikidata,
// and writes the enriched documents to data/linked/.
//
// Options:
//   --offline            don't call Wikidata; only use the cache and explicit IDs
//   TRANSFORMER_URL=...  (env) POST each document to an external transformer instead;
//                        it must return the enriched JSON document.
//   SITE_URL=...         (env) overrides baseUrl from site.config.json
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const IN = path.join(ROOT, "data", "json");
const OUT = path.join(ROOT, "data", "linked");
const CACHE_FILE = path.join(ROOT, "data", "wikidata-cache.json");
const config = JSON.parse(await fs.readFile(path.join(ROOT, "site.config.json"), "utf8"));
const baseUrl = (process.env.SITE_URL || config.baseUrl).replace(/\/$/, "") + "/";
const offline = process.argv.includes("--offline") || !config.linking?.wikidata;
const lang = config.linking?.wikidataLanguage || "en";

// ---------- Wikidata lookup with a committed cache ----------
let cache = {};
try {
  cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
} catch {}

async function lookupWikidata(term) {
  const key = `${lang}:${term.toLowerCase()}`;
  if (key in cache) return cache[key];
  if (offline) return null;
  const url =
    "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&limit=1" +
    `&language=${lang}&uselang=${lang}&search=${encodeURIComponent(term)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "linked-data-site/1.0 (static site build)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const hit = (await res.json()).search?.[0];
    cache[key] = hit
      ? { id: hit.id, label: hit.label, description: hit.description || "" }
      : null;
    return cache[key];
  } catch (err) {
    console.warn(`  ! Wikidata lookup failed for "${term}": ${err.message}`);
    return null; // not cached, so it is retried next build
  }
}

async function toThing(entity) {
  // entity is "Amsterdam" or { name, wikidata?, type?, url? }
  const e = typeof entity === "string" ? { name: entity } : entity;
  const thing = { "@type": e.type || "Thing", name: e.name };
  let wd = e.wikidata ? { id: e.wikidata } : await lookupWikidata(e.name);
  if (wd?.id) {
    thing["@id"] = `http://www.wikidata.org/entity/${wd.id}`;
    thing.sameAs = [`https://www.wikidata.org/wiki/${wd.id}`];
    if (wd.description) thing.description = wd.description;
  }
  if (e.url) thing.sameAs = [...(thing.sameAs || []), e.url];
  return thing;
}

// ---------- Build JSON-LD for one document ----------
async function enrich(doc) {
  const pageUrl = baseUrl + doc.path;
  const author = doc.author || config.author?.name;
  const about = await Promise.all(doc.tags.map(toThing));
  const mentions = await Promise.all(doc.entities.map(toThing));

  const main = {
    "@type": doc.type,
    "@id": pageUrl + "#main",
    url: pageUrl,
    headline: doc.title,
    name: doc.title,
    description: doc.description,
    inLanguage: config.language,
    isPartOf: { "@id": baseUrl + "#website" },
    ...(doc.date && { datePublished: doc.date }),
    ...((doc.updated || doc.date) && { dateModified: doc.updated || doc.date }),
    ...(author && { author: { "@type": "Person", name: author } }),
    ...(about.length && { about, keywords: doc.tags.join(", ") }),
    ...(mentions.length && { mentions }),
    ...(doc.wordCount && { wordCount: doc.wordCount }),
  };

  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": baseUrl + "#website",
        url: baseUrl,
        name: config.title,
        description: config.description,
        inLanguage: config.language,
      },
      main,
    ],
  };

  // Map of term → Wikidata URL, used by the renderer to link tags.
  const links = {};
  for (const t of [...about, ...mentions]) if (t.sameAs) links[t.name] = t.sameAs[0];

  return { ...doc, url: pageUrl, jsonld, links };
}

async function enrichRemote(doc) {
  const res = await fetch(process.env.TRANSFORMER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document: doc, site: { ...config, baseUrl } }),
  });
  if (!res.ok) throw new Error(`Transformer returned HTTP ${res.status} for ${doc.id}`);
  return res.json();
}

// ---------- Run ----------
const files = (await fs.readdir(IN)).filter((f) => f.endsWith(".json"));
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

for (const f of files) {
  const doc = JSON.parse(await fs.readFile(path.join(IN, f), "utf8"));
  const out = process.env.TRANSFORMER_URL ? await enrichRemote(doc) : await enrich(doc);
  await fs.writeFile(path.join(OUT, f), JSON.stringify(out, null, 2));
}

// Keep the cache sorted so diffs stay small when you commit it.
const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(CACHE_FILE, JSON.stringify(sorted, null, 2) + "\n");
console.log(
  `transform: enriched ${files.length} document(s) → data/linked/` +
    (process.env.TRANSFORMER_URL ? " (external transformer)" : offline ? " (offline)" : "")
);
