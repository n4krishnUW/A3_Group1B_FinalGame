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

// ─── LIGHTING REFERENCES ──────────────────────────────────────────────────────
let ambientLight = null; // Reference to ambient light for dynamic adjustment
let sunLight = null; // Reference to directional light for dynamic adjustment

// ─── POST-PROCESSING (for fisheye distortion) ─────────────────────────────────
let fisheyeRenderTarget = null; // Render target for distortion effect
let fisheyeMaterial = null; // Material with distortion shader
let distortionQuad = null; // Full-screen quad for applying distortion
let distortionScene = null; // Scene containing the distortion quad
let distortionCamera = null; // Orthographic camera for post-processing pass

// ─── LEVEL SYSTEM ─────────────────────────────────────────────────────────────
let currentLevel = "tutorial"; // Current level: "tutorial", "level1", "level2", or "level3"

// Level definitions — loaded from separate level files (tutorial.js, level1.js, level2.js, level3.js)
const LEVELS = {
  tutorial: TUTORIAL_LEVEL.checkpoints,
  level1: LEVEL1.checkpoints,
  level2: LEVEL2.checkpoints,
  level3: LEVEL3.checkpoints,
};

// Map of level names to their display names
const LEVEL_NAMES = {
  tutorial: TUTORIAL_LEVEL.displayName,
  level1: LEVEL1.displayName,
  level2: LEVEL2.displayName,
  level3: LEVEL3.displayName,
};

// ─── COLLISION SYSTEM ─────────────────────────────────────────────────────────
// Each collider is an axis-aligned bounding box viewed from above: { cx, cz, hw, hd }
// cx/cz = world-space centre, hw = half-width (X axis), hd = half-depth (Z axis).
// The car is also treated as an AABB for fast, reliable push-out every frame.
const colliders = [];

// padding adds a small margin so the car stops just before the visual edge,
// giving a forgiving Roblox-style feel.
function addCollider(cx, cz, hw, hd, padding) {
  var p = padding === undefined ? 0.05 : padding;
  colliders.push({ cx: cx, cz: cz, hw: hw + p, hd: hd + p });
}

// Car half-extents — slightly snug so the player can thread narrow gaps
var CAR_HW = 1.05;
var CAR_HD = 2.1;

// Two-pass separating-axis push-out. The second pass catches adjacent-collider
// corner cases that a single pass would miss.
function resolveCollisions() {
  var collisionOccurred = false;
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
        collisionOccurred = true;
      }
    }
  }

  // STATE TOGGLE: Only play sound when transitioning FROM "not colliding" TO "colliding"
  if (collisionOccurred && !isCurrentlyColliding) {
    // Collision JUST started
    playBumpSound();
    isCurrentlyColliding = true;
  } else if (!collisionOccurred && isCurrentlyColliding) {
    // Collision JUST ended
    isCurrentlyColliding = false;
  }
}

// ─── MISSION SYSTEM ───────────────────────────────────────────────────────────
// The player must reach each checkpoint in order to win.
let CHECKPOINTS = LEVELS[currentLevel]; // Current level's checkpoints

let missionActive = false;
let missionComplete = false;
let currentCP = 0; // index of the checkpoint the player is heading to
let missionStart = 0; // Date.now() snapshot when mission began
let missionElapsed = 0; // seconds elapsed (updated each frame)
let missionTimeoutShown = false; // track if 30-second timeout popup has been shown
let cpMarkers = []; // Three.js groups — one beacon per checkpoint
let markerRotation = 0; // accumulates each frame for spinning animation
let tutorialCheckpointJustCollected = false; // Prevent multiple triggers on same checkpoint
let tutorialCheckpointGoalStartTime = null; // When current checkpoint-goal step was entered (for visibility delay)
let tutorialStepWhenCheckpointGoalStarted = -1; // Track which step index started the checkpoint-goal delay

// ─── TUTORIAL SYSTEM ──────────────────────────────────────────────────────────
let tutorialActive = false;
let tutorialStepIndex = 0;
let tutorialStartTime = 0;
let tutorialKeysPressed = {}; // Track which tutorial keys have been pressed
let tutorialCompleted = false;

// ─── EPISODE SYSTEM (for tutorial state transitions) ────────────────────────────
let currentEpisode = "euthymia"; // Current episode: "euthymia", "depressive", or "manic"
let episodeStartTime = 0; // When the current episode began
let lockDepressiveEpisode = false; // Developer shortcut: lock to depressive episode (press 1)
let lockManicEpisode = false; // Developer shortcut: lock to manic episode (press 2)

// Level 1 unpredictable episode system
let level1EpisodeSchedule = []; // Array of episode start times for the level
let level1EpisodeDurations = []; // Array of episode durations (randomized for each episode)
let level1CurrentEpisodeIndex = 0; // Track which episode in the schedule we're on

// Level 2 unpredictable episode system (manic episodes)
let level2EpisodeSchedule = []; // Array of manic episode start times for the level
let level2EpisodeDurations = []; // Array of manic episode durations (randomized for each episode)
let level2CurrentEpisodeIndex = 0; // Track which manic episode in the schedule we're on

// Level 3 unpredictable mixed episode system (depressive + manic)
let level3DepressiveSchedule = []; // Array of depressive episode start times for level 3
let level3DepressiveDurations = []; // Array of depressive episode durations
let level3DepressiveIndex = 0; // Track current depressive episode
let level3ManicSchedule = []; // Array of manic episode start times for level 3
let level3ManicDurations = []; // Array of manic episode durations
let level3ManicIndex = 0; // Track current manic episode

// ─── PAUSE SYSTEM ─────────────────────────────────────────────────────────────
let gamePaused = false;
let pausedTime = 0; // Timestamp when pause began

// ─── SOUND SYSTEM ─────────────────────────────────────────────────────────────
let backgroundMusic = null;
let bumpSound = null;
let engineSound = null;
let gameoverSound = null;
let winSound = null;
let menuSound = null;
let isCurrentlyColliding = false; // State toggle: only play sound on collision START, not every frame
let lastEngineBoostPressed = false; // Track if shift was pressed last frame

// ─── MINIMAP DISCOVERY SYSTEM ──────────────────────────────────────────────────
// Tracks which zones have been visited during depressive episode
let visitedZones = {}; // { "Grassy Fields NW": true, "Downtown": true, ... }
// Tracks which road segments have been discovered during depressive episode
let discoveredRoads = {}; // { "0,-85": true, ... } — keyed by "x,z" road center position
// Off-screen canvas to track explored areas during depressive episode
let exploredAreaCanvas = null;
let exploredAreaCtx = null;

// ─── MINIMAP ACCESSIBILITY ────────────────────────────────────────────────────
// Allow player to toggle minimap rotation (manic state) with 'M' key
let minimapRotationEnabled = true;

// ─── GLOBAL ENTER KEY LISTENER ────────────────────────────────────────────────
// This listener is registered globally so it works on the start screen
// before init() is called
document.addEventListener("keydown", function (e) {
  if (e.code === "Enter") {
    // Check if start screen is visible
    if (document.getElementById("start-screen").style.display !== "none") {
      playMenuSound();
      startGame();
    } else {
      // Check if any completion screen is visible and click the primary button
      var completionScreens = [
        "tutorial-completion",
        "level1-completion",
        "level2-completion",
        "level3-completion",
        "level-timeout",
      ];

      for (var i = 0; i < completionScreens.length; i++) {
        var screenId = completionScreens[i];
        var screen = document.getElementById(screenId);
        if (screen && screen.classList.contains("show")) {
          var primaryBtn = screen.querySelector(".tutorial-btn.primary");
          if (primaryBtn) {
            primaryBtn.click();
          }
          break;
        }
      }
    }
  }
});

function startTutorialFlow() {
  if (currentLevel !== "tutorial") return;
  tutorialActive = true;
  tutorialStepIndex = 0;
  tutorialStartTime = Date.now();
  tutorialKeysPressed = {};
  tutorialCompleted = false;
  currentEpisode = "euthymia"; // Start with euthymia episode
  showNextTutorialStep();
}

function checkTutorialKeyCompletion() {
  if (!tutorialActive || tutorialCompleted) return;

  var tutorialFlow = TUTORIAL_LEVEL.tutorialFlow;
  var currentStep = tutorialFlow[tutorialStepIndex];

  if (!currentStep || currentStep.type !== "wait-keys") return;

  // Check if required keys have been pressed
  var allKeyPressed = false;
  if (
    currentStep.keys.includes("ShiftLeft") ||
    currentStep.keys.includes("ShiftRight")
  ) {
    // For shift, check if either ShiftLeft or ShiftRight is pressed
    allKeyPressed =
      tutorialKeysPressed["ShiftLeft"] || tutorialKeysPressed["ShiftRight"];
  } else {
    // For movement keys (WASD or Arrow keys), check if ANY key is pressed
    allKeyPressed = currentStep.keys.some(function (key) {
      return tutorialKeysPressed[key];
    });
  }

  if (allKeyPressed) {
    flashSuccessOverlay();
    var notif = document.getElementById("tutorial-notification");
    if (notif) {
      notif.classList.remove("show");
    }
    tutorialStepIndex++;
    // Wait for success overlay (1 second) + CSS transition (0.3s) before showing next step
    setTimeout(function () {
      if (tutorialActive && !tutorialCompleted) {
        showNextTutorialStep();
      }
    }, 1350);
  }
}

function flashSuccessOverlay() {
  var flash = document.getElementById("cp-flash");
  if (flash) {
    flash.classList.add("flash");
    setTimeout(function () {
      flash.classList.remove("flash");
    }, 1000);
  }
}

function showNextTutorialStep() {
  var tutorialFlow = TUTORIAL_LEVEL.tutorialFlow;

  // If all steps are complete, show completion screen
  if (!tutorialFlow || tutorialStepIndex >= tutorialFlow.length) {
    showTutorialCompletion();
    tutorialCompleted = true;
    return;
  }

  var step = tutorialFlow[tutorialStepIndex];
  var notif = document.getElementById("tutorial-notification");
  if (!notif) return;

  notif.textContent = step.message;
  notif.className = "tutorial-notification show";

  // Detect which episode this step represents and update currentEpisode
  if (
    step.type === "state-message" &&
    !lockDepressiveEpisode &&
    !lockManicEpisode
  ) {
    if (step.message.includes("Euthymia")) {
      currentEpisode = "euthymia";
    } else if (step.message.includes("Depressive")) {
      currentEpisode = "depressive";
      visitedZones = {}; // Clear zone discoveries when entering depressive episode
      discoveredRoads = {}; // Clear road discoveries when entering depressive episode
      // Initialize explored area canvas for this depressive episode
      exploredAreaCanvas = document.createElement("canvas");
      exploredAreaCanvas.width = 200;
      exploredAreaCanvas.height = 200;
      exploredAreaCtx = exploredAreaCanvas.getContext("2d");
      exploredAreaCtx.fillStyle = "rgba(100, 140, 180, 0.5)"; // Blue-grey tint for visited areas
      console.log(
        "DEPRESSIVE EPISODE STARTED: visitedZones, discoveredRoads, and exploredAreaCanvas cleared",
      );
    } else if (step.message.includes("Manic")) {
      currentEpisode = "manic";
    }
    episodeStartTime = Date.now();
    updateMusicSpeed(); // Update music speed for new episode
  }

  if (step.type === "glow-mission") {
    glowMissionPanel();
    setTimeout(function () {
      notif.classList.remove("show");
      tutorialStepIndex++;
      // Wait for CSS transition (0.3s) to complete before showing next step
      setTimeout(function () {
        if (tutorialActive && !tutorialCompleted) {
          showNextTutorialStep();
        }
      }, 350);
    }, step.duration || 3000);
  } else if (step.type === "glow-minimap") {
    glowMinimapPanel();
    setTimeout(function () {
      notif.classList.remove("show");
      tutorialStepIndex++;
      // Wait for CSS transition (0.3s) to complete before showing next step
      setTimeout(function () {
        if (tutorialActive && !tutorialCompleted) {
          showNextTutorialStep();
        }
      }, 350);
    }, step.duration || 3000);
  } else if (step.type === "wait-keys") {
    // Keep message visible until keys are pressed, handled by checkTutorialKeyCompletion()
  } else if (step.type === "state-message") {
    // Show for the specified duration then advance
    setTimeout(function () {
      if (!tutorialCompleted) {
        notif.classList.remove("show");
        tutorialStepIndex++;
        // Wait for CSS transition (0.3s) to complete before showing next step
        setTimeout(function () {
          if (tutorialActive && !tutorialCompleted) {
            showNextTutorialStep();
          }
        }, 350);
      }
    }, step.duration || 3000);
  } else if (step.type === "checkpoint-goal") {
    // Checkpoint goal step — wait for player to reach checkpoint
    // Delay timer will be initialized on first frame update in updateMarkers()
    // The checkCheckpoints() function will advance this when reached
  }
}

function scheduleNextTutorialStep() {
  var tutorialFlow = TUTORIAL_LEVEL.tutorialFlow;
  if (tutorialStepIndex >= tutorialFlow.length) return;

  var step = tutorialFlow[tutorialStepIndex];
  var elapsed = Date.now() - tutorialStartTime;
  var nextDelay = Math.max(0, step.delay - elapsed);

  setTimeout(function () {
    if (tutorialActive && !tutorialCompleted) {
      showNextTutorialStep();
    }
  }, nextDelay);
}

function glowMissionPanel() {
  var panel = document.getElementById("mission-panel");
  var overlay = document.getElementById("mission-focus-overlay");

  if (panel) {
    panel.classList.add("glow");
  }

  if (overlay) {
    overlay.classList.add("show");
    setTimeout(function () {
      overlay.classList.remove("show");
    }, 3000);
  }

  if (panel) {
    setTimeout(function () {
      panel.classList.remove("glow");
    }, 5000);
  }
}

function glowMinimapPanel() {
  var overlay = document.getElementById("minimap-focus-overlay");

  if (overlay) {
    overlay.classList.add("show");
    setTimeout(function () {
      overlay.classList.remove("show");
    }, 3000);
  }
}

function showTutorialCompletion() {
  document.getElementById("tutorial-completion").classList.add("show");
}

// Dynamically build mission progress dots based on checkpoint count
function buildMissionSteps() {
  var stepsContainer = document.getElementById("mission-steps");
  if (!stepsContainer) return;

  // Clear existing dots
  stepsContainer.innerHTML = "";

  // Create a dot for each checkpoint
  CHECKPOINTS.forEach(function (_, i) {
    var dot = document.createElement("div");
    dot.className = "step-dot";
    dot.id = "dot-" + i;
    if (i === 0) {
      dot.classList.add("active");
    }
    stepsContainer.appendChild(dot);
  });
}

// Generate unpredictable episode schedule for Level 1
// Randomly distributes episodeCount episodes throughout the 30-second level
function generateLevel1EpisodeSchedule() {
  level1EpisodeSchedule = [];
  level1EpisodeDurations = [];
  level1CurrentEpisodeIndex = 0;

  // Only generate schedule for Level 1
  if (currentLevel !== "level1") return;

  var levelConfig = LEVEL1;
  var episodeCount = levelConfig.episodeCount || 3;
  var episodeDurationMin = levelConfig.episodeDurationMin || 2000;
  var episodeDurationMax = levelConfig.episodeDurationMax || 6000;
  var levelDuration = 45000; // 45 seconds in milliseconds
  var maxGapBetweenEpisodes = 3000; // Maximum 3 seconds between end of one episode and start of next
  var minGapBetweenEpisodes = 0.5 * 1000; // Minimum 0.5 seconds gap for unpredictability

  // Generate random duration for each episode
  for (var i = 0; i < episodeCount; i++) {
    var randomDuration =
      episodeDurationMin +
      Math.random() * (episodeDurationMax - episodeDurationMin);
    level1EpisodeDurations.push(randomDuration);
  }

  // Schedule episodes with maximum 3-second gaps between them
  var currentTime = 2 * 1000; // Start first episode at least 2 seconds in

  for (var i = 0; i < episodeCount; i++) {
    // Record start time of this episode
    level1EpisodeSchedule.push(currentTime);

    // Move to the end of this episode
    currentTime += level1EpisodeDurations[i];

    // Add gap before next episode (random between 0.5 and 3 seconds)
    if (i < episodeCount - 1) {
      var randomGap =
        minGapBetweenEpisodes +
        Math.random() * (maxGapBetweenEpisodes - minGapBetweenEpisodes);
      currentTime += randomGap;

      // Safety check: if next episode would exceed level duration, clamp it
      var remainingTime = levelDuration - currentTime;
      var remainingEpisodes = episodeCount - i - 1;
      var minRemainingTime =
        remainingEpisodes * (episodeDurationMin + minGapBetweenEpisodes);

      if (remainingTime < minRemainingTime) {
        // Adjust current time to fit remaining episodes
        currentTime = levelDuration - minRemainingTime;
      }
    }
  }

  console.log(
    "Level 1 Episode Schedule Generated (Max 3 seconds between episodes):",
    level1EpisodeSchedule
      .map(function (t, i) {
        return (
          (t / 1000).toFixed(1) +
          "s (duration: " +
          (level1EpisodeDurations[i] / 1000).toFixed(1) +
          "s)"
        );
      })
      .join(", "),
  );
}

// Generate unpredictable manic episode schedule for Level 2
// Randomly distributes manic episodes throughout the 30-second level
function generateLevel2EpisodeSchedule() {
  level2EpisodeSchedule = [];
  level2EpisodeDurations = [];
  level2CurrentEpisodeIndex = 0;

  // Only generate schedule for Level 2
  if (currentLevel !== "level2") return;

  var levelConfig = LEVEL2;
  var episodeCount = levelConfig.episodeCount || 2;
  var episodeDurationMin = levelConfig.episodeDurationMin || 7000;
  var episodeDurationMax = levelConfig.episodeDurationMax || 15000;
  var levelDuration = 45000; // 45 seconds in milliseconds for Level 2
  var maxGapBetweenEpisodes = 3000; // Maximum 3 seconds between end of one episode and start of next
  var minGapBetweenEpisodes = 0.5 * 1000; // Minimum 0.5 seconds gap for unpredictability

  // Generate random duration for each manic episode
  for (var i = 0; i < episodeCount; i++) {
    var randomDuration =
      episodeDurationMin +
      Math.random() * (episodeDurationMax - episodeDurationMin);
    level2EpisodeDurations.push(randomDuration);
  }

  // Schedule episodes with maximum 3-second gaps between them
  var currentTime = 2 * 1000; // Start first manic episode at least 2 seconds in

  for (var i = 0; i < episodeCount; i++) {
    // Record start time of this episode
    level2EpisodeSchedule.push(currentTime);

    // Move to the end of this episode
    currentTime += level2EpisodeDurations[i];

    // Add gap before next episode (random between 0.5 and 3 seconds)
    if (i < episodeCount - 1) {
      var randomGap =
        minGapBetweenEpisodes +
        Math.random() * (maxGapBetweenEpisodes - minGapBetweenEpisodes);
      currentTime += randomGap;

      // Safety check: if next episode would exceed level duration, clamp it
      var remainingTime = levelDuration - currentTime;
      var remainingEpisodes = episodeCount - i - 1;
      var minRemainingTime =
        remainingEpisodes * (episodeDurationMin + minGapBetweenEpisodes);

      if (remainingTime < minRemainingTime) {
        // Adjust current time to fit remaining episodes
        currentTime = levelDuration - minRemainingTime;
      }
    }
  }

  console.log(
    "Level 2 Manic Episode Schedule Generated (Max 3 seconds between episodes):",
    level2EpisodeSchedule
      .map(function (t, i) {
        return (
          (t / 1000).toFixed(1) +
          "s (duration: " +
          (level2EpisodeDurations[i] / 1000).toFixed(1) +
          "s)"
        );
      })
      .join(", "),
  );
}

// Generate unpredictable mixed episode schedule for Level 3
// Randomly distributes depressive and manic episodes throughout the 60-second level
function generateLevel3EpisodeSchedule() {
  level3DepressiveSchedule = [];
  level3DepressiveDurations = [];
  level3DepressiveIndex = 0;
  level3ManicSchedule = [];
  level3ManicDurations = [];
  level3ManicIndex = 0;

  // Only generate schedule for Level 3
  if (currentLevel !== "level3") return;

  var levelConfig = LEVEL3;
  var depressiveCount = levelConfig.depressiveEpisodeCount || 2;
  var manicCount = levelConfig.manicEpisodeCount || 2;
  var depressiveDurationMin = levelConfig.depressiveEpisodeDurationMin || 2000;
  var depressiveDurationMax = levelConfig.depressiveEpisodeDurationMax || 6000;
  var manicDurationMin = levelConfig.manicEpisodeDurationMin || 7000;
  var manicDurationMax = levelConfig.manicEpisodeDurationMax || 12000;
  var levelDuration = 60000; // 60 seconds in milliseconds for Level 3
  var maxGapBetweenEpisodes = 3000;
  var minGapBetweenEpisodes = 0.5 * 1000;

  // Generate random durations for depressive episodes
  for (var i = 0; i < depressiveCount; i++) {
    var randomDuration =
      depressiveDurationMin +
      Math.random() * (depressiveDurationMax - depressiveDurationMin);
    level3DepressiveDurations.push(randomDuration);
  }

  // Generate random durations for manic episodes
  for (var i = 0; i < manicCount; i++) {
    var randomDuration =
      manicDurationMin + Math.random() * (manicDurationMax - manicDurationMin);
    level3ManicDurations.push(randomDuration);
  }

  // Schedule depressive episodes
  var currentTime = 2 * 1000; // Start first depressive at 2 seconds
  for (var i = 0; i < depressiveCount; i++) {
    level3DepressiveSchedule.push(currentTime);
    currentTime += level3DepressiveDurations[i];
    if (i < depressiveCount - 1) {
      var randomGap =
        minGapBetweenEpisodes +
        Math.random() * (maxGapBetweenEpisodes - minGapBetweenEpisodes);
      currentTime += randomGap;
    }
  }

  // Schedule manic episodes in remaining space
  var manicStartTime = 25 * 1000; // Start first manic at 25 seconds
  for (var i = 0; i < manicCount; i++) {
    level3ManicSchedule.push(manicStartTime);
    manicStartTime += level3ManicDurations[i];
    if (i < manicCount - 1) {
      var randomGap =
        minGapBetweenEpisodes +
        Math.random() * (maxGapBetweenEpisodes - minGapBetweenEpisodes);
      manicStartTime += randomGap;
    }
  }

  console.log(
    "Level 3 Depressive Episodes:",
    level3DepressiveSchedule
      .map(function (t, i) {
        return (
          (t / 1000).toFixed(1) +
          "s (duration: " +
          (level3DepressiveDurations[i] / 1000).toFixed(1) +
          "s)"
        );
      })
      .join(", "),
  );
  console.log(
    "Level 3 Manic Episodes:",
    level3ManicSchedule
      .map(function (t, i) {
        return (
          (t / 1000).toFixed(1) +
          "s (duration: " +
          (level3ManicDurations[i] / 1000).toFixed(1) +
          "s)"
        );
      })
      .join(", "),
  );
}

// Update episode state for Level 1 - manages unpredictable episode transitions
function updateLevel1Episodes() {
  if (currentLevel !== "level1" || !missionActive || missionComplete) return;
  if (lockDepressiveEpisode || lockManicEpisode) return; // Skip if developer locked

  var missionElapsedMs = missionElapsed * 1000;

  // Check if we should start the next episode
  if (level1CurrentEpisodeIndex < level1EpisodeSchedule.length) {
    var nextEpisodeStart = level1EpisodeSchedule[level1CurrentEpisodeIndex];
    var nextEpisodeDuration = level1EpisodeDurations[level1CurrentEpisodeIndex];
    var nextEpisodeEnd = nextEpisodeStart + nextEpisodeDuration;

    // DEBUG: Log episode timing (remove after testing)
    if (missionElapsedMs % 1000 < 50) {
      // Log once per second
      console.log(
        "Level 1 Episode Check | Time: " +
          (missionElapsedMs / 1000).toFixed(1) +
          "s | Episode " +
          level1CurrentEpisodeIndex +
          " | Window: " +
          (nextEpisodeStart / 1000).toFixed(1) +
          "-" +
          (nextEpisodeEnd / 1000).toFixed(1) +
          "s | Current State: " +
          currentEpisode,
      );
    }

    if (
      missionElapsedMs >= nextEpisodeStart &&
      missionElapsedMs < nextEpisodeEnd
    ) {
      // We're within an episode
      if (currentEpisode !== "depressive") {
        console.log(
          "🔴 ENTERING DEPRESSIVE EPISODE " +
            level1CurrentEpisodeIndex +
            " at time " +
            (missionElapsedMs / 1000).toFixed(1) +
            "s",
        );
        currentEpisode = "depressive";
        episodeStartTime = Date.now();
        updateMusicSpeed(); // Update music speed for depressive episode

        // Initialize explored area canvas for fog-of-war discovery
        visitedZones = {}; // Clear zone discoveries
        discoveredRoads = {}; // Clear road discoveries
        exploredAreaCanvas = document.createElement("canvas");
        exploredAreaCanvas.width = 200;
        exploredAreaCanvas.height = 200;
        exploredAreaCtx = exploredAreaCanvas.getContext("2d");
        exploredAreaCtx.fillStyle = "rgba(100, 140, 180, 0.5)"; // Blue-grey tint for visited areas
        console.log(
          "🔴 Level 1 depressive episode started: fog-of-war discovery initialized",
        );
      }
    } else if (missionElapsedMs >= nextEpisodeEnd) {
      // Episode is over, move to next one
      console.log(
        "🟢 EXITING DEPRESSIVE EPISODE " +
          level1CurrentEpisodeIndex +
          " at time " +
          (missionElapsedMs / 1000).toFixed(1) +
          "s",
      );
      level1CurrentEpisodeIndex++;
      currentEpisode = "euthymia";
      updateMusicSpeed(); // Update music speed back to normal
      // Reset fog-of-war for normal mode
      exploredAreaCanvas = null;
      exploredAreaCtx = null;
    }
  } else {
    // All episodes are done, return to euthymia
    currentEpisode = "euthymia";
  }
}

// Update episode state for Level 2 - manages unpredictable manic episode transitions
function updateLevel2Episodes() {
  if (currentLevel !== "level2" || !missionActive || missionComplete) return;
  if (lockDepressiveEpisode || lockManicEpisode) return; // Skip if developer locked

  var missionElapsedMs = missionElapsed * 1000;

  // Check if we should start the next manic episode
  if (level2CurrentEpisodeIndex < level2EpisodeSchedule.length) {
    var nextEpisodeStart = level2EpisodeSchedule[level2CurrentEpisodeIndex];
    var nextEpisodeDuration = level2EpisodeDurations[level2CurrentEpisodeIndex];
    var nextEpisodeEnd = nextEpisodeStart + nextEpisodeDuration;

    // DEBUG: Log episode timing
    if (missionElapsedMs % 1000 < 50) {
      // Log once per second
      console.log(
        "Level 2 Manic Check | Time: " +
          (missionElapsedMs / 1000).toFixed(1) +
          "s | Episode " +
          level2CurrentEpisodeIndex +
          " | Window: " +
          (nextEpisodeStart / 1000).toFixed(1) +
          "-" +
          (nextEpisodeEnd / 1000).toFixed(1) +
          "s | Current State: " +
          currentEpisode,
      );
    }

    if (
      missionElapsedMs >= nextEpisodeStart &&
      missionElapsedMs < nextEpisodeEnd
    ) {
      // We're within a manic episode
      if (currentEpisode !== "manic") {
        console.log(
          "🟡 ENTERING MANIC EPISODE " +
            level2CurrentEpisodeIndex +
            " at time " +
            (missionElapsedMs / 1000).toFixed(1) +
            "s",
        );
        currentEpisode = "manic";
        episodeStartTime = Date.now();
        updateMusicSpeed(); // Update music speed for manic episode

        // Apply warm sky color and building tints immediately
        scene.background = new THREE.Color(0xffdd44); // Warm yellow
        console.log(
          "🟡 Level 2 manic episode started: warm euphoric state activated",
        );
      }
    } else if (missionElapsedMs >= nextEpisodeEnd) {
      // Manic episode is over, move to next one
      console.log(
        "🔵 EXITING MANIC EPISODE " +
          level2CurrentEpisodeIndex +
          " at time " +
          (missionElapsedMs / 1000).toFixed(1) +
          "s",
      );
      level2CurrentEpisodeIndex++;
      currentEpisode = "euthymia";
      updateMusicSpeed(); // Update music speed back to normal
      // Reset sky to normal blue
      scene.background = new THREE.Color(0x87ceeb);
    }
  } else {
    // All episodes are done, return to euthymia
    currentEpisode = "euthymia";
    updateMusicSpeed();
    scene.background = new THREE.Color(0x87ceeb);
  }
}

// Update episode state for Level 3 - manages unpredictable mixed episode transitions
function updateLevel3Episodes() {
  if (currentLevel !== "level3" || !missionActive || missionComplete) return;
  if (lockDepressiveEpisode || lockManicEpisode) return; // Skip if developer locked

  var missionElapsedMs = missionElapsed * 1000;

  // Check if we should start the next depressive episode
  if (level3DepressiveIndex < level3DepressiveSchedule.length) {
    var nextDepStart = level3DepressiveSchedule[level3DepressiveIndex];
    var nextDepDuration = level3DepressiveDurations[level3DepressiveIndex];
    var nextDepEnd = nextDepStart + nextDepDuration;

    if (missionElapsedMs >= nextDepStart && missionElapsedMs < nextDepEnd) {
      // We're within a depressive episode
      if (currentEpisode !== "depressive") {
        console.log(
          "🔴 ENTERING DEPRESSIVE EPISODE " +
            level3DepressiveIndex +
            " at time " +
            (missionElapsedMs / 1000).toFixed(1) +
            "s",
        );
        currentEpisode = "depressive";
        episodeStartTime = Date.now();
        updateMusicSpeed(); // Update music speed for depressive episode

        // Initialize explored area canvas
        visitedZones = {};
        discoveredRoads = {};
        exploredAreaCanvas = document.createElement("canvas");
        exploredAreaCanvas.width = 200;
        exploredAreaCanvas.height = 200;
        exploredAreaCtx = exploredAreaCanvas.getContext("2d");
        exploredAreaCtx.fillStyle = "rgba(100, 140, 180, 0.5)";
      }
    } else if (
      missionElapsedMs >= nextDepEnd &&
      currentEpisode === "depressive"
    ) {
      // Exit depressive episode
      console.log(
        "🟢 EXITING DEPRESSIVE EPISODE " +
          level3DepressiveIndex +
          " at time " +
          (missionElapsedMs / 1000).toFixed(1) +
          "s",
      );
      level3DepressiveIndex++;
      // Check if manic episode is active, otherwise go to euthymia
      var manicActive = false;
      if (level3ManicIndex < level3ManicSchedule.length) {
        var manicStart = level3ManicSchedule[level3ManicIndex];
        var manicDuration = level3ManicDurations[level3ManicIndex];
        var manicEnd = manicStart + manicDuration;
        if (missionElapsedMs >= manicStart && missionElapsedMs < manicEnd) {
          manicActive = true;
        }
      }
      if (!manicActive) {
        currentEpisode = "euthymia";
        updateMusicSpeed(); // Update music speed back to normal
        exploredAreaCanvas = null;
        exploredAreaCtx = null;
      }
    }
  }

  // Check if we should start the next manic episode
  if (level3ManicIndex < level3ManicSchedule.length) {
    var nextManicStart = level3ManicSchedule[level3ManicIndex];
    var nextManicDuration = level3ManicDurations[level3ManicIndex];
    var nextManicEnd = nextManicStart + nextManicDuration;

    if (missionElapsedMs >= nextManicStart && missionElapsedMs < nextManicEnd) {
      // We're within a manic episode
      if (currentEpisode !== "manic") {
        console.log(
          "🟡 ENTERING MANIC EPISODE " +
            level3ManicIndex +
            " at time " +
            (missionElapsedMs / 1000).toFixed(1) +
            "s",
        );
        currentEpisode = "manic";
        episodeStartTime = Date.now();
        updateMusicSpeed(); // Update music speed for manic episode
        scene.background = new THREE.Color(0xffdd44); // Warm yellow
      }
    } else if (missionElapsedMs >= nextManicEnd && currentEpisode === "manic") {
      // Exit manic episode
      console.log(
        "🔵 EXITING MANIC EPISODE " +
          level3ManicIndex +
          " at time " +
          (missionElapsedMs / 1000).toFixed(1) +
          "s",
      );
      level3ManicIndex++;
      // Check if depressive episode is active, otherwise go to euthymia
      var depActive = false;
      if (level3DepressiveIndex < level3DepressiveSchedule.length) {
        var depStart = level3DepressiveSchedule[level3DepressiveIndex];
        var depDuration = level3DepressiveDurations[level3DepressiveIndex];
        var depEnd = depStart + depDuration;
        if (missionElapsedMs >= depStart && missionElapsedMs < depEnd) {
          depActive = true;
        }
      }
      if (!depActive) {
        currentEpisode = "euthymia";
        updateMusicSpeed(); // Update music speed back to normal
        scene.background = new THREE.Color(0x87ceeb); // Reset to blue
      }
    }
  }

  // If all episodes are done, return to euthymia
  if (
    level3DepressiveIndex >= level3DepressiveSchedule.length &&
    level3ManicIndex >= level3ManicSchedule.length &&
    currentEpisode !== "euthymia"
  ) {
    currentEpisode = "euthymia";
    updateMusicSpeed();
    scene.background = new THREE.Color(0x87ceeb);
    exploredAreaCanvas = null;
    exploredAreaCtx = null;
  }
}

// Spawn 3D beacon markers into the scene (call once, inside init)
function buildCheckpointMarkers() {
  // Remove old markers from scene
  cpMarkers.forEach(function (marker) {
    scene.remove(marker);
  });
  cpMarkers = [];

  // For tutorial, only build markers (visibility controlled per frame in updateMarkers)
  // For other levels, build all markers normally
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

  // Determine which checkpoint should be shown
  var targetCheckpointIndex = currentCP;
  var shouldShowCheckpoint = true;

  if (currentLevel === "tutorial" && tutorialActive && !tutorialCompleted) {
    var tutorialFlow = TUTORIAL_LEVEL.tutorialFlow;
    var currentStep = tutorialFlow[tutorialStepIndex];
    // Only show checkpoint during checkpoint-goal steps (with 1 second delay for UX)
    if (currentStep && currentStep.type === "checkpoint-goal") {
      // Initialize delay timer on first frame entering this step
      if (tutorialStepWhenCheckpointGoalStarted !== tutorialStepIndex) {
        tutorialCheckpointGoalStartTime = Date.now();
        tutorialStepWhenCheckpointGoalStarted = tutorialStepIndex;
      }

      var checkpointGoalElapsed = Date.now() - tutorialCheckpointGoalStartTime;
      if (checkpointGoalElapsed >= 1000) {
        // After 1 second delay, show the checkpoint
        targetCheckpointIndex = currentStep.checkpointIndex;
        shouldShowCheckpoint = true;
      } else {
        // Still waiting for delay to complete
        shouldShowCheckpoint = false;
      }
    } else {
      // Don't show checkpoint for other step types (state-message, wait-keys, glow-mission)
      shouldShowCheckpoint = false;
    }
  }

  cpMarkers.forEach(function (group, i) {
    // Hide checkpoint if:
    // - Tutorial step is not a checkpoint-goal type or delay not elapsed
    // - Mission is not active
    // - Mission is complete
    // - Marker index doesn't match target
    if (
      !shouldShowCheckpoint ||
      i !== targetCheckpointIndex ||
      !missionActive ||
      missionComplete
    ) {
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
  missionTimeoutShown = false; // reset timeout flag for new mission
  gamePaused = false; // Reset pause state
  tutorialCheckpointJustCollected = false; // Reset tutorial checkpoint collection flag
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

  // Start tutorial flow if in tutorial level
  if (currentLevel === "tutorial") {
    startTutorialFlow();
  }

  // Generate episode schedule if in level 1
  if (currentLevel === "level1") {
    generateLevel1EpisodeSchedule();
  }

  // Generate manic episode schedule if in level 2
  if (currentLevel === "level2") {
    generateLevel2EpisodeSchedule();
  }

  // Generate mixed episode schedule if in level 3
  if (currentLevel === "level3") {
    generateLevel3EpisodeSchedule();
  }
}

// Initialize audio elements
function initAudio() {
  backgroundMusic = document.getElementById("background-music");
  bumpSound = document.getElementById("bump-sound");
  engineSound = document.getElementById("engine-sound");
  gameoverSound = document.getElementById("gameover-sound");
  winSound = document.getElementById("win-sound");
  menuSound = document.getElementById("menu-sound");

  // Debug: Log audio element status
  console.log("🔊 Audio System Initialized:");
  console.log(
    "   Background Music:",
    backgroundMusic ? "✓ Found" : "✗ Not found",
  );
  console.log("   Bump Sound:", bumpSound ? "✓ Found" : "✗ Not found");
  console.log("   Engine Sound:", engineSound ? "✓ Found" : "✗ Not found");
  console.log("   Gameover Sound:", gameoverSound ? "✓ Found" : "✗ Not found");
  console.log("   Win Sound:", winSound ? "✓ Found" : "✗ Not found");
  console.log("   Menu Sound:", menuSound ? "✓ Found" : "✗ Not found");

  // Set reasonable volume levels
  if (backgroundMusic) {
    backgroundMusic.volume = 0.4;
    console.log("   Background Music Volume: 0.4");
  }
  if (bumpSound) {
    bumpSound.volume = 0.45;
    console.log("   Bump Sound Volume: 0.45");
  }
  if (engineSound) {
    engineSound.volume = 0.25;
    console.log("   Engine Sound Volume: 0.25");
  }
  if (gameoverSound) {
    gameoverSound.volume = 0.35;
    console.log("   Gameover Sound Volume: 0.35");
  }
  if (winSound) {
    winSound.volume = 0.5;
    console.log("   Win Sound Volume: 0.5");
  }
  if (menuSound) {
    menuSound.volume = 0.5;
    console.log("   Menu Sound Volume: 0.5");
  }

  // Attach menu sound to all buttons (UI elements only)
  attachMenuSoundToButtons();
}

// Attach menu/button press sound to all HTML buttons
function attachMenuSoundToButtons() {
  if (!menuSound) return;

  // Select all button elements in the DOM
  var buttons = document.querySelectorAll("button");

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      // Play menu sound when button is clicked
      menuSound.currentTime = 0;
      menuSound.play().catch(function (error) {
        console.log("❌ Menu sound play failed:", error);
      });
    });
  });

  console.log("🎵 Menu sound attached to " + buttons.length + " buttons");
}

// Play background music on loop
function playBackgroundMusic() {
  if (backgroundMusic && backgroundMusic.paused) {
    console.log("▶️ Playing background music");
    backgroundMusic.currentTime = 0;
    backgroundMusic.loop = true; // Enable seamless looping

    // Handle seamless looping by resetting when approaching end
    backgroundMusic.addEventListener(
      "ended",
      function () {
        backgroundMusic.currentTime = 0;
        backgroundMusic.play().catch(function (error) {
          console.log("❌ Background music replay failed:", error);
        });
      },
      { once: false },
    );

    backgroundMusic.play().catch(function (error) {
      console.log("❌ Background music autoplay blocked:", error);
    });
  }
}

// Stop background music
function stopBackgroundMusic() {
  if (backgroundMusic) {
    backgroundMusic.pause();
    backgroundMusic.currentTime = 0;
  }
}

// Update music playback speed based on current episode
function updateMusicSpeed() {
  if (!backgroundMusic) return;
  if (currentEpisode === "depressive") {
    backgroundMusic.playbackRate = 0.4; // Slow music in depressive state
    console.log("🎵 Music speed: 0.4x (depressive)");
  } else if (currentEpisode === "manic") {
    backgroundMusic.playbackRate = 2.0; // Speed up music in manic state
    console.log("🎵 Music speed: 2.0x (manic)");
  } else {
    backgroundMusic.playbackRate = 1.0; // Normal speed in euthymia
    console.log("🎵 Music speed: 1.0x (euthymia)");
  }

  // Apply same playback rate to engine and bump sounds for consistency
  updateSoundEffectsSpeed();
}

// Update engine and bump sound playback rates to match episode state
function updateSoundEffectsSpeed() {
  if (currentEpisode === "depressive") {
    if (engineSound) engineSound.playbackRate = 0.4;
    if (bumpSound) bumpSound.playbackRate = 0.4;
    console.log("🔧 Sound effects speed: 0.4x (depressive)");
  } else if (currentEpisode === "manic") {
    if (engineSound) engineSound.playbackRate = 2.0;
    if (bumpSound) bumpSound.playbackRate = 2.0;
    console.log("🔧 Sound effects speed: 2.0x (manic)");
  } else {
    if (engineSound) engineSound.playbackRate = 1.0;
    if (bumpSound) bumpSound.playbackRate = 1.0;
    console.log("🔧 Sound effects speed: 1.0x (euthymia)");
  }
}

// Play collision/bump sound (called only once per collision event via state toggle)
function playBumpSound() {
  if (!bumpSound) return;
  console.log("💥 Playing bump sound");
  bumpSound.currentTime = 0;
  bumpSound.play().catch(function (error) {
    console.log("❌ Bump sound play failed:", error);
  });
}

// Play engine boost sound
function playEngineSound() {
  if (!engineSound) return;
  console.log("⚡ Playing engine sound");
  engineSound.currentTime = 0;
  engineSound.play().catch(function (error) {
    console.log("❌ Engine sound play failed:", error);
  });
}

// Play game over sound
function playGameoverSound() {
  if (gameoverSound) {
    console.log("🎬 Playing gameover sound");
    gameoverSound.currentTime = 0;
    gameoverSound.play().catch(function (error) {
      console.log("❌ Gameover sound play failed:", error);
    });
  }
}

// Play win/level completion sound
function playWinSound() {
  if (winSound) {
    console.log("🏆 Playing win sound");
    winSound.currentTime = 0;
    winSound.play().catch(function (error) {
      console.log("❌ Win sound play failed:", error);
    });
  }
}
function formatTime(secs) {
  var m = Math.floor(secs / 60);
  var s = Math.floor(secs % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

// Toggle pause state and open the pause menu with level-specific buttons
function togglePause() {
  var pauseMenu = document.getElementById("pause-menu");
  if (!pauseMenu) return;

  if (gamePaused) {
    // Resume game
    gamePaused = false;
    pauseMenu.classList.remove("show");
    // Resume background music
    if (backgroundMusic) {
      backgroundMusic.play().catch(function (error) {
        console.log("Background music resume failed:", error);
      });
    }
    // Adjust mission start time to account for pause duration
    var pauseDuration = Date.now() - pausedTime;
    missionStart += pauseDuration;
  } else {
    // Pause game and open menu
    gamePaused = true;
    pausedTime = Date.now();
    openPauseMenu();
    pauseMenu.classList.add("show");
    // Pause background music
    if (backgroundMusic) {
      backgroundMusic.pause();
    }
  }
}

// Dynamically populate pause menu buttons based on current level
function openPauseMenu() {
  var pauseMenu = document.getElementById("pause-menu");
  if (!pauseMenu) return;

  var buttonsContainer = pauseMenu.querySelector(".pause-buttons");
  if (!buttonsContainer) {
    // Create buttons container if it doesn't exist
    var card = pauseMenu.querySelector(".pause-card");
    if (card) {
      buttonsContainer = document.createElement("div");
      buttonsContainer.className = "pause-buttons";
      card.appendChild(buttonsContainer);
    }
  }

  if (!buttonsContainer) return;

  // Clear existing buttons
  buttonsContainer.innerHTML = "";

  // Always add Resume Game button
  var resumeBtn = document.createElement("button");
  resumeBtn.className = "pause-btn primary";
  resumeBtn.textContent = "Resume Game";
  resumeBtn.onclick = function () {
    resumeGame();
  };
  buttonsContainer.appendChild(resumeBtn);

  // Add Restart Level button only for main levels (not tutorial)
  if (currentLevel !== "tutorial") {
    var restartBtn = document.createElement("button");
    restartBtn.className = "pause-btn";
    restartBtn.textContent = "Restart Level";
    restartBtn.onclick = function () {
      restartFromPause();
    };
    buttonsContainer.appendChild(restartBtn);
  }
}

// Resume game from pause
function resumeGame() {
  if (gamePaused) {
    // Use togglePause to properly handle resume logic
    togglePause();
  }
}

// Restart mission from pause menu
function restartFromPause() {
  var pauseMenu = document.getElementById("pause-menu");
  if (pauseMenu) {
    pauseMenu.classList.remove("show");
  }
  gamePaused = false;
  restartMission();
}

// Refresh the mission panel text — called every frame while mission is active
function updateMissionHUD() {
  if (!missionActive || missionComplete) return;

  // Skip HUD update if paused
  if (gamePaused) return;

  missionElapsed = (Date.now() - missionStart) / 1000;

  var timerEl = document.getElementById("mission-timer");

  // For non-tutorial levels, show countdown timer
  if (currentLevel !== "tutorial") {
    var levelTimeLimit = 45; // 45 seconds for all levels (tutorial, level1, level2, level3)
    var timeRemaining = Math.max(0, levelTimeLimit - missionElapsed);
    timerEl.textContent = formatTime(timeRemaining);
    // Flash red when 10 seconds or less remain
    timerEl.classList.toggle("urgent", timeRemaining <= 10);
  } else {
    // Tutorial: show elapsed time as normal, no urgent indicator
    timerEl.textContent = formatTime(missionElapsed);
    timerEl.classList.remove("urgent");
  }

  // Check for timeout on non-tutorial levels
  if (currentLevel !== "tutorial" && !missionTimeoutShown) {
    var levelTimeLimit = 45; // 45 seconds for all levels
    if (missionElapsed >= levelTimeLimit) {
      missionTimeoutShown = true;
      missionActive = false;
      playGameoverSound();
      document.getElementById("level-timeout").classList.add("show");
      return;
    }
  }

  // Show checkpoint destination during normal gameplay and tutorial checkpoint goals
  var showCheckpointHUD = currentLevel !== "tutorial";
  var checkpointIndexToShow = currentCP;

  if (currentLevel === "tutorial" && tutorialActive && !tutorialCompleted) {
    var tutorialFlow = TUTORIAL_LEVEL.tutorialFlow;
    var currentStep = tutorialFlow[tutorialStepIndex];
    if (currentStep && currentStep.type === "checkpoint-goal") {
      // Initialize delay timer on first frame entering this step (same as 3D markers)
      if (tutorialStepWhenCheckpointGoalStarted !== tutorialStepIndex) {
        tutorialCheckpointGoalStartTime = Date.now();
        tutorialStepWhenCheckpointGoalStarted = tutorialStepIndex;
      }

      // Check 1 second delay before showing checkpoint in HUD
      var checkpointGoalElapsed = Date.now() - tutorialCheckpointGoalStartTime;
      if (checkpointGoalElapsed >= 1000) {
        showCheckpointHUD = true;
        checkpointIndexToShow = currentStep.checkpointIndex;
      } else {
        showCheckpointHUD = false;
      }
    } else {
      // Don't show checkpoint for other tutorial step types
      showCheckpointHUD = false;
    }
  }

  if (showCheckpointHUD) {
    var cp = CHECKPOINTS[checkpointIndexToShow];
    var dx = car.position.x - cp.x;
    var dz = car.position.z - cp.z;
    var dist = Math.round(Math.sqrt(dx * dx + dz * dz));
    document.getElementById("mission-dist").textContent = dist;
    document.getElementById("mission-objective").innerHTML =
      "Drive to <strong>" + cp.emoji + " " + cp.label + "</strong>";
  } else {
    // Tutorial mode (before checkpoint goals): show generic message
    document.getElementById("mission-objective").innerHTML =
      "Follow the tutorial instructions";
  }

  updateLevelDisplay();
}

function updateLevelDisplay() {
  var levelEl = document.getElementById("mission-level");
  if (levelEl) {
    levelEl.textContent = LEVEL_NAMES[currentLevel] || "UNKNOWN";
  }
}

// Test whether the car has entered the active checkpoint's trigger radius
function checkCheckpoints() {
  if (!missionActive || missionComplete) return;

  // Tutorial mode: check if we're in a checkpoint-goal step
  if (currentLevel === "tutorial") {
    if (tutorialActive && !tutorialCompleted) {
      var tutorialFlow = TUTORIAL_LEVEL.tutorialFlow;
      var currentStep = tutorialFlow[tutorialStepIndex];

      if (currentStep && currentStep.type === "checkpoint-goal") {
        // Get the target checkpoint for this step
        var targetCheckpointIndex = currentStep.checkpointIndex;
        var cp = CHECKPOINTS[targetCheckpointIndex];
        var dx = car.position.x - cp.x;
        var dz = car.position.z - cp.z;
        var dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < cp.r) {
          // Only trigger if we haven't already collected this checkpoint
          if (!tutorialCheckpointJustCollected) {
            collectCheckpointTutorial(targetCheckpointIndex);
            tutorialCheckpointJustCollected = true;
          }
        } else {
          // Player has left checkpoint radius, allow collection again
          tutorialCheckpointJustCollected = false;
        }
      }
    }
    return;
  }

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
    playWinSound();
    showWinScreen();
  } else {
    var nextDot = document.getElementById("dot-" + currentCP);
    if (nextDot) nextDot.classList.add("active");
    updateMissionHUD();
  }
}

function collectCheckpointTutorial(checkpointIndex) {
  // Green screen flash
  var flash = document.getElementById("cp-flash");
  flash.classList.add("flash");
  setTimeout(function () {
    flash.classList.remove("flash");
  }, 300);

  // Play success sound
  playWinSound();

  // Advance to next tutorial step after the flash
  setTimeout(function () {
    if (tutorialActive && !tutorialCompleted) {
      var notif = document.getElementById("tutorial-notification");
      if (notif) {
        notif.classList.remove("show");
      }
      tutorialStepIndex++;
      // Wait for CSS transition (0.3s) to complete before showing next step
      setTimeout(function () {
        if (tutorialActive && !tutorialCompleted) {
          showNextTutorialStep();
        }
      }, 350);
    }
  }, 300);
}

function showWinScreen() {
  document.getElementById("win-time").textContent = formatTime(missionElapsed);
  document.getElementById("win-stops").textContent = CHECKPOINTS.map(
    function (cp) {
      return cp.emoji + " " + cp.label;
    },
  ).join("  →  ");
  document.getElementById("win-screen").classList.add("show");

  // Show level-specific completion popup if not tutorial
  showLevelCompletion();
}

function showLevelCompletion() {
  // Hide win screen and show appropriate level completion popup
  document.getElementById("win-screen").classList.remove("show");

  if (currentLevel === "level1") {
    document.getElementById("level1-completion").classList.add("show");
  } else if (currentLevel === "level2") {
    document.getElementById("level2-completion").classList.add("show");
  } else if (currentLevel === "level3") {
    document.getElementById("level3-completion").classList.add("show");
  }
}

function restartMission() {
  document.getElementById("win-screen").classList.remove("show");
  document.getElementById("tutorial-completion").classList.remove("show");
  document.getElementById("level1-completion").classList.remove("show");
  document.getElementById("level2-completion").classList.remove("show");
  document.getElementById("level3-completion").classList.remove("show");
  document.getElementById("level-timeout").classList.remove("show");

  // Reset tutorial state when restarting (ensures fresh tutorial on restart)
  tutorialActive = false;
  tutorialStepIndex = 0;
  tutorialStartTime = 0;
  tutorialKeysPressed = {};
  tutorialCompleted = false;
  var notif = document.getElementById("tutorial-notification");
  if (notif) {
    notif.classList.remove("show");
  }

  // Restart background music
  playBackgroundMusic();

  resetCar();
  beginMission();
}

function switchLevel(newLevel) {
  // Switch to a different level and restart mission
  // Hide all completion popups
  document.getElementById("tutorial-completion").classList.remove("show");
  document.getElementById("level1-completion").classList.remove("show");
  document.getElementById("level2-completion").classList.remove("show");
  document.getElementById("level3-completion").classList.remove("show");
  document.getElementById("win-screen").classList.remove("show");
  document.getElementById("level-timeout").classList.remove("show");

  // Reset tutorial state — tutorial is only active in tutorial level
  if (newLevel !== "tutorial") {
    tutorialActive = false;
    tutorialCompleted = false;
    var notif = document.getElementById("tutorial-notification");
    if (notif) {
      notif.classList.remove("show");
    }
  }

  currentLevel = newLevel;
  CHECKPOINTS = LEVELS[currentLevel];
  currentEpisode = "euthymia"; // reset episode when switching levels
  lockDepressiveEpisode = false; // reset developer lock
  lockManicEpisode = false; // reset manic lock
  visitedZones = {}; // reset discovered zones on minimap
  discoveredRoads = {}; // reset discovered roads on minimap
  exploredAreaCanvas = null; // reset explored area map
  exploredAreaCtx = null;

  // Restart background music for new level
  playBackgroundMusic();

  resetCar();
  beginMission();
  buildCheckpointMarkers(); // Rebuild markers for new checkpoint positions
  buildMissionSteps(); // Rebuild mission progress dots for checkpoint count
  updateLevelDisplay();
}

function goToPreviousLevel() {
  // Map each level to its previous level
  var previousLevel = {
    level1: "tutorial",
    level2: "level1",
    level3: "level2",
  };

  if (previousLevel[currentLevel]) {
    switchLevel(previousLevel[currentLevel]);
  }
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

// ─── FISHEYE DISTORTION EFFECT ────────────────────────────────────────────────
// Set up post-processing for barrel/fisheye distortion during depressive state
function initFisheyeEffect() {
  var width = window.innerWidth;
  var height = window.innerHeight;

  // Create a render target to capture the main scene
  fisheyeRenderTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });

  // Create shader material for barrel distortion with chromatic aberration and sway
  fisheyeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: fisheyeRenderTarget.texture },
      strength: { value: 0.0 }, // Controls intensity of distortion (0 to 1)
      time: { value: 0.0 }, // Time for wobble/sway effects
      chromaticStrength: { value: 0.0 }, // Chromatic aberration intensity (0 to 1)
      yellowVignetteStrength: { value: 0.0 }, // Yellow vignette blur intensity for manic (0 to 1)
      vignetteZoomAmount: { value: 0.0 }, // Zoom effect for vignette (0 = edges, 1 = center)
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float strength;
      uniform float time;
      uniform float chromaticStrength;
      uniform float yellowVignetteStrength;
      uniform float vignetteZoomAmount;
      varying vec2 vUv;
      
      void main() {
        vec2 center = vec2(0.5, 0.5);
        vec2 delta = vUv - center;
        float len = length(delta);
        
        // Apply exaggerated barrel/fisheye distortion
        // Use a stronger quadratic distortion for more pronounced effect
        float distortion = 1.0 + (len * len) * strength * 2.0;
        vec2 distorted = center + (delta * distortion);
        
        // Add enhanced time-based sway/wobble effect (inspired by camera sway) - only for depressive // [1]
        float wobble = sin(time * 2.0) * 0.12 * strength; // [1]
        float wobble2 = sin(time * 1.3 + 1.57) * 0.12 * strength; // [1]
        distorted += vec2(wobble, wobble2);
        
        // Warm chromatic aberration - separate with orange/yellow/red shifts (no cool blue fringing)
        float chromaticAmount = chromaticStrength * 0.03;
        vec2 orangeOffset = distorted + vec2(chromaticAmount, chromaticAmount * 0.5); // Warmer outer offset
        vec2 yellowOffset = distorted; // Center channel (warm yellow)
        vec2 redOffset = distorted - vec2(chromaticAmount, chromaticAmount * 0.5); // Warm inner offset
        
        // Clamp all channels
        orangeOffset = clamp(orangeOffset, 0.0, 1.0);
        yellowOffset = clamp(yellowOffset, 0.0, 1.0);
        redOffset = clamp(redOffset, 0.0, 1.0);
        
        // Sample color channels
        float orange = texture2D(tDiffuse, orangeOffset).r; // Use red channel for orange shift
        float yellow = texture2D(tDiffuse, yellowOffset).g; // Use green channel for yellow
        float red = texture2D(tDiffuse, redOffset).r; // Use red channel for red
        
        // Blend warm chromatic colors (orange-yellow-red shifts, no cool blue)
        vec3 warmChromaticColor = vec3(red, yellow * 0.9, orange * 0.5); // Warm aberration blend
        vec3 normalColor = texture2D(tDiffuse, clamp(distorted, 0.0, 1.0)).rgb;
        vec3 sampleColor = mix(normalColor, warmChromaticColor, chromaticStrength * 0.6);
        
        // Add enhanced vignetting (darkening at edges) - applies to both depressive and manic
        float vignetteStrength = max(strength, chromaticStrength);
        float vignette = 1.0 - (len * len * len) * vignetteStrength * 2.0;
        vignette = clamp(vignette, 0.0, 1.0);
        vec4 color = vec4(sampleColor, 1.0) * vignette;
        
        // Yellow vignette blur for manic state with smooth inward zoom effect
        if (yellowVignetteStrength > 0.0) {
          // Strong yellow glow that intensifies at edges and extends far into center
          // Create a more gradual falloff so yellow surrounds the car
          float edgeIntensity = pow(len, 1.5); // Smooth falloff from edges toward center
          vec3 yellowOverlay = vec3(1.0, 0.9, 0.4); // Bright warm yellow
          
          // Apply zoom effect: pull yellow from edges toward center (surrounding the car)
          float zoomPull = mix(0.3, 1.0, vignetteZoomAmount); // Start at 0.3 (always some yellow at center) to 1.0
          float vignetteBlur = edgeIntensity * zoomPull; // Extends further inward with zoom
          
          // Blend yellow vignette strongly into the scene
          color.rgb = mix(color.rgb, yellowOverlay, yellowVignetteStrength * vignetteBlur);
          
          // Add additional yellow wash that extends all the way to center during full zoom
          color.rgb += yellowOverlay * yellowVignetteStrength * edgeIntensity * 0.8 * vignetteZoomAmount;
        }
        
        gl_FragColor = color;
      }
    `,
  });

  // Create a fullscreen quad to apply the effect
  var quadGeo = new THREE.PlaneGeometry(2, 2);
  distortionQuad = new THREE.Mesh(quadGeo, fisheyeMaterial);

  // Create a separate scene for the distortion effect
  distortionScene = new THREE.Scene();
  distortionScene.add(distortionQuad);

  // Create an orthographic camera for the post-processing pass
  distortionCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  distortionCamera.position.z = 1;
}

// Render with optional fisheye distortion
function renderWithEffects() {
  // Update shader time uniform for wobble and sway effects
  if (fisheyeMaterial && fisheyeMaterial.uniforms) {
    fisheyeMaterial.uniforms.time.value += 0.016; // ~60fps

    // Set manic state effects (yellow vignette with smooth zoom)
    if (currentEpisode === "manic") {
      // Smooth inward zoom animation: gradually transition from edges to center over time
      var zoomTime = (Date.now() - episodeStartTime) / 4000.0; // Full zoom cycle every 4 seconds
      var zoomAmount = Math.abs(Math.sin(zoomTime * Math.PI)); // Oscillate between 0 and 1.0 (full zoom into center)
      fisheyeMaterial.uniforms.yellowVignetteStrength.value = 0.85;
      fisheyeMaterial.uniforms.vignetteZoomAmount.value = zoomAmount;
    } else {
      fisheyeMaterial.uniforms.yellowVignetteStrength.value = 0.0;
      fisheyeMaterial.uniforms.vignetteZoomAmount.value = 0.0;
    }
  }

  // FISHEYE LENS EFFECT ENABLED (distortion for depressive, chromatic aberration for manic)
  if (
    (currentEpisode === "depressive" || currentEpisode === "manic") &&
    fisheyeRenderTarget &&
    distortionScene &&
    distortionQuad
  ) {
    // Render main scene to render target
    renderer.setRenderTarget(fisheyeRenderTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // Apply distortion/chromatic effect to screen using orthographic camera
    renderer.render(distortionScene, distortionCamera);
  } else {
    // Normal render without distortion
    renderer.render(scene, camera);
  }
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────
// Called by the Start button in index.html
// Play menu button sound (can be called before initAudio)
function playMenuSound() {
  var menu = document.getElementById("menu-sound");
  if (menu) {
    menu.currentTime = 0;
    menu.play().catch(function (error) {
      console.log("❌ Menu sound play failed:", error);
    });
  }
}

function startGame() {
  document.getElementById("start-screen").style.display = "none";
  document.getElementById("hud").style.display = "block";
  gameRunning = true;
  initAudio();
  playBackgroundMusic();
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

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  // Fog removed for better visibility

  // Camera
  camera = new THREE.PerspectiveCamera(
    65,
    window.innerWidth / window.innerHeight,
    0.1,
    500,
  );
  camera.position.set(0, 8, -14);

  // Lighting
  ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  sunLight = new THREE.DirectionalLight(0xfffbe0, 1.2);
  sunLight.position.set(80, 120, 60);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 400;
  sunLight.shadow.camera.left = -180;
  sunLight.shadow.camera.right = 180;
  sunLight.shadow.camera.top = 180;
  sunLight.shadow.camera.bottom = -180;
  scene.add(sunLight);

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
  buildMissionSteps(); // Build progress dots for current level's checkpoints

  // Post-processing
  initFisheyeEffect();

  // Input
  window.addEventListener("keydown", function (e) {
    keys[e.code] = true;
    if (e.code === "KeyR") resetCar();
    // Space to toggle pause
    if (e.code === "Space") {
      if (missionActive && !missionComplete) {
        togglePause();
      }
    }
    // Developer shortcut: backtick to cycle through levels (tutorial → level1 → level2 → level3 → tutorial)
    if (e.code === "Backquote") {
      var levelCycle = ["tutorial", "level1", "level2", "level3"];
      var currentIndex = levelCycle.indexOf(currentLevel);
      var nextIndex = (currentIndex + 1) % levelCycle.length;
      switchLevel(levelCycle[nextIndex]);
    }
    // Developer shortcut: 1 to lock/unlock depressive episode
    if (e.code === "Digit1") {
      lockDepressiveEpisode = !lockDepressiveEpisode;
      lockManicEpisode = false; // Disable manic lock if switching to depressive
      if (lockDepressiveEpisode) {
        currentEpisode = "depressive";
        visitedZones = {}; // Clear zone discoveries when entering depressive episode
        discoveredRoads = {}; // Clear road discoveries when entering depressive episode
        // Initialize explored area canvas for developer lock
        exploredAreaCanvas = document.createElement("canvas");
        exploredAreaCanvas.width = 200;
        exploredAreaCanvas.height = 200;
        exploredAreaCtx = exploredAreaCanvas.getContext("2d");
        exploredAreaCtx.fillStyle = "rgba(100, 140, 180, 0.5)"; // Blue-grey tint for visited areas
        console.log(
          "🔒 Depressive episode locked - visitedZones, discoveredRoads, and exploredAreaCanvas cleared",
        );
      } else {
        currentEpisode = "euthymia";
        console.log("🔓 Depressive episode unlocked - reset to euthymia");
      }
    }
    // Developer shortcut: 2 to lock/unlock manic episode
    if (e.code === "Digit2") {
      lockManicEpisode = !lockManicEpisode;
      lockDepressiveEpisode = false; // Disable depressive lock if switching to manic
      if (lockManicEpisode) {
        currentEpisode = "manic";
        console.log("🔒 Manic episode locked");
      } else {
        currentEpisode = "euthymia";
        console.log("🔓 Manic episode unlocked - reset to euthymia");
      }
    }
    // Accessibility: M to toggle minimap rotation (useful during manic episodes)
    if (e.code === "KeyM" || e.code === "KeyM") {
      minimapRotationEnabled = !minimapRotationEnabled;
      console.log(
        "🗺️ Minimap rotation " +
          (minimapRotationEnabled ? "enabled" : "disabled"),
      );
    }
    // Track tutorial key presses for WASD and Shift
    if (tutorialActive && !tutorialCompleted) {
      tutorialKeysPressed[e.code] = true;
      checkTutorialKeyCompletion();
    }
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

  // Billboards
  billboard(18, -30, 0xff6644);
  billboard(-18, -30, 0x44aaff);
}

function building(x, z, w, d, h, color) {
  // Apply warm color tint during manic episodes
  var buildingColor = color;
  if (currentEpisode === "manic") {
    // Shift color toward warmer tones (increase red, maintain green, reduce blue)
    var r = ((color >> 16) & 255) * 1.2; // Boost red
    var g = ((color >> 8) & 255) * 1.0; // Keep green
    var b = (color & 255) * 0.7; // Reduce blue
    buildingColor =
      (Math.min(r, 255) << 16) | (Math.min(g, 255) << 8) | Math.min(b, 255);
  }

  box(w, h, d, buildingColor, x, 0, z); // main body — auto-registers collider (h > 2)
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
// Define zones for discovery tracking
var MINIMAP_ZONES = [
  { name: "Grassy Fields", x: -70, z: -70, w: 110, h: 110, color: "#1e3a1a" },
  { name: "Rocky Hills", x: 25, z: -90, w: 95, h: 100, color: "#2a2218" },
  { name: "Downtown", x: -20, z: -20, w: 80, h: 80, color: "#192233" },
  {
    name: "Industrial District",
    x: -125,
    z: 15,
    w: 110,
    h: 110,
    color: "#221c10",
  },
  { name: "Waterfront", x: 35, z: 20, w: 110, h: 110, color: "#112233" },
];

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

  // Check which zone the car is currently in and mark as visited (if discovery is enabled)
  var episodeConfig = null;
  if (currentEpisode === "depressive") {
    episodeConfig = DEPRESSIVE_EPISODE;
  } else if (currentEpisode === "manic") {
    episodeConfig = MANIC_EPISODE;
  } else if (currentEpisode === "euthymia") {
    episodeConfig = EUTHYMIA_EPISODE;
  }

  // Save canvas state before rotation
  ctx.save();

  // Apply rotation to canvas grid (not the container)
  if (
    episodeConfig &&
    episodeConfig.minimapRotation &&
    minimapRotationEnabled
  ) {
    var rotationSpeed = episodeConfig.rotationSpeed || 0.06;
    var rotationDegrees = (Date.now() * rotationSpeed) % 360;
    var rotationRadians = (rotationDegrees * Math.PI) / 180; // Convert to radians
    ctx.translate(W / 2, H / 2); // Translate to canvas center
    ctx.rotate(rotationRadians); // Rotate the grid
    ctx.translate(-W / 2, -H / 2); // Translate back
  }

  // DEBUG: Log minimap rendering state (remove after testing)
  if (missionActive && missionElapsed % 2 < 0.067) {
    // Log roughly every 2 seconds
    console.log(
      "📍 MINIMAP RENDER | currentEpisode: " +
        currentEpisode +
        " | episodeConfig: " +
        (episodeConfig ? episodeConfig.name : "null") +
        " | minimapDiscovery: " +
        (episodeConfig ? episodeConfig.minimapDiscovery : "N/A"),
    );
  }

  // ── Background ──
  // During depressive episode with discovery: pure black background (foggy/blacked out)
  // Otherwise: dark green
  if (episodeConfig && episodeConfig.minimapDiscovery) {
    ctx.fillStyle = "#000000"; // Pure black background during depressive discovery
  } else {
    ctx.fillStyle = "#111a11"; // Dark green for normal/manic
  }
  ctx.fillRect(0, 0, W, H);

  // ── DEPRESSIVE DISCOVERY MODE: Circular radius around player ──
  var isDepressiveDiscovery = episodeConfig && episodeConfig.minimapDiscovery;
  var visibilityRadius = 35; // World units - how far player can see on minimap in depressive mode
  var playerWorldX = car.position.x;
  var playerWorldZ = car.position.z;

  // Helper function to check if a point is visible from player
  function isPointVisible(x, z) {
    if (!isDepressiveDiscovery) return true; // Always visible in normal mode
    var dx = x - playerWorldX;
    var dz = z - playerWorldZ;
    var dist = Math.sqrt(dx * dx + dz * dz);
    return dist < visibilityRadius;
  }

  // Helper function to check if a zone's center is visible
  function isZoneCenterVisible(z) {
    return isPointVisible(z.x, z.z);
  }

  // Helper function to convert hex color to rgba with alpha
  function colorWithAlpha(hexColor, alpha) {
    // Convert #RRGGBB to rgba
    var r = parseInt(hexColor.slice(1, 3), 16);
    var g = parseInt(hexColor.slice(3, 5), 16);
    var b = parseInt(hexColor.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  // ── Draw explored areas (BEFORE clipping, as persistent background) ──
  if (isDepressiveDiscovery && exploredAreaCanvas) {
    ctx.globalAlpha = 0.2;
    ctx.drawImage(exploredAreaCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  // ── Draw discovered zones and roads clipped to explored area (in depressive mode) ──
  if (isDepressiveDiscovery && exploredAreaCanvas) {
    // Create a temporary canvas for discovered items
    var tempCanvas = document.createElement("canvas");
    tempCanvas.width = mc.width;
    tempCanvas.height = mc.height;
    var tempCtx = tempCanvas.getContext("2d");

    // First, record any newly visible zones as discovered
    MINIMAP_ZONES.forEach(function (z) {
      if (isZoneCenterVisible(z)) {
        visitedZones[z.name] = true; // Mark zone as discovered
      }
    });

    // Draw discovered zones to temp canvas
    MINIMAP_ZONES.forEach(function (z) {
      if (visitedZones[z.name]) {
        var isCurrentlyVisible = isZoneCenterVisible(z);
        if (!isCurrentlyVisible) {
          // Only draw if not currently visible
          tempCtx.fillStyle = colorWithAlpha(z.color, 0.35);
          tempCtx.fillRect(wx(z.x), wz(z.z + z.h), z.w * S, z.h * S);
        }
      }
    });

    // Draw discovered roads to temp canvas
    var roadDefs = [
      [0, -85, 9, 170, Math.PI / 2],
      [0, 85, 9, 170, Math.PI / 2],
      [-85, 0, 9, 170, 0],
      [85, 0, 9, 170, 0],
      [0, 0, 9, 170, 0],
      [0, 0, 9, 170, Math.PI / 2],
      [-42, 0, 7, 170, 0],
      [42, 0, 7, 170, 0],
      [0, -42, 7, 170, Math.PI / 2],
      [0, 42, 7, 170, Math.PI / 2],
      [0, -62, 7, 170, Math.PI / 2],
      [0, 62, 7, 170, Math.PI / 2],
      [-62, 0, 7, 170, 0],
      [62, 0, 7, 170, 0],
      [-75, 0, 8, 170, 0],
      [-73, 55, 7, 24, Math.PI / 2],
      [80, 63, 7, 46, 0],
      [73, 70, 7, 22, Math.PI / 2],
      [-22, -21, 7, 42, 0],
      [22, -21, 7, 42, 0],
      [0, -25, 7, 84, Math.PI / 2],
      [-21, -21, 7, 80, Math.PI / 4],
      [21, 21, 7, 80, Math.PI / 4],
      [21, -21, 7, 80, -Math.PI / 4],
      [-21, 21, 7, 80, -Math.PI / 4],
    ];

    // Helper function to draw a road on temp canvas
    function drawRoadToTemp(x, z, w, len, ry, opacity) {
      opacity = opacity || 1;
      ry = ry || 0;
      tempCtx.save();
      tempCtx.globalAlpha = opacity;
      tempCtx.translate(wx(x), wz(z));
      tempCtx.rotate(-ry);
      tempCtx.fillStyle = "#3a3a3a";
      tempCtx.fillRect((-len * S) / 2, (-w * S) / 2, len * S, w * S);
      tempCtx.fillStyle = "rgba(220,210,120,0.35)";
      tempCtx.fillRect((-len * S) / 2, -0.4, len * S, 0.8);
      tempCtx.restore();
    }

    // Draw discovered roads to temp canvas
    for (var i = 0; i < roadDefs.length; i++) {
      var rd = roadDefs[i];
      var roadKey = rd[0] + "," + rd[1];
      var isCurrentlyVisible = isPointVisible(rd[0], rd[1]);

      // Record road as discovered if currently visible
      if (isCurrentlyVisible) {
        discoveredRoads[roadKey] = true;
      }

      // Draw discovered but not visible to temp canvas
      if (discoveredRoads[roadKey] && !isCurrentlyVisible) {
        drawRoadToTemp(rd[0], rd[1], rd[2], rd[3], rd[4], 0.35);
      }
    }

    // Now composite the temp canvas with exploredAreaCanvas to clip it
    tempCtx.globalCompositeOperation = "destination-in";
    tempCtx.drawImage(exploredAreaCanvas, 0, 0);

    // Draw the clipped temp canvas to main canvas
    ctx.drawImage(tempCanvas, 0, 0);
  } else {
    // Normal mode: draw all zones
    MINIMAP_ZONES.forEach(function (z) {
      ctx.fillStyle = z.color;
      ctx.fillRect(wx(z.x), wz(z.z + z.h), z.w * S, z.h * S);
    });
  }

  // ── APPLY CLIPPING CIRCLE in depressive mode ──
  if (isDepressiveDiscovery) {
    ctx.save();
    var circleRadius = visibilityRadius * S;
    ctx.beginPath();
    ctx.arc(wx(playerWorldX), wz(playerWorldZ), circleRadius, 0, Math.PI * 2);
    ctx.clip();
  }

  // ── Water patch (Waterfront) ──
  if (isPointVisible(55, 65)) {
    ctx.fillStyle = "#1a3a4a";
    ctx.fillRect(wx(55), wz(65 + 45), 70 * S, 45 * S);
  }

  // ── Draw currently visible zones at FULL brightness (inside clipping) ──
  if (isDepressiveDiscovery) {
    MINIMAP_ZONES.forEach(function (z) {
      if (isZoneCenterVisible(z)) {
        ctx.fillStyle = z.color;
        ctx.fillRect(wx(z.x), wz(z.z + z.h), z.w * S, z.h * S);
      }
    });
  }

  // ── ROAD RENDERING ──
  if (!isDepressiveDiscovery) {
    // Normal/Manic mode: draw all roads
    function mroad(x, z, w, len, ry) {
      ry = ry || 0;
      ctx.save();
      ctx.translate(wx(x), wz(z));
      ctx.rotate(-ry);
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect((-len * S) / 2, (-w * S) / 2, len * S, w * S);
      ctx.fillStyle = "rgba(220,210,120,0.35)";
      ctx.fillRect((-len * S) / 2, -0.4, len * S, 0.8);
      ctx.restore();
    }

    // ── Draw every road ──
    mroad(0, -85, 9, 170, Math.PI / 2);
    mroad(0, 85, 9, 170, Math.PI / 2);
    mroad(-85, 0, 9, 170, 0);
    mroad(85, 0, 9, 170, 0);
    mroad(0, 0, 9, 170, 0);
    mroad(0, 0, 9, 170, Math.PI / 2);
    mroad(-42, 0, 7, 170, 0);
    mroad(42, 0, 7, 170, 0);
    mroad(0, -42, 7, 170, Math.PI / 2);
    mroad(0, 42, 7, 170, Math.PI / 2);
    mroad(0, -62, 7, 170, Math.PI / 2);
    mroad(0, 62, 7, 170, Math.PI / 2);
    mroad(-62, 0, 7, 170, 0);
    mroad(62, 0, 7, 170, 0);
    mroad(-75, 0, 8, 170, 0);
    mroad(-73, 55, 7, 24, Math.PI / 2);
    mroad(80, 63, 7, 46, 0);
    mroad(73, 70, 7, 22, Math.PI / 2);
    mroad(-22, -21, 7, 42, 0);
    mroad(22, -21, 7, 42, 0);
    mroad(0, -25, 7, 84, Math.PI / 2);
    mroad(-21, -21, 7, 80, Math.PI / 4);
    mroad(21, 21, 7, 80, Math.PI / 4);
    mroad(21, -21, 7, 80, -Math.PI / 4);
    mroad(-21, 21, 7, 80, -Math.PI / 4);
  } else {
    // Depressive mode: draw currently visible roads at FULL opacity (inside clipping)
    var roadDefs = [
      [0, -85, 9, 170, Math.PI / 2],
      [0, 85, 9, 170, Math.PI / 2],
      [-85, 0, 9, 170, 0],
      [85, 0, 9, 170, 0],
      [0, 0, 9, 170, 0],
      [0, 0, 9, 170, Math.PI / 2],
      [-42, 0, 7, 170, 0],
      [42, 0, 7, 170, 0],
      [0, -42, 7, 170, Math.PI / 2],
      [0, 42, 7, 170, Math.PI / 2],
      [0, -62, 7, 170, Math.PI / 2],
      [0, 62, 7, 170, Math.PI / 2],
      [-62, 0, 7, 170, 0],
      [62, 0, 7, 170, 0],
      [-75, 0, 8, 170, 0],
      [-73, 55, 7, 24, Math.PI / 2],
      [80, 63, 7, 46, 0],
      [73, 70, 7, 22, Math.PI / 2],
      [-22, -21, 7, 42, 0],
      [22, -21, 7, 42, 0],
      [0, -25, 7, 84, Math.PI / 2],
      [-21, -21, 7, 80, Math.PI / 4],
      [21, 21, 7, 80, Math.PI / 4],
      [21, -21, 7, 80, -Math.PI / 4],
      [-21, 21, 7, 80, -Math.PI / 4],
    ];

    // Function to draw a road at given position
    function drawRoad(x, z, w, len, ry, opacity) {
      opacity = opacity || 1;
      ry = ry || 0;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.translate(wx(x), wz(z));
      ctx.rotate(-ry);
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect((-len * S) / 2, (-w * S) / 2, len * S, w * S);
      ctx.fillStyle = "rgba(220,210,120,0.35)";
      ctx.fillRect((-len * S) / 2, -0.4, len * S, 0.8);
      ctx.restore();
    }

    // Draw currently visible roads at full opacity (inside clipping)
    for (var i = 0; i < roadDefs.length; i++) {
      var rd = roadDefs[i];
      if (isPointVisible(rd[0], rd[1])) {
        drawRoad(rd[0], rd[1], rd[2], rd[3], rd[4], 1);
      }
    }
  }

  // ── Map boundary box (only in normal mode) ──
  if (!isDepressiveDiscovery) {
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(wx(-100), wz(100), 200 * S, 200 * S);
  }

  // ── Restore clipping and draw visibility circle (only in depressive mode) ──
  if (isDepressiveDiscovery) {
    ctx.restore(); // Restore from clipping
    var circleRadius = visibilityRadius * S;

    // Draw circle outline showing visible area
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(wx(playerWorldX), wz(playerWorldZ), circleRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Track explored areas: fill circle on the explored area canvas (after clipping is done)
  if (isDepressiveDiscovery && exploredAreaCanvas && exploredAreaCtx) {
    var circleRadius = visibilityRadius * S;
    exploredAreaCtx.beginPath();
    exploredAreaCtx.arc(
      wx(playerWorldX),
      wz(playerWorldZ),
      circleRadius,
      0,
      Math.PI * 2,
    );
    exploredAreaCtx.fill();
  }

  // ── Active checkpoint marker — pulsing ring (visibility based on episode config) ──
  var showCheckpoints =
    !episodeConfig || episodeConfig.showCheckpoints !== false;

  // Determine which checkpoint to show on minimap
  var minimapCheckpointIndex = currentCP;
  if (currentLevel === "tutorial" && tutorialActive && !tutorialCompleted) {
    var tutorialFlow = TUTORIAL_LEVEL.tutorialFlow;
    var currentStep = tutorialFlow[tutorialStepIndex];
    if (currentStep && currentStep.type === "checkpoint-goal") {
      // Initialize delay timer on first frame entering this step (same as 3D markers)
      if (tutorialStepWhenCheckpointGoalStarted !== tutorialStepIndex) {
        tutorialCheckpointGoalStartTime = Date.now();
        tutorialStepWhenCheckpointGoalStarted = tutorialStepIndex;
      }

      // Check 1 second delay before showing checkpoint
      var checkpointGoalElapsed = Date.now() - tutorialCheckpointGoalStartTime;
      if (checkpointGoalElapsed >= 1000) {
        minimapCheckpointIndex = currentStep.checkpointIndex;
        showCheckpoints = true;
      } else {
        showCheckpoints = false;
      }
    } else {
      // Hide checkpoints for other tutorial step types
      showCheckpoints = false;
    }
  }

  if (missionActive && !missionComplete && showCheckpoints) {
    var cp = CHECKPOINTS[minimapCheckpointIndex];
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

  // ── Collected checkpoint tick marks (visibility based on episode config) ──
  // Don't show collected checkpoints during tutorial either
  if (showCheckpoints && currentLevel !== "tutorial") {
    for (var ci = 0; ci < currentCP; ci++) {
      var dcp = CHECKPOINTS[ci];
      ctx.beginPath();
      ctx.arc(wx(dcp.x), wz(dcp.z), 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(126,245,168,0.3)";
      ctx.fill();
    }
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
  // Only drawn during normal episodes, completely hidden during depressive discovery fog
  if (!isDepressiveDiscovery) {
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = "7px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", W / 2, 7);
    ctx.fillText("S", W / 2, H - 7);
    ctx.fillText("W", 7, H / 2);
    ctx.fillText("E", W - 7, H / 2);
  }

  // Restore canvas state from rotation (if rotation was applied)
  ctx.restore();
}

// ─── CAR PHYSICS ──────────────────────────────────────────────────────────────
function updateCar(dt) {
  var boost = keys["ShiftLeft"] || keys["ShiftRight"];

  // Play engine sound when boost starts (transition from not pressing to pressing Shift)
  if (boost && !lastEngineBoostPressed) {
    playEngineSound();
  }
  lastEngineBoostPressed = boost;

  var maxSpeed = 0.32;

  // During depressive episode, significantly reduce car speed
  // Apply episode-specific speed multiplier
  var episodeConfig = null;
  if (currentEpisode === "depressive") {
    episodeConfig = DEPRESSIVE_EPISODE;
  } else if (currentEpisode === "manic") {
    episodeConfig = MANIC_EPISODE;
  } else if (currentEpisode === "euthymia") {
    episodeConfig = EUTHYMIA_EPISODE;
  }

  if (episodeConfig && episodeConfig.carSpeedMultiplier) {
    maxSpeed *= episodeConfig.carSpeedMultiplier;
  }

  // Apply episode-specific boost multipliers
  var boostMultiplier = 1.0;
  if (boost) {
    if (currentEpisode === "depressive") {
      boostMultiplier = 1.71875; // Standard boost multiplier
    } else if (currentEpisode === "manic") {
      boostMultiplier = 1.71875; // Standard boost multiplier
    } else if (currentEpisode === "euthymia") {
      boostMultiplier = 2.0; // Faster boost in euthymia
    }
  }
  maxSpeed *= boostMultiplier;

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

  // Add camera shake during episodes
  if (fisheyeMaterial && fisheyeMaterial.uniforms) {
    var time = fisheyeMaterial.uniforms.time.value;

    // Get episode configuration
    var episodeConfig = null;
    if (currentEpisode === "depressive") {
      episodeConfig = DEPRESSIVE_EPISODE;
    } else if (currentEpisode === "manic") {
      episodeConfig = MANIC_EPISODE;
    } else if (currentEpisode === "euthymia") {
      episodeConfig = EUTHYMIA_EPISODE;
    }

    if (episodeConfig && episodeConfig.cameraShakeStrength > 0) {
      var shakeStrength = episodeConfig.cameraShakeStrength;
      var freqs = episodeConfig.cameraShakeFrequencies;

      // Apply sinusoidal camera shake based on episode configuration // [1]
      camera.position.x += Math.sin(time * freqs.x) * shakeStrength; // [1]
      camera.position.y += Math.sin(time * freqs.y + 0.5) * shakeStrength; // [1]
      camera.position.z += Math.sin(time * freqs.z + 1.0) * shakeStrength; // [1]
    }
  }

  camera.lookAt(car.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
}

// ─── EPISODE EFFECTS ──────────────────────────────────────────────────────────
// Update visual and camera effects based on current episode
function updateEpisodeEffects() {
  // Default values for euthymia (normal state)
  var targetFOV = 75;
  var targetSkyColor = 0x87ceeb;
  var targetDistortion = 0;
  var targetChromaticStrength = 0;
  var targetAmbientIntensity = 0.6;

  // Use episode configuration files
  var episodeConfig = null;
  if (currentEpisode === "depressive") {
    episodeConfig = DEPRESSIVE_EPISODE;
  } else if (currentEpisode === "manic") {
    episodeConfig = MANIC_EPISODE;
  } else if (currentEpisode === "euthymia") {
    episodeConfig = EUTHYMIA_EPISODE;
  }

  // Apply episode-specific parameters if available
  if (episodeConfig) {
    targetFOV = episodeConfig.fov;
    targetSkyColor = episodeConfig.skyColor;
    targetDistortion = episodeConfig.distortion;
    targetChromaticStrength = episodeConfig.chromaticStrength;
    targetAmbientIntensity = episodeConfig.ambientIntensity;
  }

  // Smoothly transition the sky color
  if (scene.background) {
    var currentColor = scene.background;
    var targetColor = new THREE.Color(targetSkyColor);
    currentColor.lerp(targetColor, 0.05); // smooth transition
  }

  // Smoothly transition the camera FOV
  if (camera && Math.abs(camera.fov - targetFOV) > 0.1) {
    camera.fov += (targetFOV - camera.fov) * 0.05;
    camera.updateProjectionMatrix();
  }

  // Adjust ambient light intensity during episodes
  if (ambientLight) {
    ambientLight.intensity +=
      (targetAmbientIntensity - ambientLight.intensity) * 0.05;
  }

  // Update fisheye distortion strength and chromatic aberration
  if (fisheyeMaterial && fisheyeMaterial.uniforms) {
    var currentStrength = fisheyeMaterial.uniforms.strength.value;
    fisheyeMaterial.uniforms.strength.value +=
      (targetDistortion - currentStrength) * 0.1;

    var currentChromaticStrength =
      fisheyeMaterial.uniforms.chromaticStrength.value;
    fisheyeMaterial.uniforms.chromaticStrength.value +=
      (targetChromaticStrength - currentChromaticStrength) * 0.1;

    // Reset shader time when leaving depressive episode for clean transitions
    if (currentEpisode !== "depressive" && currentStrength > 0.01) {
      // Shader is active but shouldn't be, no reset needed yet - it will fade out
    } else if (currentEpisode !== "depressive" && currentStrength < 0.01) {
      // Fully transitioned out, reset time for next depressive episode
      fisheyeMaterial.uniforms.time.value = 0.0;
    }
  }
}

// ─── DEBUG DISPLAY ────────────────────────────────────────────────────────────
// Debug display removed

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
function animate() {
  if (!gameRunning) return;
  requestAnimationFrame(animate);

  // Skip game logic if paused
  if (!gamePaused) {
    var dt = clock.getDelta();
    updateCar(dt);
    updateCamera();
    updateLevel1Episodes(); // Update unpredictable episodes for Level 1
    updateLevel2Episodes(); // Update unpredictable manic episodes for Level 2
    updateLevel3Episodes(); // Update mixed episodes for Level 3
    updateEpisodeEffects();
    updateMarkers(dt);
    updateMissionHUD();
    checkCheckpoints();
  }

  drawMinimap();

  // Rotate minimap based on episode configuration
  var minimapElement = document.getElementById("minimap");
  if (minimapElement) {
    var episodeConfig = null;
    if (currentEpisode === "depressive") {
      episodeConfig = DEPRESSIVE_EPISODE;
    } else if (currentEpisode === "manic") {
      episodeConfig = MANIC_EPISODE;
    } else if (currentEpisode === "euthymia") {
      episodeConfig = EUTHYMIA_EPISODE;
    }

    // Note: Minimap rotation is now applied via canvas context inside drawMinimap()
    // This ensures the grid content rotates, not the container element
  }

  renderWithEffects();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Resize post-processing render target
  if (fisheyeRenderTarget) {
    fisheyeRenderTarget.setSize(window.innerWidth, window.innerHeight);
  }
}
