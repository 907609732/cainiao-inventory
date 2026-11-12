import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('offline backup preserves dataset and key, rejects corrupt restore without modifying destination', async () => {
  const { backupData, restoreData } = await import('../scripts/fnos-backup.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cainiao-package-'));
  try {
    const source = path.join(dir, 'data');
    await mkdir(source);
    await writeFile(path.join(source, 'dataset.json'), JSON.stringify({ datasetId: 'dataset-a' }));
    await writeFile(path.join(source, 'master.key'), Buffer.alloc(32, 17));
    const backup = path.join(dir, 'backup');
    await backupData({ source, destination: backup, serviceStopped: true });
    const restored = path.join(dir, 'restored');
    await restoreData({ source: backup, destination: restored, serviceStopped: true });
    assert.deepEqual(await readFile(path.join(restored, 'master.key')), Buffer.alloc(32, 17));
    assert.equal(JSON.parse(await readFile(path.join(restored, 'dataset.json'))).datasetId, 'dataset-a');
    await assert.rejects(restoreData({ source: backup, destination: restored, serviceStopped: true }), /empty|exist/i);
    await writeFile(path.join(backup, 'data', 'master.key'), 'corrupt');
    await assert.rejects(restoreData({ source: backup, destination: path.join(dir, 'corrupt'), serviceStopped: true }), /integrity/i);
    await assert.rejects(backupData({ source, destination: path.join(dir, 'live') }), /stopped/i);
    await writeFile(path.join(source, 'runtime.lock'), JSON.stringify({ pid: process.pid }));
    await assert.rejects(backupData({ source, destination: path.join(dir, 'live-lock'), serviceStopped: true }), /live process/i);
    await rm(path.join(source, 'runtime.lock'));
    await rm(path.join(source, 'master.key'));
    await assert.rejects(backupData({ source, destination: path.join(dir, 'missing-key'), serviceStopped: true }), /ENOENT|key/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('package exposes gateway and host-loopback API only, isolates data and drops container privileges', async () => {
  const compose = await readFile(new URL('../deploy/fnos/package/app/docker/docker-compose.yaml', import.meta.url), 'utf8');
  assert.match(compose, /127\.0\.0\.1:18762:18762/);
  assert.match(compose, /18761:18761/);
  assert.doesNotMatch(compose, /docker\.sock|privileged: true|network_mode: host|5900:|6080:/);
  assert.match(compose, /\$\{TRIM_PKGVAR\}\/data:\/data/);
  assert.match(compose, /no-new-privileges/);
  assert.match(compose, /cap_drop: \[ALL\]/);
});

test('Linux backup distinguishes live process owner from reused namespace PID', { skip: process.platform !== 'linux' }, async () => {
  const { backupData } = await import('../scripts/fnos-backup.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cainiao-process-proof-'));
  try {
    const source = path.join(dir, 'data');
    await mkdir(source);
    await writeFile(path.join(source, 'dataset.json'), JSON.stringify({ datasetId: 'dataset-a' }));
    await writeFile(path.join(source, 'master.key'), Buffer.alloc(32, 17));
    const stat = await readFile(`/proc/${process.pid}/stat`, 'utf8');
    const processStart = { bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(), startTime: stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19] };
    await writeFile(path.join(source, 'runtime.lock'), JSON.stringify({ pid: process.pid, processStart }));
    await assert.rejects(backupData({ source, destination: path.join(dir, 'active'), serviceStopped: true }), /live process/i);
    await writeFile(path.join(source, 'runtime.lock'), JSON.stringify({ pid: process.pid, processStart: { ...processStart, startTime: `${processStart.startTime}0` } }));
    await backupData({ source, destination: path.join(dir, 'stale'), serviceStopped: true });
    assert.equal(JSON.parse(await readFile(path.join(dir, 'stale', 'backup.json'))).datasetId, 'dataset-a');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
