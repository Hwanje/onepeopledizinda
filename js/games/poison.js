import { h, roster, esc, pad } from './common.js';

export const poison = {
  id: 'poison',
  name: '독배',
  tag: 'POISONED CHALICE',
  line: '잔은 사람 수만큼. 독은 하나.',
  rule: '차례대로 잔을 하나씩 고른다. 모두 고르면 무작위 순서로 한 명씩 들이킨다.',

  async run(c) {
    const order = c.shuffle(c.alive());
    const n = order.length;
    const bad = c.rand(n);
    const picks = {};
    c.set({ order, n, picks: {}, cur: null, phase: 'pick', drank: [], drinking: null });
    c.caption(`${n}개의 잔이 채워집니다`);
    c.emit('pour', { n });
    await c.sleep(2400);
    for (const id of order) {
      const free = [...Array(n).keys()].filter((i) => !(i in picks));
      c.set({ cur: id });
      let cup;
      if (free.length === 1) {
        c.caption(`${c.name(id)}에게 남은 잔은 하나뿐`);
        await c.sleep(1200);
        cup = free[0];
      } else {
        c.caption(`${c.name(id)} — 잔을 고르시오`);
        const d = await c.turn(id, 'cup', {
          options: free,
          def: () => ({ cup: free[c.rand(free.length)] }),
          validate: (x) => x && free.includes(x.cup),
        });
        cup = d.cup;
      }
      picks[cup] = id;
      c.set({ picks: { ...picks } });
      c.emit('take', { id, cup });
      await c.sleep(500);
    }
    const drinkOrder = c.shuffle(order);
    c.set({ phase: 'drink', cur: null });
    c.caption('모두 잔을 들었습니다. 한 명씩 마십니다.');
    await c.sleep(2000);
    const drank = [];
    for (const id of drinkOrder) {
      const cup = Number(Object.keys(picks).find((k) => picks[k] === id));
      c.set({ cur: id, drinking: null });
      c.caption(`${c.name(id)}의 차례`);
      await c.turn(id, 'drink', { def: () => ({}), validate: () => true });
      c.set({ drinking: cup });
      c.emit('drink', { id, cup });
      await c.sleep(2600 + c.rand(1600));
      if (cup === bad) {
        c.emit('poisoned', { id, cup });
        c.caption('');
        await c.sleep(1600);
        await c.kill(id, '독배 · 중독');
        return;
      }
      drank.push(cup);
      c.set({ drank: drank.slice(), drinking: null });
      c.emit('fine', { id, cup });
      c.caption('...아무 일도 없었다');
      await c.sleep(1300);
    }
  },

  View: class {
    constructor(root, api) {
      this.api = api;
      this.el = h(`
        <div class="g g-poison">
          <div class="ps-table"></div>
          <div class="g-holder"></div>
          <div class="g-actions"></div>
          <div class="g-roster"></div>
        </div>`);
      root.appendChild(this.el);
      this.table = this.el.querySelector('.ps-table');
    }

    cupEl(i) { return this.table.querySelector(`.ps-cup[data-i="${i}"]`); }

    build(n) {
      if (this.table._n === n) return;
      this.table._n = n;
      let html = '';
      for (let i = 0; i < n; i++) {
        html += `<button class="ps-cup" data-i="${i}" disabled>
          <svg viewBox="0 0 60 90" aria-hidden="true">
            <path class="ps-glass" d="M8 6 L52 6 Q52 40 30 46 Q8 40 8 6 Z"/>
            <path class="ps-wine" d="M11 16 L49 16 Q48 38 30 43 Q12 38 11 16 Z"/>
            <rect x="28" y="46" width="4" height="28" class="ps-stem"/>
            <ellipse cx="30" cy="78" rx="16" ry="4" class="ps-stem"/>
          </svg>
          <span class="ps-no">${i + 1}</span>
          <span class="ps-who"></span>
        </button>`;
      }
      this.table.innerHTML = html;
      this.table.querySelectorAll('.ps-cup').forEach((b) => (b.onclick = () => {
        this.api.act('cup', { cup: Number(b.dataset.i) });
        this.table.classList.remove('choosing');
      }));
    }

    update(S) {
      const g = S.game;
      const api = this.api;
      if (!g.order) return;
      this.build(g.n);
      const canPick = api.canAct('cup');
      this.table.classList.toggle('choosing', canPick);
      for (let i = 0; i < g.n; i++) {
        const b = this.cupEl(i);
        const who = g.picks[i];
        const p = who && api.player(who);
        b.classList.toggle('taken', !!who);
        b.classList.toggle('empty', g.drank.includes(i));
        b.classList.toggle('mine', !!who && who === api.me);
        b.querySelector('.ps-who').textContent = p ? pad(p.num) : '';
        b.disabled = !(canPick && !who);
      }
      const p = api.player(g.cur);
      this.el.querySelector('.g-holder').innerHTML = p
        ? `<span class="gh-k">${g.phase === 'pick' ? '잔을 고르는 자' : '잔을 드는 자'}</span><span class="gh-n">${pad(p.num)}</span><span class="gh-name">${esc(p.name)}</span>`
        : '';
      const marks = {};
      for (const k in g.picks) marks[g.picks[k]] = `${Number(k) + 1}번 잔`;
      roster(this.el.querySelector('.g-roster'), api, g.order, { active: g.cur, marks });
      const A = this.el.querySelector('.g-actions');
      if (api.canAct('drink')) {
        const key = 'drink' + S.turn.id;
        if (A._k !== key) {
          A._k = key;
          A.innerHTML = '<button class="btn btn-blood btn-big">잔을 비운다</button>';
          A.querySelector('button').onclick = () => { api.act('drink', {}); A.innerHTML = ''; A._k = null; };
        }
      } else if (canPick) {
        if (A._k !== 'pickhint') { A._k = 'pickhint'; A.innerHTML = '<div class="bm-hint">잔 하나를 누르시오</div>'; }
      } else if (A._k) { A.innerHTML = ''; A._k = null; }
    }

    event(ev) {
      const { sfx, fx, heart } = this.api;
      const d = ev.data;
      switch (ev.type) {
        case 'pour':
          sfx.stinger();
          this.table.classList.add('poured');
          break;
        case 'take':
          sfx.ui();
          this.cupEl(d.cup)?.classList.add('lift');
          setTimeout(() => this.cupEl(d.cup)?.classList.remove('lift'), 500);
          break;
        case 'drink':
          sfx.gulp();
          heart(110);
          this.cupEl(d.cup)?.classList.add('drinking');
          break;
        case 'fine':
          heart(0);
          sfx.sigh();
          this.cupEl(d.cup)?.classList.remove('drinking');
          break;
        case 'poisoned': {
          heart(0);
          sfx.choke();
          const cup = this.cupEl(d.cup);
          cup?.classList.remove('drinking');
          cup?.classList.add('toxic');
          fx.glitch(1400);
          fx.flash('rgba(60,255,90,.35)', 200);
          fx.shake(1, 1200);
          const c = fx.centerOf(cup);
          fx.burst(c.x, c.y, { count: 40, colors: ['#3cff6a', '#1a8c35', '#b3ffbf'], speed: 5, gravity: 0.1, life: 90 });
          break;
        }
      }
    }

    destroy() { this.api.heart(0); this.el.remove(); }
  },
};
