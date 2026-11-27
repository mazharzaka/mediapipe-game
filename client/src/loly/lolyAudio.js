/**
 * Isolated Audio Engine for Loly World (/loly)
 * - Sequential Auto-Advancing Playlist Loop across all 3 real MP3 tracks:
 *   track1.mp3 (قشطة عليها) -> track2.mp3 (لولا البنات) -> track3.mp3 (حبيبي النانو) -> loop!
 * - Automatic Audio Ducking to 35% volume whenever funny sound effects trigger so Loly hears
 *   every duck quack, baby giggle, bubble pop, and bangle jingle crystal clearly!
 */

export const LOLY_TRACKS = [
  {
    id: 'track1',
    title: 'قشطة عليها',
    emoji: '💃',
    src: '/loly/audio/track1.mp3',
    bpm: 118,
  },
  {
    id: 'track2',
    title: 'لولا البنات',
    emoji: '🎀',
    src: '/loly/audio/track2.mp3',
    bpm: 112,
  },
  {
    id: 'track3',
    title: 'حبيبي النانو',
    emoji: '👶',
    src: '/loly/audio/track3.mp3',
    bpm: 104,
  },
];

const NORMAL_MUSIC_VOLUME = 1.0;
const DUCKED_MUSIC_VOLUME = 0.35; // 35% volume during funny SFX!

class LolySoundEngine {
  constructor() {
    this.ctx = null;
    this.audioEl = null;
    this.isPlayingMusic = false;
    this.usingFallbackSynth = false;
    this.currentTrackIndex = 0;
    this.customObjectUrl = null;
    this.synthInterval = null;
    this.synthStep = 0;
    this.lastJingleAt = 0;
    this.lastQuackAt = 0;
    this.lastGiggleAt = 0;
    this.lastClapAt = 0;
    this.muted = false;
    this.duckRestoreTimer = null;
    this.duckRampInterval = null;
    this.currentSynthGainScale = 1.0;
    this.trackListeners = new Set();
    this.hasAutoStartedOnce = false;
  }

  onTrackChange(fn) {
    this.trackListeners.add(fn);
    return () => this.trackListeners.delete(fn);
  }

  notifyTrackListeners() {
    for (const fn of this.trackListeners) {
      try {
        fn({
          trackIndex: this.currentTrackIndex,
          isPlaying: this.isPlayingMusic,
          fallback: this.usingFallbackSynth,
        });
      } catch (_) {}
    }
  }

  ensureContext() {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  ensureAudioElement() {
    if (!this.audioEl && typeof Audio !== 'undefined') {
      this.audioEl = new Audio();
      // Sequential playlist loop: when one track ends, advance automatically to the next!
      this.audioEl.loop = false;
      this.audioEl.preload = 'auto';
      this.audioEl.volume = NORMAL_MUSIC_VOLUME;
      this.audioEl.addEventListener('ended', () => {
        if (this.customObjectUrl) {
          this.audioEl.currentTime = 0;
          this.audioEl.play().catch(() => {});
          return;
        }
        const nextIdx = (this.currentTrackIndex + 1) % LOLY_TRACKS.length;
        this.playTrack(nextIdx);
      });
    }
    return this.audioEl;
  }

  /**
   * Automatically ducks background music to 35% volume during funny sound effects,
   * then smoothly restores volume to 100%.
   */
  duckMusicForEffect(holdMs = 750) {
    clearTimeout(this.duckRestoreTimer);
    clearInterval(this.duckRampInterval);

    this.currentSynthGainScale = DUCKED_MUSIC_VOLUME;
    if (this.audioEl) {
      this.audioEl.volume = DUCKED_MUSIC_VOLUME;
    }

    this.duckRestoreTimer = setTimeout(() => {
      this.duckRampInterval = setInterval(() => {
        if (!this.audioEl) {
          this.currentSynthGainScale = NORMAL_MUSIC_VOLUME;
          clearInterval(this.duckRampInterval);
          return;
        }
        const nextVol = Math.min(NORMAL_MUSIC_VOLUME, this.audioEl.volume + 0.08);
        this.audioEl.volume = nextVol;
        this.currentSynthGainScale = nextVol;
        if (nextVol >= NORMAL_MUSIC_VOLUME) {
          clearInterval(this.duckRampInterval);
        }
      }, 45);
    }, holdMs);
  }

  /**
   * Unlocks audio & auto-starts the 3-track playlist on the very first touch/click
   */
  async unlockOnFirstGesture() {
    this.ensureContext();
    if (!this.hasAutoStartedOnce) {
      this.hasAutoStartedOnce = true;
      return this.playTrack(this.currentTrackIndex);
    }
    if (this.isPlayingMusic && this.audioEl && this.audioEl.paused && !this.usingFallbackSynth) {
      try {
        await this.audioEl.play();
      } catch (_) {}
    }
    return { playing: this.isPlayingMusic, fallback: this.usingFallbackSynth };
  }

  setMuted(flag) {
    this.muted = Boolean(flag);
    if (this.audioEl) {
      this.audioEl.muted = this.muted;
    }
    if (this.muted) {
      this.stopFallbackSynth();
    } else if (this.isPlayingMusic && this.usingFallbackSynth) {
      this.startFallbackSynth();
    }
  }

  getBeatPhase(timeMs = performance.now()) {
    const track = LOLY_TRACKS[this.currentTrackIndex] || LOLY_TRACKS[0];
    const bpm = this.isPlayingMusic ? track.bpm : 98;
    const periodMs = 60000 / bpm;
    return (timeMs % periodMs) / periodMs;
  }

  // 1. Sparkling Jewelry & Diamond Bangles Jingle (رنين أساور ومجوهرات)
  playBangleJingle() {
    if (this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastJingleAt < 240) return;
    this.lastJingleAt = nowMs;

    this.duckMusicForEffect(520);
    const ctx = this.ensureContext();
    if (!ctx) return;

    const baseNow = ctx.currentTime;
    const freqs = [1760, 2349.32, 2793.83, 3520, 4186.01];
    freqs.forEach((f, idx) => {
      const start = baseNow + idx * 0.028;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(f * (0.98 + Math.random() * 0.04), start);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.09 / (1 + idx * 0.22), start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  // 2. Funny Cartoon Soap Bubble Pop ("بوب!")
  playBubblePop() {
    if (this.muted) return;
    this.duckMusicForEffect(420);
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const startFreq = 260 + Math.random() * 120;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(startFreq * 3.4, now + 0.09);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  // 3. Cheerful Rubber Duck Quack-Quack (صوت بطة مضحك وعالي الوضوح)
  playDuckQuack() {
    if (this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastQuackAt < 550) return;
    this.lastQuackAt = nowMs;

    this.duckMusicForEffect(850);
    const ctx = this.ensureContext();
    if (!ctx) return;

    const triggerSingleQuack = (offset) => {
      const t = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.linearRampToValueAtTime(250, t + 0.14);

      filter.type = 'bandpass';
      filter.Q.setValueAtTime(5.2, t);
      filter.frequency.setValueAtTime(1250, t);
      filter.frequency.exponentialRampToValueAtTime(520, t + 0.14);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    };

    triggerSingleQuack(0);
    triggerSingleQuack(0.19);
  }

  // 4. Playful Baby Giggle / Laugh Melody (ضحكة أطفال مرحة لمفاجأة ✌️)
  playBabyGiggle() {
    if (this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastGiggleAt < 800) return;
    this.lastGiggleAt = nowMs;

    this.duckMusicForEffect(1050);
    const ctx = this.ensureContext();
    if (!ctx) return;

    const base = ctx.currentTime;
    const bounces = [
      { f1: 580, f2: 860, dt: 0.0 },
      { f1: 640, f2: 960, dt: 0.13 },
      { f1: 700, f2: 1080, dt: 0.26 },
      { f1: 620, f2: 980, dt: 0.4 },
      { f1: 760, f2: 1180, dt: 0.54 },
    ];

    bounces.forEach((b) => {
      const t = base + b.dt;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(b.f1, t);
      osc.frequency.exponentialRampToValueAtTime(b.f2, t + 0.075);
      osc.frequency.exponentialRampToValueAtTime(b.f1 * 0.92, t + 0.11);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    });
  }

  // 5. Joyful Family Clapping & Cheer Chime (تصفيق مرح لقفزة العيلة 🖐️)
  playFamilyApplause() {
    if (this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastClapAt < 900) return;
    this.lastClapAt = nowMs;

    this.duckMusicForEffect(1000);
    const ctx = this.ensureContext();
    if (!ctx) return;

    const base = ctx.currentTime;
    // Synthesize 5 warm rhythmic hand-claps using filtered noise bursts
    for (let c = 0; c < 5; c++) {
      const t = base + c * 0.11;
      const bufferSize = Math.floor(ctx.sampleRate * 0.065);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.018));
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1150 + c * 80, t);
      filter.Q.setValueAtTime(2.2, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t);
    }

    this.playHappyBurst();
  }

  // 6. Happy Confetti Xylophone Arpeggio (مدفع القصاصات الملونة ✊)
  playHappyBurst() {
    if (this.muted) return;
    this.duckMusicForEffect(850);
    const ctx = this.ensureContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    const base = ctx.currentTime;
    notes.forEach((freq, i) => {
      const start = base + i * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  startFallbackSynth() {
    this.stopFallbackSynth();
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const melodies = [
      [523.25, 587.33, 659.25, 783.99, 659.25, 783.99, 880.0, 783.99],
      [659.25, 783.99, 880.0, 783.99, 659.25, 587.33, 523.25, 659.25],
      [523.25, 659.25, 587.33, 783.99, 659.25, 523.25, 587.33, 523.25],
    ];

    const track = LOLY_TRACKS[this.currentTrackIndex] || LOLY_TRACKS[0];
    const stepMs = Math.round(60000 / track.bpm / 2);
    this.synthStep = 0;

    this.synthInterval = setInterval(() => {
      if (this.muted || !this.isPlayingMusic || !this.usingFallbackSynth) return;
      const c = this.ensureContext();
      if (!c) return;
      const seq = melodies[this.currentTrackIndex % melodies.length];
      const freq = seq[this.synthStep % seq.length];
      this.synthStep++;

      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const peak = 0.045 * this.currentSynthGainScale;
      gain.gain.setValueAtTime(0.0008, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.002, peak), now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.24);

      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    }, stepMs);
  }

  stopFallbackSynth() {
    if (this.synthInterval) {
      clearInterval(this.synthInterval);
      this.synthInterval = null;
    }
  }

  async playTrack(index = this.currentTrackIndex, customFileUrl = null) {
    this.ensureContext();
    this.hasAutoStartedOnce = true;
    this.currentTrackIndex = ((index % LOLY_TRACKS.length) + LOLY_TRACKS.length) % LOLY_TRACKS.length;
    this.isPlayingMusic = true;
    this.stopFallbackSynth();

    if (!customFileUrl && this.customObjectUrl) {
      URL.revokeObjectURL(this.customObjectUrl);
      this.customObjectUrl = null;
    }

    const audio = this.ensureAudioElement();
    if (!audio) {
      this.usingFallbackSynth = true;
      this.startFallbackSynth();
      this.notifyTrackListeners();
      return { playing: true, fallback: true, trackIndex: this.currentTrackIndex };
    }

    const srcToPlay = customFileUrl || LOLY_TRACKS[this.currentTrackIndex]?.src || LOLY_TRACKS[0].src;
    audio.pause();
    audio.src = srcToPlay;
    audio.muted = this.muted;
    audio.volume = NORMAL_MUSIC_VOLUME;

    try {
      await audio.play();
      this.usingFallbackSynth = false;
      this.notifyTrackListeners();
      return { playing: true, fallback: false, trackIndex: this.currentTrackIndex };
    } catch (_) {
      this.usingFallbackSynth = true;
      this.startFallbackSynth();
      this.notifyTrackListeners();
      return { playing: true, fallback: true, trackIndex: this.currentTrackIndex };
    }
  }

  async nextTrack() {
    const nextIdx = (this.currentTrackIndex + 1) % LOLY_TRACKS.length;
    return this.playTrack(nextIdx);
  }

  loadCustomAudioFile(file) {
    if (!file) return null;
    if (this.customObjectUrl) {
      URL.revokeObjectURL(this.customObjectUrl);
    }
    this.customObjectUrl = URL.createObjectURL(file);
    return this.playTrack(this.currentTrackIndex, this.customObjectUrl);
  }

  pauseMusic() {
    this.isPlayingMusic = false;
    this.stopFallbackSynth();
    if (this.audioEl) {
      this.audioEl.pause();
    }
    this.notifyTrackListeners();
  }

  destroy() {
    clearTimeout(this.duckRestoreTimer);
    clearInterval(this.duckRampInterval);
    this.pauseMusic();
    if (this.customObjectUrl) {
      URL.revokeObjectURL(this.customObjectUrl);
      this.customObjectUrl = null;
    }
  }
}

export const lolyAudio = new LolySoundEngine();
