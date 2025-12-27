// app.js
const WORKER_ORIGIN = "https://seishotsudoku-push.teruntyo.workers.dev";

// ★あなたの Worker と同じ VAPID 公開鍵（Public）
const VAPID_PUBLIC_KEY = "BP51V69QOr3LWj2YhzcVO05ojPb9R_VRiMcNciBxPkOXbBtsYZMuJOxgrpVcr755ixYsWK5hVDJLXSgYpTWfM_I";

const elPushBtn = document.getElementById("pushBtn");
const elInstallBtn = document.getElementById("installBtn");
const elPushStatus = document.getElementById("pushStatus");
const elMeta = document.getElementById("todayMeta");
const elVerse = document.getElementById("todayVerse");
const elBtnArea = document.getElementById("btnArea");
const elComment = document.getElementById("todayComment");
const elError = document.getElementById("errorBox");

// ----------------------------
// UI helpers
// ----------------------------
function setError(msg) {
  if (!elError) return;
  elError.style.display = "block";
  elError.textContent = msg;
}
function clearError() {
  if (!elError) return;
  elError.style.display = "none";
  elError.textContent = "";
}
function setPushStatus(msg) {
  if (!elPushStatus) return;
  elPushStatus.textContent = msg;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function isStandalonePWA() {
  // iOS: navigator.standalone / others: display-mode
  return (window.navigator.standalone === true) ||
    window.matchMedia?.("(display-mode: standalone)")?.matches;
}

function supportsPush() {
  return ("serviceWorker" in navigator) && ("PushManager" in window);
}

// ----------------------------
// PWA install prompt (Android/Chrome)
// ----------------------------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (elInstallBtn) elInstallBtn.style.display = "inline-block";
});

if (elInstallBtn) {
  elInstallBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    elInstallBtn.style.display = "none";
  });
}

// ----------------------------
// SW register
// ----------------------------
async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    return reg;
  } catch (e) {
    console.log("SW register failed:", e);
    return null;
  }
}

// ----------------------------
// Push enable
// ----------------------------
async function refreshPushUI() {
  if (!elPushBtn) return;

  // すでに許可済み＆購読済みならボタンを消す
  if (supportsPush()) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (Notification.permission === "granted" && sub) {
        elPushBtn.style.display = "none";
        setPushStatus("✅ 通知は有効です");
        return;
      }
    } catch {}
  }

  // 未購読
  elPushBtn.style.display = "inline-block";
  setPushStatus("");
}

async function enablePush() {
  clearError();
  setPushStatus("準備中…");

  // iPhone/iPad は「ホーム画面に追加」必須ケースがあるので、ここは案内寄りの文言にする
  if (!supportsPush()) {
    setPushStatus("Push通知を有効にするには、ホーム画面に追加して開いてください。");
    return;
  }

  // iOS系でブラウザから開いてるなら案内
  if (!isStandalonePWA() && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    setPushStatus("Push通知を有効にするには、ホーム画面に追加して開いてください。");
    return;
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    setPushStatus("通知が許可されていません。設定で通知をONにしてください。");
    return;
  }

  const reg = await navigator.serviceWorker.ready;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const res = await fetch(WORKER_ORIGIN + "/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });

  const t = await res.text();
  if (!res.ok) {
    setError("subscribe失敗: " + res.status + " " + t);
    setPushStatus("");
    return;
  }

  setPushStatus("✅ 通知は有効です");
  elPushBtn.style.display = "none";
}

// ----------------------------
// Today render
// ----------------------------
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderButtons(buttons) {
  if (!elBtnArea) return;
  elBtnArea.innerHTML = "";

  (buttons || []).forEach((b) => {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.gap = "10px";
    wrap.style.flexWrap = "wrap";

    const a1 = document.createElement("a");
    a1.href = b.prsUrl;
    a1.target = "_blank";
    a1.rel = "noopener";
    a1.textContent = `${b.label}（新改訳2017）`;
    a1.style.cssText = "display:inline-block;padding:10px 14px;border-radius:12px;background:#eef3ff;color:#1a73e8;text-decoration:none;font-weight:800;";

    const a2 = document.createElement("a");
    a2.href = b.lbUrl;
    a2.target = "_blank";
    a2.rel = "noopener";
    a2.textContent = `${b.label}（LB）`;
    a2.style.cssText = "display:inline-block;padding:10px 14px;border-radius:12px;background:#fff2e3;color:#c25a00;text-decoration:none;font-weight:800;";

    wrap.appendChild(a1);
    wrap.appendChild(a2);
    elBtnArea.appendChild(wrap);
  });
}

async function loadToday() {
  clearError();

  const r = await fetch(WORKER_ORIGIN + "/today", { cache: "no-store" });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    setError("読み込みに失敗しました（today）: " + r.status + " " + t);
    return;
  }

  const j = await r.json().catch(() => null);
  if (!j?.ok) {
    setError("読み込みに失敗しました（today）: " + (j?.error || "unknown"));
    return;
  }

  if (elMeta) elMeta.textContent = `${j.date}（${j.weekday}）`;
  if (elVerse) elVerse.textContent = j.verse || "";

  renderButtons(j.buttons || []);

  if (elComment) {
    elComment.textContent = j.comment || "";
  }
}

// ----------------------------
// boot
// ----------------------------
(async function boot() {
  await ensureServiceWorker();
  await refreshPushUI();
  await loadToday();

  if (elPushBtn) elPushBtn.addEventListener("click", enablePush);
})();
// ===== ② 起動時にバッジ＆通知を消す（Android対策） =====
async function clearBadgesAndNotifications() {
  // 1) Service Workerへ「通知を全部閉じて」と依頼
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg?.active) {
        reg.active.postMessage({ type: "CLEAR_NOTIFICATIONS" });
      }
    } catch (e) {
      // 失敗しても無視でOK
    }
  }

  // 2) アプリアイコンの数字（Badge）を消す（対応端末のみ）
  try {
    if ("clearAppBadge" in navigator) {
      await navigator.clearAppBadge();
    } else if ("setAppBadge" in navigator) {
      await navigator.setAppBadge(0);
    }
  } catch (e) {
    // 失敗しても無視でOK
  }
}

// ページ表示時に実行
window.addEventListener("load", clearBadgesAndNotifications);

// アプリに戻ってきた時にも実行（効果高い）
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") clearBadgesAndNotifications();
});
