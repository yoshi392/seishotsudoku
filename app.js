// app.js (front-end) — index.html とID一致版

const CONFIG = window.__CONFIG__ || {};
const WORKER_ORIGIN = String(CONFIG.WORKER_ORIGIN || "").replace(/\/$/, "");
const VAPID_PUBLIC_KEY = String(CONFIG.VAPID_PUBLIC_KEY || "").trim();

// ---- DOM
const btnPush = document.getElementById("btnPush");
const elPushStatus = document.getElementById("pushStatus");
const btnInstall = document.getElementById("btnInstall");

const btnLike = document.getElementById("btnLike");
const elTodayDate = document.getElementById("todayDate");
const elTodayVerse = document.getElementById("todayVerse");
const elTodayButtons = document.getElementById("todayButtons");
const elTodayComment = document.getElementById("todayComment");

const btnFilterUnread = document.getElementById("btnFilterUnread");
const btnFilterAll = document.getElementById("btnFilterAll");
const elCountRead = document.getElementById("countRead");
const elCountUnread = document.getElementById("countUnread");
const elList = document.getElementById("list");

// ---- state
let daysCache = [];
let showUnreadOnly = true;
let selectedYmd = "";

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
  return normalizeDateAny(q);
}
function setQueryDate(ymd) {
  const u = new URL(location.href);
  u.searchParams.set("date", ymd);
  history.pushState({}, "", u.toString());
}

// localStorage keys
function kRead(ymd) { return `read:${ymd}`; }
function kLike(ymd) { return `like:${ymd}`; }
function isRead(ymd) { return localStorage.getItem(kRead(ymd)) === "1"; }
function setRead(ymd, v) { localStorage.setItem(kRead(ymd), v ? "1" : "0"); }
function isLiked(ymd) { return localStorage.getItem(kLike(ymd)) === "1"; }
function setLiked(ymd, v) { localStorage.setItem(kLike(ymd), v ? "1" : "0"); }

// ---- SW register + timeout
async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;

  // scopeを /seishotsudoku/ に合わせるため相対で登録
  await navigator.serviceWorker.register("./sw.js");

  // ready が永久待ちにならないようタイムアウト
  const ready = navigator.serviceWorker.ready;
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("SW ready timeout")), 8000));
  return await Promise.race([ready, timeout]).catch(() => null);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// ---- Push UI
async function refreshPushUI(reg) {
  if (!btnPush || !elPushStatus) return;

  // iOS Safari は「ホーム画面に追加」しないと PushManager が出ない
  if (!("PushManager" in window)) {
    if (isIOS() && !isStandalone()) {
      elPushStatus.textContent = "Push通知を有効にするには、ホーム画面に追加してください。";
    } else {
      elPushStatus.textContent = "この端末/ブラウザでは通知を使えません。";
    }
    btnPush.disabled = true;
    return;
  }

  const sub = await reg?.pushManager?.getSubscription?.().catch(() => null);
  if (sub) {
    elPushStatus.textContent = "✅ 通知は有効です";
    btnPush.hidden = true;
  } else {
    elPushStatus.textContent = "";
    btnPush.hidden = false;
    btnPush.disabled = false;
  }
}

async function enablePush() {
  if (!WORKER_ORIGIN) {
    alert("WORKER_ORIGIN が空です（index.html の __CONFIG__ を確認してください）");
    return;
  }
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.length < 20) {
    alert("VAPID 公開鍵が未設定です（index.html の __CONFIG__ を確認してください）");
    return;
  }

  btnPush.disabled = true;
  elPushStatus.textContent = "準備中…";

  try {
    const reg = await registerSW();
    if (!reg) throw new Error("Service Worker の登録に失敗しました");

    if (!("PushManager" in window)) {
      throw new Error(isIOS() ? "ホーム画面に追加してから開いてください" : "この端末/ブラウザでは通知を使えません");
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("通知が許可されていません（端末の設定で許可してください）");

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
      throw new Error(`subscribe 失敗: ${res.status} ${t}`);
    }

    await refreshPushUI(reg);
  } catch (e) {
    alert(String(e?.message || e));
    elPushStatus.textContent = "";
    btnPush.disabled = false;
  }
}

// ---- fetch helpers
async function fetchJson(path) {
  const r = await fetch(WORKER_ORIGIN + path, { cache: "no-store" });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (j && j.error) ? j.error : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return j;
}

// ---- render today (from a day object)
function renderToday(day) {
  const ymd = normalizeDateAny(day?.date) || ymdLocal(new Date());
  selectedYmd = ymd;

  if (elTodayDate) {
    const w = day?.weekday ? `（${day.weekday}）` : "";
    elTodayDate.textContent = `${formatDisplayDate(ymd)} ${w}`.trim();
  }
  if (elTodayVerse) elTodayVerse.textContent = day?.verse || day?.title || "今日の聖書箇所";
  if (elTodayComment) elTodayComment.textContent = day?.comment || "";

  if (elTodayButtons) {
    elTodayButtons.innerHTML = "";
    const btns = Array.isArray(day?.buttons) ? day.buttons : [];
    for (const b of btns) {
      const row = document.createElement("div");
      row.className = "btnRow";

      const a1 = document.createElement("a");
      a1.className = "btn";
      a1.href = b.prsUrl || "#";
      a1.target = "_blank";
      a1.rel = "noopener";
      a1.textContent = `${b.label}（新改訳2017）`;

      const a2 = document.createElement("a");
      a2.className = "btn btnLb";
      a2.href = b.lbUrl || "#";
      a2.target = "_blank";
      a2.rel = "noopener";
      a2.textContent = `${b.label}（LB）`;

      row.appendChild(a1);
      row.appendChild(a2);
      elTodayButtons.appendChild(row);
    }
  }

  // like（今日のハート）
  if (btnLike) {
    const liked = isLiked(ymd);
    btnLike.textContent = liked ? "♥" : "♡";
    btnLike.setAttribute("aria-pressed", liked ? "true" : "false");
    btnLike.onclick = () => {
      const now = !isLiked(ymd);
      setLiked(ymd, now);
      setRead(ymd, true);
      btnLike.textContent = now ? "♥" : "♡";
      btnLike.setAttribute("aria-pressed", now ? "true" : "false");
      renderList();
      updateCounts();
    };
  }

  // 開いたら既読扱い（必要なら外してOK）
  setRead(ymd, true);
  renderList();
  updateCounts();
}

// ---- list
function updateCounts() {
  const items = daysCache;
  let read = 0, unread = 0;
  for (const it of items) {
    const ymd = normalizeDateAny(it.date);
    if (!ymd) continue;
    if (isRead(ymd)) read++; else unread++;
  }
  if (elCountRead) elCountRead.textContent = String(read);
  if (elCountUnread) elCountUnread.textContent = String(unread);
}

function renderList() {
  if (!elList) return;
  elList.innerHTML = "";

  const today = ymdLocal(new Date());

  const items = daysCache
    .map(d => ({...d, _ymd: normalizeDateAny(d.date)}))
    .filter(d => d._ymd)
    // ★未来は出さない（今日まで）
    .filter(d => d._ymd <= today)
    // ★降順（新しい日付が上）
    .sort((a,b) => (a._ymd < b._ymd ? 1 : -1));

  const filtered = showUnreadOnly
    ? items.filter(d => !isRead(d._ymd))
    : items;

  for (const d of filtered) {
    const ymd = d._ymd;
    const li = document.createElement("li");

    const row = document.createElement("div");
    row.className = "row";

    const left = document.createElement("div");
    left.className = "left";

    const check = document.createElement("div");
    check.className = "check" + (isRead(ymd) ? " on" : "");
    check.title = "既読";
    check.onclick = (ev) => {
      ev.stopPropagation();
      const now = !isRead(ymd);
      setRead(ymd, now);
      check.className = "check" + (now ? " on" : "");
      updateCounts();
      if (showUnreadOnly) renderList();
    };

    const mainBtn = document.createElement("button");
    mainBtn.className = "rowMain";
    mainBtn.type = "button";
    mainBtn.onclick = () => {
      setQueryDate(ymd);
      setRead(ymd, true);
      renderToday(d);
    };

    const dateDiv = document.createElement("div");
    dateDiv.className = "rowDate";
    const w = d.weekday ? `（${d.weekday}）` : "";
    dateDiv.textContent = `${formatDisplayDate(ymd)} ${w}`.trim();

    const verseDiv = document.createElement("div");
    verseDiv.className = "rowVerse";
    verseDiv.textContent = d.verse || d.title || "";

    mainBtn.appendChild(dateDiv);
    mainBtn.appendChild(verseDiv);

    left.appendChild(check);
    left.appendChild(mainBtn);

    const heart = document.createElement("button");
    heart.className = "heart";
    heart.type = "button";
    heart.textContent = isLiked(ymd) ? "♥" : "♡";
    heart.onclick = (ev) => {
      ev.stopPropagation();
      const now = !isLiked(ymd);
      setLiked(ymd, now);
      setRead(ymd, true);
      heart.textContent = now ? "♥" : "♡";
      updateCounts();
      if (showUnreadOnly) renderList();
      // 今日表示中のハートも同期
      if (selectedYmd === ymd && btnLike) {
        btnLike.textContent = now ? "♥" : "♡";
        btnLike.setAttribute("aria-pressed", now ? "true" : "false");
      }
    };

    row.appendChild(left);
    row.appendChild(heart);
    li.appendChild(row);
    elList.appendChild(li);
  }
}

// ---- load data
async function loadDays() {
  // サーバ仕様が変わっても耐える（配列 / {days:[]} どっちでも）
  const j = await fetchJson("/days?limit=365");
  const arr = Array.isArray(j) ? j : (j.days || j.list || []);
  daysCache = Array.isArray(arr) ? arr : [];
}

async function loadTodayFromCacheOrApi() {
  const q = getQueryDate();
  const todayYmd = ymdLocal(new Date());
  const target = q || todayYmd;

  // daysCacheから探す
  const hit = daysCache.find(d => normalizeDateAny(d.date) === target);
  if (hit) {
    renderToday(hit);
    return;
  }

  // だめなら /today を読む（あなたのWorkerが返す形式に合わせる）
  const t = await fetchJson("/today");
  // /today が単体オブジェクトならそれを使う
  renderToday(t);
}

// ---- install prompt (Android)
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (btnInstall) btnInstall.hidden = false;
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

// ---- events
if (btnPush) btnPush.addEventListener("click", enablePush);

if (btnFilterUnread) btnFilterUnread.addEventListener("click", () => {
  showUnreadOnly = true;
  btnFilterUnread.classList.add("active");
  btnFilterAll.classList.remove("active");
  renderList();
});

if (btnFilterAll) btnFilterAll.addEventListener("click", () => {
  showUnreadOnly = false;
  btnFilterAll.classList.add("active");
  btnFilterUnread.classList.remove("active");
  renderList();
});

window.addEventListener("popstate", () => {
  const q = getQueryDate();
  if (!q) return;
  const hit = daysCache.find(d => normalizeDateAny(d.date) === q);
  if (hit) renderToday(hit);
});

// ---- init
(async function init() {
  if (!WORKER_ORIGIN) {
    if (elPushStatus) elPushStatus.textContent = "設定エラー: WORKER_ORIGIN が空です";
    return;
  }

  const reg = await registerSW();
  await refreshPushUI(reg);

  await loadDays().catch(() => { daysCache = []; });
  updateCounts();

  await loadTodayFromCacheOrApi().catch((e) => {
    if (elTodayVerse) elTodayVerse.textContent = "読み込みに失敗しました";
    if (elTodayComment) elTodayComment.textContent = String(e?.message || e);
  });
})();
