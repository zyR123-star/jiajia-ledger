const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const anonKey = process.env.SUPABASE_ANON_KEY || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const { randomUUID } = require("node:crypto");
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

if (!baseUrl || !anonKey || !serviceRoleKey) {
  console.error("Missing Supabase test environment");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { method = "GET", token, body, prefer } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { text };
    }
  }
  return { response, data };
}

async function admin(path, options = {}) {
  return request(path, { ...options, token: serviceRoleKey });
}

async function createUser(label) {
  const email = `codex-ledger-${runId}-${label}@example.com`;
  const password = `Test-${runId}-${label}-Aa1!`;
  const result = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: true, user_metadata: { display_name: `测试${label}` } }
  });
  assert(result.response.ok, `创建临时账号失败：${label}`);
  const user = result.data?.user || result.data;
  assert(user?.id, `临时账号没有返回 ID：${label}`);
  return { id: user.id, email, password };
}

async function signIn(user) {
  const result = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email: user.email, password: user.password }
  });
  assert(result.response.ok && result.data?.access_token, `临时账号登录失败：${user.email}`);
  return result.data.access_token;
}

async function getProfile(token, userId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await request(`/rest/v1/profiles?select=*&id=eq.${userId}&limit=1`, { token });
    assert(result.response.ok, "读取测试档案失败");
    if (result.data?.[0]) return result.data[0];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("测试档案没有由触发器创建");
}

async function insertTransaction(token, transaction) {
  const result = await request("/rest/v1/transactions", {
    method: "POST",
    token,
    prefer: "return=representation",
    body: transaction
  });
  assert(result.response.ok && result.data?.[0]?.id, `创建测试账单失败：${transaction.note}`);
  return result.data[0];
}

async function visibleTransactions(token) {
  const result = await request("/rest/v1/transactions?select=*&order=created_at.desc", { token });
  assert(result.response.ok, "读取测试账单失败");
  return result.data || [];
}

async function verifyIdempotentInsert(token) {
  const id = randomUUID();
  const payload = {
    id,
    type: "expense",
    amount: 1234,
    category_id: "exp-other",
    account: "现金",
    date: "2026-10-18",
    note: "真实测试-幂等账单",
    visibility: "private"
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await request("/rest/v1/transactions?on_conflict=id", {
      method: "POST",
      token,
      prefer: "resolution=ignore-duplicates,return=representation",
      body: payload
    });
    assert(result.response.ok, "幂等账单写入失败");
  }
  const result = await request(`/rest/v1/transactions?id=eq.${id}&select=id`, { token });
  assert(result.response.ok && result.data?.length === 1, "同一个账单 ID 写入了多条记录");
  return id;
}

async function deleteUser(id) {
  await admin(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
}

async function main() {
  let a = null;
  let b = null;
  try {
    a = await createUser("a");
    b = await createUser("b");
    const tokenA = await signIn(a);
    const tokenB = await signIn(b);
    const profileA = await getProfile(tokenA, a.id);
    const profileB = await getProfile(tokenB, b.id);
    await verifyIdempotentInsert(tokenA);

    const claim = await request("/rest/v1/rpc/claim_invite", {
      method: "POST",
      token: tokenB,
      body: { input_code: profileA.invite_code }
    });
    assert(claim.response.ok, "真实数据库配对失败");

    const duoPrivate = await insertTransaction(tokenA, {
      type: "expense",
      amount: 1100,
      category_id: "exp-food",
      account: "微信",
      date: "2026-10-17",
      note: "真实测试-多多私密",
      visibility: "private"
    });
    const duoShared = await insertTransaction(tokenA, {
      type: "expense",
      amount: 2200,
      category_id: "exp-food",
      account: "微信",
      date: "2026-10-17",
      note: "真实测试-多多共享",
      visibility: "partner"
    });
    const jiaPrivate = await insertTransaction(tokenB, {
      type: "expense",
      amount: 3300,
      category_id: "exp-fun",
      account: "支付宝",
      date: "2026-10-17",
      note: "真实测试-佳嘉私密",
      visibility: "private"
    });
    const jiaShared = await insertTransaction(tokenB, {
      type: "expense",
      amount: 4400,
      category_id: "exp-fun",
      account: "支付宝",
      date: "2026-10-17",
      note: "真实测试-佳嘉共享",
      visibility: "partner"
    });

    const rowsA = await visibleTransactions(tokenA);
    const rowsB = await visibleTransactions(tokenB);
    const notesA = rowsA.map((row) => row.note);
    const notesB = rowsB.map((row) => row.note);
    assert(notesA.includes(duoPrivate.note), "多多看不到自己的私密账单");
    assert(notesA.includes(duoShared.note), "多多看不到自己的共享账单");
    assert(notesA.includes(jiaShared.note), "多多看不到佳嘉的共享账单");
    assert(!notesA.includes(jiaPrivate.note), "私密账单泄漏给多多");
    assert(notesB.includes(jiaPrivate.note), "佳嘉看不到自己的私密账单");
    assert(notesB.includes(jiaShared.note), "佳嘉看不到自己的共享账单");
    assert(notesB.includes(duoShared.note), "佳嘉看不到多多的共享账单");
    assert(!notesB.includes(duoPrivate.note), "私密账单泄漏给佳嘉");

    const forbiddenUpdate = await request(
      `/rest/v1/transactions?id=eq.${duoShared.id}`,
      {
        method: "PATCH",
        token: tokenB,
        prefer: "return=representation",
        body: { note: "不应该成功的修改" }
      }
    );
    assert(!forbiddenUpdate.data?.length, "对方竟然可以修改共享账单");

    await request(`/rest/v1/transactions?id=eq.${duoShared.id}`, {
      method: "DELETE",
      token: tokenB
    });
    const afterForbiddenDelete = await visibleTransactions(tokenA);
    assert(afterForbiddenDelete.some((row) => row.id === duoShared.id), "对方竟然可以删除共享账单");

    const profileBPaired = await getProfile(tokenB, b.id);
    assert(profileBPaired.partner_id === profileA.id, "真实配对关系没有写入");

    const unpair = await request("/rest/v1/rpc/unpair", {
      method: "POST",
      token: tokenB,
      body: {}
    });
    assert(unpair.response.ok, "真实数据库解除配对失败");
    const rowsAfterUnpair = await visibleTransactions(tokenB);
    const notesAfterUnpair = rowsAfterUnpair.map((row) => row.note);
    assert(notesAfterUnpair.includes(jiaPrivate.note), "解除配对后看不到自己的私密账单");
    assert(notesAfterUnpair.includes(jiaShared.note), "解除配对后看不到自己的共享账单");
    assert(!notesAfterUnpair.includes(duoShared.note), "解除配对后仍能看到对方共享账单");

    console.log(JSON.stringify({
      ok: true,
      liveSupabase: baseUrl,
      idempotentInsert: true,
      mutualSharedVisibility: true,
      privateRecordsIsolated: true,
      partnerUpdateBlocked: true,
      partnerDeleteBlocked: true,
      unpairRevokesSharedVisibility: true
    }, null, 2));
  } finally {
    if (b) await deleteUser(b.id);
    if (a) await deleteUser(a.id);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
