import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const PUBLIC_DIR = path.join(HERE, 'public');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const OPEN = argv.includes('--open');
const PORT = Number(getArg('port', process.env.STUDYMATE_PORT || 4310));

function resolveWorkspace() {
  const explicit = getArg('workspace', process.env.STUDYMATE_WORKSPACE);
  if (explicit) return path.resolve(explicit);
  const inProject = path.resolve(PLUGIN_ROOT, '..', 'StudyMate');
  if (fs.existsSync(path.join(inProject, 'workspace.json'))) return inProject;
  return path.join(process.env.USERPROFILE || process.env.HOME, 'StudyMate');
}

const WORKSPACE = resolveWorkspace();
const SUBJECTS_DIR = path.join(WORKSPACE, 'subjects');
const MEMORY_DIR = path.join(WORKSPACE, 'memory');

/* ---------- 工具 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8'
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

/** 只允许访问工作区内的文件，阻断 ../ 与绝对路径 */
function safeJoin(base, ...parts) {
  const target = path.resolve(base, ...parts);
  const root = path.resolve(base);
  if (!target.startsWith(root + path.sep) && target !== root) return null;
  return target;
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

async function readBody(req, limit = 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

/** 解析课件首部受限 YAML */
function parseLesson(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return { meta, markdown: m ? raw.slice(m[0].length) : raw };
}

/* ---------- 科目汇总 ---------- */
async function loadCourse(id) {
  const file = safeJoin(SUBJECTS_DIR, id, 'course.json');
  if (!file) return null;
  return readJson(file, null);
}

function summarize(course, id) {
  const nodes = Array.isArray(course.nodes) ? course.nodes : [];
  const counts = { todo: 0, in_progress: 0, done: 0, skipped: 0 };
  for (const n of nodes) {
    if (counts[n.status] !== undefined) counts[n.status] += 1;
    else counts.todo += 1;
  }
  const current = nodes.find((n) => n.status === 'in_progress') || nodes.find((n) => n.status === 'todo');
  return {
    id,
    title: course.title || id,
    subtitle: course.subtitle || '',
    goal: course.goal || '',
    level: course.level || '',
    status: course.status || 'active',
    nodeCount: nodes.length,
    doneCount: counts.done,
    counts,
    progress: nodes.length ? Math.round((counts.done / nodes.length) * 100) : 0,
    current: current ? { id: current.id, title: current.title } : null,
    hasLesson: Boolean(current && current.lesson)
  };
}

async function listSubjects() {
  const index = await readJson(path.join(WORKSPACE, 'workspace.json'), { subjects: [] });
  let ids = Array.isArray(index.subjects) ? index.subjects.slice() : [];
  try {
    const dirs = await fsp.readdir(SUBJECTS_DIR, { withFileTypes: true });
    for (const d of dirs) {
      if (d.isDirectory() && !ids.includes(d.name) && fs.existsSync(path.join(SUBJECTS_DIR, d.name, 'course.json'))) {
        ids.push(d.name);
      }
    }
  } catch {
    /* 没有 subjects 目录就先不管 */
  }
  const out = [];
  for (const id of ids) {
    const course = await loadCourse(id);
    if (course) out.push(summarize(course, id));
  }
  return out;
}

/* ---------- 路由 ---------- */
async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/workspace' && req.method === 'GET') {
    const index = await readJson(path.join(WORKSPACE, 'workspace.json'), {});
    return sendJson(res, 200, {
      name: index.name || '我的学习工作区',
      workspace: WORKSPACE,
      subjects: await listSubjects()
    });
  }

  if (p.startsWith('/api/course/') && req.method === 'GET') {
    const id = decodeURIComponent(p.slice('/api/course/'.length));
    const course = await loadCourse(id);
    if (!course) return sendJson(res, 404, { error: '找不到这门课' });
    return sendJson(res, 200, course);
  }

  if (p === '/api/lesson' && req.method === 'GET') {
    const subject = url.searchParams.get('subject');
    const nodeId = url.searchParams.get('node');
    const course = await loadCourse(subject);
    if (!course) return sendJson(res, 404, { error: '找不到这门课' });
    const node = (course.nodes || []).find((n) => n.id === nodeId);
    if (!node) return sendJson(res, 404, { error: '找不到这个知识点' });
    if (!node.lesson) return sendJson(res, 200, { node, missing: true, meta: {}, markdown: '', note: '' });

    const file = safeJoin(SUBJECTS_DIR, subject, 'lessons', node.lesson);
    if (!file || !fs.existsSync(file)) return sendJson(res, 200, { node, missing: true, meta: {}, markdown: '', note: '' });
    const parsed = parseLesson(await fsp.readFile(file, 'utf8'));
    const noteFile = safeJoin(SUBJECTS_DIR, subject, 'notes', `${nodeId}.md`);
    const note = noteFile && fs.existsSync(noteFile) ? await fsp.readFile(noteFile, 'utf8') : '';
    return sendJson(res, 200, { node, meta: parsed.meta, markdown: parsed.markdown, note, missing: false });
  }

  if (p === '/api/status' && req.method === 'POST') {
    const { subject, node, status } = await readBody(req);
    const allowed = ['todo', 'in_progress', 'done', 'skipped'];
    if (!allowed.includes(status)) return sendJson(res, 400, { error: 'status 不合法' });
    const file = safeJoin(SUBJECTS_DIR, subject, 'course.json');
    const course = file ? await readJson(file, null) : null;
    if (!course) return sendJson(res, 404, { error: '找不到这门课' });
    const target = (course.nodes || []).find((n) => n.id === node);
    if (!target) return sendJson(res, 404, { error: '找不到这个知识点' });
    target.status = status;
    await writeJson(file, course);

    const progressFile = path.join(SUBJECTS_DIR, subject, 'progress.json');
    const log = await readJson(progressFile, []);
    log.push({ at: new Date().toISOString(), subject, node, status });
    await writeJson(progressFile, log);
    return sendJson(res, 200, { ok: true, node: target });
  }

  if (p === '/api/note' && req.method === 'POST') {
    const { subject, node, content } = await readBody(req);
    const file = safeJoin(SUBJECTS_DIR, subject, 'notes', `${node}.md`);
    if (!file) return sendJson(res, 400, { error: '路径不合法' });
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, content || '', 'utf8');
    return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/memory' && req.method === 'GET') {
    const read = async (f) => {
      try {
        return await fsp.readFile(path.join(MEMORY_DIR, f), 'utf8');
      } catch {
        return '';
      }
    };
    return sendJson(res, 200, { profile: await read('profile.md'), preferences: await read('preferences.md') });
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

async function serveStatic(req, res, url) {
  const rel = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
  const file = safeJoin(PUBLIC_DIR, rel);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': path.extname(file) === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    fs.createReadStream(file).pipe(res);
    return;
  }
  // 前端使用 hash 路由，未命中的路径统一回 index.html
  const index = path.join(PUBLIC_DIR, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
  fs.createReadStream(index).pipe(res);
}

/* ---------- 启动 ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const done = (err) => {
    if (err) sendJson(res, 500, { error: err.message });
  };
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(done);
  } else {
    serveStatic(req, res, url).catch(done);
  }
});

if (!fs.existsSync(WORKSPACE)) {
  console.error(`\n[StudyMate] 找不到学习工作区：${WORKSPACE}`);
  console.error('先在对话里说“我想学 X”，让学习搭档建课，或手动创建 workspace.json。\n');
  process.exit(1);
}

function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error('[StudyMate] 启动失败：', err.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const actualPort = server.address().port;
    const url = `http://127.0.0.1:${actualPort}/`;
    console.log('\n  Study Mate 课件阅读端已启动');
    console.log(`  地址：${url}`);
    console.log(`  工作区：${WORKSPACE}`);
    console.log('  按 Ctrl+C 停止\n');
    if (OPEN) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
}

listen(PORT, 10);
