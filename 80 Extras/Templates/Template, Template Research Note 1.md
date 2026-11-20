---
title: "{{title}}"
year: {{date | format("YYYY")}}
tags: books 
authors: {{authors}}{{directors}}
---

author:: {{authors}}
read start:
read end:
tags:: #source/zotero
URL: {{url}}
Zotero Link: {{pdfZoteroLink}}

### The Book in 3 Sentences

### How the Book Changed Me

### Key Concepts & Evergreens

## Highlights
{% for annotation in annotations -%} 
    {%- if annotation.annotatedText -%} 
    {{annotation.annotatedText}}”{% if annotation.color %} | **{{annotation.colorCategory}} {{annotation.type | capitalize}}** {% else %} {{annotation.type | capitalize}} {% endif %} | [Page {{annotation.page}}](zotero://open-pdf/library/items/{{annotation.attachment.itemKey}}?page={{annotation.page}}&annotation={{annotation.id}})
    {%- endif %}
    {%- if annotation.imageRelativePath -%}
    ![[{{annotation.imageRelativePath}}]] [View on page {{annotation.page}}](zotero://open-pdf/library/items/{{annotation.attachment.itemKey}}?page={{annotation.page}}) {%- endif %}
{% if annotation.comment %} 
> {{annotation.comment}}

{% endif %} 
{% endfor -%}