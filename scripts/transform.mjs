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
import { parseId, getEntityWithProperties } from "./wikidata.mjs";
import { getHeritage } from "./heritage.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const IN = path.join(ROOT, "data", "json");
const OUT = path.join(ROOT, "data", "linked");
const CACHE_FILE = path.join(ROOT, "data", "wikidata-cache.json");
const config = JSON.parse(await fs.readFile(path.join(ROOT, "site.config.json"), "utf8"));
const baseUrl = (process.env.SITE_URL || config.baseUrl).replace(/\/$/, "") + "/";
const offline = (process.argv.includes("--offline") || !config.linking?.wikidata) && !process.env.WIKIDATA_FIXTURE;
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
  // wikidata: may be a Q-ID or a full Wikidata URI
  let wd = e.wikidata ? { id: parseId(e.wikidata) } : await lookupWikidata(e.name);
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

  // Main subject from Wikidata, with the properties chosen in front matter:
  //   wikidata: Q5598   (or https://www.wikidata.org/wiki/Q5598)
  //   wikidata_properties: [P569, P570, P19, P106, P18]
  const fm = doc.frontmatter || {};
  const subjectId = parseId(fm.wikidata);
  let subject = null;
  let heritage = null;
  if (subjectId && !offline) {
    try {
      heritage = await getHeritage(subjectId, lang);
    } catch (err) {
      console.warn(`  ! ${doc.id}: could not load World Heritage data for ${subjectId}: ${err.message}`);
    }
  }
  if (heritage) {
    // A World Heritage record: title falls back to the Wikidata label.
    if (!fm.title && !doc.headings?.some((h) => h.depth === 1)) doc = { ...doc, title: heritage.label };
    if (!fm.description && heritage.description) doc = { ...doc, description: heritage.description };
    const pv = (id, name, value, ref) => ({
      "@type": "PropertyValue",
      ...(id && { propertyID: `http://www.wikidata.org/prop/direct/${id}` }),
      name,
      value,
      ...(ref && { valueReference: { "@id": ref.uri || `http://www.wikidata.org/entity/${ref.id}`, name: ref.label } }),
    });
    about.unshift({
      "@type": ["LandmarksOrHistoricalBuildings", "TouristAttraction"],
      "@id": heritage.uri,
      name: heritage.label,
      ...(heritage.description && { description: heritage.description }),
      sameAs: [heritage.url, heritage.unescoUrl],
      identifier: pv("P757", "World Heritage Site ID", heritage.whsId),
      ...(heritage.images.length && { image: heritage.images.map((i) => i.src) }),
      ...(heritage.coordinates && {
        geo: { "@type": "GeoCoordinates", latitude: heritage.coordinates.latitude, longitude: heritage.coordinates.longitude },
      }),
      ...(heritage.countries.length && {
        containedInPlace: heritage.countries.map((c) => ({ "@type": "Country", "@id": `http://www.wikidata.org/entity/${c.id}`, name: c.label })),
      }),
      additionalProperty: [
        ...heritage.regions.map((r) => pv(null, "UNESCO region", r)),
        ...heritage.countries.map((c) => pv("P17", "country", c.label, c)),
        ...(heritage.year ? [pv("P1435", "year of inscription on the World Heritage List", heritage.year)] : []),
        ...heritage.criteria.map((c) => pv("P2614", "World Heritage criterion", c.numeral ? `(${c.numeral})` : c.label, c)),
      ],
    });
  } else if (subjectId && !offline) {
    const list = fm.wikidata_properties ?? config.linking?.wikidataProperties ?? ["P31", "P18"];
    const propIds = (Array.isArray(list) ? list : String(list).split(","))
      .map((p) => parseId(p, "P"))
      .filter(Boolean);
    try {
      subject = await getEntityWithProperties(subjectId, propIds, lang);
      if (!subject) console.warn(`  ! ${doc.id}: Wikidata item ${subjectId} not found`);
    } catch (err) {
      console.warn(`  ! ${doc.id}: could not load Wikidata item ${subjectId}: ${err.message}`);
    }
  }
  if (subject) {
    about.unshift({
      "@type": fm.wikidata_type || "Thing",
      "@id": subject.uri,
      name: subject.label,
      ...(subject.description && { description: subject.description }),
      sameAs: [subject.url],
      ...(subject.image && { image: subject.image }),
      additionalProperty: subject.properties.flatMap((p) =>
        p.values.map((v) => ({
          "@type": "PropertyValue",
          propertyID: `http://www.wikidata.org/prop/direct/${p.id}`,
          name: p.label,
          value: v.date || v.amount || v.text,
          ...(v.uri && { valueReference: { "@id": v.uri, name: v.text } }),
          ...(v.kind === "image" || v.kind === "url" ? { url: v.image || v.url } : {}),
        }))
      ),
    });
  }

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

  return { ...doc, url: pageUrl, jsonld, links, wikidata: subject, heritage };
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
