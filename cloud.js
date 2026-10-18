(() => {
  "use strict";

  const CONFIG_KEY = "jiajia-cloud-config-v1";
  const SESSION_KEY = "jiajia-cloud-session-v1";
  const AUTH_DB_NAME = "jiajia-cloud-auth-v1";
  const AUTH_DB_STORE = "session";
  let config = readJson(CONFIG_KEY) || window.SHARED_LEDGER_CONFIG || null;
  let session = null;
  let refreshTask = null;
  let authDbPromise = null;

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function saveJson(key, value) {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  }

  function openAuthDb() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB unavailable"));
    if (authDbPromise) return authDbPromise;
    authDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(AUTH_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(AUTH_DB_STORE)) {
          request.result.createObjectStore(AUTH_DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return authDbPromise;
  }

  function authDbRequest(mode, operation) {
    return openAuthDb().then((database) => new Promise((resolve, reject) => {
      const transaction = database.transaction(AUTH_DB_STORE, mode);
      const request = operation(transaction.objectStore(AUTH_DB_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }

  function writeSessionBackup(value) {
    return authDbRequest("readwrite", (store) => store.put(value, "current"));
  }

  function readSessionBackup() {
    return authDbRequest("readonly", (store) => store.get("current")).catch(() => null);
  }

  function clearSessionBackup() {
    return authDbRequest("readwrite", (store) => store.delete("current")).catch(() => {});
  }

  async function loadStoredSession() {
    const local = readJson(SESSION_KEY);
    const backup = await readSessionBackup();
    if (!backup) return local;
    if (!local) {
      saveJson(SESSION_KEY, backup);
      return backup;
    }
    const localTime = Number(local.updatedAt || 0);
    const backupTime = Number(backup.updatedAt || 0);
    if (backupTime > localTime) {
      saveJson(SESSION_KEY, backup);
      return backup;
    }
    if (localTime > backupTime) writeSessionBackup(local).catch(() => {});
    return local;
  }

  function configured() {
    return Boolean(config?.url && config?.anonKey);
  }

  function getConfig() {
    return config ? { ...config } : null;
  }

  function configure(url, anonKey) {
    const normalizedUrl = String(url || "").trim().replace(/\/+$/, "");
    const normalizedKey = String(anonKey || "").trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) throw new Error("Supabase 地址格式不正确");
    if (normalizedKey.length < 40) throw new Error("anon key 格式不正确");
    config = { url: normalizedUrl, anonKey: normalizedKey };
    saveJson(CONFIG_KEY, config);
    return getConfig();
  }

  function clearConfig() {
    config = null;
    saveJson(CONFIG_KEY, null);
  }

  function normalizeSession(data) {
    if (!data?.access_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
      updatedAt: Date.now(),
      user: data.user || session?.user || null
    };
  }

  function persistSession(next) {
    session = next;
    saveJson(SESSION_KEY, next);
    writeSessionBackup(next).catch(() => {});
    return next;
  }

  function getSession() {
    return session ? { ...session, user: session.user ? { ...session.user } : null } : null;
  }

  function getUser() {
    return session?.user || null;
  }

  async function authRequest(path, options = {}) {
    if (!configured()) throw new Error("还没有连接共享账本");
    const response = await fetch(`${config.url}${path}`, {
      method: options.method || "GET",
      headers: {
        apikey: config.anonKey,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await parseResponse(response);
    if (!response.ok) throw cloudError(response, data, "登录服务暂时不可用");
    return data;
  }

  async function signUp(email, password, displayName) {
    const data = await authRequest("/auth/v1/signup", {
      method: "POST",
      body: {
        email,
        password,
        data: { display_name: displayName },
        options: {
          email_redirect_to: `${window.location.origin}${window.location.pathname}`
        }
      }
    });
    if (data.access_token) persistSession(normalizeSession(data));
    return { needsConfirmation: !data.access_token, user: data.user || null };
  }

  async function signIn(email, password) {
    const data = await authRequest("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: { email, password }
    });
    return persistSession(normalizeSession(data));
  }

  async function resendConfirmation(email) {
    return authRequest("/auth/v1/resend", {
      method: "POST",
      body: {
        type: "signup",
        email,
        options: {
          email_redirect_to: `${window.location.origin}${window.location.pathname}`
        }
      }
    });
  }

  async function restoreSession() {
    if (!configured()) return null;
    const stored = await loadStoredSession();
    if (!stored?.accessToken) return null;
    session = stored;
    if (session.expiresAt && session.expiresAt - Date.now() < 60000) {
      try {
        await refreshSession();
      } catch {
        await signOut(false).catch(() => {});
        return null;
      }
    }
    return getSession();
  }

  async function refreshSession(force = false) {
    if (refreshTask) return refreshTask;
    const task = async () => {
      const latest = readJson(SESSION_KEY);
      if (
        !force
        && latest?.accessToken
        && latest.accessToken !== session?.accessToken
        && latest.expiresAt - Date.now() > 30000
      ) {
        session = latest;
        return getSession();
      }
      const refreshToken = latest?.refreshToken || session?.refreshToken;
      if (!refreshToken) throw new Error("登录已过期");
      const data = await authRequest("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: { refresh_token: refreshToken }
      });
      return persistSession(normalizeSession(data));
    };
    const locks = navigator.locks;
    refreshTask = locks
      ? locks.request(`${SESSION_KEY}-refresh`, task)
      : task();
    try {
      return await refreshTask;
    } finally {
      refreshTask = null;
    }
  }

  async function signOut(notifyServer = true) {
    if (notifyServer && session?.accessToken && configured()) {
      await fetch(`${config.url}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`
        }
      }).catch(() => {});
    }
    session = null;
    saveJson(SESSION_KEY, null);
    await clearSessionBackup();
  }

  async function ensureSession() {
    if (!session?.accessToken) throw new Error("请先登录共享账本");
    if (session.expiresAt && session.expiresAt - Date.now() < 30000) await refreshSession();
    return session;
  }

  async function dataRequest(path, options = {}, retry = true) {
    await ensureSession();
    const response = await fetch(`${config.url}${path}`, {
      method: options.method || "GET",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
        ...(options.prefer ? { Prefer: options.prefer } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (response.status === 401 && retry) {
      await refreshSession(true);
      return dataRequest(path, options, false);
    }

    const data = await parseResponse(response);
    if (!response.ok) throw cloudError(response, data, "共享账本请求失败");
    return data;
  }

  async function getProfile() {
    const user = session?.user;
    if (!user?.id) throw new Error("登录信息不完整");
    const ownRows = await dataRequest(`/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(user.id)}&limit=1`);
    const own = ownRows?.[0] || null;
    let partner = null;
    if (own?.partner_id) {
      const rows = await dataRequest(`/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(own.partner_id)}&limit=1`);
      partner = rows?.[0] || null;
    }
    return { own, partner };
  }

  async function listTransactions() {
    return dataRequest("/rest/v1/transactions?select=*&order=date.desc,created_at.desc");
  }

  async function saveTransaction(transaction, options = {}) {
    const payload = {
      type: transaction.type,
      amount: transaction.amount,
      category_id: transaction.categoryId,
      account: transaction.account,
      date: transaction.date,
      note: transaction.note,
      visibility: transaction.visibility === "partner" ? "partner" : "private",
      updated_at: new Date().toISOString()
    };
    if (!options.create) {
      const userId = session?.user?.id;
      if (!userId) throw new Error("登录已过期");
      return dataRequest(
        `/rest/v1/transactions?id=eq.${encodeURIComponent(transaction.id)}&owner_id=eq.${encodeURIComponent(userId)}`,
        { method: "PATCH", body: payload, prefer: "return=representation" }
      );
    }
    return dataRequest("/rest/v1/transactions?on_conflict=id", {
      method: "POST",
      body: { id: transaction.id, ...payload },
      prefer: "resolution=ignore-duplicates,return=representation"
    });
  }

  async function deleteTransaction(id) {
    const userId = session?.user?.id;
    if (!userId) throw new Error("登录已过期");
    return dataRequest(
      `/rest/v1/transactions?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(userId)}`,
      { method: "DELETE", prefer: "return=minimal" }
    );
  }

  async function claimInvite(code) {
    return dataRequest("/rest/v1/rpc/claim_invite", {
      method: "POST",
      body: { input_code: String(code || "").trim().toUpperCase() }
    });
  }

  async function unpair() {
    return dataRequest("/rest/v1/rpc/unpair", { method: "POST", body: {} });
  }

  async function parseResponse(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  function apiMessage(data, fallback) {
    return data?.message || data?.msg || data?.error_description || data?.error || fallback;
  }

  function cloudError(response, data, fallback) {
    const error = new Error(apiMessage(data, fallback));
    error.code = data?.error_code || data?.code || "";
    error.status = response.status;
    return error;
  }

  window.JiajiaCloud = {
    configured,
    getConfig,
    configure,
    clearConfig,
    signUp,
    signIn,
    resendConfirmation,
    restoreSession,
    signOut,
    getSession,
    getUser,
    getProfile,
    listTransactions,
    saveTransaction,
    deleteTransaction,
    claimInvite,
    unpair
  };
})();
