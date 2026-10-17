/*!
 * art.js — 絵。キャンバスに描くものは、ぜんぶここ。
 * 世界の座標 (core.js と同じ。x は右、y は下) で描く。
 * ロジックは持たず、core の状態を読むだけ。
 */
(function () {
  'use strict';

  const C = window.Core;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------ 道具
  function hash(a, b, c) {
    let h = (a * 374761393 + (b || 0) * 668265263 + (c || 0) * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function circle(c, x, y, r, fill) {
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill();
  }

  function line(c, x1, y1, x2, y2, w, col) {
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
    c.lineWidth = w; c.strokeStyle = col; c.lineCap = 'round'; c.stroke();
  }

  // ------------------------------------------------------------ 色
  const BUILD = [
    { body: '#5d5fa6', dark: '#46487f', top: '#8183c9' },
    { body: '#7b5fa6', dark: '#5e4784', top: '#9d83c9' },
    { body: '#4a77a8', dark: '#375a84', top: '#6c9bcb' },
    { body: '#4f9a9a', dark: '#3b7676', top: '#74bcbc' },
    { body: '#a6647f', dark: '#824d63', top: '#c986a1' }
  ];

  // ------------------------------------------------------------ ステージの配色 (ステージは終わりなく続く。8 種類をめぐり、周回ごとに色相をずらす)
  // h: ビルの色相 / sky: 空の 4 色 (上→下) / far: 遠い街の 2 色 / night: 夜 (星と月)
  const THEMES = [
    { name: 'ゆうやけ',   h: 262, sky: ['#6f62e8', '#b784e6', '#ff9fc4', '#ffd0a8'], far: ['#b79be0', '#8f7fcf'], sun: '#fff3c4', night: false, own: true },
    { name: 'ひるま',     h: 205, sky: ['#3f9bff', '#86ccff', '#cdeeff', '#fff6d6'], far: ['#9fd0f0', '#7fb5e0'], sun: '#fffbe0', night: false },
    { name: 'よぞら',     h: 248, sky: ['#14123d', '#2b2a7a', '#5b4bb0', '#b07ad0'], far: ['#3d3a8c', '#2b2a70'], sun: '#f4f1ff', night: true },
    { name: 'あさやけ',   h: 335, sky: ['#7f8de8', '#c78bd6', '#ff8fa3', '#ffb27a'], far: ['#e8a0b8', '#c487b0'], sun: '#fff0c4', night: false },
    { name: 'みどりの空', h: 165, sky: ['#2fb99a', '#8fe0c0', '#d4f5c4', '#fff5c0'], far: ['#8fd8b8', '#68bd9e'], sun: '#fffbd0', night: false },
    { name: 'あかね',     h: 18,  sky: ['#6a3a9e', '#d9507a', '#ff9a5c', '#ffd36e'], far: ['#a0509a', '#7d3f8c'], sun: '#fff0b0', night: false },
    { name: 'ネオン',     h: 300, sky: ['#0b0b2e', '#3a0f6a', '#a21caf', '#ff5ea0'], far: ['#4b1d7a', '#33135a'], sun: '#ffd1f0', night: true },
    { name: 'こおり',     h: 208, sky: ['#7db8ff', '#bfe0ff', '#e6f4ff', '#ffffff'], far: ['#b5d2ec', '#97b9d6'], sun: '#ffffff', night: false }
  ];
  const palCache = {};

  function themeOf(stage) {
    const i = Math.max(0, stage - 1);
    const t = THEMES[i % THEMES.length];
    const loop = Math.floor(i / THEMES.length);
    return { idx: i % THEMES.length, loop: loop, name: t.name, base: t, sky: t.sky, far: t.far, sun: t.sun, night: t.night };
  }

  function skyCss(theme) {
    const s = theme.sky;
    return 'linear-gradient(180deg, ' + s[0] + ' 0%, ' + s[1] + ' 38%, ' + s[2] + ' 72%, ' + s[3] + ' 100%)';
  }

  /** ビルの色。最初のステージだけ手で決めた色、あとは色相から作る (周回ごとに 40 度ずつずらす)。 */
  function buildPal(theme, style) {
    const key = theme.idx + ':' + theme.loop + ':' + style;
    if (palCache[key]) return palCache[key];
    let p;
    if (theme.base.own && theme.loop === 0) {
      p = BUILD[style % BUILD.length];
    } else {
      const off = [0, 28, -28, 56, -56][style % 5];
      const hue = (theme.base.h + theme.loop * 40 + off + 360) % 360;
      const sat = theme.night ? 34 : 38, L = theme.night ? 30 : 47;
      p = {
        body: 'hsl(' + hue + ',' + sat + '%,' + L + '%)',
        dark: 'hsl(' + hue + ',' + (sat + 4) + '%,' + (L - 10) + '%)',
        top: 'hsl(' + hue + ',' + (sat + 4) + '%,' + (L + 14) + '%)'
      };
    }
    palCache[key] = p;
    return p;
  }

  // ------------------------------------------------------------ 背景 (画面に固定のもの・ゆっくり動くもの)
  function drawBackdrop(c, view) {
    const w = view.w, h = view.h;
    const th = view.theme || themeOf(1);
    // 星 (夜のステージ)
    if (th.night) {
      for (let i = 0; i < 46; i++) {
        const x = ((hash(i, 21) * (w + 60) - view.camX * 0.03) % (w + 60) + (w + 60)) % (w + 60) - 30;
        const y = hash(i, 22) * h * 0.62;
        const tw = 0.5 + 0.5 * Math.sin(view.t * (1.2 + hash(i, 23)) + i);
        c.globalAlpha = 0.35 + 0.55 * tw;
        circle(c, x, y, 0.8 + hash(i, 24) * 1.3, '#fff');
      }
      c.globalAlpha = 1;
    }
    // 太陽・月
    const sx = w * 0.74, sy = h * 0.2;
    const glow = c.createRadialGradient(sx, sy, 6, sx, sy, 120);
    glow.addColorStop(0, th.night ? 'rgba(220,215,255,.7)' : 'rgba(255,244,200,.95)');
    glow.addColorStop(0.35, th.night ? 'rgba(170,160,255,.28)' : 'rgba(255,214,170,.5)');
    glow.addColorStop(1, 'rgba(255,190,200,0)');
    c.fillStyle = glow;
    c.fillRect(sx - 130, sy - 130, 260, 260);
    circle(c, sx, sy, 34, th.sun);

    // 雲
    for (let i = 0; i < 7; i++) {
      const par = 0.06 + hash(i, 1) * 0.05;
      const span = w + 260;
      let x = ((hash(i, 2) * span * 2 - view.camX * par) % span + span) % span - 130;
      const y = h * (0.06 + hash(i, 3) * 0.34) - view.camY * 0.02;
      const s = 0.8 + hash(i, 4) * 0.9;
      c.fillStyle = th.night ? 'rgba(180,170,255,.18)' : 'rgba(255,255,255,.55)';
      c.beginPath();
      c.ellipse(x, y, 46 * s, 14 * s, 0, 0, TAU);
      c.ellipse(x - 26 * s, y + 4 * s, 30 * s, 11 * s, 0, 0, TAU);
      c.ellipse(x + 28 * s, y + 5 * s, 32 * s, 10 * s, 0, 0, TAU);
      c.fill();
    }

    // 地上ステージの街並み (店・窓・ひさし)。高さはいまの道の高さに合わせる
    if ((view.facade || 0) > 0.01) {
      const base = (view.groundY != null ? view.groundY : 0) - view.camY;
      const cell = 120, off = view.camX * 0.5;
      const i0 = Math.floor(off / cell) - 1, n = Math.ceil(w / cell) + 3;
      c.save(); c.globalAlpha = Math.min(1, view.facade);
      for (let i = i0; i < i0 + n; i++) {
        const bh = 220 + hash(i, 31) * 190, bw = cell - 8, x = i * cell - off;
        const pal = buildPal(th, Math.floor(hash(i, 32) * 5));
        c.fillStyle = pal.body; c.fillRect(x, base - bh, bw, bh);
        c.fillStyle = pal.top; c.fillRect(x - 2, base - bh - 4, bw + 4, 8);
        for (let r2 = 0; r2 * 44 + 30 < bh - 70; r2++) {
          for (let k = 0; k < 3; k++) {
            const lit = hash(i, r2, k + 40) > 0.45;
            c.fillStyle = lit ? '#ffe6a0' : (th.night ? '#2b2a58' : '#3c4476');
            rr(c, x + 12 + k * 32, base - bh + 22 + r2 * 44, 20, 26, 3); c.fill();
          }
        }
        // 1 階の店: ひさしと入り口
        const awn = ['#ff6b6b', '#4cc9f0', '#ffd166', '#7bd88f', '#c77dff'][Math.floor(hash(i, 33) * 5)];
        c.fillStyle = awn;
        for (let k = 0; k < 6; k++) { if (k % 2 === 0) c.fillRect(x + 6 + k * 16, base - 58, 16, 12); }
        c.fillStyle = 'rgba(255,255,255,.88)';
        for (let k = 0; k < 6; k++) { if (k % 2 === 1) c.fillRect(x + 6 + k * 16, base - 58, 16, 12); }
        c.fillStyle = th.night ? '#ffe9a8' : '#cfeaff'; rr(c, x + 10, base - 42, 38, 32, 3); c.fill();
        c.fillStyle = '#5b3f86'; rr(c, x + 60, base - 44, 24, 44, 4); c.fill();
      }
      c.restore();
    }

    // 遠くの街
    const layers = [
      { par: 0.12, col: th.far[0], cell: 78, base: 0.86, hmin: 90, hmax: 240 },
      { par: 0.26, col: th.far[1], cell: 64, base: 0.93, hmin: 90, hmax: 260 }
    ];
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      const off = view.camX * L.par;
      const i0 = Math.floor(off / L.cell) - 1;
      const n = Math.ceil(w / L.cell) + 3;
      const base = h * L.base - view.camY * (0.04 + li * 0.05);
      c.fillStyle = L.col;
      for (let i = i0; i < i0 + n; i++) {
        const bh = L.hmin + hash(i, li, 9) * (L.hmax - L.hmin);
        const bw = L.cell - 6 + hash(i, li, 10) * 10;
        const x = i * L.cell - off;
        c.fillRect(x, base - bh, bw, bh + 600);
        if (hash(i, li, 11) > 0.6) c.fillRect(x + bw * 0.3, base - bh - 18, 4, 18);
      }
    }
  }

  // ------------------------------------------------------------ ビル
  /** 地上の道: 歩道・道路・中央線・横断歩道・街灯。区画の継ぎ目は見えない (同じ絵がつづく)。 */
  function drawStreet(c, g, b, view, t) {
    const th = themeOf(C.stageOf(b.x));
    const x = b.x, w = b.w, top = b.roofY;
    const bottom = view.camY + view.h + 40;
    const x0 = Math.max(x, view.camX - 40), x1 = Math.min(x + w, view.camX + view.w + 40);
    if (x1 <= x0) return;
    const night = th.night;
    c.fillStyle = night ? '#6a678c' : '#aaa5c6'; c.fillRect(x, top, w, 14);                 // 歩道
    c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(x, top, w, 3);
    c.fillStyle = night ? '#2c294a' : '#4b4868'; c.fillRect(x, top + 14, w, bottom - top);   // 道路
    c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(x, top + 14, w, 5);
    // 中央線 (点線)
    c.fillStyle = night ? '#d9c36a' : '#ffe27a';
    for (let xx = Math.floor(x0 / 70) * 70; xx < x1; xx += 70) c.fillRect(xx, top + 78, 36, 5);
    // 横断歩道 (1000px ごとに 1 つ)
    for (let xx = Math.floor(x0 / 1000) * 1000 + 520; xx < x1 + 120; xx += 1000) {
      if (xx + 90 < x0 || xx > x1) continue;
      c.fillStyle = 'rgba(255,255,255,.75)';
      for (let k = 0; k < 6; k++) c.fillRect(xx + k * 16, top + 24, 9, 110);
    }
    // 道路を走る車 (飾り。じゃま物ではない。区画のはしで切って、継ぎ目でも同じ位置に見えるようにする)
    c.save();
    c.beginPath(); c.rect(x, top + 14, w, 200); c.clip();
    const P = 1500;
    for (let lane = 0; lane < 2; lane++) {
      const dir = lane === 0 ? -1 : 1, v = lane === 0 ? 150 : 110, base = top + (lane === 0 ? 70 : 128);
      for (let m = Math.floor((x0 - 150) / P) - 1; m <= Math.ceil((x1 + 150) / P); m++) {
        for (let j = 0; j < 2; j++) {
          const seed = hash(j, lane, 7);
          const px = m * P + (((seed * P + dir * t * v * (0.8 + seed * 0.5)) % P) + P) % P;
          if (px < x0 - 80 || px > x1 + 80) continue;
          const col = ['#d96a6a', '#5aa9c9', '#d9b85a', '#68b87a', '#a874d0'][Math.floor(hash(m, j, lane) * 5)];
          c.save(); c.translate(px, base); c.scale(dir * 0.9, 0.9);
          c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(0, 0, 33, 3, 0, 0, TAU); c.fill();
          c.fillStyle = col; rr(c, -32, -20, 64, 17, 6); c.fill();
          c.beginPath(); c.moveTo(-20, -20); c.lineTo(-13, -33); c.lineTo(12, -33); c.lineTo(21, -20); c.closePath(); c.fill();
          c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(-31, -12, 62, 8);
          c.fillStyle = '#cfe6f5'; c.beginPath(); c.moveTo(-16, -21); c.lineTo(-11, -30); c.lineTo(11, -30); c.lineTo(17, -21); c.closePath(); c.fill();
          circle(c, 29, -12, 2.4, '#fff3a8'); circle(c, -29, -12, 2, '#ff8a8a');
          circle(c, -18, -4, 6, '#23223a'); circle(c, 18, -4, 6, '#23223a');
          c.restore();
        }
      }
    }
    c.restore();
    // 街灯 (320px ごと。よるはあかりがにじむ)
    for (let xx = Math.floor(x0 / 320) * 320 + 160; xx < x1 + 20; xx += 320) {
      if (xx < x0 - 20) continue;
      c.fillStyle = '#4a4766'; c.fillRect(xx - 2, top - 96, 4, 96);
      c.fillRect(xx - 2, top - 96, 20, 4);
      c.fillStyle = night ? '#fff0b0' : '#fff6d0'; rr(c, xx + 10, top - 98, 14, 8, 3); c.fill();
      if (night) {
        const gr = c.createRadialGradient(xx + 17, top - 90, 2, xx + 17, top - 50, 70);
        gr.addColorStop(0, 'rgba(255,240,170,.55)'); gr.addColorStop(1, 'rgba(255,240,170,0)');
        c.fillStyle = gr; c.fillRect(xx - 60, top - 100, 154, 150);
      }
    }
    void g; void t;
  }

  function drawBuilding(c, g, b, view, t) {
    if (b.ground) { drawStreet(c, g, b, view, t); return; }
    const pal = buildPal(themeOf(C.stageOf(b.x)), b.style);
    const x = b.x, w = b.w, top = b.roofY;
    const bottom = view.camY + view.h + 40;
    // 本体
    c.fillStyle = pal.body;
    c.fillRect(x, top, w, bottom - top);
    c.fillStyle = pal.dark;
    c.fillRect(x + w - 10, top, 10, bottom - top);
    // ふち飾り
    c.fillStyle = pal.top;
    rr(c, x - 4, top - 2, w + 8, 12, 4); c.fill();
    c.fillStyle = 'rgba(255,255,255,.25)';
    c.fillRect(x - 2, top - 1, w + 4, 3);
    // まど
    const inHere = g.p.inside === b.i;
    const rowH = 50, colW = 40;
    const y0 = b.door ? b.floorY + 26 : top + 22;     // ドアのあるビルは、1 階 (屋内) の下から
    const rows = Math.ceil((bottom - y0) / rowH);
    for (let r = 0; r < rows; r++) {
      const wy = y0 + r * rowH;
      if (wy > view.camY + view.h) break;
      if (wy + 34 < view.camY) continue;
      for (let cI = 0; cI * colW + 30 < w - 10; cI++) {
        const wx = x + 16 + cI * colW;
        if (wx + 22 > view.camX + view.w + 10 || wx < view.camX - 30) continue;
        const lit = hash(b.i, r, cI) > 0.5;
        c.fillStyle = lit ? '#ffe6a0' : '#2f3566';
        rr(c, wx, wy, 22, 32, 3); c.fill();
        if (lit) { c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(wx + 3, wy + 3, 5, 26); }
      }
    }
    if (b.door) drawRoomWindowBand(c, g, b, inHere, t);
    // 屋上のドア小屋
    if (b.door) drawShed(c, b);
    // かざり (水のタンク・アンテナ)
    const deco = hash(b.i, 77);
    if (deco < 0.3 && b.w > 260) {
      const tx = x + b.w - 70;
      c.fillStyle = '#8a6a5a'; c.fillRect(tx + 6, top - 12, 3, 12); c.fillRect(tx + 30, top - 12, 3, 12);
      c.fillStyle = '#c9a28c'; rr(c, tx, top - 44, 40, 34, 8); c.fill();
      c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(tx + 6, top - 40, 6, 24);
    } else if (deco > 0.75) {
      const ax = x + 30 + hash(b.i, 78) * (w - 80);
      line(c, ax, top, ax, top - 38, 3, '#a9a9c9');
      line(c, ax - 10, top - 30, ax + 10, top - 30, 2, '#a9a9c9');
      circle(c, ax, top - 40, 3, (Math.floor(t * 2) % 2) ? '#ff6b9d' : '#ffd1e0');
    }
  }

  function drawShed(c, b) {
    const dx = b.doorX, top = b.roofY;
    c.fillStyle = '#e8e2f5';
    rr(c, dx - 24, top - 50, 48, 50, 6); c.fill();
    c.fillStyle = '#c9bfe6'; c.fillRect(dx - 24, top - 50, 48, 7);
    c.fillStyle = '#7a5cc8';
    rr(c, dx - 11, top - 38, 22, 38, 10); c.fill();
    c.fillStyle = '#ffd166'; circle(c, dx + 6, top - 18, 2.2, '#ffd166');
    c.fillStyle = '#ff6b9d';
    c.beginPath(); c.moveTo(dx - 7, top - 58); c.lineTo(dx + 7, top - 58); c.lineTo(dx, top - 50); c.closePath(); c.fill();
  }

  /** 1 階ぶんの窓。ビルの中にいるときは、かべを切り取って部屋を見せる。 */
  function drawRoomWindowBand(c, g, b, inHere, t) {
    const x0 = b.x + 8, x1 = b.x + b.w - 8;
    const y0 = b.roofY + 14, y1 = b.floorY + 12;
    if (!inHere) {
      // 外から見ると、あかりのついた大きな窓
      for (let xx = x0 + 6; xx + 30 < x1; xx += 46) {
        c.fillStyle = hash(b.i, xx | 0) > 0.25 ? '#ffe6a0' : '#ffd1e0';
        rr(c, xx, y0 + 10, 34, 70, 4); c.fill();
        c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(xx + 4, y0 + 14, 6, 62);
      }
      return;
    }
    // 切り取った部屋
    c.fillStyle = '#ffe3ef';
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.fillStyle = '#ffd0e2';
    for (let xx = x0 + 10; xx < x1; xx += 40) c.fillRect(xx, y0, 14, y1 - y0);
    c.fillStyle = '#fff6fa'; c.fillRect(x0, y0, x1 - x0, 8);
    // 絵や植物
    for (let xx = x0 + 70; xx < x1 - 50; xx += 120) {
      if (hash(b.i, xx | 0, 5) > 0.5) {
        c.fillStyle = '#fff'; rr(c, xx, y0 + 26, 36, 26, 3); c.fill();
        c.fillStyle = hash(b.i, xx | 0, 6) > 0.5 ? '#9be0ff' : '#ffd166'; c.fillRect(xx + 4, y0 + 30, 28, 18);
      }
    }
    // 床
    c.fillStyle = '#b07a52'; c.fillRect(x0, b.floorY, x1 - x0, 14);
    c.fillStyle = '#c99166'; c.fillRect(x0, b.floorY, x1 - x0, 3);
    c.fillStyle = 'rgba(0,0,0,.12)';
    for (let xx = x0; xx < x1; xx += 38) c.fillRect(xx, b.floorY + 3, 2, 11);
    // 入ってきたドア
    c.fillStyle = '#7a5cc8'; rr(c, b.doorX - 15, b.floorY - 62, 30, 62, 12); c.fill();
    c.fillStyle = '#ffd166'; circle(c, b.doorX + 8, b.floorY - 30, 2.4, '#ffd166');
    // 出口
    const ex = b.exitX;
    c.fillStyle = '#2fbf71'; rr(c, ex - 18, b.floorY - 66, 36, 66, 6); c.fill();
    c.fillStyle = '#7cf0b0'; rr(c, ex - 13, b.floorY - 60, 26, 54, 4); c.fill();
    c.fillStyle = '#1b8a50'; rr(c, ex - 22, b.floorY - 84, 44, 16, 4); c.fill();
    c.fillStyle = '#fff'; c.font = '700 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('でぐち', ex, b.floorY - 76);
    // 天井のライト
    for (let xx = x0 + 60; xx < x1; xx += 130) {
      c.fillStyle = 'rgba(255,255,220,.8)'; rr(c, xx - 16, y0 + 8, 32, 5, 2); c.fill();
      const gr = c.createRadialGradient(xx, y0 + 14, 2, xx, y0 + 60, 70);
      gr.addColorStop(0, 'rgba(255,255,200,.35)'); gr.addColorStop(1, 'rgba(255,255,200,0)');
      c.fillStyle = gr; c.fillRect(xx - 70, y0 + 8, 140, 110);
    }
    void t;
  }

  // ------------------------------------------------------------ じゃま物・もの・アイテム
  function drawObstacle(c, ob, base) {
    const O = C.OBSTACLES[ob.t];
    const x = ob.x, y = base;
    if (ob.t === 'cone') {
      c.fillStyle = '#ff8a3c';
      c.beginPath(); c.moveTo(x - 8, y); c.lineTo(x - 3, y - O.h); c.lineTo(x + 3, y - O.h); c.lineTo(x + 8, y); c.closePath(); c.fill();
      c.fillStyle = '#fff'; c.fillRect(x - 5.5, y - 13, 11, 4);
      c.fillStyle = '#e06a1f'; c.fillRect(x - 11, y - 3, 22, 3);
    } else if (ob.t === 'box') {
      c.fillStyle = '#c9a074'; rr(c, x - 14, y - O.h, 28, O.h, 3); c.fill();
      c.fillStyle = '#b78a5c'; c.fillRect(x - 14, y - O.h, 28, 5);
      c.fillStyle = 'rgba(255,255,255,.55)'; c.fillRect(x - 3, y - O.h, 6, O.h);
      c.fillStyle = '#7a5a3a'; c.font = '700 8px sans-serif'; c.textAlign = 'center'; c.fillText('▼', x + 8, y - 8);
    } else if (ob.t === 'car') {
      const col = ['#ff6b6b', '#4cc9f0', '#ffd166', '#7bd88f', '#c77dff'][Math.floor(hash(Math.round(x), 41) * 5)];
      c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(x, y, 34, 3.4, 0, 0, TAU); c.fill();
      c.fillStyle = col; rr(c, x - 32, y - 20, 64, 17, 6); c.fill();                  // 車体
      c.beginPath(); c.moveTo(x - 20, y - 20); c.lineTo(x - 13, y - 33); c.lineTo(x + 12, y - 33); c.lineTo(x + 21, y - 20); c.closePath(); c.fill();   // 屋根
      c.fillStyle = 'rgba(255,255,255,.28)'; rr(c, x - 31, y - 19, 62, 5, 3); c.fill();
      c.fillStyle = '#dff4ff';
      c.beginPath(); c.moveTo(x - 16, y - 21); c.lineTo(x - 11, y - 30); c.lineTo(x - 1, y - 30); c.lineTo(x - 1, y - 21); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(x + 2, y - 21); c.lineTo(x + 2, y - 30); c.lineTo(x + 11, y - 30); c.lineTo(x + 17, y - 21); c.closePath(); c.fill();
      circle(c, x + 29, y - 12, 2.6, '#fff3a8'); circle(c, x - 29, y - 12, 2.2, '#ff8a8a');
      circle(c, x - 18, y - 4, 6, '#2b2a3a'); circle(c, x + 18, y - 4, 6, '#2b2a3a');
      circle(c, x - 18, y - 4, 2.4, '#b9b9c9'); circle(c, x + 18, y - 4, 2.4, '#b9b9c9');
    } else if (ob.t === 'bin') {
      c.fillStyle = '#6fae8c'; rr(c, x - 9, y - 26, 18, 26, 3); c.fill();
      c.fillStyle = '#4e8a6b'; rr(c, x - 11, y - 29, 22, 5, 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(x - 6, y - 22, 3, 18);
      c.fillStyle = '#4e8a6b'; c.fillRect(x - 9, y - 12, 18, 2);
    } else if (ob.t === 'hydrant') {
      c.fillStyle = '#ff5d5d'; rr(c, x - 6, y - 21, 12, 21, 3); c.fill();
      circle(c, x, y - 22, 6.5, '#ff5d5d');
      c.fillStyle = '#d63c3c'; c.fillRect(x - 10, y - 14, 20, 5); rr(c, x - 8, y - 4, 16, 4, 1); c.fill();
      circle(c, x, y - 28, 2.2, '#ffe27a');
    } else if (ob.t === 'bench') {
      c.fillStyle = '#b07a52'; rr(c, x - 19, y - 19, 38, 6, 2); c.fill();
      c.fillStyle = '#c99166'; rr(c, x - 19, y - 12, 38, 5, 2); c.fill();
      c.fillStyle = '#5b5876'; c.fillRect(x - 17, y - 8, 3, 8); c.fillRect(x + 14, y - 8, 3, 8);
    } else {
      c.fillStyle = '#9aa3bd'; rr(c, x - 17, y - O.h, 34, O.h, 4); c.fill();
      c.fillStyle = '#7c86a3';
      for (let i = 0; i < 4; i++) c.fillRect(x - 14 + i * 8, y - O.h + 4, 4, O.h - 8);
      c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(x - 17, y - O.h, 34, 3);
    }
  }

  function drawProp(c, kind, x, y, rot, scale) {
    // (x, y) は物の底の中心
    c.save();
    c.translate(x, y);
    if (scale) c.scale(scale, scale);
    if (rot) { c.translate(0, -11); c.rotate(rot); c.translate(0, 11); }
    switch (kind) {
      case 'crate':
        c.fillStyle = '#d9a35f'; rr(c, -13, -26, 26, 26, 3); c.fill();
        c.strokeStyle = '#a8742f'; c.lineWidth = 2.5; c.strokeRect(-11, -24, 22, 22);
        line(c, -11, -24, 11, -2, 2.5, '#a8742f'); line(c, 11, -24, -11, -2, 2.5, '#a8742f');
        break;
      case 'barrel':
        c.fillStyle = '#b5683c'; rr(c, -11, -28, 22, 28, 8); c.fill();
        c.fillStyle = '#7f4521'; c.fillRect(-11, -22, 22, 3); c.fillRect(-11, -8, 22, 3);
        c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(-7, -26, 3, 24);
        break;
      case 'pot':
        c.fillStyle = '#e07a4f';
        c.beginPath(); c.moveTo(-10, -18); c.lineTo(10, -18); c.lineTo(7, 0); c.lineTo(-7, 0); c.closePath(); c.fill();
        c.fillStyle = '#c4613a'; rr(c, -12, -22, 24, 6, 2); c.fill();
        circle(c, -4, -26, 6, '#5ccf7a'); circle(c, 5, -28, 7, '#44b866'); circle(c, 0, -33, 5, '#7be08f');
        break;
      case 'bucket':
        c.fillStyle = '#4ea8ff';
        c.beginPath(); c.moveTo(-11, -20); c.lineTo(11, -20); c.lineTo(8, 0); c.lineTo(-8, 0); c.closePath(); c.fill();
        c.fillStyle = '#9ad1ff'; c.fillRect(-11, -20, 22, 3);
        c.strokeStyle = '#6b7aa8'; c.lineWidth = 1.6; c.beginPath(); c.arc(0, -20, 10, Math.PI, TAU); c.stroke();
        break;
      case 'tire':
        c.translate(0, -12);
        circle(c, 0, 0, 12, '#2c2c3a'); circle(c, 0, 0, 5.5, '#8a8aa8');
        c.strokeStyle = '#4a4a5e'; c.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(Math.cos(i) * 8, Math.sin(i) * 8); c.lineTo(Math.cos(i) * 11.5, Math.sin(i) * 11.5); c.stroke(); }
        break;
      case 'duck':
        c.fillStyle = '#ffd93d'; c.beginPath(); c.ellipse(0, -9, 12, 8, 0, 0, TAU); c.fill();
        circle(c, 7, -19, 7, '#ffd93d');
        c.fillStyle = '#ff9f43'; c.beginPath(); c.moveTo(12, -19); c.lineTo(19, -17); c.lineTo(12, -15); c.closePath(); c.fill();
        circle(c, 8, -21, 1.5, '#222');
        c.fillStyle = '#f5c518'; c.beginPath(); c.ellipse(-3, -9, 6, 4, -0.4, 0, TAU); c.fill();
        break;
      default: break;
    }
    c.restore();
  }

  function drawBomb(c, x, y, rot, t) {
    c.save(); c.translate(x, y); c.rotate(rot || 0);
    circle(c, 0, 0, 11, '#3a86ff');
    circle(c, -3.5, -3.5, 3.5, 'rgba(255,255,255,.55)');
    c.fillStyle = '#2b6fd9'; c.fillRect(-4, -14, 8, 5);
    c.strokeStyle = '#ffb703'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -14); c.quadraticCurveTo(5, -20, 9, -17); c.stroke();
    circle(c, 9, -17, 2.4 + Math.sin((t || 0) * 30) * 0.8, '#ff6b6b');
    c.restore();
  }

  function drawItem(c, it, t) {
    const bob = Math.sin(t * 4 + it.x * 0.05) * 2.5;
    const x = it.x, y = it.y + bob;
    if (it.t === 'coin') {
      const sq = Math.abs(Math.cos(t * 3 + it.x * 0.07)) * 0.75 + 0.25;
      c.save(); c.translate(x, y); c.scale(sq, 1);
      circle(c, 0, 0, 9, '#ffcf3d'); circle(c, 0, 0, 6.2, '#ffe27a');
      c.fillStyle = '#e3a008'; c.font = '700 9px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('¢', 0, 0.5);
      c.restore();
    } else if (it.t === 'tank') {
      const gr = c.createRadialGradient(x, y, 2, x, y, 20);
      gr.addColorStop(0, 'rgba(120,210,255,.5)'); gr.addColorStop(1, 'rgba(120,210,255,0)');
      c.fillStyle = gr; c.fillRect(x - 20, y - 20, 40, 40);
      c.fillStyle = '#4cc9f0';
      c.beginPath(); c.moveTo(x, y - 12); c.bezierCurveTo(x + 12, y + 2, x + 9, y + 12, x, y + 12);
      c.bezierCurveTo(x - 9, y + 12, x - 12, y + 2, x, y - 12); c.fill();
      c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.ellipse(x - 3.5, y + 1, 2.2, 4.5, 0.3, 0, TAU); c.fill();
    } else if (it.t === 'bomb') {
      drawBomb(c, x, y + 1, 0, t);
    } else if (it.t === 'gift') {
      const gr = c.createRadialGradient(x, y, 2, x, y, 24);
      gr.addColorStop(0, 'rgba(255,170,220,.55)'); gr.addColorStop(1, 'rgba(255,170,220,0)');
      c.fillStyle = gr; c.fillRect(x - 24, y - 24, 48, 48);
      c.fillStyle = '#ff6b9d'; rr(c, x - 11, y - 8, 22, 18, 3); c.fill();
      c.fillStyle = '#ff9ec0'; rr(c, x - 12, y - 12, 24, 7, 3); c.fill();
      c.fillStyle = '#ffe66d'; c.fillRect(x - 2, y - 12, 4, 22);
      c.beginPath(); c.arc(x - 4, y - 14, 4, 0, TAU); c.arc(x + 4, y - 14, 4, 0, TAU); c.strokeStyle = '#ffe66d'; c.lineWidth = 2; c.stroke();
    }
  }

  // ------------------------------------------------------------ 主人公
  function drawGunSprite(c, gunId, color) {
    // 腕の先に持つ水でっぽう。+x が銃口 (あとで反転して後ろへ向ける)
    c.fillStyle = '#e9ecff';
    switch (gunId) {
      case 'sniper': rr(c, 0, -3, 24, 5, 2); c.fill(); c.fillStyle = color; c.fillRect(6, -6, 8, 3); break;
      case 'cutter': rr(c, 0, -2, 22, 4, 2); c.fill(); c.fillStyle = color; c.fillRect(2, -4, 6, 8); break;
      case 'hose': rr(c, 0, -4, 16, 8, 3); c.fill(); c.fillStyle = color; rr(c, 14, -6, 7, 12, 3); c.fill(); break;
      case 'bazooka': c.fillStyle = color; rr(c, -2, -6, 22, 12, 5); c.fill(); c.fillStyle = '#fff'; circle(c, 20, 0, 3, '#fff'); break;
      case 'shot': rr(c, 0, -4, 20, 7, 2); c.fill(); c.fillStyle = color; c.fillRect(8, 3, 8, 3); break;
      case 'gatling': rr(c, 0, -5, 14, 10, 2); c.fill(); c.fillStyle = color; c.fillRect(14, -4, 9, 2); c.fillRect(14, 0, 9, 2); break;
      case 'twin': rr(c, 0, -5, 16, 3, 1); c.fill(); rr(c, 0, 0, 16, 3, 1); c.fill(); c.fillStyle = color; c.fillRect(-2, -5, 5, 8); break;
      case 'bubble': rr(c, 0, -3, 12, 7, 3); c.fill(); circle(c, 15, 0, 6, color); break;
      case 'rainbow': rr(c, 0, -3, 16, 7, 3); c.fill(); c.fillStyle = '#ff6b6b'; c.fillRect(16, -3, 3, 2); c.fillStyle = '#ffd166'; c.fillRect(16, -1, 3, 2); c.fillStyle = '#4cc9f0'; c.fillRect(16, 1, 3, 2); break;
      default: rr(c, 0, -3, 16, 6, 2); c.fill(); c.fillStyle = color; c.fillRect(-1, -3, 6, 9); c.fillRect(14, -2, 4, 4); break;
    }
  }

  function drawSpyVector(c, o) {
    c.save();
    c.translate(o.x, o.y);
    const run = o.air ? 0 : o.phase;
    const bob = o.air ? 0 : Math.abs(Math.sin(run)) * 2.2;
    const tuck = o.air ? 1 : 0;
    // 影
    if (!o.air) { c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(0, 0, 11, 2.6, 0, 0, TAU); c.fill(); }
    if (o.inv > 0 && Math.floor(o.t * 20) % 2 === 0) c.globalAlpha = 0.45;
    c.translate(0, -bob);
    const lean = o.stun > 0 ? -0.25 : 0.1;
    c.rotate(lean);

    // マフラー (うしろになびく)
    const wave = Math.sin(o.t * 14);
    c.fillStyle = '#ff5d8f';
    c.beginPath();
    c.moveTo(-3, -31);
    c.quadraticCurveTo(-14, -31 + wave * 2, -24, -28 + wave * 4);
    c.quadraticCurveTo(-30, -26 + wave * 5, -34, -30 + wave * 6);
    c.lineTo(-33, -24 + wave * 6);
    c.quadraticCurveTo(-18, -23 + wave * 3, -3, -26);
    c.closePath(); c.fill();
    c.fillStyle = '#ff8fb2';
    c.fillRect(-26, -30 + wave * 4, 5, 3);

    // ポニーテール
    const sw = Math.sin(o.t * 12 + 1) * 3;
    c.fillStyle = '#4b3a8f';
    c.beginPath();
    c.moveTo(-8, -43);
    c.quadraticCurveTo(-20, -48 + sw, -23, -36 + sw * 1.6);
    c.quadraticCurveTo(-14, -39, -8, -37);
    c.closePath(); c.fill();
    circle(c, -9, -41, 2.6, '#ff5d8f');

    // うしろの足
    const a1 = tuck ? 0.9 : Math.sin(run) * 0.9;
    const a2 = tuck ? -0.5 : -Math.sin(run) * 0.9;
    function leg(a, col) {
      c.save(); c.translate(0, -14);
      c.rotate(a);
      c.strokeStyle = col; c.lineWidth = 5.5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, tuck ? 7 : 11); c.stroke();
      circle(c, 1.5, tuck ? 9 : 13, 4, '#ff5d8f');
      c.restore();
    }
    leg(a1, '#3b3170');

    // うしろの腕 (水でっぽうを後ろへ向ける)
    const aim = o.aim || 0;
    c.save();
    c.translate(-1, -28);
    if (o.carry) {
      c.strokeStyle = '#c8bdff'; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(-2, -16); c.stroke();
    } else {
      const recoil = (o.shoot || 0) * 3;
      c.rotate(Math.PI - aim);       // 後ろ向き
      c.strokeStyle = '#c8bdff'; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(9 - recoil, 0); c.stroke();
      c.save(); c.translate(8 - recoil, 0);
      c.scale(1, -1);                // 上下をそろえる
      drawGunSprite(c, o.gunId, o.gunColor);
      c.restore();
      circle(c, 9 - recoil, 0, 3, '#ffe0cc');
    }
    c.restore();

    // からだ (トレンチコート)
    const coat = c.createLinearGradient(0, -34, 0, -12);
    coat.addColorStop(0, '#b9a8ff'); coat.addColorStop(1, '#8f7ae6');
    c.fillStyle = coat;
    c.beginPath();
    c.moveTo(-7, -33); c.lineTo(7, -33); c.lineTo(9, -13); c.lineTo(-9, -13); c.closePath(); c.fill();
    c.fillStyle = '#6f5ccf'; c.fillRect(-9, -22, 18, 3);                 // ベルト
    circle(c, 0, -20.5, 1.8, '#ffd166');
    c.fillStyle = '#f4efff';                                              // えり
    c.beginPath(); c.moveTo(-6, -33); c.lineTo(0, -28); c.lineTo(6, -33); c.lineTo(3, -34); c.lineTo(0, -31); c.lineTo(-3, -34); c.closePath(); c.fill();

    // まえの足
    leg(a2, '#4a3f8a');

    // まえの腕
    c.save(); c.translate(1, -29);
    if (o.carry) {
      c.strokeStyle = '#c8bdff'; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(4, -15); c.stroke();
    } else {
      const sw2 = o.air ? -1.0 : Math.sin(run + Math.PI) * 0.9;
      c.rotate(sw2);
      c.strokeStyle = '#c8bdff'; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 9); c.stroke();
      circle(c, 0, 10, 3, '#ffe0cc');
    }
    c.restore();

    // あたま
    const hx = 2, hy = -41;
    circle(c, hx, hy, 11.5, '#ffe3d0');
    // 髪 (ボブ)
    c.fillStyle = '#4b3a8f';
    c.beginPath();
    c.arc(hx, hy - 1, 12.4, Math.PI * 0.92, Math.PI * 2.02);
    c.lineTo(hx + 12, hy + 3); c.lineTo(hx + 8, hy - 3); c.quadraticCurveTo(hx + 1, hy - 8, hx - 8, hy - 2); c.lineTo(hx - 12, hy + 7);
    c.closePath(); c.fill();
    c.fillStyle = '#4b3a8f'; rr(c, hx - 13, hy - 2, 7, 15, 3); c.fill();
    // ベレー帽
    c.fillStyle = '#2d2a55';
    c.beginPath(); c.ellipse(hx + 1, hy - 10, 12.5, 6, -0.12, 0, TAU); c.fill();
    circle(c, hx + 1, hy - 16, 2, '#2d2a55');
    circle(c, hx + 8, hy - 10, 2.4, '#ffd166');
    // 目
    const blink = Math.floor(o.t * 1.3) % 7 === 0 && (o.t * 1.3 % 1) < 0.12;
    if (o.stun > 0) {
      line(c, hx + 4, hy - 1, hx + 9, hy + 2, 1.8, '#2d2a55'); line(c, hx + 9, hy - 1, hx + 4, hy + 2, 1.8, '#2d2a55');
    } else if (blink) {
      line(c, hx + 3, hy + 1, hx + 9, hy + 1, 1.8, '#2d2a55');
    } else {
      c.fillStyle = '#2d2a55'; c.beginPath(); c.ellipse(hx + 6.5, hy + 1, 3.3, 4.2, 0, 0, TAU); c.fill();
      circle(c, hx + 7.6, hy - 0.8, 1.3, '#fff'); circle(c, hx + 5.4, hy + 2.6, 0.8, '#fff');
    }
    circle(c, hx + 3.4, hy + 6.2, 2.4, 'rgba(255,120,160,.55)');
    c.strokeStyle = '#d4607f'; c.lineWidth = 1.4; c.beginPath(); c.arc(hx + 8.4, hy + 6.2, 1.8, 0.2, Math.PI - 0.2); c.stroke();
    // 前髪
    c.fillStyle = '#4b3a8f';
    c.beginPath(); c.moveTo(hx - 8, hy - 7); c.quadraticCurveTo(hx + 2, hy - 3, hx + 11, hy - 6); c.lineTo(hx + 11, hy - 9); c.lineTo(hx - 8, hy - 9); c.closePath(); c.fill();
    c.restore();
  }

  // ------------------------------------------------------------ 主人公 (キツネのスパイ。絵は画像、読み込めるまではベクターで代用)
  // k: 画像 1px あたりの世界の長さ / ax: 足もとの中心が、画像の左から何割の所か
  const SPR = {
    run:    { src: './spy-run.webp',    ax: 0.56, k: 0.56 },
    jump:   { src: './spy-jump.webp',   ax: 0.56, k: 0.56 },
    gadget: { src: './spy-gadget.webp', ax: 0.55, k: 0.56 }
  };
  Object.keys(SPR).forEach((key) => {
    const s = SPR[key];
    s.img = new Image();
    s.ok = false;
    s.img.onload = () => { s.ok = true; };
    s.img.src = s.src;
  });
  function spritesReady() { return Object.keys(SPR).every((k) => SPR[k].ok); }

  function drawSpy(c, o) {
    if (!spritesReady()) { drawSpyVector(c, o); return; }
    const pose = o.firing && !o.carry ? 'gadget' : (o.air ? 'jump' : 'run');
    const s = SPR[pose];
    const w = s.img.width * s.k, h = s.img.height * s.k;
    c.save();
    c.translate(o.x, o.y);
    if (!o.air) { c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(0, 0, 15, 3, 0, 0, TAU); c.fill(); }
    if (o.inv > 0 && Math.floor(o.t * 20) % 2 === 0) c.globalAlpha = 0.45;
    let rot = 0;
    if (o.stun > 0) rot = -0.32 + Math.sin(o.t * 30) * 0.03;
    else if (pose === 'jump') rot = Math.max(-0.2, Math.min(0.3, (o.vy || 0) / 1800));
    else if (pose === 'run') rot = Math.sin(o.phase) * 0.035;
    else rot = -(o.aim || 0) * 0.3;
    const bob = pose === 'run' && !o.air && !(o.stun > 0) ? Math.abs(Math.sin(o.phase)) * 2.4 : 0;
    const sq = pose === 'run' ? 1 + Math.sin(o.phase * 2) * 0.025 : 1;
    c.translate(0, -bob);
    c.rotate(rot);
    c.scale(pose === 'gadget' ? -1 : 1, sq);
    const recoil = pose === 'gadget' ? (o.shoot || 0) * 2 : 0;   // うつ瞬間に少しのけぞる
    c.drawImage(s.img, -s.ax * w + recoil, -h, w, h);
    c.restore();
    if (o.stun > 0) {
      for (let i = 0; i < 3; i++) {
        const an = o.t * 8 + i * 2.1;
        drawStar(c, o.x + Math.cos(an) * 14, o.y - h - 2 + Math.sin(an) * 3, 4, '#ffe66d');
      }
    }
  }

  // ------------------------------------------------------------ 敵
  // ------------------------------------------------------------ 敵 (動物スパイ。絵は画像、読み込めるまではベクターで代用)
  // 画像は [ファイル, 足もとの横の中心 (左から何割か)]。k: 画像 1px あたりの世界の長さ (4 人とも同じ縮尺)
  // suit=くろねこ / dog=ジャックラッセル / big=ヒグマ / drone=コウモリ (中身のキーは前のまま)
  const ESPR = {
    suit:  { run: ['./en-cat-run.webp', 0.52],  jump: ['./en-cat-jump.webp', 0.51],  hit: ['./en-cat-hit.webp', 0.55] },
    dog:   { run: ['./en-dog-run.webp', 0.54],  jump: ['./en-dog-jump.webp', 0.49],  hit: ['./en-dog-hit.webp', 0.54] },
    big:   { run: ['./en-bear-run.webp', 0.49], jump: ['./en-bear-jump.webp', 0.49], hit: ['./en-bear-hit.webp', 0.55] },
    drone: { fly1: ['./en-bat-fly1.webp', 0.52], fly2: ['./en-bat-fly2.webp', 0.49], hit: ['./en-bat-hit.webp', 0.52] }
  };
  const EK = 0.476;
  const VIS_H = { suit: 56, dog: 38, big: 72, drone: 44 };      // 絵の見かけの高さ (飾りの位置に使う)
  Object.keys(ESPR).forEach((type) => {
    const set = ESPR[type];
    Object.keys(set).forEach((pose) => {
      const s = { src: set[pose][0], ax: set[pose][1], ok: false, img: new Image() };
      s.img.onload = () => { s.ok = true; };
      s.img.src = s.src;
      set[pose] = s;
    });
  });
  function enemySpritesReady(type) {
    const set = ESPR[type];
    return !!set && Object.keys(set).every((k) => set[k].ok);
  }
  function enemyVisH(e) { return enemySpritesReady(e.type) ? VIS_H[e.type] : C.ENEMIES[e.type].h; }

  function drawEnemySprite(c, e, t) {
    const set = ESPR[e.type];
    let pose;
    if (e.state === 'fly' || e.stun > 0) pose = 'hit';
    else if (e.type === 'drone') pose = Math.floor(t * 9 + e.id) % 2 ? 'fly2' : 'fly1';
    else pose = e.onGround ? 'run' : 'jump';
    const s = set[pose];
    const w = s.img.width * EK, h = s.img.height * EK;
    const drone = e.type === 'drone';
    c.save();
    c.translate(e.x, e.y);
    if (e.state === 'fly') {
      c.translate(0, -h / 2); c.rotate(e.rot || 0); c.translate(0, h / 2);
      c.globalAlpha = Math.max(0, Math.min(1, e.flyT / 0.5));
    }
    if (e.inside >= 0 && !e.seen) c.globalAlpha *= 0.4;
    if (e.onGround && !drone && e.state === 'chase') {
      c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.ellipse(0, 0, w * 0.32, 3, 0, 0, TAU); c.fill();
    }
    const running = pose === 'run';
    const bob = running ? Math.abs(Math.sin(e.anim)) * 2.4 : 0;
    const lean = running ? Math.sin(e.anim) * 0.035 : (pose === 'jump' ? Math.max(-0.2, Math.min(0.3, (e.vy || 0) / 1800)) : (drone ? Math.sin(t * 7 + e.id) * 0.05 : 0));
    const face = pose === 'hit' ? 1 : (e.vx < -1 ? -1 : 1);
    c.translate(0, -bob + (drone ? h / 2 - 10 : 0));      // コウモリは、当たり判定の中心に絵の中心を合わせる
    c.rotate(lean);
    c.scale(face, 1);
    c.drawImage(s.img, -s.ax * w, -h, w, h);
    if (e.flash > 0) {                               // 当たった瞬間は白く光る
      c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.6;
      c.drawImage(s.img, -s.ax * w, -h, w, h);
    }
    c.restore();
  }

  function drawEnemy(c, e, t) {
    const T = C.ENEMIES[e.type];
    const useSpr = enemySpritesReady(e.type);
    const VH = useSpr ? VIS_H[e.type] : T.h;
    if (useSpr) drawEnemySprite(c, e, t);
    else {
    c.save();
    c.translate(e.x, e.y);
    if (e.state === 'fly') {
      c.translate(0, -T.h / 2); c.rotate(e.rot || 0); c.translate(0, T.h / 2);
      c.globalAlpha = Math.max(0, Math.min(1, e.flyT / 0.5));
    }
    if (e.inside >= 0 && !e.seen) c.globalAlpha *= 0.4;
    const ph = e.anim;
    const air = !e.onGround && e.type !== 'drone';
    const flash = e.flash > 0;
    const body = (col) => (flash ? '#fff' : col);
    if (e.type === 'suit' || e.type === 'big') {
      const big = e.type === 'big';
      const s = big ? 1.22 : 1;
      c.scale(s, s);
      const bob = air ? 0 : Math.abs(Math.sin(ph)) * 2;
      c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(0, 0, 12, 2.6, 0, 0, TAU); c.fill();
      c.translate(0, -bob);
      const a1 = air ? 0.7 : Math.sin(ph) * 0.9;
      for (const sgn of [1, -1]) {
        c.save(); c.translate(0, -15); c.rotate(a1 * sgn);
        c.strokeStyle = body('#1d1d2b'); c.lineWidth = 6; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 12); c.stroke();
        circle(c, 2, 14, 3.6, body('#111'));
        c.restore();
      }
      c.fillStyle = body(big ? '#23233a' : '#2a2a40');
      rr(c, -10, -37, 20, 24, 5); c.fill();
      c.fillStyle = body('#fff'); c.beginPath(); c.moveTo(-3, -37); c.lineTo(3, -37); c.lineTo(0, -26); c.closePath(); c.fill();
      c.fillStyle = body('#e63946'); c.beginPath(); c.moveTo(0, -35); c.lineTo(2.4, -30); c.lineTo(0, -24); c.lineTo(-2.4, -30); c.closePath(); c.fill();
      // うで (つかもうとする)
      c.save(); c.translate(6, -33); c.rotate(-1.15 + Math.sin(ph) * 0.15);
      c.strokeStyle = body('#2a2a40'); c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 11); c.stroke();
      circle(c, 0, 12, 3.4, body('#f2c9a4')); c.restore();
      circle(c, 1, -43, 9, body('#f2c9a4'));
      if (!big) { c.fillStyle = body('#1d1d2b'); c.beginPath(); c.arc(1, -45, 9.4, Math.PI, TAU); c.fill(); }
      c.fillStyle = body('#111'); rr(c, 1, -46, 11, 5, 2); c.fill();
      line(c, 0, -48.5, 11, -47, 1.6, '#e63946');
      c.strokeStyle = '#a33'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(4, -37.4); c.lineTo(10, -38.6); c.stroke();
    } else if (e.type === 'dog') {
      const gal = Math.sin(ph * 1.3);
      c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(0, 0, 15, 2.4, 0, 0, TAU); c.fill();
      c.translate(0, -Math.abs(gal) * 2);
      c.strokeStyle = body('#2b2b3a'); c.lineWidth = 4.5; c.lineCap = 'round';
      for (const k of [[-9, 1], [-5, -1], [6, 1], [10, -1]]) {
        c.save(); c.translate(k[0], -8); c.rotate(gal * 0.9 * k[1]); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 8); c.stroke(); c.restore();
      }
      c.fillStyle = body('#2b2b3a'); c.beginPath(); c.ellipse(0, -12, 14, 7.5, 0, 0, TAU); c.fill();
      c.strokeStyle = body('#2b2b3a'); c.lineWidth = 3.5; c.beginPath(); c.moveTo(-13, -14); c.quadraticCurveTo(-21, -22 + gal * 3, -19, -27); c.stroke();
      circle(c, 14, -17, 7.2, body('#2b2b3a'));
      c.fillStyle = body('#1a1a26'); c.beginPath(); c.ellipse(11, -22, 3, 6, -0.4 + gal * 0.2, 0, TAU); c.fill();
      circle(c, 21, -16, 2.4, '#111');
      circle(c, 16, -18.5, 1.8, '#fff'); circle(c, 16.5, -18.5, 0.9, '#111');
      c.fillStyle = '#ff6b9d'; c.beginPath(); c.ellipse(19, -11, 2.4, 3.4, 0, 0, Math.PI); c.fill();
      c.fillStyle = '#e63946'; c.fillRect(7, -14, 4, 7);
    } else if (e.type === 'drone') {
      const hov = Math.sin(t * 9 + e.id) * 1.5;
      c.translate(0, -10 + hov);
      c.fillStyle = body('#8d99ae'); rr(c, -14, -7, 28, 14, 7); c.fill();
      c.fillStyle = body('#5a6577'); rr(c, -14, 1, 28, 6, 3); c.fill();
      circle(c, 5, -1, 4.8, '#1d1d2b'); circle(c, 5, -1, 2.6, (Math.floor(t * 6) % 2) ? '#ff3b3b' : '#ff8a8a');
      line(c, -12, -9, -12, -12, 2, '#5a6577'); line(c, 12, -9, 12, -12, 2, '#5a6577');
      const sp = Math.sin(t * 60);
      c.fillStyle = 'rgba(200,210,230,.7)';
      c.beginPath(); c.ellipse(-12, -13, 10 * Math.abs(sp) + 2, 1.8, 0, 0, TAU); c.ellipse(12, -13, 10 * Math.abs(-sp) + 2, 1.8, 0, 0, TAU); c.fill();
    }
    c.restore();
    }
    // 状態の飾り
    c.save();
    c.translate(e.x, e.y);
    if (e.state === 'chase') {
      if (e.freeze > 0) {
        c.fillStyle = 'rgba(170,230,255,.55)'; rr(c, -T.w / 2 - 4, -VH - 4, T.w + 8, VH + 6, 6); c.fill();
        c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.5; rr(c, -T.w / 2 - 4, -VH - 4, T.w + 8, VH + 6, 6); c.stroke();
      }
      if (e.wet > 0.2) {
        c.fillStyle = 'rgba(90,190,255,.8)';
        for (let i = 0; i < 3; i++) {
          const dx = (i - 1) * 7, dy = -VH * 0.7 + ((t * 40 + i * 9) % 22);
          c.beginPath(); c.arc(dx, dy, 2, 0, TAU); c.fill();
        }
      }
      if (e.stun > 0) {
        for (let i = 0; i < 3; i++) {
          const a = t * 7 + i * 2.1;
          drawStar(c, Math.cos(a) * 11, -VH - 9 + Math.sin(a) * 3, 3.6, e.freeze > 0 ? '#bfe9ff' : '#ffe66d');
        }
      }
      if (e.hp < e.maxhp && e.maxhp > 2) {
        c.fillStyle = 'rgba(0,0,0,.45)'; rr(c, -14, -VH - 12, 28, 5, 2.5); c.fill();
        c.fillStyle = '#ff6b6b'; rr(c, -14, -VH - 12, 28 * Math.max(0, e.hp / e.maxhp), 5, 2.5); c.fill();
      }
    }
    c.restore();
  }

  function drawStar(c, x, y, r, col) {
    c.fillStyle = col; c.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.45 : r;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    c.closePath(); c.fill();
  }

  // ------------------------------------------------------------ 水の玉
  function drawShot(c, s, t) {
    const gun = C.GUN_BY_ID[s.gun];
    const vx = s.vx - s.ref, vy = s.vy;
    const sp = Math.hypot(vx, vy) || 1;
    const nx = vx / sp, ny = vy / sp;
    c.save();
    switch (s.gun) {
      case 'cutter':
        line(c, s.x, s.y, s.x - nx * 40, s.y - ny * 40, 3, 'rgba(224,251,252,.95)');
        line(c, s.x, s.y, s.x - nx * 40, s.y - ny * 40, 1, '#fff');
        break;
      case 'sniper':
        line(c, s.x, s.y, s.x - nx * 34, s.y - ny * 34, 5, 'rgba(199,125,255,.7)');
        circle(c, s.x, s.y, 4.5, '#f1ddff');
        break;
      case 'hose':
        circle(c, s.x, s.y, 7 + Math.min(4, s.age * 14), 'rgba(80,150,255,.45)');
        circle(c, s.x, s.y, 4, 'rgba(180,220,255,.7)');
        break;
      case 'bubble': {
        const r = 14 + Math.sin(t * 9 + s.rot) * 1.5;
        c.fillStyle = 'rgba(189,224,254,.28)'; c.beginPath(); c.arc(s.x, s.y, r, 0, TAU); c.fill();
        c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 1.8; c.stroke();
        circle(c, s.x - 5, s.y - 5, 3, 'rgba(255,255,255,.85)');
        break;
      }
      case 'bazooka':
        c.translate(s.x, s.y); c.rotate(s.age * 5);
        circle(c, 0, 0, 9, '#ff6b9d'); circle(c, -3, -3, 3, 'rgba(255,255,255,.7)');
        c.fillStyle = '#ff6b9d'; c.beginPath(); c.moveTo(-2, 8); c.lineTo(2, 8); c.lineTo(0, 12); c.closePath(); c.fill();
        break;
      case 'rainbow': {
        const cols = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff'];
        for (let i = 0; i < 5; i++) circle(c, s.x - nx * i * 5, s.y - ny * i * 5, 5 - i * 0.7, cols[i]);
        break;
      }
      case 'shock':
        line(c, s.x, s.y, s.x - nx * 18, s.y - ny * 18, 4, 'rgba(255,230,109,.6)');
        circle(c, s.x, s.y, 5, '#fff7b0');
        c.strokeStyle = '#ffe66d'; c.lineWidth = 1.6; c.beginPath();
        c.moveTo(s.x - nx * 18, s.y - ny * 18 - 4); c.lineTo(s.x - nx * 12, s.y - ny * 12 + 4); c.lineTo(s.x - nx * 6, s.y - ny * 6 - 4); c.lineTo(s.x, s.y); c.stroke();
        break;
      case 'ice':
        line(c, s.x, s.y, s.x - nx * 18, s.y - ny * 18, 5, 'rgba(168,218,220,.55)');
        drawStar(c, s.x, s.y, 6, '#e7fbff');
        break;
      case 'homing':
        line(c, s.x, s.y, s.x - nx * 22, s.y - ny * 22, 4, 'rgba(128,255,219,.45)');
        circle(c, s.x, s.y, 5.5, '#b9ffe9'); circle(c, s.x, s.y, 2.5, '#fff');
        break;
      default:
        line(c, s.x, s.y, s.x - nx * 16, s.y - ny * 16, gun.r * 1.2, 'rgba(127,216,255,.45)');
        circle(c, s.x, s.y, gun.r + 0.6, '#9be4ff');
        circle(c, s.x - 1, s.y - 1, gun.r * 0.4, '#fff');
        break;
    }
    c.restore();
  }

  // ------------------------------------------------------------ こまかい効果 (パーティクル)
  const fx = [];
  const MAX_FX = 420;
  function addFx(o) { if (fx.length < MAX_FX) { o.lifeMax = o.life; fx.push(o); } }

  function drops(x, y, n, col, spd, up) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = (0.3 + Math.random()) * (spd || 160);
      addFx({ k: 'drop', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (up || 60), life: 0.5 + Math.random() * 0.4, max: 0.9, r: 1.6 + Math.random() * 2.2, col: col || '#9be4ff' });
    }
  }

  function handleEvent(ev) {
    switch (ev.t) {
      case 'shoot': {
        const gun = C.GUN_BY_ID[ev.gun];
        const R = gun.flash || 9;
        addFx({ k: 'glow', x: ev.x, y: ev.y, r: R, life: 0.12, col: gun.color });                    // 銃口の光 (銃の色・大きさは銃ごと)
        switch (ev.gun) {
          case 'shot':    for (let i = 0; i < 12; i++) { const an = (Math.random() - 0.5) * 1.1; addFx({ k: 'drop', x: ev.x, y: ev.y, vx: -Math.cos(an) * (260 + Math.random() * 200), vy: Math.sin(an) * 300, life: 0.35, max: 0.35, r: 2 + Math.random() * 2, col: gun.color }); } break;
          case 'sniper':  addFx({ k: 'ring', x: ev.x, y: ev.y, r: 4, max: 38, life: 0.2, col: 'rgba(241,221,255,.95)' }); break;
          case 'bazooka': for (let i = 0; i < 6; i++) addFx({ k: 'puff', x: ev.x, y: ev.y, vx: -Math.random() * 120, vy: -Math.random() * 60, r: 5 + Math.random() * 5, life: 0.5, max: 0.5 }); break;
          case 'hose':    for (let i = 0; i < 4; i++) addFx({ k: 'drop', x: ev.x, y: ev.y, vx: -120 - Math.random() * 160, vy: (Math.random() - 0.5) * 120, life: 0.4, max: 0.4, r: 2 + Math.random() * 2, col: '#7fb2ff' }); break;
          case 'ice':     for (let i = 0; i < 5; i++) addFx({ k: 'spark', x: ev.x, y: ev.y, vx: -Math.random() * 150, vy: (Math.random() - 0.5) * 150, life: 0.35, max: 0.35, col: '#e7fbff' }); break;
          case 'bubble':  addFx({ k: 'ring', x: ev.x - 6, y: ev.y, r: 3, max: 16, life: 0.25, col: 'rgba(189,224,254,.95)' }); break;
          case 'rainbow': ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff'].forEach((col, i) => addFx({ k: 'spark', x: ev.x, y: ev.y, vx: -80 - i * 28, vy: (i - 2) * 40, life: 0.4, max: 0.4, col: col })); break;
          case 'shock':   addFx({ k: 'arcline', x: ev.x, y: ev.y, x2: ev.x - 34, y2: ev.y + (Math.random() - 0.5) * 20, life: 0.12, col: '#fff7b0' }); break;
          case 'gatling': addFx({ k: 'spark', x: ev.x, y: ev.y - 2, vx: 30 + Math.random() * 40, vy: -60 - Math.random() * 50, life: 0.3, max: 0.3, col: '#ffe9a8' }); break;   // 薬きょうのかわり: 水のつぶ
          default: drops(ev.x - 10, ev.y, 2, gun.color, 90, 10);
        }
        break;
      }
      case 'beam': {
        const gun = C.GUN_BY_ID[ev.gun];
        addFx({ k: 'beam', x: ev.x, y: ev.y, x2: ev.x2, y2: ev.y2, life: 0.1, col: gun.color });
        break;
      }
      case 'arc':
        addFx({ k: 'arcline', x: ev.x, y: ev.y, x2: ev.x2, y2: ev.y2, life: 0.2, col: '#fff7b0' });
        drops(ev.x2, ev.y2, 4, '#ffe66d', 160, 80);
        break;
      case 'hit':
        drops(ev.x, ev.y, 7, '#9be4ff', 190, 90);
        addFx({ k: 'ring', x: ev.x, y: ev.y, r: 4, max: 20, life: 0.25, col: 'rgba(255,255,255,.9)' });
        break;
      case 'splash':
        drops(ev.x, ev.y, 18, '#9be4ff', 260, 120);
        addFx({ k: 'ring', x: ev.x, y: ev.y, r: 6, max: ev.r, life: 0.35, col: 'rgba(130,210,255,.9)' });
        break;
      case 'explode':
        drops(ev.x, ev.y, 38, '#8fd8ff', 380, 200);
        drops(ev.x, ev.y, 16, '#ffffff', 300, 160);
        addFx({ k: 'ring', x: ev.x, y: ev.y, r: 8, max: ev.r * 1.1, life: 0.45, col: 'rgba(120,205,255,.95)' });
        addFx({ k: 'ring', x: ev.x, y: ev.y, r: 4, max: ev.r * 0.7, life: 0.35, col: 'rgba(255,255,255,.9)' });
        break;
      case 'defeat':
        addFx({ k: 'text', x: ev.x, y: ev.y - 26, vy: -50, txt: ev.fell ? 'おっこちた!' : 'ざばーん!', col: '#fff', life: 0.9, size: 15 });
        drops(ev.x, ev.y, 16, '#9be4ff', 280, 180);
        break;
      case 'coin':
        if (ev.pop || ev.n > 1) addFx({ k: 'text', x: ev.x, y: ev.y - 10, vy: -60, txt: '+' + ev.n, col: '#ffe27a', life: 0.7, size: 14 });
        for (let i = 0; i < 4; i++) addFx({ k: 'spark', x: ev.x, y: ev.y, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.7) * 120, life: 0.35, max: 0.35, col: '#fff2a8' });
        break;
      case 'item':
      case 'gift':
        for (let i = 0; i < 8; i++) addFx({ k: 'spark', x: ev.x, y: ev.y, vx: (Math.random() - 0.5) * 220, vy: (Math.random() - 0.7) * 220, life: 0.5, max: 0.5, col: ev.t === 'gift' ? '#ffb3d6' : '#b9ecff' });
        break;
      case 'jump':
      case 'land':
        for (let i = 0; i < (ev.t === 'land' ? 5 : 3); i++) addFx({ k: 'puff', x: ev.x + (Math.random() - 0.5) * 12, y: ev.y - 2, vx: (Math.random() - 0.6) * 60, vy: -Math.random() * 20, r: 3 + Math.random() * 3, life: 0.35, max: 0.35 });
        break;
      case 'trip':
        addFx({ k: 'text', x: ev.x, y: ev.y - 52, vy: -40, txt: 'あいた!', col: '#ffd1e0', life: 0.7, size: 14 });
        for (let i = 0; i < 3; i++) drawStarFx(ev.x, ev.y - 46);
        break;
      case 'poof':
        for (let i = 0; i < 6; i++) addFx({ k: 'puff', x: ev.x + (Math.random() - 0.5) * 14, y: ev.y - 8, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 60, r: 4 + Math.random() * 4, life: 0.4, max: 0.4 });
        break;
      case 'thud':
        drops(ev.x, ev.y, 3, '#c9b79a', 80, 40);
        break;
      case 'enter':
      case 'exit':
        addFx({ k: 'ring', x: ev.x, y: ev.y - 24, r: 6, max: 50, life: 0.35, col: 'rgba(255,255,255,.8)' });
        break;
      case 'spawn':
        break;
      case 'grab':
        addFx({ k: 'text', x: ev.x, y: ev.y - 30, vy: -40, txt: 'よいしょ', col: '#fff', life: 0.6, size: 13 });
        break;
      default: break;
    }
  }

  function drawStarFx(x, y) {
    addFx({ k: 'spark', x: x, y: y, vx: (Math.random() - 0.5) * 100, vy: -Math.random() * 90, life: 0.5, max: 0.5, col: '#ffe66d' });
  }

  function updateFx(dt) {
    let w = 0;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      f.life -= dt;
      if (f.life <= 0) continue;
      if (f.k === 'drop') { f.vy += 900 * dt; f.x += f.vx * dt; f.y += f.vy * dt; }
      else if (f.k === 'spark' || f.k === 'puff') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += (f.k === 'puff' ? -20 : 240) * dt; }
      else if (f.k === 'text') { f.y += f.vy * dt; }
      fx[w++] = f;
    }
    fx.length = w;
  }

  function drawFx(c) {
    for (const f of fx) {
      const u = Math.max(0, f.life / (f.max || f.life + 0.001));
      if (f.k === 'drop') {
        c.globalAlpha = Math.min(1, u * 1.6);
        circle(c, f.x, f.y, f.r, f.col);
      } else if (f.k === 'ring') {
        const p = Math.min(1, Math.max(0, 1 - f.life / f.lifeMax));
        c.globalAlpha = Math.max(0, Math.min(1, f.life / f.lifeMax * 1.6));
        c.strokeStyle = f.col; c.lineWidth = 3;
        c.beginPath(); c.arc(f.x, f.y, Math.max(0, f.r + (f.max - f.r) * Math.min(1, p * 1.4)), 0, TAU); c.stroke();
      } else if (f.k === 'glow') {
        const u2 = Math.max(0, f.life / f.lifeMax), R = f.r * (1.4 - 0.4 * u2);
        const gr = c.createRadialGradient(f.x, f.y, 1, f.x, f.y, R);
        gr.addColorStop(0, 'rgba(255,255,255,' + (0.95 * u2).toFixed(2) + ')');
        gr.addColorStop(0.45, f.col); gr.addColorStop(1, 'rgba(255,255,255,0)');
        c.globalAlpha = u2; c.fillStyle = gr; c.fillRect(f.x - R, f.y - R, R * 2, R * 2);
      } else if (f.k === 'beam') {
        const u2 = Math.max(0, f.life / f.lifeMax);
        c.globalAlpha = u2; c.lineCap = 'round';
        c.strokeStyle = f.col; c.lineWidth = 7; c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(f.x2, f.y2); c.stroke();
        c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(f.x2, f.y2); c.stroke();
      } else if (f.k === 'arcline') {
        if (!f.pts) {                                    // ぎざぎざの稲妻の形 (1 回だけ決める)
          f.pts = []; const n = 6;
          for (let i = 0; i <= n; i++) { const u3 = i / n; f.pts.push([f.x + (f.x2 - f.x) * u3 + (i && i < n ? (Math.random() - 0.5) * 14 : 0), f.y + (f.y2 - f.y) * u3 + (i && i < n ? (Math.random() - 0.5) * 14 : 0)]); }
        }
        const u2 = Math.max(0, f.life / f.lifeMax);
        c.globalAlpha = u2; c.lineJoin = 'round'; c.lineCap = 'round';
        c.strokeStyle = 'rgba(255,230,109,.9)'; c.lineWidth = 5; c.beginPath(); f.pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke();
        c.strokeStyle = '#fff'; c.lineWidth = 1.8; c.beginPath(); f.pts.forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke();
      } else if (f.k === 'spark') {
        c.globalAlpha = u;
        drawStar(c, f.x, f.y, 3.2, f.col);
      } else if (f.k === 'puff') {
        c.globalAlpha = u * 0.5;
        circle(c, f.x, f.y, f.r * (1.6 - u * 0.6), '#fff');
      } else if (f.k === 'text') {
        c.globalAlpha = Math.min(1, f.life * 2.5);
        c.font = '800 ' + f.size + 'px "Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans JP",sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 4; c.strokeStyle = 'rgba(60,40,120,.85)'; c.lineJoin = 'round';
        c.strokeText(f.txt, f.x, f.y);
        c.fillStyle = f.col; c.fillText(f.txt, f.x, f.y);
      }
    }
    c.globalAlpha = 1;
  }

  // ------------------------------------------------------------ 全体を描く
  function drawPuddle(c, pd, base, t) {
    const u = Math.min(1, pd.t / 0.6);
    c.globalAlpha = 0.75 * u;
    c.fillStyle = '#6cc7ff';
    c.beginPath(); c.ellipse(pd.x, base - 1, pd.w / 2, 5, 0, 0, TAU); c.fill();
    c.fillStyle = '#b9e6ff';
    c.beginPath(); c.ellipse(pd.x - pd.w * 0.1, base - 2, pd.w * 0.22, 2, 0, 0, TAU); c.fill();
    c.globalAlpha = 1;
    void t;
  }

  /**
   * g: core の状態 / view: {w,h,camX,camY,t,aim} 世界の単位。
   * c は呼び出し側で「世界 → 画面」の拡大を済ませてある。
   */
  function render(c, g, view) {
    const w = g.world;
    const p = g.p;
    const t = view.t;
    drawBackdrop(c, view);
    c.save();
    c.translate(-view.camX, -view.camY);

    const x0 = view.camX - 40, x1 = view.camX + view.w + 40;
    const i0 = C.indexNear(w, x0);
    const vis = [];
    for (let i = Math.max(0, i0 - 1); i < w.b.length && w.b[i].x < x1; i++) {
      if (w.b[i].x + w.b[i].w >= x0) vis.push(w.b[i]);
    }
    for (const b of vis) drawBuilding(c, g, b, view, t);

    // もの・じゃま物・アイテム
    for (const b of vis) {
      for (const ob of b.roof.obs) drawObstacle(c, ob, b.roofY);
      for (const pr of b.roof.props) drawProp(c, pr.t, pr.x, b.roofY, 0);
      for (const it of b.roof.items) drawItem(c, it, t);
      if (g.p.inside === b.i) {
        for (const ob of b.room.obs) drawObstacle(c, ob, b.floorY);
        for (const pr of b.room.props) drawProp(c, pr.t, pr.x, b.floorY, 0);
        for (const it of b.room.items) drawItem(c, it, t);
      }
      // ドアの合図 (近づくとゆれる)
      if (b.door && p.inside < 0 && Math.abs(p.x - b.doorX) < 90) {
        c.fillStyle = '#fff'; c.font = '800 12px "Hiragino Sans","Noto Sans JP",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 4; c.strokeStyle = 'rgba(70,40,140,.9)';
        const yy = b.roofY - 70 + Math.sin(t * 6) * 2;
        c.strokeText('入れる!', b.doorX, yy); c.fillText('入れる!', b.doorX, yy);
      }
    }

    // みずたまり
    for (const pd of g.puddles) {
      const base = pd.inside >= 0 ? w.b[pd.inside].floorY : (C.buildingAt(w, pd.x) ? C.buildingAt(w, pd.x).roofY : p.y);
      drawPuddle(c, pd, base, t);
    }

    // 敵 (ビルの中の敵は、主人公も中にいるときだけはっきり見える)
    for (const e of g.enemies) {
      e.seen = e.inside === p.inside;
      drawEnemy(c, e, t);
    }

    // 主人公
    const gun = C.curGun(g);
    drawSpy(c, {
      x: p.x, y: p.y, phase: p.anim, air: !p.onGround, inv: p.inv, stun: p.stun, t: t,
      carry: p.carry, aim: view.aim || 0, shoot: view.shoot || 0, firing: (view.fireT || 0) > 0, vy: p.vy, gunId: gun.id, gunColor: gun.color
    });
    if (p.carry) drawProp(c, p.carry, p.x + 3, p.y - 62, Math.sin(t * 10) * 0.06);
    if (gun.windup && p.charge > 0.01) {
      const u = Math.min(1, p.charge / gun.windup), mx = p.x - 28, my = p.y - 34, ang = view.aim || 0;
      c.save(); c.lineCap = 'round';
      c.strokeStyle = 'rgba(255,80,110,' + (0.25 + 0.6 * u).toFixed(2) + ')'; c.lineWidth = 1.6 + u * 1.6; c.setLineDash([7, 5]);
      c.beginPath(); c.moveTo(mx, my); c.lineTo(mx - Math.cos(ang) * 420, my + Math.sin(ang) * 420); c.stroke();
      c.setLineDash([]);
      c.strokeStyle = 'rgba(255,255,255,' + (0.4 + 0.5 * u).toFixed(2) + ')'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(mx, my, 16 - 10 * u, 0, TAU); c.stroke();
      circle(c, mx, my, 2 + 3 * u, '#ff5d7a');
      c.restore();
    }

    // 投げ物・水
    for (const o of g.thrown) {
      if (o.kind === 'bomb') drawBomb(c, o.x, o.y, o.rot, t);
      else drawProp(c, o.t, o.x, o.y + 11, o.rot);
    }
    for (const s of g.shots) drawShot(c, s, t);

    drawFx(c);
    c.restore();
  }

  window.Art = {
    render: render,
    handleEvent: handleEvent,
    updateFx: updateFx,
    clearFx: function () { fx.length = 0; },
    drawSpy: drawSpy,
    drawProp: drawProp,
    drawStar: drawStar,
    fxCount: function () { return fx.length; },
    spritesReady: spritesReady,
    enemySpritesReady: enemySpritesReady,
    themeOf: themeOf,
    skyCss: skyCss,
    THEMES: THEMES,
    hash: hash
  };
})();
