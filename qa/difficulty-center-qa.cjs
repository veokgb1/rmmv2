const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const rootDir = path.resolve(__dirname, '..');
const artifactDir = path.join(rootDir, 'qa-artifacts');
const screenshotDir = path.join(artifactDir, 'difficulty-center');
const reportPath = path.join(artifactDir, 'difficulty-center-report.json');

fs.mkdirSync(screenshotDir, { recursive: true });

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  }[ext] || 'application/octet-stream';
}

function createServer() {
  return http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      const filePath = path.normalize(path.join(rootDir, pathname));
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        return res.end('forbidden');
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': contentType(filePath) });
      res.end(fs.readFileSync(filePath));
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
}

function createMockApiModule() {
  return `
const month = new Date().toISOString().slice(0, 7);
const nowIso = () => new Date().toISOString();
const doneMarker = 'difficulty_center_done';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildAudit(existing, message) {
  const entry = '[' + nowIso() + '] ' + String(message || '').trim();
  const current = String(existing || '').trim();
  return current ? current + '\\n' + entry : entry;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function makeTx(data) {
  return {
    source: 'qa-fixture',
    status: '未关联',
    voucherPaths: [],
    voucherStoragePaths: [],
    recordBucket: 'formal',
    lifecycleState: 'active',
    pendingReason: null,
    difficultyState: null,
    difficultyDoneAt: null,
    difficultyDoneReason: null,
    decisionSource: 'manual',
    decisionNote: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastReviewedAt: nowIso(),
    ...data,
  };
}

function makeVoucher(data) {
  return {
    lifecycleState: 'pending_link',
    pendingReason: 'manual_unbind',
    difficultyState: null,
    difficultyDoneAt: null,
    difficultyDoneReason: null,
    decisionSource: 'manual',
    decisionNote: '',
    linkedTransactionIds: [],
    linkedTransactionKeys: [],
    updatedAt: nowIso(),
    lastReviewedAt: nowIso(),
    latestAt: nowIso(),
    ...data,
  };
}

const txDb = new Map([
  ['formal_dup_a', makeTx({ id: 'formal_dup_a', date: month + '-08', month, type: '支出', category: '餐饮', amount: 120, summary: '午餐报销', status: '人工关联', decisionNote: 'qa fixture dedupe A' })],
  ['formal_dup_b', makeTx({ id: 'formal_dup_b', date: month + '-08', month, type: '支出', category: '餐饮', amount: 120, summary: '午餐报销', status: '人工关联', decisionNote: 'qa fixture dedupe B' })],
  ['formal_promo_target', makeTx({ id: 'formal_promo_target', date: month + '-11', month, type: '支出', category: '饮品', amount: 66, summary: '奶茶报销', status: '人工关联' })],
  ['formal_relink_target', makeTx({ id: 'formal_relink_target', date: month + '-12', month, type: '支出', category: '交通', amount: 88.5, summary: '滴滴打车发票', status: '未关联' })],
  ['temp_review', makeTx({ id: 'temp_review', date: month + '-11', month, type: '支出', category: '饮品', amount: 66, summary: '奶茶报销', recordBucket: 'temp', lifecycleState: 'active', pendingReason: 'temp_capture', decisionNote: 'qa temp record' })],
  ['temp_hidden_legacy', makeTx({ id: 'temp_hidden_legacy', date: month + '-06', month, type: '支出', category: '办公', amount: 18, summary: '老标记隐藏样本', recordBucket: 'temp', decisionNote: 'legacy ' + doneMarker })],
]);

const voucherDb = new Map([
  ['voucher_relink', makeVoucher({ id: 'voucher_relink', storagePath: 'vouchers/' + month + '/taxi-001.jpg', amount: 88.5, date: month + '-12', summary: '滴滴打车发票', merchant: '滴滴出行', latestAt: month + '-13T09:00:00.000Z', updatedAt: month + '-13T09:00:00.000Z', lastReviewedAt: month + '-13T09:00:00.000Z' })],
  ['voucher_done', makeVoucher({ id: 'voucher_done', storagePath: 'vouchers/' + month + '/meal-002.jpg', amount: 32, date: month + '-09', summary: '午餐小票', merchant: '员工食堂', latestAt: month + '-12T08:00:00.000Z', updatedAt: month + '-12T08:00:00.000Z', lastReviewedAt: month + '-12T08:00:00.000Z' })],
  ['voucher_page3', makeVoucher({ id: 'voucher_page3', storagePath: 'vouchers/' + month + '/office-003.jpg', amount: 18, date: month + '-07', summary: '办公用品小票', merchant: '文具店', difficultyState: 'done', difficultyDoneReason: doneMarker, latestAt: month + '-10T07:00:00.000Z', updatedAt: month + '-10T07:00:00.000Z', lastReviewedAt: month + '-10T07:00:00.000Z' })],
  ['voucher_page4', makeVoucher({ id: 'voucher_page4', storagePath: 'vouchers/' + month + '/office-004.jpg', amount: 21, date: month + '-06', summary: '办公耗材补票', merchant: '文具店', difficultyState: 'done', difficultyDoneReason: doneMarker, latestAt: month + '-10T07:00:00.000Z', updatedAt: month + '-10T07:00:00.000Z', lastReviewedAt: month + '-10T07:00:00.000Z' })],
  // Fixture for "missing updatedAt" cursor edge-case test.
  // updatedAt is intentionally null; lastReviewedAt/createdAt are present but must
  // not be used as the cursor timestamp (that would misalign with orderBy("updatedAt")).
  ['voucher_no_updatedAt', makeVoucher({ id: 'voucher_no_updatedAt', storagePath: 'vouchers/' + month + '/no-updated-at.jpg', amount: 15, date: month + '-05', summary: '无更新时间样本', merchant: '测试商家', updatedAt: null, lastReviewedAt: month + '-05T06:00:00.000Z', latestAt: month + '-05T06:00:00.000Z', createdAt: month + '-05T06:00:00.000Z' })],
]);

function normalizeTx(tx) {
  const item = { ...tx };
  item.voucherPaths = uniqueStrings([...(item.voucherPaths || []), ...(item.voucherStoragePaths || [])]);
  item.voucherStoragePaths = [...item.voucherPaths];
  item.decisionNote = String(item.decisionNote || '');
  item.recordBucket = item.recordBucket || 'formal';
  item.lifecycleState = item.lifecycleState || (item.pendingReason ? 'pending_link' : 'active');
  item.pendingReason = item.pendingReason ?? null;
  item.difficultyState = item.difficultyState || (item.decisionNote.includes(doneMarker) ? 'done' : null);
  item.difficultyDoneAt = item.difficultyDoneAt || (item.difficultyState === 'done' ? item.lastReviewedAt || item.updatedAt : null);
  item.difficultyDoneReason = item.difficultyDoneReason || (item.difficultyState === 'done' ? doneMarker : null);
  item.decisionSource = item.decisionSource || 'manual';
  return item;
}

function normalizeVoucher(voucher) {
  const item = { ...voucher };
  item.decisionNote = String(item.decisionNote || '');
  item.lifecycleState = item.lifecycleState || 'pending_link';
  item.pendingReason = item.pendingReason || null;
  item.difficultyState = item.difficultyState || (item.decisionNote.includes(doneMarker) ? 'done' : null);
  item.difficultyDoneAt = item.difficultyDoneAt || (item.difficultyState === 'done' ? item.lastReviewedAt || item.updatedAt : null);
  item.difficultyDoneReason = item.difficultyDoneReason || (item.difficultyState === 'done' ? doneMarker : null);
  item.latestAt = item.lastReviewedAt || item.updatedAt || item.createdAt || null;
  return item;
}

function sortByDateDesc(items) {
  return items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function sortByLatestDesc(items) {
  return items.sort((a, b) => {
    const diff = Date.parse(b.latestAt || b.updatedAt || b.lastReviewedAt || 0) - Date.parse(a.latestAt || a.updatedAt || a.lastReviewedAt || 0);
    if (diff !== 0) return diff;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function toCursorMillis(voucher) {
  return Date.parse(voucher.updatedAt || voucher.createdAt || 0) || 0;
}

function normalizeCursor(input) {
  if (!input) return null;
  let cursor = input;
  if (typeof cursor === 'string') {
    try { cursor = JSON.parse(cursor); } catch { return null; }
  }
  const id = String(cursor.id || '').trim();
  const updatedAtMs = Number(cursor.updatedAtMs);
  if (!id || !Number.isFinite(updatedAtMs)) return null;
  return { id, updatedAtMs };
}

export async function submitTransaction(txData) {
  const id = txData.id || 'tx_' + Math.random().toString(36).slice(2, 10);
  const record = normalizeTx(makeTx({ id, ...txData, month: (txData.date || month + '-01').slice(0, 7) }));
  txDb.set(id, record);
  return { id };
}

export async function fetchLedger({ month: queryMonth, limit = 100 } = {}) {
  const items = [...txDb.values()].map(normalizeTx).filter((tx) => !queryMonth || tx.month === queryMonth);
  return sortByDateDesc(items).slice(0, limit).map(clone);
}

export async function updateTransaction(txId, updates) {
  const current = txDb.get(txId);
  if (!current) throw new Error('Transaction not found: ' + txId);
  const stamp = nowIso();
  const next = normalizeTx({ ...current, ...updates });

  if ('voucherPaths' in updates || 'voucherStoragePaths' in updates) {
    next.voucherPaths = uniqueStrings([...(updates.voucherPaths || []), ...(updates.voucherStoragePaths || [])]);
    next.voucherStoragePaths = [...next.voucherPaths];
  }
  if ('difficultyState' in updates || 'difficultyDoneAt' in updates || 'difficultyDoneReason' in updates) {
    if ('difficultyState' in updates) next.difficultyState = updates.difficultyState ?? null;
    if ('difficultyDoneAt' in updates) next.difficultyDoneAt = updates.difficultyDoneAt ?? null;
    else if (updates.difficultyState === 'done') next.difficultyDoneAt = stamp;
    else if ('difficultyState' in updates) next.difficultyDoneAt = null;

    if ('difficultyDoneReason' in updates) next.difficultyDoneReason = updates.difficultyDoneReason ?? null;
    else if ('difficultyState' in updates && updates.difficultyState !== 'done') next.difficultyDoneReason = null;
  }

  next.updatedAt = stamp;
  if ('lifecycleState' in updates || 'pendingReason' in updates || 'decisionSource' in updates || 'decisionNote' in updates || 'difficultyState' in updates || 'difficultyDoneAt' in updates || 'difficultyDoneReason' in updates) {
    next.lastReviewedAt = updates.lastReviewedAt || stamp;
  }
  txDb.set(txId, next);
  return { id: txId };
}

export async function deleteTransaction(txId) {
  return updateTransaction(txId, {
    _deleted: true,
    status: '已删除',
    lifecycleState: 'deleted',
    pendingReason: null,
    decisionSource: 'manual',
    decisionNote: buildAudit(txDb.get(txId)?.decisionNote, 'manual delete record'),
  });
}

export async function unbindVouchers(txId, pathsToRemove = []) {
  const current = normalizeTx(txDb.get(txId));
  if (!current) throw new Error('Transaction not found: ' + txId);
  const removeSet = new Set((pathsToRemove || []).map((item) => String(item || '')));
  const nextPaths = (current.voucherStoragePaths || []).filter((item) => !removeSet.has(item));
  await updateTransaction(txId, {
    voucherPaths: nextPaths,
    voucherStoragePaths: nextPaths,
    lifecycleState: nextPaths.length ? 'active' : 'pending_link',
    pendingReason: nextPaths.length ? null : 'manual_unbind',
    decisionSource: 'manual',
    decisionNote: buildAudit(current.decisionNote, 'manual unbind vouchers'),
  });
  for (const voucher of voucherDb.values()) {
    if (!removeSet.has(voucher.storagePath)) continue;
    const stamp = nowIso();
    voucher.lifecycleState = 'pending_link';
    voucher.pendingReason = 'manual_unbind';
    voucher.difficultyState = null;
    voucher.difficultyDoneAt = null;
    voucher.difficultyDoneReason = null;
    voucher.decisionSource = 'manual';
    voucher.decisionNote = buildAudit(voucher.decisionNote, 'manual unbind');
    voucher.updatedAt = stamp;
    voucher.lastReviewedAt = stamp;
    voucher.latestAt = stamp;
  }
  return { remainingPaths: nextPaths, removedPaths: [...removeSet], updatedVoucherDocs: [...removeSet].length };
}

export async function geminiOCR() {
  return { amount: 0, date: month + '-01', summary: 'qa ocr mock' };
}

export async function geminiNLP({ text }) {
  return [{ date: month + '-15', type: '支出', category: '其他支出', amount: 1, summary: text || 'qa nlp mock' }];
}

export async function uploadVoucher() {
  return { id: 'qa-upload', storagePath: 'vouchers/' + month + '/qa-upload.jpg' };
}

export async function fetchPendingVouchers({ limit = 100, pageSize, cursor = null, returnMeta = false } = {}) {
  const items = [...voucherDb.values()].map(normalizeVoucher).filter((voucher) => voucher.lifecycleState === 'pending_link');
  const sorted = [...items].sort((a, b) => {
    const diff = toCursorMillis(b) - toCursorMillis(a);
    if (diff !== 0) return diff;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  const useCursor = Boolean(returnMeta || cursor || pageSize);
  const size = Math.max(1, Number(pageSize || limit || 100));
  if (!useCursor) {
    return sorted.slice(0, size).map(clone);
  }
  const forceFallbackStep = Boolean(globalThis?.__ENV__?.GLOBAL_CENTER_FORCE_PENDING_FALLBACK_STEP);
  if (forceFallbackStep) {
    const list = sorted.slice(0, size).map(clone);
    return {
      list,
      nextCursor: null,
      hasMore: sorted.length >= size,
      pageSize: size,
      fallback: true,
      fallbackMode: 'step',
      fallbackReason: 'cursor_query_failed',
      fallbackDetail: 'qa force fallback step',
    };
  }

  const parsed = normalizeCursor(cursor);
  let startIndex = 0;
  if (parsed) {
    const exactIndex = sorted.findIndex((voucher) => voucher.id === parsed.id && toCursorMillis(voucher) === parsed.updatedAtMs);
    if (exactIndex >= 0) {
      startIndex = exactIndex + 1;
    } else {
      startIndex = sorted.findIndex((voucher) => {
        const ms = toCursorMillis(voucher);
        if (ms < parsed.updatedAtMs) return true;
        if (ms === parsed.updatedAtMs) return String(voucher.id || '').localeCompare(parsed.id) > 0;
        return false;
      });
      if (startIndex < 0) startIndex = sorted.length;
    }
  }

  const page = sorted.slice(startIndex, startIndex + size);
  const hasMore = startIndex + size < sorted.length;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? { id: last.id, updatedAtMs: toCursorMillis(last) }
    : null;
  return {
    list: page.map(clone),
    nextCursor,
    hasMore,
    pageSize: size,
    fallback: false,
  };
}

export async function fetchTempTransactions({ limit = 100 } = {}) {
  const items = [...txDb.values()].map(normalizeTx).filter((tx) => tx.recordBucket === 'temp');
  return sortByLatestDesc(items).slice(0, limit).map(clone);
}

export async function promoteTempTransaction(txId, options = {}) {
  const current = normalizeTx(txDb.get(txId));
  if (!current) throw new Error('Transaction not found: ' + txId);
  await updateTransaction(txId, {
    recordBucket: 'formal',
    lifecycleState: 'active',
    pendingReason: null,
    difficultyState: options.difficultyState ?? null,
    difficultyDoneAt: options.difficultyDoneAt ?? null,
    difficultyDoneReason: options.difficultyDoneReason ?? null,
    decisionSource: options.decisionSource || 'manual',
    decisionNote: buildAudit(current.decisionNote, options.decisionNote || 'promote temp transaction'),
  });
  return { id: txId };
}

export async function relinkVoucherToTransaction({ voucherId, storagePath, txId }) {
  const current = normalizeTx(txDb.get(txId));
  if (!current) throw new Error('Transaction not found: ' + txId);
  const nextPaths = uniqueStrings([...(current.voucherStoragePaths || []), storagePath]);
  await updateTransaction(txId, {
    voucherPaths: nextPaths,
    voucherStoragePaths: nextPaths,
    status: '人工关联',
    lifecycleState: 'active',
    pendingReason: null,
    decisionSource: 'manual',
    decisionNote: buildAudit(current.decisionNote, 'relink voucher to transaction'),
  });
  const voucher = voucherId ? voucherDb.get(voucherId) : [...voucherDb.values()].find((item) => item.storagePath === storagePath);
  if (voucher) {
    const stamp = nowIso();
    voucher.lifecycleState = 'active';
    voucher.pendingReason = null;
    voucher.difficultyState = null;
    voucher.difficultyDoneAt = null;
    voucher.difficultyDoneReason = null;
    voucher.decisionSource = 'manual';
    voucher.linkedTransactionIds = uniqueStrings([...(voucher.linkedTransactionIds || []), txId]);
    voucher.decisionNote = buildAudit(voucher.decisionNote, 'relink to transaction');
    voucher.updatedAt = stamp;
    voucher.lastReviewedAt = stamp;
    voucher.latestAt = stamp;
  }
  return { txId, voucherId: voucherId || null, updatedVoucherDocs: voucher ? 1 : 0 };
}

export async function markVoucherDifficultyDone({ voucherId, storagePath, decisionNote = 'mark difficulty as done', decisionSource = 'manual', difficultyDoneReason = doneMarker } = {}) {
  const voucher = voucherId ? voucherDb.get(voucherId) : [...voucherDb.values()].find((item) => item.storagePath === storagePath);
  if (!voucher) return 0;
  const stamp = nowIso();
  voucher.difficultyState = 'done';
  voucher.difficultyDoneAt = stamp;
  voucher.difficultyDoneReason = difficultyDoneReason;
  voucher.decisionSource = decisionSource;
  voucher.decisionNote = buildAudit(voucher.decisionNote, decisionNote);
  voucher.lastReviewedAt = stamp;
  voucher.latestAt = voucher.updatedAt || voucher.lastReviewedAt || stamp;
  return 1;
}

export async function fetchShadowLogs() {
  return [];
}

export async function loginUser() {
  return { uid: 'qa-user' };
}

export async function logoutUser() {
  return true;
}

export async function onAuthChange(callback) {
  setTimeout(() => callback({ uid: 'qa-user', email: 'qa@example.com' }), 0);
  return () => {};
}
`;
}

function firebaseStub(url) {
  if (url.endsWith('firebase-app.js')) {
    return 'export function initializeApp(config){ return { config }; }';
  }
  if (url.endsWith('firebase-firestore.js')) {
    return 'export function getFirestore(){ return {}; }';
  }
  if (url.endsWith('firebase-auth.js')) {
    return 'export function getAuth(){ return {}; } export function onAuthStateChanged(auth, cb){ setTimeout(() => cb({ uid: "qa-user" }), 0); return () => {}; } export async function signInWithEmailAndPassword(){ return { user: { uid: "qa-user" } }; } export async function signOut(){ return true; }';
  }
  if (url.endsWith('firebase-storage.js')) {
    return 'export function getStorage(){ return {}; } export function ref(storage, path){ return { storage, fullPath: path }; } export async function getDownloadURL(){ return "./icons/icon-192.png"; }';
  }
  return 'export {}';
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'msedge' });
  } catch {
    return chromium.launch({ headless: true });
  }
}

async function attachRoutes(page) {
  await page.route(/\/js\/api-bridge\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: createMockApiModule() });
  });
  await page.route(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.0\/.+\.js/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: firebaseStub(route.request().url()) });
  });
  await page.route(/https:\/\/cdn\.tailwindcss\.com\/?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: `window.tailwind = window.tailwind || {}; document.head.insertAdjacentHTML('beforeend', '<style>.hidden{display:none!important}.fixed{position:fixed}.absolute{position:absolute}.inset-0{inset:0}.z-20,.z-30,.z-40,.z-50{position:relative}</style>');`,
    });
  });
}

async function runScenario(browser, baseUrl, strategy, report) {
  const scenario = {
    strategy,
    startedAt: new Date().toISOString(),
    steps: [],
    requestfailed: [],
    pageerrors: [],
    console: [],
    screenshots: [],
    failures: [],
  };
  report.scenarios.push(scenario);

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => scenario.console.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => scenario.pageerrors.push(String(err.stack || err.message || err)));
  page.on('requestfailed', (req) => scenario.requestfailed.push({ url: req.url(), errorText: req.failure()?.errorText || 'failed' }));

  await page.addInitScript(() => {
    window.__ENV__ = {
      ...(window.__ENV__ || {}),
      GLOBAL_CENTER_LIMIT_FORMAL: 2,
      GLOBAL_CENTER_LIMIT_TEMP: 1,
      GLOBAL_CENTER_LIMIT_PENDING: 1,
      GLOBAL_CENTER_PENDING_PAGE_SIZE: 1,
      GLOBAL_CENTER_STEP_FORMAL: 2,
      GLOBAL_CENTER_STEP_TEMP: 1,
      GLOBAL_CENTER_STEP_PENDING: 1,
      GLOBAL_CENTER_MAX_FORMAL: 10,
      GLOBAL_CENTER_MAX_TEMP: 10,
      GLOBAL_CENTER_MAX_PENDING: 10,
    };
    const swStub = {
      register: async (_url, options = {}) => ({ scope: options.scope || '/' }),
      addEventListener: () => {},
    };
    try {
      Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: swStub });
    } catch {
      try { window.navigator.serviceWorker = swStub; } catch {}
    }
  });

  await attachRoutes(page);

  async function screenshot(name) {
    const filePath = path.join(screenshotDir, `${strategy}-${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    scenario.screenshots.push(filePath);
    return filePath;
  }

  async function getEntryCount() {
    return page.locator('#difficulty-list').evaluate((el) => {
      return [...new Set([...el.querySelectorAll('[data-entry-id]')].map((node) => node.getAttribute('data-entry-id')))].length;
    });
  }

  async function getGlobalEntryCount() {
    return page.locator('#global-center-list').evaluate((el) => {
      return [...new Set([...el.querySelectorAll('[data-entry-id]')].map((node) => node.getAttribute('data-entry-id')))].length;
    });
  }

  async function getGlobalEntryOrder() {
    return page.locator('#global-center-list').evaluate((el) => {
      const ids = [...el.querySelectorAll('[data-entry-id]')]
        .map((node) => node.getAttribute('data-entry-id'))
        .filter(Boolean);
      const ordered = [];
      ids.forEach((id) => {
        if (!ordered.includes(id)) ordered.push(id);
      });
      return ordered;
    });
  }

  async function readGlobalScope() {
    const text = await page.$eval('#global-scope-hint', (el) =>
      (el.textContent || '').replace(/\s+/g, ' ').trim(),
    );
    function parse(sourceKey) {
      const regex = new RegExp(`${sourceKey} loaded (\\d+)\\/(\\d+) \\(base (\\d+), max (\\d+)\\)`, 'i');
      const match = text.match(regex);
      if (!match) return null;
      return {
        loaded: Number(match[1]),
        requested: Number(match[2]),
        base: Number(match[3]),
        max: Number(match[4]),
      };
    }
    function parsePending() {
      const regex = /pending_link loaded (\d+)\/(\d+) \(page (\d+), mode (cursor|fallback-step)\)/i;
      const match = text.match(regex);
      if (!match) return null;
      return {
        loaded: Number(match[1]),
        requested: Number(match[2]),
        pageSize: Number(match[3]),
        mode: String(match[4] || '').toLowerCase(),
      };
    }
    return {
      text,
      formal: parse('formal'),
      temp: parse('temp'),
      pendingLink: parsePending(),
    };
  }

  async function readLoadMoreMeta(sourceType = 'pending') {
    return page.$eval(`[data-global-load-more="${sourceType}"]`, (el) => ({
      disabled: el.hasAttribute('disabled'),
      loadState: el.getAttribute('data-load-state') || null,
      loadMode: el.getAttribute('data-load-mode') || null,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
  }

  async function openGlobalCenterFresh(entryAction) {
    await openGlobalCenter('openRowCorrelation');
    await closeGlobalCenter();
    await openGlobalCenter(entryAction);
  }

  async function clickSelector(selector, index = 0) {
    const locator = page.locator(selector).nth(index);
    await locator.waitFor({ state: 'attached', timeout: 15000 });
    await locator.click({ force: true });
  }

  async function openDifficultyCenter() {
    await clickSelector('#fab-add');
    await clickSelector('[data-action="openConflictCourt"]');
    await page.waitForSelector('#difficulty-list', { state: 'attached' });
  }

  async function openGlobalCenter(entryAction) {
    await clickSelector('#fab-add');
    await page.waitForTimeout(80);
    const clicked = await page.evaluate((action) => {
      const target = document.querySelector(`[data-action="${action}"][data-disabled="false"]`);
      if (!target) return false;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return true;
    }, entryAction);
    if (!clicked) {
      throw new Error(`drawer action not clickable: ${entryAction}`);
    }
    await page.waitForSelector('#global-center-list', { state: 'attached' });
  }

  async function closeGlobalCenter() {
    const closeBtn = page.locator('#global-center-close');
    if (await closeBtn.count()) {
      await closeBtn.first().click({ force: true });
      await page.waitForTimeout(120);
    }
  }

  async function step(name, fn) {
    const entry = { name, startedAt: new Date().toISOString() };
    try {
      entry.data = await fn();
      entry.status = 'passed';
    } catch (error) {
      entry.status = 'failed';
      entry.error = String(error.stack || error.message || error);
      scenario.failures.push({ name, error: entry.error });
    }
    entry.finishedAt = new Date().toISOString();
    scenario.steps.push(entry);
    return entry;
  }

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#fab-add', { state: 'attached', timeout: 15000 });
    await page.evaluate((configuredStrategy) => {
      localStorage.setItem('rmm.v2.dedupePromotionStrategy', configuredStrategy);
    }, strategy);
    await screenshot('00-shell');

    await step('settings strategy switch', async () => {
      await page.evaluate(() => {
        document.querySelector('.nav-btn[data-nav="settings"]')?.click();
      });
      await page.waitForTimeout(180);
      const debug = await page.evaluate(() => {
        const control = document.querySelector('#settings-dedupe-strategy');
        const pane = document.querySelector('#pane-settings');
        const activeNav = [...document.querySelectorAll('.nav-btn')]
          .find((btn) => btn.classList.contains('text-purple-600'))
          ?.getAttribute('data-nav') || null;
        return {
          hasControl: Boolean(control),
          activeNav,
          paneHidden: pane?.classList.contains('hidden') ?? null,
          paneHtmlLen: pane?.innerHTML?.length ?? 0,
        };
      });
      if (!debug.hasControl) {
        throw new Error(`settings control not rendered: ${JSON.stringify(debug)}`);
      }
      await page.selectOption('#settings-dedupe-strategy', strategy);
      await page.waitForTimeout(120);
      const selected = await page.$eval('#settings-dedupe-strategy', (el) => el.value);
      if (selected !== strategy) {
        throw new Error(`settings strategy mismatch expected=${strategy} actual=${selected}`);
      }
      const currentHint = await page.$eval('#settings-dedupe-strategy-current', (el) => (el.textContent || '').trim());
      await screenshot('01-settings-strategy');
      await page.evaluate(() => {
        document.querySelector('.nav-btn[data-nav="ledger"]')?.click();
      });
      await page.waitForSelector('#fab-add', { state: 'attached' });
      return { selected, currentHint };
    });

    await step('global center entry convergence', async () => {
      await openGlobalCenter('openRowCorrelation');
      const rowMeta = await page.evaluate(() => {
        const active = document.querySelector('[data-global-view].bg-purple-600')?.getAttribute('data-global-view');
        const title = (document.querySelector('#global-center-list')?.parentElement?.parentElement?.querySelector('h2')?.textContent || '').trim();
        return { active, title };
      });
      if (rowMeta.active !== 'records') {
        throw new Error(`row entry default view should be records, got ${rowMeta.active}`);
      }
      await closeGlobalCenter();

      await openGlobalCenter('openVoucherCorrelation');
      const voucherMeta = await page.evaluate(() => {
        const active = document.querySelector('[data-global-view].bg-purple-600')?.getAttribute('data-global-view');
        return { active };
      });
      if (voucherMeta.active !== 'pending') {
        throw new Error(`voucher entry default view should be pending, got ${voucherMeta.active}`);
      }
      await screenshot('02-global-entry-converge');
      await closeGlobalCenter();
      return { rowMeta, voucherMeta };
    });

    await step('global center load more expansion', async () => {
      await openGlobalCenter('openRowCorrelation');
      const rowBefore = await readGlobalScope();
      const rowBeforeCount = await getGlobalEntryCount();
      if (!rowBefore.formal || !rowBefore.temp) {
        throw new Error(`cannot parse row scope: ${rowBefore.text}`);
      }
      if (rowBefore.formal.requested !== 2 || rowBefore.temp.requested !== 1) {
        throw new Error(`unexpected row base request scope: ${rowBefore.text}`);
      }

      await page.locator('[data-global-load-more="formal"]').first().click({ force: true });
      await page.waitForTimeout(150);
      const rowAfterFormal = await readGlobalScope();
      const rowAfterFormalCount = await getGlobalEntryCount();
      if (!rowAfterFormal.formal || rowAfterFormal.formal.requested <= rowBefore.formal.requested) {
        throw new Error(`formal load-more did not increase requested range: before=${rowBefore.text} after=${rowAfterFormal.text}`);
      }
      if (rowAfterFormalCount < rowBeforeCount) {
        throw new Error(`formal load-more should not reduce list count: before=${rowBeforeCount} after=${rowAfterFormalCount}`);
      }

      await page.locator('[data-global-load-more="temp"]').first().click({ force: true });
      await page.waitForTimeout(150);
      const rowAfterTemp = await readGlobalScope();
      const rowAfterTempCount = await getGlobalEntryCount();
      if (!rowAfterTemp.temp || rowAfterTemp.temp.requested <= rowAfterFormal.temp.requested) {
        throw new Error(`temp load-more did not increase requested range: before=${rowAfterFormal.text} after=${rowAfterTemp.text}`);
      }
      if (rowAfterTempCount < rowAfterFormalCount) {
        throw new Error(`temp load-more should not reduce list count: before=${rowAfterFormalCount} after=${rowAfterTempCount}`);
      }
      await closeGlobalCenter();

      await openGlobalCenter('openVoucherCorrelation');
      const pendingBefore = await readGlobalScope();
      const pendingBeforeCount = await getGlobalEntryCount();
      const modeNoteCursor = await page.$eval('#global-pending-mode-note', (el) => (el.textContent || '').trim());
      if (!pendingBefore.pendingLink || pendingBefore.pendingLink.requested !== 1) {
        throw new Error(`unexpected pending base request scope: ${pendingBefore.text}`);
      }
      if (!/mode cursor/i.test(modeNoteCursor)) {
        throw new Error(`pending cursor mode note missing: ${modeNoteCursor}`);
      }
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(150);
      const pendingAfter = await readGlobalScope();
      const pendingAfterCount = await getGlobalEntryCount();
      if (!pendingAfter.pendingLink || pendingAfter.pendingLink.requested <= pendingBefore.pendingLink.requested) {
        throw new Error(`pending load-more did not increase requested range: before=${pendingBefore.text} after=${pendingAfter.text}`);
      }
      if (pendingAfterCount < pendingBeforeCount) {
        throw new Error(`pending load-more should not reduce list count: before=${pendingBeforeCount} after=${pendingAfterCount}`);
      }

      await screenshot('03-global-load-more');
      await closeGlobalCenter();
      return {
        rowBeforeCount,
        rowAfterFormalCount,
        rowAfterTempCount,
        pendingBeforeCount,
        pendingAfterCount,
        modeNoteCursor,
        rowScopeBefore: rowBefore,
        rowScopeAfterTemp: rowAfterTemp,
        pendingScopeBefore: pendingBefore,
        pendingScopeAfter: pendingAfter,
      };
    });

    await step('global center pending cursor load-more states', async () => {
      await openGlobalCenterFresh('openVoucherCorrelation');
      await clickSelector('[data-global-view="pending"]');
      await page.fill('#global-center-search', '');
      await page.waitForTimeout(100);

      const pendingLoadBtn = page.locator('[data-global-load-more="pending"]').first();
      const stateTrace = [];
      let firstLoadingSeen = false;

      const loadingProbe = await page.evaluate(() => {
        const btn = document.querySelector('[data-global-load-more="pending"]');
        if (!btn) return null;
        btn.click();
        return {
          disabled: btn.hasAttribute('disabled'),
          loadState: btn.getAttribute('data-load-state') || null,
          stateText: (btn.querySelector('[data-loadmore-state-text]')?.textContent || '').trim(),
        };
      });
      stateTrace.push({ phase: 'loading-probe', ...(loadingProbe || {}) });
      firstLoadingSeen = Boolean(
        loadingProbe
        && loadingProbe.loadState === 'loading'
        && loadingProbe.disabled,
      );
      await page.waitForTimeout(130);

      for (let guard = 0; guard < 8; guard += 1) {
        const beforeMeta = await readLoadMoreMeta('pending');
        stateTrace.push({ phase: `before-${guard}`, ...beforeMeta });
        if (beforeMeta.loadMode !== 'cursor') {
          throw new Error(`cursor state expected loadMode=cursor, got ${JSON.stringify(beforeMeta)}`);
        }
        if (beforeMeta.loadState === 'no_more') break;

        await pendingLoadBtn.click({ force: true });
        await page.waitForTimeout(120);
      }

      const finalMeta = await readLoadMoreMeta('pending');
      const finalScope = await readGlobalScope();
      const finalCount = await getGlobalEntryCount();
      if (!firstLoadingSeen) {
        throw new Error(`cursor loading probe failed: ${JSON.stringify(loadingProbe)}`);
      }
      if (finalMeta.loadState !== 'no_more' || !finalMeta.disabled) {
        throw new Error(`cursor final state should be no_more + disabled, got ${JSON.stringify(finalMeta)}`);
      }
      if (!finalScope.pendingLink || finalScope.pendingLink.loaded !== 5 || finalScope.pendingLink.requested !== 5) {
        throw new Error(`cursor final scope mismatch: ${finalScope.text}`);
      }

      await page.evaluate(() => document.querySelector('[data-global-load-more="pending"]')?.click());
      await page.waitForTimeout(120);
      const afterNoMoreScope = await readGlobalScope();
      const afterNoMoreCount = await getGlobalEntryCount();
      const afterNoMoreMeta = await readLoadMoreMeta('pending');
      if (afterNoMoreScope.pendingLink?.requested !== finalScope.pendingLink?.requested || afterNoMoreCount !== finalCount) {
        throw new Error(`cursor no_more should not trigger extra load: before=${finalScope.text} after=${afterNoMoreScope.text}`);
      }
      if (afterNoMoreMeta.loadState !== 'no_more') {
        throw new Error(`cursor no_more state should persist after extra click, got ${JSON.stringify(afterNoMoreMeta)}`);
      }

      await screenshot('03c-global-pending-cursor-states');
      await closeGlobalCenter();
      return {
        firstLoadingSeen,
        finalMeta,
        finalScope,
        finalCount,
        afterNoMoreScope,
        afterNoMoreCount,
        stateTrace,
      };
    });

    await step('global center pending same-updatedAt cursor stability', async () => {
      await openGlobalCenterFresh('openVoucherCorrelation');
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(120);
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(120);
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(120);
      const orderA = await getGlobalEntryOrder();
      if (orderA.length !== 4) throw new Error(`pending same-updatedAt expected 4 entries, got ${orderA.length}`);
      if (orderA.indexOf('pending:voucher_page3') < 0 || orderA.indexOf('pending:voucher_page4') < 0) {
        throw new Error(`pending same-updatedAt ids missing: ${orderA.join(',')}`);
      }
      if (orderA.indexOf('pending:voucher_page3') > orderA.indexOf('pending:voucher_page4')) {
        throw new Error(`same updatedAt order unstable (expected page3 before page4): ${orderA.join(',')}`);
      }
      await screenshot('03a-global-pending-same-updatedAt');
      await closeGlobalCenter();

      await openGlobalCenterFresh('openVoucherCorrelation');
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(120);
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(120);
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(120);
      const orderB = await getGlobalEntryOrder();
      if (orderB.join('|') !== orderA.join('|')) {
        throw new Error(`pending same-updatedAt pagination order changed: a=${orderA.join(',')} b=${orderB.join(',')}`);
      }
      await closeGlobalCenter();
      return { orderA, orderB };
    });

    await step('pending cursor missing-updatedAt fixture', async () => {
      // Verifies that a voucher with updatedAt=null is included in pagination results
      // with no duplicates or skipped entries, regardless of cursor encoding behaviour.
      await openGlobalCenterFresh('openVoucherCorrelation');
      // Load every page until no_more.
      for (let guard = 0; guard < 10; guard += 1) {
        const meta = await readLoadMoreMeta('pending');
        if (meta.loadState === 'no_more') break;
        await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
        await page.waitForTimeout(130);
      }
      const finalOrder = await getGlobalEntryOrder();
      const uniqueIds = [...new Set(finalOrder.filter(Boolean))];
      if (uniqueIds.length !== finalOrder.length) {
        throw new Error(`missing-updatedAt: duplicate entry ids detected raw=${finalOrder.join(',')} unique=${uniqueIds.join(',')}`);
      }
      if (!finalOrder.includes('pending:voucher_no_updatedAt')) {
        throw new Error(`missing-updatedAt: voucher_no_updatedAt absent from final list, got ${finalOrder.join(',')}`);
      }
      if (uniqueIds.length !== 5) {
        throw new Error(`missing-updatedAt: expected 5 unique entries, got ${uniqueIds.length}: ${uniqueIds.join(',')}`);
      }
      const finalScope = await readGlobalScope();
      if (!finalScope.pendingLink || finalScope.pendingLink.loaded !== 5) {
        throw new Error(`missing-updatedAt: scope loaded mismatch, got ${finalScope.text}`);
      }
      await screenshot('03d-pending-cursor-no-updatedAt');
      await closeGlobalCenter();
      return { finalOrder, uniqueIds };
    });

    await step('global center session memory restore', async () => {
      await openGlobalCenter('openRowCorrelation');
      await clickSelector('[data-global-view="temp"]');
      await page.fill('#global-center-search', '奶茶');
      await page.waitForTimeout(120);
      await page.locator('[data-global-load-more="formal"]').first().click({ force: true });
      await page.waitForTimeout(140);
      const rowBefore = await readGlobalScope();
      const rowBeforeMeta = await page.evaluate(() => ({
        activeView: document.querySelector('[data-global-view].bg-purple-600')?.getAttribute('data-global-view') || null,
        search: document.querySelector('#global-center-search')?.value || '',
      }));
      await closeGlobalCenter();

      await openGlobalCenter('openRowCorrelation');
      const rowAfter = await readGlobalScope();
      const rowAfterMeta = await page.evaluate(() => ({
        activeView: document.querySelector('[data-global-view].bg-purple-600')?.getAttribute('data-global-view') || null,
        search: document.querySelector('#global-center-search')?.value || '',
      }));
      if (rowAfterMeta.activeView !== rowBeforeMeta.activeView) {
        throw new Error(`row session restore activeView mismatch before=${rowBeforeMeta.activeView} after=${rowAfterMeta.activeView}`);
      }
      if (rowAfterMeta.search !== rowBeforeMeta.search) {
        throw new Error(`row session restore search mismatch before=${rowBeforeMeta.search} after=${rowAfterMeta.search}`);
      }
      if ((rowAfter.formal?.requested || 0) !== (rowBefore.formal?.requested || 0)) {
        throw new Error(`row session restore formal scope mismatch before=${rowBefore.text} after=${rowAfter.text}`);
      }
      await closeGlobalCenter();

      await openGlobalCenter('openVoucherCorrelation');
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(140);
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(140);
      await page.$eval('#global-center-list', (el) => { el.scrollTop = 999; });
      const pendingBefore = await readGlobalScope();
      const pendingBeforeCount = await getGlobalEntryCount();
      const pendingBeforeOrder = await getGlobalEntryOrder();
      const pendingBeforeBtn = await readLoadMoreMeta('pending');
      const pendingBeforeMode = await page.$eval('#global-pending-mode-note', (el) => (el.textContent || '').trim());
      const pendingBeforeScroll = await page.$eval('#global-center-list', (el) => Number(el.scrollTop || 0));
      await closeGlobalCenter();

      await openGlobalCenter('openVoucherCorrelation');
      const pendingAfter = await readGlobalScope();
      const pendingAfterCount = await getGlobalEntryCount();
      const pendingAfterOrder = await getGlobalEntryOrder();
      const pendingAfterBtn = await readLoadMoreMeta('pending');
      const pendingAfterMode = await page.$eval('#global-pending-mode-note', (el) => (el.textContent || '').trim());
      const pendingAfterScroll = await page.$eval('#global-center-list', (el) => Number(el.scrollTop || 0));
      if (!pendingAfter.pendingLink || !pendingBefore.pendingLink) {
        throw new Error(`pending session restore parse failed before=${pendingBefore.text} after=${pendingAfter.text}`);
      }
      if (pendingAfter.pendingLink.mode !== pendingBefore.pendingLink.mode) {
        throw new Error(`pending session restore mode mismatch before=${pendingBefore.text} after=${pendingAfter.text}`);
      }
      if (pendingAfter.pendingLink.requested !== pendingBefore.pendingLink.requested) {
        throw new Error(`pending session restore requested mismatch before=${pendingBefore.text} after=${pendingAfter.text}`);
      }
      if (pendingAfterCount !== pendingBeforeCount) {
        throw new Error(`pending session restore count mismatch before=${pendingBeforeCount} after=${pendingAfterCount}`);
      }
      if (pendingAfterOrder.join('|') !== pendingBeforeOrder.join('|')) {
        throw new Error(`pending session restore order mismatch before=${pendingBeforeOrder.join(',')} after=${pendingAfterOrder.join(',')}`);
      }
      if ((pendingBeforeScroll > 0) && (pendingAfterScroll <= 0)) {
        throw new Error(`pending session restore scroll lost before=${pendingBeforeScroll} after=${pendingAfterScroll}`);
      }
      if (!/mode\s+(cursor|fallback-step)/i.test(pendingAfterMode) || !/mode\s+(cursor|fallback-step)/i.test(pendingBeforeMode)) {
        throw new Error(`pending mode note missing before=${pendingBeforeMode} after=${pendingAfterMode}`);
      }
      if (!/session-restored/i.test(pendingAfter.text)) {
        throw new Error(`pending session restore scope should mark session-restored, got ${pendingAfter.text}`);
      }
      if (pendingAfterBtn.loadState !== 'ready' || pendingAfterBtn.disabled) {
        throw new Error(`pending session restore (loadable) should keep ready state, got ${JSON.stringify(pendingAfterBtn)}`);
      }

      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(160);
      const pendingContinueCount = await getGlobalEntryCount();
      if (pendingContinueCount < pendingAfterCount) {
        throw new Error(`pending session restore continue-load should not decrease count before=${pendingAfterCount} after=${pendingContinueCount}`);
      }
      const rawEntryIds = await page.locator('#global-center-list [data-entry-id]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-entry-id')));
      const uniqueEntryIds = [...new Set(rawEntryIds.filter(Boolean))];
      if (uniqueEntryIds.length !== pendingContinueCount) {
        throw new Error(`pending session restore continue-load duplicated ids raw=${rawEntryIds.join(',')} unique=${uniqueEntryIds.join(',')}`);
      }
      const pendingNoMoreBtn = await readLoadMoreMeta('pending');
      if (pendingNoMoreBtn.loadState !== 'no_more' || !pendingNoMoreBtn.disabled) {
        throw new Error(`pending should become no_more at tail page, got ${JSON.stringify(pendingNoMoreBtn)}`);
      }
      const pendingNoMoreScope = await readGlobalScope();

      await closeGlobalCenter();
      await openGlobalCenter('openVoucherCorrelation');
      const pendingAfterNoMoreRestore = await readGlobalScope();
      const pendingAfterNoMoreBtn = await readLoadMoreMeta('pending');
      const pendingAfterNoMoreCount = await getGlobalEntryCount();
      if (pendingAfterNoMoreBtn.loadState !== 'no_more' || !pendingAfterNoMoreBtn.disabled) {
        throw new Error(`pending no_more restore should keep disabled no_more, got ${JSON.stringify(pendingAfterNoMoreBtn)}`);
      }
      if ((pendingAfterNoMoreRestore.pendingLink?.requested || 0) !== (pendingNoMoreScope.pendingLink?.requested || 0)) {
        throw new Error(`pending no_more restore scope mismatch before=${pendingNoMoreScope.text} after=${pendingAfterNoMoreRestore.text}`);
      }
      if (pendingAfterNoMoreCount !== pendingContinueCount) {
        throw new Error(`pending no_more restore count mismatch before=${pendingContinueCount} after=${pendingAfterNoMoreCount}`);
      }
      await page.evaluate(() => document.querySelector('[data-global-load-more="pending"]')?.click());
      await page.waitForTimeout(120);
      const pendingAfterNoMoreClickScope = await readGlobalScope();
      if ((pendingAfterNoMoreClickScope.pendingLink?.requested || 0) !== (pendingAfterNoMoreRestore.pendingLink?.requested || 0)) {
        throw new Error(`pending no_more restore extra click should not reload: before=${pendingAfterNoMoreRestore.text} after=${pendingAfterNoMoreClickScope.text}`);
      }

      await screenshot('03c-global-session-memory');
      await closeGlobalCenter();
      return {
        rowBeforeMeta,
        rowAfterMeta,
        rowScopeBefore: rowBefore,
        rowScopeAfter: rowAfter,
        pendingBefore,
        pendingAfter,
        pendingBeforeCount,
        pendingAfterCount,
        pendingBeforeBtn,
        pendingAfterBtn,
        pendingContinueCount,
        pendingNoMoreBtn,
        pendingNoMoreScope,
        pendingAfterNoMoreBtn,
        pendingAfterNoMoreRestore,
        pendingAfterNoMoreCount,
        pendingBeforeScroll,
        pendingAfterScroll,
      };
    });

    await step('global center pending fallback-step mode', async () => {
      await page.evaluate(() => {
        window.__ENV__ = { ...(window.__ENV__ || {}), GLOBAL_CENTER_FORCE_PENDING_FALLBACK_STEP: true };
      });
      try {
        await openGlobalCenterFresh('openVoucherCorrelation');
        const beforeScope = await readGlobalScope();
        const beforeModeNote = await page.$eval('#global-pending-mode-note', (el) => (el.textContent || '').trim());
        if (!beforeScope.pendingLink || beforeScope.pendingLink.mode !== 'fallback-step') {
          throw new Error(`pending fallback mode expected fallback-step, got ${beforeScope.text}`);
        }
        if (!/fallback-step/i.test(beforeModeNote) || !/已降级|cursor/i.test(beforeModeNote)) {
          throw new Error(`fallback-step mode note not diagnostic enough: ${beforeModeNote}`);
        }
        const stateTrace = [];
        for (let guard = 0; guard < 8; guard += 1) {
          const beforeMeta = await readLoadMoreMeta('pending');
          stateTrace.push({ phase: `before-${guard}`, ...beforeMeta });
          if (beforeMeta.loadMode !== 'fallback-step') {
            throw new Error(`fallback-step loadMode expected fallback-step, got ${JSON.stringify(beforeMeta)}`);
          }
          if (beforeMeta.loadState === 'no_more') break;
          await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
          await page.waitForTimeout(130);
        }

        const afterScope = await readGlobalScope();
        const afterCount = await getGlobalEntryCount();
        const afterMeta = await readLoadMoreMeta('pending');
        if (!afterScope.pendingLink || afterScope.pendingLink.mode !== 'fallback-step') {
          throw new Error(`pending fallback mode should persist fallback-step, got ${afterScope.text}`);
        }
        if (afterMeta.loadState !== 'no_more' || !afterMeta.disabled) {
          throw new Error(`fallback-step tail page should become no_more+disabled, got ${JSON.stringify(afterMeta)}`);
        }
        await page.evaluate(() => document.querySelector('[data-global-load-more="pending"]')?.click());
        await page.waitForTimeout(120);
        const afterExtraScope = await readGlobalScope();
        const afterExtraCount = await getGlobalEntryCount();
        if ((afterExtraScope.pendingLink?.requested || 0) !== (afterScope.pendingLink?.requested || 0) || afterExtraCount !== afterCount) {
          throw new Error(`fallback-step no_more should block extra requests: before=${afterScope.text} after=${afterExtraScope.text}`);
        }
        await screenshot('03b-global-pending-fallback-step');

        // ── session restore sub-check ─────────────────────────────────────────
        // At this point FORCE flag = true and we're at no_more state.
        // Save session by closing, then turn force OFF so the next open honours the
        // restored session's `initialized: true` and restores mode = fallback-step.
        const afterOrder = await getGlobalEntryOrder();
        await closeGlobalCenter();
        await page.evaluate(() => {
          window.__ENV__ = { ...(window.__ENV__ || {}), GLOBAL_CENTER_FORCE_PENDING_FALLBACK_STEP: false };
        });
        await openGlobalCenter('openVoucherCorrelation');
        const restoreScope = await readGlobalScope();
        const restoreCount = await getGlobalEntryCount();
        const restoreOrder = await getGlobalEntryOrder();
        const restoreModeNote = await page.$eval('#global-pending-mode-note', (el) => (el.textContent || '').trim());
        const restoreBtn = await readLoadMoreMeta('pending');
        if (!restoreScope.pendingLink || restoreScope.pendingLink.mode !== 'fallback-step') {
          throw new Error(`fallback-step session restore: mode lost after reopen, got ${restoreScope.text}`);
        }
        if (restoreScope.pendingLink.requested !== afterScope.pendingLink.requested) {
          throw new Error(`fallback-step session restore: scope mismatch before=${afterScope.text} after=${restoreScope.text}`);
        }
        if (restoreCount !== afterCount) {
          throw new Error(`fallback-step session restore: count mismatch before=${afterCount} after=${restoreCount}`);
        }
        if (restoreOrder.join('|') !== afterOrder.join('|')) {
          throw new Error(`fallback-step session restore: order changed before=${afterOrder.join(',')} after=${restoreOrder.join(',')}`);
        }
        if (!/fallback-step/i.test(restoreModeNote)) {
          throw new Error(`fallback-step session restore: mode note lost, got ${restoreModeNote}`);
        }
        if (restoreBtn.loadState !== 'no_more' || !restoreBtn.disabled) {
          throw new Error(`fallback-step session restore: no_more state lost, got ${JSON.stringify(restoreBtn)}`);
        }
        await screenshot('03b-global-pending-fallback-step-session-restore');
        await closeGlobalCenter();
        // ── END session restore sub-check ─────────────────────────────────────

        return { beforeScope, afterScope, afterExtraScope, beforeModeNote, afterMeta, afterCount, afterExtraCount, stateTrace, afterOrder, restoreScope, restoreCount, restoreModeNote, restoreBtn };
      } finally {
        await page.evaluate(() => {
          window.__ENV__ = { ...(window.__ENV__ || {}), GLOBAL_CENTER_FORCE_PENDING_FALLBACK_STEP: false };
        });
      }
    });

    await step('global center search and quick actions', async () => {
      await openGlobalCenter('openRowCorrelation');
      const scopeInfo = await readGlobalScope();
      if (!scopeInfo.formal || !scopeInfo.temp || !scopeInfo.pendingLink) {
        throw new Error(`scope hint parse failed: ${scopeInfo.text}`);
      }
      const scopeHint = scopeInfo.text;
      await page.fill('#global-center-search', '奶茶');
      await page.waitForTimeout(150);
      const rowHitCount = await getGlobalEntryCount();
      if (rowHitCount < 1) throw new Error('global center search should return rows for 奶茶');
      const rowHitReasonText = await page.$eval('#global-center-list [data-hit-reasons]', (el) => (el.getAttribute('data-hit-reasons') || '').trim());
      const rowHitTagCount = await page.locator('#global-center-list [data-hit-tag]').count();
      if (!rowHitReasonText || rowHitTagCount < 1) {
        throw new Error(`global center hit explanation missing: reasons=${rowHitReasonText} tags=${rowHitTagCount}`);
      }

      await page.fill('#global-center-search', 'no-hit-keyword-xyz');
      await page.waitForTimeout(120);
      const noHitCount = await getGlobalEntryCount();
      const noHitText = await page.$eval('#global-center-list', (el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
      const noHitModeNote = await page.$eval('#global-pending-mode-note', (el) => (el.textContent || '').trim());
      if (noHitCount !== 0) {
        throw new Error(`global center no-hit search should return 0, got ${noHitCount}`);
      }
      if (!/没有命中结果/.test(noHitText) || !/清空关键词/.test(noHitText)) {
        throw new Error(`global center no-hit hint should guide clear keyword, got: ${noHitText}`);
      }
      if (!/mode\s+(cursor|fallback-step)/i.test(noHitModeNote)) {
        throw new Error(`global center no-hit should keep mode note, got: ${noHitModeNote}`);
      }
      await page.fill('#global-center-search', '奶茶');
      await page.waitForTimeout(120);

      await page.locator('#global-center-list [data-global-action="detail"]').first().click({ force: true });
      await page.waitForSelector('#tx-detail-panel', { state: 'attached' });
      await page.evaluate(() => {
        const panel = document.getElementById('tx-detail-panel');
        const panelOverlay = panel ? panel.closest('.absolute.inset-0') : null;
        if (panelOverlay) panelOverlay.remove();
      });

      await page.locator('[data-global-load-more="temp"]').first().click({ force: true });
      await page.waitForTimeout(120);
      await page.fill('#global-center-search', 'temp_review');
      await page.waitForTimeout(120);
      await page.locator('#global-center-list [data-global-action="promote"]').first().click({ force: true });
      await page.waitForSelector('#promote-review-continue', { state: 'attached' });
      await clickSelector('#promote-review-close');
      await closeGlobalCenter();

      await openGlobalCenter('openVoucherCorrelation');
      await page.fill('#global-center-search', 'taxi-001.jpg');
      await page.waitForTimeout(150);
      const pendingHitCount = await getGlobalEntryCount();
      if (pendingHitCount !== 1) throw new Error(`pending search expected 1 hit, got ${pendingHitCount}`);
      const voucherHitTagCount = await page.locator('#global-center-list [data-hit-tag="voucher"]').count();
      if (voucherHitTagCount < 1) throw new Error('pending search should expose voucher hit tag');

      await page.locator('#global-center-list [data-global-action="relink"]').first().click({ force: true });
      await page.waitForSelector('#relink-list [data-relink-target]', { state: 'attached' });
      await clickSelector('#relink-close');

      const doneActionCount = await page.locator('#global-center-list [data-global-action="done"]').count();
      await screenshot('03-global-search-actions');
      if (doneActionCount < 1) throw new Error('pending entry should expose done action');

      await closeGlobalCenter();
      return {
        rowHitCount,
        noHitCount,
        noHitText,
        noHitModeNote,
        pendingHitCount,
        doneActionCount,
        scopeHint,
        rowHitReasonText,
        rowHitTagCount,
        voucherHitTagCount,
      };
    });

    await step('global center pending cursor after relink and continue load', async () => {
      await openGlobalCenterFresh('openVoucherCorrelation');
      await clickSelector('[data-global-view="pending"]');
      await page.fill('#global-center-search', '');
      await page.waitForTimeout(120);
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(140);
      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(140);
      const loaded3Count = await getGlobalEntryCount();
      if (loaded3Count !== 3) throw new Error(`pending expected 3 after loading 3 pages, got ${loaded3Count}`);

      await page.fill('#global-center-search', 'office-003.jpg');
      await page.waitForTimeout(120);
      const relinkTargetCount = await getGlobalEntryCount();
      if (relinkTargetCount !== 1) throw new Error(`office-003 should match exactly 1 pending row, got ${relinkTargetCount}`);

      await page.locator('#global-center-list [data-global-action="relink"]').first().click({ force: true });
      await page.waitForSelector('#relink-list [data-relink-target]', { state: 'attached' });
      await page.locator('#relink-list [data-relink-target]').first().click({ force: true });
      await page.waitForTimeout(260);

      await page.fill('#global-center-search', '');
      await page.waitForTimeout(140);
      const afterRelinkCount = await getGlobalEntryCount();
      if (afterRelinkCount !== 2) throw new Error(`pending should shrink to 2 after relink remove, got ${afterRelinkCount}`);

      await page.locator('[data-global-load-more="pending"]').first().click({ force: true });
      await page.waitForTimeout(160);
      const afterContinueCount = await getGlobalEntryCount();
      if (afterContinueCount !== 3) throw new Error(`pending should return to 3 after continue load, got ${afterContinueCount}`);

      const rawEntryIds = await page.locator('#global-center-list [data-entry-id]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-entry-id')));
      const uniqueEntryIds = [...new Set(rawEntryIds.filter(Boolean))];
      const uniqueCount = uniqueEntryIds.length;
      if (uniqueCount !== afterContinueCount) {
        throw new Error(`pending cursor append should not duplicate ids: raw=${rawEntryIds.join(',')} unique=${uniqueEntryIds.join(',')}`);
      }
      const scopeInfo = await readGlobalScope();
      await screenshot('04-global-pending-cursor-relink');
      await closeGlobalCenter();
      return { loaded3Count, afterRelinkCount, afterContinueCount, uniqueCount, scopeInfo, entryIds: uniqueEntryIds };
    });

    await step('difficulty-center filters', async () => {
      await openDifficultyCenter();
      const allCount = await getEntryCount();
      await clickSelector('[data-difficulty-filter="matching"]');
      const matchingCount = await getEntryCount();
      await clickSelector('[data-difficulty-filter="dedupe"]');
      const dedupeCount = await getEntryCount();
      await clickSelector('[data-difficulty-filter="temp"]');
      const tempCount = await getEntryCount();
      await screenshot('04-filters');
      if (allCount !== 4 || matchingCount !== 2 || dedupeCount !== 1 || tempCount !== 1) {
        throw new Error(`unexpected filter counts all=${allCount} matching=${matchingCount} dedupe=${dedupeCount} temp=${tempCount}`);
      }
      return { allCount, matchingCount, dedupeCount, tempCount };
    });

    await step('search and filter linkage', async () => {
      await clickSelector('[data-difficulty-filter="all"]');
      await page.fill('#difficulty-search', 'taxi-001.jpg');
      await page.waitForTimeout(120);
      const searchAllCount = await getEntryCount();
      await clickSelector('[data-difficulty-filter="matching"]');
      const searchMatchingCount = await getEntryCount();
      await screenshot('05-search-linkage');
      if (searchAllCount !== 1 || searchMatchingCount !== 1) {
        throw new Error(`search linkage mismatch all=${searchAllCount} matching=${searchMatchingCount}`);
      }
      await page.fill('#difficulty-search', '');
      await page.waitForTimeout(120);
      const matchingAfterClear = await getEntryCount();
      if (matchingAfterClear !== 2) {
        throw new Error(`clear search mismatch matching=${matchingAfterClear}`);
      }
      return { searchAllCount, searchMatchingCount, matchingAfterClear };
    });

    await step('mark done hides matching item', async () => {
      await clickSelector('[data-difficulty-filter="matching"]');
      const secondCard = page.locator('#difficulty-list > div').nth(1);
      await secondCard.locator('[data-difficulty-action="done"]').click({ force: true });
      await page.waitForTimeout(200);
      const matchingCount = await getEntryCount();
      await screenshot('06-matching-done');
      if (matchingCount !== 1) throw new Error(`matching count expected 1 after done, got ${matchingCount}`);
      return { matchingCount };
    });

    await step('pending_link relink chain', async () => {
      const firstCard = page.locator('#difficulty-list > div').nth(0);
      await firstCard.locator('[data-difficulty-action="relink"]').click({ force: true });
      await page.waitForSelector('#relink-list [data-relink-target]', { state: 'attached' });
      await screenshot('07-relink-picker');
      await page.locator('#relink-list [data-relink-target]').first().click({ force: true });
      await page.waitForTimeout(260);
      const matchingCount = await getEntryCount();
      if (matchingCount !== 0) throw new Error(`matching should be 0 after relink, got ${matchingCount}`);
      return { matchingCount };
    });

    await step('dedupe actions and detail jump', async () => {
      await clickSelector('[data-difficulty-filter="dedupe"]');
      const dedupeCount = await getEntryCount();
      if (dedupeCount !== 1) throw new Error(`dedupe count expected 1 before operations, got ${dedupeCount}`);

      const dedupeCard = page.locator('#difficulty-list > div').first();
      await dedupeCard.locator('[data-difficulty-action="detail"]').click({ force: true });
      await page.waitForSelector('#dedupe-open-left', { state: 'attached' });
      await clickSelector('#dedupe-open-left');
      await page.waitForSelector('#tx-detail-panel', { state: 'attached' });
      await screenshot('08-dedupe-open-left');

      await page.evaluate(() => {
        const panel = document.getElementById('tx-detail-panel');
        const panelOverlay = panel ? panel.closest('.absolute.inset-0') : null;
        if (panelOverlay) panelOverlay.remove();
      });
      await clickSelector('#dedupe-detail-close');
      await page.waitForTimeout(120);

      await dedupeCard.locator('[data-difficulty-action="done"]').click({ force: true });
      await page.waitForSelector('#dedupe-done-reason', { state: 'attached' });
      await page.selectOption('#dedupe-done-reason', 'manual_keep_both');
      await clickSelector('#dedupe-done-confirm');
      await page.waitForTimeout(220);
      const dedupeAfterDone = await getEntryCount();
      await screenshot('09-dedupe-done');
      if (dedupeAfterDone !== 0) throw new Error(`dedupe should be 0 after done, got ${dedupeAfterDone}`);
      return { dedupeCount, dedupeAfterDone };
    });

    await step('temp to formal duplicate warning flow', async () => {
      await clickSelector('[data-difficulty-filter="temp"]');
      const tempBefore = await getEntryCount();
      if (tempBefore !== 1) throw new Error(`temp expected 1 before promote, got ${tempBefore}`);
      await page.locator('#difficulty-list > div').first().locator('[data-difficulty-action="promote"]').click({ force: true });
      await page.waitForSelector('#promote-review-continue', { state: 'attached' });
      await screenshot('10-promote-warning');
      await clickSelector('#promote-review-continue');
      await page.waitForTimeout(300);
      const tempAfter = await getEntryCount();
      if (tempAfter !== 0) throw new Error(`temp expected 0 after promote, got ${tempAfter}`);
      return { tempBefore, tempAfter };
    });

    await step('strategy final behavior', async () => {
      await clickSelector('[data-difficulty-filter="all"]');
      const allCount = await getEntryCount();
      await clickSelector('[data-difficulty-filter="dedupe"]');
      const dedupeCount = await getEntryCount();
      await screenshot('11-final-state');

      if (strategy === 'strict') {
        if (allCount !== 1 || dedupeCount !== 1) {
          throw new Error(`strict expects remaining dedupe 1, got all=${allCount} dedupe=${dedupeCount}`);
        }
      } else {
        if (allCount !== 0 || dedupeCount !== 0) {
          throw new Error(`manual_resolve expects no remaining dedupe, got all=${allCount} dedupe=${dedupeCount}`);
        }
      }
      return { allCount, dedupeCount };
    });
  } finally {
    scenario.finishedAt = new Date().toISOString();
    await context.close().catch(() => {});
  }
}

(async () => {
  const report = {
    startedAt: new Date().toISOString(),
    baseUrl: null,
    scenarios: [],
    failures: [],
  };

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/`;
  report.baseUrl = baseUrl;

  const browser = await launchBrowser();

  try {
    await runScenario(browser, baseUrl, 'strict', report);
    await runScenario(browser, baseUrl, 'manual_resolve', report);
  } finally {
    report.finishedAt = new Date().toISOString();
    report.failures = report.scenarios.flatMap((scenario) =>
      scenario.failures.map((item) => ({ strategy: scenario.strategy, ...item })),
    );
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }

  if (report.failures.length) {
    console.error(JSON.stringify({ ok: false, failures: report.failures, reportPath }, null, 2));
    process.exit(1);
  }

  const screenshots = report.scenarios.flatMap((scenario) => scenario.screenshots);
  console.log(JSON.stringify({ ok: true, reportPath, screenshots }, null, 2));
})();
