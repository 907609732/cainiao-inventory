import net from 'node:net';
for (const port of [18761, 18762, 5900, 6080]) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
    socket.once('timeout', () => { socket.destroy(); reject(new Error('healthcheck timeout')); });
  });
}
