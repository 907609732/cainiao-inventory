/* Browser transport for the same explicit API exposed by Electron preload. */
(() => {
  if (window.inventoryApp) return;
  const listeners = new Map();
  let csrf = '', cursor = 0, connected = false, stopped = false;
  function status(message) {
    const show = () => {
      let banner = document.getElementById('localWebStatus');
      if (!banner) { banner = document.createElement('div'); banner.id = 'localWebStatus'; banner.className = 'local-web-status'; banner.setAttribute('role', 'status'); document.body.prepend(banner); }
      banner.textContent = message; banner.hidden = !message;
      if (message) document.getElementById('warehouseLoading')?.remove();
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, {once:true});
  }
  async function request(path, options = {}) {
    const response = await fetch(path, {...options, credentials:'same-origin', cache:'no-store'});
    const body = await response.json();
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
  async function call(operation, payload) {
    const key = writes.has(operation) ? window.crypto.randomUUID() : null;
    await session;
    let data = payload || {};
    if (operation === 'saveSettings' || operation === 'saveSettingsSection') data = {...data,secrets:Object.fromEntries(Object.entries(data.secrets || {}).filter(([,value])=>value !== ''))};
    if (writes.has(operation)) data = {...data,confirmed:true};
    const headers = {'Content-Type':'application/json','x-csrf-token':csrf};
    if (key) headers['Idempotency-Key'] = key;
    try { return (await request('/api/v1/call/' + operation,{method:'POST',headers,body:JSON.stringify(data)})).value; }
    catch (error) { status('本机请求未完成：' + error.message + '。请检查后台后手动重试；同步和发送不会自动重复。'); throw error; }
  }
  const api = {isLocalWeb:true,getEditableSecrets:async()=>({})};
  for (const method of ['getBranding','getSettings','getAbout','saveSettings','saveSettingsSection','loginRemoteServer','testRemoteServer','runNow','refreshLogin','stopTask','getState','getLogs','previewDateException','sendDateException','getInventory','getMonthlySales','syncMonthlySales','backfillMonthlySales','openLogs','openData','openRepository','openWebsite','openReleaseNotes','getIntegration','getUpdateState','checkForUpdates','installUpdate','getLocalAccess','createAiCredential','revokeAiCredential','openWeb']) api[method] = payload => call(method,payload);
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
