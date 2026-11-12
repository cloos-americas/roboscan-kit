// Typical structural steel parts in 3D, welds in orange. One page serves two jobs:
// - interactive: pick a part, drag to turn it (parts/ page of the kit)
// - stills: #part=<id>&still renders one clean frame on a transparent background for the deck
//   and the kit page (shoot_parts.py). #part=lineup is the cover shot.
// Illustrations of the kind of part RoboScan welds; sizes are typical, not a customer's part.
(function () {
  'use strict';
  const THREE = window.THREE;
  const stage = document.getElementById('stage');
  const params = new URLSearchParams(location.hash.slice(1));
  const STILL = params.has('still');
  if (STILL) document.body.classList.add('still');
  if (!THREE) { document.body.classList.add('no3d'); return; }

  // ------------------------------------------------------------------ renderer and scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(STILL ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.autoRotate = !STILL; controls.autoRotateSpeed = 0.6;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  scene.add(new THREE.HemisphereLight(0xf4f7fa, 0x7d7a74, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(6, 10, 7); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 40 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 0.45); rim.position.set(-8, 5, -6); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  // ------------------------------------------------------------------ materials and helpers
  const MAT = {
    profile: new THREE.MeshStandardMaterial({ color: 0x5f666d, metalness: 0.5, roughness: 0.5 }),
    plate: new THREE.MeshStandardMaterial({ color: 0x9aa2a8, metalness: 0.55, roughness: 0.38 }),
    tube: new THREE.MeshStandardMaterial({ color: 0x6f777e, metalness: 0.5, roughness: 0.45 }),
    hole: new THREE.MeshStandardMaterial({ color: 0x22272b, metalness: 0.2, roughness: 0.8 }),
    weld: new THREE.MeshStandardMaterial({ color: new THREE.Color(0xdb6006).convertSRGBToLinear(), emissive: new THREE.Color(0x7a2600).convertSRGBToLinear(), emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.1 }),   // CLOOS orange, sRGB
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function box(w, h, d, m, x, y, z, parent) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  function strut(a, b, w, h, m, parent, up) {     // rectangular bar from a to b
    const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, len, h), m);
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
    if (up) mesh.rotateY(up);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  const R = 0.0085;                                  // weld bead radius
  function weld(points, parent, closed) {
    const pts = closed ? points.concat([points[0]]) : points;
    const path = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    const segs = Math.max(4, Math.round(path.getLength() / 0.02));
    const m = new THREE.Mesh(new THREE.TubeGeometry(path, segs, R, 6, false), MAT.weld);
    m.castShadow = false; parent.add(m); return m;
  }
  // W/H shape along x, web vertical, centred on the web
  function wShape(L, d, bf, tf, tw, parent, m = MAT.profile) {
    const g = new THREE.Group();
    box(L, tf, bf, m, 0, d / 2 - tf / 2, 0, g);
    box(L, tf, bf, m, 0, -d / 2 + tf / 2, 0, g);
    box(L, d - 2 * tf, tw, m, 0, 0, 0, g);
    parent.add(g); return g;
  }
  // weld outline of an I-profile where it meets a plate at x = px (bead sits on the plate side s)
  function profileWeld(px, d, bf, tf, tw, g) {
    const e = R * 0.9, y1 = d / 2, y2 = d / 2 - tf;
    weld([V(px, y1 + e, -bf / 2), V(px, y1 + e, bf / 2)], g);                 // top of top flange
    weld([V(px, -y1 - e, -bf / 2), V(px, -y1 - e, bf / 2)], g);               // bottom of bottom flange
    for (const s of [-1, 1]) {
      weld([V(px, y2 - e, s * bf / 2), V(px, y2 - e, s * (tw / 2 + e)), V(px, -y2 + e, s * (tw / 2 + e)), V(px, -y2 + e, s * bf / 2)], g);
    }
  }

  // ------------------------------------------------------------------ the parts
  const BUILD = {
    'beam-stiffeners'(g) {
      const L = 4.0, d = 0.46, bf = 0.19, tf = 0.016, tw = 0.01, y = d / 2 + 0.04;
      const p = new THREE.Group(); p.position.y = y; g.add(p);
      wShape(L, d, bf, tf, tw, p);
      const t = 0.012, h = d - 2 * tf, w = bf / 2 - tw / 2 - 0.004;
      for (const x of [-1.3, 0, 1.3]) for (const s of [-1, 1]) {
        box(t, h, w, MAT.plate, x, 0, s * (tw / 2 + w / 2), p);
        for (const f of [-1, 1]) {
          const fx = x + f * (t / 2 + R);
          weld([V(fx, h / 2 - 0.02, s * (tw / 2 + R)), V(fx, -h / 2 + 0.02, s * (tw / 2 + R))], p);
          weld([V(fx, h / 2 - R, s * (tw / 2 + 0.01)), V(fx, h / 2 - R, s * (tw / 2 + w))], p);
          weld([V(fx, -h / 2 + R, s * (tw / 2 + 0.01)), V(fx, -h / 2 + R, s * (tw / 2 + w))], p);
        }
      }
      for (const s of [-1, 1]) {
        box(0.02, d + 0.1, bf + 0.08, MAT.plate, s * (L / 2 + 0.01), 0, 0, p);
        for (const zz of [-0.07, 0.07]) for (const yy of [-0.17, 0.17])
          box(0.022, 0.026, 0.026, MAT.hole, s * (L / 2 + 0.01), yy, zz + Math.sign(zz) * 0.06, p);
        profileWeld(s * (L / 2 - R), d, bf, tf, tw, p);
      }
    },
    column(g) {
      const L = 3.2, d = 0.3, bf = 0.3, tf = 0.019, tw = 0.011, y = 0.27;
      const p = new THREE.Group(); p.position.y = y; g.add(p);
      wShape(L, d, bf, tf, tw, p);
      box(0.03, 0.5, 0.5, MAT.plate, -L / 2 - 0.015, 0, 0, p);                       // base plate
      for (const yy of [-0.19, 0.19]) for (const zz of [-0.19, 0.19]) {
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.032, 16), MAT.hole);
        hole.rotation.z = Math.PI / 2; hole.position.set(-L / 2 - 0.015, yy, zz); p.add(hole);
      }
      box(0.02, 0.34, 0.34, MAT.plate, L / 2 + 0.01, 0, 0, p);                       // cap plate
      profileWeld(-L / 2 + R, d, bf, tf, tw, p);
      profileWeld(L / 2 - R, d, bf, tf, tw, p);
      // shear tabs on the top flange where the beams land
      for (const x of [-0.2, 0.7]) {
        box(0.26, 0.14, 0.012, MAT.plate, x, d / 2 + 0.07, 0, p);
        for (const s of [-1, 1]) weld([V(x - 0.12, d / 2 + R, s * (0.006 + R)), V(x + 0.12, d / 2 + R, s * (0.006 + R))], p);
        for (const hy of [0.035, 0.1]) box(0.024, 0.024, 0.014, MAT.hole, x + 0.06, d / 2 + hy, 0, p);
      }
      // shear tab in the web pocket
      const hw = d - 2 * tf, ww = bf / 2 - tw / 2 - 0.006;
      box(0.012, hw, ww, MAT.plate, 0.7, 0, tw / 2 + ww / 2, p);
      for (const f of [-1, 1]) weld([V(0.7 + f * (0.006 + R), hw / 2 - 0.02, tw / 2 + R), V(0.7 + f * (0.006 + R), -hw / 2 + 0.02, tw / 2 + R)], p);
    },
    'beam-plates'(g) {
      const L = 4.0, d = 0.4, bf = 0.18, tf = 0.014, tw = 0.009, y = d / 2 + 0.04;
      const p = new THREE.Group(); p.position.y = y; g.add(p);
      wShape(L, d, bf, tf, tw, p);
      // B1 reinforcing plate on the top flange
      const cw = bf - 0.03, cl = 1.6;
      box(cl, 0.014, cw, MAT.plate, 0, d / 2 + 0.007, 0, p);
      for (const s of [-1, 1]) weld([V(-cl / 2, d / 2 + R, s * (cw / 2 + R)), V(cl / 2, d / 2 + R, s * (cw / 2 + R))], p);
      for (const s of [-1, 1]) weld([V(s * (cl / 2 + R), d / 2 + R, -cw / 2), V(s * (cl / 2 + R), d / 2 + R, cw / 2)], p);
      // C1 plate on the web (near side)
      const px = 1.25, pl = 0.5, ph = 0.24, z0 = tw / 2 + 0.006;
      box(pl, ph, 0.012, MAT.plate, px, 0, z0, p);
      weld([V(px - pl / 2 - R, ph / 2, tw / 2 + R), V(px + pl / 2 + R, ph / 2, tw / 2 + R), V(px + pl / 2 + R, -ph / 2, tw / 2 + R), V(px - pl / 2 - R, -ph / 2, tw / 2 + R)], p, true);
      // C2 shear tabs off the web (far side, toward the viewer's left)
      const hw = d - 2 * tf;
      for (const x of [-1.35, -1.05]) {
        box(0.012, hw - 0.04, 0.11, MAT.plate, x, 0, tw / 2 + 0.055, p);
        for (const f of [-1, 1]) weld([V(x + f * (0.006 + R), hw / 2 - 0.04, tw / 2 + R), V(x + f * (0.006 + R), -hw / 2 + 0.04, tw / 2 + R)], p);
      }
    },
    brace(g) {
      // UNP 200 channel, web vertical, flanges toward +z
      const L = 2.8, h = 0.2, b = 0.075, tf = 0.0115, tw = 0.0085, y = h / 2 + 0.04;
      const p = new THREE.Group(); p.position.y = y; g.add(p);
      box(L, h, tw, MAT.profile, 0, 0, -b / 2 + tw / 2, p);
      for (const s of [-1, 1]) box(L, tf, b, MAT.profile, 0, s * (h / 2 - tf / 2), 0, p);
      const back = -b / 2;
      // D1 plate on the profile: gusset on the back of the web, past the end
      const gl = 0.42, gh = 0.3, gx = -L / 2 + 0.06;
      box(gl, gh, 0.012, MAT.plate, gx, 0, back - 0.006, p);
      weld([V(gx + gl / 2 + R, h / 2 - 0.01, back - R), V(gx + gl / 2 + R, -h / 2 + 0.01, back - R)], p);
      for (const s of [-1, 1]) weld([V(-L / 2 + 0.01, s * (h / 2 + R), back - R), V(gx + gl / 2, s * (h / 2 + R), back - R)], p);
      for (const hx of [-0.12, 0]) box(0.03, 0.03, 0.014, MAT.hole, gx - 0.05 + hx, 0, back - 0.006, p);
      // D2 plate in the profile: gusset inside the channel, past the other end
      const ix = L / 2 - 0.08, il = 0.42, ih = h - 2 * tf;
      box(il, ih, 0.012, MAT.plate, ix, 0, back + tw + 0.006, p);
      for (const s of [-1, 1]) weld([V(ix - il / 2, s * (ih / 2 - R), back + tw + 0.012 + R), V(L / 2, s * (ih / 2 - R), back + tw + 0.012 + R)], p);
      weld([V(ix - il / 2 - R, ih / 2 - 0.01, back + tw + R), V(ix - il / 2 - R, -ih / 2 + 0.01, back + tw + R)], p);
      for (const hx of [0.08, 0.18]) box(0.03, 0.03, 0.014, MAT.hole, ix + hx, 0, back + tw + 0.006, p);
    },
    truss(g) {
      // lattice girder standing upright: HEA chords, square tube diagonals
      const L = 5.2, d = 0.19, bf = 0.2, tf = 0.01, tw = 0.0065, H = 1.1, y0 = d / 2 + 0.04;
      const p = new THREE.Group(); p.position.y = y0; g.add(p);
      wShape(L, d, bf, tf, tw, p);
      const top = wShape(L, d, bf, tf, tw, p); top.position.y = H;
      const yb = d / 2, yt = H - d / 2, tb = 0.08, n = 6, step = (L - 0.4) / n;
      for (let i = 0; i <= n; i++) {
        const xa = -L / 2 + 0.2 + i * step;
        if (i < n) {
          const xb = xa + step;
          const a = i % 2 === 0 ? V(xa, yb, 0) : V(xa, yt, 0), b = i % 2 === 0 ? V(xb, yt, 0) : V(xb, yb, 0);
          strut(a, b, tb, tb, MAT.tube, p);
          for (const q of [a, b]) {
            const ang = Math.atan2(b.y - a.y, b.x - a.x), ex = tb / Math.abs(Math.sin(ang)) / 2 + R, ez = tb / 2 + R, yy = q.y + (q.y > H / 2 ? -R : R);
            weld([V(q.x - ex, yy, -ez), V(q.x + ex, yy, -ez), V(q.x + ex, yy, ez), V(q.x - ex, yy, ez)], p, true);
          }
        }
      }
      for (const s of [-1, 1]) {
        const x = s * (L / 2 - 0.06);
        strut(V(x, yb, 0), V(x, yt, 0), tb, tb, MAT.tube, p);
        for (const yy of [yb + R, yt - R]) weld([V(x - tb / 2 - R, yy, -tb / 2 - R), V(x + tb / 2 + R, yy, -tb / 2 - R), V(x + tb / 2 + R, yy, tb / 2 + R), V(x - tb / 2 - R, yy, tb / 2 + R)], p, true);
        box(0.02, H + d + 0.06, bf + 0.06, MAT.plate, s * (L / 2 + 0.01), H / 2, 0, p);
        profileWeld(s * (L / 2 - R), d, bf, tf, tw, p);
        const pw = new THREE.Group(); pw.position.y = H; p.add(pw); profileWeld(s * (L / 2 - R), d, bf, tf, tw, pw);
      }
    },
    railing(g) {
      const L = 2.4, H = 1.07, ps = 0.06, p = new THREE.Group(); g.add(p);
      const posts = [-L / 2 + 0.05, 0, L / 2 - 0.05];
      for (const x of posts) {
        box(ps, H - 0.03, ps, MAT.tube, x, 0.012 + (H - 0.03) / 2, 0, p);
        box(0.16, 0.012, 0.16, MAT.plate, x, 0.006, 0, p);
        for (const hx of [-0.055, 0.055]) for (const hz of [-0.055, 0.055]) box(0.018, 0.014, 0.018, MAT.hole, x + hx, 0.006, hz, p);
        const e = ps / 2 + R;
        weld([V(x - e, 0.012 + R, -e), V(x + e, 0.012 + R, -e), V(x + e, 0.012 + R, e), V(x - e, 0.012 + R, e)], p, true);
      }
      box(L + 0.06, 0.04, 0.06, MAT.tube, 0, H, 0, p);                 // top rail
      box(L - 0.1, 0.04, 0.04, MAT.tube, 0, 0.16, 0, p);               // bottom rail
      for (const x of posts) for (const yy of [H - 0.02 - R, 0.18 + R]) weld([V(x - ps / 2 - R, yy, ps / 2 + R), V(x + ps / 2 + R, yy, ps / 2 + R)], p);
      for (let x = -L / 2 + 0.17; x < L / 2 - 0.1; x += 0.12) {
        if (posts.some(px => Math.abs(px - x) < 0.06)) continue;
        box(0.04, H - 0.2, 0.008, MAT.plate, x, 0.18 + (H - 0.2) / 2, 0, p);
        for (const yy of [0.18 + R, H - 0.02 - R]) weld([V(x - 0.02, yy, 0.004 + R), V(x + 0.02, yy, 0.004 + R)], p);
      }
    },
  };
  BUILD.lineup = function (g) {
    const a = new THREE.Group(); BUILD['beam-stiffeners'](a); a.position.set(0.5, 0, 1.0); g.add(a);
    const b = new THREE.Group(); BUILD.column(b); b.position.set(-0.4, 0, -0.1); g.add(b);
    const c = new THREE.Group(); BUILD.truss(c); c.position.set(0.1, 0, -1.55); g.add(c);
  };

  // wide cover shot: a shop's worth of parts in a row, for the deck cover and the top of the kit page
  BUILD.cover = function (g) {
    const put = (id, x, z, ry) => { const q = new THREE.Group(); BUILD[id](q); q.position.set(x, 0, z); q.rotation.y = ry || 0; g.add(q); };
    put('truss', -0.6, -1.9);
    put('beam-stiffeners', -2.2, 0.15);
    put('column', 2.3, 0.35);
    put('beam-plates', 0.4, 1.35);
    put('railing', 4.7, -1.2, -0.35);
  };

  // ------------------------------------------------------------------ show one part
  const holder = new THREE.Group(); scene.add(holder);
  const VIEW = { lineup: [1.0, 0.62, 1.35], cover: [0.28, 0.55, 1.4], truss: [0.55, 0.42, 1.4], railing: [0.55, 0.45, 1.4] };
  function show(id) {
    while (holder.children.length) holder.remove(holder.children[0]);
    const g = new THREE.Group(); (BUILD[id] || BUILD['beam-stiffeners'])(g); holder.add(g);
    const bb = new THREE.Box3().setFromObject(holder), c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3());
    holder.position.set(-c.x, 0, -c.z);
    const dir = new THREE.Vector3(...(VIEW[id] || [0.9, 0.62, 1.3])).normalize();
    // fit: move the camera along its view line until the part fills the frame (by its 8 box corners)
    controls.target.set(0, size.y * 0.45, 0);
    const corners = [];
    for (const x of [-size.x / 2, size.x / 2]) for (const y of [0, size.y]) for (const z of [-size.z / 2, size.z / 2]) corners.push(V(x, y, z));
    const fill = STILL ? 0.94 : 0.8;
    let dist = size.length() * 2;
    for (let i = 0; i < 30; i++) {
      camera.position.copy(controls.target).addScaledVector(dir, dist);
      camera.near = dist / 50; camera.far = dist * 10; camera.updateProjectionMatrix(); camera.lookAt(controls.target);
      camera.updateMatrixWorld();
      let ex = 0, ey = 0;
      for (const c0 of corners) { const q = c0.clone().project(camera); ex = Math.max(ex, Math.abs(q.x)); ey = Math.max(ey, Math.abs(q.y)); }
      dist *= Math.max(ex / fill, ey / (fill * 0.95));
    }
    controls.update();
    document.querySelectorAll('[data-part]').forEach(el => el.classList.toggle('on', el.dataset.part === id));
    document.querySelectorAll('[data-info]').forEach(el => { el.hidden = el.dataset.info !== id; });
  }
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  resize();
  document.querySelectorAll('[data-part]').forEach(el => el.addEventListener('click', () => {
    show(el.dataset.part); history.replaceState(null, '', '#part=' + el.dataset.part); controls.autoRotate = true;
  }));
  show(params.get('part') || 'beam-stiffeners');
  function frame() {
    controls.update();
    renderer.render(scene, camera);
    if (!STILL) requestAnimationFrame(frame);
  }
  frame();
  if (STILL) { renderer.render(scene, camera); }
  document.body.classList.add('ready');
  window.PARTS_READY = true;
})();
