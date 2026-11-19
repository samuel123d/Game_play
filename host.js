import { db } from "./firebase-config.js";
import { GAME_QUESTIONS } from "./questions.js";
import {
  db,
  doc,
  collection,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot
} from "./firebase-config.js";
import { GAME_QUESTIONS } from "./questions.js";
const SETTINGS_STORAGE_KEY = "conexao-host-settings-v1";

const DEFAULT_SETTINGS = {
  maxPlayers: 30,
  minPlayers: 1,
  lobbyWaitSec: 0,
  countdownSec: 5,
  questionTimeSec: 20,
  autoStart: true,
  lateJoin: false,
  allowReview: true,
  allowReplay: true
};

const gameContent = document.querySelector("#gameContent");
const hostStatus = document.querySelector("#hostStatus");
const hostActions = document.querySelector("#hostActions");
const topbarPhaseLabel = document.querySelector("#topbarPhaseLabel");
const fullscreenToggle = document.querySelector("#fullscreenToggle");

// Áudio
const audioToggle = document.querySelector("#audioToggle");
const audioToggleLabel = document.querySelector("#audioToggleLabel");
const audioMixerBtn = document.querySelector("#audioMixerBtn");
const audioPopover = document.querySelector("#audioPopover");
const audioTestBtn = document.querySelector("#audioTestBtn");
const musicVolumeSlider = document.querySelector("#musicVolumeSlider");
const musicVolumeValue = document.querySelector("#musicVolumeValue");
const sfxVolumeSlider = document.querySelector("#sfxVolumeSlider");
const sfxVolumeValue = document.querySelector("#sfxVolumeValue");

// Modal de Configurações
const settingsToggleBtn = document.querySelector("#settingsToggleBtn");
const settingsModal = document.querySelector("#settingsModal");
const closeSettingsBtn = document.querySelector("#closeSettingsBtn");
const matchSettingsForm = document.querySelector("#matchSettingsForm");
const resetSettingsBtn = document.querySelector("#resetSettingsBtn");

const cfgMaxPlayers = document.querySelector("#cfgMaxPlayers");
const cfgMinPlayers = document.querySelector("#cfgMinPlayers");
const cfgLobbyWait = document.querySelector("#cfgLobbyWait");
const cfgCountdown = document.querySelector("#cfgCountdown");
const cfgQuestionTime = document.querySelector("#cfgQuestionTime");
const cfgAutoStart = document.querySelector("#cfgAutoStart");
const cfgLateJoin = document.querySelector("#cfgLateJoin");
const cfgAllowReview = document.querySelector("#cfgAllowReview");
const cfgAllowReplay = document.querySelector("#cfgAllowReplay");

let hostSettings = loadHostSettings();
let activeRoomCode = sessionStorage.getItem("conexao-host-room") || null;
let unsubRoom = null;
let unsubPlayers = null;
let currentGame = null;
let currentPlayers = [];
let timerInterval = 0;
let stateTransitionLock = false;
let lastCelebratedRoom = "";

function sanitizeSettings(raw = {}) {
  const maxPlayers = Math.min(100, Math.max(2, Number(raw.maxPlayers) || DEFAULT_SETTINGS.maxPlayers));
  const minPlayers = Math.min(maxPlayers, Math.max(1, Number(raw.minPlayers) || DEFAULT_SETTINGS.minPlayers));
  const lobbyWaitSec = Math.max(0, Number(raw.lobbyWaitSec ?? DEFAULT_SETTINGS.lobbyWaitSec));
  const countdownSec = Math.min(30, Math.max(3, Number(raw.countdownSec) || DEFAULT_SETTINGS.countdownSec));
  const questionTimeSec = Math.min(120, Math.max(5, Number(raw.questionTimeSec) || DEFAULT_SETTINGS.questionTimeSec));

  return {
    maxPlayers,
    minPlayers,
    lobbyWaitSec,
    countdownSec,
    questionTimeSec,
    autoStart: raw.autoStart !== undefined ? Boolean(raw.autoStart) : DEFAULT_SETTINGS.autoStart,
    lateJoin: raw.lateJoin !== undefined ? Boolean(raw.lateJoin) : DEFAULT_SETTINGS.lateJoin,
    allowReview: raw.allowReview !== undefined ? Boolean(raw.allowReview) : DEFAULT_SETTINGS.allowReview,
    allowReplay: raw.allowReplay !== undefined ? Boolean(raw.allowReplay) : DEFAULT_SETTINGS.allowReplay
  };
}

function loadHostSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    return sanitizeSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveHostSettings(nextSettings) {
  hostSettings = sanitizeSettings(nextSettings);
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(hostSettings));
  } catch {
    // Ignora bloqueio de armazenamento
  }
}

function populateSettingsForm(settings = hostSettings) {
  if (cfgMaxPlayers) cfgMaxPlayers.value = String(settings.maxPlayers);
  if (cfgMinPlayers) cfgMinPlayers.value = String(settings.minPlayers);
  if (cfgLobbyWait) cfgLobbyWait.value = String(settings.lobbyWaitSec);
  if (cfgCountdown) cfgCountdown.value = String(settings.countdownSec);
  if (cfgQuestionTime) cfgQuestionTime.value = String(settings.questionTimeSec);
  if (cfgAutoStart) cfgAutoStart.checked = Boolean(settings.autoStart);
  if (cfgLateJoin) cfgLateJoin.checked = Boolean(settings.lateJoin);
  if (cfgAllowReview) cfgAllowReview.checked = Boolean(settings.allowReview);
  if (cfgAllowReplay) cfgAllowReplay.checked = Boolean(settings.allowReplay);
}

function openSettingsModal() {
  if (!settingsModal) return;
  populateSettingsForm(currentGame?.settings ? sanitizeSettings(currentGame.settings) : hostSettings);
  settingsModal.hidden = false;
}

function closeSettingsModal() {
  if (!settingsModal) return;
  settingsModal.hidden = true;
}

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

function setStatus(text) {
  if (hostStatus) hostStatus.textContent = text;
}

function setPhaseLabel(text) {
  if (topbarPhaseLabel) topbarPhaseLabel.textContent = text;
}

function setAudioTrack(track) {
  try {
    window.GameAudio?.setTrack?.(track);
  } catch {
    // Ignora se o módulo de áudio não suportar faixas
  }
}

function playEffect(name) {
  try {
    window.GameAudio?.playEffect?.(name);
  } catch {
    // Ignora falha de áudio
  }
}

function triggerConfetti() {
  try {
    if (typeof window.GameConfetti?.burst === "function") {
      window.GameConfetti.burst({ count: 140 });
    } else if (typeof window.launchConfetti === "function") {
      window.launchConfetti();
    }
  } catch {
    // Ignora falha visual
  }
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
    setStatus(`Erro no Firestore: ${error.message}`);
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

    if (currentGame && currentGame.status !== "closed") {
      renderGame(currentGame, currentPlayers);
    }
  }, (error) => {
    setStatus(`Erro ao ler jogadores: ${error.message}`);
  });
}

async function openNewRoom() {
  const buttons = [
    document.querySelector("#welcomeOpenRoom"),
    document.querySelector("#barOpenRoom"),
    document.querySelector("#btnRestart")
  ].filter(Boolean);

  buttons.forEach((btn) => { btn.disabled = true; });
  setStatus("Criando sala no Firestore...");

  try {
    let code = generateRoomCode();
    for (let attempt = 0; attempt < 10; attempt++) {
      const existing = await getDoc(doc(db, "rooms", code));
      if (!existing.exists()) break;
      code = generateRoomCode();
    }

    const settings = sanitizeSettings(hostSettings);
    const now = Date.now();
    const lobbyEndsAt = settings.lobbyWaitSec > 0 ? now + settings.lobbyWaitSec * 1000 : null;

    stateTransitionLock = false;
    lastCelebratedRoom = "";

    await setDoc(doc(db, "rooms", code), {
      roomCode: code,
      status: "lobby",
      questionIndex: -1,
      questionCount: GAME_QUESTIONS.length,
      questionDurationMs: settings.questionTimeSec * 1000,
      questionEndsAt: null,
      lobbyEndsAt,
      countdownEndsAt: null,
      settings,
      createdAt: now
    });

    subscribeToRoom(code);
  } catch (error) {
    console.error("Erro ao abrir sala:", error);
    setStatus(`Erro ao abrir sala: ${error.message}`);
    buttons.forEach((btn) => { btn.disabled = false; });
  }
}

async function beginCountdown() {
  if (!activeRoomCode || !currentGame || stateTransitionLock) return;
  const settings = sanitizeSettings(currentGame.settings || hostSettings);

  if (currentPlayers.length < settings.minPlayers) {
    setStatus(`Aguarde pelo menos ${settings.minPlayers} participante(s) para iniciar.`);
    return;
  }

  stateTransitionLock = true;
  try {
    await updateDoc(doc(db, "rooms", activeRoomCode), {
      status: "countdown",
      lobbyEndsAt: null,
      countdownEndsAt: Date.now() + settings.countdownSec * 1000
    });
  } finally {
    stateTransitionLock = false;
  }
}

async function startFirstQuestion() {
  if (!activeRoomCode || !currentGame || stateTransitionLock) return;
  const settings = sanitizeSettings(currentGame.settings || hostSettings);
  const durationMs = settings.questionTimeSec * 1000;

  stateTransitionLock = true;
  try {
    await updateDoc(doc(db, "rooms", activeRoomCode), {
      status: "question",
      questionIndex: 0,
      questionDurationMs: durationMs,
      countdownEndsAt: null,
      questionEndsAt: Date.now() + durationMs
    });
  } finally {
    stateTransitionLock = false;
  }
}

async function revealAnswer() {
  if (!activeRoomCode || !currentGame || currentGame.status !== "question" || stateTransitionLock) return;
  stateTransitionLock = true;
  try {
    await updateDoc(doc(db, "rooms", activeRoomCode), {
      status: "review",
      questionEndsAt: null
    });
  } finally {
    stateTransitionLock = false;
  }
}

async function nextQuestion() {
  if (!activeRoomCode || !currentGame || currentGame.status !== "review" || stateTransitionLock) return;
  const nextIndex = Number(currentGame.questionIndex) + 1;

  stateTransitionLock = true;
  try {
    if (nextIndex >= GAME_QUESTIONS.length) {
      await updateDoc(doc(db, "rooms", activeRoomCode), {
        status: "final",
        questionEndsAt: null
      });
      return;
    }

    const settings = sanitizeSettings(currentGame.settings || hostSettings);
    const durationMs = settings.questionTimeSec * 1000;

    await updateDoc(doc(db, "rooms", activeRoomCode), {
      status: "question",
      questionIndex: nextIndex,
      questionDurationMs: durationMs,
      questionEndsAt: Date.now() + durationMs
    });
  } finally {
    stateTransitionLock = false;
  }
}

async function replaySameRoom() {
  if (!activeRoomCode || !currentGame || stateTransitionLock) return;
  stateTransitionLock = true;

  try {
    const settings = sanitizeSettings(currentGame.settings || hostSettings);
    const now = Date.now();
    const lobbyEndsAt = settings.lobbyWaitSec > 0 ? now + settings.lobbyWaitSec * 1000 : null;

    await Promise.all(
      currentPlayers.map((p) =>
        updateDoc(doc(db, "rooms", activeRoomCode, "players", p.id), {
          score: 0,
          answers: {}
        })
      )
    );

    lastCelebratedRoom = "";
    await updateDoc(doc(db, "rooms", activeRoomCode), {
      status: "lobby",
      questionIndex: -1,
      questionEndsAt: null,
      countdownEndsAt: null,
      lobbyEndsAt
    });
  } catch (error) {
    setStatus(`Erro ao reiniciar partida: ${error.message}`);
  } finally {
    stateTransitionLock = false;
  }
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
        questionEndsAt: null,
        lobbyEndsAt: null,
        countdownEndsAt: null
      });
    } catch {
      // Ignora caso a sala já tenha sido encerrada
    }
  }

  setAudioTrack("none");
  renderWelcomeScreen();
}

function renderWelcomeScreen() {
  window.clearInterval(timerInterval);
  setPhaseLabel("ARENA INTERATIVA · PRONTA PARA INICIAR");
  setAudioTrack("none");

  if (gameContent) {
    gameContent.innerHTML = `
      <div class="game-screen game-welcome-screen">
        <p class="eyebrow">ATIVIDADE INTERATIVA EM TEMPO REAL</p>
        <h1>Desafio<br /><span class="accent">Relâmpago.</span></h1>
        <p class="welcome-copy">
          Abra uma sala para gerar o QR Code na tela. Os participantes podem escanear de qualquer celular e rede para entrar e responder ao vivo.
        </p>
        <div class="welcome-cta-group">
          <button type="button" class="primary-cta" id="welcomeOpenRoom">
            Abrir sala do desafio <span>→</span>
          </button>
          <button type="button" class="host-btn" id="welcomeConfigBtn">
            Configurar parâmetros (${hostSettings.questionTimeSec}s/pergunta · máx. ${hostSettings.maxPlayers})
          </button>
        </div>
      </div>
    `;
  }

  setStatus("Nenhuma sala ativa no momento.");
  if (hostActions) {
    hostActions.innerHTML = `
      <button type="button" class="host-btn" id="barConfigBtn">Configurar</button>
      <button type="button" class="host-btn host-btn-primary" id="barOpenRoom">Abrir nova sala</button>
    `;
  }

  document.querySelector("#welcomeOpenRoom")?.addEventListener("click", openNewRoom);
  document.querySelector("#barOpenRoom")?.addEventListener("click", openNewRoom);
  document.querySelector("#welcomeConfigBtn")?.addEventListener("click", openSettingsModal);
  document.querySelector("#barConfigBtn")?.addEventListener("click", openSettingsModal);
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
          ${window.GameAvatar?.render(player.avatar, "game-avatar game-avatar-ranking") || ""}
          <b>${escapeHTML(player.name)}</b>
          <strong>${player.score.toLocaleString("pt-BR")} pts</strong>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderGame(game, players) {
  window.clearInterval(timerInterval);
  const settings = sanitizeSettings(game.settings || hostSettings);
  const joinUrl = `${window.location.origin}/play?room=${encodeURIComponent(game.roomCode)}`;

  if (game.status === "lobby") {
    setPhaseLabel(`SALA ${game.roomCode} · AGUARDANDO PARTICIPANTES`);
    setAudioTrack("lobby");

    let qrSvg = "";
    try {
      qrSvg = window.qrCodeSvg(joinUrl);
    } catch {
      qrSvg = `<div class="qr-fallback">${escapeHTML(joinUrl)}</div>`;
    }

    const canStart = players.length >= settings.minPlayers;

    if (gameContent) {
      gameContent.innerHTML = `
        <div class="game-screen game-lobby-screen">
          <header class="game-screen-heading">
            <span>CONEXÃO · DESAFIO RELÂMPAGO</span>
            <strong>CADASTRO SEGURO · ${settings.questionTimeSec}S POR PERGUNTA</strong>
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
              <span class="game-player-counter">
                ${players.length} / ${settings.maxPlayers} ${players.length === 1 ? "participante na sala" : "participantes na sala"}
                ${settings.minPlayers > 1 ? ` (mín. ${settings.minPlayers})` : ""}
              </span>
              ${game.lobbyEndsAt ? `<span class="game-lobby-timer" id="lobbyWaitTimer">Calculando tempo de espera...</span>` : ""}
            </div>
          </div>
          <div class="game-player-list">
            ${players.length
              ? players.map((p) => `
                  <span class="game-player-chip">
                    ${window.GameAvatar?.render(p.avatar, "game-avatar game-avatar-chip") || ""}
                    <span>${escapeHTML(p.name)}</span>
                  </span>
                `).join("")
              : `<span class="game-waiting-chips">Aguardando participantes entrarem...</span>`
            }
          </div>
          <p class="game-privacy-note">Use apenas um apelido. Não informe nome completo, telefone, senha ou documento.</p>
        </div>
      `;
    }

    if (game.lobbyEndsAt) {
      const updateLobbyTimer = () => {
        const remaining = Math.max(0, game.lobbyEndsAt - Date.now());
        const el = document.querySelector("#lobbyWaitTimer");
        const sec = Math.ceil(remaining / 1000);
        if (el) {
          el.textContent = remaining > 0
            ? (settings.autoStart
                ? `Início automático em ${sec}s...`
                : `Tempo de espera sugerido: ${sec}s`)
            : (settings.autoStart
                ? (players.length >= settings.minPlayers ? "Iniciando contagem..." : `Aguardando mínimo de ${settings.minPlayers} participante(s)...`)
                : "Tempo de espera concluído. Pronto para iniciar.");
        }
        if (remaining === 0 && settings.autoStart && players.length >= settings.minPlayers && !stateTransitionLock) {
          void beginCountdown();
        }
      };
      updateLobbyTimer();
      timerInterval = window.setInterval(updateLobbyTimer, 250);
    }

    document.querySelector("#copyJoinUrl")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(joinUrl);
        if (btn) btn.textContent = "Copiado!";
        setTimeout(() => {
          if (btn) btn.textContent = "Copiar link";
        }, 2000);
      } catch {
        setStatus(`Link da sala: ${joinUrl}`);
      }
    });

    setStatus(`Sala ${game.roomCode} aberta · ${players.length}/${settings.maxPlayers} participante(s).`);
    if (hostActions) {
      hostActions.innerHTML = `
        <button type="button" class="host-btn host-btn-primary" id="btnStart" ${!canStart ? "disabled" : ""}>
          Iniciar desafio (${GAME_QUESTIONS.length} perguntas)
        </button>
        <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar sala</button>
      `;
    }

    document.querySelector("#btnStart")?.addEventListener("click", beginCountdown);
    document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
    return;
  }

  if (game.status === "countdown") {
    setPhaseLabel(`SALA ${game.roomCode} · PREPARAR PARA INICIAR`);
    setAudioTrack("countdown");

    if (gameContent) {
      gameContent.innerHTML = `
        <div class="game-screen game-countdown-screen">
          <p class="eyebrow">PREPARE-SE · TODOS OS CELULARES PRONTOS</p>
          <div class="countdown-ring">
            <strong id="countdownBigNumber">${settings.countdownSec}</strong>
          </div>
          <h2>O desafio vai começar!</h2>
          <p class="game-screen-subtitle">${players.length} participante(s) na arena · ${GAME_QUESTIONS.length} perguntas de ${settings.questionTimeSec}s.</p>
        </div>
      `;
    }

    let lastTickSec = -1;
    const updateCountdown = () => {
      const target = game.countdownEndsAt || Date.now();
      const remaining = Math.max(0, target - Date.now());
      const sec = Math.ceil(remaining / 1000);
      const numEl = document.querySelector("#countdownBigNumber");
      if (numEl) numEl.textContent = String(Math.max(1, sec));

      if (sec !== lastTickSec && sec > 0) {
        lastTickSec = sec;
        playEffect("tick");
      }

      if (remaining === 0 && !stateTransitionLock) {
        void startFirstQuestion();
      }
    };

    updateCountdown();
    timerInterval = window.setInterval(updateCountdown, 150);

    setStatus("Contagem regressiva em andamento...");
    if (hostActions) {
      hostActions.innerHTML = `
        <button type="button" class="host-btn host-btn-primary" id="btnSkipCountdown">Começar agora</button>
        <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar sala</button>
      `;
    }
    document.querySelector("#btnSkipCountdown")?.addEventListener("click", startFirstQuestion);
    document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
    return;
  }

  const qIndex = Number(game.questionIndex);
  const qKey = String(qIndex);
  const question = GAME_QUESTIONS[qIndex];
  const durationMs = Number(game.questionDurationMs) || settings.questionTimeSec * 1000;

  if ((game.status === "question" || game.status === "review") && question) {
    const isQuestion = game.status === "question";
    const isReview = game.status === "review";
    const answeredCount = players.filter((p) => p.answers && p.answers[qKey] !== undefined).length;

    setPhaseLabel(`PERGUNTA ${String(qIndex + 1).padStart(2, "0")}/${String(GAME_QUESTIONS.length).padStart(2, "0")} · ${isQuestion ? "EM ANDAMENTO" : "GABARITO"}`);
    setAudioTrack(isQuestion ? "question" : "review");

    if (isQuestion && players.length > 0 && answeredCount >= players.length && !stateTransitionLock) {
      void revealAnswer();
      return;
    }

    if (gameContent) {
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
            ? `<div class="game-timer-row"><span class="game-timer" id="gameTimer">${Math.ceil(durationMs / 1000)}</span><div class="game-timer-track"><i class="game-timer-fill" id="gameTimerFill"></i></div></div>`
            : ""
          }
          <div class="game-projector-answers">
            ${question.choices.map((choice, idx) => `
              <div class="game-projector-answer${isReview && idx === question.answer ? " is-correct" : ""}${isReview && idx !== question.answer ? " is-dimmed" : ""}">
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
    }

    if (isQuestion && game.questionEndsAt) {
      const updateTimer = () => {
        const remaining = Math.max(0, game.questionEndsAt - Date.now());
        const timerEl = gameContent?.querySelector("#gameTimer");
        const fillEl = gameContent?.querySelector("#gameTimerFill");
        if (timerEl) timerEl.textContent = String(Math.ceil(remaining / 1000)).padStart(2, "0");
        if (fillEl) fillEl.style.width = `${Math.max(0, (remaining / durationMs) * 100)}%`;
        if (remaining === 0 && !stateTransitionLock) {
          void revealAnswer();
        }
      };
      updateTimer();
      timerInterval = window.setInterval(updateTimer, 200);
    }

    setStatus(
      isQuestion
        ? `Pergunta ${qIndex + 1} de ${GAME_QUESTIONS.length} · ${answeredCount}/${players.length} responderam`
        : `Resposta revelada · Pergunta ${qIndex + 1} de ${GAME_QUESTIONS.length}`
    );

    if (hostActions) {
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
    }

    document.querySelector("#btnReveal")?.addEventListener("click", revealAnswer);
    document.querySelector("#btnNext")?.addEventListener("click", nextQuestion);
    document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
    return;
  }

  // Tela Final
  setPhaseLabel(`SALA ${game.roomCode} · PÓDIO FINAL`);
  setAudioTrack("final");

  const celebrationKey = `${game.roomCode}:${players.length}`;
  if (lastCelebratedRoom !== celebrationKey) {
    lastCelebratedRoom = celebrationKey;
    playEffect("finish");
    triggerConfetti();
  }

  const winner = players[0];
  const tiedWinners = winner ? players.filter((p) => p.score === winner.score) : [];
  const winnerTitle = !winner
    ? "Sem pontuações"
    : tiedWinners.length > 1
      ? `Empate: ${tiedWinners.map((p) => p.name).join(" & ")}`
      : winner.name;

  if (gameContent) {
    gameContent.innerHTML = `
      <div class="game-screen game-final-screen">
        <header class="game-screen-heading">
          <span>DESAFIO RELÂMPAGO · RESULTADO FINAL</span>
          <strong>PARABÉNS!</strong>
        </header>
        <div class="game-podium-hero">
          ${winner ? window.GameAvatar?.render(winner.avatar, "game-avatar game-avatar-projector-winner") || "" : ""}
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
  }

  setStatus("Desafio concluído!");
  if (hostActions) {
    hostActions.innerHTML = `
      ${settings.allowReplay ? `<button type="button" class="host-btn" id="btnReplaySame">Jogar novamente nesta sala</button>` : ""}
      <button type="button" class="host-btn host-btn-primary" id="btnRestart">Abrir nova sala</button>
      <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar</button>
    `;
  }

  document.querySelector("#btnReplaySame")?.addEventListener("click", replaySameRoom);
  document.querySelector("#btnRestart")?.addEventListener("click", openNewRoom);
  document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
}

// Controles de Áudio e Mixer (todos blindados com ?.)
function updateAudioUI() {
  const enabled = Boolean(window.GameAudio?.isEnabled?.());
  audioToggle?.setAttribute("aria-pressed", String(enabled));
  if (audioToggleLabel) {
    audioToggleLabel.textContent = enabled ? "Som ligado" : "Som desligado";
  }

  const prefs = window.GameAudio?.getPreferences?.() || { musicVolume: 0.65, sfxVolume: 0.85 };
  const mPct = Math.round((prefs.musicVolume ?? 0.65) * 100);
  const sPct = Math.round((prefs.sfxVolume ?? 0.85) * 100);
  if (musicVolumeSlider) musicVolumeSlider.value = String(mPct);
  if (musicVolumeValue) musicVolumeValue.textContent = `${mPct}%`;
  if (sfxVolumeSlider) sfxVolumeSlider.value = String(sPct);
  if (sfxVolumeValue) sfxVolumeValue.textContent = `${sPct}%`;
}

audioToggle?.addEventListener("click", async () => {
  try {
    const next = !Boolean(window.GameAudio?.isEnabled?.());
    await window.GameAudio?.setEnabled?.(next);
    updateAudioUI();
  } catch (err) {
    setStatus(`Áudio indisponível: ${err.message}`);
  }
});

audioMixerBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!audioPopover) return;
  const willOpen = audioPopover.hidden;
  audioPopover.hidden = !willOpen;
  audioMixerBtn.setAttribute("aria-expanded", String(willOpen));
});

audioTestBtn?.addEventListener("click", async () => {
  try {
    if (!window.GameAudio?.isEnabled?.()) {
      await window.GameAudio?.setEnabled?.(true);
      updateAudioUI();
    }
    playEffect("correct");
  } catch {
    // Ignora
  }
});

musicVolumeSlider?.addEventListener("input", () => {
  const pct = Number(musicVolumeSlider.value);
  if (musicVolumeValue) musicVolumeValue.textContent = `${pct}%`;
  window.GameAudio?.setMusicVolume?.(pct / 100);
});

sfxVolumeSlider?.addEventListener("input", () => {
  const pct = Number(sfxVolumeSlider.value);
  if (sfxVolumeValue) sfxVolumeValue.textContent = `${pct}%`;
  window.GameAudio?.setSfxVolume?.(pct / 100);
});

document.addEventListener("click", (event) => {
  if (audioPopover && !audioPopover.hidden) {
    if (!audioPopover.contains(event.target) && event.target !== audioMixerBtn && !audioMixerBtn?.contains(event.target)) {
      audioPopover.hidden = true;
      audioMixerBtn?.setAttribute("aria-expanded", "false");
    }
  }
});

// Listeners do Modal de Configurações (todos blindados com ?.)
settingsToggleBtn?.addEventListener("click", openSettingsModal);
closeSettingsBtn?.addEventListener("click", closeSettingsModal);

settingsModal?.addEventListener("click", (event) => {
  if (event.target === settingsModal) {
    closeSettingsModal();
  }
});

resetSettingsBtn?.addEventListener("click", () => {
  populateSettingsForm(DEFAULT_SETTINGS);
});

matchSettingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const updated = sanitizeSettings({
    maxPlayers: cfgMaxPlayers?.value,
    minPlayers: cfgMinPlayers?.value,
    lobbyWaitSec: cfgLobbyWait?.value,
    countdownSec: cfgCountdown?.value,
    questionTimeSec: cfgQuestionTime?.value,
    autoStart: cfgAutoStart?.checked,
    lateJoin: cfgLateJoin?.checked,
    allowReview: cfgAllowReview?.checked,
    allowReplay: cfgAllowReplay?.checked
  });

  saveHostSettings(updated);
  closeSettingsModal();

  if (activeRoomCode && currentGame) {
    try {
      const patch = {
        settings: updated,
        questionDurationMs: updated.questionTimeSec * 1000
      };
      if (currentGame.status === "lobby") {
        patch.lobbyEndsAt = updated.lobbyWaitSec > 0 ? Date.now() + updated.lobbyWaitSec * 1000 : null;
      }
      await updateDoc(doc(db, "rooms", activeRoomCode), patch);
      setStatus("Configurações da sala atualizadas!");
    } catch (error) {
      setStatus(`Configurações salvas localmente, mas falharam na sala: ${error.message}`);
    }
  } else {
    renderWelcomeScreen();
    setStatus("Parâmetros da partida salvos.");
  }
});

// Tela cheia e atalhos de teclado
fullscreenToggle?.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && settingsModal && !settingsModal.hidden) {
    closeSettingsModal();
    return;
  }
  if (
    event.key.toLowerCase() === "f" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
  ) {
    fullscreenToggle?.click();
  }
});

populateSettingsForm(hostSettings);
updateAudioUI();

if (activeRoomCode) {
  subscribeToRoom(activeRoomCode);
} else {
  renderWelcomeScreen();
}