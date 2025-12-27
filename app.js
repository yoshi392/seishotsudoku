// app.js

// ★あなたのWorker
const WORKER_ORIGIN = "https://seishotsudoku-push.teruntyo.workers.dev";

// ★VAPID 公開鍵（改行なしで1行にしてください）
const VAPID_PUBLIC_KEY = "BP51V69QOr3LWj2YhzcVO05ojPb9R_VRiMcNciBxPkOXbBtsYZMuJOxgrpVcr755ixYsWK5hVDJLXSgYpTWfM_I";

const elPushBtn = document.getElementById("btnEnablePush");
const elPushStatus = document.getElementById("pushStatus");
const elMeta = document.getElementById("todayMeta");
const elVerse = document.getElementById("todayVerse");
const elBtnArea = document.getElementById("btnArea");
const elComment = document.getElementById("todayComment");
const elError = document.getElementById("errorBox");

function setPushStatus(msg) {
  elPushStatus.textContent = msg || "";
}

function setError(msg) {
  elError.textContent = msg || "";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function buildButtons(buttons) {
  elBtnArea.innerHTML = "";
  if (!Array.isArray(buttons) || buttons.length === 0) return;

  for (const b of buttons) {
    const label = b.label || "聖書";
    const prsUrl = b.prsUrl || "";
    const lbUrl = b.lbUrl || "";

    if (prsUrl) {
      const a = document.createElement("a");
      a.href = prsUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = `${label}（新改訳2017）`;
      a.style.cssText = "display:inline-block;padding:10px 14px;border-radius:12px;background:#eef3ff;text-decoration:none;font-weight:800;color:#1a73e8;";
      elBtnArea.appendChild(a);
    }

    if (lbUrl) {
      const a = document.createElement("a");
      a.href = lbUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = `${label}（LB）`;
      a.style.cssText = "display:inline-block;padding:10px 14px;border-radius:12px;background:#fff3e6;text-decoration:none;font-weight:800;color:#b35a00;";
      elBtnArea.appendChild(a);
    }
  }
}

async function loadToday() {
  setError("");

  // ?date=YYYY-MM-DD があればそれも渡せる（Worker側が対応していれば使われます）
  const params = new URLSearchParams(location.search);
  const date = params.get("date");
  const url = date ? `${WORKER_ORIGIN}/today?date=${encodeURIComponent(date)}` : `${WORKER_ORIGIN}/today`;

  const res = await fetch(url, { cache: "no-store" });
  const txt = await res.text();
  if (!res.ok) {
    setError(`読み込みに失敗しました: ${res.status}\n${txt}`);
    return;
  }

  const data = JSON.parse(txt);

  if (!data.ok) {
    setError(`読み込みに失敗しました\n${data.error || ""}`);
    return;
  }

  elMeta.textContent = `${data.date || ""}（${data.weekday || ""}）`;
  elVerse.textContent = data.verse || "";
  elComment.textContent = data.comment || "";

  buildButtons(data.buttons || []);
}

async function refreshPushButtonState() {
  // SW対応確認
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    elPushBtn.style.display = "none";
    setPushStatus("この端末/ブラウザはPush通知に対応していません。");
    return;
  }

  // 既に許可されてなければボタンは出す
  if (Notification.permission !== "granted") {
    elPushBtn.style.display = "";
    setPushStatus("");
    return;
  }

  // 既に購読済みならボタン消す
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      elPushBtn.style.display = "none";
      setPushStatus("✅ 通知は有効です");
    } else {
      elPushBtn.style.display = "";
      setPushStatus("");
    }
  } catch {
    elPushBtn.style.display = "";
    setPushStatus("");
  }
}

async function enablePush() {
  setPushStatus("準備中…");
  setError("");

  // SW登録（GitHub Pages配下なので ./sw.js）
  const reg = await navigator.serviceWorker.register("./sw.js");

  // 権限要求
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    setPushStatus("通知が許可されませんでした（端末の設定をご確認ください）");
    return;
  }

  // 購読作成
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  // Workerへ保存
  const res = await fetch(WORKER_ORIGIN + "/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });

  const t = await res.text();
  if (!res.ok) {
    setPushStatus(`subscribe失敗: ${res.status} ${t}`);
    return;
  }

  setPushStatus("✅ 通知は有効です");
  elPushBtn.style.display = "none";
}

document.addEventListener("DOMContentLoaded", async () => {
  // 画面表示
  await loadToday();

  // Push状態反映
  await refreshPushButtonState();

  // ボタン
  elPushBtn.addEventListener("click", enablePush);
});
