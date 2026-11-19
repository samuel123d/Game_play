(() => {
  const PREFS_KEY = "conexao-audio-prefs-v3";

  let context = null;
  let masterCompressor = null;
  let musicGain = null;
  let sfxGain = null;
  let delayNode = null;
  let delayFeedback = null;
  let delayFilter = null;
  let enabled = false;
  let currentTrack = "none";
  let trackTimer = 0;
  let trackStep = 0;

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return {
        musicVolume: typeof raw.musicVolume === "number" ? Math.min(1, Math.max(0, raw.musicVolume)) : 0.65,
        sfxVolume: typeof raw.sfxVolume === "number" ? Math.min(1, Math.max(0, raw.sfxVolume)) : 0.85
      };
    } catch {
      return { musicVolume: 0.65, sfxVolume: 0.85 };
    }
  }

  let prefs = loadPrefs();

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Ignora erro de storage
    }
  }

  function applyVolumes() {
    if (!context) return;
    const now = context.currentTime;
    if (musicGain) {
      musicGain.gain.setTargetAtTime(enabled ? prefs.musicVolume * 0.22 : 0.0001, now, 0.05);
    }
    if (sfxGain) {
      sfxGain.gain.setTargetAtTime(enabled ? prefs.sfxVolume * 0.36 : 0.0001, now, 0.02);
    }
  }

  function prepare() {
    if (context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Este navegador não oferece suporte a áudio.");
    context = new AudioContext();

    masterCompressor = context.createDynamicsCompressor();
    masterCompressor.threshold.value = -18;
    masterCompressor.knee.value = 18;
    masterCompressor.ratio.value = 4;
    masterCompressor.attack.value = 0.005;
    masterCompressor.release.value = 0.18;
    masterCompressor.connect(context.destination);

    // Ambiência sutil para dar profundidade aos acordes e sinos
    delayNode = context.createDelay(1.0);
    delayNode.delayTime.value = 0.22;
    delayFilter = context.createBiquadFilter();
    delayFilter.type = "lowpass";
    delayFilter.frequency.value = 1850;
    delayFeedback = context.createGain();
    delayFeedback.gain.value = 0.24;

    delayNode.connect(delayFilter);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayFilter.connect(masterCompressor);

    musicGain = context.createGain();
    musicGain.gain.value = 0.0001;
    musicGain.connect(masterCompressor);
    musicGain.connect(delayNode);

    sfxGain = context.createGain();
    sfxGain.gain.value = 0.0001;
    sfxGain.connect(masterCompressor);

    applyVolumes();
  }

  function playVoice(bus, {
    freq,
    endFreq = null,
    duration = 0.22,
    wave = "triangle",
    volume = 0.24,
    delay = 0,
    attack = 0.015,
    cutoff = 3200,
    sendAmbience = false
  }) {
    if (!enabled || !context || !bus) return;
    const start = context.currentTime + delay;
    const osc = context.createOscillator();
    const filter = context.createBiquadFilter();
    const env = context.createGain();

    osc.type = wave;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq && endFreq > 0) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    }

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(400, cutoff * 0.55), start + duration);

    const peak = Math.max(0.001, volume);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(filter);
    filter.connect(env);
    env.connect(bus);
    if (sendAmbience && delayNode) {
      const wet = context.createGain();
      wet.gain.value = 0.22;
      env.connect(wet);
      wet.connect(delayNode);
    }

    osc.start(start);
    osc.stop(start + duration + 0.04);
  }

  function playNoiseHat(bus, duration = 0.045, volume = 0.08, delay = 0) {
    if (!enabled || !context || !bus) return;
    const start = context.currentTime + delay;
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = context.createBufferSource();
    noise.buffer = buffer;

    const filter = context.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(5200, start);

    const env = context.createGain();
    env.gain.setValueAtTime(Math.max(0.001, volume), start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    noise.connect(filter);
    filter.connect(env);
    env.connect(bus);
    noise.start(start);
    noise.stop(start + duration + 0.01);
  }

  const TRACKS = {
    lobby: {
      tempoMs: 340,
      tick(step) {
        // Progressão acolhedora estilo Rhodes (Cmaj9 -> Am9 -> Fmaj9 -> G13)
        const progressions = [
          { bass: 130.81, chord: [261.63, 329.63, 392.0, 493.88], arp: [523.25, 659.25, 587.33, 493.88] },
          { bass: 110.0,  chord: [220.0, 261.63, 329.63, 392.0],  arp: [493.88, 587.33, 523.25, 392.0] },
          { bass: 87.31,  chord: [174.61, 220.0, 261.63, 329.63], arp: [440.0, 523.25, 493.88, 392.0] },
          { bass: 98.0,   chord: [196.0, 246.94, 293.66, 349.23], arp: [392.0, 493.88, 587.33, 493.88] }
        ];
        const bar = Math.floor(step / 4) % progressions.length;
        const beat = step % 4;
        const current = progressions[bar];

        if (beat === 0) {
          playVoice(musicGain, { freq: current.bass, duration: 1.15, wave: "sine", volume: 0.26, cutoff: 650 });
          current.chord.forEach((f, i) => {
            playVoice(musicGain, {
              freq: f,
              duration: 1.1,
              wave: "triangle",
              volume: 0.085,
              delay: i * 0.025,
              attack: 0.04,
              cutoff: 1600
            });
          });
        }
        playVoice(musicGain, {
          freq: current.arp[beat],
          duration: 0.28,
          wave: "sine",
          volume: 0.13,
          cutoff: 2400
        });
      }
    },

    countdown: {
      tempoMs: 460,
      tick(step) {
        const pulse = [220, 246.94, 277.18, 329.63, 369.99, 440];
        const freq = pulse[Math.min(step, pulse.length - 1)];
        playVoice(musicGain, { freq, duration: 0.2, wave: "triangle", volume: 0.24, cutoff: 2200 });
        playVoice(musicGain, { freq: freq * 0.5, duration: 0.28, wave: "sine", volume: 0.22, cutoff: 700 });
      }
    },

    question: {
      tempoMs: 250,
      tick(step) {
        // Groove de quiz dinâmico e leve (marimba + baixo sincopado + chimbal sutil)
        const motif = [293.66, 349.23, 440.0, 349.23, 329.63, 392.0, 493.88, 392.0];
        const bass = [146.83, 0, 146.83, 174.61, 130.81, 0, 130.81, 164.81];
        const idx = step % motif.length;

        playVoice(musicGain, {
          freq: motif[idx],
          duration: 0.17,
          wave: "triangle",
          volume: 0.15,
          attack: 0.008,
          cutoff: 2100
        });

        if (bass[idx]) {
          playVoice(musicGain, {
            freq: bass[idx],
            duration: 0.22,
            wave: "sine",
            volume: 0.24,
            attack: 0.01,
            cutoff: 600
          });
        }

        if (idx % 2 === 1) {
          playNoiseHat(musicGain, 0.035, 0.045);
        }
      }
    },

    review: {
      tempoMs: 420,
      tick(step) {
        const chords = [
          [261.63, 329.63, 392.0, 493.88],
          [220.0, 261.63, 329.63, 392.0],
          [174.61, 220.0, 261.63, 349.23],
          [196.0, 246.94, 293.66, 392.0]
        ];
        if (step % 2 === 0) {
          const chord = chords[(step / 2) % chords.length];
          chord.forEach((f, i) => {
            playVoice(musicGain, {
              freq: f,
              duration: 0.72,
              wave: "sine",
              volume: 0.1,
              delay: i * 0.035,
              attack: 0.05,
              cutoff: 1800
            });
          });
        }
      }
    },

    victory: {
      tempoMs: 260,
      tick(step) {
        const fanfare = [523.25, 659.25, 783.99, 1046.5, 880.0, 1046.5, 1174.66, 1046.5];
        const bass = [261.63, 196.0, 261.63, 329.63, 293.66, 220.0, 293.66, 392.0];
        const idx = step % fanfare.length;
        playVoice(musicGain, {
          freq: fanfare[idx],
          duration: 0.22,
          wave: "triangle",
          volume: 0.19,
          cutoff: 3000
        });
        playVoice(musicGain, {
          freq: bass[idx],
          duration: 0.26,
          wave: "sine",
          volume: 0.22,
          cutoff: 900
        });
        if (idx % 2 === 0) {
          playNoiseHat(musicGain, 0.04, 0.05);
        }
      }
    }
  };

  function stopTrack() {
    window.clearInterval(trackTimer);
    trackTimer = 0;
  }

  function setTrack(trackName) {
    const next = TRACKS[trackName] ? trackName : "none";
    if (next === currentTrack && trackTimer) return;
    currentTrack = next;
    stopTrack();
    if (!enabled || currentTrack === "none" || document.hidden) return;
    const track = TRACKS[currentTrack];
    trackStep = 0;
    track.tick(trackStep++);
    trackTimer = window.setInterval(() => {
      if (!enabled || document.hidden) return;
      track.tick(trackStep++);
    }, track.tempoMs);
  }

  async function setEnabled(value) {
    enabled = Boolean(value);
    if (enabled) {
      prepare();
      await context.resume();
      applyVolumes();
      if (currentTrack !== "none" && !trackTimer) {
        const restartName = currentTrack;
        currentTrack = "none";
        setTrack(restartName);
      }
    } else {
      stopTrack();
      applyVolumes();
    }
    return enabled;
  }

  function setMusicVolume(val) {
    prefs.musicVolume = Math.min(1, Math.max(0, Number(val)));
    savePrefs();
    applyVolumes();
  }

  function setSfxVolume(val) {
    prefs.sfxVolume = Math.min(1, Math.max(0, Number(val)));
    savePrefs();
    applyVolumes();
  }

  function playEffect(kind) {
    if (!enabled || !context || !sfxGain) return;
    if (context.state === "suspended") {
      void context.resume();
    }

    switch (kind) {
      case "select":
        playVoice(sfxGain, { freq: 520, endFreq: 680, duration: 0.07, wave: "sine", volume: 0.22, attack: 0.005, cutoff: 3400 });
        break;

      case "start":
        // Vinheta de início de partida
        [261.63, 329.63, 392.0, 523.25].forEach((freq, i) => {
          playVoice(sfxGain, {
            freq,
            duration: i === 3 ? 0.45 : 0.15,
            wave: "triangle",
            volume: 0.3,
            delay: i * 0.075,
            cutoff: 3600,
            sendAmbience: true
          });
        });
        playVoice(sfxGain, { freq: 1046.5, duration: 0.48, wave: "sine", volume: 0.22, delay: 0.24, cutoff: 4200, sendAmbience: true });
        break;

      case "tick":
        playVoice(sfxGain, { freq: 740, endFreq: 620, duration: 0.065, wave: "sine", volume: 0.22, attack: 0.004, cutoff: 2800 });
        break;

      case "urgentTick":
        playVoice(sfxGain, { freq: 987.77, endFreq: 880, duration: 0.08, wave: "triangle", volume: 0.28, attack: 0.004, cutoff: 3600 });
        break;

      case "join":
        playVoice(sfxGain, { freq: 587.33, duration: 0.11, wave: "sine", volume: 0.24, sendAmbience: true });
        playVoice(sfxGain, { freq: 880.0, duration: 0.2, wave: "triangle", volume: 0.26, delay: 0.07, sendAmbience: true });
        break;

      case "answer":
        // Confirmação tátil ao registrar resposta
        playVoice(sfxGain, { freq: 587.33, duration: 0.09, wave: "sine", volume: 0.26, cutoff: 3200 });
        playVoice(sfxGain, { freq: 880.0, duration: 0.18, wave: "triangle", volume: 0.3, delay: 0.055, cutoff: 3800, sendAmbience: true });
        break;

      case "correct":
        // Arpejo maior brilhante de acerto
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) => {
          playVoice(sfxGain, {
            freq,
            duration: i === 4 ? 0.42 : 0.13,
            wave: i === 4 ? "sine" : "triangle",
            volume: 0.32,
            delay: i * 0.07,
            cutoff: 4200,
            sendAmbience: true
          });
        });
        playVoice(sfxGain, { freq: 261.63, duration: 0.45, wave: "sine", volume: 0.26, delay: 0.2, cutoff: 900 });
        break;

      case "incorrect":
        // Dois tons suaves de erro (amigável, sem estridência)
        playVoice(sfxGain, { freq: 329.63, duration: 0.17, wave: "triangle", volume: 0.24, cutoff: 1400 });
        playVoice(sfxGain, { freq: 246.94, duration: 0.32, wave: "sine", volume: 0.28, delay: 0.13, cutoff: 1100 });
        break;

      case "timeout":
        [440.0, 392.0, 329.63].forEach((freq, i) => {
          playVoice(sfxGain, {
            freq,
            duration: i === 2 ? 0.34 : 0.15,
            wave: "triangle",
            volume: 0.24,
            delay: i * 0.14,
            cutoff: 1600
          });
        });
        break;

      case "finish":
      case "champion":
        [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((freq, i) => {
          playVoice(sfxGain, {
            freq,
            duration: i === 5 ? 0.72 : 0.16,
            wave: "triangle",
            volume: 0.34,
            delay: i * 0.085,
            cutoff: 4500,
            sendAmbience: true
          });
        });
        playVoice(sfxGain, { freq: 261.63, duration: 0.8, wave: "sine", volume: 0.3, delay: 0.42, cutoff: 950 });
        break;

      default:
        playVoice(sfxGain, { freq: 783.99, duration: 0.14, wave: "sine", volume: 0.24 });
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!enabled) return;
    if (document.hidden) {
      stopTrack();
    } else if (currentTrack !== "none" && !trackTimer) {
      const resumeName = currentTrack;
      currentTrack = "none";
      setTrack(resumeName);
    }
  });

  window.GameAudio = {
    setEnabled,
    setTrack,
    playEffect,
    setMusicVolume,
    setSfxVolume,
    getPrefs: () => ({ ...prefs }),
    isEnabled: () => enabled
  };
})();