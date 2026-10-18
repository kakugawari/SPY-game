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

test('自動プレイが 20 通りの世界を 2 分走りきれる (谷と壁をぜんぶ越える)', () => {
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

test('ビルの中: 追ってきた敵が、ドアから入ってきて、うしろに見える。撃てば当たる (ぜんぜん入ってこない、ではない)', () => {
  let seen = 0, hit = 0, tot = 0, hits = 0, caught = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = Core.newGame({ seed: seed, guns: ['mizu'] });
    Core.ensure(g.world, 60000);
    const bs = g.world.b.filter((q) => q.door && q.i > 3);
    const b = bs[seed % bs.length];
    assert.ok(b.exitX - b.doorX >= 400, `中が短い ${b.exitX - b.doorX}`);
    g.enemies.length = 0; g.spawnT = 99;
    g.p.x = b.doorX - 4; g.p.y = b.roofY; g.p.vy = 0; g.p.onGround = true;
    const e = Core.spawnEnemy(g, 'suit', b.doorX - 40);        // 同じ屋上の、ドアのすぐ手前
    e.y = b.roofY; e.onGround = true; e.hp = e.maxhp = 6;
    Core.input(g, 'door', true); Core.step(g, DT); Core.input(g, 'fire', true);
    let inView = false, h = 0;
    for (let i = 0; i < 60 * 8 && !g.over && g.p.inside >= 0; i++) {
      Core.step(g, DT);
      const d = g.p.x - e.x;
      if (e.inside === g.p.inside && e.state === 'chase' && d > 20 && d < 190) inView = true;
      for (const ev of g.events) if (ev.t === 'hit') h++;
      g.events.length = 0;
    }
    tot++; if (inView) seen++; if (h > 0) hit++; hits += h; if (g.over === 'caught') caught++;
  }
  assert.ok(seen >= tot * 0.8, `うしろに見えた ${seen}/${tot}`);
  assert.ok(hit >= tot * 0.8 && hits / tot >= 3, `撃って当たった ${hit}/${tot} (1 回につき ${(hits / tot).toFixed(1)} 発)`);
  assert.ok(caught <= tot * 0.1, `つかまった ${caught}/${tot}`);
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

test('自動プレイが、地上ステージをふくむ 3 ステージを 40 通りで走りきる', () => {
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

// ------------------------------------------------------------ 乗り物 (スケボー・ラジコンカー)
function streetGame(seed) {
  const g = Core.newGame({ seed: seed, noEnemies: true });
  Core.ensure(g.world, 8000 * 3);
  const b = g.world.b.find((q) => q.ground);
  return { g, b };
}

test('乗り物は地上の道にだけ出る (屋上には出ない)。両方の種類が出る', () => {
  const kinds = new Set(); let onRoof = 0, onStreet = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = Core.newGame({ seed: seed, noEnemies: true });
    Core.ensure(g.world, 8000 * 7);
    for (const b of g.world.b) {
      for (const it of b.roof.items.concat(b.room.items)) {
        if (!Core.RIDES[it.t]) continue;
        if (b.ground) { onStreet++; kinds.add(it.t); } else onRoof++;
      }
    }
  }
  assert.strictEqual(onRoof, 0);
  assert.ok(onStreet > 20 && kinds.has('board') && kinds.has('toycar'), `地上 ${onStreet} / ${[...kinds]}`);
});

function giveRide(g, kind) {
  g.p.ride = { k: kind, t: Core.RIDES[kind].sec };
}

test('乗ると速くなり、拾うと乗る。時間が切れると降りる', () => {
  const { g, b } = streetGame(3);
  g.p.x = b.x + 20; g.p.y = b.roofY; g.p.inside = -1;
  for (const q of g.world.b) q.roof.items.length = 0;
  b.roof.items.push({ x: b.x + 30, y: b.roofY - 22, t: 'toycar' });
  let got = false;
  for (let i = 0; i < 30; i++) { Core.step(g, DT); if (g.events.some((e) => e.t === 'ride')) got = true; g.events.length = 0; }
  assert.ok(got && g.p.ride && g.p.ride.k === 'toycar', '拾って乗った');
  assert.ok(Math.abs(g.p.vx / (Core.speedAt(g.p.x) * 1.5) - 1) < 0.01, `速さ ${g.p.vx}`);
  let off = false;
  for (let i = 0; i < 60 * 20 && !off; i++) { Core.step(g, DT); if (g.events.some((e) => e.t === 'unride')) off = true; g.events.length = 0; }
  assert.ok(off && !g.p.ride, '降りた');
});

test('障害物は無い (道に落ちている物は、ぜんぶ取れる物か、もてる物)。つまずくのは壁だけ', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const w = Core.createWorld(seed);
    Core.ensure(w, Core.STAGE_PX * 6);
    for (const b of w.b) {
      assert.ok(!('obs' in b.roof) && !('obs' in b.room), `seed ${seed}: じゃま物の置き場が残っている`);
      const taken = new Set(['coin', 'tank', 'bomb', 'gift', 'gem', 'board', 'toycar']);
      for (const it of b.roof.items.concat(b.room.items)) assert.ok(taken.has(it.t), `seed ${seed}: 知らない物 ${it.t}`);
    }
  }
  assert.strictEqual(Core.OBSTACLES, undefined);
  // 道を走り続けても、壁いがいではつまずかない (1 本道の地上ステージ)
  const g = Core.newGame({ seed: 5, noEnemies: true });
  const st = makeBot();
  let trips = 0;
  for (let i = 0; i < 60 * 60 && !g.over; i++) { botStep(g, st, DT); Core.step(g, DT); trips += g.events.filter((e) => e.t === 'trip' && e.k !== 'wall').length; g.events.length = 0; }
  assert.strictEqual(trips, 0);
});

test('ラジコンカーは、つかまりそうになると敵をはね飛ばして守る。スケボーは守らない', () => {
  for (const [kind, shield] of [['board', false], ['toycar', true]]) {
    const { b } = streetGame(5);
    const g = Core.newGame({ seed: 5 });
    Core.ensure(g.world, 8000 * 3);
    g.p.x = b.x + 300; g.p.y = b.roofY; g.p.inside = -1;
    giveRide(g, kind);
    g.enemies.length = 0;
    // 敵を主人公のすぐ後ろへ (つかまる位置)
    const e = Core.spawnEnemy(g, 'suit', 0);
    e.x = g.p.x - 5; e.y = b.roofY; e.onGround = true;
    const seen = new Set();
    for (let i = 0; i < 20 && !g.over; i++) { Core.step(g, DT); g.events.forEach((ev) => seen.add(ev.t)); g.events.length = 0; }
    if (shield) assert.ok(!g.over && seen.has('smash') && e.state !== 'chase', `守った ${g.over} ${[...seen]}`);
    else assert.strictEqual(g.over, 'caught');
  }
});

test('乗ったまま地上の道を出ない: 道の終わりの手前で降りる。撃つ弾は乗った高さから出る', () => {
  const g = Core.newGame({ seed: 9, noEnemies: true });
  Core.ensure(g.world, 8000 * 3);
  const b = g.world.b.filter((q) => q.ground && stageOf(q.x) === 2).pop();
  function stageOf(x) { return Core.stageOf(x); }
  g.p.x = b.x + b.w - 400; g.p.y = b.roofY; g.p.inside = -1; g.stage = 2;
  giveRide(g, 'board'); g.p.ride.t = 99;
  let offAt = null;
  for (let i = 0; i < 60 * 5 && offAt == null; i++) {
    Core.step(g, DT);
    if (g.events.some((e) => e.t === 'unride')) offAt = g.p.x;
    g.events.length = 0;
  }
  assert.ok(offAt != null && offAt < b.x + b.w - 100, `降りた x=${offAt} / 道の終わり ${b.x + b.w}`);
  const muzzle = (ride) => {
    const { g: h, b: sb } = streetGame(2);
    h.p.x = sb.x + 60; h.p.y = sb.roofY; h.p.inside = -1;
    if (ride) giveRide(h, 'toycar');
    Core.input(h, 'fire', true); Core.step(h, DT);
    return h.shots[0] ? h.shots[0].y - sb.roofY : null;
  };
  const y0 = muzzle(false), y1 = muzzle(true);
  assert.ok(y0 != null && y1 != null && y0 - y1 > 10, `銃口 ${y0} → ${y1}`);
});

// ------------------------------------------------------------ 2 だんジャンプ
function airGame() {
  const g = Core.newGame({ seed: 7, noEnemies: true });
  const b = g.world.b[0];
  b.roof.items.length = 0;
  g.p.x = 200; g.p.y = b.roofY;
  return { g, b };
}
function press(g) { Core.input(g, 'jump', true); Core.step(g, DT); }

test('2 だんジャンプ: 空中でもう一度おすと、もう一回だけ跳べる。着地するとまた使える', () => {
  const { g, b } = airGame();
  press(g);                                           // 1 だんめ
  Core.input(g, 'jump', false);
  for (let i = 0; i < 12; i++) Core.step(g, DT);      // 0.2 秒ほど上がる
  assert.ok(!g.p.onGround && !g.p.air2);
  const vBefore = g.p.vy;
  press(g);
  assert.ok(g.p.air2 && g.p.vy < vBefore - 100 && g.p.vy <= -Core.JUMP_V * 0.8, `2 だんめ vy=${g.p.vy}`);
  assert.ok(g.events.some((e) => e.t === 'jump2'));
  g.events.length = 0;
  for (let i = 0; i < 6; i++) Core.step(g, DT);
  const vy = g.p.vy;
  Core.input(g, 'jump', false); Core.input(g, 'jump', true); Core.step(g, DT);  // 3 だんめは無い
  assert.ok(g.p.vy > vy, `3 だんめは出ない (${vy} → ${g.p.vy})`);
  Core.input(g, 'jump', false);
  for (let i = 0; i < 200 && !g.p.onGround; i++) Core.step(g, DT);
  assert.ok(g.p.onGround && !g.p.air2, '着地でもどる');
  assert.strictEqual(g.p.y, b.roofY);
});

test('2 だんジャンプ: 1 だんより高く (合わせて) 上がる / しびれ中・着地すぐ前のおしでは出ない', () => {
  const peak = (second) => {
    const { g } = airGame();
    press(g);                                         // おしっぱなし (jumpHeld のまま)
    let top = g.p.y;
    for (let i = 0; i < 200 && !(g.p.onGround && i > 5); i++) {
      if (second && i === 14) { Core.input(g, 'jump', false); press(g); }
      Core.step(g, DT); top = Math.min(top, g.p.y);
    }
    return top;
  };
  const one = peak(false), two = peak(true);
  assert.ok(two < one - 40, `頂点 ${one.toFixed(0)} → ${two.toFixed(0)}`);
  // しびれ中は出ない
  const { g } = airGame();
  press(g); Core.input(g, 'jump', false);
  for (let i = 0; i < 12; i++) Core.step(g, DT);
  g.p.stun = 0.3; press(g);
  assert.ok(!g.p.air2, 'しびれ中は 2 だんめが出ない');
  // 着地の直前のおしは 2 だんめにせず、着地したらすぐ跳ぶ (先おし)
  const h = airGame().g;
  h.p.y = h.world.b[0].roofY - 20; h.p.vy = 600; h.p.onGround = false; h.p.ground = 0; h.p.airT = 0.5;
  press(h);
  assert.ok(!h.p.air2, '着地すぐ前は 2 だんめにしない');
  for (let i = 0; i < 12 && !h.events.some((e) => e.t === 'jump'); i++) Core.step(h, DT);
  assert.ok(h.events.some((e) => e.t === 'jump'), '先おしは着地でふつうのジャンプになる');
});

test('2 だんジャンプは、谷の保証を変えない: 自動プレイは今までどおり走りきる (使わない)', () => {
  const g = Core.newGame({ seed: 3, noEnemies: true });
  const st = makeBot();
  for (let i = 0; i < 60 * 40 && !g.over; i++) { botStep(g, st, DT); Core.step(g, DT); g.events.length = 0; }
  assert.strictEqual(g.over, null);
  assert.strictEqual(g.p.jumps2, 0);
});

// ------------------------------------------------------------ 宝石・きたえる
test('宝石: 4 種類がそろい、屋上・屋内・地上に出る。高い宝石 (2 だんジャンプの高さ) もある', () => {
  const kinds = {}, where = new Set(), ys = new Set();
  let total = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const w = Core.createWorld(seed);
    Core.ensure(w, Core.STAGE_PX * 6);
    for (const b of w.b) {
      for (const [name, L, base] of [['roof', b.roof, b.roofY], ['room', b.room, b.floorY]]) {
        for (const it of L.items) {
          if (it.t !== 'gem') continue;
          assert.ok(Core.GEMS[it.k], `知らない宝石 ${it.k}`);
          kinds[it.k] = (kinds[it.k] || 0) + 1; total++;
          where.add(b.ground ? 'ground' : name);
          ys.add(base - it.y);
        }
      }
    }
  }
  assert.deepStrictEqual(Object.keys(kinds).sort(), ['diamond', 'emerald', 'ruby', 'sapphire']);
  assert.ok(kinds.ruby > kinds.sapphire && kinds.sapphire > kinds.emerald && kinds.emerald > kinds.diamond, JSON.stringify(kinds));
  assert.deepStrictEqual([...where].sort(), ['ground', 'roof', 'room']);
  assert.ok(ys.has(Core.GEM_Y[1]) && ys.has(Core.GEM_Y[2]) && ys.has(Core.GEM_Y[0]), [...ys].join());
  // 6 ステージ (1200m) で、見ごたえのある数
  assert.ok(total / 20 > 40 && total / 20 < 120, `1 つの世界に ${total / 20} 個`);
});

test('宝石を取ると、ポイントが入る。高さしだいで、取れる跳びかたがちがう', () => {
  const { g, b } = airGame();
  b.roof.items.length = 0;
  b.roof.items.push({ x: g.p.x + 5, y: b.roofY - 26, t: 'gem', k: 'diamond' });
  Core.step(g, DT);
  assert.strictEqual(g.gems, 10);
  assert.ok(g.events.some((e) => e.t === 'gem' && e.k === 'diamond' && e.n === 10));
  // 空中で届く最高の高さ: 長おし 1 だん / 2 だん
  const apex = (second) => {
    const { g: h, b: hb } = airGame();
    hb.roof.items.length = 0;
    press(h);
    let top = 0;
    for (let i = 0; i < 160 && !(h.p.onGround && i > 5); i++) {
      if (second && i === 18) { Core.input(h, 'jump', false); press(h); }
      Core.step(h, DT); top = Math.max(top, hb.roofY - h.p.y);
    }
    return top;
  };
  const one = apex(false), two = apex(true);
  const need = (tier) => Core.GEM_Y[tier] - 24 - 30;           // 足もとをこの高さまで上げれば取れる
  assert.ok(one >= need(1) && one < need(2), `長おし 1 だんの最高 ${one.toFixed(0)} (1 段目の宝石 ${need(1)}・2 段目の宝石 ${need(2)})`);
  assert.ok(two >= need(2), `2 だんジャンプの最高 ${two.toFixed(0)}`);
});

test('きたえる: ジャンプは高く、水でっぽうは強く、タンクは水が へりにくくなる。上限がある', () => {
  const peak = (up) => {
    const g = Core.newGame({ seed: 7, noEnemies: true, up });
    const b = g.world.b[0];
    g.p.x = 200; g.p.y = b.roofY;
    press(g); Core.input(g, 'jump', true);
    let top = 0;
    for (let i = 0; i < 100; i++) { Core.step(g, DT); top = Math.max(top, b.roofY - g.p.y); }
    return top;
  };
  const p0 = peak({}), p5 = peak({ jump: 5 }), p10 = peak({ jump: 10 });
  assert.ok(p5 > p0 * 1.2 && p10 > p5 * 1.3, `頂点 ${p0.toFixed(0)} → ${p5.toFixed(0)} → ${p10.toFixed(0)}`);
  // 威力: 1 発で倒せなかった敵が、強化すると倒せる (スナイパーの dmg 5 は固定、ミズデッポウ dmg 1 の hp 3 の敵を何発で倒すか)
  const shots = (up) => {
    const g = Core.newGame({ seed: 2, noEnemies: true, up });
    const e = Core.spawnEnemy(g, 'suit', g.p.x - 100);
    let n = 0;
    while (e.state === 'chase' && n < 50) { Core.applyHit(g, e, { dmg: 1 }); n++; }
    return n;
  };
  assert.ok(shots({ power: 10 }) < shots({}), `${shots({})} 発 → ${shots({ power: 10 })} 発`);
  const used = (up) => {
    const g = Core.newGame({ seed: 2, noEnemies: true, up });
    g.water = 100; Core.input(g, 'fire', true);
    for (let i = 0; i < 60; i++) Core.step(g, DT);
    return 100 - g.water;
  };
  assert.ok(used({ tank: 10 }) < used({}) * 0.85, `水のへり ${used({}).toFixed(1)} → ${used({ tank: 10 }).toFixed(1)}`);
  const g = Core.newGame({ seed: 1, up: { jump: 99, power: -3, tank: 2.9 } });
  assert.deepStrictEqual(g.up, { jump: 10, power: 0, tank: 2 });
  assert.ok(Core.gemCost(0) < Core.gemCost(5) && Core.gemCost(9) <= 60);
});

test('きたえても谷の保証は変わらない: 強化を最大にしても自動プレイは走りきる', () => {
  const g = Core.newGame({ seed: 4, noEnemies: true, up: { jump: 10, power: 10, tank: 10 } });
  const st = makeBot();
  for (let i = 0; i < 60 * 60 && !g.over; i++) { botStep(g, st, DT); Core.step(g, DT); g.events.length = 0; }
  assert.strictEqual(g.over, null);
});

// ------------------------------------------------------------ ロープ (風船のわっか)
function hookScene(seed, dx) {
  const g = Core.newGame({ seed: seed, noEnemies: true });
  Core.ensure(g.world, 40000);
  const hb = g.world.b.find((q) => q.hooks.length && q.hooks[0].x < q.x && q.i > 2);   // 谷の上の風船
  const pv = g.world.b[hb.i - 1], h = hb.hooks[0];
  g.p.x = h.x - dx; g.p.y = pv.roofY; g.p.vy = 0; g.p.onGround = true; g.p.inside = -1;
  pv.roof.props.length = 0;            // 足もとに、もてる物があると、そっちがえらばれる
  return { g, hb, pv, h };
}

test('風船のわっか: 谷の上と長い屋上の上にあり、高さは近くの屋上のうち高いほうから HOOK_H。ぶらさがりの一番下でも足がつかない', () => {
  let gapH = 0, roofH = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const w = Core.createWorld(seed);
    Core.ensure(w, Core.STAGE_PX * 4);
    for (const b of w.b) {
      for (const h of b.hooks) {
        assert.ok(!b.ground, '地上の道には風船が無い');
        if (h.x < b.x) {
          gapH++;
          const pv = w.b[b.i - 1];
          assert.ok(h.x > pv.x + pv.w && b.x - (pv.x + pv.w) >= 70, '谷の上 (幅 70 以上)');
          assert.strictEqual(h.y, Math.min(pv.roofY, b.roofY) - Core.HOOK_H);
          // いちばん下の足もと = わっか + 長さ + 手までの高さ。両方の屋上より上
          assert.ok(h.y + Core.ROPE_MAX_L + Core.GRIP_H < Math.min(pv.roofY, b.roofY), '足がつく');
        } else {
          roofH++;
          assert.ok(h.x >= b.x && h.x <= b.x + b.w);
          assert.strictEqual(h.y, b.roofY - Core.HOOK_H);
        }
      }
    }
  }
  assert.ok(gapH > 40 && roofH > 20, `谷 ${gapH} / 屋上 ${roofH}`);
});

test('ロープ: ボタンをおしている間ぶらさがり、はなすと飛びだす (勢いは残る)。ちゃんと谷をわたれる', () => {
  const { g, hb } = hookScene(5, 100);
  const x0 = g.p.x;
  Core.input(g, 'grab', true);
  let attached = false, endWhy = null;
  for (let i = 0; i < 60 * 0.8; i++) { Core.step(g, DT); if (g.p.rope) attached = true; g.events.forEach((e) => { if (e.t === 'unrope') endWhy = e.why; }); g.events.length = 0; }
  assert.ok(attached && g.p.rope, 'つかまった');
  assert.ok(!g.p.onGround && g.p.vx > 200, `飛んでいる (vx ${g.p.vx.toFixed(0)})`);
  const vxBefore = g.p.vx;
  Core.input(g, 'grab', false);
  Core.step(g, DT);
  assert.ok(!g.p.rope, 'はなれた');
  const vxAfter = g.p.vx;
  assert.ok(vxAfter > vxBefore * 1.1, `はなすと勢いが増す (${vxBefore.toFixed(0)} → ${vxAfter.toFixed(0)})`);
  assert.ok(vxAfter > 150, `はなれても勢いが残る (${vxAfter.toFixed(0)})`);
  for (let i = 0; i < 60 * 3 && !g.over && !g.p.onGround; i++) Core.step(g, DT);
  assert.ok(!g.over && g.p.onGround && g.p.x > hb.x, `むこうの屋上に着いた (x ${Math.round(g.p.x)} / 屋上の左はし ${hb.x})`);
  const plain = Core.reach(Core.speedAt(x0), 0);
  assert.ok(g.p.x - x0 > plain * 1.4, `ふつうの全力ジャンプ (${Math.round(plain)}px) より 4 割は遠くへ (${Math.round(g.p.x - x0)}px)`);
  void endWhy;
});

test('ロープ: ぶらさがっている間、わっかからの距離は長さより遠くならない。屋上にめりこまない', () => {
  for (const dx of [40, 100, 160]) for (let seed = 1; seed <= 6; seed++) {
    const { g } = hookScene(seed, dx);
    Core.input(g, 'grab', true);
    let maxOver = 0, hadRope = false;
    for (let i = 0; i < 60 * 2 && !g.over; i++) {
      Core.step(g, DT);
      if (g.p.rope) {
        hadRope = true;
        const d = Math.hypot(g.p.x - g.p.rope.ax, (g.p.y - Core.GRIP_H) - g.p.rope.ay);
        maxOver = Math.max(maxOver, d - g.p.rope.L);
        const b = Core.buildingAt(g.world, g.p.x);
        if (b) assert.ok(g.p.y <= b.roofY + 1, `屋上にめりこんだ (seed ${seed} dx ${dx})`);
      }
      g.events.length = 0;
    }
    assert.ok(hadRope, 'つかまれなかった');
    assert.ok(maxOver < 0.5, `ロープがのびた ${maxOver.toFixed(2)}`);
  }
});

test('ロープ: ジャンプをおすと、上へ飛んではなれる。つかまれない時 (かかえている・屋内・遠い・しびれ) はつかまらない', () => {
  const { g } = hookScene(3, 90);
  Core.input(g, 'grab', true);
  for (let i = 0; i < 30; i++) Core.step(g, DT);
  assert.ok(g.p.rope);
  Core.input(g, 'jump', true); Core.step(g, DT);
  assert.ok(!g.p.rope && g.p.vy <= -400, `ジャンプではなれて、上へ (vy ${g.p.vy.toFixed(0)})`);
  assert.ok(!g.p.air2, 'はなれたあとに、2 だんジャンプが使える');
  // つかまれない
  const tries = {
    かかえている: (s) => { s.g.p.carry = 'crate'; },
    しびれ: (s) => { s.g.p.stun = 0.5; },
    屋内: (s) => { s.g.p.inside = 0; },
    遠い: (s) => { s.g.p.x -= 400; }
  };
  for (const k of Object.keys(tries)) {
    const s = hookScene(3, 90);
    tries[k](s);
    Core.input(s.g, 'grab', true);
    for (let i = 0; i < 10; i++) Core.step(s.g, DT);
    assert.ok(!s.g.p.rope, `${k}ときは、つかまらない`);
  }
  // ちかくに風船が無ければ、いままでどおり (もつ)
  const e = Core.newGame({ seed: 2, noEnemies: true });
  Core.input(e, 'grab', true); for (let i = 0; i < 10; i++) Core.step(e, DT);
  assert.ok(!e.p.rope);
});

// 2 だんジャンプ (Lv0・いちばん高く跳ぶ押し方) で、足が屋上からどこまで上がるか
function bestJumpApex(jumpLv) {
  const g = Core.newGame({ seed: 1, noEnemies: true, up: { jump: jumpLv || 0 } });
  Core.ensure(g.world, 4000);
  const b = g.world.b.find((q) => q.w > 600 && !q.ground && q.i > 0);
  b.roof.props.length = 0;
  g.p.x = b.x + 40; g.p.y = b.roofY; g.p.vy = 0; g.p.onGround = true; g.p.inside = -1;
  Core.input(g, 'jump', true);
  let top = 0, second = false;
  for (let i = 0; i < 60 * 2; i++) {
    Core.step(g, DT);
    if (!second && g.p.vy >= 0) { Core.input(g, 'jump', false); Core.step(g, DT); Core.input(g, 'jump', true); second = true; }
    top = Math.max(top, b.roofY - g.p.y);
    if (second && g.p.onGround) break;
  }
  return top;
}

test('ロープ: 風船のふりの円の上に、ロープでしか取れない宝石がある (Lv0 の 2 だんジャンプでは届かない)', () => {
  const apex = bestJumpApex(0);
  assert.ok(apex > 200 && apex < 300, `2 だんジャンプの高さ ${apex.toFixed(0)}`);
  let sets = 0, gems = 0, minMargin = 1e9;
  for (let seed = 1; seed <= 30; seed++) {
    const w = Core.createWorld(seed);
    Core.ensure(w, Core.STAGE_PX * 3);
    for (const b of w.b) for (const it of b.roof.items) {
      if (!it.rope) continue;
      gems++;
      assert.strictEqual(it.t, 'gem');
      const h = w.b.flatMap((q) => q.hooks).find((q) => q.gems && Math.abs(Math.hypot(it.x - q.x, it.y - 20 - q.y) - Core.ROPE_MAX_L) < 2);
      assert.ok(h, 'ふりの円の上にある');
      // 取れるのは 足 - 24 が宝石から 30 以内 → 足が (宝石 + 54) より上
      const need = (h.y + Core.HOOK_H) - (it.y + 54);   // 高いほうの屋上から
      minMargin = Math.min(minMargin, need - apex);
      assert.ok(it.x > b.x && it.x < b.x + b.w, 'そのビルの屋上の上');
      assert.ok(!b.decks.some((d) => it.x > d.x0 - 60 && it.x < d.x1 + 60), '2 かいの上には無い');
    }
    for (const b of w.b) for (const h of b.hooks) if (h.gems) sets++;
  }
  assert.ok(sets >= 20 && gems === sets * Core.ROPE_GEM_DEG.length, `風船 ${sets} / 宝石 ${gems}`);
  assert.ok(minMargin > 0, `2 だんジャンプで届いてしまう (あと ${minMargin.toFixed(0)}px)`);
});

test('ロープ: ぶらさがっておしっぱなしにすると、ふりの宝石が取れる。ある角度で自動ではなれる', () => {
  let took = 0, all = 0, auto = 0, n = 0;
  for (let seed = 1; seed <= 40 && n < 12; seed++) {
    const g = Core.newGame({ seed: seed, noEnemies: true });
    Core.ensure(g.world, 40000);
    const hb = g.world.b.find((q) => q.i > 2 && q.hooks.some((h) => h.gems && h.x < q.x));
    if (!hb) continue;
    const h = hb.hooks.find((q) => q.gems && q.x < hb.x), pv = g.world.b[hb.i - 1];
    pv.roof.props.length = 0;
    g.p.x = h.x - 100; g.p.y = pv.roofY; g.p.vy = 0; g.p.onGround = true; g.p.inside = -1;
    const before = hb.roof.items.filter((it) => it.rope).length;
    Core.input(g, 'grab', true);
    for (let i = 0; i < 60 * 6 && !g.over && !g.p.onGround || i < 5; i++) {
      Core.step(g, DT);
      g.events.forEach((e) => { if (e.t === 'unrope' && e.why === 'auto') auto++; });
      g.events.length = 0;
    }
    took += before - hb.roof.items.filter((it) => it.rope).length; all += before; n++;
  }
  assert.ok(n >= 8, `ためした風船 ${n}`);
  assert.ok(took >= all * 0.8, `ふりで取れた宝石 ${took} / ${all}`);
  assert.ok(auto >= n * 0.8, `自動ではなれた ${auto} / ${n}`);
});

test('ロープ: はなすと勢いよく飛びだし (ふつうのジャンプより速い)、着地してからもしばらく速く走る (ROPE_DASH)', () => {
  const { g } = hookScene(5, 100);
  const run = Core.speedAt(g.p.x);
  Core.input(g, 'grab', true);
  let maxVx = 0;
  for (let i = 0; i < 60 * 6 && !g.over; i++) {
    Core.step(g, DT);
    maxVx = Math.max(maxVx, g.p.vx);
    if (!g.p.rope && i > 5) break;
  }
  assert.ok(maxVx > run * 1.5, `ふりの速さ ${maxVx.toFixed(0)} / 走り ${run.toFixed(0)}`);
  assert.ok(g.p.dash > 0, 'はなすとダッシュが付く');
  for (let i = 0; i < 60 * 3 && !g.over && !g.p.onGround; i++) Core.step(g, DT);
  assert.ok(g.p.onGround && !g.over, '着地した');
  Core.step(g, DT);
  assert.ok(g.p.vx > Core.speedAt(g.p.x) * 1.15, `着地のあとも速い (${g.p.vx.toFixed(0)} / ${Core.speedAt(g.p.x).toFixed(0)})`);
  // 走りつづけて谷に落ちないよう、着いた屋上を長くのばしてから測る
  const lb = Core.buildingAt(g.world, g.p.x); lb.w += 3000;
  for (let i = 0; i < 60 * 2; i++) Core.step(g, DT);
  assert.ok(!g.over && g.p.onGround);
  assert.strictEqual(g.p.dash, 0, 'しばらくするとダッシュは終わる');
  assert.ok(Math.abs(g.p.vx - Core.speedAt(g.p.x)) < 1, 'もとの速さ');
  // ジャンプだけでは付かない
  const j = Core.newGame({ seed: 5, noEnemies: true });
  Core.input(j, 'jump', true); for (let i = 0; i < 20; i++) Core.step(j, DT);
  assert.ok(!j.p.dash, 'ふつうのジャンプにダッシュは無い');
});

// ------------------------------------------------------------ 1 つのアクションボタン (入る・もつ・なげる・ロープ)
test('アクションボタン: 近くにある物で、入る → なげる → もつ → ロープ の順に決まる。何も無ければ何もしない', () => {
  const sc = () => { const s = hookScene(5, 110); s.g.p.carry = null; return s; };
  // ロープ
  let s = sc();
  assert.strictEqual(Core.hints(s.g).act, 'rope');
  Core.input(s.g, 'act', true); Core.step(s.g, DT);
  assert.ok(s.g.p.rope && Core.hints(s.g).act === 'roping', 'おすとぶらさがる');
  Core.input(s.g, 'act', false); Core.step(s.g, DT);
  assert.ok(!s.g.p.rope, 'はなすとはなれる');
  // もつ (ロープよりもてる物が先) → なげる
  s = sc();
  s.pv.roof.props.push({ x: s.g.p.x + 5, t: 'crate' });
  assert.strictEqual(Core.hints(s.g).act, 'grab');
  Core.input(s.g, 'act', true); Core.step(s.g, DT); Core.input(s.g, 'act', false);
  assert.ok(s.g.p.carry && !s.g.p.rope, 'もった (ロープではなく)');
  assert.strictEqual(Core.hints(s.g).act, 'carry');
  Core.input(s.g, 'act', true); Core.step(s.g, DT); Core.input(s.g, 'act', false);
  assert.ok(!s.g.p.carry && s.g.thrown.length === 1, 'なげた');
  // 入る (ドアが先)
  const g = Core.newGame({ seed: 5, noEnemies: true });
  Core.ensure(g.world, 20000);
  const b = g.world.b.find((q) => q.door && q.i > 2);
  g.p.x = b.doorX; g.p.y = b.roofY; g.p.vy = 0; g.p.onGround = true; g.p.inside = -1;
  b.roof.props.push({ x: b.doorX + 2, t: 'crate' });
  assert.strictEqual(Core.hints(g).act, 'door');
  Core.input(g, 'act', true); Core.step(g, DT); Core.input(g, 'act', false);
  assert.strictEqual(g.p.inside, b.i, 'ドアに入った');
  // 何も無い
  const e = Core.newGame({ seed: 2, noEnemies: true });
  assert.strictEqual(Core.hints(e).act, null);
  Core.input(e, 'act', true); for (let i = 0; i < 20; i++) Core.step(e, DT);
  assert.ok(!e.p.rope && !e.p.carry && e.p.inside === -1);
});

// ------------------------------------------------------------ 屋上の 2 かい (給水タンク・看板)
function decksOf(seed, px) {
  const w = Core.createWorld(seed);
  Core.ensure(w, px || Core.STAGE_PX * 5);
  return w;
}

test('2 かい: 屋上にだけあり、高さは DECK_H。左はしから 100px・右はしから DECK_END あけ、ドアと重ならない。2 つあれば 120px はなれる', () => {
  let n = 0; const kinds = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const w = decksOf(seed);
    for (const b of w.b) {
      if (b.ground) { assert.strictEqual(b.decks.length, 0, '地上の道には無い'); continue; }
      for (const d of b.decks) {
        n++; kinds.add(d.k);
        assert.strictEqual(d.y, b.roofY - Core.DECK_H);
        assert.ok(d.x0 >= b.x + 100 && d.x1 <= b.x + b.w - Core.DECK_END, `はみだし seed ${seed}`);
        assert.ok(d.x1 - d.x0 >= 150 && d.x1 - d.x0 <= 260);
        if (b.door) assert.ok(d.x1 <= b.doorX - 70 || d.x0 >= b.doorX + 70, 'ドアに重なる');
      }
      const ds = b.decks.slice().sort((a, c) => a.x0 - c.x0);
      for (let k = 1; k < ds.length; k++) assert.ok(ds[k].x0 - ds[k - 1].x1 >= 120, '2 かいどうしが近い');
    }
  }
  assert.ok(n > 150 && kinds.has('tank') && kinds.has('sign'), `2 かいの数 ${n} / ${[...kinds]}`);
});

function deckScene(seed) {
  const g = Core.newGame({ seed: seed, noEnemies: true });
  Core.ensure(g.world, 30000);
  const b = g.world.b.find((q) => q.i > 2 && q.decks.length);
  const d = b.decks[0];
  return { g, b, d };
}

test('2 かい: 長おしジャンプで上に乗れる。下からは通りぬける。乗っている間は onDeck', () => {
  let landed = 0, through = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const { g, b, d } = deckScene(seed);
    b.roof.props.length = 0;
    g.p.x = d.x0 - 60; g.p.y = b.roofY; g.p.vy = 0; g.p.onGround = true;
    Core.input(g, 'jump', true);
    let top = false, minY = 1e9;
    for (let i = 0; i < 60; i++) { Core.step(g, DT); minY = Math.min(minY, g.p.y); if (g.p.onDeck) top = true; if (g.p.y < d.y + 30 && g.p.y > d.y - 5 && g.p.vy < 0) through++; }
    Core.input(g, 'jump', false);
    if (top) landed++;
  }
  assert.ok(landed >= 18, `長おしジャンプで乗れた ${landed}/20`);
  assert.ok(through > 0, '下から上がるとき、2 かいの高さを通りぬけている (頭をぶつけない)');
});

test('2 かい: はしから走って落ちると、同じビルの屋上に着く (谷には落ちない)。どの 2 かいでも', () => {
  let tried = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const g = Core.newGame({ seed: seed, noEnemies: true });
    Core.ensure(g.world, Core.STAGE_PX * 4);
    for (const b of g.world.b) for (const d of b.decks) {
      if (b.x > Core.STAGE_PX * 3.5) continue;
      const h = Core.newGame({ seed: seed, noEnemies: true });
      Core.ensure(h.world, Core.STAGE_PX * 4);
      const hb = h.world.b[b.i];
      h.p.x = d.x1 - 20; h.p.y = d.y; h.p.vy = 0; h.p.onGround = true;
      let land = null;
      for (let i = 0; i < 120 && !h.over; i++) {
        Core.step(h, DT);
        if (h.p.onGround && !h.p.onDeck && h.p.x > d.x1) { land = h.p.x; break; }
      }
      tried++;
      assert.ok(land != null && land < hb.x + hb.w - 20 && h.p.y === hb.roofY, `seed ${seed}: 2 かいから落ちて屋上に着かない (着いた x ${land} / 屋上の右はし ${hb.x + hb.w})`);
    }
  }
  assert.ok(tried > 100, `ためした 2 かい ${tried}`);
});

test('2 かい: 敵は 2 かいに乗らない (屋上を走る)。2 かいの上の主人公はつかまらない', () => {
  const { g, b, d } = deckScene(4);
  const h = Core.newGame({ seed: 4 });
  Core.ensure(h.world, 30000);
  h.enemies.length = 0; h.spawnT = 999;
  h.p.x = d.x0 + 20; h.p.y = d.y; h.p.vy = 0; h.p.onGround = true;
  const e = Core.spawnEnemy(h, 'suit', h.p.x - 4);
  e.y = b.roofY; e.onGround = true;
  for (let i = 0; i < 20; i++) Core.step(h, DT);
  assert.ok(!h.over && e.y === b.roofY, `つかまらない (${h.over}) / 敵は屋上 (${e.y} = ${b.roofY})`);
  void g;
});
