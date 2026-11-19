import { db } from "./firebase-config.js";
import { GAME_QUESTIONS } from "./questions.js";
import {
  ref,
  get,
  set,
  push,
  update,
  onValue,
  off
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

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
const audioToggle = document.querySelector("#playerAudioToggle");

const params = new URLSearchParams(location.search);
const roomFromUrl = params.get("room") || "";
if (/^\d{5}$/.test(roomFromUrl)) roomCodeInput.value = roomFromUrl;

let playerId = sessionStorage.getItem("conexao-game-player-id");
let playerRoom = sessionStorage.getItem("conexao-game-room");
let currentGame = null;
let currentPlayer = null;
let roomRef = null;
let timerInterval = 0;
let submitting = false;
let lastSoundKey = "";

function selectedAvatar() {
  return Object.fromEntries(avatarFields.map((field) => [field.dataset.avatarField, field.value]));
}

function renderAvatarPreview() {
  avatarPreview.innerHTML = window.GameAvatar.render(selectedAvatar(), "game-avatar game-avatar-preview");
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
  statusLabel.textContent = message;
  statusLabel.classList.toggle("is-error", error);
}

function setConnected(connected) {
  connectionLabel.textContent = connected ? "CONECTADO" : "FORA DA SALA";
  connectionLabel.classList.toggle("is-connected", connected);
}

function getSortedPlayers(playersMap) {
  if (!playersMap || typeof playersMap !== "object") return [];
  return Object.entries(playersMap)
    .map(([id, data]) => ({
      id,
      name: data.name || "Participante",
      score: Number(data.score || 0),
      avatar: data.avatar || {},
      answers: data.answers || {}
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "pt-BR"));
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
            ${window.GameAvatar.render(player.avatar, "game-avatar game-avatar-ranking")}
            <b>${escapeHTML(player.name)}</b>
            <span>${player.score.toLocaleString("pt-BR")} pts</span>
          </li>
        `).join("")}
      </ol>
    </div>
  `;
}

function clearSession() {
  if (roomRef) off(roomRef);
  roomRef = null;
  sessionStorage.removeItem("conexao-game-player-id");
  sessionStorage.removeItem("conexao-game-room");
  playerId = null;
  playerRoom = null;
  currentGame = null;
  currentPlayer = null;
  setConnected(false);
}

function renderGame(game) {
  currentGame = game;
  window.clearInterval(timerInterval);

  if (!game || game.status === "closed" || !game.players?.[playerId]) {
    gameSection.hidden = true;
    joinSection.hidden = false;
    void window.GameAudio.setEnabled(false);
    audioToggle.setAttribute("aria-pressed", "false");
    audioToggle.textContent = "♫ Som desligado";
    showStatus("A sala foi encerrada. Peça um novo código para entrar em outra partida.");
    clearSession();
    return;
  }

  setConnected(true);
  const players = getSortedPlayers(game.players);
  currentPlayer = game.players[playerId];
  const qIndex = Number(game.questionIndex);
  const question = GAME_QUESTIONS[qIndex];
  const roundAnswer = currentPlayer.answers?.[qIndex] || null;

  const soundKey = `${game.status}:${qIndex}`;
  if (soundKey && lastSoundKey && soundKey !== lastSoundKey) {
    if (game.status === "question") window.GameAudio.playEffect("tick");
    else if (game.status === "review") window.GameAudio.playEffect(roundAnswer?.correct ? "correct" : "answer");
    else if (game.status === "final") window.GameAudio.playEffect("finish");
  }
  lastSoundKey = soundKey;

  joinSection.hidden = true;
  gameSection.hidden = false;

  const header = `
    <header class="player-card-header">
      <span>DESAFIO · ${escapeHTML(game.roomCode)}</span>
      <span class="player-score">${Number(currentPlayer.score || 0).toLocaleString("pt-BR")} PTS</span>
    </header>
  `;
  const identity = `
    <div class="player-identity">
      ${window.GameAvatar.render(currentPlayer.avatar, "game-avatar game-avatar-identity")}
      <span>JOGANDO COMO <b>${escapeHTML(currentPlayer.name)}</b></span>
    </div>
  `;

  if (game.status === "lobby") {
    gameContent.innerHTML = `
      <article class="player-card">
        ${header}
        ${identity}
        <h2>Você entrou na sala!</h2>
        <p class="player-waiting">Aguarde a pessoa que apresenta iniciar o desafio.</p>
        <p class="player-privacy">Você está usando apenas um apelido. Não compartilhe dados pessoais nesta atividade.</p>
      </article>
    `;
    return;
  }

  const lastChoice = roundAnswer ? roundAnswer.choice : null;
  const ranking = renderRanking(players);

  if (game.status === "question" && question) {
    const remaining = Math.max(0, (game.questionEndsAt || Date.now()) - Date.now());
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

    const updateTimer = () => {
      const seconds = Math.max(0, (game.questionEndsAt || Date.now()) - Date.now());
      const secondsLabel = gameContent.querySelector("#playerSeconds");
      const fill = gameContent.querySelector("#playerTimerFill");
      if (secondsLabel) secondsLabel.textContent = `${Math.ceil(seconds / 1000)} SEG`;
      if (fill) fill.style.width = `${Math.max(0, (seconds / 20000) * 100)}%`;
      if (seconds === 0 && lastChoice === null) {
        const feedback = gameContent.querySelector("#playerFeedback");
        if (feedback) feedback.textContent = "Tempo esgotado. Aguarde a resposta correta.";
        gameContent.querySelectorAll("[data-choice]").forEach((btn) => { btn.disabled = true; });
      }
    };
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 200);
    return;
  }

  if (game.status === "review" && question) {
    const chosen = lastChoice === null
      ? "Você não respondeu a tempo."
      : roundAnswer?.correct
        ? `Resposta correta! +${roundAnswer.pointsEarned} pts`
        : "Resposta registrada. Confira a explicação para a próxima.";

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
    return;
  }

  const winner = players[0];
  const tiedWinners = winner ? players.filter((player) => player.score === winner.score) : [];
  const winnerCard = winner
    ? `
      <div class="player-champion">
        ${window.GameAvatar.render(winner.avatar, "game-avatar game-avatar-champion")}
        <span>✦</span>
        <b>${tiedWinners.length > 1 ? "Empate!" : escapeHTML(winner.name)}</b>
        <small>${tiedWinners.length > 1
          ? `EMPATE ENTRE ${tiedWinners.map((player) => escapeHTML(player.name)).join(", ")}`
          : "CAMPEÃO"} · ${winner.score.toLocaleString("pt-BR")} PONTOS</small>
      </div>
    `
    : "";

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
      <p class="player-waiting">Obrigado por jogar! Reveja as dicas com a turma.</p>
    </article>
  `;
}

function subscribeToRoom(roomCode) {
  if (roomRef) off(roomRef);
  roomRef = ref(db, `rooms/${roomCode}`);
  onValue(roomRef, (snapshot) => {
    renderGame(snapshot.val());
  }, (error) => {
    setConnected(false);
    showStatus(`Erro de conexão com o Firebase: ${error.message}`, true);
  });
}

async function resumeGame() {
  if (!playerId || !playerRoom) return;
  try {
    const snap = await get(ref(db, `rooms/${playerRoom}`));
    const data = snap.val();
    if (!data || data.status === "closed" || !data.players?.[playerId]) {
      clearSession();
      return;
    }
    roomCodeInput.value = playerRoom;
    subscribeToRoom(playerRoom);
  } catch {
    clearSession();
  }
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  joinError.textContent = "";
  joinButton.disabled = true;

  const roomCode = roomCodeInput.value.trim();
  const name = nameInput.value.trim().replace(/\s+/g, " ").slice(0, 20);
  const avatar = selectedAvatar();

  try {
    if (!/^\d{5}$/.test(roomCode)) {
      throw new Error("Digite o código numérico de 5 dígitos exibido na tela.");
    }
    if (name.length < 2) {
      throw new Error("Escolha um apelido com pelo menos 2 caracteres.");
    }

    const roomSnap = await get(ref(db, `rooms/${roomCode}`));
    const roomData = roomSnap.val();

    if (!roomData || roomData.status !== "lobby") {
      throw new Error("Sala não encontrada ou o jogo já foi iniciado. Confira o código na tela.");
    }

    const existingPlayers = Object.values(roomData.players || {});
    if (existingPlayers.length >= 60) {
      throw new Error("Esta sala já atingiu o limite de 60 participantes.");
    }

    const duplicate = existingPlayers.some(
      (p) => (p.name || "").toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")
    );
    if (duplicate) {
      throw new Error("Esse apelido já está na sala. Escolha outro.");
    }

    const newPlayerRef = push(ref(db, `rooms/${roomCode}/players`));
    playerId = newPlayerRef.key;
    playerRoom = roomCode;

    await set(newPlayerRef, {
      name,
      avatar,
      score: 0,
      joinedAt: Date.now()
    });

    sessionStorage.setItem("conexao-game-player-id", playerId);
    sessionStorage.setItem("conexao-game-room", playerRoom);
    showStatus("");
    subscribeToRoom(roomCode);
  } catch (error) {
    joinError.textContent = error.message;
  } finally {
    joinButton.disabled = false;
  }
});

avatarFields.forEach((field) => field.addEventListener("change", renderAvatarPreview));
renderAvatarPreview();

audioToggle.addEventListener("click", async () => {
  try {
    const enabled = await window.GameAudio.setEnabled(!window.GameAudio.isEnabled());
    audioToggle.setAttribute("aria-pressed", String(enabled));
    audioToggle.textContent = enabled ? "♫ Som ligado" : "♫ Som desligado";
    showStatus(enabled ? "Trilha do jogo ativada." : "Som do jogo desligado.");
  } catch (error) {
    showStatus(`Não foi possível ativar o som: ${error.message}`, true);
  }
});

gameContent.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-choice]");
  if (!button || submitting || !playerId || !playerRoom || !currentGame) return;

  const qIndex = Number(currentGame.questionIndex);
  const question = GAME_QUESTIONS[qIndex];
  if (!question || currentGame.status !== "question") return;
  if (currentPlayer?.answers?.[qIndex] !== undefined) return;

  const choice = Number(button.dataset.choice);
  const timeLeft = Math.max(0, (currentGame.questionEndsAt || Date.now()) - Date.now());
  if (timeLeft === 0) return;

  submitting = true;
  button.disabled = true;

  try {
    const correct = choice === question.answer;
    const pointsEarned = correct ? 1000 + Math.round((500 * timeLeft) / 20000) : 0;
    const newScore = Number(currentPlayer.score || 0) + pointsEarned;

    await update(ref(db, `rooms/${playerRoom}/players/${playerId}`), {
      score: newScore,
      [`answers/${qIndex}`]: {
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

void resumeGame();
