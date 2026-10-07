/*
 * Conifer — Order × Chaos
 * ------------------------------------------------------------------
 * 下から上へ成長する針葉樹の数理モデルと、密度ヒストグラムによる描画。
 *
 *  Order（秩序）  … 黄金角の葉序 / 円錐の包絡線 / 等比で詰まる節間 / 自己相似な分枝比
 *  Chaos（混沌）  … 対称カオス写像（Field & Golubitsky の symmetric icon）の軌道を
 *                   ゆらぎの源として、角度・長さ・節間・枝の曲がり・針葉の散らばりに注入
 *  Beauty        … Order × Complexity × Contrast（Generative Flower の評価関数を木に移植）
 *
 * 依存なし。window.Conifer に公開。
 */
(() => {
  "use strict";

  const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 黄金角 ≈ 137.5°
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const bell = (x, mu, s) => Math.exp(-0.5 * ((x - mu) / s) ** 2);

  // ================================================================
  // Chaos source — symmetric icon
  //   z ← (λ + α|z|² + β Re(zⁿ) + iω) z + γ z̄ⁿ⁻¹
  // 軌道座標 / 境界半径 を [-1, 1] のゆらぎとして取り出す。
  // seed は初期値に入り、軌道の初期値鋭敏性によって全く別の系列になる。
  // ================================================================
  const ICON = { lam: -2.34, alpha: 2.0, beta: 0.2, gamma: 0.1, omega: 0, n: 5 }; // "Starfish"

  function IconChaos(seed, q = ICON) {
    let x = 0.01 + (seed % 9973) * 1.3e-6, y = 0.003 + (seed % 7919) * 0.7e-6, R = 0;
    let nx = 0, ny = 0;
    function step() {
      const zz = x * x + y * y;
      let zr = x, zi = y;
      for (let i = 1; i < q.n - 1; i++) { const t = zr * x - zi * y; zi = zr * y + zi * x; zr = t; }
      const ren = zr * x - zi * y;
      const p = q.lam + q.alpha * zz + q.beta * ren;
      nx = p * x - q.omega * y + q.gamma * zr;
      ny = p * y + q.omega * x - q.gamma * zi;
      x = nx; y = ny;
    }
    for (let i = 0; i < 3000; i++) { step(); if (i > 500) R = Math.max(R, Math.hypot(x, y)); }
    for (let i = 0, m = seed % 1009; i < m; i++) step();
    let flip = false;
    return {
      // 構造用：[-1, 1] のゆらぎ（数ステップ空けて相関を切る）
      next() { step(); step(); step(); flip = !flip; return clamp((flip ? x : y) / R, -1, 1); },
      // テクスチャ用：1 ステップごとの軌道（針葉の散らばり）
      pair() { step(); return [x / R, y / R]; },
      // [0, 1) の一様化（角度を n 倍して端数を取る）
      unit() { step(); const a = Math.atan2(y, x) / (2 * Math.PI) * 7.0 + 7; return a - Math.floor(a); },
    };
  }

  // ================================================================
  // Growth model — 1 本の木を「線分 + 誕生時刻」の集合として生成する
  // ================================================================
  const DEFAULTS = {
    seed: 137,
    chaos: 0.32,      // 0 = 完全な秩序 / 1 = 強い混沌
    tiers: 26,        // 輪生枝の段数
    whorl: 5,         // 1 段あたりの枝数（回転対称の次数 n に相当）
    slender: 0.22,    // 最下段の枝長 / 樹高（小さいほど細身で凛とする）
    bareTrunk: 0.15,  // 枝のない幹の高さ
    growTime: 5.2,    // 成長前線が根元から梢に届くまでの秒数
  };

  function generate(opt = {}) {
    const o = { ...DEFAULTS, ...opt };
    const C = clamp(o.chaos, 0, 1);
    const N = IconChaos(o.seed);
    const r = () => N.next() * C;            // 混沌の振れ幅でスケールしたゆらぎ
    const segs = [];
    const tf = y => o.growTime * Math.pow(y, 1.05); // 高さ y を成長前線が通過する時刻

    const add = (a, b, t0, dur, needle, dens, weight) =>
      segs.push({ a, b, t0, dur: Math.max(dur, 0.02), needle, dens, weight, drawn: 0 });

    // ---- 幹（Order：ほぼ垂直。Chaos：わずかな揺らぎ） ----
    const sway = [r() * 0.012, r() * 0.012];
    const trunkAt = y => [sway[0] * Math.sin(y * 3.1), y, sway[1] * Math.sin(y * 2.3)];
    const TS = 64;
    for (let i = 0; i < TS; i++) {
      const y0 = i / TS, y1 = (i + 1) / TS;
      const w = 0.0035 + 0.011 * (1 - y0) ** 1.6;               // 幹の太さ（根元が太い）
      add(trunkAt(y0), trunkAt(y1), tf(y0), tf(y1) - tf(y0), w, 1.25, 1);
    }

    // ---- 輪生枝の高さ（Order：等比で詰まる節間。Chaos：節間のゆらぎ） ----
    const K = o.tiers, q = 0.955, top = 0.965;
    const ys = [];
    for (let k = 0; k < K; k++) {
      const f = (1 - q ** k) / (1 - q ** K);
      const gap = (top - o.bareTrunk) * (q ** k) * (1 - q) / (1 - q ** K);
      ys.push(clamp(o.bareTrunk + (top - o.bareTrunk) * f + r() * gap * 0.45, 0.02, 0.985));
    }

    const Lmax = o.slender;
    for (let k = 0; k < K; k++) {
      const y = ys[k];
      const h = (y - o.bareTrunk) / (1 - o.bareTrunk);           // 枝域内の相対高さ 0..1
      const env = Math.pow(clamp(1 - h, 0, 1), 0.92) * 0.94 + 0.06; // 円錐の包絡線
      let m = o.whorl + Math.round(r() * 1.6);
      m = clamp(m, 3, 8);
      const base = k * GOLDEN + r() * 0.5;                       // 黄金角で段ごとに回る
      const tStart = tf(y);
      for (let j = 0; j < m; j++) {
        const th = base + (j * 2 * Math.PI) / m + r() * (Math.PI / m) * 0.7;
        const L = Lmax * env * (1 + r() * 0.38) * (0.86 + 0.14 * Math.cos(j * 2.4 + k));
        if (L < 0.012) continue;
        if (N.unit() < C * C * 0.35) continue;                   // 混沌が強いと枝が欠ける
        // 仰角：下段は垂れ、上段は空へ向く（Order） + ゆらぎ（Chaos）
        const a0 = -0.2 + 0.75 * h * h + r() * 0.22;
        const grav = 0.32 * (L / Lmax) + 0.06;                   // 長い枝ほど自重で垂れる
        const lift = 0.22;                                       // 枝先はわずかに反り上がる
        const bend = r() * 0.4;                                  // 水平面内の曲がり
        const dir = [Math.cos(th), 0, Math.sin(th)];
        const side = [-Math.sin(th), 0, Math.cos(th)];
        const root = trunkAt(y);
        const P = s => {
          const v = L * (Math.tan(a0) * s - grav * s * s + lift * s * s * s);
          const lat = L * bend * s * s;
          return [root[0] + dir[0] * L * s + side[0] * lat, root[1] + v, root[2] + dir[2] * L * s + side[2] * lat];
        };
        const grow = 1.5 * Math.sqrt(L / Lmax) + 0.25;           // 枝の伸長時間（下段ほど長く伸び続ける）
        const S = 8;
        for (let i = 0; i < S; i++) {
          const s0 = i / S, s1 = (i + 1) / S;
          add(P(s0), P(s1), tStart + s0 * grow, grow / S, 0.008 + 0.01 * (1 - s0), 0.9, 1);
        }
        // ---- 小枝（自己相似：親枝の比で短くなる） ----
        const nb = Math.max(3, Math.round(16 * L / Lmax));
        for (let i = 1; i <= nb; i++) {
          const s = clamp(0.1 + 0.86 * (i / (nb + 0.5)) + r() * 0.04, 0.05, 0.98);
          const p0 = P(s), p1 = P(Math.min(1, s + 0.01));
          const tan = norm(sub(p1, p0));
          const sg = i % 2 ? 1 : -1;
          const ang = 0.95 + r() * 0.3;                          // 小枝の開き角 ≈ 55°
          const sd = [side[0] * sg, 0, side[2] * sg];
          let d = norm([
            tan[0] * Math.cos(ang) + sd[0] * Math.sin(ang),
            tan[1] * Math.cos(ang) - 0.12,
            tan[2] * Math.cos(ang) + sd[2] * Math.sin(ang),
          ]);
          const l = L * 0.5 * Math.pow(1 - s, 0.7) * (1 + r() * 0.45) + 0.01;
          const t0 = tStart + s * grow;
          const q1 = [p0[0] + d[0] * l * 0.5, p0[1] + d[1] * l * 0.5 - l * 0.04, p0[2] + d[2] * l * 0.5];
          const q2 = [p0[0] + d[0] * l, p0[1] + d[1] * l - l * (0.22 + 0.2 * (1 - h)), p0[2] + d[2] * l];
          const gd = 0.5 * Math.sqrt(l / Lmax) + 0.15;
          const nd = 0.55 + 0.45 * Math.sqrt(L / Lmax);            // 短い枝は針葉も短い
          add(p0, q1, t0, gd * 0.5, 0.016 * nd, 0.9 * nd, 0.9);
          add(q1, q2, t0 + gd * 0.5, gd * 0.5, 0.013 * nd, 0.8 * nd, 0.8);
        }
      }
    }
    // ---- 梢（頂芽：まっすぐ天へ） ----
    const tip = trunkAt(1);
    add(trunkAt(top), [tip[0], 1.03, tip[2]], tf(top), 0.6, 0.006, 1.6, 1);

    const end = segs.reduce((m, s) => Math.max(m, s.t0 + s.dur), 0);
    return { segs, end, opt: o, noise: N };
  }

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  // ================================================================
  // 投影（わずかに見下ろす透視） + 点の散布
  // ================================================================
  function makeProjector(view) {
    const e = view.elev ?? 0.09, ce = Math.cos(e), se = Math.sin(e);
    const rot = view.rot ?? 0, cr = Math.cos(rot), sr = Math.sin(rot);
    const D = 4.5;
    return (x, y, z, out) => {
      const X = x * cr - z * sr, Z = x * sr + z * cr;           // 幹まわりの回転
      const ys = y * ce - Z * se, zs = Z * ce + y * se;          // 見下ろし
      const f = D / (D - zs);
      out[0] = view.cx + X * f * view.scale;
      out[1] = view.cy - ys * f * view.scale;
      out[2] = Z;                                                // 奥行き（手前が正）
    };
  }

  // seg の fraction [f0, f1) を点で埋めてヒストグラムに加算
  const P3 = [0, 0, 0];
  function scatter(field, tree, seg, f0, f1) {
    const { W, H } = field;
    const fog = tree.view.fog ?? 0;
    const hist = fog > 0 ? field.haze : field.hist;   // 遠景は霞の層へ
    const proj = tree.proj, N = tree.noise;
    const a = seg.a, b = seg.b;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let count = len * (f1 - f0) * seg.dens * tree.density;
    let n = Math.floor(count); if (N.unit() < count - n) n++;
    const nl = seg.needle;
    for (let i = 0; i < n; i++) {
      const t = f0 + (f1 - f0) * N.unit();
      const [u, v] = N.pair();
      // 針葉：枝から放射状に散る（距離は |u|、方向は v）
      const rr = nl * Math.abs(u), ang = v * Math.PI;
      const x = a[0] + (b[0] - a[0]) * t + rr * Math.cos(ang);
      const y = a[1] + (b[1] - a[1]) * t + rr * Math.sin(ang) * 0.75 - rr * 0.25;
      const z = a[2] + (b[2] - a[2]) * t + rr * Math.sin(ang * 1.7);
      proj(x, y, z, P3);
      const px = P3[0] | 0, py = P3[1] | 0;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      // 奥の枝ほど淡く（空気遠近）
      const depth = 0.62 + 0.38 * clamp(0.5 + P3[2] * 2.2, 0, 1);
      hist[py * W + px] += seg.weight * tree.weight * depth * (1 - 0.6 * fog);
    }
  }

  // ================================================================
  // Beauty — Order × Complexity × Contrast（粗いラスタで木を評価）
  // ================================================================
  function evaluate(tree) {
    const G = 128, occ = new Uint8Array(G * G);
    const proj = makeProjector({ cx: G / 2, cy: G * 0.97, scale: G * 0.9, elev: 0.09 });
    const p = [0, 0, 0];
    for (const s of tree.segs) {
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);
      const n = Math.max(2, Math.round(len * 900));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        proj(s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t, s.a[2] + (s.b[2] - s.a[2]) * t, p);
        const gx = p[0] | 0, gy = p[1] | 0;
        if (gx >= 0 && gy >= 0 && gx < G && gy < G) occ[gy * G + gx] = 1;
      }
    }
    // Order：左右の鏡映対称（完全対称は退屈なので 0.8 付近を好む）
    let inter = 0, uni = 0, c128 = 0;
    const occ32 = new Uint8Array(32 * 32); let c32 = 0;
    let rowsFill = 0, rowsSpan = 0;
    for (let j = 0; j < G; j++) {
      let lo = G, hi = -1;
      for (let i = 0; i < G; i++) {
        const a = occ[j * G + i], b = occ[j * G + (G - 1 - i)];
        if (a && b) inter++; if (a || b) uni++;
        if (a) {
          c128++; lo = Math.min(lo, i); hi = Math.max(hi, i);
          const k = (j >> 2) * 32 + (i >> 2); if (!occ32[k]) { occ32[k] = 1; c32++; }
        }
      }
      if (hi > lo) { rowsSpan += hi - lo + 1; for (let i = lo; i <= hi; i++) rowsFill += occ[j * G + i]; }
    }
    const mirror = uni ? inter / uni : 0;
    const D = Math.log2(c128 / Math.max(c32, 1)) / 2;            // ボックス次元
    const neg = rowsSpan ? 1 - rowsFill / rowsSpan : 0;           // 輪郭内の余白
    const O = bell(mirror, 0.7, 0.09);
    const Cx = bell(D, 1.7, 0.09);
    const K = bell(neg, 0.2, 0.1);
    return { O, C: Cx, K, B: O * Cx * K, mirror, D, neg };
  }

  // 複数の seed を試し、Beauty 最大の木を選ぶ
  function selectBest(opt, candidates = 6) {
    let best = null;
    for (let i = 0; i < candidates; i++) {
      const seed = (opt.seed ?? 137) + i * 7919;
      const t = generate({ ...opt, seed });
      const s = evaluate(t);
      if (!best || s.B > best.score.B) best = { seed, score: s };
    }
    return best;
  }

  // ================================================================
  // Renderer — 複数の木を 1 枚の密度場に描き、ログ階調でトーンマップする
  // ================================================================
  function hex(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }

  function createScene(canvas) {
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0, hist = null, haze = null, img = null;
    let trees = [], raf = 0, t0 = 0, running = false;
    let palette = { bg: "#f3f1ea", stops: ["#f3f1ea", "#8f9a90", "#2c3a33", "#101814"] };
    let LUT = new Uint8ClampedArray(256 * 3), BG = [0, 0, 0];
    let ref = 1;

    function buildLUT() {
      const st = palette.stops.map(hex);
      for (let i = 0; i < 256; i++) {
        const t = (i / 255) * (st.length - 1), j = Math.min(st.length - 2, Math.floor(t)), f = t - j;
        for (let k = 0; k < 3; k++) LUT[i * 3 + k] = st[j][k] + f * (st[j + 1][k] - st[j][k]);
      }
      BG = hex(palette.bg);
    }
    buildLUT();

    function resize(w, h) {
      W = canvas.width = Math.max(1, w | 0);
      H = canvas.height = Math.max(1, h | 0);
      hist = new Float32Array(W * H);
      haze = new Float32Array(W * H);
      img = ctx.createImageData(W, H);
    }

    function paint() {
      if (!img) return;
      const d = img.data, lm = Math.log1p(ref), g = 0.78;
      for (let i = 0, n = W * H; i < n; i++) {
        let r = BG[0], gg = BG[1], b = BG[2];
        const hz = haze[i];
        if (hz > 0) {                                            // 霞の層：淡く、暗部まで届かない
          const v = Math.min(1, Math.pow(Math.log1p(hz) / lm, g));
          const t = (v * 150) | 0, al = Math.min(1, v * 2.2) * 0.75;
          r += (LUT[t * 3] - r) * al; gg += (LUT[t * 3 + 1] - gg) * al; b += (LUT[t * 3 + 2] - b) * al;
        }
        const hv = hist[i];
        if (hv > 0) {
          const v = Math.min(1, Math.pow(Math.log1p(hv) / lm, g));
          const t = (v * 255) | 0, al = Math.min(1, v * 2.2);
          r += (LUT[t * 3] - r) * al; gg += (LUT[t * 3 + 1] - gg) * al; b += (LUT[t * 3 + 2] - b) * al;
        }
        const k = i << 2;
        d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }

    // trees: [{ opt, view: {cx, cy, scale, rot, elev, fog}, weight, density, delay }]
    function setTrees(list) {
      trees = list.map(spec => {
        const t = generate(spec.opt);
        t.view = spec.view; t.proj = makeProjector(spec.view);
        t.weight = spec.weight ?? 1; t.delay = spec.delay ?? 0;
        // 点の総数：線分長 × 密度 がおよそ budget になるように正規化
        const total = t.segs.reduce((s, g) => s + Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]) * g.dens, 0);
        t.density = (spec.budget ?? 1e6) / total;
        return t;
      });
      // トーンマップの基準：画素あたりの期待密度から決める（成長中に明るさが跳ねないように）
      const budget = list.reduce((s, x) => s + (x.budget ?? 1e6) * (x.weight ?? 1), 0);
      ref = Math.max(4, (budget / (W * H)) * 90);
      hist.fill(0); haze.fill(0);
    }

    function advance(T) {
      let pending = false;
      for (const t of trees) {
        const tt = T - t.delay;
        for (const s of t.segs) {
          if (s.drawn >= 1) continue;
          pending = true;
          if (tt <= s.t0) continue;
          const f = Math.min(1, (tt - s.t0) / s.dur);
          if (f > s.drawn) { scatter({ hist, haze, W, H }, t, s, s.drawn, f); s.drawn = f; }
        }
      }
      return pending;
    }

    function grow(onDone) {
      cancelAnimationFrame(raf); running = true; t0 = performance.now();
      const frame = now => {
        const pending = advance((now - t0) / 1000);
        paint();
        if (pending && running) raf = requestAnimationFrame(frame);
        else { running = false; onDone && onDone(); }
      };
      raf = requestAnimationFrame(frame);
    }

    function instant() { cancelAnimationFrame(raf); running = false; advance(1e9); paint(); }

    function setPalette(p) { palette = p; buildLUT(); paint(); }

    // 任意の点群を描く（作品サムネイルの花など）。fn(hist, W, H) が基準密度を返す
    function draw(fn) { cancelAnimationFrame(raf); trees = []; hist.fill(0); haze.fill(0); ref = fn(hist, W, H); paint(); }

    return { resize, setTrees, grow, instant, setPalette, paint, draw, get size() { return [W, H]; } };
  }

  window.Conifer = { generate, evaluate, selectBest, createScene, IconChaos, DEFAULTS };
})();
