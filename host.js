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
const topbarPhaseLabel = document.querySelector("#topbarPhaseLabel");

const audioToggle = document.querySelector("#audioToggle");
const audioToggleLabel = document.querySelector("#audioToggleLabel");
const audioMixerBtn = document.querySelector("#audioMixerBtn");
const audioPopover = document.querySelector("#audioPopover");
const audioTestBtn = document.querySelector("#audioTestBtn");
const musicVolumeSlider = document.querySelector("#musicVolumeSlider");
const musicVolumeValue = document.querySelector("#musicVolumeValue");
const sfxVolumeSlider = document.querySelector("#sfxVolumeSlider");
const sfxVolumeValue = document.querySelector("#sfxVolumeValue");

const fullscreenToggle = document.querySelector("#fullscreenToggle");
const settingsToggleBtn = document.querySelector("#settingsToggleBtn");
const settingsModal = document.querySelector("#settingsModal");
const closeSettingsBtn = document.querySelector("#closeSettingsBtn");
const matchSettingsForm = document.querySelector("#matchSettingsForm");
const resetSettingsBtn = document.querySelector("#resetSettingsBtn");

const SETTINGS_STORAGE_KEY = "conexao-host-settings-v2";
const DEFAULT_SETTINGS = {
  maxPlayers: 30,
  minPlayers: 1,
  lobbyWaitSeconds: 0,
  countdownSeconds: 5,
  questionDurationSec: 20,
  autoStart: true,
  allowLateJoin: false,
  allowReview: true,
  allowReplay: true
};

function loadSavedSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function normalizeSettings(raw) {
  const maxPlayers = Math.min(100, Math.max(2, Number(raw.maxPlayers) || 30));
  const minPlayers = Math.min(maxPlayers, Math.max(1, Number(raw.minPlayers) || 1));
  const lobbyWaitSeconds = Math.min(600, Math.max(0, Number(raw.lobbyWaitSeconds) || 0));
  const countdownSeconds = Math.min(30, Math.max(3, Number(raw.countdownSeconds) || 5));
  const questionDurationSec = Math.min(120, Math.max(5, Number(raw.questionDurationSec) || 20));
  return {
    maxPlayers,
    minPlayers,
    lobbyWaitSeconds,
    countdownSeconds,
    questionDurationSec,
    autoStart: raw.autoStart !== false,
    allowLateJoin: Boolean(raw.allowLateJoin),
    allowReview: raw.allowReview !== false,
    allowReplay: raw.allowReplay !== false
  };
}

let draftSettings = loadSavedSettings();
let activeRoomCode = sessionStorage.getItem("conexao-host-room") || null;
let unsubRoom = null;
let unsubPlayers = null;
let currentGame = null;
let currentPlayers = [];
let timerInterval = 0;
let autoTransitionLock = false;
let lastKnownPlayerCount = 0;
let lastHostSoundKey = "";
let lastCountdownTick = -1;
let timeoutSoundPlayedFor = "";

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

function getActiveSettings() {
  if (currentGame?.settings) {
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...currentGame.settings });
  }
  return draftSettings;
}

function syncSettingsForm(settings) {
  document.querySelector("#cfgMaxPlayers").value = String(settings.maxPlayers);
  document.querySelector("#cfgMinPlayers").value = String(settings.minPlayers);
  document.querySelector("#cfgLobbyWait").value = String(settings.lobbyWaitSeconds);
  document.querySelector("#cfgCountdown").value = String(settings.countdownSeconds);
  document.querySelector("#cfgQuestionTime").value = String(settings.questionDurationSec);
  document.querySelector("#cfgAutoStart").checked = settings.autoStart;
  document.querySelector("#cfgLateJoin").checked = settings.allowLateJoin;
  document.querySelector("#cfgAllowReview").checked = settings.allowReview;
  document.querySelector("#cfgAllowReplay").checked = settings.allowReplay;
}

function readSettingsForm() {
  return normalizeSettings({
    maxPlayers: document.querySelector("#cfgMaxPlayers").value,
    minPlayers: document.querySelector("#cfgMinPlayers").value,
    lobbyWaitSeconds: document.querySelector("#cfgLobbyWait").value,
    countdownSeconds: document.querySelector("#cfgCountdown").value,
    questionDurationSec: document.querySelector("#cfgQuestionTime").value,
    autoStart: document.querySelector("#cfgAutoStart").checked,
    allowLateJoin: document.querySelector("#cfgLateJoin").checked,
    allowReview: document.querySelector("#cfgAllowReview").checked,
    allowReplay: document.querySelector("#cfgAllowReplay").checked
  });
}

function openSettingsModal() {
  syncSettingsForm(getActiveSettings());
  settingsModal.hidden = false;
}

function closeSettingsModal() {
  settingsModal.hidden = true;
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
  lastKnownPlayerCount = 0;
  lastHostSoundKey = "";
  lastCountdownTick = -1;
  timeoutSoundPlayedFor = "";

  const roomDocRef = doc(db, "rooms", roomCode);
  const playersColRef = collection(db, "rooms", roomCode, "players");

  unsubRoom = onSnapshot(roomDocRef, (snapshot) => {
    if (!snapshot.exists()) {
      currentGame = null;
      sessionStorage.removeItem("conexao-host-room");
      activeRoomCode = null;
      cleanupListeners();
      window.GameConfetti?.stop();
      window.GameAudio?.setTrack("none");
      renderWelcomeScreen();
      return;
    }
    const data = snapshot.data();
    if (data.status === "closed") {
      currentGame = null;
      sessionStorage.removeItem("conexao-host-room");
      activeRoomCode = null;
      cleanupListeners();
      window.GameConfetti?.stop();
      window.GameAudio?.setTrack("none");
      renderWelcomeScreen();
      return;
    }
    currentGame = data;
    renderGame(currentGame, currentPlayers);
  }, (error) => {
    hostStatus.textContent = `Erro no Firestore: ${error.message}`;
  });

  unsubPlayers = onSnapshot(playersColRef, (snapshot) => {
    const nextPlayers = snapshot.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || "Participante",
          score: Number(data.score || 0),
          attemptNumber: Number(data.attemptNumber || 1),
          avatar: data.avatar || {},
          answers: data.answers || {}
        };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "pt-BR"));

    if (currentGame?.status === "lobby" && nextPlayers.length > lastKnownPlayerCount) {
      window.GameAudio?.playEffect("join");
    }
    lastKnownPlayerCount = nextPlayers.length;
    currentPlayers = nextPlayers;

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
  window.GameConfetti?.stop();

  try {
    let code = generateRoomCode();
    for (let attempt = 0; attempt < 10; attempt++) {
      const existing = await getDoc(doc(db, "rooms", code));
      if (!existing.exists()) break;
      code = generateRoomCode();
    }

    const settings = normalizeSettings(draftSettings);
    const now = Date.now();
    const lobbyEndsAt = settings.lobbyWaitSeconds > 0
      ? now + settings.lobbyWaitSeconds * 1000
      : null;

    autoTransitionLock = false;
    await setDoc(doc(db, "rooms", code), {
      roomCode: code,
      status: "lobby",
      questionIndex: -1,
      questionCount: GAME_QUESTIONS.length,
      questionEndsAt: null,
      lobbyEndsAt,
      countdownEndsAt: null,
      settings,
      createdAt: now
    });
    subscribeToRoom(code);
  } catch (error) {
    console.error("Erro ao abrir sala:", error);
    hostStatus.textContent = `Erro ao abrir sala: ${error.message}`;
    buttons.forEach((btn) => { btn.disabled = false; });
  }
}

async function beginCountdown() {
  if (!activeRoomCode || !currentGame || currentGame.status !== "lobby") return;
  const settings = getActiveSettings();
  if (currentPlayers.length < settings.minPlayers) {
    hostStatus.textContent = `São necessários pelo menos ${settings.minPlayers} participante(s) para iniciar.`;
    return;
  }
  if (autoTransitionLock) return;
  autoTransitionLock = true;
  lastCountdownTick = -1;

  try {
    await updateDoc(doc(db, "rooms", activeRoomCode), {
      status: "countdown",
      lobbyEndsAt: null,
      countdownEndsAt: Date.now() + settings.countdownSeconds * 1000
    });
  } catch (error) {
    hostStatus.textContent = `Erro ao iniciar contagem: ${error.message}`;
  } finally {
    autoTransitionLock = false;
  }
}

async function launchFirstQuestion() {
  if (!activeRoomCode || !currentGame) return;
  if (autoTransitionLock) return;
  autoTransitionLock = true;
  const settings = getActiveSettings();

  try {
    await updateDoc(doc(db, "rooms", activeRoomCode), {
      status: "question",
      questionIndex: 0,
      lobbyEndsAt: null,
      countdownEndsAt: null,
      questionEndsAt: Date.now() + settings.questionDurationSec * 1000
    });
  } catch (error) {
    hostStatus.textContent = `Erro ao iniciar perguntas: ${error.message}`;
  } finally {
    autoTransitionLock = false;
  }
}

async function revealAnswer() {
  if (!activeRoomCode || !currentGame || currentGame.status !== "question") return;
  if (autoTransitionLock) return;
  autoTransitionLock = true;
  try {
    await updateDoc(doc(db, "rooms", activeRoomCode), {
      status: "review",
      questionEndsAt: null
    });
  } finally {
    autoTransitionLock = false;
  }
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
  const settings = getActiveSettings();
  autoTransitionLock = false;
  await updateDoc(doc(db, "rooms", activeRoomCode), {
    status: "question",
    questionIndex: nextIndex,
    questionEndsAt: Date.now() + settings.questionDurationSec * 1000
  });
}

async function closeRoom() {
  window.clearInterval(timerInterval);
  window.GameConfetti?.stop();
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
      // Ignora caso já tenha sido encerrada
    }
  }

  window.GameAudio?.setTrack("none");
  renderWelcomeScreen();
}

function renderWelcomeScreen() {
  window.clearInterval(timerInterval);
  topbarPhaseLabel.textContent = "ARENA INTERATIVA · PRONTA";
  const cfg = draftSettings;

  gameContent.innerHTML = `
    <div class="game-screen game-welcome-screen">
      <p class="eyebrow">ATIVIDADE INTERATIVA EM TEMPO REAL</p>
      <h1>Desafio<br /><span class="accent">Relâmpago.</span></h1>
      <p class="welcome-copy">
        Configure os parâmetros da partida, abra uma sala e projete o QR Code. Os participantes entram pelo celular em tempo real e disputam o pódio.
      </p>
      <div class="welcome-settings-summary">
        <span class="summary-pill">Até ${cfg.maxPlayers} jogadores</span>
        <span class="summary-pill">${cfg.questionDurationSec}s por pergunta</span>
        <span class="summary-pill">Contagem: ${cfg.countdownSeconds}s</span>
        <span class="summary-pill">${cfg.lobbyWaitSeconds > 0 ? `Espera: ${cfg.lobbyWaitSeconds}s` : "Início manual"}</span>
      </div>
      <div class="welcome-cta-group">
        <button type="button" class="primary-cta" id="welcomeOpenRoom">
          <span>Abrir sala do desafio</span>
          <span aria-hidden="true">→</span>
        </button>
        <button type="button" class="secondary-cta" id="welcomeConfigureBtn">
          <span>Configurar partida</span>
        </button>
      </div>
    </div>
  `;

  hostStatus.textContent = "Pronto para configurar ou abrir uma nova sala.";
  hostActions.innerHTML = `
    <button type="button" class="host-btn" id="barConfigureBtn">Configurações</button>
    <button type="button" class="host-btn host-btn-primary" id="barOpenRoom">Abrir nova sala</button>
  `;

  document.querySelector("#welcomeOpenRoom")?.addEventListener("click", openNewRoom);
  document.querySelector("#barOpenRoom")?.addEventListener("click", openNewRoom);
  document.querySelector("#welcomeConfigureBtn")?.addEventListener("click", openSettingsModal);
  document.querySelector("#barConfigureBtn")?.addEventListener("click", openSettingsModal);
}

function renderStandings(players, startRank = 1, maxItems = 8) {
  const slice = players.slice(0, maxItems);
  if (!slice.length) {
    return `<p class="game-waiting-chips">A classificação aparece aqui quando a rodada começar.</p>`;
  }
  return `
    <ol class="game-standings">
      ${slice.map((player, idx) => `
        <li>
          <span class="game-rank">${String(startRank + idx).padStart(2, "0")}</span>
          ${window.GameAvatar.render(player.avatar, "game-avatar game-avatar-ranking")}
          <b>${escapeHTML(player.name)}</b>
          <strong>${player.score.toLocaleString("pt-BR")} pts</strong>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderPodium(players) {
  if (!players.length) {
    return `<p class="game-waiting-chips">Nenhum participante registrado nesta partida.</p>`;
  }

  const first = players[0] || null;
  const second = players[1] || null;
  const third = players[2] || null;

  const slots = [];
  if (second) slots.push({ place: 2, cls: "podium-slot-second", player: second });
  if (first) slots.push({ place: 1, cls: "podium-slot-first", player: first });
  if (third) slots.push({ place: 3, cls: "podium-slot-third", player: third });

  return `
    <div class="podium-arena" aria-label="Pódio dos vencedores">
      ${slots.map((slot) => `
        <div class="podium-slot ${slot.cls}">
          <div class="podium-player-card">
            ${slot.place === 1 ? `<span class="podium-champion-tag">CAMPEÃO</span>` : ""}
            <div class="podium-avatar-wrap">
              ${window.GameAvatar.render(slot.player.avatar, "game-avatar podium-avatar")}
            </div>
            <div class="podium-name" title="${escapeHTML(slot.player.name)}">${escapeHTML(slot.player.name)}</div>
            <div class="podium-score">${slot.player.score.toLocaleString("pt-BR")} pts</div>
          </div>
          <div class="podium-pedestal">
            <span class="podium-place-num">${slot.place}º</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function handleAudioState(game) {
  const key = `${game.status}:${game.questionIndex}`;
  if (key === lastHostSoundKey) return;
  lastHostSoundKey = key;

  if (game.status === "lobby") {
    window.GameAudio?.setTrack("lobby");
  } else if (game.status === "countdown") {
    window.GameAudio?.setTrack("countdown");
  } else if (game.status === "question") {
    if (Number(game.questionIndex) === 0) {
      window.GameAudio?.playEffect("start");
    }
    window.GameAudio?.setTrack("question");
  } else if (game.status === "review") {
    window.GameAudio?.setTrack("review");
  } else if (game.status === "final") {
    window.GameAudio?.setTrack("victory");
    window.GameAudio?.playEffect("champion");
    window.GameConfetti?.burst();
  }
}

function renderGame(game, players) {
  window.clearInterval(timerInterval);
  const settings = getActiveSettings();
  handleAudioState(game);

  const joinUrl = `${window.location.origin}/play?room=${encodeURIComponent(game.roomCode)}`;

  if (game.status === "lobby") {
    topbarPhaseLabel.textContent = `SALA ${game.roomCode} · AGUARDANDO ENTRADAS`;
    let qrSvg = "";
    try {
      qrSvg = window.qrCodeSvg(joinUrl);
    } catch {
      qrSvg = `<div class="qr-fallback">${escapeHTML(joinUrl)}</div>`;
    }

    const canStart = players.length >= settings.minPlayers;

    gameContent.innerHTML = `
      <div class="game-screen game-lobby-screen">
        <header class="game-screen-heading">
          <span>CONEXÃO · DESAFIO RELÂMPAGO</span>
          <strong>${settings.allowLateJoin ? "ENTRADA ABERTA" : "BLOQUEIA APÓS INÍCIO"}</strong>
        </header>
        <h2>Entre na sala</h2>
        <p class="game-screen-subtitle">
          Escaneie o QR Code pelo celular ou acesse o endereço abaixo e digite o código da sala.
        </p>

        <div class="game-lobby-layout">
          <div class="game-qr-frame">${qrSvg}</div>
          <div class="game-room-info">
            <span>CÓDIGO DA SALA</span>
            <strong class="game-room-code">${escapeHTML(game.roomCode)}</strong>
            <span class="game-url-label">ENDEREÇO DE ACESSO</span>
            <div class="game-url-row">
              <code class="game-join-url">${escapeHTML(joinUrl)}</code>
              <button type="button" class="copy-link-btn" id="copyJoinUrl">Copiar link</button>
            </div>
            <div class="lobby-metrics-bar">
              <span class="game-player-counter">${players.length} / ${settings.maxPlayers} participante(s)</span>
              ${game.lobbyEndsAt ? `<span class="lobby-wait-badge" id="lobbyWaitTimer">Início em --s</span>` : ""}
            </div>
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
            : `<span class="game-waiting-chips">Aguardando participantes entrarem (mínimo: ${settings.minPlayers})...</span>`
          }
        </div>
        <p class="game-privacy-note">Use apenas um apelido. Não informe nome completo, telefone, senha ou documento.</p>
      </div>
    `;

    document.querySelector("#copyJoinUrl")?.addEventListener("click", async (e) => {
      try {
        await navigator.clipboard.writeText(joinUrl);
        e.currentTarget.textContent = "Copiado!";
        setTimeout(() => { if (e.target) e.target.textContent = "Copiar link"; }, 2000);
      } catch {
        hostStatus.textContent = `Link da sala: ${joinUrl}`;
      }
    });

    if (game.lobbyEndsAt) {
      const updateLobbyTimer = () => {
        const remaining = Math.max(0, game.lobbyEndsAt - Date.now());
        const sec = Math.ceil(remaining / 1000);
        const badge = gameContent.querySelector("#lobbyWaitTimer");
        if (badge) {
          badge.textContent = sec > 0 ? `Tempo de espera: ${sec}s` : "Tempo de espera encerrado";
        }
        if (remaining === 0 && !autoTransitionLock) {
          if (settings.autoStart && currentPlayers.length >= settings.minPlayers) {
            void beginCountdown();
          } else if (currentPlayers.length < settings.minPlayers) {
            hostStatus.textContent = `Tempo de espera encerrado, mas faltam participantes (mínimo ${settings.minPlayers}).`;
          }
        }
      };
      updateLobbyTimer();
      timerInterval = window.setInterval(updateLobbyTimer, 250);
    }

    hostStatus.textContent = `Sala ${game.roomCode} aberta · ${players.length}/${settings.maxPlayers} participante(s).`;
    hostActions.innerHTML = `
      <button type="button" class="host-btn" id="btnLobbyConfig">Configurar</button>
      <button type="button" class="host-btn host-btn-primary" id="btnStart" ${canStart ? "" : "disabled"}>
        Iniciar contagem (${settings.countdownSeconds}s)
      </button>
      <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar sala</button>
    `;
    document.querySelector("#btnLobbyConfig")?.addEventListener("click", openSettingsModal);
    document.querySelector("#btnStart")?.addEventListener("click", beginCountdown);
    document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
    return;
  }

  if (game.status === "countdown") {
    topbarPhaseLabel.textContent = `SALA ${game.roomCode} · PREPARANDO PARTIDA`;
    const initialSec = Math.max(1, Math.ceil(((game.countdownEndsAt || Date.now()) - Date.now()) / 1000));

    gameContent.innerHTML = `
      <div class="game-screen game-countdown-screen">
        <p class="eyebrow">PREPARE-SE · A PARTIDA VAI COMEÇAR</p>
        <h2>Atenção ao telão e ao celular</h2>
        <div class="countdown-ring">
          <span class="countdown-number" id="hostCountdownNum">${initialSec}</span>
        </div>
        <p class="game-screen-subtitle">${players.length} participante(s) na disputa · ${GAME_QUESTIONS.length} perguntas</p>
      </div>
    `;

    const updateCountdown = () => {
      const remaining = Math.max(0, (game.countdownEndsAt || Date.now()) - Date.now());
      const sec = Math.ceil(remaining / 1000);
      const numEl = gameContent.querySelector("#hostCountdownNum");
      if (numEl) numEl.textContent = sec > 0 ? String(sec) : "VAI!";

      if (sec > 0 && sec !== lastCountdownTick) {
        lastCountdownTick = sec;
        window.GameAudio?.playEffect("countdownTick");
      }

      if (remaining === 0 && !autoTransitionLock) {
        window.GameAudio?.playEffect("countdownGo");
        void launchFirstQuestion();
      }
    };

    updateCountdown();
    timerInterval = window.setInterval(updateCountdown, 150);

    hostStatus.textContent = `Contagem regressiva em andamento...`;
    hostActions.innerHTML = `
      <button type="button" class="host-btn host-btn-primary" id="btnSkipCountdown">Começar agora</button>
      <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar sala</button>
    `;
    document.querySelector("#btnSkipCountdown")?.addEventListener("click", launchFirstQuestion);
    document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
    return;
  }

  const qIndex = Number(game.questionIndex);
  const qKey = String(qIndex);
  const question = GAME_QUESTIONS[qIndex];
  const durationMs = settings.questionDurationSec * 1000;

  if ((game.status === "question" || game.status === "review") && question) {
    const isQuestion = game.status === "question";
    const isReview = game.status === "review";
    const answeredCount = players.filter((p) => p.answers && p.answers[qKey] !== undefined).length;
    topbarPhaseLabel.textContent = `SALA ${game.roomCode} · PERGUNTA ${qIndex + 1} DE ${GAME_QUESTIONS.length}`;

    if (isQuestion && players.length > 0 && answeredCount >= players.length && !autoTransitionLock) {
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
          ? `<div class="game-timer-row"><span class="game-timer" id="gameTimer">${settings.questionDurationSec}</span><div class="game-timer-track"><i class="game-timer-fill" id="gameTimerFill"></i></div></div>`
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
            <b>EXPLICAÇÃO</b>
            <span>${escapeHTML(question.explanation)}</span>
          </div>
          <div class="game-live-score">
            <span>CLASSIFICAÇÃO PARCIAL</span>
            ${renderStandings(players, 1, 5)}
          </div>
        ` : ""}
        <p class="game-screen-foot">
          ${isQuestion ? "Responda no seu celular antes do tempo acabar." : "Confira a resposta correta e avance para a próxima rodada."}
        </p>
      </div>
    `;

    if (isQuestion && game.questionEndsAt) {
      const updateTimer = () => {
        const remaining = Math.max(0, game.questionEndsAt - Date.now());
        const sec = Math.ceil(remaining / 1000);
        const timerEl = gameContent.querySelector("#gameTimer");
        const fillEl = gameContent.querySelector("#gameTimerFill");
        if (timerEl) {
          timerEl.textContent = String(sec).padStart(2, "0");
          timerEl.classList.toggle("is-urgent", sec <= 5);
        }
        if (fillEl) {
          fillEl.style.width = `${(remaining / durationMs) * 100}%`;
          fillEl.classList.toggle("is-urgent", sec <= 5);
        }
        if (remaining === 0) {
          const timeoutKey = `${game.roomCode}:${qIndex}`;
          if (timeoutSoundPlayedFor !== timeoutKey) {
            timeoutSoundPlayedFor = timeoutKey;
            window.GameAudio?.playEffect("timeout");
          }
          if (!autoTransitionLock) {
            void revealAnswer();
          }
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
          ${qIndex === GAME_QUESTIONS.length - 1 ? "Ver pódio final →" : "Próxima pergunta →"}
        </button>
        <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar sala</button>
      `;

    document.querySelector("#btnReveal")?.addEventListener("click", revealAnswer);
    document.querySelector("#btnNext")?.addEventListener("click", nextQuestion);
    document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
    return;
  }

  // Tela de Encerramento e Pódio
  topbarPhaseLabel.textContent = `SALA ${game.roomCode} · PÓDIO FINAL`;
  const remainingPlayers = players.slice(3);

  gameContent.innerHTML = `
    <div class="game-screen game-final-screen">
      <header class="game-screen-heading">
        <span>DESAFIO RELÂMPAGO · RESULTADO FINAL</span>
        <strong>PARTIDA CONCLUÍDA</strong>
      </header>
      <h2>Pódio dos Vencedores</h2>
      ${renderPodium(players)}
      ${remainingPlayers.length > 0 ? `
        <div class="game-final-standings">
          <span>DEMAIS PARTICIPANTES</span>
          ${renderStandings(remainingPlayers, 4, 15)}
        </div>
      ` : ""}
      <p class="game-screen-foot">Pontuação calculada por acertos e velocidade de resposta.</p>
    </div>
  `;

  hostStatus.textContent = "Desafio concluído! Pódio exibido.";
  hostActions.innerHTML = `
    <button type="button" class="host-btn" id="btnCelebrationAgain">Repetir confetes</button>
    <button type="button" class="host-btn host-btn-primary" id="btnRestart">Abrir nova sala</button>
    <button type="button" class="host-btn host-btn-danger" id="btnClose">Encerrar</button>
  `;
  document.querySelector("#btnCelebrationAgain")?.addEventListener("click", () => {
    window.GameConfetti?.burst();
    window.GameAudio?.playEffect("champion");
  });
  document.querySelector("#btnRestart")?.addEventListener("click", openNewRoom);
  document.querySelector("#btnClose")?.addEventListener("click", closeRoom);
}

// Controles de Áudio
function initAudioControls() {
  const prefs = window.GameAudio.getPrefs();
  musicVolumeSlider.value = String(Math.round(prefs.musicVolume * 100));
  musicVolumeValue.textContent = `${musicVolumeSlider.value}%`;
  sfxVolumeSlider.value = String(Math.round(prefs.sfxVolume * 100));
  sfxVolumeValue.textContent = `${sfxVolumeSlider.value}%`;

  audioToggle.addEventListener("click", async () => {
    try {
      const enabled = await window.GameAudio.setEnabled(!window.GameAudio.isEnabled());
      audioToggle.setAttribute("aria-pressed", String(enabled));
      audioToggleLabel.textContent = enabled ? "Som ligado" : "Som desligado";
      if (enabled && currentGame) {
        lastHostSoundKey = "";
        handleAudioState(currentGame);
      }
    } catch (err) {
      hostStatus.textContent = `Áudio indisponível: ${err.message}`;
    }
  });

  audioMixerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = audioPopover.hidden;
    audioPopover.hidden = !open;
    audioMixerBtn.setAttribute("aria-expanded", String(open));
  });

  musicVolumeSlider.addEventListener("input", () => {
    musicVolumeValue.textContent = `${musicVolumeSlider.value}%`;
    window.GameAudio.setMusicVolume(Number(musicVolumeSlider.value) / 100);
  });

  sfxVolumeSlider.addEventListener("input", () => {
    sfxVolumeValue.textContent = `${sfxVolumeSlider.value}%`;
    window.GameAudio.setSfxVolume(Number(sfxVolumeSlider.value) / 100);
  });

  audioTestBtn.addEventListener("click", async () => {
    if (!window.GameAudio.isEnabled()) {
      await window.GameAudio.setEnabled(true);
      audioToggle.setAttribute("aria-pressed", "true");
      audioToggleLabel.textContent = "Som ligado";
    }
    window.GameAudio.playEffect("correct");
  });

  document.addEventListener("click", (e) => {
    if (!audioPopover.hidden && !e.target.closest(".audio-control-wrap")) {
      audioPopover.hidden = true;
      audioMixerBtn.setAttribute("aria-expanded", "false");
    }
  });
}

// Eventos de Configurações
settingsToggleBtn.addEventListener("click", openSettingsModal);
closeSettingsBtn.addEventListener("click", closeSettingsModal);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});

resetSettingsBtn.addEventListener("click", () => {
  syncSettingsForm(DEFAULT_SETTINGS);
});

matchSettingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const updated = readSettingsForm();
  draftSettings = updated;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignora
  }

  if (activeRoomCode && currentGame && currentGame.status === "lobby") {
    try {
      const lobbyEndsAt = updated.lobbyWaitSeconds > 0
        ? Date.now() + updated.lobbyWaitSeconds * 1000
        : null;
      await updateDoc(doc(db, "rooms", activeRoomCode), {
        settings: updated,
        lobbyEndsAt
      });
      hostStatus.textContent = "Configurações da sala atualizadas em tempo real.";
    } catch (error) {
      hostStatus.textContent = `Erro ao salvar configurações na sala: ${error.message}`;
    }
  } else {
    renderWelcomeScreen();
    hostStatus.textContent = "Configurações salvas para a próxima sala.";
  }
  closeSettingsModal();
});

fullscreenToggle.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "f" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    fullscreenToggle.click();
  } else if (event.key === "Escape" && !settingsModal.hidden) {
    closeSettingsModal();
  }
});

initAudioControls();
if (activeRoomCode) {
  subscribeToRoom(activeRoomCode);
} else {
  renderWelcomeScreen();
}