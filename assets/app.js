/* ============================================================
 * 焦虑浓度检测 · 交互逻辑
 * 纯原生 JS，无依赖，无后端
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var STORAGE_KEY = 'anxiety-lab:last';
  var DIMS = ['A', 'B', 'C', 'D'];

  var state = {
    index: 0,
    questions: [],       // 本次抽到的题目（从题库随机抽取）
    answers: [],         // 与 questions 同序
    result: null,
    locked: false
  };

  /* ---------------- 抽题 ---------------- */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /**
   * 从题库随机抽 n 题：先按维度均分，再把余数从剩余池里补齐，最后整体打乱顺序。
   * 这样每次题目不同，但四个维度都能覆盖到。
   */
  function pickQuestions(n) {
    var pool = {};
    DIMENSIONS.forEach(function (d) { pool[d.key] = []; });
    QUESTIONS.forEach(function (q) {
      if (pool[q.dim]) pool[q.dim].push(q);
    });

    var dimCount = DIMENSIONS.length;
    var base = Math.floor(n / dimCount);
    var extra = n - base * dimCount;
    var picked = [];
    var leftovers = [];

    DIMENSIONS.forEach(function (d) {
      var bag = shuffle(pool[d.key] || []);
      picked = picked.concat(bag.slice(0, base));
      leftovers = leftovers.concat(bag.slice(base));
    });

    if (extra > 0) picked = picked.concat(shuffle(leftovers).slice(0, extra));

    return shuffle(picked);
  }

  /* ---------------- 小工具 ---------------- */
  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hexA(hex, alpha) {
    var h = hex.replace('#', '');
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('is-show'); }, 2200);
  }

  function safeStore(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* 隐私模式忽略 */ }
  }

  function safeRead() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.ids) || !Array.isArray(obj.answers)) return null;
      if (obj.ids.length !== obj.answers.length || obj.ids.length === 0) return null;
      // 按存下来的题号还原成题目对象，题库改过导致找不到的直接认为存档失效
      var qs = [];
      for (var i = 0; i < obj.ids.length; i++) {
        var hit = null;
        for (var j = 0; j < QUESTIONS.length; j++) {
          if (QUESTIONS[j].id === obj.ids[i]) { hit = QUESTIONS[j]; break; }
        }
        if (!hit) return null;
        qs.push(hit);
      }
      return { questions: qs, answers: obj.answers, ts: obj.ts };
    } catch (e) { return null; }
  }

  function showScreen(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle('is-active', screens[i].id === id);
    }
    window.scrollTo(0, 0);
  }

  /* ---------------- 计分 ---------------- */
  function similarityOf(dims, fig) {
    var l1 = 0;
    for (var i = 0; i < DIMS.length; i++) {
      var k = DIMS[i];
      l1 += Math.abs(dims[k] - fig.dimProfile[k]);
    }
    var raw = 100 - 82 * (l1 / 4);
    return Math.max(72, Math.min(97, Math.round(raw)));
  }

  function computeResult(answers, questions) {
    var qs = questions || QUESTIONS;
    var dimRaw = { A: 0, B: 0, C: 0, D: 0 };
    var dimMax = { A: 0, B: 0, C: 0, D: 0 };
    var total = 0;

    qs.forEach(function (q, i) {
      var v = answers[i] || 0;
      dimRaw[q.dim] += v;
      dimMax[q.dim] += 4;
      total += v;
    });

    var maxTotal = qs.length * 4;
    var score = Math.round((total / maxTotal) * 100);

    var dims = {};
    var dimList = DIMENSIONS.map(function (d) {
      var pct = dimMax[d.key] ? Math.round((dimRaw[d.key] / dimMax[d.key]) * 100) : 0;
      dims[d.key] = pct / 100;
      return {
        key: d.key,
        name: d.name,
        short: d.short,
        desc: d.desc,
        insight: d.insight || {},
        pct: pct,
        norm: pct / 100
      };
    });

    var sortedDims = dimList.slice().sort(function (a, b) { return b.pct - a.pct; });
    var top = sortedDims[0];
    var second = sortedDims[1];

    var tier = TIERS[TIERS.length - 1];
    for (var i = 0; i < TIERS.length; i++) {
      if (score <= TIERS[i].max) { tier = TIERS[i]; break; }
    }

    var pool = FIGURES.filter(function (f) { return f.tier === tier.key; })
      .map(function (f) {
        var sim = similarityOf(dims, f);
        // 同档内排序：整体相似度为主，用户最强维度上的共鸣做加权
        var affinity = f.dimProfile[top.key] || 0;
        return { fig: f, sim: sim, rank: sim + affinity * 6 };
      })
      .sort(function (a, b) { return b.rank - a.rank; });

    return {
      score: score,
      total: total,
      maxTotal: maxTotal,
      dimList: dimList,
      top: top,
      second: second,
      low: sortedDims[sortedDims.length - 1],
      tier: tier,
      main: pool[0].fig,
      mainSim: pool[0].sim,
      others: pool.slice(1).map(function (p) { return { fig: p.fig, sim: p.sim }; })
    };
  }

  /* ---------------- 首页 ---------------- */
  function startTest() {
    state.questions = pickQuestions(TEST_META.total);
    state.answers = new Array(state.questions.length).fill(null);
    state.index = 0;
    showScreen('screen-quiz');
    renderQuestion(0);
  }

  function initIntro() {
    var last = safeRead();
    var btn = $('#btn-last');
    if (last) {
      var r = computeResult(last.answers, last.questions);
      $('#last-score').textContent = '· ' + r.score + ' 分 ' + r.tier.name;
      btn.hidden = false;
      btn.addEventListener('click', function () { renderResult(r, last.answers); });
    }

    $('#btn-start').addEventListener('click', startTest);

    renderFriendBanner();
  }

  /* ---------------- 答题 ---------------- */
  function renderQuestion(dir) {
    var q = state.questions[state.index];
    var total = state.questions.length;

    $('#progress-label').textContent =
      String(state.index + 1).padStart(2, '0') + ' / ' + total;
    $('#progress-dim').textContent = q.dim ? dimLabel(q.dim) : '';
    $('#progress-fill').style.width = ((state.index + 1) / total * 100) + '%';
    $('#progress-bar').setAttribute('aria-valuenow', String(state.index + 1));
    $('#progress-bar').setAttribute('aria-valuemax', String(total));
    $('#q-total').textContent = '/ ' + total;

    $('#q-num').textContent = String(state.index + 1).padStart(2, '0');
    $('#q-text').textContent = q.text;
    $('#q-note').textContent = q.note || '';

    var box = $('#options');
    box.innerHTML = '';
    OPTIONS.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option' + (state.answers[state.index] === opt.value ? ' is-selected' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', state.answers[state.index] === opt.value ? 'true' : 'false');
      btn.innerHTML =
        '<span class="opt-radio" aria-hidden="true"></span>' +
        '<span class="opt-text"><b>' + esc(opt.label) + '</b><i>' + esc(opt.hint) + '</i></span>';
      btn.addEventListener('click', function () { pick(opt.value, btn); });
      box.appendChild(btn);
    });

    updateQuizFoot();
    animateIn($('#quiz-body'), dir);
  }

  function dimLabel(key) {
    for (var i = 0; i < DIMENSIONS.length; i++) {
      if (DIMENSIONS[i].key === key) return DIMENSIONS[i].short;
    }
    return '';
  }

  function animateIn(el, dir) {
    if (!el || !el.animate) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var from = dir === -1 ? -14 : 14;
    el.animate(
      [{ opacity: 0, transform: 'translateY(' + from + 'px)' }, { opacity: 1, transform: 'none' }],
      { duration: 340, easing: 'cubic-bezier(.22,.9,.28,1)' }
    );
  }

  function pick(value, btn) {
    if (state.locked) return;
    state.answers[state.index] = value;

    var all = document.querySelectorAll('.option');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.remove('is-selected');
      all[i].setAttribute('aria-checked', 'false');
    }
    btn.classList.add('is-selected');
    btn.setAttribute('aria-checked', 'true');

    state.locked = true;
    setTimeout(function () {
      state.locked = false;
      if (state.index < state.questions.length - 1) {
        state.index++;
        renderQuestion(1);
      } else {
        finish();
      }
    }, 200);
  }

  function updateQuizFoot() {
    var foot = $('.quiz-foot');
    var done = state.answers.every(function (a) { return a !== null; });
    if (done) {
      foot.innerHTML = '<button class="linkbtn" id="btn-see-result" type="button">已全部答完 · 查看结果 →</button>';
      $('#btn-see-result').addEventListener('click', finish);
    } else {
      foot.innerHTML = '<span class="quiz-hint">凭第一反应选，不必纠结</span>';
    }
  }

  function finish() {
    var missing = state.answers.findIndex(function (a) { return a === null; });
    if (missing !== -1) {
      state.index = missing;
      renderQuestion(1);
      toast('还有题没答，已跳到第 ' + (missing + 1) + ' 题');
      return;
    }
    var r = computeResult(state.answers, state.questions);
    safeStore({
      ids: state.questions.map(function (q) { return q.id; }),
      answers: state.answers,
      ts: Date.now()
    });
    renderResult(r, state.answers);
  }

  /* ---------------- 结果 ---------------- */
  function renderResult(r, answers) {
    state.result = r;
    var root = $('#result-inner');
    root.style.setProperty('--tier', r.tier.color);
    root.style.setProperty('--tier-soft', r.tier.soft);

    $('#result-date').textContent = formatDate(new Date());
    $('#tier-level').textContent = r.tier.level;
    $('#tier-name').textContent = r.tier.name;
    $('#tier-tagline').textContent = r.tier.tagline;
    $('#tier-desc').textContent = r.tier.desc;
    $('#score-num').textContent = '0';

    /* 名人卡 */
    var main = r.main;
    $('#figure-main').innerHTML =
      '<div class="figure-top">' +
        '<div class="mark">' + esc(main.mark) + '</div>' +
        '<div class="figure-id">' +
          '<div class="figure-name">' + esc(main.name) + '</div>' +
          '<div class="figure-sub">' + esc(main.era) + ' · ' + esc(main.role) + '</div>' +
        '</div>' +
        '<div class="sim"><b>' + r.mainSim + '%</b><span>相似度</span></div>' +
      '</div>' +
      '<div class="figure-body">' +
        '<span class="figure-work">' + esc(main.work) + '</span>' +
        '<p class="figure-reason">' + esc(main.reason) + '</p>' +
      '</div>';

    $('#figure-list').innerHTML = r.others.map(function (o) {
      return '<article class="alt-figure">' +
        '<div class="alt-head">' +
          '<div class="mark">' + esc(o.fig.mark) + '</div>' +
          '<div class="alt-id">' +
            '<div class="alt-name">' + esc(o.fig.name) +
              '<span>' + esc(o.fig.era) + '</span>' +
            '</div>' +
            '<div class="alt-role">' + esc(o.fig.role) + ' · ' + esc(o.fig.work) + '</div>' +
          '</div>' +
          '<div class="alt-sim"><b>' + o.sim + '%</b><span>相似度</span></div>' +
        '</div>' +
        '<p class="alt-reason">' + esc(o.fig.reason) + '</p>' +
      '</article>';
    }).join('');

    /* 配方 */
    var recipe;
    if (r.top.pct < 40) {
      if (r.top.pct <= 5) {
        recipe = '四个通道几乎贴着地面，最高的一项也只有 <b>' + r.top.pct +
          '%</b>。你的压力处理系统运转得很好——事情来了就处理，处理完就放下。';
      } else {
        recipe = '四个通道都停在低位，最高的一项<b>「' + esc(r.top.name) + '」</b>也只有 <b>' +
          r.top.pct + '%</b>。你的压力处理系统运转得不错，偶尔响一下，但没让它变成背景音。';
      }
    } else if (r.top.pct - r.second.pct <= 3) {
      var rangeText = r.top.pct === r.second.pct
        ? '都是 <b>' + r.top.pct + '%</b>'
        : '都在 <b>' + r.second.pct + '–' + r.top.pct + '%</b> 这个区间';
      recipe = '四个通道里，<b>「' + esc(r.top.name) + '」</b>和<b>「' + esc(r.second.name) +
        '」</b>几乎并列，' + rangeText + '。焦虑不是从单一入口进来的，是整片一起亮。';
    } else {
      recipe = '四个通道里，<b>「' + esc(r.top.name) + '」</b>开得最大，<b>' + r.top.pct + '%</b>；' +
        '<b>「' + esc(r.second.name) + '」</b>紧随其后，' + r.second.pct + '%。' +
        '焦虑主要从前者进来，再被后者放大。';
      if (r.top.pct >= 70) {
        recipe += ' 这一项几乎每天都在运转，它比总分本身更值得注意。';
      }
    }
    $('#recipe').innerHTML = recipe;

    $('#bars').innerHTML = r.dimList.map(function (d) {
      // 只有浓度上来、且确实拉开差距时，"主导通道"才成立
      var isTop = d.key === r.top.key && r.top.pct >= 40 && (r.top.pct - r.second.pct > 3);
      var ins = d.insight || {};
      var note = d.pct >= 70 ? ins.high : (d.pct >= 40 ? ins.mid : ins.low);
      return '<div class="bar-row' + (isTop ? ' is-top' : '') + '">' +
        '<div class="bar-top"><span>' + esc(d.name) +
          (isTop ? '<em class="bar-tag">主导</em>' : '') +
        '</span><b>' + d.pct + '%</b></div>' +
        '<div class="bar-track"><div class="bar-fill" data-pct="' + d.pct + '"></div></div>' +
        (note ? '<p class="bar-note">' + esc(note) + '</p>' : '') +
      '</div>';
    }).join('');

    /* 建议 */
    $('#advice-list').innerHTML = r.tier.advice.map(function (a) {
      return '<div class="advice-item">' +
        '<div class="advice-tag">' + esc(a.tag) + '</div>' +
        '<p class="advice-text">' + esc(a.text) + '</p>' +
      '</div>';
    }).join('');

    $('#disclaimer').textContent = DISCLAIMER;

    showScreen('screen-result');

    /* 动画：分数、圆环、刻度、条形 */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        $('#ring-fg').style.strokeDashoffset = String(590.6 * (1 - r.score / 100));
        $('#scale-marker').style.left = Math.min(97, Math.max(3, r.score)) + '%';
        $('#score-num').textContent = '0';
        countUp($('#score-num'), r.score, 900);
      });
      var fills = document.querySelectorAll('.bar-fill');
      for (var i = 0; i < fills.length; i++) {
        (function (el, idx) {
          setTimeout(function () { el.style.width = el.getAttribute('data-pct') + '%'; }, 150 + idx * 90);
        })(fills[i], i);
      }
    });
  }

  function countUp(el, target, duration) {
    var start = performance.now();
    function tick(now) {
      var p = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = String(target);
    }
    requestAnimationFrame(tick);
  }

  function formatDate(d) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }

  /* ---------------- 分享 ---------------- */
  function shareText(r) {
    var url = location.href.split('#')[0];
    return '我测出 ' + r.score + ' 分，焦虑浓度「' + r.tier.name + '」，' +
      '精神状态最像 ' + r.main.name + '（' + r.main.era + '）。\n' +
      '你也来测测自己的焦虑浓度：' + url;
  }

  function shareLink(r) {
    var base = location.href.split('#')[0];
    return base + '#s=' + r.score + '&t=' + r.tier.key + '&f=' + r.main.id;
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(okMsg || '已复制');
      }).catch(function () { fallbackCopy(text, okMsg); });
    } else {
      fallbackCopy(text, okMsg);
    }
  }

  function fallbackCopy(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(okMsg || '已复制'); }
    catch (e) { toast('复制失败，请手动选择文本'); }
    document.body.removeChild(ta);
  }

  /* ---------------- 分享图（Canvas 手绘） ---------------- */
  function roundRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var chars = String(text).split('');
    var line = '';
    var lines = [];
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = chars[i];
        if (lines.length === maxLines) break;
      } else {
        line = test;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (lines.length === maxLines) {
      var last = lines[maxLines - 1];
      if (ctx.measureText(last + '…').width <= maxWidth + 1) {
        lines[maxLines - 1] = last.replace(/[，。、；]$/, '') + '…';
      }
    }
    lines.forEach(function (l, i) { ctx.fillText(l, x, y + i * lineHeight); });
    return y + lines.length * lineHeight;
  }

  function buildShareImage(r) {
    var W = 750, H = 1200, DPR = 2;
    var c = document.createElement('canvas');
    c.width = W * DPR;
    c.height = H * DPR;
    var ctx = c.getContext('2d');
    ctx.scale(DPR, DPR);

    var F = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif';
    var tier = r.tier;

    /* 背景 */
    ctx.fillStyle = '#FBF8F4';
    ctx.fillRect(0, 0, W, H);

    var g1 = ctx.createRadialGradient(120, 60, 0, 120, 60, 460);
    g1.addColorStop(0, hexA(tier.color, 0.16));
    g1.addColorStop(1, 'rgba(251,248,244,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);

    var g2 = ctx.createRadialGradient(700, 1160, 0, 700, 1160, 380);
    g2.addColorStop(0, 'rgba(91,91,214,0.10)');
    g2.addColorStop(1, 'rgba(251,248,244,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);

    /* 顶部标签 */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#8A8378';
    ctx.font = '700 21px ' + F;
    var brandW = ctx.measureText('ANXIETY LAB').width;
    ctx.fillText('ANXIETY LAB', 60, 86);
    ctx.fillStyle = 'rgba(27,26,23,0.28)';
    ctx.fillRect(60 + brandW + 14, 78, 14, 1.5);
    ctx.fillStyle = '#46423B';
    ctx.font = '600 22px ' + F;
    ctx.fillText('焦虑浓度检测', 60 + brandW + 40, 87);

    /* 圆环 */
    var cx = 375, cy = 288, rad = 122;
    ctx.lineWidth = 20;
    ctx.strokeStyle = 'rgba(27,26,23,0.07)';
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = tier.color;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (r.score / 100));
    ctx.stroke();

    /* 分数 */
    ctx.textBaseline = 'alphabetic';
    ctx.font = '800 128px ' + F;
    var numStr = String(r.score);
    var numW = ctx.measureText(numStr).width;
    ctx.font = '600 30px ' + F;
    var unitW = ctx.measureText('分').width;
    var totalW = numW + 10 + unitW;
    var sx = cx - totalW / 2;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#1B1A17';
    ctx.font = '800 128px ' + F;
    ctx.fillText(numStr, sx, cy + 44);
    ctx.fillStyle = '#8A8378';
    ctx.font = '600 30px ' + F;
    ctx.fillText('分', sx + numW + 10, cy + 38);

    /* 标注 */
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8A8378';
    ctx.font = '500 18px ' + F;
    ctx.fillText('焦虑浓度 / 100', cx, cy + rad + 44);

    /* 档位 */
    ctx.fillStyle = tier.color;
    ctx.font = '700 20px ' + F;
    ctx.fillText(tier.level, cx, 506);

    ctx.fillStyle = '#1B1A17';
    ctx.font = '800 54px ' + F;
    ctx.fillText(tier.name, cx, 580);

    ctx.fillStyle = '#46423B';
    ctx.font = '400 24px ' + F;
    wrapText(ctx, tier.tagline, cx, 622, 600, 38, 2);

    /* 分隔线 */
    ctx.strokeStyle = 'rgba(27,26,23,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, 692);
    ctx.lineTo(690, 692);
    ctx.stroke();

    /* 名人块 */
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8A8378';
    ctx.font = '600 19px ' + F;
    ctx.fillText('你的精神同类', 60, 730);

    var main = r.main;
    ctx.fillStyle = hexA(tier.color, 0.13);
    roundRect(ctx, 60, 744, 62, 62, 16);
    ctx.fill();

    ctx.fillStyle = tier.color;
    ctx.font = '700 30px "Songti SC","SimSun",serif';
    ctx.textAlign = 'center';
    ctx.fillText(main.mark, 91, 786);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#1B1A17';
    ctx.font = '800 36px ' + F;
    ctx.fillText(main.name, 142, 782);
    var nameW = ctx.measureText(main.name).width;

    ctx.fillStyle = '#8A8378';
    ctx.font = '400 18px ' + F;
    ctx.fillText(main.era, 142 + nameW + 12, 782);

    ctx.textAlign = 'right';
    ctx.fillStyle = tier.color;
    ctx.font = '800 36px ' + F;
    ctx.fillText(r.mainSim + '%', 690, 774);
    ctx.fillStyle = '#8A8378';
    ctx.font = '500 16px ' + F;
    ctx.fillText('精神状态相似度', 690, 798);

    /* 理由 */
    ctx.textAlign = 'left';
    ctx.fillStyle = '#46423B';
    ctx.font = '400 23px ' + F;
    wrapText(ctx, main.reason, 60, 866, 630, 40, 4);

    /* 四维 */
    ctx.strokeStyle = 'rgba(27,26,23,0.07)';
    ctx.beginPath();
    ctx.moveTo(60, 1036);
    ctx.lineTo(690, 1036);
    ctx.stroke();

    ctx.fillStyle = '#8A8378';
    ctx.font = '500 19px ' + F;
    ctx.textAlign = 'center';
    var dimLine = r.dimList.map(function (d) {
      return d.short + ' ' + d.pct;
    }).join('   ·   ');
    ctx.fillText(dimLine, 375, 1078);

    /* 底部 */
    ctx.fillStyle = '#1B1A17';
    ctx.font = '700 24px ' + F;
    ctx.fillText(TEST_META.total + ' 题 · ' + TEST_META.minutes + ' 分钟，测出你的焦虑浓度', 375, 1128);

    ctx.fillStyle = 'rgba(27,26,23,0.35)';
    ctx.font = '400 17px ' + F;
    ctx.fillText('结果仅供娱乐，不构成医学诊断', 375, 1158);

    return c;
  }

  /* ---------------- 弹层 ---------------- */
  function openModal(canvas) {
    var img = $('#share-img');
    img.src = canvas.toDataURL('image/png');
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    $('#modal').hidden = true;
    document.body.style.overflow = '';
  }

  /* ---------------- 分享链接进入 ---------------- */
  function parseShared() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return null;
    var params = new URLSearchParams(h);
    var s = parseInt(params.get('s'), 10);
    if (!Number.isFinite(s) || s < 0 || s > 100) return null;
    var tier = null;
    for (var i = 0; i < TIERS.length; i++) {
      if (s <= TIERS[i].max) { tier = TIERS[i]; break; }
    }
    var figId = params.get('f');
    var fig = null;
    for (var j = 0; j < FIGURES.length; j++) {
      if (FIGURES[j].id === figId) { fig = FIGURES[j]; break; }
    }
    return { score: s, tier: tier, fig: fig };
  }

  function renderFriendBanner() {
    var shared = parseShared();
    if (!shared || !shared.tier) return;

    var banner = document.createElement('div');
    banner.className = 'friend-banner';
    var who = shared.fig ? esc(shared.fig.name) : '某位历史人物';
    banner.innerHTML =
      '<div>你朋友测出 <b>' + shared.score + ' 分 · ' + esc(shared.tier.name) + '</b>，' +
      '精神状态像 ' + who + '。来看看你的。</div>' +
      '<button class="icon-btn icon-btn-sm" type="button" aria-label="关闭提示">✕</button>';

    var screen = $('#screen-intro');
    var topbar = $('.topbar', screen);
    screen.insertBefore(banner, topbar.nextSibling);
    banner.querySelector('button').addEventListener('click', function () {
      banner.parentNode.removeChild(banner);
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindResultEvents() {
    $('#btn-back').addEventListener('click', function () {
      if (state.index > 0) {
        state.index--;
        renderQuestion(-1);
      } else {
        showScreen('screen-intro');
      }
    });

    $('#btn-retry').addEventListener('click', startTest);

    $('#btn-copy').addEventListener('click', function () {
      if (!state.result) return;
      copyText(shareText(state.result), '文案已复制，去粘贴吧');
    });

    $('#btn-share-img').addEventListener('click', function () {
      if (!state.result) return;
      var btn = $('#btn-share-img');
      var old = btn.textContent;
      btn.textContent = '正在生成…';
      btn.disabled = true;
      setTimeout(function () {
        try {
          var canvas = buildShareImage(state.result);
          openModal(canvas);
          var dl = $('#btn-download');
          dl.onclick = function () {
            var a = document.createElement('a');
            a.download = '焦虑浓度检测-' + state.result.score + '分-' + state.result.tier.name + '.png';
            a.href = canvas.toDataURL('image/png');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            toast('图片已保存');
          };
        } catch (e) {
          toast('生成失败，请截图保存');
        }
        btn.textContent = old;
        btn.disabled = false;
      }, 60);
    });

    var modal = $('#modal');
    modal.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
  }

  /* ---------------- 启动 ---------------- */
  initIntro();
  bindResultEvents();
})();
