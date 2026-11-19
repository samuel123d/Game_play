import { db } from "./firebase-config.js";
import { GAME_QUESTIONS } from "./questions.js";
import {
  doc,
  collection,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const gameContent = document.querySelector("#gameContent");
const hostStatus = document.querySelector("#hostStatus");
const hostActions = document.querySelector("#hostActions");
const fullscreenToggle = document.querySelector("#fullscreenToggle");

const audioToggle = document.querySelector("#audioToggle, #soundToggle, [data-audio-toggle]");
const audioToggleLabel = document.querySelector("#audioToggleLabel");
const audioWavePath = document.querySelector("#audioWavePath");
const audioMixerBtn = document.querySelector("#audioMixerBtn");
const audioPopover = document.querySelector("#audioPopover");
const audioTestBtn = document.querySelector("#audioTestBtn");
const musicVolumeSlider = document.querySelector("#musicVolumeSlider");
const musicVolumeValue = document.querySelector("#musicVolumeValue");
const sfxVolumeSlider = document.querySelector("#sfxVolumeSlider");
const sfxVolumeValue = document.querySelector("#sfxVolumeValue");

const QUESTION_DURATION_MS = 20000;

let activeRoomCode = sessionStorage.getItem("conexao-host-room") || null;
let unsubRoom = null;
let unsubPlayers = null;
let currentGame = null;
let currentPlayers = [];
let timerInterval = 0;
let autoRevealLock = false;

let lastStateSoundKey = "";
let lastUrgentSecond = -1;
let knownPlayerCount = -1;
let knownAnsweredKey = "";
let knownAnsweredCount = 0;

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function generateRoomCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function getCorrectAnswerIndex(question) {
  if (!question) return -1;
  const raw = question.answer ?? question.correctIndex ?? question.correct ?? question.rightAnswer;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const letterIdx = ["A", "B", "C", "D"].indexOf(trimmed.toUpperCase());
    if (letterIdx !== -1) return letterIdx;
    if (Array.isArray(question.choices)) {
      return question.choices.findIndex((c) => String(c).trim() === trimmed);
    }
  }
  return -1;
}

function syncMusicForStatus(status) {
  if (!window.GameAudio) return;
  if (!window.GameAudio.isEnabled()) {
    window.GameAudio.setTrack("none");
    return;
  }
  if (status === "question") window.GameAudio.setTrack("question");
  else if (status === "review") window.GameAudio.setTrack("review");
  else if (status === "final") window.GameAudio.setTrack("victory");
  else window.GameAudio.setTrack("lobby");
}

function updateAudioButton() {
  if (!window.GameAudio || !audioToggle) return;
  const enabled = window.GameAudio.isEnabled();
  audioToggle.setAttribute("aria-pressed", String(enabled));
  if (audioToggleLabel) {
    audioToggleLabel.textContent = enabled ? "Som ligado" : "Som desligado";
  }
  if (audioWavePath) {
    audioWavePath.style.opacity = enabled ? "1" : "0.28";
  }
}

function initAudioControls() {
  if (!window.GameAudio) return;
  const prefs = window.GameAudio.getPrefs();
  if (musicVolumeSlider && musicVolumeValue) {
    const pct = Math.round(prefs.musicVolume * 100);
    musicVolumeSlider.value = String(pct);
    musicVolumeValue.textContent = `${pct}%`;
  }
  if (sfxVolumeSlider && sfxVolumeValue) {
    const pct = Math.round(prefs.sfxVolume * 100);
    sfxVolumeSlider.value = String(pct);
    sfxVolumeValue.textContent = `${pct}%`;
  }
  updateAudioButton();
  syncMusicForStatus(currentGame?.status || "welcome");
}

function cleanupListeners() {
  if (unsubRoom) {
    unsubRoom();
    unsubRoom = null;
  }
  if (unsubPlayers) {
    unsubPlayers();
    unsubPlayers = null;
  }
}

function subscribeToRoom(roomCode) {
  cleanupListeners();
  activeRoomCode = roomCode;
  sessionStorage.setItem("conexao-host-room", roomCode);
  currentPlayers = [];
  knownPlayerCount = -1;
  knownAnsweredKey = "";
  knownAnsweredCount = 0;
  lastStateSoundKey = "";

  const roomDocRef = doc(db, "rooms", roomCode);
  const playersColRef = collection(db, "rooms", roomCode, "players");

  unsubRoom = onSnapshot(roomDocRef, (snapshot) => {
    if (!snapshot.exists()) {
      currentGame = null;
      sessionStorage.removeItem("conexao-host-room");
      activeRoomCode = null;
      cleanupListeners();
      renderWelcomeScreen();
      return;
    }
    const data = snapshot.data();
    if (data.status === "closed") {
      currentGame = null;
      sessionStorage.removeItem("conexao-host-room");
      activeRoomCode = null;
      cleanupListeners();
      renderWelcomeScreen();
      return;
    }
    currentGame = data;
    renderGame(currentGame, currentPlayers);
  }, (error) => {
    hostStatus.textContent = `Erro no Firestore: ${error.message}`;
  });

  unsubPlayers = onSnapshot(playersColRef, (snapshot) => {
    currentPlayers = snapshot.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || "Participante",
          score: Number(data.score || 0),
          avatar: data.avatar || {},
          answers: data.answers || {}
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "pt-BR"));

    if (knownPlayerCount >= 0 && currentPlayers.length > knownPlayerCount && currentGame?.status === "lobby") {
      window.GameAudio?.playEffect("join");
    }
    knownPlayerCount = currentPlayers.length;

    if (currentGame && currentGame.status !== "closed") {
      renderGame(currentGame, currentPlayers);
    }
  }, (error) => {
    hostStatus.textContent = `Erro ao ler jogadores: ${error.message}`;
  });
}

async function openNewRoom() {
  const buttons = [
    document.querySelector("#welcomeOpenRoom"),
    document.querySelector("#barOpenRoom"),
    document.querySelector("#btnRestart")
  ].filter(Boolean);

  buttons.forEach((btn) => { btn.disabled = true; });
  hostStatus.textContent = "Criando sala no Firestore...";

  try {
    let code = generateRoomCode();
    for (let attempt = 0; attempt < 10; attempt++) {
      const existing = await getDoc(doc(db, "rooms", code));
      if (!existing.exists()) break;
      code = generateRoomCode();
    }

    autoRevealLock = false;
    await setDoc(doc(db, "rooms", code), {
      roomCode: code,
      status: "lobby",
      questionIndex: -1,
      questionCount: GAME_QUESTIONS.length,
      questionEndsAt: null,
      createdAt: Date.now()
    });
    subscribeToRoom(code);
  } catch (error) {
    console.error("Erro ao abrir sala:", error);
    hostStatus.textContent = `Erro ao abrir sala: ${error.message}`;
    buttons.forEach((btn) => { btn.disabled = false; });
  }
}

async function startChallenge() {
  if (!activeRoomCode || !currentGame) return;
  if (currentPlayers.length === 0) {
    hostStatus.textContent = "Aguarde pelo menos 1 participante entrar pelo QR Code.";
    return;
  }
  autoRevealLock = false;
  await updateDoc(doc(db, "rooms", activeRoomCode), {
    status: "question",
    questionIndex: 0,
    questionEndsAt: Date.now() + QUESTION_DURATION_MS
  });
}

async function revealAnswer() {
  if (!activeRoomCode || !currentGame || currentGame.status !== "question") return;
  if (autoRevealLock) return;
  autoRevealLock = true;
  await updateDoc(doc(db, "rooms", activeRoomCode), {
    status: "review",
    questionEndsAt: null
  });
}

async function nextQuestion() {
  if (!activeRoomCode || !currentGame || currentGame.status !== "review") return;
  const nextIndex = Number(currentGame.questionIndex) + 1;
  if (nextIndex >= GAME_QUESTIONS.length) {
    await updateDoc(doc(db, "rooms", activeRoomCode), {
      status: "final",
      questionEndsAt: null
    });
    return;
  }
  autoRevealLock = false;
  await updateDoc(doc(db, "rooms", activeRoomCode), {
    status: "question",
    questionIndex: nextIndex,
    questionEndsAt: Date.now() + QUESTION_DURATION_MS
  });
}

async function closeRoom() {
  window.clearInterval(timerInterval);
  const codeToClose = activeRoomCode;
  cleanupListeners();
  activeRoomCode = null;
  currentGame = null;
  currentPlayers = [];
  sessionStorage.removeItem("conexao-host-room");

  if (codeToClose) {
    try {
      await updateDoc(doc(db, "rooms", codeToClose), {
        status: "closed",
        questionEndsAt: null
      });
    } catch {
      // Ignora caso a sala já tenha sido encerrada
    }
  }

  window.GameConfetti?.stop();
  renderWelcomeScreen();
}

function renderWelcomeScreen() {
  window.clearInterval(timerInterval);
  syncMusicForStatus("welcome");
  gameContent.innerHTML = `
    <div class="game-screen game-welcome-screen">
      <p class="eyebrow">ATIVIDADE INTERATIVA EM TEMPO REAL</p>
      <h1>Desafio<br /><span class="accent">Relâmpago.</span></h1>
      <p class="welcome-copy">
        Abra uma sala para gerar o QR Code na tela. Os participantes podem escanear de qualquer celular e rede para entrar e responder ao vivo.
      </p>
      <button type="button" class="primary-cta" id="welcomeOpenRoom">
        Abrir sala do desafio <span>→</span>
      </button>
    </div>
  `;
  hostStatus.textContent = "Nenhuma sala ativa no momento.";
  hostActions.innerHTML = `
    <button type="button" class="host-btn host-btn-primary" id="barOpenRoom">Abrir nova sala</button>
  `;
  document.querySelector("#welcomeOpenRoom")?.addEventListener("click", openNewRoom);
  document.querySelector("#barOpenRoom")?.addEventListener("click", openNewRoom);
}

function renderStandings(players) {
  const top = players.slice(0, 5);
  if (!top.length) {
    return `<p class="game-empty">A classificação aparece aqui quando a rodada começar.</p>`;
  }
  return `
    <ol class="game-standings">
      ${top.map((player, idx) => `
        <li>
          <span class="game-rank">${String(idx + 1).padStart(2, "0")}</span>
          ${window.GameAvatar.render(player.avatar, "game-avatar game-avatar-ranking")}
          <b>${escapeHTML(player.name)}</b>
          <strong>${player.score.toLocaleString("pt-BR")} pts</strong>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderGame(game, players) {
  window.clearInterval(timerInterval);
  const joinUrl = `${window.location.origin}/play?room=${encodeURIComponent(game.roomCode)}`;
  const qIndex = Number(game.questionIndex);

  syncMusicForStatus(game.status);
  const stateSoundKey = `${game.status}:${qIndex}`;
  if (stateSoundKey !== lastStateSoundKey) {
    if (lastStateSoundKey) {
      if (game.status === "question") {
        lastUrgentSecond = -1;
        window.GameAudio?.playEffect(qIndex === 0 ? "start" : "tick");
      } else if (game.status === "review") {
        window.GameAudio?.playEffect("correct");
      } else if (game.status === "final") {
        window.GameAudio?.playEffect("champion");
        window.GameConfetti?.burst();
      }
    } else if (game.status === "final") {
      window.GameConfetti?.burst();
    }
    lastStateSoundKey = stateSoundKey;
  }

  if (game.status === "lobby") {
    let qrSvg = "";
    try {
      qrSvg = window.qrCodeSvg(joinUrl);
    } catch {
      qrSvg = `<div class="qr-fallback">${escapeHTML(joinUrl)}</div>`;
    }

    gameContent.innerHTML = `
      <div class="game-screen game-lobby-screen">
        <header class="game-screen-heading">
          <span>CONEXÃO · DESAFIO RELÂMPAGO</span>
          <strong>CADASTRO SEGURO</strong>
        </header>
        <h2>Entre no desafio</h2>
        <p class="game-screen-subtitle">
          Aponte a câmera do celular para o QR code ou acesse o endereço abaixo e escolha um apelido.
        </p>
        <div class="game-lobby-layout">
          <div class="game-qr-frame">${qrSvg}</div>
          <div class="game-room-info">
            <span>CÓDIGO DA SALA</span>
            <strong class="game-room-code">${escapeHTML(game.roomCode)}</strong>
            <span class="game-url-label">ENDEREÇO DIRETO</span>
            <div class="game-url-row">
              <code class="game-join-url">${escapeHTML(joinUrl)}</code>
              <button type="button" class="copy-link-btn" id="copyJoinUrl">Copiar link</button>
            </div>
            <span class="game-player-counter">${players.length} ${players.length === 1 ? "participante na sala" : "participantes na sala"}</span>
          </div>
        </div>
        <div class="game-player-list">
          ${players.length
            ? players.map((p) => `
                <span class="game-player-chip">
                  ${window.GameAvatar.render(p.avatar, "game-avatar game-avatar-chip")}
                  <span>${escapeHTML(p.name)}</span>
                </span>
              `).join("")
            : `<span class="game-waiting-chips">Aguardando participantes entrarem...</span>`
          }
        </div>
        <p class="game-privacy-note">Use apenas um apelido. Não informe nome completo, telefone, senha ou documento.</p>
      </div>
    `;

    document.querySelector("#copyJoinUrl")?.addEventListener("click", async (e) => {
      try {
        await navigator.clipboard.writeText(joinUrl);
        e.currentTarget.textContent = "Copiado!";
        setTimeout(() => { e.target && (e.target.textContent = "Copiar link"); }, 2000);
      } catch {
        hostStatus.textContent = `Link da sala: ${joinUrl}`;
      }
    });

    hostStatus.textContent = `Sala ${game.roomCode} aberta · ${players.length} participante(s).`;
    hostActions.innerHTML = `
      <button type="button" class="host-btn host-btn-primary" id="btnStart" ${players.length === 0 ? "disabled" : ""}>
        Iniciar desafio (${GAME_QUESTIONS.length} perguntas)
      </button>
      <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar sala</button>
    `;
    document.querySelector("#btnStart")?.addEventListener("click", startChallenge);
    document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
    return;
  }

  const qKey = String(qIndex);
  const question = GAME_QUESTIONS[qIndex];

  if ((game.status === "question" || game.status === "review") && question) {
    const isQuestion = game.status === "question";
    const isReview = game.status === "review";
    const correctIndex = getCorrectAnswerIndex(question);
    const answeredCount = players.filter((p) => p.answers && p.answers[qKey] !== undefined).length;

    if (isQuestion) {
      if (knownAnsweredKey !== qKey) {
        knownAnsweredKey = qKey;
        knownAnsweredCount = answeredCount;
      } else if (answeredCount > knownAnsweredCount) {
        knownAnsweredCount = answeredCount;
        window.GameAudio?.playEffect("select");
      }
    }

    if (isQuestion && players.length > 0 && answeredCount >= players.length && !autoRevealLock) {
      void revealAnswer();
      return;
    }

    gameContent.innerHTML = `
      <div class="game-screen game-question-screen">
        <header class="game-screen-heading">
          <span>DESAFIO RELÂMPAGO · SALA ${escapeHTML(game.roomCode)}</span>
          <strong>PERGUNTA ${String(qIndex + 1).padStart(2, "0")} / ${String(GAME_QUESTIONS.length).padStart(2, "0")}</strong>
        </header>
        <div class="game-question-meta">
          <span>${players.length} PARTICIPANTES</span>
          <span>${answeredCount} RESPONDERAM</span>
        </div>
        <h2>${escapeHTML(question.prompt)}</h2>
        ${isQuestion
          ? `<div class="game-timer-row"><span class="game-timer" id="gameTimer">20</span><div class="game-timer-track"><i class="game-timer-fill" id="gameTimerFill"></i></div></div>`
          : ""
        }
        <div class="game-projector-answers">
          ${question.choices.map((choice, idx) => `
            <div class="game-projector-answer${isReview && idx === correctIndex ? " is-correct" : ""}${isReview && idx !== correctIndex ? " is-dimmed" : ""}">
              <span>${["A", "B", "C"][idx]}</span>
              <div>${escapeHTML(choice)}</div>
            </div>
          `).join("")}
        </div>
        ${isReview ? `
          <div class="game-explanation-box">
            <b>POR QUE ESTA É A MAIS SEGURA?</b>
            <span>${escapeHTML(question.explanation)}</span>
          </div>
          <div class="game-live-score">
            <span>PLACAR ATUAL</span>
            ${renderStandings(players)}
          </div>
        ` : ""}
        <p class="game-screen-foot">
          ${isQuestion ? "Responda no seu celular antes do tempo acabar." : "Confira a explicação e avance para a próxima rodada."}
        </p>
      </div>
    `;

    if (isQuestion && game.questionEndsAt) {
      const updateTimer = () => {
        const remaining = Math.max(0, game.questionEndsAt - Date.now());
        const secLeft = Math.ceil(remaining / 1000);
        const urgent = secLeft > 0 && secLeft <= 5;

        const timerEl = gameContent.querySelector("#gameTimer");
        const fillEl = gameContent.querySelector("#gameTimerFill");
        if (timerEl) {
          timerEl.textContent = String(secLeft).padStart(2, "0");
          timerEl.classList.toggle("is-urgent", urgent);
        }
        if (fillEl) {
          fillEl.style.width = `${(remaining / QUESTION_DURATION_MS) * 100}%`;
          fillEl.classList.toggle("is-urgent", urgent);
        }

        if (urgent && secLeft !== lastUrgentSecond) {
          lastUrgentSecond = secLeft;
          window.GameAudio?.playEffect("urgentTick");
        }

        if (remaining === 0 && !autoRevealLock) {
          void revealAnswer();
        }
      };
      updateTimer();
      timerInterval = window.setInterval(updateTimer, 200);
    }

    hostStatus.textContent = isQuestion
      ? `Pergunta ${qIndex + 1} de ${GAME_QUESTIONS.length} · ${answeredCount}/${players.length} responderam`
      : `Resposta revelada · Pergunta ${qIndex + 1} de ${GAME_QUESTIONS.length}`;

    hostActions.innerHTML = isQuestion
      ? `
        <button type="button" class="host-btn host-btn-primary" id="btnReveal">Revelar resposta agora</button>
        <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar sala</button>
      `
      : `
        <button type="button" class="host-btn host-btn-primary" id="btnNext">
          ${qIndex === GAME_QUESTIONS.length - 1 ? "Ver resultado final" : "Próxima pergunta →"}
        </button>
        <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar sala</button>
      `;

    document.querySelector("#btnReveal")?.addEventListener("click", revealAnswer);
    document.querySelector("#btnNext")?.addEventListener("click", nextQuestion);
    document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
    return;
  }

  const winner = players[0];
  const tiedWinners = winner ? players.filter((p) => p.score === winner.score) : [];
  const winnerTitle = !winner
    ? "Sem pontuações"
    : tiedWinners.length > 1
      ? `Empate: ${tiedWinners.map((p) => p.name).join(" & ")}`
      : winner.name;

  gameContent.innerHTML = `
    <div class="game-screen game-final-screen">
      <header class="game-screen-heading">
        <span>DESAFIO RELÂMPAGO · RESULTADO FINAL</span>
        <strong>PARABÉNS!</strong>
      </header>
      <div class="game-podium-hero">
        ${winner ? window.GameAvatar.render(winner.avatar, "game-avatar game-avatar-projector-winner") : ""}
        <div class="game-winner-crown">✦ ${tiedWinners.length > 1 ? "EMPATE NO TOPO" : "CAMPEÃO DO DESAFIO"}</div>
        <h2>${escapeHTML(winnerTitle)}</h2>
        ${winner ? `<strong class="game-winner-score">${winner.score.toLocaleString("pt-BR")} PONTOS</strong>` : ""}
      </div>
      <div class="game-final-standings">
        <span>CLASSIFICAÇÃO FINAL</span>
        ${renderStandings(players)}
      </div>
      <p class="game-screen-foot">Cada resposta correta valeu pontos extras pela rapidez. Obrigado por jogar!</p>
    </div>
  `;

  hostStatus.textContent = "Desafio concluído!";
  hostActions.innerHTML = `
    <button type="button" class="host-btn host-btn-primary" id="btnRestart">Abrir nova sala</button>
    <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar</button>
  `;
  document.querySelector("#btnRestart")?.addEventListener("click", openNewRoom);
  document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
}

audioToggle?.addEventListener("click", async () => {
  if (!window.GameAudio) {
    hostStatus.textContent = "Erro: game-audio.js não foi carregado no index.html.";
    return;
  }
  try {
    const enabled = await window.GameAudio.setEnabled(!window.GameAudio.isEnabled());
    updateAudioButton();
    if (enabled) {
      syncMusicForStatus(currentGame?.status || "welcome");
      window.GameAudio.playEffect("start");
    } else {
      window.GameAudio.setTrack("none");
    }
  } catch (err) {
    hostStatus.textContent = `Áudio indisponível: ${err.message}`;
  }
});

audioMixerBtn?.addEventListener("click", () => {
  if (!audioPopover) return;
  const willShow = audioPopover.hidden;
  audioPopover.hidden = !willShow;
  audioMixerBtn.setAttribute("aria-expanded", String(willShow));
});

document.addEventListener("click", (event) => {
  if (!audioPopover || audioPopover.hidden) return;
  if (!event.target.closest(".audio-control-wrap")) {
    audioPopover.hidden = true;
    audioMixerBtn?.setAttribute("aria-expanded", "false");
  }
});

musicVolumeSlider?.addEventListener("input", () => {
  const pct = Number(musicVolumeSlider.value);
  if (musicVolumeValue) musicVolumeValue.textContent = `${pct}%`;
  window.GameAudio?.setMusicVolume(pct / 100);
});

sfxVolumeSlider?.addEventListener("input", () => {
  const pct = Number(sfxVolumeSlider.value);
  if (sfxVolumeValue) sfxVolumeValue.textContent = `${pct}%`;
  window.GameAudio?.setSfxVolume(pct / 100);
});

audioTestBtn?.addEventListener("click", async () => {
  if (!window.GameAudio) return;
  if (!window.GameAudio.isEnabled()) {
    await window.GameAudio.setEnabled(true);
    updateAudioButton();
    syncMusicForStatus(currentGame?.status || "welcome");
  }
  window.GameAudio.playEffect("correct");
});

fullscreenToggle?.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "f" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
    fullscreenToggle?.click();
  }
});

initAudioControls();

if (activeRoomCode) {
  subscribeToRoom(activeRoomCode);
} else {
  renderWelcomeScreen();
}