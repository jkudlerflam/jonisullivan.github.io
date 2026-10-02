#!/usr/bin/env python3
"""One-time migration: the hand-written HTML site (as of commit d75c5ab) -> content/site.json.

Run from the repo root:  python3 tools/migrate.py
Reads the old *.html pages and images/, writes content/site.json. Uses only the
standard library plus Pillow (for image dimensions).
"""
import html
import json
import os
import re
import sys
from datetime import datetime

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# This conversion already happened. Running it again would replace everything edited
# since with the old hand-written pages (which no longer exist in that form).
if os.path.exists(os.path.join(ROOT, "content", "site.json")) and "--force" not in sys.argv:
    raise SystemExit("content/site.json already exists; refusing to overwrite it. This was a one-time migration.")


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()


def squash(s):
    """Collapse whitespace the way a browser renders it, and trim."""
    return re.sub(r"\s+", " ", s).strip()


def clean_inline(s):
    """Normalize hand-written inline HTML into what the editor's sanitizer keeps."""
    s = squash(s)
    s = re.sub(r"\s+style=\"[^\"]*\"", "", s)
    s = re.sub(r"<p class=\"[^\"]*\">", "<p>", s)
    s = s.replace("<b>", "<strong>").replace("</b>", "</strong>")
    s = s.replace("<i>", "<em>").replace("</i>", "</em>")
    # Links: keep href; external links open in a new tab with rel=noopener.
    def fix_a(m):
        attrs = m.group(1)
        href = re.search(r"href=\"([^\"]*)\"", attrs)
        blank = "target=\"_blank\"" in attrs
        out = f"<a href=\"{href.group(1)}\"" if href else "<a"
        if blank:
            out += " target=\"_blank\" rel=\"noopener\""
        return out + ">"
    s = re.sub(r"<a\s+([^>]*)>", fix_a, s)
    s = re.sub(r"\s*<br>\s*", "<br>", s)
    return s


def inner(pattern, text, flags=re.S):
    m = re.search(pattern, text, flags)
    if not m:
        raise SystemExit(f"pattern not found: {pattern[:80]}")
    return m.group(1)


def paragraphs(block):
    """Inner HTML of every <p> in a block, cleaned."""
    return [clean_inline(p) for p in re.findall(r"<p[^>]*>(.*?)</p>", block, re.S)]


# ---------------------------------------------------------------- media

media = {}


def media_id(path):
    stem = os.path.splitext(os.path.basename(path))[0]
    return "m-" + re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")


def artwork_title(path):
    stem = os.path.splitext(os.path.basename(path))[0]
    stem = re.sub(r"_WebTEXT$", "", stem)
    stem = re.sub(r"^\d+_", "", stem)
    if re.fullmatch(r"\d+", stem):
        return ""
    return stem.replace("_", " ").strip()


def add_media(path, alt=""):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        return None
    mid = media_id(path)
    if mid not in media:
        with Image.open(full) as im:
            w, h = im.size
        media[mid] = {"id": mid, "src": path, "w": w, "h": h, "alt": alt, "title": alt}
    return mid


ids = iter(range(1, 10_000))


def sid(prefix="s"):
    return f"{prefix}-{next(ids):04d}"


def section(type_, **kw):
    base = {"id": sid(), "type": type_, "width": None, "align": "left", "space": 48, "spaceAbove": 0}
    base.update(kw)
    return base


def gallery_item(mid, hidden=False, caption=""):
    return {"id": sid("gi"), "media": mid, "caption": caption, "alt": "", "link": "", "hidden": hidden}


def title_of(page_html):
    return html.unescape(inner(r"<title>(.*?)</title>", page_html))


pages = []

# ---------------------------------------------------------------- Painting (home)

idx = read("index.html")
arr = inner(r"const paintings = \[(.*?)\];", idx)
items = []
for line in arr.splitlines():
    m = re.search(r"(//\s*)?\"([^\"]+\.jpg)\"", line)
    if not m:
        continue
    hidden = bool(m.group(1))
    path = "images/" + m.group(2)
    mid = add_media(path, artwork_title(path))
    if mid:
        items.append(gallery_item(mid, hidden=hidden))

pages.append({
    "id": "p-painting", "kind": "page", "title": "Painting", "navTitle": "", "slug": "painting",
    "seoTitle": title_of(idx), "description": "", "width": None, "align": "left",
    "sections": [section("gallery", layout="stack", width=900, align="center", gap=34, items=items,
                         columns=1, aspect="original", captions=True, captionAlign="left",
                         lightbox=False, bleedMobile=True, autoplay=0, slideHeight=75, mobileGap=16)],
})

# ---------------------------------------------------------------- MFA 2021

mfa = read("exhibits-mfa-2021.html")
body = inner(r"<section class=\"exhibit-page\">(.*?)</section>", mfa)
secs = []
for block in re.finditer(r"<figure class=\"exhibit-figure\">(.*?)</figure>|<div class=\"exhibit-text\">(.*?)</div>", body, re.S):
    if block.group(1):
        src = inner(r"src=\"([^\"]+)\"", block.group(1))
        cap = clean_inline(inner(r"<figcaption>(.*?)</figcaption>", block.group(1)))
        cap = re.sub(r",\s*photograph by", ", photograph by", cap)
        secs.append(section("image", media=add_media(src), caption=cap, link="", newTab=False, lightbox=False))
    else:
        ps = paragraphs(block.group(2))
        secs.append(section("text", width=705, textAlign="justify", size="normal", lineHeight="tight",
                            html="".join(f"<p>{p}</p>" for p in ps)))
pages.append({
    "id": "p-mfa-2021", "kind": "page", "title": "MFA Class of 2021 Exhibition",
    "navTitle": "\"MFA CLASS OF\n2021 EXHIBITION\"", "slug": "exhibits-mfa-2021",
    "seoTitle": title_of(mfa), "description": "", "width": 900, "align": "center", "sections": secs,
})

# ---------------------------------------------------------------- During Dessert

dd = read("exhibits-during-dessert.html")
head = inner(r"<header class=\"exhibit-text exhibit-text--wide\">(.*?)</header>", dd)
count = int(inner(r"Array\.from\(\{ length: (\d+) \}", dd))
dd_items = []
for i in range(1, count + 1):
    mid = add_media(f"images/{i}.jpg")
    if mid:
        dd_items.append(gallery_item(mid))
pages.append({
    "id": "p-during-dessert", "kind": "page", "title": "During Dessert", "navTitle": "\"DURING DESSERT\"",
    "slug": "exhibits-during-dessert", "seoTitle": title_of(dd), "description": "", "width": None, "align": "left",
    "sections": [
        section("text", width=705, spaceAbove=40, textAlign="justify", size="normal", lineHeight="tight",
                html="".join(f"<p>{p}</p>" for p in paragraphs(head))),
        section("gallery", layout="stack", width=650, align="center", gap=48, items=dd_items, columns=1,
                aspect="original", captions=False, captionAlign="left", lightbox=False, bleedMobile=True,
                autoplay=0, slideHeight=75, mobileGap=48),
    ],
})

# ---------------------------------------------------------------- Art Writing (collection + articles)

listing = read("writing-about-art.html")
blog_id = "p-art-writing"
pages.append({
    "id": blog_id, "kind": "blog", "title": "Art Writing", "navTitle": "", "slug": "writing-about-art",
    "seoTitle": title_of(listing), "description": "", "width": None, "align": "left",
    "sections": [section("posts", width=780, blog=blog_id, showImage=True, showDate=True, showSubtitle=True,
                         showExcerpt=True, readMore="Read More →")],
})

for art in re.findall(r"<article class=\"post\">(.*?)</article>", listing, re.S):
    href = inner(r"class=\"read-more\" href=\"([^\"]+)\"", art)
    list_title = clean_inline(inner(r"<h2 class=\"post-title\">(.*?)</h2>", art))
    venue = clean_inline(inner(r"<p class=\"post-venue\">(.*?)</p>", art))
    date_text = squash(inner(r"<p class=\"date\">(.*?)</p>", art))
    iso = datetime.strptime(date_text, "%B %d, %Y").strftime("%Y-%m-%d")
    thumb = inner(r"<div class=\"post-image\">\s*<img src=\"([^\"]+)\"", art)
    blurb = clean_inline(re.findall(r"<p>(.*?)</p>", art, re.S)[-1])

    a = read(href)
    kicker = clean_inline(inner(r"<h1 class=\"kicker-title\">(.*?)</h1>", a))
    a_date = squash(inner(r"<p class=\"date\">(.*?)</p>", a))
    decks = [clean_inline(d) for d in re.findall(r"<p class=\"deck\"[^>]*>(.*?)</p>", a, re.S)]
    hero = inner(r"<div class=\"hero\">\s*<img src=\"([^\"]+)\"", a)
    caption = clean_inline(inner(r"<div class=\"caption\">(.*?)</div>", a))
    body_html = inner(r"<div class=\"body\">(.*?)</div>\s*</article>", a)
    body_ps = paragraphs(body_html)

    hero_id = add_media(hero)
    slug = href[:-5]
    pages.append({
        "id": "p-" + slug, "kind": "post", "parent": blog_id, "title": html.unescape(re.sub(r"<[^>]+>", "", list_title)),
        "navTitle": "", "slug": slug, "seoTitle": title_of(a), "description": "", "width": 980, "align": "left",
        "post": {"title": html.unescape(re.sub(r"<[^>]+>", "", list_title)),
                 "subtitle": html.unescape(re.sub(r"<[^>]+>", "", venue)),
                 "date": iso, "image": add_media(thumb), "excerpt": blurb, "draft": False},
        "sections": [
            section("text", space=10, size="normal", lineHeight="tight", textAlign="left",
                    html=f"<h1>{kicker}</h1><p class=\"muted\">{a_date}</p>"),
            section("text", width=760, space=24, size=14, lineHeight="normal", textAlign="left",
                    html="".join(f"<p>{d}</p>" for d in decks)),
            section("image", space=24, media=hero_id, caption=caption, captionStyle="small", link="", newTab=False, lightbox=False),
            section("text", width=900, size="small", lineHeight="loose", textAlign="left",
                    html="".join(f"<p>{p}</p>" for p in body_ps)),
        ],
    })

# ---------------------------------------------------------------- Contact

contact = read("contact.html")
cblock = inner(r"<div class=\"contact-block\">(.*?)</div>", contact)
pages.append({
    "id": "p-contact", "kind": "page", "title": "Contact", "navTitle": "", "slug": "contact",
    "seoTitle": title_of(contact), "description": "", "width": None, "align": "left",
    "sections": [section("text", width=600, size=14, lineHeight="normal", textAlign="left",
                         html="".join(f"<p>{p}</p>" for p in paragraphs(cblock)))],
})

# ---------------------------------------------------------------- CV

cv = read("cv.html")
groups = []
for sec_html in re.findall(r"<section class=\"cv-section\">(.*?)</section>", cv, re.S):
    heading = html.unescape(squash(inner(r"<h2 class=\"cv-heading\">(.*?)</h2>", sec_html)))
    entries = []
    for year, text in re.findall(r"<div class=\"cv-year\">(.*?)</div>\s*<div class=\"cv-text\">(.*?)</div>", sec_html, re.S):
        entries.append({"id": sid("i"), "year": html.unescape(squash(year)), "html": clean_inline(text)})
    groups.append({"id": sid("g"), "heading": heading, "items": entries})
pages.append({
    "id": "p-cv", "kind": "page", "title": "CV", "navTitle": "", "slug": "cv",
    "seoTitle": title_of(cv), "description": "", "width": None, "align": "left",
    "sections": [section("cv", width=800, groups=groups)],
})

# ---------------------------------------------------------------- old placeholder pages (kept so their URLs keep working)

for slug, title in (("exhibits", "Exhibits"), ("writing", "Writing")):
    old = read(f"{slug}.html")
    text = paragraphs(inner(r"<div class=\"page-block\">(.*?)</div>", old))
    pages.append({
        "id": f"p-{slug}", "kind": "page", "title": title, "navTitle": "", "slug": slug,
        "seoTitle": title_of(old), "description": "", "width": None, "align": "left",
        "sections": [section("text", size="normal", lineHeight="tight", textAlign="left", html="".join(f"<p>{p}</p>" for p in text))],
    })

# ---------------------------------------------------------------- nav, settings

nav = [
    {"id": "n-1", "type": "page", "page": "p-painting"},
    {"id": "n-2", "type": "folder", "label": "Exhibits", "children": [
        {"id": "n-3", "type": "page", "page": "p-mfa-2021"},
        {"id": "n-4", "type": "page", "page": "p-during-dessert"},
    ]},
    {"id": "n-5", "type": "page", "page": blog_id},
    {"id": "n-6", "type": "spacer"},
    {"id": "n-7", "type": "page", "page": "p-contact"},
    {"id": "n-8", "type": "page", "page": "p-cv"},
]

site = {
    "version": 1,
    "settings": {
        "siteName": "Joni Sullivan",
        "headerTitle": "JONI\nSULLIVAN",
        "titleFormat": "{site} — {page}",
        "description": "",
        "language": "en",
        "homePage": "p-painting",
        "url": "https://www.jonisullivan.com",
        "socialImage": None,
        "favicon": None,
        "footer": "",
        "goatcounter": "",
        "formEndpoint": "",
    },
    "design": {},
    "nav": nav,
    "pages": pages,
    "media": dict(sorted(media.items())),
    "redirects": [],
}

os.makedirs(os.path.join(ROOT, "content"), exist_ok=True)
with open(os.path.join(ROOT, "content", "site.json"), "w", encoding="utf-8") as f:
    json.dump(site, f, ensure_ascii=False, indent=1)
    f.write("\n")

print(f"pages: {len(pages)}  media: {len(media)}  painting items: {len(items)} "
      f"(hidden {sum(i['hidden'] for i in items)})  dessert: {len(dd_items)}  cv groups: {len(groups)} "
      f"({sum(len(g['items']) for g in groups)} entries)", file=sys.stderr)
