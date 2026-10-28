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

export function hasNet() { return !!(window.mqtt && window.mqtt.connect); }

// 여러 브로커에 붙어서 하나처럼 쓰는 묶음
function bus(subTopic, onMsg, onStatus) {
  const clients = [];
  let up = 0;
  for (const url of brokers()) {
    let c;
    try {
      c = window.mqtt.connect(url, {
        clientId: 'jd_' + rid(12),
        clean: true,
        keepalive: 30,
        connectTimeout: 9000,
        reconnectPeriod: 3000,
        protocolVersion: 4,
      });
    } catch (e) { continue; }
    c._up = false;
    c.on('connect', () => {
      c.subscribe(subTopic, { qos: 0 });
      if (!c._up) { c._up = true; up++; onStatus(up); }
    });
    const down = () => { if (c._up) { c._up = false; up--; onStatus(up); } };
    c.on('close', down);
    c.on('offline', down);
    c.on('error', () => {});
    c.on('message', (t, buf) => {
      let env;
      try { env = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return; }
      if (env && typeof env === 'object') onMsg(env);
    });
    clients.push(c);
  }
  return {
    publish(topic, obj) {
      const s = JSON.stringify(obj);
      for (const c of clients) if (c._up) c.publish(topic, s, { qos: 0 });
    },
    get up() { return up; },
    end() { for (const c of clients) try { c.end(true); } catch (e) {} },
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
