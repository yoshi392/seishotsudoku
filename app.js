  function renderToday(t) {
    if (!t || !t.date) return;
    const ymd = normalizeDate(t.date) || todayYmdLocal();
    todayYmd = ymd;

    const titleText = t.title || t.verse || "今日の聖句";
    const verseText = t.verse && t.verse !== titleText ? t.verse : "";

    setText(els.todayDate, `${t.date} ${t.weekday || ""}`.trim());
    setText(els.todayTitle, titleText);
    setText(els.todayVerse, verseText);
    setText(els.todayComment, t.comment || "");
    renderButtons(els.todayButtons, t.buttons || []);
    updateTodayButtons(ymd);
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

      const verse = document.createElement("div");
      verse.className = "meta";
      verse.textContent = verseText;

      left.append(meta, title);
      if (verseText) left.append(verse);

      const controls = document.createElement("div");
      controls.className = "controls";

      const btnRead = document.createElement("button");
      btnRead.textContent = isRead(d.ymd) ? "📖 既読" : "📖 未読";
      btnRead.className = "pill";
      btnRead.addEventListener("click", () => {
        const now = !isRead(d.ymd);
        setRead(d.ymd, now);
        renderList();
        updateTodayButtons(todayYmd);
      });

      const btnLike = document.createElement("button");
      btnLike.textContent = isLiked(d.ymd) ? "♥ いいね済" : "♡ いいね";
      btnLike.className = "pill secondary";
      btnLike.addEventListener("click", () => {
        const now = !isLiked(d.ymd);
        setLike(d.ymd, now);
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
