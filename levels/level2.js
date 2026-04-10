// =============================================================================
// levels/level2.js — Level 2 Definition
// =============================================================================
// Level 2 of the game. Currently identical to Level 1,
// but can be customized with different checkpoints or world modifications.
// =============================================================================

const LEVEL2 = {
  name: "level2",
  displayName: "LEVEL 2",
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
  ],
  // Manic episode configuration for Level 2
  episodeCount: 2, // 2 unpredictable manic episodes
  episodeDurationMin: 7000, // 7 seconds minimum per episode
  episodeDurationMax: 15000, // 15 seconds maximum per episode
};
