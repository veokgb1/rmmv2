// v2-app/js/api-bridge.js
// 职责：统管所有网络交互（Worker、Firestore、双写容错）
// 依赖：js/core-config.js
// 导出：submitTransaction, updateTransaction, fetchLedger, deleteTransaction,
//        geminiOCR, geminiNLP, uploadVoucher, fetchShadowLogs,
//        loginUser, logoutUser, onAuthChange

import {
  APP_CONFIG,
  initFirebase,
  getFirebaseApp,
} from "./core-config.js";

// ── Firestore 动态导入缓存 ────────────────────────────
let _fsModules = null;
async function fsModules() {
  if (_fsModules) return _fsModules;
  const m = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  _fsModules = m;
  return m;
}

// ── Auth 动态导入缓存 ──────────────────────────────────
let _authModules = null;
async function authModules() {
  if (_authModules) return _authModules;
  const m = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
  _authModules = m;
  return m;
}

// ── 内部 Token 缓存 ───────────────────────────────────
let _cachedToken    = null;
let _tokenExpiresAt = 0;
const ROUTE_CACHE_KEY = "rmm_v2_worker_route";
const ROUTE_CACHE_VER = 1;
let _routeState = {
  channel: "auto",
  baseUrl: "",
  source: "init",
  healthy: null,
  updatedAt: 0,
};

async function getIdToken(forceRefresh = false) {
  const { auth } = getFirebaseApp();
  if (!auth?.currentUser) throw new Error("用户未登录");
  if (!forceRefresh && _cachedToken && Date.now() < _tokenExpiresAt) {
    return _cachedToken;
  }
  _cachedToken    = await auth.currentUser.getIdToken(true);
  _tokenExpiresAt = Date.now() + 55 * 60 * 1000; // 55 分钟，比 JWT 1小时略短
  return _cachedToken;
}

// ── Worker 请求封装 ───────────────────────────────────

/**
 * 向 Cloudflare Worker 发送 POST 请求
 * @param {string} action
 * @param {object} payload
 * @returns {Promise<object>}
 */
function normalizeBase(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function isPublicWebHost() {
  if (typeof window === "undefined") return false;
  const host = String(window.location.hostname || "").toLowerCase();
  if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return false;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
  return true;
}

function getProbeTimeoutMs() {
  const configured = Number(APP_CONFIG.WORKER_PROBE_TIMEOUT_MS || 1800);
  if (!isPublicWebHost()) return configured;
  return Math.min(configured, 900);
}

function routeCandidates() {
  const internal = normalizeBase(APP_CONFIG.WORKER_URL_INTERNAL);
  const external = normalizeBase(APP_CONFIG.WORKER_URL_EXTERNAL);
  const candidates = [];
  if (internal) candidates.push({ channel: "internal", baseUrl: internal });
  if (external && external !== internal) candidates.push({ channel: "external", baseUrl: external });
  if (!candidates.length) candidates.push({ channel: "single", baseUrl: normalizeBase(APP_CONFIG.WORKER_URL) });
  if (isPublicWebHost() && candidates.length > 1) {
    candidates.sort((a, b) => {
      if (a.channel === "external" && b.channel !== "external") return -1;
      if (b.channel === "external" && a.channel !== "external") return 1;
      return 0;
    });
  }
  return candidates.filter((c) => !!c.baseUrl);
}

function emitRouteState(partial) {
  _routeState = { ..._routeState, ...partial, updatedAt: Date.now() };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("rmm:network-route", { detail: { ..._routeState } }));
  }
}

function readRouteCache() {
  try {
    const raw = localStorage.getItem(ROUTE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.ver !== ROUTE_CACHE_VER) return null;
    if (!parsed?.baseUrl || !parsed?.channel || !parsed?.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveRouteCache(route) {
  try {
    localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify({
      ver: ROUTE_CACHE_VER,
      channel: route.channel,
      baseUrl: route.baseUrl,
      expiresAt: Date.now() + APP_CONFIG.WORKER_ROUTE_CACHE_TTL_MS,
    }));
  } catch {}
}

function pingUrl(baseUrl) {
  const p = APP_CONFIG.WORKER_PING_PATH || "/ping";
  return `${baseUrl}${p.startsWith("/") ? p : `/${p}`}`;
}

async function probeRoute(route) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), getProbeTimeoutMs());
  try {
    const resp = await fetch(`${pingUrl(route.baseUrl)}?_=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function getNetworkRouteState() {
  return { ..._routeState };
}

export function __debugResetNetworkRoute() {
  _routeState = {
    channel: "auto",
    baseUrl: "",
    source: "init",
    healthy: null,
    updatedAt: 0,
  };
  try { localStorage.removeItem(ROUTE_CACHE_KEY); } catch {}
}

export async function resolveWorkerRoute({ forceProbe = false } = {}) {
  const candidates = routeCandidates();
  if (!candidates.length) throw new ApiError("Worker URL not configured", 500);

  if (candidates.length === 1) {
    emitRouteState({ ...candidates[0], source: "single", healthy: true });
    return candidates[0];
  }

  const cache = readRouteCache();
  if (!forceProbe && cache && cache.expiresAt > Date.now()) {
    const hit = candidates.find((c) => c.baseUrl === normalizeBase(cache.baseUrl));
    if (hit) {
      emitRouteState({ ...hit, source: "cache", healthy: true });
      return hit;
    }
  }

  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await probeRoute(c)) {
      saveRouteCache(c);
      emitRouteState({ ...c, source: "probe", healthy: true });
      return c;
    }
  }

  if (cache) {
    const stale = candidates.find((c) => c.baseUrl === normalizeBase(cache.baseUrl));
    if (stale) {
      emitRouteState({ ...stale, source: "fallback", healthy: false });
      return stale;
    }
  }

  emitRouteState({ ...candidates[0], source: "fallback", healthy: false });
  return candidates[0];
}

async function postWorker(baseUrl, token, action, payload = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), APP_CONFIG.REQUEST_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(baseUrl, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body:   JSON.stringify({ action, ...payload }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const data = await resp.json();
  if (!data.ok) throw new ApiError(data.error || "Worker returned error", resp.status);
  return data;
}

async function workerPost(action, payload = {}) {
  const token = await getIdToken();
  try {
    const route = await resolveWorkerRoute();
    return await postWorker(route.baseUrl, token, action, payload);
  } catch (err) {
    const retryable =
      err?.name === "AbortError" ||
      err instanceof TypeError ||
      (err instanceof ApiError && err.status >= 500);
    if (!retryable) throw err;

    const current = getNetworkRouteState();
    const alt = routeCandidates().find((c) => c.baseUrl !== normalizeBase(current.baseUrl));
    if (!alt) throw err;

    saveRouteCache(alt);
    emitRouteState({ ...alt, source: "fallback", healthy: true });
    return await postWorker(alt.baseUrl, token, action, payload);
  }
}

// ── 核心业务：提交账目（含双写容错，铁律二核心）────────

/**
 * 提交新账目到 Firestore（主链路）
 * 主链路成功后，异步影子写到 V1 GAS（非阻塞）
 *
 * @param {object} txData - 账目数据
 * @returns {Promise<{ id: string }>} Firestore 文档 ID
 */
export async function submitTransaction(txData) {
  const { db } = getFirebaseApp();
  const { collection, addDoc, serverTimestamp } = await fsModules();
  const timestamps = {
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    reviewedAt: serverTimestamp(),
  };

  const docRef = await addDoc(
    collection(db, "transactions"),
    buildTransactionWritePayload(txData, timestamps),
  );

  if (APP_CONFIG.SHADOW_WRITE_ENABLED && APP_CONFIG.GAS_V1_URL) {
    shadowWriteToGas(txData, docRef.id).catch(() => {
      // silent fallback by design
    });
  }

  return { id: docRef.id };
}

/**
 * 影子写：将新账目异步 POST 给 V1 GAS 接口，并上报日志
 * 此函数永远不抛出，永远不阻塞调用方
 *
 * @param {object} txData
 * @param {string} firestoreId
 */
async function shadowWriteToGas(txData, firestoreId) {
  const t0         = Date.now();
  let   gasStatus  = "ok";
  let   errorMsg   = null;

  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), APP_CONFIG.SHADOW_TIMEOUT_MS);

    try {
      const resp = await fetch(APP_CONFIG.GAS_V1_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          action: "append_rows",
          rows:   [txDataToGasRow(txData)],
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok) gasStatus = "error";
    } catch (fetchErr) {
      gasStatus = fetchErr.name === "AbortError" ? "timeout" : "error";
      errorMsg  = fetchErr.message;
    } finally {
      clearTimeout(timer);
    }
  } catch (outerErr) {
    gasStatus = "error";
    errorMsg  = outerErr.message;
  }

  const gasMs = Date.now() - t0;

  // 上报日志到 Worker → Firestore shadow_logs（同样非阻塞）
  try {
    const token = await getIdToken().catch(() => "");
    if (token) {
      const route = await resolveWorkerRoute().catch(() => ({ baseUrl: APP_CONFIG.WORKER_URL }));
      await fetch(route.baseUrl, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          action:    "shadow_write_log",
          txId:      firestoreId,
          gasStatus,
          gasMs,
          error:     errorMsg,
        }),
      });
    }
  } catch {
    // 日志上报失败也静默处理，不让它影响任何用户操作
  }
}

/**
 * 将 V2 账目对象转换为 V1 GAS append_rows 格式（9列）
 */
function txDataToGasRow(txData) {
  const dateStr = normalizeDateStr(txData.date);
  return [
    dateStr,
    dateStr.slice(0, 7),          // YYYY-MM
    txData.type     || "支出",
    txData.category || "未分类",
    txData.amount   || 0,
    txData.summary  || "",
    "V2双写备份",
    "",                           // 凭证列（V1不处理 Storage 路径）
    txData.status   || "未关联",
  ];
}

// ── 读取账目列表 ──────────────────────────────────────

/**
 * 从 Firestore 读取账目列表
 * @param {{ month?: string, limit?: number, startAfter?: object }} options
 * @returns {Promise<object[]>}
 */
export async function fetchLedger({ month, limit = 100, startAfterDoc } = {}) {
  const { db } = getFirebaseApp();
  const {
    collection, query, where, orderBy,
    limit: fsLimit, startAfter, getDocs,
  } = await fsModules();

  const constraints = [
    orderBy("date", "desc"),
    fsLimit(limit),
  ];
  if (month) constraints.push(where("month", "==", month));
  if (startAfterDoc) constraints.push(startAfter(startAfterDoc));

  const q = query(collection(db, "transactions"), ...constraints);
  const snap = await getDocs(q);

  return snap.docs.map((docSnap) => normalizeTransactionRecord(docSnap.data(), {
    id: docSnap.id,
    snap: docSnap,
  }));
}

/**
 * 更新账目字段
 * @param {string} txId
 * @param {object} updates
 */
export async function updateTransaction(txId, updates) {
  const { db } = getFirebaseApp();
  const { doc, updateDoc, serverTimestamp } = await fsModules();
  await updateDoc(
    doc(db, "transactions", txId),
    buildTransactionUpdatePayload(updates, {
      updatedAt: serverTimestamp(),
      reviewedAt: serverTimestamp(),
    }),
  );
}

/**
 * 删除账目（软删除：标记 _deleted: true）
 * @param {string} txId
 */
export async function deleteTransaction(txId) {
  await updateTransaction(txId, {
    _deleted: true,
    status: "\u5df2\u5220\u9664",
    lifecycleState: "deleted",
    decisionSource: "manual",
    pendingReason: null,
    decisionNote: buildDecisionTrailEntry("manual delete record"),
  });
}

/**
 * 解绑账目中的指定凭证（arrayRemove 原子操作）
 * @param {string}   txId
 * @param {string[]} pathsToRemove - Storage 路径数组
 */
export async function unbindVouchers(txId, pathsToRemove, options = {}) {
  const { db } = getFirebaseApp();
  const { doc, getDoc, updateDoc, serverTimestamp } = await fsModules();
  const txRef = doc(db, "transactions", txId);
  const txSnap = await getDoc(txRef);
  if (!txSnap.exists()) throw new ApiError("Transaction not found", 404);

  const current = normalizeTransactionRecord(txSnap.data(), {
    id: txSnap.id,
    snap: txSnap,
  });
  const removeSet = new Set(
    (Array.isArray(pathsToRemove) ? pathsToRemove : [])
      .map((pathValue) => String(pathValue || "").trim())
      .filter(Boolean),
  );

  if (!removeSet.size) {
    return { remainingPaths: current.voucherStoragePaths || [], updatedVoucherDocs: 0 };
  }

  const nextVoucherPaths = (current.voucherStoragePaths || []).filter(
    (pathValue) => !removeSet.has(String(pathValue)),
  );
  const removedPaths = (current.voucherStoragePaths || []).filter(
    (pathValue) => removeSet.has(String(pathValue)),
  );
  const noteEntry = buildDecisionTrailEntry(
    options.decisionNote || ('manual unbind ' + removedPaths.length + ' vouchers'),
  );

  await updateDoc(txRef, {
    voucherPaths: nextVoucherPaths,
    voucherStoragePaths: nextVoucherPaths,
    status: nextVoucherPaths.length ? current.status : "\u5f85\u7eed\u5173\u8054",
    lifecycleState: nextVoucherPaths.length ? "active" : "pending_link",
    pendingReason: nextVoucherPaths.length ? null : (options.pendingReason || "manual_unbind"),
    decisionSource: options.decisionSource || "manual",
    decisionNote: appendDecisionTrail(current.decisionNote, noteEntry),
    lastReviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const updatedVoucherDocs = await markVouchersPendingByStoragePaths(removedPaths, {
    txId,
    legacyRowNum: current._legacyRowNum ?? null,
    pendingReason: options.pendingReason || "manual_unbind",
    decisionSource: options.decisionSource || "manual",
    decisionNote: noteEntry,
  });

  return {
    remainingPaths: nextVoucherPaths,
    removedPaths,
    updatedVoucherDocs,
  };
}

// ── AI 功能（通过 Worker 代理，Key 不暴露）────────────

/**
 * OCR：识别图片内容
 * @param {{ base64: string, mime: string }} params
 * @returns {Promise<object>} AI 识别结果
 */
export async function fetchPendingVouchers({
  limit = 100,
  pageSize,
  cursor = null,
  returnMeta = false,
} = {}) {
  const wantsCursorMeta = Boolean(returnMeta || cursor || pageSize);
  const resolvedPageSize = clampPendingPageSize(pageSize ?? limit);
  if (!wantsCursorMeta) {
    return fetchPendingVouchersLegacyList({ limit: resolvedPageSize });
  }

  const { db } = getFirebaseApp();
  try {
    const {
      collection, query, where, orderBy,
      limit: fsLimit, startAfter, getDocs,
      documentId, Timestamp,
    } = await fsModules();
    const constraints = [
      where("lifecycleState", "==", "pending_link"),
      // stable order: updatedAt desc + document id asc
      orderBy("updatedAt", "desc"),
      orderBy(documentId(), "asc"),
      fsLimit(resolvedPageSize + 1),
    ];
    const parsedCursor = normalizePendingVoucherCursor(cursor);
    if (parsedCursor) {
      const cursorTs = Timestamp?.fromMillis
        ? Timestamp.fromMillis(parsedCursor.updatedAtMs)
        : new Date(parsedCursor.updatedAtMs);
      constraints.push(startAfter(cursorTs, parsedCursor.id));
    }

    const snap = await getDocs(query(collection(db, "vouchers"), ...constraints));
    const docs = snap.docs || [];
    const pageDocs = docs.slice(0, resolvedPageSize);
    const list = pageDocs.map((docSnap) => normalizePendingVoucher(docSnap.data(), docSnap.id));
    const hasMore = docs.length > resolvedPageSize;
    const nextCursor = hasMore && pageDocs.length
      ? encodePendingVoucherCursor(pageDocs[pageDocs.length - 1])
      : null;

    return {
      list,
      nextCursor,
      hasMore,
      pageSize: resolvedPageSize,
      fallback: false,
    };
  } catch (err) {
    // fallback for environments lacking required composite index / cursor support
    const list = await fetchPendingVouchersLegacyList({ limit: resolvedPageSize });
    return {
      list,
      nextCursor: null,
      hasMore: list.length >= resolvedPageSize,
      pageSize: resolvedPageSize,
      fallback: true,
      fallbackMode: "step",
      fallbackReason: classifyPendingFallbackReason(err),
      fallbackDetail: String(err?.message || err || "pending cursor fallback"),
    };
  }
}

export async function fetchTempTransactions({ limit = 100 } = {}) {
  const { db } = getFirebaseApp();
  const { collection, query, where, limit: fsLimit, getDocs } = await fsModules();
  const snap = await getDocs(
    query(
      collection(db, "transactions"),
      where("recordBucket", "==", "temp"),
      fsLimit(limit),
    ),
  );

  return snap.docs
    .map((docSnap) => normalizeTransactionRecord(docSnap.data(), {
      id: docSnap.id,
      snap: docSnap,
    }))
    .sort((left, right) => sortByLatestDesc(left, right));
}

export async function promoteTempTransaction(txId, options = {}) {
  const { db } = getFirebaseApp();
  const { doc, getDoc } = await fsModules();
  const txRef = doc(db, "transactions", txId);
  const txSnap = await getDoc(txRef);
  if (!txSnap.exists()) throw new ApiError("Transaction not found", 404);

  const txData = normalizeTransactionRecord(txSnap.data(), {
    id: txSnap.id,
    snap: txSnap,
  });

  await updateTransaction(txId, {
    recordBucket: "formal",
    pendingReason: null,
    lifecycleState: "active",
    difficultyState: options.difficultyState ?? null,
    difficultyDoneAt: options.difficultyDoneAt ?? null,
    difficultyDoneReason: options.difficultyDoneReason ?? null,
    decisionSource: options.decisionSource || "manual",
    decisionNote: appendDecisionTrail(
      txData.decisionNote,
      buildDecisionTrailEntry(options.decisionNote || "promote temp transaction"),
    ),
  });
}

export async function relinkVoucherToTransaction({ voucherId, storagePath, txId }) {
  const { db } = getFirebaseApp();
  const { doc, getDoc, updateDoc, serverTimestamp } = await fsModules();

  const txRef = doc(db, "transactions", txId);
  const txSnap = await getDoc(txRef);
  if (!txSnap.exists()) throw new ApiError("Transaction not found", 404);

  const txData = normalizeTransactionRecord(txSnap.data(), {
    id: txSnap.id,
    snap: txSnap,
  });
  const nextVoucherPaths = uniqueStrings([
    ...(txData.voucherStoragePaths || []),
    storagePath,
  ]);

  await updateDoc(txRef, {
    voucherPaths: nextVoucherPaths,
    voucherStoragePaths: nextVoucherPaths,
    status: "\u4eba\u5de5\u5173\u8054",
    lifecycleState: "active",
    pendingReason: null,
    decisionSource: "manual",
    decisionNote: appendDecisionTrail(
      txData.decisionNote,
      buildDecisionTrailEntry("relink voucher to transaction"),
    ),
    lastReviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const updatedVoucherDocs = await markVoucherLinked(voucherId, storagePath, {
    txId,
    legacyRowNum: txData._legacyRowNum ?? null,
    decisionNote: buildDecisionTrailEntry("relink to transaction"),
  });

  return {
    txId,
    voucherId,
    updatedVoucherDocs,
  };
}

export async function markVoucherDifficultyDone({
  voucherId,
  storagePath,
  decisionNote = "mark difficulty as done",
  decisionSource = "manual",
  difficultyDoneReason = "difficulty_center_done",
} = {}) {
  const { db } = getFirebaseApp();
  const { doc, getDoc, query, collection, where, getDocs, updateDoc, serverTimestamp } = await fsModules();

  let docs = [];
  if (voucherId) {
    const directRef = doc(db, "vouchers", voucherId);
    const directSnap = await getDoc(directRef);
    if (directSnap.exists()) docs = [directSnap];
  }
  if (!docs.length && storagePath) {
    const snap = await getDocs(
      query(collection(db, "vouchers"), where("storagePath", "==", storagePath)),
    );
    docs = snap.docs;
  }

  let updated = 0;
  const noteEntry = buildDecisionTrailEntry(decisionNote);
  for (const voucherDoc of docs) {
    const data = voucherDoc.data() || {};
    await updateDoc(voucherDoc.ref, {
      difficultyState: "done",
      difficultyDoneAt: serverTimestamp(),
      difficultyDoneReason,
      decisionSource,
      decisionNote: appendDecisionTrail(data.decisionNote, noteEntry),
      lastReviewedAt: serverTimestamp(),
    });
    updated += 1;
  }

  return updated;
}
export async function geminiOCR({ base64, mime }) {
  const result = await workerPost("gemini_ocr", { base64, mime });
  return result.data;
}

/**
 * NLP：从文字提取账目
 * @param {{ text: string, categories?: string }} params
 * @returns {Promise<Array>} 账目数组
 */
export async function geminiNLP({ text, categories }) {
  const result = await workerPost("gemini_nlp", { text, categories });
  return Array.isArray(result.data) ? result.data : [result.data];
}

// ── 图片上传（直传 Firebase Storage）────────────────

/**
 * 上传凭证图片到 Firebase Storage
 * @param {{ file: File, txId?: string }} params
 * @returns {Promise<{ storagePath: string, publicUrl: string, thumbnailUrl: string }>}
 */
export async function uploadVoucher({ file, txId = "" }) {
  const { storage } = getFirebaseApp();
  const {
    ref, uploadBytes, getDownloadURL,
  } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js");

  const ext         = file.name.split(".").pop() || "jpg";
  const timestamp   = Date.now();
  const storagePath = `vouchers/${timestamp}_${crypto.randomUUID()}.${ext}`;
  const storageRef  = ref(storage, storagePath);

  await uploadBytes(storageRef, file, {
    contentType: file.type || "image/jpeg",
    customMetadata: { txId },
  });

  const publicUrl = await getDownloadURL(storageRef);
  return { storagePath, publicUrl, thumbnailUrl: publicUrl };
}

// ── 影子日志读取（Shadow Monitor 面板）───────────────

/**
 * 读取最近的影子写日志（供 Shadow Monitor 终端面板展示）
 * @param {{ limit?: number }} options
 * @returns {Promise<Array>}
 */
export async function fetchShadowLogs({ limit = 30 } = {}) {
  const { db } = getFirebaseApp();
  const { collection, query, orderBy, limit: fsLimit, getDocs } = await fsModules();

  const q    = query(
    collection(db, "shadow_logs"),
    orderBy("ts", "desc"),
    fsLimit(limit)
  );
  const snap = await getDocs(q);
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// ── Firebase Auth ─────────────────────────────────────

/**
 * 邮箱密码登录
 * @param {{ email: string, password: string }} credentials
 * @returns {Promise<object>} Firebase User
 */
export async function loginUser({ email, password }) {
  const { auth } = getFirebaseApp();
  const { signInWithEmailAndPassword } = await authModules();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/**
 * 登出
 */
export async function logoutUser() {
  const { auth }  = getFirebaseApp();
  const { signOut } = await authModules();
  _cachedToken    = null;
  _tokenExpiresAt = 0;
  await signOut(auth);
}

/**
 * 监听登录状态变化
 * @param {(user: object|null) => void} callback
 * @returns {() => void} unsubscribe 函数
 */
export async function onAuthChange(callback) {
  const { auth } = getFirebaseApp();
  const { onAuthStateChanged } = await authModules();
  return onAuthStateChanged(auth, callback);
}

// ── 工具函数 ──────────────────────────────────────────

function normalizeDateStr(date) {
  if (!date) return new Date().toISOString().slice(0, 10);
  if (typeof date === "string") return date.slice(0, 10);
  if (date instanceof Date)    return date.toISOString().slice(0, 10);
  if (date.seconds)            return new Date(date.seconds * 1000).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function normalizeTransactionRecord(data = {}, { id = "", snap = null } = {}) {
  const mergedVoucherPaths = mergeVoucherPaths(data);
  return {
    id,
    ...data,
    ...mergedVoucherPaths,
    recordBucket: data.recordBucket || "formal",
    lifecycleState: data.lifecycleState || deriveLifecycleState(data),
    pendingReason: data.pendingReason ?? null,
    difficultyState: data.difficultyState || deriveDifficultyState(data),
    difficultyDoneAt: data.difficultyDoneAt || deriveDifficultyDoneAt(data),
    difficultyDoneReason: data.difficultyDoneReason || deriveDifficultyDoneReason(data),
    decisionSource: data.decisionSource || deriveDecisionSource(data),
    decisionNote: String(data.decisionNote || ""),
    lastReviewedAt: data.lastReviewedAt || null,
    _snap: snap,
  };
}

function buildTransactionWritePayload(txData = {}, timestamps = {}) {
  const normalized = normalizeTransactionRecord(txData);
  return {
    ...txData,
    voucherPaths: normalized.voucherPaths,
    voucherStoragePaths: normalized.voucherStoragePaths,
    source: txData.source || "\u624b\u52a8\u5f55\u5165",
    status: txData.status || "\u672a\u5173\u8054",
    recordBucket: txData.recordBucket || normalized.recordBucket,
    lifecycleState: txData.lifecycleState || normalized.lifecycleState,
    pendingReason: txData.pendingReason ?? normalized.pendingReason,
    difficultyState: txData.difficultyState ?? normalized.difficultyState,
    difficultyDoneAt: txData.difficultyDoneAt ?? normalized.difficultyDoneAt ?? null,
    difficultyDoneReason: txData.difficultyDoneReason ?? normalized.difficultyDoneReason ?? null,
    decisionSource: txData.decisionSource || normalized.decisionSource,
    decisionNote: txData.decisionNote || normalized.decisionNote,
    lastReviewedAt: txData.lastReviewedAt || timestamps.reviewedAt || null,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  };
}

function buildTransactionUpdatePayload(updates = {}, timestamps = {}) {
  const payload = {
    ...updates,
    updatedAt: timestamps.updatedAt,
  };

  if ("voucherPaths" in updates || "voucherStoragePaths" in updates) {
    const mergedVoucherPaths = mergeVoucherPaths(updates);
    payload.voucherPaths = mergedVoucherPaths.voucherPaths;
    payload.voucherStoragePaths = mergedVoucherPaths.voucherStoragePaths;
  }

  if ("recordBucket" in updates) {
    payload.recordBucket = updates.recordBucket || "formal";
  }

  if (
    "difficultyState" in updates ||
    "difficultyDoneAt" in updates ||
    "difficultyDoneReason" in updates
  ) {
    if ("difficultyState" in updates) {
      payload.difficultyState = updates.difficultyState ?? null;
    }
    if ("difficultyDoneAt" in updates) {
      payload.difficultyDoneAt = updates.difficultyDoneAt ?? null;
    } else if (updates.difficultyState === "done") {
      payload.difficultyDoneAt = timestamps.reviewedAt || null;
    } else if ("difficultyState" in updates) {
      payload.difficultyDoneAt = null;
    }

    if ("difficultyDoneReason" in updates) {
      payload.difficultyDoneReason = updates.difficultyDoneReason ?? null;
    } else if ("difficultyState" in updates && updates.difficultyState !== "done") {
      payload.difficultyDoneReason = null;
    }
  }

  if (
    "lifecycleState" in updates ||
    "pendingReason" in updates ||
    "decisionSource" in updates ||
    "decisionNote" in updates ||
    "difficultyState" in updates ||
    "difficultyDoneAt" in updates ||
    "difficultyDoneReason" in updates
  ) {
    payload.lastReviewedAt = updates.lastReviewedAt || timestamps.reviewedAt || null;
  }

  return payload;
}

function mergeVoucherPaths(data = {}) {
  const merged = uniqueStrings([
    ...(Array.isArray(data.voucherStoragePaths) ? data.voucherStoragePaths : []),
    ...(Array.isArray(data.voucherPaths) ? data.voucherPaths : []),
  ]);
  return {
    voucherPaths: merged,
    voucherStoragePaths: merged,
  };
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function deriveLifecycleState(data = {}) {
  if (data._deleted || data.status === "\u5df2\u5220\u9664") return "deleted";
  if (data.pendingReason) return "pending_link";
  if (data.status === "\u5f85\u7eed\u5173\u8054") return "pending_link";
  return "active";
}

function deriveDecisionSource(data = {}) {
  if (data.status === "\u667a\u80fd\u5173\u8054") return "system";
  if (data.status === "\u4eba\u5de5\u5173\u8054") return "manual";
  if (data.status === "\u5f85\u7eed\u5173\u8054") return "manual";
  return "manual";
}

function deriveDifficultyState(data = {}) {
  return String(data.decisionNote || "").includes("difficulty_center_done") ? "done" : null;
}

function deriveDifficultyDoneAt(data = {}) {
  if (!String(data.decisionNote || "").includes("difficulty_center_done")) return null;
  return data.difficultyDoneAt || data.lastReviewedAt || data.updatedAt || null;
}

function deriveDifficultyDoneReason(data = {}) {
  if (!String(data.decisionNote || "").includes("difficulty_center_done")) return null;
  return data.difficultyDoneReason || "difficulty_center_done";
}

function buildDecisionTrailEntry(message) {
  const stamp = new Date().toISOString();
  return '[' + stamp + '] ' + String(message || "").trim();
}

function appendDecisionTrail(existingNote, newEntry) {
  const current = String(existingNote || "").trim();
  if (!current) return newEntry;
  return current + '\n' + newEntry;
}

async function markVouchersPendingByStoragePaths(storagePaths = [], context = {}) {
  if (!storagePaths.length) return 0;

  const { db } = getFirebaseApp();
  const { collection, query, where, getDocs, updateDoc, serverTimestamp } = await fsModules();
  let updated = 0;

  for (const storagePath of storagePaths) {
    const snap = await getDocs(
      query(collection(db, "vouchers"), where("storagePath", "==", storagePath)),
    );
    for (const voucherDoc of snap.docs) {
      const data = voucherDoc.data() || {};
      const linkedIds = Array.isArray(data.linkedTransactionIds)
        ? data.linkedTransactionIds.filter((id) => id !== context.txId)
        : [];
      const linkedKeys = Array.isArray(data.linkedTransactionKeys)
        ? data.linkedTransactionKeys.filter((key) => key !== context.legacyRowNum)
        : [];

      await updateDoc(voucherDoc.ref, {
        linkedTransactionIds: linkedIds,
        linkedTransactionKeys: linkedKeys,
        lifecycleState: "pending_link",
        pendingReason: context.pendingReason || "manual_unbind",
        difficultyState: null,
        difficultyDoneAt: null,
        difficultyDoneReason: null,
        decisionSource: context.decisionSource || "manual",
        decisionNote: appendDecisionTrail(data.decisionNote, context.decisionNote),
        lastReviewedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      updated += 1;
    }
  }

  return updated;
}

function normalizePendingVoucher(data = {}, id = "") {
  return {
    id,
    ...data,
    lifecycleState: data.lifecycleState || "pending_link",
    pendingReason: data.pendingReason || null,
    difficultyState: data.difficultyState || deriveDifficultyState(data),
    difficultyDoneAt: data.difficultyDoneAt || deriveDifficultyDoneAt(data),
    difficultyDoneReason: data.difficultyDoneReason || deriveDifficultyDoneReason(data),
    decisionSource: data.decisionSource || "manual",
    decisionNote: String(data.decisionNote || ""),
    linkedTransactionIds: Array.isArray(data.linkedTransactionIds) ? data.linkedTransactionIds : [],
    linkedTransactionKeys: Array.isArray(data.linkedTransactionKeys) ? data.linkedTransactionKeys : [],
    latestAt: data.lastReviewedAt || data.updatedAt || data.createdAt || null,
  };
}

function clampPendingPageSize(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 100;
  return Math.max(1, Math.min(200, Math.floor(num)));
}

async function fetchPendingVouchersLegacyList({ limit = 100 } = {}) {
  const { db } = getFirebaseApp();
  const { collection, query, where, limit: fsLimit, getDocs } = await fsModules();
  const snap = await getDocs(
    query(
      collection(db, "vouchers"),
      where("lifecycleState", "==", "pending_link"),
      fsLimit(clampPendingPageSize(limit)),
    ),
  );
  return snap.docs
    .map((docSnap) => normalizePendingVoucher(docSnap.data(), docSnap.id))
    .sort((left, right) => {
      const diff = toMillis(right.updatedAt) - toMillis(left.updatedAt);
      if (diff !== 0) return diff;
      return String(left.id || "").localeCompare(String(right.id || ""));
    });
}

function normalizePendingVoucherCursor(cursor) {
  if (!cursor) return null;
  let input = cursor;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return null;
    }
  }
  const id = String(input?.id || "").trim();
  const updatedAtMs = Number(input?.updatedAtMs);
  if (!id || !Number.isFinite(updatedAtMs)) return null;
  return { id, updatedAtMs };
}

function encodePendingVoucherCursor(docSnap) {
  if (!docSnap) return null;
  const data = docSnap.data?.() || {};
  const id = String(docSnap.id || "").trim();
  if (!id) return null;
  // Only use updatedAt — the same field as orderBy("updatedAt"). Falling back to
  // lastReviewedAt / createdAt would produce a timestamp that doesn't align with
  // the Firestore index, causing startAfter to land at the wrong position.
  const rawUpdatedAt = data.updatedAt;
  if (rawUpdatedAt == null) return null;          // missing field → no cursor
  const updatedAtMs = toMillis(rawUpdatedAt);
  if (!Number.isFinite(updatedAtMs)) return null; // unparseable value → no cursor
  return { id, updatedAtMs };
}

function classifyPendingFallbackReason(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (!message) return "cursor_query_failed";
  if (message.includes("failed_precondition") || message.includes("index")) {
    return "index_missing";
  }
  return "cursor_query_failed";
}

function sortByLatestDesc(left, right) {
  return toMillis(right.latestAt || right.updatedAt || right.lastReviewedAt) - toMillis(left.latestAt || left.updatedAt || left.lastReviewedAt);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }
  return 0;
}

async function markVoucherLinked(voucherId, storagePath, context = {}) {
  const { db } = getFirebaseApp();
  const { doc, getDoc, query, collection, where, getDocs, updateDoc, serverTimestamp } = await fsModules();

  let docs = [];
  if (voucherId) {
    const directRef = doc(db, "vouchers", voucherId);
    const directSnap = await getDoc(directRef);
    if (directSnap.exists()) docs = [directSnap];
  }
  if (!docs.length && storagePath) {
    const snap = await getDocs(
      query(collection(db, "vouchers"), where("storagePath", "==", storagePath)),
    );
    docs = snap.docs;
  }

  let updated = 0;
  for (const voucherDoc of docs) {
    const data = voucherDoc.data() || {};
    const linkedIds = uniqueStrings([...(Array.isArray(data.linkedTransactionIds) ? data.linkedTransactionIds : []), context.txId]);
    const linkedKeys = context.legacyRowNum == null
      ? (Array.isArray(data.linkedTransactionKeys) ? data.linkedTransactionKeys : [])
      : uniqueStrings([...(Array.isArray(data.linkedTransactionKeys) ? data.linkedTransactionKeys : []), context.legacyRowNum]);

    await updateDoc(voucherDoc.ref, {
      linkedTransactionIds: linkedIds,
      linkedTransactionKeys: linkedKeys,
      lifecycleState: "active",
      pendingReason: null,
      difficultyState: null,
      difficultyDoneAt: null,
      difficultyDoneReason: null,
      decisionSource: "manual",
      decisionNote: appendDecisionTrail(data.decisionNote, context.decisionNote),
      lastReviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    updated += 1;
  }

  return updated;
}
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name   = "ApiError";
    this.status = status;
  }
}
