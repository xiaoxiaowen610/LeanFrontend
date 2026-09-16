(function () {
  const cards = Array.from(document.querySelectorAll(".question-card:not(.usage-card)"));
  const mobileMedia = window.matchMedia("(max-width: 700px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = {
    shell: null,
    deck: null,
    progress: null,
    sheet: null,
    sheetTitle: null,
    sheetContent: null,
    visible: [],
    index: 0,
    current: null,
    drag: null,
    animating: false,
    suppressClick: false,
    lastFocus: null,
    closeTimer: null
  };

  document.querySelectorAll("button").forEach((button) => {
    if (!button.type) button.type = "button";
  });

  function setCardOpen(card, open) {
    card.classList.toggle("is-open", open);
    card.classList.toggle("open", open);
    const trigger = card.querySelector('[data-action="toggle-card"]');
    if (trigger) trigger.setAttribute("aria-expanded", String(open));
  }

  function visibleCards() {
    return cards.filter((card) => !card.hidden);
  }

  function getSearchText(card) {
    return card.textContent.replace(/\s+/g, " ").trim().toLowerCase();
  }

  function ensureToolbar() {
    const toolbar = document.querySelector(".toolbar");
    if (!toolbar || !cards.length) return null;

    const hero = toolbar.closest(".hero");
    if (hero && toolbar.parentElement === hero) {
      hero.insertAdjacentElement("afterend", toolbar);
    }
    toolbar.classList.add("study-controls");

    const gradeButtons = Array.from(toolbar.querySelectorAll('[data-action="filter-grade"]'));
    const actionButtons = Array.from(toolbar.querySelectorAll('[data-action]:not([data-action="filter-grade"])'));

    if (!toolbar.querySelector("[data-search-input]")) {
      const search = document.createElement("label");
      search.className = "search-control";
      search.innerHTML = '<span class="sr-only">搜索题目</span><input data-search-input type="search" placeholder="搜索题目、追问或关键词" autocomplete="off"><button class="clear-search" data-action="clear-search" aria-label="清空搜索">×</button>';
      toolbar.prepend(search);
    }

    if (gradeButtons.length && !toolbar.querySelector(".filter-group")) {
      const group = document.createElement("div");
      group.className = "filter-group";
      gradeButtons[0].before(group);
      gradeButtons.forEach((button) => group.appendChild(button));
    }

    if (actionButtons.length && !toolbar.querySelector(".action-group")) {
      const group = document.createElement("div");
      group.className = "action-group";
      actionButtons[0].before(group);
      actionButtons.forEach((button) => group.appendChild(button));
    }

    if (!toolbar.querySelector("[data-results-status]")) {
      const status = document.createElement("div");
      status.className = "results-status";
      status.dataset.resultsStatus = "";
      status.setAttribute("aria-live", "polite");
      toolbar.appendChild(status);
    }

    return toolbar;
  }

  function ensureEmptyState() {
    let empty = document.querySelector("[data-empty-state]");
    if (empty || !cards.length) return empty;

    empty = document.createElement("div");
    empty.className = "empty-state";
    empty.dataset.emptyState = "";
    empty.hidden = true;
    empty.textContent = "没有匹配的题目，换个关键词或筛选条件试试。";
    cards[cards.length - 1].insertAdjacentElement("afterend", empty);
    return empty;
  }

  function currentGrade(toolbar) {
    const active = toolbar && toolbar.querySelector('[data-action="filter-grade"][aria-pressed="true"]');
    return active ? active.dataset.filterGrade || "ALL" : "ALL";
  }

  function applyFilters() {
    if (!cards.length) return;

    const toolbar = document.querySelector(".toolbar.study-controls");
    const query = (document.querySelector("[data-search-input]")?.value || "").trim().toLowerCase();
    const grade = currentGrade(toolbar);
    let shown = 0;

    cards.forEach((card) => {
      const cardGrade = card.dataset.grade || "";
      const gradeMatched = grade === "ALL" || cardGrade === grade;
      const queryMatched = !query || getSearchText(card).includes(query);
      const visible = gradeMatched && queryMatched;
      card.hidden = !visible;
      if (visible) shown += 1;
    });

    const status = document.querySelector("[data-results-status]");
    if (status) status.textContent = `显示 ${shown} / ${cards.length} 题`;

    const empty = ensureEmptyState();
    if (empty) empty.hidden = shown !== 0;

    syncMobileDeck();
    syncMobileFilters();
  }

  function normalizeTriggers() {
    document.querySelectorAll(".head, .question-head").forEach((head) => {
      head.dataset.action = "toggle-card";
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      head.setAttribute("aria-expanded", String(head.closest(".question-card")?.classList.contains("open")));
    });
  }

  function detailContent(card, label) {
    const detail = Array.from(card.querySelectorAll("details")).find((item) => {
      const summary = item.querySelector("summary");
      return summary && summary.textContent.includes(label);
    });
    return detail?.querySelector(".detail-content") || detail || null;
  }

  function appendContent(target, source) {
    if (!source) return;
    Array.from(source.childNodes).forEach((node) => target.appendChild(node.cloneNode(true)));
  }

  function answerSection(title, source) {
    if (!source) return null;
    const section = document.createElement("section");
    section.className = "mobile-answer-section";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const content = document.createElement("div");
    content.className = "mobile-answer-copy";
    appendContent(content, source);
    section.append(heading, content);
    return section;
  }

  function swipeCard(source, index, offset) {
    const card = document.createElement("article");
    card.className = `swipe-card ${offset === 0 ? "is-current" : offset > 0 ? "is-next" : "is-prev"}`;
    card.dataset.cardIndex = String(index);
    card.setAttribute("aria-label", `第 ${index + 1} 题`);
    if (offset !== 0) card.setAttribute("aria-hidden", "true");

    const inner = document.createElement("div");
    inner.className = "swipe-card-inner";
    const front = document.createElement("section");
    front.className = "card-face card-front";
    front.tabIndex = offset === 0 ? 0 : -1;
    front.setAttribute("role", "button");
    front.setAttribute("aria-label", "查看答案");

    const top = document.createElement("div");
    top.className = "swipe-card-topline";
    const rank = document.createElement("span");
    rank.className = "swipe-rank";
    rank.textContent = source.querySelector(".rank")?.textContent.trim() || `#${String(index + 1).padStart(2, "0")}`;
    const grade = document.createElement("span");
    grade.className = "swipe-grade";
    grade.textContent = source.dataset.grade ? `${source.dataset.grade} 级` : "精选题";
    top.append(rank, grade);

    const question = document.createElement("div");
    question.className = "swipe-question";
    question.textContent = source.querySelector(".title, .question-title")?.textContent.trim() || "题目";
    const meta = source.querySelector(".meta")?.cloneNode(true) || document.createElement("div");
    meta.classList.add("swipe-card-meta");
    front.append(top, question, meta);

    const back = document.createElement("section");
    back.className = "card-face card-back";
    back.setAttribute("aria-hidden", "true");
    const backHead = document.createElement("div");
    backHead.className = "swipe-back-header";
    backHead.innerHTML = '<strong>答案精华</strong><button type="button" class="mobile-icon-button" data-action="mobile-flip" aria-label="返回题面" title="返回题面">↻</button>';
    const answer = document.createElement("div");
    answer.className = "swipe-answer-scroll";
    const standard = detailContent(source, "标准答案") || source.querySelector(".answer, .detail-content");
    const analysis = detailContent(source, "答案整体解析") || source.querySelector(".analysis");
    const standardBlock = answerSection("标准答案", standard);
    const analysisBlock = answerSection("答案解析", analysis);
    if (standardBlock) answer.appendChild(standardBlock);
    if (analysisBlock && analysis !== standard) answer.appendChild(analysisBlock);
    if (!answer.childElementCount) answer.textContent = "这道题暂无精华答案，请查看完整解析。";
    const full = document.createElement("button");
    full.type = "button";
    full.className = "mobile-full-answer";
    full.dataset.action = "mobile-full-answer";
    full.textContent = "查看完整解析";
    back.append(backHead, answer, full);
    back.querySelectorAll("button").forEach((button) => { button.tabIndex = -1; });
    inner.append(front, back);
    card.appendChild(inner);
    return card;
  }

  function updateMobileProgress() {
    const total = mobile.visible.length;
    if (mobile.progress) mobile.progress.textContent = total ? `${mobile.index + 1} / ${total}` : "0 / 0";
    const previous = mobile.shell?.querySelector('[data-action="mobile-prev"]');
    const next = mobile.shell?.querySelector('[data-action="mobile-next"]');
    const flip = mobile.shell?.querySelector('.mobile-study-actions [data-action="mobile-flip"]');
    if (previous) previous.disabled = !total || mobile.index === 0;
    if (next) next.disabled = !total || mobile.index === total - 1;
    if (flip) flip.disabled = !total;
  }

  function renderMobileDeck() {
    if (!mobile.deck) return;
    mobile.deck.replaceChildren();
    mobile.animating = false;
    if (!mobile.visible.length) {
      mobile.current = null;
      const empty = document.createElement("div");
      empty.className = "mobile-deck-empty";
      empty.innerHTML = '<strong>没有匹配的题目</strong><span>换个关键词或筛选条件试试。</span><button type="button" data-action="mobile-filter" data-mobile-command="reset">重置筛选</button>';
      mobile.deck.appendChild(empty);
      updateMobileProgress();
      return;
    }
    mobile.current = mobile.visible[mobile.index];
    [-1, 1, 0].forEach((offset) => {
      const index = mobile.index + offset;
      if (index >= 0 && index < mobile.visible.length) mobile.deck.appendChild(swipeCard(mobile.visible[index], index, offset));
    });
    updateMobileProgress();
  }

  function syncMobileDeck() {
    if (!mobile.shell) return;
    const current = mobile.current;
    mobile.visible = visibleCards();
    const preserved = current ? mobile.visible.indexOf(current) : -1;
    mobile.index = preserved >= 0 ? preserved : 0;
    renderMobileDeck();
  }

  function syncMobileFilters() {
    if (!mobile.shell) return;
    const toolbar = document.querySelector(".toolbar.study-controls");
    const query = document.querySelector("[data-search-input]")?.value || "";
    const grade = currentGrade(toolbar);
    const input = mobile.shell.querySelector("[data-mobile-search-input]");
    const result = mobile.shell.querySelector("[data-mobile-results]");
    const filter = mobile.shell.querySelector('[data-action="mobile-filter"]:not([data-mobile-command])');
    if (input && input.value !== query) input.value = query;
    mobile.shell.querySelectorAll('[data-action="filter-grade"]').forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.filterGrade === grade));
    });
    if (result) result.textContent = `筛选后 ${visibleCards().length} 题`;
    if (filter) filter.classList.toggle("has-filter", Boolean(query) || grade !== "ALL");
  }

  function clearUnderCards() {
    mobile.deck?.querySelectorAll(".is-prev, .is-next").forEach((card) => {
      card.classList.remove("is-revealed");
      card.style.removeProperty("transform");
      card.style.removeProperty("opacity");
    });
  }

  function revealCard(direction, progress) {
    clearUnderCards();
    const card = mobile.deck?.querySelector(`[data-card-index="${mobile.index + direction}"]`);
    if (!card) return;
    const amount = Math.min(1, Math.max(0, progress));
    card.classList.add("is-revealed");
    card.style.transform = `translate3d(0, ${12 * (1 - amount)}px, 0) scale(${0.965 + 0.035 * amount})`;
    card.style.opacity = String(0.74 + 0.26 * amount);
  }

  function resetDrag(card) {
    card?.classList.remove("is-dragging", "is-departing");
    card?.style.removeProperty("transform");
    card?.style.removeProperty("opacity");
    clearUnderCards();
  }

  function boundaryResistance(direction) {
    const card = mobile.deck?.querySelector(".is-current");
    if (!card || mobile.animating) return;
    const distance = direction > 0 ? -18 : 18;
    card.style.transform = `translate3d(${distance}px, 0, 0) rotate(${distance / 18}deg)`;
    window.setTimeout(() => resetDrag(card), reducedMotion.matches ? 0 : 130);
  }

  function changeMobileCard(direction) {
    const target = mobile.index + direction;
    if (mobile.animating) return;
    if (target < 0 || target >= mobile.visible.length) {
      boundaryResistance(direction);
      return;
    }
    const card = mobile.deck?.querySelector(".is-current");
    if (!card) return;
    mobile.animating = true;
    revealCard(direction, 1);
    card.classList.remove("is-dragging");
    card.classList.add("is-departing");
    requestAnimationFrame(() => {
      const distance = mobile.deck.clientWidth + 90;
      card.style.transform = `translate3d(${direction > 0 ? -distance : distance}px, 0, 0) rotate(${direction > 0 ? -4 : 4}deg)`;
      card.style.opacity = "0";
    });
    window.setTimeout(() => {
      mobile.index = target;
      renderMobileDeck();
    }, reducedMotion.matches ? 0 : 220);
  }

  function toggleMobileFlip() {
    const card = mobile.deck?.querySelector(".is-current");
    if (!card || mobile.animating) return;
    const flipped = !card.classList.contains("is-flipped");
    card.classList.toggle("is-flipped", flipped);
    const front = card.querySelector(".card-front");
    const back = card.querySelector(".card-back");
    front?.setAttribute("aria-hidden", String(flipped));
    back?.setAttribute("aria-hidden", String(!flipped));
    if (front) front.tabIndex = flipped ? -1 : 0;
    back?.querySelectorAll("button").forEach((button) => { button.tabIndex = flipped ? 0 : -1; });
  }

  function pointerDown(event) {
    const card = event.target.closest(".swipe-card.is-current");
    if (!card || mobile.animating || mobile.sheet?.classList.contains("is-open")) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest("button, a, input, textarea, summary")) return;
    mobile.drag = {
      card,
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      dx: 0,
      velocity: 0,
      axis: null,
      moved: false
    };
    card.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    const drag = mobile.drag;
    if (!drag || drag.id !== event.pointerId) return;
    const rawX = event.clientX - drag.startX;
    const rawY = event.clientY - drag.startY;
    if (!drag.axis && Math.max(Math.abs(rawX), Math.abs(rawY)) >= 8) drag.axis = Math.abs(rawX) > Math.abs(rawY) ? "x" : "y";
    if (drag.axis !== "x") return;
    event.preventDefault();
    const direction = rawX < 0 ? 1 : -1;
    const boundary = mobile.index + direction < 0 || mobile.index + direction >= mobile.visible.length;
    const dx = boundary ? rawX * 0.28 : rawX;
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocity = (event.clientX - drag.lastX) / elapsed;
    drag.lastX = event.clientX;
    drag.lastTime = event.timeStamp;
    drag.dx = dx;
    drag.moved = drag.moved || Math.abs(rawX) > 10;
    const rotation = Math.max(-4, Math.min(4, dx / mobile.deck.clientWidth * 8));
    drag.card.classList.add("is-dragging");
    drag.card.style.transform = `translate3d(${dx}px, 0, 0) rotate(${rotation}deg)`;
    revealCard(direction, Math.abs(dx) / Math.max(1, mobile.deck.clientWidth * 0.22));
  }

  function pointerEnd(event, cancelled) {
    const drag = mobile.drag;
    if (!drag || drag.id !== event.pointerId) return;
    mobile.drag = null;
    if (drag.axis !== "x") return;
    mobile.suppressClick = drag.moved;
    window.setTimeout(() => { mobile.suppressClick = false; }, 0);
    const direction = drag.dx < 0 ? 1 : -1;
    const threshold = Math.max(72, mobile.deck.clientWidth * 0.22);
    const valid = mobile.index + direction >= 0 && mobile.index + direction < mobile.visible.length;
    if (!cancelled && valid && (Math.abs(drag.dx) >= threshold || Math.abs(drag.velocity) >= 0.45)) changeMobileCard(direction);
    else resetDrag(drag.card);
  }

  function closeMobileSheet(restoreFocus = true) {
    if (!mobile.sheet || mobile.sheet.hidden) return;
    mobile.sheet.classList.remove("is-open");
    mobile.sheet.setAttribute("aria-hidden", "true");
    document.body.classList.remove("mobile-sheet-open");
    mobile.shell.querySelectorAll(":scope > .mobile-study-topbar, :scope > .mobile-study-main, :scope > .mobile-study-actions").forEach((region) => { region.inert = false; });
    window.clearTimeout(mobile.closeTimer);
    mobile.closeTimer = window.setTimeout(() => { mobile.sheet.hidden = true; }, reducedMotion.matches ? 0 : 220);
    if (restoreFocus && mobile.lastFocus instanceof HTMLElement) mobile.lastFocus.focus();
  }

  function openMobileSheet(title, content) {
    if (!mobile.sheet) return;
    window.clearTimeout(mobile.closeTimer);
    mobile.lastFocus = document.activeElement;
    mobile.shell.querySelectorAll(":scope > .mobile-study-topbar, :scope > .mobile-study-main, :scope > .mobile-study-actions").forEach((region) => { region.inert = true; });
    mobile.sheetTitle.textContent = title;
    mobile.sheetContent.replaceChildren(content);
    mobile.sheet.hidden = false;
    mobile.sheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("mobile-sheet-open");
    requestAnimationFrame(() => {
      mobile.sheet.classList.add("is-open");
      (content.querySelector("input, button, summary") || mobile.sheet.querySelector('[data-action="mobile-sheet-close"]'))?.focus();
    });
  }

  function filterPanel() {
    const panel = document.createElement("div");
    panel.className = "mobile-filter-panel";
    panel.innerHTML = '<label class="mobile-filter-search"><span>搜索题目</span><input type="search" autocomplete="off" placeholder="题目、追问或关键词" data-mobile-search-input></label>';
    panel.querySelector("input").value = document.querySelector("[data-search-input]")?.value || "";
    const sourceButtons = Array.from(document.querySelectorAll('.toolbar.study-controls [data-action="filter-grade"]'));
    if (sourceButtons.length) {
      const label = document.createElement("span");
      label.className = "mobile-filter-label";
      label.textContent = "题目等级";
      const group = document.createElement("div");
      group.className = "mobile-grade-group";
      sourceButtons.forEach((source) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = "filter-grade";
        button.dataset.filterGrade = source.dataset.filterGrade || "ALL";
        button.setAttribute("aria-pressed", source.getAttribute("aria-pressed") || "false");
        button.textContent = source.textContent.trim();
        group.appendChild(button);
      });
      panel.append(label, group);
    }
    const footer = document.createElement("div");
    footer.className = "mobile-filter-footer";
    footer.innerHTML = `<span data-mobile-results>筛选后 ${visibleCards().length} 题</span><button type="button" data-action="mobile-filter" data-mobile-command="reset">重置筛选</button>`;
    panel.appendChild(footer);
    return panel;
  }

  function resetMobileFilters() {
    const search = document.querySelector("[data-search-input]");
    if (search) search.value = "";
    document.querySelectorAll('[data-action="filter-grade"]').forEach((button) => {
      button.setAttribute("aria-pressed", String((button.dataset.filterGrade || "ALL") === "ALL"));
    });
    applyFilters();
  }

  function openFullAnswer() {
    if (!mobile.current) return;
    const source = mobile.current.querySelector(".body, .question-body") || mobile.current;
    const content = source.cloneNode(true);
    content.classList.add("mobile-full-content");
    openMobileSheet(`第 ${mobile.index + 1} 题 · 完整解析`, content);
  }

  function ensureMobileStudy() {
    if (mobile.shell || !cards.length) return;
    const title = document.querySelector(".hero h1")?.textContent.trim() || document.title.split("｜")[0];
    const back = document.querySelector(".back")?.getAttribute("href") || "index.html";
    const shell = document.createElement("section");
    shell.className = "mobile-study-shell";
    shell.setAttribute("aria-label", `${title} 划卡刷题`);
    shell.innerHTML = `<header class="mobile-study-topbar"><a class="mobile-back-button" href="${back}" aria-label="返回总目录" title="返回总目录">←</a><div class="mobile-study-heading"><strong>${title}</strong><span data-mobile-progress aria-live="polite">0 / 0</span></div><button type="button" class="mobile-filter-button" data-action="mobile-filter">筛选</button></header><main class="mobile-study-main"><div class="swipe-deck" aria-live="polite"></div></main><nav class="mobile-study-actions" aria-label="题目切换"><button type="button" data-action="mobile-prev" aria-label="上一题" title="上一题">←</button><button type="button" data-action="mobile-flip" aria-label="翻转题卡" title="翻转题卡">↻</button><button type="button" data-action="mobile-next" aria-label="下一题" title="下一题">→</button></nav><div class="mobile-sheet-layer" hidden aria-hidden="true"><button type="button" class="mobile-sheet-backdrop" data-action="mobile-sheet-close" aria-label="关闭面板" tabindex="-1"></button><section class="mobile-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-sheet-title"><header><h2 id="mobile-sheet-title"></h2><button type="button" class="mobile-icon-button" data-action="mobile-sheet-close" aria-label="关闭面板" title="关闭面板">×</button></header><div class="mobile-sheet-content"></div></section></div>`;
    document.body.appendChild(shell);
    mobile.shell = shell;
    mobile.deck = shell.querySelector(".swipe-deck");
    mobile.progress = shell.querySelector("[data-mobile-progress]");
    mobile.sheet = shell.querySelector(".mobile-sheet-layer");
    mobile.sheetTitle = shell.querySelector("#mobile-sheet-title");
    mobile.sheetContent = shell.querySelector(".mobile-sheet-content");
    mobile.deck.addEventListener("pointerdown", pointerDown);
    mobile.deck.addEventListener("pointermove", pointerMove, { passive: false });
    mobile.deck.addEventListener("pointerup", (event) => pointerEnd(event, false));
    mobile.deck.addEventListener("pointercancel", (event) => pointerEnd(event, true));
    syncMobileDeck();
  }

  function updateMobileMode() {
    ensureMobileStudy();
    const active = Boolean(mobile.shell && mobileMedia.matches);
    document.body.classList.toggle("mobile-study-active", active);
    if (active) {
      syncMobileDeck();
      syncMobileFilters();
    } else {
      closeMobileSheet(false);
    }
  }

  function trapSheetFocus(event) {
    if (event.key !== "Tab" || !mobile.sheet?.classList.contains("is-open")) return false;
    const items = Array.from(mobile.sheet.querySelectorAll('button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'));
    if (!items.length) return true;
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === items[items.length - 1]) {
      event.preventDefault();
      items[0].focus();
    }
    return true;
  }

  normalizeTriggers();
  const toolbar = ensureToolbar();
  ensureEmptyState();

  if (toolbar) {
    const gradeButtons = Array.from(toolbar.querySelectorAll('[data-action="filter-grade"]'));
    if (gradeButtons.length && !gradeButtons.some((button) => button.getAttribute("aria-pressed") === "true")) {
      gradeButtons[0].setAttribute("aria-pressed", "true");
    }
  }

  document.addEventListener("click", (event) => {
    if (mobile.suppressClick) {
      event.preventDefault();
      return;
    }
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) {
      if (event.target.closest(".swipe-card.is-current .card-front")) toggleMobileFlip();
      return;
    }

    const action = actionTarget.dataset.action;

    if (action === "toggle-card") {
      const card = actionTarget.closest(".question-card");
      if (card) setCardOpen(card, !card.classList.contains("is-open"));
      return;
    }

    if (action === "filter-grade") {
      const selected = actionTarget.dataset.filterGrade || "ALL";
      document.querySelectorAll('[data-action="filter-grade"]').forEach((button) => {
        button.setAttribute("aria-pressed", String((button.dataset.filterGrade || "ALL") === selected));
      });
      applyFilters();
      return;
    }

    if (action === "collapse-visible") {
      visibleCards().forEach((card) => setCardOpen(card, false));
      return;
    }

    if (action === "expand-visible") {
      visibleCards().forEach((card) => setCardOpen(card, true));
      return;
    }

    if (action === "print") {
      window.print();
      return;
    }

    if (action === "clear-search") {
      const input = document.querySelector("[data-search-input]");
      if (input) {
        input.value = "";
        input.focus();
      }
      applyFilters();
      return;
    }

    if (action === "mobile-prev") {
      changeMobileCard(-1);
      return;
    }

    if (action === "mobile-next") {
      changeMobileCard(1);
      return;
    }

    if (action === "mobile-flip") {
      toggleMobileFlip();
      return;
    }

    if (action === "mobile-filter") {
      if (actionTarget.dataset.mobileCommand === "reset") resetMobileFilters();
      else openMobileSheet("筛选题目", filterPanel());
      return;
    }

    if (action === "mobile-full-answer") {
      openFullAnswer();
      return;
    }

    if (action === "mobile-sheet-close") closeMobileSheet();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobile.sheet?.classList.contains("is-open")) {
      event.preventDefault();
      closeMobileSheet();
      return;
    }
    if (trapSheetFocus(event)) return;
    if (event.key !== "Enter" && event.key !== " ") return;

    if (event.target.closest(".swipe-card.is-current .card-front")) {
      event.preventDefault();
      toggleMobileFlip();
      return;
    }
    const trigger = event.target.closest('[data-action="toggle-card"]');
    if (!trigger) return;
    event.preventDefault();
    trigger.click();
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-search-input]")) {
      applyFilters();
      return;
    }
    if (event.target.matches("[data-mobile-search-input]")) {
      const source = document.querySelector("[data-search-input]");
      if (source) source.value = event.target.value;
      applyFilters();
    }
  });

  if (mobileMedia.addEventListener) mobileMedia.addEventListener("change", updateMobileMode);
  else mobileMedia.addListener(updateMobileMode);

  applyFilters();
  updateMobileMode();
})();
