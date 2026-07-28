/* =========================================================================
   MOK — COFFEE & CHOCOLATE
   Stage 1: SECTION 2 "THE BREW" in isolation.

   HOW THE TIMING WORKS
   --------------------
   The master timeline has a total duration of exactly 1.0, so every
   position/duration number below IS the scroll progress value from the brief.
   `tl.to(x, {...}, 0.45)` starts at 45% of the pinned scroll distance. Nothing
   else needs converting — retune by editing PHASES and the tween positions.

   Add ?debug to the URL for a live progress + phase readout.
   ========================================================================= */

const { gsap } = window;
const { ScrollTrigger } = window;
/* If the CDN is unreachable the section must still be readable, so fall back
   to the same static exploded diagram that reduced-motion users get. */
const HAS_GSAP = !!(gsap && ScrollTrigger && window.MotionPathPlugin);
if (HAS_GSAP) gsap.registerPlugin(ScrollTrigger, window.MotionPathPlugin);

/* -------------------------------------------------------------------------
   1. TIMING — RETUNE HERE
   Each phase is [start, end] as scroll progress 0 → 1 across the pin.
   ------------------------------------------------------------------------- */
const PHASES = {
  EXPLODE:  [0.00, 0.20],  // layers separate into the technical stack
  LABELS:   [0.15, 0.30],  // connectors draw, labels stagger in
  ASSEMBLE: [0.30, 0.45],  // labels out; filter → dripper → glass seat together
  BLOOM:    [0.45, 0.60],  // kettle tilts, water spirals, CO2 burst, steam
  DRIP:     [0.60, 0.85],  // droplets fall, liquid rises, ice lifts
  REVEAL:   [0.85, 1.00],  // dripper/kettle away, glass up, chips + price
};

/* Scroll distance of the pin. 300vh desktop / 200vh mobile, per the brief. */
const SCROLL_VH = { desktop: 300, mobile: 200 };

/* Tunables that shape the diagram itself (not the timing). */
const TUNING = {
  gapDesktop: 34,          // px of clear air between stacked layers
  mobileGapFactor: 0.55,   // < 768px: separation cut by 45%
  sceneTiltDeg: 6,         // rotateX on the container during EXPLODE
  labelOffset: 148,        // px from the layer edge to the label, desktop
  labelOffsetMobile: 10,   // px below the layer for centred mobile captions
  /* Under 768px the captions sit *between* the layers, so the stack needs a
     reserve on top of the separation itself. This is deliberately a separate
     number from mobileGapFactor: the 45% cut applies to the separation, the
     reserve is the room two lines of caption need to not collide. */
  mobileCaptionReserve: 34,
  /* Desktop only: the label column all sits on one side, so the diagram is
     nudged toward inline-start to centre the whole composition. It slides back
     to true centre during ASSEMBLE, as the labels leave. */
  originShift: 164,
  labelStagger: 0.06,      // brief: 0.06 stagger between labels
  kettleTiltDeg: 35,       // BLOOM pour angle
  groundsBloomScale: 1.06, // 1.00 → 1.06
  dripRepeats: 3,          // droplet volleys inside the DRIP window
  liquidFrom: '#E8A33D',   // amber
  liquidTo:   '#D93B58',   // passion
};

/* Particle budgets. Halved on touch devices (see BUDGET below). */
const PARTICLES = { steam: 6, bubbles: 20, drips: 10 };

/* Cap devicePixelRatio at 2 — exposed for any future canvas/raster work and
   published as --dpr so CSS can branch on it. */
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 2);
document.documentElement.style.setProperty('--dpr', String(MAX_DPR));

const BREW_ORDER = ['kettle', 'grounds', 'filter', 'dripper', 'glass', 'fruit'];

/* -------------------------------------------------------------------------
   2. ENVIRONMENT
   ------------------------------------------------------------------------- */
const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const isMobile = () => window.innerWidth < 768;
const isTouch = () => window.matchMedia('(hover: none), (pointer: coarse)').matches;
const budget = (n) => (isTouch() ? Math.ceil(n / 2) : n);

/* RTL/LTR-agnostic: +1 means inline-end is to the right, -1 means to the left.
   Every horizontal offset below is multiplied by this, so the LTR toggle
   costs nothing later. */
const dirSign = () => (document.documentElement.dir === 'rtl' ? -1 : 1);

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const el = {
  section:    $('#brew'),
  pin:        $('.brew__pin'),
  stage:      $('[data-stage]'),
  scene:      $('[data-scene]'),
  connectors: $('[data-connectors]'),
  stream:     $('[data-stream]'),
  labelList:  $('[data-labels]'),
  labels:     $$('.lbl'),
  chips:      $$('.chip'),
  price:      $('[data-price]'),
  reveal:     $('[data-reveal]'),
  liquid:     $('[data-liquid]'),
  ice:        $$('.ice i'),
  hud:        $('[data-hud]'),
};
const layerEl = Object.fromEntries(
  BREW_ORDER.map((k) => [k, $(`.layer[data-layer="${k}"]`)])
);

/* -------------------------------------------------------------------------
   3. LAYOUT — where each layer sits, exploded and assembled.
   Recomputed on every (re)build so the diagram always fits the viewport.
   Coordinates are px offsets from the stage centre; +y is down, +x is right.
   ------------------------------------------------------------------------- */
function computeLayout() {
  const stageBox = el.stage.getBoundingClientRect();
  const mobile = isMobile();
  const gap = TUNING.gapDesktop * (mobile ? TUNING.mobileGapFactor : 1);

  const size = {};
  BREW_ORDER.forEach((k) => {
    const box = layerEl[k].querySelector('.ph').getBoundingClientRect();
    // getBoundingClientRect is post-transform; the scene is untransformed at
    // build time, so these are the intrinsic CSS sizes.
    size[k] = { w: box.width, h: box.height };
  });

  // captions live in the gaps on mobile, so they get their own allowance
  const slotGap = gap + (mobile ? TUNING.mobileCaptionReserve : 0);
  const stackH = BREW_ORDER.reduce((a, k) => a + size[k].h, 0) + slotGap * (BREW_ORDER.length - 1);

  /* If the stack is taller than the stage, shrink the whole scene rather than
     cramping the gaps — keeps the diagram proportions intact on short screens. */
  // mobile captions hang below their layer and are not scaled by `fit`, so the
  // bottom-most one needs headroom the scene itself does not use
  const avail = stageBox.height - (mobile ? 96 : 64);
  const fit = Math.min(1, avail / stackH);

  /* EXPLODE slots: cumulative top → bottom, centred on the stage. */
  const explode = {};
  let cursor = -stackH / 2;
  BREW_ORDER.forEach((k) => {
    explode[k] = { x: 0, y: cursor + size[k].h / 2 };
    cursor += size[k].h + slotGap;
  });

  /* ASSEMBLE targets: the built V60 sitting on the glass. */
  const d = dirSign();
  const originX = mobile ? 0 : -d * TUNING.originShift;
  const gY = stackH * 0.10; // finished glass sits a touch below centre
  const assemble = {
    glass:   { x: 0, y: gY, rot: 0 },
    dripper: { x: 0, y: gY - size.glass.h / 2 - size.dripper.h / 2 + size.dripper.h * 0.28, rot: 0 },
  };
  assemble.filter  = { x: 0, y: assemble.dripper.y - size.dripper.h * 0.10, rot: 0 };
  assemble.grounds = { x: 0, y: assemble.filter.y - size.filter.h * 0.06, rot: 0 };
  assemble.kettle  = {
    x: -d * (size.dripper.w * 0.48 + size.kettle.w * 0.40),
    y: assemble.dripper.y - size.dripper.h / 2 - size.kettle.h / 2 - (mobile ? 14 : 24),
    rot: 0,
  };
  assemble.fruit = {
    x: d * (size.glass.w * 0.58 + size.fruit.w * 0.56),
    y: gY + size.glass.h * 0.22,
    rot: 0,
  };

  /* Kettle tips its spout toward the dripper, whichever side it landed on. */
  const kettleTilt = (assemble.kettle.x > 0 ? -1 : 1) * TUNING.kettleTiltDeg;

  /* Droplet travel: dripper cone underside → down into the body of the glass.
     The dripper seats *into* the glass mouth, so measuring to the glass's top
     edge gives a negative distance — aim at 55% down the glass instead, and
     floor it so swapped-in artwork of any proportion still reads as a fall. */
  const dripDistance = Math.max(
    40,
    (assemble.glass.y - size.glass.h / 2 + size.glass.h * 0.55) -
    (assemble.dripper.y + size.dripper.h / 2)
  );

  return { stageBox, mobile, gap, slotGap, originX, size, stackH, fit,
           explode, assemble, kettleTilt, dripDistance };
}

/* -------------------------------------------------------------------------
   4. BUILD-TIME DOM: labels, connectors, stream path, particles

   COORDINATE RULE — the one thing to get right in here.
   The six layers live inside .brew__scene, which carries the fit-scale, so
   anything *inside* the scene (layer offsets, droplet travel, bubble radius,
   steam rise) uses raw design px and gets scaled for free. Labels,
   connectors, the stream SVG and the tasting chips sit *outside* the scene,
   so they convert through F() exactly once. Applying F() to a layer would
   scale it twice and pull the diagram apart from its own labels.
   ------------------------------------------------------------------------- */
const F = (L, v) => v * L.fit;

function placeLabels(L) {
  const d = dirSign();
  el.labels.forEach((lbl) => {
    const key = lbl.dataset.for;
    const slot = L.explode[key];
    if (L.mobile) {
      // < 768px: centred caption directly under its layer
      gsap.set(lbl, {
        x: 0,
        y: F(L, slot.y + L.size[key].h / 2) + TUNING.labelOffsetMobile,
        xPercent: -50,
        yPercent: 0,
      });
    } else {
      // desktop: side callout hanging off the far end of its connector.
      // xPercent parks the edge nearest the diagram on the anchor point so the
      // text always flows away from the stack, in either direction.
      gsap.set(lbl, {
        x: F(L, d * (L.size[key].w / 2 + TUNING.labelOffset)) + L.originX,
        y: F(L, slot.y),
        xPercent: d < 0 ? -100 : 0,
        yPercent: -50,
      });
    }
  });
}

/* Hairline connectors live in the same centred coordinate space as the
   layers (viewBox origin = stage centre), so the maths matches exactly. */
function buildConnectors(L) {
  const svg = el.connectors;
  svg.innerHTML = '';
  if (L.mobile) return [];

  const { width: w, height: h } = L.stageBox;
  svg.setAttribute('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`);

  const d = dirSign();
  const ns = 'http://www.w3.org/2000/svg';
  const lines = [];

  BREW_ORDER.forEach((key) => {
    const slot = L.explode[key];
    const y = F(L, slot.y);
    const x1 = F(L, d * (L.size[key].w / 2 + 10)) + L.originX;
    const x2 = F(L, d * (L.size[key].w / 2 + TUNING.labelOffset - 10)) + L.originX;

    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x1);
    dot.setAttribute('cy', y);
    dot.setAttribute('r', 2);
    svg.appendChild(dot);

    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y);
    svg.appendChild(line);

    const len = Math.abs(x2 - x1);
    gsap.set([line], { attr: { 'stroke-dasharray': len }, strokeDashoffset: len });
    gsap.set(dot, { scale: 0, transformOrigin: '50% 50%' });
    lines.push({ line, dot, len });
  });

  return lines;
}

/* Water stream: falls from the spout, then spirals inward over the grounds. */
function buildStream(L) {
  const svg = el.stream;
  svg.innerHTML = '';
  const { width: w, height: h } = L.stageBox;
  svg.setAttribute('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`);

  const ns = 'http://www.w3.org/2000/svg';
  const k = L.assemble.kettle;
  const g = L.assemble.grounds;

  // spout tip, roughly, once the kettle has tilted
  // BLOOM runs after ASSEMBLE has re-centred the scene, so these coordinates
  // assume scene x = 0 — unlike the connectors, which draw while it is offset.
  const spoutX = F(L, k.x + (k.x > 0 ? -1 : 1) * L.size.kettle.w * 0.42);
  const spoutY = F(L, k.y + L.size.kettle.h * 0.30);
  const cx = F(L, g.x);
  const cy = F(L, g.y);

  // the spiral reads against the mouth of the dripper, not the grounds bed
  const r0 = F(L, L.size.dripper.w * 0.33);
  const turns = 2.25;
  const steps = 64;

  let dAttr = `M ${spoutX.toFixed(1)} ${spoutY.toFixed(1)}`;
  // fall: one quadratic from the spout to the outer edge of the spiral
  const entryX = cx + r0;
  const entryY = cy;
  dAttr += ` Q ${((spoutX + entryX) / 2).toFixed(1)} ${(entryY - Math.abs(entryY - spoutY) * 0.15).toFixed(1)} ${entryX.toFixed(1)} ${entryY.toFixed(1)}`;
  // spiral: radius decays to ~15% over `turns`
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const r = r0 * (1 - 0.85 * t);
    dAttr += ` L ${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r * 0.34).toFixed(1)}`;
  }

  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', dAttr);
  svg.appendChild(path);

  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('class', 'pour-dot');
  dot.setAttribute('r', 3.5);
  svg.appendChild(dot);

  const len = path.getTotalLength();
  gsap.set(path, { attr: { 'stroke-dasharray': len }, strokeDashoffset: len });

  return { path, dot, len };
}

function buildParticles(L) {
  const mk = (host, n, cls) => {
    host.innerHTML = '';
    return Array.from({ length: n }, () => {
      const b = document.createElement('b');
      if (cls) b.className = cls;
      host.appendChild(b);
      return b;
    });
  };

  const steamHost = $('[data-steam]', layerEl.kettle);
  const steam = mk(steamHost, budget(PARTICLES.steam));
  steam.forEach((b, i) => {
    gsap.set(b, {
      left: `${18 + (i / Math.max(1, steam.length - 1)) * 64}%`,
      top: '-10%',
      xPercent: -50,
      opacity: 0,
    });
  });

  const bubbleHost = $('[data-bubbles]', layerEl.grounds);
  const bubbles = mk(bubbleHost, budget(PARTICLES.bubbles));
  gsap.set(bubbles, { xPercent: -50, yPercent: -50, opacity: 0, scale: 0 });

  const dripHost = $('[data-drips]', layerEl.dripper);
  const drips = mk(dripHost, budget(PARTICLES.drips));
  drips.forEach((b) => {
    gsap.set(b, {
      left: `${44 + Math.random() * 12}%`,
      bottom: 0,
      xPercent: -50,
      opacity: 0,
      y: 0,
    });
  });

  return { steam, bubbles, drips };
}

/* Chips fan out around the finished glass at REVEAL. */
function placeChips(L) {
  const d = dirSign();
  const spread = L.mobile ? 0.9 : 1;
  const spots = [
    { x: -d * 150, y: -110 },
    { x:  d * 158, y: -46 },
    { x: -d * 162, y:  30 },
    { x:  d * 146, y:  104 },
  ];
  el.chips.forEach((chip, i) => {
    const s = spots[i % spots.length];
    gsap.set(chip, {
      x: F(L, s.x * spread),
      y: F(L, s.y * spread),
      xPercent: -50,
      yPercent: -50,
    });
  });
}

/* -------------------------------------------------------------------------
   5. THE TIMELINE
   ------------------------------------------------------------------------- */
let ctx = null;          // gsap.Context — one call to revert() cleans everything
let lenis = null;

function buildBrew() {
  /* --- reduced motion (or no GSAP): static exploded diagram, no ScrollTrigger --- */
  if (mqReduce.matches || !HAS_GSAP) {
    renderStatic();
    return;
  }
  el.section.classList.remove('is-static');

  ctx = gsap.context(() => {
    const L = computeLayout();
    placeLabels(L);
    placeChips(L);
    const connectors = buildConnectors(L);
    const stream = buildStream(L);
    const P = buildParticles(L);

    /* ---- initial state: everything collapsed at the stage centre ---- */
    gsap.set(el.scene, { x: L.originX, rotateX: 0, scale: L.fit, transformOrigin: '50% 50%' });
    BREW_ORDER.forEach((k) => gsap.set(layerEl[k], {
      x: 0, y: 0, xPercent: -50, yPercent: -50, rotate: 0, scale: 1, opacity: 1,
    }));
    gsap.set(el.labels, { opacity: 0 });
    gsap.set(el.chips, { opacity: 0, scale: 0.8 });
    gsap.set(el.price, { opacity: 0, y: 14 });
    gsap.set(el.liquid, { clipPath: 'inset(100% 0 0 0)', backgroundColor: TUNING.liquidFrom });
    // ice cubes carry their own scatter offset; GSAP owns the transform so the
    // resting position has to come from JS too, not a CSS var
    el.ice.forEach((cube) => gsap.set(cube, {
      x: Number(cube.dataset.x), y: Number(cube.dataset.y), rotate: Number(cube.dataset.r),
    }));

    const scrollLen = L.mobile ? SCROLL_VH.mobile : SCROLL_VH.desktop;

    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: el.section,
        start: 'top top',
        end: `+=${scrollLen}%`,
        pin: el.pin,
        pinType: 'transform',      // iOS Safari: no position:fixed jitter
        pinSpacing: true,
        anticipatePin: 1,
        scrub: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => updateHud(self.progress),
      },
    });

    /* =====================================================================
       0.00 – 0.20  EXPLODE
       Layers separate top → bottom into the technical stack. The container
       takes a 6deg rotateX so the separation reads as depth.
       ===================================================================== */
    const [exA, exB] = PHASES.EXPLODE;
    tl.to(el.scene, {
      rotateX: TUNING.sceneTiltDeg,
      duration: exB - exA,
      ease: 'power2.out',
    }, exA);

    BREW_ORDER.forEach((k, i) => {
      tl.to(layerEl[k], {
        y: L.explode[k].y,
        x: 0,
        duration: (exB - exA) * 0.82,
        ease: 'power2.out',
        // top and bottom layers lead; the middle of the stack trails slightly
        }, exA + (exB - exA) * 0.18 * (i / (BREW_ORDER.length - 1)));
    });

    /* =====================================================================
       0.15 – 0.30  LABELS
       Connector hairlines draw outward, then each label fades + slides in
       on a 0.06 stagger. Desktop only for the lines; mobile gets captions.
       ===================================================================== */
    const [lbA, lbB] = PHASES.LABELS;
    const lbSpan = lbB - lbA;

    connectors.forEach((c, i) => {
      const at = lbA + i * TUNING.labelStagger * lbSpan * 0.9;
      tl.to(c.dot,  { scale: 1, duration: lbSpan * 0.10 }, at);
      tl.to(c.line, { strokeDashoffset: 0, duration: lbSpan * 0.34, ease: 'power2.out' }, at + lbSpan * 0.04);
    });

    el.labels.forEach((lbl, i) => {
      const at = lbA + lbSpan * 0.22 + i * TUNING.labelStagger * lbSpan * 0.9;
      // opacity on the <li>, travel on its spans: the <li>'s xPercent/yPercent
      // is the layout anchor from placeLabels() and must survive the tween
      tl.fromTo(lbl, { opacity: 0 }, { opacity: 1, duration: lbSpan * 0.30, ease: 'power2.out' }, at);
      tl.fromTo(lbl.children,
        { x: L.mobile ? 0 : dirSign() * 14, y: L.mobile ? 12 : 0 },
        { x: 0, y: 0, duration: lbSpan * 0.30, ease: 'power2.out' },
        at);
    });

    /* =====================================================================
       0.30 – 0.45  ASSEMBLE
       Labels fade out. Filter drops into the dripper, grounds settle into the
       filter with a small back.out bounce, dripper seats onto the glass.
       ===================================================================== */
    const [asA, asB] = PHASES.ASSEMBLE;
    const asSpan = asB - asA;

    tl.to(el.labels, { opacity: 0, duration: asSpan * 0.20, ease: 'power1.in' }, asA);
    if (connectors.length) {
      tl.to(connectors.map((c) => c.line), {
        strokeDashoffset: (i) => connectors[i].len,
        duration: asSpan * 0.24,
      }, asA);
      tl.to(connectors.map((c) => c.dot), { scale: 0, duration: asSpan * 0.16 }, asA);
    }
    // labels are on their way out, so the diagram slides back to true centre
    tl.to(el.scene, {
      rotateX: 0, x: 0,
      duration: asSpan * 0.75, ease: 'power2.inOut',
    }, asA + asSpan * 0.10);

    // glass slides to its final seat first — everything else lands on top of it
    tl.to(layerEl.glass, {
      x: L.assemble.glass.x, y: L.assemble.glass.y,
      duration: asSpan * 0.55, ease: 'power2.inOut',
    }, asA + asSpan * 0.10);

    // dripper seats onto the glass
    tl.to(layerEl.dripper, {
      x: L.assemble.dripper.x, y: L.assemble.dripper.y,
      duration: asSpan * 0.55, ease: 'power2.inOut',
    }, asA + asSpan * 0.18);

    // filter drops into the cone
    tl.to(layerEl.filter, {
      x: L.assemble.filter.x, y: L.assemble.filter.y,
      duration: asSpan * 0.42, ease: 'power2.in',
    }, asA + asSpan * 0.30);

    // grounds settle into the filter — tiny bounce
    tl.to(layerEl.grounds, {
      x: L.assemble.grounds.x, y: L.assemble.grounds.y,
      duration: asSpan * 0.46, ease: 'back.out(2.2)',
    }, asA + asSpan * 0.44);

    // kettle moves into pour position; fruit steps aside
    tl.to(layerEl.kettle, {
      x: L.assemble.kettle.x, y: L.assemble.kettle.y,
      duration: asSpan * 0.55, ease: 'power2.inOut',
    }, asA + asSpan * 0.28);

    tl.to(layerEl.fruit, {
      x: L.assemble.fruit.x, y: L.assemble.fruit.y, scale: 0.86,
      duration: asSpan * 0.50, ease: 'power2.inOut',
    }, asA + asSpan * 0.30);

    /* =====================================================================
       0.45 – 0.60  BLOOM
       Kettle tilts ~35deg, the stream draws along a spiral over the grounds,
       a pour dot rides the same path (MotionPath), grounds swell 1 → 1.06,
       CO2 bubbles burst radially, steam wisps rise.
       ===================================================================== */
    const [blA, blB] = PHASES.BLOOM;
    const blSpan = blB - blA;

    tl.to(layerEl.kettle, {
      rotate: L.kettleTilt,
      duration: blSpan * 0.28,
      ease: 'power2.inOut',
    }, blA);

    tl.to(stream.path, {
      strokeDashoffset: 0,
      duration: blSpan * 0.62,
      ease: 'power1.inOut',
    }, blA + blSpan * 0.16);

    tl.to(stream.dot, { opacity: 1, duration: blSpan * 0.06 }, blA + blSpan * 0.16);
    tl.to(stream.dot, {
      motionPath: { path: stream.path, align: stream.path, alignOrigin: [0.5, 0.5] },
      duration: blSpan * 0.62,
      ease: 'power1.inOut',
    }, blA + blSpan * 0.16);
    tl.to(stream.dot, { opacity: 0, duration: blSpan * 0.08 }, blA + blSpan * 0.78);

    tl.to(layerEl.grounds, {
      scale: TUNING.groundsBloomScale,
      duration: blSpan * 0.42,
      ease: 'power2.out',
    }, blA + blSpan * 0.32);

    // CO2 burst — radial, from the centre of the grounds bed
    P.bubbles.forEach((b, i) => {
      const a = (i / P.bubbles.length) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 30 + Math.random() * 52;
      tl.fromTo(b,
        { opacity: 0, scale: 0, x: 0, y: 0 },
        {
          opacity: 0.9, scale: gsap.utils.random(0.6, 1.3),
          x: Math.cos(a) * dist, y: Math.sin(a) * dist * 0.5,
          duration: blSpan * 0.30, ease: 'power2.out',
        },
        blA + blSpan * 0.34 + (i % 6) * blSpan * 0.03);
      tl.to(b, { opacity: 0, duration: blSpan * 0.20 }, blA + blSpan * 0.62 + (i % 6) * blSpan * 0.03);
    });

    // steam wisps
    P.steam.forEach((b, i) => {
      tl.fromTo(b,
        { opacity: 0, y: 0, scaleY: 0.7 },
        { opacity: 0.5, y: -70 - Math.random() * 40, scaleY: 1.25, duration: blSpan * 0.55, ease: 'power1.out' },
        blA + blSpan * 0.30 + i * blSpan * 0.05);
      tl.to(b, { opacity: 0, duration: blSpan * 0.22 }, blA + blSpan * 0.70 + i * blSpan * 0.05);
    });

    /* =====================================================================
       0.60 – 0.85  DRIP
       Droplets fall from the cone on a repeating stagger. The liquid rises
       via clip-path: inset() and its colour shifts amber → passion as it
       fills. Ice cubes nudge upward as the level comes up.
       ===================================================================== */
    const [drA, drB] = PHASES.DRIP;
    const drSpan = drB - drA;

    tl.to(stream.path, { opacity: 0, duration: drSpan * 0.08 }, drA);
    tl.to(layerEl.grounds, { scale: 1, duration: drSpan * 0.30, ease: 'power1.inOut' }, drA);

    // one droplet volley, looped `dripRepeats` times inside the DRIP window
    const cycle = drSpan / TUNING.dripRepeats;
    const dropTl = gsap.timeline({ repeat: TUNING.dripRepeats - 1 });
    P.drips.forEach((b, i) => {
      const at = (i / P.drips.length) * cycle * 0.82;
      dropTl.fromTo(b,
        { opacity: 0, y: 0, scaleY: 0.8 },
        { opacity: 1, duration: cycle * 0.06, ease: 'none' }, at);
      dropTl.to(b, {
        y: L.dripDistance, scaleY: 1.5,
        duration: cycle * 0.30, ease: 'power2.in',
      }, at);
      dropTl.to(b, { opacity: 0, duration: cycle * 0.06 }, at + cycle * 0.28);
    });
    dropTl.set({}, {}, cycle); // pin the cycle length so repeats tile exactly
    tl.add(dropTl, drA);

    // liquid rise + colour shift, driven together off one proxy
    const fill = { p: 0 };
    tl.to(fill, {
      p: 1,
      duration: drSpan * 0.94,
      ease: 'power1.inOut',
      onUpdate: () => {
        const pct = (1 - fill.p) * 100;
        el.liquid.style.clipPath = `inset(${pct.toFixed(2)}% 0 0 0)`;
        el.liquid.style.background =
          `linear-gradient(180deg, ${gsap.utils.interpolate(TUNING.liquidFrom, TUNING.liquidTo, fill.p)} 0%, ` +
          `${gsap.utils.interpolate(TUNING.liquidFrom, TUNING.liquidTo, Math.min(1, fill.p + 0.35))} 100%)`;
      },
    }, drA + drSpan * 0.04);

    // ice rides the rising level
    tl.to(el.ice, {
      y: '-=16',
      duration: drSpan * 0.80,
      ease: 'power1.inOut',
      stagger: drSpan * 0.05,
    }, drA + drSpan * 0.14);

    /* =====================================================================
       0.85 – 1.00  REVEAL
       Dripper and kettle lift away and fade. The finished glass scales up
       and centres. Tasting chips fly in around it. Price resolves last.
       ===================================================================== */
    const [rvA, rvB] = PHASES.REVEAL;
    const rvSpan = rvB - rvA;

    tl.to([layerEl.dripper, layerEl.filter, layerEl.grounds], {
      y: '-=120', opacity: 0,
      duration: rvSpan * 0.40, ease: 'power2.in',
    }, rvA);

    tl.to(layerEl.kettle, {
      y: '-=140', opacity: 0, rotate: L.kettleTilt * 0.4,
      duration: rvSpan * 0.40, ease: 'power2.in',
    }, rvA);

    tl.to(layerEl.fruit, {
      x: L.assemble.fruit.x * 1.25, opacity: 0.0,
      duration: rvSpan * 0.35, ease: 'power2.in',
    }, rvA);

    tl.to(layerEl.glass, {
      x: 0, y: 0, scale: L.mobile ? 1.10 : 1.22,
      duration: rvSpan * 0.55, ease: 'power2.out',
    }, rvA + rvSpan * 0.12);

    el.chips.forEach((chip, i) => {
      tl.fromTo(chip,
        { opacity: 0, scale: 0.8 },
        { opacity: 1, scale: 1, duration: rvSpan * 0.26, ease: 'back.out(1.8)' },
        rvA + rvSpan * 0.40 + i * rvSpan * 0.08);
    });

    // price resolves last
    tl.fromTo(el.price,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: rvSpan * 0.24, ease: 'power2.out' },
      rvA + rvSpan * 0.76);

    /* Lock the master timeline to exactly 1.0 so every position above reads
       as a raw scroll-progress value. */
    tl.set({}, {}, 1);
  }, el.section);
}

/* -------------------------------------------------------------------------
   6. REDUCED-MOTION FALLBACK
   Not a stub: the stack renders as a real static vertical exploded diagram
   in document flow, every label visible under its layer.
   ------------------------------------------------------------------------- */
function renderStatic() {
  el.section.classList.add('is-static');
  // re-parent each label under the layer it describes so the diagram reads
  // top-to-bottom with no absolute positioning at all
  el.labels.forEach((lbl) => {
    const host = layerEl[lbl.dataset.for];
    if (host && lbl.parentElement !== host) host.appendChild(lbl);
    lbl.style.removeProperty('--lx');
    lbl.style.removeProperty('--ly');
  });
  el.connectors.innerHTML = '';
  el.stream.innerHTML = '';
}

/* -------------------------------------------------------------------------
   7. SMOOTH SCROLL — desktop only. Under 768px native momentum wins.
   ------------------------------------------------------------------------- */
function initLenis() {
  if (lenis) { lenis.destroy(); lenis = null; }
  if (isMobile() || mqReduce.matches || !window.Lenis || !HAS_GSAP) return;

  lenis = new window.Lenis({ duration: 1.05, smoothWheel: true, syncTouch: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis && lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* -------------------------------------------------------------------------
   8. LIFECYCLE — kill + re-init on resize, debounced 250ms
   ------------------------------------------------------------------------- */
function teardown() {
  if (ctx) { ctx.revert(); ctx = null; }
  if (HAS_GSAP) ScrollTrigger.getAll().forEach((t) => t.kill());
}

function init() {
  teardown();
  initLenis();
  buildBrew();
  if (HAS_GSAP) ScrollTrigger.refresh();
}

let resizeTimer = null;
let lastW = window.innerWidth;
let lastH = window.innerHeight;

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Mobile browsers fire resize when the URL bar hides/shows. Rebuilding on
    // that causes visible jumps, so ignore height-only changes under ~140px.
    const widthChanged = w !== lastW;
    const bigHeightChange = Math.abs(h - lastH) > 140;
    lastW = w; lastH = h;
    if (widthChanged || bigHeightChange) init();
    else if (HAS_GSAP) ScrollTrigger.refresh();
  }, 250);
}, { passive: true });

// respond live if the user flips their reduced-motion preference
mqReduce.addEventListener('change', () => window.location.reload());

/* -------------------------------------------------------------------------
   9. DEV HUD — ?debug
   ------------------------------------------------------------------------- */
const HUD_ON = new URLSearchParams(location.search).has('debug');
function phaseAt(p) {
  const hit = Object.entries(PHASES).filter(([, [a, b]]) => p >= a && p <= b).map(([n]) => n);
  return hit.length ? hit.join(' + ') : '—';
}
function updateHud(p) {
  if (!HUD_ON || !el.hud) return;
  el.hud.innerHTML =
    `progress <b>${p.toFixed(3)}</b><br>phase <b>${phaseAt(p)}</b>` +
    `<span class="hud__bar"><i style="width:${(p * 100).toFixed(1)}%"></i></span>`;
}
if (HUD_ON && el.hud) { el.hud.hidden = false; updateHud(0); }

/* boot after fonts settle so measured sizes are final */
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(init);
} else {
  window.addEventListener('load', init);
}
