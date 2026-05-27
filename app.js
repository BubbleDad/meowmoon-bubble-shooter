(() => {
  "use strict";

  /***************************************************************************
   * Meowmoon Bowling v1.1
   * Eleventh playable browser/PWA prototype: removes maze levels and adds sports-action special pin animations.
   * Design: no choices, no score, no frames, no losing, no ads, no timers.
   **************************************************************************/

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const TAU = Math.PI * 2;
  const TITLE_HOLD_MS = 1450;
  const TITLE_FADE_MS = 850;
  const LEVEL_REWARD_MS = 1550;
  const NEXT_LEVEL_DELAY_MS = 550;
  const LONG_PRESS_MS = 3000;
  const AUTO_PAUSE_GRACE_MS = 500;
  const ROTATING_TEXT_MS = 60000;
  const BALL_SPEED = 740; // CSS pixels per second; steady and not twitchy.
  const PIN_FADE_DELAY_MS = 220;
  const PIN_FADE_MS = 720;
  const MAX_ROLLS_PER_LEVEL = 8;
  const SPECIAL_PINS_PER_LEVEL = MAX_ROLLS_PER_LEVEL;
  const SPECIAL_BALLS_PER_LEVEL = 0;
  const PIN_SPECIAL_TYPES = ["rocket", "pinata", "pinatastar", "balloon", "firework", "jelly", "catpaw", "toytrain", "popcorn", "kite", "magicpaint", "flower", "racecar", "airplane", "helicopter", "bus", "bulldozer", "bunny", "frog", "bird", "dogzoomies", "batbaseball", "basketballdribble", "basketballhoop", "hockeypuck", "curling", "footballthrow", "soccergoal", "tennisserve", "golfdrive", "volleyballspike", "baseballcatch", "bowlingstrike", "skijump", "gymnasticsflip"];
  const BALL_SPECIAL_TYPES = [];
  const SPECIAL_TYPES = PIN_SPECIAL_TYPES;
  const SFX_GAIN = 4.1;


  const ROTATING_STATUS_TEXTS = [
    "Press cat for 3 seconds to pause game",
    "Music: Jesu, Joy of Mans Desiring by Bach",
    "Meowmoon loves to play with you"
  ];

  const view = { w: 720, h: 1080, dpr: 1 };
  const layout = {
    unit: 36,
    radius: 30,
    topBand: 92,
    playTop: 126,
    playBottom: 810,
    wallLeft: 32,
    wallRight: 688,
    rollerX: 360,
    rollerY: 982,
    ballR: 30,
    pinH: 62,
    pinW: 26,
    catX: 255,
    catY: 986,
    textX: 484,
    textY: 884,
    textW: 205,
    textH: 150,
    statusX: 470,
    statusY: 946,
    statusW: 210,
    statusH: 92,
    launcherZoneTop: 832
  };

  const game = {
    level: 0,
    pins: [],
    ball: null,
    pathPreview: [],
    titleStartedAt: performance.now(),
    introDismissed: false,
    phase: "title", // title, playing, rolling, resolving, reward, paused
    previousPhase: "playing",
    rewardStartedAt: 0,
    nextLevelAt: 0,
    resolvingUntil: 0,
    forceHitNext: false,
    hold: null,
    pauseTimer: null,
    pausedAt: 0,
    messageIndex: 0,
    message: "Hi there, bowler! Tap anywhere to roll.",
    particles: [],
    nextBallSeed: 0,
    rollsThisLevel: 0,
    specialBallMap: {},
    remainingSpecialPins: 0,
    bounceBursts: [],
    pinSpecialQueue: []
  };

  const messages = [
    "Hi there, bowler!\nTap anywhere to roll.",
    "Great roll!\nEvery roll helps.",
    "You can bounce\noff the sides!",
    "Meowmoon is cheering\nfor you!",
    "Knock down the pins\none roll at a time.",
    "Nice bowling!\nYou've got this!"
  ];

  const audio = {
    context: null,
    musicAudio: null,
    usingFileMusic: false,
    synthMusicTimer: null,
    synthNoteIndex: 0,
    nextNoteAt: 0,
    rollNoise: null,
    rollGain: null,
    rocketNoise: null,
    rocketGain: null,
    isStarted: false,
    isMutedByPause: false,
    pattern: [
      392.00, 440.00, 493.88, 523.25, 587.33, 523.25, 493.88, 440.00,
      392.00, 493.88, 587.33, 659.25, 587.33, 523.25, 493.88, 440.00
    ],

    async start() {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.context = new AudioContext();
      }
      if (this.context && this.context.state === "suspended") {
        this.context.resume().catch(() => {});
      }
      this.isStarted = true;
      this.isMutedByPause = false;
      await this.startMusic();
    },

    async startMusic() {
      if (this.isMutedByPause) return;
      if (!this.musicAudio) {
        this.musicAudio = document.getElementById("bachMusic") || new Audio("audio/jesu-joy-piano-loop.mp3");
        this.musicAudio.loop = true;
        this.musicAudio.volume = 0.42;
        this.musicAudio.muted = false;
        this.musicAudio.setAttribute("playsinline", "");
        this.musicAudio.setAttribute("webkit-playsinline", "");
        this.musicAudio.preload = "auto";
      }
      try {
        await this.musicAudio.play();
        this.usingFileMusic = true;
      } catch (err) {
        this.usingFileMusic = false;
      }
    },

    pauseMusic() {
      this.isMutedByPause = true;
      if (this.musicAudio) this.musicAudio.pause();
      this.stopRolling();
      this.stopRocketFlight();
    },

    resumeMusic() {
      this.isMutedByPause = false;
      if (!this.isStarted) return;
      this.startMusic();
    },

    startSynthMusic() {
      if (!this.context || this.synthMusicTimer) return;
      this.synthNoteIndex = 0;
      this.nextNoteAt = this.context.currentTime + 0.03;
      this.scheduleSynthMusic();
      this.synthMusicTimer = window.setInterval(() => this.scheduleSynthMusic(), 260);
    },

    stopSynthMusic() {
      if (this.synthMusicTimer) {
        window.clearInterval(this.synthMusicTimer);
        this.synthMusicTimer = null;
      }
    },

    scheduleSynthMusic() {
      if (!this.context || this.isMutedByPause) return;
      const horizon = this.context.currentTime + 1.1;
      while (this.nextNoteAt < horizon) {
        const freq = this.pattern[this.synthNoteIndex % this.pattern.length];
        this.playTone(freq, this.nextNoteAt, 0.34, 0.055, "triangle", 1200);
        if (this.synthNoteIndex % 4 === 0) {
          this.playTone(freq / 2, this.nextNoteAt, 0.48, 0.035, "sine", 700);
        }
        this.synthNoteIndex += 1;
        this.nextNoteAt += 0.31;
      }
    },

    playTone(freq, at, duration, gainValue, type = "sine", filterFreq = 2000) {
      if (!this.context) return;
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      const filter = this.context.createBiquadFilter();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, at);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.992), at + duration);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(filterFreq, at);
      const effectiveGain = Math.min(0.62, Math.max(0.0001, gainValue * SFX_GAIN));
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(effectiveGain, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.context.destination);
      osc.start(at);
      osc.stop(at + duration + 0.04);
    },

    startRolling() {
      if (!this.context || this.isMutedByPause || this.rollNoise) return;
      const bufferSize = 2 * this.context.sampleRate;
      const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) {
        const t = i / this.context.sampleRate;
        // Soft granular rumble, deliberately non-comedic.
        data[i] = (Math.random() * 2 - 1) * 0.24 * (0.65 + 0.35 * Math.sin(t * 68));
      }
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 210;
      const gain = this.context.createGain();
      gain.gain.value = 0.038;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.context.destination);
      source.start();
      this.rollNoise = source;
      this.rollGain = gain;
    },

    stopRolling() {
      if (!this.rollNoise) return;
      try { this.rollNoise.stop(); } catch (err) {}
      this.rollNoise = null;
      this.rollGain = null;
    },

    rocketLaunch() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(110, now, 0.18, 0.12, "sawtooth", 900);
      this.playTone(260, now + 0.035, 0.22, 0.075, "triangle", 1400);
      this.startRocketFlight();
    },

    startRocketFlight() {
      if (!this.context || this.isMutedByPause || this.rocketNoise) return;
      const bufferSize = Math.floor(this.context.sampleRate * 1.1);
      const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) {
        const t = i / this.context.sampleRate;
        data[i] = (Math.random() * 2 - 1) * 0.34 * (0.75 + 0.25 * Math.sin(t * 150));
      }
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 860;
      filter.Q.value = 0.8;
      const gain = this.context.createGain();
      gain.gain.value = 0.11;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.context.destination);
      source.start();
      this.rocketNoise = source;
      this.rocketGain = gain;
    },

    stopRocketFlight() {
      if (!this.rocketNoise) return;
      try { this.rocketNoise.stop(); } catch (err) {}
      this.rocketNoise = null;
      this.rocketGain = null;
    },

    rocketBurst() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(90, now, 0.18, 0.13, "sawtooth", 650);
      this.playTone(180, now + 0.025, 0.20, 0.09, "square", 850);
      [523.25, 659.25, 783.99, 987.77, 1174.66].forEach((f, i) => {
        this.playTone(f, now + 0.06 + i * 0.025, 0.28, 0.055, "triangle", 1900);
      });
    },

    pinataBurst() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(180, now, 0.14, 0.10, "square", 800);
      this.playTone(260, now + 0.03, 0.18, 0.08, "triangle", 1400);
      this.playTone(720, now + 0.07, 0.22, 0.045, "triangle", 2200);
    },

    balloonInflate() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(220, now, 0.22, 0.05, "sine", 1200);
      this.playTone(300, now + 0.08, 0.24, 0.04, "triangle", 1500);
    },

    balloonPop() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(480, now, 0.08, 0.07, "square", 2000);
      this.playTone(860, now + 0.015, 0.12, 0.04, "triangle", 2400);
    },

    fireworkLaunch() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(140, now, 0.12, 0.10, "sawtooth", 1000);
      this.playTone(220, now + 0.03, 0.18, 0.08, "triangle", 1400);
      this.startRocketFlight();
    },

    fireworkBurst() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      [520, 650, 820, 1040, 1300].forEach((f, i) => this.playTone(f, now + i * 0.02, 0.24, 0.055, "triangle", 2400));
      this.playTone(120, now, 0.16, 0.12, "square", 900);
    },

    jellyWobble() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(190, now, 0.20, 0.05, "sine", 700);
      this.playTone(150, now + 0.12, 0.24, 0.05, "triangle", 900);
    },

    jellyMelt() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(300, now, 0.20, 0.04, "triangle", 1200);
      this.playTone(180, now + 0.06, 0.26, 0.05, "sine", 800);
    },

    catPawSwipe() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(240, now, 0.14, 0.06, "triangle", 1200);
      this.playTone(160, now + 0.04, 0.10, 0.06, "square", 900);
    },

    catPawBop() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(180, now, 0.10, 0.09, "square", 850);
      this.playTone(520, now + 0.02, 0.16, 0.04, "triangle", 1700);
    },

    treasureOpen() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(140, now, 0.14, 0.11, "square", 700);
      this.playTone(260, now + 0.06, 0.18, 0.075, "triangle", 1300);
      this.playTone(620, now + 0.12, 0.22, 0.055, "triangle", 2200);
    },

    treasureSparkle() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      [660, 880, 1100, 1320].forEach((f, i) => this.playTone(f, now + i * 0.035, 0.18, 0.065, "triangle", 2600));
    },

    toyTrainStart() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(180, now, 0.12, 0.09, "square", 900);
      this.playTone(240, now + 0.12, 0.12, 0.08, "square", 900);
      this.playTone(980, now + 0.24, 0.18, 0.055, "triangle", 2200);
    },

    toyTrainChug() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(150, now, 0.10, 0.075, "square", 650);
      this.playTone(210, now + 0.035, 0.10, 0.055, "triangle", 900);
    },

    popcornCluster() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      [360, 520, 440, 680, 580, 760].forEach((f, i) => this.playTone(f, now + i * 0.035, 0.08, 0.075, "square", 1800));
    },

    kiteWhoosh() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(260, now, 0.26, 0.065, "sine", 1100);
      this.playTone(420, now + 0.10, 0.30, 0.055, "triangle", 1600);
      this.playTone(620, now + 0.22, 0.24, 0.045, "triangle", 1900);
    },

    brushSwish() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(320, now, 0.10, 0.065, "triangle", 1200);
      this.playTone(720, now + 0.05, 0.18, 0.060, "triangle", 2400);
    },

    paintSplash() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(190, now, 0.14, 0.10, "square", 800);
      [440, 560, 700].forEach((f, i) => this.playTone(f, now + 0.05 + i * 0.035, 0.16, 0.060, "triangle", 1900));
    },

    flowerBloom() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.playTone(f, now + i * 0.045, 0.24, 0.060, "triangle", 2200));
    },

    raceCarRev() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(120, now, 0.14, 0.12, "sawtooth", 800);
      this.playTone(180, now + 0.04, 0.18, 0.10, "sawtooth", 1100);
      this.playTone(280, now + 0.09, 0.22, 0.08, "square", 1400);
    },

    raceCarSkid() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(320, now, 0.08, 0.09, "square", 1600);
      this.playTone(210, now + 0.02, 0.10, 0.09, "triangle", 1200);
    },

    airplaneTakeoff() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(180, now, 0.18, 0.10, "sawtooth", 900);
      this.playTone(260, now + 0.06, 0.26, 0.09, "triangle", 1400);
      this.playTone(420, now + 0.14, 0.30, 0.07, "triangle", 1800);
    },

    airplanePass() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(560, now, 0.16, 0.07, "triangle", 1900);
      this.playTone(760, now + 0.04, 0.18, 0.06, "triangle", 2200);
    },

    helicopterStart() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(140, now, 0.12, 0.11, "square", 700);
      this.playTone(190, now + 0.04, 0.12, 0.10, "square", 850);
      this.playTone(240, now + 0.08, 0.14, 0.09, "square", 1000);
    },

    helicopterChop() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(180, now, 0.06, 0.09, "square", 900);
      this.playTone(220, now + 0.03, 0.06, 0.07, "square", 1100);
    },

    busHorn() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(220, now, 0.16, 0.12, "square", 1000);
      this.playTone(330, now + 0.04, 0.16, 0.10, "triangle", 1300);
    },

    busDrive() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(140, now, 0.10, 0.08, "square", 650);
      this.playTone(180, now + 0.03, 0.10, 0.06, "triangle", 900);
    },

    bulldozerRumble() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(90, now, 0.16, 0.13, "sawtooth", 500);
      this.playTone(130, now + 0.04, 0.18, 0.10, "square", 700);
    },

    bulldozerClank() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(220, now, 0.08, 0.10, "square", 1300);
      this.playTone(440, now + 0.025, 0.12, 0.06, "triangle", 2200);
    },

    bunnyHop() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(420, now, 0.10, 0.07, "triangle", 1600);
      this.playTone(620, now + 0.05, 0.12, 0.05, "triangle", 2200);
    },

    frogBoing() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(180, now, 0.12, 0.10, "square", 700);
      this.playTone(260, now + 0.06, 0.16, 0.07, "triangle", 1100);
    },

    fishBlub() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(240, now, 0.08, 0.06, "sine", 900);
      this.playTone(320, now + 0.04, 0.10, 0.05, "triangle", 1300);
    },

    birdChirp() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(760, now, 0.08, 0.05, "triangle", 2400);
      this.playTone(980, now + 0.03, 0.10, 0.04, "triangle", 2800);
    },

    penguinSlide() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(220, now, 0.10, 0.08, "sine", 800);
      this.playTone(340, now + 0.05, 0.12, 0.06, "triangle", 1300);
    },

    dogZoomies() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      this.playTone(360, now, 0.08, 0.08, "square", 1400);
      this.playTone(520, now + 0.035, 0.10, 0.06, "triangle", 1900);
      this.playTone(300, now + 0.09, 0.08, 0.07, "square", 1200);
    },

    hitPins(count = 1) {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      const hits = Math.min(8, Math.max(1, count));
      for (let i = 0; i < hits; i += 1) {
        this.playTone(150 + i * 24, now + i * 0.025, 0.18, 0.08, "square", 600);
        this.playTone(420 + i * 30, now + i * 0.032, 0.12, 0.035, "triangle", 1600);
      }
    },

    pinFall(count = 1) {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime + 0.06;
      const falls = Math.min(6, Math.max(1, count));
      for (let i = 0; i < falls; i += 1) {
        this.playTone(260 - i * 14, now + i * 0.055, 0.16, 0.045, "sawtooth", 900);
      }
    },

    reward() {
      if (!this.context || this.isMutedByPause) return;
      const now = this.context.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.playTone(f, now + i * 0.085, 0.34, 0.085, "triangle", 1800));
    }
  };

  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const nowMs = () => performance.now();

  function normalizeAngle(angle) {
    while (angle <= -Math.PI) angle += TAU;
    while (angle > Math.PI) angle -= TAU;
    return angle;
  }

  function angleDistance(a, b) {
    return Math.abs(normalizeAngle(a - b));
  }

  function resize() {
    view.dpr = Math.max(1, Math.min(2.4, window.devicePixelRatio || 1));
    view.w = Math.max(320, window.innerWidth || 720);
    view.h = Math.max(480, window.innerHeight || 1080);
    canvas.width = Math.floor(view.w * view.dpr);
    canvas.height = Math.floor(view.h * view.dpr);
    canvas.style.width = `${view.w}px`;
    canvas.style.height = `${view.h}px`;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    computeLayout();
  }

  function computeLayout() {
    layout.unit = clamp(Math.min(view.w / 15.8, view.h / 26.0), 22, 42);
    layout.topBand = clamp(view.h * 0.085, 60, 104);
    layout.playTop = layout.topBand + layout.unit * 1.05;
    layout.rollerY = view.h - Math.max(54, view.h * 0.078);
    layout.rollerX = view.w * 0.50;
    layout.ballR = clamp(layout.unit * 0.86, 22, 34);
    layout.radius = layout.ballR;
    // v0.2: pins are doubled from v0.1's 44-70px height range to 88-140px.
    layout.pinH = clamp(layout.unit * 3.36, 88, 140);
    layout.pinW = layout.pinH * 0.43;
    layout.launcherZoneTop = layout.rollerY - layout.unit * 4.65;
    layout.playBottom = layout.launcherZoneTop - layout.unit * 0.25;
    layout.wallLeft = layout.ballR + 8;
    layout.wallRight = view.w - layout.ballR - 8;

    // Same relative mascot placement as Bubble Shooter v0.9 snippets: launcherX - radius*3.15.
    layout.catX = layout.rollerX - layout.ballR * 3.15;
    layout.catY = layout.rollerY + layout.ballR * 0.12;

    // Same text/status box placement formula as Bubble Shooter v0.9, with the bowling roller as the launcher reference.
    layout.statusX = layout.rollerX + layout.radius * 1.75;
    layout.statusY = layout.rollerY - layout.radius * 0.85;
    layout.statusW = Math.max(layout.radius * 2.45, view.w - layout.statusX - Math.max(12, view.w * 0.025));
    layout.statusH = layout.radius * 1.85;
    layout.textX = layout.statusX;
    layout.textY = layout.statusY;
    layout.textW = layout.statusW;
    layout.textH = layout.statusH;
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(resize, 150), { passive: true });

  function startLevel() {
    game.level += 1;
    game.pins = [];
    game.ball = null;
    game.pathPreview = [];
    game.phase = game.level === 1 && !game.introDismissed ? "title" : "playing";
    game.forceHitNext = false;
    game.particles = [];
    game.rollsThisLevel = 0;
    game.specialBallMap = {};
    game.remainingSpecialPins = 0;
    game.bounceBursts = [];
    game.pinSpecialQueue = shuffled(PIN_SPECIAL_TYPES);
    game.messageIndex = (game.level - 1) % messages.length;
    game.message = messages[game.messageIndex];
    if (game.level === 1 && !game.introDismissed) game.titleStartedAt = nowMs();
    generatePins();
    assignSpecialPins();
    assignSpecialBalls();
  }

  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = randInt(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function nextPinSpecialType() {
    if (!game.pinSpecialQueue || !game.pinSpecialQueue.length) game.pinSpecialQueue = shuffled(PIN_SPECIAL_TYPES);
    return game.pinSpecialQueue.shift();
  }

  function assignSpecialPins() {
    game.pins.forEach(pin => {
      pin.specialType = nextPinSpecialType();
      pin.specialTriggered = false;
    });
    game.remainingSpecialPins = game.pins.length;
  }

  function assignSpecialBalls() {
    game.specialBallMap = {};
  }

  function generatePins() {
    const count = randInt(16, 24);
    const minSep = layout.pinH * 0.70;
    const left = layout.wallLeft + layout.pinW * 0.45;
    const right = layout.wallRight - layout.pinW * 0.45;
    const top = layout.playTop + layout.pinH * 0.35;
    const bottom = Math.max(top + 160, layout.playBottom - layout.pinH * 0.35);

    const anchors = [];
    const groupCount = randInt(7, 10);
    for (let i = 0; i < groupCount; i += 1) {
      anchors.push({ x: rand(left, right), y: rand(top, bottom) });
    }

    let attempts = 0;
    while (game.pins.length < count && attempts < 1500) {
      attempts += 1;
      const group = anchors[randInt(0, anchors.length - 1)];
      const mode = Math.random();
      let x = group.x + rand(-layout.pinH * 1.15, layout.pinH * 1.15);
      let y = group.y + rand(-layout.pinH * 0.90, layout.pinH * 0.90);
      if (mode < 0.22) {
        x = rand(left, right);
        y = rand(top, bottom);
      }
      x = clamp(x, left, right);
      y = clamp(y, top, bottom);

      const candidate = { x, y };
      const tooClose = game.pins.some(p => Math.hypot(p.x - x, p.y - y) < minSep * rand(0.82, 1.26));
      if (tooClose) continue;
      game.pins.push(createPin(x, y, game.pins.length));
    }

    // If the device is small and spacing prevented enough pins, fill with looser spacing.
    attempts = 0;
    while (game.pins.length < count && attempts < 1000) {
      attempts += 1;
      const x = rand(left, right);
      const y = rand(top, bottom);
      const tooClose = game.pins.some(p => Math.hypot(p.x - x, p.y - y) < minSep * 0.58);
      if (!tooClose) game.pins.push(createPin(x, y, game.pins.length));
    }
  }

  function createPin(x, y, index) {
    return {
      id: `p${game.level}-${index}-${Math.random().toString(16).slice(2)}`,
      x,
      y,
      baseX: x,
      baseY: y,
      vx: 0,
      vy: 0,
      angle: rand(-0.025, 0.025),
      angularVelocity: 0,
      wobble: rand(0, TAU),
      fallen: false,
      falling: false,
      hitAt: 0,
      chainDepth: 0,
      scale: rand(0.94, 1.08),
      fading: false,
      fadeStartAt: 0,
      removed: false,
      rocket: null,
      specialType: null,
      specialTriggered: false
    };
  }

  function currentTitleAlpha(current) {
    return game.introDismissed ? 0 : 1;
  }

  function pointerToGame(evt) {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function pointInCat(p) {
    const s = layout.ballR * 0.84;
    return Math.hypot(p.x - layout.catX, p.y - (layout.catY - s * 0.26)) < s * 1.55;
  }

  function onPointerDown(evt) {
    evt.preventDefault();
    const p = pointerToGame(evt);

    if (game.phase === "paused") {
      resumeFromPause();
      return;
    }

    if (pointInCat(p)) {
      beginCatHold(p, evt.pointerId);
      return;
    }

    if (game.phase === "title") {
      game.introDismissed = true;
      game.phase = "playing";
      audio.start();
      fireBall(p);
      return;
    }

    if (game.phase !== "playing" || game.ball) return;

    audio.start();
    fireBall(p);
  }

  function onPointerMove(evt) {
    if (!game.hold) return;
    const p = pointerToGame(evt);
    if (!pointInCat(p)) cancelCatHold();
  }

  function onPointerUp(evt) {
    if (game.hold && game.hold.pointerId === evt.pointerId) cancelCatHold();
  }

  function beginCatHold(p, pointerId) {
    cancelCatHold();
    game.hold = { startedAt: nowMs(), pointerId };
    game.hold.timer = window.setTimeout(() => {
      game.hold = null;
      pauseGame("Meowmoon pause");
    }, LONG_PRESS_MS);
  }

  function cancelCatHold() {
    if (!game.hold) return;
    if (game.hold.timer) window.clearTimeout(game.hold.timer);
    game.hold = null;
  }

  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove, { passive: false });
  canvas.addEventListener("pointerup", onPointerUp, { passive: false });
  canvas.addEventListener("pointercancel", onPointerUp, { passive: false });

  function scheduleAutoPause() {
    if (game.phase === "paused") return;
    if (game.pauseTimer) window.clearTimeout(game.pauseTimer);
    game.pauseTimer = window.setTimeout(() => pauseGame("automatic pause"), AUTO_PAUSE_GRACE_MS);
  }

  function clearAutoPause() {
    if (game.pauseTimer) window.clearTimeout(game.pauseTimer);
    game.pauseTimer = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) scheduleAutoPause();
    else clearAutoPause();
  });
  window.addEventListener("blur", scheduleAutoPause, { passive: true });
  window.addEventListener("focus", clearAutoPause, { passive: true });
  window.addEventListener("pagehide", scheduleAutoPause, { passive: true });

  function pauseGame(reason) {
    if (game.phase === "paused") return;
    clearAutoPause();
    cancelCatHold();
    game.previousPhase = game.phase === "title" ? "playing" : game.phase;
    game.phase = "paused";
    game.pausedAt = nowMs();
    audio.pauseMusic();
  }

  function resumeFromPause() {
    if (game.phase !== "paused") return;
    const pausedDuration = nowMs() - game.pausedAt;
    // Shift timers forward so animations do not jump.
    game.titleStartedAt += pausedDuration;
    game.rewardStartedAt += pausedDuration;
    game.nextLevelAt += pausedDuration;
    for (const p of game.particles) p.startedAt += pausedDuration;
    for (const pin of game.pins) {
      pin.hitAt += pausedDuration;
      if (pin.fadeStartAt) pin.fadeStartAt += pausedDuration;
      if (pin.rocket) {
        ["startedAt", "burstAt", "popAt", "meltAt", "swipeAt", "finishAt", "nextChug"].forEach(key => { if (pin.rocket[key]) pin.rocket[key] += pausedDuration; });
      }
    }
    game.phase = game.previousPhase || "playing";
    if (game.phase === "title") game.phase = "playing";
    audio.resumeMusic();
    if (game.ball) audio.startRolling();
    if (game.pins.some(pin => pin.rocket && !pin.removed && (pin.rocket.type === "rocket" || pin.rocket.type === "firework"))) audio.startRocketFlight();
  }

  function fireBall(tap) {
    const nextRoll = game.rollsThisLevel + 1;
    const targetInfo = chooseAssistedTarget(tap, nextRoll);
    if (!targetInfo) return;
    game.pathPreview = targetInfo.path;
    const specialType = null;
    game.rollsThisLevel = nextRoll;
    const ballRadius = layout.ballR;
    game.ball = {
      x: layout.rollerX,
      y: layout.rollerY - layout.ballR * 0.55,
      r: ballRadius,
      path: targetInfo.path,
      segment: 0,
      distanceOnSegment: 0,
      targetPinId: targetInfo.pin ? targetInfo.pin.id : null,
      guaranteed: targetInfo.guaranteed,
      spin: 0,
      missed: false,
      colorSeed: game.nextBallSeed++,
      specialType,
      trail: [],
      bounceCount: 0,
      squashUntil: 0,
      launchedAt: nowMs()
    };
    game.phase = "rolling";
    audio.startRolling();
  }

  function chooseAssistedTarget(tap, nextRoll = game.rollsThisLevel + 1) {
    const start = { x: layout.rollerX, y: layout.rollerY - layout.ballR * 0.55 };
    const uprightPins = game.pins.filter(p => !p.fallen && !p.falling && !p.rocket && !p.removed);
    if (!uprightPins.length) return null;

    const rawAngle = Math.atan2(tap.y - start.y, tap.x - start.x);
    const scored = [];

    for (const pin of uprightPins) {
      const aimPoint = { x: pin.x, y: pin.y + layout.pinH * 0.16 };
      const options = pathOptionsTo(start, aimPoint);
      for (const opt of options) {
        const targetCloseness = Math.hypot(tap.x - aimPoint.x, tap.y - aimPoint.y) / Math.max(320, view.h);
        const angleScore = angleDistance(rawAngle, opt.initialAngle);
        const nearEdgeBonus = (pin.x < view.w * 0.17 || pin.x > view.w * 0.83) && opt.bounce ? -0.04 : 0;
        const guaranteedBonus = (game.forceHitNext || nextRoll >= MAX_ROLLS_PER_LEVEL) ? -0.85 : 0;
        const clusterCount = uprightPins.filter(other => other !== pin && Math.hypot(other.x - pin.x, other.y - pin.y) < layout.pinH * 1.55).length;
        const specialBonus = pin.specialType ? -0.16 : 0;
        const score = angleScore + targetCloseness * 0.44 + (opt.bounce ? 0.055 : 0) + nearEdgeBonus + guaranteedBonus - clusterCount * 0.06 + specialBonus;
        scored.push({ pin, path: opt.points, score, guaranteed: (game.forceHitNext || nextRoll >= MAX_ROLLS_PER_LEVEL) });
      }
    }

    scored.sort((a, b) => a.score - b.score);
    const best = scored[0];

    // If the child clearly aims at empty sky and the previous roll was not a miss,
    // allow a gentle miss sometimes. The next roll is then forced to be a hit.
    const nearestPinDist = Math.min(...uprightPins.map(pin => Math.hypot(tap.x - pin.x, tap.y - pin.y)));
    const emptySkyTap = nearestPinDist > layout.pinH * 2.7 && !game.forceHitNext && nextRoll < MAX_ROLLS_PER_LEVEL;
    if (emptySkyTap && Math.random() < 0.10) {
      const missPath = missPathForTap(start, tap);
      return { pin: null, path: missPath, guaranteed: false };
    }

    return best;
  }

  function pathOptionsTo(start, point) {
    const options = [];
    const directAngle = Math.atan2(point.y - start.y, point.x - start.x);
    options.push({ points: [start, point], initialAngle: directAngle, bounce: false });

    const walls = [layout.wallLeft, layout.wallRight];
    for (const wallX of walls) {
      const mirrorX = wallX === layout.wallLeft ? (wallX * 2 - point.x) : (wallX * 2 - point.x);
      const mirror = { x: mirrorX, y: point.y };
      const denom = mirror.x - start.x;
      if (Math.abs(denom) < 1) continue;
      const t = (wallX - start.x) / denom;
      const bounceY = start.y + (mirror.y - start.y) * t;
      if (t > 0.06 && t < 0.94 && bounceY > layout.playTop - layout.pinH && bounceY < start.y - layout.ballR * 1.8) {
        const bounce = { x: wallX, y: bounceY };
        const initialAngle = Math.atan2(bounce.y - start.y, bounce.x - start.x);
        options.push({ points: [start, bounce, point], initialAngle, bounce: true });
      }
    }
    return options;
  }

  function missPathForTap(start, tap) {
    let angle = Math.atan2(tap.y - start.y, tap.x - start.x);
    // Keep shots generally upward.
    angle = clamp(angle, -Math.PI * 0.93, -Math.PI * 0.07);
    const end = projectedEdgePoint(start, angle);
    return [start, end];
  }

  function projectedEdgePoint(start, angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const candidates = [];
    if (dx < -0.001) candidates.push((layout.wallLeft - start.x) / dx);
    if (dx > 0.001) candidates.push((layout.wallRight - start.x) / dx);
    if (dy < -0.001) candidates.push((layout.playTop - layout.pinH * 1.2 - start.y) / dy);
    const t = Math.min(...candidates.filter(v => v > 20));
    return { x: start.x + dx * t, y: start.y + dy * t };
  }

  function update(current) {
    if (game.phase === "paused") return;
    const dt = clamp((current - lastFrame) / 1000, 0, 0.035);
    updateBall(dt);
    updatePins(current, dt);
    updateParticles(current, dt);
    updateReward(current);
  }

  function updateBall(dt) {
    if (!game.ball || game.phase !== "rolling") return;
    const ball = game.ball;
    ball.spin += dt * 7.5;
    const currentTime = nowMs();
    ball.trail.push({ x: ball.x, y: ball.y, at: currentTime });
    if (ball.trail.length > 28) ball.trail.shift();
    let remaining = BALL_SPEED * dt;

    while (remaining > 0 && ball.segment < ball.path.length - 1) {
      const a = ball.path[ball.segment];
      const b = ball.path[ball.segment + 1];
      const segmentLength = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const left = segmentLength - ball.distanceOnSegment;
      const step = Math.min(left, remaining);
      ball.distanceOnSegment += step;
      remaining -= step;
      const t = ball.distanceOnSegment / segmentLength;
      ball.x = lerp(a.x, b.x, t);
      ball.y = lerp(a.y, b.y, t);

      const hitPin = detectBallPinHit(ball);
      if (hitPin) {
        resolveBallHit(hitPin);
        return;
      }

      if (ball.distanceOnSegment >= segmentLength - 0.5) {
        if (ball.segment + 1 < ball.path.length - 1) {
          ball.bounceCount += 1;
          ball.squashUntil = currentTime + 180;
          if (ball.specialType === "superbounce") makeWallBounceBurst(b.x, b.y);
        }
        ball.segment += 1;
        ball.distanceOnSegment = 0;
        ball.x = b.x;
        ball.y = b.y;
      }
    }

    if (ball.segment >= ball.path.length - 1) {
      const target = ball.targetPinId ? game.pins.find(p => p.id === ball.targetPinId && !p.fallen && !p.falling) : null;
      const fallback = game.pins.filter(p => !p.fallen && !p.falling && !p.rocket && !p.removed).sort((a,b)=>Math.hypot(ball.x-a.x,ball.y-a.y)-Math.hypot(ball.x-b.x,ball.y-b.y))[0] || null;
      if ((target && ball.guaranteed) || (game.rollsThisLevel >= MAX_ROLLS_PER_LEVEL && fallback)) {
        resolveBallHit(target || fallback);
      } else {
        resolveMiss();
      }
    }
  }

  function detectBallPinHit(ball) {
    for (const pin of game.pins) {
      if (pin.fallen || pin.falling || pin.rocket || pin.removed) continue;
      const hitRadius = ball.r * 0.78 + layout.pinW * 0.62;
      const targetPoint = { x: pin.x, y: pin.y + layout.pinH * 0.10 };
      if (Math.hypot(ball.x - targetPoint.x, ball.y - targetPoint.y) <= hitRadius) return pin;
    }
    return null;
  }

  function resolveBallHit(pin) {
    audio.stopRolling();
    const ballSpecial = game.ball ? game.ball.specialType : null;
    const forceClearAll = game.rollsThisLevel >= MAX_ROLLS_PER_LEVEL;
    const knocked = knockPinsFrom(pin, ballSpecial, forceClearAll);
    const specialHit = knocked.some(p => p.rocket);
    game.ball = null;
    game.pathPreview = [];
    game.forceHitNext = false;
    game.phase = "resolving";
    game.message = messages[(++game.messageIndex) % messages.length];
    audio.hitPins(knocked.length);
    if (!specialHit) audio.pinFall(knocked.length);
    makeImpactParticles(pin.x, pin.y, knocked.length);
    if (ballSpecial === "meteor") makeMeteorImpact(pin.x, pin.y);
    if (ballSpecial === "giantbounce") makePinataBurst(pin.x, pin.y);
    const longestSpecial = knocked.reduce((m, p) => Math.max(m, p.rocket ? ((p.rocket.finishAt || (p.rocket.startedAt + p.rocket.duration)) - nowMs()) : 0), 0);
    game.resolvingUntil = nowMs() + (specialHit ? Math.max(700, longestSpecial + 160) : PIN_FADE_DELAY_MS + PIN_FADE_MS + 160);
  }

  function resolveMiss() {
    audio.stopRolling();
    game.ball = null;
    game.pathPreview = [];
    game.forceHitNext = true;
    game.phase = "playing";
    game.message = "Good try!\nThe next roll will help.";
  }

  function knockPinsFrom(firstPin, ballSpecial = null, forceClearAll = false) {
    const remainingBefore = remainingUprightCount();
    const knocked = [];
    const openingPower = ballSpecial === "giantbounce" ? 1.6 : ballSpecial === "meteor" ? 1.25 : 1;
    const queue = [{ pin: firstPin, depth: 0, power: openingPower }];
    const seen = new Set();
    const current = nowMs();

    while (queue.length) {
      const item = queue.shift();
      const pin = item.pin;
      if (!pin || seen.has(pin.id) || pin.fallen || pin.falling || pin.rocket || pin.removed) continue;
      seen.add(pin.id);
      if (item.depth === 0 && pin.specialType && !pin.specialTriggered) {
        launchSpecialPin(pin, current, pin.specialType);
        pin.specialTriggered = true;
        game.remainingSpecialPins = Math.max(0, game.remainingSpecialPins - 1);
        knocked.push(pin);
        if (ballSpecial === "giantbounce" || forceClearAll) {
          const extraNeighbors = game.pins.filter(p => !p.fallen && !p.falling && !p.rocket && !p.removed && !seen.has(p.id))
            .map(p => ({ pin: p, d: Math.hypot(p.x - pin.x, p.y - pin.y) }))
            .filter(o => o.d < layout.pinH * 1.9)
            .sort((a,b)=>a.d-b.d)
            .slice(0, 2);
          extraNeighbors.forEach(n => queue.push({ pin: n.pin, depth: 1, power: 0.95 }));
        }
        continue;
      }
      knockOnePin(pin, item.depth, item.power, current);
      knocked.push(pin);

      const neighbors = game.pins
        .filter(p => !p.fallen && !p.falling && !p.rocket && !p.removed && !seen.has(p.id))
        .map(p => ({ pin: p, d: Math.hypot(p.x - pin.x, p.y - pin.y) }))
        .filter(o => o.d < layout.pinH * (item.depth === 0 ? 1.45 : 1.15))
        .sort((a, b) => a.d - b.d);

      for (const n of neighbors) {
        const baseChance = item.depth === 0 ? 0.72 : 0.46;
        const distanceFactor = clamp(1 - n.d / (layout.pinH * 1.85), 0, 1);
        const chance = clamp(baseChance * (0.52 + distanceFactor) * item.power, 0, 0.95);
        if (Math.random() < chance) {
          queue.push({ pin: n.pin, depth: item.depth + 1, power: item.power * 0.80 });
        }
      }
    }

    if (ballSpecial === "giantbounce") {
      const extras = game.pins.filter(p => !p.fallen && !p.falling && !p.rocket && !p.removed && !seen.has(p.id))
        .sort((a,b)=>Math.hypot(a.x-firstPin.x,a.y-firstPin.y)-Math.hypot(b.x-firstPin.x,b.y-firstPin.y)).slice(0,2);
      extras.forEach(pin => { knockOnePin(pin, 1, 1.0, current); knocked.push(pin); seen.add(pin.id); });
    }

    if (forceClearAll) {
      for (const pin of game.pins) {
        if (seen.has(pin.id) || pin.fallen || pin.falling || pin.rocket || pin.removed) continue;
        if (pin.specialType && !pin.specialTriggered) {
          launchSpecialPin(pin, current, pin.specialType);
          pin.specialTriggered = true;
          game.remainingSpecialPins = Math.max(0, game.remainingSpecialPins - 1);
          knocked.push(pin);
        } else {
          knockOnePin(pin, 1, 1.05, current);
          knocked.push(pin);
        }
      }
    }

    return knocked;
  }

  function launchSpecialPin(pin, current, forcedType = null) {
    const type = forcedType || pin.specialType || PIN_SPECIAL_TYPES[randInt(0, PIN_SPECIAL_TYPES.length - 1)];
    pin.falling = false;
    pin.fallen = true;
    pin.fading = false;
    pin.fadeStartAt = 0;
    pin.vx = 0;
    pin.vy = 0;
    pin.angularVelocity = 0;
    const durationMap = { rocket: randInt(2400, 3200), pinata: randInt(1000, 1500), pinatastar: randInt(1100, 1600), balloon: randInt(1800, 2600), firework: randInt(1700, 2500), jelly: randInt(1200, 1900), catpaw: randInt(2400, 3300), treasure: randInt(1000, 1600), toytrain: randInt(1800, 2600), popcorn: randInt(900, 1400), kite: randInt(1800, 2600), magicpaint: randInt(1200, 1800), flower: randInt(1300, 2100), racecar: randInt(1600, 2400), airplane: randInt(2000, 2900), helicopter: randInt(2200, 3200), bus: randInt(1800, 2500), bulldozer: randInt(1900, 2700), bunny: randInt(1700, 2400), frog: randInt(1800, 2500), fish: randInt(1900, 2600), bird: randInt(1800, 2500), penguin: randInt(1900, 2600), dogzoomies: randInt(2100, 3000), batbaseball: randInt(1500, 2300), basketballdribble: randInt(1800, 2600), basketballhoop: randInt(1700, 2500), hockeypuck: randInt(1500, 2300), curling: randInt(2000, 2900), footballthrow: randInt(1700, 2500), soccergoal: randInt(1700, 2500), tennisserve: randInt(1500, 2300), golfdrive: randInt(1600, 2400), volleyballspike: randInt(1600, 2400), baseballcatch: randInt(1600, 2400), bowlingstrike: randInt(1700, 2500), skijump: randInt(1900, 2800), gymnasticsflip: randInt(1700, 2500) };
    const duration = durationMap[type];
    const exitSide = Math.random() < 0.5 ? -1 : 1;
    const exitX = exitSide < 0 ? -layout.pinH * 1.2 : view.w + layout.pinH * 1.2;
    const exitY = rand(layout.playTop + layout.pinH * 0.2, layout.playBottom - layout.pinH * 0.4);
    const variant = randInt(0, 9999);
    pin.rocket = {
      type, variant, startedAt: current, duration,
      burstAt: current + duration * rand(0.45, 0.82),
      popAt: current + duration * rand(0.70, 0.88),
      meltAt: current + duration * rand(0.62, 0.82),
      swipeAt: current + duration * rand(0.30, 0.52),
      finishAt: current + duration, burstDone: false, pawDone: false, popped: false,
      balloonColor: ["#ff6fae", "#7bdfff", "#ffe36d", "#9d7bff", "#63e38c"][randInt(0,4)],
      jellyColor: ["#ff88c2", "#8ee0ff", "#a7ff7d", "#ffe36d", "#b59aff"][randInt(0,4)],
      pawSide: Math.random() < 0.5 ? -1 : 1,
      petalColor: ["#ff7fb9", "#ffd75f", "#8ee0ff", "#c6a6ff", "#84e56d"][randInt(0,4)],
      paintColor: ["#ff4d6d", "#ffaa33", "#41d6ff", "#8a5cff", "#5fd36a"][randInt(0,4)],
      animalColor: ["#f6c36b", "#8be37e", "#66d4ff", "#ffd96b", "#9ab6ff", "#d69c6a"][randInt(0,5)],
      exit: { x: exitX, y: exitY },
      path: [
        { x: pin.x, y: pin.y },
        { x: rand(layout.wallLeft + layout.pinH * 0.4, layout.wallRight - layout.pinH * 0.4), y: rand(layout.playTop + layout.pinH * 0.2, layout.playBottom - layout.pinH * 0.8) },
        { x: rand(layout.wallLeft + layout.pinH * 0.4, layout.wallRight - layout.pinH * 0.4), y: rand(layout.playTop + layout.pinH * 0.2, layout.playBottom - layout.pinH * 0.8) },
        { x: exitX, y: exitY }
      ]
    };
    if (type === "firework") {
      const burstX = rand(layout.wallLeft + layout.pinH * 0.7, layout.wallRight - layout.pinH * 0.7);
      const burstY = rand(layout.playTop + layout.pinH * 0.25, layout.playTop + layout.pinH * 1.4);
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: lerp(pin.x, burstX, 0.35), y: lerp(pin.y, burstY, 0.55) }, { x: burstX, y: burstY }, { x: burstX, y: burstY - layout.pinH * 0.12 }];
      audio.fireworkLaunch();
    } else if (type === "rocket") {
      audio.rocketLaunch();
      makeRocketTrailParticles(pin.x, pin.y, 14);
    } else if (type === "pinata") {
      audio.pinataBurst();
    } else if (type === "pinatastar") {
      audio.pinataBurst();
    } else if (type === "balloon") {
      audio.balloonInflate();
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: pin.x + rand(-layout.pinH * 0.45, layout.pinH * 0.45), y: pin.y - layout.pinH * rand(1.2, 2.2) }, { x: pin.x + rand(-layout.pinH * 0.85, layout.pinH * 0.85), y: layout.playTop - layout.pinH * 0.4 }, { x: pin.x + rand(-layout.pinH, layout.pinH), y: -layout.pinH * 1.2 }];
    } else if (type === "jelly") {
      audio.jellyWobble();
    } else if (type === "catpaw") {
      audio.catPawSwipe();
      pin.rocket.exit = { x: exitSide < 0 ? -layout.pinH * 1.5 : view.w + layout.pinH * 1.5, y: pin.y + rand(-layout.pinH * 0.2, layout.pinH * 0.15) };
    } else if (type === "treasure") {
      audio.treasureOpen();
    } else if (type === "toytrain") {
      audio.toyTrainStart();
      pin.rocket.nextChug = current + 260;
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: layout.wallLeft + layout.pinH * 0.8, y: pin.y + rand(-layout.pinH * 0.2, layout.pinH * 0.2) }, { x: layout.wallRight - layout.pinH * 0.8, y: pin.y + rand(-layout.pinH * 0.25, layout.pinH * 0.25) }, { x: exitX, y: pin.y + rand(-layout.pinH * 0.3, layout.pinH * 0.3) }];
    } else if (type === "popcorn") {
      audio.popcornCluster();
    } else if (type === "kite") {
      audio.kiteWhoosh();
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: pin.x + rand(-layout.pinH * 0.8, layout.pinH * 0.8), y: pin.y - layout.pinH * 1.6 }, { x: pin.x + rand(-layout.pinH * 1.2, layout.pinH * 1.2), y: layout.playTop - layout.pinH * 0.1 }, { x: pin.x + rand(-layout.pinH * 1.4, layout.pinH * 1.4), y: -layout.pinH * 1.0 }];
    } else if (type === "magicpaint") {
      audio.brushSwish();
    } else if (type === "flower") {
      audio.flowerBloom();
    } else if (type === "racecar") {
      audio.raceCarRev();
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: layout.wallLeft + layout.pinH * 0.5, y: pin.y + rand(-layout.pinH * 0.18, layout.pinH * 0.18) }, { x: layout.wallRight - layout.pinH * 0.6, y: pin.y + rand(-layout.pinH * 0.22, layout.pinH * 0.22) }, { x: exitX, y: pin.y + rand(-layout.pinH * 0.18, layout.pinH * 0.18) }];
    } else if (type === "airplane") {
      audio.airplaneTakeoff();
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: pin.x + rand(-layout.pinH * 0.6, layout.pinH * 0.6), y: pin.y - layout.pinH * 1.2 }, { x: pin.x + rand(-layout.pinH * 1.4, layout.pinH * 1.4), y: layout.playTop + layout.pinH * 0.35 }, { x: exitX, y: layout.playTop - layout.pinH * 0.7 }];
    } else if (type === "helicopter") {
      audio.helicopterStart();
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: pin.x + rand(-layout.pinH * 0.7, layout.pinH * 0.7), y: pin.y - layout.pinH * 0.9 }, { x: rand(layout.wallLeft + layout.pinH * 0.6, layout.wallRight - layout.pinH * 0.6), y: rand(layout.playTop + layout.pinH * 0.6, layout.playTop + layout.pinH * 2.1) }, { x: exitX, y: rand(layout.playTop + layout.pinH * 0.2, layout.playTop + layout.pinH * 1.3) }];
    } else if (type === "bus") {
      audio.busHorn();
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: layout.wallLeft + layout.pinH * 0.55, y: pin.y + rand(-layout.pinH * 0.14, layout.pinH * 0.14) }, { x: layout.wallRight - layout.pinH * 0.55, y: pin.y + rand(-layout.pinH * 0.14, layout.pinH * 0.14) }, { x: exitX, y: pin.y + rand(-layout.pinH * 0.18, layout.pinH * 0.18) }];
    } else if (type === "bulldozer") {
      audio.bulldozerRumble();
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: layout.wallLeft + layout.pinH * 0.5, y: pin.y + rand(-layout.pinH * 0.16, layout.pinH * 0.16) }, { x: layout.wallRight - layout.pinH * 0.6, y: pin.y + rand(-layout.pinH * 0.16, layout.pinH * 0.16) }, { x: exitX, y: pin.y + rand(-layout.pinH * 0.12, layout.pinH * 0.12) }];
    } else if (type === "bunny") {
      audio.bunnyHop();
      pin.rocket.nextChug = current + 320;
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: pin.x + rand(-layout.pinH * 0.5, layout.pinH * 0.5), y: pin.y - layout.pinH * 0.9 }, { x: pin.x + rand(-layout.pinH * 1.0, layout.pinH * 1.0), y: pin.y - layout.pinH * 0.2 }, { x: exitX, y: pin.y + rand(-layout.pinH * 0.25, layout.pinH * 0.15) }];
    } else if (type === "frog") {
      audio.frogBoing();
      pin.rocket.nextChug = current + 420;
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: pin.x + rand(-layout.pinH * 0.3, layout.pinH * 0.3), y: pin.y - layout.pinH * 0.4 }, { x: pin.x + rand(-layout.pinH * 0.9, layout.pinH * 0.9), y: pin.y - layout.pinH * 1.0 }, { x: exitX, y: pin.y + rand(-layout.pinH * 0.18, layout.pinH * 0.15) }];
    } else if (type === "fish") {
      audio.fishBlub();
      pin.rocket.nextChug = current + 350;
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: pin.x + rand(-layout.pinH * 0.8, layout.pinH * 0.8), y: pin.y - layout.pinH * 0.25 }, { x: rand(layout.wallLeft + layout.pinH * 0.5, layout.wallRight - layout.pinH * 0.5), y: rand(layout.playTop + layout.pinH * 0.8, layout.playBottom - layout.pinH * 0.9) }, { x: exitX, y: rand(layout.playTop + layout.pinH * 0.9, layout.playBottom - layout.pinH * 0.8) }];
    } else if (type === "bird") {
      audio.birdChirp();
      pin.rocket.nextChug = current + 280;
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: pin.x + rand(-layout.pinH * 0.5, layout.pinH * 0.5), y: pin.y - layout.pinH * 0.8 }, { x: rand(layout.wallLeft + layout.pinH * 0.5, layout.wallRight - layout.pinH * 0.5), y: layout.playTop + rand(layout.pinH * 0.3, layout.pinH * 1.8) }, { x: exitX, y: layout.playTop - layout.pinH * 0.4 }];
    } else if (type === "penguin") {
      audio.penguinSlide();
      pin.rocket.nextChug = current + 480;
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: layout.wallLeft + layout.pinH * 0.6, y: pin.y + rand(-layout.pinH * 0.06, layout.pinH * 0.06) }, { x: layout.wallRight - layout.pinH * 0.6, y: pin.y + rand(-layout.pinH * 0.06, layout.pinH * 0.06) }, { x: exitX, y: pin.y + rand(-layout.pinH * 0.06, layout.pinH * 0.06) }];
    } else if (type === "dogzoomies") {
      audio.dogZoomies();
      pin.rocket.nextChug = current + 260;
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: rand(layout.wallLeft + layout.pinH * 0.4, layout.wallRight - layout.pinH * 0.4), y: rand(layout.playTop + layout.pinH * 0.5, layout.playBottom - layout.pinH * 1.1) }, { x: rand(layout.wallLeft + layout.pinH * 0.4, layout.wallRight - layout.pinH * 0.4), y: rand(layout.playTop + layout.pinH * 0.5, layout.playBottom - layout.pinH * 1.1) }, { x: exitX, y: rand(layout.playTop + layout.pinH * 0.6, layout.playBottom - layout.pinH * 1.0) }];
    } else if (["batbaseball", "hockeypuck", "footballthrow", "soccergoal", "tennisserve", "golfdrive", "volleyballspike", "baseballcatch", "bowlingstrike", "skijump", "gymnasticsflip", "basketballhoop"].includes(type)) {
      pin.rocket.nextChug = current + 360;
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: pin.x + rand(-layout.pinH * 0.45, layout.pinH * 0.45), y: pin.y - layout.pinH * 0.55 }, { x: rand(layout.wallLeft + layout.pinH * 0.6, layout.wallRight - layout.pinH * 0.6), y: rand(layout.playTop + layout.pinH * 0.45, layout.playBottom - layout.pinH * 1.1) }, { x: exitX, y: rand(layout.playTop + layout.pinH * 0.5, layout.playBottom - layout.pinH * 0.9) }];
    } else if (type === "basketballdribble") {
      pin.rocket.nextChug = current + 250;
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: pin.x + rand(-layout.pinH * 0.4, layout.pinH * 0.4), y: pin.y + layout.pinH * 0.10 }, { x: rand(layout.wallLeft + layout.pinH * 0.8, layout.wallRight - layout.pinH * 0.8), y: pin.y + rand(-layout.pinH * 0.3, layout.pinH * 0.3) }, { x: exitX, y: pin.y + rand(-layout.pinH * 0.35, layout.pinH * 0.35) }];
    } else if (type === "curling") {
      pin.rocket.nextChug = current + 300;
      pin.rocket.path = [{ x: pin.x, y: pin.y }, { x: layout.wallLeft + layout.pinH * 0.75, y: pin.y + rand(-layout.pinH * 0.10, layout.pinH * 0.10) }, { x: layout.wallRight - layout.pinH * 0.75, y: pin.y + rand(-layout.pinH * 0.10, layout.pinH * 0.10) }, { x: exitX, y: pin.y + rand(-layout.pinH * 0.10, layout.pinH * 0.10) }];
    }
  }

  function knockOnePin(pin, depth, power, current) {
    pin.falling = true;
    pin.hitAt = current + depth * 70;
    const direction = Math.random() < 0.5 ? -1 : 1;
    pin.vx = direction * rand(18, 50) * power;
    pin.vy = rand(-12, 18) * power;
    pin.angularVelocity = direction * rand(1.6, 2.8) * (0.8 + power);
    pin.chainDepth = depth;
  }

  function restorePin(pin) {
    pin.falling = false;
    pin.fallen = false;
    pin.x = pin.baseX;
    pin.y = pin.baseY;
    pin.vx = 0;
    pin.vy = 0;
    pin.angle = rand(-0.025, 0.025);
    pin.angularVelocity = 0;
    pin.hitAt = 0;
    pin.chainDepth = 0;
    pin.fading = false;
    pin.fadeStartAt = 0;
    pin.removed = false;
    pin.rocket = null;
  }

  function updatePins(current, dt) {
    let activeFlightSpecials = false;
    for (const pin of game.pins) {
      if (pin.rocket && !pin.removed) {
        if (pin.rocket.type === "rocket" || pin.rocket.type === "firework") activeFlightSpecials = true;
        updateSpecialPin(pin, current, dt);
        continue;
      }
      if (pin.fading && current - pin.fadeStartAt >= PIN_FADE_MS) {
        pin.removed = true;
        continue;
      }
      if (!pin.falling) continue;
      if (current < pin.hitAt) continue;
      pin.x += pin.vx * dt;
      pin.y += pin.vy * dt;
      pin.vy += 80 * dt;
      pin.angle += pin.angularVelocity * dt;
      const targetAngle = pin.angularVelocity >= 0 ? Math.PI * 0.53 : -Math.PI * 0.53;
      if (Math.abs(pin.angle) >= Math.abs(targetAngle)) {
        pin.angle = targetAngle;
        pin.falling = false;
        pin.fallen = true;
        pin.vx *= 0.22;
        pin.vy = 0;
        pin.fading = true;
        pin.fadeStartAt = current + PIN_FADE_DELAY_MS;
      }
    }
    if (!activeFlightSpecials) audio.stopRocketFlight();
    game.pins = game.pins.filter(pin => !pin.removed);
  }

  function updateSpecialPin(pin, current, dt) {
    const s = pin.rocket;
    if (!s) return;
    const age = current - s.startedAt;
    const t = clamp(age / s.duration, 0, 1);

    if (["rocket", "firework", "balloon", "toytrain", "kite", "racecar", "airplane", "helicopter", "bus", "bulldozer", "bunny", "frog", "bird", "dogzoomies", "batbaseball", "basketballdribble", "basketballhoop", "hockeypuck", "curling", "footballthrow", "soccergoal", "tennisserve", "golfdrive", "volleyballspike", "baseballcatch", "bowlingstrike", "skijump", "gymnasticsflip"].includes(s.type)) {
      const path = s.path;
      const scaled = t * (path.length - 1);
      const segment = Math.min(path.length - 2, Math.floor(scaled));
      const localT = scaled - segment;
      const eased = 0.5 - Math.cos(localT * Math.PI) * 0.5;
      const a = path[segment];
      const b = path[segment + 1];
      const wobbleAmp = s.type === "balloon" ? layout.pinH * 0.10 : s.type === "kite" ? layout.pinH * 0.12 : s.type === "helicopter" ? layout.pinH * 0.06 : s.type === "airplane" ? layout.pinH * 0.04 : s.type === "bird" ? layout.pinH * 0.06 : s.type === "dogzoomies" ? layout.pinH * 0.05 : layout.pinH * 0.035;
      pin.x = lerp(a.x, b.x, eased) + Math.sin(age / 120 + (s.variant % 7)) * wobbleAmp;
      pin.y = lerp(a.y, b.y, eased) + Math.cos(age / 140) * (s.type === "toytrain" || s.type === "bus" || s.type === "bulldozer" ? 3 : s.type === "helicopter" ? 8 : s.type === "bunny" ? 12 : s.type === "frog" ? 10 : s.type === "bird" ? 7 : layout.pinH * 0.025);
      pin.angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2 + Math.sin(age / 130) * (s.type === "balloon" ? 0.28 : s.type === "kite" ? 0.35 : s.type === "racecar" ? 0.10 : s.type === "bus" ? 0.08 : s.type === "bulldozer" ? 0.07 : s.type === "bunny" ? 0.14 : s.type === "frog" ? 0.16 : s.type === "bird" ? 0.20 : s.type === "dogzoomies" ? 0.22 : 0.18);
      if (["rocket", "firework", "meteor"].includes(s.type) && Math.random() < 0.55) makeRocketTrailParticles(pin.x, pin.y + layout.pinH * 0.20, 1);
      if (s.type === "rocket" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; audio.rocketBurst(); makePinataBurst(pin.x, pin.y); }
      if (s.type === "firework" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; audio.fireworkBurst(); makeFireworkBurst(pin.x, pin.y); }
      if (s.type === "balloon" && !s.popped && current >= s.popAt) { s.popped = true; audio.balloonPop(); makeBalloonPop(pin.x, pin.y, s.balloonColor); }
      if (s.type === "toytrain" && Math.random() < 0.22) makeTrainPuff(pin.x - layout.pinW * 0.4, pin.y + layout.pinH * 0.2);
      if (s.type === "racecar" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; makeRaceCarBurst(pin.x, pin.y); }
      if (s.type === "airplane" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; makeAirplaneBurst(pin.x, pin.y); }
      if (s.type === "helicopter" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; makeHelicopterBurst(pin.x, pin.y); }
      if (s.type === "bus" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; makeBusBurst(pin.x, pin.y); }
      if (s.type === "bulldozer" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; makeBulldozerBurst(pin.x, pin.y); }
      if (s.type === "bunny" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; makeBunnyBurst(pin.x, pin.y); }
      if (s.type === "frog" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; makeFrogBurst(pin.x, pin.y); }
      if (s.type === "bird" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; makeBirdBurst(pin.x, pin.y); }
      if (s.type === "dogzoomies" && !s.burstDone && current >= s.burstAt) { s.burstDone = true; makeDogBurst(pin.x, pin.y); }
      if (["batbaseball", "basketballhoop", "hockeypuck", "footballthrow", "soccergoal", "tennisserve", "golfdrive", "volleyballspike", "baseballcatch", "bowlingstrike", "skijump", "gymnasticsflip", "basketballdribble", "curling"].includes(s.type) && !s.burstDone && current >= s.burstAt) { s.burstDone = true; makeSportBurst(pin.x, pin.y, s.type); }
      if (s.type === "toytrain" && current >= (s.nextChug || 0)) { audio.toyTrainChug(); s.nextChug = current + 310; }
      if (s.type === "racecar" && current >= (s.nextChug || 0)) { audio.raceCarSkid(); s.nextChug = current + 420; }
      if (s.type === "airplane" && current >= (s.nextChug || 0)) { audio.airplanePass(); s.nextChug = current + 650; }
      if (s.type === "helicopter" && current >= (s.nextChug || 0)) { audio.helicopterChop(); s.nextChug = current + 170; }
      if (s.type === "bus" && current >= (s.nextChug || 0)) { audio.busDrive(); s.nextChug = current + 360; }
      if (s.type === "bulldozer" && current >= (s.nextChug || 0)) { audio.bulldozerClank(); s.nextChug = current + 320; }
      if (s.type === "bunny" && current >= (s.nextChug || 0)) { audio.bunnyHop(); s.nextChug = current + 340; }
      if (s.type === "frog" && current >= (s.nextChug || 0)) { audio.frogBoing(); s.nextChug = current + 420; }
      if (s.type === "bird" && current >= (s.nextChug || 0)) { audio.birdChirp(); s.nextChug = current + 260; }
      if (s.type === "dogzoomies" && current >= (s.nextChug || 0)) { audio.dogZoomies(); s.nextChug = current + 260; }
      if (["basketballdribble", "curling"].includes(s.type) && current >= (s.nextChug || 0)) { audio.hitPins(1); s.nextChug = current + 360; }
      if (t >= 1) {
        pin.removed = true;
        if ((s.type === "rocket" || s.type === "firework") && !game.pins.some(p => p !== pin && p.rocket && !p.removed && (p.rocket.type === "rocket" || p.rocket.type === "firework"))) audio.stopRocketFlight();
      }
      return;
    }

    if (s.type === "pinata") {
      pin.angle = Math.sin(age / 55) * 0.18 * (1 - t * 0.25);
      if (!s.burstDone && current >= s.burstAt) { s.burstDone = true; makePinataBurst(pin.x, pin.y); }
      if (t >= 1) pin.removed = true;
      return;
    }

    if (s.type === "pinatastar") {
      pin.angle = age / 280;
      if (!s.burstDone && current >= s.burstAt) { s.burstDone = true; makePinataBurst(pin.x, pin.y); makeFireworkBurst(pin.x, pin.y); }
      if (t >= 1) pin.removed = true;
      return;
    }

    if (s.type === "jelly") {
      if (!s.melted && current >= s.meltAt) { s.melted = true; audio.jellyMelt(); makeJellyDrips(pin.x, pin.y, s.jellyColor); }
      pin.angle = Math.sin(age / 80) * 0.10;
      if (t >= 1) pin.removed = true;
      return;
    }

    if (s.type === "catpaw") {
      const impactT = clamp((current - s.swipeAt) / (s.duration * 0.46), 0, 1);
      if (!s.pawDone && current >= s.swipeAt) { s.pawDone = true; audio.catPawBop(); makeCatPawBurst(pin.x, pin.y); }
      if (s.pawDone) {
        pin.x = lerp(pin.x, s.exit.x, impactT * 0.12);
        pin.y = lerp(pin.y, s.exit.y, impactT * 0.12);
        pin.angle += dt * (s.pawSide * 4.5);
      }
      if (t >= 1) pin.removed = true;
      return;
    }

    if (s.type === "treasure") {
      pin.angle = Math.sin(age / 90) * 0.08;
      if (!s.burstDone && current >= s.burstAt) { s.burstDone = true; audio.treasureSparkle(); makeTreasureBurst(pin.x, pin.y); }
      if (t >= 1) pin.removed = true;
      return;
    }

    if (s.type === "popcorn") {
      pin.angle = Math.sin(age / 70) * 0.12;
      if (!s.popped && current >= s.popAt) { s.popped = true; audio.popcornCluster(); makePopcornBurst(pin.x, pin.y); }
      if (t >= 1) pin.removed = true;
      return;
    }

    if (s.type === "magicpaint") {
      pin.angle = Math.sin(age / 80) * 0.18;
      if (!s.burstDone && current >= s.burstAt) { s.burstDone = true; audio.paintSplash(); makePaintBurst(pin.x, pin.y, s.paintColor); }
      if (t >= 1) pin.removed = true;
      return;
    }

    if (s.type === "flower") {
      if (!s.burstDone && current >= s.burstAt) { s.burstDone = true; audio.flowerBloom(); makeFlowerBurst(pin.x, pin.y, s.petalColor); }
      if (t >= 1) pin.removed = true;
      return;
    }
  }

  function remainingUprightCount() {
    return game.pins.filter(p => !p.fallen && !p.falling && !p.rocket && !p.removed).length;
  }

  function beginReward() {
    game.phase = "reward";
    game.rewardStartedAt = nowMs();
    game.nextLevelAt = game.rewardStartedAt + LEVEL_REWARD_MS + NEXT_LEVEL_DELAY_MS;
    game.message = "MEOW!\nYou knocked them down!";
    audio.reward();
    for (let i = 0; i < 80; i += 1) {
      game.particles.push({
        x: rand(view.w * 0.14, view.w * 0.86),
        y: rand(view.h * 0.18, view.h * 0.45),
        vx: rand(-90, 90),
        vy: rand(-130, 70),
        size: rand(4, 11),
        color: ["#fff7a8", "#ffffff", "#7bdfff", "#ff9acb", "#8d63ff"][randInt(0, 4)],
        shape: Math.random() < 0.56 ? "star" : "confetti",
        spin: rand(-5, 5),
        startedAt: nowMs(),
        duration: rand(1200, 2300)
      });
    }
  }

  function updateReward(current) {
    if (game.phase === "resolving" && current >= game.resolvingUntil) {
      if (remainingUprightCount() === 0) beginReward();
      else game.phase = "playing";
    }
    if (game.phase === "reward" && current >= game.nextLevelAt) startLevel();
  }

  function makeRocketTrailParticles(x, y, count) {
    for (let i = 0; i < count; i += 1) {
      game.particles.push({
        x: x + rand(-layout.pinW * 0.25, layout.pinW * 0.25),
        y: y + rand(-layout.pinW * 0.20, layout.pinW * 0.20),
        vx: rand(-45, 45),
        vy: rand(20, 105),
        size: rand(3, 8),
        color: ["#ffef86", "#ff7a31", "#ffca54", "#ffffff"][randInt(0, 3)],
        shape: Math.random() < 0.7 ? "spark" : "confetti",
        spin: rand(-5, 5),
        startedAt: nowMs(),
        duration: rand(280, 620)
      });
    }
  }

  function makePinataBurst(x, y) {
    const shapes = ["star", "confetti", "treat", "toy", "heart"];
    const colors = ["#fff7a8", "#ffffff", "#7bdfff", "#ff9acb", "#8d63ff", "#ff7a31", "#58d36f", "#ef3340"];
    for (let i = 0; i < 86; i += 1) {
      const angle = rand(0, TAU);
      const speed = rand(80, 260);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - rand(20, 150), size: rand(5, 15), color: colors[randInt(0, colors.length - 1)], shape: shapes[randInt(0, shapes.length - 1)], spin: rand(-7, 7), startedAt: nowMs(), duration: rand(1000, 2100) });
    }
  }

  function makeFireworkBurst(x, y) {
    const colors = ["#fff7a8", "#ffffff", "#7bdfff", "#ff9acb", "#8d63ff", "#ff7a31"];
    for (let i = 0; i < 92; i += 1) {
      const angle = rand(0, TAU);
      const speed = rand(90, 300);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, size: rand(3, 11), color: colors[randInt(0, colors.length - 1)], shape: Math.random() < 0.68 ? "spark" : "star", spin: rand(-8, 8), startedAt: nowMs(), duration: rand(700, 1600) });
    }
  }

  function makeBalloonPop(x, y, color) {
    for (let i = 0; i < 44; i += 1) {
      const angle = rand(0, TAU);
      const speed = rand(35, 180);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - rand(10, 80), size: rand(3, 9), color: Math.random() < 0.7 ? color : ["#ffffff", "#fff7a8", "#7bdfff"][randInt(0,2)], shape: Math.random() < 0.55 ? "confetti" : "spark", spin: rand(-7, 7), startedAt: nowMs(), duration: rand(500, 1200) });
    }
  }

  function makeJellyDrips(x, y, color) {
    for (let i = 0; i < 34; i += 1) {
      game.particles.push({ x: x + rand(-layout.pinW * 0.4, layout.pinW * 0.4), y: y + rand(-layout.pinH * 0.1, layout.pinH * 0.3), vx: rand(-55, 55), vy: rand(-40, 90), size: rand(4, 12), color, shape: Math.random() < 0.5 ? "bubble" : "confetti", spin: rand(-3, 3), startedAt: nowMs(), duration: rand(650, 1400) });
    }
  }

  function makeCatPawBurst(x, y) {
    const colors = ["#ffffff", "#ffe36d", "#ff9acb", "#7bdfff"];
    for (let i = 0; i < 36; i += 1) {
      const angle = rand(-Math.PI * 0.8, Math.PI * 0.2);
      const speed = rand(70, 220);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - rand(20, 110), size: rand(5, 12), color: colors[randInt(0, colors.length - 1)], shape: Math.random() < 0.35 ? "paw" : "star", spin: rand(-5, 5), startedAt: nowMs(), duration: rand(650, 1400) });
    }
  }

  function makeTreasureBurst(x, y) {
    const colors = ["#ffe36d", "#fff7a8", "#ffb739", "#7bdfff", "#ff9acb"];
    for (let i = 0; i < 68; i += 1) {
      const angle = rand(0, TAU); const speed = rand(60, 240);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - rand(10, 120), size: rand(4, 13), color: colors[randInt(0, colors.length - 1)], shape: ["star","treat","toy"][randInt(0,2)], spin: rand(-6,6), startedAt: nowMs(), duration: rand(900, 1800) });
    }
  }

  function makeTrainPuff(x, y) {
    game.particles.push({ x, y, vx: rand(-20, 20), vy: rand(-40, -5), size: rand(7, 14), color: "rgba(255,255,255,0.8)", shape: "bubble", spin: 0, startedAt: nowMs(), duration: rand(450, 850) });
  }

  function makePopcornBurst(x, y) {
    for (let i = 0; i < 54; i += 1) {
      const angle = rand(0, TAU); const speed = rand(50, 220);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - rand(0, 120), size: rand(5, 11), color: Math.random() < 0.72 ? "#fff8d7" : "#ffcc55", shape: Math.random() < 0.7 ? "bubble" : "star", spin: rand(-4,4), startedAt: nowMs(), duration: rand(700, 1400) });
    }
  }

  function makePaintBurst(x, y, color) {
    for (let i = 0; i < 70; i += 1) {
      const angle = rand(0, TAU); const speed = rand(60, 250);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - rand(0, 120), size: rand(4, 12), color, shape: Math.random() < 0.65 ? "confetti" : "bubble", spin: rand(-8,8), startedAt: nowMs(), duration: rand(800, 1600) });
    }
  }

  function makeFlowerBurst(x, y, color) {
    for (let i = 0; i < 48; i += 1) {
      const angle = rand(0, TAU); const speed = rand(40, 170);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - rand(0, 100), size: rand(5, 12), color, shape: Math.random() < 0.55 ? "heart" : "star", spin: rand(-5,5), startedAt: nowMs(), duration: rand(900, 1800) });
    }
  }

  function makeWallBounceBurst(x, y) {
    for (let i = 0; i < 28; i += 1) {
      const angle = rand(-Math.PI * 0.55, Math.PI * 0.55);
      const speed = rand(50, 170);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed * (x < view.w * 0.5 ? 1 : -1), vy: Math.sin(angle) * speed, size: rand(4, 10), color: ["#ffffff","#ffe36d","#7bdfff"][randInt(0,2)], shape: Math.random() < 0.5 ? "star" : "spark", spin: rand(-8,8), startedAt: nowMs(), duration: rand(400, 900) });
    }
  }

  function makeMeteorImpact(x, y) {
    for (let i = 0; i < 58; i += 1) {
      const angle = rand(0, TAU); const speed = rand(80, 260);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - rand(0, 140), size: rand(5, 12), color: ["#fff7a8","#ffb739","#ff7a31","#ef3340"][randInt(0,3)], shape: Math.random() < 0.6 ? "spark" : "star", spin: rand(-9,9), startedAt: nowMs(), duration: rand(700, 1400) });
    }
  }

  function makeRaceCarBurst(x, y) { makeWallBounceBurst(x, y); }
  function makeAirplaneBurst(x, y) { makeFireworkBurst(x, y); }
  function makeHelicopterBurst(x, y) { makeCatPawBurst(x, y); }
  function makeBusBurst(x, y) { makeTreasureBurst(x, y); }
  function makeBulldozerBurst(x, y) { makePinataBurst(x, y); }
  function makeBunnyBurst(x, y) { makeFlowerBurst(x, y, "#ffd8f1"); }
  function makeFrogBurst(x, y) { makeJellyDrips(x, y, "#8be37e"); }
  function makeFishBurst(x, y) { makeBalloonPop(x, y, "#66d4ff"); }
  function makeBirdBurst(x, y) { makeFireworkBurst(x, y); }
  function makePenguinBurst(x, y) { makeBalloonPop(x, y, "#e8f4ff"); }
  function makeDogBurst(x, y) { makeCatPawBurst(x, y); }
  function makeSportBurst(x, y, type) {
    const colors = type === "basketballdribble" || type === "basketballhoop" ? ["#ff8a1c", "#ffffff", "#ffe36d"] : type === "hockeypuck" || type === "curling" ? ["#dff7ff", "#ffffff", "#7bdfff"] : ["#fff7a8", "#ffffff", "#ff9acb", "#7bdfff"];
    for (let i = 0; i < 42; i += 1) {
      const angle = rand(0, TAU);
      const speed = rand(55, 210);
      game.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - rand(0, 110), size: rand(4, 11), color: colors[randInt(0, colors.length - 1)], shape: Math.random() < 0.55 ? "star" : "confetti", spin: rand(-7, 7), startedAt: nowMs(), duration: rand(700, 1500) });
    }
  }

  function makeImpactParticles(x, y, strength) {
    const count = clamp(8 + strength * 4, 10, 34);
    for (let i = 0; i < count; i += 1) {
      game.particles.push({
        x,
        y,
        vx: rand(-120, 120),
        vy: rand(-130, 85),
        size: rand(3, 8),
        color: ["#ffffff", "#ffe36d", "#ef3340", "#bfeaff"][randInt(0, 3)],
        shape: Math.random() < 0.5 ? "star" : "confetti",
        spin: rand(-5, 5),
        startedAt: nowMs(),
        duration: rand(380, 850)
      });
    }
  }

  function updateParticles(current, dt) {
    for (const p of game.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 82 * dt;
      p.spin += dt * 4;
    }
    game.particles = game.particles.filter(p => current - p.startedAt < p.duration + 80);
  }

  function render(current) {
    drawBackground();
    drawTitleBar();
    drawPathPreview();
    drawPins(current);
    drawParticles(current);
    drawCat();
    drawRoller();
    if (!game.ball && game.phase !== "reward") drawLoadedBall(layout.rollerX, layout.rollerY - layout.ballR * 0.60, layout.ballR, 0, game.nextBallSeed);
    drawBall();
    drawRotatingStatusText(current);
    drawHoldProgress(current);
    drawReward(current);
    drawTitleOverlay(current);
    if (game.phase === "paused") drawPauseOverlay();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, view.h);
    sky.addColorStop(0, "#53cfff");
    sky.addColorStop(0.55, "#a4ebff");
    sky.addColorStop(1, "#e3fbff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, view.w, view.h);

    drawCloud(view.w * 0.18, view.h * 0.11, layout.radius * 1.4, 0.35);
    drawCloud(view.w * 0.76, view.h * 0.16, layout.radius * 1.15, 0.32);
    drawCloud(view.w * 0.53, view.h * 0.035, layout.radius * 0.95, 0.22);

    // Subtle playfield shine.
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(view.w * 0.5, view.h * 0.39, view.w * 0.55, view.h * 0.32, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawCloud(x, y, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x - size * 0.75, y + size * 0.1, size * 0.52, 0, TAU);
    ctx.arc(x - size * 0.25, y - size * 0.15, size * 0.64, 0, TAU);
    ctx.arc(x + size * 0.35, y, size * 0.54, 0, TAU);
    ctx.arc(x + size * 0.85, y + size * 0.14, size * 0.42, 0, TAU);
    ctx.rect(x - size * 1.22, y, size * 2.35, size * 0.55);
    ctx.fill();
    ctx.restore();
  }

  function drawBottomClouds() {
    const y = view.h - layout.unit * 1.1;
    drawCloud(view.w * 0.12, y, layout.unit * 1.9, 0.72);
    drawCloud(view.w * 0.42, y + layout.unit * 0.15, layout.unit * 2.05, 0.62);
    drawCloud(view.w * 0.78, y + layout.unit * 0.12, layout.unit * 2.0, 0.62);
  }

  function drawTitleBar() {
    const size = clamp(view.w * 0.072, 26, 55);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `1000 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.lineWidth = Math.max(4, size * 0.10);
    ctx.strokeStyle = "rgba(52, 47, 145, 0.72)";
    ctx.fillStyle = "#ffe36d";
    ctx.strokeText("Meowmoon", view.w / 2, layout.topBand * 0.43);
    ctx.fillText("Meowmoon", view.w / 2, layout.topBand * 0.43);

    ctx.font = `900 ${size * 0.52}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.strokeText("BOWLING", view.w / 2, layout.topBand * 0.80);
    ctx.fillText("BOWLING", view.w / 2, layout.topBand * 0.80);

    drawMoon(view.w - layout.unit * 1.45, layout.unit * 1.06, layout.unit * 0.72);
    drawTinyStar(layout.unit * 1.0, layout.unit * 1.05, layout.unit * 0.28, "#fff7a8");
    drawTinyStar(view.w * 0.18, layout.unit * 2.05, layout.unit * 0.20, "#fff7a8");
    ctx.restore();
  }

  function drawMoon(x, y, r) {
    ctx.save();
    ctx.fillStyle = "#ffe893";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x - r * 0.34, y - r * 0.08, r * 0.96, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(104,77,142,0.42)";
    ctx.beginPath();
    ctx.arc(x + r * 0.26, y + r * 0.02, r * 0.06, 0, TAU);
    ctx.arc(x + r * 0.42, y + r * 0.22, r * 0.045, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawTinyStar(x, y, r, color) {
    ctx.save();
    ctx.fillStyle = color;
    drawStar(x, y, r, r * 0.42, 5);
    ctx.restore();
  }

  function drawPathPreview() {
    if (!game.ball || !game.ball.path || game.ball.path.length < 2) return;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#5534ca";
    ctx.lineWidth = Math.max(2, layout.unit * 0.08);
    ctx.setLineDash([7, 11]);
    ctx.beginPath();
    ctx.moveTo(game.ball.path[0].x, game.ball.path[0].y);
    for (let i = 1; i < game.ball.path.length; i += 1) ctx.lineTo(game.ball.path[i].x, game.ball.path[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function drawPins(current) {
    const ordered = game.pins.slice().sort((a, b) => a.y - b.y);
    for (const pin of ordered) {
      if (pin.rocket && !pin.removed) drawSpecialPin(pin, current);
      else drawPin(pin, current);
    }
  }

  function drawPin(pin, current) {
    if (pin.removed) return;
    let alpha = 1;
    if (pin.fading) alpha = clamp(1 - (current - pin.fadeStartAt) / PIN_FADE_MS, 0, 1);
    if (alpha <= 0.01) return;
    const w = layout.pinW * pin.scale;
    const h = layout.pinH * pin.scale;
    let x = pin.x;
    let y = pin.y;
    let angle = pin.angle;
    if (!pin.falling && !pin.fallen) {
      y += Math.sin(current / 900 + pin.wobble) * 0.7;
    }
    const shadowAlpha = (pin.fallen ? 0.16 : 0.23) * alpha;

    ctx.save();
    ctx.globalAlpha = shadowAlpha;
    ctx.fillStyle = "#315e8f";
    ctx.beginPath();
    ctx.ellipse(x + w * 0.05, y + h * 0.58, w * 0.78, h * 0.12, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const body = ctx.createLinearGradient(-w * 0.62, -h * 0.52, w * 0.78, h * 0.62);
    body.addColorStop(0, "#d9d7d2");
    body.addColorStop(0.22, "#ffffff");
    body.addColorStop(0.62, "#f9f8f2");
    body.addColorStop(1, "#c9c6bc");

    ctx.fillStyle = body;
    ctx.strokeStyle = "rgba(125,118,105,0.45)";
    ctx.lineWidth = Math.max(1.2, w * 0.055);

    ctx.beginPath();
    ctx.moveTo(0, -h * 0.55);
    ctx.bezierCurveTo(w * 0.38, -h * 0.54, w * 0.44, -h * 0.22, w * 0.20, -h * 0.11);
    ctx.bezierCurveTo(w * 0.64, h * 0.03, w * 0.62, h * 0.42, w * 0.31, h * 0.52);
    ctx.bezierCurveTo(w * 0.16, h * 0.59, -w * 0.16, h * 0.59, -w * 0.31, h * 0.52);
    ctx.bezierCurveTo(-w * 0.62, h * 0.42, -w * 0.64, h * 0.03, -w * 0.20, -h * 0.11);
    ctx.bezierCurveTo(-w * 0.44, -h * 0.22, -w * 0.38, -h * 0.54, 0, -h * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Classic red neck bands clipped to body shape.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.55);
    ctx.bezierCurveTo(w * 0.38, -h * 0.54, w * 0.44, -h * 0.22, w * 0.20, -h * 0.11);
    ctx.bezierCurveTo(w * 0.38, -h * 0.05, w * 0.39, h * 0.01, w * 0.30, h * 0.06);
    ctx.lineTo(-w * 0.30, h * 0.06);
    ctx.bezierCurveTo(-w * 0.39, h * 0.01, -w * 0.38, -h * 0.05, -w * 0.20, -h * 0.11);
    ctx.bezierCurveTo(-w * 0.44, -h * 0.22, -w * 0.38, -h * 0.54, 0, -h * 0.55);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = "#d91622";
    ctx.fillRect(-w * 0.40, -h * 0.24, w * 0.80, h * 0.065);
    ctx.fillRect(-w * 0.37, -h * 0.135, w * 0.74, h * 0.058);
    ctx.restore();

    // Highlights.
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(-w * 0.18, -h * 0.27, w * 0.10, h * 0.20, -0.24, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha * 0.20;
    ctx.beginPath();
    ctx.ellipse(-w * 0.13, h * 0.16, w * 0.15, h * 0.25, -0.17, 0, TAU);
    ctx.fill();

    // Base ring.
    ctx.globalAlpha = alpha * 0.82;
    ctx.strokeStyle = "rgba(110,80,45,0.40)";
    ctx.lineWidth = Math.max(1, w * 0.05);
    ctx.beginPath();
    ctx.ellipse(0, h * 0.52, w * 0.30, h * 0.045, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawSpecialPin(pin, current) {
    const type = pin.rocket?.type || "rocket";
    if (type === "rocket") return drawRocketPin(pin, current);
    if (type === "pinata") return drawPinataPin(pin, current);
    if (type === "pinatastar") return drawPinataStarPin(pin, current);
    if (type === "balloon") return drawBalloonPin(pin, current);
    if (type === "firework") return drawFireworkPin(pin, current);
    if (type === "jelly") return drawJellyPin(pin, current);
    if (type === "catpaw") return drawCatPawPin(pin, current);
    if (type === "treasure") return drawTreasurePin(pin, current);
    if (type === "toytrain") return drawToyTrainPin(pin, current);
    if (type === "popcorn") return drawPopcornPin(pin, current);
    if (type === "kite") return drawKitePin(pin, current);
    if (type === "magicpaint") return drawMagicPaintPin(pin, current);
    if (type === "flower") return drawFlowerPin(pin, current);
    if (type === "racecar") return drawRaceCarPin(pin, current);
    if (type === "airplane") return drawAirplanePin(pin, current);
    if (type === "helicopter") return drawHelicopterPin(pin, current);
    if (type === "bus") return drawBusPin(pin, current);
    if (type === "bulldozer") return drawBulldozerPin(pin, current);
    if (type === "bunny") return drawBunnyPin(pin, current);
    if (type === "frog") return drawFrogPin(pin, current);
    if (type === "fish") return drawFishPin(pin, current);
    if (type === "bird") return drawBirdPin(pin, current);
    if (type === "penguin") return drawPenguinPin(pin, current);
    if (type === "dogzoomies") return drawDogPin(pin, current);
    if (type === "batbaseball") return drawBatBaseballPin(pin, current);
    if (type === "basketballdribble") return drawBasketballDribblePin(pin, current);
    if (type === "basketballhoop") return drawBasketballHoopPin(pin, current);
    if (type === "hockeypuck") return drawHockeyPuckPin(pin, current);
    if (type === "curling") return drawCurlingPin(pin, current);
    if (type === "footballthrow") return drawFootballThrowPin(pin, current);
    if (type === "soccergoal") return drawSoccerGoalPin(pin, current);
    if (type === "tennisserve") return drawTennisServePin(pin, current);
    if (type === "golfdrive") return drawGolfDrivePin(pin, current);
    if (type === "volleyballspike") return drawVolleyballSpikePin(pin, current);
    if (type === "baseballcatch") return drawBaseballCatchPin(pin, current);
    if (type === "bowlingstrike") return drawBowlingStrikePin(pin, current);
    if (type === "skijump") return drawSkiJumpPin(pin, current);
    if (type === "gymnasticsflip") return drawGymnasticsFlipPin(pin, current);
    return drawRocketPin(pin, current);
  }

  function drawRocketPin(pin, current) {
    const w = layout.pinW * pin.scale;
    const h = layout.pinH * pin.scale;
    const age = pin.rocket ? current - pin.rocket.startedAt : 0;
    const pulse = 1 + Math.sin(age / 85) * 0.035;

    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = "#315e8f";
    ctx.beginPath();
    ctx.ellipse(pin.x, pin.y + h * 0.42, w * 0.80, h * 0.12, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(pin.x, pin.y);
    ctx.rotate(pin.angle);
    ctx.scale(pulse, pulse);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Flame.
    const flame = ctx.createRadialGradient(0, h * 0.56, w * 0.08, 0, h * 0.60, h * 0.35);
    flame.addColorStop(0, "#ffffff");
    flame.addColorStop(0.28, "#ffe36d");
    flame.addColorStop(0.66, "#ff7a31");
    flame.addColorStop(1, "rgba(239, 51, 64, 0)");
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-w * 0.22, h * 0.38);
    ctx.quadraticCurveTo(0, h * (0.96 + Math.sin(age / 70) * 0.08), w * 0.22, h * 0.38);
    ctx.quadraticCurveTo(0, h * 0.50, -w * 0.22, h * 0.38);
    ctx.fill();

    // Fins.
    ctx.fillStyle = "#ef3340";
    ctx.strokeStyle = "rgba(100, 35, 50, 0.42)";
    ctx.lineWidth = Math.max(1, w * 0.045);
    ctx.beginPath();
    ctx.moveTo(-w * 0.22, h * 0.22);
    ctx.lineTo(-w * 0.62, h * 0.48);
    ctx.lineTo(-w * 0.20, h * 0.47);
    ctx.closePath();
    ctx.moveTo(w * 0.22, h * 0.22);
    ctx.lineTo(w * 0.62, h * 0.48);
    ctx.lineTo(w * 0.20, h * 0.47);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // The pin becomes the rocket body.
    const body = ctx.createLinearGradient(-w * 0.55, -h * 0.62, w * 0.65, h * 0.55);
    body.addColorStop(0, "#d9d7d2");
    body.addColorStop(0.22, "#ffffff");
    body.addColorStop(0.64, "#f9f8f2");
    body.addColorStop(1, "#c9c6bc");
    ctx.fillStyle = body;
    ctx.strokeStyle = "rgba(95, 90, 85, 0.50)";
    ctx.lineWidth = Math.max(1.2, w * 0.055);
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.62);
    ctx.bezierCurveTo(w * 0.42, -h * 0.48, w * 0.38, h * 0.22, w * 0.18, h * 0.48);
    ctx.bezierCurveTo(w * 0.08, h * 0.56, -w * 0.08, h * 0.56, -w * 0.18, h * 0.48);
    ctx.bezierCurveTo(-w * 0.38, h * 0.22, -w * 0.42, -h * 0.48, 0, -h * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#d91622";
    ctx.fillRect(-w * 0.30, -h * 0.25, w * 0.60, h * 0.055);
    ctx.fillRect(-w * 0.28, -h * 0.145, w * 0.56, h * 0.050);

    ctx.fillStyle = "#7bdfff";
    ctx.strokeStyle = "#275a9b";
    ctx.lineWidth = Math.max(1, w * 0.04);
    ctx.beginPath();
    ctx.arc(0, -h * 0.02, w * 0.16, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function drawPinataPin(pin, current) {
    const age = current - pin.rocket.startedAt;
    const size = layout.pinH * 0.62;
    const swing = Math.sin(age / 65) * 0.12;
    const fringeColors = ["#ff5a8e", "#8a5cff", "#41d6ff", "#5fd36a", "#ffe36d", "#ff8a33"];
    ctx.save();
    ctx.translate(pin.x, pin.y);
    ctx.rotate(swing);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#315e8f";
    ctx.beginPath();
    ctx.ellipse(0, size * 0.64, size * 0.34, size * 0.08, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    for (let i = 0; i < fringeColors.length; i += 1) {
      const y = -size * 0.58 + i * size * 0.17;
      ctx.fillStyle = fringeColors[i];
      roundRect(ctx, -size * 0.26, y, size * 0.52, size * 0.19, size * 0.08);
      ctx.fill();
      for (let j = 0; j < 5; j += 1) {
        const fx = -size * 0.22 + j * size * 0.11;
        ctx.beginPath();
        ctx.moveTo(fx, y + size * 0.19);
        ctx.lineTo(fx + size * 0.04, y + size * 0.27 + Math.sin(age / 120 + j) * 2);
        ctx.lineTo(fx + size * 0.08, y + size * 0.19);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.strokeStyle = "rgba(110,70,40,0.72)";
    ctx.lineWidth = Math.max(2, size * 0.05);
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.68);
    ctx.lineTo(0, -size * 0.88);
    ctx.stroke();
    ctx.restore();
  }

  function drawPinataStarPin(pin, current) {
    const age = current - pin.rocket.startedAt;
    const size = layout.pinH * 0.62;
    ctx.save();
    ctx.translate(pin.x, pin.y);
    ctx.rotate(age / 380 + Math.sin(age / 160) * 0.08);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#315e8f";
    ctx.beginPath();
    ctx.ellipse(0, size * 0.64, size * 0.34, size * 0.08, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    const starColors = ["#ff5a8e", "#ffe36d", "#41d6ff", "#5fd36a", "#8a5cff", "#ff8a33"];
    for (let i = 0; i < 2; i += 1) {
      ctx.fillStyle = starColors[(Math.floor(age / 180) + i * 2) % starColors.length];
      drawStar(0, 0, size * (0.42 - i * 0.08), size * (0.20 - i * 0.04), 6);
    }
    ctx.fillStyle = "#fff7ec";
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.12, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawBalloonPin(pin, current) {
    const s = pin.rocket; const w = layout.pinW * pin.scale; const h = layout.pinH * pin.scale;
    const age = current - s.startedAt; const puff = 1 + 0.20 * Math.sin(Math.min(1, age / 500) * Math.PI * 0.8);
    ctx.save(); ctx.globalAlpha = s.popped ? clamp(1 - (current - s.popAt) / 220, 0, 1) : 1; ctx.translate(pin.x, pin.y); ctx.rotate(Math.sin(age / 170) * 0.12);
    ctx.strokeStyle = "rgba(60,80,120,0.45)"; ctx.lineWidth = Math.max(1.5, w * 0.04); ctx.beginPath(); ctx.moveTo(0, h * 0.18); ctx.bezierCurveTo(-w * 0.2, h * 0.55, w * 0.15, h * 0.9, 0, h * 1.3); ctx.stroke();
    ctx.fillStyle = s.balloonColor; ctx.beginPath(); ctx.ellipse(0, -h * 0.08, w * 0.92 * puff, h * 0.95 * puff, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = Math.max(1.2, w * 0.035); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.beginPath(); ctx.ellipse(-w * 0.25, -h * 0.3, w * 0.15, h * 0.22, -0.3, 0, TAU); ctx.fill(); ctx.restore();
  }

  function drawFireworkPin(pin, current) {
    drawRocketPin(pin, current);
    const s = pin.rocket; const age = current - s.startedAt;
    ctx.save(); ctx.globalAlpha = 0.35; ctx.strokeStyle = "#ffe36d"; ctx.lineWidth = Math.max(2, layout.pinW * 0.08); ctx.beginPath(); ctx.moveTo(pin.x, pin.y + layout.pinH * 0.5); ctx.lineTo(pin.x, pin.y + layout.pinH * (1.1 + 0.1 * Math.sin(age / 60))); ctx.stroke(); ctx.restore();
  }

  function drawJellyPin(pin, current) {
    const s = pin.rocket; const age = current - s.startedAt; const t = clamp(age / s.duration, 0, 1);
    const squishX = 1 + Math.sin(age / 80) * 0.14 + (s.melted ? t * 0.25 : 0);
    const squishY = 1 - Math.sin(age / 80) * 0.10 - (s.melted ? t * 0.30 : 0);
    const w = layout.pinW * pin.scale; const h = layout.pinH * pin.scale;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.rotate(Math.sin(age / 140) * 0.08); ctx.scale(squishX, squishY); ctx.globalAlpha = 0.88;
    const body = ctx.createLinearGradient(-w * 0.6, -h * 0.5, w * 0.6, h * 0.6); body.addColorStop(0, "#ffffff"); body.addColorStop(0.1, s.jellyColor); body.addColorStop(1, "rgba(255,255,255,0.4)"); ctx.fillStyle = body; ctx.strokeStyle = "rgba(95, 90, 85, 0.32)"; ctx.lineWidth = Math.max(1.2, w * 0.05);
    ctx.beginPath(); ctx.moveTo(0, -h * 0.55); ctx.bezierCurveTo(w * 0.38, -h * 0.54, w * 0.44, -h * 0.22, w * 0.20, -h * 0.11); ctx.bezierCurveTo(w * 0.64, h * 0.03, w * 0.62, h * 0.42, w * 0.31, h * 0.52); ctx.bezierCurveTo(w * 0.16, h * 0.59, -w * 0.16, h * 0.59, -w * 0.31, h * 0.52); ctx.bezierCurveTo(-w * 0.62, h * 0.42, -w * 0.64, h * 0.03, -w * 0.20, -h * 0.11); ctx.bezierCurveTo(-w * 0.44, -h * 0.22, -w * 0.38, -h * 0.54, 0, -h * 0.55); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (s.melted) { ctx.globalAlpha = 0.45; ctx.fillStyle = s.jellyColor; ctx.beginPath(); ctx.ellipse(0, h * 0.62, w * (0.55 + t * 0.5), h * 0.11, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  function drawCatPawPin(pin, current) {
    drawPin(pin, current);
    const s = pin.rocket; const age = current - s.startedAt; const pawProgress = clamp((current - s.swipeAt + s.duration * 0.25) / (s.duration * 0.45), 0, 1);
    const baseX = s.pawSide < 0 ? -layout.pinH * 1.4 : view.w + layout.pinH * 1.4; const targetX = pin.x + s.pawSide * layout.pinH * 0.2; const pawX = lerp(baseX, targetX, pawProgress); const pawY = pin.y - layout.pinH * 0.15 + Math.sin(age / 120) * 4;
    ctx.save(); ctx.translate(pawX, pawY); ctx.rotate((s.pawSide < 0 ? 1 : -1) * (0.18 + pawProgress * 0.3)); const size = layout.pinH * 0.72; ctx.fillStyle = "#ffd17a"; ctx.strokeStyle = "#b74f18"; ctx.lineWidth = Math.max(2, size * 0.05); ctx.beginPath(); ctx.ellipse(0, 0, size * 0.42, size * 0.32, 0, 0, TAU); ctx.fill(); ctx.stroke(); [[-0.24,-0.36],[-0.06,-0.46],[0.12,-0.46],[0.30,-0.35]].forEach(([ox,oy])=>{ctx.beginPath(); ctx.ellipse(size*ox,size*oy,size*0.11,size*0.13,0,0,TAU); ctx.fill(); ctx.stroke();}); ctx.restore();
  }

  function drawTreasurePin(pin, current) {
    const s = pin.rocket; const age = current - s.startedAt; const lid = s.burstDone ? 0.9 : clamp(age / s.duration * 1.7, 0, 0.55);
    const w = layout.pinW * 1.5, h = layout.pinH * 0.65;
    ctx.save(); ctx.translate(pin.x, pin.y + layout.pinH * 0.15); ctx.rotate(Math.sin(age / 90) * 0.05);
    ctx.fillStyle = "#a5612f"; ctx.strokeStyle = "#6e3f1d"; ctx.lineWidth = 2;
    roundRect(ctx, -w * 0.5, -h * 0.2, w, h * 0.62, 6); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.translate(0, -h * 0.18); ctx.rotate(-lid); roundRect(ctx, -w * 0.52, -h * 0.16, w * 1.04, h * 0.30, 6); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = "#ffe36d"; ctx.fillRect(-w * 0.08, h * 0.01, w * 0.16, h * 0.16); ctx.restore();
  }

  function drawToyTrainPin(pin, current) {
    const s = pin.rocket; const age = current - s.startedAt; const size = layout.pinH * 0.56;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.rotate(Math.sin(age / 120) * 0.06);
    ctx.fillStyle = "#ef3340"; roundRect(ctx, -size * 0.65, -size * 0.14, size * 0.9, size * 0.42, size * 0.12); ctx.fill();
    ctx.fillStyle = "#236dcc"; roundRect(ctx, -size * 0.10, -size * 0.34, size * 0.42, size * 0.30, size * 0.10); ctx.fill();
    ctx.fillStyle = "#ffe36d"; ctx.fillRect(-size * 0.50, -size * 0.06, size * 0.16, size * 0.11);
    ctx.fillStyle = "#333"; [-0.42,-0.05,0.28].forEach((ox)=>{ctx.beginPath(); ctx.arc(size*ox, size*0.34, size*0.12, 0, TAU); ctx.fill();});
    ctx.restore();
  }

  function drawPopcornPin(pin, current) {
    const s = pin.rocket; const age = current - s.startedAt; const pop = s.popped ? 1 : clamp(age / s.popAt, 0.1, 1);
    ctx.save(); ctx.translate(pin.x, pin.y);
    ctx.fillStyle = "#ff7070"; roundRect(ctx, -layout.pinW * 0.55, 0, layout.pinW * 1.1, layout.pinH * 0.62, 6); ctx.fill();
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; [-0.25, 0, 0.25].forEach(off=>{ctx.beginPath(); ctx.moveTo(layout.pinW*off, 3); ctx.lineTo(layout.pinW*off, layout.pinH*0.55); ctx.stroke();});
    ctx.fillStyle = "#fff8d7"; [-0.35,-0.12,0.12,0.34].forEach((ox,i)=>{ctx.beginPath(); ctx.arc(layout.pinW*ox, -layout.pinH*(0.05+0.06*Math.sin(age/120+i)), layout.pinW*(0.24 + 0.02*Math.sin(age/90+i))*pop, 0, TAU); ctx.fill();});
    ctx.restore();
  }

  function drawKitePin(pin, current) {
    const age = current - pin.rocket.startedAt;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.rotate(Math.sin(age / 140) * 0.2);
    ctx.fillStyle = pin.rocket.balloonColor; ctx.beginPath(); ctx.moveTo(0, -layout.pinH*0.42); ctx.lineTo(layout.pinW*0.55, 0); ctx.lineTo(0, layout.pinH*0.34); ctx.lineTo(-layout.pinW*0.55, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(60,80,120,0.5)"; ctx.beginPath(); ctx.moveTo(0, layout.pinH*0.34); ctx.lineTo(0, layout.pinH*0.95); ctx.stroke();
    for (let i=0;i<4;i+=1){ ctx.fillStyle=["#ffe36d","#ff9acb","#7bdfff","#63e38c"][i%4]; ctx.beginPath(); ctx.moveTo(0, layout.pinH*(0.46+i*0.12)); ctx.lineTo(layout.pinW*0.14, layout.pinH*(0.54+i*0.12)); ctx.lineTo(0, layout.pinH*(0.62+i*0.12)); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }

  function drawMagicPaintPin(pin, current) {
    const s = pin.rocket; const age = current - s.startedAt;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.rotate(-0.8 + Math.sin(age / 90) * 0.16);
    ctx.fillStyle = "#c28b42"; roundRect(ctx, -layout.pinW*0.12, -layout.pinH*0.52, layout.pinW*0.24, layout.pinH*0.88, 4); ctx.fill();
    ctx.fillStyle = s.paintColor; ctx.beginPath(); ctx.ellipse(0, -layout.pinH*0.56, layout.pinW*0.34, layout.pinH*0.14, 0, 0, TAU); ctx.fill();
    ctx.restore();
    if (s.burstDone) {
      ctx.save(); ctx.strokeStyle = s.paintColor; ctx.globalAlpha = 0.55; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(pin.x + layout.pinW*0.15, pin.y - layout.pinH*0.25, layout.pinH*0.42, Math.PI*0.8, Math.PI*1.65); ctx.stroke(); ctx.restore();
    }
  }

  function drawFlowerPin(pin, current) {
    const s = pin.rocket; const age = current - s.startedAt; const bloom = clamp(age / (s.duration * 0.55), 0.2, 1);
    ctx.save(); ctx.translate(pin.x, pin.y + layout.pinH*0.08);
    ctx.strokeStyle = "#4cae57"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, layout.pinH*0.52); ctx.quadraticCurveTo(-4, 10, 0, -layout.pinH*0.1); ctx.stroke();
    ctx.fillStyle = s.petalColor; for (let i=0;i<6;i+=1){ ctx.save(); ctx.rotate(i*TAU/6 + age/1000); ctx.beginPath(); ctx.ellipse(0, -layout.pinH*0.18*bloom, layout.pinW*0.25*bloom, layout.pinH*0.24*bloom, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = "#ffe36d"; ctx.beginPath(); ctx.arc(0, 0, layout.pinW*0.18*bloom, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawRaceCarPin(pin, current) {
    const age = current - pin.rocket.startedAt; const size = layout.pinH * 0.52;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.rotate(Math.sin(age / 150) * 0.06);
    ctx.fillStyle = "#ef3340"; roundRect(ctx, -size * 0.58, -size * 0.10, size * 1.02, size * 0.34, size * 0.12); ctx.fill();
    ctx.fillStyle = "#ffd24d"; roundRect(ctx, -size * 0.18, -size * 0.26, size * 0.34, size * 0.20, size * 0.08); ctx.fill();
    ctx.fillStyle = "#333"; [-0.35,0.22].forEach(ox=>{ctx.beginPath(); ctx.arc(size*ox, size*0.26, size*0.12, 0, TAU); ctx.fill();});
    ctx.restore();
  }

  function drawAirplanePin(pin, current) {
    const age = current - pin.rocket.startedAt;
    const size = layout.pinH * 0.58;
    ctx.save();
    ctx.translate(pin.x, pin.y);
    ctx.rotate(-0.45 + Math.sin(age / 240) * 0.04);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#7aa3d6";
    ctx.lineWidth = Math.max(2, size * 0.04);
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.86);
    ctx.lineTo(size * 1.02, size * 0.68);
    ctx.lineTo(0, size * 0.30);
    ctx.lineTo(-size * 1.02, size * 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#d91622";
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.80);
    ctx.lineTo(0, size * 0.30);
    ctx.moveTo(0, size * 0.30);
    ctx.lineTo(size * 0.60, size * 0.52);
    ctx.moveTo(0, size * 0.30);
    ctx.lineTo(-size * 0.60, size * 0.52);
    ctx.stroke();
    ctx.restore();
  }

  function drawHelicopterPin(pin, current) {
    const age = current - pin.rocket.startedAt; const size = layout.pinH * 0.54;
    ctx.save(); ctx.translate(pin.x, pin.y);
    ctx.fillStyle = "#63e38c"; roundRect(ctx, -size * 0.42, -size * 0.16, size * 0.72, size * 0.36, size * 0.16); ctx.fill();
    ctx.fillStyle = "#7bdfff"; roundRect(ctx, -size * 0.16, -size * 0.12, size * 0.28, size * 0.18, size * 0.06); ctx.fill();
    ctx.strokeStyle = "#555"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-size*0.14, size*0.24); ctx.lineTo(size*0.34, size*0.24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-size*0.52, -size*0.30); ctx.lineTo(size*0.52, -size*0.30); ctx.stroke();
    ctx.save(); ctx.rotate(age / 80); ctx.beginPath(); ctx.moveTo(-size*0.66, -size*0.30); ctx.lineTo(size*0.66, -size*0.30); ctx.moveTo(0, -size*0.96); ctx.lineTo(0, size*0.36); ctx.stroke(); ctx.restore();
    ctx.restore();
  }

  function drawBusPin(pin, current) {
    const age = current - pin.rocket.startedAt; const size = layout.pinH * 0.56;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.rotate(Math.sin(age / 180) * 0.04);
    ctx.fillStyle = "#ffd24d"; roundRect(ctx, -size * 0.64, -size * 0.18, size * 1.18, size * 0.46, size * 0.10); ctx.fill();
    ctx.fillStyle = "#7bdfff"; [-0.40,-0.18,0.04,0.26].forEach(ox=>ctx.fillRect(size*ox, -size*0.11, size*0.15, size*0.14));
    ctx.fillStyle = "#333"; [-0.42,0.24].forEach(ox=>{ctx.beginPath(); ctx.arc(size*ox, size*0.30, size*0.12, 0, TAU); ctx.fill();});
    ctx.restore();
  }

  function drawBulldozerPin(pin, current) {
    const age = current - pin.rocket.startedAt; const size = layout.pinH * 0.58;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.rotate(Math.sin(age / 180) * 0.03);
    ctx.fillStyle = "#ffb739"; roundRect(ctx, -size * 0.48, -size * 0.10, size * 0.72, size * 0.34, size * 0.10); ctx.fill();
    ctx.fillStyle = "#7bdfff"; roundRect(ctx, -size * 0.10, -size * 0.28, size * 0.26, size * 0.20, size * 0.05); ctx.fill();
    ctx.fillStyle = "#555"; ctx.fillRect(size*0.14, size*0.00, size*0.32, size*0.06);
    ctx.beginPath(); ctx.moveTo(size*0.42, -size*0.08); ctx.lineTo(size*0.74, size*0.08); ctx.lineTo(size*0.42, size*0.24); ctx.closePath(); ctx.fillStyle = "#d3c088"; ctx.fill();
    ctx.fillStyle = "#333"; [-0.26,0.00].forEach(ox=>{ctx.beginPath(); ctx.arc(size*ox, size*0.26, size*0.11, 0, TAU); ctx.fill();});
    ctx.restore();
  }

  function drawBunnyPin(pin, current) {
    const age = current - pin.rocket.startedAt;
    const size = layout.pinH * 0.56;
    ctx.save();
    ctx.translate(pin.x, pin.y);
    ctx.rotate(Math.sin(age / 140) * 0.08);
    ctx.fillStyle = "#f3e3cf";
    ctx.strokeStyle = "#7a5f52";
    ctx.lineWidth = Math.max(2, size * 0.035);
    ctx.beginPath();
    ctx.ellipse(0, size * 0.10, size * 0.28, size * 0.18, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(size * 0.22, -size * 0.04, size * 0.14, size * 0.12, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    [[size * 0.12, -size * 0.52], [size * 0.24, -size * 0.50]].forEach(([ex, ey]) => {
      ctx.fillStyle = "#f3e3cf";
      ctx.beginPath();
      ctx.ellipse(ex, ey, size * 0.05, size * 0.18, -0.1, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ff8ab3";
      ctx.beginPath();
      ctx.ellipse(ex, ey + size * 0.01, size * 0.024, size * 0.11, -0.1, 0, TAU);
      ctx.fill();
    });
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(-size * 0.24, size * 0.14, size * 0.10, size * 0.09, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.ellipse(size * 0.26, -size * 0.08, size * 0.035, size * 0.045, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(size * 0.245, -size * 0.095, size * 0.012, size * 0.012, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ff8ab3";
    ctx.beginPath();
    ctx.ellipse(size * 0.33, -size * 0.02, size * 0.03, size * 0.02, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#e33b51";
    roundRect(ctx, size * 0.05, size * 0.14, size * 0.18, size * 0.08, size * 0.03);
    ctx.fill();
    ctx.restore();
  }

  function drawFrogPin(pin, current) {
    const age = current - pin.rocket.startedAt;
    const size = layout.pinH * 0.56;
    const jump = (Math.sin(age / 500) + 1) / 2;
    ctx.save();
    ctx.translate(pin.x, pin.y - jump * size * 0.16);
    ctx.scale(1 + 0.12 * (1 - jump), 1 - 0.10 * (1 - jump));
    ctx.fillStyle = "#43a946";
    ctx.beginPath();
    ctx.ellipse(0, size * 0.08, size * 0.30, size * 0.18, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(size * 0.22, -size * 0.04, size * 0.15, size * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#2d7e33";
    ctx.lineWidth = Math.max(3, size * 0.05);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-size * 0.16, size * 0.18);
    ctx.lineTo(-size * 0.36, size * 0.30);
    ctx.lineTo(-size * 0.46, size * 0.22);
    ctx.moveTo(size * 0.12, size * 0.18);
    ctx.lineTo(size * 0.34, size * 0.32);
    ctx.lineTo(size * 0.46, size * 0.22);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(size * 0.15, -size * 0.16, size * 0.05, size * 0.05, 0, 0, TAU);
    ctx.ellipse(size * 0.29, -size * 0.15, size * 0.05, size * 0.05, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#111111";
    ctx.beginPath();
    ctx.ellipse(size * 0.15, -size * 0.16, size * 0.02, size * 0.02, 0, 0, TAU);
    ctx.ellipse(size * 0.29, -size * 0.15, size * 0.02, size * 0.02, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawFishPin(pin, current) {
    const age = current - pin.rocket.startedAt; const size = layout.pinH * 0.56;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.rotate(Math.sin(age / 110) * 0.18); ctx.fillStyle = "#66d4ff";
    ctx.beginPath(); ctx.ellipse(0, 0, size * 0.34, size * 0.20, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-size*0.34, 0); ctx.lineTo(-size*0.58, -size*0.18); ctx.lineTo(-size*0.58, size*0.18); ctx.closePath(); ctx.fill();
    ctx.fillStyle="#7beec9"; ctx.beginPath(); ctx.moveTo(0, -size*0.18); ctx.lineTo(size*0.10, -size*0.34); ctx.lineTo(size*0.18, -size*0.10); ctx.closePath(); ctx.fill();
    ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(size*0.16, -size*0.04, size*0.03, 0, TAU); ctx.fill(); ctx.restore();
  }

  function drawBirdPin(pin, current) {
    const age = current - pin.rocket.startedAt; const size = layout.pinH * 0.50; const flap = Math.sin(age / 90) * 0.45;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.fillStyle = "#ffd96b"; ctx.beginPath(); ctx.ellipse(0, 0, size * 0.24, size * 0.18, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.rotate(-0.45 + flap); ctx.beginPath(); ctx.ellipse(-size*0.16, -size*0.04, size*0.18, size*0.08, -0.2, 0, TAU); ctx.fill(); ctx.restore();
    ctx.save(); ctx.rotate(0.45 - flap); ctx.beginPath(); ctx.ellipse(size*0.16, -size*0.04, size*0.18, size*0.08, 0.2, 0, TAU); ctx.fill(); ctx.restore();
    ctx.fillStyle="#f49b24"; ctx.beginPath(); ctx.moveTo(size*0.22, 0); ctx.lineTo(size*0.34, -size*0.04); ctx.lineTo(size*0.34, size*0.04); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawPenguinPin(pin, current) {
    const age = current - pin.rocket.startedAt; const size = layout.pinH * 0.56;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.rotate(Math.sin(age / 180) * 0.06); ctx.fillStyle = "#1e2432";
    ctx.beginPath(); ctx.ellipse(0, 0, size * 0.24, size * 0.34, 0, 0, TAU); ctx.fill();
    ctx.fillStyle="#ffffff"; ctx.beginPath(); ctx.ellipse(0, size*0.04, size*0.14, size*0.22, 0, 0, TAU); ctx.fill();
    ctx.fillStyle="#f49b24"; ctx.beginPath(); ctx.moveTo(0, size*0.02); ctx.lineTo(size*0.10, size*0.08); ctx.lineTo(0, size*0.12); ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function drawDogPin(pin, current) {
    const age = current - pin.rocket.startedAt;
    const size = layout.pinH * 0.56;
    ctx.save();
    ctx.translate(pin.x, pin.y);
    ctx.rotate(Math.sin(age / 160) * 0.12);
    ctx.fillStyle = "#d69c6a";
    ctx.beginPath();
    ctx.ellipse(0, size * 0.06, size * 0.32, size * 0.16, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(size * 0.28, -size * 0.04, size * 0.15, size * 0.14, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#8b5e3c";
    ctx.beginPath();
    ctx.ellipse(size * 0.18, -size * 0.12, size * 0.07, size * 0.16, -0.45, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(size * 0.36, -size * 0.10, size * 0.07, size * 0.16, 0.45, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#d69c6a";
    [-0.18, -0.05, 0.10, 0.24].forEach(ox => { ctx.fillRect(size * ox, size * 0.18, size * 0.07, size * 0.18); });
    ctx.fillStyle = "#f7f2ef";
    ctx.beginPath();
    ctx.ellipse(size * 0.33, -size * 0.01, size * 0.06, size * 0.05, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#8b5e3c";
    ctx.lineWidth = Math.max(3, size * 0.045);
    ctx.beginPath();
    ctx.moveTo(-size * 0.28, size * 0.02);
    ctx.quadraticCurveTo(-size * 0.44, -size * 0.16, -size * 0.50, size * 0.02);
    ctx.stroke();
    ctx.fillStyle = "#e33b51";
    ctx.fillRect(size * 0.20, size * 0.12, size * 0.18, size * 0.05);
    ctx.fillStyle = "#ffd24d";
    ctx.beginPath();
    ctx.arc(size * 0.28, size * 0.145, size * 0.04, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.ellipse(size * 0.31, -size * 0.08, size * 0.03, size * 0.04, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(size * 0.30, -size * 0.095, size * 0.012, size * 0.012, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }


  function drawSportStreaks(age, color = "rgba(255,255,255,0.55)") {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, layout.pinW * 0.10);
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-layout.pinH * (0.60 + i * 0.18), layout.pinH * (0.15 - i * 0.12));
      ctx.quadraticCurveTo(-layout.pinH * (0.35 + i * 0.12), -layout.pinH * 0.02, -layout.pinH * 0.10, -layout.pinH * 0.04);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSportBall(x, y, r, fill, stroke = "#333") {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawBatBaseballPin(pin, current) {
    const age = current - pin.rocket.startedAt; const s = layout.pinH * 0.58; const swing = Math.sin(Math.min(1, age / 650) * Math.PI) * 0.95;
    ctx.save(); ctx.translate(pin.x, pin.y); drawSportStreaks(age, "rgba(255,231,125,0.55)");
    ctx.rotate(-0.75 + swing); ctx.fillStyle = "#b97843"; roundRect(ctx, -s * 0.08, -s * 0.48, s * 0.16, s * 0.92, s * 0.08); ctx.fill(); ctx.restore();
    drawSportBall(pin.x + s * 0.40 + Math.sin(age/180)*6, pin.y - s * 0.08, s * 0.12, "#ffffff", "#c73b3b");
  }

  function drawBasketballDribblePin(pin, current) {
    const age = current - pin.rocket.startedAt; const s = layout.pinH * 0.58; const bounce = Math.abs(Math.sin(age / 180));
    ctx.save(); ctx.translate(pin.x, pin.y - bounce * s * 0.28); drawSportStreaks(age, "rgba(255,138,28,0.35)");
    drawSportBall(0, 0, s * 0.24, "#e97925", "#5c2d12");
    ctx.strokeStyle = "#5c2d12"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-s*.22,0); ctx.lineTo(s*.22,0); ctx.moveTo(0,-s*.22); ctx.lineTo(0,s*.22); ctx.arc(0,0,s*.24,Math.PI*0.28,Math.PI*0.72); ctx.arc(0,0,s*.24,-Math.PI*0.72,-Math.PI*0.28); ctx.stroke();
    ctx.restore();
    ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = "#315e8f"; ctx.beginPath(); ctx.ellipse(pin.x, pin.y + s * 0.36, s * 0.30, s * 0.07, 0, 0, TAU); ctx.fill(); ctx.restore();
  }

  function drawBasketballHoopPin(pin, current) {
    const age = current - pin.rocket.startedAt; const s = layout.pinH * 0.56; const arc = Math.sin(Math.min(1, age / 900) * Math.PI);
    ctx.save(); ctx.translate(pin.x, pin.y); drawSportStreaks(age, "rgba(255,138,28,0.40)");
    ctx.strokeStyle = "#ef3340"; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(s * 0.25, -s * 0.12, s * 0.25, s * 0.08, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 2; for(let i=0;i<5;i++){ ctx.beginPath(); ctx.moveTo(s*(0.05+i*.10), -s*.05); ctx.lineTo(s*(0.00+i*.10), s*.20); ctx.stroke(); }
    drawSportBall(-s * 0.25 + arc * s * 0.55, -s * 0.35 + Math.sin(age/250)*5, s * 0.13, "#e97925", "#5c2d12"); ctx.restore();
  }

  function drawHockeyPuckPin(pin, current) {
    const age = current - pin.rocket.startedAt; const s = layout.pinH * 0.58; const slap = Math.sin(Math.min(1, age / 520) * Math.PI) * 0.70;
    ctx.save(); ctx.translate(pin.x, pin.y); drawSportStreaks(age, "rgba(223,247,255,0.65)");
    ctx.rotate(-0.65 + slap); ctx.strokeStyle = "#222"; ctx.lineWidth = 7; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(-s*.34,-s*.40); ctx.lineTo(s*.12,s*.25); ctx.lineTo(s*.42,s*.20); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.fillStyle = "#111"; ctx.beginPath(); ctx.ellipse(pin.x + s*.42, pin.y + s*.18, s*.18, s*.07, 0, 0, TAU); ctx.fill(); ctx.restore();
  }

  function drawCurlingPin(pin, current) {
    const age = current - pin.rocket.startedAt; const s = layout.pinH * 0.58;
    ctx.save(); ctx.translate(pin.x, pin.y); drawSportStreaks(age, "rgba(223,247,255,0.65)");
    ctx.fillStyle = "rgba(220,247,255,.45)"; roundRect(ctx, -s*.55, s*.17, s*1.10, s*.10, s*.05); ctx.fill();
    ctx.fillStyle = "#9aa3af"; ctx.beginPath(); ctx.ellipse(s*.12, s*.12, s*.26, s*.14, 0, 0, TAU); ctx.fill(); ctx.fillStyle = "#ef3340"; roundRect(ctx, s*.03, -s*.05, s*.18, s*.10, s*.04); ctx.fill();
    ctx.rotate(Math.sin(age/160)*0.10); ctx.strokeStyle = "#7b4a23"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-s*.45, -s*.42); ctx.lineTo(-s*.06, s*.20); ctx.stroke(); ctx.restore();
  }

  function drawFootballThrowPin(pin, current) {
    const age = current - pin.rocket.startedAt; const s = layout.pinH * 0.58;
    ctx.save(); ctx.translate(pin.x, pin.y); ctx.rotate(-0.40 + Math.sin(age/160)*0.12); drawSportStreaks(age, "rgba(255,255,255,0.48)");
    ctx.fillStyle = "#8b4a24"; ctx.strokeStyle = "#4b260f"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, s*.34, s*.19, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-s*.12,0); ctx.lineTo(s*.12,0); for(let i=-2;i<=2;i++){ctx.moveTo(i*s*.035,-s*.04); ctx.lineTo(i*s*.035,s*.04);} ctx.stroke(); ctx.restore();
  }

  function drawSoccerGoalPin(pin, current) {
    const age = current - pin.rocket.startedAt; const s = layout.pinH * 0.56; const kick = Math.sin(Math.min(1, age/800)*Math.PI);
    ctx.save(); ctx.translate(pin.x, pin.y); drawSportStreaks(age, "rgba(255,255,255,0.55)");
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; roundRect(ctx, s*.16, -s*.28, s*.58, s*.46, 3); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth=1.5; for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(s*(.16+i*.145),-s*.28);ctx.lineTo(s*(.16+i*.145),s*.18);ctx.stroke();}
    drawSportBall(-s*.34 + kick*s*.75, -s*.05, s*.13, "#ffffff", "#222"); ctx.restore();
  }

  function drawTennisServePin(pin, current) {
    const age = current - pin.rocket.startedAt; const s = layout.pinH * 0.56; const swing = Math.sin(Math.min(1,age/650)*Math.PI)*0.95;
    ctx.save(); ctx.translate(pin.x, pin.y); drawSportStreaks(age, "rgba(195,255,82,0.45)"); ctx.rotate(-0.60+swing);
    ctx.strokeStyle="#415a77"; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(-s*.10,s*.34); ctx.lineTo(s*.18,-s*.12); ctx.stroke(); ctx.beginPath(); ctx.ellipse(s*.25,-s*.24,s*.18,s*.24,.25,0,TAU); ctx.stroke(); ctx.restore();
    drawSportBall(pin.x+s*.40, pin.y-s*.35+Math.sin(age/150)*4, s*.08, "#ccff33", "#6b8e00");
  }

  function drawGolfDrivePin(pin, current) {
    const age = current - pin.rocket.startedAt; const s = layout.pinH * 0.58; const swing = Math.sin(Math.min(1,age/700)*Math.PI)*1.1;
    ctx.save(); ctx.translate(pin.x, pin.y); drawSportStreaks(age, "rgba(255,255,255,0.45)"); ctx.rotate(-0.75+swing); ctx.strokeStyle="#555"; ctx.lineWidth=4; ctx.beginPath(); ctx.moveTo(-s*.15,-s*.40); ctx.lineTo(s*.20,s*.34); ctx.lineTo(s*.34,s*.32); ctx.stroke(); ctx.restore();
    drawSportBall(pin.x+s*.45, pin.y+s*.25, s*.07, "#ffffff", "#bbb");
  }

  function drawVolleyballSpikePin(pin, current) {
    const age = current - pin.rocket.startedAt; const s = layout.pinH * 0.58; const hit = Math.sin(Math.min(1,age/600)*Math.PI);
    ctx.save(); ctx.translate(pin.x, pin.y); drawSportStreaks(age, "rgba(255,255,255,0.50)");
    drawSportBall(0, -s*.25 + hit*s*.25, s*.19, "#ffffff", "#315e8f"); ctx.fillStyle="#ffd17a"; ctx.beginPath(); ctx.ellipse(s*.28,-s*.32+hit*s*.25,s*.13,s*.08,-.4,0,TAU); ctx.fill(); ctx.restore();
  }

  function drawBaseballCatchPin(pin, current) {
    const age = current - pin.rocket.startedAt; const s=layout.pinH*.58; const close=Math.min(1,age/700);
    ctx.save(); ctx.translate(pin.x,pin.y); drawSportStreaks(age,"rgba(255,255,255,.45)"); ctx.fillStyle="#b97843"; ctx.strokeStyle="#6f3e1c"; ctx.lineWidth=3; ctx.beginPath(); ctx.ellipse(0,0,s*.28,s*.34,-.4,0,TAU); ctx.fill(); ctx.stroke(); ctx.strokeStyle="#5c2d12"; for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(i*s*.055,-s*.24);ctx.lineTo(i*s*.035,s*.22);ctx.stroke();} ctx.restore();
    drawSportBall(pin.x+s*(.42-close*.28), pin.y-s*(.16-close*.08), s*.09, "#ffffff", "#c73b3b");
  }

  function drawBowlingStrikePin(pin, current) {
    const age = current - pin.rocket.startedAt; const s=layout.pinH*.58; ctx.save(); ctx.translate(pin.x,pin.y); drawSportStreaks(age,"rgba(255,231,125,.45)");
    drawSportBall(-s*.28+Math.sin(age/220)*4,s*.08,s*.18,"#2b3f67","#14213d");
    for(let i=0;i<4;i++){ctx.save();ctx.translate(s*(.14+i*.13),-s*(.18-(i%2)*.12));ctx.rotate(-.55+Math.sin(age/120+i)*.15);ctx.fillStyle="#fff9ee";roundRect(ctx,-s*.045,-s*.18,s*.09,s*.34,s*.045);ctx.fill();ctx.fillStyle="#d91622";ctx.fillRect(-s*.04,-s*.07,s*.08,s*.025);ctx.restore();} ctx.restore();
  }

  function drawSkiJumpPin(pin, current) {
    const age=current-pin.rocket.startedAt; const s=layout.pinH*.58; const jump=Math.sin(Math.min(1,age/900)*Math.PI);
    ctx.save();ctx.translate(pin.x,pin.y-jump*s*.25);ctx.rotate(-.28+jump*.38);drawSportStreaks(age,"rgba(223,247,255,.7)");ctx.strokeStyle="#ffffff";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-s*.42,s*.30);ctx.lineTo(s*.44,s*.20);ctx.moveTo(-s*.36,s*.40);ctx.lineTo(s*.50,s*.30);ctx.stroke();ctx.fillStyle="#e33b51";ctx.beginPath();ctx.ellipse(0,-s*.03,s*.13,s*.24,0,0,TAU);ctx.fill();ctx.fillStyle="#ffd17a";ctx.beginPath();ctx.arc(0,-s*.30,s*.09,0,TAU);ctx.fill();ctx.restore();
  }

  function drawGymnasticsFlipPin(pin, current) {
    const age=current-pin.rocket.startedAt; const s=layout.pinH*.58; ctx.save();ctx.translate(pin.x,pin.y);drawSportStreaks(age,"rgba(255,154,203,.45)");ctx.rotate(age/250);ctx.strokeStyle="#8a5cff";ctx.lineWidth=5;ctx.lineCap="round";ctx.beginPath();ctx.arc(0,0,s*.28,Math.PI*.15,Math.PI*1.85);ctx.stroke();ctx.fillStyle="#ffd17a";ctx.beginPath();ctx.arc(0,-s*.33,s*.09,0,TAU);ctx.fill();ctx.fillStyle="#ff5a8e";ctx.beginPath();ctx.ellipse(0,0,s*.13,s*.20,0,0,TAU);ctx.fill();ctx.restore();
  }

  function drawRoller() {
    const x = layout.rollerX;
    const y = layout.rollerY;
    const r = layout.ballR;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const baseGrad = ctx.createLinearGradient(x - r * 2.0, y - r * 0.8, x + r * 2.0, y + r * 1.3);
    baseGrad.addColorStop(0, "#b99aff");
    baseGrad.addColorStop(0.55, "#8058dc");
    baseGrad.addColorStop(1, "#5130a8");
    ctx.fillStyle = baseGrad;
    ctx.strokeStyle = "rgba(55,35,125,0.62)";
    ctx.lineWidth = Math.max(2, r * 0.08);
    roundRect(ctx, x - r * 1.55, y - r * 0.16, r * 3.10, r * 1.15, r * 0.34);
    ctx.fill();
    ctx.stroke();

    const railGrad = ctx.createLinearGradient(x - r * 1.8, y - r * 1.35, x + r * 1.8, y + r * 0.2);
    railGrad.addColorStop(0, "#ffe36d");
    railGrad.addColorStop(1, "#ffb739");
    ctx.fillStyle = railGrad;
    roundRect(ctx, x - r * 1.75, y - r * 1.03, r * 0.64, r * 1.14, r * 0.28);
    ctx.fill();
    ctx.stroke();
    roundRect(ctx, x + r * 1.11, y - r * 1.03, r * 0.64, r * 1.14, r * 0.28);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#236dcc";
    ctx.beginPath();
    ctx.arc(x, y + r * 0.56, r * 0.52, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffe36d";
    drawPaw(x, y + r * 0.55, r * 0.34);
    ctx.restore();
  }

  function drawLoadedBall(x, y, r, spin, seed = 0) {
    ctx.save();
    const grad = ctx.createRadialGradient(x - r * 0.34, y - r * 0.42, r * 0.14, x, y, r * 1.12);
    grad.addColorStop(0, "#cbe9ff");
    grad.addColorStop(0.18, "#2476c9");
    grad.addColorStop(0.56, "#0d3b83");
    grad.addColorStop(1, "#071b45");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.46)";
    ctx.lineWidth = Math.max(1.5, r * 0.055);
    ctx.stroke();

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin * 0.45 + seed * 0.2);
    ctx.fillStyle = "rgba(2,9,28,0.88)";
    ctx.beginPath();
    ctx.arc(r * 0.12, -r * 0.34, r * 0.14, 0, TAU);
    ctx.arc(r * 0.40, -r * 0.14, r * 0.13, 0, TAU);
    ctx.arc(r * 0.04, r * 0.11, r * 0.15, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.globalAlpha = 0.42;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(x - r * 0.31, y - r * 0.45, r * 0.22, r * 0.10, -0.35, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawBallTrail(ball) {
    if (!ball.trail || ball.trail.length < 2) return;
    const points = ball.trail;
    if (ball.specialType === "rainbow") {
      const colors = ["#ff4d6d", "#ffaa33", "#ffe36d", "#63e38c", "#41d6ff", "#8a5cff"];
      for (let i = 1; i < points.length; i += 1) {
        ctx.save(); ctx.strokeStyle = colors[i % colors.length]; ctx.globalAlpha = i / points.length * 0.7; ctx.lineWidth = 4 + (i / points.length) * 4; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(points[i-1].x, points[i-1].y); ctx.lineTo(points[i].x, points[i].y); ctx.stroke(); ctx.restore();
      }
    } else if (ball.specialType === "yarn") {
      ctx.save(); ctx.strokeStyle = "#ff8ab3"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.beginPath();
      points.forEach((pt, i) => { const off = Math.sin(i * 0.9 + ball.spin) * 6; if (i===0) ctx.moveTo(pt.x, pt.y); else ctx.quadraticCurveTo((points[i-1].x+pt.x)/2 + off, (points[i-1].y+pt.y)/2 - off, pt.x, pt.y); });
      ctx.stroke(); ctx.restore();
    } else if (ball.specialType === "comet" || ball.specialType === "meteor") {
      const colors = ball.specialType === "meteor" ? ["rgba(239,51,64,0.05)","rgba(255,122,49,0.18)","rgba(255,227,109,0.50)"] : ["rgba(255,255,255,0.04)","rgba(123,223,255,0.18)","rgba(255,255,255,0.45)"];
      for (let i = 1; i < points.length; i += 1) {
        ctx.save(); ctx.strokeStyle = colors[Math.min(colors.length - 1, Math.floor(i / Math.max(1, points.length / colors.length)))]; ctx.globalAlpha = i / points.length; ctx.lineWidth = 3 + (i / points.length) * 10; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(points[i-1].x, points[i-1].y); ctx.lineTo(points[i].x, points[i].y); ctx.stroke(); ctx.restore();
      }
    } else if (ball.specialType === "superbounce") {
      ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.42)"; ctx.lineWidth = 3; ctx.setLineDash([6, 8]); ctx.beginPath(); points.forEach((pt, i) => { if (i===0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); }); ctx.stroke(); ctx.restore();
    } else if (ball.specialType === "giantbounce") {
      ctx.save(); ctx.strokeStyle = "rgba(255,227,109,0.35)"; ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.beginPath(); points.forEach((pt, i) => { if (i===0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); }); ctx.stroke(); ctx.restore();
    }
  }

  function drawBall() {
    if (!game.ball) return;
    drawBallTrail(game.ball);
    const squash = game.ball.squashUntil > nowMs() ? 1 + (game.ball.specialType === "superbounce" ? 0.18 : 0.08) : 1;
    ctx.save();
    if (game.ball.specialType === "superbounce" && game.ball.squashUntil > nowMs()) { ctx.translate(game.ball.x, game.ball.y); ctx.scale(1.18, 0.84); ctx.translate(-game.ball.x, -game.ball.y); }
    if (game.ball.specialType === "giantbounce") { ctx.globalAlpha = 0.22; ctx.fillStyle = "#ffe36d"; ctx.beginPath(); ctx.arc(game.ball.x, game.ball.y, game.ball.r * 1.28 + Math.sin(game.ball.spin * 1.5) * 3, 0, TAU); ctx.fill(); }
    drawLoadedBall(game.ball.x, game.ball.y, game.ball.r, game.ball.spin, game.ball.colorSeed);
    ctx.restore();
  }

  function drawCat() {
    const x = layout.catX;
    const y = layout.catY;
    const s = layout.radius * 0.84;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Tail behind body.
    ctx.strokeStyle = "#d9651f";
    ctx.lineWidth = s * 0.28;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.3, y + s * 0.18);
    ctx.bezierCurveTo(x - s * 1.45, y - s * 0.2, x - s * 1.2, y - s * 1.25, x - s * 0.42, y - s * 0.88);
    ctx.stroke();

    // Body.
    const bodyGrad = ctx.createRadialGradient(x - s * 0.18, y - s * 0.48, s * 0.2, x, y, s * 1.2);
    bodyGrad.addColorStop(0, "#ffbd63");
    bodyGrad.addColorStop(1, "#f07b28");
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = "#b74f18";
    ctx.lineWidth = s * 0.07;
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.12, s * 0.62, s * 0.78, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Head.
    ctx.beginPath();
    ctx.arc(x, y - s * 0.65, s * 0.58, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Ears.
    ctx.fillStyle = "#f07b28";
    ctx.beginPath();
    ctx.moveTo(x - s * 0.42, y - s * 1.02);
    ctx.lineTo(x - s * 0.26, y - s * 1.55);
    ctx.lineTo(x - s * 0.04, y - s * 1.02);
    ctx.closePath();
    ctx.moveTo(x + s * 0.42, y - s * 1.02);
    ctx.lineTo(x + s * 0.26, y - s * 1.55);
    ctx.lineTo(x + s * 0.04, y - s * 1.02);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Stripes.
    ctx.strokeStyle = "#b84e18";
    ctx.lineWidth = s * 0.055;
    for (const offset of [-0.22, 0, 0.22]) {
      ctx.beginPath();
      ctx.moveTo(x + offset * s, y - s * 1.18);
      ctx.lineTo(x + offset * s * 0.7, y - s * 0.92);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - s * 0.48, y - s * 0.52);
    ctx.lineTo(x - s * 0.22, y - s * 0.58);
    ctx.moveTo(x + s * 0.48, y - s * 0.52);
    ctx.lineTo(x + s * 0.22, y - s * 0.58);
    ctx.stroke();

    // Face.
    ctx.fillStyle = "#2d1a12";
    ctx.beginPath();
    ctx.arc(x - s * 0.22, y - s * 0.68, s * 0.055, 0, TAU);
    ctx.arc(x + s * 0.22, y - s * 0.68, s * 0.055, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#ffe6ce";
    ctx.beginPath();
    ctx.ellipse(x, y - s * 0.43, s * 0.2, s * 0.15, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#65301c";
    ctx.beginPath();
    ctx.arc(x, y - s * 0.49, s * 0.045, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "#65301c";
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.42, s * 0.13, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();

    // Paws.
    ctx.fillStyle = "#ffbd63";
    ctx.strokeStyle = "#b74f18";
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.ellipse(x - s * 0.28, y + s * 0.75, s * 0.19, s * 0.12, -0.1, 0, TAU);
    ctx.ellipse(x + s * 0.28, y + s * 0.75, s * 0.19, s * 0.12, 0.1, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  function drawRotatingStatusText(current) {
    const visibleTexts = ROTATING_STATUS_TEXTS;
    const index = Math.floor((current - game.titleStartedAt) / ROTATING_TEXT_MS) % visibleTexts.length;
    const text = visibleTexts[index];
    const x = layout.statusX;
    const y = layout.statusY;
    const w = layout.statusW;
    const h = layout.statusH;

    if (w < layout.radius * 1.7) return;

    ctx.save();
    ctx.globalAlpha = 0.84;
    ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
    ctx.strokeStyle = "rgba(53, 113, 178, 0.22)";
    ctx.lineWidth = Math.max(1.5, layout.radius * 0.035);
    roundRect(ctx, x, y, w, h, Math.max(14, layout.radius * 0.28));
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#29599d";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const fontSize = clamp(w * 0.098, 12, layout.radius * 0.43);
    ctx.font = `800 ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
    drawWrappedStatusText(text, x + w * 0.08, y + h * 0.50, w * 0.84, fontSize, 3);
    ctx.restore();
  }

  function drawWrappedStatusText(text, x, centerY, maxWidth, fontSize, maxLines) {
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth || !line) {
        line = test;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);

    const clipped = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
      clipped[maxLines - 1] = `${clipped[maxLines - 1].replace(/[.,;:!?]*$/, "")}…`;
    }

    const lineHeight = fontSize * 1.16;
    const startY = centerY - ((clipped.length - 1) * lineHeight) / 2;
    for (let i = 0; i < clipped.length; i += 1) {
      ctx.fillText(clipped[i], x, startY + i * lineHeight);
    }
  }

  function drawHoldProgress(current) {
    if (!game.hold) return;
    const t = clamp((current - game.hold.startedAt) / LONG_PRESS_MS, 0, 1);
    const s = layout.ballR * 0.84;
    ctx.save();
    ctx.strokeStyle = "rgba(94, 56, 180, 0.80)";
    ctx.lineWidth = Math.max(3, s * 0.10);
    ctx.beginPath();
    ctx.arc(layout.catX, layout.catY - s * 0.38, s * 1.08, -Math.PI / 2, -Math.PI / 2 + TAU * t);
    ctx.stroke();
    ctx.restore();
  }

  function drawReward(current) {
    if (game.phase !== "reward") return;
    const t = clamp((current - game.rewardStartedAt) / LEVEL_REWARD_MS, 0, 1);
    const pulse = 1 + Math.sin(t * Math.PI * 5) * 0.035;
    const alpha = t < 0.82 ? 1 : clamp(1 - (t - 0.82) / 0.18, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = clamp(view.w * 0.20, 72, 150) * pulse;
    ctx.font = `1000 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.lineWidth = Math.max(7, size * 0.08);
    ctx.strokeStyle = "rgba(71, 55, 160, 0.72)";
    ctx.fillStyle = "#ffffff";
    ctx.strokeText("MEOW!", view.w / 2, view.h * 0.43);
    ctx.fillText("MEOW!", view.w / 2, view.h * 0.43);
    ctx.restore();
  }

  function drawTitleOverlay(current) {
    const alpha = currentTitleAlpha(current);
    if (alpha <= 0) {
      if (game.phase === "title") game.phase = "playing";
      return;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    const bg = ctx.createLinearGradient(0, 0, 0, view.h);
    bg.addColorStop(0, "rgba(54, 172, 255, 0.94)");
    bg.addColorStop(0.65, "rgba(171, 236, 255, 0.90)");
    bg.addColorStop(1, "rgba(255, 255, 255, 0.78)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.globalAlpha = alpha * 0.22;
    drawPins(current);
    drawCat();
    drawRoller();

    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const titleSize = clamp(view.w * 0.105, 36, 82);
    const y = view.h * 0.34;
    ctx.font = `1000 ${titleSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.lineWidth = Math.max(4, titleSize * 0.11);
    ctx.strokeStyle = "rgba(38, 72, 160, 0.72)";
    ctx.fillStyle = "#ffe36d";
    ctx.strokeText("Meowmoon", view.w / 2, y - titleSize * 0.34);
    ctx.fillText("Meowmoon", view.w / 2, y - titleSize * 0.34);
    ctx.font = `900 ${titleSize * 0.62}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.strokeText("Bowling", view.w / 2, y + titleSize * 0.52);
    ctx.fillText("Bowling", view.w / 2, y + titleSize * 0.52);
    ctx.font = `750 ${clamp(view.w * 0.044, 17, 28)}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.fillStyle = "#34308b";
    ctx.fillText("Tap anywhere to roll", view.w / 2, y + titleSize * 1.45);
    ctx.restore();
  }

  function drawPauseCat(cx, cy, size) {
    const s = size;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Raised paws.
    ctx.strokeStyle = "#b74f18";
    ctx.lineWidth = s * 0.14;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.42, cy + s * 0.15);
    ctx.quadraticCurveTo(cx - s * 0.95, cy - s * 0.28, cx - s * 0.72, cy - s * 0.78);
    ctx.moveTo(cx + s * 0.42, cy + s * 0.15);
    ctx.quadraticCurveTo(cx + s * 0.95, cy - s * 0.28, cx + s * 0.72, cy - s * 0.78);
    ctx.stroke();

    ctx.fillStyle = "#ffbd63";
    ctx.strokeStyle = "#b74f18";
    ctx.lineWidth = s * 0.045;
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.74, cy - s * 0.82, s * 0.20, s * 0.24, -0.25, 0, TAU);
    ctx.ellipse(cx + s * 0.74, cy - s * 0.82, s * 0.20, s * 0.24, 0.25, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Body and head.
    const bodyGrad = ctx.createRadialGradient(cx - s * 0.18, cy - s * 0.18, s * 0.2, cx, cy, s * 1.1);
    bodyGrad.addColorStop(0, "#ffbd63");
    bodyGrad.addColorStop(1, "#f07b28");
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = "#b74f18";
    ctx.lineWidth = s * 0.055;
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.24, s * 0.55, s * 0.68, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.52, s * 0.55, 0, TAU);
    ctx.fill();
    ctx.stroke();

    // Ears.
    ctx.fillStyle = "#f07b28";
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.42, cy - s * 0.83);
    ctx.lineTo(cx - s * 0.25, cy - s * 1.35);
    ctx.lineTo(cx - s * 0.03, cy - s * 0.86);
    ctx.closePath();
    ctx.moveTo(cx + s * 0.42, cy - s * 0.83);
    ctx.lineTo(cx + s * 0.25, cy - s * 1.35);
    ctx.lineTo(cx + s * 0.03, cy - s * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Tabby stripes.
    ctx.strokeStyle = "#b84e18";
    ctx.lineWidth = s * 0.045;
    for (const offset of [-0.22, 0, 0.22]) {
      ctx.beginPath();
      ctx.moveTo(cx + offset * s, cy - s * 1.02);
      ctx.lineTo(cx + offset * s * 0.65, cy - s * 0.78);
      ctx.stroke();
    }

    // Smile and face.
    ctx.fillStyle = "#2d1a12";
    ctx.beginPath();
    ctx.arc(cx - s * 0.2, cy - s * 0.56, s * 0.055, 0, TAU);
    ctx.arc(cx + s * 0.2, cy - s * 0.56, s * 0.055, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#ffe6ce";
    ctx.beginPath();
    ctx.ellipse(cx, cy - s * 0.33, s * 0.22, s * 0.15, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = "#65301c";
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.39, s * 0.045, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = "#65301c";
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.arc(cx - s * 0.06, cy - s * 0.32, s * 0.13, 0.15 * Math.PI, 0.9 * Math.PI);
    ctx.arc(cx + s * 0.06, cy - s * 0.32, s * 0.13, 0.1 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  function drawPauseOverlay() {
    if (game.phase !== "paused") return;

    ctx.save();
    ctx.fillStyle = "rgba(25, 48, 90, 0.46)";
    ctx.fillRect(0, 0, view.w, view.h);

    const cardW = Math.min(view.w * 0.86, 720);
    const cardH = Math.min(view.h * 0.52, 520);
    const cardX = (view.w - cardW) / 2;
    const cardY = view.h * 0.23;

    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.strokeStyle = "rgba(56, 98, 180, 0.35)";
    ctx.lineWidth = Math.max(3, view.w * 0.006);
    roundRect(ctx, cardX, cardY, cardW, cardH, Math.max(24, cardW * 0.045));
    ctx.fill();
    ctx.stroke();

    drawPauseCat(view.w / 2, cardY + cardH * 0.36, Math.min(cardW * 0.17, cardH * 0.22));

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#254a9a";
    const fontSize = clamp(cardW * 0.055, 22, 42);
    ctx.font = `900 ${fontSize}px system-ui, -apple-system, Segoe UI, sans-serif`;

    const lines = [
      "The game is paused.",
      "Meowmoon wants to play",
      "with you again soon"
    ];
    const startY = cardY + cardH * 0.70;
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i], view.w / 2, startY + i * fontSize * 1.18);
    }

    ctx.restore();
  }

  function drawParticles(current) {
    for (const p of game.particles) {
      const age = current - p.startedAt;
      const alpha = clamp(1 - age / p.duration, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = p.color;
      if (p.shape === "star" || p.shape === "spark") drawStar(0, 0, p.size, p.size * 0.44, 5);
      else if (p.shape === "heart") {
        drawHeart(0, 0, p.size);
      } else if (p.shape === "treat") {
        roundRect(ctx, -p.size * 0.70, -p.size * 0.38, p.size * 1.4, p.size * 0.76, p.size * 0.24);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = Math.max(1, p.size * 0.10);
        ctx.beginPath();
        ctx.moveTo(-p.size * 0.35, 0);
        ctx.lineTo(p.size * 0.35, 0);
        ctx.stroke();
      } else if (p.shape === "toy") {
        ctx.beginPath();
        ctx.arc(0, 0, p.size * 0.55, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath();
        ctx.arc(-p.size * 0.16, -p.size * 0.18, p.size * 0.14, 0, TAU);
        ctx.fill();
      } else if (p.shape === "bubble") {
        ctx.beginPath(); ctx.arc(0, 0, p.size * 0.55, 0, TAU); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); ctx.arc(-p.size * 0.14, -p.size * 0.18, p.size * 0.16, 0, TAU); ctx.fill();
      } else if (p.shape === "paw") {
        drawPaw(0, 0, p.size * 0.55);
      } else {
        roundRect(ctx, -p.size * 0.55, -p.size * 0.25, p.size * 1.1, p.size * 0.5, p.size * 0.12);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawStar(x, y, outer, inner, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i += 1) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = -Math.PI / 2 + (i * Math.PI) / points;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawHeart(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.45);
    ctx.bezierCurveTo(x - s * 0.92, y - s * 0.12, x - s * 0.45, y - s * 0.74, x, y - s * 0.30);
    ctx.bezierCurveTo(x + s * 0.45, y - s * 0.74, x + s * 0.92, y - s * 0.12, x, y + s * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  function drawPaw(x, y, s) {
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.18, s * 0.34, s * 0.30, 0, 0, TAU);
    ctx.ellipse(x - s * 0.34, y - s * 0.16, s * 0.16, s * 0.19, 0, 0, TAU);
    ctx.ellipse(x - s * 0.11, y - s * 0.31, s * 0.16, s * 0.20, 0, 0, TAU);
    ctx.ellipse(x + s * 0.13, y - s * 0.31, s * 0.16, s * 0.20, 0, 0, TAU);
    ctx.ellipse(x + s * 0.36, y - s * 0.15, s * 0.16, s * 0.19, 0, 0, TAU);
    ctx.fill();
  }

  function roundRect(context, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + w - radius, y);
    context.quadraticCurveTo(x + w, y, x + w, y + radius);
    context.lineTo(x + w, y + h - radius);
    context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    context.lineTo(x + radius, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }

  function wrapCenteredText(text, x, y, maxWidth, lineHeight) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, x, y + (i - (lines.length - 1) / 2) * lineHeight));
  }

  let lastFrame = nowMs();
  function loop(current) {
    update(current);
    lastFrame = current;
    render(current);
    requestAnimationFrame(loop);
  }

  resize();
  startLevel();
  requestAnimationFrame(loop);
})();
