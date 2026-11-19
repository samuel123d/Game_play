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

let playerToken = sessionStorage.getItem("conexao-game-player-token");
let playerRoom = sessionStorage.getItem("conexao-game-room");
let currentGame = null;
let currentPlayer = null;
let stream = null;
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
    "'": "&#39;",
  })[character]);
}

function showStatus(message, error = false) {
  statusLabel.textContent = message;
  statusLabel.classList.toggle("is-error", error);
}

function setConnected(connected) {
  connectionLabel.textContent = connected ? "CONECTADO" : "RECONECTANDO";
  connectionLabel.classList.toggle("is-connected", connected);
}

function renderRanking(players) {
  const topPlayers = (players || []).slice(0, 5);
  return `<div class="player-ranking"><span>PLACAR DA SALA</span><ol>${topPlayers.map((player, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span>${window.GameAvatar.render(player.avatar, "game-avatar game-avatar-ranking")}<b>${escapeHTML(player.name)}</b><span>${player.score.toLocaleString("pt-BR")} pts</span></li>`).join("")}</ol></div>`;
}

function renderGame(game, player = currentPlayer) {
  currentGame = game;
  currentPlayer = player || currentPlayer;
  window.clearInterval(timerInterval);
  const soundKey = game ? `${game.status}:${game.questionIndex}` : "";
  if (soundKey && lastSoundKey && soundKey !== lastSoundKey) {
    if (game.status === "question") window.GameAudio.playEffect("tick");
    else if (game.status === "review") window.GameAudio.playEffect(currentPlayer?.lastCorrect ? "correct" : "answer");
    else if (game.status === "final") window.GameAudio.playEffect("finish");
  }
  lastSoundKey = soundKey;
  if (!game || game.status === "closed") {
    gameSection.hidden = true;
    joinSection.hidden = false;
    if (game?.status === "closed") {
      void window.GameAudio.setEnabled(false);
      audioToggle.setAttribute("aria-pressed", "false");
      audioToggle.textContent = "♫ Som desligado";
    }
    showStatus("A sala foi encerrada. Peça um novo código para entrar em outra partida.");
    sessionStorage.removeItem("conexao-game-player-token");
    sessionStorage.removeItem("conexao-game-room");
    playerToken = null;
    playerRoom = null;
    if (stream) stream.close();
    return;
  }

  joinSection.hidden = true;
  gameSection.hidden = false;
  const header = `<header class="player-card-header"><span>DESAFIO · ${escapeHTML(game.roomCode)}</span><span class="player-score">${(currentPlayer?.score || 0).toLocaleString("pt-BR")} PTS</span></header>`;
  const identity = `<div class="player-identity">${window.GameAvatar.render(currentPlayer?.avatar, "game-avatar game-avatar-identity")}<span>JOGANDO COMO <b>${escapeHTML(currentPlayer?.name || "participante")}</b></span></div>`;
  if (game.status === "lobby") {
    gameContent.innerHTML = `<article class="player-card">${header}${identity}<h2>Você entrou na sala!</h2><p class="player-waiting">Aguarde a pessoa que apresenta iniciar o desafio.</p><p class="player-privacy">Você está usando apenas um apelido. Não compartilhe dados pessoais nesta atividade.</p></article>`;
    return;
  }

  const question = game.question;
  const lastChoice = currentPlayer?.lastChoice ?? null;
  const ranking = renderRanking(game.players);
  if (game.status === "question" && question) {
    const remaining = Math.max(0, game.questionEndsAt - Date.now());
    gameContent.innerHTML = `<article class="player-card">${header}${identity}<div class="player-card-header"><span>PERGUNTA ${String(game.questionIndex + 1).padStart(2, "0")} / ${String(game.questionCount).padStart(2, "0")}</span><span id="playerSeconds">${Math.ceil(remaining / 1000)} SEG</span></div><h2>${escapeHTML(question.prompt)}</h2><div class="player-timer"><i id="playerTimerFill"></i></div><div class="player-answer-list">${question.choices.map((choice, index) => `<button class="player-answer${lastChoice === index ? " is-selected" : ""}" type="button" data-choice="${index}" ${lastChoice !== null || submitting ? "disabled" : ""}><span>${["A", "B", "C"][index]}</span>${escapeHTML(choice)}</button>`).join("")}</div><p class="player-player-feedback" id="playerFeedback" aria-live="polite">${lastChoice !== null ? "Resposta registrada. Aguarde a revelação no telão." : "Toque em uma resposta antes do tempo acabar."}</p></article>`;
    const updateTimer = () => {
      const seconds = Math.max(0, game.questionEndsAt - Date.now());
      const secondsLabel = gameContent.querySelector("#playerSeconds");
      const fill = gameContent.querySelector("#playerTimerFill");
      if (secondsLabel) secondsLabel.textContent = `${Math.ceil(seconds / 1000)} SEG`;
      if (fill) fill.style.width = `${Math.max(0, seconds / 20000 * 100)}%`;
      if (seconds === 0 && lastChoice === null) {
        const feedback = gameContent.querySelector("#playerFeedback");
        if (feedback) feedback.textContent = "Tempo esgotado. Aguarde a resposta correta.";
      }
    };
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 200);
    return;
  }

  if (game.status === "review" && question) {
    const chosen = lastChoice === null ? "Você não respondeu a tempo." : currentPlayer?.lastCorrect ? "Resposta correta! Você ganhou pontos nesta rodada." : "Resposta registrada. Confira a explicação para a próxima.";
    gameContent.innerHTML = `<article class="player-card">${header}${identity}<div class="player-card-header"><span>RESPOSTA REVELADA</span><span>${escapeHTML(chosen)}</span></div><h2>${escapeHTML(question.prompt)}</h2><div class="player-answer-list">${question.choices.map((choice, index) => `<div class="player-answer${index === question.answer ? " is-correct" : ""}"><span>${["A", "B", "C"][index]}</span>${escapeHTML(choice)}</div>`).join("")}</div><div class="player-review"><b>POR QUE É A MAIS SEGURA?</b>${escapeHTML(question.explanation)}</div>${ranking}</article>`;
    return;
  }

  const winner = game.players[0];
  const tiedWinners = winner ? game.players.filter((player) => player.score === winner.score) : [];
  const winnerCard = winner
    ? `<div class="player-champion">${window.GameAvatar.render(winner.avatar, "game-avatar game-avatar-champion")}<span>✦</span><b>${tiedWinners.length > 1 ? "Empate!" : escapeHTML(winner.name)}</b><small>${tiedWinners.length > 1 ? `EMPATE ENTRE ${tiedWinners.map((player) => escapeHTML(player.name)).join(", ")}` : "CAMPEÃO"} · ${winner.score.toLocaleString("pt-BR")} PONTOS</small></div>`
    : "";
  gameContent.innerHTML = `<article class="player-card">${header}<div class="player-card-header"><span>FIM DE JOGO</span><span>PARABÉNS!</span></div><h2>Desafio concluído.</h2>${winnerCard}${ranking}<p class="player-waiting">Obrigado por jogar! Reveja as dicas com a turma.</p></article>`;
}

async function loadPlayerState() {
  const response = await fetch(`/api/game/player-state?token=${encodeURIComponent(playerToken)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Sua sessão de jogo expirou.");
  currentPlayer = data.player;
  renderGame(data.game, data.player);
}

function connectPlayerStream() {
  if (stream) stream.close();
  stream = new EventSource(`/api/game/events?token=${encodeURIComponent(playerToken)}`);
  stream.onopen = () => setConnected(true);
  stream.onerror = () => setConnected(false);
  stream.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type !== "game-state") return;
      if (message.game.status === "closed") {
        renderGame(message.game);
        return;
      }
      await loadPlayerState();
    } catch (error) {
      showStatus(`Não foi possível atualizar o jogo: ${error.message}`, true);
    }
  };
}

async function resumeGame() {
  if (!playerToken || !playerRoom) return false;
  try {
    await loadPlayerState();
    roomCodeInput.value = playerRoom;
    connectPlayerStream();
    return true;
  } catch (error) {
    sessionStorage.removeItem("conexao-game-player-token");
    sessionStorage.removeItem("conexao-game-room");
    playerToken = null;
    playerRoom = null;
    showStatus(error.message, true);
    return false;
  }
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  joinError.textContent = "";
  joinButton.disabled = true;
  try {
    const response = await fetch("/api/game/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode: roomCodeInput.value.trim(), name: nameInput.value.trim(), avatar: selectedAvatar() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível entrar na sala.");
    playerToken = data.token;
    playerRoom = data.game.roomCode;
    sessionStorage.setItem("conexao-game-player-token", playerToken);
    sessionStorage.setItem("conexao-game-room", playerRoom);
    currentPlayer = { name: nameInput.value.trim(), avatar: selectedAvatar(), score: 0, lastChoice: null, lastCorrect: null };
    renderGame(data.game, currentPlayer);
    connectPlayerStream();
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
  if (!button || submitting || !playerToken) return;
  submitting = true;
  button.disabled = true;
  try {
    const response = await fetch("/api/game/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + playerToken },
      body: JSON.stringify({ choice: Number(button.dataset.choice) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível registrar sua resposta.");
    await loadPlayerState();
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    submitting = false;
  }
});

resumeGame().then((resumed) => {
  if (resumed) setConnected(true);
});
