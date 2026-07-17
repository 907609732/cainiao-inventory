import type { Locator, Page } from "playwright";

export async function prepareDefaultInventoryView(page: Page): Promise<void> {
  const detailTab = await waitForFirstVisible(page, [
    page.getByRole("tab", { name: "库存明细", exact: true }).first(),
    page.locator('.cn-next-tabs-tab-inner:has-text("库存明细"), .cn-ui-tab-item:has-text("库存明细")').first(),
    page.getByText("库存明细", { exact: true }).first()
  ], 30_000);
  if (!detailTab) throw new Error("未找到库存明细标签，菜鸟页面可能已经改版。");
  if (await detailTab.getAttribute("aria-selected") !== "true") {
    await detailTab.click({ force: true });
    await page.waitForTimeout(500);
  }
}

export async function findInventoryExportButton(page: Page, timeoutMs = 30_000): Promise<Locator> {
  const button = await waitForFirstVisible(page, [
    page.getByRole("button", { name: /导出明细/ }).first(),
    page.locator('button:has-text("导出明细"), .ant-btn:has-text("导出明细"), .cn-next-btn:has-text("导出明细")').first(),
    page.getByText("导出明细", { exact: true }).first()
  ], timeoutMs);
  if (!button) throw new Error("未找到导出明细按钮，已停止且不会发送钉钉。");
  return button;
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    if (await candidate.count() && await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function waitForFirstVisible(page: Page, candidates: Locator[], timeoutMs: number): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    const match = await firstVisible(candidates);
    if (match) return match;
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return null;
}
