// =============================================================================
// levels/euthymia.js — Euthymia Episode Configuration
// =============================================================================
// Defines all visual and gameplay parameters for the euthymia episode state.
// This episode represents normal mood and baseline emotional regulation:
// - Normal speed and camera movement
// - Clear vision and normal visual effects
// - Full minimap visibility
// - Standard game feel
// =============================================================================

const EUTHYMIA_EPISODE = {
  name: "euthymia",
  displayName: "EUTHYMIA",

  // Visual effects
  skyColor: 0x87ceeb, // Bright sky blue
  fov: 75, // Normal field of view
  ambientIntensity: 0.6, // Normal lighting

  // Shader effects
  distortion: 0, // No barrel distortion
  chromaticStrength: 0, // No chromatic aberration

  // Camera behavior
  cameraShakeStrength: 0, // No camera shake
  cameraShakeFrequencies: {
    x: 0,
    y: 0,
    z: 0,
  },

  // Gameplay mechanics
  carSpeedMultiplier: 1.0, // Normal speed

  // Minimap behavior
  minimapDiscovery: false, // Full visibility
  minimapRotation: false, // No rotation
  showCheckpoints: true, // Show checkpoints

  // Duration (in milliseconds)
  duration: 10000, // 10 seconds
};
