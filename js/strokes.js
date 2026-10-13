/* ===========================================================
   strokes.js — 筆順の表示
   画のデータ（data/strokes*.js、KanjiVG 由来）は大きいので、
   筆順の画面や「何画目」の問題を開いたときに、その字の級のぶんだけ読み込む。
   =========================================================== */
window.KANKEN = window.KANKEN || {};

(function (ns) {
  "use strict";

  /* 画のデータは級ごとのファイルに分けてある（3〜2級で約650KB、1級は約2.5MB）。
     必要な級のファイルだけを読み込む */
  var base = "data/";            // dev/ のページからは "../data/" に差し替える
  var FILE = { "3": "strokes.js", "p2": "strokes.js", "2": "strokes.js", "p1": "strokes-p1.js", "1": "strokes-1.js" };
  var loaded = {};               // ファイル名 → true
  var pending = {};              // ファイル名 → 読み込みを待つ関数の列

  function filesFor(lvs) {
    var out = [];
    (lvs && lvs.length ? lvs : ["3"]).forEach(function (lv) {
      var f = FILE[lv];
      if (f && out.indexOf(f) === -1) out.push(f);
    });
    return out;
  }

  /* 指定した級の画のデータがそろっているか */
  function ready(lvs) {
    return filesFor(lvs).every(function (f) { return loaded[f]; });
  }

  function loadFile(f, cb) {
    if (loaded[f]) { cb(true); return; }
    if (pending[f]) { pending[f].push(cb); return; }
    pending[f] = [cb];
    var s = document.createElement("script");
    s.src = base + f;
    function finish(ok) {
      if (ok) loaded[f] = true;
      var list = pending[f];
      delete pending[f];
      list.forEach(function (fn) { fn(ok); });
    }
    s.onload = function () { finish(!!ns.strokes); };
    s.onerror = function () { finish(false); };
    document.head.appendChild(s);
  }

  /* 指定した級（省略時は 3 級）の画のデータを読み込む。cb(true) で使える、cb(false) で読み込めなかった */
  function load(cb, lvs) {
    var files = filesFor(lvs), left = files.length, all = true;
    if (!left) { cb(true); return; }
    files.forEach(function (f) {
      loadFile(f, function (ok) {
        all = all && ok;
        if (--left === 0) cb(all);
      });
    });
  }

  function paths(k) { return ns.strokes ? (ns.strokes[k] || null) : null; }

  /* 字の SVG。
     opts.hi    : 太く示す画（1始まり）。「何画目」の問題用
     opts.upto  : この画までだけ描く（それより後は薄い下書き）。一画ずつ見る用
     opts.anim  : 描き順のアニメーション用に、画を見えない状態で出す */
  function svg(k, opts) {
    opts = opts || {};
    var p = paths(k);
    if (!p) return "";
    var out = '<svg class="strokes" viewBox="0 0 109 109" role="img" aria-label="「' + k + '」の筆順">' +
      '<path class="strokes__grid" d="M54.5 2v105M2 54.5h105"/>';
    p.forEach(function (d, i) {
      var n = i + 1, cls = "strokes__s";
      if (opts.hi) cls += n === opts.hi ? " is-hi" : " is-dim";
      else if (opts.upto) cls += n < opts.upto ? "" : n === opts.upto ? " is-hi" : " is-ghost";
      else if (opts.anim) cls += " is-anim";
      out += '<path class="' + cls + '" d="' + d + '"/>';
    });
    return out + '</svg>';
  }

  /* 描き順を1画ずつ描いて見せる。box の中の svg.strokes を対象にする */
  function animate(box) {
    var list = box ? box.querySelectorAll(".strokes__s") : [];
    var delay = 0;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      el.classList.remove("is-ghost", "is-hi", "is-dim");
      var len = el.getTotalLength ? el.getTotalLength() : 0;
      if (!len || !el.animate) { el.classList.remove("is-anim"); continue; }
      el.style.strokeDasharray = len;
      el.style.strokeDashoffset = len;
      el.classList.remove("is-anim");
      var dur = Math.max(220, len * 9);
      el.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration: dur, delay: delay, easing: "ease-in-out", fill: "forwards" });
      delay += dur + 120;
    }
  }

  ns.stroke = {
    load: load,
    ready: ready,
    paths: paths,
    count: function (k) { var p = paths(k); return p ? p.length : 0; },
    svg: svg,
    animate: animate,
    setBase: function (b) { base = b; }
  };
})(window.KANKEN);
