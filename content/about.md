---
title: How this site works
description: From Markdown to linked data to HTML, automatically on every push.
type: AboutPage
tags: [Markdown, Linked data, GitHub Pages]
---

# How this site works

1. **Write** a page as a Markdown file in the `content/` folder.
2. **Push** it to GitHub.
3. GitHub Actions turns every page into **JSON**.
4. The **transformer** adds linked data: schema.org JSON-LD, with tags and entities linked to Wikidata.
5. The pages are rendered to **HTML** and published on **GitHub Pages**.

## Writing a page

Every Markdown file starts with a small block of settings, called *front matter*:

```markdown
---
title: My trip to Amsterdam
date: 2026-10-31
description: A short summary for search engines.
tags: [Amsterdam, Travel]
entities: [Rijksmuseum, "Vincent van Gogh"]
---

Your text goes here.
```

- `tags` become tag pages and are linked to Wikidata.
- `entities` are things the page mentions; they are added to the linked data as `mentions`.
- If a lookup picks the wrong thing, give the ID yourself: `entities: [{name: Mercury, wikidata: Q308}]`.
- Add `draft: true` to keep a page from being published.
