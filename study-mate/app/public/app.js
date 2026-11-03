/* Study Mate 阅读端 · 前端逻辑（无构建、零依赖） */
(function () {
  'use strict';

  var TYPE_LABEL = { concept: '概念', practice: '实操', lab: '实验', project: '项目' };
  var STATUS_LABEL = { todo: '未开始', in_progress: '学习中', done: '已学完', skipped: '已跳过' };
  var state = { workspace: null, subjectId: null, course: null, route: 'home' };

  var stageInner = document.getElementById('stageInner');
  var treeEl = document.getElementById('tree');
  var crumbEl = document.getElementById('crumb');
  var sidePanel = document.getElementById('sidePanel');
  var toastEl = document.getElementById('toast');

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }
  async function api(path, options) {
    var res = await fetch(path, options);
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || ('请求失败：' + res.status));
    return data;
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
    return Promise.resolve();
  }
  function pad4(n) { var s = String(n); while (s.length < 4) s = '0' + s; return s; }

  /* ---------- Markdown ---------- */
  var MATH_RE = /(\$\$[\s\S]*?\$\$|\$[^\n$]+\$)/g;
  var OPEN_RE = /^:::\s*(\w+)\s*(.*)$/;
  var CLOSE_RE = /^:::\s*$/;

  function protectMath(md) {
    var store = [];
    var out = md.replace(MATH_RE, function (m) { store.push(m); return '@@MATH' + (store.length - 1) + '@@'; });
    return { out: out, store: store };
  }
  function restoreMath(html, store) {
    return html.replace(/@@MATH(\d+)@@/g, function (_, i) {
      return store[Number(i)] != null ? store[Number(i)] : '';
    });
  }

  function renderBlocks(md) {
    var lines = md.split(/\r?\n/);
    var out = [];
    var buf = [];
    function flush() { if (buf.length) { out.push(marked.parse(buf.join('\n'))); buf = []; } }
    for (var i = 0; i < lines.length; i++) {
      var open = lines[i].match(OPEN_RE);
      if (open) {
        var depth = 1, inner = [], j = i + 1;
        for (; j < lines.length; j++) {
          if (OPEN_RE.test(lines[j])) depth++;
          else if (CLOSE_RE.test(lines[j])) { depth--; if (depth === 0) break; }
          inner.push(lines[j]);
        }
        flush();
        var kind = open[1], title = (open[2] || '').trim(), body = renderBlocks(inner.join('\n'));
        if (kind === 'answer') {
          out.push('<details class="answer"><summary>参考答案</summary>' + body + '</details>');
        } else {
          out.push('<div class="callout callout-' + kind + '">' +
            (title ? '<div class="callout-title">' + esc(title) + '</div>' : '') +
            '<div class="callout-body">' + body + '</div></div>');
        }
        i = j;
      } else buf.push(lines[i]);
    }
    flush();
    return out.join('\n');
  }

  function renderMarkdown(md) {
    if (!md) return '';
    var svgStore = [];
    var withoutSvg = md.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, function (m) {
      svgStore.push(m);
      return '@@SVG' + (svgStore.length - 1) + '@@';
    });
    var p = protectMath(withoutSvg);
    var html = renderBlocks(p.out);
    html = restoreMath(html, p.store);
    return html.replace(/@@SVG(\d+)@@/g, function (_, i) { return svgStore[Number(i)] || ''; });
  }

  /** 把课件里的 ::: exercise 块抽出来，放到右侧题目栏 */
  function splitExercises(md) {
    var lines = md.split(/\r?\n/);
    var kept = [];
    var exercises = [];
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/^:::\s*exercise\s*(.*)$/);
      if (m) {
        var depth = 1, inner = [], j = i + 1;
        for (; j < lines.length; j++) {
          if (OPEN_RE.test(lines[j])) depth++;
          else if (CLOSE_RE.test(lines[j])) { depth--; if (depth === 0) break; }
          inner.push(lines[j]);
        }
        exercises.push({ title: m[1].trim() || ('练习 ' + (exercises.length + 1)), md: inner.join('\n') });
        i = j;
      } else {
        kept.push(lines[i]);
      }
    }
    return { markdown: kept.join('\n'), exercises: exercises };
  }

  function typeset(el) {
    if (!window.renderMathInElement) return;
    try {
      renderMathInElement(el, {
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option']
      });
    } catch (e) { /* 公式异常不影响正文 */ }
  }

  /* ---------- 侧栏树 ---------- */
  function folderIcon() {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">' +
      '<path d="M3.5 6.5h6l1.8 2h9.2v10.5H3.5z" stroke-linejoin="round"/></svg>';
  }

  function renderTree() {
    var ws = state.workspace;
    document.getElementById('workspaceName').textContent = ws.name || '学习搭档';
    var pathEl = document.getElementById('workspacePath');
    pathEl.textContent = ws.workspace || '';
    pathEl.title = ws.workspace || '';

    var html = '';
    (ws.subjects || []).forEach(function (s) {
      var active = state.subjectId === s.id;
      html += '<button class="tree-subject' + (active ? ' active' : '') + '" data-subject="' + esc(s.id) + '">' +
        folderIcon() + '<span>' + esc(s.title) + '</span><small>' + s.progress + '%</small></button>';
      if (active && state.course) {
        (state.course.nodes || []).forEach(function (n, i) {
          html += '<button class="tree-node' + (state.route === 'lesson' && state.lessonNode === n.id ? ' active' : '') +
            '" data-node="' + esc(n.id) + '"><span class="dot ' + esc(n.status || 'todo') + '"></span>' +
            '<span class="label">' + pad4(i + 1) + ' ' + esc(n.title) + '</span></button>';
        });
      }
    });
    if (!(ws.subjects || []).length) {
      html = '<div style="padding:6px 8px;font-size:12px;color:var(--muted);line-height:1.7">还没有科目。对搭档说「我想学 …」即可开课。</div>';
    }
    treeEl.innerHTML = html;

    Array.prototype.forEach.call(treeEl.querySelectorAll('.tree-subject'), function (b) {
      b.addEventListener('click', function () { location.hash = '#/s/' + encodeURIComponent(b.dataset.subject); });
    });
    Array.prototype.forEach.call(treeEl.querySelectorAll('.tree-node'), function (b) {
      b.addEventListener('click', function () {
        location.hash = '#/l/' + encodeURIComponent(state.subjectId) + '/' + encodeURIComponent(b.dataset.node);
      });
    });
  }

  /* ---------- 面包屑 ---------- */
  function setCrumb(parts) {
    var html = '<a href="#/" aria-label="主页"><svg class="home-ico" viewBox="0 0 24 24"><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" stroke-linejoin="round"/></svg></a>';
    parts.forEach(function (p) {
      html += '<span class="sep">/</span>';
      html += p.href ? '<a href="' + p.href + '">' + esc(p.label) + '</a>' : '<b>' + esc(p.label) + '</b>';
    });
    crumbEl.innerHTML = html;
  }

  function setActiveActivity(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.act[data-go]'), function (b) {
      b.classList.toggle('active', b.dataset.go === name);
    });
  }

  /* ---------- 工作台 ---------- */
  async function renderHome() {
    var ws = state.workspace;
    state.course = null;
    state.subjectId = null;
    sidePanel.hidden = true;
    setCrumb([{ label: '主页' }]);
    setActiveActivity('#/');
    document.getElementById('topHint').textContent = '共 ' + (ws.subjects || []).length + ' 门科目';

    if (!(ws.subjects || []).length) {
      stageInner.innerHTML = '<h1 class="page-title">学习工作台</h1>' +
        '<p class="lede">在 Trae 对话里对学习搭档说一句「我想学心理学」，它会做入学评估、给出路线图，并把第一课写进工作区。回来后刷新本页即可看到。</p>' +
        '<div class="missing"><strong>还没有学习科目</strong>工作区：' + esc(ws.workspace) + '</div>';
      return;
    }

    var last = (ws.subjects || []).filter(function (s) { return s.current && s.status === 'active'; })[0] || ws.subjects[0];
    var html = '<h1 class="page-title">学习工作台</h1>' +
      '<p class="lede">没有待复习队列，也没有今天该刷多少题的排期——接着上次那个节点往下读就行。</p>';

    if (last && last.current) {
      html += '<div class="sec-head"><h2>接着上次</h2></div>';
      html += '<a class="last-card" href="#/s/' + encodeURIComponent(last.id) + '">';
      html += '<div class="last-top"><span class="subject-label">' + esc(last.title) + '</span>' +
        '<span class="chip learning">' + (last.progress ? '学习中' : '未开始') + '</span></div>';
      html += '<h3><span class="idx">' + pad4(last.doneCount + 1) + '</span>' + esc(last.current.title) + '</h3>';
      html += '<p>' + esc(last.subtitle || last.goal || '按前置依赖排好的路线，学完一个节点勾一个。') + '</p>';
      html += '<div class="last-foot"><span>已学完 ' + last.doneCount + ' / ' + last.nodeCount + '</span>' +
        '<button class="text-btn" data-last="' + esc(last.id) + '">继续读 →</button></div></a>';
    }

    html += '<div class="sec-head" style="margin-top:34px"><h2>科目</h2><span class="count">' +
      (ws.subjects || []).length + ' 门</span></div><div class="course-list">';
    (ws.subjects || []).forEach(function (s) {
      var c = s.counts || { todo: 0, in_progress: 0, done: 0 };
      var left = Math.max(0, s.nodeCount - s.doneCount);
      html += '<button class="course-row" data-id="' + esc(s.id) + '"><div class="course-main">' +
        '<h3>' + esc(s.title) + '</h3><p>' + esc(s.subtitle || s.goal || '—') + '</p></div>' +
        '<div class="course-stats">' +
        '<span class="cs-top">进行中 ' + left + ' 课<span class="cs-arrow">→</span></span>' +
        '<span class="cs-line">' + s.doneCount + ' / ' + s.nodeCount + ' · 未开始 ' + (c.todo || 0) +
        ' · 学习中 ' + (c.in_progress || 0) + ' · 已学完 ' + (c.done || 0) + '</span>' +
        '<span class="bar"><i style="width:' + s.progress + '%"></i></span></div></button>';
    });
    html += '</div>';
    stageInner.innerHTML = html;

    Array.prototype.forEach.call(stageInner.querySelectorAll('.course-row'), function (b) {
      b.addEventListener('click', function () { location.hash = '#/s/' + encodeURIComponent(b.dataset.id); });
    });
    var lastBtn = stageInner.querySelector('[data-last]');
    if (lastBtn) {
      lastBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (last.current && last.hasLesson) {
          location.hash = '#/l/' + encodeURIComponent(last.id) + '/' + encodeURIComponent(last.current.id);
        } else {
          location.hash = '#/s/' + encodeURIComponent(last.id);
        }
      });
    }
  }

  /* ---------- 科目页 ---------- */
  async function renderSubject(id) {
    var course = await api('/api/course/' + encodeURIComponent(id));
    state.course = course;
    state.subjectId = id;
    sidePanel.hidden = true;
    setCrumb([{ label: '主页', href: '#/' }, { label: course.title }]);
    setActiveActivity('#/s/');

    var nodes = course.nodes || [];
    var counts = { todo: 0, in_progress: 0, done: 0, skipped: 0 };
    nodes.forEach(function (n) { counts[n.status || 'todo'] = (counts[n.status || 'todo'] || 0) + 1; });
    document.getElementById('topHint').textContent = nodes.length + ' 个知识点 · 已完成 ' + counts.done;

    var layers = {};
    nodes.forEach(function (n) { var l = Number(n.layer) || 1; (layers[l] = layers[l] || []).push(n); });

    var html = '<div class="subject-head"><h1 class="subject-title">' + esc(course.title) + '</h1>' +
      '<p class="subject-sub">' + esc(course.subtitle || '') + '</p>' +
      (course.goal ? '<div class="subject-goal">目标：' + esc(course.goal) + '</div>' : '') +
      '<div class="subject-stats"><span>' + (counts.done || 0) + ' / ' + nodes.length + ' 已学完</span>' +
      '<span>未开始 ' + (counts.todo || 0) + '</span><span>学习中 ' + (counts.in_progress || 0) + '</span>' +
      '<span>起点 ' + esc(course.level || '—') + '</span></div></div>';

    Object.keys(layers).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (l) {
      html += '<div class="layer-block"><div class="layer-title">第 ' + esc(l) + ' 层</div>';
      layers[l].forEach(function (n) {
        var idx = nodes.indexOf(n) + 1;
        var prereq = (n.prereq || []).map(function (pid) {
          var p = nodes.filter(function (x) { return x.id === pid; })[0];
          return p ? p.title : pid;
        });
        html += '<button class="node-row" data-node="' + esc(n.id) + '">' +
          '<span class="num">' + pad4(idx) + '</span>' +
          '<span class="body"><span class="name"><span class="dot ' + esc(n.status || 'todo') + '"></span>' +
          esc(n.title) + '<span class="type-tag">' + esc(TYPE_LABEL[n.type] || '概念') + '</span></span>' +
          '<span class="desc">' + esc(n.summary || '') + (prereq.length ? ' · 前置：' + esc(prereq.join('、')) : '') + '</span></span>' +
          '<span class="right"><span>' + (n.estimated ? n.estimated + ' 分钟' : '') + '</span>' +
          '<span>' + esc(STATUS_LABEL[n.status] || '') + '</span></span></button>';
      });
      html += '</div>';
    });
    stageInner.innerHTML = html;
    renderTree();

    Array.prototype.forEach.call(stageInner.querySelectorAll('.node-row'), function (b) {
      b.addEventListener('click', function () {
        location.hash = '#/l/' + encodeURIComponent(id) + '/' + encodeURIComponent(b.dataset.node);
      });
    });
  }

  /* ---------- 课件页 ---------- */
  async function renderLesson(subjectId, nodeId) {
    var course = await api('/api/course/' + encodeURIComponent(subjectId));
    var lesson = await api('/api/lesson?subject=' + encodeURIComponent(subjectId) + '&node=' + encodeURIComponent(nodeId));
    state.course = course;
    state.subjectId = subjectId;
    state.lessonNode = nodeId;

    var nodes = course.nodes || [];
    var idx = nodes.findIndex(function (n) { return n.id === nodeId; });
    var node = lesson.node;
    var prev = idx > 0 ? nodes[idx - 1] : null;
    var next = idx >= 0 && idx < nodes.length - 1 ? nodes[idx + 1] : null;
    var split = splitExercises(lesson.markdown || '');

    setCrumb([{ label: '主页', href: '#/' }, { label: course.title, href: '#/s/' + encodeURIComponent(subjectId) }, { label: node.title }]);
    setActiveActivity('#/s/');
    document.getElementById('topHint').textContent = '第 ' + pad4(idx + 1) + ' 课';

    var html = '<div class="lesson-wrap"><div class="lesson-chips">' +
      '<span class="chip">第 ' + pad4(idx + 1) + ' 课</span>' +
      '<span class="type-tag">' + esc(TYPE_LABEL[node.type] || '概念') + '</span>' +
      '<span class="chip ' + (node.status === 'done' ? 'done' : node.status === 'in_progress' ? 'learning' : '') + '">' +
      esc(STATUS_LABEL[node.status] || '未开始') + '</span>' +
      (lesson.meta && lesson.meta.duration ? '<span>' + esc(lesson.meta.duration) + ' 分钟</span>' : '') +
      '</div>';
    html += '<h1 class="lesson-title">' + esc((lesson.meta && lesson.meta.title) || node.title) + '</h1>';
    if (node.summary) html += '<p class="lesson-desc">' + esc(node.summary) + '</p>';

    if (lesson.missing) {
      html += '<div class="missing"><strong>这一课的课件还没写</strong>课件是讲一课写一课，不预先灌水。回对话里说「继续学习」，搭档会补上这一课。<br><br>' +
        '<button class="btn ghost" id="copyPrompt">复制提示语</button></div>';
    } else {
      html += '<article class="prose" id="prose">' + renderMarkdown(split.markdown) + '</article>';
    }

    html += '<div class="pager">' +
      (prev ? '<a href="#/l/' + encodeURIComponent(subjectId) + '/' + encodeURIComponent(prev.id) + '">← ' + esc(prev.title) + '</a>' : '<span></span>') +
      (next ? '<a href="#/l/' + encodeURIComponent(subjectId) + '/' + encodeURIComponent(next.id) + '">' + esc(next.title) + ' →</a>' : '<span></span>') +
      '</div></div>';

    stageInner.innerHTML = html;
    var prose = document.getElementById('prose');
    if (prose) typeset(prose);

    renderPanel(subjectId, nodeId, course, node, split.exercises, lesson.note || '');
    renderTree();

    var cp = document.getElementById('copyPrompt');
    if (cp) cp.addEventListener('click', function () {
      copyText('继续学习「' + course.title + '」的节点：' + node.title + '，把这一课的课件写出来。')
        .then(function () { toast('已复制提示语'); });
    });
  }

  /* ---------- 右侧栏 ---------- */
  function renderPanel(subjectId, nodeId, course, node, exercises, note) {
    sidePanel.hidden = false;
    var qHtml = '';
    if (exercises.length) {
      exercises.forEach(function (ex, i) {
        qHtml += '<div class="q-card"><div class="q-head"><span class="q-no">' + (i + 1) + '</span>' +
          '<span class="q-title">' + esc(ex.title) + '</span></div>' +
          '<div class="q-body">' + renderMarkdown(ex.md) + '</div></div>';
      });
    } else {
      qHtml = '<div class="panel-empty">这一课没有抽出来的练习。课件里的 `::: exercise` 块会自动出现在这里。</div>';
    }

    var actions = '';
    if (node.status === 'todo') actions += '<button class="btn" id="markStart">开始学习</button>';
    if (node.status !== 'done') actions += '<button class="btn' + (node.status === 'todo' ? ' ghost' : '') + '" id="markDone">标记完成</button>';
    if (node.status === 'done') actions += '<button class="btn ghost" id="markUndo">撤销完成</button>';
    actions += '<button class="btn text" id="copyAsk" style="margin-left:auto">问搭档</button>';

    sidePanel.innerHTML =
      '<div class="panel-tabs">' +
      '<button class="panel-tab active" data-tab="q">题目 ' + (exercises.length ? exercises.length : '') + '</button>' +
      '<button class="panel-tab" data-tab="note">笔记</button></div>' +
      '<div class="panel-body" id="panelBody">' + qHtml + '</div>' +
      '<div class="panel-actions">' + actions + '</div>';

    var panelBody = document.getElementById('panelBody');

    function showTab(name) {
      Array.prototype.forEach.call(sidePanel.querySelectorAll('.panel-tab'), function (t) {
        t.classList.toggle('active', t.dataset.tab === name);
      });
      if (name === 'note') {
        panelBody.innerHTML = '<textarea class="note-area" id="noteInput" placeholder="用自己的话写一遍：这一课解决什么问题？哪里还想追问？">' +
          esc(note) + '</textarea>' +
          '<div class="note-actions"><span>保存到 notes/' + esc(nodeId) + '.md</span>' +
          '<button class="btn ghost" id="saveNote">保存笔记</button></div>';
        var save = document.getElementById('saveNote');
        save.addEventListener('click', function () {
          var val = document.getElementById('noteInput').value;
          api('/api/note', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject: subjectId, node: nodeId, content: val })
          }).then(function () { note = val; toast('笔记已保存'); })
            .catch(function (e) { toast(e.message); });
        });
      } else {
        panelBody.innerHTML = qHtml;
      }
      typeset(panelBody);
    }

    Array.prototype.forEach.call(sidePanel.querySelectorAll('.panel-tab'), function (t) {
      t.addEventListener('click', function () { showTab(t.dataset.tab); });
    });
    typeset(panelBody);

    function bind(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
    bind('markStart', function () { return setStatus(subjectId, nodeId, 'in_progress', '已开始学习'); });
    bind('markDone', function () { return setStatus(subjectId, nodeId, 'done', '已标记完成'); });
    bind('markUndo', function () { return setStatus(subjectId, nodeId, 'in_progress', '已撤销完成'); });
    bind('copyAsk', function () {
      copyText('我在「' + course.title + ' / ' + node.title + '」这一课有个地方没懂：')
        .then(function () { toast('已复制，补上具体段落发给搭档'); });
    });
  }

  async function setStatus(subjectId, nodeId, status, msg) {
    try {
      await api('/api/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subjectId, node: nodeId, status: status })
      });
      toast(msg);
      await loadWorkspace();
      await route();
    } catch (e) { toast(e.message); }
  }

  /* ---------- 记忆 ---------- */
  async function renderMemory() {
    state.course = null;
    state.subjectId = null;
    sidePanel.hidden = true;
    setCrumb([{ label: '主页', href: '#/' }, { label: '学习记忆' }]);
    setActiveActivity('#/memory');
    document.getElementById('topHint').textContent = '跨科目共享';
    var m = await api('/api/memory');
    function body(md) {
      return md ? renderMarkdown(md.replace(/^#\s+.*(\r?\n|$)/, '')) : '<p style="color:var(--muted)">还没有记录。第一次开课时搭档会问你几个问题并写在这里。</p>';
    }
    stageInner.innerHTML = '<h1 class="page-title">学习记忆</h1>' +
      '<p class="lede">记的是稳定的东西：你的水平与目标、哪种讲法有效、哪些地方容易卡。换一门课也不用重新自我介绍。</p>' +
      '<div class="memo"><div class="memo-block"><h3>学习者档案</h3><div class="prose">' + body(m.profile) + '</div></div>' +
      '<div class="memo-block"><h3>讲法偏好与卡点</h3><div class="prose">' + body(m.preferences) + '</div></div></div>';
    typeset(stageInner);
    renderTree();
  }

  /* ---------- 路由 ---------- */
  async function route() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/').filter(Boolean);
    state.route = 'home';
    try {
      if (parts[0] === 'memory') {
        await renderMemory();
      } else if (parts[0] === 's' && parts[1]) {
        state.route = 'subject';
        await renderSubject(decodeURIComponent(parts[1]));
      } else if (parts[0] === 'l' && parts[1] && parts[2]) {
        state.route = 'lesson';
        await renderLesson(decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
      } else if ((state.workspace.subjects || []).length) {
        state.route = 'home';
        await renderHome();
      } else {
        await renderHome();
      }
      renderTree();
    } catch (e) {
      sidePanel.hidden = true;
      stageInner.innerHTML = '<h1 class="page-title">读取失败</h1><div class="missing"><strong>' + esc(e.message) +
        '</strong>确认工作区里的 course.json 是合法 JSON，然后点右上角「刷新」。</div>';
    }
    document.getElementById('content').scrollTop = 0;
  }

  async function loadWorkspace() {
    state.workspace = await api('/api/workspace');
  }

  /* ---------- 主题 / 交互 ---------- */
  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('sm-theme', next);
  }
  document.documentElement.setAttribute('data-theme', localStorage.getItem('sm-theme') || 'light');
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  document.getElementById('themeTop').addEventListener('click', toggleTheme);

  Array.prototype.forEach.call(document.querySelectorAll('.act[data-go]'), function (b) {
    b.addEventListener('click', function () {
      var target = b.dataset.go;
      if (target === '#/s/') {
        var first = (state.workspace && state.workspace.subjects || [])[0];
        target = first ? '#/s/' + encodeURIComponent(first.id) : '#/';
      }
      location.hash = target;
    });
  });

  async function refreshAll() {
    await loadWorkspace();
    await route();
    toast('已刷新');
  }
  document.getElementById('refreshBtn').addEventListener('click', refreshAll);
  document.getElementById('refreshTop').addEventListener('click', refreshAll);
  window.addEventListener('hashchange', route);

  loadWorkspace()
    .then(route)
    .catch(function (e) {
      stageInner.innerHTML = '<h1 class="page-title">无法连接学习工作区</h1><div class="missing"><strong>' +
        esc(e.message) + '</strong>确认服务已启动：node study-mate/app/server.mjs --workspace StudyMate</div>';
    });
})();
