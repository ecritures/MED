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
import { parseId, getEntityWithProperties, fetchJson, getEntities, pick, bestStatements } from "./wikidata.mjs";
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
    const hit = (await fetchJson(url)).search?.[0];
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
  const loadErrors = [];
  if (subjectId && !offline) {
    try {
      heritage = await getHeritage(subjectId, lang, fm.img_uri);
    } catch (err) {
      loadErrors.push(err.message);
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
      if (!subject) loadErrors.push(`item ${subjectId} does not exist on Wikidata`);
    } catch (err) {
      loadErrors.push(err.message);
    }
  }
  // A note that names a Wikidata item must get its data; otherwise stop the build, so a
  // half-empty page is never published (the previous version of the site stays online).
  if (subjectId && !offline && !heritage && !subject) {
    throw new Error(`${doc.source}: could not load Wikidata item ${subjectId}. ${[...new Set(loadErrors)].join(" / ")}`);
  }
  if (subject && !fm.title && !doc.headings?.some((h) => h.depth === 1)) doc = { ...doc, title: subject.label };
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

const enriched = [];
for (const f of files) {
  const doc = JSON.parse(await fs.readFile(path.join(IN, f), "utf8"));
  let out;
  try {
    out = process.env.TRANSFORMER_URL ? await enrichRemote(doc) : await enrich(doc);
  } catch (err) {
    // "::error::" makes GitHub Actions show the message prominently on the run page.
    console.error(`::error title=Linked data step failed::${err.message}`);
    process.exit(1);
  }
  await fs.writeFile(path.join(OUT, f), JSON.stringify(out, null, 2));
  enriched.push(out);
}

// ---------- Points for the interactive map ----------
// Every site in data/sites.json (the list of Mediterranean World Heritage sites) plus every
// record with a location. A site links to its article when a record has the same `order`
// number or the same Wikidata item. Failures here only cost the extra markers, never the build.
{
  const records = enriched
    .filter((d) => d.heritage?.coordinates)
    .map((d) => ({ q: d.heritage.id, listQ: d.heritage.listedAs?.id, order: Number(d.frontmatter?.order), name: d.title,
      url: d.path, lat: d.heritage.coordinates.latitude, lon: d.heritage.coordinates.longitude }));
  let list = [];
  try { list = JSON.parse(await fs.readFile(path.join(ROOT, "data", "sites.json"), "utf8")); } catch {}
  const points = new Map(); // key: Wikidata item of the listed site
  if (list.length && !offline) {
    try {
      const qids = [...new Set(list.map((r) => r.qid).filter(Boolean))];
      const items = await getEntities(qids, lang, "labels|claims");
      for (const r of list) {
        if (!r.qid || points.has(r.qid)) { if (points.has(r.qid)) points.get(r.qid).orders.push(r.order); continue; }
        const geo = bestStatements(items[r.qid]?.claims?.P625)[0]?.mainsnak.datavalue?.value;
        if (!geo || typeof geo.latitude !== "number") continue;
        points.set(r.qid, { q: r.qid, name: pick(items[r.qid]?.labels, lang) || r.site, lat: geo.latitude, lon: geo.longitude, orders: [r.order], url: null });
      }
    } catch (err) {
      console.warn(`  ! map: could not load the site list from Wikidata (${err.message}); only articles are shown`);
    }
  }
  for (const rec of records) {
    const hit = [...points.values()].find((p) => p.orders.includes(rec.order) || p.q === rec.q || p.q === rec.listQ);
    if (hit) Object.assign(hit, { name: rec.name, url: rec.url, lat: rec.lat, lon: rec.lon, self: rec.q });
    else points.set(rec.q, { q: rec.q, self: rec.q, name: rec.name, lat: rec.lat, lon: rec.lon, orders: [rec.order], url: rec.url });
  }
  const out = [...points.values()].map(({ q, self, name, lat, lon, url }) => ({ q: self || q, name, lat: +lat.toFixed(5), lon: +lon.toFixed(5), url }));
  await fs.writeFile(path.join(ROOT, "data", "map-points.json"), JSON.stringify(out));
  console.log(`transform: ${out.length} location(s) for the map`);
}

// Keep the cache sorted so diffs stay small when you commit it.
const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(CACHE_FILE, JSON.stringify(sorted, null, 2) + "\n");
console.log(
  `transform: enriched ${files.length} document(s) → data/linked/` +
    (process.env.TRANSFORMER_URL ? " (external transformer)" : offline ? " (offline)" : "")
);
