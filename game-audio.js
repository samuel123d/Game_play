(() => {
  const STORAGE_KEY = "conexao-game-audio-v1";

  const defaultPrefs = {
    enabled: false,
    musicVolume: 0.45,
    sfxVolume: 0.75
  };

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        enabled: Boolean(saved.enabled),
        musicVolume: typeof saved.musicVolume === "number" ? Math.min(1, Math.max(0, saved.musicVolume)) : defaultPrefs.musicVolume,
        sfxVolume: typeof saved.sfxVolume === "number" ? Math.min(1, Math.max(0, saved.sfxVolume)) : defaultPrefs.sfxVolume
      };
    } catch {
      return { ...defaultPrefs };
    }
  }

  const prefs = loadPrefs();
  let ctx = null;
  let musicGain = null;
  let sfxGain = null;
  let currentTrack = "none";
  let loopTimer = 0;
  let stepIndex = 0;

  const TRACKS = {
    lobby: {
      tempoMs: 420,
      type: "triangle",
      notes: [261.63, 329.63, 392.0, 493.88, 440.0, 392.0, 329.63, 293.66]
    },
    question: {
      tempoMs: 290,
      type: "sine",
      notes: [220.0, 220.0, 261.63, 329.63, 293.66, 293.66, 261.63, 246.94]
    },
    doublePoints: {
      tempoMs: 195,
      type: "sawtooth",
      bassType: "triangle",
      notes: [293.66, 349.23, 440.0, 523.25, 587.33, 523.25, 440.0, 392.0],
      bassNotes: [146.83, 146.83, 174.61, 174.61, 220.0, 220.0, 196.0, 196.0]
    },
    review: {
      tempoMs: 480,
      type: "sine",
      notes: [349.23, 440.0, 523.25, 493.88, 392.0, 493.88, 587.33, 523.25]
    },
    victory: {
      tempoMs: 250,
      type: "triangle",
      notes: [261.63, 329.63, 392.0, 523.25, 392.0, 523.25, 659.25, 783.99]
    }
  };

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Ignora bloqueio de storage
    }
  }

  function ensureContext() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error("Seu navegador não suporta Web Audio.");
      }
      ctx = new AudioCtx();
      musicGain = ctx.createGain();
      sfxGain = ctx.createGain();
      musicGain.gain.value = prefs.enabled ? prefs.musicVolume : 0;
      sfxGain.gain.value = prefs.enabled ? prefs.sfxVolume : 0;
      musicGain.connect(ctx.destination);
      sfxGain.connect(ctx.destination);
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function playTone(freq, durationSec, type, destination, peakGain = 0.25, delaySec = 0) {
    if (!prefs.enabled || !freq) return;
    const audioCtx = ensureContext();
    const now = audioCtx.currentTime + delaySec;

    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peakGain, now + 0.018);
    env.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(env);
    env.connect(destination);

    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  function stopLoop() {
    if (loopTimer) {
      window.clearInterval(loopTimer);
      loopTimer = 0;
    }
  }

  function startLoop(trackName) {
    stopLoop();
    const track = TRACKS[trackName];
    if (!prefs.enabled || !track) return;

    ensureContext();
    stepIndex = 0;

    const tickStep = () => {
      if (!prefs.enabled || currentTrack !== trackName) {
        stopLoop();
        return;
      }
      const idx = stepIndex % track.notes.length;
      const freq = track.notes[idx];
      const leadGain = track.type === "sawtooth" ? 0.09 : 0.16;
      playTone(freq, (track.tempoMs / 1000) * 0.85, track.type, musicGain, leadGain, 0);

      if (track.bassNotes) {
        const bassFreq = track.bassNotes[idx % track.bassNotes.length];
        playTone(bassFreq, (track.tempoMs / 1000) * 0.9, track.bassType || "triangle", musicGain, 0.18, 0);
      }
      stepIndex += 1;
    };

    tickStep();
    loopTimer = window.setInterval(tickStep, track.tempoMs);
  }

  function unlockOnGesture() {
    if (!prefs.enabled) return;
    try {
      ensureContext();
      if (currentTrack !== "none" && !loopTimer) {
        startLoop(currentTrack);
      }
    } catch {
      // Aguarda próximo gesto
    }
  }

  document.addEventListener("pointerdown", unlockOnGesture, { passive: true });
  document.addEventListener("keydown", unlockOnGesture, { passive: true });

  window.GameAudio = {
    isEnabled() {
      return prefs.enabled;
    },

    getPrefs() {
      return { ...prefs };
    },

    async setEnabled(nextState) {
      prefs.enabled = Boolean(nextState);
      savePrefs();

      if (prefs.enabled) {
        const audioCtx = ensureContext();
        if (audioCtx.state === "suspended") {
          try {
            await audioCtx.resume();
          } catch {
            // Continua
          }
        }
        if (musicGain) musicGain.gain.value = prefs.musicVolume;
        if (sfxGain) sfxGain.gain.value = prefs.sfxVolume;

        if (currentTrack !== "none") {
          startLoop(currentTrack);
        }
      } else {
        stopLoop();
        if (musicGain) musicGain.gain.value = 0;
        if (sfxGain) sfxGain.gain.value = 0;
      }

      return prefs.enabled;
    },

    setMusicVolume(value) {
      prefs.musicVolume = Math.min(1, Math.max(0, Number(value) || 0));
      if (musicGain && prefs.enabled) {
        musicGain.gain.value = prefs.musicVolume;
      }
      savePrefs();
    },

    setSfxVolume(value) {
      prefs.sfxVolume = Math.min(1, Math.max(0, Number(value) || 0));
      if (sfxGain && prefs.enabled) {
        sfxGain.gain.value = prefs.sfxVolume;
      }
      savePrefs();
    },

    setTrack(trackName) {
      const normalized = TRACKS[trackName] ? trackName : "none";
      if (currentTrack === normalized && (loopTimer || normalized === "none")) {
        return;
      }
      currentTrack = normalized;
      if (!prefs.enabled || normalized === "none") {
        stopLoop();
        return;
      }
      startLoop(normalized);
    },

    playEffect(name) {
      if (!prefs.enabled) return;
      try {
        ensureContext();
      } catch {
        return;
      }

      if (name === "join") {
        playTone(523.25, 0.11, "sine", sfxGain, 0.28, 0);
        playTone(659.25, 0.16, "sine", sfxGain, 0.28, 0.08);
      } else if (name === "select") {
        playTone(783.99, 0.09, "triangle", sfxGain, 0.26, 0);
        playTone(1046.5, 0.14, "triangle", sfxGain, 0.26, 0.06);
      } else if (name === "start") {
        playTone(523.25, 0.12, "triangle", sfxGain, 0.3, 0);
        playTone(659.25, 0.12, "triangle", sfxGain, 0.3, 0.1);
        playTone(783.99, 0.12, "triangle", sfxGain, 0.3, 0.2);
        playTone(1046.5, 0.26, "triangle", sfxGain, 0.32, 0.3);
      } else if (name === "doublePointsStart") {
        const notes = [440.0, 554.37, 659.25, 880.0, 1108.73, 1318.51];
        notes.forEach((n, idx) => {
          playTone(n, idx === notes.length - 1 ? 0.38 : 0.11, "triangle", sfxGain, 0.34, idx * 0.075);
        });
      } else if (name === "tick") {
        playTone(880.0, 0.06, "sine", sfxGain, 0.18, 0);
      } else if (name === "urgentTick") {
        playTone(1174.66, 0.09, "square", sfxGain, 0.2, 0);
      } else if (name === "correct") {
        playTone(523.25, 0.13, "triangle", sfxGain, 0.3, 0);
        playTone(659.25, 0.13, "triangle", sfxGain, 0.3, 0.09);
        playTone(783.99, 0.13, "triangle", sfxGain, 0.3, 0.18);
        playTone(1046.5, 0.32, "triangle", sfxGain, 0.34, 0.27);
      } else if (name === "champion") {
        const fanfare = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.51];
        fanfare.forEach((note, i) => {
          playTone(note, i === fanfare.length - 1 ? 0.45 : 0.14, "triangle", sfxGain, 0.34, i * 0.11);
        });
      }
    }
  };
})();