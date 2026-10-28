// PeerJS(WebRTC) 기반 P2P 통신. 방장 브라우저가 서버 역할을 한다.
// 기본은 PeerJS 공개 시그널링 서버. ?peer=host:port 로 자체 서버를 지정할 수 있다.

const PREFIX = 'jiok-draw-v1-';

function peerOptions() {
  const q = new URLSearchParams(location.search);
  const custom = q.get('peer');
  const opts = { debug: 0 };
  if (custom) {
    const [host, port, secure] = custom.split(':');
    opts.host = host;
    opts.port = Number(port || 443);
    opts.path = q.get('peerpath') || '/';
    opts.secure = secure ? secure === 's' : opts.port === 443;
  }
  return opts;
}

export function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[(Math.random() * abc.length) | 0];
  return s;
}

export function hasPeer() { return typeof window.Peer === 'function'; }

// 방장
export function hostRoom(code, { onReady, onJoin, onData, onLeave, onError }) {
  if (!hasPeer()) { onError && onError('PeerJS 로드 실패'); return null; }
  const peer = new window.Peer(PREFIX + code, peerOptions());
  const conns = new Map();
  let ready = false;
  peer.on('open', () => { ready = true; onReady && onReady(code); });
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      onJoin && onJoin(conn.peer);
    });
    conn.on('data', (d) => onData && onData(conn.peer, d));
    const gone = () => {
      if (conns.get(conn.peer) === conn) {
        conns.delete(conn.peer);
        onLeave && onLeave(conn.peer);
      }
    };
    conn.on('close', gone);
    conn.on('error', gone);
  });
  let back = 1500;
  peer.on('disconnected', () => {
    if (peer.destroyed) return;
    setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, back);
    back = Math.min(back * 2, 30000);
  });
  peer.on('open', () => { back = 1500; });
  peer.on('error', (e) => onError && onError(e.type || String(e), ready));
  return {
    send(pid, msg) {
      const c = conns.get(pid);
      if (c && c.open) try { c.send(msg); } catch (e) {}
    },
    broadcast(msg) {
      for (const c of conns.values()) if (c.open) try { c.send(msg); } catch (e) {}
    },
    drop(pid) { const c = conns.get(pid); if (c) c.close(); },
    destroy() { peer.destroy(); },
  };
}

// 참가자
export function joinRoom(code, { onOpen, onData, onClose, onError }) {
  if (!hasPeer()) { onError && onError('PeerJS 로드 실패'); return null; }
  const peer = new window.Peer(undefined, peerOptions());
  let conn = null;
  let closed = false;
  let retry = 0;
  const connect = () => {
    if (closed || peer.destroyed) return;
    conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    conn.on('open', () => { retry = 0; onOpen && onOpen(); });
    conn.on('data', (d) => onData && onData(d));
    conn.on('close', () => {
      if (closed) return;
      onClose && onClose();
      setTimeout(connect, Math.min(8000, 1000 * ++retry));
    });
  };
  peer.on('open', connect);
  peer.on('disconnected', () => { if (!peer.destroyed && !closed) setTimeout(() => peer.reconnect(), 1500); });
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') {
      onError && onError('peer-unavailable');
      if (!closed) setTimeout(connect, Math.min(8000, 1500 * ++retry));
    } else onError && onError(e.type || String(e));
  });
  return {
    send(msg) { if (conn && conn.open) try { conn.send(msg); } catch (e) {} },
    destroy() { closed = true; peer.destroy(); },
  };
}
