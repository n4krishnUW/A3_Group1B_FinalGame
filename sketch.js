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
      new THREE.CylinderGeometry(0.4, 0.4, 18, 8),
      poleMat,
    );
    pole.position.y = 9;
    group.add(pole);

    // Spinning diamond on top
    var diamondMat = new THREE.MeshLambertMaterial({
      color: cp.color,
      emissive: cp.color,
      emissiveIntensity: 0.9,
    });
    var diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(3.5, 0),
      diamondMat,
    );
    diamond.position.y = 16;
    diamond.name = "diamond";
    group.add(diamond);

    // Ground ring showing the trigger radius — raised above road surface (road top = 0.24)
    var ringMat = new THREE.MeshLambertMaterial({
      color: cp.color,
      emissive: cp.color,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    var ring = new THREE.Mesh(
      new THREE.CylinderGeometry(cp.r, cp.r, 0.15, 32, 1, true),
      ringMat,
    );
    ring.position.y = 0.35; // sits visibly above road surface
    group.add(ring);

    group.position.set(cp.x, 0, cp.z);
    scene.add(group);
    cpMarkers.push(group);
  });
}

// Spin diamonds and manage beacon visibility — called every frame
function updateMarkers(dt) {
  markerRotation += dt * 1.8;
  cpMarkers.forEach(function (group, i) {
    // Only show the current active destination — everything else hidden
    if (i !== currentCP || !missionActive || missionComplete) {
      group.visible = false;
      return;
    }
    group.visible = true;
    var diamond = group.getObjectByName("diamond");
    if (diamond) {
      diamond.rotation.y = markerRotation;
      // Bigger bob and scale pulse for maximum visibility
      diamond.position.y = 14 + Math.sin(markerRotation * 2.5) * 1.2;
      var pulse = 1 + Math.sin(markerRotation * 3) * 0.18;
      diamond.scale.set(pulse, pulse, pulse);
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

  // Only show the first checkpoint marker
  cpMarkers.forEach(function (g, i) {
    g.visible = i === 0;
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
  var mat = new THREE.MeshLambertMaterial({
    color: 0x5a9e4a,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
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
  var ROAD_TOP = 0.12;
  var roadMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
  var lineMat = new THREE.MeshLambertMaterial({ color: 0xffffff });

  function road(x, z, w, len, ry) {
    ry = ry === undefined ? 0 : ry;
    var cos = Math.cos(ry),
      sin = Math.sin(ry);

    // ── Road surface ─────────────────────────────────────────────────────
    var surf = new THREE.Mesh(
      new THREE.BoxGeometry(w, ROAD_TOP * 2, len),
      roadMat,
    );
    surf.position.set(x, ROAD_TOP, z);
    surf.rotation.y = ry;
    surf.receiveShadow = true;
    scene.add(surf);

    // ── Dashed centre line ───────────────────────────────────────────────
    // Skip a clearance zone at each end so dashes never spill into intersections
    var PAD_CLEAR = 9; // matches intersection pad size — no dashes this close to ends
    var dashLen = 3;
    var dashGap = 5;
    var dashCycle = dashLen + dashGap;
    var usable = len - PAD_CLEAR * 2; // drawable length, clear of both ends
    if (usable < dashLen) return; // road too short for any dashes

    var numDashes = Math.floor((usable + dashGap) / dashCycle);
    var totalUsed = numDashes * dashCycle - dashGap;
    var startOffset = -totalUsed / 2 + dashLen / 2; // centre dashes within usable zone

    for (var i = 0; i < numDashes; i++) {
      var along = startOffset + i * dashCycle;
      var dash = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.05, dashLen),
        lineMat,
      );
      dash.position.set(x + along * sin, ROAD_TOP * 2 + 0.02, z + along * cos);
      dash.rotation.y = ry;
      scene.add(dash);
    }
  }

  // ── Intersection pad — exact same height as road surface ────────────
  function pad(x, z, size) {
    var p = new THREE.Mesh(
      new THREE.BoxGeometry(size, ROAD_TOP * 2, size),
      roadMat,
    );
    p.position.set(x, ROAD_TOP, z);
    p.receiveShadow = true;
    scene.add(p);
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

  // ════════════════════════════════════════════════════════════════════
  // ROAD NETWORK  — every road endpoint touches at least one other road.
  // Convention:  road(centreX, centreZ, width, length, rotation)
  //   ry = 0       → runs N-S  (along Z), endpoints at centreZ ± length/2
  //   ry = PI/2    → runs E-W  (along X), endpoints at centreX ± length/2
  // All coordinates verified so no floating disconnected stubs.
  // ════════════════════════════════════════════════════════════════════

  // ── 1. OUTER RING  (forms the world boundary rectangle) ─────────────
  //   N side:  z = -85, x = -85..85
  //   S side:  z =  85, x = -85..85
  //   W side:  x = -85, z = -85..85
  //   E side:  x =  85, z = -85..85
  road(0, -85, 9, 170, Math.PI / 2); // N outer E-W
  road(0, 85, 9, 170, Math.PI / 2); // S outer E-W
  road(-85, 0, 9, 170, 0); // W outer N-S
  road(85, 0, 9, 170, 0); // E outer N-S
  // corner pads handled below in intersection list

  // ── 2. MAIN CROSS  (x=0 N-S and z=0 E-W, full map width) ───────────
  road(0, 0, 9, 170, 0); // main N-S  (z=-85..85)
  road(0, 0, 9, 170, Math.PI / 2); // main E-W  (x=-85..85)

  // ── 3. INNER GRID  (x=±42 N-S, z=±42 E-W — connects outer to centre) ─
  //   N-S at x=-42: z=-85..85  (full height, connects outer ring both ends)
  road(-42, 0, 7, 170, 0); // inner W N-S
  road(42, 0, 7, 170, 0); // inner E N-S
  //   E-W at z=-42: x=-85..85
  road(0, -42, 7, 170, Math.PI / 2); // inner N E-W
  road(0, 42, 7, 170, Math.PI / 2); // inner S E-W

  // ── 4. MID-LATITUDE EAST-WEST ROADS  (z=-62, z=62 — fills N/S gaps) ─
  road(0, -62, 7, 170, Math.PI / 2); // z=-62 E-W (x=-85..85)
  road(0, 62, 7, 170, Math.PI / 2); // z= 62 E-W (x=-85..85)

  // ── 5. MID-LONGITUDE N-S ROADS  (x=-62, x=62 — fills E/W gaps) ─────
  road(-62, 0, 7, 170, 0); // x=-62 N-S (z=-85..85)
  road(62, 0, 7, 170, 0); // x= 62 N-S (z=-85..85)

  // ── 6. GAS STATION APPROACH  (destination at -75, 55) ───────────────
  //   x=-75 N-S from outer ring z=-85 down to z=85
  road(-75, 0, 8, 170, 0); // x=-75 full N-S (hits outer ring at ±85)
  //   E-W connector at z=55 from x=-85 to x=-62 (outer ring to x=-62 N-S)
  road(-73, 55, 7, 24, Math.PI / 2); // z=55 short E-W stub: x=-85..x=-61 → ties x=-75 spur to x=-62

  // ── 7. WATERFRONT APPROACH  (destination at 80, 70) ─────────────────
  //   x=80 N-S already covered by outer ring at x=85 and inner x=62
  //   Add a dedicated spur: x=80, z=42..85 (connects inner S E-W to outer S)
  road(80, 63, 7, 46, 0); // x=80 N-S: z=40..86 — ties z=42 inner to z=85 outer
  //   E-W at z=70 from x=62 to x=85
  road(73, 70, 7, 22, Math.PI / 2); // z=70 E-W: x=62..84 — connects x=62 N-S to waterfront

  // ── 8. DOWNTOWN CROSS STREETS  (destination at 0, -25) ──────────────
  //   x=-22 and x=22 N-S between z=-42 and z=0 (inner grid already at ±42 E-W and z=0 E-W)
  road(-22, -21, 7, 42, 0); // x=-22 N-S: z=-42..0
  road(22, -21, 7, 42, 0); // x= 22 N-S: z=-42..0
  //   z=-25 E-W from x=-42 to x=42
  road(0, -25, 7, 84, Math.PI / 2); // z=-25 E-W: x=-42..42

  // ── 9. DIAGONALS  (expressways cutting across zones) ────────────────
  //   These cut between grid intersections; pads at each end catch the gaps
  road(-21, -21, 7, 80, Math.PI / 4); // NW diagonal (-42,-42 → 0,0 region)
  road(21, 21, 7, 80, Math.PI / 4); // SE diagonal (0,0 → 42,42 region)
  road(21, -21, 7, 80, -Math.PI / 4); // NE diagonal (0,-42 → 42,0 region)
  road(-21, 21, 7, 80, -Math.PI / 4); // SW diagonal (-42,0 → 0,42 region)

  // ── 10. INTERSECTION PADS  (large flat squares at every grid crossing) ─
  // Outer ring corners
  var outerCorners = [
    [-85, -85],
    [85, -85],
    [-85, 85],
    [85, 85],
  ];
  // Main cross + outer ring junctions
  var mainJunctions = [
    [0, -85],
    [0, 85],
    [-85, 0],
    [85, 0],
    [0, 0],
  ];
  // Inner grid crossings (every combination of {-85,-62,-42,0,42,62,85} on both axes
  // that actually has two roads crossing)
  var innerJunctions = [
    // x=-42 N-S crosses all E-W roads
    [-42, -85],
    [-42, -62],
    [-42, -42],
    [-42, 0],
    [-42, 42],
    [-42, 62],
    [-42, 85],
    // x=42 N-S crosses all E-W roads
    [42, -85],
    [42, -62],
    [42, -42],
    [42, 0],
    [42, 42],
    [42, 62],
    [42, 85],
    // x=-62 N-S crosses all E-W roads
    [-62, -85],
    [-62, -62],
    [-62, -42],
    [-62, 0],
    [-62, 42],
    [-62, 62],
    [-62, 85],
    // x=62 N-S crosses all E-W roads
    [62, -85],
    [62, -62],
    [62, -42],
    [62, 0],
    [62, 42],
    [62, 62],
    [62, 85],
    // main x=0 N-S crosses extra E-W roads
    [0, -62],
    [0, -42],
    [0, 42],
    [0, 62],
    // x=-75 spur crosses E-W roads
    [-75, -85],
    [-75, -62],
    [-75, -42],
    [-75, 0],
    [-75, 42],
    [-75, 62],
    [-75, 85],
    // x=80 spur
    [80, 42],
    [80, 62],
    [80, 85],
    // downtown extras
    [-22, -42],
    [-22, 0],
    [22, -42],
    [22, 0],
    [-22, -25],
    [22, -25],
    // waterfront junction
    [73, 70],
    [62, 70],
    [80, 70],
    // gas station junction
    [-73, 55],
    [-75, 55],
    // diagonal endpoints (approx)
    [-42, -42],
    [42, 42],
    [42, -42],
    [-42, 42],
  ];

  outerCorners
    .concat(mainJunctions)
    .concat(innerJunctions)
    .forEach(function (pos) {
      pad(pos[0], pos[1], 16);
    });
}

// ─── GRASSY FIELDS ────────────────────────────────────────────────────────────
function buildGrassyFields() {
  var patch = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshLambertMaterial({
      color: 0x6abf55,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
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
    new THREE.MeshLambertMaterial({
      color: 0x888888,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
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
    new THREE.MeshLambertMaterial({
      color: 0x9e8866,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
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
    new THREE.MeshLambertMaterial({
      color: 0x777766,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
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
    new THREE.MeshLambertMaterial({
      color: 0x4a9a88,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
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
  // Map covers world coords -100 to +100 on both axes → 200 world units
  // Canvas is 200×200 for sharper rendering (CSS still scales to 160×160)
  mc.width = 200;
  mc.height = 200;
  var W = 200,
    H = 200;
  // Scale + offset so world (0,0) = canvas centre
  var S = W / 210; // ~0.95 px per world unit — world spans ±105
  function wx(x) {
    return W / 2 + x * S;
  }
  function wz(z) {
    return H / 2 - z * S;
  }

  // ── Background ──
  ctx.fillStyle = "#111a11";
  ctx.fillRect(0, 0, W, H);

  // ── Zone fills (flat coloured rectangles matching each zone's rough footprint) ──
  var zones = [
    { x: -70, z: -70, w: 110, h: 110, color: "#1e3a1a" }, // Grassy Fields NW
    { x: 25, z: -90, w: 95, h: 100, color: "#2a2218" }, // Rocky Hills NE
    { x: -20, z: -20, w: 80, h: 80, color: "#192233" }, // Downtown centre
    { x: -125, z: 15, w: 110, h: 110, color: "#221c10" }, // Industrial SW
    { x: 35, z: 20, w: 110, h: 110, color: "#112233" }, // Waterfront SE
  ];
  zones.forEach(function (z) {
    ctx.fillStyle = z.color;
    // With Z flipped, world top (z.z) maps to canvas bottom, so use wz(z.z + z.h) as canvas top
    ctx.fillRect(wx(z.x), wz(z.z + z.h), z.w * S, z.h * S);
  });

  // ── Water patch (Waterfront) ──
  ctx.fillStyle = "#1a3a4a";
  ctx.fillRect(wx(55), wz(65 + 45), 70 * S, 45 * S);

  // ── Map boundary box ──
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(wx(-100), wz(100), 200 * S, 200 * S);

  // Helper: draw one road segment as a filled rect on the minimap
  // Matches the road() call signature: centre x/z, width w, length len, rotation ry
  function mroad(x, z, w, len, ry) {
    ry = ry || 0;
    ctx.save();
    ctx.translate(wx(x), wz(z));
    ctx.rotate(-ry);
    // Main tarmac
    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect((-len * S) / 2, (-w * S) / 2, len * S, w * S);
    // Centre dash line
    ctx.fillStyle = "rgba(220,210,120,0.35)";
    ctx.fillRect((-len * S) / 2, -0.4, len * S, 0.8);
    ctx.restore();
  }

  // ── Draw every road — mirrors buildRoadNetwork exactly ──────────────
  // Outer ring
  mroad(0, -85, 9, 170, Math.PI / 2);
  mroad(0, 85, 9, 170, Math.PI / 2);
  mroad(-85, 0, 9, 170, 0);
  mroad(85, 0, 9, 170, 0);
  // Main cross
  mroad(0, 0, 9, 170, 0);
  mroad(0, 0, 9, 170, Math.PI / 2);
  // Inner full-height grid
  mroad(-42, 0, 7, 170, 0);
  mroad(42, 0, 7, 170, 0);
  mroad(0, -42, 7, 170, Math.PI / 2);
  mroad(0, 42, 7, 170, Math.PI / 2);
  // Mid-latitude E-W
  mroad(0, -62, 7, 170, Math.PI / 2);
  mroad(0, 62, 7, 170, Math.PI / 2);
  // Mid-longitude N-S
  mroad(-62, 0, 7, 170, 0);
  mroad(62, 0, 7, 170, 0);
  // Gas station spur
  mroad(-75, 0, 8, 170, 0);
  mroad(-73, 55, 7, 24, Math.PI / 2);
  // Waterfront spur
  mroad(80, 63, 7, 46, 0);
  mroad(73, 70, 7, 22, Math.PI / 2);
  // Downtown cross streets
  mroad(-22, -21, 7, 42, 0);
  mroad(22, -21, 7, 42, 0);
  mroad(0, -25, 7, 84, Math.PI / 2);
  // Diagonals
  mroad(-21, -21, 7, 80, Math.PI / 4);
  mroad(21, 21, 7, 80, Math.PI / 4);
  mroad(21, -21, 7, 80, -Math.PI / 4);
  mroad(-21, 21, 7, 80, -Math.PI / 4);

  // ── Active checkpoint marker — pulsing ring ──
  if (missionActive && !missionComplete) {
    var cp = CHECKPOINTS[currentCP];
    var pulse = 0.55 + 0.45 * Math.abs(Math.sin(Date.now() * 0.003));
    ctx.beginPath();
    ctx.arc(wx(cp.x), wz(cp.z), 7 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(126,245,168,0.25)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wx(cp.x), wz(cp.z), 5, 0, Math.PI * 2);
    ctx.fillStyle = "#7ef5a8";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Letter label
    ctx.fillStyle = "#000";
    ctx.font = "bold 6px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String.fromCharCode(65 + currentCP), wx(cp.x), wz(cp.z));
  }

  // ── Collected checkpoint tick marks ──
  for (var ci = 0; ci < currentCP; ci++) {
    var dcp = CHECKPOINTS[ci];
    ctx.beginPath();
    ctx.arc(wx(dcp.x), wz(dcp.z), 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(126,245,168,0.3)";
    ctx.fill();
  }

  // ── Player arrow ──
  var px = wx(car.position.x);
  var pz = wz(car.position.z);
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(car.rotation.y);
  // White halo
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fill();
  // wz flips Z so +Z world = canvas UP. rotation.y=0 = facing +Z = tip points up (0,-7)
  ctx.fillStyle = "#ff4444";
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(4, 4);
  ctx.lineTo(-4, 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();

  // ── Cardinal labels ──
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.font = "7px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", W / 2, 7);
  ctx.fillText("S", W / 2, H - 7);
  ctx.fillText("W", 7, H / 2);
  ctx.fillText("E", W - 7, H / 2);
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
  car.position.y = 0.38; // keep on ground (clears road top at y=0.24)

  // Hard boundary — matches the minimap border (world coords ±100)
  car.position.x = Math.max(-100, Math.min(100, car.position.x));
  car.position.z = Math.max(-100, Math.min(100, car.position.z));

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
