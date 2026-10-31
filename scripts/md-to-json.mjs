// Step 1: Markdown → JSON
// Reads every .md file under content/ and writes one JSON document per file to data/json/.
// Understands Obsidian syntax: [[wiki links]], ![[embeds]], callouts, ==highlights==,
// %%comments%%, inline #tags, and note names with spaces.
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONTENT = path.join(ROOT, "content");
const OUT = path.join(ROOT, "data", "json");
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

// Folders starting with "." (.obsidian, .trash) or "_" (_templates, _private) are never published.
async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith(".") && !e.name.startsWith("_"))
      .map((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : [p];
      })
  );
  return files.flat();
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toIsoDate(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date) ? null : date.toISOString().slice(0, 10);
}

function toList(v) {
  if (!v) return [];
  const list = Array.isArray(v) ? v : String(v).split(",");
  return list.map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean);
}

// ---------- Pass 1: read all notes and attachments ----------
const all = await walk(CONTENT);
const notes = [];
const media = new Map(); // lowercased file name → { src, dest }

for (const file of all) {
  const rel = path.relative(CONTENT, file).replace(/\\/g, "/");
  if (!rel.endsWith(".md")) {
    const ext = path.extname(rel);
    const dest = `media/${slugify(path.basename(rel, ext))}${ext.toLowerCase()}`;
    media.set(path.basename(rel).toLowerCase(), { src: `content/${rel}`, dest });
    continue;
  }
  const { data: fm, content } = matter(await fs.readFile(file, "utf8"));
  if (fm.draft === true || fm.publish === false) continue;

  const relNoExt = rel.replace(/\.md$/, "");
  const parts = relNoExt.split("/").map(slugify);
  if (fm.slug) parts[parts.length - 1] = slugify(fm.slug);
  if (parts[parts.length - 1] === "index") parts.pop();
  const urlPath = parts.length ? parts.join("/") + "/" : "";
  notes.push({ rel, relNoExt, fm, content, urlPath, name: path.basename(relNoExt) });
}

// Obsidian resolves [[Note]] by file name, by path, or by alias.
const noteIndex = new Map();
for (const n of notes) {
  for (const key of [n.name, n.relNoExt, ...toList(n.fm.aliases)]) {
    if (!noteIndex.has(key.toLowerCase())) noteIndex.set(key.toLowerCase(), n);
  }
}
// Also allow linking by title, without overriding file names or aliases.
for (const n of notes) {
  const t = n.fm.title && String(n.fm.title).toLowerCase();
  if (t && !noteIndex.has(t)) noteIndex.set(t, n);
}

// ---------- Obsidian → standard Markdown ----------
function resolveWikiTarget(target) {
  const [notePart, heading] = target.split("#");
  const note = notePart ? noteIndex.get(notePart.trim().toLowerCase()) : null;
  const anchor = heading ? `#${slugify(heading)}` : "";
  return { note, anchor, notePart: notePart.trim(), heading };
}

function convertText(text, inlineTags) {
  return text
    // %% Obsidian comments %% are removed
    .replace(/%%[\s\S]*?%%/g, "")
    // ![[image.png|300]] → image ; ![[Note]] → link to the note
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target, opt) => {
      const file = media.get(path.basename(target.trim()).toLowerCase());
      if (file && IMAGE_EXT.test(target)) {
        const alt = opt && !/^\d+(x\d+)?$/.test(opt) ? opt : path.basename(target, path.extname(target));
        return `![${alt}](/${file.dest})`;
      }
      if (file) return `[${path.basename(target)}](/${file.dest})`;
      const { note, anchor } = resolveWikiTarget(target);
      return note ? `[${note.fm.title || note.name}](/${note.urlPath}${anchor})` : target;
    })
    // [[Note]], [[Note|label]], [[Note#Heading]], [[#Heading]]
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, target, label) => {
      const { note, anchor, notePart, heading } = resolveWikiTarget(target);
      const text = label || (notePart || heading);
      if (!notePart && anchor) return `[${text}](${anchor})`;
      const file = media.get(path.basename(notePart).toLowerCase());
      if (file) return `[${text}](/${file.dest})`;
      return note ? `[${text}](/${note.urlPath}${anchor})` : text; // unpublished note → plain text
    })
    // > [!note] Title  → bold title line in a blockquote
    .replace(/^(>\s*)\[!(\w+)\][+-]?\s*(.*)$/gm, (_, q, type, title) =>
      `${q}**${title || type.charAt(0).toUpperCase() + type.slice(1)}**\n${q.trimEnd()}`)
    // ==highlight==
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>")
    // collect inline #tags (not headings, not URLs #anchors)
    .replace(/(^|\s)#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu, (m, pre, tag) => {
      inlineTags.add(tag);
      return m;
    });
}

// Leave code blocks and inline code untouched.
function convertObsidian(md, inlineTags) {
  return md
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((block, i) =>
      i % 2 ? block : block.split(/(`[^`\n]+`)/g).map((s, j) => (j % 2 ? s : convertText(s, inlineTags))).join("")
    )
    .join("");
}

// ---------- Pass 2: write JSON ----------
await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

for (const n of notes) {
  const { fm } = n;
  const inlineTags = new Set();
  const markdown = convertObsidian(n.content, inlineTags);
  const tokens = marked.lexer(markdown);
  const headings = tokens
    .filter((t) => t.type === "heading")
    .map((t) => ({ depth: t.depth, text: t.text, id: slugify(t.text) }));
  const plain = markdown.replace(/<[^>]+>|[#>*_`\[\]()!-]/g, " ").replace(/\s+/g, " ").trim();
  const tags = [...new Set([...toList(fm.tags), ...inlineTags])];

  const doc = {
    id: n.relNoExt,
    source: `content/${n.rel}`,
    path: n.urlPath,
    type: fm.type || (n.rel.startsWith("posts/") ? "BlogPosting" : "WebPage"),
    title: fm.title || headings.find((h) => h.depth === 1)?.text || n.name,
    description: fm.description || plain.slice(0, 160),
    date: toIsoDate(fm.date || fm.created),
    updated: toIsoDate(fm.updated || fm.modified),
    author: fm.author || null,
    tags,
    entities: fm.entities || [], // e.g. ["Amsterdam", {name: "...", wikidata: "Q..."}]
    frontmatter: fm,
    headings,
    wordCount: plain ? plain.split(" ").length : 0,
    markdown,
  };
  const outFile = path.join(OUT, doc.id.replace(/\//g, "__") + ".json");
  await fs.writeFile(outFile, JSON.stringify(doc, null, 2));
}

// Attachments (images, PDFs…) for the renderer to copy.
await fs.writeFile(path.join(ROOT, "data", "media.json"), JSON.stringify([...media.values()], null, 2));
console.log(`md-to-json: wrote ${notes.length} JSON document(s) and found ${media.size} attachment(s)`);
