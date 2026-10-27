/* 宋代职官数据库 · 在线版 */
(function () {
  'use strict';

  var INDEX = [];
  var META = { total: 0, shard: 80 };
  var shardCache = new Map();
  var curCat = '';
  var curK = -1;    // 官类筛选：-1 为不限，0..5 指 KLASS 下标
  var curTag = '';  // 身份群类筛选：'' 为不限；与层、六类并行不悖
  var curC = '';    // 二级类筛选：'' 为不限
  var TAGS = {};    // 词条页：'L:官' / 'C:名号|蕃官名号' / 'K:监当官' / 'G:蕃官' -> 内容
  var EMB = window.__EMB__ || null;   // 离线单文件模式：数据内嵌，不走 fetch
  var curList = [];
  var shown = 0;
  var PAGE = 120;
  var curId = null;
  var KLASS = ['京官', '朝官', '亲民官', '环卫官', '幕职官', '监当官'];
  var KB = null;   // 六类判定的史料依据库（data/klass.json）
  var DUPS = {};   // 重名条目：列表中标出门类以示区别

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var elQ = $('#q'), elStat = $('#stat'), elList = $('#list'),
      elChips = $('#chips'), elDetail = $('#dbody'), elIntro = $('#dintro'),
      elEmpty = $('#empty'), elMore = $('#more'), elMoreBtn = $('#morebtn'),
      elClr = $('#clr'), elPane = $('#detailpane');

  /* ───────── 配色映射 ───────── */
  var BADGE = {
    '官': 'b-guan', '职': 'b-zhi', '差遣': 'b-chai',
    '名号': 'b-ming', '其他': 'b-fei',
    '机构': 'b-inst', '军职': 'b-inst', '内侍官': 'b-inst',
    '技术官': 'b-inst', '学官': 'b-inst', '吏职': 'b-inst',
    '名号': 'b-inst', '文书': 'b-inst', '军士': 'b-inst',
    '曹官': 'b-inst', '环卫官': 'b-inst', '其他': 'b-inst'
  };
  function badge(g) {
    if (!g) return '';
    return '<span class="b ' + (BADGE[g] || 'b-inst') + '">' + esc(g) + '</span>';
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ───────── 检索评分 ───────── */
  function norm(s) { return String(s || '').replace(/[\s　]+/g, ''); }

  // 机构通名后缀：搜「转运使」时「转运使司」应排在「路转运使」之后
  var INST_TAIL = /[司院局库务场仓所寺监台阁馆门曹]$/;

  function score(e, q) {
    var n = e.n, c = norm(e.c) || n, s = 0;
    var dn = n.length - q.length, dc = c.length - q.length;
    if (n === q) s = 1000;
    else if (c === q) s = 960;
    else if (dn >= 0 && dn <= 3 && n.slice(-q.length) === q) s = 912 - dn * 12;
    else if (dc >= 0 && dc <= 3 && c.slice(-q.length) === q) s = 880 - dc * 12;
    else if (n.indexOf(q) === 0) s = 830 - Math.min(n.length, 24) * 2;
    else if (c.indexOf(q) === 0) s = 795 - Math.min(c.length, 24) * 2;
    else if (n.indexOf(q) > 0) s = 620 - n.indexOf(q) * 5 - Math.min(n.length, 24);
    else if (c.indexOf(q) > 0) s = 580 - c.indexOf(q) * 5 - Math.min(c.length, 24);
    if (!s && e.a && e.a.length) {
      for (var i = 0; i < e.a.length; i++) {
        var a = norm(e.a[i]);
        if (a === q) s = Math.max(s, 720 - Math.min(a.length, 20) * 2);
        else if (a.indexOf(q) === 0) s = Math.max(s, 520 - Math.min(a.length, 20) * 2);
        else if (a.indexOf(q) > 0) s = Math.max(s, 340 - Math.min(a.length, 20));
      }
    }
    // 类名亦可检：输入「蕃官」应带出蕃官名号一类诸条
    if (!s && q.length >= 2 && e.C && norm(e.C).indexOf(q) >= 0) s = 300;
    if (s > 0) {
      if (INST_TAIL.test(n) && !INST_TAIL.test(q)) s -= 70;
      if (e.d) s += 18;                    // 有元丰前后对照者优先
      if (e.L === '官' || e.L === '差遣' || e.L === '职') s += 6;
    }
    return s;
  }

  function search(q) {
    var out = [];
    for (var i = 0; i < INDEX.length; i++) {
      var e = INDEX[i];
      if (curCat && e.L !== curCat) continue;
      if (curC && e.C !== curC) continue;
      if (curTag && (e.T || []).indexOf(curTag) < 0) continue;
      if (!q) { out.push(e); continue; }
      var s = score(e, q);
      if (s > 0) { e._s = s; out.push(e); }
    }
    if (q && out.length) {
      out.sort(function (a, b) {
        return (b._s - a._s) || (a.b - b.b) || String(a.n).localeCompare(String(b.n));
      });
    }
    return out;
  }

  /* ───────── 列表渲染 ───────── */
  function itemHTML(e) {
    var meta = '';
    if (e.d && e.L && e.L2) {
      meta = badge(e.L) + (e.C ? '<span class="cat">' + esc(e.C) + '</span>' : '') +
             '<span class="arrow">→</span>' + badge(e.L2) +
             (e.C2 ? '<span class="cat">' + esc(e.C2) + '</span>' : '') +
             '<span class="b b-dual">元丰前后</span>';
    } else if (e.d) {
      meta = badge(e.L) + '<span class="arrow">→</span>' + badge(e.L2 || e.L) +
             '<span class="b b-dual">元丰前后</span>';
    } else {
      meta = badge(e.L) + (e.C ? '<span class="cat">' + esc(e.C) + '</span>' : '');
    }
    if (e.p || e.q) {
      meta += '<span class="arrow">·</span><span>' +
              esc(e.d ? (e.p || '—') + ' → ' + (e.q || '—') : (e.p || e.q)) + '</span>';
    }
    return '<button class="item" data-id="' + e.i + '"' +
           (e.i === curId ? ' aria-current="true"' : '') + '>' +
           '<span class="nm">' + esc(e.n) +
           (DUPS[e.n] && e.b ? '<span class="dup">原书 ' + e.b + ' 页</span>' : '') +
           '</span>' +
           '<span class="meta">' + meta + '</span></button>';
  }

  function renderList(reset) {
    var hint = $('#hint');
    if (hint) hint.style.display = (norm(elQ.value) || curCat || curK >= 0 || curTag) ? 'none' : '';
    if (reset) { shown = 0; elList.innerHTML = ''; }
    var end = Math.min(shown + PAGE, curList.length);
    var buf = '';
    for (var i = shown; i < end; i++) buf += itemHTML(curList[i]);
    elList.insertAdjacentHTML('beforeend', buf);
    shown = end;
    elMore.hidden = end >= curList.length;
    elEmpty.hidden = curList.length > 0;
  }

  function updateStat(n) {
    var q = norm(elQ.value);
    if (!INDEX.length) { elStat.textContent = '正在载入…'; return; }
    var parts = [];
    if (q) parts.push('「' + q + '」');
    if (curCat) parts.push('层：' + curCat + (curC ? ' · ' + curC : ''));
    else if (curC) parts.push('类：' + curC);
    if (curK >= 0) parts.push('官类：' + KLASS[curK]);
    if (curTag) parts.push('群类：' + curTag);
    if (parts.length) elStat.textContent = parts.join(' · ') + '　命中 ' + n + ' 条';
    else elStat.textContent = '全库 ' + META.total + ' 条　·　输入职官名即可检索';
  }

  function refresh() {
    var q = norm(elQ.value);
    elClr.hidden = !elQ.value;
    curList = search(q);
    if (curK >= 0) {
      curList = curList.filter(function (e) { return (e.kk || 0) & KBIT[curK]; });
    }
    renderList(true);
    updateStat(curList.length);
  }

  /* ───────── 分类筛选 ───────── */
  function buildChips() {
    var cnt = {};
    INDEX.forEach(function (e) { cnt[e.L] = (cnt[e.L] || 0) + 1; });
    var order = ['官', '职', '差遣', '名号', '机构', '其他'];
    var keys = order.filter(function (k) { return cnt[k]; });
    var html = '<button class="chip" data-c="" aria-pressed="true">全部<span class="num">' +
               META.total + '</span></button>';
    keys.forEach(function (k) {
      html += '<button class="chip" data-c="' + esc(k) + '" aria-pressed="false">' +
              esc(k) + '<span class="num">' + cnt[k] + '</span></button>';
    });
    elChips.innerHTML = html;
    buildKChips();
  }

  /* 官类筛选：京官、朝官、亲民官、环卫官、幕职官、监当官 */
  var KBIT = [1, 2, 4, 8, 16, 32];
  function buildKChips() {
    var box = $('#kchips');
    if (!box) return;
    var h = '';
    for (var i = 0; i < KLASS.length; i++) {
      var n = 0;
      INDEX.forEach(function (e) { if ((e.kk || 0) & KBIT[i]) n++; });
      h += '<button class="kchip" data-k="' + i + '" aria-pressed="false">' +
           KLASS[i] + '<span class="num">' + n + '</span></button>';
    }
    h += buildTagChips();
    h += buildPinChips();
    box.innerHTML = h;
  }

  /* 身份群类：宰执官、侍从官、台谏官、选人、厘务官……接在官类之后，同排铺开。
     一条可具数签，与层、六类并行不悖。 */
  /* 名号层诸类（蕃官名号等）另作一列，点之即入该类词条页 */
  function buildPinChips() {
    if (!META.pins || !META.pins.length) return '';
    var h = '<span class="kdiv">名号</span>';
    META.pins.forEach(function (x) {
      if (!x.c) return;
      h += '<button class="kchip tchip pchip" data-cat="' + esc(x.L + '|' + x.n) +
           '" aria-pressed="false" title="' + esc(x.n) + '　' + x.c + ' 条">' +
           esc(x.n) + '<span class="num">' + x.c + '</span></button>';
    });
    return h;
  }

  function buildTagChips() {
    if (!META.tags) return '';
    var h = '<span class="kdiv">群类</span>';
    META.tags.forEach(function (t) {
      if (!t.c) return;
      h += '<button class="kchip tchip" data-t="' + esc(t.n) + '" aria-pressed="false" ' +
           'title="' + esc(t.name || t.n) + '　' + t.c + ' 条">' + esc(t.n) +
           '<span class="num">' + t.c + '</span></button>';
    });
    return h;
  }

  /* ───────── 筛选与词条页 ───────── */

  function syncChips() {
    $$('.chip').forEach(function (c) {
      c.setAttribute('aria-pressed', String((c.dataset.c || '') === curCat));
    });
    $$('.kchip').forEach(function (c) {
      if (c.dataset.t) c.setAttribute('aria-pressed', String(c.dataset.t === curTag));
      else c.setAttribute('aria-pressed',
        String(parseInt(c.dataset.k, 10) === curK));
    });
  }

  /* 当前筛选状态 -> 右侧该显示哪一页 */
  function renderPage() {
    curId = null;
    $$('.item').forEach(function (b) { b.removeAttribute('aria-current'); });
    if (curC) return showTagPage('C', curCat + '|' + curC);
    if (curTag) return showTagPage('G', curTag);
    if (curK >= 0) return showTagPage('K', KLASS[curK]);
    if (curCat) return showTagPage('L', curCat);
    return showHome();
  }

  function showHome() {
    elDetail.innerHTML = '';
    elDetail.hidden = true;
    elIntro.hidden = false;
    document.body.classList.remove('viewing');
    history.replaceState(null, '', location.pathname + location.search);
    document.title = '即事见风·宋代职官数据库';
  }

  function tagItem(kind, key) { return TAGS[kind + ':' + key] || null; }

  function showTagPage(kind, key) {
    var t = tagItem(kind, key);
    if (!t) return showHome();
    var h = '<div class="tghead"><p class="tgkind">' + esc(t.sub || '') + '</p>' +
            '<h2>' + esc(t.n) + '<span class="tgc">' + (t.c || 0) + ' 条</span></h2></div>';
    h += '<section class="sec tgs"><h3>界定</h3><p class="tgdef">' + esc(t.def || '') + '</p>';
    if (t.ex) h += '<p class="knote">例　' + esc(t.ex) + '</p>';
    if (t.up) {
      var up = TAGS[t.up];
      if (up) h += '<p class="knote">所属层　<button class="lnk" data-tg="' + esc(t.up) + '">' +
        esc(up.n) + '</button></p>';
    }
    h += '</section>';

    if (t.subs && t.subs.length) {
      h += '<section class="sec"><h3>下属类目</h3><div class="tgsubs">';
      t.subs.forEach(function (x) {
        h += '<button class="tgsub" data-tg="C:' + esc(t.n + '|' + x.n) + '">' +
             '<b>' + esc(x.n) + '</b><span>' + x.c + ' 条</span></button>';
      });
      h += '</div></section>';
    }

    // 本页代表词条
    var ex = [];
    for (var i = 0; i < INDEX.length && ex.length < 14; i++) {
      var e = INDEX[i];
      if (inPage(t, e)) ex.push(e);
    }
    if (ex.length) {
      h += '<section class="sec"><h3>本页词条（前 ' + ex.length + ' 条）</h3><div class="tgex">';
      ex.forEach(function (e) {
        h += '<button class="al" data-goid="' + e.i + '">' + esc(e.n) + '</button>';
      });
      h += '</div><p class="knote">左侧为全部检索结果，点任一条目即看详情。</p></section>';
    }

    if (t.refs && t.refs.length) {
      h += '<section class="sec"><h3>相关研究</h3><ul class="rf">';
      t.refs.forEach(function (r) {
        h += '<li><b>' + esc(r.t) + '</b>' + (r.n ? '<span>' + esc(r.n) + '</span>' : '') + '</li>';
      });
      h += '</ul></section>';
    }
    if (t.extra && t.extra.length) {
      h += '<section class="sec"><h3>专题论文</h3><ul class="rf">';
      t.extra.forEach(function (x) { h += '<li><b>' + esc(x) + '</b></li>'; });
      h += '</ul></section>';
    }
    if (t.src) {
      h += '<section class="sec"><h3>界定出处</h3><p class="knote">' + esc(t.src) + '</p></section>';
    }
    h += '<p class="tgfoot">以上为「' + esc(t.n) + '」的界说与相关研究。' +
         '点左侧任一词条，即入该条详情；若要重来，按上方「回到主页」。</p>';

    elDetail.innerHTML = h;
    elDetail.hidden = false;
    elIntro.hidden = true;
    document.body.classList.add('viewing');
    document.title = t.n + ' · 即事见风·宋代职官数据库';
    bindPage();
  }

  /* 该词条属于本页否 */
  function inPage(t, e) {
    var k = t.k;
    if (k.slice(0, 2) === 'L:') return e.L === t.n;
    if (k.slice(0, 2) === 'C:') return e.C === t.n && e.L === (t.up || '').slice(2);
    if (k.slice(0, 2) === 'K:') {
      var i = KLASS.indexOf(t.n);
      return i >= 0 && ((e.kk || 0) & KBIT[i]) !== 0;
    }
    if (k.slice(0, 2) === 'G:') return (e.T || []).indexOf(t.n) >= 0;
    return false;
  }

  function bindPage() {
    $$('.tgsub', elDetail).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.tg;             // C:层|类
        var rest = k.slice(2).split('|');
        curCat = rest[0]; curC = rest[1]; curK = -1; curTag = '';
        elQ.value = ''; elClr.hidden = true;
        syncChips(); refresh();
        showTagPage('C', rest.join('|'));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    $$('.lnk', elDetail).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.tg;
        curC = ''; curCat = k.slice(2); curK = -1; curTag = '';
        elQ.value = ''; elClr.hidden = true;
        syncChips(); refresh();
        showTagPage('L', curCat);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    $$('.al[data-goid]', elDetail).forEach(function (b) {
      b.addEventListener('click', function () { openById(+b.dataset.goid); });
    });
  }

  /* 点任一签：清空检索词，跳到该签的页 */
  function goTag(kind, key) {
    curId = null;
    elQ.value = '';
    elClr.hidden = true;
    if (kind === 'L') { curCat = key; curC = ''; curK = -1; curTag = ''; }
    else if (kind === 'C') {
      var pr = key.split('|');
      curCat = pr[0]; curC = pr[1]; curK = -1; curTag = '';
    } else if (kind === 'K') { curK = KLASS.indexOf(key); curCat = ''; curC = ''; curTag = ''; }
    else if (kind === 'G') { curTag = key; }
    syncChips();
    refresh();
    showTagPage(kind, key);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* 层签 */
  elChips.addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip');
    if (!b) return;
    var c = b.dataset.c || '';
    if (!c) {                                   // 「全部」
      curCat = ''; curC = ''; curK = -1; curTag = '';
      elQ.value = ''; elClr.hidden = true;
      syncChips(); refresh(); showHome();
      return;
    }
    goTag('L', c);
  });

  /* 六类、群类 */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('.kchip, .tg');
    if (!b) return;
    ev.preventDefault();
    if (b.dataset.cat) { goTag('C', b.dataset.cat); return; }
    if (b.dataset.t) { goTag('G', b.dataset.t); return; }
    var i = parseInt(b.dataset.k, 10);
    if (isNaN(i)) return;
    goTag('K', KLASS[i]);
  });

  /* ───────── 详情 ───────── */
  function shardOf(id) { return Math.floor(id / META.shard); }

  function bust() {
    return '?v=' + encodeURIComponent(window.__BUILD__ || 'dev');
  }

  function loadShard(k, tries) {
    if (shardCache.has(k)) return Promise.resolve(shardCache.get(k));
    if (EMB && EMB.shards) {
      var j0 = EMB.shards[k] || EMB.shards[String(k)] || {};
      shardCache.set(k, j0);
      return Promise.resolve(j0);
    }
    tries = tries == null ? 2 : tries;
    return fetch('data/d/' + k + '.json' + bust())
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) { shardCache.set(k, j); return j; })
      .catch(function (e) {
        if (tries <= 0) throw e;
        return new Promise(function (res) { setTimeout(res, 320); })
          .then(function () { return loadShard(k, tries - 1); });
      });
  }

  function getEntry(id) {
    return loadShard(shardOf(id)).then(function (j) { return j[String(id)]; });
  }

  function splitFold(paras, limit) {
    var head = [], rest = [], acc = 0, cutting = false;
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      if (cutting) { rest.push(p); continue; }
      if (acc + p.length <= limit) { head.push(p); acc += p.length; }
      else {
        head.push(p.slice(0, limit - acc) + '……');
        rest.push(p.slice(limit - acc));
        cutting = true;
      }
    }
    return [head, rest];
  }

  function secHTML(title, text, cls) {
    if (!text) return '';
    var paras = String(text).split(/\n+/).filter(function (t) { return t.trim(); });
    var total = paras.join('').length;
    var attr = cls ? ' class="' + cls + '"' : '';
    function P(a) { return a.map(function (t) { return '<p' + attr + '>' + esc(t) + '</p>'; }).join(''); }

    if (total <= 460) {
      return '<section class="sec"><h3>' + title + '</h3>' + P(paras) + '</section>';
    }
    var sf = splitFold(paras, 380);
    return '<section class="sec"><h3>' + title + '</h3>' +
      '<div class="cut">' + P(sf[0]) + '</div>' +
      '<div class="rest" hidden>' + P(sf[1]) + '</div>' +
      '<button class="ex" type="button" data-n="' + total + '">展开全文 · 共 ' + total + ' 字</button>' +
      '</section>';
  }

  function kcls(v) {
    if (!v) return 'na';
    if (v === '否') return 'no';
    if (v === '不适用') return 'na';
    if (v === '总名' || v === '未详') return 'sp';
    return 'yes';
  }

  function kshort(v) {
    return String(v || '')
      .replace(/元丰前/g, '前').replace(/元丰后/g, '后');
  }

  function klassBlock(d) {
    if (!d.k || !d.k.length) return '';
    var rows = '', proofs = '';
    for (var i = 0; i < KLASS.length; i++) {
      var v = d.k[i] || '';
      rows += '<div class="krow k-' + kcls(v) + '">' +
        '<span class="kname">' + KLASS[i] + '</span>' +
        '<span class="kval">' + esc(kshort(v) || '—') + '</span></div>';
      var why = d.kb && d.kb[KLASS[i]];
      if (why) {
        proofs += '<div class="kp"><p class="kp-h">' + KLASS[i] + '　' +
          esc(kshort(v)) + '</p><p class="kp-t">' + esc(why) + '</p></div>';
      }
    }
    var h = '<section class="sec kls"><h3>官类归属</h3>' +
      '<div class="kgrid">' + rows + '</div>' +
      '<p class="knote">京官、朝官说的是寄禄官阶的层级，不是差遣；' +
      '亲民官、环卫官、幕职官、监当官说的是职任的门类。' +
      '「不适用」有两层：一是该条本非官职（机构、文书、称谓、军士），六类俱无所施；' +
      '二是虽为官职而所论之栏非其所属之途，如差遣之于京、朝官——任此职者之阶随人而迁。</p>';
    if (proofs) {
      h += '<button class="ex kex" type="button">查看判定依据与史料原文</button>' +
           '<div class="kproof" hidden>' + proofs + '</div>';
    }
    h += '</section>';
    return h;
  }


  /* 层级（官／职／差遣／名号／机构／其他）与二级类 */
  function taxBlock(d) {
    if (!d.L) return '';
    var h = '<section class="sec tax"><h3>层级与类目</h3>';
    if (d.L2 && (d.L2 !== d.L || d.C2 !== d.C)) {
      h += '<div class="tdual">' +
        '<div class="tside"><p class="tera">元丰改制前</p>' +
        '<p class="tval"><b>' + esc(d.L) + '</b><span>' + esc(d.C || '—') + '</span></p></div>' +
        '<div class="tmid">→</div>' +
        '<div class="tside"><p class="tera">元丰改制后</p>' +
        '<p class="tval"><b>' + esc(d.L2) + '</b><span>' + esc(d.C2 || '—') + '</span></p></div>' +
        '</div>';
    } else {
      h += '<div class="tgrid">' +
        '<div class="trow"><span class="tname">层</span><b>' +
        '<button class="lnk" data-tg="L:' + esc(d.L) + '">' + esc(d.L) + '</button></b></div>' +
        '<div class="trow"><span class="tname">类</span><b>' +
        (d.C ? '<button class="lnk" data-tg="C:' + esc(d.L + '|' + d.C) + '">' +
               esc(d.C) + '</button>' : '—') + '</b></div></div>';
    }
    if (d.sc) {
      h += '<div class="tgrid"><div class="trow"><span class="tname">侍从官</span><b class="' +
        (String(d.sc).indexOf('是') === 0 ? 'k-yes' : (d.sc === '否' ? 'k-no' : 'k-na')) +
        '">' + esc(d.sc) + '</b></div></div>';
    }
    if (d.T && d.T.length) {
      h += '<div class="tgrid"><div class="trow"><span class="tname">群类</span><b class="tgl">' +
        d.T.map(function (t) {
          return '<button class="tg" data-t="' + esc(t) + '" type="button">' + esc(t) + '</button>';
        }).join('') + '</b></div></div>';
    }
    var dualTag = (d.L2 && (d.L2 !== d.L || d.C2 !== d.C));
    if (d.tw) h += '<p class="knote">归类依据' + (dualTag ? '（元丰前）' : '') + '　' + esc(d.tw) + '</p>';
    if (d.tw2) h += '<p class="knote">归类依据（元丰后）　' + esc(d.tw2) + '</p>';
    var srcTxt;
    if (d.bp) srcTxt = '原书第 ' + d.bp + ' 页；层之界说见《宋史》卷一六一《职官志一》、' +
         '卷一六二《职官志二》';
    else if (d.bian === '补录') srcTxt = '本条为补录，据正史、政书；' +
         '层之界说见《宋史》卷一六一《职官志一》、卷一六二《职官志二》';
    else srcTxt = '《宋史》卷一六一《职官志一》、卷一六二《职官志二》，中华书局1977年点校本';
    h += '<p class="knote ksrc">出处　' + esc(srcTxt) + '。</p>';
    var deep = '';
    if (d.sw) deep += '<p class="knote">侍从之判　' + esc(d.sw) + '</p>';
    if (d.TW) deep += '<p class="knote">群类之判　' + esc(d.TW) + '</p>';
    deep += '<p class="knote">三者不同轴：层（官、职、差遣、名号、机构、其他）言其性质；' +
         '六类（京官、朝官言寄禄之阶，亲民、环卫、幕职、监当言职任之门）言其在铨选之位置；' +
         '群类（宰执、侍从、台谏、选人、厘务之类）言其所属之官僚群体。故一条可具数签，' +
         '重合非误，正见宋制「一官而数义」之实。</p>';
    h += '<button class="ex deepx" type="button">判定与说明（点开）</button>' +
         '<div class="deepbox" hidden>' + deep + '</div>';
    return h + '</section>';
  }

  function renderDetail(d, id) {
    var h = '';

    // 标题区
    h += '<div class="dh"><h2>' + esc(d.n);
    if (d.L && !d.dual) h += badge(d.L);
    h += '</h2>';
    if (d.raw) h += '<p class="raw">' + esc(d.raw) + '</p>';
    var loc = [];
    if (d.bian) loc.push('<b>' + esc(d.bian) + '</b>' + (d.men ? '　' + esc(d.men) : ''));
    if (d.bp) loc.push('《宋代官制辞典》第 ' + d.bp + ' 页');
    else loc.push('补录条目（据正史、政书）');
    h += '<p class="loc">' + loc.join('　·　') + '</p></div>';

    // 元丰前后对照 / 单轨性质
    if (d.dual) {
      h += '<div class="dual"><p class="dual-h">元丰改制前后</p><div class="dual-grid">';
      h += '<div class="side"><p class="era">元丰改制前</p>' +
           '<p class="nat">' + esc(d.dp || '—') + '</p>' +
           (d.L ? '<div>' + badge(d.L) + '</div>' : '') +
           (d.p ? '<p class="rk" style="margin-top:6px">品级　<b>' + esc(d.p) + '</b></p>' : '') +
           '</div>';
      h += '<div class="mid">→</div>';
      h += '<div class="side"><p class="era">元丰改制后</p>' +
           '<p class="nat">' + esc(d.dq || '—') + '</p>' +
           (d.L2 || d.L ? '<div>' + badge(d.L2 || d.L) + '</div>' : '') +
           (d.q ? '<p class="rk" style="margin-top:6px">品级　<b>' + esc(d.q) + '</b></p>' : '') +
           '</div>';
      h += '</div></div>';
    } else {
      var kv = [];
      if (d.raw) kv.push('<div class="kv"><span class="k">原书定性</span><span class="v">' + esc(d.raw) + '</span></div>');
      if (d.p || d.q) kv.push('<div class="kv"><span class="k">品级</span><span class="v">' + esc(d.p || d.q) + '</span></div>');
      h += '<div class="natbar">' + kv.join('') + '</div>';
    }

    h += taxBlock(d);

    // 正文段落
    var zy = d.zy, zz = d.zz;
    var rest = d.summary || '';
    // summary 若等于 zy+zz 拼接则不再重复展示
    if (zy || zz) {
      rest = '';
      if (d.bz || d.pw) {
        // 编制等已单列
      }
    }
    h += secHTML('职源与沿革', zy);
    h += secHTML('职掌', zz);
    if (!zy && !zz) h += secHTML('释文', rest);

    if (d.jc) {
      h += '<section class="sec"><h3>简称与别名</h3><p>' + esc(d.jc) + '</p>';
      if (d.al && d.al.length) {
        h += '<div class="ali">' + d.al.map(function (a) {
          return '<button class="al" data-w="' + esc(a) + '">' + esc(a) + '</button>';
        }).join('') + '</div>';
      }
      h += '</section>';
    }

    if (d.bz) h += secHTML('编制', d.bz);
    if (d.pw) h += secHTML('品位', d.pw);

    // 官类归属与判定依据（置于品位之下，为详情页末节）
    h += klassBlock(d);

    // 页脚：页码与归类，不列出版信息
    var srcs = [];
    if (d.bp) srcs.push('原书第 ' + d.bp + ' 页');
    if (d.bian) srcs.push('归类：' + d.bian + (d.men ? ' ' + d.men : ''));
    srcs.push('释文照录原书，有疑处请覆核原书；本库仅供内部测验，错讹尚多。');
    h += '<div class="src">' + srcs.map(function (s) { return esc(s); }).join('<br>') + '</div>';

    // 报错与更正
    h += repairBlock(id, d.n);

    elDetail.innerHTML = h;
    elDetail.hidden = false;
    elIntro.hidden = true;
    document.body.classList.add('viewing');
    bindInDetail();
  }

  /* ───────── 报错与更正 ───────── */
  var MAIL = 'hughzudao@qq.com';
  function repKey(id) { return 'sbzg-rep-' + id; }
  function repLoad(id) {
    try { return JSON.parse(localStorage.getItem(repKey(id)) || '[]'); }
    catch (e) { return []; }
  }
  function repSave(id, arr) {
    try { localStorage.setItem(repKey(id), JSON.stringify(arr)); } catch (e) { }
  }

  function repairBlock(id, name) {
    var mine = repLoad(id);
    var h = '<section class="sec rep"><h3>报错与更正</h3>' +
      '<p class="knote">此条若有错讹（归类不当、释文有误、错字断句、条目缺失），请在此写明。' +
      '提交后会自动打开您的邮件程序，把内容发往 ' + MAIL + '，同时在本机留一份记录，便于回看。</p>' +
      '<div class="repform" data-id="' + id + '" data-nm="' + esc(name) + '">' +
      '<div class="reprow">' +
      '<select class="rsel" aria-label="问题类型">' +
      '<option>归类有误</option><option>释文有误</option><option>错字、断句</option>' +
      '<option>品级有误</option><option>条目缺失</option><option>其他</option></select>' +
      '<input class="rmail" type="email" placeholder="您的邮箱（选填，便于回复）">' +
      '</div>' +
      '<textarea class="rtxt" rows="3" placeholder="请写明错处与依据（如原书页码、史料原文、论文出处）"></textarea>' +
      '<div class="reprow"><button class="rbtn" type="button">提交报错</button>' +
      '<button class="rcopy" type="button">只复制内容</button>' +
      '<span class="rmsg" aria-live="polite"></span></div></div>';
    if (mine.length) {
      h += '<div class="replist"><p class="rlh">您在本机提交过 ' + mine.length + ' 条：</p>';
      mine.slice(-5).forEach(function (x) {
        h += '<p class="rl"><b>' + esc(x.k) + '</b>' + esc(x.d) +
             '<span>' + esc(x.t) + '</span></p>';
      });
      h += '</div>';
    }
    return h + '</section>';
  }

  function repText(f, name) {
    var k = $('.rsel', f).value;
    var d = $('.rtxt', f).value.trim();
    var m = $('.rmail', f).value.trim();
    var t = new Date().toLocaleString('zh-CN');
    var body = '条目：' + name + '\n类型：' + k + '\n说明：' + d +
               (m ? '\n联系邮箱：' + m : '') + '\n时间：' + t +
               '\n（此信由「即事见风·宋代职官数据库」页面生成）';
    return { k: k, d: d, m: m, t: t, body: body };
  }

  function bindRepair(f) {
    var id = f.dataset.id, name = f.dataset.nm;
    function fire(open) {
      var r = repText(f, name);
      if (!r.d) { $('.rmsg', f).textContent = '请先写明错处'; return; }
      var arr = repLoad(id);
      arr.push({ k: r.k, d: r.d, t: r.t });
      repSave(id, arr);
      $('.rmsg', f).textContent = '已记下（本机保存），谢谢！';
      $('.rtxt', f).value = '';
      // 立即在下方显示本机记录
      var box = f.parentNode.querySelector('.replist');
      if (!box) {
        box = document.createElement('div');
        box.className = 'replist';
        box.innerHTML = '<p class="rlh"></p>';
        f.parentNode.insertBefore(box, f.nextSibling);
      }
      $('.rlh', box).textContent = '您在本机提交过 ' + arr.length + ' 条：';
      var line = document.createElement('p');
      line.className = 'rl';
      line.innerHTML = '<b>' + esc(r.k) + '</b>' + esc(r.d) + '<span>' + esc(r.t) + '</span>';
      box.appendChild(line);
      if (open) {
        location.href = 'mailto:' + MAIL +
          '?subject=' + encodeURIComponent('【职官数据库报错】' + name) +
          '&body=' + encodeURIComponent(r.body);
      } else {
        if (navigator.clipboard) navigator.clipboard.writeText(r.body);
        $('.rmsg', f).textContent = '已复制到剪贴板，可粘贴到邮件或微信';
      }
    }
    var b1 = $('.rbtn', f), b2 = $('.rcopy', f);
    if (b1) b1.addEventListener('click', function () { fire(true); });
    if (b2) b2.addEventListener('click', function () { fire(false); });
  }

  function bindInDetail() {
    $$('.deepx', elDetail).forEach(function (b) {
      b.addEventListener('click', function () {
        var box = b.nextElementSibling;
        var open = box.hidden;
        box.hidden = !open;
        b.textContent = open ? '收起判定与说明' : '判定与说明（点开）';
      });
    });
    $$('.lnk', elDetail).forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.tg;                       // L:官 / C:名号|蕃官名号
        if (k.slice(0, 2) === 'L:') { goTag('L', k.slice(2)); }
        else { goTag('C', k.slice(2)); }
      });
    });
    var f = $('.repform', elDetail);
    if (f) bindRepair(f);
    $$('.kex', elDetail).forEach(function (b) {
      b.addEventListener('click', function () {
        var box = b.nextElementSibling;
        var open = box.hidden;
        box.hidden = !open;
        b.textContent = open ? '收起判定依据' : '查看判定依据与史料原文';
      });
    });
    $$('.ex', elDetail).forEach(function (b) {
      if (b.classList.contains('kex')) return;
      b.addEventListener('click', function () {
        var sec = b.closest('.sec');
        var cut = $('.cut', sec), rest = $('.rest', sec);
        var open = rest.hidden;
        rest.hidden = !open;
        cut.hidden = open;
        b.textContent = open ? '收起' : '展开全文 · 共 ' + b.dataset.n + ' 字';
      });
    });
    $$('.al', elDetail).forEach(function (b) {
      b.addEventListener('click', function () {
        elQ.value = b.dataset.w;
        document.body.classList.remove('viewing');
        refresh();
        goTop();
      });
    });
  }

  /* ───────── 官制表格（十五种） ───────── */
  var TB = null;

  function tnl(s) {
    return esc(s).replace(/\n/g, '<br>');
  }

  function tblTreeHTML(tree) {
    var h = '<div class="tree">';
    for (var i = 0; i < tree.length; i++) {
      var n = tree[i], lv = n.lv || 0;
      h += '<div class="tL' + lv + '">' + esc(n.t || '') + '</div>';
    }
    return h + '</div>';
  }

  function tblTableHTML(it) {
    var cols = it.columns || [];
    var h = '<table><thead><tr>';
    for (var i = 0; i < cols.length; i++) h += '<th>' + esc(cols[i]) + '</th>';
    h += '</tr></thead><tbody>';
    var rows = it.rows || [];
    for (var r = 0; r < rows.length; r++) {
      h += '<tr>';
      for (var c = 0; c < cols.length; c++) {
        var v = rows[r][c];
        h += '<td>' + (v == null || v === '' ? '' : tnl(v)) + '</td>';
      }
      h += '</tr>';
    }
    return h + '</tbody></table>';
  }

  function buildTableCards() {
    var box = $('#tblcards');
    if (!box || !TB || !TB.items) return;
    var h = '';
    for (var i = 0; i < TB.items.length; i++) {
      var it = TB.items[i];
      h += '<button class="tcard" type="button" data-t="' + i + '">' +
        '<b>' + esc(it.no) + '</b>' + esc(it.title) + '</button>';
    }
    box.innerHTML = h;
  }

  function openTable(i) {
    if (!TB || !TB.items[i]) return;
    var it = TB.items[i];
    $('#tvtitle').textContent = it.no + '　' + it.title;
    $('#tvnote').textContent = (it.pages && it.pages.length)
      ? '原书第 ' + it.pages.join('、') + ' 页' : '';
    $('#tvbody').innerHTML = (it.kind === 'tree' ? tblTreeHTML(it.tree) : tblTableHTML(it)) +
      (it.notes ? '<p class="note">' + tnl(it.notes) + '</p>' : '');
    $('#tv').hidden = false;
    document.body.classList.add('tving');
    $('#tvbody').scrollTop = 0;
  }

  function closeTable() {
    $('#tv').hidden = true;
    document.body.classList.remove('tving');
  }

  /* 表格目录随版式归位：宽屏挂在右侧「输入职官名，即出结果」之内，
     窄屏挂在左侧提示块之内，免得要翻到列表末尾才见。 */
  function placeTblIdx() {
    var box = $('#tblidx');
    if (!box) return;
    var host = (window.innerWidth <= 860) ? $('#hint') : $('#dintro .intro-in');
    if (host && box.parentNode !== host) host.appendChild(box);
  }

  function boomTables() {
    if (window.__TABLES__) { TB = window.__TABLES__; buildTableCards(); placeTblIdx(); return; }
    if (EMB && EMB.tables) { TB = EMB.tables; buildTableCards(); placeTblIdx(); return; }
    fetch('data/tables.json')
      .then(function (r) { return r.json(); })
      .then(function (j) { TB = j; buildTableCards(); placeTblIdx(); })
      .catch(function () { /* 无表格数据时静默 */ });
  }


  function topOffset() {
    var hd = document.querySelector('.hd');
    var ch = document.querySelector('.chips');
    var h = hd ? hd.offsetHeight : 0;
    if (ch && ch.offsetParent !== null) h += ch.offsetHeight;
    return h + 8;
  }

  function goTop() {
    var y = elPane.getBoundingClientRect().top + window.pageYOffset - topOffset();
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  function showLoading() {
    elDetail.innerHTML = '<div class="loading"><span class="spin"></span>正在读取释文…</div>';
    elDetail.hidden = false;
    elIntro.hidden = true;
  }

  function openById(id, push) {
    if (id == null) return;
    curId = id;
    $$('.item').forEach(function (b) {
      if (+b.dataset.id === id) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    showLoading();
    document.body.classList.add('viewing');
    getEntry(id).then(function (d) {
      if (!d) { elDetail.innerHTML = '<div class="loading">条目缺失</div>'; return; }
      renderDetail(d, id);
      if (push !== false) {
        var e = INDEX.find(function (x) { return x.i === id; });
        if (e) history.replaceState(null, '', '#/' + encodeURIComponent(e.n));
        document.title = e.n + ' · 即事见风·宋代职官数据库';
      }
      if (window.innerWidth <= 860) {
        goTop();
      } else {
        var y = elPane.getBoundingClientRect().top + window.pageYOffset - topOffset();
        if (window.pageYOffset > y + 4) window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    }).catch(function () {
      elDetail.innerHTML = '<div class="loading">这一条的释文没有读到，多半是网络一时不通。' +
        '<br><span style="font-size:12px">若以本地文件方式打开，请改用在线地址。</span>' +
        '<br><button class="btn-retry" type="button">再读一次</button></div>';
      var rb = $('.btn-retry', elDetail);
      if (rb) rb.addEventListener('click', function () { openById(id); });
    });
  }

  /* ───────── 交互 ───────── */
  var t = null;
  elQ.addEventListener('input', function () {
    clearTimeout(t);
    elClr.hidden = !elQ.value;
    t = setTimeout(function () {
      // 检索一开，撤去全部筛选：任何时候检索都列出全库相关词条
      var had = (curCat || curC || curK >= 0 || curTag) ? 1 : 0;
      if (elQ.value.trim() && had) {
        curCat = ''; curC = ''; curK = -1; curTag = '';
        syncChips();
      }
      if (curId !== null || had) renderPage();
      refresh();
    }, 110);
  });
  elQ.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      clearTimeout(t); refresh();
      if (curList.length) openById(curList[0].i);
    } else if (ev.key === 'Escape') {
      elQ.value = ''; refresh();
    }
  });
  elClr.addEventListener('click', function () {
    elQ.value = ''; elQ.focus(); refresh();
  });

  elList.addEventListener('click', function (ev) {
    var b = ev.target.closest('.item');
    if (b) openById(+b.dataset.id);
  });
  elMoreBtn.addEventListener('click', function () { renderList(false); });

  $('#back').addEventListener('click', function () {
    renderPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* 回到主页：清空检索、撤去筛选，回到最初的那一屏 */
  $('#home').addEventListener('click', function () {
    elQ.value = '';
    elClr.hidden = true;
    curCat = '';
    curC = '';
    curK = -1;
    curTag = '';
    syncChips();
    curId = null;
    $$('.item').forEach(function (b) { b.removeAttribute('aria-current'); });
    elDetail.innerHTML = '';
    elDetail.hidden = true;
    elIntro.hidden = false;
    document.body.classList.remove('viewing');
    closeTable();
    history.replaceState(null, '', location.pathname + location.search);
    document.title = '即事见风·宋代职官数据库';
    refresh();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#tblcards').addEventListener('click', function (ev) {
    var b = ev.target.closest('.tcard');
    if (b) openTable(+b.dataset.t);
  });
  $('#tvclose').addEventListener('click', closeTable);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('#tv').hidden) closeTable();
  });

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('.qk');
    if (!b) return;
    elQ.value = b.dataset.w;
    refresh();
    if (curList.length) openById(curList[0].i);
  });

  window.addEventListener('hashchange', function () { routeFromHash(); });

  function routeFromHash() {
    var h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    if (!h) return;
    var e = INDEX.find(function (x) { return x.n === h || norm(x.c) === norm(h); });
    if (e) {
      elQ.value = e.n;
      if (curCat) { curCat = ''; $$('.chip').forEach(function (c) { c.setAttribute('aria-pressed', String(!c.dataset.c)); }); }
      refresh();
      openById(e.i, false);
    }
  }

  function setHdHeight() {
    var hd = document.querySelector('.hd');
    if (hd) document.documentElement.style.setProperty('--hdt', hd.offsetHeight + 'px');
  }
  window.addEventListener('resize', function () { setHdHeight(); placeTblIdx(); });
  window.addEventListener('load', setHdHeight);

  /* ───────── 启动 ───────── */
  function getJSON(name) {
    if (EMB && EMB[name]) return Promise.resolve(EMB[name]);
    return fetch('data/' + name + '.json' + bust())
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function boot() {
    getJSON('meta').catch(function () { return {}; })
      .then(function (m) { META = m || {}; if (!META.shard) META.shard = 80; })
      .then(function () { return getJSON('index'); })
      .then(function (list) {
        INDEX = list;
        DUPS = {};
        INDEX.forEach(function (e) { DUPS[e.n] = (DUPS[e.n] || 0) + 1; });
        Object.keys(DUPS).forEach(function (k) { if (DUPS[k] < 2) delete DUPS[k]; });
        var tt = $('#tot'); if (tt) tt.textContent = INDEX.length;
        getJSON('klass').then(function (j) { KB = j; }).catch(function () { });
        getJSON('tags').then(function (j) {
          TAGS = {};
          (j.items || []).forEach(function (x) { TAGS[x.k] = x; });
        }).catch(function () { });
        buildChips();
        boomTables();
        setHdHeight();
        refresh();
        routeFromHash();
      })
      .catch(function (err) {
        elStat.textContent = '数据载入失败：' + err.message;
        elList.innerHTML = '<div class="empty"><p class="big">数据载入失败</p>' +
          '<p class="hint">若以本地文件方式打开，浏览器会禁止读取数据文件。请改用在线地址访问。</p></div>';
      });
  }

  boot();
})();
