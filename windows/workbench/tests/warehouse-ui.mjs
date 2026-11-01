import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {_electron} from 'playwright';
import {EXTERNAL_LINKS} from '../desktop/shared/external-links.mjs';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cainiao-current-ui-'));
const workspace = path.join(profile, 'workspace');
const data = path.join(workspace, 'data');
const managed = process.env.WAREHOUSE_TEST_MANAGED === '1';
fs.mkdirSync(data, {recursive: true});
const env = {...process.env, CAINIAO_APP_DATA_DIR: workspace, ERP_DATA_DIR: data,
  LINGTU_REGISTRY_PATH: path.join(profile, 'registry.json'), LINGTU_ISOLATED_TEST: '1',
  LINGTU_MANAGED_MODULE: managed ? '1' : '0', LINGTU_TEST_LEDGER: '1', LINGTU_BUSINESS_ONLY: '1'};
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
    args: [...(packagedExecutable ? [] : ['.']), '--user-data-dir=' + profile, ...(managed ? ['--managed-module=warehouse'] : [])], env});
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => !!window.inventoryApp);
  await page.waitForLoadState('domcontentloaded');
  assert.equal(await page.title(), managed ? '云仓同步 · 五成电子商务工作台' : '菜鸟云仓');
  assert.equal(await app.evaluate(({app}) => app.getPath('userData')), profile);
  assert.equal(await app.evaluate(() => process.env.LINGTU_REGISTRY_PATH), managed ? path.join(profile, 'registry.json') : path.join(profile, 'integrations', 'registry.json'));
  const state = await page.evaluate(() => window.inventoryApp.getState());
  assert.equal(state.running, false);
  assert.equal(Boolean(state.nextScheduledRun), false);
  assert.equal(Boolean(state.nextMonthlyScheduledRun), false);
  const views = ['dashboard', 'inventory', 'sales', 'settings'];
  assert.deepEqual(await page.locator('.view-tab').evaluateAll(nodes => nodes.map(n => n.dataset.view)), views);
  for (const view of views) {
    await page.locator(`.view-tab[data-view="${view}"]`).click();
    await page.locator(`[data-view-panel="${view}"]`).waitFor({state: 'visible'});
    if (!managed) assert.doesNotMatch(await page.locator('body').innerText(), /工作台|Tailscale|主服务器|员工/, view);
  }
  assert.equal(await page.locator('[data-managed-only]').isVisible(), managed);
  assert.equal(await page.locator('#featureHelpSettings, #featureHelpDialog, #featureManualButton').count(), 0);
  assert.equal(await page.locator('#maintenanceCard').count(), 1);
  for (const id of ['loginState','updateState','aboutVersion','refreshLogin','openData','openLogs','checkUpdate','installUpdate','openReleaseNotes']) {
    assert.equal(await page.locator('#maintenanceCard #'+id).count(), 1, id);
  }
  assert.equal(await page.locator('#changelogList, #aboutBuild, #aboutChannel, #updateCredentialState').count(), 0);
  assert.equal(await page.locator('#settingsLinks').evaluate(el=>el===el.parentElement.lastElementChild), true);
  assert.equal(await page.locator('#settingsLinks #openWebsite').count(),1);
  assert.equal(await page.locator('#settingsLinks #openRepository').count(),1);
  await app.evaluate(({shell}) => {
    globalThis.originalExternalOpen = shell.openExternal;
    globalThis.openedExternalLinks = [];
    shell.openExternal = async url => { globalThis.openedExternalLinks.push(url); };
  });
  try {
    for (const id of ['openWebsite','openRepository',...(managed ? [] : ['openReleaseNotes'])]) await page.locator('#'+id).click();
    assert.deepEqual(await app.evaluate(() => globalThis.openedExternalLinks), [EXTERNAL_LINKS.website,EXTERNAL_LINKS.repository,...(managed ? [] : [EXTERNAL_LINKS.releases])]);
  } finally {
    await app.evaluate(({shell}) => { shell.openExternal = globalThis.originalExternalOpen; });
  }
  if (!managed) {
    for (const status of ['checking','downloading','ready','error','idle']) {
      await app.evaluate(({BrowserWindow}, status) => BrowserWindow.getAllWindows()[0].webContents.send('update:state', {status,message:'测试更新状态：'+status}),status);
      await page.waitForFunction(status => document.getElementById('updateState').textContent === '测试更新状态：'+status,status);
      assert.equal(await page.locator('#installUpdate').isVisible(), status==='ready');
      assert.equal(await page.locator('#checkUpdate').isDisabled(), ['checking','downloading'].includes(status));
    }
  }
  await page.evaluate(() => window.inventoryApp.getInventory());
  assert.equal(await page.locator('[data-view="attendance"]').count(), 0);
  assert.deepEqual(errors, []);
  const version = await app.evaluate(({app}) => app.getVersion());
  assert.equal(version, JSON.parse(fs.readFileSync('package.json')).version);
  console.log(JSON.stringify({ok: true, version, managed, packaged: Boolean(packagedExecutable), views, inventoryRead: true, rendererErrors: errors, isolated: true}));
} finally {
  await app?.close();
  fs.rmSync(profile, {recursive: true, force: true});
}
