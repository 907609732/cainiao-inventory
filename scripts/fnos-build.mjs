import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, writeFile, chmod, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.env.FNOS_OUTPUT_DIR || path.join(root, 'dist/fnos'));
const fnpack = process.env.FNPACK || 'fnpack';
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
await mkdir(out, { recursive: true });
const stagingParent = path.join(out, 'staging');
await mkdir(stagingParent);
run(fnpack, ['create', 'cainiao-warehouse', '--template', 'docker'], stagingParent);
const project = path.join(stagingParent, 'cainiao-warehouse');
await cp(path.join(root, 'deploy/fnos/package'), project, { recursive: true });
const icon = path.join(root, 'windows/workbench/desktop/assets/lingtu-icon.png');
await mkdir(path.join(project, 'app/ui/images'), { recursive: true });
for (const size of [64, 256]) {
  const destination = path.join(project, size === 64 ? 'ICON.PNG' : 'ICON_256.PNG');
  run('convert', [icon, '-resize', `${size}x${size}`, destination]);
  await copyFile(destination, path.join(project, `app/ui/images/icon_${size}.png`));
}
for (const hook of ['uninstall_callback', 'upgrade_callback', 'config_init']) {
  await writeFile(path.join(project, 'cmd', hook), '#!/bin/bash\nset -euo pipefail\nexit 0\n');
}
for (const file of await readdir(path.join(project, 'cmd'))) await chmod(path.join(project, 'cmd', file), 0o755);
await copyFile(path.join(root, 'deploy/fnos/THIRD-PARTY.md'), path.join(project, 'THIRD-PARTY.md'));
await copyFile(path.join(root, 'LICENSE'), path.join(project, 'LICENSE'));
run(fnpack, ['build'], project);
const packages = (await readdir(project)).filter((file) => file.endsWith('.fpk'));
if (packages.length !== 1) throw new Error('fnpack must produce exactly one FPK');
await copyFile(path.join(project, packages[0]), path.join(out, 'cainiao-warehouse-0.10.1-x86.fpk'));
const artifacts = (await readdir(out)).filter((file) => file.endsWith('.fpk') || file.endsWith('.tar.gz'));
const sums = [];
for (const file of artifacts) sums.push(`${createHash('sha256').update(await readFile(path.join(out, file))).digest('hex')}  ${file}`);
await writeFile(path.join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
await writeFile(path.join(out, 'build.json'), JSON.stringify({ appId: 'cainiao-warehouse', version: '0.10.1', gitCommit: process.env.GITHUB_SHA || null, githubRunId: process.env.GITHUB_RUN_ID || null, node: process.version, playwright: JSON.parse(await readFile(path.join(root, 'windows/workbench/package-lock.json'))).packages['node_modules/playwright'].version, image: 'cainiao-warehouse:0.10.1' }, null, 2));
