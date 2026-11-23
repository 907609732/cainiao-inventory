// CI-only fnOS transport simulator; never mounts or contacts production data.
import http from 'node:http';
import {chromium} from 'playwright';
const socketPath='/app-target/app.sock',prefix='/app/cainiao-warehouse';
const headers=req=>({...req.headers,host:'127.0.0.1','x-forwarded-proto':'http','x-trim-userid':'1000','x-trim-isadmin':'true'});
const proxy=http.createServer((req,res)=>{
 const upstream=http.request({socketPath,path:req.url,method:req.method,headers:headers(req)},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
 upstream.on('error',error=>res.destroy(error));req.pipe(upstream);
});
const peers=new Set();
proxy.on('connection',socket=>{peers.add(socket);socket.on('close',()=>peers.delete(socket));});
proxy.on('upgrade',(req,client,head)=>{
 const upstream=http.request({socketPath,path:req.url,method:'GET',headers:headers(req)});
 upstream.on('upgrade',(response,peer,upstreamHead)=>{
  client.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([key,value])=>key+': '+value).join('\r\n')+'\r\n\r\n');
  if(head.length)peer.write(head);if(upstreamHead.length)client.write(upstreamHead);
  peer.on('error',()=>client.destroy());client.on('error',()=>peer.destroy());
  client.on('close',()=>peer.destroy());peer.pipe(client).pipe(peer);
 });
 upstream.on('response',response=>{response.resume();client.end('HTTP/1.1 '+response.statusCode+' Forbidden\r\nConnection: close\r\n\r\n');});
 upstream.on('error',()=>client.destroy());upstream.end();
});
let browser;
try{
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${proxy.address().port}${prefix}/browser/`);
 await page.waitForFunction(()=>document.documentElement.classList.contains('noVNC_connected'),null,{timeout:15000});
 console.log('Real noVNC assets, redirect and RFB WebSocket connected through simulated fnOS Unix forwarding. No collection or notification invoked.');
}finally{
 await browser?.close();for(const peer of peers)peer.destroy();
 await new Promise(resolve=>proxy.close(resolve));
}
