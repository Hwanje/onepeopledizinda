import { unlock, sfx, drone, heartLoop, isMuted, setMuted } from './audio.js';
import * as fx from './fx.js';
import { hostRoom, joinRoom, makeCode, hasNet } from './net.js';
import { Engine } from './engine.js';
import { GAMES, GAME_IDS } from './games/index.js';
import { esc, pad } from './games/common.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  sget(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
  sset(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  sdel(k) { try { sessionStorage.removeItem(k); } catch (e) {} },
};

function cid() {
  let id = store.get('hp_cid');
  if (!id) {
    id = 'P' + Math.random().toString(36).slice(2, 10);
    store.set('hp_cid', id);
  }
  return id;
}

const A = {
  role: null, // 'host' | 'guest'
  me: null,
  S: null,
  engine: null,
  net: null,
  view: null,
  viewGid: null,
  turnId: null,
  turnEnd: 0,
  code: null,
  joined: false,
  peerOk: null,
  lastSeq: 0,
};

// ---------- 공통 유틸 ----------
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), ms);
}

function show(id) {
  $$('.scr').forEach((s) => s.classList.toggle('on', s.id === id));
  document.body.dataset.scr = id;
}

function player(id) { return A.S && A.S.players.find((p) => p.id === id); }

const voice = {
  say(text) {
    if (isMuted() || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      u.pitch = 0.1;
      u.rate = 0.82;
      u.volume = 0.9;
      const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith('ko'));
      if (v) u.voice = v;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) {}
  },
};

const KNUM = ['', '첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
const ordinal = (n) => (n <= 10 ? `${KNUM[n]} 번째` : `${n}번째`);

function shareLink(code) {
  const u = new URL(location.href);
  u.hash = `#/r/${code}`;
  return u.toString();
}

// ---------- 규칙 설정 폼 (개설 화면과 대기실 공용) ----------
function settingsForm(root, values, onChange, editable = true) {
  const v = { ...values };
  if (!editable) {
    const names = v.games.map((g) => GAMES[g].name).join(', ');
    root.innerHTML = `
      <dl class="rules-ro">
        <div><dt>정원</dt><dd>${v.maxPlayers}명</dd></div>
        <div><dt>탈락자</dt><dd>${v.elimCount}명</dd></div>
        <div><dt>당첨(생존)</dt><dd>${Math.max(0, (A.S ? A.S.players.length : v.maxPlayers) - v.elimCount)}명</dd></div>
        <div><dt>게임 결정</dt><dd>${v.pickMode === 'host' ? '방장 지정' : '매 라운드 무작위'}</dd></div>
        <div><dt>제한 시간</dt><dd>${v.timeout}초</dd></div>
        <div><dt>게임</dt><dd>${esc(names)}</dd></div>
      </dl>`;
    return;
  }
  root.innerHTML = `
    <div class="nums">
      <div class="num-field">
        <span>참여자 수</span>
        <div class="stepper" data-k="maxPlayers"><button type="button" data-d="-1">−</button><input type="number" inputmode="numeric" min="2" max="60"><button type="button" data-d="1">+</button></div>
      </div>
      <div class="num-field">
        <span>탈락자 수</span>
        <div class="stepper" data-k="elimCount"><button type="button" data-d="-1">−</button><input type="number" inputmode="numeric" min="1" max="59"><button type="button" data-d="1">+</button></div>
      </div>
    </div>
    <p class="calc" data-calc></p>
    <div class="field">
      <span>게임 결정 방식</span>
      <div class="seg" data-k="pickMode">
        <button type="button" data-v="random">매 라운드 무작위</button>
        <button type="button" data-v="host">방장이 지정</button>
      </div>
    </div>
    <div class="field">
      <span>사용할 게임</span>
      <div class="gamelist">
        ${GAME_IDS.map((g) => `<label class="gl-item"><input type="checkbox" value="${g}"><span><b>${GAMES[g].name}</b><i>${GAMES[g].line}</i></span></label>`).join('')}
      </div>
    </div>
    <div class="field">
      <span>행동 제한 시간</span>
      <div class="seg" data-k="timeout">
        ${[10, 15, 20, 30].map((s) => `<button type="button" data-v="${s}">${s}초</button>`).join('')}
      </div>
    </div>`;

  const sync = () => {
    const minP = Math.max(2, A.S ? A.S.players.length : 2);
    v.maxPlayers = Math.min(60, Math.max(minP, v.maxPlayers | 0));
    const total = A.S && A.S.players.length > 0 ? A.S.players.length : v.maxPlayers;
    v.elimCount = Math.min(Math.max(1, total - 1), Math.max(1, v.elimCount | 0));
    root.querySelector('[data-k=maxPlayers] input').value = v.maxPlayers;
    root.querySelector('[data-k=elimCount] input').value = v.elimCount;
    root.querySelectorAll('[data-k=pickMode] button').forEach((b) => b.classList.toggle('on', b.dataset.v === v.pickMode));
    root.querySelectorAll('[data-k=timeout] button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === v.timeout));
    root.querySelectorAll('.gamelist input').forEach((c) => (c.checked = v.games.includes(c.value)));
    const live = A.S && A.S.players.length ? `현재 ${A.S.players.length}명 기준 ` : '';
    root.querySelector('[data-calc]').innerHTML = `${live}<b>${v.elimCount}명</b>이 죽고 <b>${Math.max(0, total - v.elimCount)}명</b>이 살아남는다.`;
  };
  const commit = () => { sync(); onChange({ ...v }); };

  root.querySelectorAll('.stepper').forEach((st) => {
    const k = st.dataset.k;
    st.querySelectorAll('button').forEach((b) => (b.onclick = () => { sfx.ui(); v[k] = (v[k] | 0) + Number(b.dataset.d); commit(); }));
    st.querySelector('input').onchange = (e) => { v[k] = Number(e.target.value) || 0; commit(); };
  });
  root.querySelectorAll('[data-k=pickMode] button').forEach((b) => (b.onclick = () => { sfx.ui(); v.pickMode = b.dataset.v; commit(); }));
  root.querySelectorAll('[data-k=timeout] button').forEach((b) => (b.onclick = () => { sfx.ui(); v.timeout = Number(b.dataset.v); commit(); }));
  root.querySelectorAll('.gamelist input').forEach((c) => (c.onchange = () => {
    sfx.ui();
    const set = new Set(v.games);
    if (c.checked) set.add(c.value);
    else if (set.size > 1) set.delete(c.value);
    v.games = GAME_IDS.filter((g) => set.has(g));
    commit();
  }));
  sync();
  return { get: () => ({ ...v }) };
}

// ---------- 방장 ----------
function hostSave() {
  if (A.role !== 'host' || !A.engine) return;
  const E = A.engine;
  store.sset('hp_host_' + A.code, { S: E.S, manualN: E.manualN, nums: [...E.usedNums], gid: E.gid });
}

let outDirty = false;
function hostFlush() {
  if (!outDirty) return;
  outDirty = false;
  const snap = JSON.parse(JSON.stringify(A.engine.S));
  if (A.net) A.net.broadcast({ t: 'state', s: snap });
  onState(snap);
  hostSave();
}

function startHost(cfg, saved = null) {
  A.role = 'host';
  A.code = cfg.code;
  A.me = 'H';
  A.lastSeq = 0;
  const peers = new Map(); // peerId -> cid
  const peerOf = (id) => { for (const [k, v] of peers) if (v === id) return k; return null; };

  A.engine = new Engine(cfg, {
    push: () => { outDirty = true; queueMicrotask(hostFlush); },
    event: (ev) => {
      hostFlush();
      if (A.net) A.net.broadcast({ t: 'ev', ev });
      onEvent(ev);
    },
  });
  const E = A.engine;
  if (saved) {
    Object.assign(E.S, saved.S);
    E.manualN = saved.manualN || 0;
    E.usedNums = new Set(saved.nums || []);
    E.gid = saved.gid || 0;
    for (const p of E.S.players) if (!p.manual && !p.host) p.online = false;
    E.S.turn = null;
    E.S.pick = null;
  } else if (cfg.hostName !== null) {
    E.addPlayer({ id: 'H', name: cfg.hostName, host: true });
  }

  const connect = (code) => {
    A.net = hostRoom(code, {
      onReady: () => { A.peerOk = true; renderNet(); },
      // 모르는 접속(방장 새로고침 뒤 등)에는 신원을 다시 묻는다
      onJoin: (pid) => { if (!peers.has(pid)) A.net.send(pid, { t: 'who' }); },
      onData: (pid, m) => {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'hello') {
          const id = String(m.cid || '').slice(0, 20) || pid;
          for (const [k, v] of peers) if (v === id && k !== pid) { peers.delete(k); A.net.drop(k); }
          peers.set(pid, id);
          let p = E.S.players.find((x) => x.id === id);
          if (!p && m.name) p = E.addPlayer({ id, name: m.name });
          if (p) E.setOnline(id, true);
          A.net.send(pid, { t: 'welcome', you: id, joined: !!p, seq: E.S.seq, full: !p && E.S.players.length >= E.S.maxPlayers, started: E.S.phase !== 'lobby' });
          A.net.send(pid, { t: 'state', s: JSON.parse(JSON.stringify(E.S)) });
        } else if (m.t === 'act') {
          const id = peers.get(pid);
          if (id) E.act(id, String(m.kind), m.data || null);
        }
      },
      onLeave: (pid) => {
        const id = peers.get(pid);
        peers.delete(pid);
        if (id && !peerOf(id)) E.setOnline(id, false);
      },
      onError: () => { A.peerOk = false; renderNet(); },
    });
    if (!A.net) { A.peerOk = false; renderNet(); }
  };
  connect(cfg.code);
  A.kick = (id) => { const k = peerOf(id); if (k) { A.net.send(k, { t: 'kicked' }); setTimeout(() => A.net.drop(k), 300); } };

  history.replaceState(null, '', `#/h/${A.code}`);
  E.push();
  if (saved && E.S.phase !== 'lobby' && E.S.phase !== 'end') {
    toast('진행 중이던 게임을 이어갑니다');
    E.resume();
  }
}

// ---------- 참가자 ----------
function startGuest(code, name) {
  A.role = 'guest';
  A.code = code;
  A.me = cid();
  A.lastSeq = 0;
  store.set('hp_name', name);
  store.sset('hp_guest_' + code, 1);
  $('#j-status').textContent = '연결 중...';
  const hello = () => A.net && A.net.send({ t: 'hello', cid: A.me, name });
  let welcomed = false;
  let tries = 0;
  clearInterval(A.helloTimer);
  A.helloTimer = setInterval(() => {
    if (welcomed || !A.net) return;
    hello();
    if (++tries === 4) $('#j-status').textContent = '방을 찾는 중입니다. 방장 화면이 열려 있는지, 코드가 맞는지 확인하세요...';
  }, 2500);
  A.net = joinRoom(code, {
    onOpen: (why) => {
      if (why === 'host') { A.peerOk = true; renderNet(); }
      hello();
    },
    onData: (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'who') { hello(); return; }
      if (m.t === 'welcome') {
        welcomed = true;
        A.joined = m.joined;
        A.lastSeq = m.seq;
        if (!m.joined) toast(m.started ? '이미 시작된 방입니다. 관전합니다.' : m.full ? '정원이 찼습니다. 관전합니다.' : '관전 모드');
      } else if (m.t === 'state') {
        onState(m.s);
      } else if (m.t === 'ev') {
        if (m.ev.seq <= A.lastSeq) return;
        A.lastSeq = m.ev.seq;
        onEvent(m.ev);
      } else if (m.t === 'kicked') {
        A.net.destroy();
        A.net = null;
        toast('방장이 당신을 내보냈습니다', 4000);
        location.hash = '#/';
      }
    },
    onClose: () => { A.peerOk = false; renderNet(); toast('연결이 끊겼습니다. 다시 연결하는 중...'); },
    onError: () => {
      $('#j-status').textContent = '중계 서버에 연결하지 못했습니다. 네트워크를 확인하세요. 재시도 중...';
      A.peerOk = false;
      renderNet();
    },
  });
  if (!A.net) $('#j-status').textContent = '통신 라이브러리를 불러오지 못했습니다.';
}

// ---------- API (게임 화면용) ----------
const api = {
  get me() { return A.me; },
  get isHost() { return A.role === 'host'; },
  player,
  canAct(kind) {
    const t = A.S && A.S.turn;
    if (!t || t.kind !== kind) return false;
    if (t.actor === A.me) {
      const p = player(A.me);
      return !!p && p.alive;
    }
    if (A.role === 'host') {
      const p = player(t.actor);
      return !!p && (p.manual || !p.online);
    }
    return false;
  },
  act(kind, data) {
    sfx.ui();
    if (A.role === 'host') A.engine.act(A.me, kind, data, { asHost: true });
    else if (A.net) A.net.send({ t: 'act', kind, data });
  },
  sfx,
  fx,
  heart: heartLoop,
};

// ---------- 상태 반영 ----------
function onState(S) {
  const prev = A.S;
  A.S = S;
  if (A.role === 'guest' && !prev) {
    $('#j-status').textContent = '';
  }
  render(prev);
}

function render(prev) {
  const S = A.S;
  if (!S) return;
  document.body.classList.toggle('is-host', A.role === 'host');
  document.body.classList.toggle('is-guest', A.role !== 'host');
  const meP = player(A.me);
  document.body.classList.toggle('me-dead', !!meP && !meP.alive && S.phase !== 'lobby');
  $('#hud-room').textContent = S.code ? `ROOM ${S.code}` : '';
  if (S.phase === 'lobby') { renderLobby(); show('scr-lobby'); }
  else if (S.phase === 'end') { renderEnd(); show('scr-end'); }
  else { renderPlay(prev); show('scr-play'); }
}

function renderNet() {
  const el = $('#hud-net');
  if (A.peerOk === null) { el.textContent = ''; el.className = 'hud-net'; return; }
  el.textContent = A.peerOk ? 'LINK' : 'OFFLINE';
  el.className = 'hud-net ' + (A.peerOk ? 'ok' : 'bad');
  el.title = A.peerOk ? '연결됨' : (A.role === 'host' ? '중계 서버에 연결하지 못했습니다. 이 화면에서 직접 추가한 참가자로만 진행할 수 있습니다.' : '연결 끊김');
}

let lobbyForm = null;
let lobbyFormKey = '';
function renderLobby() {
  const S = A.S;
  const host = A.role === 'host';
  $('#l-title').textContent = S.title;
  $('#l-summary').textContent = `${S.players.length}명 입장 · 정원 ${S.maxPlayers}명 · 탈락 ${S.elimCount}명`;
  $('#l-code').textContent = S.code;
  const link = shareLink(S.code);
  if ($('#l-link').value !== link) {
    $('#l-link').value = link;
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      $('#l-qr').innerHTML = qr.createSvgTag(4, 0);
    } catch (e) { $('#l-qr').innerHTML = ''; }
  }
  $('#l-count').textContent = `${S.players.length} / ${S.maxPlayers}`;

  const slots = [];
  for (let i = 0; i < Math.max(S.maxPlayers, S.players.length); i++) {
    const p = S.players[i];
    if (!p) { slots.push(`<div class="slot empty"><span class="slot-num">---</span><span class="slot-name">빈 자리</span></div>`); continue; }
    const flags = [p.host ? '방장' : '', p.manual ? '현장' : '', !p.online ? '연결 끊김' : '', p.id === A.me ? '나' : ''].filter(Boolean);
    slots.push(`<div class="slot ${p.id === A.me ? 'me' : ''} ${p.online ? '' : 'off'}">
      <span class="slot-num">${pad(p.num)}</span>
      <span class="slot-name">${esc(p.name)}</span>
      <span class="slot-flags">${flags.map((f) => `<i>${f}</i>`).join('')}</span>
      ${host && !p.host ? `<button class="slot-x" data-kick="${esc(p.id)}" title="내보내기">×</button>` : ''}
    </div>`);
  }
  const html = slots.join('');
  const sl = $('#l-slots');
  if (sl._h !== html) {
    sl._h = html;
    sl.innerHTML = html;
    sl.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => {
      sfx.ui();
      const id = b.dataset.kick;
      A.kick && A.kick(id);
      A.engine.removePlayer(id);
    }));
  }

  const cfg = { maxPlayers: S.maxPlayers, elimCount: S.elimCount, pickMode: S.pickMode, games: S.games, timeout: S.timeout };
  const key = (host ? 'h' : 'g') + JSON.stringify(cfg) + S.players.length;
  if (key !== lobbyFormKey) {
    lobbyFormKey = key;
    lobbyForm = settingsForm($('#l-settings'), cfg, (v) => A.engine.updateConfig(v), host);
  }
  if (host) {
    const n = S.players.length;
    let warn = '';
    if (n < 2) warn = '최소 2명이 필요합니다.';
    else if (S.elimCount >= n) warn = `탈락자는 ${n - 1}명 이하여야 합니다.`;
    else if (n < S.maxPlayers) warn = `정원 ${S.maxPlayers}명 중 ${n}명. 지금 시작하면 ${n}명으로 진행합니다.`;
    $('#l-warn').textContent = warn;
    $('#l-start').disabled = !A.engine.canStart();
  }
}

function renderPlay(prev) {
  const S = A.S;
  $('#p-round').textContent = S.round;
  $('#p-total').textContent = `/${S.elimCount}`;
  const alive = S.players.filter((p) => p.alive).length;
  $('#p-alive').textContent = alive;
  const cap = $('#p-caption');
  if (cap.textContent !== S.caption) {
    cap.textContent = S.caption;
    cap.classList.remove('in');
    void cap.offsetWidth;
    cap.classList.add('in');
  }
  const dead = S.players.filter((p) => !p.alive).sort((a, b) => a.diedRound - b.diedRound);
  const gh = dead.map((p) => `<span class="tag is-dead" title="${esc(p.cause || '')}"><b>${pad(p.num)}</b>${esc(p.name)}</span>`).join('') || '<span class="muted small">아직 없음</span>';
  if ($('#p-grave')._h !== gh) { $('#p-grave').innerHTML = gh; $('#p-grave')._h = gh; }

  const stage = $('#p-stage');
  if (S.phase === 'pick') {
    if (A.view) { A.view.destroy(); A.view = null; A.viewGid = null; }
    renderPick(stage);
    $('#p-gamehead').innerHTML = '';
  } else if (S.phase === 'game' && S.game) {
    if (A.viewGid !== S.game.gid) {
      if (A.view) A.view.destroy();
      stage.innerHTML = '';
      const G = GAMES[S.game.type];
      A.view = new G.View(stage, api);
      A.viewGid = S.game.gid;
      $('#p-gamehead').innerHTML = `<span class="gh-tag">${G.tag}</span><b>${G.name}</b><span class="gh-rule">${G.rule}</span>`;
    }
    A.view.update(S);
  }
  renderTurn();
}

function renderPick(stage) {
  const S = A.S;
  let box = stage.querySelector('.pick');
  if (!box) {
    stage.innerHTML = `<div class="pick"><p class="eyebrow">다음 게임</p><div class="pick-reel"><span class="pick-name">???</span></div><p class="pick-line"></p><div class="pick-host"></div></div>`;
    box = stage.querySelector('.pick');
  }
  const ph = box.querySelector('.pick-host');
  if (S.pick && S.pick.waiting) {
    if (A.role === 'host') {
      if (!ph._on) {
        ph._on = true;
        ph.innerHTML = `<p class="muted small">이번 라운드의 게임을 고르시오</p><div class="pick-btns">${S.pick.options.map((g) => `<button class="btn btn-ghost" data-g="${g}">${GAMES[g].name}</button>`).join('')}<button class="btn btn-blood" data-g="*">운에 맡긴다</button></div>`;
        ph.querySelectorAll('button').forEach((b) => (b.onclick = () => { sfx.ui(); A.engine.hostPick(b.dataset.g); }));
      }
    } else {
      ph.innerHTML = '<p class="muted">방장이 게임을 고르고 있습니다<span class="dots"></span></p>';
    }
  } else {
    ph.innerHTML = '';
    ph._on = false;
  }
}

function showGameCard(type, rolled) {
  const box = $('#p-stage .pick');
  if (!box) return;
  const name = box.querySelector('.pick-name');
  const line = box.querySelector('.pick-line');
  const G = GAMES[type];
  name.textContent = G.name;
  name.dataset.text = G.name;
  name.classList.add('locked', 'glitch');
  line.textContent = G.line;
  line.classList.add('in');
  sfx.stinger();
  fx.flash('rgba(193,18,31,.5)', 120);
  fx.shake(0.6, 400);
  voice.say(G.name);
  if (!rolled) box.querySelector('.pick-reel').classList.add('slam');
}

function rollReel(options, chosen) {
  const box = $('#p-stage .pick');
  if (!box) return;
  const name = box.querySelector('.pick-name');
  name.classList.remove('locked', 'glitch');
  let delay = 40;
  let i = 0;
  const seq = [];
  // 마지막에 chosen이 오도록 순서를 만든다
  let total = 0;
  while (total < 3300) { seq.push(options[i++ % options.length]); total += delay; delay *= 1.09; }
  seq.push(chosen);
  delay = 40;
  let k = 0;
  const step = () => {
    if (k >= seq.length) return showGameCard(chosen, true);
    name.textContent = GAMES[seq[k]].name;
    sfx.reel();
    k++;
    delay *= 1.09;
    setTimeout(step, delay);
  };
  step();
}

let turnTimer = null;
function renderTurn() {
  const S = A.S;
  const bar = $('#p-turn');
  const t = S.turn;
  if (!t) {
    if (A.turnId !== null) { A.turnId = null; bar.innerHTML = ''; bar.classList.remove('on', 'mine'); }
    clearInterval(turnTimer);
    return;
  }
  if (A.turnId === t.id) return;
  A.turnId = t.id;
  A.turnEnd = performance.now() + t.ms;
  const p = player(t.actor);
  const mine = t.actor === A.me;
  bar.classList.add('on');
  bar.classList.toggle('mine', mine);
  bar.innerHTML = `
    <div class="tb-who">${mine ? '<b class="tb-you">당신의 차례</b>' : `<span class="muted">차례</span> <b>${p ? pad(p.num) + ' ' + esc(p.name) : ''}</b>${p && (p.manual || !p.online) ? ' <i class="tb-proxy">방장이 대신 진행 가능</i>' : ''}`}</div>
    <div class="tb-time"><div class="tb-fill"></div></div>
    <span class="tb-sec"></span>
    ${A.role === 'host' ? '<button class="btn btn-ghost btn-sm tb-auto">자동 진행</button>' : ''}`;
  const auto = bar.querySelector('.tb-auto');
  if (auto) auto.onclick = () => { sfx.ui(); A.engine.act(A.me, t.kind, { auto: true }, { asHost: true }); };
  if (mine) { sfx.alarm(); fx.glitch(250); if (navigator.vibrate) navigator.vibrate([80, 60, 80]); }
  clearInterval(turnTimer);
  let lastSec = -1;
  const tick = () => {
    const left = Math.max(0, A.turnEnd - performance.now());
    const f = bar.querySelector('.tb-fill');
    if (!f) return clearInterval(turnTimer);
    f.style.transform = `scaleX(${left / t.ms})`;
    const sec = Math.ceil(left / 1000);
    bar.querySelector('.tb-sec').textContent = sec;
    if (sec !== lastSec && sec <= 3 && sec > 0 && mine) sfx.tick(1.4);
    lastSec = sec;
    bar.classList.toggle('urgent', left < 3500);
  };
  tick();
  turnTimer = setInterval(tick, 100);
}

function renderEnd() {
  const S = A.S;
  const alive = S.players.filter((p) => p.alive);
  const dead = S.players.filter((p) => !p.alive).sort((a, b) => a.diedRound - b.diedRound);
  $('#e-sub').textContent = `${S.players.length}명 중 ${alive.length}명이 살아남았습니다.`;
  const wh = alive.map((p) => `<div class="winner ${p.id === A.me ? 'me' : ''}"><span class="w-num">${pad(p.num)}</span><span class="w-name">${esc(p.name)}</span><span class="w-stamp">당첨</span></div>`).join('');
  if ($('#e-winners')._h !== wh) { $('#e-winners').innerHTML = wh; $('#e-winners')._h = wh; }
  $('#e-dead').innerHTML = dead.map((p) => `<li><b>R${p.diedRound}</b><span>${pad(p.num)} ${esc(p.name)}</span><i>${esc(p.cause || '')}</i></li>`).join('');
}

// ---------- 이벤트 ----------
function banner(k, t, s, ms = 2600) {
  $('#banner-k').textContent = k;
  $('#banner-t').textContent = t;
  $('#banner-t').dataset.text = t;
  $('#banner-s').textContent = s;
  const b = $('#banner');
  b.classList.remove('on');
  void b.offsetWidth;
  b.classList.add('on');
  clearTimeout(b._t);
  b._t = setTimeout(() => b.classList.remove('on'), ms);
}

function deathScene(id, cause) {
  const p = player(id);
  if (!p) return;
  const mine = id === A.me;
  const d = $('#death');
  $('#death-k').textContent = mine ? '당신은 탈락했습니다' : '탈락';
  $('#death-num').textContent = pad(p.num);
  $('#death-name').textContent = p.name;
  $('#death-cause').textContent = cause || '';
  d.classList.remove('on', 'mine');
  void d.offsetWidth;
  d.classList.add('on');
  d.classList.toggle('mine', mine);
  fx.flash('#a3000f', 260);
  fx.shake(1.6, 800);
  fx.glitch(900);
  sfx.death();
  setTimeout(() => sfx.thud(), 120);
  for (let i = 0; i < 3; i++) setTimeout(() => fx.blood(innerWidth * (0.2 + Math.random() * 0.6), innerHeight * (0.2 + Math.random() * 0.6), 0.8 + Math.random() * 0.7), i * 180);
  if (mine && navigator.vibrate) navigator.vibrate([300, 100, 600]);
  setTimeout(() => voice.say(`${p.num}번. ${p.name}. 탈락.`), 700);
  clearTimeout(d._t);
  d._t = setTimeout(() => d.classList.remove('on'), 4700);
}

function onEvent(ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case 'start':
      drone(true);
      sfx.stinger();
      fx.clearBlood(false);
      break;
    case 'round':
      fx.clearBlood();
      sfx.stinger();
      sfx.alarm();
      fx.glitch(600);
      banner(`ROUND ${d.round} / ${d.total}`, `${ordinal(d.round)} 탈락자`, `남은 인원 ${d.alive}명. 이번 라운드에 반드시 한 명이 죽는다.`, 2900);
      voice.say(`${ordinal(d.round)} 탈락자를 선정합니다.`);
      break;
    case 'pickroll':
      setTimeout(() => rollReel(d.options, d.chosen), 30);
      break;
    case 'picked':
      setTimeout(() => showGameCard(d.chosen, false), 30);
      break;
    case 'death':
      heartLoop(0);
      deathScene(d.id, d.cause);
      break;
    case 'end':
      heartLoop(0);
      drone(false);
      sfx.finale();
      fx.clearBlood();
      banner('GAME OVER', '추첨 종료', '살아남은 자에게 축하를.', 3200);
      voice.say('추첨을 종료합니다. 생존자에게 축하를.');
      break;
    case 'reset':
      heartLoop(0);
      drone(false);
      fx.clearBlood(false);
      if (A.view) { A.view.destroy(); A.view = null; A.viewGid = null; }
      break;
    case 'join':
      sfx.ui();
      break;
    default:
      if (A.view) A.view.event(ev);
  }
}

// ---------- 라우팅 ----------
function teardown() {
  clearInterval(A.helloTimer);
  if (A.net) { A.net.destroy(); A.net = null; }
  if (A.view) { A.view.destroy(); A.view = null; }
  A.role = null; A.S = null; A.engine = null; A.viewGid = null; A.turnId = null; A.peerOk = null;
  lobbyFormKey = '';
  $('#p-stage').innerHTML = '';
  $('#l-link').value = '';
  heartLoop(0);
  drone(false);
  fx.clearBlood(false);
  document.body.classList.remove('me-dead');
  $('#hud-room').textContent = '';
  renderNet();
}

let createForm = null;
function route() {
  const hsh = location.hash || '#/';
  const mH = hsh.match(/^#\/h\/([A-Z0-9]{5})$/i);
  const mR = hsh.match(/^#\/r\/([A-Z0-9]{5})$/i);
  if (mH) {
    const code = mH[1].toUpperCase();
    if (A.role === 'host' && A.code === code) return;
    const saved = store.sget('hp_host_' + code);
    teardown();
    if (saved) { startHost({ ...saved.S, code }, saved); return; }
    location.hash = '#/';
    return;
  }
  if (mR) {
    const code = mR[1].toUpperCase();
    if (A.role === 'guest' && A.code === code) return;
    // 방장이 자기 링크를 연 경우
    if (store.sget('hp_host_' + code)) { location.hash = `#/h/${code}`; return; }
    teardown();
    $('#j-code').textContent = code;
    $('#j-name').value = store.get('hp_name', '');
    $('#j-status').textContent = '';
    show('scr-join');
    // 새로고침한 참가자는 바로 재접속
    if (store.sget('hp_guest_' + code) && store.get('hp_name', '')) startGuest(code, store.get('hp_name', ''));
    return;
  }
  if (hsh === '#/create') {
    teardown();
    const last = store.get('hp_cfg', null) || {};
    createForm = settingsForm($('#c-settings'), {
      maxPlayers: last.maxPlayers || 8,
      elimCount: last.elimCount || 3,
      pickMode: last.pickMode || 'random',
      games: (last.games || GAME_IDS).filter((g) => GAMES[g]),
      timeout: last.timeout || 15,
    }, () => {});
    $('#c-name').value = store.get('hp_name', '');
    show('scr-create');
    return;
  }
  teardown();
  show('scr-home');
}

// ---------- 바인딩 ----------
function bind() {
  $('#go-create').onclick = () => { sfx.ui(); location.hash = '#/create'; };
  const join = () => {
    const c = $('#join-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(c)) { toast('코드는 5자리입니다'); return; }
    sfx.ui();
    location.hash = `#/r/${c}`;
  };
  $('#go-join').onclick = join;
  $('#join-code').onkeydown = (e) => { if (e.key === 'Enter') join(); };
  $$('[data-go]').forEach((b) => (b.onclick = () => {
    sfx.ui();
    if (A.role === 'host' && A.code) store.sdel('hp_host_' + A.code);
    location.hash = b.dataset.go;
  }));
  $('#c-join').onchange = () => $('#c-name-wrap').classList.toggle('hidden', !$('#c-join').checked);
  $('#c-open').onclick = () => {
    const v = createForm.get();
    const participate = $('#c-join').checked;
    const name = $('#c-name').value.trim();
    if (participate && !name) { toast('방장 이름을 입력하세요'); $('#c-name').focus(); return; }
    if (participate) store.set('hp_name', name);
    store.set('hp_cfg', v);
    sfx.stinger();
    fx.glitch(400);
    const code = makeCode();
    teardown();
    startHost({ ...v, code, title: $('#c-title').value.trim() || '지옥의 추첨', hostName: participate ? name : null });
  };
  const go = () => {
    const name = $('#j-name').value.trim();
    if (!name) { toast('이름을 입력하세요'); $('#j-name').focus(); return; }
    sfx.stinger();
    fx.glitch(300);
    startGuest($('#j-code').textContent, name);
  };
  $('#j-go').onclick = go;
  $('#j-name').onkeydown = (e) => { if (e.key === 'Enter') go(); };

  $('#l-copy').onclick = async () => {
    sfx.ui();
    const v = $('#l-link').value;
    try { await navigator.clipboard.writeText(v); } catch (e) { $('#l-link').select(); document.execCommand('copy'); }
    toast('초대 링크를 복사했습니다');
  };
  $('#l-link').onclick = (e) => e.target.select();
  const addManual = () => {
    const name = $('#l-manual').value.trim();
    if (A.S.players.length >= A.S.maxPlayers) { toast('정원이 찼습니다. 참여자 수를 늘리세요.'); return; }
    A.engine.addManual(name || null);
    $('#l-manual').value = '';
    $('#l-manual').focus();
  };
  $('#l-add').onclick = addManual;
  $('#l-manual').onkeydown = (e) => { if (e.key === 'Enter') addManual(); };
  $('#l-fill').onclick = () => { sfx.ui(); A.engine.fillManual(); };
  $('#l-start').onclick = () => { if (A.engine.start()) unlock(); };
  $('#p-abort').onclick = () => { if (confirm('진행 중인 게임을 중단하고 대기실로 돌아갈까요? 탈락자는 모두 되살아납니다.')) A.engine.reset(); };
  $('#e-again').onclick = () => { sfx.ui(); A.engine.reset(); };

  const mb = $('#btn-mute');
  const syncMute = () => { mb.textContent = isMuted() ? 'SOUND OFF' : 'SOUND ON'; mb.classList.toggle('off', isMuted()); };
  mb.onclick = () => { unlock(); setMuted(!isMuted()); if (isMuted() && 'speechSynthesis' in window) speechSynthesis.cancel(); syncMute(); };
  syncMute();

  document.addEventListener('pointerover', (e) => { if (e.target.closest && e.target.closest('.btn')) sfx.hover(); });

  addEventListener('beforeunload', (e) => {
    if (A.role === 'host' && A.S && A.S.phase !== 'lobby' && A.S.phase !== 'end') { e.preventDefault(); e.returnValue = ''; }
  });

  $('#gate-btn').onclick = () => {
    unlock();
    sfx.stinger();
    $('#gate').classList.add('gone');
    setTimeout(() => $('#gate').remove(), 700);
  };
}

function grain() {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d');
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 22;
  }
  g.putImageData(img, 0, 0);
  $('#grain').style.backgroundImage = `url(${c.toDataURL()})`;
}

fx.initFx();
grain();
bind();
addEventListener('hashchange', route);
route();
if (!hasNet()) toast('통신 라이브러리를 불러오지 못했습니다. 이 화면에서만 진행할 수 있습니다.', 5000);
