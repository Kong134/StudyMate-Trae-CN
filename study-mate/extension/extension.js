const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let serverProc = null;
let serverUrl = null;
let startPromise = null;
let provider = null;
let panel = null;
let output = null;

function log(line) {
  if (!output) output = vscode.window.createOutputChannel('学习搭档');
  output.appendLine(line);
}

/** 找到学习工作区：优先项目根下的 StudyMate，其次 ~/StudyMate */
function resolveWorkspace() {
  const folders = vscode.workspace.workspaceFolders || [];
  for (const f of folders) {
    const candidate = path.join(f.uri.fsPath, 'StudyMate');
    if (fs.existsSync(path.join(candidate, 'workspace.json'))) return candidate;
  }
  const home = path.join(os.homedir(), 'StudyMate');
  if (fs.existsSync(path.join(home, 'workspace.json'))) return home;
  if (folders.length) return path.join(folders[0].uri.fsPath, 'StudyMate');
  return home;
}

function resolveServerScript(extensionPath) {
  const bundled = path.join(extensionPath, 'app', 'server.mjs');
  if (fs.existsSync(bundled)) return bundled;
  const sibling = path.resolve(extensionPath, '..', 'app', 'server.mjs');
  if (fs.existsSync(sibling)) return sibling;
  return null;
}

function spawnNode(args, useElectronNode) {
  const env = Object.assign({}, process.env);
  if (useElectronNode) env.ELECTRON_RUN_AS_NODE = '1';
  return spawn(useElectronNode ? process.execPath : 'node', args, {
    env,
    windowsHide: true,
    cwd: path.dirname(args[0])
  });
}

function startServer(context, workspace) {
  if (serverUrl) return Promise.resolve(serverUrl);
  if (startPromise) return startPromise;

  const script = resolveServerScript(context.extensionPath);
  if (!script) return Promise.reject(new Error('找不到 app/server.mjs，请重新安装扩展。'));

  startPromise = new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    const args = [script, '--workspace', workspace, '--no-open', '--port', '0'];

    const finish = (err, url) => {
      if (settled) return;
      settled = true;
      if (err) {
        startPromise = null;
        reject(err);
      } else {
        serverUrl = url;
        resolve(url);
      }
    };

    const launch = (useElectronNode) => {
      const proc = spawnNode(args, useElectronNode);
      serverProc = proc;

      proc.stdout.on('data', (chunk) => {
        buffer += String(chunk);
        const m = buffer.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (m) finish(null, m[0].replace(/\/$/, ''));
      });

      proc.stderr.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text) log('[server] ' + text);
      });

      proc.on('error', (err) => {
        if (!useElectronNode) {
          log('用 node 启动失败，改用内置 Node 重试：' + err.message);
          launch(true);
        } else {
          finish(err);
        }
      });

      proc.on('exit', (code) => {
        serverUrl = null;
        serverProc = null;
        startPromise = null;
        log('阅读端服务退出，code=' + code);
        if (!settled) finish(new Error('阅读端启动失败（退出码 ' + code + '）'));
      });
    };

    launch(false);

    setTimeout(() => {
      if (settled || serverUrl) return;
      finish(new Error('阅读端启动超时。看看输出面板「学习搭档」里的日志。'));
    }, 12000);
  });

  return startPromise;
}

function stopServer() {
  if (serverProc) {
    try { serverProc.kill(); } catch (e) { /* 已退出就算了 */ }
  }
  serverProc = null;
  serverUrl = null;
  startPromise = null;
}

function shellHtml(inner, csp) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #f4efe4; color: #1b2420;
    font-family: -apple-system, "Microsoft YaHei", sans-serif; }
  .wrap { height: 100%; display: flex; flex-direction: column; }
  iframe { flex: 1; width: 100%; border: 0; background: #f4efe4; }
  .tip { padding: 16px; font-size: 12.5px; line-height: 1.75; color: #4d5a53; }
  .tip b { color: #1f6f5c; }
  .tip code { background: rgba(31,111,92,.08); padding: 2px 5px; border-radius: 4px; }
  .empty { padding: 22px 18px; font-size: 13px; line-height: 1.8; }
  .empty h3 { margin: 0 0 10px; font-size: 15px; }
  .empty p { margin: 0 0 10px; color: #5c6a63; }
</style>
</head>
<body><div class="wrap">${inner}</div></body>
</html>`;
}

function iframeHtml(url) {
  return shellHtml(
    `<iframe src="${url}" allow="clipboard-read; clipboard-write"></iframe>` +
    `<div class="tip">阅读端在本地运行：<code>${url}</code></div>`,
    "default-src 'none'; style-src 'unsafe-inline'; frame-src http://127.0.0.1:* http://localhost:*;"
  );
}

function loadingHtml(text) {
  return shellHtml(`<div class="empty"><h3>${text}</h3><p>首次打开需要启动本地阅读端，通常一两秒。</p></div>`,
    "default-src 'none'; style-src 'unsafe-inline';");
}

function emptyHtml(workspace) {
  return shellHtml(
    `<div class="empty"><h3>还没有学习工作区</h3>
      <p>在对话里跟学习搭档说一句「我想学心理学」，它会生成大纲与第一课。</p>
      <p>工作区预期位置：<code>${workspace}</code></p></div>`,
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:;"
  );
}

class StudyMateView {
  constructor(context) {
    this.context = context;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: false };
    this.show();
    view.onDidChangeVisibility(() => {
      if (view.visible) this.show();
    });
  }

  async show() {
    if (!this.view) return;
    const workspace = resolveWorkspace();
    if (!fs.existsSync(path.join(workspace, 'workspace.json'))) {
      this.view.webview.html = emptyHtml(workspace);
      return;
    }
    if (serverUrl) {
      this.view.webview.html = iframeHtml(serverUrl);
      return;
    }
    this.view.webview.html = loadingHtml('正在启动学习阅读端…');
    try {
      const url = await startServer(this.context, workspace);
      if (this.view) this.view.webview.html = iframeHtml(url);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      log(msg);
      this.view.webview.html = shellHtml(
        `<div class="empty"><h3>启动失败</h3><p>${msg.replace(/</g, '&lt;')}</p>
          <p>确认机器上有 Node 18+，然后点标题栏的重启按钮。</p></div>`,
        "default-src 'none'; style-src 'unsafe-inline';"
      );
    }
  }

  refresh() {
    serverUrl = null;
    this.show();
  }
}

function errorHtml(msg) {
  return shellHtml(
    `<div class="empty"><h3>启动失败</h3><p>${String(msg).replace(/</g, '&lt;')}</p>
      <p>确认机器上有 Node 18+，然后重新执行命令或重启 Trae。</p></div>`,
    "default-src 'none'; style-src 'unsafe-inline';"
  );
}

/** 在编辑器区域打开一个标签页（活动栏不可用时的主入口） */
async function openPanel(context) {
  if (panel) {
    panel.reveal(panel.viewColumn);
    return;
  }
  panel = vscode.window.createWebviewPanel(
    'studyMate.panel',
    '学习搭档',
    vscode.ViewColumn.One,
    { enableScripts: false, retainContextWhenHidden: true }
  );
  panel.onDidDispose(() => { panel = null; });

  const workspace = resolveWorkspace();
  if (!fs.existsSync(path.join(workspace, 'workspace.json'))) {
    panel.webview.html = emptyHtml(workspace);
    return;
  }
  if (serverUrl) {
    panel.webview.html = iframeHtml(serverUrl);
    return;
  }
  panel.webview.html = loadingHtml('正在启动学习阅读端…');
  try {
    const url = await startServer(context, workspace);
    if (panel) panel.webview.html = iframeHtml(url);
  } catch (err) {
    log(err.message);
    if (panel) panel.webview.html = errorHtml(err.message);
  }
}

/** 启动痕迹：用来确认 Trae CN 到底有没有加载这个扩展 */
function markLoaded(context) {
  try {
    const file = path.join(os.homedir(), '.trae-cn', 'study-mate-load.log');
    const ver = context.extension && context.extension.packageJSON ? context.extension.packageJSON.version : '?';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${new Date().toISOString()} activated v${ver}\n`, 'utf8');
  } catch (e) { /* 写不进去就算了 */ }
}

function activate(context) {
  markLoaded(context);
  provider = new StudyMateView(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('studyMate.view', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('studyMate.openPanel', () => openPanel(context)),
    vscode.commands.registerCommand('studyMate.openInBrowser', async () => {
      try {
        const workspace = resolveWorkspace();
        const url = await startServer(context, workspace);
        await vscode.env.openExternal(vscode.Uri.parse(url));
      } catch (err) {
        vscode.window.showErrorMessage('打开阅读端失败：' + err.message);
      }
    }),
    vscode.commands.registerCommand('studyMate.restartServer', async () => {
      stopServer();
      provider.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    { dispose: stopServer }
  );

  // 状态栏入口：活动栏不可用时，这里也能一键打开
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = '$(book) 学习搭档';
  status.tooltip = '打开学习界面';
  status.command = 'studyMate.openPanel';
  status.show();
  context.subscriptions.push(status);
}

function deactivate() {
  stopServer();
}

module.exports = { activate, deactivate };
