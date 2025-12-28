// app.js (GitHub Pages)

const WORKER_ORIGIN = "https://seishotsudoku-push.teruntyo.workers.dev";

// VAPID 公開鍵（Public Keyだけ）
const VAPID_PUBLIC_KEY = "BP51V69QOr3LWj2YhzcVO05ojPb9R_VRiMcNciBxPkOXbBtsYZMuJOxgrpVcr755ixYsWK5hVDJLXSgYpTWfM_I";

const els = {
  install: document.getElementById("btnInstall"),
  btnArea: document.getElementById("btnArea"),
  meta: document.getElementById("todayMeta"),
  verse: document.getElementById("todayVerse"),
  comment: document.getElementById("todayComment"),// app.js

// ========= 設定 =========
const WORKER_ORIGIN = "https://seishotsudoku-push.teruntyo.workers.dev";

// Workerの /today が返す「buttons」はそのまま使う想定
// 過去一覧は CSV を直接読む（公開CSV）
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1Ue8iKwyo8EMvoI-eCXiWpQ7_nMyRtbNg80SvIv3Y5_Q/gviz/tq?tqx=out:csv&gid=1717884447";

// 365日分表示（= 昨日から遡って365日）
const HISTORY_DAYS = 365;

// ========= DOM =========
const elBtnPush = document.getElementById("btnPush");
const elPushStatus = document.getElementById("pushStatus");
const elBtnInstall = document.getElementById("btnInstall");

const elTodayDate = document.getElementById("todayDate");
const elTodayVerse = document.getElementById("todayVerse");
const elTodayButtons = document.getElementById("todayButtons");
const elTodayComment = document.getElementById("todayComment");

const elBtnTodayLike = document.getElementById("btnTodayLike");
const elTodayLikeLabel = document.getElementById("todayLikeLabel");

const elChipUnread = document.getElementById("chipUnread");
const elChipAll = document.getElementById("chipAll");
const elCountLabel = document.getElementById("countLabel");
const elHistoryList = document.getElementById("historyList");

// ========= storage =========
const LS_KEY = "seishotsudoku_state_v1";
/**
 * state = {
 *   read: { "YYYY-MM-DD": true, ... },
 *   like: { "YYYY-MM-DD": true, ... }
 * }
 */
function loadState() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || { read: {}, like: {} };
  } catch {
    return { read: {}, like: {} };
  }
}
function saveState(st) {
  localStorage.setItem(LS_KEY, JSON.stringify(st));
}

let state = loadState();
let filterMode = "unread"; // unread | all

// ========= helpers =========
const YOUBI = ["日","月","火","水","木","金","土"];

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function ymdSlash(ymdStr) {
  // YYYY-MM-DD -> YYYY/MM/DD
  return ymdStr.replaceAll("-", "/");
}
function parseYmdAny(s) {
  // "2025/12/27" "2025-12-27" "2025.12.27" など
  const x = String(s || "").trim().replace(/\./g, "/").replace(/-/g, "/");
  const m = x.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return "";
  const y = m[1];
  const mo = String(Number(m[2])).padStart(2, "0");
  const da = String(Number(m[3])).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}
function weekdayLabel(ymdStr) {
  const [y,m,d] = ymdStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return YOUBI[dt.getDay()];
}
function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}
function pushSupportMessage() {
  // iPhone Safari は「ホーム画面に追加」が必要なケースが多い
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    if (!isStandalone()) {
      return "Push通知を有効にするには、ホーム画面に追加してください。";
    }
  }
  return "この端末/ブラウザではPush通知を利用できません。";
}

// ========= Push =========
async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    return reg;
  } catch (e) {
    console.log("sw register failed", e);
    return null;
  }
}

async function refreshPushUi() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();

    if (Notification.permission === "granted" && sub) {
      elPushStatus.innerHTML = `<span class="ok">✅ 通知は有効です</span>`;
      elBtnPush.style.display = "none"; // 有効になったら消す
      return true;
    }
  } catch {}
  elBtnPush.style.display = "";
  elPushStatus.textContent = "";
  return false;
}

async function enablePush() {
  // iOS: ホーム画面に追加してないと進めても失敗しがち → 先に案内
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) && !isStandalone()) {
    elPushStatus.innerHTML = `<span class="err">⚠️ ${pushSupportMessage()}</span>`;
    return;
  }

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    elPushStatus.innerHTML = `<span class="err">⚠️ ${pushSupportMessage()}</span>`;
    return;
  }

  elPushStatus.textContent = "準備中…";

  const reg = await ensureServiceWorker();
  if (!reg) {
    elPushStatus.innerHTML = `<span class="err">⚠️ Service Workerの登録に失敗しました</span>`;
    return;
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    elPushStatus.innerHTML = `<span class="err">⚠️ 通知が許可されませんでした（設定で通知をONにしてください）</span>`;
    return;
  }

  // Workerがsubscribeを受けている前提（VAPIDはSW側ではなくWorker側で送信）
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true });

  const res = await fetch(`${WORKER_ORIGIN}/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    elPushStatus.innerHTML = `<span class="err">⚠️ subscribe失敗: ${res.status} ${t}</span>`;
    return;
  }

  await refreshPushUi();
}

elBtnPush?.addEventListener("click", enablePush);

// ========= Android install prompt =========
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (elBtnInstall) elBtnInstall.style.display = "";
});

elBtnInstall?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  elBtnInstall.style.display = "none";
});

// ========= Today =========
async function loadToday() {
  const res = await fetch(`${WORKER_ORIGIN}/today`, { cache: "no-store" });
  const data = await res.json();

  if (!data?.ok) {
    elTodayDate.textContent = "";
    elTodayVerse.textContent = "";
    elTodayButtons.innerHTML = "";
    elTodayComment.innerHTML = `<span class="err">読み込みに失敗しました（today）</span>`;
    return;
  }

  // dateは "2025/12/27" のように来る場合があるので正規化
  const todayKey = parseYmdAny(data.date) || ymd(new Date());
  const youbi = data.weekday || weekdayLabel(todayKey);

  elTodayDate.textContent = `${ymdSlash(todayKey)}（${youbi}）`;
  elTodayVerse.textContent = data.verse || "";

  // 2ボタン群
  elTodayButtons.innerHTML = "";
  const btns = Array.isArray(data.buttons) ? data.buttons : [];
  for (const b of btns) {
    const a1 = document.createElement("a");
    a1.className = "pill pill-prs";
    a1.href = b.prsUrl || b.lbUrl || "#";
    a1.target = "_blank";
    a1.rel = "noopener";
    a1.textContent = `${b.label || ""}（新改訳2017）`;

    const a2 = document.createElement("a");
    a2.className = "pill pill-lb";
    a2.href = b.lbUrl || "#";
    a2.target = "_blank";
    a2.rel = "noopener";
    a2.textContent = `${b.label || ""}（LB）`;

    elTodayButtons.appendChild(a1);
    elTodayButtons.appendChild(a2);
  }

  elTodayComment.textContent = data.comment || "";

  // 今日を表示したら「既読」にする（必要なら外せます）
  state.read[todayKey] = true;
  saveState(state);

  // 今日のハート（スクショの「今日にハートが無い」を解消）
  updateTodayLikeUi(todayKey);
  elBtnTodayLike.onclick = () => {
    state.like[todayKey] = !state.like[todayKey];
    saveState(state);
    updateTodayLikeUi(todayKey);
    renderHistory(); // 一覧にも反映
  };

  // 一覧を更新
  renderHistory();
}

function updateTodayLikeUi(todayKey) {
  const on = !!state.like[todayKey];
  elBtnTodayLike.classList.toggle("on", on);
  elBtnTodayLike.textContent = on ? "♥" : "♡";
  elTodayLikeLabel.textContent = on ? "いいね済み" : "";
}

// ========= CSV -> history =========
let allRows = []; // [{dateKey, dateDisp, youbi, verse, comment, urls[]}]

async function loadCsvRows() {
  const r = await fetch(CSV_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`CSV fetch failed: ${r.status}`);
  const csv = await r.text();
  const rows = parseCsv(csv);
  if (!rows.length) return [];

  const header = rows[0].map((x) => (x || "").trim());
  const data = rows.slice(1);

  const idxDate = header.findIndex(h => ["date","Date","日付"].includes(h));
  const idxYoubi = header.findIndex(h => ["weekday","Weekday","曜日"].includes(h));
  const idxVerse = header.findIndex(h => ["verse","Verse","聖書箇所","reference","Reference"].includes(h));
  const idxUrl = header.findIndex(h => ["url","URL","リンク"].includes(h));
  const idxComment = header.findIndex(h => ["comment","Comment","コメント"].includes(h));
  const idxTitle = header.findIndex(h => ["title","Title","タイトル"].includes(h));

  const out = [];
  for (const row of data) {
    const rawDate = (row[idxDate] || "").trim();
    const dateKey = parseYmdAny(rawDate);
    if (!dateKey) continue;

    const youbi = (idxYoubi >= 0 ? (row[idxYoubi] || "").trim() : "") || weekdayLabel(dateKey);
    const verse = (idxVerse >= 0 ? (row[idxVerse] || "").trim() : "");
    const comment = (idxComment >= 0 ? (row[idxComment] || "").trim() : "");
    const urlText = (idxUrl >= 0 ? (row[idxUrl] || "").trim() : "");
    const title = (idxTitle >= 0 ? (row[idxTitle] || "").trim() : "");

    const urls = urlText
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(s => /^https?:\/\//i.test(s));

    out.push({
      dateKey,
      dateDisp: ymdSlash(dateKey),
      youbi,
      title,
      verse,
      comment,
      urls,
    });
  }

  // 日付降順（新しい→古い）
  out.sort((a,b) => (a.dateKey < b.dateKey ? 1 : -1));
  return out;
}

// ✅ 未来を出さない：昨日まで、さらに365日分だけ
function filterHistoryBase(list) {
  const today = new Date();
  const todayKey = ymd(today);

  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const from = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() - (HISTORY_DAYS - 1));
  const fromKey = ymd(from);
  const toKey = ymd(yesterday);

  return list.filter(r => r.dateKey >= fromKey && r.dateKey <= toKey && r.dateKey < todayKey);
}

// ========= render history =========
function renderHistory() {
  const base = filterHistoryBase(allRows);

  const totalUnread = base.filter(r => !state.read[r.dateKey]).length;
  const totalRead = base.length - totalUnread;
  elCountLabel.textContent = `既読 ${totalRead} / 未読 ${totalUnread}`;

  let list = base;
  if (filterMode === "unread") {
    list = base.filter(r => !state.read[r.dateKey]);
  }

  elHistoryList.innerHTML = "";
  for (const r of list) {
    const item = document.createElement("div");
    item.className = "item";

    const chk = document.createElement("div");
    chk.className = "chk" + (state.read[r.dateKey] ? " done" : "");
    chk.title = "既読/未読";

    const main = document.createElement("div");
    main.className = "item-main";

    const d = document.createElement("div");
    d.className = "item-date";
    d.textContent = `${r.dateDisp}（${r.youbi}）`;

    const v = document.createElement("div");
    v.className = "item-verse";
    v.textContent = r.verse || r.title || "";

    main.appendChild(d);
    main.appendChild(v);

    // ハート
    const heart = document.createElement("button");
    const liked = !!state.like[r.dateKey];
    heart.className = "heart" + (liked ? " on" : "");
    heart.textContent = liked ? "♥" : "♡";
    heart.title = "いいね";

    // クリック動作
    chk.addEventListener("click", () => {
      state.read[r.dateKey] = !state.read[r.dateKey];
      saveState(state);
      renderHistory();
    });

    heart.addEventListener("click", (e) => {
      e.stopPropagation();
      state.like[r.dateKey] = !state.like[r.dateKey];
      saveState(state);
      renderHistory();
    });

    // 行全体クリックでその日を表示（必要なら実装を拡張します）
    item.addEventListener("click", () => {
      // 今は「今日」固定で動いているので、将来ここで date パラメータ付きで /today?date= を叩く形にできます
      // ひとまず既読だけ付ける
      state.read[r.dateKey] = true;
      saveState(state);
      renderHistory();
      // ここでページ内にその日の内容表示を作りたければ言ってください（今は要望の範囲外なので最小）
    });

    item.appendChild(chk);
    item.appendChild(main);
    item.appendChild(heart);

    elHistoryList.appendChild(item);
  }
}

elChipUnread?.addEventListener("click", () => {
  filterMode = "unread";
  elChipUnread.classList.add("active");
  elChipAll.classList.remove("active");
  renderHistory();
});
elChipAll?.addEventListener("click", () => {
  filterMode = "all";
  elChipAll.classList.add("active");
  elChipUnread.classList.remove("active");
  renderHistory();
});

// ========= CSV parser =========
function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    const n = csv[i + 1];

    if (inQ) {
      if (c === '"' && n === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQ = false; continue; }
      cur += c;
      continue;
    }

    if (c === '"') { inQ = true; continue; }
    if (c === ",") { row.push(cur); cur = ""; continue; }

    if (c === "\r" && n === "\n") {
      row.push(cur); rows.push(row);
      row = []; cur = ""; i++; continue;
    }
    if (c === "\n") {
      row.push(cur); rows.push(row);
      row = []; cur = ""; continue;
    }
    cur += c;
  }

  if (cur.length || row.length) { row.push(cur); rows.push(row); }

  return rows.filter(r => r.some(x => (x ?? "").trim() !== ""));
}

// ========= boot =========
(async function boot() {
  await ensureServiceWorker();
  await refreshPushUi();

  try {
    allRows = await loadCsvRows();
  } catch (e) {
    console.log(e);
    // 過去一覧が壊れても今日表示は生かす
  }

  await loadToday();
})();

  error: document.getElementById("errorBox"),
  history: document.getElementById("history"),
  stats: document.getElementById("stats"),
  filterUnread: document.getElementById("btnFilterUnread"),
};

let deferredPrompt = null;
let filterUnread = false;

// ----------------------------
// 端末ID（ログイン無しの“自分用”）
// ----------------------------
function getDeviceId() {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = (crypto?.randomUUID?.() || String(Date.now()) + Math.random());
    localStorage.setItem("deviceId", id);
  }
  return id;
}

// ----------------------------
// Android「アプリをインストール」ボタン
// ----------------------------
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (els.install) els.install.style.display = "inline-block";
});

if (els.install) {
  els.install.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    els.install.style.display = "none";
  });
}

// ----------------------------
// Push 有効化
// ----------------------------
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function ensureSwReady() {
  if (!("serviceWorker" in navigator)) return null;
  await navigator.serviceWorker.register("./sw.js");
  return navigator.serviceWorker.ready;
}

async function getSubscription() {
  const reg = await ensureSwReady();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

async function enablePush() {
  // iPhone Safari は「ホーム画面に追加」してから（ただし現在はSE3もOKとのことなので文言だけ丁寧に）
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    alert("Push通知を有効にするには、ホーム画面に追加して開いてください。");
    return;
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    alert("通知が許可されていません。設定で通知を許可してください。");
    return;
  }

  const reg = await ensureSwReady();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const res = await fetch(WORKER_ORIGIN + "/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    alert("購読の保存に失敗しました: " + res.status + " " + t);
    return;
  }

  await refreshPushButtons();
  alert("通知を有効にしました。");
}

async function refreshPushButtons() {
  if (!els.btnArea) return;

  const sub = await getSubscription().catch(() => null);
  els.btnArea.innerHTML = "";

  if (sub) {
    // 有効ならボタンを消す（要望通り）
    return;
  }

  const btn = document.createElement("button");
  btn.textContent = "🔔 通知を有効にする";
  btn.style.padding = "10px 14px";
  btn.style.fontWeight = "700";
  btn.addEventListener("click", enablePush);
  els.btnArea.appendChild(btn);
}

// ----------------------------
// 表示（今日/指定日）
// ----------------------------
function getQueryDate() {
  const u = new URL(location.href);
  const d = (u.searchParams.get("date") || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function setQueryDate(ymd) {
  const u = new URL(location.href);
  u.searchParams.set("date", ymd);
  history.pushState(null, "", u.toString());
}

async function apiGet(path) {
  const r = await fetch(WORKER_ORIGIN + path, { cache: "no-store" });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { ok: false, error: t }; }
}

function renderToday(data) {
  els.error.textContent = "";

  els.meta.textContent = `${data.date}（${data.weekday || ""}）`;
  els.verse.textContent = data.verse || "";
  els.comment.textContent = data.comment || "";

  // 2ボタン（新改訳2017 / LB）
  const area = els.btnArea;
  if (!area) return;

  // pushボタンの表示は refreshPushButtons() が担当
  // ここでは聖書ボタンを下に足す
  if (Array.isArray(data.buttons) && data.buttons.length) {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.gap = "10px";
    wrap.style.flexWrap = "wrap";
    wrap.style.marginTop = "12px";

    data.buttons.forEach((b) => {
      const a1 = document.createElement("a");
      a1.href = b.prsUrl;
      a1.target = "_blank";
      a1.rel = "noopener";
      a1.textContent = `${b.label}（新改訳2017）`;
      a1.style.padding = "10px 12px";
      a1.style.background = "#eef3ff";
      a1.style.borderRadius = "12px";
      a1.style.textDecoration = "none";

      const a2 = document.createElement("a");
      a2.href = b.lbUrl;
      a2.target = "_blank";
      a2.rel = "noopener";
      a2.textContent = `${b.label}（LB）`;
      a2.style.padding = "10px 12px";
      a2.style.background = "#eef3ff";
      a2.style.borderRadius = "12px";
      a2.style.textDecoration = "none";

      wrap.appendChild(a1);
      wrap.appendChild(a2);
    });

    area.appendChild(wrap);
  }
}

// ----------------------------
// 既読/いいね
// ----------------------------
async function postProgress(ymd, patch) {
  const deviceId = getDeviceId();
  await fetch(WORKER_ORIGIN + "/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, date: ymd, ...patch }),
  }).catch(() => null);
}

async function loadProgress(limit = 60) {
  const deviceId = getDeviceId();
  return apiGet(`/progress?device=${encodeURIComponent(deviceId)}&limit=${limit}`);
}

// ----------------------------
// 履歴一覧
// ----------------------------
function renderHistory(days, progressItems) {
  const map = new Map();
  (progressItems || []).forEach((it) => map.set(it.date, it));

  const filtered = filterUnread
    ? days.filter((d) => !(map.get(d.ymd)?.read))
    : days;

  // stats
  const total = days.length;
  const readCount = days.filter((d) => map.get(d.ymd)?.read).length;
  const unreadCount = total - readCount;
  if (els.stats) els.stats.textContent = `既読 ${readCount} / 未読 ${unreadCount}`;

  els.history.innerHTML = "";

  filtered.forEach((d) => {
    const p = map.get(d.ymd) || {};
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.style.padding = "10px 8px";
    row.style.borderBottom = "1px solid #eee";
    row.style.gap = "10px";

    const left = document.createElement("div");
    left.style.flex = "1";

    const a = document.createElement("a");
    a.href = `?date=${encodeURIComponent(d.ymd)}`;
    a.textContent = `${p.read ? "✅" : "⬜"} ${d.date}（${d.weekday || ""}）  ${d.verse || ""}`;
    a.style.textDecoration = "none";
    a.style.color = "#111";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      setQueryDate(d.ymd);
      boot(); // 表示更新
    });

    left.appendChild(a);

    const likeBtn = document.createElement("button");
    likeBtn.textContent = p.liked ? "❤️" : "🤍";
    likeBtn.style.fontSize = "18px";
    likeBtn.addEventListener("click", async () => {
      const next = !p.liked;
      await postProgress(d.ymd, { liked: next, read: true });
      boot();
    });

    row.appendChild(left);
    row.appendChild(likeBtn);

    els.history.appendChild(row);
  });
}

// ----------------------------
// 起動
// ----------------------------
async function boot() {
  els.error.textContent = "";

  // 1) 今日 or 指定日
  const qd = getQueryDate();
  const data = qd ? await apiGet(`/day?date=${encodeURIComponent(qd)}`) : await apiGet(`/today`);
  if (!data.ok) {
    els.error.textContent = data.error || "読み込みに失敗しました";
    return;
  }

  // ページを開いたら既読にする
  const ymd = data.ymd || qd;
  if (ymd) await postProgress(ymd, { read: true });

  // 2) Pushボタン状態
  await refreshPushButtons();

  // 3) 今日表示
  renderToday(data);

  // 4) 履歴＆進捗
  const daysRes = await apiGet("/days?limit=60");
  const progRes = await loadProgress(120);

  const days = daysRes.ok ? (daysRes.days || []) : [];
  const prog = progRes.ok ? (progRes.items || []) : [];

  renderHistory(days, prog);
}

if (els.filterUnread) {
  els.filterUnread.addEventListener("click", () => {
    filterUnread = !filterUnread;
    els.filterUnread.textContent = filterUnread ? "全て表示" : "未読のみ";
    boot();
  });
}

boot();
