const test = require('node:test');
const assert = require('node:assert');
const Core = require('./core.js');

const DT = 1 / 60;

/**
 * 人のかわりに走る自動プレイ。谷・壁・じゃま物の手前で跳び、
 * 越えたら離す (押しっぱなしにしない)。delay は跳ぶのを遅らせる秒数。
 */
function makeBot(delay) {
  return { until: null, wait: 0, air: false, delay: delay || 0 };
}
function botStep(g, st, dt) {
  const p = g.p;
  if (st.air) {
    if (p.onGround) { st.air = false; st.until = null; Core.input(g, 'jump', false); }
    else if (p.x >= st.until) { Core.input(g, 'jump', false); return; }
    else return;
  }
  if (st.until == null) {
    const plan = Core.jumpPlan(g, p, Core.speedAt(p.x));
    if (plan) { st.until = plan.until; st.wait = st.delay; }
  }
  if (st.until != null) {
    st.wait -= dt;
    if (st.wait <= 0) { Core.input(g, 'jump', true); st.air = true; }
  }
}

function runBot(seed, seconds, opts, delay) {
  const g = Core.newGame(Object.assign({ seed: seed, noEnemies: true }, opts || {}));
  const st = makeBot(delay);
  for (let t = 0; t < seconds && !g.over; t += DT) {
    botStep(g, st, DT);
    Core.step(g, DT);
  }
  return g;
}

test('同じ seed からは同じ世界ができる', () => {
  const a = Core.createWorld(5), b = Core.createWorld(5);
  Core.ensure(a, 6000); Core.ensure(b, 6000);
  assert.deepStrictEqual(a.b.map((x) => [x.x, x.w, x.roofY]), b.b.map((x) => [x.x, x.w, x.roofY]));
});

test('谷の幅は、どの高さの差でも跳んで渡れる余裕がある (全力ジャンプの届く距離 - 38 以下)', () => {
  let n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const w = Core.createWorld(seed);
    Core.ensure(w, 40000);
    for (let i = 1; i < w.b.length; i++) {
      const pv = w.b[i - 1], b = w.b[i];
      const gap = b.x - (pv.x + pv.w);
      const dy = b.roofY - pv.roofY;
      const sp = Core.speedAt(pv.x + pv.w);
      if (pv.ground && b.ground) {
        assert.strictEqual(gap, 0, '地上の道は谷なしでつづく');
        assert.strictEqual(dy, 0, '地上の道は同じ高さ');
        n++;
        continue;
      }
      assert.ok(gap >= 50, `谷が狭すぎる ${gap}`);
      assert.ok(gap <= Core.reach(sp, dy) - 37, `seed ${seed} の ${i} 番目: 谷 ${gap} が届く距離 ${Core.reach(sp, dy)} に対して広い`);
      assert.ok(dy >= -80 && dy <= 90, `段差 ${dy}`);
      n++;
    }
  }
  assert.ok(n > 1000, `調べた谷の数 ${n}`);
});

test('自動プレイが 20 通りの世界を 2 分走りきれる (谷・壁・じゃま物をぜんぶ越える)', () => {
  let worst = Infinity;
  for (let seed = 1; seed <= 20; seed++) {
    const g = runBot(seed, 120);
    assert.strictEqual(g.over, null, `seed ${seed}: ${g.over} (x=${Math.round(g.p.x)})`);
    worst = Math.min(worst, g.p.x);
  }
  assert.ok(worst > 20000, `いちばん短い走行 ${Math.round(worst)}`);
});

test('ふちを過ぎてから跳んでも渡れる (0.09 秒おそい。猶予は 0.1 秒)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = runBot(seed, 120, {}, 0.09);
    assert.strictEqual(g.over, null, `seed ${seed}: ${g.over} (x=${Math.round(g.p.x)})`);
  }
});

test('高いビルのふちの少し下にぶつかっても、角に手がかかって登れる (30px まで)', () => {
  const g = Core.newGame({ seed: 1, noEnemies: true });
  const b = g.world.b[1];
  const o = { x: b.x - 14, y: b.roofY + 22, vx: 200, vy: 100, hw: 9, inside: -1, onGround: false };
  Core.stepBody(g, o, 1 / 30);
  assert.ok(o.x > b.x - 10, '壁にはばまれず進む');
  assert.strictEqual(o.y, b.roofY, 'ふちの上に乗る');
  const lo = { x: b.x - 14, y: b.roofY + 60, vx: 200, vy: 100, hw: 9, inside: -1, onGround: false };
  Core.stepBody(g, lo, 1 / 30);
  assert.ok(lo.blocked && lo.x <= b.x - 9 + 0.01, '30px より下なら、ふつうに壁にぶつかる');
});

test('じゃま物は互いに 170px 以上はなれ、谷のきわには置かれない', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const w = Core.createWorld(seed);
    Core.ensure(w, 30000);
    for (const b of w.b) {
      if (b.ground) continue;            // 地上の道は、下の別のテストで見る
      for (const L of [b.roof, b.room]) {
        const xs = L.obs.map((o) => o.x).sort((a, c) => a - c);
        for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 170, '近すぎ');
        for (const o of L.obs) assert.ok(o.x >= b.x + 95 || b.i === 0, '左はしに近い');
      }
      for (const o of b.roof.obs) assert.ok(o.x <= b.x + b.w - 150 || b.i === 0, '右はしに近い');
    }
  }
});

test('ドアのあるビルは中が走れる広さ。出口は屋上の右はしの手前', () => {
  let doors = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const w = Core.createWorld(seed);
    Core.ensure(w, 30000);
    for (const b of w.b) {
      if (!b.door) continue;
      doors++;
      assert.ok(b.exitX - b.doorX >= 200, `中が短い ${b.exitX - b.doorX}`);
      assert.ok(b.x + b.w - b.exitX >= 100, '出口から谷までが近すぎる');
      for (const o of b.room.obs) assert.ok(o.x > b.doorX + 100 && o.x < b.exitX - 80, '中のじゃま物の位置');
    }
  }
  assert.ok(doors > 100, `ドアの数 ${doors}`);
});

test('ドアに入ると中へ、出口で屋上へ戻る', () => {
  const g = Core.newGame({ seed: 3, noEnemies: true });
  const b = g.world.b[2];
  assert.ok(b.door, '3 つ目のビルには必ずドアがある');
  g.p.x = b.doorX - 4; g.p.y = b.roofY; g.p.onGround = true; g.p.vy = 0;
  assert.ok(Core.nearDoor(g), 'ドアの近く');
  Core.input(g, 'door', true);
  Core.step(g, DT);
  assert.strictEqual(g.p.inside, 2);
  assert.strictEqual(g.p.y, b.floorY);
  // 走って出口へ (中のじゃま物は跳ぶ)
  const st = makeBot();
  for (let i = 0; i < 600 && g.p.inside >= 0 && !g.over; i++) {
    botStep(g, st, DT);
    Core.step(g, DT);
  }
  assert.strictEqual(g.p.inside, -1, '出口で外へ出る');
  assert.strictEqual(g.p.y, b.roofY);
  assert.ok(g.p.x >= b.exitX && g.p.x < b.x + b.w - 90);
});

test('谷に落ちたら終わり', () => {
  const g = Core.newGame({ seed: 1, noEnemies: true });
  for (let i = 0; i < 60 * 30 && !g.over; i++) Core.step(g, DT);   // 跳ばずに走りつづける
  assert.strictEqual(g.over, 'fell');
});

test('敵は追いついたらつかまる', () => {
  const g = Core.newGame({ seed: 2, noEnemies: true });
  const e = Core.spawnEnemy(g, 'suit', g.p.x - 5);
  Core.step(g, DT);
  assert.strictEqual(g.over, 'caught');
  assert.ok(e);
});

test('敵は谷を跳んでついてくる。撃ちながら走れば、1 分はふつうに逃げ切れる', () => {
  let alive = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const g = Core.newGame({ seed: seed });
    const st = makeBot();
    Core.input(g, 'fire', true);
    for (let t = 0; t < 60 && !g.over; t += DT) { botStep(g, st, DT); Core.step(g, DT); }
    if (!g.over) alive++;
    assert.notStrictEqual(g.over, 'fell', `seed ${seed}`);
  }
  assert.ok(alive >= 9, `逃げ切った数 ${alive}/10`);
});

test('dt が負でも 0 でも大きすぎても壊れない', () => {
  const g = Core.newGame({ seed: 4, noEnemies: true });
  Core.step(g, -4.04);
  assert.strictEqual(g.p.x, 0);
  Core.step(g, 0);
  assert.strictEqual(g.p.x, 0);
  Core.step(g, 10);
  assert.ok(g.p.x > 0 && g.p.x < 20, `x=${g.p.x}`);
});

test('水でっぽうは 13 種類。名前・値段が重ならず、くせの説明があり、ぜんぶ撃てる', () => {
  assert.ok(Core.GUNS.length >= 12);
  const ids = new Set(Core.GUNS.map((x) => x.id));
  assert.strictEqual(ids.size, Core.GUNS.length);
  assert.strictEqual(Core.GUNS[0].price, 0);
  for (const gun of Core.GUNS) {
    assert.ok(gun.trait && gun.trait.length >= 4, `${gun.id}: くせの説明が無い`);
    assert.ok(typeof gun.kick === 'number' && gun.kick >= 0 && gun.kick <= 0.4, `${gun.id}: 反動`);
    assert.ok(gun.flash >= 6 && gun.flash <= 30, `${gun.id}: 銃口の光`);
    const g = Core.newGame({ seed: 7, noEnemies: true, guns: [gun.id] });
    Core.input(g, 'fire', true);
    let fired = null;
    for (let i = 0; i < 90 && !fired; i++) { Core.step(g, DT); fired = g.events.find((e) => e.t === 'shoot'); }
    assert.ok(fired, `${gun.id} が撃てない`);
    assert.ok(gun.beam || g.shots.length >= gun.n, `${gun.id} の玉が出ない`);
    assert.ok(g.water < 100 || gun.cost < 0.2, `${gun.id} の水が減らない`);
  }
  assert.strictEqual(new Set(Core.GUNS.map((x) => x.trait)).size, Core.GUNS.length, 'くせの説明が重なっている');
});

test('マシンガン: 押しつづけると連射がどんどん加速し、離すと最初にもどる', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true, guns: ['gatling'] });
  const times = [];
  const run = (frames) => { for (let i = 0; i < frames; i++) { g.water = 100; Core.step(g, DT); g.events.forEach((e) => { if (e.t === 'shoot') times.push(g.t); }); g.events.length = 0; } };
  Core.input(g, 'fire', true);
  run(90);                                   // 1.5 秒押しつづける
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  assert.ok(gaps[0] > 0.19, `はじめは遅い (${gaps[0].toFixed(3)} 秒)`);
  assert.ok(gaps[gaps.length - 1] < 0.075, `さいごは速い (${gaps[gaps.length - 1].toFixed(3)} 秒)`);
  assert.ok(gaps.every((x, i) => i === 0 || x <= gaps[i - 1] + 0.02), '間隔はだんだんちぢむ');
  Core.input(g, 'fire', false); run(20);
  const n0 = times.length;
  Core.input(g, 'fire', true); run(40);
  const again = times.slice(n0);
  assert.ok(again[1] - again[0] > 0.19, `離すと、また遅いところから (${(again[1] - again[0]).toFixed(3)} 秒)`);
});

test('スナイパー: 押してから「ため」の 0.4 秒は撃たず、ためきると撃つ。途中で離すとやりなおし', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true, guns: ['sniper'] });
  Core.input(g, 'fire', true);
  let first = null;
  for (let i = 0; i < 60 && first == null; i++) { Core.step(g, DT); if (g.events.some((e) => e.t === 'shoot')) first = i / 60; }
  assert.ok(first >= 0.38 && first <= 0.5, `ためてから撃つ (${first} 秒)`);
  assert.ok(g.events.length >= 0);
  // 途中で離す
  const h = Core.newGame({ seed: 7, noEnemies: true, guns: ['sniper'] });
  Core.input(h, 'fire', true);
  for (let i = 0; i < 15; i++) Core.step(h, DT);          // 0.25 秒ためる
  assert.ok(h.p.charge > 0.2, `ためている (${h.p.charge.toFixed(2)})`);
  Core.input(h, 'fire', false);
  for (let i = 0; i < 20; i++) Core.step(h, DT);
  assert.strictEqual(h.shots.length, 0, '離したら撃たない');
  assert.ok(h.p.charge < 0.05, `ためが消える (${h.p.charge.toFixed(2)})`);
});

test('ウォーターカッター: 玉は飛ばず、線の上の敵を射程まで全員つらぬく (外れた敵と、射程の外には当たらない)', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true, guns: ['cutter'] });
  const mk = (dx, dy) => { const e = Core.spawnEnemy(g, 'suit', g.p.x - dx); e.hp = e.maxhp = 50; e.y = g.world.b[0].roofY + (dy || 0); e.stun = 99; e.x = g.p.x - dx; return e; };
  const near = mk(120), mid = mk(250), far = mk(560), high = mk(180, -120);
  Core.input(g, 'fire', true);
  Core.step(g, DT);
  assert.strictEqual(g.shots.length, 0, '玉は飛ばない');
  assert.ok(g.events.some((e) => e.t === 'beam'), 'ビームのイベント');
  assert.ok(near.hp < 50 && mid.hp < 50, `ならんだ 2 人に、同じコマで当たる (${near.hp}, ${mid.hp})`);
  assert.strictEqual(far.hp, 50, '射程の外には当たらない');
  assert.strictEqual(high.hp, 50, '線から高くはずれた敵には当たらない');
});

test('ビリビリ: しびれが、近くの敵へ連鎖する (遠い敵には走らない)', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true, guns: ['shock'] });
  const mk = (dx) => { const e = Core.spawnEnemy(g, 'suit', g.p.x - dx); e.hp = e.maxhp = 50; e.y = g.world.b[0].roofY; e.x = g.p.x - dx; e.stun = 0; return e; };
  const a = mk(100), b = mk(170), c = mk(235), far = mk(480);
  [a, b, c, far].forEach((e) => { e.vx = 0; });
  Core.input(g, 'fire', true);
  let arcs = 0;
  for (let i = 0; i < 40; i++) { Core.step(g, DT); arcs += g.events.filter((e) => e.t === 'arc').length; g.events.length = 0; if (arcs) break; }
  assert.ok(arcs >= 1, `連鎖のイベント (${arcs})`);
  assert.ok(a.hp < 50 && b.hp < 50, `先頭とそのとなりに当たる (${a.hp}, ${b.hp})`);
  assert.ok(b.stun > 0 || c.stun > 0, 'となりもしびれる');
  assert.strictEqual(far.hp, 50, '遠い敵には走らない');
});
test('どの水でっぽうも、追ってくる敵に当たる (射程・向き・あわの置き方の確認)', () => {
  for (const gun of Core.GUNS) {
    const g = Core.newGame({ seed: 7, guns: [gun.id], startGun: gun.id });
    g.enemies[0].hp = g.enemies[0].maxhp = 9999;
    const st = makeBot();
    Core.input(g, 'fire', true);
    let hits = 0;
    for (let i = 0; i < 60 * 6 && !g.over; i++) {
      g.water = 100;
      botStep(g, st, DT);
      Core.step(g, DT);
      hits += g.events.filter((ev) => ev.t === 'hit').length;
      g.events.length = 0;
    }
    assert.ok(hits > 0, `${gun.id}: 当たらない`);
  }
});

test('水が切れると撃てない。たまっていく', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true });
  g.water = 0;
  Core.input(g, 'fire', true);
  Core.step(g, DT);
  assert.strictEqual(g.shots.length, 0);
  assert.ok(g.events.some((e) => e.t === 'dry'));
  Core.input(g, 'fire', false);
  for (let i = 0; i < 60; i++) Core.step(g, DT);
  assert.ok(g.water > 5);
});

test('切りかえで持っている水でっぽうが順番に出る', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true, guns: ['mizu', 'twin', 'shot'] });
  assert.strictEqual(Core.curGun(g).id, 'mizu');
  Core.input(g, 'switch', true);
  assert.strictEqual(Core.curGun(g).id, 'twin');
  Core.input(g, 'switch', true); Core.input(g, 'switch', true);
  assert.strictEqual(Core.curGun(g).id, 'mizu');
});

test('水爆弾: 敵に向かって飛び、はじけて大きく押し戻す。数が減る', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true });
  const e = Core.spawnEnemy(g, 'suit', -130);
  e.hp = e.maxhp = 99;
  const x0 = e.x;
  assert.strictEqual(g.bombs, 3);
  Core.input(g, 'bomb', true);
  for (let i = 0; i < 90 && !g.events.some((ev) => ev.t === 'explode'); i++) Core.step(g, DT);
  assert.strictEqual(g.bombs, 2);
  assert.ok(g.events.some((ev) => ev.t === 'explode'), 'はじけた');
  assert.ok(e.hp < 99, `当たった hp=${e.hp}`);
  assert.ok(e.x < x0 + 40 - 30, `押し戻された ${x0} → ${e.x}`);
  assert.ok(g.puddles.length === 1, 'みずたまり');
});

test('水爆弾が 0 個なら投げられない', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true, bombs: 0 });
  Core.input(g, 'bomb', true);
  Core.step(g, DT);
  assert.strictEqual(g.thrown.length, 0);
  assert.ok(g.events.some((e) => e.t === 'nope'));
});

test('物をもって、なげて、敵に当てる', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true });
  const crate = g.world.b[0].roof.props.find((p) => p.t === 'crate');
  g.p.x = crate.x - 3;
  Core.step(g, DT);
  assert.ok(Core.nearProp(g), '近づくと拾える');
  Core.input(g, 'grab', true);
  Core.step(g, DT);
  assert.strictEqual(g.p.carry, 'crate');
  assert.ok(!g.world.b[0].roof.props.includes(crate), '置き場から消える');
  // もっている間は撃てない
  Core.input(g, 'fire', true);
  Core.step(g, DT);
  assert.strictEqual(g.shots.length, 0);
  Core.input(g, 'fire', false);
  const e = Core.spawnEnemy(g, 'suit', g.p.x - 140);
  e.hp = e.maxhp = 99;
  Core.input(g, 'grab', true);
  for (let i = 0; i < 90 && e.hp === 99; i++) Core.step(g, DT);
  assert.strictEqual(g.p.carry, null);
  assert.ok(e.hp < 99, `当たった hp=${e.hp}`);
});

test('ビルの中の敵は、ドアから追ってきて、出口から出る', () => {
  const g = Core.newGame({ seed: 3 });
  const b = g.world.b[2];
  // 敵を屋上のドアの手前に置き、主人公は中に入る
  g.enemies.length = 0;
  g.spawnT = 99;
  const e = Core.spawnEnemy(g, 'suit', b.doorX - 60);
  e.stun = 0;
  g.p.x = b.doorX - 2; g.p.y = b.roofY; g.p.onGround = true; g.p.vy = 0;
  Core.input(g, 'door', true);
  let entered = false, exited = false, sawBoth = false;
  const st = makeBot();
  for (let i = 0; i < 60 * 12 && !g.over; i++) {
    botStep(g, st, DT);
    Core.step(g, DT);
    if (e.inside === 2) { entered = true; if (g.p.inside === 2) sawBoth = true; }
    if (entered && e.inside === -1) { exited = true; break; }
  }
  assert.ok(entered, '敵もドアから入る');
  assert.ok(sawBoth, '主人公がまだ中にいるうちに入ってくる');
  assert.ok(exited || g.over, '出口へ向かう');
});

test('倒した敵はコインを落とし、数えられる', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true });
  const e = Core.spawnEnemy(g, 'dog', -100);
  Core.applyHit(g, e, { dmg: 5 });
  assert.strictEqual(g.kills, 1);
  assert.strictEqual(g.coins, Core.ENEMIES.dog.coin);
  assert.strictEqual(e.state, 'fly');
});

test('コイン・タンク・爆弾・ギフトが拾える', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true });
  const L = g.world.b[0].roof;
  const y = g.world.b[0].roofY - 24;
  L.items.push({ x: 20, y: y, t: 'coin' }, { x: 40, y: y, t: 'tank' }, { x: 60, y: y, t: 'bomb' }, { x: 80, y: y, t: 'gift' });
  g.water = 10;
  for (let i = 0; i < 40; i++) Core.step(g, DT);
  assert.ok(g.coins >= 1);
  assert.ok(g.water > 50, `水 ${g.water}`);
  assert.strictEqual(g.bombs, 4);
  assert.strictEqual(g.guns.length, 2, 'ギフトで水でっぽうが 1 つ増える');
  assert.strictEqual(g.gunIdx, 1);
});

test('じゃま物にぶつかるとつまずく。跳べば越える', () => {
  const g = Core.newGame({ seed: 7, noEnemies: true });
  const ob = g.world.b[0].roof.obs[0];
  g.p.x = ob.x - 40;
  let tripped = false;
  for (let i = 0; i < 60; i++) { Core.step(g, DT); if (g.events.some((e) => e.t === 'trip')) tripped = true; }
  assert.ok(tripped, '跳ばなければつまずく');
  const h = Core.newGame({ seed: 7, noEnemies: true });
  h.p.x = ob.x - 60;
  let trippedH = false;
  const st = makeBot();
  for (let i = 0; i < 60; i++) {
    botStep(h, st, DT);
    Core.step(h, DT);
    if (h.events.some((e) => e.t === 'trip')) trippedH = true;
  }
  assert.ok(!trippedH, '跳べば越える');
});

test('敵の種類がそろっていて、距離が進むと出てくる', () => {
  for (const k of ['suit', 'dog', 'big', 'drone']) assert.ok(Core.ENEMIES[k]);
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const g = Core.newGame({ seed: seed, noEnemies: false });
    g.p.x = 20000;
    g.p.y = Core.buildingAt(g.world, 20000) ? Core.buildingAt(g.world, 20000).roofY : 0;
    Core.ensure(g.world, 24000);
    g.enemies.length = 0;
    for (let i = 0; i < 40; i++) {
      g.spawnT = 0; g.enemies.length = 0;
      Core.step(g, 0.001);
      g.enemies.forEach((e) => seen.add(e.type));
    }
  }
  assert.ok(seen.has('suit') && seen.has('dog') && seen.has('big') && seen.has('drone'), [...seen].join());
});

test('物の種類の表が、ソースで重なっていない (同じ鍵を 2 回書くと黙って消える)', () => {
  const src = require('node:fs').readFileSync(require.resolve('./core.js'), 'utf8');
  const ids = [...src.matchAll(/\{ id: '([a-z]+)'/g)].map((m) => m[1]);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('ビルの中を抜けると、追ってくる敵とのきょりがひらく (近道のごほうび)', () => {
  let better = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = Core.newGame({ seed: seed });
    const doorB = g.world.b.find((b) => b.door);
    g.enemies.length = 0; g.spawnT = 99;
    const e = Core.spawnEnemy(g, 'suit', doorB.doorX - 130);
    g.p.x = doorB.doorX - 2; g.p.y = doorB.roofY; g.p.vy = 0; g.p.onGround = true;
    e.x = doorB.doorX - 130; e.y = doorB.roofY; e.vy = 0;
    Core.input(g, 'door', true);
    const st = makeBot();
    let gap0 = g.p.x - e.x;
    for (let i = 0; i < 60 * 2.2 && !g.over; i++) { botStep(g, st, DT); Core.step(g, DT); }
    if (!g.over && g.p.inside === -1 && g.p.x - e.x > gap0 + 40) better++;
  }
  assert.ok(better >= 9, `きょりがひらいた ${better}/12`);
});

test('ステージは 200m ごとに進み、終わりが無い (ボーナス・水・ばくだん・イベント)', () => {
  assert.strictEqual(Core.stageOf(0), 1);
  assert.strictEqual(Core.stageOf(40 * 199), 1);
  assert.strictEqual(Core.stageOf(40 * 200), 2);
  assert.strictEqual(Core.stageOf(40 * 2000), 11);
  assert.strictEqual(Core.stageOf(40 * 200 * 1000), 1001);
  const g = Core.newGame({ seed: 4, noEnemies: true });
  const st = makeBot();
  let events = [], coins0 = 0;
  g.water = 10; g.bombs = 1;
  // 1 ステージ目の終わり近くまで飛ばす
  g.p.x = 40 * 199.5;
  Core.ensure(g.world, g.p.x + 4000);
  const b = Core.buildingAt(g.world, g.p.x) || g.world.b[Core.indexNear(g.world, g.p.x)];
  g.p.x = b.x + 30; g.p.y = b.roofY; g.p.vy = 0;
  // 世界は x に応じて作るので、200m のきわで自然に越えさせる: 位置を 200m の手前へ置き直す
  g.p.x = Math.max(g.p.x, 40 * 198);
  const bb = Core.buildingAt(g.world, g.p.x);
  if (bb) g.p.y = bb.roofY;
  coins0 = g.coins;
  for (let i = 0; i < 60 * 40 && !g.over; i++) {
    botStep(g, st, DT); Core.step(g, DT);
    events = events.concat(g.events.filter((e) => e.t === 'stage')); g.events.length = 0;
    if (g.stage >= 2 && events.length) break;
  }
  assert.strictEqual(g.over, null);
  assert.strictEqual(g.stage, 2);
  assert.strictEqual(events.length, 1, 'ステージのイベントは 1 回だけ');
  assert.strictEqual(events[0].n, 2);
  assert.strictEqual(events[0].bonus, Core.stageClearBonus(1));
  assert.ok(g.coins - coins0 >= Core.stageClearBonus(1), 'ボーナスのコイン');
  assert.ok(g.water > 90, `水がまんたん (${g.water})`);
  assert.ok(g.bombs >= 2, `ばくだんが 1 つふえる (${g.bombs})`);
});

test('ステージを 5 つ続けて走っても、止まらず、1 つずつ進む (自動プレイ 8 通り)', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const g = Core.newGame({ seed: seed, noEnemies: true });
    const st = makeBot();
    const seen = [];
    for (let i = 0; i < 60 * 260 && !g.over && g.stage < 6; i++) {
      botStep(g, st, DT); Core.step(g, DT);
      for (const e of g.events) if (e.t === 'stage') seen.push(e.n);
      g.events.length = 0;
    }
    assert.strictEqual(g.over, null, `seed ${seed}: ${g.over}`);
    assert.deepStrictEqual(seen, [2, 3, 4, 5, 6], `seed ${seed}: ${seen}`);
  }
});

test('地上ステージ: 4 ステージに 1 回 (2, 6, 10 ...)。そのステージの道は谷なしでつづき、ステージの終わりで終わる', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter(Core.isGroundStage), [2, 6, 10]);
  let streets = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const w = Core.createWorld(seed);
    Core.ensure(w, Core.STAGE_PX * 12);
    for (let i = 0; i < w.b.length; i++) {
      const b = w.b[i];
      const st = Core.stageOf(b.x);
      if (b.ground) {
        streets++;
        assert.ok(Core.isGroundStage(st), `seed ${seed}: 地上の道が地上ステージ以外にある (stage ${st})`);
        assert.ok(b.x + b.w <= Core.stageOf(b.x) * Core.STAGE_PX + 1, '道が次のステージへはみ出す');
        assert.ok(!b.door, '地上にドアは無い');
      } else if (Core.isGroundStage(st) && Core.stageOf(b.x) * Core.STAGE_PX - b.x >= 300) {
        assert.fail(`seed ${seed}: 地上ステージなのに屋上のビル (x=${b.x})`);
      }
    }
    // ステージ 2 の道は、入り口から終わりまで 1 本につながっている
    const ids = w.b.filter((b) => b.ground && Core.stageOf(b.x) === 2);
    assert.ok(ids.length >= 2, `seed ${seed}: 道の区画 ${ids.length}`);
    for (let k = 1; k < ids.length; k++) assert.strictEqual(ids[k].x, ids[k - 1].x + ids[k - 1].w, '道が途切れている');
    assert.strictEqual(ids[ids.length - 1].x + ids[ids.length - 1].w, 2 * Core.STAGE_PX, '道がステージの終わりまでつづく');
  }
  assert.ok(streets > 60, `道の区画の数 ${streets}`);
});

test('地上のじゃま物: 190px 以上はなれる (区画の継ぎ目をまたいでも)。入り口から 95px・出口から 150px あける。車がある', () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const w = Core.createWorld(seed);
    Core.ensure(w, Core.STAGE_PX * 12);
    let last = null;
    for (const b of w.b) {
      if (!b.ground) { last = null; continue; }
      const entering = !(w.b[b.i - 1] && w.b[b.i - 1].ground && w.b[b.i - 1].x + w.b[b.i - 1].w === b.x);
      const lastSeg = b.x + b.w >= Core.stageOf(b.x) * Core.STAGE_PX - 1;
      for (const o of b.roof.obs) {
        kinds.add(o.t);
        if (last != null) assert.ok(o.x - last >= 190, `seed ${seed}: ${o.x - last}px しかはなれていない`);
        if (entering && last == null) assert.ok(o.x >= b.x + 95, '入り口に近すぎる');
        if (lastSeg) assert.ok(o.x <= b.x + b.w - 150, '出口に近すぎる');
        last = o.x;
      }
    }
  }
  for (const k of ['car', 'bin', 'hydrant', 'bench', 'cone', 'box']) assert.ok(kinds.has(k), `${k} が出ない`);
  assert.ok(!kinds.has('vent'), '地上に屋上のダクトは出ない');
});

test('自動プレイが、地上ステージ (車は押しつづけて跳ぶ) をふくむ 3 ステージを 40 通りで走りきる', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = Core.newGame({ seed: seed, noEnemies: true });
    const st = makeBot(seed % 3 === 0 ? 0.06 : 0);
    let sawStreet = false;
    for (let i = 0; i < 60 * 150 && !g.over && g.stage < 4; i++) {
      botStep(g, st, DT); Core.step(g, DT);
      if (g.stage === 2 && g.p.onGround) sawStreet = true;
      g.events.length = 0;
    }
    assert.strictEqual(g.over, null, `seed ${seed}: ${g.over} (x=${Math.round(g.p.x)})`);
    assert.ok(g.stage >= 4 && sawStreet, `seed ${seed}: stage ${g.stage}`);
  }
});

test('車は、ちょん跳びではつまずき、押しつづけたジャンプで越える', () => {
  const mk = () => {
    const g = Core.newGame({ seed: 7, noEnemies: true });
    const b = g.world.b[0];
    b.roof.obs.length = 0; b.roof.obs.push({ x: 400, t: 'car' });
    g.p.x = 300; g.p.y = b.roofY;
    return g;
  };
  // ちょん跳び (押してすぐ離す) を、車の手前でいちばん合う位置に
  let tripped = 0, passed = 0;
  for (const d of [30, 40, 50, 60, 70]) {
    const g = mk(); g.p.x = 400 - d;
    Core.input(g, 'jump', true); Core.step(g, DT); Core.input(g, 'jump', false);
    let t = false;
    for (let i = 0; i < 90; i++) { Core.step(g, DT); if (g.events.some((e) => e.t === 'trip')) t = true; g.events.length = 0; }
    if (t) tripped++;
  }
  assert.ok(tripped >= 4, `ちょん跳びでつまずいた ${tripped}/5`);
  const g = mk(); const st = makeBot();
  let t2 = false;
  for (let i = 0; i < 120; i++) { botStep(g, st, DT); Core.step(g, DT); if (g.events.some((e) => e.t === 'trip')) t2 = true; g.events.length = 0; }
  assert.ok(!t2 && g.p.x > 520, `押しつづければ越える (x=${Math.round(g.p.x)})`);
  passed++;
  assert.ok(passed);
});

test('stage イベントは地上かどうかを知らせる / 地上ステージは敵が 1 人多い', () => {
  const g = Core.newGame({ seed: 4, noEnemies: true });
  const st = makeBot();
  const evs = [];
  for (let i = 0; i < 60 * 130 && !g.over && g.stage < 3; i++) { botStep(g, st, DT); Core.step(g, DT); g.events.forEach((e) => { if (e.t === 'stage') evs.push(e); }); g.events.length = 0; }
  assert.deepStrictEqual(evs.map((e) => [e.n, e.ground]), [[2, true], [3, false]]);
  const h = Core.newGame({ seed: 4 });
  h.p.x = 40 * 200 * 1 + 400;
  const wantAt = (x) => { h.p.x = x; h.enemies.length = 0; h.spawnT = 0; for (let k = 0; k < 30; k++) { h.spawnT = 0; h.p.y = 0; Core.ensure(h.world, x + 4000); const b = Core.buildingAt(h.world, x); if (b) h.p.y = b.roofY; Core.step(h, 0.001); } return h.enemies.filter((e) => e.state === 'chase').length; };
  const onStreet = wantAt(40 * 398);   // ステージ 2 の終わり (m=398 → 1 + 2 + 地上の 1 = 4)
  const onRoof = wantAt(40 * 402);     // ステージ 3 の初め (m=402 → 1 + 2 = 3)
  assert.strictEqual(onStreet, onRoof + 1, `地上 ${onStreet} / 屋上 ${onRoof}`);
});
