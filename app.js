(() => {
  const cfg = window.__CONFIG__ || {};
  const API_BASE = (cfg.WORKER_ORIGIN || "").replace(/\/+$/, "") || location.origin;
  const VAPID_KEY = cfg.VAPID_PUBLIC_KEY || "";
  const qs = (id) => document.getElementById(id);
  const isIOS = () => /iPhone|iPad|iPod/i.test(window.navigator.userAgent);

  const els = {
    btnPush: qs("btnPush"),
    pushStatus: qs("pushStatus"),
    btnInstall: qs("btnInstall"),
    btnLike: qs("btnLike"),
    btnTodayRead: qs("btnTodayRead"),
    todayDate: qs("todayDate"),
    todayTitle: qs("todayTitle"),
    todayVerse: qs("todayVerse"),
    todayButtons: qs("todayButtons"),
    todayComment: qs("todayComment"),
    btnFilterUnread: qs("btnFilterUnread"),
    btnFilterAll: qs("btnFilterAll"),
    countRead: qs("countRead"),
    countUnread: qs("countUnread"),
    list: qs("list"),
    installHint: qs("installHint"), // index.html 側で <div id="installHint"></div> を置いておく
    todayLikeCount: qs("todayLikeCount"), // いいね数表示場所（任意）
  };

  let installPrompt = null;
  let days = [];
  let todayYmd = "";
  let filter = "unread";

  const isStandalone = () =>
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;

  function resetIfNewYear() {
    const nowYear = String(new Date().getFullYear());
    const key = "lastYear";
    const saved = localStorage.getItem(key);
    if (saved === nowYear) return;
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("read:") || k.startsWith("like:"))) toDelete.push(k);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem(key, nowYear);
  }

  function storageKeyRead(ymd) { return `read:${ymd}`; }
  function storageKeyLike(ymd) { return `like:${ymd}`; }
  function isRead(ymd) { return localStorage.getItem(storageKeyRead(ymd)) === "1"; }
  function isLiked(ymd) { return localStorage.getItem(storageKeyLike(ymd)) === "1"; }
  function setRead(ymd, on) { localStorage.setItem(storageKeyRead(ymd), on ? "1" : "0"); }
  function setLike(ymd, on) { localStorage.setItem(storageKeyLike(ymd), on ? "1" : "0"); }
  function setText(el, value) { if (el) el.textContent = value ?? ""; }

  async function fetchJson(path) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const msg = `${res.status} ${res.statusText}`;
      setText(els.pushStatus, `データ取得に失敗しました: ${msg}`);
      throw new Error(msg);
    }
    return res.json();
  }

  function normalizeDate(v) {
    const m = String(v || "").trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (!m) return "";
    return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  function todayYmdLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function loadData() {
    try {
      const [todayRes, daysRes] = await Promise.all([
        fetchJson("/today"),
        fetchJson("/days?limit=365"),
      ]);
      const daysArr = Array.isArray(daysRes) ? daysRes : daysRes.days || [];
      days = sanitizeDays(daysArr);
      if (todayRes?.date) todayYmd = normalizeDate(todayRes.date) || todayYmdLocal();

      renderToday(todayRes);
      renderList();
    } catch (e) {
      setText(els.pushStatus, `データ取得に失敗しました: ${e.message}`);
    }
  }

  function sanitizeDays(arr) {
    const today = todayYmdLocal();
    return (arr || [])
      .map((d) => {
        const ymd = normalizeDate(d.ymd || d.date);
        if (!ymd) return null;
        return {
          ymd,
          date: d.date || ymd.replaceAll("-", "/"),
          weekday: d.weekday || "",
          title: d.title || d.verse || "今日の聖句",
          verse: d.verse || "",
          comment: d.comment || "",
          buttons: normalizeButtons(d.buttons, d.urls, d.title || d.verse),
          likeCount: d.likeCount ?? 0,
        };
      })
      .filter(Boolean)
      .filter((d) => d.ymd <= today)
      .sort((a, b) => (a.ymd < b.ymd ? 1 : -1));
  }

  function normalizeButtons(buttons, urls, label) {
    if (Array.isArray(buttons) && buttons.length) return buttons;
    if (!Array.isArray(urls)) return [];
    const text = label || "聖句";
    return urls.map((u, i) => ({
      label: `${text}${urls.length > 1 ? `(${i + 1})` : ""}`,
      prsUrl: u,
      lbUrl: u,
    }));
  }

  function renderToday(t) {
    if (!t) return;
    const ymd = normalizeDate(t.date) || todayYmdLocal();
    todayYmd = ymd;

    const titleText = t.title || t.verse || "今日の聖句";
    const verseText = t.verse && t.verse !== titleText ? t.verse : "";

    setText(els.todayDate, `${t.date || ymd} ${t.weekday || ""}`.trim());
    setText(els.todayTitle, titleText);
    setText(els.todayVerse, verseText);
    if (els.todayVerse) els.todayVerse.style.display = verseText ? "block" : "none";
    setText(els.todayComment, t.comment || "");
    renderButtons(els.todayButtons, t.buttons || []);
    if (els.todayLikeCount) els.todayLikeCount.textContent = `♡ ${t.likeCount ?? 0}`;
    updateTodayButtons(ymd);
  }

  function renderButtons(container, buttons) {
    if (!container) return;
    container.innerHTML = "";
    (buttons || []).forEach((b) => {
      const a = document.createElement("a");
      a.href = b.prsUrl || b.lbUrl || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = b.label || "リンク";
      if (/LB/i.test(b.label || "")) a.classList.add("lb");
      container.appendChild(a);
    });
  }

  function renderList() {
    if (!els.list) return;
    els.list.innerHTML = "";
    const filtered = filter === "unread" ? days.filter((d) => !isRead(d.ymd)) : days;

    filtered.forEach((d) => {
      const li = document.createElement("li");
      li.className = "item";

      const left = document.createElement("div");
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${d.date} ${d.weekday}`.trim();

      const titleText = d.title || d.verse || "聖書箇所";
      const verseText = d.verse && d.verse !== titleText ? d.verse : "";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = titleText;

      left.append(meta, title);
      if (verseText) {
        const verse = document.createElement("div");
        verse.className = "meta";
        verse.textContent = verseText;
        left.append(verse);
      }

      // リンクボタンをリストにも表示
      if (d.buttons && d.buttons.length) {
        const links = document.createElement("div");
        links.className = "link-buttons";
        d.buttons.forEach((b) => {
          const a = document.createElement("a");
          a.href = b.prsUrl || b.lbUrl || "#";
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = b.label || "リンク";
          if (/LB/i.test(b.label || "")) a.classList.add("lb");
          links.appendChild(a);
        });
        left.append(links);
      }

      // いいね数バッジ
      const likeBadge = document.createElement("div");
      likeBadge.className = "meta";
      likeBadge.dataset.likeCount = d.ymd;
      likeBadge.textContent = `♡ ${d.likeCount ?? 0}`;
      left.append(likeBadge);

      const primaryLink =
        (d.buttons && d.buttons[0] && (d.buttons[0].prsUrl || d.buttons[0].lbUrl)) || "";
      if (primaryLink) {
        li.style.cursor = "pointer";
        li.addEventListener("click", (e) => {
          if (e.target.tagName === "BUTTON" || e.target.tagName === "A") return;
          window.open(primaryLink, "_blank", "noopener");
        });
      }

      const controls = document.createElement("div");
      controls.className = "controls";

      const btnRead = document.createElement("button");
      btnRead.textContent = isRead(d.ymd) ? "📖 既読" : "📖 未読";
      btnRead.className = "pill";
      btnRead.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const now = !isRead(d.ymd);
        setRead(d.ymd, now);
        renderList();
        updateTodayButtons(todayYmd);
      });

      const btnLike = document.createElement("button");
      btnLike.textContent = isLiked(d.ymd) ? "♥ いいね済" : "♡ いいね";
      btnLike.className = "pill secondary";
      btnLike.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const now = !isLiked(d.ymd);
        setLike(d.ymd, now);
        toggleLike(d.ymd, now);
        renderList();
        if (d.ymd === todayYmd) updateTodayButtons(todayYmd);
      });

      controls.append(btnRead, btnLike);
      li.append(left, controls);
      els.list.appendChild(li);
    });

    const readCount = days.filter((d) => isRead(d.ymd)).length;
    const unreadCount = days.length - readCount;
    setText(els.countRead, readCount);
    setText(els.countUnread, unreadCount);
  }

  function updateTodayButtons(ymd) {
    if (els.btnTodayRead) els.btnTodayRead.textContent = isRead(ymd) ? "✔️ 既読済み" : "✔️ 既読にする";
    if (els.btnLike) els.btnLike.textContent = isLiked(ymd) ? "♥ いいね済" : "♡ いいね";
  }

  // サーバにいいね増減を送る（/like を実装済み前提）
  async function toggleLike(date, nowOn) {
    setLike(date, nowOn);
    try {
      const delta = nowOn ? 1 : -1;
      const res = await fetch(`${API_BASE}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, delta }),
      });
      const json = await res.json();
      if (json.likeCount !== undefined) {
        updateLikeCount(date, json.likeCount);
      }
    } catch (e) {
      // サーバ失敗時はローカルだけ保持
    }
  }

  function updateLikeCount(date, cnt) {
    if (date === todayYmd && els.todayLikeCount) {
      els.todayLikeCount.textContent = `♡ ${cnt}`;
    }
    const badge = document.querySelector(`[data-like-count="${date}"]`);
    if (badge) badge.textContent = `♡ ${cnt}`;
  }

  function bindEvents() {
    els.btnFilterUnread?.addEventListener("click", () => {
      filter = "unread";
      els.btnFilterUnread.classList.add("active");
      els.btnFilterAll?.classList.remove("active");
      renderList();
    });
    els.btnFilterAll?.addEventListener("click", () => {
      filter = "all";
      els.btnFilterAll.classList.add("active");
      els.btnFilterUnread?.classList.remove("active");
      renderList();
    });

    els.btnLike?.addEventListener("click", () => {
      if (!todayYmd) return;
      const now = !isLiked(todayYmd);
      setLike(todayYmd, now);
      toggleLike(todayYmd, now);
      updateTodayButtons(todayYmd);
      renderList();
    });
    els.btnTodayRead?.addEventListener("click", () => {
      if (!todayYmd) return;
      const now = !isRead(todayYmd);
      setRead(todayYmd, now);
      updateTodayButtons(todayYmd);
      renderList();
    });

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      installPrompt = e;
      updateInstallUi();
    });

    els.btnInstall?.addEventListener("click", async () => {
      if (isStandalone()) return;
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        updateInstallUi();
      } else {
        setText(els.pushStatus, "iOSは共有→ホーム画面に追加でインストールできます");
      }
    });

    els.btnPush?.addEventListener("click", enablePush);
  }

  function updateInstallUi() {
    if (!els.btnInstall) return;
    if (isStandalone()) {
      els.btnInstall.disabled = true;
      els.btnInstall.textContent = "インストール済み";
    } else if (installPrompt) {
      els.btnInstall.disabled = false;
      els.btnInstall.textContent = "⬇️ アプリをインストール";
    } else {
      els.btnInstall.disabled = false;
      els.btnInstall.textContent = "⬇️ アプリをインストール";
    }
  }

  async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setText(els.pushStatus, "Push非対応のブラウザです");
      return;
    }
    try {
      setText(els.pushStatus, "準備中…");
      const reg = await registerServiceWorker();
      if (Notification.permission === "granted") {
        const sub = (await reg.pushManager.getSubscription()) || (await subscribe(reg));
        await sendSub(sub);
        setText(els.pushStatus, "通知を登録しました");
        hidePushButton();
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setText(els.pushStatus, "通知が許可されませんでした");
        return;
      }
      const sub = await subscribe(reg);
      await sendSub(sub);
      setText(els.pushStatus, "通知を登録しました");
      hidePushButton();
    } catch (e) {
      setText(els.pushStatus, `通知設定に失敗: ${e.message}`);
    }
  }

  async function subscribe(reg) {
    return reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
    });
  }

  async function sendSub(sub) {
    await fetch(`${API_BASE}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub),
    });
  }

  function hidePushButton() {
    if (els.btnPush) els.btnPush.style.display = "none";
  }

  function registerServiceWorker() {
    return Promise.race([
      navigator.serviceWorker.register("./sw.js"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("ServiceWorker timeout")), 6000)),
    ]);
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
    return output;
  }

  function setInstallHint() {
    if (!els.installHint) return;
    els.installHint.textContent = isIOS()
      ? "iOSでは「ホーム画面に追加」してから通知を許可してください。"
      : "";
  }

  function init() {
    resetIfNewYear();
    bindEvents();
    setInstallHint();
    updateInstallUi();
    loadData();
    if (Notification?.permission === "granted") hidePushButton();
    registerServiceWorker().catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", init);
})();
