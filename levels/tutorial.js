// =============================================================================
// levels/tutorial.js — Tutorial Level Definition
// =============================================================================
// Tutorial level designed to introduce players to game mechanics and
// bipolar disorder state transitions (Euthymia, Manic, Depressive).
// =============================================================================

const TUTORIAL_LEVEL = {
  name: "tutorial",
  displayName: "TUTORIAL",
  checkpoints: [
    // Tutorial & Level 1/2 checkpoints
    {
      x: -75,
      z: 55,
      r: 10,
      label: "Gas Station",
      color: 0xf5a623,
      emoji: "⛽",
    },
    { x: 0, z: -25, r: 12, label: "Downtown", color: 0x4ecdc4, emoji: "🏙️" },
    { x: 80, z: 70, r: 12, label: "Waterfront", color: 0x7bb8f5, emoji: "🌉" },
    // Level 3 checkpoints
    {
      x: -55,
      z: -80,
      r: 12,
      label: "Green Hills",
      color: 0xff9900,
      emoji: "🏔️",
    },
    {
      x: 75,
      z: -50,
      r: 12,
      label: "Rocky Hills",
      color: 0x4ecdc4,
      emoji: "🌲",
    },
    {
      x: 45,
      z: 85,
      r: 12,
      label: "Waterfront",
      color: 0xff6b9d,
      emoji: "🏖️",
    },
  ],
  tutorialFlow: [
    {
      message: "Use Arrow Keys or WASD to navigate",
      type: "wait-keys",
      keys: [
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ArrowUp",
        "ArrowLeft",
        "ArrowDown",
        "ArrowRight",
      ],
    },
    {
      message: "Use Shift to boost",
      type: "wait-keys",
      keys: ["ShiftLeft", "ShiftRight"],
    },
    {
      message:
        "Your mission bar is the top right\nIt displays your objective and progress",
      type: "glow-mission",
      duration: 3000,
    },
    {
      message: "Use your mini map to find destinations",
      type: "glow-minimap",
      duration: 3000,
    },
    {
      message: "Nice! You are ready to explore",
      type: "state-message",
      duration: 2000,
    },
    {
      message: "Drive to the Gas Station ⛽",
      type: "checkpoint-goal",
      checkpointIndex: 0,
    },
    {
      message: "Drive to Downtown 🏙️",
      type: "checkpoint-goal",
      checkpointIndex: 1,
    },
    {
      message: "Drive to the Waterfront 🌉 ",
      type: "checkpoint-goal",
      checkpointIndex: 2,
    },
    {
      message: "Drive to Green Hills 🏔️",
      type: "checkpoint-goal",
      checkpointIndex: 3,
    },
    {
      message: "Drive to Rocky Hills 🌲",
      type: "checkpoint-goal",
      checkpointIndex: 4,
    },
    {
      message: "Now you know you way around\nin the Euthymia state!",
      type: "state-message",
      duration: 3000,
    },
    {
      message: "You will experience episodes\nthat affect your driving.",
      type: "state-message",
      duration: 2000,
    },
    {
      message: "Now you are experiencing \na Depressive episode",
      type: "state-message",
      duration: 5000,
    },
    {
      message: "Now you are experiencing \na Manic episode",
      type: "state-message",
      duration: 5000,
    },
    {
      message: "Affect by motion sickness?\nPress M to toggle minimap rotation",
      type: "state-message",
      duration: 5000,
    },
  ],
};
