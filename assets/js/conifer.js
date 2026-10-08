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

  // 構造（枝の本数・小枝の数）は中心の混沌度 o.chaos で固定し、連続量（角度・長さ・曲がり）だけを
  // 任意の混沌度 C で組み直せるようにする。同じゆらぎ列を再生するので、線分は C によらず 1 対 1 に対応する。
  function generate(opt = {}) {
    const o = { ...DEFAULTS, ...opt };
    const Cs = clamp(o.chaos, 0, 1);
    const N = IconChaos(o.seed);
    const tape = [];
    const tf = y => o.growTime * Math.pow(y, 1.05); // 高さ y を成長前線が通過する時刻

    function build(C, replay) {
      let ti = 0;
      const xi = () => (replay ? tape[ti++] : (tape.push(N.next()), tape[tape.length - 1]));
      const un = () => (replay ? tape[ti++] : (tape.push(N.unit()), tape[tape.length - 1]));
      const r = () => xi() * C;                // 混沌の振れ幅でスケールしたゆらぎ
      const segs = [];
      const add = (a, b, t0, dur, needle, dens, weight, drop = 9) =>
        segs.push({ a, b, t0, dur: Math.max(dur, 0.02), needle, dens, weight, drop, drawn: 0 });

      // ---- 幹（Order：ほぼ垂直。Chaos：わずかな揺らぎ） ----
      const sway = [r() * 0.012, r() * 0.012];
      const trunkAt = y => [sway[0] * Math.sin(y * 3.1), y, sway[1] * Math.sin(y * 2.3)];
      const TS = 64;
      for (let i = 0; i < TS; i++) {
        const y0 = i / TS, y1 = (i + 1) / TS;
        const w = 0.0035 + 0.011 * (1 - y0) ** 1.6;             // 幹の太さ（根元が太い）
        add(trunkAt(y0), trunkAt(y1), tf(y0), tf(y1) - tf(y0), w, 1.25, 1);
      }

      // ---- 輪生枝の高さ（Order：等比で詰まる節間。Chaos：節間のゆらぎ） ----
      const K = o.tiers, q = 0.955, top = 0.965;
      const ys = [], ysC = [];                                  // ysC：構造を決める高さ（中心の混沌度）
      for (let k = 0; k < K; k++) {
        const f = (1 - q ** k) / (1 - q ** K);
        const gap = (top - o.bareTrunk) * (q ** k) * (1 - q) / (1 - q ** K);
        const x = xi(), y0 = o.bareTrunk + (top - o.bareTrunk) * f;
        ys.push(clamp(y0 + x * C * gap * 0.45, 0.02, 0.985));
        ysC.push(clamp(y0 + x * Cs * gap * 0.45, 0.02, 0.985));
      }

      const Lmax = o.slender;
      for (let k = 0; k < K; k++) {
        const y = ys[k];
        const h = (y - o.bareTrunk) / (1 - o.bareTrunk);         // 枝域内の相対高さ 0..1
        const cone = hh => Math.pow(clamp(1 - hh, 0, 1), 0.92) * 0.94 + 0.06; // 円錐の包絡線
        const env = cone(h), envC = cone((ysC[k] - o.bareTrunk) / (1 - o.bareTrunk));
        const m = clamp(o.whorl + Math.round(xi() * Cs * 1.6), 3, 8);
        const base = k * GOLDEN + r() * 0.5;                     // 黄金角で段ごとに回る
        const tStart = tf(ysC[k]);
        for (let j = 0; j < m; j++) {
          const th = base + (j * 2 * Math.PI) / m + r() * (Math.PI / m) * 0.7;
          const xL = xi(), shape = (0.86 + 0.14 * Math.cos(j * 2.4 + k));
          const L = Lmax * env * (1 + xL * C * 0.38) * shape;
          const Lc = Lmax * envC * (1 + xL * Cs * 0.38) * shape;  // 構造を決める長さ（中心の混沌度）
          if (Lc < 0.012) continue;
          const drop = un();                                     // C²·0.35 がこれを超えると枝が欠ける
          // 仰角：下段は垂れ、上段は空へ向く（Order） + ゆらぎ（Chaos）
          const a0 = -0.2 + 0.75 * h * h + r() * 0.22;
          const grav = 0.32 * (L / Lmax) + 0.06;                 // 長い枝ほど自重で垂れる
          const lift = 0.22;                                     // 枝先はわずかに反り上がる
          const bend = r() * 0.4;                                // 水平面内の曲がり
          const dir = [Math.cos(th), 0, Math.sin(th)];
          const side = [-Math.sin(th), 0, Math.cos(th)];
          const root = trunkAt(y);
          const P = s => {
            const v = L * (Math.tan(a0) * s - grav * s * s + lift * s * s * s);
            const lat = L * bend * s * s;
            return [root[0] + dir[0] * L * s + side[0] * lat, root[1] + v, root[2] + dir[2] * L * s + side[2] * lat];
          };
          const grow = 1.5 * Math.sqrt(Lc / Lmax) + 0.25;        // 枝の伸長時間（下段ほど長く伸び続ける）
          const S = 8;
          for (let i = 0; i < S; i++) {
            const s0 = i / S, s1 = (i + 1) / S;
            add(P(s0), P(s1), tStart + s0 * grow, grow / S, 0.008 + 0.01 * (1 - s0), 0.9, 1, drop);
          }
          // ---- 小枝（自己相似：親枝の比で短くなる） ----
          const nb = Math.max(3, Math.round(16 * Lc / Lmax));
          const nd = 0.55 + 0.45 * Math.sqrt(Lc / Lmax);         // 短い枝は針葉も短い
          for (let i = 1; i <= nb; i++) {
            const s = clamp(0.1 + 0.86 * (i / (nb + 0.5)) + r() * 0.04, 0.05, 0.98);
            const p0 = P(s), p1 = P(Math.min(1, s + 0.01));
            const tan = norm(sub(p1, p0));
            const sg = i % 2 ? 1 : -1;
            const ang = 0.95 + r() * 0.3;                        // 小枝の開き角 ≈ 55°
            const sd = [side[0] * sg, 0, side[2] * sg];
            const d = norm([
              tan[0] * Math.cos(ang) + sd[0] * Math.sin(ang),
              tan[1] * Math.cos(ang) - 0.12,
              tan[2] * Math.cos(ang) + sd[2] * Math.sin(ang),
            ]);
            const xl = xi();
            const l = L * 0.5 * Math.pow(1 - s, 0.7) * (1 + xl * C * 0.45) + 0.01;
            const lc = Lc * 0.5 * Math.pow(1 - s, 0.7) * (1 + xl * Cs * 0.45) + 0.01;
            const t0 = tStart + s * grow;
            const q1 = [p0[0] + d[0] * l * 0.5, p0[1] + d[1] * l * 0.5 - l * 0.04, p0[2] + d[2] * l * 0.5];
            const q2 = [p0[0] + d[0] * l, p0[1] + d[1] * l - l * (0.22 + 0.2 * (1 - h)), p0[2] + d[2] * l];
            const gd = 0.5 * Math.sqrt(lc / Lmax) + 0.15;
            add(p0, q1, t0, gd * 0.5, 0.016 * nd, 0.9 * nd, 0.9, drop);
            add(q1, q2, t0 + gd * 0.5, gd * 0.5, 0.013 * nd, 0.8 * nd, 0.8, drop);
          }
        }
      }
      // ---- 梢（頂芽：まっすぐ天へ） ----
      const tip = trunkAt(1);
      add(trunkAt(top), [tip[0], 1.03, tip[2]], tf(top), 0.6, 0.006, 1.6, 1);
      return segs;
    }

    const all = build(Cs, false);
    // 中心の混沌度で欠ける枝は、評価と静止画からは外す
    const segs = all.filter(g => Cs * Cs * 0.35 <= g.drop);
    if (o.range) {                                               // 秩序の姿 [0] と混沌の姿 [1] を対応づける
      const lo = build(o.range[0], true), hi = build(o.range[1], true);
      all.forEach((g, i) => { g.a0 = lo[i].a; g.b0 = lo[i].b; g.a1 = hi[i].a; g.b1 = hi[i].b; });
    }
    const end = all.reduce((m, g) => Math.max(m, g.t0 + g.dur), 0);
    return { segs, all, end, opt: o, noise: N };
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

  // 木を点群に焼く。各点は「秩序の姿」と「混沌の姿」の 2 つの画面座標を持ち、
  // 毎フレームその間を補間するだけで木全体が Order ↔ Chaos を行き来する。
  function bake(tree, budget) {
    const proj = tree.proj, N = tree.noise, segs = tree.all;
    const fog = tree.view.fog ?? 0;
    const lenOf = g => Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]);
    const total = segs.reduce((s, g) => s + lenOf(g) * g.dens, 0);
    const density = budget / total;
    const counts = segs.map(g => { const c = lenOf(g) * g.dens * density; const n = Math.floor(c); return n + (N.unit() < c - n ? 1 : 0); });
    const n = counts.reduce((a, b) => a + b, 0);
    const X0 = new Float32Array(n), Y0 = new Float32Array(n), X1 = new Float32Array(n), Y1 = new Float32Array(n);
    const Wt = new Float32Array(n), B = new Float32Array(n), D = new Float32Array(n);
    const pa = [0, 0, 0], pb = [0, 0, 0];
    let k = 0;
    segs.forEach((g, si) => {
      const a0 = g.a0 || g.a, b0 = g.b0 || g.b, a1 = g.a1 || g.a, b1 = g.b1 || g.b, nl = g.needle;
      for (let i = 0; i < counts[si]; i++, k++) {
        const t = N.unit();
        const [u, v] = N.pair();
        // 針葉：枝から放射状に散る（距離は |u|、方向は v）
        const rr = nl * Math.abs(u), ang = v * Math.PI;
        const ox = rr * Math.cos(ang), oy = rr * Math.sin(ang) * 0.75 - rr * 0.25, oz = rr * Math.sin(ang * 1.7);
        proj(a0[0] + (b0[0] - a0[0]) * t + ox, a0[1] + (b0[1] - a0[1]) * t + oy, a0[2] + (b0[2] - a0[2]) * t + oz, pa);
        proj(a1[0] + (b1[0] - a1[0]) * t + ox, a1[1] + (b1[1] - a1[1]) * t + oy, a1[2] + (b1[2] - a1[2]) * t + oz, pb);
        X0[k] = pa[0]; Y0[k] = pa[1]; X1[k] = pb[0]; Y1[k] = pb[1];
        const depth = 0.62 + 0.38 * clamp(0.5 + pa[2] * 2.2, 0, 1);   // 奥の枝ほど淡く（空気遠近）
        Wt[k] = g.weight * tree.weight * depth * (1 - 0.6 * fog);
        B[k] = tree.delay + g.t0 + t * g.dur;                    // 誕生時刻（成長）
        D[k] = g.drop;
      }
    });
    return sortByRow({ n, X0, Y0, X1, Y1, Wt, B, D, haze: fog > 0 });
  }

  // 点を画面の行順に並べ替える（毎フレームの加算でメモリを順に触るように。計数ソート）
  function sortByRow(c) {
    const { n, Y0 } = c;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const y = Y0[i] | 0; if (y < lo) lo = y; if (y > hi) hi = y; }
    if (!(hi >= lo)) return c;
    const R = hi - lo + 2, start = new Uint32Array(R);
    for (let i = 0; i < n; i++) start[(Y0[i] | 0) - lo + 1]++;
    for (let r = 1; r < R; r++) start[r] += start[r - 1];
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[start[(Y0[i] | 0) - lo]++] = i;
    for (const key of ["X0", "Y0", "X1", "Y1", "Wt", "B", "D"]) {
      const src = c[key], dst = new Float32Array(n);
      for (let i = 0; i < n; i++) dst[i] = src[idx[i]];
      c[key] = dst;
    }
    return c;
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
    let W = 0, H = 0, hist = null, haze = null, img = null, px32 = null;
    let clouds = [], raf = 0;
    let palette = { bg: "#f3f1ea", stops: ["#f3f1ea", "#8f9a90", "#2c3a33", "#101814"] };
    let LUT = new Uint8ClampedArray(256 * 3), BG = [0, 0, 0];
    let ref = 1;
    // トーンマップ表：密度 → 色。毎フレームの塗りを表引きだけにする
    const TN = 2048;
    let tq = 1, tabHz = new Uint8ClampedArray(TN * 3), tabM = new Uint8ClampedArray(TN * 3), tabA = new Float32Array(TN);

    function buildLUT() {
      const st = palette.stops.map(hex);
      for (let i = 0; i < 256; i++) {
        const t = (i / 255) * (st.length - 1), j = Math.min(st.length - 2, Math.floor(t)), f = t - j;
        for (let k = 0; k < 3; k++) LUT[i * 3 + k] = st[j][k] + f * (st[j + 1][k] - st[j][k]);
      }
      BG = hex(palette.bg);
      buildTables();
    }
    function buildTables() {
      const lm = Math.log1p(ref), g = 0.78;
      tq = (TN - 1) / (ref * 1.6);
      for (let i = 0; i < TN; i++) {
        const h = i / tq, v = h > 0 ? Math.min(1, Math.pow(Math.log1p(h) / lm, g)) : 0;
        // 霞の層：淡く、暗部まで届かない（背景色に重ねた結果を持つ）
        const th = (v * 150) | 0, ah = h > 0 ? Math.min(1, v * 2.2) * 0.75 : 0;
        for (let k = 0; k < 3; k++) tabHz[i * 3 + k] = BG[k] + (LUT[th * 3 + k] - BG[k]) * ah;
        const tm = (v * 255) | 0;
        for (let k = 0; k < 3; k++) tabM[i * 3 + k] = LUT[tm * 3 + k];
        tabA[i] = h > 0 ? Math.min(1, v * 2.2) : 0;
      }
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
      const d = img.data, top = TN - 1;
      const br = BG[0], bg = BG[1], bb = BG[2];
      for (let i = 0, n = W * H; i < n; i++) {
        const hz = haze[i], hv = hist[i], k = i << 2;
        let r = br, g = bg, b = bb;
        if (hz > 0) { const j = Math.min(top, (hz * tq) | 0) * 3; r = tabHz[j]; g = tabHz[j + 1]; b = tabHz[j + 2]; }
        if (hv > 0) {
          const j = Math.min(top, (hv * tq) | 0), a = tabA[j], j3 = j * 3;
          r += (tabM[j3] - r) * a; g += (tabM[j3 + 1] - g) * a; b += (tabM[j3 + 2] - b) * a;
        }
        d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }

    // trees: [{ opt, view: {cx, cy, scale, rot, elev, fog}, weight, budget, delay }]
    function setTrees(list, range = [0, 1]) {
      clouds = list.map(spec => {
        const t = generate({ ...spec.opt, range });
        t.view = spec.view; t.proj = makeProjector(spec.view);
        t.weight = spec.weight ?? 1; t.delay = spec.delay ?? 0;
        const c = bake(t, spec.budget ?? 1e6);
        c.end = t.delay + t.end;
        return c;
      });
      clouds.range = range;
      // トーンマップの基準：画素あたりの期待密度から決める（成長中に明るさが跳ねないように）
      const budget = list.reduce((s, x) => s + (x.budget ?? 1e6) * (x.weight ?? 1), 0);
      ref = Math.max(4, (budget / (W * H)) * 90);
      buildTables();
      return clouds.reduce((m, c) => Math.max(m, c.end), 0);   // 成長が終わる時刻
    }

    // 時刻 T（成長）と混沌度 c で 1 フレーム描く。stride > 1 は間引き（重みを掛けて階調は保つ）
    let stride = 1;
    function frame(T, c) {
      hist.fill(0); haze.fill(0);
      const [lo, hi] = clouds.range || [0, 1];
      const k = clamp((c - lo) / (hi - lo), 0, 1), dropT = c * c * 0.35;
      for (const cl of clouds) {
        const { n, X0, Y0, X1, Y1, Wt, B, D } = cl, F = cl.haze ? haze : hist;
        for (let i = 0; i < n; i += stride) {
          const dd = D[i] - dropT;
          if (B[i] > T || dd < 0) continue;
          const px = (X0[i] + (X1[i] - X0[i]) * k) | 0, py = (Y0[i] + (Y1[i] - Y0[i]) * k) | 0;
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          F[py * W + px] += Wt[i] * stride * (dd < 0.04 ? dd * 25 : 1);   // 欠ける枝は溶けるように消える
        }
      }
      paint();
    }

    // 再生：clock(T) が混沌度 c を返す。from 秒から再開できる。止めるときは stop()
    function play(clock, from = 0) {
      cancelAnimationFrame(raf);
      const t0 = performance.now() - from * 1000;
      let cost = 16;
      const loop = now => {
        const T = (now - t0) / 1000;
        frame(T, clock(T));
        // 描画が重い端末では点を間引いて滑らかさを優先する
        cost = cost * 0.9 + (performance.now() - now) * 0.1;
        if (cost > 22 && stride < 3) { stride++; cost = 16; } else if (cost < 7 && stride > 1) { stride--; cost = 16; }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }

    function setPalette(p) { palette = p; buildLUT(); paint(); }

    // 任意の点群を描く（作品サムネイルの花など）。fn(hist, W, H) が基準密度を返す
    function draw(fn) { stop(); clouds = []; hist.fill(0); haze.fill(0); ref = fn(hist, W, H); buildTables(); paint(); }

    return { resize, setTrees, frame, play, stop, setPalette, paint, draw, get playing() { return raf !== 0; } };
  }

  // ================================================================
  // Pulse — 緊張と緩和の鼓動
  //   テンポは 80 ↔ 120 BPM を周期 P 秒でゆっくり往復する：BPM(t) = 100 − 20 cos(2πt / P)
  //   拍の位相はその積分：φ(t) = [100 t − 20 (P / 2π) sin(2πt / P)] / 60
  //   緊張 τ = (1 − cos(2πt / P)) / 2 … 速いほど緊張（混沌へ）、遅いほど緩和（秩序へ）
  // ================================================================
  function pulse(t, P = 24, lo = 80, hi = 120) {
    const mid = (lo + hi) / 2, amp = (hi - lo) / 2, w = (2 * Math.PI) / P;
    const bpm = mid - amp * Math.cos(w * t);
    const phase = (mid * t - (amp / w) * Math.sin(w * t)) / 60;
    const tension = (1 - Math.cos(w * t)) / 2;
    const f = phase - Math.floor(phase);
    // 拍：一瞬で立ち上がり、ゆっくり戻る（心拍の「ドクン」と、少し遅れた小さな「トン」）
    const beat = (f < 0.06 ? f / 0.06 : Math.exp(-(f - 0.06) * 7)) + 0.35 * Math.exp(-(((f - 0.22) / 0.05) ** 2));
    return { bpm, tension, beat, phase };
  }

  window.Conifer = { generate, evaluate, selectBest, createScene, pulse, IconChaos, DEFAULTS };
})();
