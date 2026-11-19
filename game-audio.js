(() => {
  let context = null;
  let master = null;
  let enabled = false;
  let timer = 0;
  let step = 0;
  const melody = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46, 523.25, 659.25, 783.99, 1046.5, 880, 783.99, 698.46, 587.33];

  function prepare() {
    if (context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Este navegador não oferece suporte a áudio.");
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.12;
    master.connect(context.destination);
  }

  function note(frequency, duration = 0.16, wave = "triangle", volume = 0.24, delay = 0) {
    if (!enabled || !context || !master) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function playStep() {
    if (!enabled || document.hidden) return;
    const beat = step % melody.length;
    note(melody[beat], 0.19, "triangle", 0.22);
    if (beat % 4 === 0) note([130.81, 164.81, 146.83, 196][Math.floor(beat / 4)], 0.34, "sine", 0.2, 0.015);
    step += 1;
  }

  function stopLoop() {
    window.clearInterval(timer);
    timer = 0;
  }

  async function setEnabled(value) {
    enabled = Boolean(value);
    if (enabled) {
      prepare();
      await context.resume();
      if (!timer) {
        step = 0;
        playStep();
        timer = window.setInterval(playStep, 280);
      }
    } else {
      stopLoop();
    }
    return enabled;
  }

  function playEffect(kind) {
    if (!enabled) return;
    if (kind === "answer") {
      note(783.99, 0.13, "square", 0.12);
      note(1046.5, 0.2, "triangle", 0.19, 0.09);
    } else if (kind === "correct") {
      note(659.25, 0.12, "triangle", 0.2);
      note(783.99, 0.12, "triangle", 0.2, 0.11);
      note(1046.5, 0.3, "triangle", 0.24, 0.22);
    } else if (kind === "finish") {
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => note(frequency, 0.34, "triangle", 0.21, index * 0.14));
    } else if (kind === "tick") {
      note(880, 0.075, "square", 0.08);
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!enabled) return;
    if (document.hidden) stopLoop();
    else if (!timer) {
      playStep();
      timer = window.setInterval(playStep, 280);
    }
  });

  window.GameAudio = { setEnabled, playEffect, isEnabled: () => enabled };
})();
