// NAS-only presentation adapter. Desktop renderer and Windows behavior stay intact.
(() => {
  document.documentElement.dataset.platform = 'fnos';
  const apply = () => {
    const api = window.inventoryApp;
    if (api) {
      const links = {
        openRepository: 'https://github.com/907609732/cainiao-inventory',
        openReleaseNotes: 'https://github.com/907609732/cainiao-inventory/releases',
      };
      for (const [method,url] of Object.entries(links)) api[method] = async () => {
        window.open(url,'_blank','noopener,noreferrer'); return {opened:true};
      };
    }
    document.querySelector('#backHome')?.setAttribute('hidden','');
    document.querySelector('#openWebHeader')?.setAttribute('hidden','');
    const startup=document.querySelector('#startAtLogin');
    if(startup){startup.disabled=true;startup.closest('label')?.setAttribute('hidden','');}
    const actions=document.querySelector('.hero-actions');
    if(actions&&!document.querySelector('#nasBrowserEntry')){
      const link=document.createElement('a');link.id='nasBrowserEntry';link.className='btn';
      link.href='/browser/';link.target='_blank';link.rel='noopener noreferrer';
      link.textContent='菜鸟登录浏览器 ↗';actions.prepend(link);
    }
    const update=document.querySelector('#installUpdate');if(update)update.hidden=true;
    document.querySelectorAll('p,small,.settings-note,.lt-loading__note').forEach(node=>{
      if(node.children.length)return;
      if(node.textContent.includes('Windows 安全存储'))node.textContent='密码与通知密钥保存在本应用独立的加密存储中。';
      if(node.textContent.includes('重启并安装更新'))node.textContent='飞牛版由应用中心安装更新；更新前请备份云仓数据。';
      if(node.textContent.includes('请保持软件和电脑运行'))node.textContent='自动任务由飞牛后台执行，请保持 NAS 运行。关闭网页不会停止后台。';
    });
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
})();
