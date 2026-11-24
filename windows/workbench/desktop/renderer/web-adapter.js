/* Browser transport for the same explicit API exposed by Electron preload. */
(() => {
  if (window.inventoryApp) return;
  const listeners = new Map();
  const configuredPrefix = typeof window.__CAINIAO_GATEWAY_PREFIX__ === 'string' ? window.__CAINIAO_GATEWAY_PREFIX__ : '';
  const gatewayPrefix = configuredPrefix.startsWith('/') && !configuredPrefix.startsWith('//') ? configuredPrefix.replace(/\/+$/, '') : '';
  let csrf = '', cursor = 0, connected = false, stopped = false;
  let diagnosis = '', displayedStatus = '', displayedDiagnosis = '';
  function status(message) {
    const show = () => {
      let banner = document.getElementById('localWebStatus');
      if (!banner) { banner = document.createElement('div'); banner.id = 'localWebStatus'; banner.className = 'local-web-status'; banner.setAttribute('role', 'status'); document.body.prepend(banner); }
      banner.hidden = !message;
      const detail = message ? diagnosis : '';
      if (message === displayedStatus && detail === displayedDiagnosis) return;
      displayedStatus = message;
      displayedDiagnosis = detail;
      const existingLog = banner.querySelector('textarea');
      const existingMessage = banner.firstChild;
      if (message && detail && existingLog && existingMessage?.nodeType === Node.TEXT_NODE) {
        existingMessage.textContent = message;
        // Keep the displayed snapshot stable while the user is selecting it.
        if (document.activeElement !== existingLog) existingLog.value = detail;
        return;
      }
      banner.textContent = message; banner.hidden = !message;
      if (detail) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = '查看并复制诊断';
        const log = document.createElement('textarea');
        log.value = detail;
        log.readOnly = true;
        log.rows = 7;
        log.style.width = '100%';
        log.setAttribute('aria-label', '连接诊断');
        const copy = document.createElement('button');
        copy.textContent = '复制诊断';
        copy.onclick = async () => {
          try {
            await navigator.clipboard.writeText(log.value);
            copy.textContent = '已复制';
          } catch {
            log.focus();
            log.select();
            log.setSelectionRange(0, log.value.length);
            let copied = false;
            try { copied = document.execCommand('copy'); } catch {}
            copy.textContent = copied ? '已复制' : '请长按诊断文字复制';
          }
        };
        details.append(summary, copy, log);
        banner.append(details);
      }
      if (message) document.getElementById('warehouseLoading')?.remove();
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, {once:true});
  }
  async function request(path, options = {}) {
    const phase = path.split('?')[0].split('/').slice(3,5).map((part,index)=>index===1 && !path.startsWith('/api/v1/call/')?'detail':part).join('/');
    const record = (result, reason = '') => {
      diagnosis = [new Date().toISOString(), '请求 '+(options.method || 'GET')+' '+phase, '结果 '+result, reason, '页面协议 '+window.location.protocol, '内嵌窗口 '+(window.self !== window.top)].filter(Boolean).join('\n');
    };
    let response;
    try { response = await fetch(gatewayPrefix + path, {...options, credentials:'same-origin', cache:'no-store'}); }
    catch (error) { record('网络请求失败'); throw error; }
    if (!response.ok) record('HTTP '+response.status, response.headers.get('X-Cainiao-Gateway-Diagnostic') || '');
    let body;
    try { body = await response.json(); }
    catch { record('HTTP '+response.status, '网关返回了非 JSON 响应'); throw new Error('网关返回了无法识别的响应（HTTP '+response.status+'）'); }
    if (!response.ok || body.ok === false) { const error = new Error(body.error?.message || '本机服务请求失败，请重新打开网页版。'); error.code = body.error?.code; throw error; }
    return body;
  }
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get('token');
  if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const session = request('/api/v1/session', token ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})} : {method:'GET'})
    .then(value => { csrf = value.csrf; return value; })
    .catch(error => { status('无法连接本机后台：' + error.message + '。请从菜鸟云仓重新打开网页版。'); throw error; });
  // Startup failures are also observed here when a page has not called an API yet.
  session.catch(() => {});
  const writes = new Set(['saveSettings','saveSettingsSection','loginRemoteServer','testRemoteServer','runNow','refreshLogin','stopTask','sendDateException','syncMonthlySales','backfillMonthlySales','openLogs','openData','openRepository','openWebsite','openReleaseNotes','checkForUpdates','installUpdate','createAiCredential','revokeAiCredential','openWeb']);
  async function awaitTask(receipt) {
    const taskId = receipt.taskId;
    // Only the read-only receipt is polled. A lost connection never repeats the action.
    for (let attempt = 0; attempt < 1200; attempt++) {
      if (receipt.status === 'succeeded') return receipt.value;
      if (receipt.status === 'failed') {
        const error = new Error((receipt.error?.message || '任务执行失败') + '（任务 ' + taskId + '）');
        error.code = receipt.error?.code; error.taskId = taskId; throw error;
      }
      if (receipt.status !== 'running') throw new Error('任务 ' + taskId + ' 的结果未知，请在应用中核对状态；不要重复提交。');
      if (attempt) await new Promise(resolve => setTimeout(resolve, 1000));
      try { receipt = (await request('/api/v1/tasks/' + encodeURIComponent(taskId), {method:'GET'})).value; }
      catch (error) { throw new Error('无法查询任务 ' + taskId + '：' + error.message + '。请在应用中核对结果；不要重复提交。'); }
      if (!receipt || receipt.taskId !== taskId) throw new Error('任务 ' + taskId + ' 的回执无效，请在应用中核对；不要重复提交。');
    }
    throw new Error('等待任务 ' + taskId + ' 超过 20 分钟，请在应用中核对结果；任务不会自动重启。');
  }
  async function call(operation, payload) {
    const key = writes.has(operation) ? (window.crypto.randomUUID ? window.crypto.randomUUID() : Array.from(window.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')) : null;
    await session;
    let data = payload || {};
    if (operation === 'saveSettings' || operation === 'saveSettingsSection') data = {...data,secrets:Object.fromEntries(Object.entries(data.secrets || {}).filter(([,value])=>value !== ''))};
    if (writes.has(operation)) data = {...data,confirmed:true};
    const headers = {'Content-Type':'application/json','x-csrf-token':csrf};
    if (key) headers['Idempotency-Key'] = key;
    try {
      const value = (await request('/api/v1/call/' + operation,{method:'POST',headers,body:JSON.stringify(data)})).value;
      return value?.taskId && value?.status ? await awaitTask(value) : value;
    }
    catch (error) { status('本机请求未完成：' + error.message + '。请检查后台并核对任务结果；同步和发送不会自动重复。'); throw error; }
  }
  const api = {isLocalWeb:true,getEditableSecrets:async()=>({})};
  for (const method of ['revealSecret','getBranding','getSettings','getAbout','saveSettings','saveSettingsSection','loginRemoteServer','testRemoteServer','runNow','refreshLogin','stopTask','getState','getLogs','previewDateException','sendDateException','getInventory','getMonthlySales','syncMonthlySales','backfillMonthlySales','openLogs','openData','openRepository','openWebsite','openReleaseNotes','getIntegration','getUpdateState','checkForUpdates','installUpdate','getLocalAccess','createAiCredential','revokeAiCredential','openWeb']) api[method] = payload => call(method,payload);
  const events = {onState:'inventory:state',onLog:'inventory:log',onUpdateState:'update:state',onSettingsRefresh:'settings:refresh',onInventoryUpdated:'inventory:updated',onMonthlySalesUpdated:'monthly-sales:updated',onRemoteConnection:'remote:connection'};
  for (const [method,type] of Object.entries(events)) api[method] = callback => { if (!listeners.has(type)) listeners.set(type,new Set()); listeners.get(type).add(callback); return () => listeners.get(type).delete(callback); };
  const emit = (type,data) => { for (const fn of listeners.get(type) || []) { try { Promise.resolve(fn(data)).catch(()=>{}); } catch {} } };
  window.inventoryApp = api;
  async function poll() {
    try {
      await session;
      const result = await request('/api/v1/events?after=' + cursor);
      if (!connected) {
        const state = await api.getState(); emit('inventory:state',state);
        emit('settings:refresh'); emit('inventory:updated'); emit('monthly-sales:updated');
        const update = await api.getUpdateState(); emit('update:state',update);
      }
      connected = true; status('');
      cursor = Number.isSafeInteger(result.cursor) ? result.cursor : cursor;
      for (const event of result.events || []) emit(event.type,event.data);
    } catch (error) { connected = false; status('本机后台连接中断：' + error.message + '。请保持菜鸟云仓后台运行，或从应用重新打开网页版；正在重试状态查询。'); }
    if (!stopped) setTimeout(poll,1000);
  }
  window.addEventListener('pagehide',()=>{stopped=true;});
  session.then(poll,()=>{});
})();
