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
    const h = splitmix32(seed ^ 0x5eed1c0);
    let x = 0.01 + h() * 0.01, y = 0.003 + h() * 0.01, R = 0;
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
    for (let i = 0, m = Math.floor(h() * 1009); i < m; i++) step();
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
  // Seed → Genome
  //   32 bit の seed を splitmix32 で展開し、木の「遺伝子」を決める。
  //   同じ seed からは、枝の本数も葉の数も向きも、まったく同じ木が育つ。
  // ================================================================
  function splitmix32(a) {
    a >>>= 0;
    return () => {
      a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15; t = Math.imul(t, 0x735a2d97);
      return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
    };
  }
  const hash32 = (a, i) => Math.floor(splitmix32((a ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0)() * 4294967296) >>> 0;
  const randomSeed = () => {
    try { return crypto.getRandomValues(new Uint32Array(1))[0]; } catch { return Math.floor(Math.random() * 4294967296) >>> 0; }
  };
  const seedHex = s => "0x" + (s >>> 0).toString(16).toUpperCase().padStart(8, "0");

  // 葉序：Fibonacci 比 F(k)/F(k+2)（2/5, 3/8, 5/13, 8/21, 13/34 → 黄金角 137.5° に収束）
  const PHYLLO = [[2, 5], [3, 8], [5, 13], [8, 21], [13, 34]];
  function genome(seed) {
    const r = splitmix32(seed);
    const [p, q] = PHYLLO[Math.floor(r() * PHYLLO.length)];
    const leafLen = 0.011 + 0.006 * r();
    return {
      whorl: 4 + Math.floor(r() * 4),        // 1 段の枝数 n = 4〜7
      tiers: 22 + Math.floor(r() * 9),       // 段数 22〜30
      slender: 0.2 + 0.05 * r(),             // 細さ
      phyllo: [p, q],                        // 葉序（針葉が小枝を巡る回転 = 2π·p/q）
      leafAngle: (40 + 25 * r()) * Math.PI / 180, // 針葉が小枝となす角 α0
      leafLen,                               // 針葉の長さ λ
      leafGap: leafLen * (0.04 + 0.025 * r()), // 針葉の間隔 Δ（トウヒでは長さの 1/20 前後）
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
    const gnm = genome(opt.seed ?? DEFAULTS.seed);
    const o = { ...DEFAULTS, whorl: gnm.whorl, tiers: gnm.tiers, slender: gnm.slender, ...opt, genome: gnm };
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
  // 生成関数（yield で区切る）なので、アニメーションを止めずに少しずつ焼ける。
  // 葉（針葉）は数理モデルで置く：
  //   本数   N = Σ ⌊ℓ·ρ / Δ⌋         （小枝の長さ ℓ、密度 ρ、間隔 Δ）
  //   向き   d_k = cos α_k · T + sin α_k · (cos ψ_k · N₁ + sin ψ_k · N₂) + 上向きの癖
  //          ψ_k = 2π·k·p/q + c·ξ（Fibonacci 葉序）、α_k = α0 + 0.35·c·ξ
  //   各点は秩序の姿（c = 0）と混沌の姿（c = 1）の 2 つの座標を持つ
  function* bakeGen(tree, budget) {
    const proj = tree.proj, N = tree.noise, segs = tree.all, G = tree.opt.genome;
    const fog = tree.view.fog ?? 0;
    const [lo, hi] = tree.opt.range || [tree.opt.chaos, tree.opt.chaos];
    const lenOf = g => Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]);
    // 幹の点（樹皮）と葉の本数
    let trunkLen = 0, leaves = 0;
    const leafCount = segs.map(g => {
      if (g.drop > 1) { trunkLen += lenOf(g) * g.dens; return 0; }
      const k = Math.floor((lenOf(g) * g.dens) / G.leafGap); leaves += k; return k;
    });
    const trunkPts = Math.round(budget * 0.025);
    const P = clamp(Math.round((budget - trunkPts) / Math.max(1, leaves)), 3, 12); // 1 本の葉を何点で描くか
    const trunkCount = segs.map(g => (g.drop > 1 ? Math.round((lenOf(g) * g.dens / trunkLen) * trunkPts) : 0));
    const n = trunkCount.reduce((a, b) => a + b, 0) + leaves * P;
    const X0 = new Float32Array(n), Y0 = new Float32Array(n), X1 = new Float32Array(n), Y1 = new Float32Array(n);
    const Wt = new Float32Array(n), B = new Float32Array(n), D = new Float32Array(n), Q = new Float32Array(n);
    const pa = [0, 0, 0], pb = [0, 0, 0];
    const reach = tree.opt.slender, turn = (2 * Math.PI * G.phyllo[0]) / G.phyllo[1];
    const depthOf = z => 0.62 + 0.38 * clamp(0.5 + z * 2.2, 0, 1);   // 奥の枝ほど淡く（空気遠近）
    const frameOf = (a, b) => {                                // 小枝の局所座標 T, N₁, N₂
      const T = norm(sub(b, a));
      let N1 = [T[2], 0, -T[0]]; if (Math.hypot(N1[0], N1[2]) < 1e-6) N1 = [1, 0, 0];
      N1 = norm(N1);
      const N2 = [T[1] * N1[2] - T[2] * N1[1], T[2] * N1[0] - T[0] * N1[2], T[0] * N1[1] - T[1] * N1[0]];
      return [T, N1, N2];
    };
    let k = 0, since = 0, leafIndex = 0;
    const put = (g, t, P0, P1, w, q) => {
      proj(P0[0], P0[1], P0[2], pa); proj(P1[0], P1[1], P1[2], pb);
      X0[k] = pa[0]; Y0[k] = pa[1]; X1[k] = pb[0]; Y1[k] = pb[1];
      Wt[k] = w * depthOf(pa[2]); B[k] = g.t0 + t * g.dur; D[k] = g.drop; Q[k] = q; k++;
    };
    for (let si = 0; si < segs.length; si++) {
      const g = segs[si];
      const a0 = g.a0 || g.a, b0 = g.b0 || g.b, a1 = g.a1 || g.a, b1 = g.b1 || g.b;
      const w = g.weight * tree.weight * (1 - 0.6 * fog);
      if (g.drop > 1) {
        // 幹：樹皮のざらつき
        for (let i = 0; i < trunkCount[si]; i++) {
          const t = N.unit(), [u, v] = N.pair(), rr = g.needle * Math.abs(u), ang = v * Math.PI;
          const o = [rr * Math.cos(ang), rr * Math.sin(ang) * 0.75, rr * Math.sin(ang * 1.7)];
          const at = (a, b) => [a[0] + (b[0] - a[0]) * t + o[0], a[1] + (b[1] - a[1]) * t + o[1], a[2] + (b[2] - a[2]) * t + o[2]];
          put(g, t, at(a0, b0), at(a1, b1), w, 2 + g.a[1] + (g.b[1] - g.a[1]) * t);
        }
      } else {
        const F0 = frameOf(a0, b0), F1 = frameOf(a1, b1);
        const ell = G.leafLen * (g.needle / 0.014);             // 葉の長さ（小枝の太さに比例）
        for (let i = 0; i < leafCount[si]; i++, leafIndex++) {
          const [xs, xa] = N.pair();                             // ゆらぎ ξ（カオス写像の軌道）
          const t = (i + 0.5 + 0.3 * xs * hi) / leafCount[si];
          const psi = leafIndex * turn, al = G.leafAngle;
          // 秩序の姿と混沌の姿で、ゆらぎの効き方だけが違う
          const dirOf = (F, c) => {
            const p = psi + c * xs * 0.9, a = al + 0.35 * c * xa;
            const ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(p), sp = Math.sin(p);
            return norm([
              ca * F[0][0] + sa * (cp * F[1][0] + sp * F[2][0]),
              ca * F[0][1] + sa * (cp * F[1][1] + sp * F[2][1]) + 0.25,  // 針葉は光へ少し上向く
              ca * F[0][2] + sa * (cp * F[1][2] + sp * F[2][2]),
            ]);
          };
          const d0 = dirOf(F0, lo), d1 = dirOf(F1, hi);
          const base0 = [a0[0] + (b0[0] - a0[0]) * t, a0[1] + (b0[1] - a0[1]) * t, a0[2] + (b0[2] - a0[2]) * t];
          const base1 = [a1[0] + (b1[0] - a1[0]) * t, a1[1] + (b1[1] - a1[1]) * t, a1[2] + (b1[2] - a1[2]) * t];
          // 枯れる順番 Q：梢と枝先から先に
          const y = g.a[1] + (g.b[1] - g.a[1]) * t;
          const r = Math.hypot(g.a[0] + (g.b[0] - g.a[0]) * t, g.a[2] + (g.b[2] - g.a[2]) * t);
          const q = clamp(0.45 * (1 - y) + 0.45 * (1 - Math.min(1, r / reach)) + 0.1 * Math.abs(xa), 0, 1);
          for (let j = 0; j < P; j++) {
            const u = ell * ((j + 0.5) / P);
            put(g, t, [base0[0] + d0[0] * u, base0[1] + d0[1] * u, base0[2] + d0[2] * u],
                      [base1[0] + d1[0] * u, base1[1] + d1[1] * u, base1[2] + d1[2] * u], w, q);
          }
        }
      }
      since += leafCount[si] * P + trunkCount[si];
      if (since > 30000) { since = 0; yield; }
    }
    const c = yield* sortByRow({ n: k, X0, Y0, X1, Y1, Wt, B, D, Q, haze: fog > 0 });
    c.leaves = leaves; c.perLeaf = P;
    return c;
  }
  function run(gen) { let r; do { r = gen.next(); } while (!r.done); return r.value; }

  // 点を画面の行順に並べ替える（毎フレームの加算でメモリを順に触るように。計数ソート）
  function* sortByRow(c) {
    const { n, Y0 } = c;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const y = Y0[i] | 0; if (y < lo) lo = y; if (y > hi) hi = y; }
    if (!(hi >= lo)) return c;
    const R = hi - lo + 2, start = new Uint32Array(R);
    for (let i = 0; i < n; i++) start[(Y0[i] | 0) - lo + 1]++;
    for (let r = 1; r < R; r++) start[r] += start[r - 1];
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[start[(Y0[i] | 0) - lo]++] = i;
    yield;
    for (const key of ["X0", "Y0", "X1", "Y1", "Wt", "B", "D", "Q"]) {
      const src = c[key], dst = new Float32Array(n);
      for (let i = 0; i < n; i++) dst[i] = src[idx[i]];
      c[key] = dst;
      yield;
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
  function* selectBestGen(opt, candidates = 6) {
    let best = null;
    for (let i = 0; i < (opt.exact ? 1 : candidates); i++) {
      const seed = i === 0 && opt.exact ? opt.seed >>> 0 : hash32(opt.seed ?? 137, i);
      const t = generate({ ...opt, seed });
      const s = evaluate(t);
      if (!best || s.B > best.score.B) best = { seed, score: s };
      yield;
    }
    return best;
  }
  const selectBest = (opt, candidates) => run(selectBestGen(opt, candidates));

  // ================================================================
  // Renderer — 複数の木を 1 枚の密度場に描き、ログ階調でトーンマップする
  // ================================================================
  function hex(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }

  function createScene(canvas) {
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0, hist = null, haze = null, dry = null, img = null;
    let clouds = [], raf = 0;
    let palette = { bg: "#f3f1ea", stops: ["#f3f1ea", "#8f9a90", "#2c3a33", "#101814"] };
    let LUT = new Uint8ClampedArray(256 * 3), BG = [0, 0, 0], DRY = [156, 143, 120];
    let ref = 1;
    // トーンマップ表：密度 → 色。毎フレームの塗りを表引きだけにする
    const TN = 2048;
    let tq = 1, tabHz = new Uint8ClampedArray(TN * 3), tabM = new Uint8ClampedArray(TN * 3), tabA = new Float32Array(TN), tabD = new Float32Array(TN);

    function buildLUT() {
      const st = palette.stops.map(hex);
      for (let i = 0; i < 256; i++) {
        const t = (i / 255) * (st.length - 1), j = Math.min(st.length - 2, Math.floor(t)), f = t - j;
        for (let k = 0; k < 3; k++) LUT[i * 3 + k] = st[j][k] + f * (st[j + 1][k] - st[j][k]);
      }
      BG = hex(palette.bg);
      DRY = hex(palette.dry || "#9c8f78");
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
        tabD[i] = h > 0 ? Math.min(1, v * 1.9) * 0.8 : 0;      // 枯れの層：乾いた木の色
      }
    }
    buildLUT();

    function resize(w, h) {
      W = canvas.width = Math.max(1, w | 0);
      H = canvas.height = Math.max(1, h | 0);
      hist = new Float32Array(W * H);
      haze = new Float32Array(W * H);
      dry = new Float32Array(W * H);
      img = ctx.createImageData(W, H);
    }

    function paint() {
      if (!img) return;
      const d = img.data, top = TN - 1;
      const br = BG[0], bg = BG[1], bb = BG[2];
      for (let i = 0, n = W * H; i < n; i++) {
        const hz = haze[i], hv = hist[i], dv = dry[i], k = i << 2;
        let r = br, g = bg, b = bb;
        if (hz > 0) { const j = Math.min(top, (hz * tq) | 0) * 3; r = tabHz[j]; g = tabHz[j + 1]; b = tabHz[j + 2]; }
        if (dv > 0) { const a = tabD[Math.min(top, (dv * tq) | 0)]; r += (DRY[0] - r) * a; g += (DRY[1] - g) * a; b += (DRY[2] - b) * a; }
        if (hv > 0) {
          const j = Math.min(top, (hv * tq) | 0), a = tabA[j], j3 = j * 3;
          r += (tabM[j3] - r) * a; g += (tabM[j3 + 1] - g) * a; b += (tabM[j3 + 2] - b) * a;
        }
        d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }

    // ---------------------------------------------------------------- life cycle
    // 一本ごとに「生命の時計」L を持つ。L は鼓動に合わせた可変の速さで進み、
    //   成長 G → 呼吸 M → 枯れる WI → 散る FA → 眠る RE → 再び成長
    // を繰り返す。主木は眠りのあいだに新しい seed で焼き直した木に入れ替わる。
    const LIFE = { mature: 16, wither: 5.5, fall: 5.5, rest: 1.6 };
    let T = 0, stride = 1, jobs = [];

    function makeCloud(spec, range, gen) {
      const t = generate({ ...spec.opt, range });
      t.view = spec.view; t.proj = makeProjector(spec.view); t.weight = spec.weight ?? 1;
      return { tree: t, gen: gen ? bakeGen(t, spec.budget ?? 1e6) : null, pts: gen ? null : run(bakeGen(t, spec.budget ?? 1e6)) };
    }

    // trees: [{ opt, view: {cx, cy, scale, rot, elev, fog}, weight, budget, delay, mature, renew }]
    function setTrees(list, range = [0, 1], { mature = false } = {}) {
      jobs = [];
      clouds = list.map(spec => {
        const { tree, pts } = makeCloud(spec, range, false);
        const cl = { spec, pts, view: spec.view, center: spec.opt.chaos ?? 0.32, G: tree.end, M: spec.mature ?? LIFE.mature };
        cl.life = mature ? cl.G + 0.5 : -(spec.delay ?? 0);
        return cl;
      });
      clouds.range = range;
      // トーンマップの基準：画素あたりの期待密度から決める（成長中に明るさが跳ねないように）
      const budget = list.reduce((s, x) => s + (x.budget ?? 1e6) * (x.weight ?? 1), 0);
      ref = Math.max(4, (budget / (W * H)) * 90);
      buildTables();
      return clouds.reduce((m, c) => Math.max(m, c.G + (c.spec.delay ?? 0)), 0);   // 最初の成長が終わる時刻
    }

    function phaseOf(cl) {
      let L = cl.life;
      if (L < cl.G) return ["grow", Math.max(0, L)];
      L -= cl.G; if (L < cl.M) return ["breathe", L];
      L -= cl.M; if (L < LIFE.wither) return ["wither", L / LIFE.wither];
      L -= LIFE.wither; if (L < LIFE.fall) return ["fall", L / LIFE.fall];
      L -= LIFE.fall; return ["rest", L / LIFE.rest];
    }

    // 生命の時計を進める。rate は鼓動から決まる可変の速さ
    function advance(dt, rate) {
      for (const cl of clouds) {
        cl.life += dt * rate;
        const [ph, x] = phaseOf(cl);
        // 枯れ始めたら、次の木を少しずつ焼き始める（主木のみ）
        if (ph === "wither" && !cl.job && cl.spec.renew) {
          cl.job = (function* () {
            const spec = yield* cl.spec.renew();
            const { tree, gen } = makeCloud(spec, clouds.range, true);
            const pts = yield* gen;
            return { spec, pts, G: tree.end };
          })();
          jobs.push(cl.job);
        }
        if (ph === "rest" && x >= 1) {
          if (cl.job) {
            if (!cl.next) { cl.life = cl.G + cl.M + LIFE.wither + LIFE.fall + LIFE.rest; continue; } // 焼き上がるまで眠る
            Object.assign(cl, cl.next, { center: cl.next.spec.opt.chaos ?? cl.center }); cl.job = cl.next = null;
            cl.onRenew && cl.onRenew(cl.spec);
          }
          cl.life = 0;
        }
      }
      // 焼き上げは 1 フレームあたり数ミリ秒だけ
      const t0 = performance.now();
      while (jobs.length && performance.now() - t0 < 5) {
        const job = jobs[0], r = job.next();
        if (r.done) { jobs.shift(); const cl = clouds.find(c => c.job === job); if (cl) cl.next = r.value; }
      }
    }

    const fract = x => x - Math.floor(x);
    const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

    // 1 フレーム描く。c は呼吸の混沌度（中心からのずれ dc として各木に足す）
    function frame(dc) {
      hist.fill(0); haze.fill(0); dry.fill(0);
      const [lo, hi] = clouds.range || [0, 1];
      for (const cl of clouds) {
        const { n, X0, Y0, X1, Y1, Wt, B, D, Q } = cl.pts;
        const F = cl.pts.haze ? haze : hist;
        const [ph, x] = phaseOf(cl);
        const sc = cl.view.scale, ground = cl.view.cy;
        const dk = cl.pts.haze ? 0.4 : 0.9;                      // 枯れの層の濃さ（遠景は淡く）
        let c = cl.center;
        if (ph === "breathe") c = clamp(cl.center + dc * ease(x / 3), 0, 1);      // 3 秒かけて鼓動が立ち上がる
        else if (ph === "wither") c = cl.center + (0.85 - cl.center) * ease(x);   // 枯れるほど秩序がほどける
        else if (ph === "fall" || ph === "rest") c = 0.85;
        const k = clamp((c - lo) / (hi - lo), 0, 1);
        const dropT = (ph === "grow" || ph === "breathe" ? c * c : cl.center * cl.center) * 0.35;

        if (ph === "grow" || ph === "breathe") {
          const Tg = ph === "grow" ? x : 1e9;
          for (let i = 0; i < n; i += stride) {
            const dd = D[i] - dropT;
            if (B[i] > Tg || dd < 0) continue;
            const px = (X0[i] + (X1[i] - X0[i]) * k) | 0, py = (Y0[i] + (Y1[i] - Y0[i]) * k) | 0;
            if (px < 0 || py < 0 || px >= W || py >= H) continue;
            F[py * W + px] += Wt[i] * stride * (dd < 0.04 ? dd * 25 : 1);   // 欠ける枝は溶けるように消える
          }
        } else if (ph === "wither") {
          // 枯れる：梢と枝先から緑が抜けて乾いた色（枯れの層）へ移り、自重で垂れる
          for (let i = 0; i < n; i += stride) {
            if (D[i] < dropT) continue;
            const q = Q[i] >= 2 ? 0.9 : Q[i];
            const wf = ease((x - q * 0.7) / 0.3);
            const px = (X0[i] + (X1[i] - X0[i]) * k) | 0;
            const py = (Y0[i] + (Y1[i] - Y0[i]) * k + (Q[i] >= 2 ? 0 : wf * sc * 0.02)) | 0;
            if (px < 0 || py < 0 || px >= W || py >= H) continue;
            const w = Wt[i] * stride, j = py * W + px;
            F[j] += w * (1 - wf);
            dry[j] += w * wf * dk;
          }
        } else if (ph === "fall") {
          // 散る：枯れた順に枝を離れ、風に揺れながら落ち、地面に積もって消える
          const litter = 1 - ease((x - 0.8) / 0.2);
          for (let i = 0; i < n; i += stride) {
            if (D[i] < dropT) continue;
            const h1 = fract(i * 0.6180339887), h2 = fract(i * 0.7548776662);
            let px = X0[i] + (X1[i] - X0[i]) * k, py = Y0[i] + (Y1[i] - Y0[i]) * k, w = Wt[i] * stride * dk;
            if (Q[i] >= 2) {
              w *= 1 - ease((x - 0.55) / 0.4);                 // 幹は最後まで立ち、やがて消える
            } else {
              py += sc * 0.02;
              const tf = (x - (Q[i] * 0.5 + h1 * 0.4)) * LIFE.fall;   // 枝を離れてからの時間（ばらばらに離れる）
              if (tf > 0) {
                if (h2 > 0.42) {
                  w *= 1 - Math.min(1, tf * 1.4);                // 半分ほどは宙で風化して消える
                  py += sc * 0.02 * tf;
                } else {
                  // 残りは風に流され、揺れながら落ちる
                  w *= 0.85;
                  px += sc * ((0.02 + 0.08 * h1) * tf + 0.02 * Math.sin(4 * tf + 6.28 * h2));
                  py += sc * (0.05 + 0.1 * h2) * tf + sc * 0.05 * tf * tf;
                  if (py > ground - h1 * 3) { py = ground - h1 * 3; w *= litter; }   // 地面に積もる
                }
              }
            }
            px |= 0; py |= 0;
            if (w <= 0 || px < 0 || py < 0 || px >= W || py >= H) continue;
            dry[py * W + px] += w;
          }
        }
        // rest：何も描かない（土に還る）
      }
      paint();
    }

    // 再生：clock(T) が { dc, rate } を返す（dc：混沌度の揺れ、rate：生命の時計の速さ）
    function play(clock) {
      cancelAnimationFrame(raf);
      let last = performance.now(), cost = 16;
      const loop = now => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        T += dt;
        const { dc, rate } = clock(T);
        advance(dt, rate);
        frame(dc);
        // 描画が重い端末では点を間引いて滑らかさを優先する
        cost = cost * 0.9 + (performance.now() - now) * 0.1;
        if (cost > 22 && stride < 3) { stride++; cost = 16; } else if (cost < 7 && stride > 1) { stride--; cost = 16; }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }
    // 静止画：呼吸の中心で、成長しきった姿
    function still() { stop(); for (const cl of clouds) cl.life = cl.G + 0.01; stride = 1; frame(0); }
    const status = () => { const cl = clouds[clouds.length - 1]; return cl ? phaseOf(cl)[0] : ""; };

    function setPalette(p) { palette = p; buildLUT(); paint(); }

    // 任意の点群を描く（作品サムネイルの花など）。fn(hist, W, H) が基準密度を返す
    function draw(fn) { stop(); clouds = []; hist.fill(0); haze.fill(0); dry.fill(0); ref = fn(hist, W, H); buildTables(); paint(); }

    return { resize, setTrees, frame, play, stop, still, status, setPalette, paint, draw, get clouds() { return clouds; } };
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

  window.Conifer = { generate, genome, randomSeed, seedHex, evaluate, selectBest, selectBestGen, createScene, pulse, IconChaos, DEFAULTS };
})();
