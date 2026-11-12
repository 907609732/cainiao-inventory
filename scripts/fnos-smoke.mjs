import { spawnSync } from 'node:child_process';
const image = 'cainiao-warehouse:0.10.3';
const suffix = `${process.env.GITHUB_RUN_ID || process.pid}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
const name = `cainiao-warehouse-ci-${suffix}`, volume = `${name}-data`;
const dynamicName = `${name}-dynamic-uid`;
function docker(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`docker ${args[0]} failed`);
  return result.stdout?.trim() || '';
}
async function healthy(target = name) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const status = docker(['inspect', '--format={{.State.Health.Status}}', target], { capture: true });
    if (status === 'healthy') return;
    if (status === 'unhealthy') throw new Error('Container became unhealthy');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Container startup health timed out');
}
async function recoveredAfter(restartCount) {
  for (let attempt = 0; attempt < 90; attempt++) {
    const state = JSON.parse(docker(['inspect', '--format={"RestartCount":{{.RestartCount}},"State":{{json .State}}}', name], { capture: true }));
    if (state.RestartCount > restartCount && state.State.Status === 'running' && state.State.Health?.Status === 'healthy') return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Service crash did not trigger a healthy automatic container restart');
}
try {
  docker(['volume', 'create', volume], { capture: true });
  docker(['run', '--rm', '-v', `${volume}:/data`, '--entrypoint', 'node', image, '--input-type=module', '-e', 'import fs from "node:fs"; for(const path of ["/data","/data/home","/data/home/.config","/data/home/.cache"]){if(fs.statSync(path).uid!==process.getuid())throw new Error("Image volume copied incorrect ownership");fs.accessSync(path,fs.constants.W_OK);}fs.writeFileSync("/data/public-origin","http://127.0.0.1:18761",{mode:0o600});']);
  docker(['run', '-d', '--name', name, '--restart=unless-stopped', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=512m', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--shm-size=512m', '-v', `${volume}:/data`, '-e', 'CAINIAO_DATA_DIR=/data', '-e', 'CAINIAO_GATEWAY_HOST=0.0.0.0', '-e', 'CAINIAO_GATEWAY_PORT=18761', '-e', 'CAINIAO_API_HOST=0.0.0.0', '-e', 'CAINIAO_API_PORT=18762', '-e', 'CAINIAO_BROWSER_URL=http://127.0.0.1:6080', '-e', 'TZ=Asia/Shanghai', image], { capture: true });
  await healthy();
  docker(['exec', name, 'node', '--input-type=module', '-e', 'const r=await fetch("http://127.0.0.1:18761/api/v1/session");if(r.status!==200||!(await r.json()).csrf)throw Error("Direct browser access failed");if((await fetch("http://127.0.0.1:18762/api/v1/call/getInventory",{method:"POST",headers:{"content-type":"application/json"},body:"{}"})).status!==401)throw Error("API credential gate missing");']);
  const headedFixture = 'import fs from "node:fs";import {chromium} from "playwright";for(const key of ["XDG_CONFIG_HOME","XDG_CACHE_HOME"]){if(!process.env[key]?.startsWith("/data/home/"))throw new Error("Missing private writable browser directory");if(fs.statSync(process.env[key]).uid!==process.getuid())throw new Error("Browser directory owner mismatch");fs.accessSync(process.env[key],fs.constants.W_OK);}const browser=await chromium.launch({headless:false});try{const page=await browser.newPage();await page.setContent("<title>cainiao-headed-xvfb-fixture</title>");if(await page.title()!=="cainiao-headed-xvfb-fixture")throw new Error("Headed Xvfb browser fixture failed");}finally{await browser.close();}';
  docker(['exec', name, 'node', '--input-type=module', '-e', headedFixture]);
  // fnOS package UIDs need not exist in /etc/passwd. Give an arbitrary UID its
  // own private writable data mount while keeping the production restrictions.
  docker(['run', '-d', '--name', dynamicName, '--user=23456:23456', '--read-only', '--tmpfs', '/data:rw,nosuid,nodev,uid=23456,gid=23456,mode=0700,size=128m', '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777,size=512m', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--shm-size=512m', '-e', 'CAINIAO_PUBLIC_ORIGIN=http://127.0.0.1:18761', '-e', 'CAINIAO_DATA_DIR=/data', '-e', 'CAINIAO_GATEWAY_HOST=0.0.0.0', '-e', 'CAINIAO_API_HOST=0.0.0.0', '-e', 'CAINIAO_BROWSER_URL=http://127.0.0.1:6080', '-e', 'TZ=Asia/Shanghai', image], { capture: true });
  await healthy(dynamicName);
  docker(['exec', dynamicName, 'node', '--input-type=module', '-e', headedFixture]);
  docker(['stop', '--time', '60', dynamicName], { capture: true });
  const fingerprint = () => docker(['exec', name, 'node', '--input-type=module', '-e', 'import fs from "node:fs"; import {createHash} from "node:crypto";process.stdout.write(createHash("sha256").update(fs.readFileSync("/data/dataset.json")).update(fs.readFileSync("/data/master.key")).digest("hex"));'], { capture: true });
  const before = fingerprint();
  docker(['restart', '--time', '60', name], { capture: true });
  await healthy();
  if (fingerprint() !== before) throw new Error('Dataset/key changed on restart');
  const restartCount = Number(docker(['inspect', '--format={{.RestartCount}}', name], { capture: true }));
  // Kill the service child, not docker kill: an explicit operator stop can
  // suppress restart policies and would not prove unattended fault recovery.
  docker(['exec', name, 'node', '--input-type=module', '-e', 'import fs from "node:fs";const {pid}=JSON.parse(fs.readFileSync("/data/runtime.lock","utf8"));if(!Number.isSafeInteger(pid)||pid<=1||pid===process.pid)throw new Error("Invalid runtime PID");process.kill(pid,"SIGKILL");'], { allowFailure: true });
  await recoveredAfter(restartCount);
  if (fingerprint() !== before) throw new Error('Dataset/key changed after service crash recovery');
  docker(['stop', '--time', '60', name], { capture: true });
  docker(['run', '--rm', '-v', `${volume}:/data`, '--entrypoint', 'node', image, '--input-type=module', '-e', 'import {backupData,restoreData} from "/app/scripts/fnos-backup.mjs";import fs from "node:fs";await backupData({source:"/data",destination:"/tmp/backup",serviceStopped:true});await restoreData({source:"/tmp/backup",destination:"/tmp/restored",serviceStopped:true});for(const name of ["dataset.json","master.key"])if(!fs.readFileSync("/data/"+name).equals(fs.readFileSync("/tmp/restored/"+name)))throw new Error("restore mismatch");']);
  console.log('Linux service, headed Xvfb browser, graceful restart, automatic crash recovery, dataset/key preservation and offline backup/restore passed.');
} catch (error) {
  // Runtime logs must already redact secrets; do not dump Docker env or data.
  docker(['logs', '--tail', '100', name], { allowFailure: true });
  docker(['logs', '--tail', '100', dynamicName], { allowFailure: true });
  throw error;
} finally {
  docker(['rm', '-f', name], { allowFailure: true, capture: true });
  docker(['rm', '-f', dynamicName], { allowFailure: true, capture: true });
  docker(['volume', 'rm', volume], { allowFailure: true, capture: true });
}
