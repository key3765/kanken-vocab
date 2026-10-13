# -*- coding: utf-8 -*-
"""データ生成に使う公開データを tools/.cache/ に取ってくる（公開時には不要）。
     python tools/fetch_sources.py

   - Kanjium (CC BY-SA 4.0)   漢検の級・常用音訓・部首・画数・部品・形の似た字・語彙（誤答の重複よけ）
     https://github.com/mifunetoshiro/kanjium
   - KanjiVG (CC BY-SA 3.0)   筆順（画ごとの線）
     https://kanjivg.tagaini.net/
"""
import gzip
import io
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")

KANJIUM = "https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/"
KANJIUM_FILES = ["kanjidict.txt", "radicals.txt", "radicals_variants.txt", "jukugo.txt",
                 "lookalikes.txt", "elements.txt"]
KANJIVG_LATEST = "https://api.github.com/repos/KanjiVG/kanjivg/releases/latest"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "kanken-vocab-build"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main():
    os.makedirs(CACHE, exist_ok=True)
    for name in KANJIUM_FILES:
        with open(os.path.join(CACHE, name), "wb") as f:
            f.write(get(KANJIUM + name))
        print("ok", name)

    rel = json.loads(get(KANJIVG_LATEST))
    asset = [a for a in rel["assets"] if a["name"].endswith(".xml.gz")][0]
    raw = gzip.GzipFile(fileobj=io.BytesIO(get(asset["browser_download_url"]))).read()
    with open(os.path.join(CACHE, "kanjivg.xml"), "wb") as f:
        f.write(raw)
    print("ok kanjivg.xml", rel["tag_name"])


if __name__ == "__main__":
    main()
