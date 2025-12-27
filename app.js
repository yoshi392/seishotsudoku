// app.js（GitHub Pages 用）
// - CSVから「今日の行」を表示
// - Push購読（有効後はボタンを隠す）
// - Bible buttons: 「バイブルスタディ」「ともに聴く聖書」

const WORKER_ORIGIN = "https://seishotsudoku-push.teruntyo.workers.dev";

// ★「公開しているCSV」のURL（pub?output=csv のほう）
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/1Ue8iKwyo8EMvoI-eCXiWpQ7_nMyRtbNg80SvIv3Y5_Q/pub?gid=1717884447&single=true&output=csv";

// ★ VAPID 公開鍵（改行なしで1行に！）
const VAPID_PUBLIC_KEY =
  "BP51V69QOr3LWj2YhzcVO05ojPb9R_VRiMcNciBxPkOXbBtsYZMuJOxgrpVcr755ixYsWK5hVDJLXSgYpTWfM_I";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const elPushBtn = document.getElementById("btnEnablePush");
const elPushStatus = document.getElementById("pushStatus");
const elViewStatus = document.getElementById("viewStatus");
const elContent = document.getElementById("content");

function setPushStatus(msg) {
  if (elPushStatus) elPushStatus.textContent = msg;
}
function setViewStatus(msg) {
  if (elViewStatus) elViewStatus.textContent = msg;
}

function todayJstYmd() {
  const d = new Date(Date.now() + JST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// ---- CSV parser（Worker側と同等）
function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    const n = csv[i + 1];

    if (inQ) {
      if (c === '"' && n === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (c === '"') {
        inQ = false;
        continue;
      }
      cur += c;
      continue;
    }

    if (c === '"') {
      inQ = true;
      continue;
    }
    if (c === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (c === "\r" && n === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => (x ?? "").trim() !== ""));
}

function splitHeader(rows) {
  const header = rows[0].map((s) => (s ?? "").trim());
  const data = rows.slice(1);
  return { header, data };
}

function normalizeDate(s) {
  const x = String(s || "").replace(/\./g, "/").replace(/-/g, "/");
  const parts = x.split("/").map((p) => p.trim()).filter(Boolean);

  const today = todayJstYmd();
  const [ty] = today.split("-").map(Number);

  if (parts.length === 3) {
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (y && m && d) return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const d = Number(parts[1]);
    if (m && d) return `${ty}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return "";
}

function pickRowForToday(header, data, todayYmd) {
  const dateCol = header.findIndex((h) => ["date", "Date", "日付"].includes(h));
  if (dateCol < 0) return null;
  for (const row of data) {
    const raw = (row?.[dateCol] ?? "").trim();
    if (!raw) continue;
    const norm = normalizeDate(raw);
    if (norm === todayYmd) return row;
  }
  return null;
}

function mapRow(header, row) {
  const get = (...keys) => {
    for (const k of keys) {
      const idx = header.findIndex((h) => h === k);
      if (idx >= 0) return row?.[idx]?.trim() || "";
    }
    return "";
  };

  // GAS版に合わせた列の想定：
  // A:日付 / B:曜日 / C:聖書箇所 / D:URL(複数行) / E:コメント
  return {
    date: get("date", "Date", "日付"),
    youbi: get("youbi", "曜日", "Day"),
    verse: get("verse", "Verse", "reference", "Reference", "聖書箇所"),
    urlText: get("url", "URL", "リンク"),
    comment: get("comment", "Comment", "コメント"),
    title: get("title", "Title", "タイトル"),
  };
}

// bible.com → prs.app（新改訳2017のリンクに寄せる）
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

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderToday(mapped, todayYmd) {
  const urls = String(mapped.urlText || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));

  // ボタンは「最初のURL」を使って作る（複数ある場合は複数セット表示）
  const buttonsHtml = urls.length
    ? urls.map((u) => {
        const prs = bibleComToPrs(u) || u;
        return `
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0;">
            <a href="${esc(prs)}" target="_blank" rel="noopener"
               style="display:inline-block;padding:10px 14px;border-radius:12px;background:#eef3ff;text-decoration:none;font-weight:800;color:#1a73e8;">
              📖 バイブルスタディ
            </a>
            <a href="${esc(u)}" target="_blank" rel="noopener"
               style="display:inline-block;padding:10px 14px;border-radius:12px;background:#fff2e8;text-decoration:none;font-weight:800;color:#b45309;">
              🎧 ともに聴く聖書
            </a>
          </div>
        `;
      }).join("")
    : `<div style="margin:12px 0;color:#666;">リンクがありません。</div>`;

  const title = mapped.title || "今日の聖書箇所";
  const verse = mapped.verse || "";
  const comment = mapped.comment || "";

  elContent.innerHTML = `
    <section style="background:#fff;border-radius:16px;padding:16px;box-shadow:0 6px 20px rgba(0,0,0,.06);">
      <div style="font-weight:900;font-size:1.2rem;margin-bottom:8px;">${esc(title)}</div>
      <div style="color:#333;margin-bottom:10px;">
        <div>${esc(todayYmd)}${mapped.youbi ? `（${esc(mapped.youbi)}）` : ""}</div>
        ${verse ? `<div style="margin-top:8px;font-size:1.15rem;line-height:1.7;"><b>聖書箇所：</b>${esc(verse)}</div>` : ""}
      </div>

      ${buttonsHtml}

      ${comment ? `
        <hr style="border:none;border-top:1px solid #eee;margin:12px 0;">
        <div style="font-weight:800;color:#555;margin-bottom:6px;">今日のコメント</div>
        <div style="white-space:pre-wrap;line-height:1.75;">${esc(comment)}</div>
      ` : ""}
    </section>
  `;
}

// ---- 表示：CSVを読んで今日の行を描画
async function loadToday() {
  setViewStatus("読み込み中…");
  try {
    const r = await fetch(CSV_URL, { cache: "no-store" });
    if (!r.ok) {
      setViewStatus(`読み込みに失敗しました（CSV fetch failed: ${r.status}）`);
      return;
    }
    const csv = await r.text();
    const rows = parseCsv(csv);
    if (!rows.length) {
      setViewStatus("CSVが空でした");
      return;
    }

    const { header, data } = splitHeader(rows);
    const today = todayJstYmd();
    const picked = pickRowForToday(header, data, today) ?? data[0];
    const mapped = mapRow(header, picked);

    renderToday(mapped, today);
    setViewStatus("");
  } catch (e) {
    setViewStatus("読み込みに失敗しました（例外）");
    console.log(e);
  }
}

// ---- Push：状態確認（有効ならボタンを隠す）
async function refreshPushUi() {
  if (!elPushBtn) return;

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // 非対応端末はここでボタンを消してOK（あなたの希望：注意文も出さない）
    elPushBtn.style.display = "none";
    setPushStatus("");
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();

    if (Notification.permission === "granted" && sub) {
      elPushBtn.style.display = "none";
      setPushStatus("✅ 通知：有効");
    } else {
      elPushBtn.style.display = "inline-block";
      setPushStatus("");
    }
  } catch (e) {
    // SW登録に失敗しても画面は表示させる
    console.log("SW register error:", e);
  }
}

async function enablePush() {
  setPushStatus("準備中…");

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    setPushStatus("この端末/ブラウザはPush通知に対応していません");
    return;
  }
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.includes("\n")) {
    setPushStatus("VAPID公開鍵が不正です（改行が入っていないか確認）");
    return;
  }

  await navigator.serviceWorker.register("./sw.js");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    setPushStatus("通知が許可されませんでした");
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

  const t = await res.text().catch(() => "");
  if (!res.ok) {
    setPushStatus(`subscribe失敗: ${res.status} ${t}`);
    return;
  }

  elPushBtn.style.display = "none";
  setPushStatus("✅ 通知：有効");
}

if (elPushBtn) elPushBtn.addEventListener("click", enablePush);

// 起動
loadToday();
refreshPushUi();
