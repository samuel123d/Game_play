(() => {
  const PREFS_KEY = "conexao-audio-prefs-v2";

  function loadPrefs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return {
        musicVolume: typeof parsed.musicVolume === "number" ? Math.min(1, Math.max(0, parsed.musicVolume)) : 0.45,
        sfxVolume: typeof parsed.sfxVolume === "number" ? Math.min(1, Math.max(0, parsed.sfxVolume)) : 0.8
      };
    } catch {
      return { musicVolume: 0.45, sfxVolume: 0.8 };
    }
  }

  const prefs = loadPrefs();
  let context = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;

  let enabled = false;
  let currentTrack = "none";
  let trackTimer = 0;
  let trackStep = 0;
  const firedKeys = new Set();

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        musicVolume: prefs.musicVolume,
        sfxVolume: prefs.sfxVolume
      }));
    } catch {
      // Ignora erro de storage
    }
  }

  function ensureContext() {
    if (context) return true;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    context = new AudioCtx();

    masterGain = context.createGain();
    masterGain.gain.value = enabled ? 0.9 : 0.0001;
    masterGain.connect(context.destination);

    musicGain = context.createGain();
    musicGain.gain.value = prefs.musicVolume * 0.24;
    musicGain.connect(masterGain);

    sfxGain = context.createGain();
    sfxGain.gain.value = prefs.sfxVolume * 0.42;
    sfxGain.connect(masterGain);

    return true;
  }

  function applyVolumes() {
    if (!context || !masterGain || !musicGain || !sfxGain) return;
    const now = context.currentTime;
    masterGain.gain.setTargetAtTime(enabled ? 0.9 : 0.0001, now, 0.03);
    musicGain.gain.setTargetAtTime(prefs.musicVolume * 0.24, now, 0.04);
    sfxGain.gain.setTargetAtTime(prefs.sfxVolume * 0.42, now, 0.04);
  }

  function playTone({
    freq,
    endFreq = null,
    duration = 0.18,
    wave = "triangle",
    volume = 0.25,
    delay = 0,
    bus = "sfx",
    filterFreq = null
  }) {
    if (!enabled || !ensureContext()) return;
    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }
    const targetBus = bus === "music" ? musicGain : sfxGain;
    if (!targetBus) return;

    const start = context.currentTime + delay;
    const osc = context.createOscillator();
    const env = context.createGain();

    osc.type = wave;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq && endFreq > 0) {
      osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    }

    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + Math.min(0.02, duration * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    if (filterFreq) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(filterFreq, start);
      osc.connect(filter);
      filter.connect(env);
    } else {
      osc.connect(env);
    }

    env.connect(targetBus);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  const TRACKS = {
    lobby: {
      intervalMs: 420,
      step(s) {
        const arp = [261.63, 329.63, 392.00, 493.88, 392.00, 329.63, 293.66, 392.00];
        const bass = [130.81, 130.81, 146.83, 164.81];
        const note = arp[s % arp.length];
        playTone({ freq: note, duration: 0.28, wave: "sine", volume: 0.22, bus: "music", filterFreq: 1400 });
        if (s % 2 === 0) {
          playTone({ freq: bass[(s / 2) % bass.length], duration: 0.55, wave: "triangle", volume: 0.2, bus: "music", filterFreq: 700 });
        }
      }
    },

    countdown: {
      intervalMs: 250,
      step(s) {
        const rise = [329.63, 392.00, 440.00, 523.25, 349.23, 440.00, 523.25, 659.25];
        playTone({ freq: rise[s % rise.length], duration: 0.14, wave: "triangle", volume: 0.26, bus: "music", filterFreq: 1900 });
        if (s % 2 === 0) {
          playTone({ freq: 110, duration: 0.16, wave: "sine", volume: 0.28, bus: "music" });
        }
      }
    },

    question: {
      intervalMs: 300,
      step(s) {
        const melody = [
          392.00, 0, 440.00, 493.88, 523.25, 0, 493.88, 440.00,
          392.00, 0, 329.63, 392.00, 440.00, 0, 392.00, 329.63
        ];
        const bassLine = [130.81, 130.81, 164.81, 164.81, 174.61, 174.61, 196.00, 196.00];
        const lead = melody[s % melody.length];
        if (lead > 0) {
          playTone({ freq: lead, duration: 0.18, wave: "triangle", volume: 0.2, bus: "music", filterFreq: 1350 });
        }
        if (s % 2 === 0) {
          playTone({ freq: bassLine[(s / 2) % bassLine.length], duration: 0.34, wave: "sine", volume: 0.24, bus: "music", filterFreq: 650 });
        }
        if (s % 4 === 2) {
          playTone({ freq: 783.99, duration: 0.05, wave: "sine", volume: 0.07, bus: "music", filterFreq: 1600 });
        }
      }
    },

    review: {
      intervalMs: 520,
      step(s) {
        const chords = [261.63, 329.63, 392.00, 493.88];
        playTone({ freq: chords[s % chords.length], duration: 0.44, wave: "sine", volume: 0.16, bus: "music", filterFreq: 1100 });
      }
    },

    victory: {
      intervalMs: 260,
      step(s) {
        const fanfare = [
          523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50, 0, 0,
          587.33, 739.99, 880.00, 1174.66, 880.00, 1046.50, 0, 0
        ];
        const bass = [261.63, 0, 392.00, 0, 293.66, 0, 392.00, 0];
        const note = fanfare[s % fanfare.length];
        if (note > 0) {
          playTone({ freq: note, duration: 0.22, wave: "triangle", volume: 0.24, bus: "music", filterFreq: 2400 });
        }
        if (s % 2 === 0 && bass[(s / 2) % bass.length] > 0) {
          playTone({ freq: bass[(s / 2) % bass.length], duration: 0.32, wave: "sine", volume: 0.24, bus: "music" });
        }
      }
    }
  };

  function stopTrackTimer() {
    if (trackTimer) {
      window.clearInterval(trackTimer);
      trackTimer = 0;
    }
  }

  function startCurrentTrackLoop() {
    stopTrackTimer();
    if (!enabled || document.hidden || currentTrack === "none" || !TRACKS[currentTrack]) return;
    const def = TRACKS[currentTrack];
    trackStep = 0;
    def.step(trackStep++);
    trackTimer = window.setInterval(() => {
      if (!enabled || document.hidden) return;
      def.step(trackStep++);
    }, def.intervalMs);
  }

  function setTrack(trackName) {
    const next = TRACKS[trackName] ? trackName : "none";
    if (next === currentTrack) {
      if (enabled && !trackTimer && next !== "none") startCurrentTrackLoop();
      return;
    }
    currentTrack = next;
    stopTrackTimer();
    if (enabled && currentTrack !== "none") {
      startCurrentTrackLoop();
    }
  }

  async function setEnabled(value) {
    enabled = Boolean(value);
    if (enabled) {
      if (!ensureContext()) {
        enabled = false;
        throw new Error("Este navegador não oferece suporte a Web Audio.");
      }
      await context.resume();
      applyVolumes();
      startCurrentTrackLoop();
    } else {
      stopTrackTimer();
      applyVolumes();
    }
    notifyListeners();
    return enabled;
  }

  function setMusicVolume(val) {
    prefs.musicVolume = Math.min(1, Math.max(0, Number(val)));
    savePrefs();
    applyVolumes();
    notifyListeners();
  }

  function setSfxVolume(val) {
    prefs.sfxVolume = Math.min(1, Math.max(0, Number(val)));
    savePrefs();
    applyVolumes();
    notifyListeners();
  }

  function playEffect(kind) {
    if (!enabled) return;
    if (!ensureContext()) return;

    switch (kind) {
      case "join":
        playTone({ freq: 587.33, duration: 0.1, wave: "sine", volume: 0.22 });
        playTone({ freq: 880.00, duration: 0.16, wave: "triangle", volume: 0.24, delay: 0.07 });
        break;

      case "start":
        [392.00, 523.25, 659.25, 783.99, 1046.50].forEach((f, idx) => {
          playTone({ freq: f, duration: idx === 4 ? 0.42 : 0.14, wave: "triangle", volume: 0.3, delay: idx * 0.075 });
        });
        playTone({ freq: 130.81, duration: 0.5, wave: "sine", volume: 0.32, delay: 0.28 });
        break;

      case "tick":
        playTone({ freq: 783.99, duration: 0.08, wave: "triangle", volume: 0.24 });
        break;

      case "urgent":
        playTone({ freq: 987.77, duration: 0.07, wave: "square", volume: 0.12 });
        break;

      case "answer":
        playTone({ freq: 659.25, duration: 0.09, wave: "triangle", volume: 0.24 });
        playTone({ freq: 987.77, duration: 0.15, wave: "sine", volume: 0.26, delay: 0.06 });
        break;

      case "correct":
        playTone({ freq: 523.25, duration: 0.11, wave: "triangle", volume: 0.28 });
        playTone({ freq: 659.25, duration: 0.11, wave: "triangle", volume: 0.28, delay: 0.09 });
        playTone({ freq: 783.99, duration: 0.12, wave: "triangle", volume: 0.3, delay: 0.18 });
        playTone({ freq: 1046.50, duration: 0.34, wave: "triangle", volume: 0.34, delay: 0.27 });
        break;

      case "incorrect":
        playTone({ freq: 349.23, endFreq: 293.66, duration: 0.18, wave: "sawtooth", volume: 0.15, filterFreq: 900 });
        playTone({ freq: 277.18, endFreq: 220.00, duration: 0.28, wave: "sawtooth", volume: 0.15, delay: 0.15, filterFreq: 800 });
        break;

      case "timeout":
        playTone({ freq: 440.00, duration: 0.16, wave: "square", volume: 0.14, filterFreq: 1200 });
        playTone({ freq: 349.23, duration: 0.32, wave: "square", volume: 0.15, delay: 0.16, filterFreq: 1100 });
        break;

      case "champion":
        [523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50, 1318.51].forEach((f, idx) => {
          playTone({
            freq: f,
            duration: idx === 6 ? 0.55 : 0.14,
            wave: "triangle",
            volume: 0.32,
            delay: idx * 0.09
          });
        });
        playTone({ freq: 261.63, duration: 0.65, wave: "sine", volume: 0.34, delay: 0.52 });
        break;

      default:
        break;
    }
  }

  function playEffectOnce(uniqueKey, kind) {
    if (!uniqueKey) {
      playEffect(kind);
      return;
    }
    if (firedKeys.has(uniqueKey)) return;
    firedKeys.add(uniqueKey);
    if (firedKeys.size > 200) {
      const first = firedKeys.values().next().value;
      firedKeys.delete(first);
    }
    playEffect(kind);
  }

  function clearEffectHistory() {
    firedKeys.clear();
  }

  document.addEventListener("visibilitychange", () => {
    if (!enabled) return;
    if (document.hidden) stopTrackTimer();
    else startCurrentTrackLoop();
  });

  const listeners = new Set();
  function notifyListeners() {
    listeners.forEach((fn) => fn({
      enabled,
      musicVolume: prefs.musicVolume,
      sfxVolume: prefs.sfxVolume,
      currentTrack
    }));
  }

  function mountControls(container, { compact = false } = {}) {
    if (!container) return;
    container.innerHTML = `
      <div class="audio-widget ${compact ? "is-compact" : ""}">
        <button type="button" class="icon-button audio-main-btn" data-audio-toggle aria-pressed="${enabled}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          </svg>
          <span data-audio-label>${enabled ? "Som ativo" : "Ativar som"}</span>
        </button>
        <button type="button" class="icon-button audio-mixer-btn" data-audio-mixer-toggle aria-expanded="false" title="Ajustar volumes de música e efeitos" aria-label="Ajustar volumes de música e efeitos">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="4" y1="21" x2="4" y2="14"></line>
            <line x1="4" y1="10" x2="4" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12" y2="3"></line>
            <line x1="20" y1="21" x2="20" y2="16"></line>
            <line x1="20" y1="12" x2="20" y2="3"></line>
            <line x1="1" y1="14" x2="7" y2="14"></line>
            <line x1="9" y1="8" x2="15" y2="8"></line>
            <line x1="17" y1="16" x2="23" y2="16"></line>
          </svg>
        </button>
        <div class="audio-popover" data-audio-popover hidden>
          <div class="audio-popover-head">
            <strong>Controles de Áudio</strong>
            <span data-audio-state-badge>${enabled ? "Ligado" : "Mudo"}</span>
          </div>
          <label class="audio-slider-row">
            <div class="audio-slider-meta">
              <span>Música de fundo</span>
              <strong data-music-pct>${Math.round(prefs.musicVolume * 100)}%</strong>
            </div>
            <input type="range" min="0" max="100" step="5" value="${Math.round(prefs.musicVolume * 100)}" data-music-slider />
          </label>
          <label class="audio-slider-row">
            <div class="audio-slider-meta">
              <span>Efeitos sonoros</span>
              <strong data-sfx-pct>${Math.round(prefs.sfxVolume * 100)}%</strong>
            </div>
            <input type="range" min="0" max="100" step="5" value="${Math.round(prefs.sfxVolume * 100)}" data-sfx-slider />
          </label>
          <button type="button" class="audio-test-btn" data-audio-test>Testar efeitos</button>
        </div>
      </div>
    `;

    const toggleBtn = container.querySelector("[data-audio-toggle]");
    const labelEl = container.querySelector("[data-audio-label]");
    const mixerBtn = container.querySelector("[data-audio-mixer-toggle]");
    const popover = container.querySelector("[data-audio-popover]");
    const stateBadge = container.querySelector("[data-audio-state-badge]");
    const musicSlider = container.querySelector("[data-music-slider]");
    const musicPct = container.querySelector("[data-music-pct]");
    const sfxSlider = container.querySelector("[data-sfx-slider]");
    const sfxPct = container.querySelector("[data-sfx-pct]");
    const testBtn = container.querySelector("[data-audio-test]");

    const syncUI = (state) => {
      toggleBtn.setAttribute("aria-pressed", String(state.enabled));
      labelEl.textContent = state.enabled ? "Som ativo" : "Ativar som";
      stateBadge.textContent = state.enabled ? "Ligado" : "Mudo";
      musicSlider.value = String(Math.round(state.musicVolume * 100));
      musicPct.textContent = `${Math.round(state.musicVolume * 100)}%`;
      sfxSlider.value = String(Math.round(state.sfxVolume * 100));
      sfxPct.textContent = `${Math.round(state.sfxVolume * 100)}%`;
    };

    listeners.add(syncUI);

    toggleBtn.addEventListener("click", async () => {
      try {
        const next = await setEnabled(!enabled);
        if (next) playEffect("answer");
      } catch {
        // Ignora bloqueio de autoplay
      }
    });

    mixerBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = popover.hidden;
      popover.hidden = !willOpen;
      mixerBtn.setAttribute("aria-expanded", String(willOpen));
    });

    popover.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => {
      if (!popover.hidden) {
        popover.hidden = true;
        mixerBtn.setAttribute("aria-expanded", "false");
      }
    });

    musicSlider.addEventListener("input", (e) => {
      setMusicVolume(Number(e.target.value) / 100);
    });

    sfxSlider.addEventListener("input", (e) => {
      setSfxVolume(Number(e.target.value) / 100);
    });

    testBtn.addEventListener("click", async () => {
      if (!enabled) await setEnabled(true);
      playEffect("correct");
    });
  }

  window.GameAudio = {
    setEnabled,
    isEnabled: () => enabled,
    setTrack,
    getTrack: () => currentTrack,
    playEffect,
    playEffectOnce,
    clearEffectHistory,
    setMusicVolume,
    setSfxVolume,
    getMusicVolume: () => prefs.musicVolume,
    getSfxVolume: () => prefs.sfxVolume,
    mountControls
  };
})();