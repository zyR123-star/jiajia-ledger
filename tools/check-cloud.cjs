const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("C:/Users/FY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const shots = path.join(__dirname, "screenshots");
const base = "http://127.0.0.1:4181/";
const mockOrigin = "https://mock.supabase.test";
const ownerId = "11111111-1111-1111-1111-111111111111";
const partnerId = "22222222-2222-2222-2222-222222222222";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, prefer",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function text(page, selector) {
  return (await page.locator(selector).textContent()).trim();
}

async function configurePage(context, sessionUser) {
  await context.addInitScript(({ user }) => {
    localStorage.setItem("jiajia-cloud-config-v1", JSON.stringify({
      url: "https://mock.supabase.test",
      anonKey: "test-anon-key-which-is-long-enough-for-client-validation"
    }));
    localStorage.setItem("jiajia-cloud-session-v1", JSON.stringify({
      accessToken: "owner-access-token",
      refreshToken: "owner-refresh-token",
      expiresAt: Date.now() + 3600000,
      user
    }));
  }, { user: sessionUser });
}

function json(route, data, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: corsHeaders,
    body: JSON.stringify(data)
  });
}

async function main() {
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    serviceWorkers: "block"
  });
  await configurePage(context, { id: ownerId, email: "owner@example.com" });
  const page = await context.newPage();
  const errors = [];
  const posted = [];
  let transactions = [
    {
      id: "own-private",
      owner_id: ownerId,
      type: "expense",
      amount: 8800,
      category_id: "exp-study",
      account: "微信",
      date: "2026-10-17",
      note: "自己的网课",
      visibility: "private",
      created_at: "2026-10-17T01:00:00.000Z",
      updated_at: "2026-10-17T01:00:00.000Z"
    },
    {
      id: "own-shared",
      owner_id: ownerId,
      type: "expense",
      amount: 2600,
      category_id: "exp-food",
      account: "支付宝",
      date: "2026-10-17",
      note: "一起吃的面",
      visibility: "partner",
      created_at: "2026-10-17T02:00:00.000Z",
      updated_at: "2026-10-17T02:00:00.000Z"
    },
    {
      id: "partner-shared",
      owner_id: partnerId,
      type: "expense",
      amount: 1500,
      category_id: "exp-food",
      account: "微信",
      date: "2026-10-16",
      note: "她的奶茶",
      visibility: "partner",
      created_at: "2026-10-16T03:00:00.000Z",
      updated_at: "2026-10-16T03:00:00.000Z"
    }
  ];

  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await page.route(`${mockOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders, body: "" });

    if (url.pathname === "/rest/v1/profiles" && request.method() === "GET") {
      const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      if (id === ownerId) {
        return json(route, [{
          id: ownerId,
          display_name: "我",
          invite_code: "OWN123",
          partner_id: partnerId
        }]);
      }
      if (id === partnerId) {
        return json(route, [{
          id: partnerId,
          display_name: "佳嘉",
          invite_code: "JIA123",
          partner_id: ownerId
        }]);
      }
      return json(route, []);
    }

    if (url.pathname === "/rest/v1/transactions" && request.method() === "GET") {
      return json(route, transactions);
    }

    if (url.pathname === "/rest/v1/transactions" && request.method() === "POST") {
      const body = JSON.parse(request.postData());
      posted.push(body);
      const row = {
        id: `created-${posted.length}`,
        owner_id: ownerId,
        ...body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      transactions = [row, ...transactions];
      return json(route, [row], 201);
    }

    if (url.pathname.startsWith("/rest/v1/transactions") && request.method() === "PATCH") {
      return json(route, []);
    }

    return json(route, { message: `Unhandled ${request.method()} ${url.pathname}` }, 500);
  });

  try {
    await page.goto(base, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#recordSummary").textContent.includes("3 笔"));
    assert(await page.locator("#modeBanner").isHidden(), "已登录状态不应显示本机账本提示");
    assert((await page.locator("#recentList").textContent()).includes("自己的网课"), "自己的私密账单不可见");
    assert((await page.locator("#recentList").textContent()).includes("她的奶茶"), "对方共享账单不可见");
    assert((await page.locator("#recentList").textContent()).includes("对方可见"), "共享范围标记缺失");

    await page.click('.tab[data-view="ledger"]');
    assert(await page.locator("#ownerFilter").isVisible(), "共享账本缺少账单来源筛选");
    await page.click('[data-owner-filter="partner"]');
    assert((await text(page, "#ledgerCount")) === "1 笔", "对方账本筛选数量不正确");
    assert(!(await text(page, "#ledgerList")).includes("自己的网课"), "对方账本里混入了自己的私密账单");
    await page.click('[data-owner-filter="all"]');
    await page.click('.tab[data-view="home"]');

    await page.locator("#recentList .bill-row", { hasText: "她的奶茶" }).click();
    assert(await page.locator("#readonlyBanner").isVisible(), "对方共享账单没有只读提示");
    assert(await page.locator("#saveButton").isHidden(), "对方共享账单不应允许保存");
    assert(await page.locator("#deleteButton").isHidden(), "对方共享账单不应允许删除");
    assert(await page.locator("#amountInput").isDisabled(), "对方共享账单输入框应禁用");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, "readonly-partner.png"), fullPage: true });
    await page.click("#sheetClose");

    await page.click("#tabAddButton");
    await page.fill("#amountInput", "12.50");
    await page.click('[data-category="exp-fun"]');
    await page.click('[data-visibility="partner"]');
    await page.fill("#dateInput", "2026-10-17");
    await page.fill("#noteInput", "电影票");
    await page.click("#saveButton");
    await page.waitForFunction(() => document.querySelector("#sheetLayer").hidden);
    assert(posted.length === 1, "新增共享账单没有提交");
    assert(posted[0].visibility === "partner", "新增账单没有保存共享范围");
    await page.waitForTimeout(400);
    await page.waitForFunction(() => document.querySelector("#recentList").textContent.includes("电影票"));
    assert((await page.locator("#recentList").textContent()).includes("电影票"), "新增共享账单未刷新");

    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, "cloud-home.png"), fullPage: true });
    await page.click('.tab[data-view="settings"]');
    assert((await page.locator("#cloudPanel").textContent()).includes("已配对"), "设置页没有显示配对状态");
    assert((await page.locator("#cloudPanel").textContent()).includes("多多"), "设置页没有固定显示多多昵称");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, "cloud-settings.png"), fullPage: true });
    await page.click('[data-cloud-action="view-partner"]');
    assert(await page.locator("#ownerFilter").isVisible(), "查看对方共享账单后没有进入来源筛选");
    assert((await text(page, "#ledgerCount")) === "1 笔", "快捷查看对方账本数量不正确");

    const pairContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block"
    });
    await configurePage(pairContext, { id: ownerId, email: "owner@example.com" });
    const pairPage = await pairContext.newPage();
    let paired = false;
    await pairPage.route(`${mockOrigin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      if (url.pathname === "/rest/v1/profiles" && request.method() === "GET") {
        const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
        if (id === ownerId) {
          return json(route, [{
            id: ownerId,
            display_name: "我",
            invite_code: "OWN123",
            partner_id: paired ? partnerId : null
          }]);
        }
        if (id === partnerId) {
          return json(route, [{
            id: partnerId,
            display_name: "佳嘉",
            invite_code: "JIA123",
            partner_id: ownerId
          }]);
        }
      }
      if (url.pathname === "/rest/v1/rpc/claim_invite" && request.method() === "POST") {
        paired = true;
        return json(route, { partner_id: partnerId, display_name: "佳嘉" });
      }
      if (url.pathname === "/rest/v1/transactions" && request.method() === "GET") {
        return json(route, []);
      }
      return json(route, []);
    });
    await pairPage.goto(base, { waitUntil: "networkidle" });
    await pairPage.click('.tab[data-view="settings"]');
    assert((await pairPage.locator("#cloudPanel").textContent()).includes("OWN123"), "未配对方时没有显示配对码");
    await pairPage.fill("#pairCodeInput", "JIA123");
    await pairPage.click('[data-cloud-action="pair"]');
    await pairPage.waitForFunction(() => document.querySelector("#cloudPanel").textContent.includes("已配对"));
    assert((await pairPage.locator("#cloudPanel").textContent()).includes("多多"), "配对后没有固定显示多多昵称");
    await pairContext.close();

    assert(errors.length === 0, `浏览器错误：\n${errors.join("\n")}`);
    console.log(JSON.stringify({
      ok: true,
      visibleTransactions: transactions.length,
      readOnlyPartnerEntry: true,
      privateAndSharedScopes: true,
      pairingFlow: true,
      screenshots: ["readonly-partner.png", "cloud-home.png", "cloud-settings.png"]
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
