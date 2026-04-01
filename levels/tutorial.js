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
      message: "Your mission bar is on the top right",
      type: "glow-mission",
      duration: 3000,
    },
    {
      message:
        "Nice! You are ready to explore the city!\nYou are currently in Euthymia",
      type: "state-message",
      duration: 10000,
    },
    {
      message: "Now you are experiencing a Depressive episode",
      type: "state-message",
      duration: 15000,
    },
    {
      message: "Now you are experiencing a Manic episode",
      type: "state-message",
      duration: 15000,
    },
  ],
};
