import { db } from "./firebase-config.js";
import { GAME_QUESTIONS } from "./questions.js";
import {
  doc,
  collection,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const HISTORY_STORAGE_KEY = "conexao-player-history-v1";

const joinForm = document.querySelector("#playerJoinForm");
const joinSection = document.querySelector("#playerJoin");
const joinError = document.querySelector("#playerJoinError");
const roomCodeInput = document.querySelector("#playerRoomCode");
const nameInput = document.querySelector("#playerName");
const joinButton = document.querySelector("#joinButton");
const gameSection = document.querySelector("#playerGame");
const gameContent = document.querySelector("#playerGameContent");
const connectionLabel = document.querySelector("#playerConnection");
const statusLabel = document.querySelector("#playerStatus");
const avatarPreview = document.querySelector("#avatarPreview");
const avatarFields = [...document.querySelectorAll("[data-avatar-field]")];

// Áudio
const audioToggle = document.querySelector("#playerAudioToggle");
const audioLabel = document.querySelector("#playerAudioLabel");
const audioMixerBtn = document.querySelector("#playerAudioMixerBtn");
const audioPopover = document.querySelector("#playerAudioPopover");
const audioTestBtn = document.querySelector("#playerAudioTestBtn");
const musicSlider = document.querySelector("#playerMusicSlider");
const musicVal = document.querySelector("#playerMusicVal");
const sfxSlider = document.querySelector("#playerSfxSlider");
const sfxVal = document.querySelector("#playerSfxVal");

// Histórico
const historyBtn = document.querySelector("#playerHistoryBtn");
const historyModal = document.querySelector("#historyModal");
const closeHistoryBtn = document.querySelector("#closeHistoryBtn");
const historyModalBody = document.querySelector("#historyModalBody");

const params = new URLSearchParams(location.search);
const roomFromUrl = params.get("room") || "";
if (/^\d{5}$/.test(roomFromUrl) && roomCodeInput) {
  roomCodeInput.value = roomFromUrl;
}

let playerId = sessionStorage.getItem("conexao-game-player-id");
let playerRoom = sessionStorage.getItem("conexao-game-room");
let currentGame = null;
let currentPlayers = [];
let currentPlayer = null;
let unsubRoom = null;
let unsubPlayers = null;
let timerInterval = 0;
let submitting = false;
let lastSoundKey = "";
let recordedFinalKey = "";

function selectedAvatar() {
  return Object.fromEntries(avatarFields.map((field) => [field.dataset.avatarField, field.value]));
}

function renderAvatarPreview() {
  if (!avatarPreview) return;
  avatarPreview.innerHTML = window.GameAvatar?.render(selectedAvatar(), "game-avatar game-avatar-preview") || "";
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showStatus(message, error = false) {
  if (!statusLabel) return;
  statusLabel.textContent = message;
  statusLabel.classList.toggle("is-error", error);
}

function setConnected(connected) {
  if (!connectionLabel) return;
  connectionLabel.textContent = connected ? "CONECTADO" : "OFFLINE";
  connectionLabel.classList.toggle("is-connected", connected);
}

function playEffect(name) {
  try {
    window.GameAudio?.playEffect?.(name);
  } catch {
    // Ignora falha de áudio
  }
}

function setAudioTrack(track) {
  try {
    window.GameAudio?.setTrack?.(track);
  } catch {
    // Ignora
  }
}

function triggerConfetti() {
  try {
    if (typeof window.GameConfetti?.burst === "function") {
      window.GameConfetti.burst({ count: 110 });
    } else if (typeof window.launchConfetti === "function") {
      window.launchConfetti();
    }
  } catch {
    // Ignora
  }
}

function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function recordMatchHistory(game, me, rank, totalPlayers) {
  const key = `${game.roomCode}:${me.id}:${me.score}:${Object.keys(me.answers || {}).length}`;
  if (recordedFinalKey === key) return;
  recordedFinalKey = key;

  const correctCount = Object.values(me.answers || {}).filter((a) => a?.correct).length;
  const entry = {
    roomCode: game.roomCode,
    nickname: me.name,
    score: Number(me.score || 0),
    rank,
    totalPlayers,
    correctCount,
    questionCount: GAME_QUESTIONS.length,
    finishedAt: Date.now()
  };

  try {
    const history = loadHistory();
    history.unshift(entry);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 25)));
  } catch {
    // Ignora
  }
}

function openHistoryModal() {
  if (!historyModal || !historyModalBody) return;
  const history = loadHistory();

  if (!history.length) {
    historyModalBody.innerHTML = `
      <p class="player-waiting">Nenhuma partida concluída neste dispositivo ainda. Participe de uma sala para registrar seu desempenho!</p>
    `;
  } else {
    const totalGames = history.length;
    const bestScore = Math.max(...history.map((h) => h.score));
    const avgAccuracy = Math.round(
      history.reduce((acc, h) => acc + (h.correctCount / Math.max(1, h.questionCount)) * 100, 0) / totalGames
    );

    historyModalBody.innerHTML = `
      <div class="history-summary-grid">
        <div class="history-stat"><span>PARTIDAS</span><strong>${totalGames}</strong></div>
        <div class="history-stat"><span>RECORDE</span><strong>${bestScore.toLocaleString("pt-BR")}</strong></div>
        <div class="history-stat"><span>PRECISÃO</span><strong>${avgAccuracy}%</strong></div>
      </div>
      <div class="history-list">
        ${history.map((item) => {
          const dateStr = new Date(item.finishedAt).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          });
          return `
            <div class="history-item">
              <div>
                <b>${escapeHTML(item.nickname)} · Sala ${escapeHTML(item.roomCode)}</b>
                <small>${dateStr} · ${item.rank}º de ${item.totalPlayers} · ${item.correctCount}/${item.questionCount} acertos</small>
              </div>
              <strong>${item.score.toLocaleString("pt-BR")} pts</strong>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  historyModal.hidden = false;
}

function closeHistoryModal() {
  if (historyModal) historyModal.hidden = true;
}

function renderRanking(players) {
  const topPlayers = (players || []).slice(0, 5);
  return `
    <div class="player-ranking">
      <span>PLACAR DA SALA</span>
      <ol>
        ${topPlayers.map((player, index) => `
          <li>
            <span>${String(index + 1).padStart(2, "0")}</span>
            ${window.GameAvatar?.render(player.avatar, "game-avatar game-avatar-ranking") || ""}
            <b>${escapeHTML(player.name)}</b>
            <span>${player.score.toLocaleString("pt-BR")} pts</span>
          </li>
        `).join("")}
      </ol>
    </div>
  `;
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

function clearSession() {
  cleanupListeners();
  sessionStorage.removeItem("conexao-game-player-id");
  sessionStorage.removeItem("conexao-game-room");
  playerId = null;
  playerRoom = null;
  currentGame = null;
  currentPlayers = [];
  currentPlayer = null;
  setConnected(false);
}

function exitToJoinScreen(message) {
  window.clearInterval(timerInterval);
  if (gameSection) gameSection.hidden = true;
  if (joinSection) joinSection.hidden = false;
  setAudioTrack("none");
  showStatus(message);
  clearSession();
}

function renderGame(game, players) {
  currentGame = game;
  window.clearInterval(timerInterval);

  if (!game || game.status === "closed") {
    exitToJoinScreen("A sala foi encerrada. Peça um novo código para entrar em outra partida.");
    return;
  }

  const me = players.find((p) => p.id === playerId);
  if (!me) {
    return;
  }

  setConnected(true);
  currentPlayer = me;
  const settings = game.settings || {};
  const allowReview = settings.allowReview !== false;
  const allowReplay = settings.allowReplay !== false;
  const qIndex = Number(game.questionIndex);
  const qKey = String(qIndex);
  const question = GAME_QUESTIONS[qIndex];
  const roundAnswer = currentPlayer.answers?.[qKey] || null;
  const durationMs = Number(game.questionDurationMs) || (Number(settings.questionTimeSec) || 20) * 1000;

  const soundKey = `${game.status}:${qIndex}`;
  if (soundKey && lastSoundKey && soundKey !== lastSoundKey) {
    if (game.status === "question") playEffect("tick");
    else if (game.status === "review") playEffect(roundAnswer?.correct ? "correct" : "answer");
    else if (game.status === "final") playEffect("finish");
  }
  lastSoundKey = soundKey;

  if (joinSection) joinSection.hidden = true;
  if (gameSection) gameSection.hidden = false;

  const header = `
    <header class="player-card-header">
      <span>DESAFIO · ${escapeHTML(game.roomCode)}</span>
      <span class="player-score">${Number(currentPlayer.score || 0).toLocaleString("pt-BR")} PTS</span>
    </header>
  `;
  const identity = `
    <div class="player-identity">
      ${window.GameAvatar?.render(currentPlayer.avatar, "game-avatar game-avatar-identity") || ""}
      <span>JOGANDO COMO <b>${escapeHTML(currentPlayer.name)}</b></span>
    </div>
  `;

  if (game.status === "lobby") {
    recordedFinalKey = "";
    setAudioTrack("lobby");
    if (gameContent) {
      gameContent.innerHTML = `
        <article class="player-card">
          ${header}
          ${identity}
          <h2>Você entrou na sala!</h2>
          <p class="player-waiting">Aguarde a pessoa que apresenta iniciar o desafio.</p>
          <p class="player-privacy">Você está usando apenas um apelido. Não compartilhe dados pessoais nesta atividade.</p>
        </article>
      `;
    }
    return;
  }

  if (game.status === "countdown") {
    setAudioTrack("countdown");
    if (gameContent) {
      gameContent.innerHTML = `
        <article class="player-card">
          ${header}
          ${identity}
          <div class="player-card-header">
            <span>PREPARE-SE</span>
            <span id="playerCountdownSec">5 SEG</span>
          </div>
          <h2>O desafio vai começar!</h2>
          <p class="player-waiting">Fique atento à tela e responda rápido para ganhar pontos extras.</p>
        </article>
      `;
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, (game.countdownEndsAt || Date.now()) - Date.now());
      const sec = Math.ceil(remaining / 1000);
      const el = gameContent?.querySelector("#playerCountdownSec");
      if (el) el.textContent = `${Math.max(1, sec)} SEG`;
    };
    updateCountdown();
    timerInterval = window.setInterval(updateCountdown, 200);
    return;
  }

  const lastChoice = roundAnswer ? roundAnswer.choice : null;
  const ranking = renderRanking(players);

  if (game.status === "question" && question) {
    setAudioTrack("question");
    const remaining = Math.max(0, (game.questionEndsAt || Date.now()) - Date.now());

    if (gameContent) {
      gameContent.innerHTML = `
        <article class="player-card">
          ${header}
          ${identity}
          <div class="player-card-header">
            <span>PERGUNTA ${String(qIndex + 1).padStart(2, "0")} / ${String(GAME_QUESTIONS.length).padStart(2, "0")}</span>
            <span id="playerSeconds">${Math.ceil(remaining / 1000)} SEG</span>
          </div>
          <h2>${escapeHTML(question.prompt)}</h2>
          <div class="player-timer"><i id="playerTimerFill"></i></div>
          <div class="player-answer-list">
            ${question.choices.map((choice, index) => `
              <button
                class="player-answer${lastChoice === index ? " is-selected" : ""}"
                type="button"
                data-choice="${index}"
                ${lastChoice !== null || submitting ? "disabled" : ""}
              >
                <span>${["A", "B", "C"][index]}</span>
                ${escapeHTML(choice)}
              </button>
            `).join("")}
          </div>
          <p class="player-player-feedback" id="playerFeedback" aria-live="polite">
            ${lastChoice !== null
              ? "Resposta registrada. Aguarde a revelação no telão."
              : "Toque em uma resposta antes do tempo acabar."}
          </p>
        </article>
      `;
    }

    const updateTimer = () => {
      const seconds = Math.max(0, (game.questionEndsAt || Date.now()) - Date.now());
      const secondsLabel = gameContent?.querySelector("#playerSeconds");
      const fill = gameContent?.querySelector("#playerTimerFill");
      if (secondsLabel) secondsLabel.textContent = `${Math.ceil(seconds / 1000)} SEG`;
      if (fill) fill.style.width = `${Math.max(0, (seconds / durationMs) * 100)}%`;
      if (seconds === 0 && lastChoice === null) {
        const feedback = gameContent?.querySelector("#playerFeedback");
        if (feedback) feedback.textContent = "Tempo esgotado. Aguarde a resposta correta.";
        gameContent?.querySelectorAll("[data-choice]").forEach((btn) => { btn.disabled = true; });
      }
    };
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 200);
    return;
  }

  if (game.status === "review" && question) {
    setAudioTrack("review");
    const chosen = lastChoice === null
      ? "Você não respondeu a tempo."
      : roundAnswer?.correct
        ? `Resposta correta! +${roundAnswer.pointsEarned} pts`
        : "Resposta registrada. Confira a explicação para a próxima.";

    if (gameContent) {
      gameContent.innerHTML = `
        <article class="player-card">
          ${header}
          ${identity}
          <div class="player-card-header">
            <span>RESPOSTA REVELADA</span>
            <span>${escapeHTML(chosen)}</span>
          </div>
          <h2>${escapeHTML(question.prompt)}</h2>
          <div class="player-answer-list">
            ${question.choices.map((choice, index) => `
              <div class="player-answer${index === question.answer ? " is-correct" : ""}">
                <span>${["A", "B", "C"][index]}</span>
                ${escapeHTML(choice)}
              </div>
            `).join("")}
          </div>
          <div class="player-review">
            <b>POR QUE É A MAIS SEGURA?</b>
            ${escapeHTML(question.explanation)}
          </div>
          ${ranking}
        </article>
      `;
    }
    return;
  }

  // Tela Final
  setAudioTrack("final");
  const myRank = Math.max(1, players.findIndex((p) => p.id === me.id) + 1);
  recordMatchHistory(game, me, myRank, players.length);

  if (myRank === 1 && players.length > 0) {
    triggerConfetti();
  }

  const winner = players[0];
  const tiedWinners = winner ? players.filter((player) => player.score === winner.score) : [];
  const winnerCard = winner
    ? `
      <div class="player-champion">
        ${window.GameAvatar?.render(winner.avatar, "game-avatar game-avatar-champion") || ""}
        <span>✦</span>
        <b>${tiedWinners.length > 1 ? "Empate!" : escapeHTML(winner.name)}</b>
        <small>${tiedWinners.length > 1
          ? `EMPATE ENTRE ${tiedWinners.map((player) => escapeHTML(player.name)).join(", ")}`
          : "CAMPEÃO"} · ${winner.score.toLocaleString("pt-BR")} PONTOS</small>
      </div>
    `
    : "";

  const personalReviewHtml = allowReview
    ? `
      <div class="player-review-summary">
        <span>SUA REVISÃO INDIVIDUAL (${myRank}º LUGAR)</span>
        ${GAME_QUESTIONS.map((q, idx) => {
          const ans = me.answers?.[String(idx)];
          const isOk = Boolean(ans?.correct);
          return `
            <div class="review-item ${isOk ? "is-ok" : "is-miss"}">
              <b>${idx + 1}. ${escapeHTML(q.prompt)}</b>
              <small>${ans ? `Sua resposta: ${["A", "B", "C"][ans.choice]} (${isOk ? `+${ans.pointsEarned} pts` : "Incorreta"})` : "Não respondida"} · Correta: ${["A", "B", "C"][q.answer]}</small>
            </div>
          `;
        }).join("")}
      </div>
    `
    : "";

  if (gameContent) {
    gameContent.innerHTML = `
      <article class="player-card">
        ${header}
        <div class="player-card-header">
          <span>FIM DE JOGO</span>
          <span>PARABÉNS!</span>
        </div>
        <h2>Desafio concluído.</h2>
        ${winnerCard}
        ${ranking}
        ${personalReviewHtml}
        ${allowReplay ? `<button type="button" class="primary-submit-btn" id="playerPlayAgainBtn">Entrar em outra sala</button>` : ""}
        <p class="player-waiting">Obrigado por jogar! Reveja as dicas com a turma.</p>
      </article>
    `;
  }

  document.querySelector("#playerPlayAgainBtn")?.addEventListener("click", () => {
    exitToJoinScreen("Pronto para entrar em uma nova partida.");
  });
}

function subscribeToRoom(roomCode) {
  cleanupListeners();
  const roomDocRef = doc(db, "rooms", roomCode);
  const playersColRef = collection(db, "rooms", roomCode, "players");

  unsubRoom = onSnapshot(roomDocRef, (snapshot) => {
    if (!snapshot.exists()) {
      exitToJoinScreen("Sala não encontrada ou encerrada.");
      return;
    }
    currentGame = snapshot.data();
    renderGame(currentGame, currentPlayers);
  }, (error) => {
    setConnected(false);
    showStatus(`Erro de conexão com o Firestore: ${error.message}`, true);
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

    if (currentGame) {
      renderGame(currentGame, currentPlayers);
    }
  }, (error) => {
    setConnected(false);
    showStatus(`Erro ao sincronizar jogadores: ${error.message}`, true);
  });
}

async function resumeGame() {
  if (!playerId || !playerRoom) return;
  try {
    const roomSnap = await getDoc(doc(db, "rooms", playerRoom));
    if (!roomSnap.exists() || roomSnap.data().status === "closed") {
      clearSession();
      return;
    }
    const playerSnap = await getDoc(doc(db, "rooms", playerRoom, "players", playerId));
    if (!playerSnap.exists()) {
      clearSession();
      return;
    }
    if (roomCodeInput) roomCodeInput.value = playerRoom;
    subscribeToRoom(playerRoom);
  } catch {
    clearSession();
  }
}

joinForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (joinError) joinError.textContent = "";
  if (joinButton) joinButton.disabled = true;

  const roomCode = (roomCodeInput?.value || "").trim();
  const name = (nameInput?.value || "").trim().replace(/\s+/g, " ").slice(0, 20);
  const avatar = selectedAvatar();

  try {
    if (!/^\d{5}$/.test(roomCode)) {
      throw new Error("Digite o código numérico de 5 dígitos exibido na tela.");
    }
    if (name.length < 2) {
      throw new Error("Escolha um apelido com pelo menos 2 caracteres.");
    }

    const roomSnap = await getDoc(doc(db, "rooms", roomCode));
    if (!roomSnap.exists()) {
      throw new Error("Sala não encontrada. Confira o código na tela.");
    }

    const roomData = roomSnap.data();
    const settings = roomData.settings || {};
    const maxPlayers = Math.min(100, Math.max(2, Number(settings.maxPlayers) || 60));
    const allowLateJoin = Boolean(settings.lateJoin);

    const canJoinNow =
      roomData.status === "lobby" ||
      (allowLateJoin && ["countdown", "question", "review"].includes(roomData.status));

    if (!canJoinNow) {
      throw new Error("O jogo já foi iniciado e não permite entradas tardias.");
    }

    const playersSnap = await getDocs(collection(db, "rooms", roomCode, "players"));
    const existingPlayers = playersSnap.docs.map((d) => d.data());

    if (existingPlayers.length >= maxPlayers) {
      throw new Error(`Esta sala já atingiu o limite de ${maxPlayers} participantes.`);
    }

    const duplicate = existingPlayers.some(
      (p) => (p.name || "").toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")
    );
    if (duplicate) {
      throw new Error("Esse apelido já está na sala. Escolha outro.");
    }

    const initialPlayer = {
      name,
      avatar,
      score: 0,
      joinedAt: Date.now(),
      answers: {}
    };

    const newPlayerRef = await addDoc(collection(db, "rooms", roomCode, "players"), initialPlayer);
    playerId = newPlayerRef.id;
    playerRoom = roomCode;
    currentPlayers = [{ id: playerId, ...initialPlayer }];

    sessionStorage.setItem("conexao-game-player-id", playerId);
    sessionStorage.setItem("conexao-game-room", playerRoom);
    showStatus("");
    subscribeToRoom(roomCode);
  } catch (error) {
    if (joinError) joinError.textContent = error.message;
  } finally {
    if (joinButton) joinButton.disabled = false;
  }
});

avatarFields.forEach((field) => field.addEventListener("change", renderAvatarPreview));
renderAvatarPreview();

// Controles de Áudio e Mixer (todos blindados com ?.)
function updatePlayerAudioUI() {
  const enabled = Boolean(window.GameAudio?.isEnabled?.());
  audioToggle?.setAttribute("aria-pressed", String(enabled));
  if (audioLabel) audioLabel.textContent = enabled ? "Som on" : "Som";

  const prefs = window.GameAudio?.getPreferences?.() || { musicVolume: 0.65, sfxVolume: 0.85 };
  const mPct = Math.round((prefs.musicVolume ?? 0.65) * 100);
  const sPct = Math.round((prefs.sfxVolume ?? 0.85) * 100);
  if (musicSlider) musicSlider.value = String(mPct);
  if (musicVal) musicVal.textContent = `${mPct}%`;
  if (sfxSlider) sfxSlider.value = String(sPct);
  if (sfxVal) sfxVal.textContent = `${sPct}%`;
}

audioToggle?.addEventListener("click", async () => {
  try {
    const enabled = await window.GameAudio?.setEnabled?.(!window.GameAudio?.isEnabled?.());
    updatePlayerAudioUI();
    showStatus(enabled ? "Trilha do jogo ativada." : "Som do jogo desligado.");
  } catch (error) {
    showStatus(`Não foi possível ativar o som: ${error.message}`, true);
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
      updatePlayerAudioUI();
    }
    playEffect("correct");
  } catch {
    // Ignora
  }
});

musicSlider?.addEventListener("input", () => {
  const pct = Number(musicSlider.value);
  if (musicVal) musicVal.textContent = `${pct}%`;
  window.GameAudio?.setMusicVolume?.(pct / 100);
});

sfxSlider?.addEventListener("input", () => {
  const pct = Number(sfxSlider.value);
  if (sfxVal) sfxVal.textContent = `${pct}%`;
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

// Modal de Histórico (blindado com ?.)
historyBtn?.addEventListener("click", openHistoryModal);
closeHistoryBtn?.addEventListener("click", closeHistoryModal);
historyModal?.addEventListener("click", (event) => {
  if (event.target === historyModal) closeHistoryModal();
});

gameContent?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-choice]");
  if (!button || submitting || !playerId || !playerRoom || !currentGame) return;

  const qIndex = Number(currentGame.questionIndex);
  const qKey = String(qIndex);
  const question = GAME_QUESTIONS[qIndex];
  if (!question || currentGame.status !== "question") return;
  if (currentPlayer?.answers?.[qKey] !== undefined) return;

  const choice = Number(button.dataset.choice);
  const durationMs = Number(currentGame.questionDurationMs) || 20000;
  const timeLeft = Math.max(0, (currentGame.questionEndsAt || Date.now()) - Date.now());
  if (timeLeft === 0) return;

  submitting = true;
  button.disabled = true;

  try {
    const correct = choice === question.answer;
    const pointsEarned = correct ? 1000 + Math.round((500 * timeLeft) / durationMs) : 0;
    const newScore = Number(currentPlayer.score || 0) + pointsEarned;

    await updateDoc(doc(db, "rooms", playerRoom, "players", playerId), {
      score: newScore,
      [`answers.${qKey}`]: {
        choice,
        correct,
        pointsEarned,
        answeredAt: Date.now()
      }
    });
  } catch (error) {
    showStatus(`Não foi possível enviar sua resposta: ${error.message}`, true);
  } finally {
    submitting = false;
  }
});

updatePlayerAudioUI();
void resumeGame();