/**
 * Tron Legacy grid background — Three.js scene module.
 * Exports initScene(canvas) → { igniteGrid, setReducedMotion }
 *
 * Everything emissive is additive and layered: a narrow white-hot core with
 * progressively wider, dimmer coloured shells around it. That layering is what
 * stands in for a bloom pass — no postprocessing is used.
 */
import * as THREE from 'three';

const BG_COLOR = 0x030609;
const CYAN = 0x00e5ff;
const CYAN_DEEP = 0x0090c8;
const WHITE_HOT = 0xdffbff;
const ORANGE = 0xff9a1f;

const CELL_SIZE = 2;
/**
 * How far in front of the origin the floor extends, so it reaches the bottom
 * edge of the frame. This must stay clear of the camera by a healthy margin: a
 * line segment straddling the near plane is dropped outright by some drivers,
 * which silently deletes every rail and leaves the floor as bare horizontal
 * rows. The scroll offset is applied backwards for the same reason.
 */
const GRID_FRONT = 11;
const GRID_FRONT_MIN_CLEARANCE = 3;
const SCROLL_SPEED = 2.5;
const IGNITE_DURATION = 1.35;

/** Camera pitches slightly up, dropping the horizon to ~58% of the frame so
 *  the hero copy sits in clean black sky above the luminous band. */
const CAM_HEIGHT = 2.8;
const CAM_Z = 14;
const LOOK_HEIGHT = 9.2;
const LOOK_Z = -60;

/** No-op API returned when WebGL is unavailable. */
function createNoOpAPI() {
  return {
    igniteGrid() {},
    setReducedMotion() {},
  };
}

function geometryFromPositions(positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/** Rows: lines of constant Z running across the floor. */
function buildRowGeometry(width, depth, cellSize) {
  const halfW = width * 0.5;
  const front = Math.min(GRID_FRONT, CAM_Z - GRID_FRONT_MIN_CLEARANCE);
  const count = Math.floor((depth + front) / cellSize) + 1;
  const positions = new Float32Array(count * 2 * 3);
  let i = 0;

  for (let z = 0; z < count; z += 1) {
    const pz = front - z * cellSize;
    positions[i++] = -halfW;
    positions[i++] = 0;
    positions[i++] = pz;
    positions[i++] = halfW;
    positions[i++] = 0;
    positions[i++] = pz;
  }
  return geometryFromPositions(positions);
}

/** Rails: lines of constant X running away toward the vanishing point. */
function buildRailGeometry(width, depth, cellSize) {
  const halfW = width * 0.5;
  const front = Math.min(GRID_FRONT, CAM_Z - GRID_FRONT_MIN_CLEARANCE);
  const count = Math.floor(width / cellSize) + 1;
  const positions = new Float32Array(count * 2 * 3);
  let i = 0;

  for (let x = 0; x < count; x += 1) {
    const px = -halfW + x * cellSize;
    positions[i++] = px;
    positions[i++] = 0;
    positions[i++] = front;
    positions[i++] = px;
    positions[i++] = 0;
    positions[i++] = -depth;
  }
  return geometryFromPositions(positions);
}

function lineMaterial(color, fog) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog,
  });
}

/**
 * Rows and rails are built separately so each can be lit and spaced
 * independently. A portrait viewport sees only a couple of world units across
 * at the near edge of the floor, so it needs much tighter rail spacing before
 * the perspective reads at all.
 */
function buildGrid({ width, depth, railCell, rowCell }) {
  const rowGeo = buildRowGeometry(width, depth, rowCell);
  const railGeo = buildRailGeometry(width, depth, railCell);
  const majorRowGeo = buildRowGeometry(width, depth, rowCell * 8);
  const majorRailGeo = buildRailGeometry(width, depth, railCell * 8);

  const rowMaterial = lineMaterial(CYAN_DEEP, true);
  const railMaterial = lineMaterial(CYAN, true);
  const railHotMaterial = lineMaterial(WHITE_HOT, true);
  const majorMaterial = lineMaterial(WHITE_HOT, true);

  const group = new THREE.Group();
  group.add(new THREE.LineSegments(rowGeo, rowMaterial));
  group.add(new THREE.LineSegments(railGeo, railMaterial));
  group.add(new THREE.LineSegments(railGeo, railHotMaterial));
  group.add(new THREE.LineSegments(majorRowGeo, majorMaterial));
  group.add(new THREE.LineSegments(majorRailGeo, majorMaterial));

  return {
    group,
    geometries: [rowGeo, railGeo, majorRowGeo, majorRailGeo],
    materials: [rowMaterial, railMaterial, railHotMaterial, majorMaterial],
    rowMaterial,
    railMaterial,
    railHotMaterial,
    majorMaterial,
  };
}

/** Horizontal weighting applied to the horizon so it reads as a light source
 *  sitting straight ahead rather than as an even bank of fog. */
const HORIZON_FALLOFF = [
  [0, 0],
  [0.16, 0.34],
  [0.34, 0.78],
  [0.5, 1],
  [0.66, 0.78],
  [0.84, 0.34],
  [1, 0],
];

/**
 * Vertical gradient strip used for every glow surface in the scene.
 * @param {Array<[number, string]>} stops [offset from bottom, css colour]
 * @param {number} height texture resolution
 * @param {boolean} centreWeighted fade the strip out toward its left/right ends
 */
function gradientTexture(stops, height = 256, centreWeighted = false) {
  const width = centreWeighted ? 256 : 4;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Canvas y grows downward; texture v grows upward. Build top-down.
  const grad = ctx.createLinearGradient(0, height, 0, 0);
  for (let i = 0; i < stops.length; i += 1) {
    grad.addColorStop(stops[i][0], stops[i][1]);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  if (centreWeighted) {
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createLinearGradient(0, 0, width, 0);
    for (let i = 0; i < HORIZON_FALLOFF.length; i += 1) {
      const [at, alpha] = HORIZON_FALLOFF[i];
      mask.addColorStop(at, `rgba(0, 0, 0, ${alpha})`);
    }
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function glowMaterial(texture) {
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.DoubleSide,
  });
}

/**
 * The horizon: a hot filament sitting exactly on eye level, a tight bloom
 * around it and a broad atmospheric wash bleeding up into the sky.
 */
const HORIZON_Z = -228;
/** Half-width of the horizon planes before the aspect-driven scale in resize. */
const HORIZON_HALF = 250;

function buildHorizon() {
  const group = new THREE.Group();

  const skyTex = gradientTexture(
    [
      [0, 'rgba(0, 110, 160, 0)'],
      [0.32, 'rgba(0, 130, 180, 0.02)'],
      [0.46, 'rgba(0, 165, 215, 0.09)'],
      [0.5, 'rgba(90, 220, 255, 0.44)'],
      [0.6, 'rgba(0, 175, 225, 0.12)'],
      [0.78, 'rgba(0, 140, 195, 0.03)'],
      [1, 'rgba(0, 110, 160, 0)'],
    ],
    256,
    true,
  );
  const skyMat = glowMaterial(skyTex);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(HORIZON_HALF * 2, 250), skyMat);
  sky.position.set(0, CAM_HEIGHT, HORIZON_Z - 2);
  sky.renderOrder = -3;

  const bloomTex = gradientTexture(
    [
      [0, 'rgba(0, 180, 230, 0)'],
      [0.34, 'rgba(0, 200, 245, 0.12)'],
      [0.46, 'rgba(120, 240, 255, 0.5)'],
      [0.5, 'rgba(190, 250, 255, 0.85)'],
      [0.54, 'rgba(120, 240, 255, 0.5)'],
      [0.66, 'rgba(0, 200, 245, 0.14)'],
      [1, 'rgba(0, 180, 230, 0)'],
    ],
    256,
    true,
  );
  const bloomMat = glowMaterial(bloomTex);
  const bloom = new THREE.Mesh(new THREE.PlaneGeometry(HORIZON_HALF * 2, 42), bloomMat);
  bloom.position.set(0, CAM_HEIGHT, HORIZON_Z);
  bloom.renderOrder = -2;

  const coreTex = gradientTexture(
    [
      [0, 'rgba(180, 250, 255, 0)'],
      [0.44, 'rgba(200, 251, 255, 0.35)'],
      [0.49, 'rgba(255, 255, 255, 1)'],
      [0.51, 'rgba(255, 255, 255, 1)'],
      [0.56, 'rgba(200, 251, 255, 0.35)'],
      [1, 'rgba(180, 250, 255, 0)'],
    ],
    256,
    true,
  );
  const coreMat = glowMaterial(coreTex);
  const core = new THREE.Mesh(new THREE.PlaneGeometry(HORIZON_HALF * 2, 4.5), coreMat);
  core.position.set(0, CAM_HEIGHT, HORIZON_Z + 2);
  core.renderOrder = -1;

  group.add(sky, bloom, core);
  return { group, skyMat, bloomMat, coreMat };
}

/**
 * Distant skyline: thin vertical shafts standing on the horizon. Two amber
 * ones far off-axis echo the CLU accent used on the Draoi card.
 */
function buildSkyline() {
  const tex = gradientTexture([
    [0, 'rgba(255, 255, 255, 0)'],
    [0.04, 'rgba(255, 255, 255, 0.95)'],
    [0.12, 'rgba(190, 245, 255, 0.55)'],
    [0.45, 'rgba(140, 230, 255, 0.16)'],
    [1, 'rgba(120, 220, 255, 0)'],
  ]);

  const group = new THREE.Group();
  const shafts = [];

  const layout = [
    [-196, 2.2, 20, 0.13, false],
    [-168, 0.8, 11, 0.17, false],
    [-140, 1.4, 31, 0.14, false],
    [-118, 0.6, 15, 0.19, false],
    [-92, 2.6, 8, 0.12, false],
    [-63, 1, 24, 0.18, false],
    [-41, 0.5, 38, 0.2, false],
    [-22, 1.7, 13, 0.13, false],
    [26, 0.7, 18, 0.19, false],
    [48, 2, 28, 0.14, false],
    [72, 0.6, 12, 0.17, false],
    [99, 1.5, 34, 0.15, false],
    [131, 0.9, 17, 0.18, false],
    [162, 2.3, 9, 0.12, false],
    [188, 0.6, 25, 0.19, false],
    [-238, 1.2, 26, 0.17, true],
    [214, 0.8, 20, 0.18, true],
  ];

  for (let i = 0; i < layout.length; i += 1) {
    const [x, w, h, alpha, amber] = layout[i];
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      color: amber ? ORANGE : 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x, CAM_HEIGHT + h * 0.5, -215);
    mesh.renderOrder = -4;
    group.add(mesh);
    shafts.push({ material, alpha, phase: i * 1.7, rate: 0.3 + (i % 5) * 0.11 });
  }

  return { group, shafts };
}

const TRAIL_LENGTH = 34;
const TRAIL_WALL_H = 1.5;

/** Ribbon fade along the direction of travel: hot head, long dissolving tail. */
function buildTrailTexture() {
  return gradientTexture(
    [
      [0, 'rgba(255, 255, 255, 0)'],
      [0.3, 'rgba(255, 255, 255, 0.12)'],
      [0.74, 'rgba(255, 255, 255, 0.5)'],
      [0.95, 'rgba(255, 255, 255, 1)'],
      [0.99, 'rgba(255, 255, 255, 0.8)'],
      [1, 'rgba(255, 255, 255, 0)'],
    ],
    128,
  );
}

/**
 * The light wall itself: fades tail-to-head along v, and bottom-to-top along u
 * so the wall is translucent at the floor and burns out at its upper edge.
 */
function buildWallTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const along = ctx.createLinearGradient(0, size, 0, 0);
  along.addColorStop(0, 'rgba(255, 255, 255, 0)');
  along.addColorStop(0.3, 'rgba(255, 255, 255, 0.14)');
  along.addColorStop(0.72, 'rgba(255, 255, 255, 0.5)');
  along.addColorStop(0.94, 'rgba(255, 255, 255, 1)');
  along.addColorStop(0.985, 'rgba(255, 255, 255, 0.85)');
  along.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = 'destination-in';
  const up = ctx.createLinearGradient(0, 0, size, 0);
  up.addColorStop(0, 'rgba(0, 0, 0, 0.12)');
  up.addColorStop(0.7, 'rgba(0, 0, 0, 0.22)');
  up.addColorStop(0.94, 'rgba(0, 0, 0, 0.65)');
  up.addColorStop(0.99, 'rgba(0, 0, 0, 1)');
  up.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
  ctx.fillStyle = up;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function trailMaterial(map, color) {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/**
 * Pre-allocated light-cycle pool. Each entry is a heading-aligned group with a
 * ground glow, a vertical light wall and a white-hot cap along its top edge.
 * Rotations are ordered so local +Y always resolves to the travel direction.
 */
function createTrailPool(maxTrails, scene, textures) {
  const pool = [];
  for (let i = 0; i < maxTrails; i += 1) {
    const group = new THREE.Group();
    group.visible = false;

    const glowMat = trailMaterial(textures.ribbon, CYAN);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, TRAIL_LENGTH),
      glowMat,
    );
    glow.rotation.x = -Math.PI * 0.5;
    glow.position.y = 0.04;

    const wallMat = trailMaterial(textures.wall, CYAN);
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(TRAIL_WALL_H, TRAIL_LENGTH),
      wallMat,
    );
    wall.rotation.order = 'ZXY';
    wall.rotation.set(-Math.PI * 0.5, 0, Math.PI * 0.5);
    wall.position.y = TRAIL_WALL_H * 0.5;

    const capMat = trailMaterial(textures.ribbon, WHITE_HOT);
    const cap = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, TRAIL_LENGTH),
      capMat,
    );
    cap.rotation.order = 'ZXY';
    cap.rotation.set(-Math.PI * 0.5, 0, Math.PI * 0.5);
    cap.position.y = TRAIL_WALL_H;

    group.add(glow, wall, cap);
    scene.add(group);

    pool.push({
      group,
      meshes: [glow, wall, cap],
      glowMat,
      wallMat,
      capMat,
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
 * @param {'horizon'|'grid'|'skyline'} layer horizon leads for an outward feel
 */
function ignitionEnvelope(t, layer) {
  if (t < 0) return 0;

  let delay = 0.14;
  if (layer === 'horizon') delay = 0;
  else if (layer === 'skyline') delay = 0.45;

  const local = t - delay;
  if (local <= 0) return 0;

  const progress = Math.min(local / (IGNITE_DURATION - delay), 1);
  let env = 1 - (1 - progress) ** 2.6;

  const flickers = [0.08, 0.19, 0.33, 0.52];
  for (let f = 0; f < flickers.length; f += 1) {
    const d = Math.abs(progress - flickers[f]);
    if (d < 0.04) {
      env *= 0.28 + 0.72 * (d / 0.04);
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
  scene.fog = new THREE.FogExp2(BG_COLOR, 0.0095);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);
  const basePos = new THREE.Vector3(0, CAM_HEIGHT, CAM_Z);
  const lookTarget = new THREE.Vector3(0, LOOK_HEIGHT, LOOK_Z);
  camera.position.copy(basePos);
  camera.lookAt(lookTarget);

  const clock = new THREE.Clock(false);

  const isMobile = () => matchMedia('(max-width: 768px)').matches;
  const isTouchOnly = () => matchMedia('(hover: none)').matches;

  const gridSpec = () =>
    isMobile()
      ? { width: 74, depth: 200, railCell: 0.75, rowCell: 1.5 }
      : { width: 220, depth: 270, railCell: CELL_SIZE, rowCell: CELL_SIZE };

  let spec = gridSpec();
  /** Mobile uses a tighter world scale; trails and scroll speed follow it. */
  const worldScale = () => spec.railCell / CELL_SIZE;
  let gridWidth = spec.width;
  let gridDepth = spec.depth;
  let maxTrails = isMobile() ? 1 : 3;
  let wasMobile = isMobile();

  let grid = buildGrid(spec);
  scene.add(grid.group);

  const horizon = buildHorizon();
  scene.add(horizon.group);

  const skyline = buildSkyline();
  scene.add(skyline.group);

  const trailTextures = {
    ribbon: buildTrailTexture(),
    wall: buildWallTexture(),
  };
  let trailPool = createTrailPool(maxTrails, scene, trailTextures);

  let rafId = null;
  let running = false;
  let visible = !document.hidden;
  let reducedMotion = false;
  let ignitedAt = -1;
  let scrollTime = 0;
  let trailTimer = 0;
  let nextTrailDelay = 1.5 + Math.random() * 3;

  /* Mains flutter — an irregular brownout on the whole grid, scheduled at
     random so it never syncs with the CSS flicker. */
  let flutterAt = 4 + Math.random() * 7;
  let flutterUntil = -1;
  let flutterDepth = 0;

  let pointerX = 0;
  let pointerY = 0;
  let easeX = 0;
  let easeY = 0;

  function disposeGrid() {
    scene.remove(grid.group);
    grid.geometries.forEach((g) => g.dispose());
    grid.materials.forEach((m) => m.dispose());
  }

  function disposeTrails() {
    for (let i = 0; i < trailPool.length; i += 1) {
      const t = trailPool[i];
      scene.remove(t.group);
      t.meshes.forEach((m) => m.geometry.dispose());
      t.glowMat.dispose();
      t.wallMat.dispose();
      t.capMat.dispose();
    }
    trailPool = [];
  }

  function rebuildForBreakpoint() {
    spec = gridSpec();
    gridWidth = spec.width;
    gridDepth = spec.depth;
    maxTrails = isMobile() ? 1 : 3;

    disposeGrid();
    grid = buildGrid(spec);
    scene.add(grid.group);

    disposeTrails();
    trailPool = createTrailPool(maxTrails, scene, trailTextures);
  }

  function powerFlutter(elapsed) {
    if (reducedMotion) return 1;

    if (elapsed >= flutterAt && flutterUntil < 0) {
      flutterUntil = elapsed + 0.05 + Math.random() * 0.12;
      flutterDepth = 0.45 + Math.random() * 0.35;
    }
    if (flutterUntil >= 0) {
      if (elapsed >= flutterUntil) {
        flutterUntil = -1;
        flutterAt = elapsed + 3.5 + Math.random() * 9;
        return 1;
      }
      // Two-step stutter rather than a smooth dip.
      return Math.random() < 0.55 ? flutterDepth : 1;
    }
    return 1;
  }

  function applyGridBrightness(ignGrid, elapsed, flutter) {
    const hum = reducedMotion ? 1 : ambienceMultiplier(elapsed);
    const k = ignGrid * hum * flutter;
    grid.rowMaterial.opacity = 0.42 * k;
    grid.railMaterial.opacity = 0.42 * k;
    grid.railHotMaterial.opacity = 0.22 * k;
    grid.majorMaterial.opacity = 0.4 * k;
  }

  function applyHorizonBrightness(ign, flutter) {
    const k = ign * flutter;
    horizon.skyMat.opacity = 0.85 * k;
    horizon.bloomMat.opacity = 0.9 * k;
    horizon.coreMat.opacity = 0.95 * k;
  }

  function applySkylineBrightness(ign, elapsed, flutter) {
    for (let i = 0; i < skyline.shafts.length; i += 1) {
      const s = skyline.shafts[i];
      const wobble = reducedMotion
        ? 1
        : 1 + Math.sin(elapsed * s.rate + s.phase) * 0.22;
      s.material.opacity = s.alpha * ign * wobble * flutter;
    }
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

    const scale = worldScale();
    const accent = Math.random() < 0.3 ? ORANGE : CYAN;

    slot.active = true;
    slot.group.visible = true;
    slot.group.scale.setScalar(scale);
    slot.glowMat.color.setHex(accent);
    slot.wallMat.color.setHex(accent);

    /* Headings stay broadly lateral. A cycle running straight away from the
       camera presents its light wall edge-on and disappears, so the wall is
       always kept angled toward the viewer. */
    const side = Math.random() < 0.5 ? 1 : -1;
    const angle = side * (Math.PI * 0.5 + (Math.random() - 0.5) * 0.9);

    slot.dirX = Math.sin(angle);
    slot.dirZ = -Math.cos(angle);
    slot.speed = (22 + Math.random() * 16) * scale;

    /* Fog swallows anything past roughly 110 world units, so cycles are kept
       in the near field where they still read as light. */
    const z = -(9 + Math.random() * 26) * scale;
    const hFactor = Math.tan(Math.PI / 6) * camera.aspect;
    const spanHalf = hFactor * (CAM_Z - z) + 7 * scale;

    slot.group.position.set(-Math.sign(slot.dirX) * spanHalf, 0, z);
    slot.group.rotation.y = -angle;
    slot.life = 0;
    slot.maxLife = (2 * spanHalf) / Math.abs(slot.dirX * slot.speed);
    slot.glowMat.opacity = 0;
    slot.wallMat.opacity = 0;
    slot.capMat.opacity = 0;
  }

  function updateTrails(delta) {
    for (let i = 0; i < trailPool.length; i += 1) {
      const t = trailPool[i];
      if (!t.active) continue;

      t.life += delta;
      t.group.position.x += t.dirX * t.speed * delta;
      t.group.position.z += t.dirZ * t.speed * delta;

      const fadeIn = Math.min(t.life / 0.25, 1);
      const fadeOutStart = t.maxLife - 0.7;
      let alpha = fadeIn;
      if (t.life > fadeOutStart) {
        alpha *= Math.max(0, 1 - (t.life - fadeOutStart) / 0.7);
      }
      t.glowMat.opacity = alpha * 0.32;
      t.wallMat.opacity = alpha * 0.6;
      t.capMat.opacity = alpha;

      if (t.life >= t.maxLife) {
        t.active = false;
        t.group.visible = false;
        t.glowMat.opacity = 0;
        t.wallMat.opacity = 0;
        t.capMat.opacity = 0;
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
    camera.position.y =
      basePos.y + easeY * 0.22 + Math.sin(elapsed * 0.21) * 0.06;
    camera.position.z = basePos.z;
    camera.lookAt(lookTarget);
  }

  function renderFrame(delta) {
    const elapsed = clock.getElapsedTime();
    const igniteT = ignitedAt >= 0 ? elapsed - ignitedAt : -1;
    const ignHorizon = ignitionEnvelope(igniteT, 'horizon');
    const ignGrid = ignitionEnvelope(igniteT, 'grid');
    const ignSky = ignitionEnvelope(igniteT, 'skyline');

    if (reducedMotion) {
      const on = ignitedAt >= 0 ? 1 : 0;
      grid.group.position.z = 0;
      applyHorizonBrightness(Math.max(ignHorizon, on), 1);
      applySkylineBrightness(Math.max(ignSky, on), elapsed, 1);
      applyGridBrightness(Math.max(ignGrid, on), elapsed, 1);
      updateCamera(elapsed);
      renderer.render(scene, camera);
      return;
    }

    scrollTime += delta;
    grid.group.position.z =
      ((scrollTime * SCROLL_SPEED * worldScale()) % spec.rowCell) -
      spec.rowCell;

    const flutter = powerFlutter(elapsed);
    applyHorizonBrightness(ignHorizon, flutter);
    applySkylineBrightness(ignSky, elapsed, flutter);
    applyGridBrightness(ignGrid, elapsed, flutter);
    updateCamera(elapsed);

    if (ignGrid > 0.4) {
      trailTimer += delta;
      if (trailTimer >= nextTrailDelay) {
        spawnTrail();
        trailTimer = 0;
        nextTrailDelay = 2 + Math.random() * 4.5;
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

  /** Keep the horizon's centre-weighted falloff mapped onto the frame, so the
   *  band is brightest dead ahead and dims toward the screen edges at any
   *  aspect ratio. */
  function fitHorizon() {
    const halfFrame =
      Math.abs(HORIZON_Z - CAM_Z) * Math.tan((30 * Math.PI) / 180) * camera.aspect;
    horizon.group.scale.x = Math.max((halfFrame * 1.35) / HORIZON_HALF, 0.08);
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    fitHorizon();

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
