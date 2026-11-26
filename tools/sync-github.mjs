#!/usr/bin/env node
/**
 * 把本地 StudyMate 学习工作区同步到本项目仓库，并发布静态阅读站。
 *
 * 做的事：
 *   1. 拉取远端最新提交
 *   2. 把工作区镜像到仓库的 StudyMate/（删除工作区里已删掉的文件）
 *   3. 重新生成 docs/ 静态站
 *   4. git add / commit / push 到 main
 *
 * 用法：
 *   node tools/sync-github.mjs
 *   node tools/sync-github.mjs --message "同步课件：STM32 第 21 课"
 *   node tools/sync-github.mjs --no-push          # 只提交，不推送
 *   node tools/sync-github.mjs --workspace "D:\\StudyMate"
 *
 * 环境变量：
 *   STUDYMATE_WORKSPACE  工作区路径，默认 %USERPROFILE%\StudyMate
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXCLUDE = new Set(['.git', '.learning', 'node_modules', '.DS_Store', 'Thumbs.db']);

/* ---------------- 参数 ---------------- */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-push') out.noPush = true;
    else if (arg === '--no-pull') out.noPull = true;
    else if (arg === '--workspace') out.workspace = argv[++i];
    else if (arg === '--message' || arg === '-m') out.message = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('用法：node tools/sync-github.mjs [--message 文本] [--workspace 路径] [--no-push] [--no-pull]');
  process.exit(0);
}

const home = process.env.USERPROFILE || process.env.HOME || '';
const workspace = path.resolve(args.workspace || process.env.STUDYMATE_WORKSPACE || path.join(home, 'StudyMate'));
const dest = path.join(repoRoot, 'StudyMate');

/* ---------------- git 工具 ---------------- */

function git(gitArgs, options = {}) {
  return execFileSync('git', gitArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
  });
}

function gitConfig(key) {
  try {
    return git(['config', key]).trim();
  } catch {
    return '';
  }
}

/* ---------------- 镜像目录 ---------------- */

function mirror(src, dst) {
  fs.mkdirSync(dst, { recursive: true });

  // 删掉目标里源已不存在的文件/目录
  for (const name of fs.readdirSync(dst)) {
    if (EXCLUDE.has(name)) continue;
    if (!fs.existsSync(path.join(src, name))) {
      fs.rmSync(path.join(dst, name), { recursive: true, force: true });
      console.log(`  删除 ${path.relative(repoRoot, path.join(dst, name))}`);
    }
  }

  // 复制源里的文件
  for (const name of fs.readdirSync(src)) {
    if (EXCLUDE.has(name)) continue;
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) mirror(s, d);
    else fs.copyFileSync(s, d);
  }
}

/* ---------------- 主流程 ---------------- */

console.log(`仓库：${repoRoot}`);
console.log(`工作区：${workspace}`);

if (!fs.existsSync(path.join(workspace, 'workspace.json'))) {
  console.error(`错误：${workspace} 不像 StudyMate 工作区（缺少 workspace.json）。`);
  process.exit(1);
}

try {
  git(['rev-parse', '--is-inside-work-tree']);
} catch {
  console.error(`错误：${repoRoot} 不是 git 仓库。`);
  process.exit(1);
}

// 1. 拉取远端
if (!args.noPull) {
  try {
    git(['fetch', 'origin', 'main']);
    git(['merge', '--ff-only', 'origin/main']);
    console.log('✓ 已同步远端的最新提交');
  } catch {
    console.warn('! 拉取远端失败（可能有本地改动或分支已分叉），继续使用本地状态');
  }
}

// 2. 镜像工作区
console.log('→ 同步工作区到 StudyMate/ ...');
mirror(workspace, dest);

// 3. 生成静态站
console.log('→ 重新生成 docs/ ...');
execFileSync(process.execPath, [path.join(repoRoot, 'tools', 'build-pages.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit',
});

// 4. 提交
git(['add', '-A']);
const changed = git(['status', '--porcelain']).trim();
if (!changed) {
  console.log('没有需要同步的改动，仓库已是最新。');
  process.exit(0);
}

const message = args.message || `同步学习工作区 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
const identity = [];
if (!gitConfig('user.name')) identity.push('-c', 'user.name=StudyMate Sync');
if (!gitConfig('user.email')) identity.push('-c', 'user.email=studymate@local');

git([...identity, 'commit', '-m', message], { inherit: true });
const hash = git(['rev-parse', '--short', 'HEAD']).trim();

// 5. 推送
if (!args.noPush) {
  console.log('→ 推送到 GitHub ...');
  let pushed = false;
  for (let attempt = 1; attempt <= 2 && !pushed; attempt++) {
    try {
      git(['push', 'origin', 'HEAD:main'], { inherit: true });
      pushed = true;
    } catch {
      if (attempt === 1) {
        console.warn('! 第一次推送失败，2 秒后重试 ...');
        execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)']);
      }
    }
  }
  if (!pushed) {
    console.error('');
    console.error('推送失败，但本地提交已保留：' + hash);
    console.error('常见原因：未登录 GitHub、网络问题、或远端有新提交。');
    console.error('处理：运行 gh auth login，或先 git pull --rebase 后重试。');
    process.exit(2);
  }
}

const remote = git(['remote', 'get-url', 'origin']).trim();
const web = remote
  .replace(/^ssh:\/\/git@ssh\.github\.com:\d+\//, 'https://github.com/')
  .replace(/^git@github\.com:/, 'https://github.com/')
  .replace(/\.git$/, '');
console.log('');
console.log(`✓ 已同步 ${hash} · ${message}`);
console.log(`${web}/commit/${hash}`);
