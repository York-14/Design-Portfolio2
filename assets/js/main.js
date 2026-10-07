(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- palette
  const PALETTES = {
    light: { bg: "#f2f0e9", stops: ["#f2f0e9", "#a9b2a6", "#3d4d43", "#121b16"] },
    dark:  { bg: "#0d1210", stops: ["#0d1210", "#34453b", "#9fb5a8", "#eef4ef"] },
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
  const hero = Conifer.createScene(canvas);
  hero.setPalette(palette());
  scenes.push(hero);
  let seed = 1 + Math.floor(Math.random() * 9000);
  let best = null;

  function heroTrees(W, H) {
    const chaos = +slider.value;
    const wide = W / H > 0.9;
    const main = {
      cx: W * (wide ? 0.68 : 0.64),
      cy: H * (wide ? 0.93 : 0.86),
      scale: H * (wide ? 0.8 : 0.6),
    };
    const px = W * H;
    best = Conifer.selectBest({ seed, chaos });
    const list = [];
    // 遠景の森：小さく、淡く、少し早く育つ
    const R = rng(seed * 31 + 7);
    const n = wide ? 8 : 5;
    const x0 = wide ? 0.4 : 0.02;                                  // 左側はコピーのために空ける
    const far = [];
    for (let i = 0; i < n; i++) far.push({ depth: R(), slot: (i + 0.2 + R() * 0.6) / n });
    far.sort((a, b) => a.depth - b.depth);                         // 遠いものから
    for (const { depth, slot } of far) {
      const k = 0.22 + 0.38 * depth;                               // 近いほど大きい
      list.push({
        opt: { seed: seed * 13 + Math.round(slot * 997), chaos, growTime: 4.2 + R() * 1.6, tiers: 20 },
        view: {
          cx: W * (x0 + (1.04 - x0) * slot), cy: main.cy - H * 0.05 * (1 - depth),
          scale: main.scale * k, rot: R() * 6.28, fog: 0.78 - 0.4 * depth,
        },
        weight: 0.8, budget: px * 0.5 * k * k * 2.2, delay: 0.1 + R() * 0.8,
      });
    }
    list.push({
      opt: { seed: best.seed, chaos },
      view: { ...main, rot: 0 },
      weight: 1, budget: px * 1.25, delay: 0,
    });
    return list;
  }

  function showReadout() {
    if (!best) return;
    const s = best.score, f = v => v.toFixed(2);
    readout.textContent = `No.${String(seed).padStart(4, "0")}  c=${f(+slider.value)}  ` +
      `O ${f(s.O)} × C ${f(s.C)} × K ${f(s.K)} = B ${f(s.B)}`;
  }

  function buildHero(animate) {
    const [W, H] = fitCanvas(canvas, 2.4e6);
    hero.resize(W, H);
    hero.setTrees(heroTrees(W, H));
    showReadout();
    if (animate && !reduceMotion) hero.grow(); else hero.instant();
  }

  $("#regrow").addEventListener("click", () => {
    seed = 1 + Math.floor(Math.random() * 9000);
    buildHero(true);
  });
  slider.addEventListener("change", () => buildHero(true));

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

  // ================================================================ works thumbnails
  function drawFlower(scene) {
    scene.draw((hist, W, H) => {
      const N = Conifer.IconChaos(7);
      const s = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2;
      const n = W * H * 3;
      for (let i = 0; i < n; i++) {
        const [x, y] = N.pair();
        const px = (cx + x * s) | 0, py = (cy - y * s) | 0;
        if (px >= 0 && py >= 0 && px < W && py < H) hist[py * W + px] += 1;
      }
      return 60;
    });
  }

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const c = e.target, sc = Conifer.createScene(c);
      const [W, H] = fitCanvas(c, 6e5);
      sc.resize(W, H); sc.setPalette(palette()); scenes.push(sc);
      if (c.dataset.kind === "flower") { drawFlower(sc); continue; }
      const chaos = +c.dataset.chaos, b = Conifer.selectBest({ seed: +c.dataset.seed, chaos }, 3);
      sc.setTrees([{ opt: { seed: b.seed, chaos }, view: { cx: W / 2, cy: H * 0.94, scale: H * 0.84 }, budget: W * H * 1.6 }]);
      if (reduceMotion) sc.instant(); else sc.grow();
    }
  }, { rootMargin: "120px" });
  document.querySelectorAll("canvas.mini").forEach(c => io.observe(c));
})();
