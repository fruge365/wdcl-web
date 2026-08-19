const http = require('node:http');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const API_ORIGIN = 'https://www.wdcl.top';
const FILE_ORIGIN = 'https://transboxjs-1252697964.cos.ap-guangzhou.myqcloud.com';
const SITE_ORIGIN = 'https://wdcl.top';
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PROFILE_DIR = path.join(ROOT, 'browser-profile');
const DEFAULT_OUTPUT = path.join(ROOT, 'downloads');
const PORT = Number(process.env.WDCL_TOOL_PORT || 18765);
const playwrightCandidates = [
  path.join(ROOT, 'node_modules', 'playwright-core'),
  'C:/Users/zw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core',
];
const playwrightCore = playwrightCandidates.find(candidate => fss.existsSync(path.join(candidate, 'index.js')));
const { chromium } = require(fss.existsSync(path.join(playwrightCore, 'index.js'))
  ? playwrightCore
  : 'playwright-core');

let browserContext;
let uiPage;
let loginCheckTimer;
let activeJob = null;
const state = {
  operation: 'idle',
  phase: 'idle',
  message: '准备就绪',
  percent: 0,
  processed: 0,
  total: 0,
  failed: 0,
  receivedBytes: 0,
  totalBytes: 0,
  current: null,
  logs: [],
  result: null,
  preview: null,
  openablePath: '',
};

function log(message, level = 'info') {
  state.logs.unshift({ message, level, time: new Date().toISOString() });
  if (state.logs.length > 300) state.logs.length = 300;
  console.log(`[${level}] ${message}`);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!isInside(PUBLIC_DIR, target)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
    };
    response.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  } catch {
    response.writeHead(404).end('Not Found');
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getOpenid() {
  if (!browserContext) return '';
  const cookies = await browserContext.cookies(['https://www.wdcl.top', 'https://wdcl.top']);
  const openid = cookies.find(cookie => cookie.name === 'openid');
  return openid ? decodeURIComponent(openid.value) : '';
}

async function apiPost(endpoint, body, openid) {
  const response = await fetch(`${API_ORIGIN}/jeecg-boot/main/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(openid ? { Cookie: `openid=${encodeURIComponent(openid)}` } : {}),
    },
    body: JSON.stringify(body),
    signal: activeJob?.abort.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 200) {
    throw new Error(payload.message || payload.msg || `${endpoint}: HTTP ${response.status}`);
  }
  return payload.result;
}

async function getLoginState() {
  const openid = await getOpenid();
  if (!openid) return { loggedIn: false, member: false };
  try {
    const user = await apiPost('gainUsrByOpenid', { openid }, openid);
    return { loggedIn: true, member: Boolean(user && user.kaitong), user };
  } catch (error) {
    return { loggedIn: true, member: false, error: String(error.message || error) };
  }
}

function fileKind(type) {
  const value = String(type || '').toLowerCase();
  if (['doc', 'docx'].includes(value)) return 'word';
  if (['xls', 'xlsx', 'csv'].includes(value)) return 'excel';
  if (['ppt', 'pptx'].includes(value)) return 'ppt';
  if (value === 'pdf') return 'pdf';
  if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'm4v', 'webm', 'mkv'].includes(value)) return 'video';
  return 'other';
}

function safeFileName(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim() || 'file';
}

function remoteUrl(record) {
  return `${FILE_ORIGIN}/${encodeURI(record.path)}?_wx_redirect=manual`;
}

async function collectRecords(options, openid) {
  const unique = new Map();
  let page = 1;
  let pages = 1;
  do {
    const result = await apiPost('gainReadList', {
      path: options.keyword,
      page,
      pageSize: 20,
    }, openid);
    pages = Number(result.pages ?? 1);
    for (const record of result.records ?? []) {
      if (record.path) unique.set(record.path, record);
    }
    if (options.limit > 0) {
      const matchingCount = [...unique.values()]
        .filter(record => !options.types.length || options.types.includes(fileKind(record.type)))
        .length;
      if (matchingCount >= options.limit) break;
    }
    Object.assign(state, {
      phase: 'collect',
      message: `读取搜索结果 ${page}/${pages}`,
      processed: page,
      total: pages,
      percent: options.preview
        ? Math.min(99, (page / Math.max(pages, 1)) * 100)
        : Math.min(8, (page / Math.max(pages, 1)) * 8),
    });
    page += 1;
    if (page <= pages) await delay(250);
  } while (page <= pages && !activeJob.cancelled);

  let records = [...unique.values()];
  if (options.types.length) records = records.filter(record => options.types.includes(fileKind(record.type)));
  if (options.limit > 0) records = records.slice(0, options.limit);
  return records;
}

async function inspectSizes(records) {
  const expected = new Array(records.length).fill(0);
  const queue = records.map((record, index) => ({ record, index }));
  let checked = 0;
  const worker = async () => {
    while (queue.length && !activeJob.cancelled) {
      const item = queue.shift();
      const response = await fetch(remoteUrl(item.record), {
        method: 'HEAD',
        signal: activeJob.abort.signal,
      });
      if (!response.ok) throw new Error(`检查文件大小失败：HTTP ${response.status}`);
      expected[item.index] = Number(response.headers.get('content-length') ?? 0);
      checked += 1;
      Object.assign(state, {
        phase: 'inspect',
        message: `检查文件 ${checked}/${records.length}`,
        processed: checked,
        total: records.length,
        percent: 8 + (checked / Math.max(records.length, 1)) * 7,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, records.length) }, worker));
  return expected;
}

async function downloadRecord(task, tempDir, onBytes) {
  await apiPost('insertDownload', {
    openid: activeJob.openid,
    category: task.record.category,
    path: task.record.path,
    title: task.record.type,
    type: task.record.type,
  }, activeJob.openid);

  const response = await fetch(remoteUrl(task.record), { signal: activeJob.abort.signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? task.expectedLength ?? 0);
  const temporaryPath = path.join(tempDir, `${task.name}.part`);
  const output = fss.createWriteStream(temporaryPath);
  let received = 0;

  try {
    for await (const chunk of response.body) {
      if (activeJob.cancelled) throw new Error('已取消');
      output.write(chunk);
      received += chunk.length;
      onBytes(chunk.length);
      state.current = { title: task.record.title, received, total: declared };
    }
    await new Promise((resolve, reject) => {
      output.end(resolve);
      output.on('error', reject);
    });
    if (task.expectedLength > 0 && received !== task.expectedLength) {
      throw new Error(`文件大小不一致：期望 ${task.expectedLength}，实际 ${received}`);
    }
    const finalPath = path.join(tempDir, task.name);
    await fs.rename(temporaryPath, finalPath);
    return finalPath;
  } catch (error) {
    output.destroy();
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

function runZip(sourceDir, destinationPath) {
  return new Promise((resolve, reject) => {
    const script = path.join(ROOT, 'make-zip.ps1');
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-SourceDir',
      sourceDir,
      '-DestinationPath',
      destinationPath,
    ], { windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`压缩失败，退出码 ${code}`));
    });
  });
}

async function runJob(options) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wdcl-tool-'));
  activeJob = {
    cancelled: false,
    abort: new AbortController(),
    openid: '',
  };
  Object.assign(state, {
    operation: 'download',
    phase: 'starting',
    message: '启动任务',
    percent: 1,
    processed: 0,
    total: 0,
    failed: 0,
      receivedBytes: 0,
      totalBytes: 0,
      current: null,
      result: null,
      openablePath: '',
  });

  try {
    activeJob.openid = await getOpenid();
    if (!activeJob.openid) throw new Error('请先扫码登录');
    const login = await getLoginState();
    if (!login.member) throw new Error('当前账号不是会员或会员状态未生效');

    const records = await collectRecords(options, activeJob.openid);
    if (!records.length) throw new Error('没有匹配的文件');
    const expected = await inspectSizes(records);
    const totalBytes = expected.reduce((sum, value) => sum + Number(value || 0), 0);
    const usedNames = new Set();
    const tasks = records.map((record, index) => {
      let name = safeFileName(path.basename(record.path));
      if (usedNames.has(name)) {
        const extension = path.extname(name);
        name = `${path.basename(name, extension)} [record-${record.id ?? index}]${extension}`;
      }
      usedNames.add(name);
      return {
        record,
        name,
        expectedLength: Number(expected[index] || 0),
      };
    });

    Object.assign(state, {
      phase: 'download',
      message: `准备下载 ${tasks.length} 个文件`,
      processed: 0,
      total: tasks.length,
      failed: 0,
      totalBytes,
      receivedBytes: 0,
      percent: 15,
    });

    const queue = [...tasks];
    const downloaded = [];
    let receivedBytes = 0;
    const updateProgress = byteCount => {
      receivedBytes += byteCount;
      Object.assign(state, {
        receivedBytes,
        percent: 15 + (totalBytes ? receivedBytes / totalBytes : state.processed / tasks.length) * 75,
      });
    };

    const worker = async () => {
      while (queue.length && !activeJob.cancelled) {
        const task = queue.shift();
        state.current = { title: task.record.title, received: 0, total: task.expectedLength };
        try {
          const filePath = await downloadRecord(task, tempDir, updateProgress);
          downloaded.push({ task, filePath });
          log(`下载完成：${task.name}`, 'success');
        } catch (error) {
          if (activeJob.cancelled || activeJob.abort.signal.aborted) return;
          state.failed += 1;
          log(`下载失败：${task.record.title} - ${error.message || error}`, 'error');
          if (/HTTP 429/.test(String(error.message))) {
            activeJob.cancelled = true;
            activeJob.abort.abort();
          }
        }
        state.processed += 1;
        Object.assign(state, {
          message: `下载进度 ${state.processed}/${tasks.length}`,
          percent: 15 + (totalBytes ? receivedBytes / totalBytes : state.processed / tasks.length) * 75,
        });
        await delay(options.delayMs);
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, Math.min(4, options.concurrency)) }, worker));
    if (activeJob.cancelled) throw new Error('任务已停止');
    if (!downloaded.length) throw new Error('全部文件下载失败');

    await fs.mkdir(options.outputDirectory, { recursive: true });
    if (!options.createZip) {
      const folder = path.join(options.outputDirectory, safeFileName(options.keyword));
      await fs.mkdir(folder, { recursive: true });
      for (const item of downloaded) {
        await fs.copyFile(item.filePath, path.join(folder, path.basename(item.filePath)));
      }
      Object.assign(state, {
        operation: 'idle',
        phase: 'complete',
        message: `完成：${downloaded.length}/${tasks.length}`,
        percent: 100,
        result: { path: folder, downloaded: downloaded.length, requested: tasks.length, failed: state.failed },
        openablePath: folder,
      });
      log(`任务完成：${folder}`, 'success');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const zipPath = path.join(options.outputDirectory, `${safeFileName(options.keyword)}-${timestamp}.zip`);
    Object.assign(state, {
      phase: 'package',
      message: '正在生成压缩包',
      current: null,
      percent: 93,
    });
    await runZip(tempDir, zipPath);
    const zipStat = await fs.stat(zipPath);
    if (!zipStat.isFile() || zipStat.size === 0) throw new Error('压缩包生成失败');
    Object.assign(state, {
      operation: 'idle',
      phase: 'complete',
      message: `完成：${downloaded.length}/${tasks.length}`,
      percent: 100,
      result: {
        path: zipPath,
        downloaded: downloaded.length,
        requested: tasks.length,
        failed: state.failed,
        zipBytes: zipStat.size,
      },
      openablePath: zipPath,
    });
    log(`压缩包完成：${zipPath}`, 'success');
  } catch (error) {
    const message = activeJob?.cancelled || activeJob?.abort.signal.aborted
      ? '任务已停止'
      : String(error.message || error);
    Object.assign(state, {
      operation: 'idle',
      phase: 'error',
      message,
      result: null,
      openablePath: '',
    });
    log(state.message, 'error');
  } finally {
    activeJob = null;
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runPreview(options) {
  activeJob = {
    cancelled: false,
    abort: new AbortController(),
    openid: await getOpenid(),
  };
  Object.assign(state, {
    operation: 'preview',
    phase: 'collect',
    message: '正在搜索结果',
    percent: 1,
    processed: 0,
    total: 0,
    current: null,
    preview: null,
  });

  try {
    if (!activeJob.openid) throw new Error('请先扫码登录');
    const login = await getLoginState();
    if (!login.member) throw new Error('当前账号不是会员或会员状态未生效');

    const records = await collectRecords({
      keyword: options.keyword,
      types: [],
      limit: 0,
      preview: true,
    }, activeJob.openid);

    const counts = {
      word: 0,
      excel: 0,
      ppt: 0,
      pdf: 0,
      video: 0,
      other: 0,
    };
    for (const record of records) counts[fileKind(record.type)] += 1;
    const selectedTotal = options.types.length
      ? options.types.reduce((sum, type) => sum + (counts[type] || 0), 0)
      : records.length;

    state.preview = {
      keyword: options.keyword,
      total: records.length,
      selectedTotal,
      counts,
      types: options.types,
      time: new Date().toISOString(),
    };
    Object.assign(state, {
      operation: 'idle',
      phase: 'idle',
      message: `搜索完成：${records.length} 个结果，当前类型 ${selectedTotal} 个`,
      percent: 100,
      processed: records.length,
      total: records.length,
    });
    log(`搜索“${options.keyword}”：${records.length} 个结果，当前类型 ${selectedTotal} 个`, 'success');
  } catch (error) {
    const cancelled = activeJob.cancelled || activeJob.abort.signal.aborted;
    state.preview = {
      keyword: options.keyword,
      types: options.types,
      error: cancelled ? '搜索已停止' : String(error.message || error),
      time: new Date().toISOString(),
    };
    Object.assign(state, {
      operation: 'idle',
      phase: 'idle',
      message: cancelled ? '搜索已停止' : `搜索失败：${state.preview.error}`,
      percent: 0,
      processed: 0,
      total: 0,
    });
    log(state.message, 'error');
  } finally {
    activeJob = null;
  }
}

async function openLoginPage() {
  if (!browserContext) return false;
  const page = await browserContext.newPage();
  await page.goto(`${SITE_ORIGIN}/pages/my/my`, { waitUntil: 'domcontentloaded' });
  if (loginCheckTimer) clearInterval(loginCheckTimer);
  page.once('close', () => {
    if (loginCheckTimer) clearInterval(loginCheckTimer);
    loginCheckTimer = null;
  });
  loginCheckTimer = setInterval(async () => {
    try {
      const login = await getLoginState();
      if (login.member) {
        clearInterval(loginCheckTimer);
        log('扫码登录成功，会员状态有效', 'success');
        for (const page of browserContext.pages()) {
          if (page.url().startsWith(SITE_ORIGIN) && page !== uiPage) await page.close().catch(() => {});
        }
        if (uiPage && !uiPage.isClosed()) await uiPage.bringToFront();
      }
    } catch {}
  }, 2000);
  return true;
}

async function launchBrowser() {
  browserContext = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: EDGE_PATH,
    headless: false,
    viewport: { width: 1120, height: 760 },
    args: [`--app=http://127.0.0.1:${PORT}/`],
  });
  uiPage = browserContext.pages()[0] || await browserContext.newPage();
  if (!uiPage.url().startsWith(`http://127.0.0.1:${PORT}`)) {
    await uiPage.goto(`http://127.0.0.1:${PORT}/`);
  }
  browserContext.on('close', () => {
    browserContext = null;
    uiPage = null;
    if (loginCheckTimer) clearInterval(loginCheckTimer);
    setTimeout(() => process.exit(0), 200);
  });
  await bringUiToFront();
  log('小工具窗口已打开');
}

async function bringUiToFront() {
  if (!browserContext || !uiPage || uiPage.isClosed()) throw new Error('下载窗口未启动');

  try {
    const cdp = await browserContext.newCDPSession(uiPage);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        windowState: 'normal',
        left: 80,
        top: 80,
        width: 1120,
        height: 760,
      },
    });
    await cdp.detach();
  } catch {}
  await uiPage.bringToFront();
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      if (request.method === 'GET' && url.pathname === '/api/state') {
        sendJson(response, 200, { ...state, login: await getLoginState() });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/login') {
        sendJson(response, 200, { ok: await openLoginPage() });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/open-ui') {
        sendJson(response, 200, { ok: await bringUiToFront() });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/preview') {
        if (activeJob) throw new Error(state.operation === 'preview' ? '正在搜索结果' : '已有下载任务正在运行');
        const body = await readBody(request);
        const options = {
          keyword: String(body.keyword || '').trim(),
          types: Array.isArray(body.types) ? body.types : [],
        };
        if (!options.keyword) throw new Error('请输入关键词');
        runPreview(options);
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/start') {
        if (activeJob) throw new Error('已有任务正在运行');
        const body = await readBody(request);
        const options = {
          keyword: String(body.keyword || '').trim(),
          types: Array.isArray(body.types) ? body.types : [],
          limit: Math.max(0, Number(body.limit || 0)),
          concurrency: Math.max(1, Math.min(4, Number(body.concurrency || 2))),
          delayMs: Math.max(0, Math.min(5000, Number(body.delayMs || 350))),
          outputDirectory: String(body.outputDirectory || DEFAULT_OUTPUT),
          createZip: body.createZip !== false,
        };
        if (!options.keyword) throw new Error('请输入关键词');
        runJob(options);
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/cancel') {
        if (activeJob) {
          activeJob.cancelled = true;
          activeJob.abort.abort();
        }
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/open') {
        const body = await readBody(request);
        const requestedPath = path.resolve(String(body.path || ''));
        if (!state.openablePath || requestedPath !== path.resolve(state.openablePath)) {
          throw new Error('没有可打开的结果');
        }
        const stat = await fs.stat(requestedPath).catch(() => null);
        if (!stat) throw new Error('结果路径不存在');

        const explorerArgs = stat.isDirectory()
          ? [requestedPath]
          : ['/select,', requestedPath];
        const explorer = spawn('explorer.exe', explorerArgs, { windowsHide: true });
        explorer.once('error', error => log(`打开结果失败：${error.message}`, 'error'));
        sendJson(response, 200, { ok: true });
        return;
      }
      sendJson(response, 404, { message: 'Not Found' });
    } catch (error) {
      sendJson(response, 400, { message: String(error.message || error) });
    }
    return;
  }
  await serveStatic(request, response);
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`WDCL tool listening on http://127.0.0.1:${PORT}`);
  await fs.mkdir(DEFAULT_OUTPUT, { recursive: true });
  await launchBrowser().catch(async error => {
    console.error(`打开窗口失败：${error.message}`);
    await fs.rm(PROFILE_DIR, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  });
});
