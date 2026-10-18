const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("C:/Users/FY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const shots = path.join(__dirname, "screenshots");
const base = "http://127.0.0.1:4181/";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function text(page, selector) {
  return (await page.locator(selector).textContent()).trim();
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
    acceptDownloads: true
  });
  const page = await context.newPage();
  const errors = [];

  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  try {
    await page.goto(base, { waitUntil: "networkidle" });
    assert(await page.locator(".brand").isVisible(), "首页品牌区未显示");
    assert((await text(page, ".brand")).includes("佳嘉记账"), "应用名称没有更新");
    assert(await text(page, "#monthExpense") === "¥0.00", "初始支出不是 0");
    await page.screenshot({ path: path.join(shots, "home-light.png"), fullPage: true });

    await page.click("#tabAddButton");
    assert(await page.locator("#sheetLayer").isVisible(), "记账弹层未打开");
    assert(await page.locator("#deleteButton").isHidden(), "新增账单时不应显示删除按钮");
    await page.fill("#amountInput", "25.80");
    await page.click('[data-category="exp-food"]');
    await page.fill("#dateInput", "2026-10-17");
    await page.fill("#noteInput", "午饭");
    await page.click(".save-button");
    await page.waitForFunction(() => document.querySelector("#sheetLayer").hidden);
    assert(await text(page, "#monthExpense") === "¥25.80", "支出保存后金额不正确");
    assert((await text(page, "#recentList")).includes("仅自己"), "默认私密标记未显示");

    await page.click("#headerAddButton");
    await page.click('[data-type="income"]');
    await page.fill("#amountInput", "1000");
    await page.click('[data-category="inc-allowance"]');
    await page.click('[data-visibility="partner"]');
    await page.fill("#dateInput", "2026-10-17");
    await page.fill("#noteInput", "生活费");
    await page.click(".save-button");
    await page.waitForFunction(() => document.querySelector("#sheetLayer").hidden);
    assert(await text(page, "#monthIncome") === "¥1,000.00", "收入保存后金额不正确");
    assert(await text(page, "#monthBalance") === "¥974.20", "月结余计算不正确");

    await page.click('.tab[data-view="ledger"]');
    await page.fill("#ledgerSearch", "午饭");
    assert(await text(page, "#ledgerCount") === "1 笔", "明细搜索数量不正确");
    await page.locator("#ledgerList .bill-row", { hasText: "午饭" }).click();
    assert(await page.locator("#deleteButton").isVisible(), "编辑账单时应显示删除按钮");
    await page.fill("#amountInput", "30.50");
    await page.click(".save-button");
    await page.waitForFunction(() => document.querySelector("#sheetLayer").hidden);
    await page.fill("#ledgerSearch", "");
    assert(await text(page, "#ledgerCount") === "2 笔", "账单编辑后数量不正确");

    await page.click('.tab[data-view="stats"]');
    assert(await text(page, "#statsTotal") === "30.50", "统计支出总额不正确");
    assert((await text(page, "#categoryRank")).includes("餐饮"), "分类统计中缺少餐饮");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(shots, "stats-light.png"), fullPage: true });

    await page.click('.tab[data-view="settings"]');
    assert(await text(page, "#recordSummary") === "2 笔可见账单", "设置页账单数量不正确");
    assert((await text(page, "#cloudPanel")).includes("共享服务已配置"), "共享账本登录入口未显示");
    assert((await text(page, "#cloudPanel")).includes("不需要等待验证邮件"), "免验证注册说明未显示");
    assert(await page.locator('[data-cloud-action="resend"]').count() === 0, "无需邮箱验证时不应显示重发入口");
    await page.fill("#cloudEmailInput", "not-an-email");
    await page.fill("#cloudPasswordInput", "123456");
    await page.click('[data-cloud-action="signup"]');
    assert((await text(page, "#cloudPanel")).includes("邮箱格式不正确"), "注册邮箱校验没有给出中文提示");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#exportJsonButton")
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const backup = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert(backup.app === "jiajia-ledger", "备份标记不正确");
    assert(backup.transactions.length === 2, "备份账单数量不正确");

    page.once("dialog", (dialog) => dialog.accept());
    await page.setInputFiles("#importInput", {
      name: "wallet-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        app: "jiajia-ledger",
        schemaVersion: 2,
        transactions: [backup.transactions[0]]
      }))
    });
    await page.waitForFunction(() => document.querySelector("#recordSummary").textContent.includes("1 笔"));
    assert(await text(page, "#recordSummary") === "1 笔可见账单", "备份恢复没有替换账单");

    await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
    const manifestStatus = await page.evaluate(async () => (await fetch("./manifest.webmanifest")).status);
    assert(manifestStatus === 200, "manifest 无法读取");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert(!overflow, "页面出现横向溢出");

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    assert(await page.locator(".brand").isVisible(), "离线刷新后应用未显示");
    await context.setOffline(false);

    await page.emulateMedia({ colorScheme: "dark" });
    await page.click('.tab[data-view="home"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, "home-dark.png"), fullPage: true });
    await page.click("#tabAddButton");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shots, "sheet-dark.png"), fullPage: true });
    await page.keyboard.press("Escape");

    const narrow = await context.newPage();
    await narrow.setViewportSize({ width: 320, height: 720 });
    await narrow.goto(base, { waitUntil: "networkidle" });
    await narrow.click("#tabAddButton");
    await narrow.waitForTimeout(400);
    assert(!(await narrow.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "320px 宽度出现横向溢出");
    assert(await narrow.locator(".save-button").isVisible(), "窄屏保存按钮不可见");
    const scrollBox = narrow.locator(".sheet-scroll");
    await scrollBox.hover();
    await narrow.mouse.wheel(0, 600);
    await narrow.waitForTimeout(150);
    const scrollTop = await scrollBox.evaluate((node) => node.scrollTop);
    assert(scrollTop > 0, "记账弹层无法滚动到备注");
    await narrow.fill("#noteInput", "备注可以输入");
    assert(await narrow.inputValue("#noteInput") === "备注可以输入", "备注输入失败");
    await narrow.screenshot({ path: path.join(shots, "sheet-narrow.png"), fullPage: true });
    await narrow.close();

    const desktop = await context.newPage();
    await desktop.setViewportSize({ width: 1280, height: 900 });
    await desktop.goto(base, { waitUntil: "networkidle" });
    await desktop.waitForTimeout(400);
    assert(!(await desktop.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "桌面宽度出现横向溢出");
    const appWidth = await desktop.locator(".app-shell").evaluate((node) => node.getBoundingClientRect().width);
    assert(appWidth <= 680, "桌面应用主体宽度超出限制");
    await desktop.screenshot({ path: path.join(shots, "home-desktop.png"), fullPage: true });
    await desktop.close();

    assert(errors.length === 0, `浏览器错误：\n${errors.join("\n")}`);
    console.log(JSON.stringify({
      ok: true,
      recordsAfterRestore: 1,
      offlineReload: true,
      manifestStatus,
      screenshots: fs.readdirSync(shots)
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
