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

const QUESTION_DURATION_MS = 20000;

const params = new URLSearchParams(location.search);
const roomFromUrl = params.get("room") || "";
if (/^\d{5}$/.test(roomFromUrl)) roomCodeInput.value = roomFromUrl;

let playerId = sessionStorage.getItem("conexao-game-player-id");
let playerRoom = sessionStorage.getItem("conexao-game-room");
let currentGame = null;
let currentPlayers = [];
let currentPlayer = null;
let unsubRoom = null;
let unsubPlayers = null;
let timerInterval = 0;
let submitting = false;
let burstDone = false;

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
  connectionLabel.textContent = connected ? "AO VIVO" : "OFFLINE";
  connectionLabel.classList.toggle("is-connected", connected);
}

function renderRanking(players) {
  const topPlayers = (players || []).slice(0, 5);
  return `
    <div class="player-ranking">
      <span>PLACAR DA SALA</span>
      <ol>
        ${topPlayers.map((player, index) => {
          const isMe = player.id === playerId;
          return `
            <li class="${isMe ? "is-me" : ""}">
              <span>${String(index + 1).padStart(2, "0")}</span>
              ${window.GameAvatar.render(player.avatar, "game-avatar game-avatar-ranking")}
              <b>
                ${escapeHTML(player.name)}
                ${isMe ? `<span class="ranking-me-badge">VOCÊ</span>` : ""}
              </b>
              <span>${player.score.toLocaleString("pt-BR")} pts</span>
            </li>
          `;
        }).join("")}
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
  window.clearInterval(timerInterval);
  sessionStorage.removeItem("conexao-game-player-id");
  sessionStorage.removeItem("conexao-game-room");
  playerId = null;
  playerRoom = null;
  currentGame = null;
  currentPlayers = [];
  currentPlayer = null;
  burstDone = false;
  setConnected(false);
}

function exitToJoinScreen(message) {
  gameSection.hidden = true;
  joinSection.hidden = false;
  window.GameConfetti?.stop();
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
  const qIndex = Number(game.questionIndex);
  const qKey = String(qIndex);
  const question = GAME_QUESTIONS[qIndex];
  const roundAnswer = currentPlayer.answers?.[qKey] || null;

  joinSection.hidden = true;
  gameSection.hidden = false;

  const header = `
    <header class="player-card-header">
      <span>SALA · ${escapeHTML(game.roomCode)}</span>
      <span class="player-score">${Number(currentPlayer.score || 0).toLocaleString("pt-BR")} PTS</span>
    </header>
  `;
  const identity = `
    <div class="player-identity">
      ${window.GameAvatar.render(currentPlayer.avatar, "game-avatar game-avatar-identity")}
      <div class="player-identity-info">
        <span>JOGANDO COMO</span>
        <b>${escapeHTML(currentPlayer.name)}</b>
      </div>
    </div>
  `;

  if (game.status === "lobby") {
    burstDone = false;
    gameContent.innerHTML = `
      <article class="player-card">
        ${header}
        ${identity}
        <h2>Você entrou na sala!</h2>
        <div class="lobby-waiting-box">
          <span class="lobby-pulse-dot" aria-hidden="true"></span>
          <div>
            <p class="player-waiting">Aguarde o apresentador iniciar o desafio no telão.</p>
            <span class="lobby-count-pill">${players.length} ${players.length === 1 ? "participante conectado" : "participantes conectados"}</span>
          </div>
        </div>
        <p class="player-privacy">Você está usando apenas um apelido. Não compartilhe dados pessoais nesta atividade.</p>
      </article>
    `;
    return;
  }

  const lastChoice = roundAnswer ? roundAnswer.choice : null;
  const ranking = renderRanking(players);

  if (game.status === "question" && question) {
    const remaining = Math.max(0, (game.questionEndsAt || Date.now()) - Date.now());
    const secs = Math.ceil(remaining / 1000);
    const isUrgent = secs <= 5;

    gameContent.innerHTML = `
      <article class="player-card">
        ${header}
        ${identity}
        <div class="player-card-header">
          <span>PERGUNTA ${String(qIndex + 1).padStart(2, "0")} / ${String(GAME_QUESTIONS.length).padStart(2, "0")}</span>
          <span class="player-seconds-badge${isUrgent ? " is-urgent" : ""}" id="playerSeconds">${secs}s</span>
        </div>
        <h2>${escapeHTML(question.prompt)}</h2>
        <div class="player-timer"><i id="playerTimerFill" class="${isUrgent ? "is-urgent" : ""}"></i></div>
        <div class="player-answer-list">
          ${question.choices.map((choice, index) => {
            const isSelected = lastChoice === index;
            const isDimmed = lastChoice !== null && !isSelected;
            return `
              <button
                class="player-answer${isSelected ? " is-selected" : ""}${isDimmed ? " is-dimmed" : ""}"
                type="button"
                data-choice="${index}"
                ${lastChoice !== null || submitting ? "disabled" : ""}
              >
                <span class="player-answer-letter">${["A", "B", "C"][index]}</span>
                <span class="player-answer-text">${escapeHTML(choice)}</span>
                ${isSelected ? `<span class="player-answer-tag">ENVIADA</span>` : ""}
              </button>
            `;
          }).join("")}
        </div>
        <p class="player-feedback-box${lastChoice !== null ? " is-locked" : ""}" id="playerFeedback" aria-live="polite">
          ${lastChoice !== null
            ? "Resposta registrada! Aguarde a revelação no telão."
            : "Toque em uma alternativa antes do tempo acabar."}
        </p>
      </article>
    `;

    const updateTimer = () => {
      const msLeft = Math.max(0, (game.questionEndsAt || Date.now()) - Date.now());
      const secLeft = Math.ceil(msLeft / 1000);
      const urgent = secLeft > 0 && secLeft <= 5;

      const secondsLabel = gameContent.querySelector("#playerSeconds");
      const fill = gameContent.querySelector("#playerTimerFill");
      if (secondsLabel) {
        secondsLabel.textContent = `${secLeft}s`;
        secondsLabel.classList.toggle("is-urgent", urgent);
      }
      if (fill) {
        fill.style.width = `${Math.max(0, (msLeft / QUESTION_DURATION_MS) * 100)}%`;
        fill.classList.toggle("is-urgent", urgent);
      }
      if (msLeft === 0 && lastChoice === null) {
        const feedback = gameContent.querySelector("#playerFeedback");
        if (feedback) feedback.textContent = "Tempo esgotado! Aguarde a resposta correta no telão.";
        gameContent.querySelectorAll("[data-choice]").forEach((btn) => { btn.disabled = true; });
      }
    };
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 200);
    return;
  }

  if (game.status === "review" && question) {
    let bannerClass = "is-timeout";
    let bannerText = "⏱ Tempo esgotado nesta rodada";
    let bannerPts = "0 PTS";

    if (lastChoice !== null) {
      if (roundAnswer?.correct) {
        bannerClass = "is-correct";
        bannerText = "✓ Resposta correta!";
        bannerPts = `+${Number(roundAnswer.pointsEarned || 0).toLocaleString("pt-BR")} PTS`;
      } else {
        bannerClass = "is-incorrect";
        bannerText = "✕ Não foi dessa vez";
        bannerPts = "0 PTS";
      }
    }

    gameContent.innerHTML = `
      <article class="player-card">
        ${header}
        ${identity}
        <div class="round-result-banner ${bannerClass}">
          <span>${bannerText}</span>
          <span class="round-result-pts">${bannerPts}</span>
        </div>
        <h2>${escapeHTML(question.prompt)}</h2>
        <div class="player-answer-list">
          ${question.choices.map((choice, index) => {
            const isCorrectOpt = index === question.answer;
            const isWrongPick = lastChoice === index && !isCorrectOpt;
            const stateClass = isCorrectOpt ? " is-correct" : isWrongPick ? " is-incorrect" : " is-dimmed";
            const tag = isCorrectOpt
              ? `<span class="player-answer-tag">CORRETA</span>`
              : isWrongPick
                ? `<span class="player-answer-tag">SUA RESPOSTA</span>`
                : "";
            return `
              <div class="player-answer${stateClass}">
                <span class="player-answer-letter">${["A", "B", "C"][index]}</span>
                <span class="player-answer-text">${escapeHTML(choice)}</span>
                ${tag}
              </div>
            `;
          }).join("")}
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

  if (!burstDone) {
    burstDone = true;
    window.GameConfetti?.burst();
  }

  const winner = players[0];
  const tiedWinners = winner ? players.filter((player) => player.score === winner.score) : [];
  const myRankIndex = players.findIndex((p) => p.id === playerId);
  const myAnswers = Object.values(currentPlayer.answers || {});
  const myCorrectCount = myAnswers.filter((a) => a && a.correct).length;

  const winnerCard = winner
    ? `
      <div class="player-champion">
        ${window.GameAvatar.render(winner.avatar, "game-avatar game-avatar-champion")}
        <span class="player-champion-tag">✦ ${tiedWinners.length > 1 ? "EMPATE NO TOPO" : "CAMPEÃO DA SALA"}</span>
        <b>${tiedWinners.length > 1 ? tiedWinners.map((p) => escapeHTML(p.name)).join(" & ") : escapeHTML(winner.name)}</b>
        <small>${winner.score.toLocaleString("pt-BR")} PONTOS</small>
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
      <div class="my-final-stats">
        <div class="my-stat-box is-gold">
          <strong>#${myRankIndex >= 0 ? myRankIndex + 1 : "-"}</strong>
          <span>POSIÇÃO</span>
        </div>
        <div class="my-stat-box">
          <strong>${Number(currentPlayer.score || 0).toLocaleString("pt-BR")}</strong>
          <span>SEUS PONTOS</span>
        </div>
        <div class="my-stat-box is-green">
          <strong>${myCorrectCount}/${GAME_QUESTIONS.length}</strong>
          <span>ACERTOS</span>
        </div>
      </div>
      ${ranking}
      <p class="player-waiting" style="margin-top: 16px;">Obrigado por jogar! Reveja as dicas com a turma.</p>
      <button type="button" class="secondary-action-btn" id="leaveRoomBtn">Entrar em outra sala</button>
    </article>
  `;

  gameContent.querySelector("#leaveRoomBtn")?.addEventListener("click", () => {
    exitToJoinScreen("Pronto para entrar em uma nova sala.");
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

    const roomSnap = await getDoc(doc(db, "rooms", roomCode));
    if (!roomSnap.exists() || roomSnap.data().status !== "lobby") {
      throw new Error("Sala não encontrada ou o jogo já foi iniciado. Confira o código na tela.");
    }

    const playersSnap = await getDocs(collection(db, "rooms", roomCode, "players"));
    const existingPlayers = playersSnap.docs.map((d) => d.data());

    if (existingPlayers.length >= 60) {
      throw new Error("Esta sala já atingiu o limite de 60 participantes.");
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
    joinError.textContent = error.message;
  } finally {
    joinButton.disabled = false;
  }
});

avatarFields.forEach((field) => field.addEventListener("change", renderAvatarPreview));
renderAvatarPreview();

gameContent.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-choice]");
  if (!button || submitting || !playerId || !playerRoom || !currentGame) return;

  const qIndex = Number(currentGame.questionIndex);
  const qKey = String(qIndex);
  const question = GAME_QUESTIONS[qIndex];
  if (!question || currentGame.status !== "question") return;
  if (currentPlayer?.answers?.[qKey] !== undefined) return;

  const choice = Number(button.dataset.choice);
  const timeLeft = Math.max(0, (currentGame.questionEndsAt || Date.now()) - Date.now());
  if (timeLeft === 0) return;

  submitting = true;
  button.disabled = true;

  try {
    const correct = choice === question.answer;
    const pointsEarned = correct ? 1000 + Math.round((500 * timeLeft) / QUESTION_DURATION_MS) : 0;
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

void resumeGame();