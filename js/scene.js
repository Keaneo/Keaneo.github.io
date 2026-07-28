/**
 * Tron Legacy grid background — Three.js scene module.
 * Exports initScene(canvas) → { igniteGrid, setReducedMotion }
 */
import * as THREE from 'three';

const BG_COLOR = 0x030609;
const CYAN = 0x00e5ff;
const WHITE_HOT = 0xdffbff;
const ORANGE = 0xff9a1f;

const CELL_SIZE = 2;
const SCROLL_SPEED = 2.5;
const IGNITE_DURATION = 1.2;

/** No-op API returned when WebGL is unavailable. */
function createNoOpAPI() {
  return {
    igniteGrid() {},
    setReducedMotion() {},
  };
}

/** Build line-segment geometry for an XZ grid. */
function buildGridGeometry(width, depth, cellSize) {
  const halfW = width * 0.5;
  const xLines = Math.floor(width / cellSize) + 1;
  const zLines = Math.floor(depth / cellSize) + 1;
  const positions = new Float32Array((xLines + zLines) * 2 * 3);
  let i = 0;

  for (let z = 0; z < zLines; z += 1) {
    const pz = -z * cellSize;
    positions[i++] = -halfW;
    positions[i++] = 0;
    positions[i++] = pz;
    positions[i++] = halfW;
    positions[i++] = 0;
    positions[i++] = pz;
  }

  for (let x = 0; x < xLines; x += 1) {
    const px = -halfW + x * cellSize;
    positions[i++] = px;
    positions[i++] = 0;
    positions[i++] = 0;
    positions[i++] = px;
    positions[i++] = 0;
    positions[i++] = -depth;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/** Dual-layer grid: cyan base + white-hot core (additive). */
function buildGrid(width, depth, cellSize) {
  const geometry = buildGridGeometry(width, depth, cellSize);

  const cyanMaterial = new THREE.LineBasicMaterial({
    color: CYAN,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
  });

  const hotMaterial = new THREE.LineBasicMaterial({
    color: WHITE_HOT,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
  });

  const group = new THREE.Group();
  group.add(new THREE.LineSegments(geometry, cyanMaterial));
  group.add(new THREE.LineSegments(geometry, hotMaterial));

  return { group, geometry, cyanMaterial, hotMaterial };
}

/** Procedural radial/linear horizon glow (no external assets). */
function buildHorizonTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(0, 229, 255, 0.45)');
  grad.addColorStop(0.12, 'rgba(0, 229, 255, 0.18)');
  grad.addColorStop(0.35, 'rgba(0, 229, 255, 0.04)');
  grad.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.92, 'rgba(223, 251, 255, 0.55)');
  grad.addColorStop(1, 'rgba(223, 251, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 64);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.lineTo(256, 3);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildHorizon() {
  const material = new THREE.MeshBasicMaterial({
    map: buildHorizonTexture(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(420, 90), material);
  mesh.position.set(0, 18, -180);

  const rim = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 12),
    material.clone(),
  );
  rim.position.set(0, 8, -178);
  rim.material.opacity = 0;

  const group = new THREE.Group();
  group.add(mesh, rim);
  return { group, material, rimMaterial: rim.material };
}

/** Pre-allocated light-cycle trail pool. */
function createTrailPool(maxTrails, scene) {
  const pool = [];
  for (let i = 0; i < maxTrails; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 14), material);
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.position.y = 0.05;
    mesh.visible = false;
    scene.add(mesh);

    pool.push({
      mesh,
      material,
      active: false,
      dirX: 0,
      dirZ: 0,
      speed: 0,
      life: 0,
      maxLife: 0,
    });
  }
  return pool;
}

/**
 * Ignition envelope with fluorescent-style flicker dips.
 * @param {number} t seconds since igniteGrid()
 * @param {'horizon'|'grid'} layer horizon leads slightly for outward feel
 */
function ignitionEnvelope(t, layer) {
  if (t < 0) return 0;

  const delay = layer === 'horizon' ? 0 : 0.12;
  const local = t - delay;
  if (local <= 0) return 0;

  const progress = Math.min(local / (IGNITE_DURATION - delay), 1);
  let env = 1 - (1 - progress) ** 2.4;

  const flickers = [0.1, 0.28, 0.48];
  for (let f = 0; f < flickers.length; f += 1) {
    const d = Math.abs(progress - flickers[f]);
    if (d < 0.045) {
      env *= 0.5 + 0.5 * (d / 0.045);
    }
  }
  return Math.min(env, 1);
}

/** Slow layered sine brightness hum (~±4%). */
function ambienceMultiplier(time) {
  return (
    1 +
    Math.sin(time * 0.72) * 0.016 +
    Math.sin(time * 1.31 + 1.1) * 0.012 +
    Math.sin(time * 0.38 + 2.7) * 0.009
  );
}

export function initScene(canvas) {
  if (!canvas) {
    document.documentElement.classList.add('no-webgl');
    console.warn('[scene] Canvas missing; WebGL background disabled.');
    return createNoOpAPI();
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!renderer.getContext()) {
      throw new Error('WebGL context unavailable');
    }
    renderer.setClearColor(BG_COLOR, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  } catch (err) {
    document.documentElement.classList.add('no-webgl');
    console.warn('[scene] WebGL unavailable:', err);
    return createNoOpAPI();
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  scene.fog = new THREE.FogExp2(BG_COLOR, 0.018);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  const basePos = new THREE.Vector3(0, 2.2, 14);
  const lookTarget = new THREE.Vector3(0, 1.5, -60);
  camera.position.copy(basePos);
  camera.lookAt(lookTarget);

  const clock = new THREE.Clock(false);

  const isMobile = () => matchMedia('(max-width: 768px)').matches;
  const isTouchOnly = () => matchMedia('(hover: none)').matches;

  let gridWidth = isMobile() ? 80 : 120;
  let gridDepth = isMobile() ? 160 : 240;
  let maxTrails = isMobile() ? 1 : 3;
  let wasMobile = isMobile();

  let grid = buildGrid(gridWidth, gridDepth, CELL_SIZE);
  scene.add(grid.group);

  const horizon = buildHorizon();
  scene.add(horizon.group);

  let trailPool = createTrailPool(maxTrails, scene);

  let rafId = null;
  let running = false;
  let visible = !document.hidden;
  let reducedMotion = false;
  let ignitedAt = -1;
  let scrollTime = 0;
  let trailTimer = 0;
  let nextTrailDelay = 4 + Math.random() * 5;

  let pointerX = 0;
  let pointerY = 0;
  let easeX = 0;
  let easeY = 0;

  function disposeGrid() {
    scene.remove(grid.group);
    grid.geometry.dispose();
    grid.cyanMaterial.dispose();
    grid.hotMaterial.dispose();
  }

  function disposeTrails() {
    for (let i = 0; i < trailPool.length; i += 1) {
      const t = trailPool[i];
      scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.material.dispose();
    }
    trailPool = [];
  }

  function rebuildForBreakpoint() {
    gridWidth = isMobile() ? 80 : 120;
    gridDepth = isMobile() ? 160 : 240;
    maxTrails = isMobile() ? 1 : 3;

    disposeGrid();
    grid = buildGrid(gridWidth, gridDepth, CELL_SIZE);
    scene.add(grid.group);

    disposeTrails();
    trailPool = createTrailPool(maxTrails, scene);
  }

  function applyGridBrightness(ignGrid, elapsed) {
    const hum = reducedMotion ? 1 : ambienceMultiplier(elapsed);
    grid.cyanMaterial.opacity = 0.32 * ignGrid * hum;
    grid.hotMaterial.opacity = 0.52 * ignGrid * hum;
  }

  function applyHorizonBrightness(ignHorizon) {
    horizon.material.opacity = 0.55 * ignHorizon;
    horizon.rimMaterial.opacity = 0.35 * ignHorizon;
  }

  function spawnTrail() {
    let slot = null;
    for (let i = 0; i < trailPool.length; i += 1) {
      if (!trailPool[i].active) {
        slot = trailPool[i];
        break;
      }
    }
    if (!slot) return;

    slot.active = true;
    slot.mesh.visible = true;
    slot.material.color.setHex(Math.random() < 0.3 ? ORANGE : CYAN);

    const diagonal = Math.random() < 0.45;
    let angle;
    if (diagonal) {
      angle = (Math.random() < 0.5 ? 1 : -1) * (Math.PI * 0.25 + Math.random() * 0.15);
    } else {
      angle = Math.random() < 0.5 ? 0 : Math.PI * 0.5;
    }

    slot.dirX = Math.sin(angle);
    slot.dirZ = -Math.cos(angle);
    slot.speed = 38 + Math.random() * 22;

    const halfW = gridWidth * 0.5;
    slot.mesh.position.x = (Math.random() - 0.5) * halfW * 1.6;
    slot.mesh.position.z = -Math.random() * gridDepth * 0.85;

    if (Math.abs(slot.dirX) > 0.5) {
      slot.mesh.position.x = slot.dirX > 0 ? -halfW - 8 : halfW + 8;
    } else {
      slot.mesh.position.z = 6;
    }

    slot.mesh.rotation.y = Math.atan2(slot.dirX, slot.dirZ);
    slot.life = 0;
    slot.maxLife = (gridWidth + 24) / slot.speed + 0.45;
    slot.material.opacity = 0;
  }

  function updateTrails(delta) {
    for (let i = 0; i < trailPool.length; i += 1) {
      const t = trailPool[i];
      if (!t.active) continue;

      t.life += delta;
      t.mesh.position.x += t.dirX * t.speed * delta;
      t.mesh.position.z += t.dirZ * t.speed * delta;

      const fadeIn = Math.min(t.life / 0.12, 1);
      const fadeOutStart = t.maxLife - 0.35;
      let alpha = fadeIn * 0.9;
      if (t.life > fadeOutStart) {
        alpha *= Math.max(0, 1 - (t.life - fadeOutStart) / 0.35);
      }
      t.material.opacity = alpha;

      if (t.life >= t.maxLife) {
        t.active = false;
        t.mesh.visible = false;
        t.material.opacity = 0;
      }
    }
  }

  function updateCamera(elapsed) {
    if (reducedMotion) {
      camera.position.copy(basePos);
      camera.lookAt(lookTarget);
      return;
    }

    if (isTouchOnly()) {
      easeX = Math.sin(elapsed * 0.1) * 0.8;
      easeY = Math.sin(elapsed * 0.13 + 0.6) * 0.12;
    } else {
      easeX += (pointerX - easeX) * 0.03;
      easeY += (pointerY - easeY) * 0.03;
    }

    camera.position.x = basePos.x + easeX * 1.2;
    camera.position.y = basePos.y + easeY * 0.4;
    camera.position.z = basePos.z;
    camera.lookAt(lookTarget);
  }

  function renderFrame(delta) {
    const elapsed = clock.getElapsedTime();
    const igniteT = ignitedAt >= 0 ? elapsed - ignitedAt : -1;
    const ignHorizon = ignitionEnvelope(igniteT, 'horizon');
    const ignGrid = ignitionEnvelope(igniteT, 'grid');

    applyHorizonBrightness(ignHorizon);

    if (reducedMotion) {
      grid.group.position.z = 0;
      applyGridBrightness(Math.max(ignGrid, ignitedAt >= 0 ? 1 : 0), elapsed);
      updateCamera(elapsed);
      renderer.render(scene, camera);
      return;
    }

    scrollTime += delta;
    grid.group.position.z = (scrollTime * SCROLL_SPEED) % CELL_SIZE;

    applyGridBrightness(ignGrid, elapsed);
    updateCamera(elapsed);

    if (ignGrid > 0.4) {
      trailTimer += delta;
      if (trailTimer >= nextTrailDelay) {
        spawnTrail();
        trailTimer = 0;
        nextTrailDelay = 4 + Math.random() * 5;
      }
      updateTrails(delta);
    }

    renderer.render(scene, camera);
  }

  function tick() {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    if (!visible) return;
    renderFrame(clock.getDelta());
  }

  function startLoop() {
    if (running) return;
    running = true;
    clock.start();
    clock.getDelta();
    tick();
  }

  function stopLoop() {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    clock.stop();
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);

    const mobile = isMobile();
    if (mobile !== wasMobile) {
      wasMobile = mobile;
      rebuildForBreakpoint();
    }
  }

  let resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }

  function onPointerMove(event) {
    pointerX = (event.clientX / window.innerWidth) * 2 - 1;
    pointerY = -(event.clientY / window.innerHeight) * 2 + 1;
  }

  function onVisibilityChange() {
    if (document.hidden) {
      visible = false;
      clock.stop();
    } else {
      visible = true;
      clock.start();
      clock.getDelta();
      if (!reducedMotion && !running) {
        running = true;
        tick();
      }
    }
  }

  resize();
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);

  renderer.render(scene, camera);
  startLoop();

  return {
    igniteGrid() {
      if (ignitedAt < 0) {
        ignitedAt = clock.getElapsedTime();
      }
    },

    setReducedMotion(enabled) {
      reducedMotion = enabled;
      if (enabled) {
        stopLoop();
        if (ignitedAt < 0) {
          ignitedAt = clock.getElapsedTime();
        }
        clock.start();
        renderFrame(0);
        clock.stop();
      } else {
        clock.getDelta();
        startLoop();
      }
    },
  };
}
