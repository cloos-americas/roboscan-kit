// RoboScan steel cell in 3D: a QIROX QRC410 hanging from a C-frame that rolls on a floor track,
// a tacked W-beam lying web flat on steel stands, inside a closed shop bay (front wall cut away).
// The C-frame is the real CLOOS RP-C geometry, the laser scanner rides on the C-frame, and ring
// positioners appear as an option. Illustration, not to scale.
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
  // The beam lies web flat (flanges stand up as walls), the way RoboScan steel cells load it: the
  // scanner looks down at the web and every stiffener joint on it. The beam turns about its own
  // axis (x) through the web centre.
  const BEAM = { L: 9.0, d: 0.46, bf: 0.28, tf: 0.018, tw: 0.011, y0: 0.86 };
  BEAM.cy = BEAM.y0 + BEAM.bf / 2;                  // web centre height (turning axis)
  BEAM.top = BEAM.y0 + BEAM.bf;                     // top of the flanges
  const STIFF_X = [-3.0, -1.0, 1.0, 3.0];
  const STIFF_T = 0.012;
  const STANDS_X = [-3.9, -2.0, 0, 2.0, 3.9];
  const POS_X = [-4.25, 4.25];                      // ring positioners (option step)
  const CF = window.CFRAME;
  const MOUNT = { y: 2.6, z: -1.2 };                // robot mount under the boom tip, 2.4 m reach from the column
  const CARRIAGE_TOP = 0.42;                        // floor track 0.28 m + carriage 0.14 m
  const TRACK = { x0: -7.2, x1: 7.2, z: MOUNT.z + (CF ? CF.columnZ : -2.4) };
  const SCAN_OFF = -0.55;                           // scanner sits 0.55 m from the robot along the boom tip
  const PARK_X = 5.6;
  const SCAN_X0 = 5.1, SCAN_X1 = -4.0;              // carriage travel while scanning (scanner covers the whole beam)
  const WELD_DX = 0.45;                             // the robot stands this far to the open side of each joint
  const ROOF = { x0: -13, x1: 13, zBack: -8, zFront: 6.5, yBack: 8.0, yFront: 7.0 };   // the hall

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
    g.fillStyle = '#8f8e89'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 9000, 0.35, ['#7d7c78', '#a3a29d', '#878681']);
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
  const pad = new THREE.Mesh(new THREE.BoxGeometry(26, 0.04, 14.5), new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 }));
  pad.position.set(0, 0.02, -0.75); pad.receiveShadow = true; scene.add(pad);
  // painted floor: yellow cell boundary and a hatched walkway at the operator side
  const paint = mat(0xe8b511, { roughness: 0.8 });
  function floorLine(x0, z0, x1, z1, wdt = 0.1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, wdt), paint);
    m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(z1 - z0, x1 - x0);
    m.position.set((x0 + x1) / 2, 0.042, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m);
  }
  const CB = { x0: -7.7, x1: 7.7, z0: -5.2, z1: 1.4 };
  floorLine(CB.x0, CB.z0, CB.x1, CB.z0); floorLine(CB.x0, CB.z1, CB.x1, CB.z1);
  floorLine(CB.x0, CB.z0, CB.x0, CB.z1); floorLine(CB.x1, CB.z0, CB.x1, CB.z1);
  for (let i = 0; i < 9; i++) floorLine(-10.0 + i * 0.25, -5.2, -9.6 + i * 0.25, -3.4, 0.07);

  // neighbouring buildings fill the view out of the cut-away front, so nothing reads as an open yard
  const farWall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, metalness: 0.15, color: 0xb9c0c5 });
  box(90, 12, 0.6, farWall, 0, 6, 26, null, false);
  box(0.6, 12, 60, farWall, -40, 6, 0, null, false);
  box(0.6, 12, 60, farWall, 40, 6, 0, null, false);
  for (const x of [-18, 0, 18]) box(7, 6, 0.2, mat(0x8f979c, { metalness: 0.4 }), x, 3, 25.6, null, false);

  // ------------------------------------------------------------------ enclosed shop bay
  // RoboScan is not made for outdoors: the cell sits inside a closed, lit hall. The front wall is
  // cut away (and labelled so) so the viewer can see in; the other three walls and the roof are whole.
  const hall = new THREE.Group(); scene.add(hall);
  const roofY = z => lerp(ROOF.yBack, ROOF.yFront, (z - ROOF.zBack) / (ROOF.zFront - ROOF.zBack));
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
  const W = ROOF.x1 - ROOF.x0, Dz = ROOF.zFront - ROOF.zBack;
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(W, ROOF.yBack), wallMat);
  backWall.position.set(0, ROOF.yBack / 2, ROOF.zBack); backWall.receiveShadow = true; hall.add(backWall);
  for (const sx of [-1, 1]) {   // side walls follow the roof slope
    const g = new THREE.Shape();
    g.moveTo(ROOF.zBack, 0); g.lineTo(ROOF.zFront, 0); g.lineTo(ROOF.zFront, ROOF.yFront); g.lineTo(ROOF.zBack, ROOF.yBack); g.closePath();
    const wm = new THREE.Mesh(new THREE.ShapeGeometry(g), wallMat);
    wm.rotation.y = -Math.PI / 2; wm.position.set(sx * W / 2, 0, 0); wm.receiveShadow = true; hall.add(wm);
    // cut edge trim on the open front
    box(0.12, ROOF.yFront, 0.12, M.frame, sx * W / 2, ROOF.yFront / 2, ROOF.zFront, hall, false);
  }
  box(W + 0.12, 0.25, 0.12, M.orange, 0, ROOF.yFront - 0.12, ROOF.zFront, hall, false);
  // closed roll-up door and a man door in the right wall, wall heater on the back wall
  box(0.1, 5.2, 5.0, mat(0x8f979c, { metalness: 0.4, roughness: 0.5 }), W / 2 - 0.06, 2.6, -1.5, hall, false);
  for (let i = 1; i < 12; i++) box(0.11, 0.02, 5.0, M.column, W / 2 - 0.07, i * 0.43, -1.5, hall, false);
  box(0.1, 2.2, 1.0, M.orange, W / 2 - 0.06, 1.1, 3.6, hall, false);
  const heater = new THREE.Group(); heater.position.set(-6.5, 5.0, ROOF.zBack + 0.45); hall.add(heater);
  box(1.0, 0.7, 0.6, M.white, 0, 0, 0, heater, false);
  for (let i = 0; i < 5; i++) box(0.9, 0.03, 0.02, M.frameLite, 0, -0.25 + i * 0.12, 0.31, heater, false);
  // high windows in the back wall
  for (let i = 0; i < 7; i++) box(2.4, 0.9, 0.06, mat(0x9fb6c6, { metalness: 0.6, roughness: 0.15 }), -10.5 + i * 3.5, ROOF.yBack - 1.2, ROOF.zBack + 0.04, hall, false);
  // portal frames: columns on the walls, rafters across, purlins along
  for (let x = ROOF.x0 + 0.2; x <= ROOF.x1; x += (W - 0.4) / 4) {
    for (const z of [ROOF.zBack + 0.2]) {
      const h = roofY(z) - 0.2;
      const c = wShape(h, 0.36, 0.3, 0.016, 0.01, M.column, hall, false);
      c.rotation.x = Math.PI / 2; c.position.set(x, h / 2, z);
    }
    strut(V(x, roofY(ROOF.zBack) - 0.25, ROOF.zBack), V(x, roofY(ROOF.zFront) - 0.25, ROOF.zFront), 0.3, M.column, hall);
  }
  for (let z = ROOF.zBack + 0.6; z < ROOF.zFront; z += 1.5) box(W, 0.14, 0.09, M.column, 0, roofY(z) - 0.08, z, hall, false);
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  const slope = Math.atan2(ROOF.yBack - ROOF.yFront, Dz);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, Math.hypot(Dz, ROOF.yBack - ROOF.yFront) + 0.4), roofMat);
  roof.rotation.x = -Math.PI / 2 + slope;
  roof.position.set(0, (ROOF.yBack + ROOF.yFront) / 2 + 0.03, (ROOF.zBack + ROOF.zFront) / 2);
  roof.receiveShadow = true;
  hall.add(roof);
  // LED high bays
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e5, emissiveIntensity: 1.2 });
  for (const x of [-9, -3, 3, 9]) for (const z of [-4.5, 0.5, 4.5]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 20), ledMat);
    l.position.set(x, roofY(z) - 0.6, z); hall.add(l);
  }
  const under = new THREE.PointLight(0xfff3e0, 0.4, 22, 1.4); under.position.set(0, 5.5, -0.8); scene.add(under);

  // steel stock on dunnage along the back wall
  function stockPile(x, z, n, layers) {
    for (let l = 0; l < layers; l++) {
      for (const dz of [-2.6, 0, 2.6]) box(0.12, 0.12, 0.2 + n * 0.32, mat(0x7b5a3a, { roughness: 0.9 }), x + dz, 0.06 + l * 0.42, z, null);
      for (let i = 0; i < n; i++) {
        const b = wShape(7, 0.3, 0.15, 0.012, 0.008, M.millscale, null, true);
        b.position.set(x, 0.27 + l * 0.42, z - (n - 1) * 0.16 + i * 0.32);
      }
    }
  }
  stockPile(6.0, ROOF.zBack + 1.4, 3, 2);

  // monorail hoist over the stands, hung from the rafters
  const railY = 5.9;
  const mono = wShape(11, 0.3, 0.15, 0.014, 0.009, M.yellow, hall, true);
  mono.position.set(0, railY, 0);
  for (const x of [-4.8, 0, 4.8]) strut(V(x, railY + 0.15, 0), V(x, roofY(0) - 0.3, 0), 0.08, M.column, hall);
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

  // ------------------------------------------------------------------ the beam (web flat, stiffeners both sides)
  // beamRoot sits on the turning axis (web centre). Beam frame: x along the beam, y up through the
  // web, z across (flanges at z = +-d/2). Upper side joints are welded; the underside is "the other side".
  const beamRoot = new THREE.Group(); scene.add(beamRoot);
  beamRoot.position.set(0, BEAM.cy, 0);
  const beam = new THREE.Group(); beamRoot.add(beam);
  const hw = BEAM.tw / 2, hb = BEAM.bf / 2, hd = BEAM.d / 2, T = BEAM.tf;
  box(BEAM.L, BEAM.tw, BEAM.d - 2 * T, M.millscale, 0, 0, 0, beam);                       // web (flat)
  for (const s of [-1, 1]) box(BEAM.L, BEAM.bf, T, M.millscale, 0, 0, s * (hd - T / 2), beam);   // flanges (walls)
  for (const s of [-1, 1]) box(0.016, BEAM.bf + 0.04, BEAM.d + 0.04, M.plate, s * (BEAM.L / 2 + 0.008), 0, 0, beam);   // end plates
  const stiffH = hb - hw - 0.006, stiffW = BEAM.d - 2 * T;
  for (const x of STIFF_X) for (const s of [-1, 1]) box(STIFF_T, stiffH, stiffW, M.plate, x, s * (hw + stiffH / 2), 0, beam);
  // joints: stiffener to web fillets, one each side of every stiffener, near flange to far flange
  const SEAMS = [], FAR_SEAMS = [];
  const zA = -(hd - T - 0.035), zB = hd - T - 0.035;
  for (const x of STIFF_X) for (const side of [-1, 1]) {
    const sx = x + side * (STIFF_T / 2 + 0.003);
    SEAMS.push({ x, side, a: V(sx, hw + 0.003, zA), b: V(sx, hw + 0.003, zB) });
    FAR_SEAMS.push({ a: V(sx, -hw - 0.003, zA), b: V(sx, -hw - 0.003, zB) });
    for (const z of [zA - 0.012, zB + 0.012]) {
      box(0.006, 0.006, 0.014, M.tack, sx, hw + 0.003, z, beam, false);
      box(0.006, 0.006, 0.014, M.tack, sx, -hw - 0.003, z, beam, false);
    }
  }
  const TUBE_SEG = 40, TUBE_RAD = 6;
  const tube = (s, r, seg = 8, rad = 8) => new THREE.TubeGeometry(new THREE.LineCurve3(s.a, s.b), seg, r, rad, false);
  const beads = SEAMS.map(s => { const m = new THREE.Mesh(tube(s, 0.0055, TUBE_SEG, TUBE_RAD), M.bead); m.visible = false; beam.add(m); return m; });
  const farBeads = FAR_SEAMS.map(s => { const m = new THREE.Mesh(tube(s, 0.0055, 8, 6), M.bead); m.visible = false; beam.add(m); return m; });
  const hiMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95 });
  const highlights = SEAMS.map(s => { const m = new THREE.Mesh(tube(s, 0.011), hiMat.clone()); m.visible = false; beam.add(m); return m; });
  const farMat = new THREE.MeshBasicMaterial({ color: 0x9aa3a8, transparent: true, opacity: 0.75 });
  const farMarks = FAR_SEAMS.map(s => { const m = new THREE.Mesh(tube(s, 0.009), farMat); m.visible = false; beam.add(m); return m; });
  const farHi = FAR_SEAMS.map(s => { const m = new THREE.Mesh(tube(s, 0.011), hiMat.clone()); m.visible = false; beam.add(m); return m; });
  const toWorld = (p) => beamRoot.localToWorld(p.clone());
  const checkMat = new THREE.MeshBasicMaterial({ color: 0x2fbf55 });
  const checks = SEAMS.map(s => { const m = new THREE.Mesh(tube(s, 0.0085), checkMat); m.visible = false; beam.add(m); return m; });

  // ------------------------------------------------------------------ steel stands (sawhorses)
  const stands = new THREE.Group(); scene.add(stands);
  for (const x of STANDS_X) {
    const g = new THREE.Group(); g.position.set(x, 0, 0); stands.add(g);
    const top = BEAM.y0;
    box(0.16, 0.08, 0.95, M.yellow, 0, top - 0.04, 0, g);
    for (const sz of [-1, 1]) box(0.2, 0.012, 0.12, M.black, 0, top + 0.006 - 0.006, sz * (hd - T / 2), g, false);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      strut(V(sx * 0.05, top - 0.08, sz * 0.34), V(sx * 0.3, 0.04, sz * 0.48), 0.06, M.yellow, g);
      box(0.12, 0.02, 0.12, M.black, sx * 0.3, 0.05, sz * 0.48, g);
    }
    for (const sz of [-1, 1]) strut(V(-0.24, 0.25, sz * 0.45), V(0.24, 0.25, sz * 0.45), 0.04, M.yellow, g);
  }

  // ------------------------------------------------------------------ ring positioners (option)
  const cfMat = mat(0x141719, { metalness: 0.3, roughness: 0.55 });   // CLOOS black (C-frame, positioners)
  // "Pac-Man" rings: an open ring the crane drops the beam into, turned on rollers in a base.
  const positioners = new THREE.Group(); scene.add(positioners);
  const rings = [];
  const RING_R0 = 0.35, RING_R1 = 0.52, MOUTH = 1.05;           // inner, outer radius, mouth opening (rad)
  for (const x of POS_X) {
    const g = new THREE.Group(); g.position.set(x, 0, 0); positioners.add(g);
    // base with two support rollers and a drive box
    box(0.46, 0.2, 1.4, cfMat, 0, 0.1, 0, g);
    box(0.32, 0.36, 0.2, cfMat, 0, 0.36, -0.5, g);
    box(0.32, 0.36, 0.2, cfMat, 0, 0.36, 0.5, g);
    for (const z of [-0.34, 0.34]) {
      const r = cyl(0.11, 0.3, M.rail, 0, BEAM.cy - Math.sqrt(Math.max(0, (RING_R1 + 0.11) ** 2 - z * z)), z, g, 20);
      r.rotation.z = Math.PI / 2;
    }
    box(0.28, 0.28, 0.28, M.orange, 0, 0.34, -0.78, g);         // drive
    // the ring: annulus with a mouth, extruded along x
    const sh = new THREE.Shape();
    const a0 = Math.PI / 2 + MOUTH / 2, a1 = Math.PI / 2 - MOUTH / 2 + Math.PI * 2;
    sh.absarc(0, 0, RING_R1, a0, a1, false);
    sh.absarc(0, 0, RING_R0, a1, a0, true);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: false, curveSegments: 48 });
    geo.translate(0, 0, -0.08);
    const ringPivot = new THREE.Group(); ringPivot.position.set(0, BEAM.cy, 0); g.add(ringPivot);
    const ring = new THREE.Mesh(geo, cfMat); ring.rotation.y = Math.PI / 2; ring.castShadow = true; ring.receiveShadow = true;
    ringPivot.add(ring);
    const band = new THREE.Shape();
    band.absarc(0, 0, RING_R1 + 0.002, a0, a1, false);
    band.absarc(0, 0, RING_R1 - 0.06, a1, a0, true);
    const bandGeo = new THREE.ExtrudeGeometry(band, { depth: 0.17, bevelEnabled: false, curveSegments: 48 });
    bandGeo.translate(0, 0, -0.085);
    const bm = new THREE.Mesh(bandGeo, M.orange); bm.rotation.y = Math.PI / 2; ringPivot.add(bm);
    // clamp jaws that hold the beam (move with the ring)
    for (const s of [-1, 1]) box(0.14, 0.08, RING_R0 - hd + 0.02, M.frame, 0, 0, s * (hd + (RING_R0 - hd) / 2), ringPivot);
    box(0.14, RING_R0 - hb + 0.02, 0.1, M.frame, 0, -(hb + (RING_R0 - hb) / 2), 0, ringPivot);   // bottom jaw (the mouth is open on top)
    rings.push(ringPivot);
  }
  positioners.visible = false;

  // ------------------------------------------------------------------ floor track (CLOOS floor track: covered, rack and drag chain)
  const track = new THREE.Group(); scene.add(track);
  const tLen = TRACK.x1 - TRACK.x0;
  box(tLen, 0.06, 1.77, M.frameLite, 0, 0.07, TRACK.z, track);                        // base frame
  for (const dz of [-0.6, 0.6]) {
    box(tLen, 0.16, 0.12, M.frame, 0, 0.18, TRACK.z + dz, track);                       // rail beams
    box(tLen, 0.04, 0.06, M.rail, 0, 0.28, TRACK.z + dz, track);                        // rail heads
  }
  box(tLen, 0.17, 1.0, M.black, 0, 0.175, TRACK.z, track);                              // centre cover
  for (const x of [TRACK.x0 + 0.1, TRACK.x1 - 0.1]) box(0.18, 0.4, 1.77, M.yellow, x, 0.2, TRACK.z, track);   // end stops
  for (let x = TRACK.x0 + 0.5; x < TRACK.x1; x += 1.2) for (const dz of [-0.82, 0.82]) cyl(0.028, 0.02, M.rail, x, 0.11, TRACK.z + dz, track, 8);
  box(tLen * 0.55, 0.16, 0.32, M.frameLite, -tLen * 0.2, 0.08, TRACK.z - 1.15, track);    // drag chain channel
  for (let x = TRACK.x0 + 0.3; x < TRACK.x0 + 0.3 + tLen * 0.5; x += 0.09) box(0.07, 0.07, 0.2, M.black, x, 0.2, TRACK.z - 1.15, track, false);   // drag chain links
  // cell boundary posts (light curtains)
  for (const [x, z] of [[CB.x0, CB.z0], [CB.x0, CB.z1], [CB.x1, CB.z0], [CB.x1, CB.z1]]) {
    box(0.09, 1.9, 0.09, M.yellow, x, 0.95, z);
    box(0.06, 1.6, 0.04, M.black, x, 1.05, z + (z < 0 ? 0.06 : -0.06));
  }

  // ------------------------------------------------------------------ C-frame (real RP-C geometry) with the robot
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
  const cframe = new THREE.Group(); scene.add(cframe);
  cframe.position.set(PARK_X, 0, 0);
  const cz = TRACK.z;
  // carriage on the track
  box(1.9, 0.14, 1.6, M.frame, 0, CARRIAGE_TOP - 0.07, cz, cframe);
  box(1.92, 0.04, 1.62, M.orange, 0, CARRIAGE_TOP - 0.16, cz, cframe, false);
  // the C-frame itself (CLOOS RP-C, from its STEP), black like the real ones
  if (CF) {
    const m = new THREE.Mesh(geomFrom(CF), cfMat);
    m.position.set(0, MOUNT.y, MOUNT.z); m.castShadow = true; m.receiveShadow = true;
    cframe.add(m);
  } else {
    box(0.6, MOUNT.y - CARRIAGE_TOP, 0.75, cfMat, 0, (MOUNT.y + CARRIAGE_TOP) / 2, cz, cframe);
    box(0.45, 0.36, MOUNT.z - cz + 0.3, cfMat, 0, MOUNT.y + 0.18, (MOUNT.z + cz) / 2, cframe);
  }
  const logoTex = textTex('CLOOS', 512, 128, '#ffffff', null, '700 92px Teko, "Arial Narrow", sans-serif');
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true }));
    p.position.set(s * 0.262, MOUNT.y + 0.17, MOUNT.z - 1.15); p.rotation.y = s * Math.PI / 2; cframe.add(p);
  }
  // power source and wire drum ride on the carriage, behind the column
  box(0.5, 0.8, 0.6, M.frameLite, 0.62, CARRIAGE_TOP + 0.4, cz - 0.3, cframe);
  box(0.52, 0.08, 0.62, M.orange, 0.62, CARRIAGE_TOP + 0.82, cz - 0.3, cframe);
  cyl(0.24, 0.72, M.orange, -0.62, CARRIAGE_TOP + 0.36, cz - 0.35, cframe);
  strut(V(-0.36, CARRIAGE_TOP + 0.6, cz - 0.2), V(-0.36, MOUNT.y + 0.05, cz + 0.2), 0.05, M.black, cframe);
  strut(V(-0.36, MOUNT.y + 0.05, cz + 0.2), V(-0.2, MOUNT.y + 0.05, MOUNT.z - 0.25), 0.05, M.black, cframe);

  // the RoboScan laser scanner: on the C-frame (not on the robot), on a bracket off the boom tip,
  // looking down at the beam, long side across the beam
  const scanner = new THREE.Group(); cframe.add(scanner);
  scanner.position.set(SCAN_OFF, MOUNT.y - 0.05, MOUNT.z + 0.32);
  scanner.rotation.x = -0.42;                         // tilted toward the beam
  const bracket = mat(0x6d757b, { metalness: 0.5, roughness: 0.45 });
  box(0.7, 0.1, 0.16, bracket, SCAN_OFF / 2 - 0.2, MOUNT.y + 0.05, MOUNT.z + 0.08, cframe);           // arm off the boom tip
  box(0.16, 0.1, 0.42, bracket, SCAN_OFF, MOUNT.y + 0.05, MOUNT.z + 0.22, cframe);                       // reaches toward the beam
  box(0.18, 0.02, 0.36, bracket, SCAN_OFF, MOUNT.y - 0.005, MOUNT.z + 0.32, cframe, false);               // mounting plate
  const scanBlue = mat(0x2a63b8, { roughness: 0.45, metalness: 0.2 });
  box(0.16, 0.16, 0.32, scanBlue, 0, -0.1, 0, scanner);                                                   // about 1 ft x 0.5 ft
  box(0.165, 0.025, 0.325, M.black, 0, -0.19, 0, scanner, false);
  box(0.07, 0.012, 0.22, mat(0x101418, { metalness: 0.8, roughness: 0.1 }), 0, -0.203, 0, scanner, false);   // window
  const sensorEye = new THREE.Object3D(); sensorEye.position.set(0, -0.21, 0); scanner.add(sensorEye);

  // the robot: QRC410 meshes from the STEP, hung upside down from the boom
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

  // ------------------------------------------------------------------ kinematics (robot base frame)
  const PIV = R.groups.slice(1).map(g => g.pivot), AX = R.groups.slice(1).map(g => g.axis);
  // A6 turns more than a full turn on a welding robot; the torch neck hangs under at A6 = 180 deg
  const LIM = [[-3, 3], [-1.5, 1.4], [-2.2, 1.5], [-3, 3], [-1.45, 2.1], [-3.5, 3.5]];
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
  function solveN(A, b) {
    const n = b.length, Mx = A.map((r, i) => [...r, b[i]]);
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
  // Damped least squares on TCP position and wire direction, with a soft pull toward a relaxed
  // posture: the torch's free roll is spent keeping A4 and A6 near neutral, so the wrist never
  // corkscrews. A final pass with a lighter pull tightens the TCP onto the joint.
  const RELAX = [0, -0.3, 0.6, 0, -0.9, Math.PI];
  const WQ = [0.02, 0.01, 0.01, 0.12, 0.02, 0.12];
  function ik(pT, dT, q0) {
    const q = q0.slice(), W = 0.25;
    for (const [iters, kq] of [[90, 1], [40, 0.15]]) {
      const res = qq => { const f = fk(qq); return [...sub3(pT, f.p), ...scl3(sub3(dT, f.d), W), ...qq.map((v, j) => WQ[j] * kq * (RELAX[j] - v))]; };
      for (let it = 0; it < iters; it++) {
        const e = res(q), J = [];
        for (let j = 0; j < 6; j++) { const qq = q.slice(); qq[j] += 1e-5; const g = res(qq); J.push(g.map((v, k) => -(v - e[k]) / 1e-5)); }
        const A = [], b = [];
        for (let r = 0; r < 6; r++) {
          A.push(new Array(6));
          for (let c = 0; c < 6; c++) { let s = 0; for (let k = 0; k < e.length; k++) s += J[r][k] * J[c][k]; A[r][c] = s + (r === c ? 1.6e-5 : 0); }
          let s = 0; for (let k = 0; k < e.length; k++) s += J[r][k] * e[k]; b.push(s);
        }
        const dq = solveN(A, b), mx = Math.max(...dq.map(Math.abs)), st = mx > 0.3 ? 0.3 / mx : 1;
        for (let j = 0; j < 6; j++) q[j] = clamp(q[j] + dq[j] * st, LIM[j][0], LIM[j][1]);
        if (mx < 1e-6) break;
      }
    }
    return q;
  }
  const toBase = p => [-p[0], MOUNT.y - p[1], p[2] - MOUNT.z];
  const dirBase = d => [-d[0], -d[1], d[2]];
  const unit = a => scl3(a, 1 / nrm3(a));
  const ikW = (p, d, seed) => ik(toBase(p), dirBase(unit(d)), seed);
  const D2R = Math.PI / 180;
  // Home: arm swung along the track toward the park end, upper arm leaning back 20 deg, elbow
  // open, wrist straight, torch neck under and pointing about 45 deg down. Every axis mid-range.
  const HOME = [-90 * D2R, -20 * D2R, 10 * D2R, 0, 10 * D2R, 180 * D2R];
  // Weld program, relative to the carriage parked WELD_DX to the open side of the joint. The same
  // program serves every stiffener because the carriage stops square to each one.
  const webY = BEAM.cy + hw + 0.003;
  const PROG = [-1, 1].map(side => {
    const sx = side * (STIFF_T / 2 + 0.003) - side * WELD_DX;
    const a = [sx, webY, zA], b = [sx, webY, zB];
    const dir = unit([-side * 0.4, -0.8, 0.2]);
    const back = (p, k) => add3(p, scl3(dir, -k));
    const safe = ikW(add3(back(a, 0.2), [0, 0.42, 0]), dir, RELAX);
    const pre = ikW(back(a, 0.15), dir, safe);
    const path = [];
    let seed = pre;
    for (let i = 0; i <= 24; i++) { seed = ikW(add3(a, scl3(sub3(b, a), i / 24)), dir, seed); path.push(seed); }
    const post = ikW(add3(back(b, 0.15), [0, 0.06, 0]), dir, seed);
    const safeB = ikW(add3(back(b, 0.2), [0, 0.42, 0]), dir, post);
    return { side, safe, pre, path, post, safeB };
  });
  const along = (path, u) => { const f = clamp(u, 0, 1) * (path.length - 1), i = Math.min(path.length - 2, Math.floor(f)); return lerpQ(path[i], path[i + 1], f - i); };

  // ------------------------------------------------------------------ scan: laser fan and point cloud
  // What the laser sees from above at one x: flange tops, the inside of the flanges, the web and,
  // at a stiffener, its top edge. Beam frame (y, z).
  function profile(x) {
    const pts = [];
    const atStiff = STIFF_X.some(sx => Math.abs(x - sx) < STIFF_T / 2 + 0.002);
    for (let i = 0; i <= 3; i++) pts.push([hb, lerp(-hd, -hd + T, i / 3)]);              // near flange top
    if (atStiff) {
      for (let i = 0; i <= 12; i++) pts.push([hw + stiffH, lerp(-hd + T, hd - T, i / 12)]);   // stiffener top edge
    } else {
      for (let i = 0; i <= 3; i++) pts.push([lerp(hb, hw, i / 3), -hd + T]);               // near flange inside
      for (let i = 0; i <= 14; i++) pts.push([hw, lerp(-hd + T, hd - T, i / 14)]);         // web
      for (let i = 0; i <= 3; i++) pts.push([lerp(hw, hb, i / 3), hd - T]);                // far flange inside
    }
    for (let i = 0; i <= 3; i++) pts.push([hb, lerp(hd - T, hd, i / 3)]);                // far flange top
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

  const laserMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const laserGeo = new THREE.BufferGeometry();
  laserGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 9), 3));
  const laserFan = new THREE.Mesh(laserGeo, laserMat); laserFan.frustumCulled = false; scene.add(laserFan);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
  const laserLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xff3020 }));
  laserLine.frustumCulled = false; scene.add(laserLine);
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 3), 3));
  const laserDots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ color: 0xff2d1e, size: 0.022, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  laserDots.frustumCulled = false; scene.add(laserDots);

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
  const station = new THREE.Group(); station.position.set(-8.9, 0, -3.3); station.rotation.y = Math.PI * 0.22; scene.add(station);
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
  const person = new THREE.Group(); person.position.set(-8.4, 0, -4.05); person.rotation.y = Math.PI * 0.85; scene.add(person);
  const PERSON_HOME = { x: -8.4, z: -4.05, ry: Math.PI * 0.85 };
  // weld check walk: from the station into the cell (robot parked), then along the beam
  const WALK = [[-8.4, -4.05], [-8.0, -1.4], [-3.6, -0.85], [3.7, -0.85]];
  for (const s of [-1, 1]) box(0.13, 0.82, 0.16, M.denim, s * 0.1, 0.41, 0, person);
  box(0.42, 0.6, 0.24, M.hivis, 0, 1.12, 0, person);
  for (const s of [-1, 1]) box(0.1, 0.56, 0.12, M.hivis, s * 0.27, 1.1, 0.02, person);
  cyl(0.11, 0.2, M.skin, 0, 1.55, 0, person, 16);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
  helmet.position.set(0, 1.63, 0); helmet.castShadow = true; person.add(helmet);

  // ------------------------------------------------------------------ steps and timeline
  // 0 cell, 1 set the beam, 2 scan, 3 check, 4 weld, 5 operator checks the welds, 6 option: positioners, 7 your parts
  const NEAR_N = SEAMS.length;
  const WELD_CYCLE = 9.0;
  const WELD_END = STIFF_X.length * WELD_CYCLE;
  const DUR = [10, 8, 12.5, 7, WELD_END + 2.0, 13, 10, 12];
  const SPED_UP = [false, false, true, false, true, false, false, false];
  const stopX = (k, side) => STIFF_X[k] + side * WELD_DX;     // carriage stop for one joint

  // one stiffener cycle (seconds): joint on the -x side, then the +x side
  const WP = { travel: 1.0, toPre: 1.6, in: 1.9, weld: 3.8, out: 4.1, up: 4.5, move: 5.4, toPre2: 5.9, in2: 6.2, weld2: 8.1, out2: 8.4 };
  function weldState(t) {
    const done = new Array(NEAR_N).fill(0);
    const A = PROG[0], B = PROG[1];
    if (t >= WELD_END) {
      done.fill(1);
      return { x: stopX(STIFF_X.length - 1, 1), q: lerpQ(B.safeB, HOME, ease(seg(t, WELD_END, WELD_END + 1.6))), arc: null, done, active: -1 };
    }
    const k = Math.floor(t / WELD_CYCLE), u = t - k * WELD_CYCLE;
    for (let i = 0; i < k * 2; i++) done[i] = 1;
    const fromX = k === 0 ? stopX(0, -1) : stopX(k - 1, 1);
    let x, q, arc = null;
    if (u < WP.travel) { x = lerp(fromX, stopX(k, -1), ease(seg(u, 0, WP.travel))); q = k === 0 ? lerpQ(HOME, A.safe, ease(seg(u, 0, WP.travel))) : lerpQ(B.safeB, A.safe, ease(seg(u, 0, WP.travel))); }
    else if (u < WP.toPre) { x = stopX(k, -1); q = lerpQ(A.safe, A.pre, ease(seg(u, WP.travel, WP.toPre))); }
    else if (u < WP.in) { x = stopX(k, -1); q = lerpQ(A.pre, A.path[0], ease(seg(u, WP.toPre, WP.in))); }
    else if (u < WP.weld) { x = stopX(k, -1); const f = seg(u, WP.in, WP.weld); q = along(A.path, f); arc = { seam: k * 2, f }; done[k * 2] = f; }
    else if (u < WP.out) { x = stopX(k, -1); q = lerpQ(A.path[A.path.length - 1], A.post, ease(seg(u, WP.weld, WP.out))); done[k * 2] = 1; }
    else if (u < WP.up) { x = stopX(k, -1); q = lerpQ(A.post, A.safeB, ease(seg(u, WP.out, WP.up))); done[k * 2] = 1; }
    else if (u < WP.move) { x = lerp(stopX(k, -1), stopX(k, 1), ease(seg(u, WP.up, WP.move))); q = lerpQ(A.safeB, B.safe, ease(seg(u, WP.up, WP.move))); done[k * 2] = 1; }
    else if (u < WP.toPre2) { x = stopX(k, 1); q = lerpQ(B.safe, B.pre, ease(seg(u, WP.move, WP.toPre2))); done[k * 2] = 1; }
    else if (u < WP.in2) { x = stopX(k, 1); q = lerpQ(B.pre, B.path[0], ease(seg(u, WP.toPre2, WP.in2))); done[k * 2] = 1; }
    else if (u < WP.weld2) { x = stopX(k, 1); const f = seg(u, WP.in2, WP.weld2); q = along(B.path, f); arc = { seam: k * 2 + 1, f }; done[k * 2] = 1; done[k * 2 + 1] = f; }
    else if (u < WP.out2) { x = stopX(k, 1); q = lerpQ(B.path[B.path.length - 1], B.post, ease(seg(u, WP.weld2, WP.out2))); done[k * 2] = done[k * 2 + 1] = 1; }
    else { x = stopX(k, 1); q = lerpQ(B.post, B.safeB, ease(seg(u, WP.out2, WELD_CYCLE))); done[k * 2] = done[k * 2 + 1] = 1; }
    return { x, q, arc, done, active: arc ? arc.seam : -1 };
  }

  function setRobot(q) { for (let j = 0; j < 6; j++) joints[j].node.rotation[joints[j].axis] = q[j]; }

  const tmp = new THREE.Vector3();
  let arcOn = false, laserOn = false;
  function setState(step, t, wall) {
    let x = PARK_X, q = HOME, beamY = BEAM.cy, flip = 0, cloudN = 0, cloudOp = 0.9;
    let doneArr = new Array(NEAR_N).fill(0), hi = 0, far = false, farLit = 0, arc = null, scanX = null;
    let showPos = false, showStands = true, farDone = false;
    let screenLines = ['Ready', 'Load the part, then start the scan'];
    let crane = { hookY: railY - 1.2, rigged: false };

    if (step === 1) {
      beamY = lerp(BEAM.cy + 2.3, BEAM.cy, ease(seg(t, 0, 5.2)));
      const lift = ease(seg(t, 5.6, 7.6));
      crane = { hookY: lerp(beamY + hb + 1.25, railY - 1.2, lift), rigged: t < 5.6, beamY };
      screenLines = t < 5.4 ? ['Ready', 'Crane is setting the part'] : ['Ready', 'Part on the stands'];
    } else if (step >= 2) {
      cloudN = sliceStart[SLICES];
    }
    if (step === 2) {
      x = lerp(PARK_X, SCAN_X0, ease(seg(t, 0, 1.5)));
      const u = seg(t, 1.5, 11.5);
      if (t > 1.5) x = lerp(SCAN_X0, SCAN_X1, u);
      const sx = x + SCAN_OFF;
      if (t > 1.5 && t < 11.6) scanX = sx;
      const bx = clamp(sx, -BEAM.L / 2, BEAM.L / 2);
      const sl = clamp(Math.round(((BEAM.L / 2 - bx) / BEAM.L) * (SLICES - 1)), 0, SLICES - 1);
      cloudN = t <= 1.5 || sx > BEAM.L / 2 ? 0 : sliceStart[sl + 1];
      screenLines = t < 1.5 ? ['Starting scan', 'C-frame to the start'] : (t < 11.5 ? ['Scanning', Math.round(u * 100) + ' percent of the part'] : ['Scan done', 'Finding the joints']);
    }
    if (step === 3) {
      x = lerp(SCAN_X1, stopX(0, -1), ease(seg(t, 0, 3.0)));
      cloudOp = lerp(0.9, 0.16, ease(seg(t, 0, 2)));
      hi = clamp((t - 1.2) / 2.2, 0, 1);
      far = t > 3.8;
      screenLines = t < 1.2 ? ['Finding joints'] : [NEAR_N + ' joints found', 'Underside: not in view', 'Operator checks, then starts'];
    }
    if (step === 4) {
      const w = weldState(t);
      x = w.x; q = w.q; doneArr = w.done; arc = w.arc; cloudN = 0;
      const n = w.done.filter(d => d >= 1).length;
      screenLines = t < WELD_END ? ['Welding', 'Joint ' + Math.min(NEAR_N, (w.active >= 0 ? w.active + 1 : n + 1)) + ' of ' + NEAR_N] : ['Done', NEAR_N + ' of ' + NEAR_N + ' joints welded'];
    }
    let walker = null, checked = 0;
    if (step === 5) {
      // the robot parks, then the operator walks the beam and checks every weld by hand
      x = lerp(stopX(STIFF_X.length - 1, 1), PARK_X, ease(seg(t, 0, 2.5)));
      doneArr.fill(1); cloudN = 0;
      const legs = [];
      for (let i = 1; i < WALK.length; i++) legs.push(Math.hypot(WALK[i][0] - WALK[i - 1][0], WALK[i][1] - WALK[i - 1][1]));
      const inLen = legs[0] + legs[1], total = inLen + legs[2];
      const d = t < 2.5 ? 0 : (t < 6.0 ? inLen * ease(seg(t, 2.5, 6.0)) : inLen + legs[2] * seg(t, 6.0, 12.0));
      let k = 0, rem = d;
      while (k < legs.length - 1 && rem > legs[k]) { rem -= legs[k]; k++; }
      const f = clamp(rem / legs[k], 0, 1);
      const px = lerp(WALK[k][0], WALK[k + 1][0], f), pz = lerp(WALK[k][1], WALK[k + 1][1], f);
      const moving = t > 2.5 && d < total - 1e-3;
      const ry = k < 2 ? Math.atan2(WALK[k + 1][0] - WALK[k][0], WALK[k + 1][1] - WALK[k][1]) : Math.PI * 0.12;   // walking, then facing the beam
      walker = { x: px, z: pz, ry: t < 2.5 ? PERSON_HOME.ry : ry, bob: moving ? Math.abs(Math.sin(wall * 7)) * 0.025 : 0 };
      checked = t < 6.0 ? -99 : px + 0.25;
      screenLines = t < 2.5 ? ['Robot parked', 'Safe to enter the cell'] : (t < 12.2 ? ['Weld check', 'Operator inspects by hand'] : ['Welds checked', 'Touch up if needed']);
    }
    if (step === 6) {
      x = PARK_X;
      doneArr.fill(1); cloudN = 0;
      showPos = true; showStands = false;
      flip = Math.PI * ease(seg(t, 2.0, 6.5));
      farLit = t > 6.6 ? 1 : 0;
      screenLines = t < 2 ? ['Positioner option', 'Beam held in two rings'] : (t < 6.6 ? ['Turning the beam', Math.round(seg(t, 2.0, 6.5) * 180) + ' degrees'] : ['Turned', 'Other side faces the robot']);
    }
    if (step === 7) {
      x = PARK_X; doneArr.fill(1); cloudN = 0;
      screenLines = ['Done', 'Ready for the next part'];
    }

    // apply
    if (walker) { person.position.set(walker.x, walker.bob, walker.z); person.rotation.y = walker.ry; }
    else { person.position.set(PERSON_HOME.x, 0, PERSON_HOME.z); person.rotation.y = PERSON_HOME.ry; }
    checks.forEach((m, i) => { m.visible = step === 5 && SEAMS[i].a.x < checked; });
    cframe.position.x = x;
    setRobot(q);
    beamRoot.position.y = beamY;
    beamRoot.rotation.x = flip;
    rings.forEach(r => { r.rotation.x = flip; });
    positioners.visible = showPos;
    stands.visible = showStands;
    beamRoot.updateMatrixWorld(true);
    // crane rigging (slings hook under the flange tops)
    hookBlock.position.set(0, crane.hookY, 0);
    const ropeTop = railY - 0.7, ropeLen = Math.max(0.05, ropeTop - crane.hookY - 0.14);
    hookRope.scale.y = ropeLen; hookRope.position.set(0, crane.hookY + 0.14 + ropeLen / 2, 0);
    spreader.visible = crane.rigged;
    topSlings.forEach(s => s.mesh.visible = crane.rigged);
    if (crane.rigged) {
      const sy = crane.beamY + hb + 0.75;
      spreader.position.set(0, sy, 0);
      for (const s of slings) setStrut(s.mesh, V(s.x, 0, 0), V(s.x, crane.beamY + hb - sy, s.s * (hd - T / 2)));
      for (const s of topSlings) setStrut(s.mesh, V(0, crane.hookY - 0.14, 0), V(s.x * 2.2, sy + 0.08, 0));
    }
    // cloud
    cloud.visible = cloudN > 0;
    cloudGeo.setDrawRange(0, cloudN);
    cloudMat.opacity = cloudOp;
    // joint highlights
    highlights.forEach((m, i) => {
      const on = step === 3 && hi > i / NEAR_N;
      m.visible = on;
      if (on) m.material.opacity = 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(wall * 5 + i));
    });
    farMarks.forEach(m => m.visible = step === 3 && far);
    farHi.forEach((m, i) => {
      m.visible = farLit > 0;
      if (m.visible) m.material.opacity = 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(wall * 5 + i));
    });
    // beads
    beads.forEach((m, i) => {
      const f = doneArr[i];
      m.visible = f > 0;
      m.geometry.setDrawRange(0, Math.ceil(f * TUBE_SEG) * TUBE_RAD * 6);
    });
    farBeads.forEach(m => m.visible = farDone);
    // laser from the scanner on the C-frame
    laserOn = scanX !== null && scanX > -BEAM.L / 2 - 0.3 && scanX < BEAM.L / 2 + 0.3;
    laserFan.visible = laserLine.visible = laserDots.visible = laserOn;
    if (laserOn) updateLaser(clamp(scanX, -BEAM.L / 2, BEAM.L / 2));
    // arc
    arcOn = !!arc;
    glow.visible = sparks.visible = arcOn;
    arcLight.intensity = arcOn ? 2.2 + Math.sin(wall * 53) * 0.7 + Math.sin(wall * 17) * 0.5 : 0;
    if (arcOn) {
      const s = SEAMS[arc.seam];
      tmp.copy(s.a).lerp(s.b, arc.f); beamRoot.localToWorld(tmp);
      glow.position.copy(tmp); glow.scale.setScalar(0.22 + 0.06 * Math.sin(wall * 41));
      arcLight.position.copy(tmp).add(V(0, 0.12, -0.1));
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
  slings.concat(topSlings).forEach(s => { s.mesh.geometry.dispose(); s.mesh.geometry = new THREE.BoxGeometry(0.035, 1, 0.035); });

  function updateLaser(bx) {
    scene.updateMatrixWorld(true);
    const eye = sensorEye.getWorldPosition(new THREE.Vector3());
    const pts = profile(bx).map(([y, z]) => beamRoot.localToWorld(V(bx, y, z)));
    const fan = laserGeo.attributes.position.array, line = lineGeo.attributes.position.array;
    let n = 0;
    for (let i = 0; i < pts.length - 1 && n < 60; i++, n++) {
      fan.set([eye.x, eye.y, eye.z, pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z], n * 9);
    }
    laserGeo.setDrawRange(0, n * 3);
    laserGeo.attributes.position.needsUpdate = true;
    pts.slice(0, 60).forEach((p, i) => line.set([p.x, p.y, p.z], i * 3));
    const dots = dotGeo.attributes.position.array; let nd = 0;
    for (let i = 0; i < pts.length - 1 && nd < 400; i++) for (let k = 0; k < 6 && nd < 400; k++, nd++) {
      const u = k / 6; dots.set([lerp(pts[i].x, pts[i + 1].x, u), lerp(pts[i].y, pts[i + 1].y, u) + 0.002, lerp(pts[i].z, pts[i + 1].z, u)], nd * 3);
    }
    dotGeo.setDrawRange(0, nd); dotGeo.attributes.position.needsUpdate = true;
    lineGeo.setDrawRange(0, Math.min(60, pts.length));
    lineGeo.attributes.position.needsUpdate = true;
    laserGeo.computeBoundingSphere();
  }
  function updateSparks(at, wall) {
    const a = spGeo.attributes.position.array;
    for (let i = 0; i < NSP; i++) {
      const s = spSeed[i], life = (wall * (1.4 + s[3]) + s[0]) % 1;
      const vx = s[1] * 0.9, vz = s[2] * 0.9, vy = 0.6 + s[3] * 0.8;
      a[i * 3] = at.x + vx * life * 0.5;
      a[i * 3 + 1] = at.y + vy * life * 0.45 - 2.2 * life * life * 0.45;
      a[i * 3 + 2] = at.z + vz * life * 0.45;
    }
    spGeo.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------------ camera per step
  const HERO = new URLSearchParams(location.hash.slice(1)).get('cam') === 'hero';
  function camPose(step, t) {
    const x = cframe.position.x;
    if (HERO) return { pos: V(x + 3.2, 3.3, -4.4), tgt: V(x - 1.0, 1.0, -0.6) };
    switch (step) {
      case 0: { const a = 0.12 * Math.sin(t * 0.09) + 0.12; return { pos: V(Math.sin(a) * 11 + 0.5, 5.4, Math.cos(a) * 11 - 0.5), tgt: V(1.6, 1.3, -2.2) }; }
      case 1: return { pos: V(3.0, 3.4, 4.2), tgt: V(-0.6, 1.6, -0.6) };
      case 2: return { pos: V(x * 0.6 + 2.4, 3.6, 3.6), tgt: V(x - 0.4, 1.4, -0.9) };
      case 3: return { pos: V(-0.2, 3.5, -3.6), tgt: V(-2.8, 1.1, -0.5) };
      case 4: return { pos: V(x + 3.0, 3.1, -3.7), tgt: V(x - 0.5, 1.25, -0.6) };
      case 5: { const px = person.position.x; return { pos: V(px - 2.2, 3.5, -2.9), tgt: V(px + 0.9, 0.9, -0.1) }; }
      case 6: return { pos: V(7.4, 2.6, 3.4), tgt: V(2.6, 0.95, 0) };
      default: { const a = 0.1 * Math.sin(t * 0.09) - 0.7; return { pos: V(Math.sin(a) * 12.5, 4.0, Math.cos(a) * 11.5), tgt: V(0.4, 1.3, -1.6) }; }
    }
  }

  // ------------------------------------------------------------------ labels
  const tagsEl = document.getElementById('tags');
  const beamPt = (x, y, z) => () => beamRoot.localToWorld(V(x, y, z));
  const TAGS = [
    { id: 'hall', text: 'Inside a closed shop', at: () => V(-10.5, 5.2, ROOF.zBack + 0.3), steps: [0] },
    { id: 'cut', text: 'Front wall cut away', at: () => V(ROOF.x1 - 0.1, 4.8, ROOF.zFront), steps: [0] },
    { id: 'cframe', text: 'CLOOS C-frame', at: () => V(cframe.position.x, MOUNT.y + 0.45, MOUNT.z - 1.4), steps: [0] },
    { id: 'robot', text: 'QIROX robot', at: () => joints[2].node.getWorldPosition(new THREE.Vector3()), steps: [0, 4] },
    { id: 'track', text: 'Floor track', at: () => V(TRACK.x1 - 1.4, 0.35, TRACK.z), steps: [0] },
    { id: 'stands', text: 'Steel stands', at: () => V(STANDS_X[4], BEAM.y0 - 0.25, 0.48), steps: [0, 1] },
    { id: 'beam', text: 'Tacked beam, web flat', at: beamPt(-2.0, hb + 0.02, 0), steps: [0] },
    { id: 'station', text: 'Operator station', at: () => station.localToWorld(V(0, 1.75, 0)), steps: [0, 3] },
    { id: 'tracklen', text: 'Track longer than the beam', at: () => V(TRACK.x0 + 0.7, 0.4, TRACK.z), steps: [1] },
    { id: 'tacks', text: 'Tacks under 5 mm (0.20 in)', at: beamPt(SEAMS[2].a.x, SEAMS[2].a.y, zA - 0.012), steps: [1] },
    { id: 'scanner', text: 'Laser scanner on the C-frame', at: () => scanner.getWorldPosition(new THREE.Vector3()), steps: [2] },
    { id: 'found', text: 'Joints the scan found', at: beamPt(SEAMS[1].b.x, SEAMS[1].b.y, 0), steps: [3] },
    { id: 'far', text: 'Underside: not in view, turn the beam', at: beamPt(FAR_SEAMS[3].a.x, -hb, -hd), steps: [3] },
    { id: 'inspect', text: 'Operator checks every weld', at: () => person.localToWorld(V(0, 1.9, 0)), steps: [5] },
    { id: 'rings', text: 'Ring positioners (option)', at: () => V(POS_X[1], BEAM.cy + RING_R1 + 0.05, 0), steps: [6] },
    { id: 'turned', text: 'Other side now faces the robot', at: beamPt(FAR_SEAMS[5].a.x, FAR_SEAMS[5].a.y, 0), steps: [6] },
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
      if (tg.id === 'scanner') show = show && t > 1.0;
      if (tg.id === 'turned') show = show && t > 6.6;
      if (tg.id === 'inspect') show = show && t > 2.5;
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
