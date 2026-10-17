/*!
 * core.js — ロジック。DOM を触らないので node でテストできる。
 *
 * スパイ・コン: 屋上を走って逃げるゲームの中身。
 * 世界は x が右へ、y が下へ。足もとの位置を (x, y) で持つ。
 * 世界は「ビルの並び」。ビルとビルの間は谷で、跳んで渡る。
 * ビルの屋上のドアから、ビルの中(1 階ぶんの廊下)へ入れる。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ------------------------------------------------------------ 定数
  const G = 2400;            // 重力
  const JUMP_V = 800;        // ジャンプの初速 (押しっぱなしで高さ約133)
  const CUT_V = 420;         // ボタンを離したときの上向き速度の上限 (ちょんで約37)
  const MAX_FALL = 1500;
  const THROW_G = 1700;      // 投げた物の重力
  const KILL_Y = 700;        // これより下に落ちたら谷底
  const FLOOR_OFF = 128;     // 屋上から屋内の床までの深さ
  const PLAYER_HW = 9;
  const PLAYER_H = 46;

  // ------------------------------------------------------------ 乱数
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(array, rng) {
    const random = rng || Math.random;
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const t = array[i]; array[i] = array[j]; array[j] = t;
    }
    return array;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /** 走る速さ。進むほど少しずつ速くなる (200 → 260)。 */
  function speedAt(x) { return 200 + Math.min(60, Math.max(0, x) / 150); }
  function metersOf(x) { return Math.max(0, Math.floor(x / 40)); }
  /** 200m ごとに 1 ステージ。終わりは無い。 */
  const STAGE_LEN_M = 200;
  function stageOf(x) { return 1 + Math.floor(metersOf(x) / STAGE_LEN_M); }
  const STAGE_PX = STAGE_LEN_M * 40;
  /** 4 ステージに 1 回 (2, 6, 10, ...) は地上の追いかけっこ: 谷の無い、ひと続きの道。 */
  function isGroundStage(stage) { return stage % 4 === 2; }
  function stageClearBonus(stage) { return 10 + 5 * Math.min(stage, 20); }   // 抜けたステージの番号 (1 から)

  // ------------------------------------------------------------ 水でっぽう
  // cd: 連射の間隔(秒) / cost: 水の消費 / n: 一度に出る粒 / speed: 自分から見た速さ / range: 届く距離
  // dmg: ダメージ / push: 押し戻し(px) / wet: ぬれ(遅くなる秒数) / r: 当たりの半径
  // pierce: 突き抜ける数 / splash: 当たった所の爆ぜる半径 / grav: 落ちる強さ / homing: 追尾の強さ
  // freeze: こおる秒数 / stun: しびれる秒数 / trap: あわで閉じ込める秒数 / coin: 当たるとコイン
  const GUNS = [
    { id: 'mizu', name: 'ミズデッポウ', icon: '🔫', color: '#4cc9f0', price: 0,
      desc: 'ふつうの水でっぽう。つかいやすい。',
      cd: 0.22, cost: 2, n: 1, spread: 0.03, speed: 640, range: 240, dmg: 1, push: 12, wet: 0.5, r: 5 },
    { id: 'twin', name: 'ツインスプラッシュ', icon: '💦', color: '#5fd0ff', price: 90,
      desc: '2本ならんで出る。当たりやすい。',
      cd: 0.26, cost: 3.4, n: 2, spread: 0.02, offset: 7, speed: 640, range: 240, dmg: 1, push: 12, wet: 0.5, r: 5 },
    { id: 'shot', name: 'ショットガン', icon: '🎯', color: '#ffb347', price: 160,
      desc: 'ちかくでドーン! 5つぶ散らして、大きくふき飛ばす。',
      cd: 0.65, cost: 7.5, n: 5, spread: 0.3, speed: 560, range: 160, dmg: 1, push: 26, wet: 0.6, r: 6 },
    { id: 'gatling', name: 'マシンガン', icon: '⚡', color: '#7bdff2', price: 240,
      desc: 'ものすごい連射。ちょっとずつ削る。',
      cd: 0.07, cost: 0.65, n: 1, spread: 0.09, speed: 700, range: 250, dmg: 0.45, push: 5, wet: 0.2, r: 4 },
    { id: 'sniper', name: 'スナイパー', icon: '🔭', color: '#c77dff', price: 320,
      desc: '遠くまで届く強い一発。3人まで貫通。',
      cd: 0.95, cost: 8, n: 1, spread: 0, speed: 1300, range: 520, dmg: 5, push: 40, wet: 1, pierce: 2, r: 5 },
    { id: 'cutter', name: 'ウォーターカッター', icon: '📏', color: '#e0fbfc', price: 420,
      desc: '細くてするどい水。ならんだ敵を全部つらぬく。',
      cd: 0.05, cost: 0.8, n: 1, spread: 0.01, speed: 1500, range: 360, dmg: 0.55, push: 2, wet: 0.2, pierce: 99, r: 3 },
    { id: 'hose', name: 'ホース', icon: '🚒', color: '#3a86ff', price: 520,
      desc: 'ざあざあ放水。敵をぐいぐい押し戻す。',
      cd: 0.04, cost: 0.8, n: 1, spread: 0.12, speed: 520, range: 220, dmg: 0.22, push: 20, wet: 0.15, r: 11 },
    { id: 'homing', name: 'ホーミングガン', icon: '🌀', color: '#80ffdb', price: 660,
      desc: '敵をおいかけて曲がる。ねらわなくていい。',
      cd: 0.38, cost: 3.5, n: 1, spread: 0.3, speed: 520, range: 430, dmg: 1.3, push: 14, wet: 0.6, homing: 7, r: 6 },
    { id: 'bazooka', name: 'みずふうせんバズーカ', icon: '🎈', color: '#ff6b9d', price: 820,
      desc: '水風船がはじけて、まわりをまとめてびしょぬれ。',
      cd: 1.1, cost: 12, n: 1, spread: 0.02, speed: 520, range: 300, dmg: 3, push: 50, wet: 1.5, splash: 62, grav: 900, r: 8 },
    { id: 'ice', name: 'コオリみずガン', icon: '❄️', color: '#a8dadc', price: 980,
      desc: 'つめたい水で敵がカチコチ。うごきがかなり遅くなる。',
      cd: 0.3, cost: 3.5, n: 1, spread: 0.04, speed: 620, range: 240, dmg: 0.5, push: 6, wet: 0.5, freeze: 1.8, r: 6 },
    { id: 'bubble', name: 'あわあわガン', icon: '🫧', color: '#bde0fe', price: 1150,
      desc: 'ふわふわの泡で敵をとじこめる。',
      cd: 0.55, cost: 5, n: 1, spread: 0.06, speed: 210, range: 380, dmg: 0.3, push: 0, wet: 0.4, trap: 1.4, r: 15 },
    { id: 'shock', name: 'ビリビリみずガン', icon: '🔌', color: '#ffe66d', price: 1300,
      desc: 'しびれる水。まわりの敵もまとめて動けなくする。',
      cd: 0.45, cost: 5, n: 1, spread: 0.03, speed: 640, range: 240, dmg: 0.5, push: 4, wet: 0.4, stun: 0.9, splash: 40, r: 6 },
    { id: 'rainbow', name: 'にじいろガン', icon: '🌈', color: '#ff99c8', price: 1600,
      desc: '当たるとコインがこぼれる。ぜんぶ入りの最強水でっぽう。',
      cd: 0.12, cost: 2, n: 1, spread: 0.05, speed: 700, range: 280, dmg: 1, push: 14, wet: 0.6, coin: 1, r: 6 }
  ];
  const GUN_BY_ID = {};
  GUNS.forEach((gun) => { GUN_BY_ID[gun.id] = gun; });

  // ------------------------------------------------------------ 投げる物
  const PROPS = {
    crate:  { name: '木箱',     dmg: 3,   push: 50, stun: 0.9 },
    barrel: { name: 'たる',     dmg: 3,   push: 30, stun: 0.5, roll: true },
    pot:    { name: '植木鉢',   dmg: 2,   push: 30, stun: 0.6 },
    bucket: { name: 'バケツ',   dmg: 1,   push: 20, stun: 0, splash: 56, wet: 2.5, puddle: true },
    tire:   { name: 'タイヤ',   dmg: 2,   push: 25, stun: 0.3, roll: true },
    duck:   { name: 'アヒル',   dmg: 0.5, push: 10, stun: 1.5 }
  };
  const PROP_KEYS = Object.keys(PROPS);

  // w >= 50 の物 (車) は、ちょん跳びでは越えられず、押しつづけた高いジャンプが要る
  const OBSTACLES = {
    cone:    { w: 16, h: 22 },
    box:     { w: 28, h: 30 },
    vent:    { w: 34, h: 20 },
    bin:     { w: 22, h: 28 },
    hydrant: { w: 16, h: 26 },
    bench:   { w: 40, h: 20 },
    car:     { w: 64, h: 34 }
  };
  const OBS_KEYS = Object.keys(OBSTACLES);
  const ROOF_OBS = ['cone', 'box', 'vent'];
  const GROUND_OBS = ['cone', 'box', 'bin', 'hydrant', 'bench', 'car', 'car'];

  // ------------------------------------------------------------ 敵
  const ENEMIES = {
    suit:  { name: 'くろねこ',     w: 20, h: 50, hp: 3, k: 1.03, coin: 3, resist: 0 },
    dog:   { name: 'ジャックラッセル',   w: 34, h: 22, hp: 1, k: 1.12, coin: 2, resist: 0 },
    big:   { name: 'ヒグマ', w: 32, h: 60, hp: 9, k: 1.0, coin: 8, resist: 0.75 },
    drone: { name: 'コウモリ', w: 30, h: 20, hp: 2, k: 1.07, coin: 4, resist: 0.3, fly: true }
  };

  // ------------------------------------------------------------ 世界 (ビルの並び)
  /** 跳んで届く横の距離。dy は着地先の低さ (下が正)。押しっぱなしの全力ジャンプ。 */
  function reach(speed, dy) {
    const d = JUMP_V * JUMP_V + 2 * G * dy;
    if (d < 0) return 0;
    return speed * (JUMP_V + Math.sqrt(d)) / G;
  }

  function createWorld(seed) {
    return { seed: seed >>> 0, rng: mulberry32((seed >>> 0) ^ 0x51ed270b), b: [] };
  }

  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }

  function genBuilding(world) {
    const r = world.rng;
    const bs = world.b;
    const i = bs.length;
    const b = { i: i, x: 0, w: 0, roofY: 0, floorY: 0, door: false, doorX: 0, exitX: 0, ground: false, style: Math.floor(r() * 5) };
    // 地上ステージの道は、ステージの終わりまで谷なしでつづく (1 区画 900〜1400、残りが少なければ残りぜんぶ)
    const streetWidth = (x) => {
      const remain = stageOf(x) * STAGE_PX - x;
      return remain <= 1500 ? remain : Math.round(900 + r() * 500);
    };
    if (i === 0) {
      b.x = -320; b.w = 940; b.roofY = 0;
    } else {
      const pv = bs[i - 1];
      const end = pv.x + pv.w;
      if (pv.ground && isGroundStage(stageOf(end))) {
        // 道のつづき: 谷なし・同じ高さ
        b.ground = true; b.x = end; b.roofY = pv.roofY; b.w = streetWidth(end);
      } else {
        const sp = speedAt(end);
        let d = Math.round((r() * 2 - 1) * 8) * 10;
        let ry = pv.roofY + d;
        if (ry < -260 || ry > 200) { d = -d; ry = pv.roofY + d; }
        if (ry < -260 || ry > 200) { d = 0; ry = pv.roofY; }
        let gMax = Math.min(120, reach(sp, d) - 38);
        if (gMax < 50) { d = 0; ry = pv.roofY; gMax = Math.min(120, reach(sp, 0) - 38); }
        const gap = Math.round(50 + r() * (gMax - 50));
        b.x = end + gap;
        b.roofY = ry;
        if (isGroundStage(stageOf(b.x)) && stageOf(b.x) * STAGE_PX - b.x >= 300) {
          b.ground = true; b.w = streetWidth(b.x);      // 地上ステージの入り口 (谷を跳んで道へ)
        } else {
          b.w = Math.round(200 + r() * 360);
          if (i === 2) b.w = 480;
          if (b.w >= 420 && (r() < 0.75 || i === 2)) b.door = true;
        }
      }
    }
    b.floorY = b.roofY + FLOOR_OFF;
    if (b.door) {
      b.doorX = Math.round(b.x + 50 + r() * 40);
      b.exitX = b.x + b.w - 120;
    }
    populate(world, b, bs[i - 1] || null, r);
    bs.push(b);
    return b;
  }

  /** 地上の道の中身: じゃま物 (車・ゴミ箱・消火栓・ベンチ・コーン・箱) が 190〜330px おきにならぶ。 */
  function populateGround(world, b, prev, r) {
    b.roof = { items: [], props: [], obs: [] };
    b.room = { items: [], props: [], obs: [] };
    const far = (x, arr, d) => arr.every((o) => Math.abs(o.x - x) >= d);
    const entering = !prev || !prev.ground || b.x > prev.x + prev.w;
    const sEnd = stageOf(b.x) * STAGE_PX;
    const lastSeg = b.x + b.w >= sEnd - 1;
    let lo = entering ? b.x + 95 : b.x + 20;
    if (!entering && world.lastGroundObsX != null) lo = Math.max(lo, world.lastGroundObsX + 190);
    const hi = lastSeg ? b.x + b.w - 150 : b.x + b.w - 20;
    let x = lo + r() * 60;
    while (x <= hi) {
      const t = pick(r, GROUND_OBS);
      b.roof.obs.push({ x: Math.round(x), t: t });
      world.lastGroundObsX = Math.round(x);
      x += 190 + r() * 140;
    }
    // 投げられる物
    const nProps = Math.floor(b.w / 330);
    for (let k = 0; k < nProps; k++) {
      for (let tries = 0; tries < 8; tries++) {
        const px = Math.round(b.x + 50 + r() * Math.max(10, b.w - 120));
        if (!far(px, b.roof.obs, 50) || !far(px, b.roof.props, 60)) continue;
        b.roof.props.push({ x: px, t: pick(r, PROP_KEYS) });
        break;
      }
    }
    // 特別なアイテム (600px につき半分の確率)
    for (let k = 0; k < Math.floor(b.w / 600); k++) {
      if (r() < 0.55) {
        for (let tries = 0; tries < 8; tries++) {
          const px = Math.round(b.x + 60 + r() * Math.max(10, b.w - 140));
          if (!far(px, b.roof.obs, 45) || !far(px, b.roof.props, 30) || !far(px, b.roof.items, 30)) continue;
          b.roof.items.push({ x: px, y: b.roofY - 24, t: pickSpecial(r) });
          break;
        }
      }
    }
    // コインの列 (じゃま物の上は高く = 跳べという合図)
    const nLines = Math.max(1, Math.floor(b.w / 260));
    for (let k = 0; k < nLines; k++) {
      if (r() < 0.65) {
        const n = 4 + Math.floor(r() * 3);
        const x0 = b.x + 40 + r() * Math.max(10, b.w - 80 - n * 30);
        for (let q = 0; q < n; q++) {
          const cx = Math.round(x0 + q * 30);
          if (cx > b.x + b.w - 20) break;
          const over = b.roof.obs.some((o) => Math.abs(o.x - cx) < 40);
          if (b.roof.items.some((it) => Math.abs(it.x - cx) < 22)) continue;
          b.roof.items.push({ x: cx, y: b.roofY - (over ? 70 : 26), t: 'coin' });
        }
      }
    }
    // 手前の谷にかかるコインの弧 (入り口だけ)
    if (prev && entering) {
      const end = prev.x + prev.w;
      for (let k = 0; k < 5; k++) {
        const u = k / 4;
        const cx = Math.round(end - 14 + u * (b.x - end + 28));
        const base = prev.roofY + (b.roofY - prev.roofY) * u;
        b.roof.items.push({ x: cx, y: Math.round(base - 34 - 70 * Math.sin(Math.PI * u)), t: 'coin' });
      }
    }
  }

  function populate(world, b, prev, r) {
    if (b.ground) { populateGround(world, b, prev, r); return; }
    const i = b.i;
    b.roof = { items: [], props: [], obs: [] };
    b.room = { items: [], props: [], obs: [] };
    const far = (x, arr, d) => arr.every((o) => Math.abs(o.x - x) >= d);

    // --- 屋上: じゃま物 (とびこえる)
    let lo = b.x + 95;
    const hi = b.x + b.w - 150;
    if (i === 0) lo = 300;
    const nObs = i === 0 ? 1 : Math.floor(r() * 3);
    for (let k = 0; k < nObs && hi > lo + 10; k++) {
      for (let tries = 0; tries < 8; tries++) {
        const x = Math.round(lo + r() * (hi - lo));
        if (!far(x, b.roof.obs, 170)) continue;
        if (b.door && Math.abs(x - b.doorX) < 80) continue;
        b.roof.obs.push({ x: x, t: pick(r, ROOF_OBS) });
        break;
      }
    }
    // --- 屋上: 投げられる物
    if (i === 0) {
      b.roof.props.push({ x: 150, t: 'crate' });
      b.roof.props.push({ x: 460, t: 'bucket' });
    } else if (r() < 0.55) {
      for (let tries = 0; tries < 8; tries++) {
        const x = Math.round(b.x + 50 + r() * Math.max(10, b.w - 140));
        if (!far(x, b.roof.obs, 45) || !far(x, b.roof.props, 40)) continue;
        if (b.door && Math.abs(x - b.doorX) < 45) continue;
        b.roof.props.push({ x: x, t: pick(r, PROP_KEYS) });
        break;
      }
    }
    // --- 屋上: 特別なアイテム
    if (i > 0 && r() < 0.3) {
      for (let tries = 0; tries < 8; tries++) {
        const x = Math.round(b.x + 60 + r() * Math.max(10, b.w - 170));
        if (!far(x, b.roof.obs, 40) || !far(x, b.roof.props, 30)) continue;
        if (b.door && Math.abs(x - b.doorX) < 40) continue;
        b.roof.items.push({ x: x, y: b.roofY - 24, t: pickSpecial(r) });
        break;
      }
    }
    // --- 屋上: コインの列。じゃま物の上は高く (跳べという合図)
    if (i > 0 && r() < 0.55) {
      const n = 4 + Math.floor(r() * 3);
      const x0 = b.x + 60 + r() * Math.max(10, b.w - 260);
      for (let k = 0; k < n; k++) {
        const x = Math.round(x0 + k * 30);
        if (x > b.x + b.w - 30) break;
        const over = b.roof.obs.some((o) => Math.abs(o.x - x) < 36);
        b.roof.items.push({ x: x, y: b.roofY - (over ? 66 : 26), t: 'coin' });
      }
    }
    // --- 手前の谷にかかるコインの弧
    if (prev) {
      const end = prev.x + prev.w;
      const n = 5;
      for (let k = 0; k < n; k++) {
        const u = k / (n - 1);
        const x = Math.round(end - 14 + u * (b.x - end + 28));
        const base = prev.roofY + (b.roofY - prev.roofY) * u;
        b.roof.items.push({ x: x, y: Math.round(base - 34 - 70 * Math.sin(Math.PI * u)), t: 'coin' });
      }
    }

    // --- ビルの中
    if (b.door) {
      const a = b.doorX + 110;
      const z = b.exitX - 90;
      const nIn = Math.floor(r() * 3);
      for (let k = 0; k < nIn && z > a + 10; k++) {
        for (let tries = 0; tries < 8; tries++) {
          const x = Math.round(a + r() * (z - a));
          if (!far(x, b.room.obs, 170)) continue;
          b.room.obs.push({ x: x, t: pick(r, ROOF_OBS) });
          break;
        }
      }
      if (r() < 0.6) {
        const x = Math.round(b.doorX + 60 + r() * (b.exitX - b.doorX - 100));
        if (far(x, b.room.obs, 45)) b.room.props.push({ x: x, t: pick(r, PROP_KEYS) });
      }
      const n = 4 + Math.floor(r() * 5);
      const x0 = b.doorX + 50 + r() * 20;
      for (let k = 0; k < n; k++) {
        const x = Math.round(x0 + k * 30);
        if (x > b.exitX - 20) break;
        const over = b.room.obs.some((o) => Math.abs(o.x - x) < 36);
        b.room.items.push({ x: x, y: b.floorY - (over ? 66 : 26), t: 'coin' });
      }
      if (r() < 0.6) {
        const x = Math.round(b.doorX + 120 + r() * Math.max(10, b.exitX - b.doorX - 200));
        if (far(x, b.room.obs, 45)) b.room.items.push({ x: x, y: b.floorY - 24, t: pickSpecial(r) });
      }
    }
  }

  function pickSpecial(r) {
    const v = r();
    return v < 0.45 ? 'tank' : v < 0.8 ? 'bomb' : 'gift';
  }

  function ensure(world, x) {
    while (world.b.length === 0 || world.b[world.b.length - 1].x + world.b[world.b.length - 1].w < x) {
      genBuilding(world);
    }
  }

  /** x を含むビル (ふちは 5px 甘く見る)。無ければ null。 */
  function buildingAt(world, x) {
    const bs = world.b;
    let lo = 0, hi = bs.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bs[mid].x - 5 <= x) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (found < 0) return null;
    const b = bs[found];
    return x <= b.x + b.w + 5 ? b : null;
  }

  /** x より左にある最後のビルの番号 (谷の上でも、いちばん近い手前のビル)。 */
  function indexNear(world, x) {
    const bs = world.b;
    let lo = 0, hi = bs.length - 1, found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bs[mid].x <= x) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }

  function layerOf(b, inside) { return inside >= 0 ? b.room : b.roof; }
  function baseY(b, inside) { return inside >= 0 ? b.floorY : b.roofY; }

  // ------------------------------------------------------------ 体の動き (主人公も敵も共通)
  /** o: {x,y,vx,vy,hw,inside,onGround,blocked}。足もとが (x,y)。 */
  function stepBody(g, o, dt) {
    const w = g.world;
    const px = o.x;
    const py = o.y;
    o.x += o.vx * dt;
    o.vy = Math.min(o.vy + G * dt, MAX_FALL);
    o.y += o.vy * dt;
    o.onGround = false;
    o.blocked = false;
    if (o.inside >= 0) {
      const b = w.b[o.inside];
      o.x = clamp(o.x, b.x + 12, b.x + b.w - 12);
      if (o.y >= b.floorY) { o.y = b.floorY; o.vy = 0; o.onGround = true; }
      return;
    }
    const hw = o.hw;
    // 壁 (自分より高いビルの横っ腹)
    const bR = buildingAt(w, o.x + hw);
    if (bR && o.y > bR.roofY + 8 && px + hw <= bR.x + 1 && o.x + hw > bR.x) {
      if (o.y <= bR.roofY + 30) {
        // ふちの少し下なら、角に手がかかって屋上へ乗れる (ジャンプが少し遅れても登れる)
        o.y = bR.roofY; o.vy = 0; o.onGround = true;
      } else {
        o.x = bR.x - hw; o.blocked = true;
      }
    }
    const bL = buildingAt(w, o.x - hw);
    if (bL && o.y > bL.roofY + 8 && px - hw >= bL.x + bL.w - 1 && o.x - hw < bL.x + bL.w) {
      o.x = bL.x + bL.w + hw;
    }
    // 屋上に着く
    if (o.vy >= 0) {
      const bb = buildingAt(w, o.x);
      if (bb && py <= bb.roofY + 3 && o.y >= bb.roofY) {
        o.y = bb.roofY; o.vy = 0; o.onGround = true;
      }
    }
  }

  /** 足もとの下にある地面の高さ。無ければ null (谷)。 */
  function groundAt(g, inside, x, y) {
    if (inside >= 0) return g.world.b[inside].floorY;
    const b = buildingAt(g.world, x);
    if (b && b.roofY >= y - 4) return b.roofY;
    return null;
  }

  /** 投げた物・水の玉が地面か壁に入ったか。 */
  function hitsSolid(g, inside, x, y) {
    if (inside >= 0) {
      const b = g.world.b[inside];
      return y >= b.floorY || x < b.x + 8 || x > b.x + b.w - 8;
    }
    const b = buildingAt(g.world, x);
    return !!(b && y >= b.roofY);
  }

  // ------------------------------------------------------------ ゲームの始まり
  function newGame(opts) {
    opts = opts || {};
    const seed = (opts.seed != null ? opts.seed : (Math.random() * 4294967296)) >>> 0;
    const world = createWorld(seed);
    ensure(world, 3000);
    const guns = (opts.guns && opts.guns.length ? opts.guns : ['mizu']).slice();
    const start = guns.indexOf(opts.startGun);
    const g = {
      seed: seed,
      world: world,
      rng: mulberry32(seed ^ 0x9e3779b9),
      t: 0,
      over: null,
      events: [],
      p: {
        x: 0, y: world.b[0].roofY, vx: 0, vy: 0, hw: PLAYER_HW, h: PLAYER_H,
        onGround: true, ground: 0.1, inside: -1, stun: 0, inv: 0, carry: null, cd: 0,
        anim: 0, jumping: false, blocked: false
      },
      in: { jumpHeld: false, fireHeld: false, jumpBuf: 0, doorBuf: 0, grabBuf: 0, bombBuf: 0 },
      guns: guns,
      gunIdx: start >= 0 ? start : 0,
      water: 100,
      bombs: opts.bombs != null ? opts.bombs : 3,
      coins: 0,
      kills: 0,
      stage: 1,
      enemies: [],
      shots: [],
      thrown: [],
      puddles: [],
      nextId: 1,
      spawnT: 0,
      noEnemies: !!opts.noEnemies,
      danger: 999,
      dryT: 0,
      noGift: false
    };
    if (!g.noEnemies) spawnEnemy(g, 'suit', -170);
    return g;
  }

  function emit(g, type, x, y, extra) {
    const ev = { t: type, x: x, y: y };
    if (extra) for (const k in extra) ev[k] = extra[k];
    g.events.push(ev);
    if (g.events.length > 300) g.events.shift();
  }

  // ------------------------------------------------------------ 入力 (ボタンの押し離し)
  function input(g, name, down) {
    const I = g.in;
    switch (name) {
      case 'jump': I.jumpHeld = down; if (down) I.jumpBuf = 0.12; break;
      case 'fire': I.fireHeld = down; break;
      case 'door': if (down) I.doorBuf = 0.15; break;
      case 'grab': if (down) I.grabBuf = 0.12; break;
      case 'bomb': if (down) I.bombBuf = 0.12; break;
      case 'switch': if (down) switchGun(g); break;
      default: break;
    }
  }

  function curGun(g) { return GUN_BY_ID[g.guns[g.gunIdx]]; }

  function switchGun(g) {
    g.gunIdx = (g.gunIdx + 1) % g.guns.length;
    emit(g, 'switch', g.p.x, g.p.y, { gun: g.guns[g.gunIdx] });
  }

  // ------------------------------------------------------------ 敵
  function spawnEnemy(g, type, x) {
    const T = ENEMIES[type];
    const w = g.world;
    ensure(w, g.p.x + 3000);
    let inside = -1;
    let b = buildingAt(w, x);
    if (!b) {
      // 谷なら、手前のビルのはしに置く
      const j = indexNear(w, x);
      b = w.b[j];
      x = b.x + b.w - 30;
    }
    x = clamp(x, b.x + 14, b.x + b.w - 14);
    // 進むほどタフになる (400m ごとに 2 倍)
    const hp = Math.round(T.hp * (1 + metersOf(g.p.x) / 400) * 2) / 2;
    const e = {
      id: g.nextId++, type: type, x: x, y: b.roofY, vx: 0, vy: 0, hw: T.w / 2, w: T.w, h: T.h,
      hp: hp, maxhp: hp, inside: inside, onGround: true, state: 'chase',
      wet: 0, freeze: 0, stun: 0, puddle: 0, flash: 0, doorT: 0, anim: Math.random() * 6, t: 0
    };
    if (T.fly) { e.y = b.roofY - 30; }
    g.enemies.push(e);
    emit(g, 'spawn', e.x, e.y, { type: type });
    return e;
  }

  function enemyCenterY(e) { return e.y - e.h / 2; }

  function pickEnemyType(g) {
    const m = metersOf(g.p.x);
    const r = g.rng;
    const table = [['suit', 4]];
    if (m >= 60) table.push(['dog', 2.5]);
    if (m >= 150 && !g.enemies.some((e) => e.type === 'big' && e.state === 'chase')) table.push(['big', 2]);
    if (m >= 250) table.push(['drone', 2]);
    let sum = 0;
    table.forEach((t) => { sum += t[1]; });
    let v = r() * sum;
    for (const t of table) { v -= t[1]; if (v <= 0) return t[0]; }
    return 'suit';
  }

  function chasers(g) { return g.enemies.filter((e) => e.state === 'chase'); }

  function director(g, dt) {
    if (g.noEnemies) return;
    const p = g.p;
    const m = metersOf(p.x);
    const want = Math.min(5, 1 + Math.floor(m / 180) + (isGroundStage(stageOf(p.x)) ? 1 : 0));   // 地上は逃げ場が少ないので 1 人多い
    const active = chasers(g).length;
    g.spawnT -= dt;
    if (active < want && g.spawnT <= 0) {
      const type = pickEnemyType(g);
      let x = p.x - (300 + g.rng() * 100);
      if (p.inside >= 0) {
        const b = g.world.b[p.inside];
        x = Math.max(b.x + 16, b.doorX - 200);
      }
      spawnEnemy(g, type, x);
      g.spawnT = active === 0 ? 2.5 : 5;
    }
  }

  /**
   * 前に谷や壁やじゃま物があれば、跳ぶ計画 {until} を返す。無ければ null。
   * until: この x まで押しっぱなしにして、越えたら離す (離すと低く短く着く)。
   * 敵も、テストの自動プレイも、同じ計画で跳ぶ。
   */
  function jumpPlan(g, o, speed) {
    if (!o.onGround && !(o.ground > 0)) return null;
    const w = g.world;
    const la = speed * 0.035 + 4;
    if (o.inside < 0) {
      const b = buildingAt(w, o.x + la);
      if (!b || b.roofY < o.y - 8) {
        const j = indexNear(w, o.x + la + 6);
        const nb = !b ? w.b[j + 1] : b;
        if (nb && nb.x > o.x) return { until: nb.x + 25 };
        if (!b) return { until: o.x + 120 };
      }
    }
    const list = o.inside >= 0 ? w.b[o.inside].room.obs : nearbyObs(g, o.x);
    for (const ob of list) {
      const d = ob.x - o.x;
      const wide = OBSTACLES[ob.t].w >= 50;                     // 車: 押しつづけた高いジャンプで、まんなかを過ぎたら離す
      if (d > -4 && d < speed * (wide ? 0.3 : 0.18)) return { until: wide ? ob.x + 14 : o.x };   // ふつうはちょん跳び: すぐ離す
    }
    return null;
  }

  function nearbyObs(g, x) {
    const j = indexNear(g.world, x);
    const out = [];
    for (let k = Math.max(0, j - 1); k <= j + 1 && k < g.world.b.length; k++) {
      const arr = g.world.b[k].roof.obs;
      for (let q = 0; q < arr.length; q++) out.push(arr[q]);
    }
    return out;
  }

  function stepEnemy(g, e, dt) {
    const p = g.p;
    const T = ENEMIES[e.type];
    e.t += dt;
    e.anim += dt * 10;
    if (e.state === 'fly') {
      e.x += e.fvx * dt; e.y += e.fvy * dt; e.fvy += 1500 * dt;
      e.rot += dt * 14;
      e.flyT -= dt;
      if (e.flyT <= 0) e.gone = true;
      return;
    }
    e.flash = Math.max(0, e.flash - dt);
    e.wet = Math.max(0, e.wet - dt);
    e.freeze = Math.max(0, e.freeze - dt);
    e.stun = Math.max(0, e.stun - dt);
    // みずたまり
    e.puddle = 0;
    for (const pd of g.puddles) {
      if (pd.inside === e.inside && Math.abs(pd.x - e.x) < pd.w / 2) { e.puddle = 1; break; }
    }
    let slow = 1 - 0.4 * Math.min(1, e.wet / 1.5);
    if (e.freeze > 0) slow *= 0.25;
    if (e.puddle) slow *= 0.5;
    let sp = speedAt(p.x) * T.k * slow;
    if (p.x - e.x > 190) sp *= 1.25;                // 遅れすぎたら追いつく
    if (e.stun > 0) sp = 0;

    // どこへ向かうか
    let dir = 1;
    let door = false;
    if (e.inside !== p.inside) {
      if (e.inside >= 0) {
        // 中にいて、相手は外 (または別のビル) → 出口へ
        const b = g.world.b[e.inside];
        if (e.x >= b.exitX) { exitBuilding(g, e, b); return; }
      } else {
        // 外にいて、相手はビルの中 → ドアへ
        const b = g.world.b[p.inside];
        const dx = b.doorX - e.x;
        if (Math.abs(dx) < 6) {
          door = true;
          sp = 0;
          e.doorT += dt;
          if (e.doorT > 0.45) {
            e.inside = p.inside; e.x = b.doorX; e.y = b.floorY; e.vy = 0; e.doorT = 0;
            emit(g, 'enemyDoor', e.x, e.y, { id: e.id });
          }
        } else {
          dir = dx > 0 ? 1 : -1;
        }
      }
    }
    e.vx = dir * sp;

    if (T.fly) {
      e.x += e.vx * dt;
      let gy;
      if (e.inside >= 0) gy = g.world.b[e.inside].floorY;
      else {
        const b = buildingAt(g.world, e.x);
        gy = b ? b.roofY : (g.lastGround != null ? g.lastGround : e.y);
        if (b) g.lastGround = b.roofY;
      }
      const target = gy - 26 + Math.sin(e.t * 5) * 5;
      e.y += (target - e.y) * Math.min(1, dt * 6);
      if (e.inside >= 0) {
        const b = g.world.b[e.inside];
        e.x = clamp(e.x, b.x + 12, b.x + b.w - 12);
      }
    } else {
      if (!door && e.stun <= 0) {
        const plan = jumpPlan(g, e, sp || 120);
        if (plan) { e.vy = -JUMP_V; e.onGround = false; e.until = plan.until; }
      }
      if (e.until != null && e.vy < -CUT_V && e.x >= e.until) e.vy = -CUT_V;
      stepBody(g, e, dt);
      if (e.onGround) e.until = null;
      if (e.y > KILL_Y) {
        defeat(g, e, true);
        return;
      }
    }
  }

  function exitBuilding(g, o, b) {
    o.inside = -1;
    o.x = b.exitX;
    o.y = b.roofY;
    o.vy = 0;
  }

  // ------------------------------------------------------------ 当たりと倒れ
  /** 敵に当てる。h: {dmg,push,wet,freeze,stun,trap,coin} */
  function applyHit(g, e, h, x, y) {
    if (e.state !== 'chase') return;
    const T = ENEMIES[e.type];
    e.hp -= h.dmg || 0;
    e.flash = 0.12;
    if (h.wet) e.wet = Math.min(3, e.wet + h.wet);
    if (h.push) {
      e.x -= h.push * (1 - T.resist);
    }
    if (h.freeze) e.freeze = Math.max(e.freeze, h.freeze);
    if (h.stun) e.stun = Math.max(e.stun, h.stun * (1 - T.resist * 0.5));
    if (h.trap) e.stun = Math.max(e.stun, h.trap);
    if (h.coin) { g.coins += h.coin; emit(g, 'coin', e.x, enemyCenterY(e), { n: h.coin, pop: true }); }
    emit(g, 'hit', x != null ? x : e.x, y != null ? y : enemyCenterY(e), { id: e.id });
    if (e.hp <= 0) defeat(g, e, false);
  }

  function defeat(g, e, fell) {
    if (e.state !== 'chase') return;
    const T = ENEMIES[e.type];
    e.state = 'fly';
    e.fvx = -300 - Math.random() * 120 + (fell ? 0 : 0);
    e.fvy = -520;
    e.rot = 0;
    e.flyT = 1.1;
    if (fell) { e.fvx = 0; e.fvy = 0; e.flyT = 0.01; }
    g.kills++;
    g.coins += T.coin;
    emit(g, 'defeat', e.x, enemyCenterY(e), { type: e.type, coin: T.coin, fell: fell });
  }

  function splashHit(g, x, y, inside, r, h) {
    let n = 0;
    for (const e of g.enemies) {
      if (e.state !== 'chase' || e.inside !== inside) continue;
      if (Math.abs(e.x - x) <= r + e.w / 2 && Math.abs(enemyCenterY(e) - y) <= r + e.h / 2) {
        applyHit(g, e, h, e.x, enemyCenterY(e));
        n++;
      }
    }
    return n;
  }

  function explodeBomb(g, x, y, inside) {
    emit(g, 'explode', x, y, { r: 95 });
    splashHit(g, x, y, inside, 95, { dmg: 4, push: 80, stun: 0.7, wet: 2.5 });
    g.puddles.push({ x: x, w: 110, t: 3.2, inside: inside });
  }

  // ------------------------------------------------------------ 狙い
  function nearestBehind(g, maxD) {
    const p = g.p;
    let best = null, bd = maxD;
    for (const e of g.enemies) {
      if (e.state !== 'chase' || e.inside !== p.inside) continue;
      const d = p.x - e.x;
      if (d > -10 && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** 弧を描いて (tx,ty) へ届く初速。T 秒で着く。 */
  function lob(sx, sy, tx, ty, T) {
    return { vx: (tx - sx) / T, vy: (ty - sy - 0.5 * THROW_G * T * T) / T };
  }

  function aimLob(g, sx, sy) {
    const p = g.p;
    const tgt = nearestBehind(g, 500);
    let T = 0.55, tx, ty;
    if (tgt) {
      T = clamp((p.x - tgt.x) / 380, 0.35, 0.75);
      tx = tgt.x + tgt.vx * T;
      ty = enemyCenterY(tgt);
    } else {
      tx = p.x + p.vx * T - 170;
      ty = p.y - 10;
    }
    return lob(sx, sy, tx, ty, T);
  }

  // ------------------------------------------------------------ 武器
  function fireGun(g) {
    const p = g.p;
    const gun = curGun(g);
    const sx = p.x - 28;            // 後ろへ向けたカメラ型の水でっぽうの先
    const sy = p.y - 34;
    const tgt = nearestBehind(g, 520);
    let a = 0;
    if (tgt) {
      a = clamp(Math.atan2(enemyCenterY(tgt) - sy, p.x - tgt.x), -0.5, 0.5);
    }
    const ref = speedAt(p.x);
    for (let i = 0; i < gun.n; i++) {
      let da;
      if (gun.n > 1 && gun.spread > 0.1) da = (i / (gun.n - 1) - 0.5) * 2 * gun.spread;
      else da = (g.rng() - 0.5) * 2 * gun.spread;
      const off = gun.offset ? (i - (gun.n - 1) / 2) * gun.offset * 2 : 0;
      const ang = a + da;
      const sp = gun.speed * (0.96 + g.rng() * 0.08);
      g.shots.push({
        gun: gun.id, x: sx, y: sy + off,
        vx: ref - Math.cos(ang) * sp, vy: Math.sin(ang) * sp, ref: ref,
        life: gun.range / gun.speed, age: 0, inside: p.inside,
        hits: [], pierce: gun.pierce || 0, rot: g.rng() * 6
      });
    }
    p.cd = gun.cd;
    g.water = Math.max(0, g.water - gun.cost);
    emit(g, 'shoot', sx, sy, { gun: gun.id });
  }

  function stepShots(g, dt) {
    const keep = [];
    for (const s of g.shots) {
      const gun = GUN_BY_ID[s.gun];
      s.age += dt;
      s.life -= dt;
      if (gun.homing) {
        let tgt = null, bd = 1e9;
        for (const e of g.enemies) {
          if (e.state !== 'chase' || e.inside !== s.inside || s.hits.indexOf(e.id) >= 0) continue;
          const d = Math.abs(e.x - s.x);
          if (d < bd) { bd = d; tgt = e; }
        }
        if (tgt) {
          const rvx = s.vx - s.ref;
          const sp = Math.hypot(rvx, s.vy) || 1;
          const want = Math.atan2(enemyCenterY(tgt) - s.y, tgt.x - s.x);
          let cur = Math.atan2(s.vy, rvx);
          let diff = want - cur;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          cur += clamp(diff, -gun.homing * dt, gun.homing * dt);
          s.vx = s.ref + Math.cos(cur) * sp;
          s.vy = Math.sin(cur) * sp;
        }
      }
      if (gun.grav) s.vy += gun.grav * dt;
      if (gun.id === 'bubble') s.vy -= 12 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      let dead = s.life <= 0;
      let hitE = null;
      if (!dead) {
        for (const e of g.enemies) {
          if (e.state !== 'chase' || e.inside !== s.inside || s.hits.indexOf(e.id) >= 0) continue;
          if (Math.abs(s.x - e.x) <= e.w / 2 + gun.r && Math.abs(s.y - enemyCenterY(e)) <= e.h / 2 + gun.r) {
            hitE = e;
            applyHit(g, e, gun, s.x, s.y);
            s.hits.push(e.id);
            if (gun.splash) {
              splashHit(g, s.x, s.y, s.inside, gun.splash, {
                dmg: gun.splash > 50 ? gun.dmg * 0.5 : 0, push: gun.push * 0.5, wet: gun.wet, stun: gun.stun, freeze: gun.freeze
              });
              emit(g, 'splash', s.x, s.y, { r: gun.splash, gun: gun.id });
              dead = true;
            } else if (s.pierce > 0) {
              s.pierce--;
            } else {
              dead = true;
            }
            if (dead) break;
          }
        }
      }
      if (!dead && gun.grav && hitsSolid(g, s.inside, s.x, s.y)) {
        if (gun.splash) {
          splashHit(g, s.x, s.y, s.inside, gun.splash, { dmg: gun.dmg * 0.5, push: gun.push * 0.5, wet: gun.wet, stun: gun.stun });
          emit(g, 'splash', s.x, s.y, { r: gun.splash, gun: gun.id });
        }
        dead = true;
      }
      if (!dead && s.inside >= 0) {
        const b = g.world.b[s.inside];
        if (s.x < b.x + 8) dead = true;
      }
      void hitE;
      if (!dead) keep.push(s);
    }
    g.shots = keep;
  }

  // ------------------------------------------------------------ 水爆弾・投げ物
  function throwBomb(g) {
    const p = g.p;
    const sx = p.x - 4, sy = p.y - 36;
    const v = aimLob(g, sx, sy);
    g.thrown.push({ kind: 'bomb', t: 'bomb', x: sx, y: sy, vx: v.vx, vy: v.vy, inside: p.inside, state: 'air', life: 0, rot: 0, hits: [] });
    g.bombs--;
    emit(g, 'throw', sx, sy, { kind: 'bomb' });
  }

  function nearProp(g) {
    const p = g.p;
    if (p.carry) return null;
    const j = p.inside >= 0 ? p.inside : indexNear(g.world, p.x);
    let best = null, bd = 40;
    for (let k = Math.max(0, j - 1); k <= j + 1 && k < g.world.b.length; k++) {
      const b = g.world.b[k];
      if (p.inside >= 0 && k !== p.inside) continue;
      const list = layerOf(b, p.inside).props;
      for (const pr of list) {
        const d = Math.abs(pr.x - p.x);
        if (d < bd && Math.abs(p.y - baseY(b, p.inside)) < 45) { bd = d; best = { b: b, list: list, prop: pr }; }
      }
    }
    return best;
  }

  function nearDoor(g) {
    const p = g.p;
    if (p.inside >= 0 || !p.onGround) return null;
    const b = buildingAt(g.world, p.x);
    if (b && b.door && Math.abs(p.x - b.doorX) < 34) return b;
    return null;
  }

  function grabOrThrow(g) {
    const p = g.p;
    if (p.carry) {
      const sx = p.x - 4, sy = p.y - 60;
      const v = aimLob(g, sx, sy);
      g.thrown.push({ kind: 'prop', t: p.carry, x: sx, y: sy, vx: v.vx, vy: v.vy, inside: p.inside, state: 'air', life: 0, rot: 0, hits: [] });
      emit(g, 'throw', sx, sy, { kind: 'prop', k: p.carry });
      p.carry = null;
      return true;
    }
    const n = nearProp(g);
    if (n) {
      n.list.splice(n.list.indexOf(n.prop), 1);
      p.carry = n.prop.t;
      emit(g, 'grab', p.x, p.y - 20, { k: n.prop.t });
      return true;
    }
    return false;
  }

  function landThrown(g, o, enemy) {
    if (o.kind === 'bomb') {
      explodeBomb(g, o.x, o.y, o.inside);
      o.dead = true;
      return;
    }
    const P = PROPS[o.t];
    if (enemy) {
      applyHit(g, enemy, P, o.x, o.y);
      o.hits.push(enemy.id);
    }
    if (P.splash) {
      splashHit(g, o.x, o.y, o.inside, P.splash, { dmg: 0, wet: P.wet, push: 8 });
      emit(g, 'splash', o.x, o.y, { r: P.splash, gun: 'bucket' });
      if (P.puddle) g.puddles.push({ x: o.x, w: 90, t: 3, inside: o.inside });
    }
    if (P.roll && o.state !== 'roll') {
      o.state = 'roll'; o.life = 2.2; o.vy = 0;
      emit(g, 'thud', o.x, o.y, { k: o.t });
      return;
    }
    if (!P.roll || enemy) {
      emit(g, 'poof', o.x, o.y, { k: o.t });
      o.dead = true;
    }
  }

  function stepThrown(g, dt) {
    const keep = [];
    for (const o of g.thrown) {
      if (o.state === 'air') {
        o.vy += THROW_G * dt;
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        o.rot += dt * 9;
        let hit = null;
        for (const e of g.enemies) {
          if (e.state !== 'chase' || e.inside !== o.inside) continue;
          if (Math.abs(o.x - e.x) <= e.w / 2 + 13 && Math.abs(o.y - enemyCenterY(e)) <= e.h / 2 + 13) { hit = e; break; }
        }
        if (hit) landThrown(g, o, hit);
        else if (hitsSolid(g, o.inside, o.x, o.y)) {
          o.y = o.inside >= 0 ? g.world.b[o.inside].floorY - 6 : (groundAt(g, -1, o.x, o.y - 40) || o.y) - 6;
          landThrown(g, o, null);
        } else if (o.y > KILL_Y) o.dead = true;
      } else {
        // ころがる
        o.life -= dt;
        o.vx = -150;
        o.x += o.vx * dt;
        o.rot -= dt * 10;
        o.vy = Math.min(o.vy + G * dt, MAX_FALL);
        o.y += o.vy * dt;
        const gy = groundAt(g, o.inside, o.x, o.y - 20);
        if (gy != null && o.y >= gy - 6) { o.y = gy - 6; o.vy = 0; }
        for (const e of g.enemies) {
          if (e.state !== 'chase' || e.inside !== o.inside || o.hits.indexOf(e.id) >= 0) continue;
          if (Math.abs(o.x - e.x) <= e.w / 2 + 13 && Math.abs(o.y - enemyCenterY(e)) <= e.h / 2 + 13) {
            applyHit(g, e, PROPS[o.t], o.x, o.y);
            o.hits.push(e.id);
          }
        }
        if (o.life <= 0 || o.y > KILL_Y) {
          if (o.life <= 0) emit(g, 'poof', o.x, o.y, { k: o.t });
          o.dead = true;
        }
      }
      if (!o.dead) keep.push(o);
    }
    g.thrown = keep;
  }

  // ------------------------------------------------------------ 拾う・つまずく
  function collect(g) {
    const p = g.p;
    const w = g.world;
    const j = p.inside >= 0 ? p.inside : indexNear(w, p.x);
    const cx = p.x, cy = p.y - 24;
    for (let k = Math.max(0, j - 1); k <= j + 1 && k < w.b.length; k++) {
      if (p.inside >= 0 && k !== p.inside) continue;
      const b = w.b[k];
      const L = layerOf(b, p.inside);
      for (let q = L.items.length - 1; q >= 0; q--) {
        const it = L.items[q];
        if (Math.abs(it.x - cx) < 22 && Math.abs(it.y - cy) < 30) {
          L.items.splice(q, 1);
          takeItem(g, it);
        }
      }
      if (p.stun <= 0 && p.inv <= 0) {
        for (const ob of L.obs) {
          const O = OBSTACLES[ob.t];
          const top = baseY(b, p.inside) - O.h;
          if (Math.abs(ob.x - p.x) < O.w / 2 + p.hw - 2 && p.y > top + 6 && p.y - p.h < baseY(b, p.inside)) {
            p.stun = 0.45; p.inv = 0.8; p.x -= 6;
            emit(g, 'trip', p.x, p.y, { k: ob.t });
            break;
          }
        }
      }
    }
  }

  function takeItem(g, it) {
    const p = g.p;
    if (it.t === 'coin') {
      g.coins++;
      emit(g, 'coin', it.x, it.y, { n: 1 });
    } else if (it.t === 'tank') {
      g.water = Math.min(100, g.water + 50);
      emit(g, 'item', it.x, it.y, { k: 'tank' });
    } else if (it.t === 'bomb') {
      g.bombs = Math.min(9, g.bombs + 1);
      emit(g, 'item', it.x, it.y, { k: 'bomb' });
    } else if (it.t === 'gift') {
      const have = g.guns;
      const left = GUNS.filter((gu) => have.indexOf(gu.id) < 0);
      if (left.length) {
        const gu = left[Math.floor(g.rng() * left.length)];
        g.guns.push(gu.id);
        g.gunIdx = g.guns.length - 1;
        g.water = 100;
        emit(g, 'gift', it.x, it.y, { gun: gu.id });
      } else {
        g.coins += 20;
        emit(g, 'coin', it.x, it.y, { n: 20 });
      }
    }
    void p;
  }

  // ------------------------------------------------------------ 1 コマ進める
  function step(g, dtRaw) {
    const dt = dtRaw > 0 ? Math.min(dtRaw, 1 / 20) : 0;   // 間隔は上も下も止める
    if (dt === 0 || g.over) return;
    const p = g.p;
    const I = g.in;
    g.t += dt;
    ensure(g.world, p.x + 2500);

    I.jumpBuf = Math.max(0, I.jumpBuf - dt);
    I.doorBuf = Math.max(0, I.doorBuf - dt);
    I.grabBuf = Math.max(0, I.grabBuf - dt);
    I.bombBuf = Math.max(0, I.bombBuf - dt);
    p.cd = Math.max(0, p.cd - dt);
    p.inv = Math.max(0, p.inv - dt);
    p.stun = Math.max(0, p.stun - dt);
    g.dryT = Math.max(0, g.dryT - dt);
    g.water = Math.min(100, g.water + 6 * dt);
    p.anim += dt * 11;

    // ドア
    if (I.doorBuf > 0) {
      const b = nearDoor(g);
      if (b && p.stun <= 0) {
        p.inside = b.i; p.x = b.doorX; p.y = b.floorY; p.vy = 0; p.onGround = true;
        I.doorBuf = 0;
        emit(g, 'enter', p.x, p.y);
      }
    }

    // 走る・跳ぶ
    p.vx = p.stun > 0 ? 0 : speedAt(p.x);
    if (p.onGround) p.ground = 0.1; else p.ground -= dt;
    if (I.jumpBuf > 0 && p.ground > 0 && p.stun <= 0) {
      p.vy = -JUMP_V; p.ground = 0; p.onGround = false; p.jumping = true; I.jumpBuf = 0;
      emit(g, 'jump', p.x, p.y);
    }
    if (!I.jumpHeld && p.jumping && p.vy < -CUT_V) p.vy = -CUT_V;
    const was = p.onGround;
    stepBody(g, p, dt);
    if (p.onGround) {
      if (!was) emit(g, 'land', p.x, p.y);
      p.jumping = false;
    }
    if (p.blocked && p.stun <= 0) {
      p.stun = 0.4; p.x -= 6;
      emit(g, 'trip', p.x, p.y, { k: 'wall' });
    }
    if (p.y > KILL_Y) { g.over = 'fell'; emit(g, 'fell', p.x, p.y); return; }

    // ビルの出口
    if (p.inside >= 0) {
      const b = g.world.b[p.inside];
      if (p.x >= b.exitX) {
        exitBuilding(g, p, b);
        emit(g, 'exit', p.x, p.y);
      }
    }

    // ステージクリア (200m ごと。止まらず、そのまま次へ進む)
    const st = stageOf(p.x);
    if (st > g.stage) {
      const cleared = g.stage;
      g.stage = st;
      const bonus = stageClearBonus(cleared);
      g.coins += bonus;
      g.water = 100;
      g.bombs = Math.min(9, g.bombs + 1);
      emit(g, 'stage', p.x, p.y, { n: st, bonus: bonus, ground: isGroundStage(st) });
    }

    collect(g);

    // 武器
    if (I.fireHeld && !p.carry && p.cd <= 0) {
      const gun = curGun(g);
      if (g.water >= gun.cost) fireGun(g);
      else { p.cd = 0.25; if (g.dryT <= 0) { emit(g, 'dry', p.x, p.y); g.dryT = 1; } }
    }
    if (I.bombBuf > 0) {
      I.bombBuf = 0;
      if (g.bombs > 0 && !p.carry) throwBomb(g);
      else emit(g, 'nope', p.x, p.y);
    }
    if (I.grabBuf > 0) {
      I.grabBuf = 0;
      grabOrThrow(g);
    }

    // 敵・水・投げ物
    director(g, dt);
    for (const e of g.enemies) stepEnemy(g, e, dt);
    g.enemies = g.enemies.filter((e) => !e.gone);
    stepShots(g, dt);
    stepThrown(g, dt);
    for (const pd of g.puddles) pd.t -= dt;
    g.puddles = g.puddles.filter((pd) => pd.t > 0);

    // つかまった?
    let danger = 999;
    for (const e of g.enemies) {
      if (e.state !== 'chase' || e.inside !== p.inside) continue;
      const d = p.x - e.x;
      if (d < danger) danger = d;
      const eBottom = e.y, eTop = e.y - e.h;
      if (Math.abs(p.x - e.x) < p.hw + e.w / 2 - 4 && p.y > eTop + 4 && p.y - p.h < eBottom - 2) {
        g.over = 'caught';
        emit(g, 'caught', p.x, p.y);
        return;
      }
    }
    g.danger = danger;
  }

  /** ボタンの表示に使う状態。 */
  function hints(g) {
    return {
      door: !!nearDoor(g),
      grab: !!nearProp(g),
      carrying: g.p.carry
    };
  }

  return {
    // 定数
    G: G, JUMP_V: JUMP_V, CUT_V: CUT_V, KILL_Y: KILL_Y, FLOOR_OFF: FLOOR_OFF, THROW_G: THROW_G,
    PLAYER_HW: PLAYER_HW, PLAYER_H: PLAYER_H,
    GUNS: GUNS, GUN_BY_ID: GUN_BY_ID, PROPS: PROPS, OBSTACLES: OBSTACLES, ENEMIES: ENEMIES,
    // 乱数
    mulberry32: mulberry32, shuffle: shuffle,
    // 世界
    speedAt: speedAt, metersOf: metersOf, stageOf: stageOf, isGroundStage: isGroundStage, STAGE_PX: STAGE_PX, stageClearBonus: stageClearBonus, STAGE_LEN_M: STAGE_LEN_M, reach: reach,
    createWorld: createWorld, ensure: ensure, buildingAt: buildingAt, indexNear: indexNear,
    layerOf: layerOf, baseY: baseY, groundAt: groundAt,
    // 遊び
    newGame: newGame, step: step, input: input, hints: hints, curGun: curGun,
    stepBody: stepBody, jumpPlan: jumpPlan, spawnEnemy: spawnEnemy, applyHit: applyHit,
    nearDoor: nearDoor, nearProp: nearProp, chasers: chasers
  };
});
