// =============================================================================
// sketch.js — Open World Drive
// All game logic: engine, world building, physics, mission system, HUD
// Depends on: Three.js (loaded via index.html before this script)
// =============================================================================

// ─── GLOBALS ──────────────────────────────────────────────────────────────────
let scene, camera, renderer, car, clock;
let keys = {};
let carVelocity = 0,
  carSteering = 0,
  carRotation = 0;
let displaySpeed = 0; // smoothed km/h shown in HUD — interpolates toward real speed
let gameRunning = false;
const ROAD_Y = 0.11;

// ─── COLLISION SYSTEM ─────────────────────────────────────────────────────────
// Each collider is an axis-aligned bounding box viewed from above: { cx, cz, hw, hd }
// cx/cz = world-space centre, hw = half-width (X axis), hd = half-depth (Z axis).
// The car is also treated as an AABB for fast, reliable push-out every frame.
const colliders = [];

// padding adds a small margin so the car stops just before the visual edge,
// giving a forgiving Roblox-style feel.
function addCollider(cx, cz, hw, hd, padding) {
  var p = padding === undefined ? 0.3 : padding;
  colliders.push({ cx: cx, cz: cz, hw: hw + p, hd: hd + p });
}

// Car half-extents — slightly snug so the player can thread narrow gaps
var CAR_HW = 1.05;
var CAR_HD = 2.1;

// Two-pass separating-axis push-out. The second pass catches adjacent-collider
// corner cases that a single pass would miss.
function resolveCollisions() {
  for (var pass = 0; pass < 2; pass++) {
    for (var i = 0; i < colliders.length; i++) {
      var c = colliders[i];
      var dx = car.position.x - c.cx;
      var dz = car.position.z - c.cz;
      var overlapX = CAR_HW + c.hw - Math.abs(dx);
      var overlapZ = CAR_HD + c.hd - Math.abs(dz);
      if (overlapX > 0 && overlapZ > 0) {
        // Push out on the axis of least overlap so the car slides along walls
        if (overlapX < overlapZ) {
          car.position.x += overlapX * (dx >= 0 ? 1 : -1);
        } else {
          car.position.z += overlapZ * (dz >= 0 ? 1 : -1);
        }
        carVelocity *= 0.2; // bleed speed on impact
      }
    }
  }
}

// ─── MISSION SYSTEM ───────────────────────────────────────────────────────────
// The player must reach each checkpoint in order to win.
const CHECKPOINTS = [
  { x: -75, z: 55, r: 10, label: "Gas Station", color: 0xf5a623, emoji: "⛽" },
  { x: 0, z: -25, r: 12, label: "Downtown", color: 0x4ecdc4, emoji: "🏙️" },
  { x: 80, z: 70, r: 12, label: "Waterfront", color: 0x7bb8f5, emoji: "🌉" },
];

let missionActive = false;
let missionComplete = false;
let currentCP = 0; // index of the checkpoint the player is heading to
let missionStart = 0; // Date.now() snapshot when mission began
let missionElapsed = 0; // seconds elapsed (updated each frame)
let cpMarkers = []; // Three.js groups — one beacon per checkpoint
let markerRotation = 0; // accumulates each frame for spinning animation

// Spawn 3D beacon markers into the scene (call once, inside init)
function buildCheckpointMarkers() {
  cpMarkers = [];
  CHECKPOINTS.forEach(function (cp, i) {
    var group = new THREE.Group();

    // Tall glowing pole
    var poleMat = new THREE.MeshLambertMaterial({
      color: cp.color,
      emissive: cp.color,
      emissiveIntensity: 0.6,
    });
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 12, 8),
      poleMat,
    );
    pole.position.y = 6;
    group.add(pole);

    // Spinning diamond on top
    var diamondMat = new THREE.MeshLambertMaterial({
      color: cp.color,
      emissive: cp.color,
      emissiveIntensity: 0.9,
    });
    var diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(2, 0),
      diamondMat,
    );
    diamond.position.y = 14;
    diamond.name = "diamond";
    group.add(diamond);

    // Ground ring showing the trigger radius
    var ringMat = new THREE.MeshLambertMaterial({
      color: cp.color,
      emissive: cp.color,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.55,
    });
    var ring = new THREE.Mesh(
      new THREE.CylinderGeometry(cp.r, cp.r, 0.15, 24, 1, true),
      ringMat,
    );
    ring.position.y = 0.08;
    group.add(ring);

    group.position.set(cp.x, 0, cp.z);
    scene.add(group);
    cpMarkers.push(group);
  });
}

// Spin diamonds and manage beacon visibility — called every frame
function updateMarkers(dt) {
  markerRotation += dt * 1.2;
  cpMarkers.forEach(function (group, i) {
    var diamond = group.getObjectByName("diamond");
    if (diamond) diamond.rotation.y = markerRotation;

    if (i < currentCP) {
      // Already collected — hide entirely
      group.visible = false;
    } else if (i === currentCP) {
      // Active target — full brightness + gentle bob
      group.visible = true;
      if (diamond) diamond.position.y = 14 + Math.sin(markerRotation * 2) * 0.5;
    } else {
      // Future checkpoint — show faintly so player knows what's coming
      group.visible = missionActive;
      group.children.forEach(function (c) {
        if (c.material) c.material.opacity = 0.3;
      });
    }
  });
}

// Start (or restart) the mission from checkpoint 0
function beginMission() {
  currentCP = 0;
  missionActive = true;
  missionComplete = false;
  missionStart = Date.now();
  missionElapsed = 0;
  updateMissionHUD();

  // Reset progress dots in the HUD
  CHECKPOINTS.forEach(function (_, i) {
    var dot = document.getElementById("dot-" + i);
    if (dot) {
      dot.classList.remove("done", "active");
      if (i === 0) dot.classList.add("active");
    }
  });

  // Reset beacon opacity
  cpMarkers.forEach(function (g, i) {
    g.visible = true;
    g.children.forEach(function (c) {
      if (c.material) c.material.opacity = i === 0 ? 1 : 0.3;
    });
  });
}

// Format a seconds value as "m:ss"
function formatTime(secs) {
  var m = Math.floor(secs / 60);
  var s = Math.floor(secs % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

// Refresh the mission panel text — called every frame while mission is active
function updateMissionHUD() {
  if (!missionActive || missionComplete) return;
  missionElapsed = (Date.now() - missionStart) / 1000;

  var timerEl = document.getElementById("mission-timer");
  timerEl.textContent = formatTime(missionElapsed);
  timerEl.classList.toggle("urgent", missionElapsed > 90);

  var cp = CHECKPOINTS[currentCP];
  var dx = car.position.x - cp.x;
  var dz = car.position.z - cp.z;
  var dist = Math.round(Math.sqrt(dx * dx + dz * dz));
  document.getElementById("mission-dist").textContent = dist;
  document.getElementById("mission-objective").innerHTML =
    "Drive to <strong>" + cp.emoji + " " + cp.label + "</strong>";
}

// Test whether the car has entered the active checkpoint's trigger radius
function checkCheckpoints() {
  if (!missionActive || missionComplete) return;
  var cp = CHECKPOINTS[currentCP];
  var dx = car.position.x - cp.x;
  var dz = car.position.z - cp.z;
  if (Math.sqrt(dx * dx + dz * dz) < cp.r) {
    collectCheckpoint();
  }
}

function collectCheckpoint() {
  // Green screen flash
  var flash = document.getElementById("cp-flash");
  flash.classList.add("flash");
  setTimeout(function () {
    flash.classList.remove("flash");
  }, 300);

  // Mark dot as done
  var dot = document.getElementById("dot-" + currentCP);
  if (dot) {
    dot.classList.remove("active");
    dot.classList.add("done");
  }

  currentCP++;

  if (currentCP >= CHECKPOINTS.length) {
    missionComplete = true;
    missionActive = false;
    showWinScreen();
  } else {
    var nextDot = document.getElementById("dot-" + currentCP);
    if (nextDot) nextDot.classList.add("active");
    updateMissionHUD();
  }
}

function showWinScreen() {
  document.getElementById("win-time").textContent = formatTime(missionElapsed);
  document.getElementById("win-stops").textContent = CHECKPOINTS.map(
    function (cp) {
      return cp.emoji + " " + cp.label;
    },
  ).join("  →  ");
  document.getElementById("win-screen").classList.add("show");
}

function restartMission() {
  document.getElementById("win-screen").classList.remove("show");
  resetCar();
  beginMission();
}

function freeRoam() {
  document.getElementById("win-screen").classList.remove("show");
  missionActive = false;
  missionComplete = false;
  document.getElementById("mission-panel").style.opacity = "0.4";
  document.getElementById("mission-objective").textContent =
    "Free roam — explore the world!";
  document.getElementById("mission-dist").textContent = "";
  document.getElementById("mission-timer").textContent = "";
}

// ─── ZONE DETECTION ───────────────────────────────────────────────────────────
const ZONES = [
  { name: "🌿 Grassy Fields", cx: -70, cz: -70, r: 60 },
  { name: "🏙️ Downtown", cx: 0, cz: 0, r: 45 },
  { name: "⛰️ Rocky Hills", cx: 80, cz: -70, r: 60 },
  { name: "⛽ Industrial Strip", cx: -70, cz: 70, r: 55 },
  { name: "🌉 Waterfront", cx: 80, cz: 70, r: 55 },
];

let currentZone = "";
function detectZone(x, z) {
  var best = null,
    bestDist = Infinity;
  ZONES.forEach(function (zone) {
    var d = Math.sqrt(Math.pow(x - zone.cx, 2) + Math.pow(z - zone.cz, 2));
    if (d < zone.r && d < bestDist) {
      bestDist = d;
      best = zone;
    }
  });
  var name = best ? best.name : "🛣️ Open Road";
  if (name !== currentZone) {
    currentZone = name;
    var badge = document.getElementById("zone-badge");
    badge.textContent = name;
    badge.style.opacity = "0";
    setTimeout(function () {
      badge.style.opacity = "1";
    }, 50);
  }
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────
// Called by the Start button in index.html
function startGame() {
  document.getElementById("start-screen").style.display = "none";
  document.getElementById("hud").style.display = "block";
  gameRunning = true;
  init();
  animate();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  clock = new THREE.Clock();

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById("canvas"),
    antialias: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Scene + fog for depth
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 80, 220);

  // Camera
  camera = new THREE.PerspectiveCamera(
    65,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  camera.position.set(0, 8, -14);

  // Lighting
  var ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  var sun = new THREE.DirectionalLight(0xfffbe0, 1.2);
  sun.position.set(80, 120, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  scene.add(sun);

  // Build world zones
  buildGround();
  buildRoadNetwork();
  buildGrassyFields();
  buildDowntown();
  buildRockyHills();
  buildIndustrialStrip();
  buildWaterfront();

  // Car + mission
  buildCar();
  buildCheckpointMarkers();
  beginMission();

  // Input
  window.addEventListener("keydown", function (e) {
    keys[e.code] = true;
    if (e.code === "KeyR") resetCar();
  });
  window.addEventListener("keyup", function (e) {
    keys[e.code] = false;
  });
  window.addEventListener("resize", onResize);
}

// ─── GROUND ───────────────────────────────────────────────────────────────────
function buildGround() {
  var geo = new THREE.PlaneGeometry(400, 400);
  var mat = new THREE.MeshLambertMaterial({ color: 0x5a9e4a });
  var ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

// ─── PRIMITIVE HELPERS ────────────────────────────────────────────────────────
// box() — creates a box mesh and optionally registers an AABB collider.
//   solid=true  → registers a collider if h > 2 (buildings, walls, boulders)
//   solid=false → purely visual, no collision (road markings, rooftops, signs)
function box(w, h, d, color, x, y, z, ry, cast, solid) {
  ry = ry === undefined ? 0 : ry;
  cast = cast === undefined ? true : cast;
  solid = solid === undefined ? true : solid;

  var m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color: color }),
  );
  m.position.set(x, y + h / 2, z);
  m.rotation.y = ry;
  m.castShadow = cast;
  m.receiveShadow = true;
  scene.add(m);

  // Register collider for tall solid objects only.
  // h > 2 threshold prevents road surfaces, curbs, and flat details from blocking the car.
  if (solid && h > 2.0) {
    var hw, hd;
    if (ry === 0 || ry === Math.PI) {
      hw = w / 2;
      hd = d / 2;
    } else if (Math.abs(ry) === Math.PI / 2) {
      hw = d / 2;
      hd = w / 2;
    } else {
      // General case: AABB of the rotated footprint
      var cosR = Math.abs(Math.cos(ry)),
        sinR = Math.abs(Math.sin(ry));
      hw = (w / 2) * cosR + (d / 2) * sinR;
      hd = (w / 2) * sinR + (d / 2) * cosR;
    }
    addCollider(x, z, hw, hd);
  }
  return m;
}

// cylinder() — creates a cylinder and optionally registers a square AABB collider.
function cylinder(rt, rb, h, segs, color, x, y, z, solid) {
  solid = solid === undefined ? false : solid;
  var m = new THREE.Mesh(
    new THREE.CylinderGeometry(rt, rb, h, segs),
    new THREE.MeshLambertMaterial({ color: color }),
  );
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  scene.add(m);
  if (solid && h > 1.0) {
    var r = Math.max(rt, rb);
    addCollider(x, z, r, r, 0.15);
  }
  return m;
}

// cone() — low-poly cone for hills and tree tops (no collision needed)
function cone(r, h, segs, color, x, y, z) {
  var m = new THREE.Mesh(
    new THREE.ConeGeometry(r, h, segs),
    new THREE.MeshLambertMaterial({ color: color }),
  );
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  scene.add(m);
  return m;
}

// ─── ROAD NETWORK ─────────────────────────────────────────────────────────────
function buildRoadNetwork() {
  var roadMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
  var lineMat = new THREE.MeshLambertMaterial({ color: 0xeeeeaa });
  var sideMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });

  function road(x, z, w, len, ry) {
    ry = ry === undefined ? 0 : ry;

    // Road surface
    var r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, len), roadMat);
    r.position.set(x, 0, z);
    r.rotation.y = ry;
    r.receiveShadow = true;
    scene.add(r);

    // Curb strips along each side (visual only — h=0.28 stays below h>2 threshold)
    [-1, 1].forEach(function (side) {
      var curb = new THREE.Mesh(
        new THREE.BoxGeometry(
          ry === 0 ? w + 0.6 : 0.4,
          0.28,
          ry === 0 ? 0.4 : len + 0.6,
        ),
        sideMat,
      );
      if (ry !== 0) {
        curb.position.set(x + side * (w / 2 + 0.2), 0, z);
      } else {
        curb.position.set(x, 0, z + side * (len / 2));
      }
      curb.receiveShadow = true;
      scene.add(curb);
    });

    // Dashed centre line (h=0.23 — purely visual, no collider)
    var dashCount = Math.floor(len / 8);
    for (var i = 0; i < dashCount; i++) {
      var dash = new THREE.Mesh(
        new THREE.BoxGeometry(ry === 0 ? 0.25 : 2, 0.23, ry === 0 ? 2 : 0.25),
        lineMat,
      );
      var offset = -len / 2 + 4 + i * 8;
      dash.position.set(
        x + (ry !== 0 ? offset * Math.sin(ry) : 0),
        0,
        z + (ry !== 0 ? offset * Math.cos(ry) : offset),
      );
      if (ry !== 0) dash.rotation.y = ry;
      scene.add(dash);
    }
  }

  // Main cross
  road(0, 0, 9, 240);
  road(0, 0, 9, 240, Math.PI / 2);
  // Outer ring
  road(-85, 0, 9, 170);
  road(85, 0, 9, 170);
  road(0, -85, 9, 170, Math.PI / 2);
  road(0, 85, 9, 170, Math.PI / 2);
  // Corner connectors
  road(-85, -85, 9, 9);
  road(85, -85, 9, 9);
  road(-85, 85, 9, 9);
  road(85, 85, 9, 9);
  // Shortcuts / side streets
  road(-42, -42, 7, 80, Math.PI / 4);
  road(42, 42, 7, 80, Math.PI / 4);
  road(-60, 0, 7, 60, Math.PI / 2);
  road(60, 0, 7, 60, Math.PI / 2);
  road(0, -60, 7, 60);
  road(0, 60, 7, 60);

  // Flat intersection pads
  [
    [0, 0],
    [-85, 0],
    [85, 0],
    [0, -85],
    [0, 85],
    [-85, -85],
    [85, -85],
    [-85, 85],
    [85, 85],
  ].forEach(function (pos) {
    var p = new THREE.Mesh(new THREE.BoxGeometry(18, 0.22, 18), roadMat);
    p.position.set(pos[0], 0, pos[1]);
    p.receiveShadow = true;
    scene.add(p);
  });
}

// ─── GRASSY FIELDS ────────────────────────────────────────────────────────────
function buildGrassyFields() {
  var patch = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshLambertMaterial({ color: 0x6abf55 }),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(-70, 0.01, -70);
  patch.receiveShadow = true;
  scene.add(patch);

  // Low-poly hills (cone — no collision)
  cone(18, 14, 6, 0x5aa845, -80, 0, -90);
  cone(12, 10, 6, 0x62b84e, -55, 0, -95);
  cone(22, 16, 5, 0x4ea03a, -95, 0, -60);
  cone(10, 8, 6, 0x70c660, -40, 0, -80);

  // Trees
  [
    [-60, -55],
    [-65, -75],
    [-75, -50],
    [-50, -65],
    [-90, -75],
    [-45, -90],
    [-82, -42],
    [-55, -40],
    [-95, -85],
    [-38, -70],
    [-70, -100],
    [-85, -55],
    [-48, -48],
  ].forEach(function (pos) {
    tree(pos[0], pos[1]);
  });

  // Fence posts + rails
  for (var i = 0; i < 8; i++) {
    box(0.3, 1.8, 0.3, 0x8b6914, -110 + i * 6, 0, -110);
    if (i < 7) box(0.15, 0.8, 4, 0x8b6914, -110 + i * 6 + 3, 0.5, -110);
  }
}

function tree(x, z, scale) {
  scale = scale === undefined ? 1 : scale;
  // Trunk — solid cylinder so the car can't drive through it
  cylinder(0.35 * scale, 0.45 * scale, 2.2 * scale, 6, 0x7a4a2a, x, 0, z, true);
  // Three layers of low-poly foliage cones
  cone(2.2 * scale, 3.0 * scale, 5, 0x2e8b2e, x, 2.2 * scale, z);
  cone(1.8 * scale, 2.5 * scale, 5, 0x3aaa3a, x, 3.8 * scale, z);
  cone(1.2 * scale, 2.0 * scale, 5, 0x4aba4a, x, 5.2 * scale, z);
}

// ─── DOWNTOWN ─────────────────────────────────────────────────────────────────
function buildDowntown() {
  var plaza = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshLambertMaterial({ color: 0x888888 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.01, 0);
  plaza.receiveShadow = true;
  scene.add(plaza);

  // Buildings — [x, z, w, d, h, color]
  [
    [-25, -25, 10, 10, 28, 0x8899bb],
    [25, -25, 8, 8, 35, 0x6688aa],
    [-25, 25, 12, 10, 22, 0xaabbcc],
    [25, 25, 10, 12, 30, 0x778899],
    [-38, -12, 8, 6, 18, 0x99aabb],
    [38, -12, 6, 8, 24, 0x7799aa],
    [-38, 12, 6, 6, 14, 0xbbccdd],
    [38, 12, 8, 6, 20, 0x8899aa],
    [0, -35, 14, 10, 12, 0xaabbbb],
    [0, 35, 10, 14, 16, 0x99aacc],
    [-14, -14, 6, 6, 40, 0x5577aa],
    [14, 14, 6, 6, 38, 0x4466aa],
  ].forEach(function (b) {
    building(b[0], b[1], b[2], b[3], b[4], b[5]);
  });

  // Fountain
  cylinder(4, 4, 0.6, 8, 0x888888, 0, 0, 0);
  addCollider(0, 0, 4, 4); // fountain rim blocks car
  cylinder(1.5, 1.5, 1.2, 8, 0x6699bb, 0, 0.6, 0);

  // Lampposts — kept only on the outer edges of downtown,
  // well away from the car spawn at (0, -10) so the player
  // can drive out freely without clipping a post
  [
    [-20, 0],
    [20, 0],
    [0, 20],
    [-30, -30],
    [30, -30],
    [-30, 30],
    [30, 30],
  ].forEach(function (pos) {
    lamppost(pos[0], pos[1]);
  });

  // Billboards
  billboard(18, -30, 0xff6644);
  billboard(-18, -30, 0x44aaff);
}

function building(x, z, w, d, h, color) {
  box(w, h, d, color, x, 0, z); // main body — auto-registers collider (h > 2)
  box(w * 0.4, 2, d * 0.4, 0x556677, x, h, z, 0, true, false); // rooftop trim — no collision
  // Windows (purely visual meshes — no box() collider needed)
  var winMat = new THREE.MeshLambertMaterial({
    color: 0x99ccff,
    emissive: 0x224466,
    emissiveIntensity: 0.3,
  });
  for (var fl = 3; fl < h - 2; fl += 3.5) {
    for (var col = -w / 2 + 1; col < w / 2; col += 2.5) {
      var win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.5, 0.15), winMat);
      win.position.set(x + col, fl, z + d / 2 + 0.01);
      scene.add(win);
      var win2 = win.clone();
      win2.position.set(x + col, fl, z - d / 2 - 0.01);
      win2.rotation.y = Math.PI;
      scene.add(win2);
    }
  }
}

function lamppost(x, z) {
  cylinder(0.1, 0.15, 5, 6, 0x444444, x, 0, z);
  addCollider(x, z, 0.4, 0.4); // small footprint so car can't drive through post
  box(0.1, 0.1, 1.5, 0x444444, x, 5, z, 0, true, false); // horizontal arm — no collision
  var bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 6, 4),
    new THREE.MeshLambertMaterial({
      color: 0xffffcc,
      emissive: 0xffffaa,
      emissiveIntensity: 0.8,
    }),
  );
  bulb.position.set(x, 5.2, z + 0.6);
  scene.add(bulb);
}

function billboard(x, z, color) {
  cylinder(0.2, 0.2, 6, 6, 0x555555, x, 0, z);
  addCollider(x, z, 0.5, 0.5); // post footprint
  box(8, 3, 0.3, color, x, 6, z, 0, true, false); // board — high up
  box(8.6, 3.6, 0.25, 0xffffff, x, 6, z - 0.05, 0, true, false); // border
}

// ─── ROCKY HILLS ──────────────────────────────────────────────────────────────
function buildRockyHills() {
  var patch = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshLambertMaterial({ color: 0x9e8866 }),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(80, 0.01, -70);
  patch.receiveShadow = true;
  scene.add(patch);

  // Big rocky hills
  cone(25, 22, 5, 0x8a7558, 90, 0, -85);
  cone(18, 18, 5, 0x9e8866, 70, 0, -65);
  cone(14, 15, 4, 0x7a6548, 105, 0, -60);
  cone(20, 20, 6, 0xb09070, 75, 0, -95);
  cone(10, 12, 5, 0x8a7558, 60, 0, -80);

  // Cliff platform (driveable top surface — sides block the car)
  box(30, 8, 25, 0x9e8866, 95, 0, -55, 0, true, false);
  addCollider(95, -55, 15, 12.5); // cliff wall collider

  // Ramp up to cliff
  var rampGeo = new THREE.BoxGeometry(10, 0.5, 18);
  var ramp = new THREE.Mesh(
    rampGeo,
    new THREE.MeshLambertMaterial({ color: 0x888866 }),
  );
  ramp.rotation.x = -Math.atan2(8, 18);
  ramp.position.set(95, 3.8, -40);
  scene.add(ramp);

  // Tunnel entrance arch
  tunnelArch(75, 0, -55, Math.PI / 2);

  // Boulders — random scale, each auto-registers a collider
  [
    [55, -70],
    [100, -75],
    [65, -90],
    [115, -55],
    [80, -45],
  ].forEach(function (pos) {
    var s = 0.8 + Math.random() * 1.2;
    box(s * 3, s * 2.5, s * 3, 0x888877, pos[0], 0, pos[1]);
  });

  // Dry trees (decorative — trunks register small colliders)
  [
    [60, -60],
    [65, -85],
    [100, -90],
    [110, -70],
  ].forEach(function (pos) {
    dryTree(pos[0], pos[1]);
  });
}

function tunnelArch(x, y, z, ry) {
  ry = ry === undefined ? 0 : ry;
  box(2, 8, 2, 0x777766, x - 4, 0, z, ry);
  box(2, 8, 2, 0x777766, x + 4, 0, z, ry);
  box(10, 2, 2.5, 0x777766, x, 8, z, ry);
  box(6, 6, 2.6, 0x333333, x, 1, z, ry);
}

function dryTree(x, z) {
  cylinder(0.3, 0.4, 3, 5, 0x6a4a2a, x, 0, z);
  box(3, 0.2, 0.2, 0x6a4a2a, x, 3, z);
  box(0.2, 0.2, 2, 0x6a4a2a, x + 1, 3.5, z);
  box(0.2, 0.2, 1.5, 0x6a4a2a, x - 0.8, 3.2, z);
}

// ─── INDUSTRIAL STRIP ─────────────────────────────────────────────────────────
function buildIndustrialStrip() {
  var patch = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 110),
    new THREE.MeshLambertMaterial({ color: 0x777766 }),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(-70, 0.01, 70);
  patch.receiveShadow = true;
  scene.add(patch);

  gasStation(-75, 55);
  parkingLot(-55, 80);

  // Warehouse
  box(30, 12, 20, 0x888877, -90, 0, 80); // body — collider auto-added
  box(30.5, 1, 20.5, 0x555544, -90, 12, 80, 0, true, false); // roof — no collision
  box(8, 8, 0.4, 0x444433, -90, 0, 70.2, 0, true, false); // door face — no collision

  // Smoke stacks
  cylinder(1, 1.5, 18, 6, 0x666655, -80, 0, 68);
  cylinder(1, 1.5, 14, 6, 0x666655, -84, 0, 68);

  // Traffic barriers
  for (var i = 0; i < 5; i++) {
    box(0.4, 1, 0.4, 0xff6600, -62 + i * 3, 0, 62);
  }

  billboard(-58, 72, 0xee8800);
}

function gasStation(x, z) {
  box(10, 5, 8, 0xeeeedd, x, 0, z); // building — collider auto-added
  box(18, 0.5, 10, 0xdd3333, x + 10, 5.5, z, 0, true, false); // overhead canopy
  cylinder(0.3, 0.3, 5.5, 6, 0x888888, x + 4, 0, z - 4); // canopy supports
  cylinder(0.3, 0.3, 5.5, 6, 0x888888, x + 4, 0, z + 4);
  cylinder(0.3, 0.3, 5.5, 6, 0x888888, x + 16, 0, z - 4);
  cylinder(0.3, 0.3, 5.5, 6, 0x888888, x + 16, 0, z + 4);
  // Fuel pumps
  [-3, 0, 3].forEach(function (off) {
    box(1.2, 2.5, 0.8, 0x444444, x + 10, 0, z + off * 2.5); // pump body — collider auto-added
    box(0.4, 0.4, 0.3, 0xffcc00, x + 10, 1.5, z + off * 2.5, 0, true, false); // indicator light
  });
  // Sign pole
  cylinder(0.2, 0.2, 7, 6, 0x666666, x - 6, 0, z);
  addCollider(x - 6, z, 0.5, 0.5);
  box(5, 2.5, 0.3, 0xff6600, x - 6, 7, z, 0, true, false); // sign board — high up
}

function parkingLot(x, z) {
  var lot = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 20),
    new THREE.MeshLambertMaterial({ color: 0x555555 }),
  );
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(x, 0.02, z);
  scene.add(lot);

  // Parked car bodies
  var carColors = [0xff4444, 0x4444ff, 0x44ff44, 0xffff44, 0xffffff];
  for (var i = 0; i < 5; i++) {
    box(4, 1.5, 2, carColors[i], x - 10 + i * 5, 0, z - 5);
    box(4, 1.5, 2, carColors[(i + 2) % 5], x - 10 + i * 5, 0, z + 5);
  }

  // Parking bay lines
  for (var j = 0; j < 6; j++) {
    var line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 4),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(x - 12.5 + j * 5, 0.03, z - 5);
    scene.add(line);
    var line2 = line.clone();
    line2.position.set(x - 12.5 + j * 5, 0.03, z + 5);
    scene.add(line2);
  }
}

// ─── WATERFRONT ───────────────────────────────────────────────────────────────
function buildWaterfront() {
  // Water plane
  var water = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 50),
    new THREE.MeshLambertMaterial({ color: 0x3a7fc1 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(90, -0.5, 90);
  scene.add(water);

  // Land patch
  var patch = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 110),
    new THREE.MeshLambertMaterial({ color: 0x4a9a88 }),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(80, 0.01, 70);
  patch.receiveShadow = true;
  scene.add(patch);

  bridge(70, 0, 75, Math.PI / 2);

  // Dock (flat — no collision)
  box(20, 0.5, 5, 0x8b6914, 95, -0.3, 70, 0, true, false);
  [
    [90, 68],
    [90, 72],
    [100, 68],
    [100, 72],
    [108, 68],
    [108, 72],
  ].forEach(function (pos) {
    cylinder(0.4, 0.4, 4, 6, 0x6a4a2a, pos[0], -2, pos[1]);
  });

  lighthouse(108, 58);

  // Sailboat (on water — no collision)
  box(6, 0.5, 2.5, 0xddcc88, 90, -0.3, 88, 0, true, false);
  box(0.2, 6, 0.2, 0x885522, 90, 0.5, 88, 0, true, false);
  var sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 5, 0, 0, 0, 3]), 3),
  );
  var sail = new THREE.Mesh(
    sailGeo,
    new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  );
  sail.position.set(90, 0.5, 88);
  scene.add(sail);

  // Coastal trees
  [
    [65, 60],
    [65, 65],
    [65, 75],
    [65, 82],
  ].forEach(function (pos) {
    tree(pos[0], pos[1], 0.8);
  });
}

function bridge(x, y, z, ry) {
  ry = ry === undefined ? 0 : ry;
  var deck = new THREE.Mesh(
    new THREE.BoxGeometry(50, 0.8, 9),
    new THREE.MeshLambertMaterial({ color: 0x888877 }),
  );
  deck.position.set(x, 2.5, z);
  deck.rotation.y = ry;
  deck.castShadow = true;
  scene.add(deck);

  // Pillars
  for (var i = -2; i <= 2; i++) {
    cylinder(
      0.8,
      1,
      3.5,
      6,
      0x777766,
      x + (ry === 0 ? i * 10 : 0),
      -1,
      z + (ry === 0 ? 0 : i * 10),
    );
  }

  // Railing posts
  for (var j = -2; j <= 2; j++) {
    box(
      0.2,
      1.2,
      0.2,
      0x999988,
      x + (ry === 0 ? j * 10 : 3.5),
      3,
      z + (ry === 0 ? 3.5 : j * 10),
    );
    box(
      0.2,
      1.2,
      0.2,
      0x999988,
      x + (ry === 0 ? j * 10 : -3.5),
      3,
      z + (ry === 0 ? -3.5 : j * 10),
    );
  }

  // Handrails
  var rail1 = new THREE.Mesh(
    new THREE.BoxGeometry(50, 0.15, 0.15),
    new THREE.MeshLambertMaterial({ color: 0x999988 }),
  );
  rail1.position.set(x, 4, z + (ry === 0 ? 3.5 : 0));
  rail1.rotation.y = ry;
  scene.add(rail1);
  var rail2 = rail1.clone();
  rail2.position.set(x, 4, z + (ry === 0 ? -3.5 : 0));
  scene.add(rail2);
}

function lighthouse(x, z) {
  cylinder(2, 2.5, 14, 8, 0xffeeee, x, 0, z);
  addCollider(x, z, 2.5, 2.5); // base footprint
  cylinder(2.5, 2.5, 0.8, 8, 0x333333, x, 14, z);
  cylinder(1.5, 1.5, 2.0, 8, 0xffcc00, x, 14.8, z);
  cylinder(2.2, 2.2, 0.4, 8, 0x333333, x, 16.8, z);
  cone(1.5, 2, 6, 0xdd3333, x, 17.4, z);
}

// ─── CAR ──────────────────────────────────────────────────────────────────────
function buildCar() {
  car = new THREE.Group();

  // Body
  var body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.9, 4.4),
    new THREE.MeshLambertMaterial({ color: 0xee3333 }),
  );
  body.position.y = 0.55;
  body.castShadow = true;
  car.add(body);

  // Cabin
  var cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.85, 2.4),
    new THREE.MeshLambertMaterial({ color: 0xcc2222 }),
  );
  cabin.position.set(0, 1.35, -0.2);
  cabin.castShadow = true;
  car.add(cabin);

  // Windshield
  var windshield = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.7, 0.1),
    new THREE.MeshLambertMaterial({
      color: 0x88ccee,
      transparent: true,
      opacity: 0.6,
    }),
  );
  windshield.position.set(0, 1.35, 1);
  car.add(windshield);

  // Wheels + rims
  var wheelMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  var rimMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
  [
    [1.2, 0, 1.6],
    [-1.2, 0, 1.6],
    [1.2, 0, -1.6],
    [-1.2, 0, -1.6],
  ].forEach(function (pos) {
    var wx = pos[0],
      wz = pos[2];
    var wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 0.28, 10),
      wheelMat,
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.38, wz);
    car.add(wheel);
    var rim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.3, 6),
      rimMat,
    );
    rim.rotation.z = Math.PI / 2;
    rim.position.set(wx > 0 ? wx + 0.01 : wx - 0.01, 0.38, wz);
    car.add(rim);
  });

  // Headlights
  var hlMat = new THREE.MeshLambertMaterial({
    color: 0xffffcc,
    emissive: 0xffffaa,
    emissiveIntensity: 0.8,
  });
  [0.65, -0.65].forEach(function (hx) {
    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.1), hlMat);
    hl.position.set(hx, 0.6, 2.2);
    car.add(hl);
  });

  car.position.set(0, 0.38, -10);
  car.castShadow = true;
  scene.add(car);
}

function resetCar() {
  car.position.set(0, 0.38, -10);
  car.rotation.set(0, 0, 0);
  carVelocity = 0;
  carSteering = 0;
  carRotation = 0;
}

// ─── MINIMAP ──────────────────────────────────────────────────────────────────
function drawMinimap() {
  var mc = document.getElementById("minimap-canvas");
  var ctx = mc.getContext("2d");
  var W = 160,
    H = 160,
    SCALE = 0.6,
    CX = W / 2,
    CY = H / 2;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#1a2a1a";
  ctx.fillRect(0, 0, W, H);

  // Zone colour circles
  var zoneColors = {
    "🌿 Grassy Fields": "#3a6a2a",
    "🏙️ Downtown": "#334466",
    "⛰️ Rocky Hills": "#554433",
    "⛽ Industrial Strip": "#443322",
    "🌉 Waterfront": "#224455",
  };
  ZONES.forEach(function (z) {
    var sx = CX + z.cx * SCALE,
      sy = CY + z.cz * SCALE;
    ctx.beginPath();
    ctx.arc(sx, sy, z.r * SCALE, 0, Math.PI * 2);
    ctx.fillStyle = zoneColors[z.name] || "#333";
    ctx.fill();
  });

  // Simplified road lines
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CX, CY - 72);
  ctx.lineTo(CX, CY + 72);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(CX - 72, CY);
  ctx.lineTo(CX + 72, CY);
  ctx.stroke();
  ctx.strokeRect(CX - 50, CY - 50, 100, 100);

  // Checkpoint markers
  CHECKPOINTS.forEach(function (cp, i) {
    if (i < currentCP) return; // already collected
    var mx = CX + cp.x * SCALE;
    var mz = CY + cp.z * SCALE;
    ctx.beginPath();
    ctx.arc(mx, mz, i === currentCP ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = i === currentCP ? "#7ef5a8" : "rgba(126,245,168,0.35)";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.font = "bold 7px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String.fromCharCode(65 + i), mx, mz + 2.5);
  });

  // Player arrow
  var cx2 = CX + car.position.x * SCALE;
  var cy2 = CY + car.position.z * SCALE;
  ctx.save();
  ctx.translate(cx2, cy2);
  ctx.rotate(car.rotation.y);
  ctx.fillStyle = "#ff4444";
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(3, 3);
  ctx.lineTo(-3, 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ─── CAR PHYSICS ──────────────────────────────────────────────────────────────
function updateCar(dt) {
  var boost = keys["ShiftLeft"] || keys["ShiftRight"];
  var maxSpeed = boost ? 0.55 : 0.32;
  var accel = 0.018;
  var brakeForce = 0.025;
  var friction = 0.012;
  var turnSpeed = 0.032;

  var fwd = keys["ArrowUp"] || keys["KeyW"];
  var bwd = keys["ArrowDown"] || keys["KeyS"];
  var left = keys["ArrowLeft"] || keys["KeyA"];
  var right = keys["ArrowRight"] || keys["KeyD"];

  if (fwd) carVelocity = Math.min(carVelocity + accel, maxSpeed);
  else if (bwd)
    carVelocity = Math.max(carVelocity - brakeForce, -maxSpeed * 0.5);
  else carVelocity *= 1 - friction;

  if (Math.abs(carVelocity) > 0.005) {
    var steerAmount = turnSpeed * (carVelocity > 0 ? 1 : -1);
    if (left) carRotation += steerAmount;
    if (right) carRotation -= steerAmount;
  }

  car.rotation.y = carRotation;
  car.position.x += Math.sin(carRotation) * carVelocity;
  car.position.z += Math.cos(carRotation) * carVelocity;
  car.position.y = 0.38; // keep on ground

  // World boundary fence
  car.position.x = Math.max(-140, Math.min(140, car.position.x));
  car.position.z = Math.max(-140, Math.min(140, car.position.z));

  // Push car out of any solid object it has overlapped
  resolveCollisions();

  // Update HUD speed readout
  // Smoothly interpolate the displayed speed toward the real speed so it
  // rises and falls gradually rather than jumping in large steps
  var realKmh = Math.abs(carVelocity) * 350;
  displaySpeed += (realKmh - displaySpeed) * 0.08;
  document.getElementById("speed-display").textContent =
    Math.floor(displaySpeed);

  detectZone(car.position.x, car.position.z);
}

// ─── CAMERA ───────────────────────────────────────────────────────────────────
function updateCamera() {
  var offset = new THREE.Vector3(0, 5.5, -12);
  offset.applyQuaternion(car.quaternion);
  var target = car.position.clone().add(offset);
  camera.position.lerp(target, 0.07); // smooth follow with slight lag
  camera.lookAt(car.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
function animate() {
  if (!gameRunning) return;
  requestAnimationFrame(animate);
  var dt = clock.getDelta();
  updateCar(dt);
  updateCamera();
  updateMarkers(dt);
  updateMissionHUD();
  checkCheckpoints();
  drawMinimap();
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
