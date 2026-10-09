(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- palette
  // stops：作品サムネイルの単色。sky / ground / fog / dry：キービジュアルの空・地面・霞・枯れ色
  const PALETTES = {
    light: {
      bg: "#f2f0e9", stops: ["#f2f0e9", "#a9b2a6", "#3d4d43", "#121b16"],
      sky: ["#dfe5e3", "#f1f1eb"], ground: "#e7e3d7", floor: "#b9b8a4", fog: "#e1e5df",
      dry: "#a8875c", dryDark: "#4f3b28", gain: 1, lift: 0,
    },
    dark: {
      bg: "#0d1210", stops: ["#0d1210", "#34453b", "#9fb5a8", "#eef4ef"],
      sky: ["#070b0d", "#1a2420"], ground: "#121813", floor: "#0a0e0b", fog: "#26312d",
      dry: "#8a6f4e", dryDark: "#3a2c1f", gain: 1.08, lift: 4,
    },
  };
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const palette = () => PALETTES[isDark() ? "dark" : "light"];
  const scenes = [];
  const repaintAll = () => scenes.forEach(s => s.setPalette(palette()));

  $(".theme-toggle").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("oc.theme", next);
    repaintAll();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", repaintAll);

  // ヘッダーの地色はスクロールしてから（キービジュアルの空を切らない）
  const header = $(".site-header");
  const onScroll = () => header.classList.toggle("scrolled", scrollY > 40);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // 小さな決定論的乱数（森の配置用）
  const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  function fitCanvas(canvas, maxPixels) {
    const r = canvas.getBoundingClientRect();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (r.width * r.height * dpr * dpr > maxPixels) dpr = Math.sqrt(maxPixels / (r.width * r.height));
    return [Math.round(r.width * dpr), Math.round(r.height * dpr)];
  }

  // ================================================================ hero
  const canvas = $("#forest"), slider = $("#chaos"), readout = $("#readout");
  const SIGNAGE = document.documentElement.classList.contains("signage");
  const hero = Conifer.createScene(canvas);
  hero.setPalette(palette());
  scenes.push(hero);
  // 木ごとの seed（32 bit）。?seed=0x… を付けると、その木をそのまま再現する
  const urlSeed = (() => { try { const v = new URLSearchParams(location.search).get("seed"); return v ? parseInt(v, v.startsWith("0x") ? 16 : 10) >>> 0 : null; } catch { return null; } })();
  let seed = urlSeed ?? Conifer.randomSeed(), exact = urlSeed != null;

  function heroTrees(W, H) {
    const chaos = +slider.value;
    const wide = W / H > 0.9;
    const main = SIGNAGE
      ? { cx: W * 0.5, cy: H * 0.94, scale: H * 0.84 }
      : { cx: W * (wide ? 0.68 : 0.64), cy: H * (wide ? 0.93 : 0.86), scale: H * (wide ? 0.8 : 0.6) };
    hero.setGround(main.cy);
    const px = W * H;
    const list = [];
    // 遠景の森：小さく、淡く、少し早く育つ
    const R = rng(seed * 31 + 7);
    const n = SIGNAGE ? (wide ? 12 : 6) : wide ? 8 : 5;
    const x0 = SIGNAGE || !wide ? -0.02 : 0.4;                     // 左側はコピーのために空ける（サイネージは全幅）
    const far = [];
    for (let i = 0; i < n; i++) far.push({ depth: R(), slot: (i + 0.2 + R() * 0.6) / n });
    far.sort((a, b) => a.depth - b.depth);                         // 遠いものから
    for (const { depth, slot } of far) {
      const k = 0.22 + 0.38 * depth;                               // 近いほど大きい
      list.push({
        opt: { seed: (Math.imul(seed, 13) + Math.round(slot * 997)) >>> 0, chaos, growTime: 4.2 + R() * 1.6, tiers: 20 },
        view: {
          cx: W * (x0 + (1.04 - x0) * slot), cy: main.cy - H * 0.05 * (1 - depth),
          scale: main.scale * k, rot: R() * 6.28, fog: 0.78 - 0.4 * depth,
        },
        weight: 0.8, budget: px * 0.32 * k * k * 2.2, delay: 0.1 + R() * 0.8,
        mature: 10 + R() * 12,                                     // 呼吸の長さを木ごとに変えて、森の周期をずらす
      });
    }
    const mainSpec = { view: { ...main, rot: 0 }, weight: 1, budget: px * 0.75, delay: 0, mature: 16 };
    // 主木の seed：初回は今の seed（?seed= ならそのまま）、散って眠るたびに新しい seed を Beauty で選び直す
    let first = true;
    mainSpec.renew = function* () {
      const b = yield* Conifer.selectBestGen(first ? { seed, chaos: +slider.value, exact } : { seed: Conifer.randomSeed(), chaos: +slider.value });
      first = false;
      return { ...mainSpec, opt: { seed: b.seed, chaos: +slider.value }, meta: { seed: b.seed, score: b.score } };
    };
    list.push(mainSpec);
    return list;
  }

  // ---- 鼓動：80 ↔ 120 BPM の可変テンポで、緊張（混沌）と緩和（秩序）を繰り返す ----
  //   dc   … 呼吸の混沌度の揺れ（緊張で混沌へ、緩和で秩序へ、拍ごとに一瞬振れる）
  //   rate … 生命の時計の速さ（テンポが速いほど、拍の瞬間ほど速く進む＝変速）
  const seedEl = $("#seed"), genomeEl = $("#genome");
  const bpmEl = $("#bpm"), beatEl = $("#beat"), scoreEl = $("#score"), pauseBtn = $("#pause");
  const PHASE = { grow: "育つ", breathe: "呼吸", wither: "枯れる", fall: "散る", rest: "眠る" };
  let paused = false, visible = true, lastText = -1, shown = null;

  function clock(T) {
    const p = Conifer.pulse(T);
    const dc = 0.5 * (p.tension - 0.4) + 0.16 * p.beat * (0.35 + 0.65 * p.tension);
    const rate = Math.pow(p.bpm / 100, 1.6) * (1 + 0.55 * p.beat);
    beatEl.style.opacity = (0.2 + 0.8 * p.beat).toFixed(3);
    beatEl.style.transform = `scale(${(1 + 0.6 * p.beat).toFixed(3)})`;
    if (T - lastText > 0.2 || T < lastText) {
      lastText = T;
      bpmEl.textContent = `${Math.round(p.bpm)} BPM · ${PHASE[hero.status()] || ""}`;
      showReadout();
    }
    return { dc, rate };
  }

  function showReadout() {
    const cl = hero.clouds[hero.clouds.length - 1];
    if (!cl || !cl.pts || cl.spec.meta === shown) return;
    shown = cl.spec.meta;
    const s = shown.score, f = v => v.toFixed(2), G = Conifer.genome(shown.seed), hex = Conifer.seedHex(shown.seed);
    seedEl.textContent = hex;
    seedEl.href = `?seed=${hex}`;
    seedEl.title = "この木を再現する URL";
    genomeEl.textContent = `葉 ${cl.pts.leaves.toLocaleString("en-US")} 本 · 枝 n=${G.whorl} × ${G.tiers} 段 · 葉序 ${G.phyllo[0]}/${G.phyllo[1]} · 葉角 ${Math.round(G.leafAngle * 180 / Math.PI)}°`;
    scoreEl.textContent = `O ${f(s.O)} × C ${f(s.C)} × K ${f(s.K)} = B ${f(s.B)}`;
  }

  function run() {
    if (reduceMotion) { hero.still(); bpmEl.textContent = "still"; showReadout(); return; }
    if (paused || !visible) hero.stop(); else hero.play(clock);
  }

  function buildHero(regrow) {
    const [W, H] = fitCanvas(canvas, SIGNAGE ? 4e6 : 1.5e6);
    hero.resize(W, H);
    hero.setTrees(heroTrees(W, H), [0, 1], { mature: !regrow });
    shown = null; showReadout();
    run();
  }

  $("#regrow").addEventListener("click", () => {
    seed = Conifer.randomSeed(); exact = false;
    buildHero(true);
  });
  slider.addEventListener("change", () => buildHero(false));

  pauseBtn.hidden = reduceMotion;
  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "動かす" : "止める";
    pauseBtn.setAttribute("aria-pressed", String(paused));
    run();
  });
  // 画面外・非表示のタブでは止める（再開時は同じ生命の時刻から）
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting === visible) return;
    visible = e.isIntersecting; run();
  }).observe(canvas);
  document.addEventListener("visibilitychange", () => { visible = !document.hidden; run(); });

  let lastW = 0, lastH = 0, rt = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      const w = innerWidth, h = innerHeight;
      // モバイルのアドレスバー伸縮では描き直さない
      if (w === lastW && Math.abs(h - lastH) < 140) return;
      lastW = w; lastH = h;
      buildHero(false);
    }, 200);
  });
  lastW = innerWidth; lastH = innerHeight;
  buildHero(true);

  // サイネージ：ダブルクリック / F キーで全画面、操作がないとカーソルを隠す
  if (SIGNAGE) {
    const fs = () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch {} };
    canvas.addEventListener("dblclick", fs);
    addEventListener("keydown", e => { if (e.key === "f" || e.key === "F") fs(); });
    let idle = 0;
    const wake = () => { document.documentElement.classList.remove("idle"); clearTimeout(idle); idle = setTimeout(() => document.documentElement.classList.add("idle"), 2500); };
    addEventListener("pointermove", wake); wake();
    try { navigator.wakeLock && navigator.wakeLock.request("screen").catch(() => {}); } catch {}
  }

  // ================================================================ works thumbnails
  // 各作品の数理モデルを、サイトの配色で小さく描く
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  function plotter(hist, W, H, k = 0.42) {
    const s = Math.min(W, H) * k, cx = W / 2, cy = H / 2;
    return (x, y, w = 1) => {
      const px = (cx + x * s) | 0, py = (cy - y * s) | 0;
      if (px >= 0 && py >= 0 && px < W && py < H) hist[py * W + px] += w;
    };
  }
  // 濃淡の基準：非ゼロ画素の 99 パーセンタイル
  function refOf(hist) {
    const v = [];
    for (let i = 0; i < hist.length; i += 3) if (hist[i] > 0) v.push(hist[i]);
    v.sort((a, b) => a - b);
    return Math.max(2, v[Math.floor(v.length * 0.99)] || 2);
  }
  const icon = q => (hist, W, H) => {
    const N = Conifer.IconChaos(7, q), plot = plotter(hist, W, H);
    for (let i = 0, n = W * H * 3; i < n; i++) { const [x, y] = N.pair(); plot(x, y); }
    return refOf(hist);
  };
  const THUMBS = {
    flower: icon({ lam: -2.34, alpha: 2.0, beta: 0.2, gamma: 0.1, omega: 0, n: 5 }),
    ivy: icon({ lam: -2.08, alpha: 1.0, beta: -0.1, gamma: 0.167, omega: 0, n: 7 }),
    petals(hist, W, H) {                                         // 咲く・散る：5 弁の花と、散る花びら
      const plot = plotter(hist, W, H), R = rng(5);
      for (let i = 0, n = W * H * 1.2; i < n; i++) {
        const th = R() * 2 * Math.PI, c = Math.cos(2.5 * th);
        const r = Math.abs(c) * Math.sqrt(R()) * 0.62;
        plot(r * Math.cos(th + Math.PI / 2) - 0.25, r * Math.sin(th + Math.PI / 2) - 0.2);
      }
      let x = 0.37;                                              // ロジスティック写像で散らす
      for (let p = 0; p < 16; p++) {
        x = 3.9 * x * (1 - x);
        const t = (p + 1) / 16, px = -0.15 + t * 1.05 + (x - 0.5) * 0.25, py = -0.1 + t * 0.85 + (x - 0.5) * 0.3;
        const a = x * 6.28, sz = 0.07 * (1 - 0.5 * t);
        for (let i = 0; i < 2600 * (1 - 0.5 * t); i++) {
          const u = R() * 2 - 1, v = (R() * 2 - 1) * Math.sqrt(1 - u * u) * 0.5;
          plot(px + sz * (u * Math.cos(a) - v * Math.sin(a)), py + sz * (u * Math.sin(a) + v * Math.cos(a)), 0.8);
        }
      }
      return refOf(hist);
    },
    bifurcation(hist, W, H) {                                    // ロジスティック写像の分岐図
      const plot = plotter(hist, W, H, 0.44);
      const cols = W * 2;
      for (let c = 0; c < cols; c++) {
        const r = 2.8 + 1.2 * (c / cols);
        let x = 0.5;
        for (let i = 0; i < 300; i++) x = r * x * (1 - x);
        for (let i = 0; i < 260; i++) { x = r * x * (1 - x); plot((c / cols) * 2 - 1, x * 1.8 - 0.9); }
      }
      return refOf(hist);
    },
    pendulum(hist, W, H) {                                       // 二重振り子（RK4）＋ 放射対称の複製
      const plot = plotter(hist, W, H, 0.46), g = 9.81, N = 6;
      let st = [2.2, 2.6, 0, 0];
      const f = ([a1, a2, w1, w2]) => {
        const d = a1 - a2, den = 3 - Math.cos(2 * d);
        return [w1, w2,
          (-3 * g * Math.sin(a1) - g * Math.sin(a1 - 2 * a2) - 2 * Math.sin(d) * (w2 * w2 + w1 * w1 * Math.cos(d))) / den,
          (2 * Math.sin(d) * (2 * w1 * w1 + 2 * g * Math.cos(a1) + w2 * w2 * Math.cos(d))) / den];
      };
      const h = 0.002, add = (a, b, k) => a.map((v, i) => v + b[i] * k);
      for (let i = 0; i < 60000; i++) {
        const k1 = f(st), k2 = f(add(st, k1, h / 2)), k3 = f(add(st, k2, h / 2)), k4 = f(add(st, k3, h));
        st = st.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
        const x = (Math.sin(st[0]) + Math.sin(st[1])) / 2, y = -(Math.cos(st[0]) + Math.cos(st[1])) / 2;
        const r = Math.hypot(x, y), t = Math.atan2(y, x);
        for (let k = 0; k < N; k++) {
          const a = t / N + (k * 2 * Math.PI) / N;               // 角度を 1/N に縮めて N 回複製
          plot(r * Math.cos(a), r * Math.sin(a), 0.6);
          plot(r * Math.cos(-a + 2 * Math.PI / N * 0.5), r * Math.sin(-a + 2 * Math.PI / N * 0.5), 0.4);
        }
      }
      return refOf(hist);
    },
    phyllotaxis(hist, W, H) { return vogel(hist, W, H, 0); },
    drift(hist, W, H) { return vogel(hist, W, H, 1); },
    question(hist, W, H) {                                       // 一日一問：ひとつの円環とひとつの点
      const plot = plotter(hist, W, H), R = rng(3);
      for (let i = 0, n = W * H; i < n; i++) {
        const t = R() * 2 * Math.PI, r = 0.62 + (R() - 0.5) * 0.012;
        plot(r * Math.cos(t), r * Math.sin(t));
      }
      for (let i = 0; i < 20000; i++) {
        const t = R() * 2 * Math.PI, r = Math.sqrt(R()) * 0.05;
        plot(r * Math.cos(t), 0.62 + r * Math.sin(t), 3);
      }
      return refOf(hist);
    },
  };
  // 黄金角の葉序（drift = 1 でロジスティック写像のゆらぎを加える）
  function vogel(hist, W, H, drift) {
    const plot = plotter(hist, W, H), R = rng(11), M = 520;
    let x = 0.31;
    for (let i = 1; i <= M; i++) {
      x = 3.93 * x * (1 - x);
      const th = i * GOLDEN + drift * (x - 0.5) * 0.35, r = 0.95 * Math.sqrt(i / M);
      const sz = (0.012 + 0.03 * Math.sqrt(i / M)) * (1 + drift * (x - 0.5) * 0.9);
      const cx = r * Math.cos(th), cy = r * Math.sin(th);
      for (let k = 0; k < 160 * (sz / 0.03) ** 2 + 20; k++) {
        const a = R() * 2 * Math.PI, rr = Math.sqrt(R()) * sz;
        // 花弁：中心方向に長い楕円
        const u = rr * Math.cos(a) * 1.6, v = rr * Math.sin(a);
        plot(cx + u * Math.cos(th) - v * Math.sin(th), cy + u * Math.sin(th) + v * Math.cos(th));
      }
    }
    return refOf(hist);
  }

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const c = e.target, sc = Conifer.createScene(c);
      const [W, H] = fitCanvas(c, 6e5);
      sc.resize(W, H); sc.setPalette(palette()); scenes.push(sc);
      const fn = THUMBS[c.dataset.kind];
      if (fn) sc.draw(fn);
    }
  }, { rootMargin: "120px" });
  document.querySelectorAll("canvas.mini").forEach(c => io.observe(c));
})();
