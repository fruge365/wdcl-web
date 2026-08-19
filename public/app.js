const form = document.querySelector('#jobForm');
const loginButton = document.querySelector('#loginButton');
const loginText = document.querySelector('#loginText');
const loginPill = document.querySelector('#loginPill');
const startButton = document.querySelector('#startButton');
const cancelButton = document.querySelector('#cancelButton');
const concurrency = document.querySelector('#concurrency');
const concurrencyText = document.querySelector('#concurrencyText');
const phaseText = document.querySelector('#phaseText');
const percentText = document.querySelector('#percentText');
const countText = document.querySelector('#countText');
const bytesText = document.querySelector('#bytesText');
const progressBar = document.querySelector('#progressBar');
const currentBar = document.querySelector('#currentBar');
const currentPercent = document.querySelector('#currentPercent');
const resultBox = document.querySelector('#resultBox');
const logsBox = document.querySelector('#logs');
const failedText = document.querySelector('#failedText');
const openResult = document.querySelector('#openResult');
const previewButton = document.querySelector('#previewButton');
const previewBox = document.querySelector('#previewBox');
const limitField = document.querySelector('#limitField');
const limitInput = document.querySelector('#limit');
const limitModeInputs = [...document.querySelectorAll('input[name="limitMode"]')];

let runningMode = null;
let resultPath = '';

const typeNames = {
  word: 'Word',
  excel: 'Excel',
  ppt: 'PPT',
  pdf: 'PDF',
  video: '视频',
  other: '其他',
};

const phaseNames = {
  idle: '待启动',
  starting: '启动中',
  collect: '读取列表',
  inspect: '检查文件',
  download: '下载中',
  package: '压缩中',
  complete: '完成',
  error: '未完成',
};

function formatBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = Number(value || 0);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}

function setRunning(mode) {
  runningMode = mode;
  const value = Boolean(mode);
  startButton.disabled = value;
  cancelButton.disabled = !value;
  form.querySelectorAll('input, button').forEach(control => {
    if (control !== cancelButton) control.disabled = value;
  });
  loginButton.disabled = value;
  if (value) openResult.disabled = true;
  cancelButton.querySelector('span').textContent = mode === 'preview' ? '停止搜索' : '停止';
  previewButton.disabled = value;
  previewButton.querySelector('span').textContent = mode === 'preview' ? '搜索中' : '搜索数量';
}

function selectedPreviewCount(preview) {
  const selected = [...document.querySelectorAll('#types input:checked')].map(input => input.value);
  if (!selected.length) return preview.total;
  return selected.reduce((sum, type) => sum + (preview.counts?.[type] || 0), 0);
}

function renderPreview(state) {
  previewBox.className = 'preview-box';
  previewBox.textContent = '';

  if (state.operation === 'preview') {
    previewBox.classList.add('pending');
    previewBox.textContent = state.message || '正在搜索结果';
    return;
  }

  const preview = state.preview;
  if (!preview) {
    previewBox.textContent = '尚未搜索';
    return;
  }
  if (preview.keyword !== document.querySelector('#keyword').value.trim()) {
    previewBox.textContent = '关键词已修改';
    return;
  }
  if (preview.error) {
    previewBox.classList.add('error');
    previewBox.textContent = preview.error;
    return;
  }

  const total = document.createElement('div');
  total.className = 'preview-total';
  const totalStrong = document.createElement('strong');
  totalStrong.textContent = String(preview.total);
  const totalText = document.createElement('span');
  totalText.textContent = `当前类型 ${selectedPreviewCount(preview)} 个`;
  total.append(totalStrong, totalText);

  const counts = document.createElement('div');
  counts.className = 'preview-counts';
  for (const [type, name] of Object.entries(typeNames)) {
    const item = document.createElement('div');
    item.className = 'preview-count';
    const count = document.createElement('strong');
    count.textContent = String(preview.counts?.[type] || 0);
    const label = document.createElement('span');
    label.textContent = name;
    item.append(count, label);
    counts.append(item);
  }

  previewBox.append(total, counts);
}

function render(state) {
  const percent = Math.max(0, Math.min(100, state.percent || 0));
  progressBar.style.width = `${percent}%`;
  percentText.textContent = `${percent.toFixed(1)}%`;
  phaseText.textContent = state.message || phaseNames[state.phase] || '';
  countText.textContent = `${state.processed || 0} / ${state.total || 0}`;
  bytesText.textContent = `${formatBytes(state.receivedBytes)} / ${formatBytes(state.totalBytes)}`;
  failedText.textContent = `${state.failed || 0} 失败`;

  if (state.current) {
    const currentPercentValue = state.current.total
      ? (state.current.received / state.current.total) * 100
      : 0;
    currentBar.style.width = `${Math.min(100, currentPercentValue)}%`;
    currentPercent.textContent = `${Math.min(100, currentPercentValue).toFixed(0)}%`;
  } else {
    currentBar.style.width = '0%';
    currentPercent.textContent = '0%';
  }

  const loginLabel = state.login.member ? '会员有效' : state.login.loggedIn ? '已登录，未检测到会员' : '未登录';
  loginPill.dataset.state = state.login.member ? 'member' : 'default';
  loginText.textContent = loginLabel;
  startButton.disabled = Boolean(runningMode) || !state.login.member;
  renderPreview(state);

  logsBox.textContent = '';
  for (const item of state.logs.slice(0, 100)) {
    const row = document.createElement('div');
    row.className = `log ${item.level}`;
    row.textContent = item.message;
    logsBox.prepend(row);
  }

  if (state.phase === 'complete' && state.result) {
    resultPath = state.result.path;
    openResult.disabled = false;
    resultBox.innerHTML = '';
    const title = document.createElement('strong');
    title.textContent = `已下载 ${state.result.downloaded} / ${state.result.requested} 个文件`;
    const filePath = document.createElement('span');
    filePath.textContent = state.result.path;
    resultBox.append(title, filePath);
  } else if (state.phase === 'error') {
    resultPath = '';
    openResult.disabled = true;
    resultBox.textContent = state.message;
  }
}

async function poll() {
  try {
    const state = await api('/api/state');
    if (runningMode && state.operation === 'idle' && ['idle', 'complete', 'error'].includes(state.phase)) {
      setRunning(null);
    }
    render(state);
  } catch {}
}

loginButton.addEventListener('click', async () => {
  try {
    await api('/api/login', { method: 'POST', body: '{}' });
  } catch (error) {
    alert(error.message);
  }
});

concurrency.addEventListener('input', () => {
  concurrencyText.textContent = concurrency.value;
});

function updateLimitMode() {
  const limited = document.querySelector('#limitedResults').checked;
  limitField.hidden = !limited;
  limitInput.required = limited;
  if (limited && !limitInput.value) limitInput.value = 100;
}

limitModeInputs.forEach(input => input.addEventListener('change', updateLimitMode));
updateLimitMode();

cancelButton.addEventListener('click', async () => {
  cancelButton.disabled = true;
  await api('/api/cancel', { method: 'POST', body: '{}' });
});

previewButton.addEventListener('click', async () => {
  if (runningMode) return;
  const keyword = document.querySelector('#keyword').value.trim();
  if (!keyword) {
    alert('请输入关键词');
    document.querySelector('#keyword').focus();
    return;
  }

  setRunning('preview');
  try {
    await api('/api/preview', {
      method: 'POST',
      body: JSON.stringify({
        keyword,
        types: [...document.querySelectorAll('#types input:checked')].map(input => input.value),
      }),
    });
  } catch (error) {
    setRunning(null);
    previewBox.className = 'preview-box error';
    previewBox.textContent = error.message;
  }
});

openResult.addEventListener('click', async () => {
  if (!resultPath) return;
  try {
    await api('/api/open', {
      method: 'POST',
      body: JSON.stringify({ path: resultPath }),
    });
  } catch (error) {
    alert(error.message);
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (runningMode) return;
  const limited = document.querySelector('#limitedResults').checked;
  let limit = 0;
  if (limited) {
    limit = Number(limitInput.value);
    if (!Number.isInteger(limit) || limit < 1) {
      alert('限制数量时，请输入大于 0 的整数');
      limitInput.focus();
      return;
    }
  }

  resultPath = '';
  openResult.disabled = true;
  resultBox.textContent = '任务已启动';
  setRunning('download');
  if (window.matchMedia('(max-width: 960px)').matches) {
    requestAnimationFrame(() => document.querySelector('.monitor').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  try {
    await api('/api/start', {
      method: 'POST',
      body: JSON.stringify({
        keyword: document.querySelector('#keyword').value.trim(),
        types: [...document.querySelectorAll('#types input:checked')].map(input => input.value),
        limit,
        concurrency: Number(concurrency.value),
        delayMs: Number(document.querySelector('#delayMs').value || 0),
        outputDirectory: document.querySelector('#outputDirectory').value.trim(),
        createZip: document.querySelector('#createZip').checked,
      }),
    });
  } catch (error) {
    setRunning(false);
    alert(error.message);
  }
});

setInterval(poll, 700);
poll();
