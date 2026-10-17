/*!
 * app.js — 画面まわり。操作・流れ・音・表示の更新はここに書く。
 * ロジックは core.js、絵は art.js。
 */
(function () {
  'use strict';

  const C = window.Core;
  const A = window.Art;
  const $ = (id) => document.getElementById(id);

  const STEP = 1 / 60;
  const VIEW_W = 520;           // 画面に見える世界のはば
  const SPY_X = 195;            // 主人公が画面の左から何の位置に立つか (世界の単位)

  // ------------------------------------------------------------ 保存 (まとめて書く: 終わったとき・買ったときだけ)
  // 名前を変えても、保存の鍵は変えない (買った銃やコインが消えないように)
  const SAVE_KEY = 'spy-mint-v1';

  function defaultSave() {
    return { coins: 120, owned: ['mizu'], equipped: 'mizu', best: 0, mute: false, tips: {} };
  }

  function loadSave() {
    const d = defaultSave();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.coins === 'number' && s.coins >= 0) d.coins = Math.floor(s.coins);
        if (Array.isArray(s.owned)) d.owned = s.owned.filter((id) => C.GUN_BY_ID[id]);
        if (typeof s.equipped === 'string') d.equipped = s.equipped;
        if (typeof s.best === 'number') d.best = s.best;
        d.mute = !!s.mute;
        if (s.tips && typeof s.tips === 'object') d.tips = s.tips;
      }
    } catch (e) { /* 保存できない環境でも遊べる */ }
    if (d.owned.indexOf('mizu') < 0) d.owned.unshift('mizu');
    if (d.owned.indexOf(d.equipped) < 0) d.equipped = 'mizu';
    return d;
  }

  let save = loadSave();
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 無視 */ }
  }

  // ------------------------------------------------------------ 音 (その場で合成。ファイルは使わない)
  const Snd = (function () {
    let ac = null, master = null, last = {};
    function ctx() {
      if (ac === null) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          ac = AC ? new AC() : false;
          if (ac) {
            master = ac.createGain(); master.gain.value = 0.9;
            const comp = ac.createDynamicsCompressor();          // 重なっても音が割れないように
            comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.12;
            master.connect(comp); comp.connect(ac.destination);
          }
        } catch (e) { ac = false; }
      }
      if (ac && ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(f0, f1, dur, type, vol, delay) {
      const a = ctx(); if (!a || save.mute) return;
      const t0 = a.currentTime + (delay || 0);
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }
    function noise(dur, vol, freq, q, delay) {
      const a = ctx(); if (!a || save.mute) return;
      const t0 = a.currentTime + (delay || 0);
      const n = Math.max(1, Math.floor(a.sampleRate * dur));
      const buf = a.createBuffer(1, n, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const s = a.createBufferSource(); s.buffer = buf;
      const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 0.8;
      const g = a.createGain(); g.gain.value = vol;
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t0);
    }
    // 水でっぽうごとの音 (レシピは sfx.js)
    let kit = null;
    function liveKit() {
      const a = ctx();
      if (!a || save.mute) return null;
      if (!kit) kit = window.Sfx.makeKit(a, master);
      return kit;
    }
    function gunSound(id, params) {
      if (!throttle('gun:' + id, window.Sfx.MIN_GAP[id] || 70)) return;
      const k = liveKit(); if (k && window.Sfx.GUN[id]) window.Sfx.GUN[id](k, params || {});
    }
    function extraSound(name) {
      if (!throttle('x:' + name, 80)) return;
      const k = liveKit(); if (k && window.Sfx.EXTRA[name]) window.Sfx.EXTRA[name](k);
    }
    function throttle(key, ms) {
      const now = performance.now();
      if (last[key] && now - last[key] < ms) return false;
      last[key] = now; return true;
    }
    function play(name) {
      switch (name) {
        case 'jump': tone(300, 640, 0.14, 'square', 0.07); break;
        case 'hit': if (throttle('hit', 60)) { tone(520, 260, 0.08, 'triangle', 0.14); } break;
        case 'splash': noise(0.25, 0.4, 900, 0.7); break;
        case 'explode': noise(0.5, 0.7, 380, 0.6); tone(160, 45, 0.4, 'sine', 0.35); break;
        case 'coin': if (throttle('coin', 40)) { tone(988, 988, 0.07, 'square', 0.07); tone(1319, 1319, 0.12, 'square', 0.07, 0.07); } break;
        case 'item': tone(660, 990, 0.12, 'triangle', 0.16); tone(990, 1320, 0.14, 'triangle', 0.16, 0.1); break;
        case 'gift': [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.14, 'triangle', 0.18, i * 0.08)); break;
        case 'trip': tone(220, 90, 0.22, 'sawtooth', 0.16); break;
        case 'ride': tone(400, 800, 0.1, 'square', 0.1); tone(600, 1200, 0.14, 'square', 0.1, 0.09); break;
        case 'unride': tone(500, 200, 0.2, 'triangle', 0.12); break;
        case 'smash': noise(0.22, 0.45, 900, 0.6); tone(260, 90, 0.16, 'square', 0.14); break;
        case 'caught': tone(520, 130, 0.6, 'sawtooth', 0.22); noise(0.3, 0.3, 500, 0.5); break;
        case 'fell': tone(700, 90, 0.9, 'triangle', 0.22); break;
        case 'door': tone(180, 140, 0.18, 'square', 0.08); tone(300, 380, 0.12, 'triangle', 0.1, 0.1); break;
        case 'grab': tone(400, 600, 0.08, 'triangle', 0.12); break;
        case 'throw': noise(0.16, 0.25, 1400, 0.6); break;
        case 'switch': tone(900, 1200, 0.05, 'square', 0.07); break;
        case 'dry': tone(200, 160, 0.08, 'square', 0.08); break;
        case 'defeat': [440, 554, 659, 880].forEach((f, i) => tone(f, f, 0.1, 'square', 0.09, i * 0.06)); break;
        case 'stage': [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.17, i * 0.07)); break;
        case 'flip': tone(380, 980, 0.28, 'triangle', 0.1); noise(0.22, 0.14, 1800, 0.5); break;
        case 'flipland': tone(700, 1500, 0.09, 'triangle', 0.12); tone(1500, 2000, 0.1, 'sine', 0.07, 0.07); break;
        case 'roll': noise(0.18, 0.2, 700, 0.5); tone(260, 150, 0.12, 'sine', 0.1); break;
        case 'ui': tone(700, 900, 0.07, 'triangle', 0.12); break;
        case 'buy': [660, 880, 1100].forEach((f, i) => tone(f, f, 0.1, 'triangle', 0.15, i * 0.07)); break;
        case 'land': break;
        default: break;
      }
    }
    function event(ev) {
      switch (ev.t) {
        case 'jump': play('jump'); break;
        case 'shoot': gunSound(ev.gun, { ramp: ev.ramp }); break;
        case 'charge': extraSound('charge'); break;
        case 'arc': extraSound('arc'); break;
        case 'hit': play('hit'); break;
        case 'splash': play('splash'); break;
        case 'explode': play('explode'); break;
        case 'coin': play('coin'); break;
        case 'item': play('item'); break;
        case 'gift': play('gift'); break;
        case 'trip': play('trip'); break;
        case 'ride': play('ride'); break;
        case 'unride': play('unride'); break;
        case 'smash': play('smash'); break;
        case 'caught': play('caught'); break;
        case 'fell': play('fell'); break;
        case 'enter': case 'exit': play('door'); break;
        case 'grab': play('grab'); break;
        case 'throw': play('throw'); break;
        case 'switch': play('switch'); break;
        case 'dry': play('dry'); break;
        case 'defeat': play('defeat'); break;
        case 'stage': play('stage'); break;
        case 'flip': play('flip'); break;
        case 'flipland': play('flipland'); break;
        case 'roll': play('roll'); break;
        default: break;
      }
    }
    return { play: play, event: event, unlock: ctx };
  })();

  // ------------------------------------------------------------ 状態
  const els = {
    stage: $('stage'), cv: $('cv'), hud: $('hud'), pad: $('pad'),
    hDist: $('hDist'), hCoins: $('hCoins'), hGunIcon: $('hGunIcon'), hGunName: $('hGunName'), hWater: $('hWater'),
    warn: $('warn'), toast: $('toast'), sky2: $('sky2'),
    hStage: $('hStage'), hStageBar: $('hStageBar'), banner: $('stageBanner'), sbName: $('sbName'), sbSub: $('sbSub'),
    bombN: $('bombN'), bDoor: $('bDoor'), bGrab: $('bGrab'), grabIc: $('grabIc'), grabLb: $('grabLb'), bBomb: $('bBomb'),
    vTitle: $('vTitle'), vShop: $('vShop'), vResult: $('vResult'), vPause: $('vPause')
  };
  const ctx2d = els.cv.getContext('2d');

  const app = {
    mode: 'title',            // title | shop | play | pause | result
    g: null,                  // あそんでいる (または終わった) ゲーム
    demo: null,               // タイトルの背で走るゲーム
    demoBot: { until: null, wait: 0, air: false, delay: 0 },
    acc: 0,
    over: false, overT: 0,
    animPlay: null,            // 空中の動き (バク転・ロール)。見た目だけで、ゲームの動きには関わらない
    animDemo: null,
    camPlay: { x: 0, y: 0, ref: 0 },
    camDemo: { x: 0, y: 0, ref: 0 },
    view: { w: VIEW_W, h: 700, camX: 0, camY: 0, t: 0, aim: 0, shoot: 0 },
    S: 1, cssW: 0, cssH: 0,
    shake: 0, time: 0, last: 0,
    toastT: 0,
    cache: {},
    fromShop: 'title'
  };

  // ------------------------------------------------------------ 画面のきりかえ
  function show(mode) {
    app.mode = mode;
    els.vTitle.hidden = mode !== 'title';
    els.vShop.hidden = mode !== 'shop';
    els.vResult.hidden = mode !== 'result';
    els.vPause.hidden = mode !== 'pause';
    const playing = mode === 'play' || mode === 'pause';
    els.hud.hidden = !(playing || mode === 'result');
    els.pad.hidden = !(playing || mode === 'result');
    if (mode === 'title' || mode === 'shop') ensureDemo();
    refreshLabels();
    resize();
  }

  function refreshLabels() {
    $('tCoins').textContent = String(save.coins);
    $('tBest').textContent = String(save.best);
    $('sCoins').textContent = String(save.coins);
    $('soundLabel').textContent = save.mute ? '🔇 おと' : '🔊 おと';
    $('pauseSoundLabel').textContent = save.mute ? 'おとなし' : 'おとあり';
  }

  // ------------------------------------------------------------ キャンバスの大きさ
  function resize() {
    const w = els.stage.clientWidth, h = els.stage.clientHeight;
    if (!(w >= 1 && h >= 1)) return;          // 組み直しの途中で 0 が来ることがある
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (els.cv.width !== pw || els.cv.height !== ph) {
      els.cv.width = pw; els.cv.height = ph;
    }
    app.cssW = w; app.cssH = h;
    app.S = pw / VIEW_W;
    app.view.h = ph / app.S;
  }

  // ------------------------------------------------------------ タイトルの背景 (自動で走る)
  function ensureDemo() {
    if (!app.demo || app.demo.over || app.demo.p.x > 30000) {
      app.demo = C.newGame({ seed: (Math.random() * 4294967296) >>> 0, noEnemies: true });
      app.demoBot = { until: null, wait: 0, air: false, delay: 0 };
      snapCamera(app.demo, app.camDemo);
      app.animDemo = null;
    }
  }

  /** 谷・じゃま物の手前で跳ぶ自動プレイ (タイトルの背景用。core.test.js のものと同じ考え方)。 */
  function botStep(g, st, dt) {
    const p = g.p;
    if (st.air) {
      if (p.onGround) { st.air = false; st.until = null; C.input(g, 'jump', false); }
      else if (p.x >= st.until) { C.input(g, 'jump', false); return; }
      else return;
    }
    if (st.until == null) {
      const plan = C.jumpPlan(g, p, C.speedAt(p.x));
      if (plan) { st.until = plan.until; st.wait = st.delay; }
    }
    if (st.until != null) {
      st.wait -= dt;
      if (st.wait <= 0) { C.input(g, 'jump', true); st.air = true; }
    }
  }

  // ------------------------------------------------------------ あそびのはじまり・おわり
  function startGame(opts) {
    Snd.unlock();
    opts = opts || {};
    const owned = save.owned.slice().sort((a, b) => C.GUNS.indexOf(C.GUN_BY_ID[a]) - C.GUNS.indexOf(C.GUN_BY_ID[b]));
    app.animPlay = null;
    app.g = C.newGame({ seed: opts.seed, guns: owned, startGun: save.equipped, bombs: 3, noEnemies: !!opts.noEnemies });
    app.acc = 0;
    app.over = false; app.overT = 0;
    app.shake = 0;
    app.view.shoot = 0; app.view.fireT = 0; app.view.aim = 0;
    app.cache = {};
    A.clearFx();
    releaseAll();
    show('play');
    snapCamera(app.g, app.camPlay);
    applySky(1, true);
    updateHud(true);
  }

  function endGame() {
    const g = app.g;
    const m = C.metersOf(g.p.x);
    const isBest = m > save.best;
    if (isBest) save.best = m;
    save.coins += g.coins;
    persist();
    $('rTitle').textContent = g.over === 'fell' ? 'おっこちちゃった!' : 'つかまっちゃった!';
    $('rDist').textContent = String(m);
    $('rStage').textContent = String(g.stage);
    $('rCoins').textContent = '+' + g.coins;
    $('rKills').textContent = String(g.kills);
    $('rBest').textContent = String(save.best);
    $('rNew').hidden = !isBest || m === 0;
    show('result');
  }

  function pauseGame() {
    if (app.mode !== 'play') return;
    releaseAll();
    show('pause');
  }

  function resumeGame() {
    if (app.mode !== 'pause') return;
    app.last = performance.now();
    show('play');
  }

  // ------------------------------------------------------------ ぶきや
  function statsOf(gun) {
    const dps = gun.dmg * gun.n / gun.cd * (1 + (gun.pierce ? 0.3 : 0) + (gun.splash ? 0.4 : 0) + (gun.freeze ? 0.4 : 0) + (gun.stun ? 0.4 : 0) + (gun.trap ? 1.5 : 0));
    return {
      power: Math.min(1, dps / 11),
      range: Math.min(1, gun.range / 520),
      tank: 1 - Math.min(1, (gun.cost / gun.cd) / 45)
    };
  }

  function renderShop() {
    const list = $('shopList');
    const keep = list.scrollTop;
    const frag = document.createDocumentFragment();
    C.GUNS.forEach((gun) => {
      const owned = save.owned.indexOf(gun.id) >= 0;
      const st = statsOf(gun);
      const card = document.createElement('div');
      card.className = 'gcard' + (save.equipped === gun.id ? ' sel' : '') + (owned ? '' : ' locked');
      card.dataset.gun = gun.id;
      const bar = (label, v, col) => '<div class="gstat"><span>' + label + '</span><i style="--v:' + Math.round(v * 100) + '%;--c:' + col + '"></i></div>';
      let btn;
      if (!owned) {
        const can = save.coins >= gun.price;
        btn = '<button type="button" class="gbtn ' + (can ? '' : 'cant') + '" data-act="buy">🪙 ' + gun.price + '</button>';
      } else if (save.equipped === gun.id) {
        btn = '<button type="button" class="gbtn now" data-act="none">つかってる</button>';
      } else {
        btn = '<button type="button" class="gbtn use" data-act="use">つかう</button>';
      }
      card.innerHTML =
        '<div class="gicon" style="background:' + gun.color + '33">' + gun.icon + '</div>' +
        '<div class="gname">' + gun.name + '</div>' + btn +
        '<div class="gdesc"><b class="gtrait">' + gun.trait + '</b>' + gun.desc + '</div>' +
        '<div class="gstats">' + bar('パワー', st.power, '#ff5d8f') + bar('とどく', st.range, '#4cc9f0') + bar('水もち', st.tank, '#4fd6b2') + '</div>';
      frag.appendChild(card);
    });
    list.replaceChildren(frag);
    list.scrollTop = keep;
    $('sCoins').textContent = String(save.coins);
  }

  function openShop(from) {
    app.fromShop = from;
    renderShop();
    show('shop');
    $('shopList').scrollTop = 0;
  }

  function onShopClick(e) {
    const btn = e.target.closest('.gbtn');
    if (!btn) return;
    const card = btn.closest('.gcard');
    const gun = C.GUN_BY_ID[card.dataset.gun];
    const act = btn.dataset.act;
    if (act === 'buy') {
      if (save.coins >= gun.price && save.owned.indexOf(gun.id) < 0) {
        save.coins -= gun.price;
        save.owned.push(gun.id);
        save.equipped = gun.id;
        persist();
        Snd.play('buy');
      } else {
        Snd.play('dry');
      }
    } else if (act === 'use') {
      save.equipped = gun.id;
      persist();
      Snd.play('ui');
    }
    renderShop();
  }

  // ------------------------------------------------------------ ボタン・キー入力
  const held = {};     // 押している入力の名前 → true

  function press(name, down) {
    const g = app.g;
    if (!g || app.mode !== 'play' || app.over) return;
    if (down) held[name] = true; else delete held[name];
    C.input(g, name, down);
    if (name === 'jump') els.pad.querySelector('#bJump').classList.toggle('on', down);
    if (name === 'fire') els.pad.querySelector('#bFire').classList.toggle('on', down);
  }

  function releaseAll() {
    Object.keys(held).forEach((n) => { if (app.g) C.input(app.g, n, false); delete held[n]; });
    ['bJump', 'bFire', 'bBomb', 'bSwitch', 'bDoor', 'bGrab'].forEach((id) => $(id).classList.remove('on'));
  }

  function bindButton(id, name, hold) {
    const b = $(id);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      Snd.unlock();
      b.classList.add('on');
      press(name, true);
      if (!hold) setTimeout(() => { if (held[name]) press(name, false); }, 0);
    });
    const up = (e) => {
      b.classList.remove('on');
      if (hold) press(name, false);
      void e;
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const KEYS = {
    ' ': ['jump', true], ArrowUp: ['jump', true], w: ['jump', true],
    f: ['fire', true], j: ['fire', true], z: ['fire', true],
    b: ['bomb', false], e: ['grab', false], g: ['grab', false], q: ['switch', false],
    s: ['door', false], ArrowDown: ['door', false], Enter: ['door', false]
  };

  function onKey(e, down) {
    if (e.repeat) return;
    const k = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!k) return;
    e.preventDefault();
    if (k[1]) press(k[0], down);
    else if (down) press(k[0], true);
  }

  // ------------------------------------------------------------ ヒントとチュートリアル
  function toast(text, ms) {
    els.toast.textContent = text;
    els.toast.classList.add('on');
    app.toastT = (ms || 2200) / 1000;
  }

  function tip(key, text) {
    if (save.tips[key]) return;
    save.tips[key] = 1;
    persist();
    toast(text, 3000);
  }

  // ------------------------------------------------------------ 表示の更新 (変わったときだけ書く)
  function setText(el, key, v) {
    if (app.cache[key] !== v) { app.cache[key] = v; el.textContent = v; }
  }

  function updateHud(force) {
    const g = app.g;
    if (!g) return;
    if (force) app.cache = {};
    const m = C.metersOf(g.p.x);
    setText(els.hDist, 'dist', String(m));
    setText(els.hCoins, 'coins', String(g.coins));
    setText(els.hStage, 'stage', 'ステージ ' + g.stage);
    const prog = ((m % C.STAGE_LEN_M) / C.STAGE_LEN_M).toFixed(3);
    if (app.cache.prog !== prog) { app.cache.prog = prog; els.hStageBar.style.transform = 'scaleX(' + prog + ')'; }
    const gun = C.curGun(g);
    setText(els.hGunIcon, 'gicon', gun.icon);
    setText(els.hGunName, 'gname', gun.name);
    const w = Math.round(g.water);
    if (app.cache.water !== w) {
      app.cache.water = w;
      els.hWater.style.transform = 'scaleX(' + (w / 100).toFixed(2) + ')';
      els.hWater.parentNode.classList.toggle('low', w < 20);
    }
    setText(els.bombN, 'bombs', String(g.bombs));
    const h = C.hints(g);
    const door = !!h.door, grab = !!(h.grab || h.carrying);
    if (app.cache.door !== door) { app.cache.door = door; els.bDoor.classList.toggle('glow', door); els.bDoor.classList.toggle('off', !door && false); }
    if (app.cache.grabOn !== grab) { app.cache.grabOn = grab; els.bGrab.classList.toggle('glow', grab); }
    const carrying = h.carrying ? 1 : 0;
    if (app.cache.carry !== carrying) {
      app.cache.carry = carrying;
      els.grabLb.textContent = carrying ? 'なげる' : 'もつ';
      els.grabIc.textContent = carrying ? '🤾' : '✋';
    }
    const noBomb = g.bombs <= 0;
    if (app.cache.noBomb !== noBomb) { app.cache.noBomb = noBomb; els.bBomb.classList.toggle('off', noBomb); }
    const warn = g.danger < 130 && !app.over;
    if (app.cache.warn !== warn) { app.cache.warn = warn; els.warn.classList.toggle('on', warn); }
  }

  // ------------------------------------------------------------ ステージの空 (つぎのステージへは、空もじわっと変わる)
  let skyTimer = 0;
  function applySky(stage, instant) {
    const css = A.skyCss(A.themeOf(stage));
    app.skyStage = stage;
    clearTimeout(skyTimer);
    if (instant) {
      els.stage.style.background = css;
      els.sky2.style.transition = 'none';
      els.sky2.style.opacity = '0';
      return;
    }
    els.sky2.style.transition = 'none';
    els.sky2.style.background = css;
    els.sky2.style.opacity = '0';
    void els.sky2.offsetWidth;                       // 変えた直後の状態を見せてから、うすい→こい へ
    els.sky2.style.transition = 'opacity 1.2s ease';
    els.sky2.style.opacity = '1';
    skyTimer = setTimeout(() => {
      els.stage.style.background = css;
      els.sky2.style.transition = 'none';
      els.sky2.style.opacity = '0';
    }, 1250);
  }

  function showStageBanner(n, bonus, ground) {
    els.sbName.textContent = 'ステージ ' + n;
    els.sbSub.textContent = ground ? 'ちじょうの おいかけっこ! 車は長おしでジャンプ' : 'ステージクリア! +' + bonus + 'コイン ・ 水まんたん';
    els.banner.animate([
      { opacity: 0, transform: 'translateX(-50%) scale(.6)' },
      { opacity: 1, transform: 'translateX(-50%) scale(1.08)', offset: 0.18 },
      { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.3 },
      { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.78 },
      { opacity: 0, transform: 'translateX(-50%) scale(1) translateY(-14px)' }
    ], { duration: 2300, easing: 'ease-out', fill: 'none' });
  }

  // ------------------------------------------------------------ カメラ
  function snapCamera(g, cam) {
    cam.x = g.p.x - SPY_X;
    cam.ref = g.p.y;
    cam.y = g.p.y - app.view.h * 0.6;
  }

  function updateCamera(g, dt, cam) {
    const p = g.p;
    cam.x = p.x - SPY_X;
    if (p.onGround || p.y > cam.ref + 140) {
      cam.ref += (p.y - cam.ref) * Math.min(1, dt * 5);
    }
    const target = cam.ref - app.view.h * (0.6 + 0.1 * (app.view.facade || 0));   // 地上ステージは、道を少し下に見せて街並みを広く
    cam.y += (target - cam.y) * Math.min(1, dt * 6);
  }

  // ------------------------------------------------------------ 1 コマ
  // ------------------------------------------------------------ 空中の動き (見た目だけ。ゲームの動きには関わらない)
  // バク転: 押しつづけた高いジャンプ (0.1 秒たっても、まだ強く上へ向かっている) で、空中で後ろへ 1 回転。
  //   着地までに回りきらなくても、着地でさっと 1 回転ぶんまで合わせる。ちょん跳びは回らない
  // ロール: 高いところから飛びおりた着地 (落ちる速さ 1000 以上) で、前へ 1 回転。
  const TURN = Math.PI * 2;
  function newAnim() {
    return { prevGround: true, air: 0, flipOn: false, w: 0, theta: 0, maxVy: 0, ease: 0, easeFrom: 0, rollT: -1, blend: 1, trailT: 0, flips: 0, rolls: 0, maxSpin: 0, spin: 0, squash: 1 };
  }

  function updateAnim(g, a, d, firing, quiet) {
    const p = g.p, grounded = p.onGround;
    const say = (type) => { const ev = { t: type, x: p.x, y: p.y - 26 }; A.handleEvent(ev); if (!quiet) Snd.event(ev); };
    if (!grounded) {
      if (a.prevGround) { a.air = 0; a.flipOn = false; a.theta = 0; a.ease = 0; a.maxVy = 0; }
      a.air += d;
      if (p.vy > a.maxVy) a.maxVy = p.vy;
      if (!a.flipOn && a.theta === 0 && a.air >= 0.1 && a.air < 0.2 && p.vy < -480 && p.jumping && !p.carry && p.stun <= 0) {
        a.flipOn = true; a.w = TURN / 0.54; a.flips++; say('flip');
      }
      if (a.flipOn) {
        a.theta = Math.max(-TURN, a.theta - a.w * d);
        a.trailT -= d;
        if (a.trailT <= 0) { a.trailT = 0.03; A.handleEvent({ t: 'flipTrail', x: p.x, y: p.y - 26 }); }
      }
    } else if (!a.prevGround) {
      if (a.flipOn) { a.flipOn = false; a.easeFrom = a.theta; a.ease = 0.0001; say('flipland'); }
      else if (a.maxVy > 1000 && p.stun <= 0) { a.rollT = 0; a.rolls++; say('roll'); }
    }
    if (a.ease > 0) {
      a.ease += d;
      const u = Math.min(1, a.ease / 0.1);
      a.theta = a.easeFrom + (-TURN - a.easeFrom) * u;
      if (u >= 1) { a.ease = 0; a.theta = 0; }
    } else if (grounded && !a.flipOn) {
      a.theta = 0;
    }
    let roll = 0, squash = 1;
    if (a.rollT >= 0) {
      a.rollT += d / 0.34;
      const u = Math.min(1, a.rollT);
      roll = TURN * (u * u * (3 - 2 * u));
      squash = 1 - 0.18 * Math.sin(Math.PI * u);
      if (a.rollT >= 1) a.rollT = -1;
    }
    a.blend += ((firing ? 0 : 1) - a.blend) * Math.min(1, d * 14);     // 撃つあいだは体を起こして狙う
    a.spin = (a.theta + roll) * a.blend;
    a.squash = squash;
    a.maxSpin = Math.max(a.maxSpin, Math.abs(a.theta));
    a.prevGround = grounded;
  }

  function nearestChaser(g) {
    const p = g.p;
    let best = null, bd = 520;
    for (const e of g.enemies) {
      if (e.state !== 'chase' || e.inside !== p.inside) continue;
      const d = p.x - e.x;
      if (d > -10 && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function handleEvents(g) {
    if (!g.events.length) return;
    for (const ev of g.events) {
      A.handleEvent(ev);
      Snd.event(ev);
      switch (ev.t) {
        case 'shoot': app.view.shoot = 1; app.view.fireT = 0.3; app.shake = Math.max(app.shake, C.GUN_BY_ID[ev.gun].kick || 0); break;
        case 'explode': app.shake = 0.4; break;
        case 'gift': {
          const gun = C.GUN_BY_ID[ev.gun];
          toast('🎁 ' + gun.icon + ' ' + gun.name + ' ゲット!', 2400);
          break;
        }
        case 'switch': {
          const gun = C.GUN_BY_ID[ev.gun];
          toast(gun.icon + ' ' + gun.name + '\n' + gun.trait, 1700);
          break;
        }
        case 'dry': toast('水ぎれ! タンク💧をひろおう', 1400); break;
        case 'nope': if (g.bombs <= 0) toast('水ばくだんが ないよ', 1200); break;
        case 'trip': app.shake = Math.max(app.shake, 0.15); break;
        case 'ride': toast(C.RIDES[ev.k].icon + ' ' + C.RIDES[ev.k].name + '! はやいよ' + (C.RIDES[ev.k].smash ? '\nじゃま物は ぜんぶ はね飛ばす!' : '\nぶつかると おりちゃう'), 1800); break;
        case 'unride': if (ev.why === 'time') toast('おりた', 900); break;
        case 'smash': app.shake = Math.max(app.shake, 0.2); break;
        case 'stage': showStageBanner(ev.n, ev.bonus, ev.ground); applySky(ev.n, false); if (ev.ground) tip('ground', 'ちじょうは谷が無いよ。車は長おしの高いジャンプ!\n🛹スケボーや🚙ラジコンカーに乗れるよ'); break;
        default: break;
      }
    }
    g.events.length = 0;
  }

  function playTips(g) {
    if (g.t > 0.7) tip('jump', 'ジャンプで谷をこえよう!');
    if (g.danger < 220) tip('fire', 'うしろの敵に「うつ」で水をかけよう!');
    const h = C.hints(g);
    if (h.door) tip('door', '「入る」でビルの中へ。近道だよ!');
    if (h.grab && !h.carrying) tip('grab', '「もつ」→「なげる」で物を投げられる!');
    if (g.t > 12) tip('bomb', '「水ばくだん」は敵をまとめて吹き飛ばす!');
  }

  function tick(now) {
    requestAnimationFrame(tick);
    let d = (now - app.last) / 1000;
    app.last = now;
    if (!(d > 0)) d = 0;                // 負や NaN は 0 に
    if (d > 0.1) d = 0.1;
    app.time += d;

    if (app.toastT > 0) {
      app.toastT -= d;
      if (app.toastT <= 0) els.toast.classList.remove('on');
    }

    let g;
    let cam = app.camPlay;
    const live = app.mode === 'play';
    if (app.mode === 'title' || app.mode === 'shop') {
      g = app.demo;
      app.acc += d;
      let n = 0;
      while (app.acc >= STEP && n < 4) {
        botStep(g, app.demoBot, STEP);
        C.step(g, STEP);
        g.events.length = 0;
        app.acc -= STEP; n++;
      }
      cam = app.camDemo;
      updateCamera(g, d, cam);
      if (g.over || g.p.x > 30000) ensureDemo();
    } else {
      g = app.g;
      if (live && !app.over) {
        app.acc += d;
        let n = 0;
        while (app.acc >= STEP && n < 4 && !g.over) {
          C.step(g, STEP);
          app.acc -= STEP; n++;
        }
        handleEvents(g);
        playTips(g);
        if (g.over) {
          app.over = true; app.overT = 0;
          g.p.stun = 1; releaseAll();
        }
      } else if (app.over && app.mode === 'play') {
        app.overT += d;
        handleEvents(g);
        if (app.overT > 0.9) endGame();
      }
      if (g && app.mode === 'play') {
        if (!(app.over && g.over === 'fell')) updateCamera(g, d, cam);   // おちる間はカメラを止める
        updateHud(false);
      }
    }
    if (!g) return;
    A.updateFx(d);
    if (g.p.ride && g.p.onGround && app.mode === 'play' && !app.over) {
      app.ridePuffT = (app.ridePuffT || 0) - d;
      if (app.ridePuffT <= 0) { app.ridePuffT = 0.06; A.handleEvent({ t: 'ridePuff', x: g.p.x, y: g.p.y }); }
    }

    // 描く
    resize();
    app.view.shoot = Math.max(0, app.view.shoot - d * 8);
    app.view.fireT = Math.max(0, (app.view.fireT || 0) - d);
    app.shake = Math.max(0, app.shake - d);
    const v = app.view;
    v.t = app.time;
    {
      const demoMode = app.mode === 'title' || app.mode === 'shop';
      const key = demoMode ? 'animDemo' : 'animPlay';
      if (!app[key]) app[key] = newAnim();
      if (demoMode || (app.mode === 'play' && !app.over)) updateAnim(g, app[key], d, !demoMode && v.fireT > 0, demoMode);
      v.spin = app[key].spin; v.squash = app[key].squash;
    }
    const stg = C.stageOf(g.p.x);
    if (v.stage !== stg) { v.stage = stg; v.theme = A.themeOf(stg); }
    v.facade = (v.facade || 0) + ((C.isGroundStage(stg) ? 1 : 0) - (v.facade || 0)) * Math.min(1, d * 4);
    v.groundY = cam.ref;
    if (app.mode === 'title' || app.mode === 'shop') { if (app.skyStage !== stg) applySky(stg, false); }
    const sx = app.shake > 0 ? (Math.random() - 0.5) * app.shake * 18 : 0;
    const sy = app.shake > 0 ? (Math.random() - 0.5) * app.shake * 18 : 0;
    v.camX = cam.x + sx; v.camY = cam.y + sy;
    const ch = nearestChaser(g);
    let aim = 0;
    if (ch) aim = Math.max(-0.5, Math.min(0.5, Math.atan2((ch.y - ch.h / 2) - (g.p.y - 30), g.p.x - ch.x)));
    v.aim += (aim - v.aim) * Math.min(1, d * 12);
    const c = ctx2d;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, els.cv.width, els.cv.height);
    c.setTransform(app.S, 0, 0, app.S, 0, 0);
    A.render(c, g, v);
  }

  // ------------------------------------------------------------ つなぐ
  function init() {
    bindButton('bJump', 'jump', true);
    bindButton('bFire', 'fire', true);
    bindButton('bBomb', 'bomb', false);
    bindButton('bSwitch', 'switch', false);
    bindButton('bDoor', 'door', false);
    bindButton('bGrab', 'grab', false);

    $('btnPlay').addEventListener('click', () => { Snd.play('ui'); startGame(); });
    $('btnShop').addEventListener('click', () => { Snd.play('ui'); openShop('title'); });
    $('btnShopBack').addEventListener('click', () => { Snd.play('ui'); show(app.fromShop === 'result' ? 'result' : 'title'); });
    $('shopList').addEventListener('click', onShopClick);
    $('btnAgain').addEventListener('click', () => { Snd.play('ui'); startGame(); });
    $('btnResultShop').addEventListener('click', () => { Snd.play('ui'); openShop('result'); });
    $('btnResultTitle').addEventListener('click', () => { Snd.play('ui'); show('title'); });
    $('btnPause').addEventListener('click', pauseGame);
    $('btnResume').addEventListener('click', resumeGame);
    $('btnPauseQuit').addEventListener('click', () => { app.over = false; show('title'); });
    const toggleSound = () => { save.mute = !save.mute; persist(); refreshLabels(); Snd.play('ui'); };
    $('btnSound').addEventListener('click', toggleSound);
    $('btnPauseSound').addEventListener('click', toggleSound);

    document.addEventListener('keydown', (e) => onKey(e, true));
    document.addEventListener('keyup', (e) => onKey(e, false));
    window.addEventListener('blur', () => { releaseAll(); pauseGame(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseAll(); pauseGame(); } });
    document.addEventListener('touchmove', (e) => { if (!e.target.closest('.shop-list')) e.preventDefault(); }, { passive: false });
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 120));
    if (window.ResizeObserver) new ResizeObserver(resize).observe(els.stage);

    applySky(1, true);
    show('title');
    app.last = performance.now();
    requestAnimationFrame(tick);

    // 自動テストから中身をのぞくための入口
    window.__app = {
      state: function () { return app; },
      game: function () { return app.g; },
      demo: function () { return app.demo; },
      save: function () { return save; },
      start: startGame,
      press: press,
      pause: pauseGame,
      resume: resumeGame,
      openShop: openShop,
      show: show,
      hud: updateHud,
      cache: function () { return app.cache; }
    };
  }

  init();
})();
