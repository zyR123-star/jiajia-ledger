(() => {
  "use strict";

  const DB_NAME = "jiajia-ledger-local";
  const DB_VERSION = 1;
  const STORE = "transactions";
  const APP_VERSION = 2;
  const CLOUD_CACHE_KEY = "jiajia-visible-transactions-v1";
  const PROFILE_CACHE_KEY = "jiajia-cloud-profile-v1";

  const EXPENSE_CATEGORIES = [
    { id: "exp-food", name: "餐饮", mark: "餐", color: "#ff8fba", soft: "#fff0f6", ink: "#b75c83" },
    { id: "exp-transport", name: "交通", mark: "行", color: "#71cfb9", soft: "#e9fbf7", ink: "#238f78" },
    { id: "exp-shopping", name: "购物", mark: "购", color: "#ffd56a", soft: "#fff6dd", ink: "#916500" },
    { id: "exp-daily", name: "日用", mark: "日", color: "#8ea0ff", soft: "#edf0ff", ink: "#4f6ef7" },
    { id: "exp-fun", name: "娱乐", mark: "娱", color: "#b78cff", soft: "#f4edff", ink: "#7552b8" },
    { id: "exp-study", name: "学习", mark: "学", color: "#62b7e9", soft: "#eaf5ff", ink: "#287ab2" },
    { id: "exp-health", name: "健康", mark: "健", color: "#f27b76", soft: "#fff0f0", ink: "#c45156" },
    { id: "exp-home", name: "房租", mark: "房", color: "#9d8bea", soft: "#f0edff", ink: "#6854bd" },
    { id: "exp-gift", name: "人情", mark: "礼", color: "#ff9d78", soft: "#fff2ea", ink: "#ad6039" },
    { id: "exp-other", name: "其他", mark: "其", color: "#a69cac", soft: "#f2f0f4", ink: "#716779" }
  ];

  const INCOME_CATEGORIES = [
    { id: "inc-allowance", name: "生活费", mark: "生", color: "#71cfb9", soft: "#e9fbf7", ink: "#238f78" },
    { id: "inc-salary", name: "工资", mark: "薪", color: "#8ea0ff", soft: "#edf0ff", ink: "#4f6ef7" },
    { id: "inc-parttime", name: "兼职", mark: "兼", color: "#62b7e9", soft: "#eaf5ff", ink: "#287ab2" },
    { id: "inc-gift", name: "红包", mark: "红", color: "#ff8fba", soft: "#fff0f6", ink: "#b75c83" },
    { id: "inc-refund", name: "退款", mark: "退", color: "#ffd56a", soft: "#fff6dd", ink: "#916500" },
    { id: "inc-other", name: "其他", mark: "其", color: "#a69cac", soft: "#f2f0f4", ink: "#716779" }
  ];

  const CATEGORIES = {
    expense: EXPENSE_CATEGORIES,
    income: INCOME_CATEGORIES
  };
  const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
  const ACCOUNTS = ["微信", "支付宝", "银行卡", "现金"];
  const PARTNER_LABEL = "多多";

  const state = {
    view: "home",
    month: startOfMonth(new Date()),
    filter: "all",
    ownerFilter: "all",
    search: "",
    transactions: [],
    mode: "local",
    cloudSession: null,
    profile: null,
    partner: null,
    cloudOffline: false,
    cloudBusy: false,
    cloudMessage: "",
    cloudMessageType: "",
    editingId: null,
    readOnly: false,
    saving: false,
    draftType: "expense",
    draftCategory: EXPENSE_CATEGORIES[0].id,
    draftAccount: "微信",
    draftVisibility: "private",
    draftTransactionId: null
  };

  let db;
  let toastTimer;
  let syncTimer;

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindEvents();
    setInitialView();
    renderMonthLabels();

    try {
      db = await openDatabase();
      state.transactions = await dbGetAll();
      requestPersistentStorage();
    } catch (error) {
      console.error(error);
      showToast("账本暂时无法打开，请刷新重试");
    }

    if (window.JiajiaCloud?.configured()) {
      try {
        state.cloudSession = await window.JiajiaCloud.restoreSession();
        if (state.cloudSession) {
          const cachedProfile = readProfileCache();
          state.profile = cachedProfile.profile;
          state.partner = cachedProfile.partner;
          await connectCloud({ silent: true, sessionReady: true });
        }
      } catch (error) {
        console.warn("Cloud session restore failed", error);
        if (isAuthSessionError(error)) {
          state.cloudMessage = "登录状态已失效，请重新登录";
          state.cloudMessageType = "error";
        } else {
          const cachedProfile = readProfileCache();
          state.mode = "cloud";
          state.cloudOffline = true;
          state.profile = cachedProfile.profile;
          state.partner = cachedProfile.partner;
          state.transactions = readCloudCache();
          state.cloudMessage = "暂时无法连接共享服务，正在显示缓存";
          state.cloudMessageType = "";
        }
      }
    }

    renderAll();
    registerServiceWorker();
  }

  function cacheElements() {
    [
      "heroMonthLabel", "statsMonthLabel", "monthExpense", "monthIncome", "monthBalance",
      "recentList", "ledgerCount", "ledgerSearch", "ledgerFilter", "ledgerList",
      "statsDonut", "statsTotal", "statsIncome", "statsBalance", "categoryRank",
      "trendChart", "recordSummary", "storageSummary", "exportJsonButton",
      "importButton", "importInput", "exportCsvButton", "headerAddButton", "ownerFilter",
      "tabAddButton", "sheetLayer", "sheetBackdrop", "sheetClose", "sheetEyebrow",
      "sheetTitle", "transactionForm", "typeSwitch", "amountInput", "categoryGrid",
      "accountChips", "dateInput", "noteInput", "deleteButton", "saveButton", "toast",
      "cloudPanel", "ledgerModeLabel", "syncModeLabel", "readonlyBanner",
      "visibilitySection", "visibilitySwitch", "editSheet"
    ].forEach((id) => {
      elements[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    document.querySelectorAll("[data-month]").forEach((button) => {
      button.addEventListener("click", () => {
        const offset = Number(button.dataset.month);
        state.month = new Date(state.month.getFullYear(), state.month.getMonth() + offset, 1);
        renderAll();
      });
    });

    document.querySelectorAll("[data-quick]").forEach((button) => {
      button.addEventListener("click", () => openSheet(button.dataset.quick));
    });

    elements.headerAddButton.addEventListener("click", () => openSheet("expense"));
    elements.tabAddButton.addEventListener("click", () => openSheet("expense"));
    elements.sheetClose.addEventListener("click", closeSheet);
    elements.sheetBackdrop.addEventListener("click", closeSheet);
    elements.transactionForm.addEventListener("submit", saveTransaction);
    elements.deleteButton.addEventListener("click", deleteCurrentTransaction);
    elements.visibilitySwitch.addEventListener("click", (event) => {
      const button = event.target.closest("[data-visibility]");
      if (!button || state.readOnly) return;
      state.draftVisibility = button.dataset.visibility;
      renderVisibilityChoices();
    });

    elements.typeSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("[data-type]");
      if (!button) return;
      state.draftType = button.dataset.type;
      if (!CATEGORIES[state.draftType].some((item) => item.id === state.draftCategory)) {
        state.draftCategory = CATEGORIES[state.draftType][0].id;
      }
      renderSheetChoices();
      updateSheetCopy();
    });

    elements.categoryGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.draftCategory = button.dataset.category;
      renderSheetChoices();
    });

    elements.accountChips.addEventListener("click", (event) => {
      const button = event.target.closest("[data-account]");
      if (!button) return;
      state.draftAccount = button.dataset.account;
      renderSheetChoices();
    });

    elements.amountInput.addEventListener("input", normalizeAmountInput);
    elements.amountInput.addEventListener("blur", finishAmountInput);
    elements.ledgerSearch.addEventListener("input", () => {
      state.search = elements.ledgerSearch.value.trim().toLowerCase();
      renderLedger();
    });

    elements.ledgerFilter.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      state.filter = button.dataset.filter;
      elements.ledgerFilter.querySelectorAll("button").forEach((item) => {
        item.classList.toggle("is-on", item === button);
      });
      renderLedger();
    });

    elements.ownerFilter.addEventListener("click", (event) => {
      const button = event.target.closest("[data-owner-filter]");
      if (!button) return;
      state.ownerFilter = button.dataset.ownerFilter;
      renderLedger();
    });

    elements.recentList.addEventListener("click", editFromList);
    elements.ledgerList.addEventListener("click", editFromList);
    elements.exportJsonButton.addEventListener("click", exportBackup);
    elements.exportCsvButton.addEventListener("click", exportCsv);
    elements.importButton.addEventListener("click", () => elements.importInput.click());
    elements.importInput.addEventListener("change", importBackup);
    elements.cloudPanel.addEventListener("click", handleCloudAction);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.sheetLayer.hidden) closeSheet();
    });
    window.addEventListener("hashchange", setInitialView);
    window.addEventListener("focus", () => {
      if (state.mode === "cloud") {
        refreshCloudProfile(false);
        refreshCloudTransactions(false);
      }
    });
    window.addEventListener("beforeunload", () => {
      window.clearInterval(syncTimer);
      if (db) db.close();
    });
  }

  async function connectCloud({ silent = false, sessionReady = false } = {}) {
    if (!window.JiajiaCloud?.configured()) return;
    if (!sessionReady) state.cloudSession = await window.JiajiaCloud.restoreSession();
    if (!state.cloudSession) return;
    const { own, partner } = await window.JiajiaCloud.getProfile();
    if (!own) throw new Error("没有找到账户档案，请先执行 supabase/schema.sql");
    state.profile = own;
    state.partner = partner;
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ profile: own, partner }));
    state.mode = "cloud";
    state.cloudMessage = "";
    state.cloudMessageType = "";
    await refreshCloudTransactions(false);
    startCloudSync();
    if (!silent) showToast(partner ? `已连接 ${PARTNER_LABEL}` : "共享账本已连接");
    renderAll();
  }

  async function refreshCloudTransactions(notify = true) {
    if (state.mode !== "cloud" || !state.cloudSession) return;
    try {
      const rows = await window.JiajiaCloud.listTransactions();
      state.transactions = (rows || []).map(normalizeCloudTransaction);
      localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(state.transactions));
      state.cloudOffline = false;
      if (notify) renderAll();
      else renderSyncedDataViews();
    } catch (error) {
      console.warn("Cloud refresh failed", error);
      state.cloudOffline = true;
      const cached = readCloudCache();
      if (cached.length) state.transactions = cached;
      if (notify) showToast("当前离线，正在显示上次同步的账单");
      renderSettings();
    }
  }

  function startCloudSync() {
    window.clearInterval(syncTimer);
    syncTimer = window.setInterval(() => {
      refreshCloudProfile(false);
      refreshCloudTransactions(false);
    }, 15000);
  }

  async function refreshCloudProfile(notify = true) {
    if (state.mode !== "cloud" || !state.cloudSession) return;
    try {
      const { own, partner } = await window.JiajiaCloud.getProfile();
      const partnerChanged = state.partner?.id !== partner?.id;
      if (own) state.profile = own;
      state.partner = partner;
      if (notify) renderAll();
      else if (partnerChanged && state.view === "settings") renderCloudPanel();
    } catch (error) {
      console.warn("Cloud profile refresh failed", error);
    }
  }

  function renderSyncedDataViews() {
    renderHome();
    renderLedger();
    renderStats();
    if (state.view === "settings") {
      elements.ledgerModeLabel.textContent = "共享账本";
      elements.syncModeLabel.textContent = state.cloudOffline ? "离线缓存" : "自动同步";
      elements.recordSummary.textContent = `${state.transactions.length} 笔可见账单`;
      elements.storageSummary.textContent = state.cloudOffline
        ? "联网后自动刷新；离线时仅浏览缓存"
        : "私密账单不会进入对方设备";
    } else {
      renderSettings();
    }
  }

  function normalizeCloudTransaction(row) {
    return {
      id: row.id,
      type: row.type,
      amount: Number(row.amount),
      categoryId: row.category_id,
      account: row.account,
      date: row.date,
      note: row.note || "",
      visibility: row.visibility === "partner" ? "partner" : "private",
      ownerId: row.owner_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function readCloudCache() {
    try {
      const value = JSON.parse(localStorage.getItem(CLOUD_CACHE_KEY) || "[]");
      return Array.isArray(value) ? value.map(normalizeCloudTransaction) : [];
    } catch {
      return [];
    }
  }

  function readProfileCache() {
    try {
      const value = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || "null");
      return {
        profile: value?.profile || null,
        partner: value?.partner || null
      };
    } catch {
      return { profile: null, partner: null };
    }
  }

  function isAuthSessionError(error) {
    const status = Number(error?.status || 0);
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "");
    return status === 401
      || code.includes("invalid_grant")
      || code.includes("refresh_token")
      || /登录已过期|refresh token/i.test(message);
  }

  function currentUserId() {
    return state.cloudSession?.user?.id || null;
  }

  function isOwnTransaction(transaction) {
    if (!transaction) return true;
    if (state.mode !== "cloud") return true;
    return !transaction.ownerId || transaction.ownerId === currentUserId();
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("date", "date");
          store.createIndex("type", "type");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbGetAll() {
    return runStoreRequest("readonly", (store) => store.getAll());
  }

  function dbPut(transaction) {
    return runStoreRequest("readwrite", (store) => store.put(transaction));
  }

  function dbDelete(id) {
    return runStoreRequest("readwrite", (store) => store.delete(id));
  }

  function dbReplace(items) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      items.forEach((item) => store.put(item));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function runStoreRequest(mode, operation) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function renderAll() {
    renderMonthLabels();
    renderHome();
    renderLedger();
    renderStats();
    renderSettings();
  }

  function renderMonthLabels() {
    const label = formatMonth(state.month);
    elements.heroMonthLabel.textContent = label;
    elements.statsMonthLabel.textContent = label;
  }

  function renderHome() {
    const items = transactionsForMonth(state.month);
    const summary = summarize(items);
    elements.monthExpense.textContent = formatCurrency(summary.expense);
    elements.monthIncome.textContent = formatCurrency(summary.income);
    elements.monthBalance.textContent = formatCurrency(summary.balance);
    elements.monthBalance.classList.toggle("is-negative", summary.balance < 0);

    const recent = sortTransactions(items).slice(0, 5);
    elements.recentList.innerHTML = recent.length
      ? recent.map((item) => billRow(item, true)).join("")
      : emptyState("这个月还没有账单", "点下方加号，记下第一笔");
  }

  function renderLedger() {
    const query = state.search;
    const items = sortTransactions(state.transactions).filter((item) => {
      if (state.filter !== "all" && item.type !== state.filter) return false;
      if (state.mode === "cloud" && state.ownerFilter !== "all") {
        const own = isOwnTransaction(item);
        if (state.ownerFilter === "mine" && !own) return false;
        if (state.ownerFilter === "partner" && own) return false;
      }
      if (!query) return true;
      const category = getCategory(item.categoryId);
      return [
        item.note,
        item.account,
        item.date,
        category ? category.name : ""
      ].join(" ").toLowerCase().includes(query);
    });

    elements.ledgerCount.textContent = `${items.length} 笔`;
    elements.ownerFilter.hidden = state.mode !== "cloud";
    elements.ownerFilter.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("is-on", button.dataset.ownerFilter === state.ownerFilter);
    });
    elements.ledgerList.innerHTML = items.length
      ? groupTransactions(items)
      : state.mode === "cloud" && state.ownerFilter === "partner"
        ? emptyState("对方还没有共享账单", "对方需要把账单设为“对方可见”")
        : state.mode === "cloud" && state.ownerFilter === "mine"
          ? emptyState("你还没有记账", "记一笔后，明细会出现在这里")
          : emptyState(query ? "没有找到相符的账单" : "账本还是空的", query ? "换个关键词试试" : "记一笔后，明细会出现在这里");
  }

  function renderStats() {
    const items = transactionsForMonth(state.month);
    const summary = summarize(items);
    const expenseItems = items.filter((item) => item.type === "expense");
    const grouped = new Map();

    expenseItems.forEach((item) => {
      grouped.set(item.categoryId, (grouped.get(item.categoryId) || 0) + item.amount);
    });

    const ranking = [...grouped.entries()]
      .map(([id, amount]) => ({ category: getCategory(id), amount }))
      .filter((item) => item.category)
      .sort((a, b) => b.amount - a.amount);

      elements.statsTotal.textContent = formatCurrency(summary.expense, false);
    elements.statsIncome.textContent = formatCurrency(summary.income);
    elements.statsBalance.textContent = formatCurrency(summary.balance);

    if (summary.expense > 0) {
      let cursor = 0;
      const stops = ranking.map((item) => {
        const start = cursor;
        cursor += item.amount / summary.expense * 360;
        return `${item.category.color} ${start}deg ${cursor}deg`;
      });
      elements.statsDonut.style.background = `conic-gradient(${stops.join(",")})`;
    } else {
      elements.statsDonut.style.background = "";
    }

    elements.categoryRank.innerHTML = ranking.length
      ? ranking.map((item) => {
        const percent = Math.round(item.amount / summary.expense * 100);
        return `
          <div class="rank-row">
            <div class="rank-meta">
              <i class="rank-dot" style="background:${item.category.color}"></i>
              <strong>${escapeHtml(item.category.name)}</strong>
              <span>${percent}%</span>
            </div>
            <span class="rank-amount">${formatCurrency(item.amount)}</span>
            <div class="rank-track"><i style="width:${Math.max(percent, 3)}%;background:${item.category.color}"></i></div>
          </div>`;
      }).join("")
      : `<div class="empty-inner"><strong>这个月还没有支出</strong><span>记下消费后，这里会自动分类</span></div>`;

    renderTrend(expenseItems, state.month);
  }

  function renderTrend(items, monthDate) {
    const days = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const bins = [];
    for (let start = 1; start <= days; start += 5) {
      const end = Math.min(start + 4, days);
      const amount = items
        .filter((item) => {
          const day = Number(item.date.slice(8, 10));
          return day >= start && day <= end;
        })
        .reduce((sum, item) => sum + item.amount, 0);
      bins.push({ start, end, amount });
    }

    while (bins.length < 6) bins.push({ start: 0, end: 0, amount: 0 });
    while (bins.length > 6) {
      const last = bins.pop();
      bins[bins.length - 1].end = last.end;
      bins[bins.length - 1].amount += last.amount;
    }

    const max = Math.max(...bins.map((item) => item.amount), 0);
    elements.trendChart.innerHTML = bins.map((bin) => {
      const height = bin.amount && max ? Math.max(8, Math.round(bin.amount / max * 122)) : 3;
      const label = bin.start ? `${bin.start}-${bin.end}` : "-";
      return `
        <div class="trend-bar-wrap" title="${label}日 ${formatCurrency(bin.amount)}">
          <i class="trend-bar${bin.amount ? "" : " is-empty"}" style="height:${height}px"></i>
          <span>${label}</span>
        </div>`;
    }).join("");
  }

  function renderSettings() {
    const cloud = state.mode === "cloud";
    elements.ledgerModeLabel.textContent = cloud ? "共享账本" : "本机账本";
    elements.syncModeLabel.textContent = cloud
      ? (state.cloudOffline ? "离线缓存" : "自动同步")
      : "离线可用";
    elements.recordSummary.textContent = `${state.transactions.length} 笔可见账单`;
    renderCloudPanel();
    if (cloud) {
      elements.storageSummary.textContent = state.cloudOffline
        ? "联网后自动刷新；离线时仅浏览缓存"
        : "私密账单不会进入对方设备";
    } else {
      updateStorageSummary();
    }
  }

  async function updateStorageSummary() {
    if (!navigator.storage || !navigator.storage.estimate) {
      elements.storageSummary.textContent = "账单已保存在本机";
      return;
    }
    try {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage ? formatBytes(estimate.usage) : "很少";
      elements.storageSummary.textContent = `本机占用 ${used}，不会自动上传`;
    } catch {
      elements.storageSummary.textContent = "账单已保存在本机";
    }
  }

  function renderCloudPanel() {
    const cloud = window.JiajiaCloud;
    if (!cloud?.configured()) {
      elements.cloudPanel.innerHTML = `
        <div class="cloud-intro">
          <strong>连接两个人</strong>
          <span>填入 Supabase 项目地址和 anon key，登录后生成配对码。</span>
        </div>
        <div class="cloud-form">
          <label class="cloud-field"><span>Supabase URL</span><input id="cloudUrlInput" type="url" placeholder="https://xxxx.supabase.co" autocomplete="off"></label>
          <label class="cloud-field"><span>anon key</span><input id="cloudKeyInput" type="text" placeholder="eyJ..." autocomplete="off"></label>
          <button class="cloud-button primary" type="button" data-cloud-action="connect">
            <svg><use href="#i-cloud"></use></svg>连接共享服务
          </button>
        </div>
        ${cloudMessageHtml()}`;
      return;
    }

    if (!state.cloudSession) {
      elements.cloudPanel.innerHTML = `
        <div class="cloud-status">
          <span><svg><use href="#i-cloud"></use></svg></span>
          <span><strong>共享服务已配置</strong><small>${escapeHtml(cloud.getConfig().url)}</small></span>
        </div>
        <p class="cloud-note">使用邮箱和密码注册，不需要 GitHub，也不需要等待验证邮件。</p>
        <div class="cloud-form">
          <label class="cloud-field"><span>昵称</span><input id="cloudNameInput" type="text" maxlength="20" placeholder="佳嘉" autocomplete="nickname"></label>
          <label class="cloud-field"><span>邮箱</span><input id="cloudEmailInput" type="email" placeholder="name@example.com" autocomplete="email"></label>
          <label class="cloud-field"><span>密码</span><input id="cloudPasswordInput" type="password" placeholder="至少 6 位" autocomplete="current-password"></label>
          <div class="cloud-actions">
            <button class="cloud-button primary" type="button" data-cloud-action="signin" ${state.cloudBusy ? "disabled" : ""}>登录</button>
            <button class="cloud-button" type="button" data-cloud-action="signup" ${state.cloudBusy ? "disabled" : ""}>注册</button>
          </div>
          ${window.SHARED_LEDGER_CONFIG?.emailConfirmation ? `<button class="cloud-button" type="button" data-cloud-action="resend" ${state.cloudBusy ? "disabled" : ""}>重发验证邮件</button>` : ""}
          <button class="cloud-button danger" type="button" data-cloud-action="reset-config">清除服务配置</button>
        </div>
        ${cloudMessageHtml()}`;
      return;
    }

    const ownName = state.profile?.display_name || "我";
    const partnerName = PARTNER_LABEL;
    const partnerBlock = state.partner
      ? `
      <div class="partner-strip">
          <span class="partner-avatar">${escapeHtml(partnerName.slice(0, 1))}</span>
          <div><strong>${escapeHtml(partnerName)}</strong><span>已配对 · 互相只能查看对方允许的内容</span></div>
      </div>
      <div class="cloud-actions">
        <button class="cloud-button primary" type="button" data-cloud-action="view-partner">查看对方共享账单</button>
        <button class="cloud-button danger" type="button" data-cloud-action="unpair">解除配对</button>
      </div>`
      : `
        <div class="pair-code">
          <span>把这组配对码发给她</span>
          <strong>${escapeHtml(state.profile?.invite_code || "------")}</strong>
        </div>
        <button class="cloud-button" type="button" data-cloud-action="copy-code">复制配对码</button>
        <div class="cloud-form">
          <label class="cloud-field"><span>如果她已发来配对码</span><input id="pairCodeInput" type="text" maxlength="12" placeholder="输入 6 位配对码" autocomplete="one-time-code"></label>
          <button class="cloud-button primary" type="button" data-cloud-action="pair" ${state.cloudBusy ? "disabled" : ""}>完成配对</button>
        </div>`;

    elements.cloudPanel.innerHTML = `
      <div class="cloud-status${state.cloudOffline ? " is-offline" : ""}">
        <span><svg><use href="#i-${state.cloudOffline ? "cloud" : "check"}"></use></svg></span>
        <span>
          <strong>${escapeHtml(ownName)} · ${state.cloudOffline ? "离线缓存" : "已同步"}</strong>
          <small>${state.cloudOffline ? "联网后自动刷新" : "每次保存后同步，每 15 秒检查新账单"}</small>
        </span>
      </div>
      ${partnerBlock}
      <div class="cloud-actions">
        <button class="cloud-button" type="button" data-cloud-action="refresh">刷新数据</button>
        <button class="cloud-button" type="button" data-cloud-action="signout"><svg><use href="#i-log-out"></use></svg>退出登录</button>
      </div>
      ${cloudMessageHtml()}`;
  }

  function cloudMessageHtml() {
    if (!state.cloudMessage) return "";
    return `<div class="cloud-message${state.cloudMessageType === "error" ? " error" : ""}">${escapeHtml(state.cloudMessage)}</div>`;
  }

  async function handleCloudAction(event) {
    const button = event.target.closest("[data-cloud-action]");
    if (!button || state.cloudBusy) return;
    const action = button.dataset.cloudAction;
    const cloud = window.JiajiaCloud;
    state.cloudMessage = "";
    state.cloudMessageType = "";

    try {
      if (action === "connect") {
        const url = elements.cloudPanel.querySelector("#cloudUrlInput")?.value || "";
        const key = elements.cloudPanel.querySelector("#cloudKeyInput")?.value || "";
        cloud.configure(url, key);
        state.cloudMessage = "共享服务已保存，请登录或注册";
        renderCloudPanel();
        showToast("共享服务已连接");
        return;
      }

      if (action === "reset-config") {
        if (!window.confirm("确认清除共享服务配置？云端账单不会被删除，本机登录会退出。")) return;
        await cloud.signOut().catch(() => {});
        cloud.clearConfig();
        await switchToLocalMode();
        showToast("已切换回本机账本");
        return;
      }

      if (action === "signin" || action === "signup") {
        const email = elements.cloudPanel.querySelector("#cloudEmailInput")?.value.trim().toLowerCase() || "";
        const password = elements.cloudPanel.querySelector("#cloudPasswordInput")?.value || "";
        const displayName = elements.cloudPanel.querySelector("#cloudNameInput")?.value.trim() || "";
        if (!isValidEmail(email)) throw new Error("邮箱格式不正确，请填写完整地址，例如 name@qq.com");
        if (password.length < 6) throw new Error("密码至少需要 6 位");
        state.cloudBusy = true;
        renderCloudPanel();
        if (action === "signup") {
          const result = await cloud.signUp(email, password, displayName || email.split("@")[0]);
          if (result.needsConfirmation) {
            state.cloudMessage = "注册成功，请先打开邮箱完成验证，再回来登录";
            return;
          }
        } else {
          await cloud.signIn(email, password);
        }
        await connectCloud();
        return;
      }

      if (action === "resend") {
        const email = elements.cloudPanel.querySelector("#cloudEmailInput")?.value.trim().toLowerCase() || "";
        if (!isValidEmail(email)) throw new Error("邮箱格式不正确，请填写完整地址，例如 name@qq.com");
        state.cloudBusy = true;
        renderCloudPanel();
        await cloud.resendConfirmation(email);
        state.cloudMessage = "验证邮件已重新发送，请检查收件箱和垃圾邮件";
        return;
      }

      if (action === "pair") {
        const code = elements.cloudPanel.querySelector("#pairCodeInput")?.value.trim() || "";
        if (!code) throw new Error("请输入对方的配对码");
        state.cloudBusy = true;
        renderCloudPanel();
        await cloud.claimInvite(code);
        await connectCloud();
        showToast("配对完成");
        return;
      }

      if (action === "copy-code") {
        await navigator.clipboard.writeText(state.profile?.invite_code || "");
        showToast("配对码已复制");
        return;
      }

      if (action === "view-partner") {
        state.ownerFilter = "partner";
        setView("ledger");
        return;
      }

      if (action === "unpair") {
        if (!window.confirm("确认解除配对？解除后双方都不能再看到对方共享的账单。")) return;
        state.cloudBusy = true;
        renderCloudPanel();
        await cloud.unpair();
        const { own, partner } = await cloud.getProfile();
        state.profile = own;
        state.partner = partner;
        await refreshCloudTransactions(false);
        renderAll();
        showToast("已解除配对");
        return;
      }

      if (action === "refresh") {
        await refreshCloudProfile(false);
        await refreshCloudTransactions(true);
        showToast("共享数据已刷新");
        return;
      }

      if (action === "signout") {
        await cloud.signOut();
        await switchToLocalMode();
        showToast("已退出共享账本");
      }
    } catch (error) {
      console.warn("Cloud action failed", error.message);
      state.cloudMessage = friendlyCloudError(error, action);
      state.cloudMessageType = "error";
    } finally {
      state.cloudBusy = false;
      renderAll();
    }
  }

  async function switchToLocalMode() {
    window.clearInterval(syncTimer);
    state.mode = "local";
    state.cloudSession = null;
    state.profile = null;
    state.partner = null;
    state.ownerFilter = "all";
    state.cloudOffline = false;
    state.transactions = db ? await dbGetAll() : [];
    renderAll();
  }

  function isValidEmail(value) {
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(value);
  }

  function friendlyCloudError(error, action) {
    const code = String(error?.code || "").toLowerCase();
    const status = Number(error?.status || 0);
    if (code === "email_address_invalid") return "邮箱地址无效，请填写能正常收信的完整邮箱";
    if (code === "email_exists" || code === "user_already_exists") return "这个邮箱已经注册，请直接登录";
    if (code === "email_not_confirmed") return "邮箱还没有完成验证，请先打开确认邮件";
    if (code === "invalid_credentials") return "邮箱或密码不正确";
    if (/login failed/i.test(String(error?.message || ""))) {
      return "登录失败：请确认使用的是注册时填写的完整邮箱和同一个密码";
    }
    if (/failed to fetch|network|fetch/i.test(String(error?.message || ""))) {
      return "无法连接登录服务，请检查网络后重试";
    }
    if (status === 429 || code.includes("rate_limit")) {
      return action === "signin"
        ? "登录尝试过于频繁，请等 5 分钟后再试"
        : "邮件发送太频繁，请等几分钟再试";
    }
    return error?.message || (action === "signup" ? "注册失败，请稍后再试" : "操作失败，请稍后再试");
  }

  function setView(view) {
    const allowed = ["home", "ledger", "stats", "settings"];
    if (!allowed.includes(view)) view = "home";
    state.view = view;
    document.querySelectorAll(".view").forEach((section) => {
      section.hidden = section.id !== `view-${view}`;
    });
    document.querySelectorAll(".tab").forEach((button) => {
      button.classList.toggle("is-on", button.dataset.view === view);
    });
    if (view === "settings") {
      renderSettings();
      if (state.mode === "cloud") {
        refreshCloudProfile(false);
        refreshCloudTransactions(false);
      }
    }
    if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function setInitialView() {
    setView(location.hash.slice(1) || "home");
  }

  function openSheet(type = "expense", transaction = null) {
    state.editingId = transaction ? transaction.id : null;
    state.draftTransactionId = transaction ? transaction.id : createId();
    state.readOnly = transaction ? !isOwnTransaction(transaction) : false;
    state.draftType = transaction ? transaction.type : type;
    state.draftCategory = transaction ? transaction.categoryId : CATEGORIES[state.draftType][0].id;
    state.draftAccount = transaction ? transaction.account : "微信";
    state.draftVisibility = transaction?.visibility || "private";

    elements.amountInput.value = transaction ? (transaction.amount / 100).toFixed(2) : "";
    elements.dateInput.value = transaction ? transaction.date : localDateString(new Date());
    elements.noteInput.value = transaction ? transaction.note : "";
    elements.editSheet.classList.toggle("is-readonly", state.readOnly);
    elements.readonlyBanner.hidden = !state.readOnly;
    elements.deleteButton.hidden = !transaction || state.readOnly;
    elements.saveButton.hidden = state.readOnly;
    elements.saveButton.disabled = false;
    [elements.amountInput, elements.dateInput, elements.noteInput].forEach((input) => {
      input.disabled = state.readOnly;
    });

    updateSheetCopy();
    renderSheetChoices();
    elements.sheetLayer.hidden = false;
    document.body.style.overflow = "hidden";
    if (!state.readOnly) window.setTimeout(() => elements.amountInput.focus(), 120);
  }

  function closeSheet(force = false) {
    if (state.saving && !force) return;
    elements.sheetLayer.hidden = true;
    document.body.style.overflow = "";
    elements.transactionForm.reset();
    elements.editSheet.classList.remove("is-readonly");
    elements.readonlyBanner.hidden = true;
    elements.amountInput.disabled = false;
    elements.dateInput.disabled = false;
    elements.noteInput.disabled = false;
    state.editingId = null;
    state.readOnly = false;
    state.draftTransactionId = null;
  }

  function updateSheetCopy() {
    const income = state.draftType === "income";
    elements.sheetTitle.textContent = state.readOnly
      ? "这笔账单只能查看"
      : state.editingId
      ? "修改这一笔"
      : income ? "今天收到了什么" : "今天花了什么";
    elements.sheetEyebrow.textContent = state.readOnly
      ? "对方分享"
      : state.editingId ? "编辑账单" : "新账单";
    elements.typeSwitch.querySelectorAll("[data-type]").forEach((button) => {
      button.classList.toggle("is-on", button.dataset.type === state.draftType);
      button.disabled = state.readOnly;
    });
  }

  function renderSheetChoices() {
    elements.categoryGrid.innerHTML = CATEGORIES[state.draftType].map((category) => `
      <button class="category-option${category.id === state.draftCategory ? " is-on" : ""}"
        type="button" data-category="${category.id}" ${state.readOnly ? "disabled" : ""}>
        <span class="category-badge" style="background:${category.soft};color:${category.ink}">${category.mark}</span>
        <span>${escapeHtml(category.name)}</span>
      </button>`).join("");

    elements.accountChips.innerHTML = ACCOUNTS.map((account) => `
      <button class="account-chip${account === state.draftAccount ? " is-on" : ""}"
        type="button" data-account="${escapeHtml(account)}" ${state.readOnly ? "disabled" : ""}>${escapeHtml(account)}</button>`).join("");
    renderVisibilityChoices();
  }

  function renderVisibilityChoices() {
    elements.visibilitySwitch.querySelectorAll("[data-visibility]").forEach((button) => {
      button.classList.toggle("is-on", button.dataset.visibility === state.draftVisibility);
      button.disabled = state.readOnly;
    });
  }

  async function saveTransaction(event) {
    event.preventDefault();
    if (state.readOnly || state.saving) return;
    state.saving = true;
    elements.saveButton.disabled = true;
    try {
      const amount = Math.round(Number(elements.amountInput.value) * 100);
      const date = elements.dateInput.value;

      if (!Number.isFinite(amount) || amount <= 0) {
        showToast("请先填写金额");
        elements.amountInput.focus();
        return;
      }
      if (!date) {
        showToast("请选择账单日期");
        elements.dateInput.focus();
        return;
      }

      const existing = state.transactions.find((item) => item.id === state.editingId);
      const now = new Date().toISOString();
      const transaction = {
        id: state.draftTransactionId || createId(),
        type: state.draftType,
        amount,
        categoryId: state.draftCategory,
        account: state.draftAccount,
        date,
        note: elements.noteInput.value.trim(),
        visibility: state.draftVisibility,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now
      };

      if (state.mode === "cloud") {
        await window.JiajiaCloud.saveTransaction(transaction, { create: !existing });
        await refreshCloudTransactions(false);
      } else {
        await dbPut(transaction);
        state.transactions = await dbGetAll();
      }
      const savedMonth = new Date(`${date}T00:00:00`);
      state.month = startOfMonth(savedMonth);
      closeSheet(true);
      renderAll();
      const range = state.draftVisibility === "partner" ? "，对方可见" : "，仅自己可见";
      showToast(existing ? "账单已更新" : `${state.draftType === "expense" ? "支出" : "收入"}已记下${range}`);
    } catch (error) {
      console.error(error);
      showToast(state.mode === "cloud" ? "保存失败，请检查网络后重试" : "保存失败，请再试一次");
    } finally {
      state.saving = false;
      elements.saveButton.disabled = false;
    }
  }

  async function deleteCurrentTransaction() {
    if (!state.editingId || state.readOnly || state.saving) return;
    const item = state.transactions.find((transaction) => transaction.id === state.editingId);
    if (!item) return;
    if (!window.confirm(`确认删除这笔 ${formatCurrency(item.amount)} 的账单吗？`)) return;

    try {
      if (state.mode === "cloud") {
        await window.JiajiaCloud.deleteTransaction(item.id);
        await refreshCloudTransactions(false);
      } else {
        await dbDelete(item.id);
        state.transactions = await dbGetAll();
      }
      closeSheet();
      renderAll();
      showToast("账单已删除");
    } catch (error) {
      console.error(error);
      showToast(state.mode === "cloud" ? "删除失败，请检查网络后重试" : "删除失败，请再试一次");
    }
  }

  function editFromList(event) {
    const button = event.target.closest("[data-edit]");
    if (!button) return;
    const transaction = state.transactions.find((item) => item.id === button.dataset.edit);
    if (transaction) openSheet(transaction.type, transaction);
  }

  function exportBackup() {
    const payload = {
      app: "jiajia-ledger",
      schemaVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      mode: state.mode,
      transactions: state.transactions
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, `佳嘉记账-备份-${localDateString(new Date())}.json`);
    showToast("完整备份已导出");
  }

  function exportCsv() {
    const header = ["日期", "类型", "金额", "分类", "账户", "可见范围", "备注"];
    const rows = sortTransactions(state.transactions).map((item) => [
      item.date,
      item.type === "expense" ? "支出" : "收入",
      (item.amount / 100).toFixed(2),
      getCategory(item.categoryId)?.name || "其他",
      item.account,
      item.visibility === "partner" ? "对方可见" : "仅自己",
      item.note
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `佳嘉记账-账单-${localDateString(new Date())}.csv`);
    showToast("表格已导出");
  }

  async function importBackup(event) {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;

    try {
      const payload = JSON.parse(await file.text());
      if (!payload || !Array.isArray(payload.transactions)) {
        throw new Error("not a wallet backup");
      }
      const items = payload.transactions.map(sanitizeTransaction).filter(Boolean);
      if (state.mode === "cloud") {
        const ownItems = items.filter((item) => !item.ownerId || item.ownerId === currentUserId());
        if (!window.confirm(`备份中有 ${ownItems.length} 笔属于当前账号的账单。将作为新账单导入云端，确认继续吗？`)) return;
        for (const item of ownItems) {
          await window.JiajiaCloud.saveTransaction({ ...item, id: createId() }, { create: true });
        }
        await refreshCloudTransactions(false);
        showToast("云端备份已导入");
      } else {
        const message = `备份中有 ${items.length} 笔账单。恢复后会替换当前 ${state.transactions.length} 笔，确认继续吗？`;
        if (!window.confirm(message)) return;
        await dbReplace(items.map(({ ownerId, ...item }) => item));
        state.transactions = await dbGetAll();
        showToast("备份已恢复");
      }
      renderAll();
    } catch (error) {
      console.error(error);
      showToast("这个备份文件无法识别");
    }
  }

  function sanitizeTransaction(item) {
    if (!item || !["expense", "income"].includes(item.type)) return null;
    const amount = Math.round(Number(item.amount));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const date = String(item.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const category = getCategory(item.categoryId, item.type);
    const account = ACCOUNTS.includes(item.account) ? item.account : "现金";
    const now = new Date().toISOString();
    return {
      id: String(item.id || createId()),
      type: item.type,
      amount,
      categoryId: category ? category.id : CATEGORIES[item.type].slice(-1)[0].id,
      account,
      date,
      note: String(item.note || "").slice(0, 80),
      visibility: item.visibility === "partner" ? "partner" : "private",
      ownerId: item.ownerId || null,
      createdAt: String(item.createdAt || now),
      updatedAt: String(item.updatedAt || now)
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function normalizeAmountInput() {
    let value = elements.amountInput.value.replace(/[^\d.]/g, "");
    const parts = value.split(".");
    value = parts.shift() + (parts.length ? `.${parts.join("").slice(0, 2)}` : "");
    elements.amountInput.value = value;
  }

  function finishAmountInput() {
    const amount = Number(elements.amountInput.value);
    if (Number.isFinite(amount) && amount > 0) {
      elements.amountInput.value = amount.toFixed(2);
    }
  }

  function billRow(item, showDate = false) {
    const category = getCategory(item.categoryId);
    const isIncome = item.type === "income";
    const isPartnerEntry = state.mode === "cloud" && !isOwnTransaction(item);
    const title = item.note || category?.name || "未分类";
    const metaParts = [category?.name || "未分类", item.account];
    if (showDate) metaParts.unshift(formatBillDate(item.date));
    const privacy = isPartnerEntry
      ? `<span class="privacy-badge partner-entry"><svg><use href="#i-users"></use></svg>${PARTNER_LABEL}</span>`
      : item.visibility === "partner"
        ? `<span class="privacy-badge shared"><svg><use href="#i-users"></use></svg>对方可见</span>`
        : `<span class="privacy-badge"><svg><use href="#i-lock"></use></svg>仅自己</span>`;
    return `
      <button class="bill-row${isPartnerEntry ? " is-readonly" : ""}" type="button" data-edit="${escapeHtml(item.id)}">
        <span class="category-badge" style="background:${category?.soft || "#f2f0f4"};color:${category?.ink || "#716779"}">${category?.mark || "记"}</span>
        <span class="bill-copy">
          <strong>${escapeHtml(title)}</strong>
          <span class="meta-line"><span>${escapeHtml(metaParts.join(" · "))}</span>${privacy}</span>
        </span>
        <span class="bill-amount${isIncome ? " income" : ""}">${isIncome ? "+" : "-"}${formatCurrency(item.amount)}</span>
      </button>`;
  }

  function groupTransactions(items) {
    const groups = new Map();
    items.forEach((item) => {
      if (!groups.has(item.date)) groups.set(item.date, []);
      groups.get(item.date).push(item);
    });
    return [...groups.entries()].map(([date, dayItems]) => {
      const expense = dayItems
        .filter((item) => item.type === "expense")
        .reduce((sum, item) => sum + item.amount, 0);
      return `
        <section class="date-group">
          <div class="date-heading">
            <strong>${escapeHtml(formatBillDate(date))}</strong>
            <span>支出 ${formatCurrency(expense)}</span>
          </div>
          <div class="bill-list">${dayItems.map((item) => billRow(item)).join("")}</div>
        </section>`;
    }).join("");
  }

  function emptyState(title, detail) {
    return `
      <div class="empty-state">
        <div class="empty-inner">
          <span class="empty-cloud" aria-hidden="true">
            <img src="assets/jiajia-mascot.svg" alt="">
          </span>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(detail)}</span>
        </div>
      </div>`;
  }

  function transactionsForMonth(monthDate) {
    const key = localMonthKey(monthDate);
    return state.transactions.filter((item) => item.date.startsWith(key));
  }

  function summarize(items) {
    const income = items.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
    const expense = items.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
    return { income, expense, balance: income - expense };
  }

  function sortTransactions(items) {
    return [...items].sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      return byDate || String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  function getCategory(id, type) {
    if (type) return CATEGORIES[type].find((item) => item.id === id);
    return ALL_CATEGORIES.find((item) => item.id === id);
  }

  function formatCurrency(cents, withSymbol = true) {
    const numeric = Number(cents) || 0;
    const value = Math.abs(numeric) / 100;
    const text = new Intl.NumberFormat("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
    return `${numeric < 0 ? "-" : ""}${withSymbol ? "¥" : ""}${text}`;
  }

  function formatMonth(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
  }

  function formatBillDate(value) {
    const today = localDateString(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = localDateString(yesterdayDate);
    if (value === today) return "今天";
    if (value === yesterday) return "昨天";
    const date = new Date(`${value}T00:00:00`);
    const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
    return `${date.getMonth() + 1}月${date.getDate()}日 ${week}`;
  }

  function formatBytes(value) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function localMonthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function createId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-on");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-on"), 2200);
  }

  async function requestPersistentStorage() {
    if (!navigator.storage || !navigator.storage.persist) return;
    try {
      await navigator.storage.persist();
    } catch {
      // 存储仍会正常保存在浏览器允许的空间里。
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  }
})();
