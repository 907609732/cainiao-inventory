import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {_electron} from 'playwright';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cainiao-current-ui-'));
const workspace = path.join(profile, 'workspace');
const data = path.join(workspace, 'data');
fs.mkdirSync(data, {recursive: true});
const env = {...process.env, CAINIAO_APP_DATA_DIR: workspace, ERP_DATA_DIR: data,
  LINGTU_REGISTRY_PATH: path.join(profile, 'registry.json'), LINGTU_ISOLATED_TEST: '1',
  LINGTU_MANAGED_MODULE: '0', LINGTU_TEST_LEDGER: '1', LINGTU_BUSINESS_ONLY: '1'};
delete env.ELECTRON_RUN_AS_NODE;
const initialized = spawnSync(process.execPath, ['--input-type=module', '-e',
  "import {getDb,closeDb} from './core/erp/db.js';getDb();closeDb();"],
  {env, encoding: 'utf8', windowsHide: true});
assert.equal(initialized.status, 0, initialized.stderr);
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({runtimeMode: 'server',
  firstRunPending: false, scheduleEnabled: false, monthlySalesEnabled: false, startAtLogin: false}));
let app;
const packagedExecutable = process.env.WAREHOUSE_TEST_EXE ? path.resolve(process.env.WAREHOUSE_TEST_EXE) : '';
try {
  app = await _electron.launch({executablePath: packagedExecutable || path.resolve('node_modules/electron/dist/electron.exe'),
    args: [...(packagedExecutable ? [] : ['.']), '--user-data-dir=' + profile], env});
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.inventoryApp);
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await page.title(), '菜鸟云仓');
  assert.equal(await app.evaluate(({app}) => app.getPath('userData')), profile);
  assert.equal(await app.evaluate(() => process.env.LINGTU_REGISTRY_PATH), path.join(profile, 'integrations', 'registry.json'));
  const state = await page.evaluate(() => window.inventoryApp.getState());
  assert.equal(state.running, false);
  assert.equal(Boolean(state.nextScheduledRun), false);
  assert.equal(Boolean(state.nextMonthlyScheduledRun), false);
  const views = ['dashboard', 'inventory', 'sales', 'settings'];
  assert.deepEqual(await page.locator('.view-tab').evaluateAll(nodes => nodes.map(n => n.dataset.view)), views);
  for (const view of views) {
    await page.locator(`.view-tab[data-view="${view}"]`).click();
    await page.locator(`[data-view-panel="${view}"]`).waitFor({state: 'visible'});
  }
  await page.evaluate(() => window.inventoryApp.getInventory());
  assert.equal(await page.locator('[data-view="attendance"]').count(), 0);
  assert.deepEqual(errors, []);
  const version = await app.evaluate(({app}) => app.getVersion());
  assert.equal(version, JSON.parse(fs.readFileSync('package.json')).version);
  console.log(JSON.stringify({ok: true, version, packaged: Boolean(packagedExecutable), views, inventoryRead: true, rendererErrors: errors, isolated: true}));
} finally {
  await app?.close();
  fs.rmSync(profile, {recursive: true, force: true});
}
