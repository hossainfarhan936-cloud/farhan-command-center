/* 3D animated background for the Command Center.
   Loads Three.js from a CDN as a module and degrades silently if it is unavailable —
   the login card must never depend on this file. */

const canvas = document.getElementById('bg3d');
window.__scene3dReady = false;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function init() {
  if (!canvas) return;
  let THREE;
  try {
    THREE = await import('https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js');
  } catch (err) {
    console.warn('3D background unavailable:', err && err.message);
    return;
  }
  try {
    build(THREE);
  } catch (err) {
    console.warn('3D scene failed, continuing without it:', err && err.message);
  }
}

function build(THREE) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 9);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xa9b2bd, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(6, 7, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xf97316, 0.35);   // brand-orange rim
  rim.position.set(-7, -4, -6);
  scene.add(rim);

  /* --- floating low-poly shapes --- */
  const group = new THREE.Group();
  scene.add(group);

  const geoms = [
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.BoxGeometry(1.25, 1.25, 1.25),
    new THREE.TorusGeometry(0.72, 0.24, 12, 28),
    new THREE.OctahedronGeometry(1.05, 0),
    new THREE.TetrahedronGeometry(1.15, 0),
  ];
  const colors = [0xe3e8ee, 0xd3dae3, 0xc7d0da, 0xf0d5bd];
  const shapes = [];
  const COUNT = window.innerWidth < 600 ? 9 : 14;

  for (let i = 0; i < COUNT; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: colors[i % colors.length],
      roughness: 0.42,
      metalness: 0.18,
      flatShading: true,
      transparent: true,
      opacity: 0.95,
    });
    const mesh = new THREE.Mesh(geoms[i % geoms.length], mat);
    const angle = (i / COUNT) * Math.PI * 2;
    const radius = 4.2 + (i % 3) * 1.15;
    mesh.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle * 1.7) * 2.1,
      -4.5 + (i % 4) * 1.9,
    );
    const s = 0.34 + (i % 5) * 0.11;
    mesh.scale.setScalar(s);
    mesh.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    mesh.userData = { spin: 0.06 + (i % 4) * 0.035, bob: i * 0.85, baseY: mesh.position.y };
    group.add(mesh);
    shapes.push(mesh);
  }

  /* --- drifting particle field --- */
  const pCount = window.innerWidth < 600 ? 260 : 520;
  const positions = new Float32Array(pCount * 3);
  for (let i = 0; i < pCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 22;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 14 - 2;
  }
  const pGeom = new THREE.BufferGeometry();
  pGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(pGeom, new THREE.PointsMaterial({
    color: 0x9aa7b4, size: 0.045, transparent: true, opacity: 0.75, sizeAttenuation: true,
  }));
  scene.add(points);

  /* --- pointer / touch parallax --- */
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  const onPointer = (e) => {
    const t = e.touches ? e.touches[0] : e;
    if (!t) return;
    target.x = (t.clientX / window.innerWidth - 0.5) * 2;
    target.y = (t.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('touchmove', onPointer, { passive: true });

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener('resize', onResize);

  let running = true;
  let clock = new THREE.Clock();

  function frame() {
    if (!running) return;
    const t = clock.getElapsedTime();

    group.rotation.y += 0.0016;
    shapes.forEach((m) => {
      m.rotation.x += m.userData.spin * 0.004;
      m.rotation.y += m.userData.spin * 0.006;
      m.position.y = m.userData.baseY + Math.sin(t * 0.5 + m.userData.bob) * 0.32;
    });
    points.rotation.y = t * 0.012;

    current.x += (target.x - current.x) * 0.045;
    current.y += (target.y - current.y) * 0.045;
    camera.position.x = current.x * 1.5;
    camera.position.y = -current.y * 1.1;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    if (!reduceMotion) requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
    } else if (!running && !reduceMotion) {
      running = true;
      clock = new THREE.Clock();
      requestAnimationFrame(frame);
    }
  });

  onResize();
  frame();                       // with reduced motion this renders exactly one frame
  window.__scene3dReady = true;
  window.__scene3dInfo = { shapes: shapes.length, points: pCount, reducedMotion: reduceMotion };
}

init();