import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import * as locations from '../desktop/shared/workbench-location.mjs';
import {createRuntimeCapabilities} from '../desktop/shared/runtime-contract.mjs';

const require = createRequire(import.meta.url);
test('external clients identify standalone cloud as a separate application', () => {
  const value=createRuntimeCapabilities({version:'0.9.5',packaged:true,executable:'CainiaoWarehouse.exe'});
  assert.equal(value.application.name,'cainiao-cloud-warehouse');
  assert.equal(value.application.source.repository,'https://github.com/907609732/cainiao-inventory');
});
test('standalone installer cannot use workbench installation identity or folder', () => {
  const config = require('../build/electron-builder.config.cjs');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.name, 'cainiao-cloud-warehouse');
  assert.equal(config.appId, 'com.wucheng.cainiao.warehouse');
  assert.equal(config.executableName, 'CainiaoWarehouse');
  assert.equal(config.nsis.allowToChangeInstallationDirectory, false);
});

test('standalone default ignores workbench binding and inherited host registry', t => {
  assert.equal(typeof locations.getWarehouseLocation, 'function');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-separation-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const home = path.join(root, 'home'), appData = path.join(root, 'appdata');
  const marker = locations.workbenchLocationFile(home);
  fs.mkdirSync(path.dirname(marker), {recursive:true});
  fs.writeFileSync(marker, '{invalid workbench marker must not affect standalone}');
  const before = fs.readFileSync(marker);
  const result = locations.getWarehouseLocation(appData, {home, registryFile:path.join(root, 'workbench-registry.json')});
  assert.equal(result.profile, path.join(appData, 'cainiao-cloud-warehouse'));
  assert.equal(result.registryFile, path.join(result.profile, 'integrations', 'registry.json'));
  assert.deepEqual(fs.readFileSync(marker), before);
  assert.equal(fs.existsSync(appData), false);
});

test('explicit managed warehouse keeps the original host profile and registry', () => {
  assert.equal(typeof locations.getWarehouseLocation, 'function');
  const profile = path.resolve('managed-test-profile'), registryFile = path.resolve('host-registry.json');
  assert.deepEqual(locations.getWarehouseLocation(path.resolve('unused'), {managed:true, explicitProfile:profile, registryFile}),
    {profile, registryFile, source:'explicit'});
});
