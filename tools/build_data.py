# -*- coding: utf-8 -*-
"""data/*.js を作り直す。
     python tools/fetch_sources.py     # 初回だけ（tools/.cache/ に公開データを取る）
     python tools/build_data.py        # src/*.tsv と公開データから data/*.js を作る
     python tools/build_data.py --sheet 3   # その級の字と常用音訓の一覧を出す（例文を書くときの下書き用）

   手で書くのは src/ の TSV だけ。読み・部首・画数・筆順は公開データから取り、
   誤答の選択肢（同音の字・形の似た字・読みのずらし・送り仮名のずらし）はここで作る。
"""
import argparse
import json
import os
import random
import re
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache")
SRC = os.path.join(ROOT, "src")
OUT = os.path.join(ROOT, "data")

# アプリで扱う級。表示順。値は kanjidict.txt の kanken 列
LEVELS = [("3", "3"), ("p2", "pre-2"), ("2", "2"), ("p1", "pre-1"), ("1", "1")]
LEVEL_NAME = {"3": "3級", "p2": "準2級", "2": "2級", "p1": "準1級", "1": "1級"}
WIDE = {"p1", "1"}      # 常用音訓に限らず、表外の音訓まで使う級
# kanken 列の値を易しい順に並べた位置。語の級を決めるのに使う
RANK = {v: i for i, v in enumerate(["10", "9", "8", "7", "6", "5", "4", "3", "pre-2", "2", "pre-1", "1"])}

# 常用漢字表の字体 → 画面に出す字体（どちらも常用漢字表に載る。許容字体のほうが端末で化けにくい）
DISPLAY = {"𠮟": "叱", "塡": "填", "剝": "剥", "頰": "頬"}
# 2級の行に紛れている、常用漢字ではない異体字
NOT_JOYO = {"喻", "𥡴", "䇳"}

# 部首の字のうち、端末によって表示できない字（部首補助・互換漢字・拡張領域）を、
# 漢検でふつうに使われる字形に置き換える。部首名は元のまま（⺼→月 は「にくづき」）。
RADICAL_GLYPH = {
    "⺼": "月", "⻖": "阝", "⻏": "阝", "⺮": "竹", "⻗": "雨", "⺩": "王", "辶": "辶", "爫": "爫",
    "𧾷": "足", "𠆢": "人", "𩙿": "食", "飠": "食", "𦍌": "羊", "⺌": "小", "⺍": "小", "⺧": "牛",
    "𤴔": "疋", "𠘨": "几", "㔾": "卩", "羽": "羽", "㣺": "心", "釒": "金", "訁": "言",
}


def rad_glyph(c):
    return RADICAL_GLYPH.get(c, c)


random.seed(20261013)   # 何度作り直しても誤答の候補が変わらないように


# ---------------------------------------------------------------- かな
def kata2hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def hira2kata(s):
    return "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in s)


VOICE = {}
for a, b in zip("かきくけこさしすせそたちつてとはひふへほ", "がぎぐげござじずぜぞだぢづでどばびぶべぼ"):
    VOICE[a] = [b]
    VOICE[b] = [a]
for a, b in zip("はひふへほ", "ぱぴぷぺぽ"):
    VOICE[a].append(b)
    VOICE.setdefault(b, []).extend([a])
SMALL = set("ゃゅょぁぃぅぇぉ")
LONGABLE = set("おこそとのほもよろごぞどぼぽうくすつぬふむゆるぐずぶぷょゅ")
KANA = re.compile(r"^[ぁ-ゖー]+$")


def is_kanji(c):
    return "一" <= c <= "鿿" or "㐀" <= c <= "䶿" or ord(c) >= 0x20000 or c == "々"


# ---------------------------------------------------------------- 読み込み
def read_tsv(path):
    with open(path, encoding="utf-8-sig") as f:
        return [l.rstrip("\n").split("\t") for l in f if l.strip()]


def parse_kun(s):
    """「あわ（れむ）」→ ("あわ", "れむ")。送り仮名が無ければ okuri は ""。"""
    out = []
    for part in re.split("[、,]", s):
        part = part.strip().replace("*", "")
        if not part or part.startswith("-") or part.endswith("-"):
            continue
        m = re.match(r"^([ぁ-ゖ]+)（([ぁ-ゖ]+)）$", part)
        if m:
            out.append((m.group(1), m.group(2)))
        elif KANA.match(part):
            out.append((part, ""))
    return out


def parse_on(s):
    return [p.strip().replace("*", "") for p in re.split("[、,]", s) if p.strip()]


def load_kanjidict():
    rows = {}
    for r in read_tsv(os.path.join(CACHE, "kanjidict.txt")):
        if r[0] == "kanji":
            continue
        rows[r[0]] = {
            "k": r[0], "rad": r[1], "radvar": r[2], "phon": r[3],
            "on": parse_on(r[6]), "kun": parse_kun(r[7]),
            # 表外の音訓も含めた全部（準1級・1級で使う）。音の (漢)(呉) などの注記は外す
            "on_all": uniq(parse_on(re.sub(r"\(.*?\)", "", r[8])) + parse_on(r[6])),
            "kun_all": uniq(parse_kun(r[9]) + parse_kun(r[7])),
            "st": int(r[11]) if r[11].isdigit() else 0,
            "grade": r[12], "kanken": r[14], "en": r[16],
        }
    return rows


def jis_level(c):
    """JIS X 0208 の第1水準なら 1、第2水準なら 2、どちらでもなければ 0。"""
    try:
        b = c.encode("shift_jis")
    except UnicodeEncodeError:
        return 0
    if len(b) != 2:
        return 0
    v = b[0] << 8 | b[1]
    return 1 if 0x889F <= v <= 0x9872 else 2 if 0x989F <= v <= 0xEAA4 else 0


def load_radicals():
    names = {}
    for r in read_tsv(os.path.join(CACHE, "radicals.txt")):
        if r[0] == "radical":
            continue
        names[r[0]] = r[4]
        for v in r[1].split(","):
            if v.strip():
                names.setdefault(v.strip(), r[4])
    for r in read_tsv(os.path.join(CACHE, "radicals_variants.txt")):
        if r[0] == "radvar":
            continue
        names[r[0]] = r[4]       # 変形のほうが固有の呼び名を持つ（扌=てへん など）
    return names


def load_lookalikes():
    out = {}
    for r in read_tsv(os.path.join(CACHE, "lookalikes.txt")):
        if len(r) > 1 and r[1]:
            out[r[0]] = [x for x in r[1].split(",") if x]
    return out


def load_parts():
    out = {}
    for r in read_tsv(os.path.join(CACHE, "elements.txt")):
        k = r[0].lstrip("﻿")
        out[k] = [x for x in (r[6].split(",") if len(r) > 6 else []) if x]
    return out


def load_words():
    words = set()
    for r in read_tsv(os.path.join(CACHE, "jukugo.txt")):
        if len(r) > 3:
            words.add((r[2], r[3]))
    return words


def load_strokes(chars):
    """KanjiVG から、指定した字の画（SVG の path d）を筆順どおりに取り出す。"""
    want = {"kvg:kanji_%05x" % ord(c): c for c in chars}
    out = {}
    for _, node in ET.iterparse(os.path.join(CACHE, "kanjivg.xml"), events=("end",)):
        if node.tag != "kanji":
            continue
        c = want.get(node.get("id"))
        if c:
            paths = []
            for p in node.iter("path"):
                m = re.search(r"-s(\d+)$", p.get("id", ""))
                if m:
                    paths.append((int(m.group(1)), p.get("d")))
            paths.sort()
            out[c] = [compact_path(d) for _, d in paths]
        node.clear()
    return out


def compact_path(d):
    d = re.sub(r"(\d+\.\d)\d+", r"\1", d)     # 109 四方の座標なので小数1桁で十分
    d = re.sub(r"\s*,\s*", ",", d)
    d = re.sub(r"\s+", " ", d).strip()
    return d


# ---------------------------------------------------------------- 字の一覧
def build_kanji_table(kd):
    """アプリで扱う字（級ごと）と、常用漢字全体（誤答・語の検証に使う）を返す。"""
    joyo = {}
    for c, r in kd.items():
        if r["kanken"] in RANK and RANK[r["kanken"]] <= RANK["2"] and c not in NOT_JOYO:
            if r["kanken"] == "2" and c in DISPLAY.values():
                continue      # 叱・填 などは常用漢字表の字体の行（𠮟 など）から取る
            joyo[DISPLAY.get(c, c)] = dict(r, k=DISPLAY.get(c, c), alt=c if c in DISPLAY else "")
    for c in DISPLAY.values():
        joyo[c]["st"] = kd[c]["st"]      # 画数は画面に出す字体のもの
    # 準1級・1級。元データには常用漢字・人名用漢字の旧字体（國・亞 など）や、JIS にない字体（俠 など）も
    # 同じ級として入っているので、旧字体・異体字の行と、JIS 第1・第2水準にない字は除く
    for c, r in kd.items():
        if r["kanken"] in ("pre-1", "1") and "variant" not in r["grade"] and "Kyū" not in r["grade"] \
                and jis_level(c):
            joyo[c] = dict(r, alt="")
    app_lv = {src: lv for lv, src in LEVELS}
    for c, r in joyo.items():
        r["lv_app"] = app_lv.get(r["kanken"], "")
    target = {lv: [c for c, r in joyo.items() if r["kanken"] == src] for lv, src in LEVELS}
    return joyo, target


def kun_readings(r):
    return [stem + okuri for stem, okuri in r["kun"]]


def on_hira(r):
    return [kata2hira(x) for x in r["on"]]


def reading_variants(base):
    """連濁・促音化した形も含めた、字の読みの候補。"""
    out = {base}
    if base and base[0] in VOICE:
        out.update(v + base[1:] for v in VOICE[base[0]])
    if len(base) > 1 and base[-1] in "くつちき":
        out.update(x[:-1] + "っ" for x in list(out))     # 八 はち → ばっ（七転八倒）
    return out


I_ROW = dict(zip("うくぐすつぬぶむる", "いきぎしちにびみり"))


def char_readings(r):
    s = set()
    for x in on_hira(r):
        s |= reading_variants(x)
    for stem, okuri in r["kun"]:
        s |= reading_variants(stem)
        s |= reading_variants(stem + okuri)
        if okuri and okuri[-1] in I_ROW:
            # 名詞になった形（詰める→缶詰の「づめ」、挿す→挿絵の「さし」）
            s |= reading_variants(stem + okuri[:-1] + I_ROW[okuri[-1]])
            if okuri[-1] == "る" and len(okuri) > 1:
                s |= reading_variants(stem + okuri[:-1])
    return s


# ---------------------------------------------------------------- 誤答づくり
def perturb_reading(r):
    """読みを1か所だけずらした形（濁点・長音・促音）。漢検の読みで間違えやすい型。"""
    out = []
    for i, c in enumerate(r):
        for v in VOICE.get(c, []):
            if v in "ぢづ":
                continue
            out.append(r[:i] + v + r[i + 1:])
        nxt = r[i + 1] if i + 1 < len(r) else ""
        if c in LONGABLE and nxt == "う":
            out.append(r[:i + 1] + r[i + 2:])
        elif c in LONGABLE and 0 < i < len(r) - 1 and nxt not in SMALL and nxt != "う" and nxt != "ん":
            out.append(r[:i + 1] + "う" + r[i + 1:])
        if c == "っ":
            out.append(r[:i] + "く" + r[i + 1:])
            out.append(r[:i] + "つ" + r[i + 1:])
        if c in "くつちき" and 0 < i < len(r) - 1 and r[i - 1] != "っ" and nxt and nxt in "かきくけこさしすせそたちつてとぱぴぷぺぽ":
            out.append(r[:i] + "っ" + r[i + 1:])
        if c == "ゅ":
            out.append(r[:i] + "ょ" + r[i + 1:])
        if c == "ょ":
            out.append(r[:i] + "ゅ" + r[i + 1:])
    return out


def uniq(seq, exclude=()):
    seen, out = set(exclude), []
    for x in seq:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


class Distractors:
    def __init__(self, joyo, looks, words):
        self.joyo = joyo
        self.looks = looks
        self.words = words
        self.by_on = {}
        self.by_phon = {}
        self.by_rad = {}
        self.by_kun = {}
        self.kun_by_okuri = {}
        self._rd = {}
        for c, r in joyo.items():
            for x in on_hira(r):
                self.by_on.setdefault(x, []).append(c)
            if r["phon"]:
                self.by_phon.setdefault(r["phon"], []).append(c)
            self.by_rad.setdefault(r["rad"], []).append(c)
            for stem, okuri in r["kun"]:
                self.by_kun.setdefault(stem + okuri, []).append(c)
                self.kun_by_okuri.setdefault(okuri, []).append(stem)

    def readings_of(self, c):
        """字の読みの候補（連濁・促音化を含む）。表に無い字は空。"""
        if c not in self._rd:
            self._rd[c] = char_readings(self.joyo[c]) if c in self.joyo else set()
        return self._rd[c]

    def similar_chars(self, k):
        """形が似た字・同じ音符を持つ字（常用漢字のみ）。"""
        r = self.joyo[k]
        cand = [DISPLAY.get(x, x) for x in self.looks.get(r.get("alt") or k, [])]
        if r["phon"]:
            cand += self.by_phon.get(r["phon"], [])
        return [c for c in uniq(cand) if c in self.joyo and c != k]

    def same_radical(self, k):
        """同じ部首で画数の近い字。形の似た字が無いときの控え。"""
        r = self.joyo[k]
        cand = [c for c in self.by_rad.get(r["rad"], []) if c != k]
        cand.sort(key=lambda c: abs(self.joyo[c]["st"] - r["st"]))
        return cand[:12]

    def segment(self, w, r):
        """語の読みを1字ずつに割る（例 慰問/いもん → [(慰,い),(問,もん)]）。割れなければ None。"""
        cands = self.readings_of

        memo = {}

        def go(i, j):
            if i == len(w):
                return [] if j == len(r) else None
            key = (i, j)
            if key in memo:
                return memo[key]
            c = w[i]
            res = None
            if not is_kanji(c):
                if r[j:j + 1] == c:
                    rest = go(i + 1, j + 1)
                    res = None if rest is None else [(c, c)] + rest
            else:
                opts = cands(w[i - 1]) if c == "々" and i > 0 else cands(c)
                for x in sorted(opts, key=lambda s: (-len(s), s)):   # 長い読みから。同じ長さは五十音順（毎回同じ結果にする）
                    if x and r.startswith(x, j):
                        rest = go(i + 1, j + len(x))
                        if rest is not None:
                            res = [(c, x)] + rest
                            break
            memo[key] = res
            return res

        return go(0, 0)

    def homophones(self, k, reading):
        """この語での k の読みと同じ読みを持つ常用漢字。"""
        r = self.joyo[k]
        out = []
        for x in on_hira(r):
            if any(v in reading for v in reading_variants(x)):
                out += self.by_on.get(x, [])
        for stem, okuri in r["kun"]:
            if (stem + okuri) in reading or stem in reading:
                out += self.by_kun.get(stem + okuri, [])
        out = [c for c in uniq(out) if c != k]
        if len(out) < 3:
            for x in on_hira(r):      # 訓で読む語でも、字の音が同じ字を控えにする
                out += [c for c in self.by_on.get(x, []) if c != k and c not in out]
        if len(out) < 3:
            for x in on_hira(r):      # それでも足りなければ濁点だけ違う音の字（辱 ジョク → 職 ショク）
                for v in sorted(reading_variants(x) - {x}):
                    out += [c for c in self.by_on.get(v, []) if c != k and c not in out]
        return out

    def writing(self, k, w, r):
        """書き取り: k を同音の字・形の似た字に置き換えた誤った書き方。"""
        i = w.index(k)
        cands = self.homophones(k, r)
        random.shuffle(cands)
        sims = self.similar_chars(k)
        pool = cands[:3] + sims[:2] + cands[3:] + sims[2:] + self.same_radical(k)
        pool += self.sound_alikes(k)
        out = []
        for c in pool:
            bad = w[:i] + c + w[i + 1:]
            if (bad, r) in self.words:
                continue       # 同じ読みで実在する語は正解と紛らわしいので外す
            out.append(bad)
        return uniq(out, [w])[:5]

    def sound_alikes(self, k):
        """最後の控え: 読みの頭のかなと長さが同じ字（串 くし → 草 くさ、鬱 うつ → 運 うん）。"""
        r = self.joyo[k]
        mine = on_hira(r) + [s for s, _ in r["kun"]]
        out = []
        for x in mine:
            for key, cs in list(self.by_on.items()) + [(s, self.by_kun.get(s, [])) for s in self.kun_by_okuri.get("", [])]:
                if key != x and len(key) == len(x) and key[0] == x[0]:
                    out += cs
        out = [c for c in uniq(out) if c != k]
        random.shuffle(out)
        return out[:8]

    def reading(self, k, w, r):
        """読み: 形の似た字の音で読んだ誤り・1か所ずらした読み・送り仮名の同じ別の訓。"""
        first, second, last = [], [], []
        okuri = re.search(r"[ぁ-ゖ]+$", w)
        if len(w) == 1:
            # 1字の訓（麻＝あさ など）は、同じ長さの別の字の訓と取り違える形にする
            nouns = [s for s in self.kun_by_okuri.get("", []) if len(s) == len(r) and s != r]
            random.shuffle(nouns)
            first += nouns[:4]
        if okuri and len(w) - len(okuri.group(0)) == 1:
            ok = okuri.group(0)
            stem_len = len(r) - len(ok)
            stems = [s for s in self.kun_by_okuri.get(ok, []) if abs(len(s) - stem_len) <= 1]
            random.shuffle(stems)
            first += [s + ok for s in stems[:4]]

        segs = self.segment(w, r)
        if not segs:
            # 熟字訓（叔父＝おじ など）。字ごとの音読み・訓読みでそのまま読んだ誤りを出す
            ons = [(on_hira(self.joyo[c]) or [s for s, _ in self.joyo[c]["kun"]]) + [s for s, _ in self.joyo[c]["kun"]]
                   if c in self.joyo else [] for c in w]
            if all(ons):
                plain = "".join(o[0] for o in ons)
                first += [plain] + [v + plain[1:] for v in VOICE.get(plain[0], [])]
                first += [plain[:-1] + v for v in VOICE.get(plain[-1], [])]
                for i, o in enumerate(ons):      # 字の別の音で読んだ形（硫黄 → りゅうこう）
                    first += ["".join(x[0] for x in ons[:i]) + y + "".join(x[0] for x in ons[i + 1:])
                              for y in o[1:]]
        if segs:
            # 1字ずつ、その字の別の音・形の似た字の音に読み替える（見出しの字を優先）
            order = sorted(range(len(segs)), key=lambda i: segs[i][0] != k)
            for i in order:
                c, part = segs[i]
                if c not in self.joyo:
                    continue
                alts = [x for x in on_hira(self.joyo[c]) if x != part]
                for s in self.similar_chars(c)[:5]:
                    alts += on_hira(self.joyo[s])[:1]
                rad_alts = []
                for s in self.same_radical(c):
                    rad_alts += on_hira(self.joyo[s])[:1]
                head = "".join(p for _, p in segs[:i])
                tail = "".join(p for _, p in segs[i + 1:])
                bucket = first if c == k else second
                bucket += [head + a + tail for a in uniq(alts, [part])]
                last += [head + a + tail for a in uniq(rad_alts, [part])][:3]
        if segs:
            # 最後の控え: 見出しの字の読みを、頭のかなと長さが同じ別の音にする
            for i, (c, part) in enumerate(segs):
                if c != k or not part:
                    continue
                head = "".join(p for _, p in segs[:i])
                tail = "".join(p for _, p in segs[i + 1:])
                keys = [x for x in self.by_on if x != part and len(x) == len(part) and x[0] == part[0]]
                random.shuffle(keys)
                last += [head + x + tail for x in keys[:4]]
        random.shuffle(first)
        random.shuffle(second)
        p = perturb_reading(r)
        random.shuffle(p)
        out = first[:2] + second[:1] + p[:2] + first[2:] + second[1:] + p[2:] + last
        return uniq(out, [r])[:5]

    def okurigana(self, k, w, r):
        """送り仮名: 区切りを前後にずらした誤り（例 哀れむ → 哀む・哀われむ・哀）。"""
        m = re.match(r"^(.)([ぁ-ゖ]+)$", w)
        if not m or m.group(1) != k:
            return []
        ok = m.group(2)
        cut = len(r) - len(ok)            # 正しい区切りの位置
        # 1つ後ろ・1つ前・送り仮名なし・2つ前、の順に採る
        order = [cut + 1, cut - 1, len(r), cut - 2]
        out = [k + r[j:] for j in order if 0 <= j <= len(r) and j != cut]
        return uniq(out, [w])[:3]

    def radical(self, k, parts, names, correct):
        base = self.joyo[k]["rad"]
        out = [p for p in parts if p in names and p not in (correct, base)]
        common = ["口", "木", "氵", "扌", "亻", "言", "糸", "心", "忄", "艹", "宀", "土", "日", "月", "辶",
                  "阝", "刂", "力", "又", "女", "貝", "頁", "攵", "灬", "衣", "示", "一", "丶", "丿", "十"]
        random.shuffle(common)
        out += [c for c in common if c not in k and c not in (correct, base)]
        return uniq([rad_glyph(x) for x in out], [rad_glyph(correct)])[:5]


# ---------------------------------------------------------------- TSV（手書きの部分）
def read_kanji_src(lv):
    path = os.path.join(SRC, "kanji-%s.tsv" % lv)
    if not os.path.exists(path):
        return {}
    out = {}
    for r in read_tsv(path):
        if r[0].startswith("#"):
            continue
        k, meaning, exs = r[0], r[1], []
        for cell in r[2:]:
            if not cell:
                continue
            w, rd, s = cell.split("|")
            exs.append((w, rd, s))
        out[k] = (meaning, exs)
    return out


def kanji_level(word, joyo):
    """語に含まれる字のうち最も難しい字の級（アプリの級コード。4級以下だけなら "3"）。"""
    rank = max([RANK[joyo[c]["kanken"]] for c in word if c in joyo] or [0])
    for lv, src in reversed(LEVELS):
        if rank >= RANK[src]:
            return lv
    return "3"


def check_text(text, tab, warn, where):
    """tab に無い字（3〜2級なら常用漢字でない字、準1級なら準1級までに無い字）を知らせる。"""
    for c in text:
        if is_kanji(c) and c != "々" and c not in tab:
            warn.append("%s: %s字「%s」" % (where, "常用漢字でない" if len(tab) < 3000 else "この級までに無い", c))


def widen(tab):
    """表外の音訓まで読みに入れた表（準1級・1級の語の読みの割り付けと誤答づくりに使う）。"""
    return {c: dict(r, on=uniq(r["on"] + r["on_all"]), kun=uniq(r["kun"] + r["kun_all"])) for c, r in tab.items()}


def level_tables(chars):
    """級ごとの、使ってよい字の表と誤答づくり。3〜2級は常用漢字だけ・常用音訓だけで作る。"""
    joyo = {c: r for c, r in chars.items() if RANK[r["kanken"]] <= RANK["2"]}
    p1 = widen({c: r for c, r in chars.items() if RANK[r["kanken"]] <= RANK["pre-1"]})
    al = widen(chars)
    return {"3": joyo, "p2": joyo, "2": joyo, "p1": p1, "1": al}


# ---------------------------------------------------------------- 本体
def build():
    kd = load_kanjidict()
    chars, target = build_kanji_table(kd)
    names = load_radicals()
    looks = load_lookalikes()
    parts = load_parts()
    words = load_words()
    TAB = level_tables(chars)
    DIS = {}
    for lv, _ in LEVELS:
        same = [x for x in DIS if TAB[x] is TAB[lv]]
        DIS[lv] = DIS[same[0]] if same else Distractors(TAB[lv], looks, words)
    warn = []
    notes = []      # 直さなくてよいお知らせ（--strict でも失敗にしない）

    kanji_out = []
    all_chars = []
    for lv, _ in LEVELS:
        src = read_kanji_src(lv)
        missing = [c for c in target[lv] if c not in src]
        if missing:
            warn.append("%s: 例文が未作成の字 %d 字（%s…）" % (LEVEL_NAME[lv], len(missing), "".join(missing[:20])))
        extra = [c for c in src if c not in target[lv]]
        if extra:
            warn.append("%s: この級ではない字が TSV にある（%s）" % (LEVEL_NAME[lv], "".join(extra)))
        for k in target[lv]:
            if k not in src:
                continue
            joyo, dis = TAB[lv], DIS[lv]
            r = joyo[k]
            meaning, exs = src[k]
            rad = r["radvar"].split(",")[0] if r["radvar"] and r["radvar"].split(",")[0] else r["rad"]
            radn = names.get(rad) or names.get(r["rad"], "")
            ex_out = []
            readings = char_readings(r)
            for w, rd, s in exs:
                jukuji = rd.startswith("*")      # 熟字訓・付表の語（叔父 おじ など）
                rd = rd.lstrip("*")
                where = "%s「%s」" % (k, w)
                if k not in w:
                    warn.append(where + ": 見出しの字を含まない")
                    continue
                if s.count("{" + w + "}") != 1:
                    warn.append(where + ": 例文に {" + w + "} が1回だけ入っていない")
                if not KANA.match(rd):
                    warn.append(where + ": 読みがひらがなでない")
                if not jukuji and not any(x in rd for x in readings):
                    warn.append(where + ": 読み「%s」に %s の%s音訓（%s）が見当たらない"
                                % (rd, k, "" if lv in WIDE else "常用",
                                   "・".join(sorted(on_hira(r) + kun_readings(r)))))
                check_text(w + s, joyo, warn, where)
                if RANK[chars[k]["kanken"]] < max(RANK[chars[c]["kanken"]] for c in w if c in chars):
                    warn.append(where + ": 語に見出しより上の級の字が入っている")
                row = [w, rd, s, dis.reading(k, w, rd), dis.writing(k, w, rd)]
                og = dis.okurigana(k, w, rd)
                if og:
                    row.append(og)
                if len(row[3]) < 3:
                    warn.append(where + ": 読みの誤答が3つ作れない")
                if len(row[4]) < 3:
                    warn.append(where + ": 書き取りの誤答が3つ作れない")
                ex_out.append(row)
            item = {
                "k": k, "lv": lv,
                "on": r["on"],
                "kun": [stem + ("-" + okuri if okuri else "") for stem, okuri in r["kun"]],
                "rad": rad_glyph(rad), "radn": radn,
                "rd": dis.radical(k, parts.get(r.get("alt") or k, []) + parts.get(k, []), names, rad),
                "st": r["st"],
                "m": meaning,
                "ex": ex_out,
            }
            if r.get("alt"):
                item["alt"] = r["alt"]
            kanji_out.append(item)
            all_chars.append(k)

    # 四字熟語・対義語・類義語。語の級（含む字のうち最も難しい字の級）の表で検査し、誤答を作る
    yoji_out, pair_out = [], []
    yp = os.path.join(SRC, "yoji.tsv")
    if os.path.exists(yp):
        for r in read_tsv(yp):
            if r[0].startswith("#"):
                continue
            w, rd, m = r[0], r[1], r[2]
            segs = rd.split("・")
            where = "四字熟語「%s」" % w
            if len(w) != 4 or len(segs) != 4:
                warn.append(where + ": 4字・4区切りになっていない")
                continue
            lv = kanji_level(w, chars)
            joyo, dis = TAB[lv], DIS[lv]
            check_text(w, joyo, warn, where)
            blanks = []
            for i, c in enumerate(w):
                if c not in joyo:
                    blanks.append([])
                    continue
                if segs[i] not in dis.readings_of(c):
                    warn.append(where + ": 「%s」の読み「%s」が%s音訓にない" % (c, segs[i], "" if lv in WIDE else "常用"))
                cand = [x for x in dis.by_on.get(segs[i], []) + dis.by_kun.get(segs[i], []) if x != c]
                cand = uniq(cand)
                random.shuffle(cand)
                cand += [x for x in dis.similar_chars(c) if x not in cand]
                blanks.append(cand[:5])
            yoji_out.append({"w": w, "r": segs, "m": m, "lv": lv, "d": blanks})
    pp = os.path.join(SRC, "pairs.tsv")
    if os.path.exists(pp):
        for r in read_tsv(pp):
            if r[0].startswith("#"):
                continue
            t, a, ar, b, br = r[:5]
            where = "%s「%s／%s」" % ("対義語" if t == "対" else "類義語", a, b)
            lv = kanji_level(a + b, chars)
            check_text(a + b, TAB[lv], warn, where)
            for x, xr in ((a, ar), (b, br)):
                if not DIS[lv].segment(x, xr):
                    warn.append(where + ": 「%s」の読み「%s」を%s音訓で割り切れない" % (x, xr, "" if lv in WIDE else "常用"))
            pair_out.append({"t": t, "a": a, "ar": ar, "b": b, "br": br, "lv": lv})

    strokes = load_strokes([chars[c].get("alt") or c for c in all_chars] + all_chars)
    stroke_out = {}
    no_stroke = {}
    st_note = {}
    for c in all_chars:
        lv = chars[c]["lv_app"]
        s = strokes.get(c)
        if not s:
            if lv in WIDE:
                no_stroke.setdefault(lv, []).append(c)      # 表外の字は KanjiVG に無いものがある。筆順の問題から外す
            else:
                warn.append("%s: KanjiVG に筆順が無い" % c)
            continue
        if len(s) != chars[c]["st"]:
            st_note.setdefault(lv, []).append("%s（%d→%d）" % (c, chars[c]["st"], len(s)))
        stroke_out[c] = s
    for lv, _ in LEVELS:
        if st_note.get(lv):
            notes.append("%s: 漢字表と KanjiVG で画数が違う %d 字。KanjiVG の画数に合わせた: %s"
                         % (LEVEL_NAME[lv], len(st_note[lv]), "、".join(st_note[lv][:30]) + ("…" if len(st_note[lv]) > 30 else "")))
        if no_stroke.get(lv):
            notes.append("%s: KanjiVG に筆順が無い %d 字（筆順の表示と問題から外す）: %s"
                         % (LEVEL_NAME[lv], len(no_stroke[lv]), "".join(no_stroke[lv][:60]) + ("…" if len(no_stroke[lv]) > 60 else "")))

    for item in kanji_out:
        if item["k"] in stroke_out:
            item["st"] = len(stroke_out[item["k"]])
        else:
            item["ns"] = 1       # 筆順のデータが無い

    os.makedirs(OUT, exist_ok=True)
    schema = ("k=字 lv=級(3/p2/2/p1/1) on=音読み kun=訓読み(-の後が送り仮名) rad=部首 radn=部首名 rd=部首の誤答 st=画数 m=意味\n"
              "   ex=[語, 読み, 例文({}が問う語), 読みの誤答, 書き取りの誤答, 送り仮名の誤答(あれば)]\n"
              "   alt=常用漢字表の字体（画面には k を出す） ns=1 なら筆順のデータが無い")
    # 3〜2級は1つのファイル、準1級・1級は級ごとに分ける（筆順も同じ分け方。必要な級だけ読み込む）
    for fname, key, lvs in DATA_FILES:
        write_js(fname + ".js", "漢字（%s）" % "・".join(LEVEL_NAME[x] for x in lvs), schema, key,
                 [x for x in kanji_out if x["lv"] in lvs])
        write_strokes(fname.replace("kanji", "strokes") + ".js",
                      {c: s for c, s in stroke_out.items() if chars[c]["lv_app"] in lvs})
    write_js("jukugo.js", "四字熟語・対義語・類義語",
             "yoji: w=熟語 r=1字ごとの読み m=意味 lv=級 d=1字ごとの誤答の字\n"
             "   pairs: t=対(対義語)/類(類義語) a,ar=問う語と読み b,br=答えの語と読み lv=級",
             "yoji", yoji_out, extra=("pairs", pair_out))

    print("漢字 %d 字（%s）・例文 %d・四字熟語 %d・対義語/類義語 %d・筆順 %d 字"
          % (len(kanji_out), " ".join("%s %d" % (LEVEL_NAME[lv], sum(1 for x in kanji_out if x["lv"] == lv))
                                       for lv, _ in LEVELS),
             sum(len(x["ex"]) for x in kanji_out), len(yoji_out), len(pair_out), len(stroke_out)))
    if notes:
        print("\nお知らせ %d 件:" % len(notes))
        for w in notes:
            print("  - " + w)
    if warn:
        print("\n確認が必要な点 %d 件:" % len(warn))
        for w in warn:
            print("  - " + w)
    return warn


# 出力するファイル: (ファイル名, window.KANKEN の名前, 含む級)
DATA_FILES = [("kanji", "kanji", ("3", "p2", "2")), ("kanji-p1", "kanji_p1", ("p1",)), ("kanji-1", "kanji_1", ("1",))]


def write_js(name, title, schema, key, rows, extra=None):
    lines = ["/* %s — tools/build_data.py が src/ と公開データから作る。直接書き換えないこと。" % title,
             "   schema: " + schema + " */",
             "window.KANKEN = window.KANKEN || {};",
             "window.KANKEN.%s = [" % key]
    lines += [json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "," for r in rows]
    lines.append("];")
    if extra:
        lines.append("window.KANKEN.%s = [" % extra[0])
        lines += [json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "," for r in extra[1]]
        lines.append("];")
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def write_strokes(name, strokes):
    """筆順。何度読み込んでも足し合わせになるよう、既にある表に字を足す形で書く。"""
    lines = ["/* 筆順 — KanjiVG (https://kanjivg.tagaini.net/ , CC BY-SA 3.0, Ulrich Apel) の画データを",
             "   109×109 の座標のまま、画の順に並べたもの。tools/build_data.py が作る。",
             "   筆順の画面を開いたときにだけ読み込む。 */",
             "window.KANKEN = window.KANKEN || {};",
             "(function (s) {"]
    lines += ["s[%s]=%s;" % (json.dumps(c, ensure_ascii=False), json.dumps(p, separators=(",", ":")))
              for c, p in strokes.items()]
    lines.append("})(window.KANKEN.strokes = window.KANKEN.strokes || {});")
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


def sheet(lv):
    """例文を書くときの下書き用に、その級の字と音訓（準1級・1級は表外の音訓と英語の意味も）を出す。"""
    kd = load_kanjidict()
    chars, target = build_kanji_table(kd)
    for k in target[lv]:
        r = chars[k]
        on, kun = (r["on_all"], r["kun_all"]) if lv in WIDE else (r["on"], r["kun"])
        line = "%s\t音:%s\t訓:%s" % (k, "・".join(on) or "-", "・".join(s + ("（%s）" % o if o else "") for s, o in kun) or "-")
        if lv in WIDE:
            line += "\t" + r["en"]
        print(line)

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet", choices=[lv for lv, _ in LEVELS])
    ap.add_argument("--strict", action="store_true", help="確認が必要な点があれば失敗にする")
    a = ap.parse_args()
    if a.sheet:
        sheet(a.sheet)
    else:
        w = build()
        if a.strict and w:
            sys.exit(1)
