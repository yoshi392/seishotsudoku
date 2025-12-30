(() => {
  const cfg = window.__CONFIG__ || {};
  const API_BASE = (cfg.WORKER_ORIGIN || "").replace(/\/+$/, "") || location.origin;
  const VAPID_KEY = cfg.VAPID_PUBLIC_KEY || "";
  const qs = (id) => document.getElementById(id);
  const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const INSTALLED_KEY = "pwa_installed";

  const els = {
    btnPush: qs("btnPush"),
    pushStatus: qs("pushStatus"),
    btnInstall: qs("btnInstall"),
    btnLike: qs("btnLike"),
    btnTodayRead: qs("btnTodayRead"),
    todayDate: qs("todayDate"),
    todayTitle: qs("todayTitle"),   // 聖書箇所名だけを入れる
    todayVerse: qs("todayVerse"),   // 使わず空にする
    todayButtons: qs("todayButtons"),
    todayComment: qs("todayComment"),
    todayEventLabel: qs("todayEventLabel"),
    btnFilterUnread: qs("btnFilterUnread"),
    btnFilterAll: qs("btnFilterAll"),
    countRead: qs("countRead"),
    countUnread: qs("countUnread"),
    list: qs("list"),
    installHint: qs("installHint"),
    todayLikeCount: qs("todayLikeCount"),
    greeting: qs("greeting"),
  };

  let installPrompt = null;
  let days = [];
  let todayYmd = "";
  let filter = "unread";

  const isStandalone = () =>
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    navigator.standalone === true;

  const setText = (el, v) => { if (el) el.textContent = v ?? ""; };
  const storageKeyRead = (d) => `read:${d}`;
  const storageKeyLike = (d) => `like:${d}`;
  const isRead = (d) => localStorage.getItem(storageKeyRead(d)) === "1";
  const isLiked = (d) => localStorage.getItem(storageKeyLike(d)) === "1";
  const setRead = (d, on) => localStorage.setItem(storageKeyRead(d), on ? "1" : "0");
  const setLike = (d, on) => localStorage.setItem(storageKeyLike(d), on ? "1" : "0");

  function greetingByTime() {
    const h = new Date().getHours();
    if (h < 11) return "おはようございます。";
    if (h < 17) return "こんにちは。";
    return "こんばんは。";
  }
  function setGreeting() { if (els.greeting) els.greeting.textContent = greetingByTime(); }

  function setMultiline(el, text) {
    if (!el) return;
    const lines = String(text || "").split(/\r?\n/);
    while (lines.length && lines[0].trim() === "") lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    el.textContent = "";
    lines.forEach((line, idx) => {
      el.append(document.createTextNode(line));
      if (idx < lines.length - 1) el.append(document.createElement("br"));
    });
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

  async function fetchJson(path) {
    const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
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
      setText(els.pushStatus, "");
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
      .filter((d) => d.ymd < today)
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

    const titleText = t.title || t.verse || "本日の聖書箇所";
    const commentText = (t.comment || "").trim();

    setText(els.todayDate, `${t.date || ymd} ${t.weekday || ""}`.trim());

    // イベント見出し＋コメントを先に
    if (els.todayEventLabel) {
      const base = getComputedStyle(els.todayVerse || document.body);
      els.todayEventLabel.textContent = commentText ? "本日のイベント／スケジュール" : "";
      els.todayEventLabel.style.display = commentText ? "block" : "none";
      els.todayEventLabel.style.fontSize = base.fontSize;
      els.todayEventLabel.style.fontWeight = base.fontWeight;
      els.todayEventLabel.style.color = base.color;
    }
    setMultiline(els.todayComment, commentText);

    // 聖書箇所：見出しを空にし、ここに箇所名だけ表示
    setText(els.todayTitle, titleText);
    setText(els.todayVerse, "");
    if (els.todayVerse) els.todayVerse.style.display = "none";

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

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${d.date} ${d.weekday}`.trim();

      const titleText = d.title || d.verse || "聖書箇所";
      const verseText = d.verse && d.verse !== titleText ? d.verse : "";

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = titleText;

      li.append(meta, title);
      if (verseText) {
        const verse = document.createElement("div");
        verse.className = "meta";
        verse.textContent = verseText;
        li.append(verse);
      }

      if (d.comment) {
        const c = document.createElement("div");
        c.className = "meta";
        setMultiline(c, d.comment);
        li.append(c);
      }

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
        li.append(links);
      }

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

      const likeWrap = document.createElement("div");
      likeWrap.style.display = "flex";
      likeWrap.style.alignItems = "center";
      likeWrap.style.gap = "6px";

      const btnLike = document.createElement("button");
      btnLike.textContent = isLiked(d.ymd) ? "♥ いいね済" : "♡ いいね";
      btnLike.className = "pill secondary";
      btnLike.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const now = !isLiked(d.ymd);
        setLike(d.ymd, now);
        await toggleLike(d.ymd, now);
        if (d.ymd === todayYmd) updateTodayButtons(todayYmd);
        renderList();
      });

      const likeBadge = document.createElement("span");
      likeBadge.className = "meta";
      likeBadge.dataset.likeCount = d.ymd;
      likeBadge.textContent = `♡ ${d.likeCount ?? 0}`;

      likeWrap.append(btnLike, likeBadge);
      controls.append(btnRead, likeWrap);
      li.append(controls);
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
        days = days.map((d) => (d.ymd === date ? { ...d, likeCount: json.likeCount } : d));
        updateLikeCount(date, json.likeCount);
      }
    } catch (e) {}
  }

  function updateLikeCount(date, cnt) {
    if (date === todayYmd && els.todayLikeCount) els.todayLikeCount.textContent = `♡ ${cnt}`;
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

    els.btnLike?.addEventListener("click", async () => {
      if (!todayYmd) return;
      const now = !isLiked(todayYmd);
      setLike(todayYmd, now);
      await toggleLike(todayYmd, now);
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
      if (alreadyInstalled()) return;
      if (installPrompt) {
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        markInstalled();
      } else {
        setText(els.pushStatus, "Chromeメニューの「ホーム画面に追加」からもインストールできます");
      }
    });

    els.btnPush?.addEventListener("click", enablePush);
  }

  function alreadyInstalled() {
    return isStandalone() || localStorage.getItem(INSTALLED_KEY) === "1";
  }
  function markInstalled() { localStorage.setItem(INSTALLED_KEY, "1"); updateInstallUi(); }
  window.addEventListener("appinstalled", () => { markInstalled(); });

  function updateInstallUi() {
    if (!els.btnInstall) return;
    if (alreadyInstalled()) {
      els.btnInstall.style.display = "none";
      if (els.installHint) { els.installHint.textContent = ""; els.installHint.style.display = "none"; }
      return;
    }
    els.btnInstall.style.display = "";
    els.btnInstall.disabled = false;
    els.btnInstall.textContent = "⬇️ アプリをインストール";
    if (els.installHint) {
      if (isIOS()) {
        els.installHint.style.display = "block";
        els.installHint.textContent = "iOSでは「ホーム画面に追加」してから通知を許可してください。";
      } else {
        els.installHint.textContent = "";
        els.installHint.style.display = "none";
      }
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

  function hidePushButton() { if (els.btnPush) els.btnPush.style.display = "none"; }

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
    if (alreadyInstalled()) {
      els.installHint.textContent = "";
      els.installHint.style.display = "none";
    } else if (isIOS()) {
      els.installHint.style.display = "block";
      els.installHint.textContent = "iOSでは「ホーム画面に追加」してから通知を許可してください。";
    } else {
      els.installHint.textContent = "";
      els.installHint.style.display = "none";
    }
  }

  function clearTodayUI() {
    setText(els.todayTitle, "");
    setText(els.todayVerse, "");
    setText(els.todayEventLabel, "");
    setText(els.todayComment, "");
  }

  function init() {
    clearTodayUI();
    resetIfNewYear();
    bindEvents();
    setInstallHint();
    setGreeting();
    updateInstallUi();
    loadData();
    if (Notification?.permission === "granted") hidePushButton();
    registerServiceWorker().catch(() => {});
  }

  document.addEventListener("DOMContentLoaded", init);
})();
