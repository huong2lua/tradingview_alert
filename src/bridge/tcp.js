import net from 'node:net';
import { SOCKET_TOKEN, BRIDGE_HOST, BRIDGE_PORT } from '../config.js';

// TCP server cho EA MT5. Giao thức theo dòng (\n):
//   EA -> server: {"type":"HELLO","token":"...","login":123,"server":"..."} rồi PING định kỳ
//   server -> EA: AUTH_OK | AUTH_FAILED | PING | PONG | một dòng JSON cho mỗi lệnh
const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const IDLE_KICK_MS = 90_000;
const MAX_BUFFER = 1024 * 1024;

const clients = new Set();

function sendLine(socket, payload) {
  if (socket.destroyed || !socket.writable) return false;
  const line = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return socket.write(`${line}\n`);
}

function handleLine(client, line) {
  if (line === 'PING') return sendLine(client.socket, 'PONG');
  if (line === 'PONG' || client.authenticated) return;

  let hello = null;
  try {
    hello = JSON.parse(line);
  } catch {}

  if (hello?.type !== 'HELLO' || hello.token !== SOCKET_TOKEN) {
    sendLine(client.socket, 'AUTH_FAILED');
    client.socket.destroy();
    return;
  }

  client.authenticated = true;
  client.login = String(hello.login ?? '?');
  client.server = String(hello.server ?? '?');
  clearTimeout(client.authTimer);
  console.log(`[BRIDGE] EA ${client.login}@${client.server} đã kết nối`);
  sendLine(client.socket, 'AUTH_OK');
}

function onConnection(socket) {
  socket.setEncoding('utf8');
  socket.setKeepAlive(true, 15_000);
  socket.setNoDelay(true);

  const client = { socket, authenticated: false, buffer: '', login: null, server: null, lastSeenAt: Date.now() };
  client.authTimer = setTimeout(() => {
    if (client.authenticated) return;
    sendLine(socket, 'AUTH_FAILED');
    socket.destroy();
  }, AUTH_TIMEOUT_MS);
  clients.add(client);

  socket.on('data', (chunk) => {
    client.lastSeenAt = Date.now();
    client.buffer += chunk;
    if (client.buffer.length > MAX_BUFFER) return socket.destroy();

    let i;
    while ((i = client.buffer.indexOf('\n')) >= 0) {
      const line = client.buffer.slice(0, i).trim();
      client.buffer = client.buffer.slice(i + 1);
      if (line) handleLine(client, line);
    }
  });

  socket.on('error', (err) => console.error('[BRIDGE] Lỗi socket:', err.message));
  socket.on('close', () => {
    clearTimeout(client.authTimer);
    clients.delete(client);
    if (client.authenticated) console.log(`[BRIDGE] EA ${client.login}@${client.server} ngắt kết nối`);
  });
}

export function startBridge() {
  if (!SOCKET_TOKEN) {
    console.warn('[BRIDGE] Thiếu SOCKET_TOKEN trong .env, không bật bridge MT5');
    return;
  }

  const server = net.createServer(onConnection);
  server.on('error', (err) => console.error('[BRIDGE] Lỗi server:', err.message));
  server.listen(BRIDGE_PORT, BRIDGE_HOST, () => console.log(`[BRIDGE] Chờ EA tại ${BRIDGE_HOST}:${BRIDGE_PORT}`));

  // EA im lặng quá lâu => coi như chết, để EA tự kết nối lại
  setInterval(() => {
    const now = Date.now();
    for (const c of clients) {
      if (now - c.lastSeenAt > IDLE_KICK_MS) c.socket.destroy();
      else if (c.authenticated) sendLine(c.socket, 'PING');
    }
  }, HEARTBEAT_MS).unref();
}

// Gửi các dòng lệnh tới mọi EA đã xác thực. Trả về số EA nhận được.
export function broadcast(lines) {
  let delivered = 0;
  for (const c of clients) {
    if (!c.authenticated || c.socket.destroyed || !c.socket.writable) continue;
    // write() trả false chỉ là đầy buffer, dữ liệu vẫn được xếp hàng gửi
    for (const line of lines) sendLine(c.socket, line);
    delivered++;
  }
  return delivered;
}

export function listClients() {
  return [...clients].filter((c) => c.authenticated).map((c) => `${c.login}@${c.server}`);
}
