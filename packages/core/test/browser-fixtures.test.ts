import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { findInventoryExportButton, prepareDefaultInventoryView } from "../src/browser-page.js";

const runBrowserFixtures = process.env.CAINIAO_RUN_BROWSER_FIXTURES === "1";

const fixtures = [
  {
    name: "Cainiao Next controls",
    html: `
      <div role="tab" aria-selected="false">库存明细</div>
      <button class="cn-next-btn" onclick="window.exported=true">导出明细</button>`
  },
  {
    name: "Cainiao Ant controls",
    html: `
      <div class="cn-next-tabs-tab-inner">库存明细</div>
      <div onclick="window.exported=true">导出明细</div>`
  }
];

for (const fixture of fixtures) {
  test(`locates ${fixture.name}`, { skip: !runBrowserFixtures }, async () => {
    const browser = await chromium.launch({ headless: true, channel: "chromium" });
    try {
      const page = await browser.newPage();
      await page.setContent(fixture.html);
      await prepareDefaultInventoryView(page);
      const exportButton = await findInventoryExportButton(page);
      await exportButton.click({ force: true });
      assert.equal(await page.evaluate(() => Boolean((window as unknown as { exported?: boolean }).exported)), true);
    } finally {
      await browser.close();
    }
  });
}

test("missing export control fails closed", { skip: !runBrowserFixtures }, async () => {
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  try {
    const page = await browser.newPage();
    await page.setContent(fixtures[0]!.html.replace(/<button class="cn-next-btn"[\s\S]*?<\/button>/, ""));
    await prepareDefaultInventoryView(page);
    await assert.rejects(() => findInventoryExportButton(page, 200), /不会发送钉钉/);
  } finally {
    await browser.close();
  }
});
