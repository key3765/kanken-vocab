/* ===========================================================
   app.js — 画面の組み立てと操作
   =========================================================== */
window.KANKEN = window.KANKEN || {};

(function (ns) {
  "use strict";

  var store = ns.store, srs = ns.srs, ads = ns.ads, stroke = ns.stroke;

  /* -------------------------------------------------- データ */
  var LEVELS = [
    { k: "3", label: "3級" },
    { k: "p2", label: "準2級" },
    { k: "2", label: "2級" },
    { k: "p1", label: "準1級" },
    { k: "1", label: "1級" }
  ];
  var LV_RANK = { "3": 0, "p2": 1, "2": 2, "p1": 3, "1": 4 };
  var LV_LABEL = { "3": "3級", "p2": "準2級", "2": "2級", "p1": "準1級", "1": "1級" };

  function copy(o, extra) {
    var out = {}, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k];
    for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    return out;
  }

  /* 字の記録は "k:字" で紐づける。字を差し替えない限り記録は切れない */
  var KANJI = [].concat(ns.kanji || [], ns.kanji_p1 || [], ns.kanji_1 || []).map(function (x) { return copy(x, { id: "k:" + x.k }); });
  var BY_ID = {};
  KANJI.forEach(function (x) { BY_ID[x.id] = x; });
  var YOJI = (ns.yoji || []).map(function (x) { return copy(x, { id: "y:" + x.w }); });
  var PAIRS = (ns.pairs || []).map(function (x) { return copy(x, { id: "p:" + x.a + ":" + x.b }); });

  /* 出題形式。字を問う形式は字の記録（間隔反復）に、熟語の形式は jukugo の記録に入る */
  var KINDS = [
    { k: "yomi", label: "読み", juku: false },
    { k: "kaki", label: "書き取り", juku: false },
    { k: "okuri", label: "送り仮名", juku: false },
    { k: "bushu", label: "部首", juku: false },
    { k: "kakusu", label: "画数", juku: false },
    { k: "hitsujun", label: "筆順", juku: false },
    { k: "yoji", label: "四字熟語", juku: true },
    { k: "pair", label: "対義語・類義語", short: "対義・類義", juku: true }
  ];
  var KIND = {};
  KINDS.forEach(function (x) { KIND[x.k] = x; });

  function levelKanji(lv) { return KANJI.filter(function (x) { return x.lv === lv; }); }

  function pool() {
    var lv = store.settings.levels;
    return KANJI.filter(function (x) { return lv.indexOf(x.lv) !== -1; });
  }

  /* 熟語は「選んだ級のうち最も上の級」以下を全部出す（2級の試験には3級の熟語も出るため） */
  function maxRank() {
    return Math.max.apply(null, store.settings.levels.map(function (l) { return LV_RANK[l]; }));
  }
  function jukuPool(list) {
    var top = maxRank();
    return list.filter(function (x) { return LV_RANK[x.lv] <= top; });
  }

  /* -------------------------------------------------- 小物 */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pick(list, n) { return shuffle((list || []).slice()).slice(0, n); }
  function any(list) { return list[Math.floor(Math.random() * list.length)]; }

  function kata(s) {
    return String(s).replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); });
  }
  function hira(s) {
    return String(s).replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
  }

  /* 訓読み「あわ-れむ」を、送り仮名を薄くして表示する */
  function kunHtml(s) {
    var p = s.split("-");
    return esc(p[0]) + (p[1] ? '<span class="okuri">' + esc(p[1]) + '</span>' : "");
  }

  function readingsLine(x) {
    var on = x.on.join("・"), kun = x.kun.map(function (s) { return s.replace("-", ""); }).join("・");
    return [on, kun].filter(Boolean).join("　");
  }

  /* 例文の {語} を、問われている部分として印をつけて出す。asKana で読みのカタカナに置き換える */
  function sentenceHtml(s, w, shown) {
    var mark = "{" + w + "}";
    var at = s.indexOf(mark);
    if (at === -1) return esc(s);
    return esc(s.slice(0, at)) + '<span class="q-mark">' + esc(shown) + '</span>' + esc(s.slice(at + mark.length));
  }

  function plainSentence(s) { return String(s).replace(/[{}]/g, ""); }

  var WD = ["日", "月", "火", "水", "木", "金", "土"];
  function weekdayOf(key) {
    var p = key.split("-");
    return WD[new Date(+p[0], +p[1] - 1, +p[2]).getDay()];
  }

  var ICON = {
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v11"/></svg>',
    list:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V11M10 20V5M16 20v-6M22 20H2"/></svg>',
    gear:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>',
    book:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/></svg>',
    back:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    prev:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    next:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>'
  };

  /* -------------------------------------------------- 画面の状態 */
  var el = {};
  var view = "home";
  var session = null;
  var quiz = null;
  var listUI = { q: "", filter: "all" };
  var jukuUI = { tab: "yoji", q: "" };
  var detailId = null;      // 字の詳細
  var jukuId = null;        // 熟語の詳細
  var strokeStep = 0;       // 詳細の筆順で、いま何画目まで出しているか（0 = 全部）
  var sheet = null;         // "settings" | "detail" | "juku" | null
  var toastTimer = null;

  function day() { return store.today(); }

  /* -------------------------------------------------- テーマ */
  function applyTheme() {
    var t = store.settings.theme;
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }

  /* -------------------------------------------------- トースト */
  function toast(msg) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    if (toastTimer) clearTimeout(toastTimer);
    var n = document.createElement("div");
    n.className = "toast";
    n.setAttribute("role", "status");
    n.textContent = msg;
    document.body.appendChild(n);
    toastTimer = setTimeout(function () { n.remove(); toastTimer = null; }, 2200);
  }

  /* ==================================================
     ホーム
     ================================================== */
  function sessionSize() {
    var remaining = Math.max(0, store.settings.goal - store.countStudied(day()));
    return remaining > 0 ? remaining : 10;
  }

  function weakList() {
    return pool().filter(function (x) {
      return store.hasCard(x.id) && store.card(x.id).ng > 0;
    });
  }

  function renderHome() {
    var p = pool();
    var c = srs.counts(p, day());
    var doneToday = store.countStudied(day());
    var goal = store.settings.goal;
    var streak = store.liveStreak(day());
    var ready = srs.buildSession(p, sessionSize(), day()).length;

    var pct = goal > 0 ? Math.min(1, doneToday / goal) : 0;
    var R = 48, CIRC = 2 * Math.PI * R;
    var offset = CIRC * (1 - pct);
    var weak = weakList().length;

    var startLabel = doneToday >= goal
      ? "もう少し続ける（" + ready + "字）"
      : "今日の学習をはじめる（" + ready + "字）";

    var html = "";

    html += '<section class="today">' +
      '<div class="ring">' +
        '<svg viewBox="0 0 112 112" aria-hidden="true">' +
          '<circle class="ring__track" cx="56" cy="56" r="' + R + '"/>' +
          '<circle class="ring__bar" cx="56" cy="56" r="' + R + '" ' +
            'stroke-dasharray="' + CIRC.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"/>' +
        '</svg>' +
        '<div class="ring__label"><span class="ring__num">' + doneToday + '</span>' +
        '<span class="ring__den">/ ' + goal + ' 字</span></div>' +
      '</div>' +
      '<div class="today__body">' +
        '<p class="eyebrow">今日</p>' +
        '<div class="streak-row">' + sealHtml(streak) +
          '<div class="streak-row__text">' +
            '<p class="today__line">' + (streak > 0
              ? "<b>" + streak + "</b> 日連続で学習中"
              : "今日はじめると <b>1</b> 日目") + '</p>' +
            '<p class="note">' + (doneToday >= goal ? "目標達成。えらい。" : "あと " + (goal - doneToday) + " 字で目標") + '</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</section>';

    html += '<div class="start-stack">';
    if (ready > 0) {
      html += '<button class="btn btn--primary btn--block" data-go="study-normal">' + esc(startLabel) + '</button>';
    } else {
      html += '<button class="btn btn--primary btn--block" disabled>今日の復習は終わりました</button>';
    }
    html += '<div class="quick-row">' +
      '<button class="btn" data-go="quiz">小テスト 10問</button>' +
      '<button class="btn" data-go="study-weak"' + (weak === 0 ? " disabled" : "") + '>' +
        (weak === 0 ? "弱点なし" : "弱点 " + weak + "字") + '</button>' +
    '</div>';
    html += '<p class="today__line" style="text-align:center">復習の期限 <b>' + c.due + '</b> 字 ・ 未学習 <b>' + c.fresh + '</b> 字</p>';
    html += '</div>';

    html += '<section class="breakdown">' +
      '<div class="section-head"><h2 class="h">出題する級</h2>' +
      '<span class="note tnum">' + p.length + ' 字</span></div>' +
      '<div class="levels">' + levelChips() + '</div>' +
      meterHtml(c) +
    '</section>';

    /* 形式を1つに絞った練習 */
    html += '<section class="breakdown">' +
      '<div class="section-head"><h2 class="h">形式を選んで練習</h2><span class="note">各10問</span></div>' +
      '<div class="kind-grid">' + KINDS.map(function (x) {
        return '<button class="btn kind-btn" data-kind="' + x.k + '">' + esc(x.short || x.label) + '</button>';
      }).join("") + '</div>' +
      '<p class="note">四字熟語・対義語・類義語は、選んだ級までのものを出します。</p>' +
    '</section>';

    html += ads.slotHtml("home");

    html += '<p class="foot">記録はこの端末の中だけに保存されます。<br>' +
      (store.available ? "" : "※ ブラウザの設定により保存できません。学習は続けられますが記録は残りません。<br>") +
      '<a href="/privacy.html">プライバシーポリシー</a></p>';

    el.screen.className = "screen";
    el.screen.innerHTML = html;
  }

  function sealHtml(streak, extraClass) {
    var cls = "seal" + (streak > 0 ? "" : " seal--zero") + (extraClass ? " " + extraClass : "");
    return '<div class="' + cls + '" aria-label="連続 ' + streak + ' 日">' +
      '<span class="seal__n">' + streak + '</span><span class="seal__u">日連続</span></div>';
  }

  function levelChips() {
    return LEVELS.map(function (lv) {
      var on = store.settings.levels.indexOf(lv.k) !== -1;
      var n = levelKanji(lv.k).length;
      return '<button class="chip" data-level="' + lv.k + '" aria-pressed="' + on + '">' +
        lv.label + '<span class="chip__n">' + n + '</span></button>';
    }).join("");
  }

  function meterHtml(c) {
    var t = Math.max(1, c.total);
    var pct = function (n) { return (n / t * 100).toFixed(2) + "%"; };
    return '<div class="meter" role="img" aria-label="未学習 ' + c.fresh + '字、学習中 ' + c.learn + '字、習得 ' + c.mature + '字">' +
      '<span class="meter__mature" style="width:' + pct(c.mature) + '"></span>' +
      '<span class="meter__learn" style="width:' + pct(c.learn) + '"></span>' +
      '<span class="meter__new" style="width:' + pct(c.fresh) + '"></span>' +
    '</div>' +
    '<div class="legend">' +
      '<span><i style="background:var(--ai)"></i>習得 ' + c.mature + '</span>' +
      '<span><i style="background:var(--warn)"></i>学習中 ' + c.learn + '</span>' +
      '<span><i style="background:var(--line-2)"></i>未学習 ' + c.fresh + '</span>' +
    '</div>';
  }

  /* ==================================================
     学習（フラッシュカード）
     ================================================== */
  function startStudy(mode) {
    var p = pool(), items;

    if (mode === "weak") {
      items = weakList().sort(function (a, b) {
        return store.card(b.id).ng - store.card(a.id).ng;
      }).slice(0, Math.max(10, store.settings.goal));
    } else {
      items = srs.buildSession(p, sessionSize(), day());
    }

    if (!items.length) { toast("出題できる字がありません"); return; }

    session = { queue: items.slice(), total: items.length, done: 0, revealed: false, again: 0, mode: mode };
    go("study");
  }

  function infoGridHtml(x) {
    return '<dl class="kinfo">' +
      '<div><dt>音読み</dt><dd>' + (x.on.length ? esc(x.on.join("・")) : '<span class="muted">なし</span>') + '</dd></div>' +
      '<div><dt>訓読み</dt><dd>' + (x.kun.length ? x.kun.map(kunHtml).join("・") : '<span class="muted">なし</span>') + '</dd></div>' +
      '<div><dt>部首</dt><dd><span class="han kinfo__rad">' + esc(x.rad) + '</span>' + esc(x.radn ? "（" + x.radn.split("・")[0] + "）" : "") + '</dd></div>' +
      '<div><dt>画数</dt><dd class="tnum">' + x.st + ' 画</dd></div>' +
    '</dl>';
  }

  function examplesHtml(x, limit) {
    if (!x.ex.length) return '<p class="note">この字は語の例を載せていません（読み・書き取りの問題には出ません）。</p>';
    return '<ul class="exlist">' + x.ex.slice(0, limit || x.ex.length).map(function (e) {
      return '<li><span class="exlist__w"><span class="han">' + esc(e[0]) + '</span>' +
        '<span class="exlist__r">' + esc(e[1]) + '</span></span>' +
        '<span class="exlist__s">' + sentenceHtml(e[2], e[0], e[0]) + '</span></li>';
    }).join("") + '</ul>';
  }

  function altNoteHtml(x) {
    return x.alt ? '<p class="note alt-note">常用漢字表の字体は「' + esc(x.alt) + '」。試験ではどちらで書いても正解です。</p>' : "";
  }

  function renderStudy() {
    if (!session) { go("home"); return; }
    if (!session.queue.length) { renderFinish(); return; }

    var x = session.queue[0];
    var pctDone = session.total ? (session.done / session.total * 100) : 0;

    var body = '<div class="study__bar">' +
      '<span>' + session.done + ' / ' + session.total + '</span>' +
      '<span class="study__track"><span class="study__fill" style="width:' + pctDone.toFixed(1) + '%"></span></span>' +
      '<span>' + LV_LABEL[x.lv] + '</span>' +
    '</div>';

    body += '<div class="card" data-level="' + x.lv + '" data-act="reveal" role="button" tabindex="0" ' +
      'aria-label="タップして読みと意味を表示">';
    body += '<p class="card__hanzi">' + esc(x.k) + '</p>';

    if (session.revealed) {
      body += '<div class="reveal-fade card__back">' +
        '<p class="card__ja">' + esc(x.m) + '</p>' +
        infoGridHtml(x) +
        examplesHtml(x, 3) +
        altNoteHtml(x) +
        '<button class="btn btn--sm card__stroke-btn" data-act="study-stroke">筆順を見る</button>' +
        '<div class="stroke-box" id="study-stroke"></div>' +
      '</div>';
    } else {
      body += '<p class="card__hint">読みと意味を思い浮かべてからタップ</p>';
    }
    body += '</div>';

    if (session.revealed) {
      body += '<div class="grade reveal-fade">' +
        '<button class="g-again" data-grade="again">わからない<small>もう一度</small></button>' +
        '<button class="g-hard" data-grade="hard">あいまい<small>明日</small></button>' +
        '<button class="g-good" data-grade="good">わかる<small>' + nextLabel(x.id) + '</small></button>' +
      '</div>';
    } else {
      body += '<button class="btn btn--primary btn--block" data-act="reveal">読みと意味を見る</button>';
    }

    el.screen.className = "screen screen--flush";
    el.screen.innerHTML = '<div class="study">' + body + '</div>';
  }

  function nextLabel(id) {
    var c = store.hasCard(id) ? store.card(id) : null;
    var nextBox = c && c.box >= 0 ? c.box + 1 : 0;
    var d = srs.intervalFor(nextBox);
    return d >= 30 ? Math.round(d / 30) + "か月後" : d + "日後";
  }

  function doGrade(g) {
    if (!session || !session.revealed || !session.queue.length) return;
    var x = session.queue[0];
    var repeat = srs.grade(x.id, g, day());

    if (repeat) {
      session.again += 1;
      session.queue.push(session.queue.shift());
    } else {
      session.queue.shift();
      session.done += 1;
      store.logDay(day()).studied += 1;
      store.touchStreak(day());
      store.save();
    }
    session.revealed = false;
    render();
  }

  function renderFinish() {
    var streak = store.liveStreak(day());
    var doneToday = store.countStudied(day());
    var goal = store.settings.goal;
    var tomorrow = pool().filter(function (x) {
      return store.hasCard(x.id) && store.card(x.id).box >= 0 && store.card(x.id).due === store.shiftDays(day(), 1);
    }).length;

    var html = '<div class="finish">' +
      sealHtml(streak, "finish__seal") +
      '<h2>' + session.total + ' 字 おつかれさま</h2>' +
      '<p class="note">今日の学習 ' + doneToday + ' / ' + goal + ' 字' +
        (session.again ? ' ・ 言い直し ' + session.again + ' 回' : '') + '</p>' +
      '<p class="note">明日の復習は ' + tomorrow + ' 字の予定です。</p>' +
      '<div class="start-stack" style="width:100%;max-width:320px;margin-top:8px">' +
        '<button class="btn btn--primary btn--block" data-go="quiz">覚えたか小テストで確認</button>' +
        '<div class="quick-row">' +
          '<button class="btn" data-go="study-normal">もう少し続ける</button>' +
          '<button class="btn" data-go="home">ホームへ</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    el.screen.className = "screen screen--flush";
    el.screen.innerHTML = html;
  }

  /* ==================================================
     小テスト（8形式）
     どの形式も { kind, ref, prompt, choices, answer, explain } の形に揃えて出す。
     ================================================== */
  var KANJI_KINDS = ["yomi", "kaki", "okuri", "bushu", "kakusu", "hitsujun"];

  function mkChoices(right, wrongs, n) {
    var opts = [right];
    (wrongs || []).forEach(function (w) { if (opts.indexOf(w) === -1) opts.push(w); });
    opts = [right].concat(pick(opts.slice(1), (n || 4) - 1));
    shuffle(opts);
    return { list: opts, answer: opts.indexOf(right) };
  }

  /* 語の情報（解説用） */
  function wordNoteHtml(x, e) {
    return '<div class="example">' +
      '<span class="example__zh"><span class="han">' + esc(e[0]) + '</span>（' + esc(e[1]) + '）</span>' +
      '<span class="example__ja">' + esc(plainSentence(e[2])) + '</span>' +
      '<span class="example__ja">「<span class="han">' + esc(x.k) + '</span>」' + esc(x.m) + '　' + esc(readingsLine(x)) + '</span>' +
    '</div>';
  }

  var BUILD = {
    yomi: function (x) {
      if (!x.ex.length) return null;       // 準1級・1級には、語の例を載せていない字がある
      var e = any(x.ex);
      var c = mkChoices(e[1], e[3]);
      return {
        prompt: '<div class="q-sent">' + sentenceHtml(e[2], e[0], e[0]) + '</div>' +
          '<div class="q-sub">線の漢字の読みは？</div>',
        choices: c.list.map(esc), answer: c.answer, right: e[1],
        explain: wordNoteHtml(x, e)
      };
    },
    kaki: function (x) {
      if (!x.ex.length) return null;
      var e = any(x.ex);
      var c = mkChoices(e[0], e[4]);
      return {
        prompt: '<div class="q-sent">' + sentenceHtml(e[2], e[0], kata(e[1])) + '</div>' +
          '<div class="q-sub">線のカタカナを漢字にすると？</div>',
        choices: c.list.map(function (s) { return '<span class="han">' + esc(s) + '</span>'; }),
        answer: c.answer, right: e[0],
        explain: wordNoteHtml(x, e)
      };
    },
    okuri: function (x) {
      var cand = x.ex.filter(function (e) { return e[5] && e[5].length; });
      if (!cand.length) return null;
      var e = any(cand);
      var c = mkChoices(e[0], e[5]);
      return {
        prompt: '<div class="q-sent">' + sentenceHtml(e[2], e[0], kata(e[1])) + '</div>' +
          '<div class="q-sub">線のカタカナを、漢字と送り仮名で正しく書いたものは？</div>',
        choices: c.list.map(function (s) { return '<span class="han">' + esc(s) + '</span>'; }),
        answer: c.answer, right: e[0],
        explain: wordNoteHtml(x, e)
      };
    },
    bushu: function (x) {
      var c = mkChoices(x.rad, x.rd);
      return {
        prompt: '<div class="q-big han">' + esc(x.k) + '</div><div class="q-sub">この字の部首は？</div>',
        choices: c.list.map(function (s) { return '<span class="han choice__rad">' + esc(s) + '</span>'; }),
        answer: c.answer, right: x.rad,
        explain: '<div class="example"><span class="example__ja">「<span class="han">' + esc(x.k) +
          '</span>」の部首は「<span class="han">' + esc(x.rad) + '</span>」（' + esc(x.radn) + '）</span></div>'
      };
    },
    kakusu: function (x) {
      var near = [x.st - 2, x.st - 1, x.st + 1, x.st + 2].filter(function (n) { return n > 0; });
      var c = mkChoices(x.st, near);
      return {
        prompt: '<div class="q-big han">' + esc(x.k) + '</div><div class="q-sub">総画数は？</div>',
        choices: c.list.map(function (n) { return '<span class="tnum">' + n + ' 画</span>'; }),
        answer: c.answer, right: x.st + " 画",
        explain: '<div class="example"><span class="example__ja">「<span class="han">' + esc(x.k) +
          '</span>」は ' + x.st + ' 画。部首「<span class="han">' + esc(x.rad) + '</span>」</span></div>'
      };
    },
    hitsujun: function (x) {
      var total = stroke.count(x.k);
      if (total < 3) return null;
      var n = 1 + Math.floor(Math.random() * total);
      var near = [];
      for (var d = 1; d <= 3; d++) {
        if (n - d >= 1) near.push(n - d);
        if (n + d <= total) near.push(n + d);
      }
      var c = mkChoices(n, near.slice(0, 4));
      return {
        prompt: '<div class="q-stroke">' + stroke.svg(x.k, { hi: n }) + '</div>' +
          '<div class="q-sub">太く示した画は何画目？</div>',
        choices: c.list.map(function (v) { return '<span class="tnum">' + v + ' 画目</span>'; }),
        answer: c.answer, right: n + " 画目",
        explain: '<div class="example"><span class="example__ja">' + n + ' 画目（総画数 ' + total + '）</span>' +
          '<button class="btn btn--sm" data-act="quiz-anim">描き順を見る</button>' +
          '<div class="stroke-box" id="quiz-stroke"></div></div>'
      };
    },
    yoji: function (y) {
      var spots = [];
      y.d.forEach(function (d, i) { if (d && d.length >= 3) spots.push(i); });
      if (!spots.length) return null;
      var i = any(spots);
      var shown = y.w.split("").map(function (ch, j) {
        return j === i ? '<span class="q-mark q-blank">' + esc(kata(y.r[j])) + '</span>' : esc(ch);
      }).join("");
      var c = mkChoices(y.w.charAt(i), y.d[i]);
      return {
        prompt: '<div class="q-big q-yoji han">' + shown + '</div>' +
          '<div class="q-sub">カタカナの部分に入る漢字は？</div>',
        choices: c.list.map(function (s) { return '<span class="han choice__rad">' + esc(s) + '</span>'; }),
        answer: c.answer, right: y.w,
        explain: yojiNoteHtml(y)
      };
    },
    pair: function (p) {
      var others = PAIRS.filter(function (q) { return q.t === p.t && q.b !== p.b && q.b !== p.a && q.a !== p.a; })
        .map(function (q) { return q.b; });
      var c = mkChoices(p.b, others);
      var label = p.t === "対" ? "対義語" : "類義語";
      return {
        prompt: '<div class="q-big q-pair han">' + esc(p.a) + '</div>' +
          '<div class="q-reading">' + esc(p.ar) + '</div>' +
          '<div class="q-sub">' + label + '（' + (p.t === "対" ? "反対・対になる意味" : "似た意味") + '）は？</div>',
        choices: c.list.map(function (s) { return '<span class="han">' + esc(s) + '</span>'; }),
        answer: c.answer, right: p.b,
        explain: pairNoteHtml(p)
      };
    }
  };

  function yojiNoteHtml(y) {
    return '<div class="example">' +
      '<span class="example__zh"><span class="han">' + esc(y.w) + '</span>（' + esc(y.r.join("")) + '）</span>' +
      '<span class="example__ja">' + esc(y.m) + '</span></div>';
  }

  function pairNoteHtml(p) {
    return '<div class="example"><span class="example__zh"><span class="han">' + esc(p.a) + '</span>（' + esc(p.ar) + '）' +
      (p.t === "対" ? "　⇔　" : "　≒　") + '<span class="han">' + esc(p.b) + '</span>（' + esc(p.br) + '）</span>' +
      '<span class="example__ja">' + (p.t === "対" ? "対義語" : "類義語") + '</span></div>';
  }

  /* 直近に出した字を後回しにした並び（出し切ったら一巡として履歴を空に戻す） */
  function kanjiOrder(list) {
    var recent = {};
    store.state.quizRecent.forEach(function (id) { recent[id] = true; });
    var byRecency = function (l) {
      return shuffle(l.filter(function (x) { return !recent[x.id]; }))
        .concat(shuffle(l.filter(function (x) { return recent[x.id]; })));
    };
    if (store.settings.quizScope === "studied") {
      return byRecency(list.filter(function (x) { return store.stage(x.id) !== "new"; }))
        .concat(byRecency(list.filter(function (x) { return store.stage(x.id) === "new"; })));
    }
    return byRecency(list);
  }

  /* 熟語は、まだ出していないもの・間違えたものを先に */
  function jukuOrder(list) {
    var rec = store.state.jukugo;
    var fresh = [], wrong = [], rest = [];
    shuffle(list.slice()).forEach(function (x) {
      var r = rec[x.id];
      if (!r) fresh.push(x);
      else if (r.last === false) wrong.push(x);
      else rest.push(x);
    });
    return wrong.concat(fresh, rest);
  }

  function buildQuiz(kinds, n) {
    var p = pool();
    var kk = kinds.filter(function (k) { return KANJI_KINDS.indexOf(k) !== -1; });
    if (!stroke.ready(store.settings.levels)) kk = kk.filter(function (k) { return k !== "hitsujun"; });
    var jk = kinds.filter(function (k) { return KIND[k].juku; });
    var usable = kk.concat(jk);
    if (!usable.length) return null;

    var kOrder = kanjiOrder(p);
    var yOrder = jukuOrder(jukuPool(YOJI));
    var pOrder = jukuOrder(jukuPool(PAIRS));
    var used = {};
    var qs = [];
    var slots = [];
    while (slots.length < n) slots = slots.concat(shuffle(usable.slice()));
    slots = slots.slice(0, n);

    slots.forEach(function (kind) {
      var src = kind === "yoji" ? yOrder : kind === "pair" ? pOrder : kOrder;
      for (var i = 0; i < src.length; i++) {
        var item = src[i];
        if (used[item.id]) continue;
        var q = BUILD[kind](item);
        if (!q) continue;
        used[item.id] = true;
        qs.push(copy(q, { kind: kind, ref: item, picked: -1 }));
        return;
      }
    });
    if (!qs.length) return null;

    /* 字の出題履歴（直近に出た字を後回しにするため） */
    var ids = qs.filter(function (q) { return !KIND[q.kind].juku; }).map(function (q) { return q.ref.id; });
    var recentSet = {};
    store.state.quizRecent.forEach(function (id) { recentSet[id] = true; });
    var freshLeft = p.filter(function (x) { return !recentSet[x.id]; }).length;
    store.state.quizRecent = freshLeft <= ids.length ? ids : store.state.quizRecent.concat(ids);
    store.save();

    return { kinds: kinds, qs: qs, i: 0, score: 0, wrong: [] };
  }

  /* 筆順を含む小テストは、画のデータを読み込んでから組む */
  function startQuiz(kinds) {
    kinds = kinds || store.settings.kinds;
    var needStroke = kinds.indexOf("hitsujun") !== -1 && !stroke.ready(store.settings.levels);
    if (needStroke) {
      el.screen.className = "screen";
      el.screen.innerHTML = '<p class="empty">筆順のデータを読み込んでいます…</p>';
      stroke.load(function (ok) {
        if (!ok) {
          toast("筆順のデータを読み込めませんでした");
          if (kinds.length === 1) { go("home"); return; }
        }
        finishStart(kinds);
      }, store.settings.levels);
      return;
    }
    finishStart(kinds);
  }

  function finishStart(kinds) {
    var q = buildQuiz(kinds, 10);
    if (!q) { toast("出題できる問題がありません"); go("home"); return; }
    quiz = q;
    go("quiz");
  }

  function quizTitle() {
    if (!quiz) return "小テスト";
    return quiz.kinds.length === 1 ? KIND[quiz.kinds[0]].label + " 10問" : "小テスト";
  }

  function renderQuiz() {
    if (!quiz) { go("home"); return; }
    if (quiz.i >= quiz.qs.length) { renderQuizResult(); return; }

    var q = quiz.qs[quiz.i];
    var answered = q.picked !== -1;

    var html = '<div class="quiz">';
    html += '<div class="study__bar">' +
      '<span>第 ' + (quiz.i + 1) + ' / ' + quiz.qs.length + ' 問</span>' +
      '<span class="study__track"><span class="study__fill" style="width:' +
        (quiz.i / quiz.qs.length * 100).toFixed(1) + '%"></span></span>' +
      '<span class="tnum">正解 ' + quiz.score + '</span>' +
    '</div>';

    html += '<div class="quiz__prompt"><span class="kind-chip">' + esc(KIND[q.kind].label) +
      (q.ref.lv ? '・' + LV_LABEL[q.ref.lv] : '') + '</span>' + q.prompt + '</div>';

    html += '<div class="choices">';
    q.choices.forEach(function (c, idx) {
      var cls = "choice";
      if (answered) {
        if (idx === q.answer) cls += " is-correct";
        else if (idx === q.picked) cls += " is-wrong";
      }
      html += '<button class="' + cls + '" data-choice="' + idx + '"' + (answered ? " disabled" : "") + '>' +
        '<span class="choice__key">' + (idx + 1) + '</span>' +
        '<span class="choice__text">' + c + '</span>' +
      '</button>';
    });
    html += '</div>';

    if (answered) {
      var ok = q.picked === q.answer;
      html += '<p class="quiz__feedback" data-ok="' + (ok ? 1 : 0) + '">' +
        (ok ? "正解" : "正解は「" + esc(q.right) + "」") + '</p>';
      html += '<button class="btn btn--primary btn--block" data-act="quiz-next">' +
        (quiz.i + 1 >= quiz.qs.length ? "結果を見る" : "次の問題") + '</button>';
      html += q.explain;
    } else {
      html += '<p class="quiz__feedback">&nbsp;</p>';
    }

    html += '</div>';
    el.screen.className = "screen screen--flush";
    el.screen.innerHTML = html;
  }

  function answerQuiz(idx) {
    if (!quiz) return;
    var q = quiz.qs[quiz.i];
    if (!q || q.picked !== -1 || idx >= q.choices.length) return;

    q.picked = idx;
    var ok = idx === q.answer;
    if (ok) quiz.score += 1;
    else quiz.wrong.push(q);

    if (KIND[q.kind].juku) {
      var r = store.state.jukugo[q.ref.id] || (store.state.jukugo[q.ref.id] = { ok: 0, ng: 0 });
      if (ok) r.ok += 1; else r.ng += 1;
      r.last = ok;
    } else {
      /* 未学習の字に正解しただけでは復習の予定に入れない（全体から出すと予定が膨らむため） */
      srs.quizResult(q.ref.id, ok, day(), true);
    }
    store.logDay(day()).quiz += 1;
    store.touchStreak(day());
    store.save();
    render();
    var b = el.screen.querySelector('[data-act="quiz-next"]');
    if (b && b.scrollIntoView) b.scrollIntoView({ block: "nearest" });
  }

  function wrongRowHtml(q) {
    if (q.kind === "yoji") return yojiRowHtml(q.ref);
    if (q.kind === "pair") return pairRowHtml(q.ref);
    return kanjiRowHtml(q.ref, true);
  }

  function renderQuizResult() {
    var total = quiz.qs.length;
    var pct = Math.round(quiz.score / total * 100);
    /* 漢検 3級〜2級の合格の目安は 7〜8 割 */
    var verdict = pct >= 80 ? "合格の目安（8割）を超えています"
      : pct >= 70 ? "あと少しで合格の目安（3級・準2級は7割、2級は8割）"
      : "間違えた字を今日のうちに一周しましょう";

    var html = '<div class="quiz">';
    html += '<p class="eyebrow">' + esc(quizTitle()) + 'の結果</p>';
    html += '<div class="score-big">' + quiz.score + '<span style="font-size:24px;color:var(--muted)"> / ' + total + '</span>' +
      '<small>正答率 ' + pct + '%</small></div>';
    html += '<p class="note" style="text-align:center">' + verdict + '</p>';

    if (quiz.wrong.length) {
      var hasKanji = quiz.wrong.some(function (q) { return !KIND[q.kind].juku; });
      html += '<div class="section-head"><h2 class="h">間違えた問題</h2>' +
        (hasKanji ? '<span class="note">字は要復習に戻しました</span>' : '') + '</div>';
      html += '<div class="wrong-list">' + quiz.wrong.map(wrongRowHtml).join("") + '</div>';
      if (hasKanji) html += '<button class="btn btn--primary btn--block" data-go="study-weak">弱点の字を復習する</button>';
      else html += '<button class="btn btn--primary btn--block" data-act="quiz-again">別の問題でもう10問</button>';
    } else {
      html += '<button class="btn btn--primary btn--block" data-act="quiz-again">別の問題でもう10問</button>';
    }

    html += '<div class="quick-row">' +
      '<button class="btn" data-act="quiz-again">もう一度</button>' +
      '<button class="btn" data-go="home">ホームへ</button>' +
    '</div>';

    html += ads.slotHtml("result");
    html += '</div>';

    el.screen.className = "screen screen--flush";
    el.screen.innerHTML = html;
  }

  /* ==================================================
     一覧（字）
     ================================================== */
  var FILTERS = [
    { k: "all", label: "すべて" },
    { k: "due", label: "要復習" },
    { k: "new", label: "未学習" },
    { k: "learn", label: "学習中" },
    { k: "mature", label: "習得" }
  ];

  function matchKanji(x, q) {
    if (!q) return true;
    var h = hira(q);
    return x.k === q || (x.alt && x.alt === q) ||
      x.on.some(function (s) { return hira(s).indexOf(h) === 0; }) ||
      x.kun.some(function (s) { return s.replace("-", "").indexOf(h) === 0; }) ||
      x.m.indexOf(q) !== -1 ||
      x.ex.some(function (e) { return e[0].indexOf(q) !== -1 || e[1].indexOf(h) === 0; });
  }

  function filteredKanji() {
    var q = listUI.q.trim();
    var f = listUI.filter;
    return pool().filter(function (x) {
      if (f === "due" && !store.isDue(x.id, day())) return false;
      if (f !== "all" && f !== "due" && store.stage(x.id) !== f) return false;
      return matchKanji(x, q);
    });
  }

  function badgeHtml(id) {
    if (store.isDue(id, day())) return '<span class="badge badge--due">要復習</span>';
    var st = store.stage(id);
    if (st === "mature") return '<span class="badge badge--mature">習得</span>';
    if (st === "learn") return '<span class="badge badge--learn">学習中</span>';
    return '<span class="badge badge--new">未学習</span>';
  }

  function kanjiRowHtml(x, plain) {
    return '<button class="word-row" data-kanji="' + esc(x.id) + '">' +
      '<span class="word-row__han">' + esc(x.k) + '</span>' +
      '<span class="word-row__mid">' +
        '<span class="word-row__py">' + esc(readingsLine(x)) + '</span><br>' +
        '<span class="word-row__ja">' + esc(x.m) + '</span>' +
      '</span>' +
      (plain ? '<span class="badge badge--due">要復習</span>' : badgeHtml(x.id)) +
    '</button>';
  }

  function kanjiListHtml(rows) {
    return rows.length
      ? '<div class="word-list">' + rows.map(function (x) { return kanjiRowHtml(x); }).join("") + '</div>'
      : '<p class="empty">該当する字がありません。<br>検索語や絞り込みを変えてみてください。</p>';
  }

  function renderList() {
    var rows = filteredKanji();

    var html = '<div class="search">' + ICON.search +
      '<input id="list-search" type="search" placeholder="字・読み・意味・熟語で探す" ' +
      'value="' + esc(listUI.q) + '" aria-label="字を検索">' +
    '</div>';

    html += '<div class="filters">' + FILTERS.map(function (f) {
      return '<button class="chip" data-filter="' + f.k + '" aria-pressed="' +
        (listUI.filter === f.k) + '">' + f.label + '</button>';
    }).join("") + '</div>';

    html += '<div class="section-head"><h2 class="h">漢字一覧</h2>' +
      '<span class="note tnum">' + rows.length + ' 字</span></div>';
    html += kanjiListHtml(rows);
    html += ads.slotHtml("list");

    el.screen.className = "screen";
    el.screen.innerHTML = html;
  }

  /* ==================================================
     熟語（四字熟語・対義語・類義語）
     ================================================== */
  function jukuBadgeHtml(id) {
    var r = store.state.jukugo[id];
    if (!r) return '<span class="badge badge--new">未出題</span>';
    return r.last === false
      ? '<span class="badge badge--due">要確認</span>'
      : '<span class="badge badge--mature">正解</span>';
  }

  function yojiRowHtml(y) {
    return '<button class="word-row term-row" data-juku="' + esc(y.id) + '">' +
      '<span class="word-row__mid"><span class="term-row__t han">' + esc(y.w) + '</span>' +
      '<span class="word-row__py">　' + esc(y.r.join("")) + '</span><br>' +
      '<span class="word-row__ja">' + esc(y.m) + '</span></span>' +
      jukuBadgeHtml(y.id) +
    '</button>';
  }

  function pairRowHtml(p) {
    return '<button class="word-row term-row" data-juku="' + esc(p.id) + '">' +
      '<span class="word-row__mid"><span class="term-row__t"><span class="han">' + esc(p.a) + '</span>' +
      (p.t === "対" ? " ⇔ " : " ≒ ") + '<span class="han">' + esc(p.b) + '</span></span><br>' +
      '<span class="word-row__py">' + esc(p.ar) + ' ／ ' + esc(p.br) + '</span></span>' +
      jukuBadgeHtml(p.id) +
    '</button>';
  }

  function filteredJuku() {
    var q = jukuUI.q.trim(), h = hira(q);
    if (jukuUI.tab === "yoji") {
      return jukuPool(YOJI).filter(function (y) {
        return !q || y.w.indexOf(q) !== -1 || y.r.join("").indexOf(h) !== -1 || y.m.indexOf(q) !== -1;
      });
    }
    return jukuPool(PAIRS).filter(function (p) {
      if (jukuUI.tab === "tai" && p.t !== "対") return false;
      if (jukuUI.tab === "rui" && p.t !== "類") return false;
      return !q || (p.a + p.b).indexOf(q) !== -1 || (p.ar + p.br).indexOf(h) !== -1;
    });
  }

  function jukuListHtml(rows) {
    if (!rows.length) return '<p class="empty">該当する語がありません。</p>';
    return '<div class="word-list">' + rows.map(function (x) {
      return x.w ? yojiRowHtml(x) : pairRowHtml(x);
    }).join("") + '</div>';
  }

  function renderJuku() {
    var rows = filteredJuku();
    var isYoji = jukuUI.tab === "yoji";
    var html = '<div class="seg">' +
      '<button data-jtab="yoji" aria-pressed="' + isYoji + '">四字熟語</button>' +
      '<button data-jtab="tai" aria-pressed="' + (jukuUI.tab === "tai") + '">対義語</button>' +
      '<button data-jtab="rui" aria-pressed="' + (jukuUI.tab === "rui") + '">類義語</button>' +
    '</div>';
    html += '<button class="btn btn--primary btn--block" data-kind="' + (isYoji ? "yoji" : "pair") + '">' +
      (isYoji ? "四字熟語" : "対義語・類義語") + 'のテスト 10問</button>';
    html += '<div class="search">' + ICON.search +
      '<input id="juku-search" type="search" placeholder="熟語・読み・意味で探す" ' +
      'value="' + esc(jukuUI.q) + '" aria-label="熟語を検索">' +
    '</div>';
    html += '<div class="section-head"><h2 class="h">' + (isYoji ? "四字熟語" : jukuUI.tab === "tai" ? "対義語" : "類義語") + '</h2>' +
      '<span class="note tnum">' + rows.length + ' 語</span></div>';
    html += jukuListHtml(rows);
    html += '<p class="foot">選んだ級（' + store.settings.levels.map(function (l) { return LV_LABEL[l]; }).join("・") +
      '）までの字でできた語を表示しています。<br>熟語の記録は字の学習記録とは別に保存されます。</p>';

    el.screen.className = "screen";
    el.screen.innerHTML = html;
  }

  /* ==================================================
     記録
     ================================================== */
  function renderStats() {
    var p = pool();
    var c = srs.counts(p, day());
    var s = store.state.streak;
    var streak = store.liveStreak(day());
    var days = store.recentDays(7, day());

    var totalSeen = 0, totalOk = 0, totalNg = 0;
    Object.keys(store.state.cards).forEach(function (k) {
      var cc = store.state.cards[k];
      totalSeen += cc.seen; totalOk += cc.ok; totalNg += cc.ng;
    });
    var acc = (totalOk + totalNg) > 0 ? Math.round(totalOk / (totalOk + totalNg) * 100) : 0;

    var jOk = 0, jNg = 0;
    Object.keys(store.state.jukugo).forEach(function (k) {
      jOk += store.state.jukugo[k].ok; jNg += store.state.jukugo[k].ng;
    });
    var jAcc = (jOk + jNg) > 0 ? Math.round(jOk / (jOk + jNg) * 100) : 0;

    var max = Math.max(1, days.reduce(function (m, d) { return Math.max(m, d.studied + d.quiz); }, 0));

    var html = '<div class="kpi-grid">' +
      kpi(streak, "日", "連続学習") +
      kpi(s.best, "日", "最長連続") +
      kpi(c.mature, "字", "習得した字") +
      kpi(acc, "%", "字の正答率") +
    '</div>';

    html += '<div class="section-head"><h2 class="h">この7日間</h2>' +
      '<span class="note">学習した字＋小テストの問題数</span></div>';
    html += '<div class="bars">' + days.map(function (d, i) {
      var n = d.studied + d.quiz;
      var h = Math.round(n / max * 72);
      var isToday = i === days.length - 1;
      return '<div class="bars__col' + (isToday ? ' bars__col--today' : '') + '">' +
        '<span class="bars__n">' + (n || "") + '</span>' +
        '<span class="bars__bar" style="height:' + Math.max(3, h) + 'px"></span>' +
        '<span class="bars__d">' + weekdayOf(d.day) + '</span>' +
      '</div>';
    }).join("") + '</div>';

    html += '<div class="section-head"><h2 class="h">級ごとの進み</h2></div>';
    LEVELS.forEach(function (lv) {
      var lc = srs.counts(levelKanji(lv.k), day());
      var done = Math.round(lc.mature / Math.max(1, lc.total) * 100);
      html += '<section class="breakdown">' +
        '<div class="section-head"><h2 class="h" style="font-size:14px">' + lv.label + '</h2>' +
        '<span class="note tnum">習得 ' + lc.mature + ' / ' + lc.total + ' 字（' + done + '%）</span></div>' +
        meterHtml(lc) +
      '</section>';
    });

    html += '<div class="kpi-grid">' +
      kpi(totalSeen, "回", "字ののべ回答数") +
      kpi(c.due, "字", "いま要復習") +
      kpi(jOk + jNg, "回", "熟語ののべ回答数") +
      kpi(jAcc, "%", "熟語の正答率") +
    '</div>';

    html += '<p class="foot">「習得」は間隔反復の箱が3段目まで上がった字です。<br>' +
      '次に出る間隔は ' + srs.INTERVALS.join("・") + ' 日と伸びていきます。</p>';

    el.screen.className = "screen";
    el.screen.innerHTML = html;
  }

  function kpi(v, unit, label) {
    return '<div class="kpi"><div class="kpi__v">' + v + '<small>' + unit + '</small></div>' +
      '<div class="kpi__k">' + label + '</div></div>';
  }

  /* ==================================================
     シート（設定・字の詳細・熟語の詳細）
     ================================================== */
  function openSheet(kind) { sheet = kind; renderSheet(); }

  function closeSheet() {
    sheet = null; detailId = null; jukuId = null; strokeStep = 0;
    el.sheet.innerHTML = "";
    el.sheet.hidden = true;
  }

  function renderSheet() {
    if (!sheet) { closeSheet(); return; }
    el.sheet.hidden = false;
    var label = sheet === "settings" ? "設定" : sheet === "juku" ? "熟語の詳細" : "漢字の詳細";
    el.sheet.innerHTML = '<div class="sheet-wrap">' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + label + '">' +
      (sheet === "settings" ? settingsHtml() : sheet === "juku" ? jukuDetailHtml() : detailHtml()) +
      '</div></div>';
    if (sheet === "detail") fillDetailStroke();
  }

  function settingsHtml() {
    var st = store.settings;
    var html = '<div class="section-head"><h2 class="h">設定</h2>' +
      '<button class="icon-btn" data-act="sheet-close" aria-label="閉じる">' + ICON.close + '</button></div>';

    html += '<div class="field"><span class="field__label">出題する級</span>' +
      '<div class="levels">' + levelChips() + '</div>' +
      '<span class="field__help">少なくとも1つは選んでください。</span></div>';

    html += '<div class="field"><span class="field__label">1日の目標</span>' +
      '<div class="stepper">' +
        '<button data-act="goal-" aria-label="目標を減らす">−</button>' +
        '<span class="stepper__v">' + st.goal + ' 字</span>' +
        '<button data-act="goal+" aria-label="目標を増やす">＋</button>' +
      '</div>' +
      '<span class="field__help">10字なら5分ほどで終わります。続けやすい量から始めるのが近道です。</span></div>';

    html += '<div class="field"><span class="field__label">小テストに混ぜる形式</span>' +
      '<div class="kind-grid kind-grid--chips">' + KINDS.map(function (x) {
        return '<button class="chip" data-kindset="' + x.k + '" aria-pressed="' + (st.kinds.indexOf(x.k) !== -1) + '">' +
          esc(x.label) + '</button>';
      }).join("") + '</div>' +
      '<span class="field__help">ホームの「小テスト 10問」で、選んだ形式を混ぜて出します。</span></div>';

    html += '<div class="field"><span class="field__label">小テストの出題範囲</span>' +
      '<div class="seg">' +
        segBtn("quizScope", "all", "選んだ級の全体") +
        segBtn("quizScope", "studied", "学習した字を優先") +
      '</div>' +
      '<span class="field__help">どちらも直近に出た字は後回しにします。間違えた字は要復習に入ります。</span></div>';

    html += '<div class="field"><span class="field__label">配色</span>' +
      '<div class="seg">' +
        segBtn("theme", "auto", "端末に合わせる") +
        segBtn("theme", "light", "明るい") +
        segBtn("theme", "dark", "暗い") +
      '</div></div>';

    html += '<hr class="hr">';
    html += '<button class="btn danger btn--block" data-act="reset">学習記録をすべて消す</button>';
    html += '<p class="foot">収録 ' + KANJI.length + ' 字（3級〜1級）・四字熟語 ' + YOJI.length +
      '・対義語/類義語 ' + PAIRS.length + '。記録は端末内にのみ保存されます。<br>' +
      '級の配当・音訓・部首・画数は <a href="https://github.com/mifunetoshiro/kanjium" target="_blank" rel="noopener">Kanjium</a>（CC BY-SA 4.0）、' +
      '筆順は <a href="https://kanjivg.tagaini.net/" target="_blank" rel="noopener">KanjiVG</a>（CC BY-SA 3.0, Ulrich Apel）を使用しています。' +
      '例文・意味の説明は本アプリの書き下ろしです。<br>' +
      '「漢検」「漢字検定」は公益財団法人 日本漢字能力検定協会の登録商標です。本アプリは同協会とは関係ありません。</p>';
    return html;
  }

  function segBtn(key, val, label) {
    var on = String(store.settings[key]) === String(val);
    return '<button data-set="' + key + '" data-val="' + String(val) + '" aria-pressed="' + on + '">' + label + '</button>';
  }

  function detailHtml() {
    var x = BY_ID[detailId];
    if (!x) return '<p class="empty">字が見つかりません。</p>';
    var c = store.hasCard(x.id) ? store.card(x.id) : null;
    var sched = !c || c.box < 0 ? "まだ出題していません"
      : (c.due <= day() ? "いま要復習" : c.due + " に出題予定");

    var html = '<div class="section-head"><h2 class="h">' + LV_LABEL[x.lv] + 'の漢字</h2>' +
      '<button class="icon-btn" data-act="sheet-close" aria-label="閉じる">' + ICON.close + '</button></div>';

    html += '<div class="detail">' +
      '<div class="detail__top">' +
        '<p class="card__hanzi">' + esc(x.k) + '</p>' +
        '<div class="stroke-view">' +
          '<div class="stroke-box" id="detail-stroke"><p class="note">筆順を読み込み中…</p></div>' +
          '<div class="stroke-ctl">' +
            '<button class="icon-btn" data-act="stroke-prev" aria-label="前の画">' + ICON.prev + '</button>' +
            '<span class="stroke-ctl__n tnum" id="stroke-n"></span>' +
            '<button class="icon-btn" data-act="stroke-next" aria-label="次の画">' + ICON.next + '</button>' +
            '<button class="icon-btn" data-act="stroke-play" aria-label="描き順を再生">' + ICON.play + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<p class="card__ja">' + esc(x.m) + '</p>' +
      infoGridHtml(x) +
      examplesHtml(x) +
      altNoteHtml(x) +
    '</div>';

    html += '<div class="kpi-grid">' +
      kpi(c ? c.ok : 0, "回", "正解") +
      kpi(c ? c.ng : 0, "回", "間違い") +
    '</div>';

    html += '<p class="note" style="text-align:center">' + badgeHtml(x.id) + ' ' + esc(sched) + '</p>';

    html += '<div class="quick-row">' +
      '<button class="btn" data-act="mark-due">要復習にする</button>' +
      '<button class="btn" data-act="mark-mature">習得にする</button>' +
    '</div>';
    return html;
  }

  /* 詳細の筆順。strokeStep = 0 は全画、1以上はその画まで（その画を朱で強調） */
  function fillDetailStroke(play) {
    var x = BY_ID[detailId];
    if (!x) return;
    stroke.load(function (ok) {
      var box = document.getElementById("detail-stroke");
      var n = document.getElementById("stroke-n");
      if (!box || sheet !== "detail" || BY_ID[detailId] !== x) return;
      if (!ok || !stroke.count(x.k)) { box.innerHTML = '<p class="note">筆順を表示できません</p>'; return; }
      var total = stroke.count(x.k);
      box.innerHTML = stroke.svg(x.k, play ? { anim: true } : strokeStep ? { upto: strokeStep } : {});
      if (n) n.textContent = (strokeStep || total) + " / " + total + " 画";
      if (play) stroke.animate(box);
    }, [x.lv]);
  }

  function jukuDetailHtml() {
    var y = YOJI.filter(function (v) { return v.id === jukuId; })[0];
    var p = PAIRS.filter(function (v) { return v.id === jukuId; })[0];
    var r = store.state.jukugo[jukuId] || { ok: 0, ng: 0 };
    var html = '<div class="section-head"><h2 class="h">' + (y ? "四字熟語" : p && p.t === "対" ? "対義語" : "類義語") + '</h2>' +
      '<button class="icon-btn" data-act="sheet-close" aria-label="閉じる">' + ICON.close + '</button></div>';
    if (y) {
      html += '<div class="detail">' +
        '<p class="card__hanzi card__hanzi--yoji">' + esc(y.w) + '</p>' +
        '<p class="detail__reading">' + esc(y.r.join("")) + '</p>' +
        '<p class="term-detail__d">' + esc(y.m) + '</p>' +
        '<p class="note">' + LV_LABEL[y.lv] + 'の字までで書ける語</p>' +
      '</div>';
    } else if (p) {
      html += '<div class="detail">' +
        '<div class="pair-big"><span><b class="han">' + esc(p.a) + '</b><small>' + esc(p.ar) + '</small></span>' +
        '<span class="pair-big__op">' + (p.t === "対" ? "⇔" : "≒") + '</span>' +
        '<span><b class="han">' + esc(p.b) + '</b><small>' + esc(p.br) + '</small></span></div>' +
        '<p class="note">' + LV_LABEL[p.lv] + 'の字までで書ける語</p>' +
      '</div>';
    } else {
      return html + '<p class="empty">語が見つかりません。</p>';
    }
    html += '<div class="kpi-grid">' + kpi(r.ok, "回", "正解") + kpi(r.ng, "回", "間違い") + '</div>';
    return html;
  }

  /* ==================================================
     描画と遷移
     ================================================== */
  var TABS = [
    { k: "home", label: "学習", icon: "cards" },
    { k: "list", label: "一覧", icon: "list" },
    { k: "juku", label: "熟語", icon: "book" },
    { k: "stats", label: "記録", icon: "chart" }
  ];

  function tabFor(v) {
    if (v === "study" || v === "quiz") return "home";
    return v;
  }

  function renderTabs() {
    var due = srs.counts(pool(), day()).due;
    el.tabbar.innerHTML = TABS.map(function (t) {
      var cur = tabFor(view) === t.k;
      var dot = (t.k === "home" && due > 0)
        ? '<span class="tab-dot">' + (due > 99 ? "99+" : due) + '</span>' : "";
      return '<button data-tab="' + t.k + '"' + (cur ? ' aria-current="page"' : '') + '>' +
        ICON[t.icon] + '<span>' + t.label + '</span>' + dot + '</button>';
    }).join("");
  }

  function renderTopbar() {
    var inFlow = view === "study" || view === "quiz";
    var title = view === "study" ? "学習中"
      : view === "quiz" ? quizTitle()
      : view === "juku" ? "熟語"
      : view === "list" ? "漢字一覧"
      : view === "stats" ? "学習の記録"
      : "漢検 漢字帳";

    var left = inFlow
      ? '<button class="icon-btn" data-act="leave" aria-label="やめる">' + ICON.back + '</button>'
      : '';

    el.topbar.innerHTML = left +
      '<h1 class="topbar__title">' + (inFlow ? "" : '<span class="cn">漢</span>') + esc(title) + '</h1>' +
      '<span class="topbar__spacer"></span>' +
      '<button class="icon-btn" data-act="settings" aria-label="設定">' + ICON.gear + '</button>';
  }

  function render() {
    renderTopbar();
    if (view === "home") renderHome();
    else if (view === "study") renderStudy();
    else if (view === "quiz") renderQuiz();
    else if (view === "list") renderList();
    else if (view === "juku") renderJuku();
    else if (view === "stats") renderStats();
    renderTabs();
    renderSheet();
    ads.refresh(el.screen);
  }

  function go(v) {
    view = v;
    window.scrollTo(0, 0);
    render();
  }

  function leaveFlow() { session = null; quiz = null; }

  /* ==================================================
     操作の受け取り
     ================================================== */
  function onClick(e) {
    var t = e.target;
    var hit = function (attr) {
      var n = t.closest ? t.closest("[" + attr + "]") : null;
      return n ? n.getAttribute(attr) : null;
    };

    if (t.classList && t.classList.contains("sheet-wrap")) { closeSheet(); return; }

    var act = hit("data-act");
    var tab = hit("data-tab");
    var goTo = hit("data-go");
    var grade = hit("data-grade");
    var choice = hit("data-choice");
    var filter = hit("data-filter");
    var kanjiId = hit("data-kanji");
    var jukuRef = hit("data-juku");
    var levelBtn = hit("data-level");
    var setKey = hit("data-set");
    var kind = hit("data-kind");
    var kindSet = hit("data-kindset");
    var jtab = hit("data-jtab");

    if (setKey !== null) {
      var raw = t.closest("[data-set]").getAttribute("data-val");
      store.settings[setKey] = raw === "true" ? true : raw === "false" ? false : raw;
      store.save();
      if (setKey === "theme") applyTheme();
      render();
      return;
    }

    if (levelBtn !== null && t.closest(".chip")) {
      var arr = store.settings.levels.slice();
      var at = arr.indexOf(levelBtn);
      if (at === -1) arr.push(levelBtn);
      else if (arr.length > 1) arr.splice(at, 1);
      else { toast("級は1つ以上選んでください"); return; }
      arr.sort(function (a, b) { return LV_RANK[a] - LV_RANK[b]; });
      store.settings.levels = arr;
      store.save();
      render();
      return;
    }

    if (kindSet !== null) {
      var ks = store.settings.kinds.slice();
      var ki = ks.indexOf(kindSet);
      if (ki === -1) ks.push(kindSet);
      else if (ks.length > 1) ks.splice(ki, 1);
      else { toast("形式は1つ以上選んでください"); return; }
      store.settings.kinds = KINDS.map(function (x) { return x.k; }).filter(function (k) { return ks.indexOf(k) !== -1; });
      store.save();
      render();
      return;
    }

    if (tab) { leaveFlow(); go(tab); return; }

    if (kind) { startQuiz([kind]); return; }

    if (jtab) { jukuUI.tab = jtab; render(); return; }

    if (goTo) {
      if (goTo === "study-normal") { startStudy("normal"); return; }
      if (goTo === "study-weak") { startStudy("weak"); return; }
      if (goTo === "quiz") { startQuiz(); return; }
      if (goTo === "home") { leaveFlow(); go("home"); return; }
    }

    if (grade) { doGrade(grade); return; }
    if (choice !== null) { answerQuiz(+choice); return; }
    if (filter) { listUI.filter = filter; render(); return; }
    if (kanjiId) { detailId = kanjiId; strokeStep = 0; openSheet("detail"); return; }
    if (jukuRef) { jukuId = jukuRef; openSheet("juku"); return; }

    switch (act) {
      case "reveal":
        if (session && !session.revealed) { session.revealed = true; render(); }
        return;
      case "study-stroke": {
        var sx = session && session.queue[0];
        if (!sx) return;
        stroke.load(function (ok) {
          var box = document.getElementById("study-stroke");
          if (!box) return;
          if (!ok) { box.innerHTML = '<p class="note">筆順を表示できません</p>'; return; }
          box.innerHTML = stroke.svg(sx.k, { anim: true });
          stroke.animate(box);
        }, [sx.lv]);
        return;
      }
      case "quiz-anim": {
        var qx = quiz && quiz.qs[quiz.i] && quiz.qs[quiz.i].ref;
        var qbox = document.getElementById("quiz-stroke");
        if (!qx || !qbox) return;
        qbox.innerHTML = stroke.svg(qx.k, { anim: true });
        stroke.animate(qbox);
        return;
      }
      case "stroke-prev":
      case "stroke-next": {
        var dx = BY_ID[detailId];
        var total = dx ? stroke.count(dx.k) : 0;
        if (!total) return;
        var cur = strokeStep || total;
        cur = act === "stroke-next" ? (cur >= total ? 1 : cur + 1) : (cur <= 1 ? total : cur - 1);
        strokeStep = cur === total ? 0 : cur;
        fillDetailStroke();
        return;
      }
      case "stroke-play":
        strokeStep = 0;
        fillDetailStroke(true);
        return;
      case "leave":
        leaveFlow(); go("home");
        return;
      case "settings":
        openSheet("settings");
        return;
      case "sheet-close":
        closeSheet();
        return;
      case "quiz-next":
        if (quiz) { quiz.i += 1; render(); }
        return;
      case "quiz-again":
        startQuiz(quiz ? quiz.kinds : null);
        return;
      case "goal+":
        store.settings.goal = Math.min(100, store.settings.goal + 5);
        store.save(); render();
        return;
      case "goal-":
        store.settings.goal = Math.max(5, store.settings.goal - 5);
        store.save(); render();
        return;
      case "mark-due":
        if (detailId) {
          var cd = store.card(detailId);
          cd.box = 0; cd.due = day();
          store.save(); closeSheet(); render();
          toast("要復習にしました");
        }
        return;
      case "mark-mature":
        if (detailId) {
          var cm = store.card(detailId);
          cm.box = 3; cm.due = store.shiftDays(day(), srs.intervalFor(3));
          store.save(); closeSheet(); render();
          toast("習得にしました");
        }
        return;
      case "reset":
        if (window.confirm("学習記録と連続日数をすべて消します。元に戻せません。よろしいですか？")) {
          store.reset();
          applyTheme();
          leaveFlow();
          closeSheet();
          go("home");
          toast("記録を消しました");
        }
        return;
    }
  }

  /* 入力欄の焦点を保つため、一覧部分だけ差し替える */
  function replaceList(html, count) {
    var countNode = el.screen.querySelector(".section-head .note");
    if (countNode) countNode.textContent = count;
    var node = el.screen.querySelector(".word-list") || el.screen.querySelector(".empty");
    if (node) node.outerHTML = html;
  }

  function onInput(e) {
    if (!e.target) return;
    if (e.target.id === "list-search") {
      listUI.q = e.target.value;
      var rows = filteredKanji();
      replaceList(kanjiListHtml(rows), rows.length + " 字");
    } else if (e.target.id === "juku-search") {
      jukuUI.q = e.target.value;
      var jr = filteredJuku();
      replaceList(jukuListHtml(jr), jr.length + " 語");
    }
  }

  function onKey(e) {
    if (e.key === "Escape" && sheet) { closeSheet(); return; }
    if (sheet) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (view === "study" && session) {
      if (!session.revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault(); session.revealed = true; render(); return;
      }
      if (session.revealed) {
        if (e.key === "1") { doGrade("again"); return; }
        if (e.key === "2") { doGrade("hard"); return; }
        if (e.key === "3" || e.key === " " || e.key === "Enter") { e.preventDefault(); doGrade("good"); return; }
      }
      return;
    }

    if (view === "quiz" && quiz) {
      var q = quiz.qs[quiz.i];
      if (!q) return;
      if (q.picked === -1 && /^[1-4]$/.test(e.key)) { answerQuiz(+e.key - 1); return; }
      if (q.picked !== -1 && (e.key === " " || e.key === "Enter")) { e.preventDefault(); quiz.i += 1; render(); }
    }
  }

  /* ==================================================
     起動
     ================================================== */
  function init() {
    store.load();
    /* 保存された級が今の収録に無い（古い版の記録など）ときは既定に戻す */
    store.settings.levels = store.settings.levels.filter(function (l) { return LV_RANK[l] !== undefined; });
    if (!store.settings.levels.length) store.settings.levels = ["3"];
    store.settings.kinds = store.settings.kinds.filter(function (k) { return KIND[k]; });
    if (!store.settings.kinds.length) store.settings.kinds = KINDS.map(function (x) { return x.k; });
    applyTheme();

    el.topbar = document.getElementById("topbar");
    el.screen = document.getElementById("screen");
    el.tabbar = document.getElementById("tabbar");
    el.sheet = document.getElementById("sheet");

    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    document.addEventListener("keydown", onKey);

    var openedOn = day();
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && day() !== openedOn) { openedOn = day(); render(); }
    });

    window.addEventListener("beforeunload", function () { store.saveNow(); });

    if (!KANJI.length) {
      el.screen.innerHTML = '<p class="empty">漢字データを読み込めませんでした。<br>data フォルダの kanji.js を確認してください。</p>';
      return;
    }

    go("home");
  }

  ns.app = {
    init: init,
    kanji: function () { return KANJI; },
    yoji: function () { return YOJI; },
    pairs: function () { return PAIRS; },
    buildQuiz: buildQuiz,
    startQuiz: startQuiz,
    /* dev/selftest.html 用: 形式ごとの問題を1問だけ組む */
    buildOne: function (kind, item) { return BUILD[kind](item); }
  };
})(window.KANKEN);

document.addEventListener("DOMContentLoaded", function () { window.KANKEN.app.init(); });
