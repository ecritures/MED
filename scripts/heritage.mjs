// World Heritage record for a Wikidata item that has a World Heritage Site ID (P757).
//
//   image(s)             P18
//   country              P17
//   year of inscription  P1435 = World Heritage Site (Q9259), qualifier start time (P580)
//   criteria             P2614
//   UNESCO region        not on Wikidata: derived from the country (ISO code P297) using
//                        UNESCO's regional grouping of States Parties, see REGION_BY_ISO.
//   UNESCO page          https://whc.unesco.org/en/list/<P757>
import { getEntities, pick, bestStatements, commonsUrl, commonsFixture } from "./wikidata.mjs";

const WORLD_HERITAGE_SITE = "Q9259";

const EUR_NA = "Europe and North America";
const ARAB = "Arab States";
// UNESCO World Heritage regions for the Mediterranean basin and neighbours.
// Note: UNESCO groups Israel, Türkiye and Cyprus under Europe and North America.
const REGION_BY_ISO = {
  ES: EUR_NA, PT: EUR_NA, AD: EUR_NA, FR: EUR_NA, MC: EUR_NA, IT: EUR_NA, SM: EUR_NA, VA: EUR_NA,
  MT: EUR_NA, SI: EUR_NA, HR: EUR_NA, BA: EUR_NA, ME: EUR_NA, AL: EUR_NA, MK: EUR_NA, RS: EUR_NA,
  GR: EUR_NA, BG: EUR_NA, TR: EUR_NA, CY: EUR_NA, IL: EUR_NA, GB: EUR_NA,
  MA: ARAB, DZ: ARAB, TN: ARAB, LY: ARAB, EG: ARAB, LB: ARAB, SY: ARAB, PS: ARAB, JO: ARAB, MR: ARAB,
};

// Short wording of the ten selection criteria (Operational Guidelines, paragraph 77).
const CRITERIA = {
  i: "A masterpiece of human creative genius",
  ii: "An important interchange of human values over time or within a cultural area",
  iii: "A unique or exceptional testimony to a cultural tradition or civilization",
  iv: "An outstanding example of a type of building, ensemble or landscape",
  v: "An outstanding example of traditional settlement or land use",
  vi: "Associated with events, traditions, ideas or beliefs of universal significance",
  vii: "Superlative natural phenomena or areas of exceptional natural beauty",
  viii: "An outstanding example of major stages of the earth's history",
  ix: "An outstanding example of ongoing ecological and biological processes",
  x: "The most important natural habitats for conserving biological diversity",
};
const ROMAN_ORDER = Object.keys(CRITERIA);

function numeralFrom(label) {
  const m = String(label).match(/\(\s*(viii|vii|iii|ix|iv|vi|ii|v|x|i)\s*\)|\b(viii|vii|iii|ix|iv|vi|ii|v|x|i)\s*$/i);
  return m ? (m[1] || m[2]).toLowerCase() : null;
}

const yearOf = (snak) => {
  const t = snak?.datavalue?.value?.time;
  const m = t && t.match(/^\+?(-?\d+)-/);
  return m ? Number(m[1]) : null;
};

async function commonsInfo(files) {
  if (!files.length) return {};
  if (commonsFixture) return Object.fromEntries(files.map((f) => [f, commonsFixture[f] || {}]));
  const titles = files.map((f) => "File:" + f).join("|");
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo" +
    `&iiprop=url|extmetadata&iiurlwidth=900&titles=${encodeURIComponent(titles)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "linked-data-site/1.0" }, signal: AbortSignal.timeout(15000) });
    const pages = Object.values((await res.json()).query?.pages || {});
    const strip = (h = "") => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return Object.fromEntries(pages.map((p) => {
      const info = p.imageinfo?.[0] || {};
      const meta = info.extmetadata || {};
      return [p.title.replace(/^File:/, ""), {
        thumb: info.thumburl,
        page: info.descriptionurl,
        author: strip(meta.Artist?.value),
        license: strip(meta.LicenseShortName?.value),
        caption: strip(meta.ImageDescription?.value).slice(0, 200),
      }];
    }));
  } catch (err) {
    console.warn(`  ! Commons image info failed: ${err.message}`);
    return {};
  }
}

/** Returns a heritage record, or null when the item has no World Heritage Site ID. */
export async function getHeritage(qid, lang = "en") {
  const entity = (await getEntities([qid], lang))[qid];
  if (!entity) return null;
  const claims = entity.claims || {};
  const whsId = bestStatements(claims.P757)[0]?.mainsnak.datavalue?.value;
  if (!whsId) return null;

  const itemIds = (pid) => bestStatements(claims[pid]).map((s) => s.mainsnak.datavalue?.value?.id).filter(Boolean);
  const countryIds = itemIds("P17");
  const criteriaIds = itemIds("P2614");

  // Year of inscription: start time on the "World Heritage Site" designation.
  const designations = (claims.P1435 || []).filter((s) => s.mainsnak.datavalue?.value?.id === WORLD_HERITAGE_SITE && s.rank !== "deprecated");
  const years = designations
    .map((s) => yearOf(s.qualifiers?.P580?.[0]) ?? yearOf(s.qualifiers?.P585?.[0]))
    .filter((y) => y != null)
    .sort((a, b) => a - b);

  const linked = await getEntities([...countryIds, ...criteriaIds], lang, "labels|claims");
  const countries = countryIds.map((id) => {
    const iso = bestStatements(linked[id]?.claims?.P297)[0]?.mainsnak.datavalue?.value || null;
    return { id, label: pick(linked[id]?.labels, lang) || id, url: `https://www.wikidata.org/wiki/${id}`, iso, region: REGION_BY_ISO[iso] || null };
  });
  const criteria = criteriaIds
    .map((id) => {
      const label = pick(linked[id]?.labels, lang) || id;
      const numeral = numeralFrom(label);
      return { id, label, numeral, meaning: numeral ? CRITERIA[numeral] : label, url: `https://www.wikidata.org/wiki/${id}` };
    })
    .sort((a, b) => ROMAN_ORDER.indexOf(a.numeral) - ROMAN_ORDER.indexOf(b.numeral));

  const files = bestStatements(claims.P18).map((s) => s.mainsnak.datavalue?.value).filter(Boolean);
  const info = await commonsInfo(files);
  const images = files.map((file) => ({
    file,
    src: info[file]?.thumb || commonsUrl(file, 900),
    page: info[file]?.page || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`,
    author: info[file]?.author || "",
    license: info[file]?.license || "",
    caption: info[file]?.caption || "",
  }));

  return {
    id: qid,
    uri: `http://www.wikidata.org/entity/${qid}`,
    url: `https://www.wikidata.org/wiki/${qid}`,
    label: pick(entity.labels, lang) || qid,
    description: pick(entity.descriptions, lang) || "",
    whsId: String(whsId),
    unescoUrl: `https://whc.unesco.org/en/list/${encodeURIComponent(String(whsId).replace(/-.*$/, ""))}`,
    year: years[0] ?? null,
    countries,
    regions: [...new Set(countries.map((c) => c.region).filter(Boolean))],
    criteria,
    images,
  };
}
