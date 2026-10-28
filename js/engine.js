// 방장 브라우저에서만 돌아가는 진행 엔진. 모든 무작위 판정은 여기서 한다.
import { GAMES } from './games/index.js';

class Abort extends Error {}

export const rand = (n) => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
};
export const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class Engine {
  constructor(cfg, { push, event }) {
    this.S = {
      code: cfg.code,
      title: cfg.title,
      maxPlayers: cfg.maxPlayers,
      elimCount: cfg.elimCount,
      lives: Math.max(1, cfg.lives | 0 || 1), // 이 횟수만큼 죽으면 탈락. 1이면 단판
      pickMode: cfg.pickMode,
      games: cfg.games,
      timeout: cfg.timeout,
      phase: 'lobby',
      players: [],
      round: 0,
      game: null,
      turn: null,
      pick: null,
      caption: '',
      seq: 0,
      lastGame: null,
    };
    this._push = push;
    this._event = event;
    this.run = 0;
    this.pending = null;
    this.pendingPick = null;
    this.usedNums = new Set();
    this.manualN = 0;
    this.gid = 0;
  }

  push() { this._push(this.S); }

  emit(type, data = {}) {
    const ev = { seq: ++this.S.seq, type, data };
    this._event(ev);
  }

  // ---- 참가자 관리 ----
  num() {
    let n;
    do { n = 1 + rand(456); } while (this.usedNums.has(n) && this.usedNums.size < 456);
    this.usedNums.add(n);
    return n;
  }

  cleanName(name) {
    let n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 12) || '무명';
    const base = n;
    let k = 2;
    while (this.S.players.some((p) => p.name === n)) n = `${base}${k++}`;
    return n;
  }

  addPlayer({ id, name, manual = false, host = false }) {
    const S = this.S;
    const ex = S.players.find((p) => p.id === id);
    if (ex) {
      ex.online = true;
      this.push();
      return ex;
    }
    if (S.phase !== 'lobby' || S.players.length >= S.maxPlayers) return null;
    const p = { id, name: this.cleanName(name), num: this.num(), alive: true, online: true, manual, host, cause: null, diedRound: 0, deaths: 0, log: [] };
    S.players.push(p);
    this.push();
    this.emit('join', { id });
    return p;
  }

  addManual(name) {
    return this.addPlayer({ id: 'M' + ++this.manualN + '-' + rand(1e6), name: name || `참가자${this.S.players.length + 1}`, manual: true });
  }

  fillManual() {
    while (this.S.players.length < this.S.maxPlayers) this.addManual();
  }

  removePlayer(id) {
    if (this.S.phase !== 'lobby') return;
    const p = this.S.players.find((x) => x.id === id);
    if (!p) return;
    this.usedNums.delete(p.num);
    this.S.players = this.S.players.filter((x) => x.id !== id);
    this.push();
  }

  setOnline(id, online) {
    const p = this.S.players.find((x) => x.id === id);
    if (p && !p.manual) { p.online = online; this.push(); }
  }

  updateConfig(patch) {
    if (this.S.phase !== 'lobby') return;
    Object.assign(this.S, patch);
    if (this.S.players.length > this.S.maxPlayers) this.S.maxPlayers = this.S.players.length;
    this.push();
  }

  // ---- 진행 ----
  alive() { return this.S.players.filter((p) => p.alive); }

  sleep(ms) {
    const run = this.run;
    return new Promise((res, rej) => setTimeout(() => (run === this.run ? res() : rej(new Abort())), ms));
  }

  check(run) { if (run !== this.run) throw new Abort(); }

  canStart() {
    const n = this.S.players.length;
    return n >= 2 && this.S.elimCount >= 1 && this.S.elimCount < n && this.S.games.length > 0;
  }

  start() {
    if (this.S.phase !== 'lobby' || !this.canStart()) return false;
    this.matchLoop().catch((e) => { if (!(e instanceof Abort)) console.error(e); });
    return true;
  }

  out() { return this.S.players.filter((p) => !p.alive).length; }
  totalDeaths() { return this.S.players.reduce((n, p) => n + p.deaths, 0); }

  // 새로고침 뒤 이어하기: 지금까지의 죽음 횟수 다음 라운드부터
  resume() {
    this.S.game = null;
    this.matchLoop(this.totalDeaths() + 1).catch((e) => { if (!(e instanceof Abort)) console.error(e); });
  }

  async matchLoop(from = 1) {
    const S = this.S;
    const run = ++this.run;
    this.emit('start');
    // 라운드마다 정확히 한 번의 죽음. 탈락자가 정해진 수만큼 나오면 끝
    for (let r = from; this.out() < S.elimCount; r++) {
      this.check(run);
      if (this.alive().length <= 1) break;
      S.phase = 'pick';
      S.round = r;
      S.game = null;
      S.turn = null;
      S.caption = '';
      this.push();
      this.emit('round', { round: r, total: S.elimCount, alive: this.alive().length, out: this.out(), lives: S.lives });
      await this.sleep(3000);
      const type = await this.choose(run);
      this.check(run);
      S.lastGame = type;
      S.pick = null;
      S.phase = 'game';
      S.game = { type, gid: ++this.gid };
      this.push();
      const before = this.totalDeaths();
      await GAMES[type].run(this.ctx(run));
      this.check(run);
      if (this.totalDeaths() === before) {
        // 안전장치: 게임이 아무도 탈락시키지 않았다면 무작위 처형
        const v = this.alive()[rand(this.alive().length)];
        await this.kill(v.id, '시간 초과 처형', run);
      }
      await this.sleep(600);
    }
    this.check(run);
    S.phase = 'end';
    S.game = null;
    S.turn = null;
    this.push();
    this.emit('end');
  }

  async choose(run) {
    const S = this.S;
    const opts = S.games.slice();
    if (S.pickMode === 'host') {
      S.pick = { waiting: true, options: opts };
      this.push();
      const chosen = await new Promise((res) => { this.pendingPick = { res, run }; });
      this.pendingPick = null;
      this.check(run);
      if (chosen !== '*') {
        S.pick = { waiting: false, chosen };
        this.push();
        this.emit('picked', { chosen });
        await this.sleep(2200);
        return chosen;
      }
    }
    // 무작위: 직전 게임은 되도록 피한다
    const pool = opts.length > 1 ? opts.filter((g) => g !== S.lastGame) : opts;
    const chosen = pool[rand(pool.length)];
    S.pick = { waiting: false, chosen, rolling: true };
    this.push();
    this.emit('pickroll', { options: opts, chosen });
    await this.sleep(4200);
    return chosen;
  }

  hostPick(type) {
    if (this.pendingPick && (type === '*' || this.S.games.includes(type))) this.pendingPick.res(type);
  }

  async kill(id, cause, run = this.run) {
    this.check(run);
    const p = this.S.players.find((x) => x.id === id);
    if (!p || !p.alive) return;
    p.deaths++;
    p.log.push({ round: this.S.round, cause });
    p.cause = cause;
    const out = p.deaths >= this.S.lives;
    if (out) {
      p.alive = false;
      p.diedRound = this.S.round;
    }
    this.S.turn = null;
    this.push();
    this.emit('death', { id, cause, deaths: p.deaths, lives: this.S.lives, out });
    await this.sleep(out ? 5200 : 4600);
  }

  turn(actor, kind, { ms, options = null, def, validate = () => true } = {}, run) {
    this.check(run);
    const S = this.S;
    const dur = ms ?? S.timeout * 1000;
    const tid = rand(1e9);
    S.turn = { id: tid, actor, kind, ms: dur, options };
    this.push();
    return new Promise((res, rej) => {
      const finish = (data) => {
        clearTimeout(timer);
        this.pending = null;
        S.turn = null;
        if (run !== this.run) return rej(new Abort());
        this.push();
        res(data);
      };
      const timer = setTimeout(() => finish(def ? def() : null), dur);
      this.pending = { tid, actor, kind, validate, finish, run, def };
    });
  }

  // 참가자 또는 방장이 보낸 행동
  act(from, kind, data, { asHost = false } = {}) {
    const P = this.pending;
    if (!P || P.kind !== kind) return;
    if (from !== P.actor && !asHost) return;
    if (data && data.auto) return P.finish(P.def ? P.def() : null);
    if (!P.validate(data)) return;
    P.finish(data);
  }

  reset() {
    this.run++;
    if (this.pending) this.pending.finish(null);
    if (this.pendingPick) { this.pendingPick.res('*'); this.pendingPick = null; }
    const S = this.S;
    S.phase = 'lobby';
    S.round = 0;
    S.game = null;
    S.turn = null;
    S.pick = null;
    S.caption = '';
    S.lastGame = null;
    for (const p of S.players) { p.alive = true; p.cause = null; p.diedRound = 0; p.deaths = 0; p.log = []; }
    this.push();
    this.emit('reset');
  }

  ctx(run) {
    const self = this;
    return {
      alive: () => self.alive().map((p) => p.id),
      name: (id) => {
        const p = self.S.players.find((x) => x.id === id);
        return p ? p.name : '?';
      },
      set(patch) {
        self.check(run);
        Object.assign(self.S.game, patch);
        self.push();
      },
      caption(text) {
        self.S.caption = text;
        self.push();
      },
      emit(type, data) { self.check(run); self.emit(type, data); },
      sleep: (ms) => self.sleep(ms),
      turn: (actor, kind, opts) => self.turn(actor, kind, opts, run),
      kill: (id, cause) => self.kill(id, cause, run),
      rand,
      shuffle,
      timeout: self.S.timeout * 1000,
    };
  }
}
