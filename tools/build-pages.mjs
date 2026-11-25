/**
 * 把 StudyMate 工作区导出成可直接托管的静态站（docs/）。
 * 用法：node tools/build-pages.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = path.join(root, 'StudyMate');
const outDir = path.join(root, 'docs');
const vendor = path.join(root, 'study-mate/app/public/vendor');

const require = createRequire(import.meta.url);
const { marked } = require(path.join(vendor, 'marked.min.js'));
const katex = require(path.join(vendor, 'katex.min.js'));

marked.setOptions({ gfm: true, breaks: false });

const REPO_URL = 'https://github.com/Kong134/StudyMate-Trae-CN';

/* ---------------- 小工具 ---------------- */

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function frontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const data = {};
  let body = md;
  if (m) {
    body = md.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { data, body };
}

/* ---------------- 数学公式 ---------------- */

const mathStore = [];

function looksLikeMath(tex) {
  const t = tex.trim();
  if (!t) return false;
  if (/[\u4e00-\u9fff]/.test(t)) return false; // 公式里不出现汉字
  if (/^[A-Za-z]{1,4}$/.test(t)) return true;   // 单个变量，如 $x$
  if (!/[\\^_=<>+\-*/]/.test(t) && !/\d/.test(t)) return false;
  return /^[\s\dA-Za-z\\{}_^+\-*/=<>.,()[\];:|!'~]+$/.test(t);
}

function mathToPlaceholders(md) {
  const segments = md.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/);
  return segments
    .map((seg, idx) => {
      if (idx % 2 === 1) return seg; // 代码块原样保留
      let s = seg.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
        const html = katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false, strict: false });
        const key = `%%MATH${mathStore.length}%%`;
        mathStore.push(html);
        return `\n\n${key}\n\n`;
      });
      s = s.replace(/(?<!\\)\$([^\n$]+?)\$/g, (whole, tex) => {
        if (!looksLikeMath(tex)) return whole; // 避免把中文里的两个 $ 误判成公式
        const html = katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false, strict: false });
        const key = `%%MATH${mathStore.length}%%`;
        mathStore.push(html);
        return key;
      });
      return s;
    })
    .join('');
}

function restoreMath(html) {
  return html.replace(/%%MATH(\d+)%%/g, (_, i) => mathStore[Number(i)] || '');
}

/* ---------------- ::: 自定义块 ---------------- */

const DEFAULT_TITLES = {
  goal: '本课目标',
  key: '关键结论',
  note: '深入一步',
  warn: '注意',
  exercise: '练习',
  answer: '参考答案',
  project: '动手项目',
  selfcheck: '自检清单',
  example: '例子',
};

function parseBlocks(lines, start = 0) {
  const parts = [];
  let buf = [];
  let i = start;

  const flush = () => {
    if (buf.length) {
      parts.push({ type: 'md', text: buf.join('\n') });
      buf = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^:::\s*$/.test(line)) {
      flush();
      return [parts, i + 1];
    }

    const m = line.match(/^:::\s*([A-Za-z][\w-]*)?\s*(.*)$/);
    if (m) {
      const type = (m[1] || 'note').toLowerCase();
      const title = (m[2] || '').trim();
      flush();
      const [children, next] = parseBlocks(lines, i + 1);
      parts.push({ type: 'block', kind: type, title, children });
      i = next;
      continue;
    }

    buf.push(line);
    i++;
  }

  flush();
  return [parts, i];
}

function renderParts(parts) {
  return parts
    .map((p) => {
      if (p.type === 'md') return renderMarkdown(p.text);
      const inner = renderParts(p.children);
      if (p.kind === 'answer') {
        return `<details class="answer"><summary>${esc(p.title || DEFAULT_TITLES.answer)}</summary><div class="answer-body">${inner}</div></details>`;
      }
      const title = p.title || DEFAULT_TITLES[p.kind] || '提示';
      return `<section class="callout ${esc(p.kind)}"><h3 class="callout-title">${esc(title)}</h3>${inner}</section>`;
    })
    .join('\n');
}

function renderMarkdown(md) {
  if (!md.trim()) return '';
  const withMath = mathToPlaceholders(md);
  return restoreMath(marked.parse(withMath));
}

/* ---------------- 页面模板 ---------------- */

function layout({ title, siteTitle, nav, body, depth }) {
  const prefix = depth === 0 ? '' : '../';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)} · ${esc(siteTitle)}</title>
<link rel="stylesheet" href="${prefix}assets/katex/katex.min.css" />
<link rel="stylesheet" href="${prefix}assets/style.css" />
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="${prefix}index.html">学习搭档</a>
    <nav class="crumbs">${nav}</nav>
  </div>
</header>
<main class="page">
${body}
</main>
<footer class="footer">
  <span>只读静态版 · 进度与笔记请用本地阅读端</span>
  <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub 仓库</a>
</footer>
</body>
</html>`;
}

function addHeadingIds(html) {
  let n = 0;
  const items = [];
  html = html.replace(/<h2(?:\s[^>]*)?>([\s\S]*?)<\/h2>/g, (_, inner) => {
    const id = `sec-${n++}`;
    const text = inner.replace(/<[^>]+>/g, '').trim();
    items.push({ id, text });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { html, items };
}

function tocHtml(items) {
  if (items.length < 2) return '';
  return `<nav class="toc"><div class="toc-title">本页目录</div><ol>${items
    .map((it) => `<li><a href="#${it.id}">${esc(it.text)}</a></li>`)
    .join('')}</ol></nav>`;
}

/* ---------------- 构建 ---------------- */

const keepDir = path.join(root, 'tools', '.screenshots-tmp');
if (fs.existsSync(path.join(outDir, 'screenshots'))) {
  fs.rmSync(keepDir, { recursive: true, force: true });
  fs.cpSync(path.join(outDir, 'screenshots'), keepDir, { recursive: true });
}
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(keepDir)) {
  fs.cpSync(keepDir, path.join(outDir, 'screenshots'), { recursive: true });
  fs.rmSync(keepDir, { recursive: true, force: true });
}

// 样式与 KaTeX 资源
fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
fs.copyFileSync(path.join(root, 'tools', 'pages-style.css'), path.join(outDir, 'assets', 'style.css'));
fs.mkdirSync(path.join(outDir, 'assets', 'katex'), { recursive: true });
fs.copyFileSync(path.join(vendor, 'katex.min.css'), path.join(outDir, 'assets', 'katex', 'katex.min.css'));
fs.cpSync(path.join(vendor, 'fonts'), path.join(outDir, 'assets', 'katex', 'fonts'), { recursive: true });

// PPT 图片
const pptDir = path.join(workspace, 'subjects', 'stm32-embedded', 'assets', 'ppt');
if (fs.existsSync(pptDir)) {
  fs.mkdirSync(path.join(outDir, 'assets', 'ppt'), { recursive: true });
  for (const file of fs.readdirSync(pptDir)) {
    if (file.endsWith('.png')) fs.copyFileSync(path.join(pptDir, file), path.join(outDir, 'assets', 'ppt', file));
  }
}

const wsJson = readJson(path.join(workspace, 'workspace.json'));
const subjects = [];

for (const id of wsJson.subjects || []) {
  const dir = path.join(workspace, 'subjects', id);
  const courseFile = path.join(dir, 'course.json');
  if (!fs.existsSync(courseFile)) continue;
  const course = readJson(courseFile);
  const nodes = (course.nodes || []).filter((n) => n.lesson);
  subjects.push({ id, dir, course, nodes });

  fs.mkdirSync(path.join(outDir, id), { recursive: true });

  const lessons = nodes.filter((n) => fs.existsSync(path.join(dir, 'lessons', n.lesson)));
  lessons.forEach((node, idx) => {
    const md = fs.readFileSync(path.join(dir, 'lessons', node.lesson), 'utf8');
    const { data, body } = frontmatter(md);
    const raw = body.replace(/\]\(\/assets\/stm32\//g, '](../assets/ppt/');
    const [parts] = parseBlocks(raw.split(/\r?\n/));
    const rendered = renderParts(parts);
    const { html, items } = addHeadingIds(rendered);

    const prev = lessons[idx - 1];
    const next = lessons[idx + 1];
    const pager = `
<nav class="pager">
  ${prev ? `<a class="prev" href="${esc(prev.lesson.replace(/\.md$/, '.html'))}">← ${esc(prev.title)}</a>` : '<span></span>'}
  ${next ? `<a class="next" href="${esc(next.lesson.replace(/\.md$/, '.html'))}">${esc(next.title)} →</a>` : '<span></span>'}
</nav>`;

    const bodyHtml = `
<article class="lesson">
  <div class="lesson-meta">
    <span class="badge">${esc(data.type || node.type || 'lesson')}</span>
    ${data.duration ? `<span class="badge ghost">${esc(data.duration)} 分钟</span>` : ''}
    ${node.status === 'done' ? '<span class="badge done">已完成</span>' : ''}
  </div>
  ${tocHtml(items)}
  ${html}
  ${pager}
</article>`;

    const nav = `<a href="../index.html">全部科目</a><span>/</span><a href="index.html">${esc(course.title)}</a>`;
    fs.writeFileSync(
      path.join(outDir, id, node.lesson.replace(/\.md$/, '.html')),
      layout({ title: data.title || node.title, siteTitle: course.title, nav, body: bodyHtml, depth: 1 })
    );
  });

  // 科目首页
  const cards = (course.nodes || [])
    .map((n) => {
      const has = n.lesson && fs.existsSync(path.join(dir, 'lessons', n.lesson));
      const status = n.status === 'done' ? 'done' : n.status === 'in_progress' ? 'doing' : 'todo';
      const label = status === 'done' ? '已完成' : status === 'doing' ? '进行中' : '未开始';
      const inner = `
  <div class="node-main">
    <div class="node-title">${esc(n.title)}</div>
    <div class="node-summary">${esc(n.summary || '')}</div>
  </div>
  <div class="node-side">
    <span class="badge ${status}">${label}</span>
    ${n.estimated ? `<span class="node-time">${esc(n.estimated)} 分钟</span>` : ''}
  </div>`;
      return has
        ? `<a class="node" href="${esc(n.lesson.replace(/\.md$/, '.html'))}">${inner}</a>`
        : `<div class="node disabled">${inner}</div>`;
    })
    .join('\n');

  const subjectBody = `
<section class="hero">
  <h1>${esc(course.title)}</h1>
  <p class="subtitle">${esc(course.subtitle || '')}</p>
  <p class="goal">${esc(course.goal || '')}</p>
</section>
<section class="node-list">${cards}</section>`;

  fs.writeFileSync(
    path.join(outDir, id, 'index.html'),
    layout({
      title: course.title,
      siteTitle: '学习搭档',
      nav: '<a href="../index.html">全部科目</a>',
      body: subjectBody,
      depth: 1,
    })
  );
}

// 全站首页
const subjectCards = subjects
  .map(({ id, course, nodes }) => {
    const done = nodes.filter((n) => n.status === 'done').length;
    return `<a class="subject-card" href="${esc(id)}/index.html">
  <div class="subject-title">${esc(course.title)}</div>
  <div class="subject-sub">${esc(course.subtitle || '')}</div>
  <div class="subject-meta">${nodes.length} 课 · 已完成 ${done} 课</div>
</a>`;
  })
  .join('\n');

const homeBody = `
<section class="hero home">
  <h1>我的学习工作区</h1>
  <p class="subtitle">课件静态阅读版 · 手机和任何电脑都能打开</p>
</section>
<section class="subject-grid">${subjectCards}</section>`;

fs.writeFileSync(
  path.join(outDir, 'index.html'),
  layout({ title: '我的学习工作区', siteTitle: '学习搭档', nav: '', body: homeBody, depth: 0 })
);
fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

console.log(`已生成 ${subjects.length} 个科目、${subjects.reduce((n, s) => n + s.nodes.length, 0)} 个节点到 ${outDir}`);

