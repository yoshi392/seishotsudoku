// app.js (front-end)

const CONFIG = window.__CONFIG__ || {};
const WORKER_ORIGIN = (CONFIG.WORKER_ORIGIN || "").replace(/\/$/, "");
const VAPID_PUBLIC_KEY = (CONFIG.VAPID_PUBLIC_KEY || "").trim();
const APP_URL = CONFIG.APP_URL || (location.origin + location.pathname.replace(/\/[^/]*$/, "/"));

// ---- DOM
const elPushState = document.getElementById("pushState");
const btnEnablePush = document.getElementById("btnEnablePush");

const btnInstall = document.getElementById("btnInstall");
const btnAddHome = document.getElementById("btnAddHome");
const modalAddHome = document.getElementById("modalAddHome");
const btnCloseAddHome = document.getElementById("btnCloseAddHome");

const elTodayDate = document.getElementById("todayDate");
const elTodayTitle = document.getElementById("todayTitle");
const elTodayVerse = document.getElementById("todayVerse");
const elTodayButtons = document.getElementById("todayButtons");
const elTodayComment = document.getElementById("todayComment");
const btnLikeToday = document.getElementById("btnLikeToday");

const btnFilterUnread = document.getElementById("btnFilterUnread");
const btnFilterAll = document.getElementById("btnFilterAll");
const elCountInfo = document.getElementById("countInfo");
const elDaysList = document.getElementById("daysList");

// ---- state
let daysCache = [];
let showUnreadOnly = true;

// Android install prompt
let deferredInstallPrompt = null;

// ---- helpers
function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function normalizeDateAny(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  // 2025/12/28 -> 2025-12-28
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(t)) {
    const [y, m, d] = t.split("/").map((x) => x.padStart(2, "0"));
    return `${y}-${m}-${d}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return "";
}

function formatDisplayDate(ymd) {
  const [y, m, d] = ymd.split("-");
  return `${y}/${m}/${d}`;
}

function getQueryDate() {
  const u = new URL(location.href);
  const q = u.searchParams.get("date");
  const n = normalizeDateAny(q);
  return n || "";
}

// localStorage keys
function kRead(ymd) { return `read:${ymd}`; }
function kLike(ymd) { return `like:${ymd}`; }

function isRead(ymd) { return localStorage.getItem(kRead(ymd)) === "1"; }
function setRead(ymd, v) { localStorage.setItem(kRead(ymd), v ? "1" : "0"); }

function isLiked(ymd) { return localStorage.getItem(kLike(ymd)) === "1"; }
function setLiked(ymd, v) { localStorage.setItem(kLike(ymd), v ? "1" : "0"); }

// ---- SW register
async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    await navigator.serviceWorker.register("./sw.js");
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// ---- Push
async function refreshPushUI(reg) {
  // ボタンは1つだけ：有効なら隠す／無効なら出す
  if (!btnEnablePush || !elPushState) return;

  if (!("serviceWorker" in navigator)) {
    elPushState.textContent = "このブラウザでは通知を使えません";
    btnEnablePush.disabled = true;
    return;
  }

  // iOS Safari は「ホーム画面に追加」しないと PushManager が出ない
  if (!("PushManager" in window)) {
    if (isIOS() && !isStandalone()) {
      elPushState.textContent = "Push通知を有効にするには、ホーム画面に追加してください。";
      btnEnablePush.disabled = true;
      btnEnablePush.hidden = true; // iOSはここで押しても無理なので隠す
      // 代わりに「ホーム画面に追加」ボタンを出す（自動モーダルは出さない）
      if (btnAddHome) btnAddHome.hidden = false;
      return;
    }
    elPushState.textContent = "このブラウザでは通知を使えません";
    btnEnablePush.disabled = true;
    return;
  }

  const sub = await reg?.pushManager?.getSubscription?.().catch(() => null);

  if (sub) {
    elPushState.textContent = "✅ 通知は有効です";
    btnEnablePush.hidden = true;
  } else {
    elPushState.textContent = "";
    btnEnablePush.hidden = false;
    btnEnablePush.disabled = false;
  }
}

async function enablePush() {
  const reg = await navigator.serviceWorker.ready;

  if (!("PushManager" in window)) {
    // iOS未追加など
    alert("Push通知を有効にするには、ホーム画面に追加してください。");
    return;
  }
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.length < 20) {
    alert("VAPID 公開鍵が未設定です（index.html の __CONFIG__ を確認してください）");
    return;
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    alert("通知が許可されていません（端末の設定で許可してください）");
    return;
  }

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
    alert("subscribe 失敗: " + res.status + " " + t);
    return;
  }

  await refreshPushUI(reg);
}

// ---- Today / Days fetch
async function fetchJson(path) {
  const r = await fetch(WORKER_ORIGIN + path, { cache: "no-store" });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (j && j.error) ? j.error : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return j;
}

function renderToday(today) {
  const dateYmd = normalizeDateAny(today?.pageUrl?.match(/date=(\d{4}-\d{2}-\d{2})/)?.[1]) || normalizeDateAny(today?.date) || getQueryDate() || ymdLocal(new Date());
  const weekday = today?.weekday ? `（${today.weekday}）` : "";

  if (elTodayDate) elTodayDate.textContent = `${formatDisplayDate(dateYmd)} ${weekday}`.trim();
  if (elTodayTitle) elTodayTitle.textContent = today?.verse || today?.title || "今日の聖書箇所";
  if (elTodayVerse) elTodayVerse.textContent = ""; // 追加の本文表示があればここに

  // buttons
  if (elTodayButtons) {
    elTodayButtons.innerHTML = "";
    const btns = Array.isArray(today?.buttons) ? today.buttons : [];
    for (const b of btns) {
      const wrap = document.createElement("div");
      wrap.className = "btnRow";

      const a1 = document.createElement("a");
      a1.className = "btn blue";
      a1.href = b.prsUrl || "#";
      a1.target = "_blank";
      a1.rel = "noopener";
      a1.textContent = `${b.label}（新改訳2017）`;

      const a2 = document.createElement("a");
      a2.className = "btn orange";
      a2.href = b.lbUrl || "#";
      a2.target = "_blank";
      a2.rel = "noopener";
      a2.textContent = `${b.label}（LB）`;

      wrap.appendChild(a1);
      wrap.appendChild(a2);
      elTodayButtons.appendChild(wrap);
    }
  }

  if (elTodayComment) elTodayComment.textContent = today?.comment || "";

  // heart (today)
  if (btnLikeToday) {
    const liked = isLiked(dateYmd);
    btnLikeToday.classList.toggle("liked", liked);
    btnLikeToday.textContent = liked ? "♥" : "♡";
    btnLikeToday.onclick = () => {
      const now = !isLiked(dateYmd);
      setLiked(dateYmd, now);
      setRead(dateYmd, true); // いいね＝読了として扱う
      btnLikeToday.classList.toggle("liked", now);
      btnLikeToday.textContent = now ? "♥" : "♡";
      renderDaysList(); // 一覧も更新
    };
  }

  // 今日を開いた＝読んだ扱い（好みで）
  setRead(dateYmd, true);
}

function buildRow(day) {
  const ymd = normalizeDateAny(day.date);
  const verse = day.verse || day.title || "";
  const pageUrl = day.pageUrl || (APP_URL + `?date=${encodeURIComponent(ymd)}`);

  const row = document.createElement("div");
  row.className = "dayRow";

  const cb = document.createElement("button");
  cb.className = "check";
  cb.type = "button";
  cb.textContent = isRead(ymd) ? "☑" : "☐";
  cb.onclick = (e) => {
    e.stopPropagation();
    const v = !isRead(ymd);
    setRead(ymd, v);
    cb.textContent = v ? "☑" : "☐";
    renderDaysList();
  };

  const mid = document.createElement("div");
  mid.className = "mid";
  const d = document.createElement("div");
  d.className = "d";
  d.textContent = `${formatDisplayDate(ymd)}${day.weekday ? `（${day.weekday}）` : ""}`;
  const v = document.createElement("div");
  v.className = "v";
  v.textContent = verse;
  mid.appendChild(d);
  mid.appendChild(v);

  const heart = document.createElement("button");
  heart.className = "heartSmall";
  heart.type = "button";
  const liked = isLiked(ymd);
  heart.textContent = liked ? "♥" : "♡";
  heart.classList.toggle("liked", liked);
  heart.onclick = (e) => {
    e.stopPropagation();
    const now = !isLiked(ymd);
    setLiked(ymd, now);
    setRead(ymd, true);
    heart.textContent = now ? "♥" : "♡";
    heart.classList.toggle("liked", now);
    renderDaysList();
  };

  row.appendChild(cb);
  row.appendChild(mid);
  row.appendChild(heart);

  row.onclick = () => {
    setRead(ymd, true);
    location.href = pageUrl;
  };

  return row;
}

function renderDaysList() {
  if (!elDaysList) return;

  const today = new Date();
  const until = new Date(today);
  until.setDate(today.getDate() - 1); // ★昨日まで
  const untilYmd = ymdLocal(until);

  // 未来は出さない + 365日分だけ
  const filtered = daysCache
    .map((x) => ({
      ...x,
      date: normalizeDateAny(x.date),
    }))
    .filter((x) => x.date && x.date <= untilYmd)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 365);

  const unreadCount = filtered.filter((x) => !isRead(x.date)).length;
  const readCount = filtered.length - unreadCount;

  if (elCountInfo) elCountInfo.textContent = `既読 ${readCount} / 未読 ${unreadCount}`;

  const view = showUnreadOnly ? filtered.filter((x) => !isRead(x.date)) : filtered;

  elDaysList.innerHTML = "";
  for (const day of view) {
    elDaysList.appendChild(buildRow(day));
  }
}

// ---- Install (Android) / Add to Home (iOS)
function setupInstallUI() {
  // Android: beforeinstallprompt が来た時だけ出す
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstall && !isStandalone()) btnInstall.hidden = false;
  });

  if (btnInstall) {
    btnInstall.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      btnInstall.hidden = true;
    });
  }

  // iOS: 自動で邪魔なモーダルを出さない。ボタンで開く
  if (btnAddHome) {
    btnAddHome.hidden = !(isIOS() && !isStandalone());
    btnAddHome.addEventListener("click", () => {
      if (modalAddHome) modalAddHome.hidden = false;
    });
  }
  if (btnCloseAddHome) {
    btnCloseAddHome.addEventListener("click", () => {
      if (modalAddHome) modalAddHome.hidden = true;
    });
  }
  if (modalAddHome) {
    modalAddHome.addEventListener("click", (e) => {
      if (e.target === modalAddHome) modalAddHome.hidden = true;
    });
  }
}

// ---- init
async function main() {
  if (!WORKER_ORIGIN) {
    alert("WORKER_ORIGIN が未設定です（index.html の __CONFIG__ を確認）");
    return;
  }

  setupInstallUI();
  const reg = await registerSW();
  if (btnEnablePush) btnEnablePush.addEventListener("click", enablePush);
  await refreshPushUI(reg);

  // date param
  const qDate = getQueryDate();

  // today
  try {
    const today = await fetchJson("/today" + (qDate ? `?date=${encodeURIComponent(qDate)}` : ""));
    if (today?.ok) renderToday(today);
  } catch (e) {
    // 画面が真っ白にならないように最小表示
    if (elTodayDate) elTodayDate.textContent = "";
    if (elTodayTitle) elTodayTitle.textContent = "読み込みに失敗しました";
    if (elTodayComment) elTodayComment.textContent = String(e?.message || e);
  }

  // days list
  try {
    // ★/days がある前提（無ければここだけ 404 になります）
    // 例: /days?until=YYYY-MM-DD&limit=365
    const todayLocal = new Date();
    const until = new Date(todayLocal);
    until.setDate(todayLocal.getDate() - 1);
    const untilYmd = ymdLocal(until);

    const out = await fetchJson(`/days?until=${encodeURIComponent(untilYmd)}&limit=365`);
    const arr = Array.isArray(out) ? out : (out.days || out.items || out.data || []);
    daysCache = Array.isArray(arr) ? arr : [];
  } catch {
    daysCache = [];
  }

  // filter UI
  if (btnFilterUnread && btnFilterAll) {
    btnFilterUnread.addEventListener("click", () => {
      showUnreadOnly = true;
      btnFilterUnread.classList.add("active");
      btnFilterAll.classList.remove("active");
      renderDaysList();
    });
    btnFilterAll.addEventListener("click", () => {
      showUnreadOnly = false;
      btnFilterAll.classList.add("active");
      btnFilterUnread.classList.remove("active");
      renderDaysList();
    });
  }

  renderDaysList();
}

main();
