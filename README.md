# A Mind in Motion

A 3D driving game that simulates the subjective experience of bipolar disorder through dynamic gameplay mechanics, visual effects, and environmental changes.

## About

**A Mind in Motion** uses an interactive 3D environment to represent different mood states and episodes experienced by people with bipolar disorder (BPD). By driving through a procedurally-generated world, players experience how mood fluctuations affect perception, motor control, and spatial awareness.

### Core Concept

The game explores three mental states:
- **Euthymia**: A balanced, stable mood state (normal driving conditions)
- **Depressive Episodes**: Low mood, reduced motivation, limited awareness (slow movement, fog-of-war minimap, disorienting visuals)
- **Manic Episodes**: Elevated mood, heightened perception, increased energy (enhanced visuals, faster movement)

## Features

✨ **Dynamic Episode System**
- Unpredictable depressive episodes during Level 1 with randomized durations (2-6 seconds each)
- Maximum 3-second gaps between episodes to simulate relentless mood cycling
- Real-time visual feedback reflecting mood changes

🎮 **Three Progressive Levels**
- **Tutorial**: Learn the basics with guided instructions and state transitions
- **Level 1**: Navigate with unpredictable depressive episodes (1 checkpoint)
- **Level 2**: Handle multiple objectives (2 checkpoints)
- **Level 3**: Complete complex route (3 checkpoints)

🗺️ **Adaptive Minimap**
- Normal mode: Full map visibility with all zones and roads visible
- Depressive mode: Fog-of-war discovery system - only see areas you've explored within a circular visibility radius
- Permanent exploration trail to track discovered areas

👁️ **Visual State Indicators**
- **Sky Color**: Changes with mood (bright blue in euthymia, dark night blue in depression)
- **Camera FOV**: Widens during depressive episodes (95°) for disorientation
- **Fisheye Distortion**: Creates dreamlike visual warping
- **Camera Shake**: Simulates instability and anxiety
- **Speed Modulation**: 40% normal speed during depression vs. normal speed in euthymia

⏱️ **Mission Structure**
- 30-second time limit per level
- Dynamic checkpoint system with different numbers per level
- Real-time countdown timer with visual warnings
- Retry and level-select options on timeout

## How to Play

### Starting the Game
1. Open `index.html` in a modern web browser
2. Click "START DRIVING" to begin the tutorial
3. Press backtick (`` ` ``) to toggle between levels during gameplay

### Controls
| Input | Action |
|-------|--------|
| **W / Up Arrow** | Move forward |
| **A / Left Arrow** | Turn left |
| **S / Down Arrow** | Move backward |
| **D / Right Arrow** | Turn right |
| **Shift** | Speed boost |
| **R** | Reset current level |
| **Backtick `` ` ``** | Toggle difficulty/levels |

### Objectives
- Drive to each checkpoint marker (green pulsing ring on minimap)
- Avoid running out of time (30-second limit)
- During depressive episodes, rely on your exploration to navigate fog-of-war

## Game Mechanics

### Episode System
Episodes occur unpredictably throughout Level 1 to simulate authentic BPD experiences:
- **3 episodes guaranteed** per Level 1 playthrough
- **Variable duration**: Each episode lasts 2-6 seconds
- **Rapid cycling**: Episodes occur at most 3 seconds apart
- **Full sensory disruption**: Visual, audio, and gameplay changes during episodes

### Checkpoint Progression
- **Level 1**: 1 checkpoint (learn basic navigation)
- **Level 2**: 2 checkpoints (increased complexity)
- **Level 3**: 3 checkpoints (full difficulty)

### Time Pressure
- All levels have a 30-second timer
- Timer turns red and flashes at 10 seconds remaining
- Timeout options: Retry level or go back to previous level

### Fog-of-War Discovery (Depressive Mode)
During depressive episodes, the minimap switches to fog-of-war:
- Only visible areas within a circular radius around your car
- Explored zones and roads remain semi-transparent outside visibility radius
- Encourages careful, slower navigation
- Simulates reduced spatial awareness during depression

## Technical Details

### Tech Stack
- **Three.js**: 3D graphics rendering
- **WebGL**: GPU-accelerated graphics
- **Canvas 2D**: Minimap rendering
- **Vanilla JavaScript**: Game logic and controls

### File Structure
```
├── index.html              # Main HTML entry point
├── sketch.js               # Core game engine (2500+ lines)
├── style.css               # UI styling and animations
└── levels/                 # Level configurations
    ├── tutorial.js         # Tutorial level
    ├── level1.js           # Main level with episodes
    ├── level2.js           # Second level
    ├── level3.js           # Third level
    ├── depressive.js       # Depressive state config
    ├── manic.js            # Manic state config
    └── euthymia.js         # Normal state config
```

### Browser Requirements
- Modern browser with WebGL support (Chrome, Firefox, Safari, Edge)
- ~250KB+ available memory for 3D scene
- Hardware acceleration recommended

## Running Locally

### Quick Start
```bash
# Navigate to the project directory
cd A3_Group1B_FinalGame

# Start a local HTTP server (Python 3)
python3 -m http.server 8000

# Open in browser
open http://localhost:8000
```

For Python 2:
```bash
python -m SimpleHTTPServer 8000
```

Or use any other HTTP server (Node `http-server`, PHP built-in server, etc.)

## Development

### Console Debugging
Open browser DevTools (F12) to see:
- Episode schedule generation logs
- Episode entry/exit timing
- Minimap state transitions
- Performance metrics

### Key Game Variables
- `currentEpisode`: Current mood state ("depressive", "manic", "euthymia")
- `level1EpisodeSchedule`: Array of episode start times (ms)
- `level1EpisodeDurations`: Array of per-episode durations (ms)
- `missionElapsed`: Current level time in seconds
- `LEVEL1`, `LEVEL2`, `LEVEL3`: Level configuration objects

## Educational Value

This game serves as:
- **Patient Education**: Helps people with BPD understand their own experiences
- **Caregiver Tool**: Provides insight into what depressive/manic episodes feel like
- **Clinical Reference**: Demonstrates cognitive and perceptual symptoms
- **Research Tool**: Gamifies mood state simulation for study

## Contributors

Group 1B - CMPT 404 Final Project

## License

Educational use only

## Acknowledgments

Built with [Three.js](https://threejs.org/) - A JavaScript 3D library

---

**Trigger Warning**: This game simulates mental health conditions including depression. If you or someone you know is struggling with bipolar disorder or depression, please reach out to a mental health professional or crisis hotline.
