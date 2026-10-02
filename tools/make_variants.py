#!/usr/bin/env python3
"""Give existing large images a 1200px-wide copy, like the editor does for new uploads.

Run from the repo root:  python3 tools/make_variants.py
For every image in content/site.json wider than 1500px without a `medium` copy, writes
<name>-1200.<ext> next to it (same format, color profile kept) and records it in site.json.
Pages then offer both sizes, so phones and ordinary screens download the small one.
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "content", "site.json")
THRESHOLD, WIDTH = 1500, 1200

with open(SITE, encoding="utf-8") as f:
    site = json.load(f)

made = 0
for m in site["media"].values():
    if m.get("medium") or m.get("w", 0) <= THRESHOLD:
        continue
    src = os.path.join(ROOT, m["src"])
    stem, ext = os.path.splitext(m["src"])
    out_rel = f"{stem}-{WIDTH}{ext}"
    out = os.path.join(ROOT, out_rel)
    with Image.open(src) as im:
        icc = im.info.get("icc_profile")
        h = round(im.height * WIDTH / im.width)
        small = im.convert("RGB").resize((WIDTH, h), Image.LANCZOS)
        kw = {"quality": 86, "optimize": True}
        if icc:
            kw["icc_profile"] = icc
        if ext.lower() == ".webp":
            small.save(out, "WEBP", **kw)
        else:
            small.save(out, "JPEG", progressive=True, **kw)
    m["medium"] = {"src": out_rel, "w": WIDTH, "h": h}
    made += 1
    print(f"{m['src']} ({m['w']}px, {os.path.getsize(src) // 1024} KB) -> {out_rel} ({os.path.getsize(out) // 1024} KB)")

with open(SITE, "w", encoding="utf-8") as f:
    json.dump(site, f, ensure_ascii=False, indent=1)
    f.write("\n")
print(f"{made} copies made")
