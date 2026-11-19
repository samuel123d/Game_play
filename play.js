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

const audioToggle = document.querySelector("#playerAudioToggle");
const audioLabel = document.querySelector("#playerAudioLabel");
const audioMixerBtn = document.querySelector("#playerAudioMixerBtn");
const audioPopover = document.querySelector("#playerAudioPopover");
const audioTestBtn = document.querySelector("#playerAudioTestBtn");
const musicSlider = document.querySelector("#playerMusicSlider");
const musicVal = document.querySelector("#playerMusicVal");
const sfxSlider = document.querySelector("#playerSfxSlider");
const sfxVal = document.querySelector("#playerSfxVal");

const historyBtn = document.querySelector("#playerHistoryBtn");
const historyModal = document.querySelector("#historyModal");
const closeHistoryBtn = document.querySelector("#closeHistoryBtn");
const historyModalBody = document.querySelector("#historyModalBody");

const HISTORY_STORAGE_KEY = "conexao-player-history-v2";

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
let lastSoundKey = "";
let lastCountdownSec = -1;
let timeoutPlayedKey = "";
let recordedAttemptKeys = new Set();

// Modo de nova tentativa individual (quando o jogador clica em JOGAR NOVAMENTE)
let localReplaySession = null;

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveHistoryItem(item) {
  const list = loadHistory();
  if (list.some((entry) => entry.attemptKey === item.attemptKey)) return;
  list.unshift(item);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    // Ignora limite de storage
  }
}

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
  connectionLabel.textContent = connected ? "ONLINE" : "OFFLINE";
  connectionLabel.classList.toggle("is-connected", connected);
}

function getRoomSettings(game) {
  return {
    maxPlayers: Number(game?.settings?.maxPlayers || 60),
    allowLateJoin: Boolean(game?.settings?.allowLateJoin),
    allowReview: game?.settings?.allowReview !== false,
    allowReplay: game?.settings?.allowReplay !== false,
    questionDurationSec: Number(game?.settings?.questionDurationSec || 20)
  };
}

function renderMobilePodium(players) {
  if (!players.length) return "";
  const first = players[0] || null;
  const second = players[1] || null;
  const third = players[2] || null;

  const order = [];
  if (second) order.push({ place: 2, cls: "is-second", p: second });
  if (first) order.push({ place: 1, cls: "is-first", p: first });
  if (third) order.push({ place: 3, cls: "is-third", p: third });

  return `
    <div class="mobile-podium" aria-label="Pódio dos vencedores">
      ${order.map((slot) => `
        <div class="mobile-podium-slot ${slot.cls}">
          ${window.GameAvatar.render(slot.p.avatar, "game-avatar mobile-podium-avatar")}
          <span class="mobile-podium-name">${escapeHTML(slot.p.name)}</span>
          <span class="mobile-podium-pts">${slot.p.score.toLocaleString("pt-BR")} pts</span>
          <div class="mobile-podium-step">${slot.place}º</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderRanking(players) {
  const topPlayers = (players || []).slice(0, 6);
  return `
    <div class="player-ranking">
      <span>CLASSIFICAÇÃO DA SALA</span>
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

function computeStatsFromAnswers(answersObj) {
  const total = GAME_QUESTIONS.length;
  let correctCount = 0;
  let wrongCount = 0;

  GAME_QUESTIONS.forEach((q, idx) => {
    const ans = answersObj?.[String(idx)];
    if (ans && ans.correct) correctCount += 1;
    else wrongCount += 1;
  });

  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  return { total, correctCount, wrongCount, accuracy };
}

function renderIndividualReview(player, rankPosition) {
  const answers = player.answers || {};
  const stats = computeStatsFromAnswers(answers);

  return `
    <div class="individual-review-section">
      <div class="review-summary-grid">
        <div class="review-stat-box is-gold">
          <strong>${Number(player.score || 0).toLocaleString("pt-BR")}</strong>
          <span>PONTOS</span>
        </div>
        <div class="review-stat-box is-green">
          <strong>${stats.correctCount}/${stats.total}</strong>
          <span>ACERTOS</span>
        </div>
        <div class="review-stat-box is-red">
          <strong>${stats.wrongCount}/${stats.total}</strong>
          <span>ERROS</span>
        </div>
        <div class="review-stat-box">
          <strong>${stats.accuracy}%</strong>
          <span>APROVEITAMENTO</span>
        </div>
      </div>

      ${rankPosition ? `<p class="player-privacy">Posição na sala: <strong>${rankPosition}º lugar</strong> · Tentativa #${player.attemptNumber || 1}</p>` : ""}

      <div class="review-questions-list">
        ${GAME_QUESTIONS.map((q, idx) => {
          const ans = answers[String(idx)] || null;
          const isCorrect = Boolean(ans?.correct);
          const hasAnswered = ans !== null && ans.choice !== undefined;
          const statusCls = isCorrect ? "is-correct" : "is-incorrect";
          const badgeText = isCorrect
            ? `CORRETA (+${ans.pointsEarned} pts)`
            : hasAnswered
              ? "INCORRETA (0 pts)"
              : "TEMPO ESGOTADO (0 pts)";
          const badgeCls = isCorrect ? "is-correct" : hasAnswered ? "is-incorrect" : "is-timeout";

          return `
            <article class="review-q-item ${statusCls}">
              <div class="review-q-head">
                <span>QUESTÃO ${String(idx + 1).padStart(2, "0")}</span>
                <span class="review-badge ${badgeCls}">${badgeText}</span>
              </div>
              <p class="review-q-prompt">${escapeHTML(q.prompt)}</p>
              <div class="review-options">
                ${q.choices.map((choiceText, optIdx) => {
                  const isRightOpt = optIdx === q.answer;
                  const isChosenOpt = hasAnswered && ans.choice === optIdx;
                  let optClass = "";
                  let tag = "";

                  if (isRightOpt) {
                    optClass = "opt-correct";
                    tag = isChosenOpt ? "SUA RESPOSTA · CORRETA" : "RESPOSTA CORRETA";
                  } else if (isChosenOpt) {
                    optClass = "opt-wrong";
                    tag = "SUA ESCOLHA";
                  }

                  return `
                    <div class="review-opt ${optClass}">
                      <span><strong>${["A", "B", "C"][optIdx]}.</strong> ${escapeHTML(choiceText)}</span>
                      ${tag ? `<span class="review-opt-tag">${tag}</span>` : ""}
                    </div>
                  `;
                }).join("")}
              </div>
              <p class="review-q-exp">${escapeHTML(q.explanation)}</p>
            </article>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

async function archiveCompletedAttempt(roomCode, player) {
  const attemptNum = Number(player.attemptNumber || 1);
  const attemptKey = `${roomCode}:${player.id}:att${attemptNum}`;
  if (recordedAttemptKeys.has(attemptKey)) return;
  recordedAttemptKeys.add(attemptKey);

  const stats = computeStatsFromAnswers(player.answers || {});
  const record = {
    attemptKey,
    roomCode,
    playerName: player.name,
    attemptNumber: attemptNum,
    score: Number(player.score || 0),
    correctCount: stats.correctCount,
    wrongCount: stats.wrongCount,
    totalQuestions: stats.total,
    accuracy: stats.accuracy,
    finishedAt: Date.now()
  };

  saveHistoryItem(record);

  try {
    await addDoc(collection(db, "rooms", roomCode, "attempts"), {
      playerName: record.playerName,
      avatar: window.GameAvatar.normalize(player.avatar),
      attemptNumber: record.attemptNumber,
      score: record.score,
      correctCount: record.correctCount,
      wrongCount: record.wrongCount,
      totalQuestions: record.totalQuestions,
      accuracy: record.accuracy,
      finishedAt: record.finishedAt
    });
  } catch {
    // Mantém salvo no localStorage mesmo se a sala já tiver sido fechada
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

function clearSession() {
  cleanupListeners();
  sessionStorage.removeItem("conexao-game-player-id");
  sessionStorage.removeItem("conexao-game-room");
  playerId = null;
  playerRoom = null;
  currentGame = null;
  currentPlayers = [];
  currentPlayer = null;
  localReplaySession = null;
  setConnected(false);
}

function exitToJoinScreen(message) {
  window.clearInterval(timerInterval);
  window.GameConfetti?.stop();
  window.GameAudio?.setTrack("none");
  gameSection.hidden = true;
  joinSection.hidden = false;
  showStatus(message);
  clearSession();
}

// Fluxo "JOGAR NOVAMENTE"
async function startPlayAgain() {
  if (!currentPlayer || !playerRoom) return;
  const basePlayer = { ...currentPlayer };
  const roomCode = playerRoom;
  const previousAttempts = loadHistory().filter((h) => h.roomCode === roomCode && h.playerName === basePlayer.name).length;
  const nextAttemptNumber = Math.max(Number(basePlayer.attemptNumber || 1) + 1, previousAttempts + 1);
  const questionDurationSec = getRoomSettings(currentGame).questionDurationSec;

  window.GameConfetti?.stop();

  // Verifica se o organizador reabriu o lobby na mesma sala
  try {
    const roomSnap = await getDoc(doc(db, "rooms", roomCode));
    if (roomSnap.exists() && roomSnap.data().status === "lobby") {
      const freshPlayer = {
        name: basePlayer.name,
        avatar: window.GameAvatar.normalize(basePlayer.avatar),
        score: 0,
        attemptNumber: nextAttemptNumber,
        joinedAt: Date.now(),
        answers: {}
      };
      const newRef = await addDoc(collection(db, "rooms", roomCode, "players"), freshPlayer);
      playerId = newRef.id;
      sessionStorage.setItem("conexao-game-player-id", playerId);
      lastSoundKey = "";
      showStatus(`Nova tentativa (#${nextAttemptNumber}) iniciada na sala!`);
      subscribeToRoom(roomCode);
      return;
    }
  } catch {
    // Segue para tentativa individual com as mesmas perguntas da partida
  }

  // Inicia nova tentativa completa com as mesmas perguntas, pontuação zerada e registro separado
  localReplaySession = {
    roomCode,
    player: {
      id: `replay-${Date.now()}`,
      name: basePlayer.name,
      avatar: window.GameAvatar.normalize(basePlayer.avatar),
      score: 0,
      attemptNumber: nextAttemptNumber,
      answers: {}
    },
    questionIndex: 0,
    questionDurationSec,
    questionEndsAt: Date.now() + questionDurationSec * 1000,
    status: "question"
  };

  window.GameAudio?.playEffect("start");
  window.GameAudio?.setTrack("question");
  renderLocalReplay();
}

function renderLocalReplay() {
  window.clearInterval(timerInterval);
  if (!localReplaySession) return;

  const rep = localReplaySession;
  const me = rep.player;
  const qIndex = rep.questionIndex;
  const question = GAME_QUESTIONS[qIndex];

  joinSection.hidden = true;
  gameSection.hidden = false;

  const header = `
    <header class="player-card-header">
      <span>NOVA TENTATIVA #${me.attemptNumber} · SALA ${escapeHTML(rep.roomCode)}</span>
      <span class="player-score">${me.score.toLocaleString("pt-BR")} PTS</span>
    </header>
  `;
  const identity = `
    <div class="player-identity">
      ${window.GameAvatar.render(me.avatar, "game-avatar game-avatar-identity")}
      <span>JOGANDO COMO <b>${escapeHTML(me.name)}</b></span>
    </div>
  `;

  if (rep.status === "question" && question) {
    const durationMs = rep.questionDurationSec * 1000;
    const remaining = Math.max(0, rep.questionEndsAt - Date.now());

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
          ${question.choices.map((choice, idx) => `
            <button class="player-answer" type="button" data-replay-choice="${idx}">
              <span>${["A", "B", "C"][idx]}</span>
              <span>${escapeHTML(choice)}</span>
            </button>
          `).join("")}
        </div>
        <p class="player-player-feedback">Toque em uma alternativa antes do tempo acabar.</p>
      </article>
    `;

    const updateTimer = () => {
      const rem = Math.max(0, rep.questionEndsAt - Date.now());
      const secEl = gameContent.querySelector("#playerSeconds");
      const fillEl = gameContent.querySelector("#playerTimerFill");
      if (secEl) secEl.textContent = `${Math.ceil(rem / 1000)} SEG`;
      if (fillEl) fillEl.style.width = `${(rem / durationMs) * 100}%`;
      if (rem === 0) {
        window.clearInterval(timerInterval);
        window.GameAudio?.playEffect("timeout");
        advanceLocalReplay();
      }
    };
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 200);
    return;
  }

  // Final da nova tentativa
  window.GameAudio?.setTrack("victory");
  window.GameAudio?.playEffect("champion");
  window.GameConfetti?.burst();
  void archiveCompletedAttempt(rep.roomCode, me);

  gameContent.innerHTML = `
    <article class="player-card">
      ${header}
      <div class="player-card-header">
        <span>TENTATIVA #${me.attemptNumber} CONCLUÍDA</span>
        <span>RESULTADO SALVO</span>
      </div>
      <h2>Revisão da Tentativa #${me.attemptNumber}</h2>
      ${renderIndividualReview(me, null)}
      <button type="button" class="primary-submit-btn" id="btnReplayAgain">JOGAR NOVAMENTE</button>
      <button type="button" class="secondary-action-btn" id="btnOpenHistoryFromEnd">Ver histórico de tentativas</button>
      <button type="button" class="secondary-action-btn" id="btnBackToLobbyJoin">Entrar em outra sala</button>
    </article>
  `;

  document.querySelector("#btnReplayAgain")?.addEventListener("click", () => {
    currentPlayer = me;
    void startPlayAgain();
  });
  document.querySelector("#btnOpenHistoryFromEnd")?.addEventListener("click", openHistoryModal);
  document.querySelector("#btnBackToLobbyJoin")?.addEventListener("click", () => {
    exitToJoinScreen("Pronto para entrar em uma nova sala.");
  });
}

function advanceLocalReplay() {
  if (!localReplaySession) return;
  if (localReplaySession.questionIndex + 1 < GAME_QUESTIONS.length) {
    localReplaySession.questionIndex += 1;
    localReplaySession.questionEndsAt = Date.now() + localReplaySession.questionDurationSec * 1000;
    renderLocalReplay();
  } else {
    localReplaySession.status = "final";
    renderLocalReplay();
  }
}

function renderGame(game, players) {
  if (localReplaySession) return;
  currentGame = game;
  window.clearInterval(timerInterval);

  if (!game || game.status === "closed") {
    exitToJoinScreen("A sala foi encerrada pelo organizador.");
    return;
  }

  const me = players.find((p) => p.id === playerId);
  if (!me) {
    return;
  }

  setConnected(true);
  currentPlayer = me;
  const settings = getRoomSettings(game);
  const qIndex = Number(game.questionIndex);
  const qKey = String(qIndex);
  const question = GAME_QUESTIONS[qIndex];
  const roundAnswer = currentPlayer.answers?.[qKey] || null;

  // Sincronização de música e efeitos sonoros sem sobreposição
  const soundKey = `${game.status}:${qIndex}`;
  if (soundKey !== lastSoundKey) {
    lastSoundKey = soundKey;
    if (game.status === "lobby") {
      window.GameAudio?.setTrack("lobby");
    } else if (game.status === "countdown") {
      window.GameAudio?.setTrack("countdown");
    } else if (game.status === "question") {
      if (qIndex === 0) window.GameAudio?.playEffect("start");
      window.GameAudio?.setTrack("question");
    } else if (game.status === "review") {
      window.GameAudio?.setTrack("review");
      if (roundAnswer?.correct) {
        window.GameAudio?.playEffect("correct");
      } else {
        window.GameAudio?.playEffect("incorrect");
      }
    } else if (game.status === "final") {
      window.GameAudio?.setTrack("victory");
      window.GameAudio?.playEffect("champion");
      window.GameConfetti?.burst();
    }
  }

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
      <span>JOGANDO COMO <b>${escapeHTML(currentPlayer.name)}</b></span>
    </div>
  `;

  if (game.status === "lobby") {
    gameContent.innerHTML = `
      <article class="player-card">
        ${header}
        ${identity}
        <h2>Você está na sala!</h2>
        <p class="player-waiting">Aguarde o organizador iniciar a partida. Mantenha esta tela aberta.</p>
        <p class="player-privacy">${players.length} participante(s) conectado(s) neste momento.</p>
      </article>
    `;
    return;
  }

  if (game.status === "countdown") {
    const initialSec = Math.max(1, Math.ceil(((game.countdownEndsAt || Date.now()) - Date.now()) / 1000));
    gameContent.innerHTML = `
      <article class="player-card">
        ${header}
        ${identity}
        <h2>Prepare-se!</h2>
        <div class="player-countdown-box">
          <div class="player-countdown-num" id="playerCountdownNum">${initialSec}</div>
        </div>
        <p class="player-waiting">A primeira pergunta vai aparecer em instantes.</p>
      </article>
    `;

    const updatePhoneCountdown = () => {
      const rem = Math.max(0, (game.countdownEndsAt || Date.now()) - Date.now());
      const sec = Math.ceil(rem / 1000);
      const el = gameContent.querySelector("#playerCountdownNum");
      if (el) el.textContent = sec > 0 ? String(sec) : "VAI!";
      if (sec > 0 && sec !== lastCountdownSec) {
        lastCountdownSec = sec;
        window.GameAudio?.playEffect("countdownTick");
      }
    };
    updatePhoneCountdown();
    timerInterval = window.setInterval(updatePhoneCountdown, 150);
    return;
  }

  const lastChoice = roundAnswer ? roundAnswer.choice : null;
  const ranking = renderRanking(players);
  const durationMs = settings.questionDurationSec * 1000;

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
              <span>${escapeHTML(choice)}</span>
            </button>
          `).join("")}
        </div>
        <p class="player-player-feedback" id="playerFeedback" aria-live="polite">
          ${lastChoice !== null
            ? "Resposta registrada! Aguarde a revelação no telão."
            : "Toque em uma alternativa antes do tempo acabar."}
        </p>
      </article>
    `;

    const updateTimer = () => {
      const seconds = Math.max(0, (game.questionEndsAt || Date.now()) - Date.now());
      const secondsLabel = gameContent.querySelector("#playerSeconds");
      const fill = gameContent.querySelector("#playerTimerFill");
      if (secondsLabel) secondsLabel.textContent = `${Math.ceil(seconds / 1000)} SEG`;
      if (fill) fill.style.width = `${Math.max(0, (seconds / durationMs) * 100)}%`;
      if (seconds === 0) {
        const tKey = `${game.roomCode}:${qIndex}`;
        if (timeoutPlayedKey !== tKey) {
          timeoutPlayedKey = tKey;
          window.GameAudio?.playEffect("timeout");
        }
        if (lastChoice === null) {
          const feedback = gameContent.querySelector("#playerFeedback");
          if (feedback) feedback.textContent = "Tempo esgotado! Aguarde a resposta correta.";
          gameContent.querySelectorAll("[data-choice]").forEach((btn) => { btn.disabled = true; });
        }
      }
    };
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 200);
    return;
  }

  if (game.status === "review" && question) {
    const statusLine = lastChoice === null
      ? "TEMPO ESGOTADO"
      : roundAnswer?.correct
        ? `CORRETA · +${roundAnswer.pointsEarned} PTS`
        : "INCORRETA · 0 PTS";

    gameContent.innerHTML = `
      <article class="player-card">
        ${header}
        ${identity}
        <div class="player-card-header">
          <span>RESPOSTA REVELADA</span>
          <span>${escapeHTML(statusLine)}</span>
        </div>
        <h2>${escapeHTML(question.prompt)}</h2>
        <div class="player-answer-list">
          ${question.choices.map((choice, index) => {
            const isRight = index === question.answer;
            const isWrongChosen = lastChoice === index && !isRight;
            return `
              <div class="player-answer${isRight ? " is-correct" : ""}${isWrongChosen ? " is-incorrect" : ""}">
                <span>${["A", "B", "C"][index]}</span>
                <span>${escapeHTML(choice)}</span>
              </div>
            `;
          }).join("")}
        </div>
        <div class="player-review">
          <b>EXPLICAÇÃO</b>
          ${escapeHTML(question.explanation)}
        </div>
        ${ranking}
      </article>
    `;
    return;
  }

  // Tela Final: Pódio + Revisão Individual + Jogar Novamente
  void archiveCompletedAttempt(game.roomCode, currentPlayer);
  const myRankIndex = players.findIndex((p) => p.id === currentPlayer.id);
  const myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;

  gameContent.innerHTML = `
    <article class="player-card">
      ${header}
      <div class="player-card-header">
        <span>FIM DE PARTIDA</span>
        <span>PÓDIO FINAL</span>
      </div>
      <h2>Resultado do Desafio</h2>
      ${renderMobilePodium(players)}
      ${ranking}

      ${settings.allowReview
        ? renderIndividualReview(currentPlayer, myRank)
        : `<p class="player-privacy">A revisão detalhada das questões foi desativada pelo organizador desta partida.</p>`
      }

      ${settings.allowReplay
        ? `<button type="button" class="primary-submit-btn" id="btnPlayAgainMain">JOGAR NOVAMENTE</button>`
        : ""
      }
      <button type="button" class="secondary-action-btn" id="btnViewHistoryFinal">Consultar histórico de tentativas</button>
      <button type="button" class="secondary-action-btn" id="btnLeaveRoomFinal">Sair da sala</button>
    </article>
  `;

  document.querySelector("#btnPlayAgainMain")?.addEventListener("click", startPlayAgain);
  document.querySelector("#btnViewHistoryFinal")?.addEventListener("click", openHistoryModal);
  document.querySelector("#btnLeaveRoomFinal")?.addEventListener("click", () => {
    exitToJoinScreen("Você saiu da sala.");
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
          attemptNumber: Number(data.attemptNumber || 1),
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
    if (!roomSnap.exists() || roomSnap.data().status === "closed") {
      throw new Error("Sala não encontrada ou encerrada. Confira o código no telão.");
    }

    const roomData = roomSnap.data();
    const settings = getRoomSettings(roomData);

    // Bloqueia entrada após início se allowLateJoin estiver desativado
    if (roomData.status !== "lobby" && !settings.allowLateJoin) {
      throw new Error("Esta partida já começou e novas entradas foram bloqueadas pelo organizador.");
    }

    const playersSnap = await getDocs(collection(db, "rooms", roomCode, "players"));
    const existingPlayers = playersSnap.docs.map((d) => d.data());

    if (existingPlayers.length >= settings.maxPlayers) {
      throw new Error(`Esta sala atingiu o limite máximo de ${settings.maxPlayers} participantes.`);
    }

    const duplicate = existingPlayers.some(
      (p) => (p.name || "").toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")
    );
    if (duplicate) {
      throw new Error("Esse apelido já está em uso nesta sala. Escolha outro.");
    }

    const initialPlayer = {
      name,
      avatar,
      score: 0,
      attemptNumber: 1,
      joinedAt: Date.now(),
      answers: {}
    };

    const newPlayerRef = await addDoc(collection(db, "rooms", roomCode, "players"), initialPlayer);
    playerId = newPlayerRef.id;
    playerRoom = roomCode;
    currentPlayers = [{ id: playerId, ...initialPlayer }];
    lastSoundKey = "";

    sessionStorage.setItem("conexao-game-player-id", playerId);
    sessionStorage.setItem("conexao-game-room", playerRoom);
    window.GameAudio?.playEffect("join");
    showStatus("");
    subscribeToRoom(roomCode);
  } catch (error) {
    joinError.textContent = error.message;
  } finally {
    joinButton.disabled = false;
  }
});

// Envio de resposta na partida ao vivo
gameContent.addEventListener("click", async (event) => {
  // 1) Resposta no modo "Jogar Novamente"
  const replayBtn = event.target.closest("[data-replay-choice]");
  if (replayBtn && localReplaySession && localReplaySession.status === "question") {
    const qIndex = localReplaySession.questionIndex;
    const question = GAME_QUESTIONS[qIndex];
    const choice = Number(replayBtn.dataset.replayChoice);
    const timeLeft = Math.max(0, localReplaySession.questionEndsAt - Date.now());
    const durationMs = localReplaySession.questionDurationSec * 1000;
    const correct = choice === question.answer;
    const pointsEarned = correct ? 1000 + Math.round((500 * timeLeft) / durationMs) : 0;

    localReplaySession.player.score += pointsEarned;
    localReplaySession.player.answers[String(qIndex)] = {
      choice,
      correct,
      pointsEarned,
      answeredAt: Date.now()
    };

    window.clearInterval(timerInterval);
    window.GameAudio?.playEffect(correct ? "correct" : "incorrect");
    advanceLocalReplay();
    return;
  }

  // 2) Resposta na sala ao vivo (Firestore)
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
    const durationMs = getRoomSettings(currentGame).questionDurationSec * 1000;
    const correct = choice === question.answer;
    const pointsEarned = correct ? 1000 + Math.round((500 * timeLeft) / durationMs) : 0;
    const newScore = Number(currentPlayer.score || 0) + pointsEarned;

    window.GameAudio?.playEffect("answer");

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

// Modal de Histórico de Desempenho
function openHistoryModal() {
  const history = loadHistory();
  if (!history.length) {
    historyModalBody.innerHTML = `
      <p class="player-waiting">Você ainda não concluiu nenhuma partida neste dispositivo. Participe de um desafio para registrar seu histórico.</p>
    `;
    historyModal.hidden = false;
    return;
  }

  const totalMatches = history.length;
  const totalCorrect = history.reduce((acc, item) => acc + Number(item.correctCount || 0), 0);
  const totalWrong = history.reduce((acc, item) => acc + Number(item.wrongCount || 0), 0);
  const bestScore = history.reduce((max, item) => Math.max(max, Number(item.score || 0)), 0);
  const avgAccuracy = Math.round(
    history.reduce((acc, item) => acc + Number(item.accuracy || 0), 0) / totalMatches
  );

  historyModalBody.innerHTML = `
    <div class="history-overview">
      <div class="review-stat-box">
        <strong>${totalMatches}</strong>
        <span>PARTIDAS</span>
      </div>
      <div class="review-stat-box is-gold">
        <strong>${bestScore.toLocaleString("pt-BR")}</strong>
        <span>MELHOR PONTUAÇÃO</span>
      </div>
      <div class="review-stat-box is-green">
        <strong>${totalCorrect}</strong>
        <span>ACERTOS TOTAIS</span>
      </div>
      <div class="review-stat-box is-red">
        <strong>${totalWrong}</strong>
        <span>ERROS TOTAIS</span>
      </div>
    </div>
    <p class="player-privacy">Percentual médio de acertos: <strong>${avgAccuracy}%</strong></p>

    <div class="history-list">
      ${history.map((item) => {
        const dateStr = new Date(item.finishedAt).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        });
        return `
          <div class="history-item">
            <div class="history-item-top">
              <span>${escapeHTML(item.playerName)} · Tentativa #${item.attemptNumber || 1}</span>
              <span style="color: var(--gold)">${Number(item.score || 0).toLocaleString("pt-BR")} pts</span>
            </div>
            <div class="history-item-meta">
              <span>Sala ${escapeHTML(item.roomCode)}</span>
              <span>Acertos: ${item.correctCount}/${item.totalQuestions} (${item.accuracy}%)</span>
              <span>${dateStr}</span>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
  historyModal.hidden = false;
}

historyBtn.addEventListener("click", openHistoryModal);
closeHistoryBtn.addEventListener("click", () => { historyModal.hidden = true; });
historyModal.addEventListener("click", (e) => {
  if (e.target === historyModal) historyModal.hidden = true;
});

// Controles de Áudio do Participante
function initPlayerAudio() {
  const prefs = window.GameAudio.getPrefs();
  musicSlider.value = String(Math.round(prefs.musicVolume * 100));
  musicVal.textContent = `${musicSlider.value}%`;
  sfxSlider.value = String(Math.round(prefs.sfxVolume * 100));
  sfxVal.textContent = `${sfxSlider.value}%`;

  audioToggle.addEventListener("click", async () => {
    try {
      const enabled = await window.GameAudio.setEnabled(!window.GameAudio.isEnabled());
      audioToggle.setAttribute("aria-pressed", String(enabled));
      audioLabel.textContent = enabled ? "Ligado" : "Som";
      if (enabled && currentGame) {
        lastSoundKey = "";
        renderGame(currentGame, currentPlayers);
      }
    } catch (error) {
      showStatus(`Áudio indisponível: ${error.message}`, true);
    }
  });

  audioMixerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = audioPopover.hidden;
    audioPopover.hidden = !open;
    audioMixerBtn.setAttribute("aria-expanded", String(open));
  });

  musicSlider.addEventListener("input", () => {
    musicVal.textContent = `${musicSlider.value}%`;
    window.GameAudio.setMusicVolume(Number(musicSlider.value) / 100);
  });

  sfxSlider.addEventListener("input", () => {
    sfxVal.textContent = `${sfxSlider.value}%`;
    window.GameAudio.setSfxVolume(Number(sfxSlider.value) / 100);
  });

  audioTestBtn.addEventListener("click", async () => {
    if (!window.GameAudio.isEnabled()) {
      await window.GameAudio.setEnabled(true);
      audioToggle.setAttribute("aria-pressed", "true");
      audioLabel.textContent = "Ligado";
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

avatarFields.forEach((field) => field.addEventListener("change", renderAvatarPreview));
renderAvatarPreview();
initPlayerAudio();
void resumeGame();