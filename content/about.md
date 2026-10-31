---
title: Hoe deze site werkt
description: Van Markdown naar linked data naar HTML, automatisch bij elke synchronisatie.
type: AboutPage
---

# Hoe deze site werkt

1. **Schrijf** een pagina als Markdown-notitie in de map `content` van de Obsidian-vault.
2. **Synchroniseer** met Fit; de notitie gaat naar GitHub.
3. GitHub zet elke pagina om naar **JSON**.
4. De **transformer** voegt linked data toe: schema.org JSON-LD met gegevens uit Wikidata.
5. De pagina's worden omgezet naar **HTML** en gepubliceerd op **GitHub Pages**.

## Een werelderfgoedpagina schrijven

Zet bovenaan de notitie alleen het Wikidata-nummer van de plek:

```markdown
---
wikidata: Q1355749
---

## Kopje

Tekst van de alinea.
```

De titel, de foto, de kaart, het land, de UNESCO-regio en het jaar van inschrijving komen
automatisch uit Wikidata.
