const { chromium } = require("C:/Users/FY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const appUrl = process.env.APP_URL || "http://127.0.0.1:4181/";

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await page.click("#tabAddButton");
    await page.fill("#amountInput", "12.34");
    await page.fill("#dateInput", "2026-10-18");
    await page.fill("#noteInput", "重复提交测试");
    await page.evaluate(() => {
      const form = document.querySelector("#transactionForm");
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => document.querySelector("#sheetLayer").hidden);
    await page.waitForTimeout(800);
    const rows = await page.locator("#recentList .bill-row", { hasText: "重复提交测试" }).count();
    if (rows !== 1) throw new Error(`重复提交产生了 ${rows} 笔账单`);
    console.log(JSON.stringify({ ok: true, rows, duplicateSubmitBlocked: true }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
