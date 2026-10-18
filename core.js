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
      cd: 0.22, cost: 2, n: 1, spread: 0.03, speed: 640, range: 240, dmg: 1, push: 12, wet: 0.5, r: 5, trait: 'くせなし・つかいやすい', kick: 0.02, flash: 8 },
    { id: 'twin', name: 'ツインスプラッシュ', icon: '💦', color: '#5fd0ff', price: 90,
      desc: '2本ならんで出る。当たりやすい。',
      cd: 0.26, cost: 3.4, n: 2, spread: 0.02, offset: 7, speed: 640, range: 240, dmg: 1, push: 12, wet: 0.5, r: 5, trait: 'ふたつ同時に飛ぶ', kick: 0.03, flash: 10 },
    { id: 'shot', name: 'ショットガン', icon: '🎯', color: '#ffb347', price: 160,
      desc: 'ちかくでドーン! 5つぶ散らして、大きくふき飛ばす。',
      cd: 0.65, cost: 7.5, n: 5, spread: 0.3, speed: 560, range: 160, dmg: 1, push: 26, wet: 0.6, r: 6, trait: 'ちかくでドカン・大きく飛ばす', kick: 0.16, flash: 20 },
    { id: 'gatling', name: 'マシンガン', icon: '⚡', color: '#7bdff2', price: 240,
      desc: 'ものすごい連射。ちょっとずつ削る。',
      cd: 0.07, cost: 0.65, n: 1, spread: 0.09, speed: 700, range: 250, dmg: 0.45, push: 5, wet: 0.2, r: 4, trait: 'ながおしで連射がどんどん加速', ramp: { from: 0.22, to: 0.055, t: 0.9 }, kick: 0.03, flash: 7 },
    { id: 'sniper', name: 'スナイパー', icon: '🔭', color: '#c77dff', price: 320,
      desc: '遠くまで届く強い一発。3人まで貫通。',
      cd: 0.55, cost: 8, n: 1, spread: 0, speed: 1300, range: 520, dmg: 5, push: 40, wet: 1, pierce: 2, r: 5, trait: 'ねらって「ため」てから撃つ', windup: 0.4, kick: 0.22, flash: 18 },
    { id: 'cutter', name: 'ウォーターカッター', icon: '📏', color: '#e0fbfc', price: 420,
      desc: '細くてするどい水。ならんだ敵を全部つらぬく。',
      cd: 0.08, cost: 0.9, n: 1, spread: 0.01, speed: 1500, range: 360, dmg: 0.5, push: 2, wet: 0.2, pierce: 99, r: 3, trait: 'ビーム! いっしゅんで全員つらぬく', beam: true, kick: 0.02, flash: 9 },
    { id: 'hose', name: 'ホース', icon: '🚒', color: '#3a86ff', price: 520,
      desc: 'ざあざあ放水。敵をぐいぐい押し戻す。',
      cd: 0.04, cost: 0.8, n: 1, spread: 0.12, speed: 520, range: 220, dmg: 0.22, push: 20, wet: 0.15, r: 11, trait: 'ずっと押しもどす放水', kick: 0.05, flash: 12 },
    { id: 'homing', name: 'ホーミングガン', icon: '🌀', color: '#80ffdb', price: 660,
      desc: '敵をおいかけて曲がる。ねらわなくていい。',
      cd: 0.38, cost: 3.5, n: 1, spread: 0.3, speed: 520, range: 430, dmg: 1.3, push: 14, wet: 0.6, homing: 7, r: 6, trait: 'ぐるっと曲がって追いかける', kick: 0.03, flash: 9 },
    { id: 'bazooka', name: 'みずふうせんバズーカ', icon: '🎈', color: '#ff6b9d', price: 820,
      desc: '水風船がはじけて、まわりをまとめてびしょぬれ。',
      cd: 1.1, cost: 12, n: 1, spread: 0.02, speed: 520, range: 300, dmg: 3, push: 50, wet: 1.5, splash: 62, grav: 900, r: 8, trait: 'ふわっと弧をえがいてはじける', kick: 0.3, flash: 22 },
    { id: 'ice', name: 'コオリみずガン', icon: '❄️', color: '#a8dadc', price: 980,
      desc: 'つめたい水で敵がカチコチ。うごきがかなり遅くなる。',
      cd: 0.3, cost: 3.5, n: 1, spread: 0.04, speed: 620, range: 240, dmg: 0.5, push: 6, wet: 0.5, freeze: 1.8, r: 6, trait: 'こおって、うごきがおそくなる', kick: 0.03, flash: 12 },
    { id: 'bubble', name: 'あわあわガン', icon: '🫧', color: '#bde0fe', price: 1150,
      desc: 'ふわふわの泡で敵をとじこめる。',
      cd: 0.55, cost: 5, n: 1, spread: 0.06, speed: 210, range: 380, dmg: 0.3, push: 0, wet: 0.4, trap: 1.4, r: 15, trait: 'ふわふわ泡でとじこめる', kick: 0.0, flash: 13 },
    { id: 'shock', name: 'ビリビリみずガン', icon: '🔌', color: '#ffe66d', price: 1300,
      desc: 'しびれる水。まわりの敵もまとめて動けなくする。',
      cd: 0.45, cost: 5, n: 1, spread: 0.03, speed: 640, range: 240, dmg: 0.5, push: 4, wet: 0.4, stun: 0.9, r: 6, trait: 'しびれが近くの敵へ連鎖する', chain: { n: 2, r: 170, mul: 0.6 }, kick: 0.05, flash: 12 },
    { id: 'rainbow', name: 'にじいろガン', icon: '🌈', color: '#ff99c8', price: 1600,
      desc: '当たるとコインがこぼれる。ぜんぶ入りの最強水でっぽう。',
      cd: 0.12, cost: 2, n: 1, spread: 0.05, speed: 700, range: 280, dmg: 1, push: 14, wet: 0.6, coin: 1, r: 6, trait: '当てるとコインがこぼれる', kick: 0.04, flash: 11 }
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
  /** 宝石 (怪盗のおたから)。value = 宝石ポイント。きたえる (じぶんの強化) の代金になる。w = 出やすさ */
  const GEMS = {
    ruby:     { name: 'ルビー',       icon: '🔴', value: 1,  w: 55 },
    sapphire: { name: 'サファイア',   icon: '🔷', value: 2,  w: 30 },
    emerald:  { name: 'エメラルド',   icon: '🟢', value: 4,  w: 12 },
    diamond:  { name: 'ダイヤモンド', icon: '💎', value: 10, w: 3 }
  };
  const GEM_KEYS = Object.keys(GEMS);
  /** 高い所 (tier 2) の宝石ほど良いものが出る。tier 0 = 部屋のなか / 1 = 長おしジャンプで届く / 2 = 2 だんジャンプで届く */
  function pickGem(r, tier) {
    const mul = [1, 1.4, 2.4][tier || 0];
    const w = GEM_KEYS.map((k, i) => GEMS[k].w * (i === 0 ? 1 : mul * (i === 3 ? mul : 1)));
    let v = r() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) { v -= w[i]; if (v < 0) return GEM_KEYS[i]; }
    return GEM_KEYS[0];
  }
  const GEM_Y = [26, 100, 200];   // 足もとから宝石までの高さ (tier ごと)

  /** じぶんの強化 (きたえる)。1 レベルごとの伸び。値段は gemCost(レベル)。 */
  const UPGRADES = {
    jump:  { name: 'ジャンプりょく', icon: '🦘', per: 0.04, max: 10, desc: '高く跳べる' },
    power: { name: 'みずの ちから',  icon: '💪', per: 0.12, max: 10, desc: '水でっぽうも ばくだんも 強くなる' },
    tank:  { name: 'タンク',         icon: '🛢️', per: 0.03, max: 10, desc: '水の へりが ゆっくりになる' }
  };
  function gemCost(level) { return 6 + 4 * level; }              // いまのレベルから、つぎへ

  /** 地上で乗れる物。speed = はやさの倍率 / shield = 敵につかまりそうになると、はね飛ばして守る / sec = 乗っていられる時間 */
  const RIDES = {
    board:  { name: 'スケボー',     icon: '🛹', speed: 1.3, shield: false, sec: 14, lift: 8 },
    toycar: { name: 'ラジコンカー', icon: '🚙', speed: 1.5, shield: true,  sec: 10, lift: 15 }
  };
  // ロープ (スパイダーマンのように、空の風船のわっかにつかまって、ぶらんと渡る)
  const HOOK_H = 400;             // 風船のわっかの高さ (近くの屋上のうち高いほうから)。高いほど、ふりの上のほうが 2 だんジャンプより高くなる
  const GRIP_H = 44;              // 足もとから、ロープをにぎる手まで
  const ROPE_MAX_L = 260;         // ロープの長さの上限 (ぶらさがったとき、いちばん下でも屋上に足がつかない長さ)
  const ROPE_REEL = 700;          // ロープを巻きとる速さ (px/秒)
  const ROPE_PUMP = 1500;         // ぶらさがり中、ふりの向きに前へ加速する力 (px/秒^2)。こいで、ふりを大きくする
  const ROPE_TOP = 92;            // ふりの角度がこれをこえると自動ではなす (度。わっかの真横 = 90)
  const ROPE_FLING = 1.15;        // はなした瞬間、勢いを何倍にするか
  const ROPE_DASH = 1.6;          // ロープのあと、走る速さの倍率 (着地してから DASH_T 秒かけて 1 倍へもどる)
  const DASH_T = 1.8;
  const ROPE_GEM_DEG = [70, 80, 88];  // ロープでしか取れない宝石: ふりの円の上、わっかから前へこの角度
  const ROPE_KICK = 560;          // 地面からつかまったとき、とびあがる速さ
  const ROPE_MAX_T = 4;           // つかまっていられる秒
  // 屋上の 2 かい (給水タンク・看板の上)。上から乗れて、下からは通りぬける
  const DECK_H = 110;             // 屋上から 2 かいの上面まで (長おしジャンプの頂点 133 より低い)
  const DECK_END = 170;           // 2 かいの右はしから、屋上の右はしまで (落ちても屋上に着く)
  const DOOR_MIN_W = 620;         // ドアのあるビルの、いちばん短い幅 (中は 500px ほど = 2 秒近く)
  const DOOR_WAIT = 0.2;          // 敵がドアの前で、中へ入るまでに待つ秒
  const DOOR_CHASE_GAP = 140;     // ビルの中で、敵はこの距離まで追いつく (それより近くはふつうの速さ)
  const AIR_JUMP_K = 0.85;        // 2 だんめの高さ (もとのジャンプに対する割合)
  const AIR_JUMP_AFTER = 0.08;    // 跳んでから、2 だんめがおせるまでの秒

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
          if (b.w >= 420 && (r() < 0.75 || i === 2)) {
            b.door = true;
            if (i !== 2) b.w = Math.round(DOOR_MIN_W + r() * 160);     // 中でたたかえる長さ (敵がはいってきて、撃てる)
          }
        }
      }
    }
    b.floorY = b.roofY + FLOOR_OFF;
    if (b.door) {
      b.doorX = Math.round(b.x + 50 + r() * 40);
      b.exitX = b.x + b.w - 120;
    }
    b.hooks = [];
    {
      const pv = bs[i - 1];
      if (pv && !b.ground && !pv.ground) {
        const end = pv.x + pv.w, gap = b.x - end;
        if (gap >= 70 && r() < 0.6) {                       // 谷の上の風船
          const hy = Math.min(pv.roofY, b.roofY) - HOOK_H;
          b.hooks.push({ x: Math.round(end + gap / 2), y: hy });
        }
      }
      if (i > 0 && !b.ground && b.w >= 520 && r() < 0.3) {   // 長い屋上の上の風船
        b.hooks.push({ x: Math.round(b.x + b.w * (0.4 + r() * 0.2)), y: b.roofY - HOOK_H });
      }
    }
    populate(world, b, bs[i - 1] || null, r);
    // ロープでしか取れない宝石: ふりの円 (半径 ROPE_MAX_L) の前の上のほう。2 だんジャンプより高い
    // (このビルの屋上の上だけ。2 かいの上には置かない = 2 かいから 2 だんジャンプでは取れない)
    for (const h of b.hooks) {
      if (r() < 0.55) {
        const pts = ROPE_GEM_DEG.map((deg) => {
          const a = deg * Math.PI / 180;
          return { x: Math.round(h.x + Math.sin(a) * ROPE_MAX_L), y: Math.round(h.y + Math.cos(a) * ROPE_MAX_L + 20) };
        });
        const okAll = pts.every((q) => q.x > b.x + 10 && q.x < b.x + b.w - 10 && !b.decks.some((d) => q.x > d.x0 - 60 && q.x < d.x1 + 60));
        if (!okAll) continue;
        h.gems = true;
        for (const q of pts) b.roof.items.push({ x: q.x, y: q.y, t: 'gem', k: pickGem(r, 2), rope: 1 });
      }
    }
    bs.push(b);
    return b;
  }

  /** 地上の道の中身: 谷もじゃま物も無い 1 本道。乗り物・宝石・コイン・投げられる物がならぶ。 */
  function populateGround(world, b, prev, r) {
    b.decks = [];
    b.roof = { items: [], props: [] };
    b.room = { items: [], props: [] };
    const far = (x, arr, d) => arr.every((o) => Math.abs(o.x - x) >= d);
    const entering = !prev || !prev.ground || b.x > prev.x + prev.w;
    const sEnd = stageOf(b.x) * STAGE_PX;
    const lastSeg = b.x + b.w >= sEnd - 1;
    const lo = b.x + (entering ? 95 : 20);
    const hi = b.x + b.w - (lastSeg ? 150 : 20);
    // 投げられる物
    const nProps = Math.floor(b.w / 330);
    for (let k = 0; k < nProps; k++) {
      for (let tries = 0; tries < 8; tries++) {
        const px = Math.round(b.x + 50 + r() * Math.max(10, b.w - 120));
        if (!far(px, b.roof.props, 60)) continue;
        b.roof.props.push({ x: px, t: pick(r, PROP_KEYS) });
        break;
      }
    }
    // 特別なアイテム (600px につき半分の確率)
    for (let k = 0; k < Math.floor(b.w / 600); k++) {
      if (r() < 0.55) {
        for (let tries = 0; tries < 8; tries++) {
          const px = Math.round(b.x + 60 + r() * Math.max(10, b.w - 140));
          if (!far(px, b.roof.props, 30) || !far(px, b.roof.items, 30)) continue;
          b.roof.items.push({ x: px, y: b.roofY - 24, t: pickSpecial(r) });
          break;
        }
      }
    }
    // 乗り物 (スケボー・ラジコンカー): 600px につき 7 割の確率で 1 つ。出口の近くには置かない (降りる時間がいる)
    for (let k = 0; k < Math.floor(b.w / 600); k++) {
      if (r() < 0.7) {
        for (let tries = 0; tries < 8; tries++) {
          const px = Math.round(b.x + 60 + r() * Math.max(10, b.w - 260));
          if (!far(px, b.roof.props, 40) || !far(px, b.roof.items, 40)) continue;
          b.roof.items.push({ x: px, y: b.roofY - 22, t: r() < 0.6 ? 'board' : 'toycar' });
          break;
        }
      }
    }
    // 宝石: 400px につき 6 割で 1 つ。長おしジャンプで届く高さ (ときどき、2 だんジャンプの高さ)
    for (let k = 0; k < Math.floor(b.w / 400); k++) {
      if (r() < 0.6) {
        const tier = r() < 0.7 ? 1 : 2;
        for (let tries = 0; tries < 8; tries++) {
          const px = Math.round(lo + r() * Math.max(10, hi - lo));
          if (!far(px, b.roof.items, 40)) continue;
          b.roof.items.push({ x: px, y: b.roofY - GEM_Y[tier], t: 'gem', k: pickGem(r, tier) });
          break;
        }
      }
    }
    // コインの列
    const nLines = Math.max(1, Math.floor(b.w / 260));
    for (let k = 0; k < nLines; k++) {
      if (r() < 0.65) {
        const n = 4 + Math.floor(r() * 3);
        const x0 = b.x + 40 + r() * Math.max(10, b.w - 80 - n * 30);
        for (let q = 0; q < n; q++) {
          const cx = Math.round(x0 + q * 30);
          if (cx > b.x + b.w - 20) break;
          if (b.roof.items.some((it) => Math.abs(it.x - cx) < 22)) continue;
          b.roof.items.push({ x: cx, y: b.roofY - 26, t: 'coin' });
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
    b.roof = { items: [], props: [] };
    b.room = { items: [], props: [] };
    const far = (x, arr, d) => arr.every((o) => Math.abs(o.x - x) >= d);

    // --- 屋上: 投げられる物
    if (i === 0) {
      b.roof.props.push({ x: 150, t: 'crate' });
      b.roof.props.push({ x: 460, t: 'bucket' });
    } else if (r() < 0.55) {
      for (let tries = 0; tries < 8; tries++) {
        const x = Math.round(b.x + 50 + r() * Math.max(10, b.w - 140));
        if (!far(x, b.roof.props, 40)) continue;
        if (b.door && Math.abs(x - b.doorX) < 45) continue;
        b.roof.props.push({ x: x, t: pick(r, PROP_KEYS) });
        break;
      }
    }
    // --- 屋上: 特別なアイテム
    if (i > 0 && r() < 0.3) {
      for (let tries = 0; tries < 8; tries++) {
        const x = Math.round(b.x + 60 + r() * Math.max(10, b.w - 170));
        if (!far(x, b.roof.props, 30)) continue;
        if (b.door && Math.abs(x - b.doorX) < 40) continue;
        b.roof.items.push({ x: x, y: b.roofY - 24, t: pickSpecial(r) });
        break;
      }
    }
    // --- 屋上の 2 かい (給水タンク・看板)。上はコインと宝石のごほうびの道
    b.decks = [];
    if (i > 0 && b.w >= 330) {
      const want = b.w >= 640 && r() < 0.5 ? 2 : (r() < 0.65 ? 1 : 0);
      const lo = b.x + 100, hi = b.x + b.w - DECK_END;
      for (let k = 0; k < want; k++) {
        for (let tries = 0; tries < 8; tries++) {
          const span = Math.round(150 + r() * 110);
          const x0 = Math.round(lo + r() * Math.max(0, hi - lo - span));
          const x1 = x0 + span;
          if (x1 > hi) continue;
          if (b.door && x1 > b.doorX - 70 && x0 < b.doorX + 70) continue;
          if (b.decks.some((d) => x1 + 120 > d.x0 && x0 < d.x1 + 120)) continue;
          b.decks.push({ x0: x0, x1: x1, y: b.roofY - DECK_H, k: r() < 0.5 ? 'tank' : 'sign' });
          break;
        }
      }
      for (const d of b.decks) {
        if (r() < 0.6) for (let q = 0; q < 4; q++) b.roof.items.push({ x: Math.round(d.x0 + 30 + q * 30), y: d.y - 26, t: 'coin' });
        if (r() < 0.4) b.roof.items.push({ x: Math.round(d.x1 - 30), y: d.y - 26, t: 'gem', k: pickGem(r, 1) });
      }
    }
    // 2 かいの右はしの先に、風船のわっか (2 かいから、ロープでつぎのビルへ)
    for (const d of b.decks) {
      const hx = Math.round(d.x1 + 60);
      if (hx < b.x + b.w - 100 && r() < 0.45 && b.hooks.every((h) => Math.abs(h.x - hx) > 220)) b.hooks.push({ x: hx, y: b.roofY - HOOK_H });
    }
    const underDeck = (x) => b.decks.some((d) => x > d.x0 - 24 && x < d.x1 + 24);
    // --- 屋上: 宝石 (高い所にある。長おしジャンプか 2 だんジャンプで取る)
    if (i > 0 && r() < 0.45) {
      const tier = r() < 0.6 ? 1 : 2;
      const x = Math.round(b.x + 80 + r() * Math.max(10, b.w - 240));
      if (!(b.door && Math.abs(x - b.doorX) < 40) && far(x, b.roof.props, 30) && !underDeck(x)) b.roof.items.push({ x: x, y: b.roofY - GEM_Y[tier], t: 'gem', k: pickGem(r, tier) });
    }
    // --- 屋上: コインの列
    if (i > 0 && r() < 0.55) {
      const n = 4 + Math.floor(r() * 3);
      const x0 = b.x + 60 + r() * Math.max(10, b.w - 260);
      for (let k = 0; k < n; k++) {
        const x = Math.round(x0 + k * 30);
        if (x > b.x + b.w - 30) break;
        b.roof.items.push({ x: x, y: b.roofY - 26, t: 'coin' });
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
      if (r() < 0.6) {
        const x = Math.round(b.doorX + 60 + r() * (b.exitX - b.doorX - 100));
        b.room.props.push({ x: x, t: pick(r, PROP_KEYS) });
      }
      const n = 4 + Math.floor(r() * 5);
      const x0 = b.doorX + 50 + r() * 20;
      for (let k = 0; k < n; k++) {
        const x = Math.round(x0 + k * 30);
        if (x > b.exitX - 20) break;
        b.room.items.push({ x: x, y: b.floorY - 26, t: 'coin' });
      }
      if (r() < 0.6) {
        const x = Math.round(b.doorX + 120 + r() * Math.max(10, b.exitX - b.doorX - 200));
        b.room.items.push({ x: x, y: b.floorY - 24, t: pickSpecial(r) });
      }
      // ビルの中のお宝 (入ったごほうび。部屋の奥)
      if (r() < 0.55) {
        const x = Math.round(b.exitX - 60 - r() * Math.max(10, (b.exitX - b.doorX) * 0.4));
        b.room.items.push({ x: x, y: b.floorY - GEM_Y[0], t: 'gem', k: pickGem(r, 0) });
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
    // 屋上の 2 かいに着く (主人公だけ。上から落ちてきたときだけ乗る = 下からは通りぬける)
    o.onDeck = false;
    if (o === g.p && o.vy >= 0) {
      const bd = buildingAt(w, o.x);
      if (bd && bd.decks) {
        for (const d of bd.decks) {
          if (o.x >= d.x0 && o.x <= d.x1 && py <= d.y + 3 && o.y >= d.y) { o.y = d.y; o.vy = 0; o.onGround = true; o.onDeck = true; return; }
        }
      }
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
        onGround: true, ground: 0.1, inside: -1, stun: 0, inv: 0, carry: null, ride: null, rope: null, dash: 0, air2: false, airT: 0, jumps2: 0, cd: 0,
        anim: 0, jumping: false, blocked: false, hold: 0, charge: 0, gunPrev: null
      },
      in: { jumpHeld: false, fireHeld: false, grabHeld: false, jumpBuf: 0, doorBuf: 0, grabBuf: 0, bombBuf: 0 },
      guns: guns,
      gunIdx: start >= 0 ? start : 0,
      water: 100,
      bombs: opts.bombs != null ? opts.bombs : 3,
      coins: 0,
      kills: 0,
      gems: 0, gemKinds: {},
      up: { jump: 0, power: 0, tank: 0 },
      jumpK: 1, dmgK: 1, costK: 1,
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
    const up = opts.up || {};
    for (const k in UPGRADES) g.up[k] = Math.max(0, Math.min(UPGRADES[k].max, Math.floor(up[k] || 0)));
    g.jumpK = 1 + UPGRADES.jump.per * g.up.jump;
    g.dmgK = 1 + UPGRADES.power.per * g.up.power;
    g.costK = 1 - UPGRADES.tank.per * g.up.tank;
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
      case 'grab': I.grabHeld = down; if (down) I.grabBuf = 0.12; break;
      case 'act':           // 1 つのボタン: ドアが近ければ入る / なければ もつ・なげる・ロープ (おしている間つかまる)
        I.grabHeld = down;
        if (down) { if (nearDoor(g)) I.doorBuf = 0.15; else I.grabBuf = 0.12; }
        break;
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
    return null;
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
    else if (e.inside >= 0 && e.inside === p.inside && p.x - e.x > DOOR_CHASE_GAP) sp *= 1.5;   // ビルの中では、すぐ後ろまで来る (撃つ的になる。それいじょうは近づかない)
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
          if (e.doorT > DOOR_WAIT) {
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
    e.hp -= (h.dmg || 0) * g.dmgK;
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
    const sy = p.y - 34 - rideLift(p);
    const tgt = nearestBehind(g, 520);
    let a = 0;
    if (tgt) {
      a = clamp(Math.atan2(enemyCenterY(tgt) - sy, p.x - tgt.x), -0.5, 0.5);
    }
    const ref = speedAt(p.x);
    // ビーム: 玉は飛ばさず、線の上にいる敵 (射程まで) をいっぺんに当てる
    if (gun.beam) {
      const ca = Math.cos(a), sa = Math.sin(a);
      for (const e of g.enemies) {
        if (e.state !== 'chase' || e.inside !== p.inside) continue;
        const t = (sx - e.x) / ca;
        if (t < -8 || t > gun.range) continue;
        if (Math.abs(sy + sa * t - enemyCenterY(e)) <= e.h / 2 + 7) applyHit(g, e, gun, e.x, enemyCenterY(e));
      }
      emit(g, 'beam', sx, sy, { gun: gun.id, x2: sx - ca * gun.range, y2: sy + sa * gun.range });
    }
    for (let i = 0; i < (gun.beam ? 0 : gun.n); i++) {
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
    // 連射が加速する銃: 押しつづけた長さで、つぎの間隔がちぢむ
    let ramp = 0;
    if (gun.ramp) {
      ramp = Math.min(1, p.hold / gun.ramp.t);
      p.cd = gun.ramp.from + (gun.ramp.to - gun.ramp.from) * ramp;
    } else {
      p.cd = gun.cd;
    }
    g.water = Math.max(0, g.water - gun.cost * g.costK);
    emit(g, 'shoot', sx, sy, { gun: gun.id, ramp: ramp });
  }

  /** しびれの連鎖: あたった敵のそばの敵へ、つづけてしびれが走る。 */
  function chainHit(g, from, gun, shot) {
    const ch = gun.chain;
    const near = g.enemies
      .filter((e) => e.state === 'chase' && e.inside === from.inside && e.id !== from.id && shot.hits.indexOf(e.id) < 0 && Math.abs(e.x - from.x) <= ch.r)
      .sort((a, b) => Math.abs(a.x - from.x) - Math.abs(b.x - from.x))
      .slice(0, ch.n);
    let prev = from;
    for (const e of near) {
      applyHit(g, e, { dmg: gun.dmg * ch.mul, stun: gun.stun * 0.8, wet: gun.wet * 0.5, push: 0 }, e.x, enemyCenterY(e));
      shot.hits.push(e.id);
      emit(g, 'arc', prev.x, enemyCenterY(prev), { x2: e.x, y2: enemyCenterY(e) });
      prev = e;
    }
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
            if (gun.chain) chainHit(g, e, gun, s);
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
    const sx = p.x - 4, sy = p.y - 36 - rideLift(p);
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
      const sx = p.x - 4, sy = p.y - 60 - rideLift(p);
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
    }
  }

  /** つかまれる風船のわっか (足もとから見て、前の 190px・うしろの 120px・高さ 120〜470px)。いちばん近くの 1 つ。 */
  function nearHook(g) {
    const p = g.p;
    if (p.inside >= 0 || p.stun > 0 || p.rope) return null;
    const j = indexNear(g.world, p.x);
    let best = null, bd = 1e9;
    for (let k = Math.max(0, j - 1); k <= j + 3 && k < g.world.b.length; k++) {
      for (const h of g.world.b[k].hooks) {
        const dx = h.x - p.x, dy = (p.y - GRIP_H) - h.y;
        if (dx < -120 || dx > 190 || dy < 120 || dy > 470) continue;
        const d = Math.abs(dx - 60);
        if (d < bd) { bd = d; best = h; }
      }
    }
    return best;
  }

  function startRope(g, h) {
    const p = g.p;
    const gx = p.x, gy = p.y - GRIP_H;
    const d = Math.hypot(gx - h.x, gy - h.y);
    p.rope = { ax: h.x, ay: h.y, L: d, Lt: Math.min(d, ROPE_MAX_L), t: 0 };
    if (p.onGround) { p.vy = -ROPE_KICK; p.onGround = false; p.y -= 2; }
    p.jumping = false; p.air2 = true; p.airT = 0;
    emit(g, 'rope', p.x, p.y, { hx: h.x, hy: h.y });
  }

  function endRope(g, why, boost) {
    const p = g.p;
    if (!p.rope) return;
    emit(g, 'unrope', p.x, p.y, { why: why });
    p.rope = null;
    p.air2 = false; p.jumping = false; p.ground = 0;
    if (why !== 'land') {                                  // ふりの勢いで飛びだす
      p.vx *= ROPE_FLING; p.vy *= ROPE_FLING;
      p.dash = DASH_T;                                     // 着地しても、しばらく速く走る (ロープの勢い)
    }
    if (boost) p.vy = Math.min(p.vy, -boost);
  }

  /** ぶらさがり中の、ロープの長さ (まきとる)・時間。 */
  function stepRopeLength(g, dt) {
    const r = g.p.rope;
    r.t += dt;
    if (r.L > r.Lt) r.L = Math.max(r.Lt, r.L - ROPE_REEL * dt);
  }

  /** stepBody のあと、ロープより遠くへ行った分を引きもどす (ふりこ)。外向きの速さを消す。 */
  function constrainRope(g) {
    const p = g.p, r = p.rope;
    const dx = p.x - r.ax, dy = (p.y - GRIP_H) - r.ay;
    const d = Math.hypot(dx, dy) || 1;
    if (d > r.L) {
      const nx = dx / d, ny = dy / d;
      p.x = r.ax + nx * r.L;
      p.y = r.ay + ny * r.L + GRIP_H;
      const vr = p.vx * nx + p.vy * ny;
      if (vr > 0) { p.vx -= vr * nx; p.vy -= vr * ny; }
    }
  }

  /** いまのふりの角度 (度)。わっかの真下が 0、前 (右) へ行くほど +、真横で 90 */
  function ropeDeg(p) {
    const r = p.rope;
    return Math.atan2(p.x - r.ax, (p.y - GRIP_H) - r.ay) * 180 / Math.PI;
  }

  /** こぐ: ふりの円にそって前向き (右へ・上へ) に加速する。うしろへ戻るときはこがない */
  function pumpRope(g, dt) {
    const p = g.p, r = p.rope;
    const dx = p.x - r.ax, dy = (p.y - GRIP_H) - r.ay;
    const d = Math.hypot(dx, dy) || 1;
    const tx = dy / d, ty = -dx / d;                   // 前向きの接線 (真下にいるとき (1, 0))
    if (p.vx * tx + p.vy * ty > -60) { p.vx += tx * ROPE_PUMP * dt; p.vy += ty * ROPE_PUMP * dt; }
  }

  function rideLift(p) { return p.ride ? RIDES[p.ride.k].lift : 0; }

  function endRide(g, why) {
    const p = g.p;
    if (!p.ride) return;
    emit(g, 'unride', p.x, p.y, { k: p.ride.k, why: why });
    p.ride = null;
  }

  /**
   * 着地のすぐ手前か。そこでおした分は、2 だんジャンプではなく、着地したらすぐ跳ぶ (先おし) に回す。
   * 足もとのすぐ下に床があって、落ちているときだけ。
   */
  function nearLanding(g, p) {
    if (p.vy <= 0) return false;
    let base;
    if (p.inside >= 0) base = g.world.b[p.inside].floorY;
    else {
      const b = buildingAt(g.world, p.x); if (!b) return false; base = b.roofY;
      for (const dk of b.decks || []) if (p.x >= dk.x0 && p.x <= dk.x1 && dk.y >= p.y - 2) base = Math.min(base, dk.y);
    }
    const d = base - p.y;
    return d >= -2 && d < Math.max(14, p.vy * 0.12);
  }

  /** 乗っているあいだの時間と、降りる条件 (時間切れ・地上の道の終わりが近い・屋内)。 */
  function stepRide(g, dt) {
    const p = g.p;
    if (!p.ride) return;
    p.ride.t -= dt;
    if (p.ride.t <= 0) { endRide(g, 'time'); return; }
    const w = g.world, j = indexNear(w, p.x), b = w.b[j], nb = w.b[j + 1];
    if (p.inside >= 0 || !b || !b.ground || (nb && !nb.ground && p.x > b.x + b.w - 160)) endRide(g, 'exit');
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
    } else if (it.t === 'gem') {
      const G = GEMS[it.k];
      g.gems += G.value;
      g.gemKinds[it.k] = (g.gemKinds[it.k] || 0) + 1;
      emit(g, 'gem', it.x, it.y, { k: it.k, n: G.value });
    } else if (RIDES[it.t]) {
      p.ride = { k: it.t, t: RIDES[it.t].sec };
      emit(g, 'ride', it.x, it.y, { k: it.t });
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
    stepRide(g, dt);
    // ロープ: ボタンをおすとつかまり、はなすとはなれる (ジャンプをおしても、上へ飛んではなれる)
    if (p.rope) {
      if (!I.grabHeld || p.stun > 0) endRope(g, 'let', 0);
      else if (I.jumpBuf > 0) { I.jumpBuf = 0; endRope(g, 'jump', 460); }
      else if (p.rope.t > ROPE_MAX_T || ropeDeg(p) > ROPE_TOP) endRope(g, 'auto', 0);
    } else if (I.grabBuf > 0 && I.grabHeld && !p.carry && !(p.onGround && nearProp(g))) {
      const h = nearHook(g);
      if (h) { I.grabBuf = 0; startRope(g, h); }
    }
    if (p.rope) {
      stepRopeLength(g, dt);
      pumpRope(g, dt);
    } else if (!p.onGround && p.dash > 0) {
      // ロープからはなれて飛んでいる間は、ふりの勢いのまま (横の速さを上書きしない)
      p.vx = Math.max(p.vx, speedAt(p.x));
    } else {
      if (p.dash > 0) p.dash = Math.max(0, p.dash - dt);
      const dashK = 1 + (ROPE_DASH - 1) * (p.dash / DASH_T);
      p.vx = p.stun > 0 ? 0 : speedAt(p.x) * (p.ride ? RIDES[p.ride.k].speed : 1) * dashK;
    }
    if (p.onGround) p.ground = 0.1; else p.ground -= dt;
    if (p.rope) {
      // ぶらさがり中は、ジャンプの受けつけはしない (おしたぶんは、上の「はなれる」になる)
    } else if (I.jumpBuf > 0 && p.ground > 0 && p.stun <= 0) {
      p.vy = -JUMP_V * g.jumpK; p.ground = 0; p.onGround = false; p.jumping = true; I.jumpBuf = 0;
      emit(g, 'jump', p.x, p.y);
    } else if (I.jumpBuf > 0 && p.ground <= 0 && !p.onGround && !p.air2 && p.airT > AIR_JUMP_AFTER && p.stun <= 0 && !nearLanding(g, p)) {
      // 2 だんジャンプ: 空中で、もう一度おす (もとのジャンプよりすこし低い)
      p.vy = -JUMP_V * g.jumpK * AIR_JUMP_K; p.air2 = true; p.jumping = true; p.jumps2++; I.jumpBuf = 0;
      emit(g, 'jump2', p.x, p.y);
    }
    if (!I.jumpHeld && p.jumping && p.vy < -CUT_V) p.vy = -CUT_V;
    const was = p.onGround;
    stepBody(g, p, dt);
    if (p.rope) {
      if (p.onGround && p.rope.t > 0.15) endRope(g, 'land', 0);
      else constrainRope(g);
    }
    p.airT = p.onGround ? 0 : p.airT + dt;
    if (p.onGround) {
      if (!was) emit(g, 'land', p.x, p.y);
      p.jumping = false; p.air2 = false;
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
    const gun = curGun(g);
    if (p.gunPrev !== gun.id) { p.gunPrev = gun.id; p.hold = 0; p.charge = 0; }
    const trigger = I.fireHeld && !p.carry;
    p.hold = trigger ? p.hold + dt : 0;                   // 押しつづけた秒数 (離すと 0)
    if (gun.windup) {
      // ため撃ち: 押しつづけて「ため」が終わると撃つ。途中で離すとやりなおし
      if (trigger && p.cd <= 0 && g.water >= gun.cost * g.costK) {
        if (p.charge === 0) emit(g, 'charge', p.x, p.y, { gun: gun.id });
        p.charge += dt;
        if (p.charge >= gun.windup) { fireGun(g); p.charge = 0; }
      } else {
        p.charge = Math.max(0, p.charge - dt * 3);
        if (trigger && p.cd <= 0 && g.water < gun.cost * g.costK) { p.cd = 0.25; if (g.dryT <= 0) { emit(g, 'dry', p.x, p.y); g.dryT = 1; } }
      }
    } else if (trigger && p.cd <= 0) {
      if (g.water >= gun.cost * g.costK) fireGun(g);
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
        if (p.ride && RIDES[p.ride.k].shield) {                  // ラジコンカーは、ぶつかった敵をはね飛ばす
          defeat(g, e, false);
          emit(g, 'smash', e.x, e.y, { k: 'enemy' });
          continue;
        }
        g.over = 'caught';
        emit(g, 'caught', p.x, p.y);
        return;
      }
    }
    g.danger = danger;
  }

  /**
   * 1 つのボタン「アクション」が、いま何をするか (おしたときの決めかたと、同じ順番)。
   * 'roping' ぶらさがり中 / 'door' 入る / 'carry' なげる / 'grab' もつ / 'rope' ロープ / null なにもない
   */
  function actMode(g) {
    const p = g.p;
    if (p.rope) return 'roping';
    if (nearDoor(g)) return 'door';
    if (p.carry) return 'carry';
    if (nearProp(g)) return 'grab';
    if (nearHook(g)) return 'rope';
    return null;
  }

  /** ボタンの表示に使う状態。 */
  function hints(g) {
    return {
      door: !!nearDoor(g),
      act: actMode(g),
      grab: !!nearProp(g),
      rope: !!nearHook(g),
      roping: !!g.p.rope,
      carrying: g.p.carry
    };
  }

  return {
    // 定数
    G: G, JUMP_V: JUMP_V, CUT_V: CUT_V, KILL_Y: KILL_Y, FLOOR_OFF: FLOOR_OFF, THROW_G: THROW_G,
    PLAYER_HW: PLAYER_HW, PLAYER_H: PLAYER_H,
    GUNS: GUNS, GUN_BY_ID: GUN_BY_ID, PROPS: PROPS, RIDES: RIDES, GEMS: GEMS, GEM_Y: GEM_Y, DECK_H: DECK_H, DECK_END: DECK_END, ROPE_MAX_L: ROPE_MAX_L, ROPE_GEM_DEG: ROPE_GEM_DEG, ROPE_DASH: ROPE_DASH, GRIP_H: GRIP_H, HOOK_H: HOOK_H, nearHook: nearHook, UPGRADES: UPGRADES, gemCost: gemCost, ENEMIES: ENEMIES,
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
