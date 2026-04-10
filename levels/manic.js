// =============================================================================
// levels/manic.js — Manic Episode Configuration
// =============================================================================
// Defines all visual and gameplay parameters for the manic episode state.
// This episode represents the subjective experience of mania through:
// - Increased speed and racing heartbeat
// - Visual overstimulation (chromatic aberration, rotating minimap)
// - Frenetic camera motion
// - Chaotic, uncontrolled sensations
// =============================================================================

const MANIC_EPISODE = {
  name: "manic",
  displayName: "MANIC EPISODE",

  // Visual effects
  skyColor: 0xffdd44, // Warm yellow (euphoric, invincible feeling)
  fov: 75, // Normal FOV
  ambientIntensity: 0.6, // Normal intensity
  buildingWarmMultiplier: 1.3, // Warm color tint for all buildings

  // Shader effects
  distortion: 0, // No barrel distortion
  chromaticStrength: 0.6, // Warm color aberration (orange/yellow shifts, no blue fringing)
  yellowVignetteStrength: 0.85, // Strong warm yellow blur vignette from edges
  vignetteZoomAmount: 0.0, // Smooth inward zoom effect (0 = edges, 1 = center)

  // Camera behavior
  cameraShakeStrength: 0, // No camera shake — smooth focus on warm visuals
  cameraShakeFrequencies: {
    x: 10.0, // Hz (much faster)
    y: 9.0,
    z: 8.0,
  },

  // Gameplay mechanics
  carSpeedMultiplier: 2.0, // 200% of normal speed

  // Minimap behavior
  minimapDiscovery: false, // Full minimap visibility
  minimapRotation: true, // Continuous rotation
  rotationSpeed: 0.06, // Degrees per millisecond (~60°/sec)
  showCheckpoints: true, // Show checkpoints on map during manic

  // Duration (in milliseconds)
  duration: 15000, // 15 seconds

  // Level 2: Unpredictable manic episode system
  episodeCount: 2, // Number of manic episodes during level
  episodeDurationMin: 7000, // 7 seconds minimum
  episodeDurationMax: 15000, // 15 seconds maximum

  // Description for tooltip/tutorial
  description:
    "Manic episodes are marked by elevated mood, increased energy, racing thoughts, and impulsive behavior. The world feels warm, invincible, and euphoric.",
};
