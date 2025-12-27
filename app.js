// app.js (GitHub Pages)

const WORKER_ORIGIN = "https://seishotsudoku-push.teruntyo.workers.dev";

// VAPID 公開鍵（Public Keyだけ）
const VAPID_PUBLIC_KEY = "（あなたの公開鍵）";

const els = {
  install: document.getElementById("btnInstall"),
  btnArea: document.getElementById("btnArea"),
  meta: document.getElementById("todayMeta"),
  verse: document.getElementById("todayVerse"),
  comment: document.getElementById("todayComment"),
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
