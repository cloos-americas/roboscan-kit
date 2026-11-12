// RoboScan steel cell in 3D: a QIROX QRC410 hanging from a C-frame that rolls on a floor track,
// a tacked W-beam on steel stands, all under a shop awning. Illustration, not to scale.
//
// Everything on screen is a pure function of (step, t): setState() poses the whole scene for any
// step and time, so the page can jump to any step, and build tools can grab an exact frame with
// #step=5&t=14 (add &clean to hide the panel).
(function () {
  'use strict';
  const THREE = window.THREE;
  const R = window.QRC410;
  const stage = document.getElementById('stage');

  function fail(msg) {
    document.body.classList.add('no3d');
    const el = document.getElementById('fallback');
    if (el && msg) el.querySelector('[data-why]').textContent = msg;
  }
  if (!THREE || !R) { fail('The 3D files did not load.'); return; }
  try {
    const c = document.createElement('canvas');
    if (!(c.getContext('webgl') || c.getContext('experimental-webgl'))) { fail('This browser has 3D turned off.'); return; }
  } catch (e) { fail('This browser has 3D turned off.'); return; }

  // ------------------------------------------------------------------ math helpers
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, u) => a + (b - a) * u;
  const ease = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const lerpQ = (a, b, u) => a.map((x, i) => lerp(x, b[i], u));
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ------------------------------------------------------------------ layout (metres, y up)
  const BEAM = { L: 9.0, d: 0.46, bf: 0.19, tf: 0.016, tw: 0.0105, y0: 0.76 };
  BEAM.top = BEAM.y0 + BEAM.d;
  const STIFF_X = [-3.0, -1.0, 1.0, 3.0];
  const STIFF_T = 0.012;
  const STANDS_X = [-4.0, -2.0, 0, 2.0, 4.0];
  const TRACK = { x0: -6.6, x1: 6.6, z: -2.1 };
  const MOUNT = { y: 2.85, z: -1.0 };            // robot base (top of base casting) under the boom tip
  const PARK_X = 5.4;
  const SCAN_X0 = 5.0, SCAN_X1 = -5.0;   // scan runs from the park end to the far end
  const ROOF = { x0: -10.2, x1: 10.2, zBack: -5.6, zFront: 5.0, yBack: 5.9, yFront: 5.1 };

  // ------------------------------------------------------------------ renderer, scene, camera
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.NoToneMapping;   // keeps CLOOS orange orange (ACES pushes it to yellow)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const SKY = 0xdfe6ea;
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(SKY, 40, 140);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
  camera.position.set(11, 7, 13);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 1.2;
  controls.maxDistance = 45;
  controls.target.set(0, 1.2, -0.6);

  scene.add(new THREE.HemisphereLight(0xeef4f8, 0x6b6357, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1dc, 0.95);
  sun.position.set(16, 26, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 14, bottom: -14, near: 1, far: 70 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
  fill.position.set(-12, 6, -10);
  scene.add(fill);
  const inside = new THREE.DirectionalLight(0xfff8ee, 0.55);
  inside.position.set(-3, 9, -12);
  scene.add(inside);

  // ------------------------------------------------------------------ materials and textures
  const mats = {};
  function mat(hex, o) {
    const key = hex + JSON.stringify(o || {});
    if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial(Object.assign({ color: hex, roughness: 0.6, metalness: 0.15 }, o || {}));
    return mats[key];
  }
  const M = {
    steel: mat(0x7d8389, { metalness: 0.55, roughness: 0.42 }),
    millscale: mat(0x4e555c, { metalness: 0.5, roughness: 0.6 }),
    plate: mat(0xa9b0b6, { metalness: 0.6, roughness: 0.35 }),
    frame: mat(0x2b3237, { metalness: 0.35, roughness: 0.5 }),
    frameLite: mat(0x3a464d, { metalness: 0.3, roughness: 0.55 }),
    orange: mat(0xc24a04, { roughness: 0.5 }),   // CLOOS orange #db6006, a shade deeper so it holds under direct sun
    yellow: mat(0xe6ad12, { roughness: 0.5 }),
    black: mat(0x1d2124, { roughness: 0.7 }),
    rail: mat(0x9aa1a6, { metalness: 0.7, roughness: 0.3 }),
    column: mat(0x56636c, { metalness: 0.35, roughness: 0.55 }),
    bead: mat(0x8f7a5e, { metalness: 0.6, roughness: 0.32 }),
    tack: mat(0x6f655a, { metalness: 0.5, roughness: 0.5 }),
    white: mat(0xf2f3f3, { roughness: 0.6 }),
    skin: mat(0xc99b7a, { roughness: 0.8 }),
    denim: mat(0x2f3d52, { roughness: 0.9 }),
    hivis: mat(0xff8a1c, { roughness: 0.7 }),
  };
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  function skyTexture() {
    return canvasTex(4, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#9fb7c9'); gr.addColorStop(0.55, '#d6e0e7'); gr.addColorStop(1, '#e8ecee');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  }
  function noise(g, w, h, n, a, colors) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[i % colors.length];
      g.globalAlpha = a * Math.random();
      const s = 1 + Math.random() * 2;
      g.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
    g.globalAlpha = 1;
  }
  const concreteTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b8b5ad'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 9000, 0.35, ['#9f9c94', '#cfccc4', '#a8a59d']);
    g.strokeStyle = 'rgba(70,68,64,0.55)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, 1); g.lineTo(w, 1); g.moveTo(1, 0); g.lineTo(1, h); g.stroke();
  }, [7, 4]);
  const asphaltTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6f7378'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 7000, 0.4, ['#5c6065', '#83878c', '#4f5357']);
  }, [60, 60]);
  const roofTex = canvasTex(256, 64, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const v = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 8);
      const c = Math.round(132 + v * 34);
      g.fillStyle = `rgb(${c},${c + 3},${c + 6})`;
      g.fillRect(x, 0, 1, h);
    }
  }, [10, 1]);
  const wallTex = canvasTex(256, 64, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const v = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 6);
      const c = Math.round(150 + v * 30);
      g.fillStyle = `rgb(${c - 6},${c},${c + 6})`;
      g.fillRect(x, 0, 1, h);
    }
  }, [24, 1]);
  const glowTex = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(210,230,255,0.9)');
    gr.addColorStop(0.45, 'rgba(120,170,255,0.25)'); gr.addColorStop(1, 'rgba(80,120,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  glowTex.encoding = THREE.LinearEncoding;

  // ------------------------------------------------------------------ geometry helpers
  function box(w, h, d, m, x, y, z, parent, shadow = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    (parent || scene).add(mesh);
    return mesh;
  }
  function cyl(r, h, m, x, y, z, parent, seg = 24) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    (parent || scene).add(mesh);
    return mesh;
  }
  function strut(a, b, size, m, parent) {   // square bar from point a to point b
    const dir = new THREE.Vector3().subVectors(b, a);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, dir.length(), size), m);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
    mesh.castShadow = true; mesh.receiveShadow = true;
    (parent || scene).add(mesh);
    return mesh;
  }
  function wShape(len, d, bf, tf, tw, m, parent, alongX = true) {   // I-beam, centred, web vertical
    const g = new THREE.Group();
    box(alongX ? len : bf, tf, alongX ? bf : len, m, 0, d / 2 - tf / 2, 0, g);
    box(alongX ? len : bf, tf, alongX ? bf : len, m, 0, -d / 2 + tf / 2, 0, g);
    box(alongX ? len : tw, d - 2 * tf, alongX ? tw : len, m, 0, 0, 0, g);
    (parent || scene).add(g);
    return g;
  }
  function textTex(text, w, h, color, bg, font) {
    return canvasTex(w, h, (g) => {
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
      g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2);
    });
  }

  // ------------------------------------------------------------------ ground, pad, yard
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(22, 0.04, 13), new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 }));
  pad.position.set(0, 0.02, -0.3); pad.receiveShadow = true; scene.add(pad);
  // painted floor: yellow cell boundary and a hatched walkway at the operator side
  const paint = mat(0xe8b511, { roughness: 0.8 });
  function floorLine(x0, z0, x1, z1, wdt = 0.1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, wdt), paint);
    m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(z1 - z0, x1 - x0);
    m.position.set((x0 + x1) / 2, 0.042, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m);
  }
  const CB = { x0: -7.4, x1: 7.4, z0: -3.6, z1: 1.3 };
  floorLine(CB.x0, CB.z0, CB.x1, CB.z0); floorLine(CB.x0, CB.z1, CB.x1, CB.z1);
  floorLine(CB.x0, CB.z0, CB.x0, CB.z1); floorLine(CB.x1, CB.z0, CB.x1, CB.z1);
  for (let i = 0; i < 9; i++) floorLine(-9.4 + i * 0.25, -3.6, -9.0 + i * 0.25, -2.0, 0.07);

  // shop building behind the yard, roll-up door and windows
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.2 });
  box(70, 11, 0.4, wallMat, 0, 5.5, -17, null, false);
  box(6.5, 6.5, 0.1, mat(0x8f979c, { metalness: 0.4 }), -6, 3.25, -16.75, null, false);
  box(6.5, 0.4, 0.15, M.orange, -6, 6.7, -16.72, null, false);
  for (let i = 0; i < 6; i++) box(3, 1.2, 0.08, mat(0x55707f, { metalness: 0.6, roughness: 0.15 }), 4 + i * 4.2, 8.2, -16.75, null, false);
  box(70, 0.5, 0.6, M.frame, 0, 11.1, -17, null, false);

  // steel stock on dunnage in the yard
  function stockPile(x, z, n, layers) {
    for (let l = 0; l < layers; l++) {
      for (const dz of [-1.6, 1.6]) box(0.12, 0.12, 0.2 + n * 0.32, mat(0x7b5a3a, { roughness: 0.9 }), x + dz, 0.06 + l * 0.42, z, null);
      for (let i = 0; i < n; i++) {
        const b = wShape(7, 0.3, 0.15, 0.012, 0.008, M.millscale, null, true);
        b.rotation.y = 0; b.position.set(x, 0.27 + l * 0.42, z - (n - 1) * 0.16 + i * 0.32);
      }
    }
  }
  stockPile(15.5, -1.0, 4, 2);
  stockPile(15.5, 3.6, 3, 1);

  // ------------------------------------------------------------------ awning
  const awning = new THREE.Group(); scene.add(awning);
  const roofY = z => lerp(ROOF.yBack, ROOF.yFront, (z - ROOF.zBack) / (ROOF.zFront - ROOF.zBack));
  const colX = [-9.6, -3.2, 3.2, 9.6], colZ = [-5.2, 4.6];
  for (const x of colX) {
    for (const z of colZ) {
      const h = roofY(z) - 0.25;
      const c = wShape(h, 0.3, 0.3, 0.016, 0.01, M.column, awning, false);
      c.rotation.x = Math.PI / 2; c.position.set(x, h / 2, z);
      box(0.5, 0.03, 0.5, M.column, x, 0.055, z, awning);
    }
    // rafter along the slope
    const a = V(x, roofY(colZ[0] - 0.6) - 0.18, colZ[0] - 0.6), b = V(x, roofY(colZ[1] + 0.6) - 0.18, colZ[1] + 0.6);
    strut(a, b, 0.24, M.column, awning);
  }
  for (let z = ROOF.zBack + 0.3; z < ROOF.zFront; z += 1.25) {
    box(ROOF.x1 - ROOF.x0, 0.12, 0.08, M.column, 0, roofY(z) - 0.03, z, awning);
  }
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  const slope = Math.atan2(ROOF.yBack - ROOF.yFront, ROOF.zFront - ROOF.zBack);
  const roofLen = Math.hypot(ROOF.zFront - ROOF.zBack, ROOF.yBack - ROOF.yFront);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(ROOF.x1 - ROOF.x0, roofLen), roofMat);
  roof.rotation.x = -Math.PI / 2 + slope;
  roof.position.set(0, (ROOF.yBack + ROOF.yFront) / 2 + 0.04, (ROOF.zBack + ROOF.zFront) / 2);
  roof.castShadow = true; roof.receiveShadow = true;
  awning.add(roof);
  const fascia = box(ROOF.x1 - ROOF.x0 + 0.1, 0.32, 0.08, M.orange, 0, ROOF.yFront - 0.1, ROOF.zFront + 0.02, awning);
  box(ROOF.x1 - ROOF.x0 + 0.1, 0.3, 0.08, M.frame, 0, ROOF.yBack - 0.1, ROOF.zBack - 0.02, awning);
  // LED high bays under the roof
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e5, emissiveIntensity: 1.2 });
  for (const x of [-6.4, 0, 6.4]) for (const z of [-2.4, 1.6]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 20), ledMat);
    l.position.set(x, roofY(z) - 0.35, z); awning.add(l);
  }
  const under = new THREE.PointLight(0xfff3e0, 0.45, 18, 1.6); under.position.set(0, 4.4, -0.8); scene.add(under);

  // monorail hoist over the stands
  const railY = 4.55;
  const mono = wShape(11, 0.3, 0.15, 0.014, 0.009, M.yellow, awning, true);
  mono.position.set(0, railY, 0);
  for (const x of [-4.8, 0, 4.8]) strut(V(x, railY + 0.15, 0), V(x, roofY(0) - 0.05, 0), 0.08, M.column, awning);
  const hoist = new THREE.Group(); scene.add(hoist);
  box(0.5, 0.35, 0.5, M.yellow, 0, railY - 0.33, 0, hoist);
  box(0.36, 0.22, 0.36, M.frame, 0, railY - 0.6, 0, hoist);

  const crane = new THREE.Group(); scene.add(crane);
  const hookBlock = box(0.22, 0.28, 0.14, M.yellow, 0, 0, 0, crane);
  const hookRope = cyl(0.012, 1, M.black, 0, 0, 0, crane, 8);
  const spreader = new THREE.Group(); crane.add(spreader);
  box(6.4, 0.16, 0.16, M.yellow, 0, 0, 0, spreader);
  const slingMat = mat(0x3d8bd8, { roughness: 0.8 });
  const slings = [];
  for (const x of [-2.6, 2.6]) for (const s of [-1, 1]) slings.push({ x, s, mesh: strut(V(0, 0, 0), V(0, 1, 0), 0.035, slingMat, spreader) });
  const topSlings = [-1.2, 1.2].map(x => ({ x, mesh: strut(V(0, 0, 0), V(0, 1, 0), 0.035, slingMat, crane) }));

  // ------------------------------------------------------------------ the beam (W-shape with stiffeners)
  const beam = new THREE.Group(); scene.add(beam);
  wShape(BEAM.L, BEAM.d, BEAM.bf, BEAM.tf, BEAM.tw, M.millscale, beam, true).position.y = BEAM.d / 2;
  const stiffH = BEAM.d - 2 * BEAM.tf, stiffW = BEAM.bf / 2 - BEAM.tw / 2;
  for (const x of STIFF_X) for (const s of [-1, 1]) {
    box(STIFF_T, stiffH, stiffW, M.plate, x, BEAM.d / 2, s * (BEAM.tw / 2 + stiffW / 2), beam);
  }
  for (const s of [-1, 1]) box(0.016, BEAM.d + 0.04, BEAM.bf + 0.06, M.steel, s * (BEAM.L / 2 + 0.008), BEAM.d / 2, 0, beam);
  // tacks (beam frame): two small tacks at each near side seam
  const SEAMS = [];   // near side, in beam frame: {x, side, a, b}
  for (const x of STIFF_X) for (const side of [-1, 1]) {
    const sx = x + side * (STIFF_T / 2 + 0.002), sz = -BEAM.tw / 2 - 0.002;
    SEAMS.push({ x, side, a: V(sx, BEAM.tf + 0.04, sz), b: V(sx, BEAM.d - BEAM.tf - 0.05, sz) });
    for (const y of [BEAM.tf + 0.012, BEAM.d - BEAM.tf - 0.014]) box(0.006, 0.014, 0.006, M.tack, sx, y, sz, beam, false);
  }
  const FAR_SEAMS = [];
  for (const x of STIFF_X) for (const side of [-1, 1]) {
    const sx = x + side * (STIFF_T / 2 + 0.002), sz = BEAM.tw / 2 + 0.002;
    FAR_SEAMS.push({ a: V(sx, BEAM.tf + 0.04, sz), b: V(sx, BEAM.d - BEAM.tf - 0.05, sz) });
  }

  // weld beads, seam highlights (beam frame)
  const TUBE_SEG = 40, TUBE_RAD = 6;
  const beads = SEAMS.map(s => {
    const geo = new THREE.TubeGeometry(new THREE.LineCurve3(s.a, s.b), TUBE_SEG, 0.0055, TUBE_RAD, false);
    const m = new THREE.Mesh(geo, M.bead); m.castShadow = false; beam.add(m); m.visible = false;
    return m;
  });
  const hiMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95, depthTest: true });
  const highlights = SEAMS.map(s => {
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(s.a, s.b), 8, 0.013, 8, false), hiMat.clone());
    beam.add(m); m.visible = false; return m;
  });
  const farMat = new THREE.MeshBasicMaterial({ color: 0x9aa3a8, transparent: true, opacity: 0.6 });
  const farMarks = FAR_SEAMS.map(s => {
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(s.a, s.b), 8, 0.01, 6, false), farMat);
    beam.add(m); m.visible = false; return m;
  });

  // ------------------------------------------------------------------ steel stands (sawhorses)
  for (const x of STANDS_X) {
    const g = new THREE.Group(); g.position.set(x, 0, 0); scene.add(g);
    const top = BEAM.y0;
    box(0.16, 0.08, 0.9, M.yellow, 0, top - 0.04, 0, g);
    box(0.2, 0.012, 0.3, M.black, 0, top - 0.006 + 0.006, 0, g, false);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      strut(V(sx * 0.05, top - 0.08, sz * 0.32), V(sx * 0.3, 0.04, sz * 0.46), 0.06, M.yellow, g);
      box(0.12, 0.02, 0.12, M.black, sx * 0.3, 0.05, sz * 0.46, g);
    }
    for (const sz of [-1, 1]) strut(V(-0.24, 0.25, sz * 0.43), V(0.24, 0.25, sz * 0.43), 0.04, M.yellow, g);
  }

  // ------------------------------------------------------------------ floor track
  const track = new THREE.Group(); scene.add(track);
  const tLen = TRACK.x1 - TRACK.x0;
  box(tLen, 0.06, 0.95, M.frameLite, 0, 0.07, TRACK.z, track);
  for (const dz of [-0.3, 0.3]) {
    box(tLen, 0.07, 0.07, M.rail, 0, 0.135, TRACK.z + dz, track);
  }
  box(tLen, 0.03, 0.06, M.black, 0, 0.115, TRACK.z, track);   // rack
  for (const x of [TRACK.x0 + 0.1, TRACK.x1 - 0.1]) box(0.16, 0.3, 0.95, M.yellow, x, 0.19, TRACK.z, track);
  for (let x = TRACK.x0 + 0.5; x < TRACK.x1; x += 1.2) for (const dz of [-0.42, 0.42]) cyl(0.025, 0.02, M.rail, x, 0.11, TRACK.z + dz, track, 8);
  // cable chain trough behind the track
  box(tLen * 0.55, 0.14, 0.3, M.frameLite, -tLen * 0.2, 0.07, TRACK.z - 0.85, track);
  // light curtain posts at the cell corners
  for (const [x, z] of [[CB.x0, CB.z0], [CB.x0, CB.z1], [CB.x1, CB.z0], [CB.x1, CB.z1]]) {
    box(0.09, 1.9, 0.09, M.yellow, x, 0.95, z);
    box(0.06, 1.6, 0.04, M.black, x, 1.05, z + (z < 0 ? 0.06 : -0.06));
  }

  // ------------------------------------------------------------------ C-frame with the robot
  const cframe = new THREE.Group(); scene.add(cframe);
  cframe.position.set(PARK_X, 0, 0);
  const cz = TRACK.z;
  box(1.1, 0.36, 1.0, M.frame, 0, 0.36, cz, cframe);                  // carriage
  box(1.12, 0.06, 1.02, M.orange, 0, 0.56, cz, cframe);
  for (const dx of [-0.42, 0.42]) for (const dz of [-0.3, 0.3]) cyl(0.07, 0.08, M.black, dx, 0.2, cz + dz, cframe, 12).rotation.x = Math.PI / 2;
  box(0.46, MOUNT.y + 0.35 - 0.56, 0.46, M.frame, 0, (MOUNT.y + 0.35 + 0.56) / 2, cz - 0.1, cframe);   // column
  const boomLen = (MOUNT.z + 0.2) - (cz - 0.35);
  box(0.42, 0.38, boomLen, M.frame, 0, MOUNT.y + 0.19, (cz - 0.35) + boomLen / 2, cframe);              // boom
  box(0.44, 0.07, boomLen + 0.02, M.orange, 0, MOUNT.y + 0.41, (cz - 0.35) + boomLen / 2, cframe);
  box(0.5, 0.03, 0.5, M.frameLite, 0, MOUNT.y - 0.015, MOUNT.z, cframe);                                  // mount plate
  // CLOOS on both sides of the boom
  const logoTex = textTex('CLOOS', 512, 128, '#ffffff', null, '700 92px Teko, "Arial Narrow", sans-serif');
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true }));
    p.position.set(s * 0.215, MOUNT.y + 0.19, cz + 0.45); p.rotation.y = s * Math.PI / 2; cframe.add(p);
  }
  // power source and wire drum ride on the carriage back
  box(0.5, 0.8, 0.62, M.frameLite, 0.15, 0.94, cz - 0.62, cframe);
  box(0.52, 0.1, 0.64, M.orange, 0.15, 1.38, cz - 0.62, cframe);
  cyl(0.24, 0.75, M.orange, -0.36, 0.92, cz - 0.62, cframe);
  // cable from the drum up the column to the robot
  strut(V(-0.15, 1.3, cz - 0.4), V(-0.15, MOUNT.y + 0.1, cz - 0.3), 0.06, M.black, cframe);
  strut(V(-0.15, MOUNT.y + 0.1, cz - 0.3), V(-0.15, MOUNT.y + 0.1, MOUNT.z - 0.2), 0.06, M.black, cframe);

  // the robot: QRC410 meshes from the STEP, hung upside down from the boom
  function b64(s, Type) {
    const bin = atob(s), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Type(u8.buffer);
  }
  function geomFrom(p) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b64(p.v, Float32Array), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b64(p.n, Int8Array), 3, true));
    let idx = b64(p.f, Uint32Array);
    if (p.nv < 65535) idx = Uint16Array.from(idx);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }
  const robotRoot = new THREE.Group();
  robotRoot.position.set(0, MOUNT.y, MOUNT.z);
  robotRoot.rotation.z = Math.PI;          // hanging: local +y points down, +z still points at the beam
  cframe.add(robotRoot);
  const joints = [];
  let parent = robotRoot, prev = [0, 0, 0];
  for (const g of R.groups) {
    const node = new THREE.Group();
    node.position.set(g.pivot[0] - prev[0], g.pivot[1] - prev[1], g.pivot[2] - prev[2]);
    for (const p of g.parts) {
      const c = new THREE.Color().setRGB(p.c[0], p.c[1], p.c[2]).convertSRGBToLinear();
      const m = new THREE.Mesh(geomFrom(p), new THREE.MeshStandardMaterial({ color: c, metalness: 0.2, roughness: 0.42 }));
      m.castShadow = true; m.receiveShadow = true;
      node.add(m);
    }
    parent.add(node); parent = node; prev = g.pivot;
    if (g.axis) joints.push({ node, axis: g.axis });
  }
  // RoboScan laser sensor on the last axis, beside the torch neck
  const a6 = joints[5].node;
  const sensor = new THREE.Group(); a6.add(sensor);
  sensor.position.set(0, 0.11, 0.06);
  box(0.09, 0.08, 0.16, M.frame, 0, 0, 0, sensor);
  box(0.092, 0.02, 0.162, M.orange, 0, 0.03, 0, sensor);
  const sensorEye = new THREE.Object3D(); sensorEye.position.set(0, -0.045, 0.06); sensor.add(sensorEye);

  // ------------------------------------------------------------------ kinematics (robot base frame)
  const PIV = R.groups.slice(1).map(g => g.pivot), AX = R.groups.slice(1).map(g => g.axis);
  const LIM = [[-3, 3], [-1.5, 1.4], [-2.2, 1.5], [-3, 3], [-1.45, 2.1], [-3, 3]];
  const mul3 = (A, B) => { const C = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return C; };
  const mv3 = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
  const rot3 = (a, q) => { const c = Math.cos(q), s = Math.sin(q); return a === 'x' ? [1, 0, 0, 0, c, -s, 0, s, c] : a === 'y' ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1]; };
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scl3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k], nrm3 = a => Math.hypot(a[0], a[1], a[2]);
  function fk(q) {
    let Rm = [1, 0, 0, 0, 1, 0, 0, 0, 1], p = PIV[0];
    for (let i = 0; i < 6; i++) { if (i > 0) p = add3(p, mv3(Rm, sub3(PIV[i], PIV[i - 1]))); Rm = mul3(Rm, rot3(AX[i], q[i])); }
    return { p: add3(p, mv3(Rm, R.tcp)), d: mv3(Rm, R.wire) };
  }
  function solve6(A, b) {
    const n = 6, Mx = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(Mx[r][c]) > Math.abs(Mx[p][c])) p = r;
      [Mx[c], Mx[p]] = [Mx[p], Mx[c]];
      const d = Mx[c][c] || 1e-12;
      for (let r = c + 1; r < n; r++) { const k = Mx[r][c] / d; for (let k2 = c; k2 <= n; k2++) Mx[r][k2] -= k * Mx[c][k2]; }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s = Mx[r][n]; for (let c = r + 1; c < n; c++) s -= Mx[r][c] * x[c]; x[r] = s / (Mx[r][r] || 1e-12); }
    return x;
  }
  // damped least squares on TCP position and wire direction (difference residual: no flip trap)
  function ik(pT, dT, q0) {
    const q = q0.slice(), W = 0.25;
    const res = f => [...sub3(pT, f.p), ...scl3(sub3(dT, f.d), W)];
    for (let it = 0; it < 80; it++) {
      const f = fk(q), e = res(f);
      if (nrm3(sub3(pT, f.p)) < 2e-4 && nrm3(sub3(dT, f.d)) < 1e-3) break;
      const J = [];
      for (let j = 0; j < 6; j++) { const qq = q.slice(); qq[j] += 1e-5; const g = res(fk(qq)); J.push(g.map((v, k) => -(v - e[k]) / 1e-5)); }
      const lam = it < 6 ? 0.03 : 0.004, A = [], b = [];
      for (let r = 0; r < 6; r++) {
        A.push(new Array(6));
        for (let c = 0; c < 6; c++) { let s = 0; for (let k = 0; k < 6; k++) s += J[r][k] * J[c][k]; A[r][c] = s + (r === c ? lam * lam : 0); }
        let s = 0; for (let k = 0; k < 6; k++) s += J[r][k] * e[k]; b.push(s);
      }
      const dq = solve6(A, b), mx = Math.max(...dq.map(Math.abs)), st = mx > 0.35 ? 0.35 / mx : 1;
      for (let j = 0; j < 6; j++) q[j] = clamp(q[j] + dq[j] * st, LIM[j][0], LIM[j][1]);
    }
    return q;
  }
  // world point / direction relative to the carriage -> robot base frame (base is rotated 180 deg about z)
  const toBase = p => [-p[0], MOUNT.y - p[1], p[2] - MOUNT.z];
  const dirBase = d => [-d[0], -d[1], d[2]];
  const unit = a => scl3(a, 1 / nrm3(a));
  const ikW = (p, d, seed) => ik(toBase(p), dirBase(unit(d)), seed);

  // Poses, all relative to the carriage (carriage x = 0). The weld program is the same at every
  // stiffener because the carriage parks square to each one.
  const Q0 = [0, 0.6, 0.6, 0, 0.9, 0];
  const PARK = ikW([0, 2.05, -1.05], [0, -1, 0.15], [0, -0.3, 0.3, 0, 1.2, 0]);
  const SCAN = ikW([0, BEAM.top + 0.42, -0.42], [0, -0.75, 0.62], PARK);
  const SAFE = ikW([0, BEAM.top + 0.3, -0.36], [0, -0.8, 0.55], SCAN);
  const by = BEAM.y0;
  const PROG = [-1, 1].map(side => {
    const sx = side * (STIFF_T / 2 + 0.002), sz = -BEAM.tw / 2 - 0.002;
    const a = [sx, by + BEAM.tf + 0.04, sz], b = [sx, by + BEAM.d - BEAM.tf - 0.05, sz];
    const dir = unit([-side * 0.55, -0.3, 0.78]);
    const back = (p, k) => add3(p, scl3(dir, -k));
    const pre = ikW(back(a, 0.16), dir, Q0);
    const path = [];
    let seed = pre;
    for (let i = 0; i <= 24; i++) { seed = ikW(add3(a, scl3(sub3(b, a), i / 24)), dir, seed); path.push(seed); }
    const post = ikW(add3(back(b, 0.16), [0, 0.02, 0]), dir, seed);
    return { side, pre, path, post };
  });
  const along = (path, u) => { const f = clamp(u, 0, 1) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)); return lerpQ(path[i], path[i + 1], f - i); };

  // ------------------------------------------------------------------ scan: laser fan and point cloud
  // Beam cross-section the laser sees from above the near side, in beam frame (y, z) at a given x.
  function profile(x) {
    const pts = [], T = BEAM.tf, D = BEAM.d, hb = BEAM.bf / 2, hw = BEAM.tw / 2;
    for (let i = 0; i <= 10; i++) pts.push([D, lerp(hb, -hb, i / 10)]);                // top flange top
    pts.push([D - T, -hb]);                                                             // near flange tip
    const nearStiff = STIFF_X.some(sx => Math.abs(x - sx) < STIFF_T / 2);
    if (nearStiff) { for (let i = 0; i <= 6; i++) pts.push([lerp(D - T, T, i / 6), -hb]); }  // stiffener edge
    else {
      for (let i = 0; i <= 4; i++) pts.push([D - T, lerp(-hb, -hw, i / 4)]);           // flange underside
      for (let i = 0; i <= 10; i++) pts.push([lerp(D - T, T, i / 10), -hw]);            // web face
      for (let i = 0; i <= 4; i++) pts.push([T, lerp(-hw, -hb, i / 4)]);               // bottom flange top
    }
    pts.push([0, -hb]);
    return pts;
  }
  const SLICES = 360;
  const cloudPos = new Float32Array(SLICES * 40 * 3);
  const sliceStart = new Int32Array(SLICES + 1);
  {
    let n = 0;
    for (let s = 0; s < SLICES; s++) {
      sliceStart[s] = n;
      const x = lerp(BEAM.L / 2 - 0.02, -BEAM.L / 2 + 0.02, s / (SLICES - 1));
      for (const [y, z] of profile(x)) {
        if (n >= SLICES * 40) break;
        cloudPos.set([x, y + (Math.random() - 0.5) * 0.002, z], n * 3); n++;
      }
    }
    sliceStart[SLICES] = n;
  }
  const cloudGeo = new THREE.BufferGeometry();
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(cloudPos, 3));
  const cloudMat = new THREE.PointsMaterial({ color: 0xff3b2f, size: 0.014, transparent: true, opacity: 0.9, depthWrite: false });
  const cloud = new THREE.Points(cloudGeo, cloudMat);
  beam.add(cloud);

  const laserMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const laserGeo = new THREE.BufferGeometry();
  laserGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 9), 3));
  const laserFan = new THREE.Mesh(laserGeo, laserMat); laserFan.frustumCulled = false; scene.add(laserFan);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
  const laserLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xff3020 }));
  laserLine.frustumCulled = false; scene.add(laserLine);

  // ------------------------------------------------------------------ arc: glow, light, sparks
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xd6e6ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.set(0.3, 0.3, 0.3); scene.add(glow);
  const arcLight = new THREE.PointLight(0xa8c8ff, 0, 4, 2); scene.add(arcLight);
  const NSP = 70;
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NSP * 3), 3));
  const sparks = new THREE.Points(spGeo, new THREE.PointsMaterial({ color: 0xffc46b, size: 0.018, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false; scene.add(sparks);
  const spSeed = Array.from({ length: NSP }, () => [Math.random(), Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()]);

  // ------------------------------------------------------------------ operator station and operator
  const station = new THREE.Group(); station.position.set(-8.4, 0, -3.2); station.rotation.y = Math.PI * 0.18; scene.add(station);
  box(0.5, 1.05, 0.4, M.frameLite, 0, 0.55, 0, station);
  box(0.62, 0.42, 0.06, M.black, 0, 1.4, 0.06, station).rotation.x = -0.25;
  const screenCanvas = document.createElement('canvas'); screenCanvas.width = 512; screenCanvas.height = 320;
  const screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.encoding = THREE.sRGBEncoding;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 1.405, 0.095); screen.rotation.x = -0.25; station.add(screen);
  let screenText = null;
  function drawScreen(lines) {
    const key = lines.join('|');
    if (key === screenText) return;
    screenText = key;
    const g = screenCanvas.getContext('2d');
    g.fillStyle = '#1e2529'; g.fillRect(0, 0, 512, 320);
    g.fillStyle = '#db6006'; g.fillRect(0, 0, 512, 54);
    g.fillStyle = '#fff'; g.font = '600 34px Teko, "Arial Narrow", sans-serif'; g.textBaseline = 'middle';
    g.fillText('ROBOSCAN', 22, 30);
    g.font = '600 30px Cairo, Arial, sans-serif';
    lines.forEach((l, i) => { g.fillStyle = i === 0 ? '#ffffff' : '#c6ccd0'; g.fillText(l, 24, 100 + i * 52); });
    screenTex.needsUpdate = true;
  }
  const person = new THREE.Group(); person.position.set(-7.9, 0, -3.95); person.rotation.y = Math.PI * 0.85; scene.add(person);
  for (const s of [-1, 1]) box(0.13, 0.82, 0.16, M.denim, s * 0.1, 0.41, 0, person);
  box(0.42, 0.6, 0.24, M.hivis, 0, 1.12, 0, person);
  for (const s of [-1, 1]) box(0.1, 0.56, 0.12, M.hivis, s * 0.27, 1.1, 0.02, person);
  cyl(0.11, 0.2, M.skin, 0, 1.55, 0, person, 16);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
  helmet.position.set(0, 1.63, 0); helmet.castShadow = true; person.add(helmet);

  // ------------------------------------------------------------------ steps and timeline
  const NEAR_N = SEAMS.length;
  const WELD_CYCLE = 9.0;
  const WELD_END = STIFF_X.length * WELD_CYCLE;
  const DUR = [10, 8, 12.5, 7, WELD_END + 2.5, 12];
  const SPED_UP = [false, false, true, false, true, false];

  // weld timeline inside one stiffener cycle (seconds)
  const WP = { travel: 1.2, toPreA: 1.9, inA: 2.3, weldA: 4.3, outA: 4.7, safeA: 5.3, toPreB: 5.9, inB: 6.3, weldB: 8.3, outB: 8.7 };
  function weldState(t) {
    // returns carriage x, joint values, arc point index (or -1), seams completed fraction per seam
    const done = new Array(NEAR_N).fill(0);
    if (t >= WELD_END) {
      for (let i = 0; i < NEAR_N; i++) done[i] = 1;
      return { x: STIFF_X[STIFF_X.length - 1], q: lerpQ(SAFE, PARK, ease(seg(t, WELD_END, WELD_END + 1.5))), arc: null, done, active: -1 };
    }
    const k = Math.floor(t / WELD_CYCLE), u = t - k * WELD_CYCLE;
    for (let i = 0; i < k * 2; i++) done[i] = 1;
    const prevX = k === 0 ? STIFF_X[0] : STIFF_X[k - 1];
    const x = lerp(prevX, STIFF_X[k], ease(seg(u, 0, WP.travel)));
    const A = PROG[0], B = PROG[1];
    let q, arc = null, active = -1;
    if (u < WP.travel) q = k === 0 ? lerpQ(PARK, SAFE, ease(seg(u, 0, WP.travel))) : SAFE;
    else if (u < WP.toPreA) q = lerpQ(SAFE, A.pre, ease(seg(u, WP.travel, WP.toPreA)));
    else if (u < WP.inA) q = lerpQ(A.pre, A.path[0], ease(seg(u, WP.toPreA, WP.inA)));
    else if (u < WP.weldA) { const f = seg(u, WP.inA, WP.weldA); q = along(A.path, f); arc = { seam: k * 2, f }; done[k * 2] = f; }
    else if (u < WP.outA) { q = lerpQ(A.path[A.path.length - 1], A.post, ease(seg(u, WP.weldA, WP.outA))); done[k * 2] = 1; }
    else if (u < WP.safeA) { q = lerpQ(A.post, SAFE, ease(seg(u, WP.outA, WP.safeA))); done[k * 2] = 1; }
    else if (u < WP.toPreB) { q = lerpQ(SAFE, B.pre, ease(seg(u, WP.safeA, WP.toPreB))); done[k * 2] = 1; }
    else if (u < WP.inB) { q = lerpQ(B.pre, B.path[0], ease(seg(u, WP.toPreB, WP.inB))); done[k * 2] = 1; }
    else if (u < WP.weldB) { const f = seg(u, WP.inB, WP.weldB); q = along(B.path, f); arc = { seam: k * 2 + 1, f }; done[k * 2] = 1; done[k * 2 + 1] = f; }
    else if (u < WP.outB) { q = lerpQ(B.path[B.path.length - 1], B.post, ease(seg(u, WP.weldB, WP.outB))); done[k * 2] = done[k * 2 + 1] = 1; }
    else { q = lerpQ(B.post, SAFE, ease(seg(u, WP.outB, WELD_CYCLE))); done[k * 2] = done[k * 2 + 1] = 1; }
    if (arc) active = arc.seam;
    return { x, q, arc, done, active };
  }

  function setRobot(q) { for (let j = 0; j < 6; j++) joints[j].node.rotation[joints[j].axis] = q[j]; }

  const tmp = new THREE.Vector3();
  let arcOn = false, laserOn = false;
  function setState(step, t, wall) {
    // defaults
    let x = PARK_X, q = PARK, beamY = BEAM.y0, cloudN = 0, cloudOp = 0.9;
    let doneArr = new Array(NEAR_N).fill(0), hi = 0, far = false, arc = null, scanX = null;
    let screenLines = ['Ready', 'Load the part, then start the scan'];
    let crane = { hookY: railY - 1.2, rigged: false };

    if (step === 1) {
      const u = seg(t, 0, 5.2);
      beamY = lerp(BEAM.y0 + 2.3, BEAM.y0, ease(u));
      const lift = ease(seg(t, 5.6, 7.6));
      crane = { hookY: lerp(beamY + BEAM.d + 1.25, railY - 1.2, lift), rigged: t < 5.6, beamY };
      screenLines = t < 5.4 ? ['Ready', 'Crane is setting the part'] : ['Ready', 'Part on the stands'];
    } else if (step >= 2) {
      cloudN = sliceStart[SLICES];
    }
    if (step === 2) {
      x = lerp(PARK_X, SCAN_X0, ease(seg(t, 0, 1.5)));
      q = lerpQ(PARK, SCAN, ease(seg(t, 0, 1.5)));
      const u = seg(t, 1.5, 11.5);
      if (t > 1.5 && t < 11.6) { x = lerp(SCAN_X0, SCAN_X1, u); scanX = x; }
      if (t >= 11.5) x = SCAN_X1;
      const beamX = clamp(x, -BEAM.L / 2, BEAM.L / 2);
      const sl = clamp(Math.round(((BEAM.L / 2 - beamX) / BEAM.L) * (SLICES - 1)), 0, SLICES - 1);
      cloudN = t <= 1.5 ? 0 : (x > BEAM.L / 2 ? 0 : sliceStart[sl + 1]);
      screenLines = t < 1.5 ? ['Starting scan', 'Moving to the part'] : (t < 11.5 ? ['Scanning', Math.round(u * 100) + ' percent of the part'] : ['Scan done', 'Finding the joints']);
    }
    if (step === 3) {
      x = lerp(SCAN_X1, STIFF_X[0], ease(seg(t, 0, 3.0)));
      q = lerpQ(SCAN, PARK, ease(seg(t, 0, 1.2)));
      cloudOp = lerp(0.9, 0.18, ease(seg(t, 0, 2)));
      hi = clamp((t - 1.2) / 2.2, 0, 1);
      far = t > 3.8;
      screenLines = t < 1.2 ? ['Finding joints'] : ['8 joints found', 'Far side: not in view', 'Operator checks, then starts'];
    }
    if (step === 4) {
      const w = weldState(t);
      x = w.x; q = w.q; doneArr = w.done; arc = w.arc;
      cloudN = 0;
      const n = w.done.filter(d => d >= 1).length;
      screenLines = t < WELD_END ? ['Welding', 'Joint ' + Math.min(NEAR_N, (w.active >= 0 ? w.active + 1 : n + 1)) + ' of ' + NEAR_N] : ['Done', NEAR_N + ' of ' + NEAR_N + ' joints welded'];
    }
    if (step === 5) {
      x = lerp(STIFF_X[STIFF_X.length - 1], PARK_X, ease(seg(t, 0, 3.5)));
      doneArr = new Array(NEAR_N).fill(1); cloudN = 0;
      screenLines = ['Done', 'Ready for the next part'];
    }

    // apply
    cframe.position.x = x;
    setRobot(q);
    beam.position.y = beamY;
    // crane rigging
    hookBlock.position.set(0, crane.hookY, 0);
    const ropeTop = railY - 0.7, ropeLen = Math.max(0.05, ropeTop - crane.hookY - 0.14);
    hookRope.scale.y = ropeLen; hookRope.position.set(0, crane.hookY + 0.14 + ropeLen / 2, 0);
    spreader.visible = crane.rigged;
    topSlings.forEach(s => s.mesh.visible = crane.rigged);
    if (crane.rigged) {
      const sy = crane.beamY + BEAM.d + 0.75;
      spreader.position.set(0, sy, 0);
      for (const s of slings) setStrut(s.mesh, V(s.x, 0, 0), V(s.x, crane.beamY + BEAM.d - sy, s.s * 0.11));
      for (const s of topSlings) setStrut(s.mesh, V(0, crane.hookY - 0.14, 0), V(s.x * 2.2, sy + 0.08, 0));
    }
    // cloud
    cloud.visible = cloudN > 0;
    cloudGeo.setDrawRange(0, cloudN);
    cloudMat.opacity = cloudOp;
    // highlights
    highlights.forEach((m, i) => {
      const on = step === 3 && hi > i / NEAR_N;
      m.visible = on;
      if (on) m.material.opacity = 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(wall * 5 + i));
    });
    farMarks.forEach(m => m.visible = step === 3 && far);
    // beads
    beads.forEach((m, i) => {
      const f = doneArr[i];
      m.visible = f > 0;
      m.geometry.setDrawRange(0, Math.ceil(f * TUBE_SEG) * TUBE_RAD * 6);
    });
    // laser
    laserOn = scanX !== null && scanX > -BEAM.L / 2 - 0.3 && scanX < BEAM.L / 2 + 0.3;
    laserFan.visible = laserLine.visible = laserOn;
    if (laserOn) updateLaser(clamp(scanX, -BEAM.L / 2, BEAM.L / 2));
    // arc
    arcOn = !!arc;
    glow.visible = sparks.visible = arcOn;
    arcLight.intensity = arcOn ? 2.2 + Math.sin(wall * 53) * 0.7 + Math.sin(wall * 17) * 0.5 : 0;
    if (arcOn) {
      const s = SEAMS[arc.seam];
      tmp.copy(s.a).lerp(s.b, arc.f); tmp.y += beam.position.y;
      glow.position.copy(tmp); glow.scale.setScalar(0.22 + 0.06 * Math.sin(wall * 41));
      arcLight.position.copy(tmp).add(V(0, 0.05, -0.12));
      updateSparks(tmp, wall);
    }
    drawScreen(screenLines);
  }
  function setStrut(mesh, a, b) {
    const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    mesh.scale.set(1, Math.max(0.001, len), 1);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
  }
  // BoxGeometry(…, 1, …) scaled along y: rebuild sling meshes with unit height
  slings.concat(topSlings).forEach(s => { s.mesh.geometry.dispose(); s.mesh.geometry = new THREE.BoxGeometry(0.035, 1, 0.035); });

  function updateLaser(bx) {
    scene.updateMatrixWorld(true);
    const eye = sensorEye.getWorldPosition(new THREE.Vector3());
    const pts = profile(bx).map(([y, z]) => V(bx, y + beam.position.y, z));
    const fan = laserGeo.attributes.position.array, line = lineGeo.attributes.position.array;
    let n = 0;
    for (let i = 0; i < pts.length - 1 && n < 60; i++, n++) {
      fan.set([eye.x, eye.y, eye.z, pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z], n * 9);
    }
    laserGeo.setDrawRange(0, n * 3);
    laserGeo.attributes.position.needsUpdate = true;
    pts.slice(0, 60).forEach((p, i) => line.set([p.x, p.y, p.z], i * 3));
    lineGeo.setDrawRange(0, Math.min(60, pts.length));
    lineGeo.attributes.position.needsUpdate = true;
    laserGeo.computeBoundingSphere();
  }
  function updateSparks(at, wall) {
    const a = spGeo.attributes.position.array;
    for (let i = 0; i < NSP; i++) {
      const s = spSeed[i], life = (wall * (1.4 + s[3]) + s[0]) % 1;
      const vx = s[1] * 0.9, vz = -0.4 - Math.abs(s[2]) * 0.8, vy = 0.6 + s[3] * 0.8;
      a[i * 3] = at.x + vx * life * 0.5;
      a[i * 3 + 1] = at.y + vy * life * 0.45 - 2.2 * life * life * 0.45;
      a[i * 3 + 2] = at.z + vz * life * 0.45;
    }
    spGeo.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------------ camera per step
  const HERO = params0().get('cam') === 'hero';
  function params0() { return new URLSearchParams(location.hash.slice(1)); }
  function camPose(step, t) {
    const x = cframe.position.x;
    if (HERO) return { pos: V(x + 3.0, 3.4, -4.4), tgt: V(x - 1.2, 1.15, -0.3) };
    switch (step) {
      case 0: { const a = 0.12 * Math.sin(t * 0.09) + 0.05; return { pos: V(Math.sin(a) * 11 - 1.2, 3.5, Math.cos(a) * 11), tgt: V(0.6, 1.35, -1.4) }; }
      case 1: return { pos: V(2.2, 3.1, 4.1), tgt: V(-0.6, 1.7, -0.6) };
      case 2: return { pos: V(x * 0.6 + 1.6, 3.0, 3.5), tgt: V(x, 1.35, -0.9) };
      case 3: return { pos: V(0.4, 1.95, -2.15), tgt: V(-2.6, 1.0, -0.15) };
      case 4: return { pos: V(x + 2.8, 2.1, -3.0), tgt: V(x - 0.1, 1.0, -0.05) };
      default: { const a = 0.1 * Math.sin(t * 0.09) - 0.75; return { pos: V(Math.sin(a) * 12.5, 3.6, Math.cos(a) * 11.5), tgt: V(0.4, 1.3, -1.2) }; }
    }
  }

  // ------------------------------------------------------------------ labels
  const tagsEl = document.getElementById('tags');
  const TAGS = [
    { id: 'awning', text: 'Awning over the cell', at: () => V(-3.2, 3.4, 4.6), steps: [0] },
    { id: 'cframe', text: 'C-frame', at: () => V(cframe.position.x, MOUNT.y + 0.6, TRACK.z - 0.1), steps: [0, 2] },
    { id: 'robot', text: 'QIROX robot', at: () => joints[2].node.getWorldPosition(new THREE.Vector3()), steps: [0, 4] },
    { id: 'track', text: 'Floor track', at: () => V(TRACK.x1 - 1.2, 0.2, TRACK.z), steps: [0] },
    { id: 'stands', text: 'Steel stands', at: () => V(STANDS_X[4], BEAM.y0 - 0.2, 0.45), steps: [0, 1] },
    { id: 'beam', text: 'Tacked beam', at: () => V(-2.0, beam.position.y + BEAM.d + 0.05, 0), steps: [0] },
    { id: 'station', text: 'Operator station', at: () => station.localToWorld(V(0, 1.75, 0)), steps: [0, 3] },
    { id: 'tracklen', text: 'Track longer than the beam', at: () => V(TRACK.x0 + 0.6, 0.25, TRACK.z), steps: [1] },
    { id: 'tacks', text: 'Tacks under 5 mm (0.20 in)', at: () => V(SEAMS[2].a.x, beam.position.y + SEAMS[2].a.y, SEAMS[2].a.z), steps: [1] },
    { id: 'laser', text: 'Laser scanner', at: () => sensor.getWorldPosition(new THREE.Vector3()), steps: [2] },
    { id: 'found', text: 'Joints the scan found', at: () => V(SEAMS[1].b.x, beam.position.y + SEAMS[1].b.y, SEAMS[1].b.z), steps: [3] },
    { id: 'far', text: 'Far side: not in view, turn the beam', at: () => V(FAR_SEAMS[3].b.x, beam.position.y + BEAM.d + 0.02, 0.05), steps: [3] },
  ];
  TAGS.forEach(tg => {
    const el = document.createElement('div');
    el.className = 'tag'; el.innerHTML = '<span></span>';
    el.firstChild.textContent = tg.text;
    tagsEl.appendChild(el); tg.el = el;
  });
  function updateTags(step, t) {
    const w = stage.clientWidth, h = stage.clientHeight;
    for (const tg of TAGS) {
      let show = tg.steps.includes(step);
      if (tg.id === 'far') show = show && t > 3.8;
      if (tg.id === 'found') show = show && t > 2.0;
      if (tg.id === 'tracklen' || tg.id === 'tacks') show = show && t > 5.6;
      if (tg.id === 'laser') show = show && laserOn;
      if (!show) { tg.el.classList.remove('on'); continue; }
      const p = tg.at().project(camera);
      if (p.z > 1 || p.x < -1.1 || p.x > 1.1 || p.y < -1.1 || p.y > 1.1) { tg.el.classList.remove('on'); continue; }
      tg.el.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
      tg.el.classList.add('on');
    }
  }

  // ------------------------------------------------------------------ UI wiring
  const steps = Array.from(document.querySelectorAll('article[data-step]'));
  const chips = Array.from(document.querySelectorAll('[data-go]'));
  const btnPrev = document.getElementById('prev'), btnNext = document.getElementById('next');
  const btnPlay = document.getElementById('play'), spedEl = document.getElementById('sped');
  const N = steps.length;
  let cur = 0, t = 0, playing = true, tour = false, userMoved = false, camT = 1, camFrom = null;
  const params = new URLSearchParams(location.hash.slice(1));
  const fixed = params.has('t');
  if (params.has('clean')) document.body.classList.add('clean');

  function go(i, keepTime) {
    cur = clamp(i, 0, N - 1);
    if (!keepTime) t = 0;
    userMoved = false;
    camFrom = { pos: camera.position.clone(), tgt: controls.target.clone() };
    camT = 0;
    steps.forEach((s, k) => s.hidden = k !== cur);
    chips.forEach((c, k) => { c.classList.toggle('on', k === cur); c.classList.toggle('done', k < cur); c.setAttribute('aria-current', k === cur ? 'step' : 'false'); });
    btnPrev.disabled = cur === 0;
    btnNext.hidden = cur === N - 1;
    spedEl.hidden = !SPED_UP[cur];
    document.body.dataset.step = cur + 1;
    if (!fixed) history.replaceState(null, '', '#step=' + (cur + 1));
  }
  btnPrev.addEventListener('click', () => go(cur - 1));
  btnNext.addEventListener('click', () => go(cur + 1));
  chips.forEach((c, k) => c.addEventListener('click', () => go(k)));
  btnPlay.addEventListener('click', () => {
    playing = !playing;
    if (playing && t >= DUR[cur]) t = 0;
    btnPlay.setAttribute('aria-pressed', String(!playing));
    btnPlay.querySelector('span').textContent = playing ? 'Pause' : 'Play';
  });
  const btnTour = document.getElementById('tour');
  if (btnTour) btnTour.addEventListener('click', () => {
    tour = !tour; btnTour.setAttribute('aria-pressed', String(tour));
    if (tour) { playing = true; btnPlay.querySelector('span').textContent = 'Pause'; }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') go(cur + 1);
    else if (e.key === 'ArrowLeft') go(cur - 1);
    else if (e.key === ' ') { e.preventDefault(); btnPlay.click(); }
  });
  controls.addEventListener('start', () => { userMoved = true; camT = 1; });

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 58 : 40;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  resize();

  // roof fades when the camera is above it, so the cell stays in view
  // (any point of the camera-to-target line that sits above the roof, inside the roof outline)
  const fadeP = new THREE.Vector3();
  function roofFade() {
    let blocks = false;
    for (let i = 0; i <= 16 && !blocks; i++) {
      fadeP.lerpVectors(camera.position, controls.target, i / 16);
      blocks = fadeP.x > ROOF.x0 && fadeP.x < ROOF.x1 && fadeP.z > ROOF.zBack && fadeP.z < ROOF.zFront
        && fadeP.y > roofY(fadeP.z) - 0.05;
    }
    const target = blocks ? 0.14 : 1;
    roofMat.opacity += (target - roofMat.opacity) * 0.15;
    roofMat.depthWrite = roofMat.opacity > 0.9;
  }

  const startStep = clamp((parseInt(params.get('step'), 10) || 1) - 1, 0, N - 1);
  go(startStep);
  if (fixed) { t = parseFloat(params.get('t')) || 0; playing = false; }

  let last = performance.now(), wall = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    wall += dt;
    if (playing) {
      t += dt;
      if (t >= DUR[cur]) {
        if (tour && cur < N - 1 && t >= DUR[cur] + 1.5) go(cur + 1);
        else if (cur === 0 || cur === N - 1) { /* overview steps keep orbiting */ }
        else t = Math.min(t, DUR[cur]);
      }
    }
    document.body.classList.toggle('stepdone', t >= DUR[cur] && cur < N - 1);
    setState(cur, Math.min(t, DUR[cur]), fixed ? 1.3 : wall);
    const pose = camPose(cur, t);
    if (fixed) {
      camera.position.copy(pose.pos); controls.target.copy(pose.tgt);
    } else if (!userMoved) {
      if (camT < 1) {
        camT = Math.min(1, camT + dt / 1.6);
        const u = ease(camT);
        camera.position.lerpVectors(camFrom.pos, pose.pos, u);
        controls.target.lerpVectors(camFrom.tgt, pose.tgt, u);
      } else {
        const k = 1 - Math.exp(-dt * 3);
        camera.position.lerp(pose.pos, k); controls.target.lerp(pose.tgt, k);
      }
    }
    controls.update();
    roofFade();
    renderer.render(scene, camera);
    updateTags(cur, t);
    requestAnimationFrame(frame);
  }
  document.body.classList.add('ready');
  window.CELL3D_READY = true;
  requestAnimationFrame(frame);
})();
