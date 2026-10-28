// 통신: 공개 MQTT 브로커(WebSocket over TLS)를 우편함처럼 쓴다.
// WebRTC와 달리 NAT/방화벽/모바일망에 상관없이 일반 HTTPS처럼 연결된다.
// 브로커 하나가 막혀도 되도록 여러 곳에 동시에 붙고, 받은 쪽에서 중복을 거른다.
// ?mqtt=wss://a/mqtt,wss://b/mqtt 로 브로커를 직접 지정할 수 있다.

const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const ROOT = 'jiokdraw/v2/';
const PING = 4000;
const LOST = 13000;

function brokers() {
  const q = new URLSearchParams(location.search).get('mqtt');
  return q ? q.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_BROKERS;
}

const rid = (n = 10) => Math.random().toString(36).slice(2, 2 + n);

export function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[(Math.random() * abc.length) | 0];
  return s;
}

export function hasNet() { return typeof WebSocket === 'function'; }

// ---- 최소 MQTT 3.1.1 클라이언트 (WebSocket, QoS 0) ----
// 외부 라이브러리 없이 CONNECT / SUBSCRIBE / PUBLISH / PING 만 구현한다.
const te = new TextEncoder();
const td = new TextDecoder();

function cat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u8 = (...b) => new Uint8Array(b);
const mstr = (s) => { const b = te.encode(s); return cat([u8(b.length >> 8, b.length & 255), b]); };

function packet(head, body) {
  const len = [];
  let x = body.length;
  do { let d = x % 128; x = Math.floor(x / 128); if (x > 0) d |= 128; len.push(d); } while (x > 0);
  return cat([u8(head, ...len), body]);
}

function mqttClient(url, topic, { onUp, onDown, onMessage }) {
  let ws = null;
  let up = false;
  let closed = false;
  let back = 2000;
  let pingT = null;
  let buf = new Uint8Array(0);
  const clientId = 'jd_' + rid(12);

  const send = (bytes) => { if (ws && ws.readyState === 1) try { ws.send(bytes); } catch (e) {} };

  const down = () => {
    clearInterval(pingT);
    if (up) { up = false; onDown(); }
    if (!closed) { setTimeout(open, back); back = Math.min(back * 2, 20000); }
  };

  function handle(type, flags, body) {
    if (type === 2) { // CONNACK
      if (body[1] !== 0) { try { ws.close(); } catch (e) {} return; }
      back = 2000;
      send(packet(0x82, cat([u8(0, 1), mstr(topic), u8(0)]))); // SUBSCRIBE
      pingT = setInterval(() => send(u8(0xc0, 0)), 25000);
      if (!up) { up = true; onUp(); }
    } else if (type === 3) { // PUBLISH
      const tl = (body[0] << 8) | body[1];
      let o = 2 + tl;
      if ((flags >> 1) & 3) o += 2;
      onMessage(body.subarray(o));
    }
  }

  function feed(chunk) {
    buf = buf.length ? cat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) return;
      let mul = 1, len = 0, i = 1, b;
      do {
        if (i >= buf.length) return;
        b = buf[i++];
        len += (b & 127) * mul;
        mul *= 128;
      } while (b & 128);
      if (buf.length < i + len) return;
      handle(buf[0] >> 4, buf[0] & 15, buf.subarray(i, i + len));
      buf = buf.subarray(i + len);
    }
  }

  function open() {
    if (closed) return;
    buf = new Uint8Array(0);
    try {
      ws = new WebSocket(url, ['mqtt']);
    } catch (e) { return down(); }
    ws.binaryType = 'arraybuffer';
    const t = setTimeout(() => { try { ws.close(); } catch (e) {} }, 9000);
    ws.onopen = () => {
      clearTimeout(t);
      // CONNECT: "MQTT", level 4, clean session, keepalive 60s
      send(packet(0x10, cat([mstr('MQTT'), u8(4, 2, 0, 60), mstr(clientId)])));
    };
    ws.onmessage = (e) => feed(new Uint8Array(e.data));
    ws.onclose = () => { clearTimeout(t); down(); };
    ws.onerror = () => {};
  }
  open();

  return {
    get up() { return up; },
    publish(t, str) { if (up) send(packet(0x30, cat([mstr(t), te.encode(str)]))); },
    end() {
      closed = true;
      clearInterval(pingT);
      if (ws) { send(u8(0xe0, 0)); try { ws.close(); } catch (e) {} }
    },
  };
}

// 여러 브로커에 붙어서 하나처럼 쓰는 묶음
function bus(subTopic, onMsg, onStatus) {
  let up = 0;
  const clients = brokers().map((url) => mqttClient(url, subTopic, {
    onUp: () => onStatus(++up),
    onDown: () => onStatus(--up),
    onMessage: (bytes) => {
      let env;
      try { env = JSON.parse(td.decode(bytes)); } catch (e) { return; }
      if (env && typeof env === 'object') onMsg(env);
    },
  }));
  return {
    publish(topic, obj) {
      const s = JSON.stringify(obj);
      for (const c of clients) c.publish(topic, s);
    },
    get up() { return up; },
    end() { for (const c of clients) c.end(); },
  };
}

// 보낸 사람별 순번으로 중복/역순 메시지를 거른다
function sequencer() {
  const last = new Map();
  return (env) => {
    const k = env.s;
    const prev = last.get(k);
    if (prev !== undefined && env.n <= prev) return false;
    last.set(k, env.n);
    return true;
  };
}

// 방장
export function hostRoom(code, { onReady, onJoin, onData, onLeave, onError }) {
  if (!hasNet()) { onError && onError('lib'); return null; }
  const base = ROOT + code;
  const sid = 'H' + rid(8);
  let n = 0;
  let ready = false;
  const seen = sequencer();
  const peers = new Map(); // guest sid -> lastSeen
  const b = bus(base + '/g', (env) => {
    if (!env.s || !seen(env)) return;
    const pid = env.s;
    if (!peers.has(pid)) { peers.set(pid, Date.now()); onJoin && onJoin(pid); }
    peers.set(pid, Date.now());
    if (env.m) onData && onData(pid, env.m);
  }, (up) => {
    if (up > 0 && !ready) { ready = true; onReady && onReady(code); }
    if (up === 0 && ready) onError && onError('disconnected', true);
    if (up > 0 && ready) onReady && onReady(code);
  });
  const out = (m, to) => b.publish(base + '/h', { s: sid, n: ++n, to, m });
  const timer = setInterval(() => {
    out(null); // 생존 신호
    const now = Date.now();
    for (const [pid, t] of peers) if (now - t > LOST) { peers.delete(pid); onLeave && onLeave(pid); }
  }, PING);
  const failT = setTimeout(() => { if (!ready) onError && onError('timeout', false); }, 12000);
  return {
    send(pid, msg) { out(msg, pid); },
    broadcast(msg) { out(msg); },
    drop(pid) { peers.delete(pid); },
    destroy() { clearInterval(timer); clearTimeout(failT); b.end(); },
  };
}

// 참가자
export function joinRoom(code, { onOpen, onData, onClose, onError }) {
  if (!hasNet()) { onError && onError('lib'); return null; }
  const base = ROOT + code;
  const sid = 'G' + rid(8);
  let n = 0;
  let hostSeen = 0;
  let linked = false;
  const seen = sequencer();
  const b = bus(base + '/h', (env) => {
    if (!env.s || (env.to && env.to !== sid) || !seen(env)) return;
    hostSeen = Date.now();
    if (!linked) { linked = true; onOpen && onOpen('host'); }
    if (env.m) onData && onData(env.m);
  }, (up) => {
    if (up > 0) onOpen && onOpen('broker');
  });
  const out = (m) => b.publish(base + '/g', { s: sid, n: ++n, m });
  const timer = setInterval(() => {
    out(null);
    if (linked && Date.now() - hostSeen > LOST) { linked = false; onClose && onClose(); }
  }, PING);
  const failT = setTimeout(() => { if (b.up === 0) onError && onError('broker'); }, 12000);
  return {
    send(msg) { out(msg); },
    get linked() { return linked; },
    destroy() { clearInterval(timer); clearTimeout(failT); b.end(); },
  };
}
