/*!
 * sfx.js — 水でっぽうの音。ファイルは使わず、その場で合成する。
 * 音の作り方 (レシピ) を、本物のスピーカー (app.js) と、数字で測る (OfflineAudioContext) のとで
 * 同じものを使えるよう、「部品 (kit)」を受け取る形にしてある。
 *
 * kit.tone(f0, f1, 長さ, 波形, 音量, 遅れ)        f0 から f1 へ音程が動く音
 * kit.noise(長さ, 音量, 中心の周波数, 鋭さ, 遅れ)   ザーッという音 (帯域をしぼる)
 */
(function () {
  'use strict';

  /** 1 丁ごとの音。p.ramp は 0〜1 (マシンガンの加速ぐあい)。 */
  const GUN = {
    mizu:    (k) => { k.noise(0.07, 0.22, 2400, 0.9); k.tone(900, 500, 0.05, 'sine', 0.05); },
    twin:    (k) => { k.noise(0.05, 0.2, 3000, 0.9); k.noise(0.05, 0.2, 3000, 0.9, 0.045); k.tone(1100, 650, 0.05, 'sine', 0.05); k.tone(1250, 700, 0.05, 'sine', 0.04, 0.045); },
    shot:    (k) => { k.noise(0.2, 0.5, 650, 0.6); k.tone(150, 55, 0.18, 'sine', 0.35); k.noise(0.06, 0.3, 3000, 0.8); },
    gatling: (k, p) => { const f = 1 + (p.ramp || 0) * 0.7; k.noise(0.035, 0.2, 3400 * f, 1); k.tone(1500 * f, 900 * f, 0.025, 'square', 0.05); },
    sniper:  (k) => { k.noise(0.12, 0.45, 4500, 0.7); k.tone(2000, 260, 0.32, 'sawtooth', 0.14); k.tone(90, 45, 0.25, 'sine', 0.35); },
    cutter:  (k) => { k.tone(3800, 3300, 0.07, 'sawtooth', 0.07); k.noise(0.06, 0.18, 6500, 1.2); k.tone(2600, 2600, 0.05, 'square', 0.04); },
    hose:    (k) => { k.noise(0.14, 0.3, 1300, 0.4); k.noise(0.12, 0.15, 3500, 0.5); },
    homing:  (k) => { k.tone(450, 1500, 0.16, 'sine', 0.14); k.noise(0.05, 0.12, 2200, 1); k.tone(1500, 700, 0.1, 'triangle', 0.06, 0.12); },
    bazooka: (k) => { k.tone(240, 80, 0.22, 'sine', 0.4); k.noise(0.16, 0.3, 600, 0.6); k.tone(500, 300, 0.1, 'triangle', 0.08, 0.02); },
    ice:     (k) => { k.tone(2300, 3300, 0.1, 'triangle', 0.1); k.tone(3400, 3400, 0.09, 'sine', 0.07, 0.04); k.noise(0.07, 0.14, 5200, 1.5); },
    bubble:  (k) => { k.tone(500, 1000, 0.1, 'sine', 0.17); k.tone(700, 1400, 0.09, 'sine', 0.12, 0.07); },
    shock:   (k) => { k.tone(95, 95, 0.14, 'sawtooth', 0.14); k.tone(2600, 500, 0.1, 'square', 0.07); k.noise(0.08, 0.2, 4200, 1); },
    rainbow: (k) => { [880, 1108, 1320].forEach((f, i) => k.tone(f, f * 1.02, 0.05, 'triangle', 0.17, i * 0.04)); k.noise(0.04, 0.16, 4000, 1); }
  };

  /** 撃つ音いがいの、銃にまつわる音。 */
  const EXTRA = {
    charge: (k) => { k.tone(280, 1500, 0.4, 'sine', 0.2); },                                       // スナイパーの「ため」
    arc:    (k) => { k.tone(2000, 300, 0.09, 'square', 0.07); k.noise(0.07, 0.2, 4200, 1); }         // ビリビリの連鎖
  };

  /** 連射の銃ほど、同じ音を重ねすぎないよう、次の音までの最短 (ミリ秒) を長めにとる。 */
  const MIN_GAP = { gatling: 55, cutter: 60, hose: 90, twin: 70, mizu: 70, rainbow: 70 };

  /**
   * kit を作る。a: AudioContext か OfflineAudioContext / dest: つなぎ先 / rnd: 乱数 (測るときは固定の乱数)
   */
  function makeKit(a, dest, rnd) {
    const rand = rnd || Math.random;
    return {
      tone: function (f0, f1, dur, type, vol, delay) {
        const t0 = a.currentTime + (delay || 0);
        const o = a.createOscillator(), g = a.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(f0, t0);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(dest);
        o.start(t0); o.stop(t0 + dur + 0.03);
      },
      noise: function (dur, vol, freq, q, delay) {
        const t0 = a.currentTime + (delay || 0);
        const n = Math.max(1, Math.floor(a.sampleRate * dur));
        const buf = a.createBuffer(1, n, a.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (rand() * 2 - 1) * (1 - i / n);
        const s = a.createBufferSource(); s.buffer = buf;
        const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 0.8;
        const g = a.createGain(); g.gain.value = vol;
        s.connect(f); f.connect(g); g.connect(dest);
        s.start(t0);
      }
    };
  }

  function seeded(seed) {
    let s = seed >>> 0;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  /**
   * 音を鳴らさずに描き出して、波の数字 (Float32Array) にする。測る専用。
   * group: 'GUN' か 'EXTRA' / name: 銃の id など / 出口の音量は本番と同じ 0.9 (本番はそのあとに、音割れ止めが入る)。
   */
  function renderOffline(group, name, params, seconds) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const rate = 22050;
    const a = new OAC(1, Math.floor(rate * (seconds || 0.6)), rate);
    const master = a.createGain(); master.gain.value = 0.9; master.connect(a.destination);
    (group === 'EXTRA' ? EXTRA : GUN)[name](makeKit(a, master, seeded(1234)), params || {});
    return a.startRendering().then((buf) => buf.getChannelData(0));
  }

  window.Sfx = { GUN: GUN, EXTRA: EXTRA, MIN_GAP: MIN_GAP, makeKit: makeKit, renderOffline: renderOffline };
})();
