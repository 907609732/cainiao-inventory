import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, copyFile, lstat, rename, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function filesIn(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Backup refuses symbolic links');
    if (entry.isDirectory()) files.push(...await filesIn(root, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error('Backup refuses nonregular files');
  }
  return files.sort();
}
async function requireAbsent(destination) {
  try { await lstat(destination); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Destination must not exist; restore to a fresh empty directory');
}
async function identity(root) {
  const dataset = JSON.parse(await readFile(path.join(root, 'dataset.json'), 'utf8'));
  if (typeof dataset.datasetId !== 'string' || !dataset.datasetId) throw new Error('Invalid dataset identity');
  if ((await readFile(path.join(root, 'master.key'))).length !== 32) throw new Error('Invalid master key');
  return dataset.datasetId;
}
async function requireStopped(root) {
  for (const name of ['runtime.lock', 'task.lock', 'service.lock']) {
    let record;
    try { record = JSON.parse(await readFile(path.join(root, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw new Error('Unreadable service lock; cannot prove stopped'); }
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0) throw new Error('Invalid service lock; cannot prove stopped');
    try { process.kill(record.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') continue; throw new Error('Service lock owner cannot be verified stopped'); }
    if (process.platform === 'linux' && record.processStart) {
      if (typeof record.processStart.bootId !== 'string' || !record.processStart.bootId || !/^\d+$/.test(record.processStart.startTime || '')) throw new Error('Invalid service process identity; cannot prove stopped');
      try {
        const stat = await readFile(`/proc/${record.pid}/stat`, 'utf8');
        const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
        const startTime = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
        if (!startTime || !bootId) throw new Error('Incomplete process identity');
        if (record.processStart.bootId !== bootId || record.processStart.startTime !== startTime) continue;
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
        throw new Error('Service process identity cannot be verified stopped');
      }
    }
    throw new Error('Service must be stopped; live process lock exists');
  }
}
function requireOffline(options) {
  if (options.serviceStopped !== true) throw new Error('Service must be stopped before backup or restore');
  const source = path.resolve(options.source), destination = path.resolve(options.destination);
  const relative = path.relative(source, destination);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('Destination must be outside source');
  return { source, destination };
}
export async function backupData(options) {
  const { source, destination } = requireOffline(options);
  await requireAbsent(destination);
  await requireStopped(source);
  const datasetId = await identity(source);
  const staging = `${destination}.partial-${randomUUID()}`;
  try {
    await mkdir(path.join(staging, 'data'), { recursive: true, mode: 0o700 });
    const entries = [];
    for (const file of await filesIn(source)) {
      const bytes = await readFile(path.join(source, file));
      entries.push({ path: file, sha256: sha256(bytes), size: bytes.length });
      await mkdir(path.dirname(path.join(staging, 'data', file)), { recursive: true, mode: 0o700 });
      await writeFile(path.join(staging, 'data', file), bytes, { mode: 0o600 });
    }
    await writeFile(path.join(staging, 'backup.json'), JSON.stringify({ format: 'cainiao-warehouse-backup-v1', datasetId, createdAt: new Date().toISOString(), files: entries }, null, 2), { mode: 0o600 });
    await rename(staging, destination);
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
export async function restoreData(options) {
  const { source, destination } = requireOffline(options);
  await requireAbsent(destination);
  const manifest = JSON.parse(await readFile(path.join(source, 'backup.json'), 'utf8'));
  if (manifest.format !== 'cainiao-warehouse-backup-v1' || !Array.isArray(manifest.files)) throw new Error('Invalid backup manifest');
  const actual = await filesIn(path.join(source, 'data'));
  const listed = manifest.files.map((entry) => entry.path);
  if (new Set(listed).size !== listed.length || JSON.stringify([...listed].sort()) !== JSON.stringify(actual)) throw new Error('Backup integrity: unexpected files');
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || entry.path.includes('\\') || entry.path.split('/').some((part) => part === '..' || part === '') || path.isAbsolute(entry.path)) throw new Error('Backup integrity: unsafe path');
    const bytes = await readFile(path.join(source, 'data', entry.path));
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) throw new Error('Backup integrity check failed');
  }
  if (await identity(path.join(source, 'data')) !== manifest.datasetId) throw new Error('Backup integrity: dataset mismatch');
  const staging = `${destination}.partial-${randomUUID()}`;
  try {
    await mkdir(staging, { recursive: true, mode: 0o700 });
    for (const entry of manifest.files) {
      const target = path.join(staging, entry.path);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(path.join(source, 'data', entry.path), target);
      await chmod(target, 0o600);
    }
    await rename(staging, destination);
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, source, destination, confirmation] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(operation) || !source || !destination || confirmation !== '--service-stopped') throw new Error('Usage: fnos-backup.mjs backup|restore SOURCE DESTINATION --service-stopped');
  await (operation === 'backup' ? backupData : restoreData)({ source, destination, serviceStopped: true });
  console.log(`${operation} completed; no credentials printed`);
}
