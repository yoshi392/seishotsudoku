// app.js（画面表示 + Push購読）
const WORKER_ORIGIN = "https://seishotsudoku-push.teruntyo.workers.dev";
const VAPID_PUBLIC_KEY = "BP51V69QOr3LWj2YhzcVO05ojPb9R_VRiMcNciBxPkOXbBtsYZMuJOxgrpVcr755ixYsWK5hVDJLXSgYpTWfM_I"; // 改行なし！

const elStatus = document.getElementById("pushStatus");
const elToday = document.getElementById("today");
const elContent = document.getElementById("content");
const elLinks = document.getElementById("links");
const elErr = document.getElementById("err");
const btnEnable = document.getElementById("btnEnablePush");

function setStatus(msg) { elStatus.textContent = msg || ""; }
function setErr(msg) { elErr.textContent = msg || ""; }

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function bibleComToPrs(lbUrl) {
  const m = String(lbUrl).trim().match(/\/bible\/\d+\/([0-9A-Z]+)\.([0-9]+)(?:\.([0-9]+))?\.[A-Z]+/i);
  if (!m) return "";
  const book = m[1].toLowerCase();
  const chapter = m[2];
  const verse = m[3];
  return verse
    ? `https://prs.app/ja/bible/${book}.${chapter}.${verse}.jdb`
    : `https://prs.app/ja/bible/${book}.${chapter}.jdb`;
}

async function loadToday() {
  setErr("");
  elContent.innerHTML = "読み込み中…";
  elLinks.innerHTML = "";

  const r = await fetch(`${WORKER_ORIGIN}/today`, { method: "GET" });
  const t = await r.text();
  if (!r.ok) {
    elContent.innerHTML = "";
    setErr(`読み込みに失敗しました\n${r.status}\n${t}`);
    return;
  }

  const data = JSON.parse(t);

  elToday.textContent = data.date ? `日付：${data.date}${data.weekday ? `（${data.weekday}）` : ""}` : "";

  // 表示本文
  const verse = data.verse || "";
  const comment = data.comment || "";
  elContent.innerHTML = `
    <div style="font-size:1.25rem;font-weight:900;margin-bottom:8px;">${escapeHtml(data.title || "今日の聖書箇所")}</div>
    <div style="font-size:1.1rem;line-height:1.7;">
      <div><b>聖書箇所：</b>${escapeHtml(verse)}</div>
      ${comment ? `<div style="margin-top:10px;"><b>今日のコメント：</b><br>${escapeHtml(comment).replace(/\n/g,"<br>")}</div>` : ""}
    </div>
  `;

  // ボタン（新改訳2017 / LB）
  const urls = Array.isArray(data.urls) ? data.urls : [];
  if (urls.length) {
    const btns = urls.map((u, i) => {
      const lb = u;
      const prs = bibleComToPrs(lb) || lb;
      const label = urls.length > 1 ? `聖書(${i+1})` : "聖書";
      return `
        <a href="${escapeHtml(prs)}" target="_blank" rel="noopener"
           style="display:inline-block;padding:10px 12px;border-radius:14px;background:#eef3ff;text-decoration:none;font-weight:900;">
           ${escapeHtml(label)}（新改訳2017）
        </a>
        <a href="${escapeHtml(lb)}" target="_blank" rel="noopener"
           style="display:inline-block;padding:10px 12px;border-radius:14px;background:#f3f3f3;text-decoration:none;font-weight:900;">
           ${escapeHtml(label)}（LB）
        </a>
      `;
    }).join("");

    elLinks.innerHTML = btns;
  }
}

async function getRegistration() {
  // GitHub Pages 配下なので ./sw.js
  return await navigator.serviceWorker.register("./sw.js");
}

async function refreshPushButton() {
  // Push対応チェック
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    btnEnable.style.display = "none";
    setStatus("この端末/ブラウザはPush通知に対応していません");
    return;
  }

  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();

  if (sub) {
    // 既に購読済み → ボタン消す
    btnEnable.style.display = "none";
    setStatus("✅ 通知は有効です");
  } else {
    btnEnable.style.display = "inline-block";
    setStatus("");
  }
}

async function enablePush() {
  try {
    setStatus("準備中…");

    if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.includes("\n")) {
      setStatus("VAPID_PUBLIC_KEY が未設定、または改行が入っています（1行で貼ってください）");
      return;
    }

    const reg = await getRegistration();

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setStatus("通知が許可されませんでした（端末設定で通知をONにしてください）");
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

    const txt = await res.text();
    if (!res.ok) {
      setStatus("subscribe失敗: " + res.status + " " + txt);
      return;
    }

    setStatus("✅ 通知を有効にしました");
    await refreshPushButton(); // 有効化後にボタンを消す
  } catch (e) {
    setStatus("エラー: " + (e?.message || String(e)));
  }
}

btnEnable.addEventListener("click", enablePush);

// 起動時
(async () => {
  await refreshPushButton();
  await loadToday();
})();
