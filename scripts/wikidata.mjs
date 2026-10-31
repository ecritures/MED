// Fetches a Wikidata entity and turns selected properties into readable values.
// Used by transform.mjs. Results are fetched fresh on every build, so the site
// follows changes on Wikidata.
//
// For testing without internet, set WIKIDATA_FIXTURE=path/to/file.json containing
// { "entities": { "Q…": <entity JSON as returned by wbgetentities> } }.
import fs from "node:fs/promises";

const API = "https://www.wikidata.org/w/api.php";
// Wikimedia asks automated clients to identify themselves with a name and a way to get in touch.
const UA = {
  "User-Agent": `MED-site-builder/1.1 (${process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}` : "https://github.com/ecritures/MED"}) node-fetch`,
  "Api-User-Agent": "MED-site-builder/1.1 (https://github.com/ecritures/MED)",
  Accept: "application/json",
};

/** GET JSON from Wikimedia, retrying a few times; errors say what the server answered. */
export async function fetchJson(url) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${text.slice(0, 200).replace(/\s+/g, " ")}`);
      const json = JSON.parse(text);
      if (json.error) throw new Error(`${json.error.code}: ${json.error.info}`);
      return json;
    } catch (err) {
      last = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw last;
}
const entityCache = new Map();
export let fixture = null;
export let commonsFixture = null;
if (process.env.WIKIDATA_FIXTURE) {
  const f = JSON.parse(await fs.readFile(process.env.WIKIDATA_FIXTURE, "utf8"));
  fixture = f.entities;
  commonsFixture = f.commons || {};
}

/** "Q5598", "wd:Q5598", "http://www.wikidata.org/entity/Q5598", "https://www.wikidata.org/wiki/Q5598" → "Q5598" */
export function parseId(value, prefix = "Q") {
  const m = String(value ?? "").match(new RegExp(`\\b(${prefix}\\d+)\\b`, "i"));
  return m ? m[1].toUpperCase() : null;
}

/** Load entities (with labels/descriptions/claims) in batches of 50. */
export async function getEntities(ids, lang, props = "labels|descriptions|claims") {
  const missing = [...new Set(ids)].filter((id) => !entityCache.has(`${id}|${props}`));
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    let entities;
    if (fixture) {
      entities = Object.fromEntries(batch.map((id) => [id, fixture[id] || { missing: "" }]));
    } else {
      const languages = [...new Set([lang, "en"])].join("|");
      const url = `${API}?action=wbgetentities&format=json&ids=${batch.join("|")}` +
        `&props=${encodeURIComponent(props)}&languages=${encodeURIComponent(languages)}`;
      try {
        entities = (await fetchJson(url)).entities || {};
      } catch (err) {
        // Fallback: the plain entity export, one item at a time.
        console.warn(`  ! wbgetentities failed (${err.message}); trying Special:EntityData`);
        entities = {};
        for (const id of batch) {
          const data = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`);
          entities[id] = Object.values(data.entities || {})[0] || { missing: "" };
        }
      }
    }
    for (const id of batch) entityCache.set(`${id}|${props}`, entities[id] && !("missing" in entities[id]) ? entities[id] : null);
  }
  return Object.fromEntries([...new Set(ids)].map((id) => [id, entityCache.get(`${id}|${props}`)]));
}

export const pick = (obj, lang) => obj?.[lang]?.value ?? obj?.en?.value ?? Object.values(obj || {})[0]?.value ?? null;

// Statements with "preferred" rank win; deprecated ones are skipped.
export function bestStatements(claims = []) {
  const ok = claims.filter((c) => c.rank !== "deprecated" && c.mainsnak?.snaktype === "value");
  const preferred = ok.filter((c) => c.rank === "preferred");
  return preferred.length ? preferred : ok;
}

export function formatTime({ time, precision }, lang) {
  // time looks like "+1606-07-15T00:00:00Z"; precision 9 = year, 10 = month, 11 = day
  const m = time.match(/^([+-])(\d+)-(\d\d)-(\d\d)/);
  if (!m) return { text: time };
  const [, sign, y, mo, d] = m;
  const year = Number(y) * (sign === "-" ? -1 : 1);
  const bc = year <= 0 ? " BC" : "";
  const absYear = Math.abs(year) + (year <= 0 ? 1 : 0);
  const iso = precision >= 11 ? `${y.padStart(4, "0")}-${mo}-${d}` : precision === 10 ? `${y.padStart(4, "0")}-${mo}` : `${y.padStart(4, "0")}`;
  let text;
  const asDate = (day) => {
    const dt = new Date(Date.UTC(2000, Number(mo) - 1, day));
    dt.setUTCFullYear(absYear); // also correct for years below 100
    return dt;
  };
  if (precision >= 11 && !bc) {
    text = asDate(Number(d)).toLocaleDateString(lang, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  } else if (precision === 10 && !bc) {
    text = asDate(1).toLocaleDateString(lang, { year: "numeric", month: "long", timeZone: "UTC" });
  } else if (precision === 8) text = `${Math.floor(absYear / 10) * 10}s${bc}`;
  else if (precision === 7) text = `${Math.ceil(absYear / 100)}th century${bc}`;
  else text = `${absYear}${bc}`;
  return { text, date: bc ? null : iso };
}

export const commonsUrl = (file, width) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}${width ? `?width=${width}` : ""}`;

/**
 * Returns { id, uri, url, label, description, image, properties: [{ id, label, values: [...] }] }
 * Each value is { text, kind, id?, uri?, url?, date?, image? }.
 */
export async function getEntityWithProperties(qid, propertyIds, lang = "en") {
  const entity = (await getEntities([qid], lang))[qid];
  if (!entity) return null;

  const statements = Object.fromEntries(propertyIds.map((p) => [p, bestStatements(entity.claims?.[p])]));

  // Collect every ID we need a label for: the properties themselves and item values.
  const labelIds = [...propertyIds];
  for (const list of Object.values(statements))
    for (const s of list) if (s.mainsnak.datavalue?.type === "wikibase-entityid") labelIds.push(s.mainsnak.datavalue.value.id);
  const labelled = await getEntities(labelIds, lang, "labels");
  const labelOf = (id) => pick(labelled[id]?.labels, lang) || id;

  const properties = propertyIds
    .map((pid) => ({
      id: pid,
      label: labelOf(pid),
      values: statements[pid].map((s) => {
        const dv = s.mainsnak.datavalue;
        const dt = s.mainsnak.datatype;
        switch (dv.type) {
          case "wikibase-entityid":
            return { kind: "item", id: dv.value.id, text: labelOf(dv.value.id),
              uri: `http://www.wikidata.org/entity/${dv.value.id}`, url: `https://www.wikidata.org/wiki/${dv.value.id}` };
          case "time":
            return { kind: "date", ...formatTime(dv.value, lang) };
          case "monolingualtext":
            return { kind: "text", text: dv.value.text };
          case "quantity": {
            const amount = Number(dv.value.amount);
            const unitId = parseId(dv.value.unit);
            return { kind: "quantity", text: amount.toLocaleString(lang) + (unitId ? ` ${unitId}` : ""), amount, unitId };
          }
          case "globecoordinate":
            return { kind: "coordinates", text: `${dv.value.latitude.toFixed(4)}, ${dv.value.longitude.toFixed(4)}`,
              latitude: dv.value.latitude, longitude: dv.value.longitude };
          case "string":
            if (dt === "commonsMedia")
              return { kind: "image", text: dv.value, image: commonsUrl(dv.value, 480), url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(dv.value.replace(/ /g, "_"))}` };
            if (dt === "url") return { kind: "url", text: dv.value, url: dv.value };
            return { kind: "text", text: dv.value };
          default:
            return { kind: "text", text: JSON.stringify(dv.value) };
        }
      }),
    }))
    .filter((p) => p.values.length);

  // Units of quantities are items too; replace their IDs with labels.
  const unitIds = properties.flatMap((p) => p.values.filter((v) => v.unitId).map((v) => v.unitId));
  if (unitIds.length) {
    const units = await getEntities(unitIds, lang, "labels");
    for (const p of properties) for (const v of p.values)
      if (v.unitId) v.text = v.text.replace(v.unitId, pick(units[v.unitId]?.labels, lang) || v.unitId);
  }

  const imageClaim = bestStatements(entity.claims?.P18)[0]?.mainsnak.datavalue?.value;
  return {
    id: qid,
    uri: `http://www.wikidata.org/entity/${qid}`,
    url: `https://www.wikidata.org/wiki/${qid}`,
    label: pick(entity.labels, lang) || qid,
    description: pick(entity.descriptions, lang) || "",
    image: imageClaim ? commonsUrl(imageClaim, 480) : null,
    properties,
  };
}
