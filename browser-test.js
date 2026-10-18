/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui      (全域に入っていれば NODE_PATH=$(npm root -g) でもよい)
 *
 * 画面まわりの不具合は node のテストでは捕まらない。ここでは本物の
 * ブラウザを立ち上げ、指の操作 (タップ・押しっぱなし・同時押し) を再現して確かめる。
 * 対象の端末は iPhone 16 Plus (430 x 932) だけ。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;   // 手元の Chromium を使いたいとき

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}

function skip(message) {
  console.log('  \x1b[90m- とばした: ' + message + '\x1b[0m');
}

function section(name) {
  console.log('\n' + name);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

// iPhone 16 Plus: 430 x 932 (3x)。playwright が端末名を知らなくても動くよう、値で持つ。
const PHONE = {
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ページの中で、谷・じゃま物をよけて自動で走らせる (人のかわり)。 */
async function installBot(page) {
  await page.evaluate(() => {
    if (window.__botInstalled) return;
    window.__botInstalled = true;
    window.__bot = { until: null, air: false };
    window.__auto = false;
    setInterval(() => {
      const g = window.__app && window.__app.game();
      if (!window.__auto || !g || g.over) return;
      const st = window.__bot, C = window.Core, p = g.p;
      if (st.air) {
        if (p.onGround) { st.air = false; st.until = null; C.input(g, 'jump', false); }
        else if (p.x >= st.until) { C.input(g, 'jump', false); return; }
        else return;
      }
      if (st.until == null) { const plan = C.jumpPlan(g, p, C.speedAt(p.x)); if (plan) st.until = plan.until; }
      if (st.until != null) { C.input(g, 'jump', true); st.air = true; }
    }, 8);
  });
}

async function freshPage(browser, extra) {
  const ctx = await browser.newContext(Object.assign({}, PHONE, extra || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__app);
  return { ctx, page, errors };
}

/** 画面のボタンの中心 (css px)。 */
async function center(page, sel) {
  return page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
}

/** CDP で本物のタッチを送る (複数の指を同時に押しっぱなしにできる)。 */
function touchTool(cdp) {
  const down = new Map();
  const send = (type) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: [...down.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y }))
  });
  return {
    async start(id, x, y) { down.set(id, { x, y }); await send('touchStart'); },
    async move(id, x, y) { down.set(id, { x, y }); await send('touchMove'); },
    async end(id) { down.delete(id); await send('touchEnd'); }
  };
}

async function run() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright  (または NODE_PATH=$(npm root -g))');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], { stdio: 'ignore' });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------------------ 開く
    section('スマホで開く (430 x 932)');
    let { ctx, page, errors: errs } = await freshPage(browser);
    errs.forEach((e) => errors.push(e));
    page.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
    ok(true, 'ページが開いて、画面のしくみが立ち上がる');
    await sleep(600);

    const fit = await page.evaluate(() => ({
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      high: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      title: document.title,
      padHidden: getComputedStyle(document.getElementById('pad')).display === 'none',
      hudHidden: getComputedStyle(document.getElementById('hud')).display === 'none',
      titleShown: getComputedStyle(document.getElementById('vTitle')).display !== 'none',
      shopHidden: getComputedStyle(document.getElementById('vShop')).display === 'none',
      mode: window.__app.state().mode,
      cvW: document.getElementById('cv').width,
      stageW: document.getElementById('stage').clientWidth
    }));
    ok(fit.wide <= 1 && fit.high <= 1, `横にも縦にもスクロールが出ない (${fit.wide}, ${fit.high})`);
    ok(fit.title === 'スパイ・コン', `題名が出ている (${fit.title})`);
    ok(fit.mode === 'title' && fit.titleShown && fit.padHidden && fit.hudHidden && fit.shopHidden,
      'タイトルでは、そうさボタン・HUD・ぶきやが隠れている (hidden が効く)');
    ok(fit.cvW >= fit.stageW * 2 - 2 && fit.cvW <= fit.stageW * 2 + 2, `キャンバスが実寸に合っている (${fit.cvW} / ${fit.stageW})`);

    // タイトルの背景で、自動で走っている (動いている絵が出る)
    const x0 = await page.evaluate(() => window.__app.demo().p.x);
    await sleep(700);
    const x1 = await page.evaluate(() => window.__app.demo().p.x);
    ok(x1 - x0 > 100, `タイトルの背景でスパイが走っている (+${Math.round(x1 - x0)}px)`);

    // タイトルの絵 (題字と主人公をひとつにした絵) が読み込めて、ボタンと重ならず、後ろのゲーム画面を隠さない
    await page.waitForFunction(() => window.Art && window.Art.spritesReady(), null, { timeout: 5000 }).catch(() => {});
    const hero = await page.evaluate(() => {
      const el = document.getElementById('titleLogo');
      const im = el.getBoundingClientRect();
      const play = document.getElementById('btnPlay').getBoundingClientRect();
      return { ok: el.complete && el.naturalWidth > 0, top: im.top, bottom: im.bottom, left: im.left, right: im.right, playTop: play.top, w: innerWidth, h: innerHeight, sprites: window.Art.spritesReady() };
    });
    ok(hero.ok && hero.sprites, '題字+主人公の絵と、ゲーム中の主人公の絵が読み込めている');
    ok(hero.bottom <= hero.playTop + 1 && hero.top >= 0 && hero.left >= -6 && hero.right <= hero.w + 6, `タイトルの絵が「あそぶ」に重ならず、画面に収まる (下 ${Math.round(hero.bottom)} <= ${Math.round(hero.playTop)})`);
    const open = hero.playTop - hero.bottom;
    ok(open >= 200, `絵と「あそぶ」のあいだに、後ろのゲーム画面が見える 200px 以上の空きがある (${Math.round(open)}px)`);
    // その空きの、タイトルのまんなかの点を押すと、前に何も重なっていない (=ゲーム画面がそのまま見えている)
    const free = await page.evaluate(({ y }) => {
      const out = [];
      for (const x of [60, 215, 370]) { const e = document.elementFromPoint(x, y); out.push(e ? (e.id || e.className || e.tagName) : null); }
      return out;
    }, { y: (hero.bottom + hero.playTop) / 2 });
    ok(free.every((n) => n === 'vTitle' || n === 'cv'), `空きには、絵もボタンも重なっていない (${free.join(', ')})`);
    // その空きの画素が、ゲーム画面の絵 (ビルや空) で、題字の絵ではない: 空きの帯に、窓の黄色い画素がある
    const seen = await page.evaluate(({ y0, y1 }) => {
      const cv = document.getElementById('cv'), c = cv.getContext('2d'), k = cv.width / innerWidth;
      const d = c.getImageData(0, Math.round(y0 * k), cv.width, Math.max(1, Math.round((y1 - y0) * k))).data;
      let colors = new Set();
      for (let i = 0; i < d.length; i += 4 * 37) colors.add((d[i] >> 5) + ',' + (d[i + 1] >> 5) + ',' + (d[i + 2] >> 5));
      return colors.size;
    }, { y0: hero.bottom + 4, y1: hero.playTop - 4 });
    ok(seen >= 6, `空きの帯に、ゲーム画面の絵 (空・ビル・主人公) が描かれている (色の種類 ${seen})`);

    // ------------------------------------------------------------ はじめる
    section('あそぶ');
    await page.locator('#btnPlay').tap();
    await page.waitForFunction(() => window.__app.state().mode === 'play');
    await sleep(200);
    const play0 = await page.evaluate(() => {
      const hud = getComputedStyle(document.getElementById('hud')).display;
      const pad = getComputedStyle(document.getElementById('pad')).display;
      return { hud, pad, gun: document.getElementById('hGunName').textContent, bombs: document.getElementById('bombN').textContent };
    });
    ok(play0.hud !== 'none' && play0.pad !== 'none', 'HUD とそうさボタンが出る');
    ok(play0.gun.length > 0 && play0.bombs === '3', `持っている水でっぽう (${play0.gun}) と水ばくだん (${play0.bombs})`);
    const xs = await page.evaluate(() => window.__app.game().p.x);
    await sleep(500);
    const xs2 = await page.evaluate(() => window.__app.game().p.x);
    ok(xs2 - xs > 60, `スパイが自動で走る (+${Math.round(xs2 - xs)}px / 0.5秒)`);
    // 主人公のキツネが実際に描かれている (オレンジ色の毛の画素が、スパイの位置に出る)
    const orange = await page.evaluate(() => {
      const a = window.__app.state(), g = window.__app.game(), cv = document.getElementById('cv');
      const c = cv.getContext('2d');
      const cam = a.camPlay, S = a.S;
      const x0 = Math.max(0, Math.floor((g.p.x - 30 - cam.x) * S)), y0 = Math.max(0, Math.floor((g.p.y - 70 - cam.y) * S));
      const w = Math.floor(70 * S), h = Math.floor(80 * S);
      const d = c.getImageData(x0, y0, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 1] > 90 && d[i + 1] < 175 && d[i + 2] < 70) n++;
      return n;
    });
    ok(orange > 150, `スパイの位置にキツネの毛の色が描かれている (オレンジの画素 ${orange})`);
    await page.evaluate(() => window.__app.show('title'));
    await ctx.close();

    // ------------------------------------------------------------ ボタンの配置・反応
    section('そうさボタンが、押せる位置にある');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('ボタン: ' + e.message));
    await installBot(page);
    await page.evaluate(() => window.__app.start({ seed: 21, noEnemies: true }));
    await sleep(150);
    const ids = ['bJump', 'bFire', 'bBomb', 'bAct', 'hGun', 'btnPause'];
    const rects = await page.evaluate((list) => list.map((id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { id, x: r.left, y: r.top, w: r.width, h: r.height, onTop: top === el || el.contains(top), vw: innerWidth, vh: innerHeight };
    }), ids);
    ok(rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= r.vw && r.y + r.h <= r.vh), '全部のボタンが画面の中に収まっている');
    ok(rects.every((r) => r.w >= 44 && r.h >= 44), `どれも 44pt 以上 (最小 ${Math.round(Math.min(...rects.map((r) => Math.min(r.w, r.h))))}pt)`);
    ok(rects.every((r) => r.onTop), '真ん中を押すと、ちゃんとそのボタンに当たる (上に何も重なっていない)');
    let overlap = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap++;
    }
    ok(overlap === 0, `ボタンどうしが重ならない (${overlap} 組)`);
    const bigGap = rects.find((r) => r.id === 'bJump'), fireR = rects.find((r) => r.id === 'bFire');
    ok(bigGap.x + bigGap.w < 215 && fireR.x > 215, 'ジャンプは左の親指、うつは右の親指の側にある');

    // 安全域 (iPhone: 上 59 / 下 34) を差し込んでも、中身が切れない
    await page.addStyleTag({ content: '#app{padding-top:59px !important;padding-bottom:34px !important}' });
    await sleep(200);
    const safe = await page.evaluate(() => {
      const pad = document.getElementById('pad').getBoundingClientRect();
      const hud = document.getElementById('hDist').getBoundingClientRect();
      return { padBottom: pad.bottom, vh: innerHeight, hudTop: hud.top, sh: document.documentElement.scrollHeight };
    });
    ok(safe.padBottom <= safe.vh - 34 + 0.5 && safe.hudTop >= 59, `安全域ぶんの余白を入れても収まる (下 ${Math.round(safe.padBottom)} <= ${safe.vh - 34}, 上 ${Math.round(safe.hudTop)} >= 59)`);
    ok(safe.sh <= safe.vh + 1, `ページが縦にはみ出さない (${safe.sh} <= ${safe.vh})`);

    // ------------------------------------------------------------ ジャンプ
    section('ジャンプ (タッチ)');
    const cdp = await ctx.newCDPSession(page);
    const touch = touchTool(cdp);
    const jb = await center(page, '#bJump');
    // 谷もじゃま物も無い、まっすぐの所に置く (最初のビルの左はし)
    const setStraight = () => page.evaluate(() => {
      const g = window.__app.game();
      g.p.x = 30; g.p.y = 0; g.p.vy = 0; g.p.onGround = true; g.p.stun = 0; g.p.inv = 0; g.p.jumping = false;
      g.in.jumpHeld = false;
    });
    const measureJump = async (holdMs) => {
      await setStraight();
      await sleep(60);
      await touch.start(1, jb.x, jb.y);
      let peak = 0;
      const t0 = Date.now();
      while (holdMs > 0 && Date.now() - t0 < holdMs) { await sleep(8); }
      await touch.end(1);
      for (let i = 0; i < 30; i++) {
        const y = await page.evaluate(() => window.__app.game().p.y);
        peak = Math.max(peak, -y);
        await sleep(16);
      }
      return peak;
    };
    const tapPeak = await measureJump(0);
    const holdPeak = await measureJump(300);
    ok(tapPeak > 15 && tapPeak < 98, `ちょんと押すと低く跳ぶ (高さ ${Math.round(tapPeak)})`);
    ok(holdPeak > tapPeak + 25 && holdPeak > 110, `押しつづけるほど高く跳ぶ (ちょん ${Math.round(tapPeak)} < 長押し ${Math.round(holdPeak)})`);

    // 指を画面の外へすべらせて離しても、ジャンプが押しっぱなしにならない
    await setStraight();
    await touch.start(2, jb.x, jb.y);
    await sleep(60);
    await touch.move(2, jb.x - 200, jb.y - 400);
    await touch.end(2);
    await sleep(80);
    const stuck = await page.evaluate(() => window.__app.game().in.jumpHeld);
    ok(stuck === false, 'ボタンから指をすべらせて離すと、ちゃんと離したことになる');
    // マウス (パソコン) でも、押したままボタンの外へ出て離したら、押しっぱなしにならない
    await setStraight();
    await page.mouse.move(jb.x, jb.y);
    await page.mouse.down();
    await sleep(60);
    const heldNow = await page.evaluate(() => window.__app.game().in.jumpHeld);
    await page.mouse.move(jb.x + 150, jb.y - 500, { steps: 4 });
    await page.mouse.up();
    await sleep(80);
    const stuck2 = await page.evaluate(() => window.__app.game().in.jumpHeld);
    ok(heldNow === true && stuck2 === false, 'マウスで押したままボタンの外へ出て離しても、ちゃんと離したことになる');

    // ------------------------------------------------------------ うつ・同時押し
    section('うつ・ばくだん・同時押し');
    await page.evaluate(() => { window.__app.game().water = 100; });
    const fb = await center(page, '#bFire');
    await setStraight();
    await touch.start(3, fb.x, fb.y);
    await sleep(350);
    const shot = await page.evaluate(() => ({ water: window.__app.game().water, held: window.__app.game().in.fireHeld }));
    ok(shot.held && shot.water < 99, `押している間、水を撃つ (水 ${shot.water.toFixed(1)})`);
    // 撃ちながらジャンプ (2 本の指)
    await touch.start(4, jb.x, jb.y);
    await sleep(120);
    const both = await page.evaluate(() => ({ jump: window.__app.game().in.jumpHeld, fire: window.__app.game().in.fireHeld, air: !window.__app.game().p.onGround }));
    ok(both.jump && both.fire && both.air, '撃ちながらジャンプできる (2 本の指を同時に)');
    await touch.end(3);
    await touch.end(4);
    await sleep(80);
    const rel = await page.evaluate(() => ({ jump: window.__app.game().in.jumpHeld, fire: window.__app.game().in.fireHeld }));
    ok(!rel.jump && !rel.fire, '指を離すとどちらも止まる');
    await page.locator('#bBomb').tap();
    await sleep(100);
    const bombs = await page.evaluate(() => window.__app.game().bombs);
    ok(bombs === 2, `水ばくだんをタップすると 1 つ減る (残り ${bombs})`);
    await ctx.close();

    // ------------------------------------------------------------ ビルの中・もの
    section('ビルの中に入る・物をもって投げる');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('ドア: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 21, noEnemies: true }));
    // ドアの手前へ
    await page.evaluate(() => {
      const g = window.__app.game();
      const b = g.world.b.find((q) => q.door && q.x > 300);
      window.__doorB = b.i;
      g.p.x = b.doorX - 60; g.p.y = b.roofY; g.p.vy = 0; g.p.onGround = true;
    });
    const glow0 = await page.evaluate(() => (document.getElementById('bAct').classList.contains('glow') && document.getElementById('actLb').textContent === '入る'));
    ok(glow0 === false, 'ドアから遠いとき、入るボタンは光らない');
    await page.waitForFunction(() => (document.getElementById('bAct').classList.contains('glow') && document.getElementById('actLb').textContent === '入る'), null, { timeout: 2000 }).catch(() => {});
    const glow1 = await page.evaluate(() => (document.getElementById('bAct').classList.contains('glow') && document.getElementById('actLb').textContent === '入る'));
    ok(glow1 === true, 'ドアに近づくと、入るボタンが光る');
    await page.locator('#bAct').tap();
    await page.waitForFunction(() => window.__app.game().p.inside >= 0, null, { timeout: 1500 }).catch(() => {});
    const inside = await page.evaluate(() => window.__app.game().p.inside);
    ok(inside === await page.evaluate(() => window.__doorB), `タップするとビルの中に入る (inside=${inside})`);
    // 中を抜けて出口から出る
    await installBot(page);
    await page.evaluate(() => { window.__auto = true; });
    await page.waitForFunction(() => window.__app.game().p.inside < 0, null, { timeout: 5000 }).catch(() => {});
    const outside = await page.evaluate(() => ({ inside: window.__app.game().p.inside, over: window.__app.game().over }));
    ok(outside.inside === -1 && !outside.over, `出口から屋上へ出る (over=${outside.over})`);
    await page.evaluate(() => { window.__auto = false; });

    // もの
    await page.evaluate(() => {
      const g = window.__app.game();
      const b = g.world.b[0];
      g.p.x = b.roof.props[0].x - 50; g.p.y = b.roofY; g.p.vy = 0; g.p.onGround = true; g.p.inside = -1;
      g.p.stun = 0; g.p.inv = 0; g.p.carry = null;
    });
    await page.waitForFunction(() => (document.getElementById('bAct').classList.contains('glow') && document.getElementById('actLb').textContent === 'もつ'), null, { timeout: 2000 }).catch(() => {});
    await page.locator('#bAct').tap();
    await page.waitForFunction(() => window.__app.game().p.carry, null, { timeout: 1500 }).catch(() => {});
    const carried = await page.evaluate(() => ({ c: window.__app.game().p.carry, label: document.getElementById('actLb').textContent }));
    ok(!!carried.c && carried.label === 'なげる', `近づいてタップするともてる。ボタンが「なげる」に変わる (${carried.c} / ${carried.label})`);
    await page.locator('#bAct').tap();
    await page.waitForFunction(() => !window.__app.game().p.carry, null, { timeout: 1500 }).catch(() => {});
    const thrown = await page.evaluate(() => ({ c: window.__app.game().p.carry, n: window.__app.game().thrown.length, label: document.getElementById('actLb').textContent }));
    ok(!thrown.c && thrown.n >= 1 && /^(もつ|アクション)$/.test(thrown.label), `もう一度タップすると投げる。ボタンは「なげる」でなくなる (投げ物 ${thrown.n})`);
    const ic = await page.evaluate(() => document.getElementById('actIc').textContent.length);
    ok(ic > 0, 'ボタンの名前を変えても、中の絵が残っている');
    await ctx.close();

    // ------------------------------------------------------------ ステージ (200m ごと・終わりなし)
    section('ステージ (200m ごとに進む・終わりが無い)');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('ステージ: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 21, noEnemies: true }));
    await installBot(page);
    await page.evaluate(() => {
      window.__auto = false;
      const g = window.__app.game();
      g.enemies.length = 0; g.spawnT = 999;
      window.Core.ensure(g.world, 9000);
      const b = g.world.b.find((q) => q.x + q.w > 7700 && q.x < 7850);
      g.p.x = Math.max(b.x + 20, 7700); g.p.y = b.roofY; g.p.vy = 0; g.p.onGround = true; g.p.inside = -1; g.p.stun = 0;
      g.stage = 1; g.water = 20; g.bombs = 1; window.__coins0 = g.coins;
      window.__bot.until = null; window.__bot.air = false;
    });
    const stg0 = await page.evaluate(() => ({ t: document.getElementById('hStage').textContent, bg: getComputedStyle(document.getElementById('stage')).backgroundImage }));
    ok(stg0.t === 'ステージ 1', `いまのステージが HUD に出る (${stg0.t})`);
    await page.evaluate(() => { window.__auto = true; });
    await page.waitForFunction(() => window.__app.game().stage === 2, null, { timeout: 8000 }).catch(() => {});
    const stg1 = await page.evaluate(() => {
      const g = window.__app.game();
      const b = document.getElementById('stageBanner');
      return { stage: g.stage, over: g.over, text: document.getElementById('hStage').textContent, anim: b.getAnimations().length, sb: document.getElementById('sbName').textContent,
        coins: g.coins - window.__coins0, water: g.water, bombs: g.bombs };
    });
    ok(stg1.stage === 2 && !stg1.over, `200m を過ぎると、止まらずステージ 2 に入る (over=${stg1.over})`);
    ok(stg1.anim > 0 && stg1.sb === 'ステージ 2', `「ステージ 2」の札が出る (${stg1.sb})`);
    ok(stg1.coins >= 15 && stg1.water > 80 && stg1.bombs >= 2, `ごほうび: コイン +${stg1.coins}・水まんたん (${Math.round(stg1.water)})・ばくだん ${stg1.bombs}`);
    await page.waitForTimeout(1500);
    const stg2 = await page.evaluate(() => ({ t: document.getElementById('hStage').textContent, bg: getComputedStyle(document.getElementById('stage')).backgroundImage, op: getComputedStyle(document.getElementById('sky2')).opacity }));
    ok(stg2.t === 'ステージ 2' && stg2.bg !== stg0.bg && stg2.op === '0', `空の色がステージ 2 のものに変わる (${stg2.bg.slice(16, 46)})`);
    // 地上ステージ (ステージ 2): 谷の無い道を走り、街並みが出て、終わると屋上へもどる
    await page.waitForFunction(() => { const g = window.__app.game(), b = window.Core.buildingAt(g.world, g.p.x); return b && b.ground && g.p.onGround; }, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    const street = await page.evaluate(() => {
      const g = window.__app.game(), a = window.__app.state(), b = window.Core.buildingAt(g.world, g.p.x);
      return { ground: !!(b && b.ground), facade: a.view.facade, stage: g.stage, over: g.over, gaps: g.world.b.filter((q, i) => i > 0 && q.ground && g.world.b[i - 1].ground && q.x !== g.world.b[i - 1].x + g.world.b[i - 1].w).length };
    });
    ok(street.ground && !street.over, `ステージ 2 は地上の道を走る (over=${street.over})`);
    ok(street.facade > 0.9, `地上ステージでは、背景に街並みが出る (${street.facade.toFixed(2)})`);
    ok(street.gaps === 0, `道の区画のあいだに谷が無い (つなぎ目のずれ ${street.gaps})`);
    await page.evaluate(() => {
      window.__auto = false;
      const g = window.__app.game();
      const endX = 2 * window.Core.STAGE_PX;
      window.Core.ensure(g.world, endX + 4000);
      const b = window.Core.buildingAt(g.world, endX - 700);
      g.p.x = endX - 700; g.p.y = b.roofY; g.p.vy = 0; g.p.onGround = true; g.p.stun = 0; g.p.inv = 0; g.enemies.length = 0; g.spawnT = 999;
      window.__bot.until = null; window.__bot.air = false; window.__auto = true;
    });
    await page.waitForFunction(() => window.__app.game().stage === 3, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => window.__app.game().p.onGround || window.__app.game().over, null, { timeout: 3000 }).catch(() => {});   // 谷を跳んでいる最中に測らない
    const back = await page.evaluate(() => { const g = window.__app.game(), b = window.Core.buildingAt(g.world, g.p.x); return { stage: g.stage, over: g.over, facade: window.__app.state().view.facade, roof: !!(b && !b.ground), text: document.getElementById('hStage').textContent }; });
    ok(back.stage === 3 && !back.over && back.roof, `道のおわりで次のステージ (屋上) へ移れる (stage ${back.stage}, over=${back.over})`);
    ok(back.facade < 0.1, `屋上にもどると街並みは消える (${back.facade.toFixed(2)})`);
    // ずっと先 (ステージ 40 ほど) でも、ふつうに遊べる
    await page.evaluate(() => {
      window.__auto = false;
      const g = window.__app.game();
      const x = 40 * 200 * 39 + 100;
      window.Core.ensure(g.world, x + 3000);
      const b = g.world.b[window.Core.indexNear(g.world, x)];
      g.p.x = b.x + 20; g.p.y = b.roofY; g.p.vy = 0; g.p.onGround = true; g.p.stun = 0; g.p.inv = 0; g.enemies.length = 0;
      window.__bot.until = null; window.__bot.air = false; window.__auto = true;
    });
    await page.waitForTimeout(3000);
    const far = await page.evaluate(() => ({ stage: window.__app.game().stage, over: window.__app.game().over, text: document.getElementById('hStage').textContent }));
    ok(far.stage >= 40 && !far.over, `ステージ ${far.stage} でもふつうに遊べる (「${far.text}」)`);
    await ctx.close();

    // ------------------------------------------------------------ 追ってくる敵
    section('敵・つかまる・結果');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('敵: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 5 }));
    const enemyInfo = await page.evaluate(() => {
      const g = window.__app.game();
      return g.enemies.map((e) => ({ type: e.type, d: g.p.x - e.x }));
    });
    ok(enemyInfo.length >= 1 && enemyInfo[0].d > 100 && enemyInfo[0].d < 260, `はじめから敵が後ろにいる (${enemyInfo.map((e) => e.type + ' ' + Math.round(e.d) + 'px').join(', ')})`);
    // 跳ばずに走る → 敵か谷でおわる。結果の画面が出る
    await page.waitForFunction(() => window.__app.state().mode === 'result', null, { timeout: 30000 }).catch(() => {});
    const res = await page.evaluate(() => ({
      mode: window.__app.state().mode,
      over: window.__app.game().over,
      shown: getComputedStyle(document.getElementById('vResult')).display !== 'none',
      title: document.getElementById('rTitle').textContent,
      dist: document.getElementById('rDist').textContent,
      saved: window.__app.save().coins
    }));
    ok(res.mode === 'result' && res.shown, `おわると結果の画面が出る (${res.over})`);
    ok(res.title.length > 0 && /^\d+$/.test(res.dist), `結果に題と距離が出る (${res.title} / ${res.dist}m)`);
    const rs = await page.evaluate(() => document.getElementById('rStage').textContent);
    ok(/^\d+$/.test(rs) && Number(rs) >= 1, `結果に、たどりついたステージが出る (ステージ ${rs})`);
    await page.locator('#btnAgain').tap();
    await page.waitForFunction(() => window.__app.state().mode === 'play');
    const again = await page.evaluate(() => ({ over: window.__app.game().over, x: window.__app.game().p.x }));
    ok(!again.over && again.x < 50, 'もういちどで最初からやり直せる');
    await ctx.close();

    // 最後の一撃 (勝ち) など: 敵を倒すと数えられる
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('撃破: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 5 }));
    await installBot(page);
    await page.evaluate(() => { window.__auto = true; window.__app.press('fire', true); });
    await page.waitForFunction(() => window.__app.game().kills >= 1, null, { timeout: 8000 }).catch(() => {});
    const kills = await page.evaluate(() => ({ k: window.__app.game().kills, c: window.__app.game().coins, hud: document.getElementById('hCoins').textContent }));
    ok(kills.k >= 1 && kills.c >= 1, `うつと敵をたおせる (たおした ${kills.k} / コイン ${kills.c})`);
    await sleep(200);
    ok(Number(await page.evaluate(() => document.getElementById('hCoins').textContent)) === await page.evaluate(() => window.__app.game().coins), 'HUD のコインが中身と合っている');
    await ctx.close();

    // ------------------------------------------------------------ 敵の絵
    section('敵 (動物スパイ 4 人) の絵が描かれている');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('敵の絵: ' + e.message));
    await page.waitForFunction(() => ['suit', 'dog', 'big', 'drone'].every((k) => window.Art.enemySpritesReady(k)), null, { timeout: 8000 }).catch(() => {});
    const ready = await page.evaluate(() => ['suit', 'dog', 'big', 'drone'].map((k) => window.Art.enemySpritesReady(k)));
    ok(ready.every(Boolean), `4 人ぶんの絵 (くろねこ・ジャックラッセル・ヒグマ・コウモリ) が読み込めている (${ready.join(',')})`);
    await page.evaluate(() => window.__app.start({ seed: 5, noEnemies: true }));
    for (const type of ['suit', 'dog', 'big', 'drone']) {
      const px = await page.evaluate(async (ty) => {
        const g = window.__app.game(), a = window.__app.state();
        g.noEnemies = true; g.p.stun = 99; g.p.inv = 99; g.enemies.length = 0;
        const b = window.Core.buildingAt(g.world, g.p.x);
        const e = window.Core.spawnEnemy(g, ty, g.p.x + 150);
        e.x = g.p.x + 150; e.y = ty === 'drone' ? b.roofY - 26 : b.roofY; e.vy = 0; e.hp = e.maxhp = 999; e.stun = 99;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const cv = document.getElementById('cv'), c = cv.getContext('2d'), S = a.S, cam = a.camPlay;
        const x0 = Math.floor((e.x - 45 - cam.x) * S), y0 = Math.floor((e.y - 90 - cam.y) * S), w = Math.floor(90 * S), h = Math.floor(90 * S);
        const d = c.getImageData(Math.max(0, x0), Math.max(0, y0), w, h).data;
        // 空 (なめらかなグラデーション) とちがう画素を数える: まわりの 4 隅の色との差
        const ref = [d[0], d[1], d[2]];
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - ref[0]) + Math.abs(d[i + 1] - ref[1]) + Math.abs(d[i + 2] - ref[2]) > 90 && d[i + 3] > 0) n++;
        g.enemies.length = 0;
        return n;
      }, type);
      ok(px > 1500, `${type}: 敵の絵が描かれている (空と違う画素 ${px})`);
    }
    await ctx.close();

    // ------------------------------------------------------------ 水でっぽうの違い
    section('水でっぽうごとの違い (音・反動・くせの札)');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('銃の違い: ' + e.message));
    const feat = await page.evaluate(async () => {
      const out = {};
      for (const id of Object.keys(window.Sfx.GUN)) {
        for (const ramp of (id === 'gatling' ? [0, 1] : [0])) {
          const d = await window.Sfx.renderOffline('GUN', id, { ramp }, 0.6);
          let pk = 0, e = 0, zc = 0; const n = d.length;
          for (let i = 0; i < n; i++) { const v = d[i]; pk = Math.max(pk, Math.abs(v)); e += v * v; if (i && (v >= 0) !== (d[i - 1] >= 0)) zc++; }
          let end = 0; for (let i = n - 1; i >= 0; i--) if (Math.abs(d[i]) > pk * 0.03) { end = i; break; }
          out[id + (id === 'gatling' ? ramp : '')] = { peak: pk, zcr: zc / (n / 22050), len: end / 22050 };
        }
      }
      for (const nm of Object.keys(window.Sfx.EXTRA)) {
        const d = await window.Sfx.renderOffline('EXTRA', nm, {}, 0.6); let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v)); out['x:' + nm] = { peak: pk };
      }
      return { out, ids: Object.keys(window.Core.GUN_BY_ID), recipes: Object.keys(window.Sfx.GUN) };
    });
    const f = feat.out;
    ok(feat.ids.every((id) => feat.recipes.includes(id)) && feat.recipes.length === feat.ids.length, `13 丁ぜんぶに、専用の音がある (${feat.recipes.length} / ${feat.ids.length})`);
    const peaks = Object.entries(f).map(([k, v]) => [k, v.peak]);
    ok(peaks.every(([, pk]) => pk >= 0.1 && pk <= 0.9), `どの音も、小さすぎず割れない大きさ (最小 ${Math.min(...peaks.map((x) => x[1])).toFixed(2)} / 最大 ${Math.max(...peaks.map((x) => x[1])).toFixed(2)})`);
    ok(f.sniper.peak > f.mizu.peak * 2.2 && f.shot.peak > f.mizu.peak * 2.2 && f.bazooka.peak > f.mizu.peak * 2, `重い銃 (スナイパー・ショットガン・バズーカ) は、ふつうの銃の 2 倍以上おおきく鳴る (${(f.sniper.peak / f.mizu.peak).toFixed(1)} / ${(f.shot.peak / f.mizu.peak).toFixed(1)} / ${(f.bazooka.peak / f.mizu.peak).toFixed(1)} 倍)`);
    ok(f.gatling1.zcr > f.gatling0.zcr * 1.3, `マシンガンは、加速するほど音が高くなる (${Math.round(f.gatling0.zcr)} → ${Math.round(f.gatling1.zcr)})`);
    const keys = Object.keys(f).filter((k) => !k.startsWith('x:') && k !== 'gatling1');
    let same = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = f[keys[i]], b = f[keys[j]];
      const differs = Math.abs(Math.log(a.zcr / b.zcr)) > 0.12 || Math.abs(a.len - b.len) > 0.02 || Math.abs(Math.log(a.peak / b.peak)) > 0.3;
      if (!differs) same.push(keys[i] + '/' + keys[j]);
    }
    ok(same.length === 0, `どの 2 丁を比べても、音の高さ・長さ・大きさのどれかがはっきり違う (似すぎ: ${same.join(', ') || 'なし'})`);

    // 反動と、くせの札
    await page.evaluate(() => window.__app.start({ seed: 21, noEnemies: true }));
    const kick = await page.evaluate(async () => {
      const g = window.__app.game(), a = window.__app.state();
      const res = {};
      for (const id of ['mizu', 'sniper', 'bazooka']) {
        g.guns = window.Core.GUNS.map((x) => x.id); g.gunIdx = g.guns.indexOf(id); g.water = 100; g.p.cd = 0; g.p.charge = 0; a.shake = 0;
        window.__app.press('fire', true);
        let mx = 0; const t0 = performance.now();
        while (performance.now() - t0 < 900) { await new Promise((r) => setTimeout(r, 16)); mx = Math.max(mx, a.shake); }
        window.__app.press('fire', false);
        res[id] = mx;
      }
      return res;
    });
    ok(kick.sniper > kick.mizu + 0.1 && kick.bazooka > kick.sniper, `重い銃ほど、撃つと画面がゆれる (ふつう ${kick.mizu.toFixed(2)} < スナイパー ${kick.sniper.toFixed(2)} < バズーカ ${kick.bazooka.toFixed(2)})`);
    // スナイパーの「ため」: 押している途中は撃たず、レーザーサイトが出る
    const charge = await page.evaluate(async () => {
      const g = window.__app.game();
      g.gunIdx = g.guns.indexOf('sniper'); g.water = 100; g.p.cd = 0; g.p.charge = 0; g.shots.length = 0;
      window.__app.press('fire', true);
      await new Promise((r) => setTimeout(r, 200));
      const mid = { ch: g.p.charge, shots: g.shots.length };
      window.__app.press('fire', false);
      await new Promise((r) => setTimeout(r, 200));
      return { mid, after: g.p.charge, shots: g.shots.length };
    });
    ok(charge.mid.ch > 0.1 && charge.mid.shots === 0 && charge.after < 0.05 && charge.shots === 0, `スナイパーは押している間「ため」(${charge.mid.ch.toFixed(2)})、離すと撃たずに消える`);
    await page.evaluate(() => window.__app.show('title'));
    await page.locator('#btnShop').tap();
    await page.waitForFunction(() => window.__app.state().mode === 'shop');
    const traits = await page.evaluate(() => [...document.querySelectorAll('.gcard')].map((c) => (c.querySelector('.gtrait') || {}).textContent || ''));
    ok(traits.length === 13 && traits.every((x) => x.length >= 4) && new Set(traits).size === 13, `ぶきやの 13 枚の札すべてに、ちがう「くせ」が出る (${traits.filter(Boolean).length} 枚)`);
    await ctx.close();

    // ------------------------------------------------------------ バク転・ロール
    section('バク転・ロール (見た目の動き)');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('バク転: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 21, noEnemies: true }));
    const settle = () => page.evaluate(async () => {
      const g = window.__app.game();
      g.p.x = 20; g.p.y = 0; g.p.vy = 0; g.p.onGround = true; g.p.stun = 0; g.p.inv = 0; g.p.jumping = false; g.in.jumpHeld = false;
      await new Promise((r) => setTimeout(r, 150));
      g.p.x = 20; g.p.y = 0; g.p.vy = 0; g.p.onGround = true;
      await new Promise((r) => setTimeout(r, 120));
    });
    // 押しつづけた高いジャンプ: 後ろへ 1 回転して、着地でちょうど元にもどる
    await settle();
    const fl = await page.evaluate(async () => {
      const a = window.__app.state().animPlay, g = window.__app.game();
      const f0 = a.flips, m0 = a.maxSpin;
      window.__app.press('jump', true);
      let mid = null;
      const t0 = performance.now();
      while (performance.now() - t0 < 1000) {
        await new Promise((r) => setTimeout(r, 16));
        if (performance.now() - t0 > 330 && mid == null) mid = a.spin;
        if (performance.now() - t0 > 450 && g.p.onGround) break;
      }
      window.__app.press('jump', false);
      await new Promise((r) => setTimeout(r, 250));
      return { flips: a.flips - f0, maxSpin: a.maxSpin, mid, end: a.spin, endTheta: a.theta, onGround: g.p.onGround };
    });
    ok(fl.flips === 1 && fl.maxSpin > Math.PI * 2 * 0.9, `押しつづけたジャンプで、後ろへ 1 回転する (${fl.flips} 回・最大 ${fl.maxSpin.toFixed(1)} rad / 1 回転 = 6.3)`);
    ok(fl.mid < -1 && Math.abs(fl.end) < 0.01 && fl.onGround, `空中ではかたむき (${fl.mid.toFixed(1)})、着地では元にもどる (${fl.end.toFixed(2)})`);
    // ちょん跳び: 回らない
    await settle();
    const tp = await page.evaluate(async () => {
      const a = window.__app.state().animPlay, g = window.__app.game();
      const f0 = a.flips; let mx = 0;
      window.__app.press('jump', true); window.__app.press('jump', false);
      const t0 = performance.now();
      while (performance.now() - t0 < 500) { await new Promise((r) => setTimeout(r, 16)); mx = Math.max(mx, Math.abs(a.spin)); }
      return { flips: a.flips - f0, mx };
    });
    ok(tp.flips === 0 && tp.mx < 0.05, `ちょん跳びは回らない (${tp.flips} 回・かたむき ${tp.mx.toFixed(2)})`);
    // 撃っているあいだは、体を起こして狙う
    await settle();
    const aim = await page.evaluate(async () => {
      const a = window.__app.state().animPlay;
      window.__app.press('jump', true);
      await new Promise((r) => setTimeout(r, 140));
      window.__app.press('fire', true);
      await new Promise((r) => setTimeout(r, 200));
      const during = Math.abs(a.spin);
      window.__app.press('fire', false); window.__app.press('jump', false);
      await new Promise((r) => setTimeout(r, 600));
      return during;
    });
    ok(aim < 1.0, `バク転の途中でも、撃つと体を起こす (かたむき ${aim.toFixed(2)})`);
    // 高いところからの着地は、前へロール
    await settle();
    const ro = await page.evaluate(async () => {
      const a = window.__app.state().animPlay, g = window.__app.game();
      const r0 = a.rolls; let mx = 0, sq = 1;
      g.p.y = -260; g.p.vy = 0; g.p.onGround = false; g.p.jumping = false;
      const t0 = performance.now();
      while (performance.now() - t0 < 900) { await new Promise((r) => setTimeout(r, 16)); mx = Math.max(mx, a.spin); sq = Math.min(sq, a.squash); }
      return { rolls: a.rolls - r0, mx, sq, end: a.spin };
    });
    ok(ro.rolls === 1 && ro.mx > 3 && ro.sq < 0.9 && Math.abs(ro.end) < 0.01, `高いところからの着地は、前へロール (${ro.rolls} 回・最大 ${ro.mx.toFixed(1)} rad・つぶれ ${ro.sq.toFixed(2)}・おわり ${ro.end.toFixed(2)})`);
    // ふつうの段差のおり (低い) では、ロールしない
    await settle();
    const lo = await page.evaluate(async () => {
      const a = window.__app.state().animPlay, g = window.__app.game();
      const r0 = a.rolls;
      g.p.y = -40; g.p.vy = 0; g.p.onGround = false; g.p.jumping = false;
      await new Promise((r) => setTimeout(r, 500));
      return a.rolls - r0;
    });
    ok(lo === 0, `低い段差のおりでは、ロールしない (${lo} 回)`);
    await ctx.close();

    // ------------------------------------------------------------ 2 だんジャンプ
    section('2 だんジャンプ');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('2だん: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 21, noEnemies: true }));
    await sleep(300);
    const dj = await page.evaluate(async () => {
      const g = window.__app.game(), A = window.__app.state().animPlay, w = (ms) => new Promise((r) => setTimeout(r, ms));
      g.p.x = 20; g.p.y = 0; g.p.vy = 0; g.p.onGround = true; g.p.stun = 0; g.p.inv = 0; g.p.air2 = false;
      await w(200);
      const ev = []; const j0 = g.p.jumps2; const m0 = A.maxSpin;
      window.__app.press('jump', true); await w(40); window.__app.press('jump', false);
      await w(220);
      const vy1 = g.p.vy, y1 = g.p.y;
      window.__app.press('jump', true); await w(40); window.__app.press('jump', false);
      await w(30);
      const vy2 = g.p.vy;
      let top = g.p.y;
      const t0 = performance.now();
      while (!g.p.onGround && performance.now() - t0 < 3000) { await w(16); top = Math.min(top, g.p.y); }
      return { n: g.p.jumps2 - j0, vy1, vy2, y1, top, landed: g.p.onGround, air2: g.p.air2, spin: A.maxSpin - m0 };
    });
    ok(dj.n === 1 && dj.vy2 < dj.vy1 - 150, `空中でおすと、もう一回跳べる (回数 ${dj.n} / 速さ ${Math.round(dj.vy1)} → ${Math.round(dj.vy2)})`);
    ok(dj.top < dj.y1 - 40, `2 だんめで、さらに高く上がる (${Math.round(dj.y1)} → 頂点 ${Math.round(dj.top)})`);
    ok(dj.landed && !dj.air2, '着地すると、また使える');
    ok(dj.spin > 3, `2 だんめでくるっと回る (回った角度 ${dj.spin.toFixed(1)} rad)`);
    await ctx.close();

    // ------------------------------------------------------------ 地上の乗り物
    section('スケボー・ラジコンカー (地上ステージ)');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('乗り物: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 11, noEnemies: true }));
    await sleep(300);
    const setStreet = (kind) => page.evaluate(({ kind }) => {
      const g = window.__app.game(), C = window.Core;
      C.ensure(g.world, 8000 * 3);
      const b = g.world.b.find((q) => q.ground);
      g.stage = 2; g.p.ride = null;
      g.p.x = b.x + 40; g.p.y = b.roofY; g.p.vy = 0; g.p.inside = -1; g.p.stun = 0; g.p.inv = 0; g.p.onGround = true;
      for (const q of g.world.b) q.roof.items.length = 0;
      b.roof.items.push({ x: b.x + 90, y: b.roofY - 22, t: kind });
      return b.x;
    }, { kind });
    // ひろうと乗る (スケボー)
    await page.evaluate(() => { window.__toasts = []; new MutationObserver(() => window.__toasts.push(document.getElementById('toast').textContent)).observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true }); });
    await setStreet('board');
    await sleep(400);
    const rb = await page.evaluate(() => { const g = window.__app.game(); return { ride: g.p.ride && g.p.ride.k, vx: g.p.vx, base: window.Core.speedAt(g.p.x) }; });
    ok(rb.ride === 'board' && rb.vx > rb.base * 1.25, `スケボーを拾うと乗って、速くなる (${rb.ride} / ${Math.round(rb.vx)} ← ${Math.round(rb.base)})`);
    const toastTxt = (await page.evaluate(() => window.__toasts)).join(' | ');
    ok(/スケボー/.test(toastTxt), `乗ったことが画面に出る (${toastTxt.replace(/\n/g, ' ')})`);
    await sleep(900);
    const rb2 = await page.evaluate(() => { const g = window.__app.game(); return { ride: g.p.ride && g.p.ride.k, over: g.over }; });
    ok(rb2.ride === 'board' && !rb2.over, `スケボーは、道に障害物が無いので、そのまま走れる (${rb2.ride})`);
    // ラジコンカー: 車の絵が出る (ボディの黄色い画素)
    await setStreet('toycar');
    await sleep(300);
    const px = () => page.evaluate(() => {
      const cv = document.getElementById('cv'), c = cv.getContext('2d');
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 255) < 8 && Math.abs(d[i + 1] - 183) < 10 && d[i + 2] < 40) n++;
      return n;
    });
    const withCar = await px();
    await sleep(900);
    const rc = await page.evaluate(() => { const g = window.__app.game(); return { ride: g.p.ride && g.p.ride.k, over: g.over }; });
    ok(rc.ride === 'toycar' && !rc.over, `ラジコンカーに乗って走る (${rc.ride})`);
    ok(withCar > 150, `ラジコンカーの絵が出る (黄色い画素 ${withCar})`);
    // 地上の道を出る前に降りる
    const off = await page.evaluate(async () => {
      const g = window.__app.game(), C = window.Core;
      const b = g.world.b.filter((q) => q.ground && C.stageOf(q.x) === 2).pop();
      g.p.x = b.x + b.w - 360; g.p.y = b.roofY; g.p.ride = { k: 'board', t: 99 };
      b.roof.items.length = 0;
      const t0 = performance.now();
      while (g.p.ride && performance.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 30));
      return { ride: !!g.p.ride, left: Math.round(b.x + b.w - g.p.x) };
    });
    ok(!off.ride && off.left > 60, `道の終わりの手前で降りる (終わりまであと ${off.left}px)`);
    await ctx.close();

    // ------------------------------------------------------------ 宝石・きたえる
    section('宝石・きたえる');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('宝石: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 21, noEnemies: true }));
    await sleep(300);
    // 目の前に宝石を置いて、取る
    await page.evaluate(() => { window.__toasts2 = []; new MutationObserver(() => window.__toasts2.push(document.getElementById('toast').textContent)).observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true }); });
    const gm = await page.evaluate(async () => {
      const g = window.__app.game(), w = (ms) => new Promise((r) => setTimeout(r, ms));
      const b = g.world.b[0];
      g.p.x = 20; g.p.y = b.roofY; g.p.vy = 0; g.p.onGround = true; g.p.stun = 0; g.p.inv = 0;
      b.roof.items.push({ x: 60, y: b.roofY - 26, t: 'gem', k: 'emerald' }, { x: 66, y: b.roofY - 26, t: 'gem', k: 'ruby' });
      await w(500);
      return { gems: g.gems, kinds: g.gemKinds, hud: document.getElementById('hGems').textContent, toast: window.__toasts2.join(' | ') };
    });
    ok(gm.gems === 5 && gm.hud === '5', `宝石を取ると、ポイント (エメラルド 4 + ルビー 1) が入って、画面にも出る (${gm.gems} / HUD ${gm.hud})`);
    ok(/宝石/.test(gm.toast), `はじめて取ると、使いみちが出る (${gm.toast.replace(/\n/g, ' ')})`);
    // 終わると、保存に積む。けっかにも出る
    await page.evaluate(() => { const g = window.__app.game(); g.over = 'fell'; });
    await page.waitForFunction(() => window.__app.state().mode === 'result');
    const gres = await page.evaluate(() => ({ save: window.__app.save(), rGem: document.getElementById('rGem').textContent, rGems: document.getElementById('rGems').textContent, hidden: document.getElementById('rGems').hidden }));
    ok(gres.save.gems === 5 && gres.save.gemKinds.emerald === 1 && gres.save.gemKinds.ruby === 1 && gres.rGem === '5' && !gres.hidden && /🟢/.test(gres.rGems), `けっかに宝石が出て、保存にたまる (${gres.save.gems} 点 / ${gres.rGems.trim()})`);
    // きたえる: 宝石が足りないと買えず、足りると上がる
    await page.evaluate(() => window.__app.openShop('result'));
    await page.locator('#tabTrain').tap();
    await sleep(100);
    const tr0 = await page.evaluate(() => ({ cards: document.querySelectorAll('.gcard.train').length, btns: [...document.querySelectorAll('.gcard.train .gbtn')].map((b) => b.textContent.trim()), cant: document.querySelectorAll('.gcard.train .gbtn.cant').length }));
    ok(tr0.cards === 3 && tr0.btns[0] === '💎 6', `「きたえる」に 3 つ並ぶ (${tr0.btns.join(' / ')})`);
    await page.locator('.gcard.train[data-up="jump"] .gbtn').tap();
    await sleep(100);
    const tr1 = await page.evaluate(() => ({ save: window.__app.save(), pips: document.querySelectorAll('.gcard.train[data-up="jump"] .pips i.on').length }));
    ok(tr1.save.up.jump === 0 && tr1.save.gems === 5, `宝石が足りないと、きたえられない (${tr1.save.gems} 点・Lv ${tr1.save.up.jump})`);
    await page.evaluate(() => { const s = window.__app.save(); s.gems = 40; });
    await page.evaluate(() => window.__app.openShop('result'));
    await page.locator('#tabTrain').tap();
    await sleep(100);
    await page.locator('.gcard.train[data-up="jump"] .gbtn').tap();
    await sleep(100);
    const tr2 = await page.evaluate(() => ({ save: window.__app.save(), pips: document.querySelectorAll('.gcard.train[data-up="jump"] .pips i.on').length, btn: document.querySelector('.gcard.train[data-up="jump"] .gbtn').textContent.trim(), stored: JSON.parse(localStorage.getItem('spy-mint-v1')) }));
    ok(tr2.save.up.jump === 1 && tr2.save.gems === 34 && tr2.pips === 1 && tr2.btn === '💎 10' && tr2.stored.up.jump === 1, `宝石 6 点でジャンプが Lv.1 に。つぎは 10 点 (${tr2.save.gems} 点・${tr2.btn}・保存 ${tr2.stored.up.jump})`);
    // 買ったぶんが、次のあそびに効く
    await page.evaluate(() => window.__app.start({ seed: 21, noEnemies: true }));
    await sleep(200);
    const up = await page.evaluate(() => { const g = window.__app.game(); return { jk: g.jumpK, up: g.up }; });
    ok(up.up.jump === 1 && Math.abs(up.jk - 1.04) < 1e-9, `次のあそびでジャンプが高い (${up.jk})`);
    await ctx.close();

    // 前の版の保存 (宝石の欄が無い) を開いても、壊れない
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('引きつぎ: ' + e.message));
    await page.evaluate(() => localStorage.setItem('spy-mint-v1', JSON.stringify({ coins: 77, owned: ['mizu', 'twin'], equipped: 'twin', best: 12, mute: false, tips: {} })));
    await page.reload();
    await page.waitForFunction(() => window.__app);
    const old = await page.evaluate(() => window.__app.save());
    ok(old.coins === 77 && old.gems === 0 && old.up.jump === 0 && old.owned.length === 2 && JSON.stringify(old.gemKinds) === '{}', `前の版の保存でも、宝石は 0 から始まる (${JSON.stringify(old.up)})`);
    await ctx.close();

    // ------------------------------------------------------------ ロープ (風船のわっか)
    section('ロープ (ぶらさがる)');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('ロープ: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 5, noEnemies: true }));
    await sleep(300);
    const rcdp = await ctx.newCDPSession(page);
    const rtouch = touchTool(rcdp);
    const gb = await center(page, '#bAct');
    const putNearHook = (dx) => page.evaluate((dx) => {
      const g = window.__app.game(), C = window.Core;
      C.ensure(g.world, 40000);
      const hb = g.world.b.find((q) => q.hooks.length && q.hooks[0].x < q.x && q.i > 2);
      const pv = g.world.b[hb.i - 1], h = hb.hooks[0];
      pv.roof.props.length = 0;
      g.p.x = h.x - dx; g.p.y = pv.roofY; g.p.vy = 0; g.p.inside = -1; g.p.onGround = true; g.p.stun = 0; g.p.inv = 0;
      g.enemies.length = 0; g.spawnT = 999;
      return { hx: h.x, bx: hb.x };
    }, dx);
    const lab = () => page.evaluate(() => ({ lb: document.getElementById('actLb').textContent, rope: !!window.__app.game().p.rope, glow: document.getElementById('bAct').classList.contains('glow') }));
    await putNearHook(110);
    await sleep(120);
    const l0 = await lab();
    ok(l0.lb === 'ロープ' && l0.glow, `風船のわっかの近くで、ボタンが「ロープ」になって光る (${l0.lb} / 光る ${l0.glow})`);
    await rtouch.start(1, gb.x, gb.y);                       // 指でおしっぱなし
    await sleep(350);
    const l1 = await lab();
    ok(l1.rope && l1.lb === 'はなす', `指でおしている間は、ぶらさがる (${l1.rope} / ${l1.lb})`);
    const rx0 = await page.evaluate(() => window.__app.game().p.x);
    await sleep(450);
    const l2 = await lab();
    ok(l2.rope, '指をはなさないかぎり、つかまりつづける');
    await rtouch.end(1);                                     // 指をはなす
    await sleep(150);
    const l3 = await lab();
    ok(!l3.rope, `指をはなすと、はなれる (${l3.rope})`);
    await page.waitForFunction(() => window.__app.game().p.onGround || window.__app.game().over, null, { timeout: 4000 });
    const fin = await page.evaluate(() => { const g = window.__app.game(); return { x: g.p.x, over: g.over }; });
    ok(!fin.over && fin.x - rx0 > 150, `ぶらんと渡って、むこうの屋上に着く (${Math.round(fin.x - rx0)}px 進んだ / over ${fin.over})`);
    // マウスでも同じ (おして、はなす)
    await putNearHook(110);
    await sleep(120);
    await page.mouse.move(gb.x, gb.y); await page.mouse.down();
    await sleep(300);
    const m1 = await lab();
    await page.mouse.up();
    await sleep(120);
    const m2 = await lab();
    ok(m1.rope && !m2.rope, `マウスでも、おすとつかまり、はなすとはなれる (${m1.rope} → ${m2.rope})`);
    // うしろの風船が見えている (絵が出る): 風船の色のどれかの画素が、画面にある
    await putNearHook(110);
    await sleep(200);
    const balloon = await page.evaluate(() => {
      const cv = document.getElementById('cv'), c = cv.getContext('2d');
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      const want = [[255, 107, 138], [76, 201, 240], [255, 210, 63], [123, 224, 168], [181, 140, 255]];
      let n = 0;
      for (let i = 0; i < d.length; i += 4) for (const w of want) if (Math.abs(d[i] - w[0]) < 6 && Math.abs(d[i + 1] - w[1]) < 6 && Math.abs(d[i + 2] - w[2]) < 6) { n++; break; }
      return n;
    });
    ok(balloon > 300, `風船の絵が画面に出る (風船色の画素 ${balloon})`);
    await ctx.close();

    // ------------------------------------------------------------ 主人公の位置・屋上の 2 かい・画面外の敵の目じるし
    section('うしろが見える位置・屋上の 2 かい・画面外の敵');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('2かい: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 9 }));
    await sleep(300);
    const pos = await page.evaluate(() => { const g = window.__app.game(), v = window.__app.state().view; return { sx: g.p.x - v.camX, w: v.w }; });
    ok(pos.sx > pos.w * 0.5 && pos.sx < pos.w * 0.62, `主人公は、まん中より少し右に立つ (左から ${Math.round(pos.sx)} / 見える幅 ${Math.round(pos.w)})`);
    const deckPx = await page.evaluate(async () => {
      const g = window.__app.game(), C = window.Core;
      C.ensure(g.world, 30000);
      const b = g.world.b.find((q) => q.i > 3 && q.decks.length);
      const d = b.decks[0];
      g.p.x = d.x0 + 30; g.p.y = d.y; g.p.vy = 0; g.p.onGround = true; g.p.inside = -1; g.p.stun = 0.8;
      g.enemies.length = 0; g.spawnT = 999;
      await new Promise((r) => setTimeout(r, 250));
      const cv = document.getElementById('cv'), c = cv.getContext('2d');
      const dd = c.getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 0; i < dd.length; i += 4) if (Math.abs(dd[i] - 255) < 4 && Math.abs(dd[i + 1] - 226) < 6 && Math.abs(dd[i + 2] - 122) < 8) n++;
      return { n, onDeck: g.p.onDeck, y: g.p.y, dy: d.y };
    });
    ok(deckPx.onDeck && deckPx.y === deckPx.dy, `2 かいの上に立てる (onDeck ${deckPx.onDeck})`);
    ok(deckPx.n > 400, `2 かいの「乗れるふち」(黄色) が描かれている (画素 ${deckPx.n})`);
    const marks = await page.evaluate(async () => {
      const g = window.__app.game(), v = window.__app.state().view, b = window.Core.buildingAt(g.world, g.p.x);
      const e = window.Core.spawnEnemy(g, 'suit', g.p.x - 150);
      e.y = b.roofY; e.stun = 5;
      await new Promise((r) => setTimeout(r, 150));
      const near = v.marks;
      e.x = g.p.x - 520;
      await new Promise((r) => setTimeout(r, 150));
      const far = v.marks;
      e.x = g.p.x - 3000;
      await new Promise((r) => setTimeout(r, 150));
      return { near, far, gone: v.marks };
    });
    ok(marks.near === 0 && marks.far === 1 && marks.gone === 0, `画面の左より外の敵にだけ「!」が出る (見えている 0 → 画面外 1 → とても遠い 0 : ${marks.near} / ${marks.far} / ${marks.gone})`);
    await ctx.close();

    // ------------------------------------------------------------ いちじていし
    section('いちじていし・アプリを切りかえたとき');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('停止: ' + e.message));
    await page.evaluate(() => window.__app.start({ seed: 21, noEnemies: true }));
    await sleep(300);
    await page.locator('#btnPause').tap();
    await page.waitForFunction(() => window.__app.state().mode === 'pause');
    const pa = await page.evaluate(() => window.__app.game().p.x);
    await sleep(400);
    const pb = await page.evaluate(() => window.__app.game().p.x);
    ok(Math.abs(pb - pa) < 0.01, `止めている間は進まない (${pa.toFixed(1)} → ${pb.toFixed(1)})`);
    await page.locator('#btnResume').tap();
    await page.waitForFunction(() => window.__app.state().mode === 'play');
    await sleep(300);
    const pc = await page.evaluate(() => window.__app.game().p.x);
    ok(pc - pb > 20, `つづけると、また進む (+${Math.round(pc - pb)}px)`);
    // 別のアプリへ切りかえた (hidden になった) ら止まる。ヘッドレスは visibilitychange が来ないので、自分で送る
    const vis = await page.evaluate(() => ({ state: document.visibilityState, hidden: document.hidden }));
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await sleep(100);
    const m = await page.evaluate(() => window.__app.state().mode);
    ok(m === 'pause', `見えなくなったら一時停止する (前: ${vis.state}/${vis.hidden} → ${m})`);
    await ctx.close();

    // ------------------------------------------------------------ ぶきや・保存
    section('ぶきや (買う・つかう・保存)');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('ぶきや: ' + e.message));
    await page.locator('#btnShop').tap();
    await page.waitForFunction(() => window.__app.state().mode === 'shop');
    await sleep(100);
    const shop = await page.evaluate(() => ({
      n: document.querySelectorAll('.gcard').length,
      coins: document.getElementById('sCoins').textContent,
      listH: document.getElementById('shopList').clientHeight,
      scrollH: document.getElementById('shopList').scrollHeight
    }));
    ok(shop.n >= 12, `水でっぽうが ${shop.n} 種類ならぶ`);
    ok(shop.scrollH > shop.listH, '一覧は中で送れる (はみ出して押せなくならない)');
    // いちばん下まで送ると、最後の 1 枚のボタンが画面の中に見える
    await page.evaluate(() => { const l = document.getElementById('shopList'); l.scrollTop = l.scrollHeight; });
    await sleep(100);
    const last = await page.evaluate(() => {
      const cards = document.querySelectorAll('.gcard');
      const b = cards[cards.length - 1].querySelector('.gbtn').getBoundingClientRect();
      return { bottom: b.bottom, top: b.top, vh: innerHeight };
    });
    ok(last.top >= 0 && last.bottom <= last.vh, '一番下まで送ると、最後のぶきのボタンも押せる位置に出る');
    await page.evaluate(() => { document.getElementById('shopList').scrollTop = 0; });
    // 買えない物は買えない
    const before = await page.evaluate(() => window.__app.save().coins);
    await page.locator('.gcard[data-gun="shot"] .gbtn').tap();
    const after0 = await page.evaluate(() => ({ coins: window.__app.save().coins, owned: window.__app.save().owned.length }));
    ok(after0.coins === before && after0.owned === 1, `コインが足りないと買えない (${before} のまま)`);
    // 買える物は買える
    await page.locator('.gcard[data-gun="twin"] .gbtn').tap();
    const after1 = await page.evaluate(() => ({ coins: window.__app.save().coins, owned: window.__app.save().owned, eq: window.__app.save().equipped }));
    ok(after1.owned.includes('twin') && after1.coins === before - 90 && after1.eq === 'twin', `買うとコインが減って、手に入る (${before} → ${after1.coins})`);
    // 保存・再読み込み
    await page.reload();
    await page.waitForFunction(() => window.__app);
    const kept = await page.evaluate(() => ({ owned: window.__app.save().owned, coins: window.__app.save().coins, eq: window.__app.save().equipped }));
    ok(kept.owned.includes('twin') && kept.eq === 'twin' && kept.coins === after1.coins, '再読み込みしても、買った物・コイン・つかうぶきが残る');
    // あそぶと、持っている水でっぽうが全部切りかえられる
    await page.evaluate(() => window.__app.start({ seed: 21, noEnemies: true }));
    const guns = await page.evaluate(() => ({ list: window.__app.game().guns.slice(), cur: window.Core.curGun(window.__app.game()).id }));
    ok(guns.list.length === 2 && guns.cur === 'twin', `はじめは「つかう」にしたぶき (${guns.cur})。持っている ${guns.list.join(',')}`);
    await page.locator('#hGun').tap();
    await sleep(80);
    const sw = await page.evaluate(() => ({ cur: window.Core.curGun(window.__app.game()).id, name: document.getElementById('hGunName').textContent }));
    ok(sw.cur === 'mizu' && sw.name === 'ミズデッポウ', `ぶき名をタップすると切りかわって、表示も変わる (${sw.cur} / ${sw.name})`);
    // 「うつ」ボタンを上へスワイプしても、ぶきかえ (うちながら)
        const fcdp = await ctx.newCDPSession(page);
    const ftouch = touchTool(fcdp);
    const fireB = await center(page, '#bFire');
    const cur0 = await page.evaluate(() => window.Core.curGun(window.__app.game()).id);
    await ftouch.start(1, fireB.x, fireB.y);
    await sleep(60);
    await ftouch.move(1, fireB.x, fireB.y - 80);
    await sleep(80);
    const sw2 = await page.evaluate(() => ({ cur: window.Core.curGun(window.__app.game()).id, fire: window.__app.game().in.fireHeld }));
    await ftouch.end(1);
    ok(sw2.cur !== cur0 && sw2.fire === true, `「うつ」を上へスワイプすると、うちながら切りかわる (${cur0} → ${sw2.cur} / うっている ${sw2.fire})`);

    await ctx.close();

    // 前の版が残した保存でも開ける・新しい物が足されている
    section('前の版の保存を引き継ぐ');
    {
      const old = await browser.newContext(PHONE);
      const pg = await old.newPage();
      const e2 = [];
      pg.on('pageerror', (e) => e2.push(e.message));
      await pg.addInitScript(() => {
        localStorage.setItem('spy-mint-v1', JSON.stringify({ coins: 55, owned: ['mizu', 'nonexistent'], best: 12 }));
      });
      await pg.goto(URL);
      await pg.waitForFunction(() => window.__app);
      const s = await pg.evaluate(() => window.__app.save());
      ok(e2.length === 0 && s.coins === 55 && s.best === 12 && s.owned.join() === 'mizu' && s.equipped === 'mizu',
        '古い形・足りない項目・今は無いぶきの保存でも開けて、中身が補われる');
      const bad = await browser.newContext(PHONE);
      const pg2 = await bad.newPage();
      const e3 = [];
      pg2.on('pageerror', (e) => e3.push(e.message));
      await pg2.addInitScript(() => { localStorage.setItem('spy-mint-v1', '{こわれた'); });
      await pg2.goto(URL);
      await pg2.waitForFunction(() => window.__app);
      const s2 = await pg2.evaluate(() => window.__app.save());
      ok(e3.length === 0 && s2.coins === 120 && s2.owned.join() === 'mizu', 'こわれた保存でも、初期の状態で開く');
      await bad.close();
      await old.close();
    }

    // ------------------------------------------------------------ 軽さ (CPU 4 倍遅)
    section('遅い端末でも動く (CPU を 4 倍遅く)');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('速さ: ' + e.message));
    const cdp2 = await ctx.newCDPSession(page);
    await installBot(page);
    await page.evaluate(() => {
      window.__app.start({ seed: 8 });
      window.__auto = true;
      window.__app.press('fire', true);
      // 水ばくだんを定期的に
      setInterval(() => { const g = window.__app.game(); if (g && !g.over) { g.bombs = Math.max(g.bombs, 1); g.water = 100; if (g.danger < 150) window.__app.press('bomb', true); } }, 1500);
    });
    await sleep(2500);
    const measure = async (ms) => page.evaluate((dur) => new Promise((resolve) => {
      const ts = [];
      let last = performance.now();
      const t0 = last;
      const f = (now) => {
        ts.push(now - last); last = now;
        if (now - t0 < dur) requestAnimationFrame(f); else resolve(ts);
      };
      requestAnimationFrame(f);
    }), ms);
    const fast = await measure(2500);
    await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await sleep(500);
    const slowT = await measure(4000);
    await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const stat = (a) => { const s = a.slice(1).sort((x, y) => x - y); return { avg: s.reduce((x, y) => x + y, 0) / s.length, p95: s[Math.floor(s.length * 0.95)], n: s.length }; };
    const sf = stat(fast), ss = stat(slowT);
    const alive = await page.evaluate(() => !window.__app.game().over);
    ok(sf.avg < 20, `ふつうの速さ: 1 コマ 平均 ${sf.avg.toFixed(1)}ms (p95 ${sf.p95.toFixed(1)}ms, ${sf.n} コマ)`);
    ok(ss.avg < 34, `CPU 4 倍遅: 1 コマ 平均 ${ss.avg.toFixed(1)}ms / ${(1000 / ss.avg).toFixed(0)}fps (p95 ${ss.p95.toFixed(1)}ms, ${ss.n} コマ)`);
    if (!alive) skip('測っている途中でゲームが終わった (計測は終わるまでの分)');
    await ctx.close();

    // ------------------------------------------------------------ 長く遊ぶ (自動で 40 秒)
    section('自動で長く遊ばせて、おかしくならないか');
    ({ ctx, page } = await freshPage(browser));
    page.on('pageerror', (e) => errors.push('長く: ' + e.message));
    await installBot(page);
    await page.evaluate(() => {
      window.__app.start({ seed: 33 });
      window.__auto = true;
      window.__app.press('fire', true);
      setInterval(() => {
        const g = window.__app.game(); if (!g || g.over) return;
        g.bombs = Math.max(g.bombs, 1);
        if (g.danger < 120) window.__app.press('bomb', true);
        if (window.Core.nearDoor(g)) window.__app.press('door', true);
      }, 400);
    });
    await sleep(40000);
    const long = await page.evaluate(() => {
      const g = window.__app.game();
      return { x: g.p.x, over: g.over, m: window.Core.metersOf(g.p.x), kills: g.kills, coins: g.coins, fx: window.Art.fxCount(), ev: g.events.length, shots: g.shots.length, thrown: g.thrown.length, enemies: g.enemies.length, puddles: g.puddles.length };
    });
    ok(long.m > 150 || long.over, `40 秒走った (${long.m}m, たおした ${long.kills}, コイン ${long.coins}${long.over ? ', ' + long.over : ''})`);
    ok(long.fx <= 420 && long.ev < 300 && long.shots < 200 && long.thrown < 20 && long.puddles < 20, `効果・水の玉・投げ物がたまりつづけない (fx ${long.fx}, 玉 ${long.shots}, 投げ物 ${long.thrown}, 水たまり ${long.puddles})`);
    await ctx.close();

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

void fs;
