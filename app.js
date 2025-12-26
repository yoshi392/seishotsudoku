const DATA_URL = "./data/readings.json";
const WORKER_BASE_URL = "REPLACE_WITH_WORKER_URL";
const VAPID_PUBLIC_KEY = "BP51V69QOr3LWj2YhzcVO05ojPb9R_VRiMcNciBxPkOXbBtsYZMuJOxgrpVcr755ixYsWK5hVDJLXSgYpTWfM_I";

function jstTodayKey() {
  const now = new Date();
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const y = jst.getFullYear();
  const m = String(jst.getMonth() + 1).padStart(2, "0");
  const d = String(jst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function loadToday() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  const json = await res.json();
  const today = jstTodayKey();

  document.getElementById("today").textContent = `今日：${today}`;

  const item = (json.items || []).find(x => x.date === today);
  const el = document.getElementById("content");

  if (!item) {
    el.innerHTML = `<p>本日のデータがありません（data/readings.json を更新してください）。</p>`;
    return;
  }

  const urls = (item.urls || [])
    .map(u => `<li><a href="${u}" target="_blank" rel="noopener">${u}</a></li>`)
    .join("");

  el.innerHTML = `
    <h2>${escapeHtml(item.passage || "")}</h2>
    <p>曜日：${escapeHtml(item.weekday || "")}</p>
    ${urls ? `<ul>${urls}</ul>` : ""}
    ${item.comment ? `<p><b>コメント：</b>${escapeHtml(item.comment)}</p>` : ""}
  `;
}

function escapeHtml(s){
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    alert("この端末はPush通知に対応していません（iPhoneはホーム画面追加が必要）");
    return;
  }
  if (WORKER_BASE_URL.includes("REPLACE") || VAPID_PUBLIC_KEY.includes("REPLACE")) {
    alert("WORKER_BASE_URL / VAPID_PUBLIC_KEY を設定してください（次の手順で入れます）");
    return;
  }

  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    alert("通知が許可されていません");
    return;
  }

  const reg = await navigator.serviceWorker.register("./sw.js");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  const r = await fetch(`${WORKER_BASE_URL}/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });

  const j = await r.json().catch(() => null);
  if (j?.ok) alert("通知を有効にしました");
  else alert("購読の保存に失敗しました");
}

document.getElementById("btnPush").addEventListener("click", enablePush);
document.getElementById("btnTest").addEventListener("click", loadToday);

loadToday();
