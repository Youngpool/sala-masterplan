/* SALA — Interactive master plan map engine (v2, GSAP)
   Built from Figma section 31:3900 "UI MASTER PLAN SECTION".
   Layouts:  data-mm="section" (website section)  ·  data-mm="page" (full-screen Masterplan page)
   Motion:   GSAP 3 (core) — camera tweens with inertia, cloud fly-through timeline,
             staggered marker reveals, drawn highlight strokes, road light runs.          */
(function () {
  'use strict';

  var D = window.SALA_DATA;
  var I = window.SALA_ICONS;
  var G = window.gsap;
  var IMG = 'assets/img/';
  var NS = 'http://www.w3.org/2000/svg';

  var CONFIG = {
    /* views: 'overview' (location map) → click the SALA pin → 'tod' (green TOD plan, still in
       "Bản đồ tổng quan" mode) · 'urban' (3D master map) · 'amenity' (top-view amenities) */
    mapOf: { overview: 'overview', tod: 'plan2d', urban: 'master3d', amenity: 'amenity' }
  };

  var MAPS = {
    overview: { w: 2030, h: 1471, bounds: [0, 183, 1647, 1471] },
    plan2d: { w: 2030, h: 1471, bounds: [0, 0, 2030, 1471] },
    master3d: { w: 1648, h: 920, bounds: [0, 0, 1648, 920] },
    amenity: { w: 2215, h: 1236, bounds: [0, 0, 2215, 1236] }
  };

  var LAYOUTS = {
    'section-desktop': { dw: 1360, dh: 680, cams: { overview: [793, 809, 1], plan2d: [1243, 527, 1], master3d: [855, 438, 1], amenity: [1237, 500, 1] } },
    'section-mobile': { dw: 390, dh: 680, cams: { overview: [798, 913, 0.609], plan2d: [1363, 396, 1], master3d: [676, 382, 1.1956], amenity: [1237, 500, 1] } },
    'page-desktop': { dw: 1440, dh: 810, cams: { overview: [792, 808.5, 1.405], plan2d: [1230, 503, 1], master3d: [886.4, 418.4, 1.289], amenity: [1224.7, 474.4, 1.288] } },
    'page-landscape': { dw: 932, dh: 430, cams: { overview: [776, 839, 0.7026], plan2d: [1279, 532, 0.6207], master3d: [789.5, 320.4, 0.9667], amenity: [1197, 455, 0.728] } }
  };

  /* ---------- helpers ---------- */
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  /* ---------- path lights: every road light fades to 0% at its head and its tail ----------
     A light is the road stroked in the light colour (soft glow + bright core), revealed only through a
     mask made of soft radial dots sitting at fixed points along the path. Each dot's opacity comes from a
     profile function of its arc position, so brightness is shaped *along the path*: it never starts or
     ends on a solid edge — not at the comet's head or tail, and not at the road's own start/end
     (every profile is multiplied by an end taper that is 0 at both ends of the road). */
  var LIGHT_N = 0;
  function cometGradDefs(id) {
    return '<radialGradient id="' + id + '"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fff" stop-opacity=".6"/>' +
      '<stop offset=".7" stop-color="#fff" stop-opacity=".15"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>';
  }
  function smooth(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
  function taper(s, L, E) { return smooth(s / E) * smooth((L - s) / E); }
  var PROFILES = {
    /* comet: soft head (gaussian ahead of the front) + long tail fading to 0 behind it */
    comet: function (s, L, st, o) {
      var x = st.front - s, v;
      if (x < 0) v = Math.exp(-(x * x) / (o.head * o.head));
      else if (x < o.tail) v = Math.pow(1 - x / o.tail, 1.7);
      else return 0;
      return v * taper(s, L, o.endFade);
    },
    /* band: the whole road lit, tapered at both ends; st.p wipes it on with a soft leading edge */
    band: function (s, L, st, o) {
      var W = L * 0.3, f = st.p * (L + W);
      return taper(s, L, L * o.bandFade) * smooth((f - s) / W);
    }
  };
  /* o: { grad, color, core, width, glowWidth, glowFilter, radius, spacing, profile, head, tail, endFade, bandFade } */
  function makeLight(svg, parent, d, o) {
    var id = 'mmLt' + (++LIGHT_N), defs = svg.querySelector('defs');
    var mask = svgEl('mask', { id: id, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse', x: -600, y: -600, width: 4200, height: 3400 });
    defs.appendChild(mask);
    var g = svgEl('g', { 'class': 'mm-comet', mask: 'url(#' + id + ')' });
    if (o.glowWidth) {
      var glow = svgEl('path', { 'class': 'mm-comet__glow', d: d, stroke: o.color, 'stroke-width': o.glowWidth });
      if (o.glowFilter) glow.setAttribute('filter', 'url(#' + o.glowFilter + ')');
      g.appendChild(glow);
    }
    var core = svgEl('path', { 'class': 'mm-comet__core', d: d, stroke: o.core || o.color, 'stroke-width': o.width });
    g.appendChild(core); parent.appendChild(g);
    var prof = PROFILES[o.profile || 'comet'];
    var lt = { g: g, path: core, dots: null, len: 0, st: { front: -1e9, p: 0, u: null } };
    function build() {
      var L = core.getTotalLength(); if (!L) return false;
      var sp = o.spacing || o.radius / 2.6, n = Math.max(2, Math.ceil(L / sp)), dots = [];
      for (var i = 0; i <= n; i++) {
        var s = L * i / n, q = core.getPointAtLength(s);
        var c = svgEl('circle', { cx: q.x.toFixed(1), cy: q.y.toFixed(1), r: o.radius, fill: 'url(#' + o.grad + ')', opacity: 0 });
        mask.appendChild(c); dots.push({ el: c, s: s, v: 0 });
      }
      lt.dots = dots; lt.len = L; return true;
    }
    lt.draw = function () {
      if (!lt.dots && !build()) return;
      var L = lt.len, ds = lt.dots;
      if (lt.st.u != null) lt.st.front = -2 * o.head + lt.st.u * (L + o.tail + 3 * o.head);
      for (var i = 0; i < ds.length; i++) {
        var v = prof(ds[i].s, L, lt.st, o);
        if (Math.abs(v - ds[i].v) > 0.004 || (v === 0 && ds[i].v !== 0)) { ds[i].v = v; ds[i].el.setAttribute('opacity', v.toFixed(3)); }
      }
    };
    /* comet runner: front travels from before the start until the whole tail has left the end */
    lt.run = function (dur, delay, gap) {
      lt.tween = G.fromTo(lt.st, { u: 0 }, { u: 1, duration: dur, ease: 'none', repeat: -1, repeatDelay: gap == null ? 1 : gap, delay: delay || 0, onUpdate: lt.draw });
      return lt;
    };
    /* one pass of the comet (e.g. around a building outline on hover) */
    lt.once = function (dur) {
      G.killTweensOf(lt.st); G.killTweensOf(g); G.set(g, { opacity: 1 });
      return G.fromTo(lt.st, { u: 0 }, { u: 1, duration: dur, ease: 'power1.inOut', onUpdate: lt.draw });
    };
    /* band: wipe on (p 0 → 1) / off */
    lt.show = function (dur, delay) { G.killTweensOf(lt.st); if (!delay) G.killTweensOf(g); G.to(g, { opacity: 1, duration: 0.2, overwrite: 'auto', delay: delay || 0 }); return G.fromTo(lt.st, { p: 0 }, { p: 1, duration: dur, ease: 'power2.inOut', delay: delay || 0, onUpdate: lt.draw }); };
    lt.hide = function (dur, delay) { return G.to(g, { opacity: 0, duration: dur || 0.4, delay: delay || 0, overwrite: 'auto' }); };
    lt.full = function () { lt.st.p = 1; lt.draw(); if (!lt.dots) requestAnimationFrame(lt.full); };
    return lt;
  }
  /* One road-light look for every map (overview + urban 3D): same colours, sizes and timing.
     S scales the sizes into the path's own units (3D roads are drawn at 1.289× and scaled down). */
  var ROAD_FX = {
    hl: { color: '#f4c46c', core: '#ffe7b0', width: 3.2, glowWidth: 18, radius: 26, spacing: 10, profile: 'band', bandFade: 0.14 },
    comet: { color: '#f0bd63', core: '#fff4d8', width: 3.4, glowWidth: 14, radius: 26, spacing: 10, profile: 'comet', head: 45, tail: 300, endFade: 140 }
  };
  var ROAD_FX_SIZE = ['width', 'glowWidth', 'radius', 'spacing', 'head', 'tail', 'endFade'];
  function roadLights(svg, g, d, S, grad, glowId, softId, dur, gap) {
    function cfg(base, filter) {
      var o = { grad: grad, glowFilter: filter };
      for (var k in base) o[k] = base[k];
      ROAD_FX_SIZE.forEach(function (k) { if (o[k] != null) o[k] *= S; });
      return o;
    }
    var hl = makeLight(svg, g, d, cfg(ROAD_FX.hl, glowId));
    G.set(hl.g, { opacity: 0 });
    var comet = makeLight(svg, g, d, cfg(ROAD_FX.comet, softId)).run(dur, G.utils.random(0, 2.5), gap == null ? 1 : gap);
    return { hl: hl, comet: comet };
  }
  /* where each display mode lives; the single-file test build overrides this with hash routes */
  var MODE_HREF = window.SALA_MODE_HREF || { section: 'index.html', page: 'masterplan.html' };
  function modeHref(mode, view) {
    var base = MODE_HREF[mode], v = view && view !== 'overview' ? 'view=' + view : '';
    if (!v) return base;
    return base.indexOf('#') >= 0 ? base + (base.length > 1 ? '&' : '') + v : base + '#' + v;
  }
  function icon(svg, cls) { return '<span class="svg-icon' + (cls ? ' ' + cls : '') + '">' + svg + '</span>'; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var HOVER = window.matchMedia && matchMedia('(hover: hover)').matches;
  function done(anim) { return new Promise(function (r) { if (!anim) return r(); anim.eventCallback('onComplete', r); anim.eventCallback('onInterrupt', r); }); }
  function sleep(sec) { return new Promise(function (r) { G.delayedCall(REDUCED ? 0 : sec, r); }); }
  if (REDUCED) G.globalTimeline.timeScale(20);
  G.defaults({ ease: 'power2.out', duration: 0.6 });

  /* reverse an absolute M/L/C path so text reads left → right */
  function reversePath(d) {
    var t = d.match(/[MLC]|-?\d*\.?\d+(?:e-?\d+)?/g), i = 0, cur = null, segs = [], cmd;
    function pt() { var p = [t[i], t[i + 1]]; i += 2; return p; }
    while (i < t.length) {
      if (/[MLC]/.test(t[i])) cmd = t[i++];
      if (cmd === 'M') { cur = pt(); }
      else if (cmd === 'L') { var p = pt(); segs.push(['L', cur, p]); cur = p; }
      else if (cmd === 'C') { var c1 = pt(), c2 = pt(), e = pt(); segs.push(['C', cur, c1, c2, e]); cur = e; }
    }
    var out = 'M ' + cur.join(' ');
    for (var j = segs.length - 1; j >= 0; j--) {
      var s = segs[j];
      out += s[0] === 'L' ? ' L ' + s[1].join(' ') : ' C ' + s[3].join(' ') + ' ' + s[2].join(' ') + ' ' + s[1].join(' ');
    }
    return out;
  }

  /* =======================================================
     Cloud layer — one WebGL layer above the maps (approach of explore.ownprimland.com):
     domain-warped fbm noise, lit from the top-left, drifting slowly.
     Uniforms driven by GSAP:
       density  0 → 1   coverage (0 = clear sky, 1 = solid cloud bank)
       scale    1 → n   feature size; growing it reads as flying into the clouds
       hole     0 → 2   radius of a clearing that opens from the centre ("mây tan")
       edge     0 → 1   ambient mode: keep clouds near the frame edges only
       alpha             global opacity                                          */
  var CLOUD_FS = [
    'precision highp float;',
    'uniform vec2 uRes; uniform float uTime, uDensity, uScale, uHole, uEdge, uAlpha; uniform vec2 uPan;',
    'float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }',
    'float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }',
    'const mat2 R = mat2(1.6, 1.2, -1.2, 1.6);',
    'float fbm5(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=R*p; a*=0.5; } return v; }',
    'float fbm3(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<3;i++){ v+=a*noise(p); p=R*p; a*=0.5; } return v; }',
    /* billowy cloud field: soft low-frequency warp keeps shapes round, not streaky */
    'float cloud(vec2 p, float t){',
    '  vec2 q = vec2(fbm3(p*0.55 + vec2(0.0, t*0.02)), fbm3(p*0.55 + vec2(3.7, 1.9) - t*0.015));',
    '  return fbm5(p + 0.65*q + vec2(t*0.01, 0.0)); }',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  float m = min(uRes.x, uRes.y);',
    '  vec2 c = (gl_FragCoord.xy - 0.5*uRes) / m;',
    '  float t = uTime;',
    '  float thr = mix(0.86, 0.12, uDensity);',
    /* near layer */
    '  vec2 p1 = c * 1.7 / uScale + uPan + vec2(t*0.012, t*0.004);',
    '  float n1 = cloud(p1, t);',
    '  float l1 = cloud(p1 + vec2(-0.09, 0.09), t);',
    '  float a1 = smoothstep(thr, thr + 0.24, n1);',
    '  float s1 = clamp(0.6 + (n1 - l1) * 4.5 + (n1 - thr) * 0.9, 0.0, 1.0);',
    /* far layer: bigger, slower, paler — gives depth */
    '  vec2 p2 = c * 1.05 / (0.6 + 0.4*uScale) + uPan*0.55 + vec2(19.3, 7.1) + vec2(t*0.006, t*0.002);',
    '  float n2 = fbm5(p2 + 0.5*fbm3(p2*0.6 + t*0.01));',
    '  float a2 = smoothstep(thr + 0.04, thr + 0.32, n2) * 0.75;',
    '  vec3 shadow = vec3(0.66, 0.70, 0.76), light = vec3(1.0, 0.992, 0.972);',
    '  vec3 c1 = mix(shadow, light, s1);',
    '  vec3 c2 = mix(vec3(0.80, 0.83, 0.87), vec3(0.97, 0.97, 0.96), clamp(0.5 + (n2 - thr) * 1.6, 0.0, 1.0));',
    '  float a = a1 + a2 * (1.0 - a1);',
    '  vec3 col = (c1 * a1 + c2 * a2 * (1.0 - a1)) / max(a, 1e-4);',
    '  float r = length((uv - 0.5) * vec2(1.0, 0.86)) * 2.0;',
    '  a *= mix(1.0, smoothstep(0.40, 1.25, r), uEdge);',
    '  float rc = length(c) * 1.4;',
    '  a *= smoothstep(uHole - 0.6, uHole + 0.05, rc + (n1 - 0.5) * 0.7);',
    '  a *= uAlpha;',
    '  gl_FragColor = vec4(col * a, a);',
    '}'
  ].join('\n');

  function CloudLayer(host) {
    var cv = this.canvas = el('canvas', 'mm-cloudgl');
    host.appendChild(cv);
    this.u = { density: 0, scale: 1, hole: 0, edge: 1, alpha: 1, panX: 0, panY: 0, time: G.utils.random(0, 200) };
    this.res = 0.5;
    var gl = this.gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    this.ok = !!gl;
    if (!gl) { cv.classList.add('is-fallback'); return; }
    function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, CLOUD_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { this.ok = false; cv.classList.add('is-fallback'); return; }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.loc = {};
    var self = this;
    ['uRes', 'uTime', 'uDensity', 'uScale', 'uHole', 'uEdge', 'uAlpha', 'uPan'].forEach(function (n) { self.loc[n] = gl.getUniformLocation(prog, n); });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.tick = this.render.bind(this);
    this.visible = true;
    G.ticker.add(this.tick);
  }
  CloudLayer.prototype.resize = function (w, h) {
    this.w = w; this.h = h;
    var k = this.res * Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(2, Math.round(w * k)); this.canvas.height = Math.max(2, Math.round(h * k));
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
  };
  CloudLayer.prototype.render = function (t, dt) {
    if (!this.ok || !this.visible) return;
    var u = this.u, gl = this.gl;
    u.time += (dt || 16) / 1000;
    if (u.alpha * u.density < 0.004) { if (!this._cleared) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); this._cleared = true; } return; }
    this._cleared = false;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.loc.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.loc.uTime, u.time);
    gl.uniform1f(this.loc.uDensity, u.density);
    gl.uniform1f(this.loc.uScale, u.scale);
    gl.uniform1f(this.loc.uHole, u.hole);
    gl.uniform1f(this.loc.uEdge, u.edge);
    gl.uniform1f(this.loc.uAlpha, u.alpha);
    gl.uniform2f(this.loc.uPan, u.panX, u.panY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  /* ambient cloud presets per map (edge-only drifting mist) */
  var AMBIENT = {
    overview: { density: 0.62, edge: 1, alpha: 0.9 },
    plan2d: { density: 0.55, edge: 1, alpha: 0.75 },
    master3d: { density: 0.66, edge: 1, alpha: 0.95 },
    amenity: { density: 0.6, edge: 1, alpha: 0.85 }
  };

  /* ======================================================= */
  function MasterMap(root) {
    this.root = root;
    this.mode = root.getAttribute('data-mm') === 'page' ? 'page' : 'section';
    this.view = 'overview';
    this.active = 'overview';
    this.busy = false;
    this.layers = {};
    this.markers = { overview: [], plan2d: [], master3d: [], amenity: [] };
    this.selection = null;
    this.hovered = null;
    this.padRight = 0;
    this.build();
    this.bind();
    this.measure();
    var self = this;
    Object.keys(MAPS).forEach(function (k) { self.layers[k].cam = self.defaultCam(k); self.apply(k); });
    G.set(this.layers.overview.el, { autoAlpha: 1 });
    this.layers.overview.el.classList.add('is-active');
    this.updateChrome();
    this.intro();
    /* arriving from the other display mode: continue on the same view */
    var want = (location.hash.match(/view=(tod|urban|amenity)/) || [])[1];
    if (want) G.delayedCall(0.5, function () { self.go(want); });
  }
  var P = MasterMap.prototype;

  /* ---------- DOM ---------- */
  P.build = function () {
    var root = this.root, self = this;
    root.classList.add(this.mode === 'page' ? 'mm-page' : 'mm-section');

    if (this.mode === 'section') {
      var head = el('div', 'mm-heading');
      this.titleEl = el('h2', 'mm-title');
      this.setTitle('overview', true);
      head.appendChild(this.titleEl);
      head.appendChild(el('p', 'mm-desc', esc(D.description)));
      root.appendChild(head);
      this.modeEl = el('div', 'mm-mode');
      this.modeEl.setAttribute('role', 'tablist');
      this.modeEl.innerHTML = '<span class="mm-mode__indicator"></span>' +
        '<button type="button" role="tab" data-go="overview">' + icon(I.location) + '<span>Bản đồ tổng quan</span></button>' +
        '<button type="button" role="tab" data-go="urban">' + icon(I.city) + '<span>Bản đồ khu đô thị</span></button>';
      root.appendChild(this.modeEl);
    }

    var frame = this.frame = el('div', 'mm-frame');
    root.appendChild(frame);
    var stage = this.stage = el('div', 'mm-stage');
    stage.setAttribute('aria-label', 'Bản đồ tương tác SALA');
    frame.appendChild(stage);

    Object.keys(MAPS).forEach(function (k) {
      var L = el('div', 'mm-layer');
      L.setAttribute('data-map', k);
      var canvas = el('div', 'mm-canvas');
      canvas.style.width = MAPS[k].w + 'px'; canvas.style.height = MAPS[k].h + 'px';
      var markers = el('div', 'mm-markers');
      L.appendChild(canvas); L.appendChild(markers);
      stage.appendChild(L);
      G.set(L, { autoAlpha: 0 });
      self.layers[k] = { el: L, canvas: canvas, markersEl: markers, cam: { s: 1, tx: 0, ty: 0 } };
    });
    this.buildOverview(); this.buildPlan(); this.buildMaster(); this.buildAmenity();

    /* clouds: a single WebGL layer above every map */
    var clouds = this.clouds = el('div', 'mm-clouds');
    frame.appendChild(clouds);
    this.cloud = new CloudLayer(clouds);
    this.veil = el('div', 'mm-clouds__veil');
    clouds.appendChild(this.veil);
    G.set(this.veil, { autoAlpha: 0 });
    Object.assign(this.cloud.u, AMBIENT.overview, { density: 0 });
    this.loader = el('div', 'mm-loader', '<img src="' + IMG + 'pattern-sala.png" alt="">');
    frame.appendChild(this.loader);
    G.set(this.loader, { autoAlpha: 0, scale: 0.6 });

    var ctr = this.controls = el('div', 'mm-controls');
    var light = this.mode === 'page' ? ' mm-ctrl--light' : '';
    ctr.innerHTML =
      '<div class="mm-ctrl"><button type="button" data-act="zin" aria-label="Phóng to">' + icon(I.plus) + '</button>' +
      '<button type="button" data-act="zout" aria-label="Thu nhỏ">' + icon(I.minus) + '</button></div>' +
      '<div class="mm-ctrl' + light + '" data-ctrl="reload"><button type="button" data-act="reload" aria-label="Tải lại bản đồ">' + icon(I.reload) + '</button></div>' +
      (this.mode === 'page' ? '<div class="mm-ctrl mm-ctrl--light"><button type="button" data-act="full" aria-label="Toàn màn hình">' + icon(I.expand) + '</button></div>' : '');
    /* display mode: one button in the control column — section: open the full Masterplan page;
       page: back to the section. The current view (TOD / urban / amenity) carries over. */
    /* demo-only switch: a swap icon (not a design control) + a tooltip saying it is just for the demo */
    var ICON_SWAP = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3.5 7h12M12.5 4l3 3-3 3M16.5 13h-12M7.5 10l-3 3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var toPage = this.mode === 'section', tipTxt = toPage ? 'Chuyển sang chế độ Page' : 'Chuyển về chế độ Section';
    var mb = el('div', 'mm-ctrl' + light + ' mm-ctrl--mode',
      '<button type="button" data-act="mode" aria-label="Demo: ' + tipTxt + '" aria-describedby="mmModeTip">' + ICON_SWAP + '</button>' +
      '<span class="mm-tip" id="mmModeTip" role="tooltip"><b>Demo</b>' + tipTxt + '</span>');
    mb.querySelector('button').addEventListener('click', function () { location.href = modeHref(toPage ? 'page' : 'section', self.view); });
    ctr.appendChild(mb);
    frame.appendChild(ctr);


    this.legend = el('div', 'mm-legend', '<img src="' + IMG + 'legend.jpg" alt="Chú thích bản đồ">');
    frame.appendChild(this.legend);

    if (this.mode === 'section') {
      var tabs = this.tabsEl = el('div', 'mm-tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.innerHTML = '<span class="mm-tabs__indicator"></span>' +
        '<button type="button" role="tab" data-go="urban">' + icon(I.city) + '<span>Khu đô thị</span></button>' +
        '<button type="button" role="tab" data-go="amenity">' + icon(I.pool) + '<span>Tiện ích</span></button>';
      frame.appendChild(tabs);
      G.set(tabs, { autoAlpha: 0, y: 14 });
    } else {
      var header = el('div', 'mm-header');
      header.innerHTML =
        '<div class="mm-header__logo"><img src="' + IMG + 'logo-sala.png" alt="Sala"></div>' +
        '<div class="mm-ptabs" role="tablist"><span class="mm-ptabs__indicator"></span>' +
        '<button type="button" role="tab" data-go="overview" aria-label="Tổng quan">' + icon(I.location) + '<span>Tổng quan</span></button>' +
        '<button type="button" role="tab" data-go="urban" aria-label="Khu đô thị">' + icon(I.city) + '<span>Khu đô thị</span></button>' +
        '<button type="button" role="tab" data-go="amenity" aria-label="Tiện ích">' + icon(I.pool) + '<span>Tiện ích</span></button></div>' +
        '<div class="mm-header__logo mm-header__logo--ghost" aria-hidden="true"><img src="' + IMG + 'logo-sala.png" alt=""></div>';
      frame.appendChild(header);
      this.ptabs = header.querySelector('.mm-ptabs');
      this.buildRotate();
    }

    /* hover card */
    this.card = el('div', 'mm-card');
    this.card.setAttribute('aria-hidden', 'true');
    frame.appendChild(this.card);
    G.set(this.card, { autoAlpha: 0 });

    this.backdrop = el('div', 'mm-backdrop');
    var panel = this.panel = el('aside', 'mm-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = '<div class="mm-panel__head"><span class="mm-panel__kind"></span>' +
      '<button type="button" class="mm-panel__close" aria-label="Đóng">' + icon(I.close) + '</button></div>' +
      '<div class="mm-panel__body"></div><div class="mm-panel__foot"></div>';
    if (this.mode === 'section') root.appendChild(this.backdrop);
    frame.appendChild(panel);
    this.hint = el('div', 'mm-hint');
    frame.appendChild(this.hint);
  };

  P.buildRotate = function () {
    var r = this.rotate = el('div', 'mm-rotate');
    r.innerHTML = '<div class="mm-rotate__top"><h2><span>Hãy xoay ngang</span>điện thoại</h2>' +
      '<div class="mm-rings"><div><div><img src="' + IMG + 'phone-rotate.png" alt=""></div></div></div>' +
      '<p><span>Để trải nghiệm tốt nhất</span>Sala Mastermap</p></div>' +
      '<button type="button" class="mm-btn">Đã hiểu</button>';
    document.body.appendChild(r);
    var ok = false;
    try { ok = sessionStorage.getItem('sala-rotate-ok') === '1'; } catch (e) { }
    if (!ok) r.classList.add('is-on');
    r.querySelector('.mm-btn').addEventListener('click', function () {
      G.to(r, { autoAlpha: 0, duration: 0.4, onComplete: function () { r.classList.remove('is-on'); G.set(r, { clearProps: 'all' }); } });
      try { sessionStorage.setItem('sala-rotate-ok', '1'); } catch (e) { }
    });
  };

  /* every marker sits in a wrapper that only receives the camera position (CSS translate);
     the marker itself stays free for GSAP transforms */
  P.addMarker = function (map, node, x, y, anchor) {
    var wrap = el('div', 'mm-mk');
    wrap.appendChild(node);
    this.layers[map].markersEl.appendChild(wrap);
    var m = { el: node, wrap: wrap, x: x, y: y, anchor: anchor || 'none', w: 0, h: 0 };
    this.markers[map].push(m);
    return m;
  };

  P.buildOverview = function () {
    var c = this.layers.overview.canvas, self = this;
    c.appendChild(el('div', 'mm-ov-bg'));
    c.appendChild(el('div', 'mm-ov-img', '<img src="' + IMG + 'map-tong.jpg" alt="Bản đồ vị trí Hệ sinh thái SALA" draggable="false">'));
    this.buildOverviewRoads(c);
    var z = D.overview.zone;
    var zone = this.salaZone = el('div', 'mm-zone mm-zone--sala', I.salaZone);
    zone.style.cssText = 'left:' + z.x + 'px;top:' + z.y + 'px;width:' + z.w + 'px;height:' + z.h + 'px';
    c.appendChild(zone);
    var pin = this.salaPin = el('button', 'mm-sala-pin');
    pin.type = 'button';
    pin.setAttribute('aria-label', 'Khám phá Khu đô thị Sala');
    pin.innerHTML = '<span class="mm-sala-pin__inner"><span class="mm-sala-pin__ring"></span><span class="mm-sala-pin__disc"><img src="' + IMG + 'pattern-sala.png" alt=""></span><span class="mm-sala-pin__tail">' + I.pinTail + '</span></span>';
    pin.addEventListener('click', function () { if (!self.suppress) self.go('tod'); });
    this.addMarker('overview', pin, D.overview.pin.x, D.overview.pin.y);
  };

  /* Overview: highlight layer over the brown arterial roads baked into map-tong.jpg.
     Idle: a soft gold light travels along each axis. Hover: the map dims, the road lights up
     (glow + bright core drawn on), and a name chip follows the pointer along the road. */
  P.buildOverviewRoads = function (c) {
    var self = this, W = MAPS.overview.w, H = MAPS.overview.h, R = D.overviewRoads || [];
    if (!R.length) return;
    var svg = this.ovSvg = svgEl('svg', { 'class': 'mm-ovroads', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
    svg.innerHTML = '<defs><filter id="mmOvGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>' +
      '<filter id="mmOvSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>' + cometGradDefs('mmCometGradO') + '</defs>';
    this.ovDim = svgEl('rect', { 'class': 'mm-ov-dim', x: 0, y: 183, width: 1647, height: 1288 });
    svg.appendChild(this.ovDim);
    G.set(this.ovDim, { opacity: 0 });
    this.ovRoads = {};
    R.forEach(function (rd) {
      var g = svgEl('g', { 'class': 'mm-ovroad' });
      /* hover / reveal highlight (whole road, tapered to 0 at both ends) + idle comet — shared ROAD_FX look */
      var fx = roadLights(svg, g, rd.d, 1, 'mmCometGradO', 'mmOvGlow', 'mmOvSoft', rd.dur, 1), hl = fx.hl, comet = fx.comet;
      var hit = svgEl('path', { 'class': 'mm-ovroad__hit', d: rd.d });
      g.appendChild(hit);
      svg.appendChild(g);
      var o = self.ovRoads[rd.id] = { rd: rd, g: g, hl: hl, comet: comet, hit: hit, pts: null };
      hit.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') { self.hoverOvRoad(rd.id, true, e); if (self.ovHover === rd.id) self.showRoadTag('overview', o, rd.name, false, e); } });
      hit.addEventListener('pointermove', function (e) { if (self.ovHover === rd.id && e.pointerType !== 'touch') self.showRoadTag('overview', o, rd.name, false, e); });
      hit.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') self.hoverOvRoad(rd.id, false); });
      /* touch: tap a road to light it up, tap again (or elsewhere) to clear */
      hit.addEventListener('click', function (e) {
        if (self.suppress) return;
        if (self.ovHover === rd.id && e.pointerType === 'touch') return self.hoverOvRoad(rd.id, false);
        self.hoverOvRoad(rd.id, true, e);
        if (self.ovHover === rd.id) self.showRoadTag('overview', o, rd.name, false, e);
      });
    });
    c.appendChild(svg);
    this.makeRoadTag('overview');
  };

  /* nearest point on a road (in map space) to a client-space pointer; the path is sampled once, lazily.
     getCTM() maps the path's own units (e.g. the 1.289× 3D road groups) into map space. */
  P.roadNearest = function (map, o, e) {
    if (!o.pts) {
      var p = o.hit, L = p.getTotalLength(), n = Math.ceil(L / 6), M = p.getCTM(), pts = [];
      for (var i = 0; i <= n; i++) { var q = p.getPointAtLength(L * i / n); pts.push([M.a * q.x + M.c * q.y + M.e, M.b * q.x + M.d * q.y + M.f]); }
      o.pts = pts;
    }
    var cam = this.layers[map].cam, rect = this.layers[map].canvas.getBoundingClientRect();
    var mx = (e.clientX - rect.left) / cam.s, my = (e.clientY - rect.top) / cam.s, best = o.pts[0], bd = Infinity;
    for (var j = 0; j < o.pts.length; j++) {
      var dx = o.pts[j][0] - mx, dy = o.pts[j][1] - my, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = o.pts[j]; }
    }
    return best;
  };
  /* road name on hover: the Figma road-label (pill + leader + dot) pops up where the pointer is on the road */
  P.makeRoadTag = function (map) {
    var n = el('div', 'mm-road mm-road--up mm-road--tag', '<span class="mm-road__pill"></span><span class="mm-road__line"></span><span class="mm-road__dot"></span>');
    n._len = 40;
    var m = this.addMarker(map, n, 0, 0, 'road-up');
    G.set(n, { autoAlpha: 0 });
    (this.tags = this.tags || {})[map] = { n: n, m: m, pill: n.querySelector('.mm-road__pill'), on: false, name: '' };
  };
  P.showRoadTag = function (map, o, name, gold, e) {
    var t = this.tags && this.tags[map];
    if (!t || !e || e.clientX == null) return;
    if (t.name !== name) { t.name = name; t.pill.textContent = name; t.m.w = 0; }
    t.n.classList.add('mm-road--gold');   /* hover label is always the gold Figma pill */
    var pt = this.roadNearest(map, o, e), cam = this.layers[map].cam;
    /* near the top of the frame the label hangs below the road instead of above it */
    var down = pt[1] * cam.s + cam.ty < 110;
    if (down !== !!t.down) { t.down = down; t.n.classList.toggle('mm-road--up', !down); t.n.classList.toggle('mm-road--down', down); t.m.anchor = down ? 'road-down' : 'road-up'; }
    t.m.x = pt[0]; t.m.y = pt[1];
    this.apply(map);
    if (!t.on) { t.on = true; G.fromTo(t.n, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'back.out(1.6)', overwrite: true }); }
  };
  P.hideRoadTag = function (map) {
    var t = this.tags && this.tags[map];
    if (!t || !t.on) return;
    t.on = false;
    G.to(t.n, { autoAlpha: 0, y: 4, duration: 0.25, overwrite: true });
  };

  P.hoverOvRoad = function (id, on, e) {
    if (on && (this.active !== 'overview' || this.busy)) return;
    var self = this, o = this.ovRoads && this.ovRoads[id];
    if (!o) return;
    if (on && this.ovHover && this.ovHover !== id) this.hoverOvRoad(this.ovHover, false);
    this.ovHover = on ? id : null;
    Object.keys(this.ovRoads).forEach(function (k) {
      var r = self.ovRoads[k];
      G.to(r.comet.g, { opacity: on && k !== id ? 0.15 : 1, duration: 0.4, overwrite: 'auto' });
    });
    o.g.classList.toggle('is-hover', on);
    G.to(this.ovDim, { opacity: on ? 1 : 0, duration: 0.5, ease: 'power2.out', overwrite: true });
    if (on) o.hl.show(1.1);
    else { o.hl.hide(0.4); this.hideRoadTag('overview'); }
  };

  /* TOD plan: the four Figma layers stacked (base, arrows 5.4, transit icons 5.3, routes 5.2) */
  P.buildPlan = function () {
    var c = this.layers.plan2d.canvas;
    var img = el('img', 'mm-base'); img.src = IMG + 'map-sala-2d.jpg'; img.alt = 'Bản đồ kết nối TOD khu đô thị Sala'; img.draggable = false;
    c.appendChild(img);
    this.planLayers = ['plan-arrows', 'plan-icons', 'plan-routes'].map(function (n) {
      var o = el('img', 'mm-base mm-plan-layer mm-plan-layer--' + n.split('-')[1]); o.src = IMG + n + '.webp'; o.alt = ''; o.draggable = false;
      c.appendChild(o); return o;
    });
  };

  P.buildMaster = function () {
    var self = this, L = this.layers.master3d, c = L.canvas, W = MAPS.master3d.w, H = MAPS.master3d.h;
    /* Figma "Map" 49:7667 — depth: a muted, darker, top-blurred base image with the SALA core
       shown on top in full colour and full sharpness through a soft (85px-blurred) focus mask */
    var img = el('img', 'mm-base mm-3d-base'); img.src = IMG + 'map-3d.jpg'; img.alt = 'Phối cảnh tổng thể Khu đô thị Sala'; img.draggable = false;
    c.appendChild(img);
    /* progressive layer blur ~5.7px at the top fading out by 56% height (depth of field) */
    var dof = el('img', 'mm-base mm-3d-base mm-dof'); dof.src = IMG + 'map-3d.jpg'; dof.alt = ''; dof.draggable = false;
    c.appendChild(dof);
    c.appendChild(el('div', 'mm-3d-dim'));
    var focus = el('img', 'mm-base mm-3d-focus'); focus.src = IMG + 'map-3d.jpg'; focus.alt = ''; focus.draggable = false;
    c.appendChild(focus);
    c.appendChild(el('div', 'mm-softlight'));

    /* ---- one SVG in map space: spotlight, project zones, roads ---- */
    var svg = this.mSvg = svgEl('svg', { 'class': 'mm-msvg', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
    var defs = '<defs>' +
      /* Figma material (Vector 2392): fill #BC8E49→#564121 @60%, stroke #E1CFA6→transparent */
      '<linearGradient id="mmZoneFill" x1="0.5" y1="0" x2="0.5" y2="1"><stop stop-color="#BC8E49"/><stop offset="1" stop-color="#564121"/></linearGradient>' +
      '<linearGradient id="mmZoneStroke" x1="0.68" y1="0.28" x2="0.46" y2="0.97"><stop stop-color="#E1CFA6"/><stop offset="1" stop-color="#7B715B" stop-opacity="0"/></linearGradient>' +
      '<filter id="mmGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5"/></filter>' + cometGradDefs('mmCometGradM') +
      /* road light filters, sized to match the overview's on screen (roads are scaled by 1/1.289) */
      '<filter id="mmRdGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6.45"/></filter>' +
      '<filter id="mmRdSoft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.87"/></filter>' +
      '<mask id="mmSpotMask" maskUnits="userSpaceOnUse" x="0" y="0" width="' + W + '" height="' + H + '"><rect width="' + W + '" height="' + H + '" fill="#fff"/><path class="mm-spot-hole" d="" fill="#000"/></mask>';
    D.lights.forEach(function (ln) {
      defs += '<linearGradient id="mmL_' + ln.id + '" x1="0" y1="0" x2="' + ln.w + '" y2="0" gradientUnits="userSpaceOnUse">' +
        '<stop stop-color="' + ln.color + '" stop-opacity="0"/><stop offset=".5" stop-color="' + ln.color + '"/><stop offset="1" stop-color="' + ln.color + '" stop-opacity="0"/></linearGradient>';
    });
    svg.innerHTML = defs + '</defs>';
    this.spot = svgEl('rect', { 'class': 'mm-spot', width: W, height: H, mask: 'url(#mmSpotMask)' });
    svg.appendChild(this.spot);
    this.spotHole = svg.querySelector('.mm-spot-hole');
    G.set(this.spot, { opacity: 0 });

    /* roads — same logic as the overview: hover dims the map, lights the road, fades the other comets */
    this.rdDim = svgEl('rect', { 'class': 'mm-ov-dim', width: W, height: H });
    svg.appendChild(this.rdDim);
    G.set(this.rdDim, { opacity: 0 });
    var gRoads = svgEl('g', { 'class': 'mm-roads' });
    svg.appendChild(gRoads);
    var K = 1 / 1.289;
    this.roads = {};
    D.lights.forEach(function (ln) {
      var g = svgEl('g', { 'class': 'mm-road-g' + (ln.gold ? ' is-gold' : ''), transform: 'scale(' + K.toFixed(5) + ') translate(' + ln.ox + ' ' + ln.oy + ')' });
      /* static road line: tapered to 0% at both ends of the road */
      /* idle: no road line at all (0%) — only the running comet; the bold Figma stroke is the hover state */
      var base = null;
      /* hover highlight + idle comet: the same ROAD_FX as the overview roads */
      var fx = roadLights(svg, g, ln.d, 1.289, 'mmCometGradM', 'mmRdGlow', 'mmRdSoft', ln.dur, 1), hl = fx.hl, comet = fx.comet;
      var hit = svgEl('path', { 'class': 'mm-road-hit', d: ln.d });
      g.appendChild(hit);
      var tp = null, text = null, tpath = null;   /* no road names along the roads: not in the design */
      gRoads.appendChild(g);
      var road = { ln: ln, g: g, base: base, comet: comet, hl: hl, hit: hit, text: text, tpath: tpath, tp: tp };
      self.roads[ln.id] = road;
      /* road name pops up only on hover (both modes, same as the overview) */
      function tag(e) { if (self.rdHover === ln.id) self.showRoadTag('master3d', road, ln.name, ln.gold, e); }
      hit.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') { self.hoverRoad(ln.id, true); tag(e); } });
      hit.addEventListener('pointermove', function (e) { if (e.pointerType !== 'touch') tag(e); });
      hit.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') self.hoverRoad(ln.id, false); });
      /* touch: tap a road to light it up, tap again to clear (same as the overview) */
      hit.addEventListener('click', function (e) {
        if (self.suppress) return;
        if (self.rdHover === ln.id && e.pointerType === 'touch') return self.hoverRoad(ln.id, false);
        self.hoverRoad(ln.id, true); tag(e);
      });
    });

    /* project zones */
    var gZones = svgEl('g', { 'class': 'mm-zones' });
    svg.appendChild(gZones);
    /* building outlines drawn in Figma (43:7639): each keeps its own fill / stroke gradient */
    var zDefs = svg.querySelector('defs');
    function grad(id, xy, stops) {
      var lg = svgEl('linearGradient', { id: id, gradientUnits: 'userSpaceOnUse', x1: xy[0], y1: xy[1], x2: xy[2], y2: xy[3] });
      stops.forEach(function (st) { lg.appendChild(svgEl('stop', { offset: st[0], 'stop-color': st[1], 'stop-opacity': st[2] == null ? 1 : st[2] })); });
      zDefs.appendChild(lg);
    }
    D.projects.forEach(function (p) {
      var zs = (D.projectZones || {})[p.id];
      if (!zs || !zs.length) return;
      var g = svgEl('g', { 'class': 'mm-zone-g' }), fx = [], ds = [];
      /* Figma 57:7825: the building itself, cut from the dusk render (lights on) by its outline */
      var cid = 'mmZC_' + p.id, clip = svgEl('clipPath', { id: cid });
      zs.forEach(function (z) { clip.appendChild(svgEl('path', { d: z.d })); });
      zDefs.appendChild(clip);
      var lit = svgEl('image', { 'class': 'mm-zone-lit', href: IMG + 'map-3d-dusk.jpg', x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none', 'clip-path': 'url(#' + cid + ')' });
      lit.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', IMG + 'map-3d-dusk.jpg');
      g.appendChild(lit); fx.push(lit);
      zs.forEach(function (z, i) {
        var fid = 'mmZF_' + p.id + '_' + i, sid = 'mmZS_' + p.id + '_' + i;
        grad(fid, z.fill, z.fillStops); grad(sid, z.stroke, z.strokeStops);
        var fill = svgEl('path', { 'class': 'mm-zone-fill', d: z.d, fill: 'url(#' + fid + ')' });
        var line = svgEl('path', { 'class': 'mm-zone-line', d: z.d, stroke: 'url(#' + sid + ')', 'stroke-width': Math.max(1, z.sw * 1.6).toFixed(2) });
        g.appendChild(fill); g.appendChild(line); fx.push(fill, line); ds.push(z.d);
      });
      var d = ds.join(' ');
      gZones.appendChild(g);
      /* hover: a soft comet runs once around the outline (0% at head and tail) */
      var trace = makeLight(svg, g, d, { grad: 'mmCometGradM', color: '#ffd98f', core: '#fff8ea', width: 1.8, glowWidth: 6, glowFilter: 'mmGlow', radius: 9, spacing: 3.5, profile: 'comet', head: 16, tail: 260, endFade: 6 });
      G.set(trace.g, { opacity: 0 });
      G.set(fx, { opacity: 0 });
      p._zone = { g: g, fx: fx, trace: trace, d: d, tr: '' };
      g.addEventListener('pointerenter', function () { self.hoverProject(p, true); });
      g.addEventListener('pointerleave', function () { self.hoverProject(p, false); });
      g.addEventListener('click', function () { if (!self.suppress) self.select('project', p); });
    });
    c.appendChild(svg);

    /* bridge / road labels (page: designer pills; section: bridges only as compact markers) */
    D.roads.forEach(function (r) {
      if (r.hidden) return;
      /* bridges: one node per bridge — a dot with its name badge right beside it (no leader line).
         Off-screen, the dot waits on the frame edge with the badge on the inner side; as the bridge comes
         into the frame the same dot travels onto it and the badge stays next to it (see updateEdges). */
      if (r.bridge) {
        var e = el('div', 'mm-edge', '<span class="mm-edge__dot"></span><button type="button" class="mm-edge__pill">' + esc(r.name) + '</button>');
        var pulse = function () { var d = e.querySelector('.mm-edge__dot'); G.fromTo(d, { boxShadow: '0 0 0 2px rgba(122,122,122,.9), 0 0 0 0 rgba(255,254,242,.7)' }, { boxShadow: '0 0 0 2px rgba(122,122,122,.9), 0 0 0 18px rgba(255,254,242,0)', duration: 0.9, ease: 'power2.out' }); };
        e.querySelector('.mm-edge__pill').addEventListener('pointerenter', pulse);
        e.querySelector('.mm-edge__pill').addEventListener('click', function () {
          if (self.busy) return;
          var it = (self.edgeEls || []).filter(function (q) { return q.el === e; })[0];
          if (it && !it.off) return pulse();
          var cam = self.layers.master3d.cam;
          self.animateCam('master3d', self.clampCam('master3d', self.camAround('master3d', r.x, r.y + 60, cam.s)), 1.1, 'power2.inOut');
          G.delayedCall(1.1, pulse);
        });
        self.layers.master3d.markersEl.appendChild(e);   /* same stacking layer as labels, so the hover road name can sit above it */
        (self.edgeEls = self.edgeEls || []).push({ el: e, r: r, on: false, side: null });
        return;
      }
      /* streets: no permanent label — like the overview, the name only pops up while the road is hovered */
    });

    this.makeRoadTag('master3d');

    D.projects.forEach(function (p) {
      var b = el('button', 'mm-proj mm-proj--' + p.side);
      b.type = 'button';
      b.setAttribute('aria-label', p.name);
      b.innerHTML = '<span class="mm-proj__line"></span><span class="mm-proj__tag">' + esc(p.name) + '</span>';
      b.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') self.hoverProject(p, true); });
      b.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') self.hoverProject(p, false); });
      b.addEventListener('focus', function () { self.hoverProject(p, true); });
      b.addEventListener('blur', function () { self.hoverProject(p, false); });
      b.addEventListener('click', function () { if (!self.suppress) self.select('project', p); });
      p._el = b;
      self.addMarker('master3d', b, p.x, p.y, 'proj-' + p.side);
    });
  };

  P.buildAmenity = function () {
    var self = this, c = this.layers.amenity.canvas;
    var img = el('img', 'mm-base mm-topview'); img.src = IMG + 'map-topview.jpg'; img.alt = 'Bản đồ tiện ích Khu đô thị Sala'; img.draggable = false;
    c.appendChild(img);
    c.appendChild(el('div', 'mm-shade'));
    c.appendChild(el('div', 'mm-softlight'));
    D.amenities.forEach(function (a) {
      var b = el('button', 'mm-pin' + (a.featured ? ' mm-pin--featured' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', a.name);
      b.innerHTML = '<span class="mm-pin__pulse"></span>' + icon(I.amenity[a.icon]) +
        '';
      b.addEventListener('click', function () { if (!self.suppress) self.select('amenity', a); });
      a._el = b;
      self.addMarker('amenity', b, a.x, a.y);
    });
  };

  /* ---------- layout & camera ---------- */
  P.layoutName = function () {
    var w = this.fw, h = this.fh;
    if (this.mode === 'section') return w < 760 ? 'section-mobile' : 'section-desktop';
    if (h <= 500 && w > h) return 'page-landscape';
    if (w < 760) return 'section-mobile';
    return 'page-desktop';
  };

  P.measure = function () {
    var r = this.stage.getBoundingClientRect();
    this.fw = r.width || this.frame.clientWidth;
    this.fh = r.height || this.frame.clientHeight;
    this.layout = this.layoutName();
    this.mobile = this.layout === 'section-mobile' || this.layout === 'page-landscape';
    this.root.setAttribute('data-layout', this.layout);
    this.cloud.resize(this.fw, this.fh);
    var ls = this.lineScale = (this.layout === 'section-desktop' || this.layout === 'page-desktop') ? 1 : 0.72;
    var self = this;
    Object.keys(this.markers).forEach(function (k2) { self.markers[k2].forEach(function (m) { m.w = 0; }); });
    this.root.querySelectorAll('.mm-proj').forEach(function (n) { n.style.height = Math.round(120 * ls) + 'px'; });
    this.root.querySelectorAll('.mm-road').forEach(function (n) {
      var line = n.querySelector('.mm-road__line'), len = Math.round(n._len * ls);
      if (n.classList.contains('mm-road--left') || n.classList.contains('mm-road--right')) line.style.width = len + 'px';
      else line.style.height = len + 'px';
    });
    this.placeRoadNames();
  };

  /* put each road name at the point of its path nearest to the designer's label anchor */
  P.placeRoadNames = function () {
    return;
    var self = this;
    if (this._namesPlaced) return;
    Object.keys(this.roads || {}).forEach(function (id) {
      var r = self.roads[id], ln = r.ln, path = r.tp;
      var len; try { len = path.getTotalLength(); } catch (e) { return; }
      if (!len) return;
      var tx = ln.textAt[0] * 1.289 - ln.ox, ty = ln.textAt[1] * 1.289 - ln.oy, best = 0, bd = Infinity;
      for (var i = 0; i <= 240; i++) {
        var pt = path.getPointAtLength(len * i / 240), d = (pt.x - tx) * (pt.x - tx) + (pt.y - ty) * (pt.y - ty);
        if (d < bd) { bd = d; best = i / 240; }
      }
      r.tpath.setAttribute('startOffset', (best * 100).toFixed(1) + '%');
      self._namesPlaced = true;
    });
  };

  P.panelIsOverlay = function () { return this.mobile || this.fw < 900; };

  P.defaultCam = function (map) {
    var L = LAYOUTS[this.layout], c = L.cams[map];
    var k = Math.max(this.fw / L.dw, this.fh / L.dh), s = c[2] * k;
    this.layers[map].sDefault = s;
    return this.clampCam(map, { s: s, tx: this.fw / 2 - c[0] * s, ty: this.fh / 2 - c[1] * s });
  };

  P.clampCam = function (map, cam) {
    var b = MAPS[map].bounds, bw = b[2] - b[0], bh = b[3] - b[1];
    var fw = this.fw, fh = this.fh, pad = this.padRight;
    var minS = Math.max(fw / bw, fh / bh), sDef = this.layers[map].sDefault || minS;
    var s = clamp(cam.s, minS, Math.max(sDef * 3.5, minS * 1.5));
    var minTx = fw - pad - b[2] * s, maxTx = -b[0] * s;
    if (minTx > maxTx) minTx = maxTx = (fw - pad - (b[0] + b[2]) * s) / 2;
    var minTy = fh - b[3] * s, maxTy = -b[1] * s;
    if (minTy > maxTy) minTy = maxTy = (fh - (b[1] + b[3]) * s) / 2;
    return { s: s, tx: clamp(cam.tx, minTx, maxTx), ty: clamp(cam.ty, minTy, maxTy) };
  };

  P.apply = function (map) {
    var L = this.layers[map], c = L.cam;
    L.canvas.style.transform = 'translate3d(' + c.tx + 'px,' + c.ty + 'px,0) scale(' + c.s + ')';
    var ms = this.markers[map];
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i], x = m.x * c.s + c.tx, y = m.y * c.s + c.ty, ox = 0, oy = 0;
      if (m.anchor !== 'none') {
        if (!m.w) { m.w = m.el.offsetWidth; m.h = m.el.offsetHeight; }
        switch (m.anchor) {
          case 'proj-right': ox = -1; oy = -m.h; break;
          case 'proj-left': ox = -m.w + 1; oy = -m.h; break;
          case 'road-up': ox = -m.w / 2; oy = -m.h; break;
          case 'road-down': ox = -m.w / 2; oy = 0; break;
          case 'road-left': ox = -m.w; oy = -m.h / 2; break;
          case 'road-right': ox = 0; oy = -m.h / 2; break;
        }
      }
      /* `translate` positions the marker; GSAP keeps `transform` free for its own motion */
      m.wrap.style.translate = Math.round(x + ox) + 'px ' + Math.round(y + oy) + 'px';
    }
    if (this.hovered && map === this.active) this.placeCard();
    if (map === 'master3d') this.updateEdges();
    /* clouds sit above the map: they follow the camera at 60% speed (parallax) */
    if (map === this.active && this.cloud && !this.busy) {
      var cc = this.centerOf(map, c), mm = Math.min(this.fw, this.fh) || 1;
      this.cloud.u.panX = cc[0] * c.s / mm * 2.4 * 0.6;
      this.cloud.u.panY = -cc[1] * c.s / mm * 2.4 * 0.6;
    }
  };

  /* bridge nodes that are outside the frame are pinned to the frame edge (with a direction arrow) */
  P.updateEdges = function () {
    if (!this.edgeEls) return;
    var c = this.layers.master3d.cam, show = this.active === 'master3d';
    var L = 22, T = 22, R = this.fw - 22 - (this.padRight || 0), B = this.fh - (this.mode === 'section' ? 96 : 104);
    var ctl = this.controls ? this.controls.getBoundingClientRect() : null, fr = this.stage.getBoundingClientRect();
    var ctlR = ctl ? ctl.right - fr.left + 18 : 104, ctlB = ctl ? ctl.bottom - fr.top + 10 : 280;
    var GAP = 8, placed = [];
    function hit(a) { return placed.some(function (q) { return a.x < q.x + q.w + 6 && q.x < a.x + a.w + 6 && a.y < q.y + q.h + 4 && q.y < a.y + a.h + 4; }); }
    var tagOn = this.tags && this.tags.master3d && this.tags.master3d.on;
    if (show) this.layers.master3d.markersEl.querySelectorAll('.mm-proj__tag, .mm-road .mm-road__pill').forEach(function (n) {
      if (!tagOn && n.closest('.mm-road--tag')) return;
      var r = n.getBoundingClientRect();   /* count labels by layout (they may still be fading in) */
      if (r.width) placed.push({ x: r.left - fr.left, y: r.top - fr.top, w: r.width, h: r.height });
    });
    var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    this.edgeEls.forEach(function (e) {
      if (!show) { if (e.on) { e.on = false; e.el.classList.remove('is-on'); } return; }
      var x = e.r.x * c.s + c.tx, y = e.r.y * c.s + c.ty;
      var cy = clamp(y, T, B), left = cy < ctlB ? ctlR : L, cx = clamp(x, left, R);
      e.off = cx !== x || cy !== y;
      var pill = e.pill || (e.pill = e.el.querySelector('.mm-edge__pill')), dot = e.dot || (e.dot = e.el.querySelector('.mm-edge__dot'));
      var w = pill.offsetWidth || 120, h = pill.offsetHeight || 26;
      /* badge side: inward when pinned to an edge, otherwise the designer's side (dir); fall back to the others */
      var pref = [];
      if (x < left) pref.push('right'); if (x > R) pref.push('left'); if (y < T) pref.push('down'); if (y > B) pref.push('up');
      pref.push(e.r.dir === 'up' ? 'up' : e.r.dir === 'left' ? 'left' : e.r.dir === 'right' ? 'right' : 'down');
      ['right', 'left', 'down', 'up'].forEach(function (d) { if (pref.indexOf(d) < 0) pref.push(d); });
      var box = null, side = pref[0];
      for (var i = 0; i < pref.length; i++) {
        var v = DIRS[pref[i]], bx = cx + v[0] * (GAP + w / 2 + 4) - w / 2, by = cy + v[1] * (GAP + h / 2 + 4) - h / 2;
        bx = clamp(bx, left, R - w); by = clamp(by, T, B - h);
        var cand = { x: bx, y: by, w: w, h: h };
        if (!box) { box = cand; side = pref[i]; }
        if (!hit(cand)) { box = cand; side = pref[i]; break; }
      }
      placed.push(box);
      if (e.side && e.side !== side) {   /* glide when the badge swaps sides, instead of jumping */
        pill.classList.add('is-gliding'); clearTimeout(e.gt); e.gt = setTimeout(function () { pill.classList.remove('is-gliding'); }, 320);
      }
      e.side = side;
      dot.style.transform = 'translate(' + Math.round(cx) + 'px,' + Math.round(cy) + 'px)';
      pill.style.transform = 'translate(' + Math.round(box.x) + 'px,' + Math.round(box.y) + 'px)';
      e.el.classList.toggle('is-off', e.off);
      if (!e.on) { e.on = true; e.el.classList.add('is-on'); }
    });
  };

  P.setCam = function (map, cam, noClamp) { this.layers[map].cam = noClamp ? cam : this.clampCam(map, cam); this.apply(map); };

  P.centerOf = function (map, cam) { var c = cam || this.layers[map].cam; return [(this.fw / 2 - c.tx) / c.s, (this.fh / 2 - c.ty) / c.s]; };
  P.camAround = function (map, x, y, s, viewW) { var vw = viewW == null ? this.fw : viewW; return { s: s, tx: vw / 2 - x * s, ty: this.fh / 2 - y * s }; };
  P.zoomedFrom = function (map, cam, f) { var c = this.centerOf(map, cam); return this.camAround(map, c[0], c[1], cam.s * f); };

  /* camera tween in center/log-scale space so zooms feel like a real camera */
  P.animateCam = function (map, target, dur, ease) {
    var self = this, L = this.layers[map];
    if (L.tween) L.tween.kill();
    var from = { s: L.cam.s, tx: L.cam.tx, ty: L.cam.ty };
    var c0 = this.centerOf(map, from), c1 = this.centerOf(map, target), o = { p: 0 };
    L.tween = G.to(o, {
      p: 1, duration: dur, ease: ease || 'power2.inOut',
      onUpdate: function () {
        var e = o.p, s = from.s * Math.pow(target.s / from.s, e);
        var cx = c0[0] + (c1[0] - c0[0]) * e, cy = c0[1] + (c1[1] - c0[1]) * e;
        L.cam = { s: s, tx: self.fw / 2 - cx * s, ty: self.fh / 2 - cy * s };
        self.apply(map);
      },
      onComplete: function () { L.tween = null; }
    });
    return L.tween;
  };

  P.zoomBy = function (f, px, py, animate) {
    if (this.busy) return;
    var map = this.active, c = this.layers[map].cam;
    if (px == null) { px = (this.fw - this.padRight) / 2; py = this.fh / 2; }
    var s = this.clampCam(map, { s: c.s * f, tx: 0, ty: 0 }).s;
    var cam = this.clampCam(map, { s: s, tx: px - (px - c.tx) * (s / c.s), ty: py - (py - c.ty) * (s / c.s) });
    if (animate) this.animateCam(map, cam, 0.55, 'power3.out'); else this.setCam(map, cam, true);
  };

  /* ---------- interaction ---------- */
  P.bind = function () {
    var self = this, stage = this.stage;
    this.root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-go],[data-act]');
      if (!t || !self.root.contains(t)) return;
      if (t.hasAttribute('data-go')) self.go(t.getAttribute('data-go'));
      var a = t.getAttribute('data-act');
      if (a === 'zin') self.zoomBy(1.5, null, null, true);
      if (a === 'zout') self.zoomBy(1 / 1.5, null, null, true);
      if (a === 'reload') self.reload();
      if (a === 'full') self.toggleFullscreen();
    });
    this.panel.querySelector('.mm-panel__close').addEventListener('click', function () { self.deselect(); });
    this.backdrop.addEventListener('click', function () { self.deselect(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && self.selection) self.deselect(); });

    var pts = new Map(), start = null, track = [];
    var coop = this.mode === 'section';
    if (coop) stage.classList.add('is-coop');
    function snapshot() {
      var arr = Array.from(pts.values()), cx = 0, cy = 0;
      arr.forEach(function (p) { cx += p.x; cy += p.y; });
      cx /= arr.length; cy /= arr.length;
      var d = arr.length > 1 ? Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y) : 0;
      var c = self.layers[self.active].cam;
      return { cx: cx, cy: cy, d: d, cam: { s: c.s, tx: c.tx, ty: c.ty }, n: arr.length };
    }
    function local(e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

    stage.addEventListener('pointerdown', function (e) {
      if (coop && e.pointerType === 'touch') return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (self.busy) return;
      self.suppress = false;
      pts.set(e.pointerId, local(e));
      start = snapshot(); start.moved = 0; track = [];
      var L = self.layers[self.active]; if (L.tween) L.tween.kill();
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId) || self.busy) return;
      pts.set(e.pointerId, local(e));
      var now = snapshot();
      if (now.n !== start.n) { start = now; start.moved = 99; return; }
      var dx = now.cx - start.cx, dy = now.cy - start.cy;
      start.moved = Math.max(start.moved, Math.hypot(dx, dy));
      if (start.moved < 4) return;
      if (!stage.classList.contains('is-dragging')) {
        stage.classList.add('is-dragging'); self.hideCard();
        try { stage.setPointerCapture(e.pointerId); } catch (err) { }
      }
      self.suppress = true;
      var c = start.cam, s = c.s;
      if (now.n > 1 && start.d) s = self.clampCam(self.active, { s: c.s * (now.d / start.d), tx: 0, ty: 0 }).s;
      self.setCam(self.active, { s: s, tx: now.cx - (start.cx - c.tx) * (s / c.s), ty: now.cy - (start.cy - c.ty) * (s / c.s) });
      track.push({ t: performance.now(), x: now.cx, y: now.cy });
      if (track.length > 6) track.shift();
    });
    function end(e) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 0) {
        stage.classList.remove('is-dragging');
        /* inertia: keep gliding with the release velocity */
        if (track.length > 2 && self.suppress) {
          var a = track[0], b = track[track.length - 1], dt = (b.t - a.t) / 1000;
          if (dt > 0 && performance.now() - b.t < 80) {
            var vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
            if (Math.hypot(vx, vy) > 180) {
              var c = self.layers[self.active].cam;
              self.animateCam(self.active, self.clampCam(self.active, { s: c.s, tx: c.tx + vx * 0.32, ty: c.ty + vy * 0.32 }), 0.9, 'power3.out');
            }
          }
        }
        setTimeout(function () { self.suppress = false; }, 0);
      } else { start = snapshot(); start.moved = 99; }
    }
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('click', function (e) { if (self.suppress) { e.stopPropagation(); e.preventDefault(); } }, true);

    if (coop) {
      var t0 = null;
      function tsnap(e) {
        var r = stage.getBoundingClientRect(), a = e.touches[0], b = e.touches[1], c = self.layers[self.active].cam;
        return { cx: (a.clientX + b.clientX) / 2 - r.left, cy: (a.clientY + b.clientY) / 2 - r.top, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cam: { s: c.s, tx: c.tx, ty: c.ty } };
      }
      stage.addEventListener('touchstart', function (e) {
        if (self.busy) return;
        if (e.touches.length >= 2) { t0 = tsnap(e); self.hideHint(); var L = self.layers[self.active]; if (L.tween) L.tween.kill(); }
      }, { passive: true });
      stage.addEventListener('touchmove', function (e) {
        if (self.busy) return;
        if (e.touches.length < 2) { self.showHint('Dùng hai ngón tay để di chuyển bản đồ'); return; }
        e.preventDefault();
        if (!t0) t0 = tsnap(e);
        var n = tsnap(e), c = t0.cam, s = self.clampCam(self.active, { s: c.s * (n.d / t0.d), tx: 0, ty: 0 }).s;
        self.suppress = true;
        self.setCam(self.active, { s: s, tx: n.cx - (t0.cx - c.tx) * (s / c.s), ty: n.cy - (t0.cy - c.ty) * (s / c.s) });
      }, { passive: false });
      stage.addEventListener('touchend', function (e) { if (e.touches.length < 2) { t0 = null; setTimeout(function () { self.suppress = false; }, 50); } });
    }

    stage.addEventListener('wheel', function (e) {
      if (self.busy) return;
      if (self.mode === 'section' && !(e.ctrlKey || e.metaKey)) {
        self.showHint(IS_MAC ? 'Giữ ⌘ và cuộn để phóng to/thu nhỏ bản đồ' : 'Giữ Ctrl và cuộn để phóng to/thu nhỏ bản đồ');
        return;
      }
      e.preventDefault();
      var p = local(e), dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      var pinch = e.ctrlKey && Math.abs(dy) < 40;
      self.zoomBy(Math.exp(-clamp(dy, -120, 120) * (pinch ? 0.012 : 0.0022)), p.x, p.y, false);
    }, { passive: false });
    stage.addEventListener('dblclick', function (e) { var p = local(e); self.zoomBy(1.6, p.x, p.y, true); });

    var rt;
    function onR() { clearTimeout(rt); rt = setTimeout(function () { self.onResize(); }, 120); }
    window.addEventListener('resize', onR);
    if (window.ResizeObserver) new ResizeObserver(onR).observe(this.frame);
  };

  P.onResize = function () {
    var w = this.fw, h = this.fh;
    this.measure();
    if (w === this.fw && h === this.fh) return;
    var self = this;
    Object.keys(MAPS).forEach(function (k) { self.layers[k].cam = self.defaultCam(k); self.apply(k); });
    if (this.selection) this.focusSelection(false);
    this.updateChrome();
  };

  P.showHint = function (msg) {
    return;   /* gesture hints are not in the design */
    var h = this.hint, self = this;
    h.textContent = msg;
    G.to(h, { autoAlpha: 1, duration: 0.25, overwrite: true });
    clearTimeout(this._hintT);
    this._hintT = setTimeout(function () { self.hideHint(); }, 1300);
  };
  P.hideHint = function () { G.to(this.hint, { autoAlpha: 0, duration: 0.3, overwrite: true }); };

  P.toggleFullscreen = function () {
    var d = document, r = d.documentElement;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else { var p = (r.requestFullscreen || r.webkitRequestFullscreen).call(r); if (p && p.catch) p.catch(function () { }); }
    } catch (e) { }
  };

  /* ---------- hover: projects ---------- */
  P.hoverProject = function (p, on) {
    if (this.active !== 'master3d' || this.busy) return;
    var z = p._zone, sel = this.selection && this.selection.item;
    if (on) {
      if (this.hovered && this.hovered !== p) this.hoverProject(this.hovered, false);
      this.hovered = p;
      p._el.classList.add('is-hover');
      if (z) {
        this.spotHole.setAttribute('d', z.d);
        this.spotHole.setAttribute('transform', z.tr);
        G.to(this.spot, { opacity: 0.38, duration: 0.45, overwrite: true });
        G.to(z.fx, { opacity: 1, duration: 0.35, overwrite: true });
        z.trace.once(1.6);
      }
      this.showCard(p);
    } else {
      p._el.classList.remove('is-hover');
      if (this.hovered === p) this.hovered = null;
      if (sel === p) { this.hideCard(); return; }
      if (z) {
        G.to(z.fx, { opacity: 0, duration: 0.35, overwrite: true });
        z.trace.hide(0.3);
      }
      if (!this.hovered) {
        if (sel && sel._zone) { this.spotHole.setAttribute('d', sel._zone.d); this.spotHole.setAttribute('transform', sel._zone.tr); }
        else G.to(this.spot, { opacity: 0, duration: 0.4, overwrite: true });
      }
      this.hideCard();
    }
  };

  P.showCard = function (p) {
    return;   /* no hover card: the design has only the label tag */
    if (!HOVER || (this.selection && this.selection.item === p)) return;
    var d = p.data;
    this.card.innerHTML = '<b>' + esc(d ? d.title : p.name) + '</b>' +
      (p.teaser ? '<span>' + esc(p.teaser) + '</span>' : '') +
      '<em>' + (d ? 'Nhấn để xem chi tiết' : 'Thông tin đang cập nhật') + '</em>';
    this.cardFor = p;
    this.placeCard();
    G.fromTo(this.card, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3, overwrite: true });
  };
  P.placeCard = function () {
    var p = this.cardFor; if (!p || !p._el) return;
    var r = p._el.getBoundingClientRect(), fr = this.stage.getBoundingClientRect();
    var tag = p._el.querySelector('.mm-proj__tag').getBoundingClientRect();
    var x = (p.side === 'right' ? tag.left : tag.right) - fr.left, y = tag.top - fr.top - 8;
    var w = this.card.offsetWidth || 180, h = this.card.offsetHeight || 70;
    x = p.side === 'right' ? x : x - w;
    this.card.style.translate = Math.round(clamp(x, 8, this.fw - w - 8)) + 'px ' + Math.round(Math.max(8, y - h)) + 'px';
  };
  P.hideCard = function () { this.cardFor = null; G.to(this.card, { autoAlpha: 0, duration: 0.2, overwrite: true }); };

  /* ---------- hover: roads & bridges ---------- */
  P.hoverRoad = function (id, on) {
    if (on && (this.active !== 'master3d' || this.busy)) return;
    var self = this, r = this.roads && this.roads[id];
    if (!r) return;
    if (on && this.rdHover && this.rdHover !== id) this.hoverRoad(this.rdHover, false);
    if (!on && this.rdHover !== id) return;
    this.rdHover = on ? id : null;
    Object.keys(this.roads).forEach(function (k) {
      G.to(self.roads[k].comet.g, { opacity: on && k !== id ? 0.15 : 1, duration: 0.4, overwrite: 'auto' });
    });
    r.g.classList.toggle('is-hover', on);
    G.to(this.rdDim, { opacity: on ? 1 : 0, duration: 0.5, ease: 'power2.out', overwrite: true });
    if (on) r.hl.show(1.1);
    else { r.hl.hide(0.4); this.hideRoadTag('master3d'); }
    D.roads.forEach(function (rd) { if (rd.path === id && rd._el) rd._el.classList.toggle('is-hover', on); });
  };
  P.pulseBridge = function (n) {
    var dot = n.querySelector('.mm-road__dot');
    if (dot) G.fromTo(dot, { scale: 0.6, opacity: 1 }, { scale: 3.2, opacity: 0, duration: 0.9, ease: 'power2.out' });
  };

  /* ---------- chrome ---------- */
  P.updateChrome = function () {
    var v = this.view, inOverview = v === 'overview' || v === 'tod';
    if (this.modeEl) {
      var mv = inOverview ? 'overview' : 'urban';
      this.modeEl.setAttribute('data-active', mv);
      this.modeEl.querySelectorAll('button').forEach(function (b) { var on = b.getAttribute('data-go') === mv; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
    }
    if (this.tabsEl) {
      var bs = this.tabsEl.querySelectorAll('button');
      /* Figma: on the TOD plan the in-map tab bar shows with "Khu đô thị" highlighted */
      var tv = v === 'amenity' ? 'amenity' : 'urban';
      bs.forEach(function (b) { var on = b.getAttribute('data-go') === tv; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
      var ind = this.tabsEl.querySelector('.mm-tabs__indicator'), w = bs[0].offsetWidth || 160;
      ind.style.width = w + 'px';
      ind.style.transform = 'translateX(' + (v === 'amenity' ? w : 0) + 'px)';
      var show = v !== 'overview' && !this._hideTabs;
      G.to(this.tabsEl, { autoAlpha: show ? 1 : 0, y: show ? 0 : 14, duration: 0.45, overwrite: true });
    }
    if (this.ptabs) {
      var cur = null;
      var pv = v === 'tod' ? 'overview' : v;
      this.ptabs.querySelectorAll('button').forEach(function (b) { var on = b.getAttribute('data-go') === pv; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); if (on) cur = b; });
      var pi = this.ptabs.querySelector('.mm-ptabs__indicator');
      if (cur) { pi.style.width = cur.offsetWidth + 'px'; pi.style.transform = 'translateX(' + (cur.offsetLeft - 4) + 'px)'; }
    }
    G.to(this.legend, { autoAlpha: this.active === 'overview' ? 1 : 0, duration: 0.4, overwrite: true });
    this.updateEdges();
    var rl = this.controls.querySelector('[data-ctrl="reload"]');
    rl.classList.toggle('is-hidden', this.mode === 'section' && !!this.selection && !this.panelIsOverlay());
  };

  P.setTitle = function (view, instant) {
    if (!this.titleEl) return;
    var t = D.titles[view === 'overview' ? 'overview' : 'urban'], node = this.titleEl;  /* TOD plan uses the second title, as in Figma */
    var html = '<span class="ln">' + esc(t[0]) + '</span><span class="ln accent">' + esc(t[1]) + '</span>';
    if (instant) { node.innerHTML = html; return; }
    if (node.innerHTML === html) return;
    G.timeline()
      .to(node.querySelectorAll('.ln'), { yPercent: -40, autoAlpha: 0, duration: 0.35, stagger: 0.06, ease: 'power2.in' })
      .add(function () { node.innerHTML = html; })
      .fromTo(function () { return node.querySelectorAll('.ln'); }, { yPercent: 40, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.6, stagger: 0.08, ease: 'power3.out' });
  };

  /* ---------- reveals ---------- */
  P.reveal = function (map, delay) {
    var d = delay || 0, L = this.layers[map].markersEl;
    if (map === 'master3d') {
      var tags = L.querySelectorAll('.mm-proj__tag'), lines = L.querySelectorAll('.mm-proj__line');
      G.fromTo(lines, { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.7, stagger: 0.05, ease: 'power3.out', delay: d, clearProps: 'transform' });
      G.fromTo(tags, { autoAlpha: 0, y: -12 }, { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.05, ease: 'back.out(1.8)', delay: d + 0.25, clearProps: 'transform' });
      G.fromTo(L.querySelectorAll('.mm-road'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, stagger: 0.04, delay: d + 0.4 });
      var self = this;
      Object.keys(this.roads).forEach(function (k, i) {
        var r = self.roads[k];
        r.hl.show(1.4, d + 0.2 + i * 0.15);
        r.hl.hide(0.8, d + 1.7 + i * 0.15);
      });
    } else if (map === 'amenity') {
      G.fromTo(L.querySelectorAll('.mm-pin'), { autoAlpha: 0, scale: 0.3 }, { autoAlpha: 1, scale: 1, duration: 0.5, stagger: { each: 0.03, from: 'center' }, ease: 'back.out(2.2)', delay: d, clearProps: 'transform' });
    } else if (map === 'overview') {
      var zp = this.salaZone.querySelectorAll('path');
      G.fromTo(this.salaPin, { y: -60, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9, ease: 'bounce.out', delay: d + 0.2 });
      G.fromTo(zp, { opacity: 0 }, { opacity: 1, duration: 0.8, stagger: 0.1, delay: d });
      var ovr = this.ovRoads || {};
      Object.keys(ovr).forEach(function (k, i) {
        var r = ovr[k];
        r.hl.show(1.6, d + 0.3 + i * 0.18);
        r.hl.hide(0.9, d + 2.0 + i * 0.18);
      });
    }
  };

  P.intro = function () {
    this.reveal('overview', 0.3);
    var u = this.cloud.u;
    G.fromTo(u, { density: 0.9, edge: 0.4, scale: 1.6 }, { density: AMBIENT.overview.density, edge: 1, scale: 1, duration: 2.6, ease: 'power2.out', delay: 0.1 });
  };

  /* TOD plan layers come in one after another: routes wipe out from the centre, then icons, then arrows */
  P.revealPlan = function (d) {
    var L = this.planLayers; if (!L) return;
    var routes = L[2], icons = L[1], arrows = L[0], st = { r: 0 };
    G.set([icons, arrows], { autoAlpha: 0 });
    G.fromTo(st, { r: 0 }, { r: 140, duration: 2.0, ease: 'power2.inOut', delay: d,
      onUpdate: function () { var m = 'radial-gradient(circle at 52% 45%, #000 ' + (st.r - 12) + '%, transparent ' + st.r + '%)'; routes.style.webkitMaskImage = m; routes.style.maskImage = m; },
      onComplete: function () { routes.style.webkitMaskImage = routes.style.maskImage = 'none'; } });
    G.fromTo(icons, { autoAlpha: 0, scale: 1.015 }, { autoAlpha: 1, scale: 1, duration: 0.8, delay: d + 1.0, ease: 'power2.out' });
    G.fromTo(arrows, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, delay: d + 1.5, ease: 'power1.out' });
  };

  /* ---------- clouds timeline pieces ---------- */
  /* close in: density rises while the features grow (we fly into the bank) */
  P.cloudsIn = function (tl, at) {
    var u = this.cloud.u;
    tl.to(u, { edge: 0, alpha: 1, duration: 0.9, ease: 'sine.inOut' }, at)
      .to(u, { density: 1, duration: 1.15, ease: 'power2.inOut' }, at)
      .to(u, { scale: 2.2, duration: 1.25, ease: 'power1.in' }, at)
      .set(u, { hole: 0 }, at)
      .to(this.veil, { autoAlpha: 0.55, duration: 0.5, ease: 'sine.in' }, at + 0.75);
    if (!this.cloud.ok) tl.to(this.veil, { autoAlpha: 1, duration: 0.6 }, at + 0.4);
    return tl;
  };
  /* part: a clearing opens from the centre and the clouds sweep past the camera,
     then settle back into the ambient edge mist of the new map */
  P.cloudsOut = function (tl, at, map) {
    var u = this.cloud.u, amb = AMBIENT[map || this.active] || AMBIENT.master3d;
    tl.to(this.veil, { autoAlpha: 0, duration: 0.7, ease: 'sine.out' }, at)
      .to(u, { hole: 2.4, duration: 2.0, ease: 'power2.inOut' }, at)
      .to(u, { scale: 4.2, duration: 2.0, ease: 'power2.out' }, at)
      .to(u, { density: 0, duration: 1.3, ease: 'power1.in' }, at + 0.4)
      .add(function () {
        /* settle into the ambient mist without holding up the interaction */
        G.set(u, { hole: 0, scale: 1, edge: amb.edge, alpha: 0 });
        G.to(u, { density: amb.density, alpha: amb.alpha, duration: 1.6, ease: 'sine.inOut' });
      }, at + 1.75);
    return tl;
  };
  P.ambient = function (map, dur) {
    var amb = AMBIENT[map];
    G.to(this.cloud.u, { density: amb.density, alpha: amb.alpha, edge: amb.edge, scale: 1, hole: 0, duration: dur == null ? 1.2 : dur, ease: 'sine.inOut', overwrite: 'auto' });
  };

  P.showLayer = function (map, fade) {
    var self = this;
    Object.keys(this.layers).forEach(function (k) {
      var L = self.layers[k].el, on = k === map;
      L.classList.toggle('is-active', on);
      if (fade) G.to(L, { autoAlpha: on ? 1 : 0, duration: fade, ease: 'power1.inOut', overwrite: true });
      else G.set(L, { autoAlpha: on ? 1 : 0 });
    });
    this.active = map;
  };

  /* ---------- navigation ---------- */
  P.go = function (target) {
    if (this.busy || target === this.view) return;
    var v = this.view, fromOverview = v === 'overview' || v === 'tod';
    if (target === 'overview') return this.toOverview();          /* from TOD plan or urban maps back to the location map */
    if (target === 'tod') return this.dive('tod');                 /* SALA pin on the location map */
    if (fromOverview) return this.dive(target);                    /* Tổng quan → Khu đô thị / Tiện ích: clouds */
    return this.switchTab(target);                                 /* Khu đô thị ⇄ Tiện ích: quick crossfade */
  };

  P.dive = async function (target) {
    var self = this, from = this.active;
    if (this.ovHover) this.hoverOvRoad(this.ovHover, false);
    if (this.rdHover) this.hoverRoad(this.rdHover, false);
    this.busy = true;
    this.deselect(true);
    this.view = target;
    this._hideTabs = true;
    this.updateChrome();
    var first = CONFIG.mapOf[target], def = this.defaultCam(first), pin = D.overview.pin;
    var tl = G.timeline();
    if (from === 'overview') {
      tl.add(this.animateCam('overview', this.camAround('overview', pin.x, pin.y - 60, this.layers.overview.cam.s * 2.4), 1.4, 'power2.in'), 0)
        .to(this.salaPin, { autoAlpha: 0, duration: 0.4 }, 0.6);
    } else {
      tl.add(this.animateCam(from, this.zoomedFrom(from, this.layers[from].cam, 1.35), 1.4, 'power2.in'), 0);
    }
    this.cloudsIn(tl, 0.15);
    tl.add(function () {
      self.setTitle(target);
      self.setCam(first, self.zoomedFrom(first, def, 1.4), true);
      self.showLayer(first);
    }, 1.3);
    this.cloudsOut(tl, 1.35, first);
    tl.add(function () {
      self.animateCam(first, def, 1.9, 'power3.out');
      self._hideTabs = false; self.updateChrome();
      if (first === 'plan2d') self.revealPlan(0.6); else self.reveal(first, 0.5);
    }, 1.35);
    await done(tl);
    G.set(this.salaPin, { autoAlpha: 1 });
    if (from !== first) { this.layers[from].cam = this.defaultCam(from); this.apply(from); }
    this.updateChrome();
    this.busy = false;
  };

  P.toOverview = async function () {
    var self = this;
    if (this.rdHover) this.hoverRoad(this.rdHover, false);
    this.busy = true;
    this.deselect(true);
    this.view = 'overview';
    this.updateChrome();
    var cur = this.active, def = this.defaultCam('overview'), pin = D.overview.pin;
    var tl = G.timeline();
    tl.add(this.animateCam(cur, this.zoomedFrom(cur, this.layers[cur].cam, 1.3), 1.25, 'power2.in'), 0);
    this.cloudsIn(tl, 0);
    tl.add(function () {
      self.setTitle('overview');
      self.setCam('overview', self.camAround('overview', pin.x, pin.y - 60, def.s * 2.1), true);
      self.showLayer('overview');
      self.updateChrome();
    }, 1.15);
    this.cloudsOut(tl, 1.2, 'overview');
    tl.add(function () { self.animateCam('overview', def, 2.0, 'power3.out'); self.reveal('overview', 0.6); }, 1.2);
    await done(tl);
    this.layers[cur].cam = this.defaultCam(cur); this.apply(cur);
    this.busy = false;
  };

  P.switchTab = async function (target) {
    if (this.rdHover) this.hoverRoad(this.rdHover, false);
    this.busy = true;
    this.deselect(true);
    var map = target === 'amenity' ? 'amenity' : 'master3d', prev = this.active;
    this.view = target;
    this.updateChrome();
    var def = this.defaultCam(map);
    this.setCam(map, this.zoomedFrom(map, def, 1.12), true);
    this.animateCam(prev, this.zoomedFrom(prev, this.layers[prev].cam, 1.1), 0.9, 'power2.inOut');
    this.showLayer(map, 0.8);
    this.ambient(map, 1.2);
    this.reveal(map, 0.35);
    await done(this.animateCam(map, def, 1.3, 'power3.out'));
    this.layers[prev].cam = this.defaultCam(prev); this.apply(prev);
    this.updateChrome();
    this.busy = false;
  };

  P.reload = async function () {
    if (this.busy) return;
    var self = this, map = this.active;
    this.busy = true;
    this.deselect(true);
    var tl = G.timeline();
    this.cloudsIn(tl, 0);
    tl.to(this.loader, { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' }, 0.75)
      .add(function () { self.setCam(map, self.zoomedFrom(map, self.defaultCam(map), 1.25), true); }, 1.2)
      .to(this.loader, { autoAlpha: 0, scale: 0.7, duration: 0.35, ease: 'power2.in' }, 2.05);
    this.cloudsOut(tl, 2.1, map);
    tl.add(function () { self.animateCam(map, self.defaultCam(map), 1.6, 'power3.out'); self.reveal(map, 0.3); if (map === 'plan2d') self.revealPlan(0.3); }, 2.1);
    await done(tl);
    this.busy = false;
  };

  /* ---------- selection & panel ---------- */
  P.select = function (kind, item) {
    if (this.busy) return;
    if (!item.data) return;   /* only items with content from the design open the panel */
    if (this.selection && this.selection.item === item) return;
    this.clearSelectionMarks();
    this.selection = { kind: kind, item: item };
    if (kind === 'project') {
      D.projects.forEach(function (p) { p._el.classList.toggle('is-selected', p === item); p._el.classList.toggle('is-dim', p !== item); });
      var z = item._zone;
      if (z) {
        this.spotHole.setAttribute('d', z.d); this.spotHole.setAttribute('transform', z.tr);
        G.to(this.spot, { opacity: 0.38, duration: 0.45, overwrite: true });
        G.to(z.fx, { opacity: 1, duration: 0.35, overwrite: true });
      }
      this.hideCard();
    } else {
      item._el.classList.add('is-active');
    }
    this.renderPanel(kind, item);
    this.openPanel();
    this.focusSelection(true);
    this.updateChrome();
  };

  P.clearSelectionMarks = function () {
    D.projects.forEach(function (p) {
      if (p._el) p._el.classList.remove('is-selected', 'is-dim');
      if (p._zone) { G.to(p._zone.fx, { opacity: 0, duration: 0.3, overwrite: true }); p._zone.trace.hide(0.3); }
    });
    if (this.spot && !this.hovered) G.to(this.spot, { opacity: 0, duration: 0.35, overwrite: true });
    D.amenities.forEach(function (a) { if (a._el) a._el.classList.remove('is-active'); });
  };

  P.focusSelection = function (animate) {
    var it = this.selection.item, map = this.active;
    this.padRight = this.panelIsOverlay() ? 0 : this.panel.offsetWidth;
    var s = this.layers[map].cam.s;
    var cam = this.clampCam(map, { s: s, tx: (this.fw - this.padRight) / 2 - it.x * s, ty: this.fh / 2 - it.y * s });
    if (animate) this.animateCam(map, cam, 0.9, 'power3.inOut'); else this.setCam(map, cam, true);
  };

  P.openPanel = function () {
    var p = this.panel;
    p.classList.add('is-open');
    p.setAttribute('aria-hidden', 'false');
    this.backdrop.classList.add('is-on');
    this.root.classList.add('panel-open');
    p.querySelector('.mm-panel__body').scrollTop = 0;
    G.fromTo(p.querySelectorAll('.mm-panel__title, .mm-col > *, .mm-panel__empty, .mm-panel__foot > *'),
      { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.55, stagger: 0.045, ease: 'power3.out', delay: 0.15 });
    var media = p.querySelector('.mm-panel__media img');
    if (media) G.fromTo(media, { scale: 1.12 }, { scale: 1, duration: 1.4, ease: 'power2.out', delay: 0.1 });
  };

  P.deselect = function (silent) {
    if (!this.selection) return;
    this.selection = null;
    this.clearSelectionMarks();
    this.panel.classList.remove('is-open');
    this.panel.setAttribute('aria-hidden', 'true');
    this.backdrop.classList.remove('is-on');
    this.root.classList.remove('panel-open');
    this.padRight = 0;
    var map = this.active;
    if (!silent) this.animateCam(map, this.clampCam(map, this.layers[map].cam), 0.6, 'power2.out');
    else this.setCam(map, this.layers[map].cam);
    this.updateChrome();
  };

  P.renderPanel = function (kind, item) {
    var d = item.data, P2 = this.panel;
    P2.setAttribute('aria-label', d ? d.title : item.name);
    P2.querySelector('.mm-panel__kind').textContent = kind === 'project' ? 'Dự án' : 'Tiện ích';
    var body = P2.querySelector('.mm-panel__body'), foot = P2.querySelector('.mm-panel__foot');
    var title = d ? d.title : item.name;
    var html = '<h3 class="mm-panel__title">' + esc(title) + '</h3>';
    if (d) {
      var stats = d.stats.map(function (s) {
        return '<div class="mm-stat">' + (d.statsValueFirst
          ? '<span class="v">' + esc(s[0]) + '</span><span class="k">' + esc(s[1]) + '</span>'
          : '<span class="k">' + esc(s[0]) + '</span><span class="v">' + esc(s[1]) + '</span>') + '</div>';
      }).join('');
      var thumbs = d.gallery.map(function (g, i) { return '<button type="button" data-src="' + g + '" aria-label="Ảnh ' + (i + 1) + '"><img src="' + g + '" alt="" loading="lazy"></button>'; }).join('');
      var cta = '<a class="mm-cta" href="' + (d.href || '#') + '">' + esc(d.cta) + icon(I.arrowRight) + '</a>';
      html = '<div class="mm-col mm-col--a">' + html +
        '<div class="mm-panel__media"><img src="' + d.image + '" alt="' + esc(title) + '"></div>' +
        '<p class="mm-panel__desc">' + esc(d.desc) + '</p></div>' +
        '<div class="mm-col mm-col--b"><div class="mm-acc"><button type="button" class="mm-acc__head" aria-expanded="true">Thông tin chung' + icon(I.chevron) + '</button>' +
        '<div class="mm-acc__body"><div class="mm-acc__inner">' + stats + '</div></div></div>' +
        '<div class="mm-gal"><div class="mm-gal__head"><span class="mm-gal__count">Hình ảnh (' + d.gallery.length + ')</span>' +
        '<div class="mm-gal__nav"><button type="button" class="prev" aria-label="Ảnh trước">' + icon(I.chevron) + '</button>' +
        '<button type="button" class="next" aria-label="Ảnh sau">' + icon(I.chevron) + '</button></div></div>' +
        '<div class="mm-gal__track">' + thumbs + '</div></div>' +
        cta.replace('class="mm-cta"', 'class="mm-cta mm-cta-inline"') + '</div>';
      foot.innerHTML = cta; foot.style.display = '';
    } else {
      html += '<p class="mm-panel__empty">Thông tin chi tiết về ' + esc(item.name) + ' đang được cập nhật.</p>';
      foot.innerHTML = ''; foot.style.display = 'none';
    }
    body.innerHTML = html;
    if (!d) return;
    var acc = body.querySelector('.mm-acc');
    acc.querySelector('.mm-acc__head').addEventListener('click', function () { var closed = acc.classList.toggle('is-closed'); this.setAttribute('aria-expanded', !closed); });
    var track = body.querySelector('.mm-gal__track'), media = body.querySelector('.mm-panel__media img');
    var btns = track.querySelectorAll('button'), idx = -1;
    function show(i) {
      idx = (i + btns.length) % btns.length;
      btns.forEach(function (b, j) { b.classList.toggle('is-current', j === idx); });
      var src = btns[idx].getAttribute('data-src');
      G.to(media, { autoAlpha: 0, duration: 0.2, onComplete: function () { media.src = src; G.fromTo(media, { autoAlpha: 0, scale: 1.06 }, { autoAlpha: 1, scale: 1, duration: 0.6 }); } });
      var b = btns[idx];
      track.scrollTo({ left: Math.max(0, b.offsetLeft - track.offsetLeft - (track.clientWidth - b.offsetWidth) / 2), behavior: 'smooth' });
    }
    btns.forEach(function (b, i) { b.addEventListener('click', function () { show(i); }); });
    body.querySelector('.mm-gal__nav .prev').addEventListener('click', function () { show(idx < 0 ? btns.length - 1 : idx - 1); });
    body.querySelector('.mm-gal__nav .next').addEventListener('click', function () { show(idx + 1); });
  };

  /* ---------- boot ---------- */
  function boot() {
    if (!G) { console.error('GSAP is required'); return; }
    var all = [];
    document.querySelectorAll('[data-mm]').forEach(function (n) { n._mm = new MasterMap(n); all.push(n._mm); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {
      all.forEach(function (m) { m.measure(); Object.keys(MAPS).forEach(function (k) { m.apply(k); }); m.updateChrome(); });
    });
  }
  window.SalaBoot = boot;
  if (!window.SALA_MANUAL_BOOT) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
  window.SalaMasterMap = MasterMap;
})();
