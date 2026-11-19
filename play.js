import { db } from "./firebase-config.js";
import { GAME_QUESTIONS } from "./questions.js";
import {
  doc,
  collection,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  onSnapshot,
  increment
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
const playerAudioToggle = document.querySelector("#playerAudioToggle");
const statusLabel = document.querySelector("#playerStatus");
const avatarPreview = document.querySelector("#avatarPreview");
const avatarFields = [...document.querySelectorAll("[data-avatar-field]")];

const QUESTION_DURATION_MS = 30000;
const BASE_POINTS = 1000;
const SPEED_BONUS_MAX = 1000;
const STREAK_STEP_BONUS = 250;
const STREAK_BONUS_MAX = 1000;

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
let pendingChoice = null;
let burstDone = false;

let clockOffsetMs = Number(sessionStorage.getItem("conexao-clock-offset") || 0);
let syncedQuestionKey = "";
let hasSeenRoomSnapshot = false;
let trackedQuestionStartLocal = 0;
let lastPlayerStateSoundKey = "";
let lastPlayerUrgentSecond = -1;

function updatePlayerAudioButton() {
  if (!window.GameAudio || !playerAudioToggle) return;
  const enabled = window.GameAudio.isEnabled();
  playerAudioToggle.setAttribute("aria-pressed", String(enabled));
  playerAudioToggle.classList.toggle("is-on", enabled);
  playerAudioToggle.classList.toggle("is-off", !enabled);
  playerAudioToggle.innerHTML = enabled
    ? `
      <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"></polygon>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
      <span>Som ligado</span>
    `
    : `
      <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      </svg>
      <span>Som desligado</span>
    `;
}

playerAudioToggle?.addEventListener("click", async () => {
  if (!window.GameAudio) return;
  const enabled = await window.GameAudio.setEnabled(!window.GameAudio.isEnabled());
  updatePlayerAudioButton();
  if (enabled) {
    window.GameAudio.playEffect("select");
  }
});

updatePlayerAudioButton();

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

function isDoublePointsQuestion(qIndex, question, game = null) {
  if (!question || qIndex < 0) return false;
  if (typeof question.doublePoints === "boolean") return question.doublePoints;
  if (typeof game?.doublePoints === "boolean") return game.doublePoints;
  if (/deep\s*fake|rodada em dobro|desafio final/i.test(String(question.prompt || ""))) {
    return true;
  }
  return GAME_QUESTIONS.length > 1 && qIndex === GAME_QUESTIONS.length - 1;
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

function computePreviousStreak(answers, currentQIndex) {
  let count = 0;
  for (let i = currentQIndex - 1; i >= 0; i--) {
    const ans = answers?.[String(i)];
    if (ans && ans.correct) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function getStreakBonus(streak) {
  if (streak < 2) return 0;
  return Math.min(STREAK_BONUS_MAX, (streak - 1) * STREAK_STEP_BONUS);
}

function getActiveStreak(player, game) {
  if (!player || !game) return 0;
  const answers = player.answers || {};
  const qIndex = Number(game.questionIndex ?? -1);

  if (game.status === "lobby" || game.status === "final" || qIndex < 0) return 0;

  if (game.status === "question") {
    const currentAns = answers[String(qIndex)];
    if (currentAns !== undefined) {
      return currentAns.correct ? 1 + computePreviousStreak(answers, qIndex) : 0;
    }
    return computePreviousStreak(answers, qIndex);
  }

  if (game.status === "review") {
    const currentAns = answers[String(qIndex)];
    if (!currentAns || !currentAns.correct) return 0;
    return 1 + computePreviousStreak(answers, qIndex);
  }

  return 0;
}

function renderAvatarWithFire(avatar, avatarClass, streak = 0) {
  const baseAvatar = window.GameAvatar.render(avatar, avatarClass);
  if (streak < 2) return baseAvatar;

  const tierClass = streak >= 4 ? "is-blazing" : streak === 3 ? "is-hot" : "is-warm";
  return `
    <span class="avatar-fire-wrap ${tierClass}" title="Sequência de ${streak} acertos!">
      <span class="avatar-fire-aura" aria-hidden="true"></span>
      <span class="avatar-fire-blaze" aria-hidden="true">
        <i></i><i></i><i></i>
      </span>
      ${baseAvatar}
      <span class="avatar-fire-flames" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
      </span>
      <span class="avatar-fire-sparks" aria-hidden="true">
        <i></i><i></i><i></i><i></i>
      </span>
      <span class="avatar-fire-badge">🔥${streak}</span>
    </span>
  `;
}

function renderDancingAvatar(avatar, avatarClass, isChampion = true) {
  const baseAvatar = window.GameAvatar.render(avatar, avatarClass);
  return `
    <span class="avatar-dance-wrap${isChampion ? " is-champion" : " is-podium"}" title="Comemorando!">
      <span class="avatar-dance-halo" aria-hidden="true"></span>
      <span class="avatar-dance-notes" aria-hidden="true">
        <i>♪</i><i>✦</i><i>♫</i><i>★</i>
      </span>
      <span class="avatar-dance-body">
        ${baseAvatar}
      </span>
      <span class="avatar-dance-shadow" aria-hidden="true"></span>
    </span>
  `;
}

function getQuestionDurationMs(game) {
  const val = Number(game?.questionDurationMs);
  return Number.isFinite(val) && val > 0 ? val : QUESTION_DURATION_MS;
}

function formatSecondsPt(ms) {
  const seconds = Math.max(0.1, ms / 1000);
  return `${seconds.toFixed(1).replace(".", ",")}s`;
}

function getAnswerResponseTimeMs(ans, durationMs) {
  if (!ans) return null;
  if (typeof ans.responseTimeMs === "number" && Number.isFinite(ans.responseTimeMs)) {
    return Math.max(100, Math.min(durationMs, ans.responseTimeMs));
  }
  if (ans.correct && typeof ans.speedBonus === "number" && SPEED_BONUS_MAX > 0) {
    const inferred = Math.round(durationMs * (1 - ans.speedBonus / SPEED_BONUS_MAX));
    return Math.max(100, Math.min(durationMs, inferred));
  }
  return null;
}

function syncQuestionClock(game) {
  const durationMs = getQuestionDurationMs(game);
  const serverEndsAt = Number(game?.questionEndsAt) || 0;
  const qKey = String(game?.questionIndex ?? -1);
  const stateKey = `${game?.roomCode || ""}:${qKey}:${serverEndsAt}`;

  if (stateKey !== syncedQuestionKey) {
    syncedQuestionKey = stateKey;
    trackedQuestionStartLocal = Date.now();
    pendingChoice = null;

    if (serverEndsAt > 0) {
      if (hasSeenRoomSnapshot) {
        clockOffsetMs = Date.now() + durationMs - serverEndsAt;
        sessionStorage.setItem("conexao-clock-offset", String(clockOffsetMs));
      } else {
        const calibratedRemaining = serverEndsAt + clockOffsetMs - Date.now();
        if (calibratedRemaining > durationMs) {
          clockOffsetMs = Date.now() + durationMs - serverEndsAt;
          sessionStorage.setItem("conexao-clock-offset", String(clockOffsetMs));
        }
      }
    }
  }

  return { durationMs, serverEndsAt };
}

function getSyncedRemainingMs(game) {
  const durationMs = getQuestionDurationMs(game);
  const serverEndsAt = Number(game?.questionEndsAt) || 0;

  if (serverEndsAt > 0) {
    const remaining = serverEndsAt + clockOffsetMs - Date.now();
    return Math.max(0, Math.min(durationMs, remaining));
  }

  if (trackedQuestionStartLocal > 0) {
    return Math.max(0, durationMs - (Date.now() - trackedQuestionStartLocal));
  }

  return 0;
}

function showStatus(message, error = false) {
  statusLabel.textContent = message;
  statusLabel.classList.toggle("is-error", error);
}

function setConnected(connected) {
  connectionLabel.textContent = connected ? "AO VIVO" : "OFFLINE";
  connectionLabel.classList.toggle("is-connected", connected);
}

function renderQuestionHistoryGrid(answers, durationMs) {
  const total = GAME_QUESTIONS.length;
  const items = [];

  for (let idx = 0; idx < total; idx++) {
    const q = GAME_QUESTIONS[idx];
    const ans = answers?.[String(idx)] || null;
    const correctIndex = getCorrectAnswerIndex(q);
    const isDouble = isDoublePointsQuestion(idx, q);

    let statusClass = "is-timeout";
    let statusIcon = "⏱";
    let statusLabelText = "Esgotado";
    let timeText = `${Math.round(durationMs / 1000)}s`;

    if (ans) {
      const isRight = Boolean(ans.correct) || Number(ans.choice) === correctIndex;
      const respMs = getAnswerResponseTimeMs(ans, durationMs);
      timeText = respMs !== null ? formatSecondsPt(respMs) : "Respondida";

      if (isRight) {
        statusClass = "is-correct";
        statusIcon = "✓";
        statusLabelText = "Acertou";
      } else {
        statusClass = "is-incorrect";
        statusIcon = "✕";
        statusLabelText = "Errou";
      }
    }

    items.push(`
      <button
        type="button"
        class="question-history-tile ${statusClass}"
        data-open-review="${idx}"
        title="Ver detalhes da pergunta ${idx + 1}"
      >
        <span class="q-tile-top">
          <b>${String(idx + 1).padStart(2, "0")}</b>
          ${isDouble ? `<em class="q-tile-2x">2X</em>` : ""}
        </span>
        <span class="q-tile-icon" aria-hidden="true">${statusIcon}</span>
        <span class="q-tile-status">${statusLabelText}</span>
        <span class="q-tile-time">⏱ ${timeText}</span>
      </button>
    `);
  }

  return `
    <section class="player-history-section" aria-label="Resumo das suas respostas">
      <div class="player-history-head">
        <span>SUAS QUESTÕES</span>
        <small>TOQUE PARA ABRIR NO CARROSSEL</small>
      </div>
      <div class="question-history-grid">
        ${items.join("")}
      </div>
    </section>
  `;
}

function buildReviewCarouselSrcdoc(answers, startIndex, durationMs) {
  const total = GAME_QUESTIONS.length;
  const safeStart = Math.max(0, Math.min(total - 1, Number(startIndex) || 0));
  const totalSecLabel = `${Math.round(durationMs / 1000)}s`;

  const slidesHTML = [];
  const dotsHTML = [];

  for (let idx = 0; idx < total; idx++) {
    const q = GAME_QUESTIONS[idx];
    const ans = answers?.[String(idx)] || null;
    const correctIndex = getCorrectAnswerIndex(q);
    const isDouble = isDoublePointsQuestion(idx, q);
    const multiplier = isDouble ? 2 : 1;

    let statusClass = "is-timeout";
    let statusBadge = "⏱ TEMPO ESGOTADO";
    let timeDisplay = `${totalSecLabel} (não respondeu)`;
    let speedTag = "Sem resposta";
    let speedPct = 0;
    let pointsDisplay = "0 pts";
    let userChoice = null;

    if (ans) {
      userChoice = Number(ans.choice);
      const isRight = Boolean(ans.correct) || userChoice === correctIndex;
      const respMs = getAnswerResponseTimeMs(ans, durationMs);
      const earned = Number(ans.pointsEarned || 0);
      pointsDisplay = `+${earned.toLocaleString("pt-BR")} pts`;

      if (respMs !== null) {
        timeDisplay = `${formatSecondsPt(respMs)} de ${totalSecLabel}`;
        speedPct = Math.max(6, Math.min(100, Math.round((respMs / durationMs) * 100)));
        if (respMs <= durationMs * 0.25) {
          speedTag = "⚡ Relâmpago";
        } else if (respMs <= durationMs * 0.55) {
          speedTag = "🚀 Muito rápido";
        } else {
          speedTag = "✓ Dentro do tempo";
        }
      } else {
        timeDisplay = "Respondida";
        speedTag = "Registrada";
        speedPct = 50;
      }

      if (isRight) {
        statusClass = "is-correct";
        statusBadge = isDouble ? "✓ VOCÊ ACERTOU · 2X" : "✓ VOCÊ ACERTOU";
      } else {
        statusClass = "is-incorrect";
        statusBadge = "✕ VOCÊ ERROU";
        pointsDisplay = "0 pts";
      }
    }

    dotsHTML.push(`
      <button type="button" class="dot-btn ${statusClass}${idx === safeStart ? " is-active" : ""}" data-slide="${idx}">
        ${String(idx + 1).padStart(2, "0")}
      </button>
    `);

    const choicesHTML = (q.choices || []).map((choice, cIdx) => {
      const isCorrectOpt = cIdx === correctIndex;
      const isUserPick = userChoice === cIdx;
      const isWrongPick = isUserPick && !isCorrectOpt;
      const optClass = isCorrectOpt ? "is-correct" : isWrongPick ? "is-incorrect" : "is-neutral";

      let tagHTML = "";
      if (isCorrectOpt && isUserPick) {
        tagHTML = `<span class="opt-tag is-right">SUA RESPOSTA · CORRETA</span>`;
      } else if (isCorrectOpt) {
        tagHTML = `<span class="opt-tag is-right">CORRETA</span>`;
      } else if (isWrongPick) {
        tagHTML = `<span class="opt-tag is-wrong">SUA RESPOSTA</span>`;
      }

      return `
        <div class="choice-item ${optClass}">
          <span class="choice-letter">${["A", "B", "C", "D"][cIdx] || cIdx + 1}</span>
          <span class="choice-text">${escapeHTML(choice)}</span>
          ${tagHTML}
        </div>
      `;
    }).join("");

    const streakVal = Number(ans?.streak || 0);
    const speedPts = Number(ans?.speedBonus || 0) * multiplier;
    const streakPts = Number(ans?.streakBonus || 0) * multiplier;

    slidesHTML.push(`
      <section class="carousel-slide" aria-label="Pergunta ${idx + 1} de ${total}">
        <div class="slide-inner">
          <div class="slide-meta">
            <span>PERGUNTA ${String(idx + 1).padStart(2, "0")} DE ${String(total).padStart(2, "0")}</span>
            ${isDouble ? `<span class="double-pill">⚡ 2X PONTOS</span>` : ""}
          </div>

          <div class="result-banner ${statusClass}">
            <strong>${statusBadge}</strong>
            <span>${pointsDisplay}</span>
          </div>

          <div class="metrics-grid">
            <div class="metric-card">
              <span class="metric-label">⏱ TEMPO DA QUESTÃO</span>
              <strong class="metric-value">${timeDisplay}</strong>
              <div class="time-bar-track"><i style="width:${speedPct}%"></i></div>
              <small class="metric-sub">${speedTag}</small>
            </div>
            <div class="metric-card">
              <span class="metric-label">🏆 PONTUAÇÃO</span>
              <strong class="metric-value">${pointsDisplay}</strong>
              <small class="metric-sub">
                ${ans?.correct
                  ? `Rapidez: +${speedPts.toLocaleString("pt-BR")}${streakPts > 0 ? ` · 🔥${streakVal}x: +${streakPts.toLocaleString("pt-BR")}` : ""}`
                  : "Sem pontos nesta rodada"}
              </small>
            </div>
          </div>

          <h2 class="question-title">${escapeHTML(q.prompt)}</h2>

          <div class="choices-list">
            ${choicesHTML}
          </div>

          <div class="explanation-card">
            <b>POR QUE ESTA É A MAIS SEGURA?</b>
            <p>${escapeHTML(q.explanation)}</p>
          </div>
        </div>
      </section>
    `);
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #090d1f;
      color: #f5f6ff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
    }
    .app-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .top-bar {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 16px;
      background: #101633;
      border-bottom: 1px solid rgba(165, 176, 255, 0.16);
    }
    .top-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .top-title span {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.14em;
      color: #66f4ff;
    }
    .top-title strong {
      font-size: 14px;
      color: #ffffff;
    }
    .close-btn {
      height: 34px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid rgba(251, 113, 133, 0.45);
      background: rgba(251, 113, 133, 0.14);
      color: #fda4af;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .dots-bar {
      flex: none;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 14px;
      overflow-x: auto;
      background: rgba(13, 18, 40, 0.9);
      border-bottom: 1px solid rgba(165, 176, 255, 0.1);
    }
    .dot-btn {
      flex: none;
      min-width: 32px;
      height: 28px;
      padding: 0 7px;
      border-radius: 8px;
      border: 1px solid rgba(165, 176, 255, 0.22);
      background: rgba(255, 255, 255, 0.04);
      color: #cbd5e1;
      font-size: 11px;
      font-weight: 800;
      cursor: pointer;
      transition: transform 0.15s, border-color 0.15s, background 0.15s;
    }
    .dot-btn.is-correct {
      border-color: rgba(52, 211, 153, 0.45);
      color: #6ee7b7;
      background: rgba(52, 211, 153, 0.12);
    }
    .dot-btn.is-incorrect {
      border-color: rgba(251, 113, 133, 0.45);
      color: #fda4af;
      background: rgba(251, 113, 133, 0.12);
    }
    .dot-btn.is-active {
      transform: scale(1.08);
      border-width: 2px;
      border-color: #66f4ff;
      color: #ffffff;
      box-shadow: 0 0 12px rgba(102, 244, 255, 0.35);
    }
    .carousel-viewport {
      flex: 1;
      overflow: hidden;
      position: relative;
    }
    .carousel-track {
      display: flex;
      height: 100%;
      transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
      will-change: transform;
    }
    .carousel-slide {
      flex: 0 0 100%;
      width: 100%;
      height: 100%;
      overflow-y: auto;
      padding: 16px;
    }
    .slide-inner {
      max-width: 560px;
      margin: 0 auto;
      display: grid;
      gap: 12px;
    }
    .slide-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: #94a3b8;
    }
    .double-pill {
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(251, 191, 36, 0.18);
      border: 1px solid rgba(251, 191, 36, 0.5);
      color: #fde047;
    }
    .result-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 800;
    }
    .result-banner.is-correct {
      background: rgba(52, 211, 153, 0.15);
      border: 1px solid rgba(52, 211, 153, 0.5);
      color: #6ee7b7;
    }
    .result-banner.is-incorrect {
      background: rgba(251, 113, 133, 0.15);
      border: 1px solid rgba(251, 113, 133, 0.5);
      color: #fda4af;
    }
    .result-banner.is-timeout {
      background: rgba(148, 163, 184, 0.14);
      border: 1px solid rgba(148, 163, 184, 0.35);
      color: #cbd5e1;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .metric-card {
      padding: 10px 12px;
      border-radius: 12px;
      background: #121836;
      border: 1px solid rgba(165, 176, 255, 0.16);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .metric-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: #94a3b8;
    }
    .metric-value {
      font-size: 15px;
      color: #ffffff;
    }
    .metric-sub {
      font-size: 11px;
      color: #66f4ff;
    }
    .time-bar-track {
      height: 5px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
      overflow: hidden;
      margin: 2px 0;
    }
    .time-bar-track i {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #34d399, #66f4ff);
    }
    .question-title {
      margin: 4px 0;
      font-size: 17px;
      line-height: 1.4;
      color: #ffffff;
    }
    .choices-list {
      display: grid;
      gap: 8px;
    }
    .choice-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 11px 12px;
      border-radius: 12px;
      border: 1px solid rgba(165, 176, 255, 0.16);
      background: #131a3a;
      font-size: 13px;
      line-height: 1.35;
    }
    .choice-item.is-neutral {
      opacity: 0.55;
    }
    .choice-item.is-correct {
      border-color: #34d399;
      background: rgba(52, 211, 153, 0.14);
      color: #ecfdf5;
    }
    .choice-item.is-incorrect {
      border-color: #fb7185;
      background: rgba(251, 113, 133, 0.14);
      color: #fff1f2;
    }
    .choice-letter {
      width: 26px;
      height: 26px;
      flex: none;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.1);
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 12px;
    }
    .choice-item.is-correct .choice-letter {
      background: #34d399;
      color: #06281e;
    }
    .choice-item.is-incorrect .choice-letter {
      background: #fb7185;
      color: #2b0711;
    }
    .choice-text {
      flex: 1;
    }
    .opt-tag {
      flex: none;
      padding: 3px 7px;
      border-radius: 6px;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 0.06em;
    }
    .opt-tag.is-right {
      background: rgba(52, 211, 153, 0.22);
      color: #6ee7b7;
    }
    .opt-tag.is-wrong {
      background: rgba(251, 113, 133, 0.24);
      color: #fda4af;
    }
    .explanation-card {
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid rgba(102, 244, 255, 0.25);
      background: rgba(102, 244, 255, 0.07);
      font-size: 13px;
      line-height: 1.5;
      color: #e2e8f0;
    }
    .explanation-card b {
      display: block;
      margin-bottom: 4px;
      font-size: 10px;
      letter-spacing: 0.12em;
      color: #66f4ff;
    }
    .explanation-card p {
      margin: 0;
    }
    .nav-bar {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 16px;
      background: #101633;
      border-top: 1px solid rgba(165, 176, 255, 0.16);
    }
    .nav-btn {
      height: 40px;
      padding: 0 16px;
      border-radius: 10px;
      border: 1px solid rgba(102, 244, 255, 0.35);
      background: rgba(102, 244, 255, 0.12);
      color: #66f4ff;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }
    .nav-btn:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .swipe-hint {
      font-size: 11px;
      color: #94a3b8;
    }
    @media (max-width: 420px) {
      .metrics-grid { grid-template-columns: 1fr; }
      .swipe-hint { display: none; }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="top-bar">
      <div class="top-title">
        <span>CARROSSEL DE REVISÃO</span>
        <strong id="counterLabel">Questão ${String(safeStart + 1).padStart(2, "0")} de ${String(total).padStart(2, "0")}</strong>
      </div>
      <button type="button" class="close-btn" id="closeBtn">Fechar ✕</button>
    </header>

    <nav class="dots-bar" aria-label="Navegar entre questões">
      ${dotsHTML.join("")}
    </nav>

    <main class="carousel-viewport" id="viewport">
      <div class="carousel-track" id="track">
        ${slidesHTML.join("")}
      </div>
    </main>

    <footer class="nav-bar">
      <button type="button" class="nav-btn" id="prevBtn">← Anterior</button>
      <span class="swipe-hint">Deslize para o lado</span>
      <button type="button" class="nav-btn" id="nextBtn">Próxima →</button>
    </footer>
  </div>

  <script>
    const total = ${total};
    let current = ${safeStart};
    const track = document.getElementById("track");
    const counterLabel = document.getElementById("counterLabel");
    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    const dots = [...document.querySelectorAll(".dot-btn")];

    function goTo(index) {
      current = Math.max(0, Math.min(total - 1, index));
      track.style.transform = "translateX(-" + (current * 100) + "%)";
      counterLabel.textContent = "Questão " + String(current + 1).padStart(2, "0") + " de " + String(total).padStart(2, "0");
      prevBtn.disabled = current === 0;
      nextBtn.disabled = current === total - 1;
      dots.forEach((dot, idx) => {
        dot.classList.toggle("is-active", idx === current);
        if (idx === current) {
          dot.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      });
    }

    prevBtn.addEventListener("click", () => goTo(current - 1));
    nextBtn.addEventListener("click", () => goTo(current + 1));
    dots.forEach((dot) => {
      dot.addEventListener("click", () => goTo(Number(dot.dataset.slide)));
    });

    document.getElementById("closeBtn").addEventListener("click", () => {
      window.parent.postMessage({ type: "close-review-iframe" }, "*");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") goTo(current - 1);
      if (e.key === "ArrowRight") goTo(current + 1);
      if (e.key === "Escape") window.parent.postMessage({ type: "close-review-iframe" }, "*");
    });

    let touchStartX = 0;
    let touchStartY = 0;
    const viewport = document.getElementById("viewport");
    viewport.addEventListener("touchstart", (e) => {
      touchStartX = e.changedTouches[0].clientX;
      touchStartY = e.changedTouches[0].clientY;
    }, { passive: true });

    viewport.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) goTo(current + 1);
        else goTo(current - 1);
      }
    }, { passive: true });

    goTo(current);
  </script>
</body>
</html>`;
}

function closeReviewIframeModal() {
  const existing = document.querySelector("#playerReviewModal");
  if (existing) {
    existing.remove();
  }
}

function openReviewIframeModal(startIndex = 0) {
  if (!currentPlayer || !currentGame || currentGame.status !== "final") return;
  closeReviewIframeModal();

  const durationMs = getQuestionDurationMs(currentGame);

  const modal = document.createElement("div");
  modal.id = "playerReviewModal";
  modal.className = "review-iframe-backdrop";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Carrossel de revisão das questões");

  modal.innerHTML = `
    <div class="review-iframe-dialog">
      <iframe
        class="review-carousel-iframe"
        title="Carrossel de revisão das questões"
        sandbox="allow-scripts"
      ></iframe>
    </div>
  `;

  document.body.appendChild(modal);

  const iframe = modal.querySelector("iframe");
  iframe.srcdoc = buildReviewCarouselSrcdoc(
    currentPlayer.answers || {},
    startIndex,
    durationMs
  );

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      window.GameAudio?.playEffect("click");
      closeReviewIframeModal();
    }
  });
}

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "close-review-iframe") {
    window.GameAudio?.playEffect("click");
    closeReviewIframeModal();
  }
});

function renderRanking(players, game) {
  const topPlayers = (players || []).slice(0, 5);
  const isFinal = game?.status === "final";
  const topScore = topPlayers[0]?.score ?? 0;
  return `
    <div class="player-ranking">
      <span>PLACAR DA SALA</span>
      <ol>
        ${topPlayers.map((player, index) => {
          const isMe = player.id === playerId;
          const pStreak = getActiveStreak(player, game);
          const isFirstPlace = isFinal && (index === 0 || (topScore > 0 && player.score === topScore));
          const avatarHtml = isFirstPlace
            ? renderDancingAvatar(player.avatar, "game-avatar game-avatar-ranking", false)
            : renderAvatarWithFire(player.avatar, "game-avatar game-avatar-ranking", pStreak);

          return `
            <li class="${isMe ? "is-me" : ""}" style="--stagger:${index}">
              <span>${String(index + 1).padStart(2, "0")}</span>
              ${avatarHtml}
              <b>
                <span class="ranking-player-name">${escapeHTML(player.name)}</span>
                ${pStreak >= 2 ? `<span class="streak-inline-pill">🔥 ${pStreak}x</span>` : ""}
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
  closeReviewIframeModal();
  window.clearInterval(timerInterval);
  sessionStorage.removeItem("conexao-game-player-id");
  sessionStorage.removeItem("conexao-game-room");
  playerId = null;
  playerRoom = null;
  currentGame = null;
  currentPlayers = [];
  currentPlayer = null;
  pendingChoice = null;
  syncedQuestionKey = "";
  hasSeenRoomSnapshot = false;
  trackedQuestionStartLocal = 0;
  lastPlayerStateSoundKey = "";
  burstDone = false;
  setConnected(false);
}

function exitToJoinScreen(message) {
  window.GameAudio?.playEffect("closeRoom");
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
    hasSeenRoomSnapshot = true;
    return;
  }

  setConnected(true);
  currentPlayer = me;
  const qIndex = Number(game.questionIndex);
  const qKey = String(qIndex);
  const question = GAME_QUESTIONS[qIndex];
  const isDouble = isDoublePointsQuestion(qIndex, question, game);
  const roundAnswer = currentPlayer.answers?.[qKey] || null;
  const myStreak = getActiveStreak(currentPlayer, game);
  const durationMs = getQuestionDurationMs(game);

  const stateSoundKey = `${game.status}:${qKey}`;
  if (stateSoundKey !== lastPlayerStateSoundKey) {
    if (game.status === "question") {
      closeReviewIframeModal();
      lastPlayerUrgentSecond = -1;
      if (isDouble) {
        window.GameAudio?.playEffect("doublePointsStart");
      } else {
        window.GameAudio?.playEffect(qIndex === 0 ? "start" : "nextQuestion");
      }
    } else if (game.status === "review" && question) {
      const correctIndex = getCorrectAnswerIndex(question);
      const userChoice = roundAnswer ? Number(roundAnswer.choice) : null;
      if (userChoice === null) {
        window.GameAudio?.playEffect("timeout");
      } else if (Boolean(roundAnswer?.correct) || userChoice === correctIndex) {
        window.GameAudio?.playEffect(myStreak >= 2 ? "doublePointsStart" : "correct");
      } else {
        window.GameAudio?.playEffect("wrong");
      }
    } else if (game.status === "final") {
      window.GameAudio?.playEffect("champion");
    }
    lastPlayerStateSoundKey = stateSoundKey;
  }

  if (game.status === "question") {
    syncQuestionClock(game);
  } else {
    pendingChoice = null;
  }

  hasSeenRoomSnapshot = true;
  joinSection.hidden = true;
  gameSection.hidden = false;

  const header = `
    <header class="player-card-header">
      <span>SALA · ${escapeHTML(game.roomCode)}</span>
      <span class="player-score">${Number(currentPlayer.score || 0).toLocaleString("pt-BR")} PTS</span>
    </header>
  `;
  const identity = `
    <div class="player-identity${myStreak >= 2 ? " is-on-fire" : ""}">
      ${renderAvatarWithFire(currentPlayer.avatar, "game-avatar game-avatar-identity", myStreak)}
      <div class="player-identity-info">
        <span>JOGANDO COMO</span>
        <b>${escapeHTML(currentPlayer.name)}</b>
      </div>
      ${myStreak >= 2 ? `
        <div class="player-streak-chip">
          <span>🔥 ${myStreak} SEGUIDOS</span>
          <small>+${(getStreakBonus(myStreak) * (isDouble ? 2 : 1)).toLocaleString("pt-BR")} PTS</small>
        </div>
      ` : ""}
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

  const lastChoice = roundAnswer ? Number(roundAnswer.choice) : pendingChoice;
  const ranking = renderRanking(players, game);

  if (game.status === "question" && question) {
    const remaining = getSyncedRemainingMs(game);
    const secs = Math.ceil(remaining / 1000);
    const isUrgent = secs > 0 && secs <= 5;
    const isLocked = lastChoice !== null || submitting;
    const multiplier = isDouble ? 2 : 1;
    const nextStreakIfRight = myStreak + 1;
    const nextStreakBonus = getStreakBonus(nextStreakIfRight) * multiplier;
    const maxRoundPoints = ((BASE_POINTS + SPEED_BONUS_MAX) * multiplier) + nextStreakBonus;

    gameContent.innerHTML = `
      <article class="player-card${isDouble ? " is-double-points" : ""}">
        ${header}
        ${identity}
        ${isDouble ? `
          <div class="player-double-banner">
            <span>⚡ MODO DOBRO DE PONTOS · 2X ATIVO</span>
          </div>
        ` : ""}
        <div class="player-card-header">
          <span>PERGUNTA ${String(qIndex + 1).padStart(2, "0")} / ${String(GAME_QUESTIONS.length).padStart(2, "0")}</span>
          <span class="${isDouble ? "is-double-pts-label" : ""}">ATÉ ${maxRoundPoints.toLocaleString("pt-BR")} PTS${isDouble ? " (2X)" : ""}</span>
        </div>
        <h2>${escapeHTML(question.prompt)}</h2>
        <div class="player-timer-box${isUrgent ? " is-urgent" : ""}" id="playerTimerBox">
          <div class="player-timer-top">
            <span class="player-timer-label">
              <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9"></circle>
                <polyline points="12 7 12 12 15 14"></polyline>
              </svg>
              ${isDouble ? "VALENDO O DOBRO · +RÁPIDO = +PONTOS" : "TEMPO RESTANTE · +RÁPIDO = +PONTOS"}
            </span>
            <span class="player-seconds-badge${isUrgent ? " is-urgent" : ""}" id="playerSeconds">${String(secs).padStart(2, "0")}s</span>
          </div>
          <div class="player-timer"><i id="playerTimerFill" class="${isUrgent ? "is-urgent" : ""}" style="width: ${Math.max(0, Math.min(100, (remaining / durationMs) * 100))}%"></i></div>
        </div>
        <div class="player-answer-list">
          ${question.choices.map((choice, index) => {
            const isSelected = lastChoice === index;
            const isDimmed = lastChoice !== null && !isSelected;
            return `
              <button
                class="player-answer${isSelected ? " is-selected" : ""}${isDimmed ? " is-dimmed" : ""}"
                type="button"
                data-choice="${index}"
                style="--stagger:${index}"
                ${isLocked ? "disabled" : ""}
              >
                <span class="player-answer-letter">${["A", "B", "C"][index]}</span>
                <span class="player-answer-text">${escapeHTML(choice)}</span>
                ${isSelected ? `<span class="player-answer-tag">${roundAnswer ? "ENVIADA" : "ENVIANDO..."}</span>` : ""}
              </button>
            `;
          }).join("")}
        </div>
        <p class="player-feedback-box${lastChoice !== null ? " is-locked" : ""}" id="playerFeedback" aria-live="polite">
          ${roundAnswer
            ? `Resposta registrada em ${formatSecondsPt(getAnswerResponseTimeMs(roundAnswer, durationMs) || 1000)}! ${roundAnswer.correct ? `Você garantiu +${Number(roundAnswer.pointsEarned || 0).toLocaleString("pt-BR")} pts.` : "Aguarde a revelação no telão."}`
            : pendingChoice !== null
              ? "Registrando sua resposta..."
              : nextStreakIfRight >= 2
                ? `🔥 Acerte agora para chegar a ${nextStreakIfRight} seguidos (+${nextStreakBonus.toLocaleString("pt-BR")} pts de sequência)!`
                : isDouble
                  ? "⚡ Modo Dobro de Pontos ativo! Acerte rápido para multiplicar sua pontuação por 2!"
                  : "Responda rápido para ganhar até +1.000 pts de velocidade!"}
        </p>
      </article>
    `;

    const updateTimer = () => {
      const msLeft = getSyncedRemainingMs(game);
      const secLeft = Math.ceil(msLeft / 1000);
      const urgent = secLeft > 0 && secLeft <= 5;

      const timerBox = gameContent.querySelector("#playerTimerBox");
      const secondsLabel = gameContent.querySelector("#playerSeconds");
      const fill = gameContent.querySelector("#playerTimerFill");
      if (timerBox) {
        timerBox.classList.toggle("is-urgent", urgent);
      }
      if (secondsLabel) {
        secondsLabel.textContent = `${String(secLeft).padStart(2, "0")}s`;
        secondsLabel.classList.toggle("is-urgent", urgent);
      }
      if (fill) {
        fill.style.width = `${Math.max(0, Math.min(100, (msLeft / durationMs) * 100))}%`;
        fill.classList.toggle("is-urgent", urgent);
      }
      if (urgent && secLeft !== lastPlayerUrgentSecond && lastChoice === null) {
        lastPlayerUrgentSecond = secLeft;
        window.GameAudio?.playEffect("urgentTick");
      }
      if (msLeft === 0 && lastChoice === null && !submitting) {
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
    const correctIndex = getCorrectAnswerIndex(question);
    const multiplier = isDouble ? 2 : 1;
    let bannerClass = "is-timeout";
    let bannerText = "⏱ Tempo esgotado nesta rodada";
    let bannerPts = "0 PTS";
    let breakdownHTML = "";

    if (lastChoice !== null && roundAnswer) {
      const wasCorrect = Boolean(roundAnswer.correct) || lastChoice === correctIndex;
      const earned = Number(roundAnswer.pointsEarned || (wasCorrect ? BASE_POINTS * multiplier : 0));
      const respMs = getAnswerResponseTimeMs(roundAnswer, durationMs);
      const timeChip = respMs !== null ? `<span>⏱ Tempo: <b>${formatSecondsPt(respMs)}</b></span>` : "";

      if (wasCorrect) {
        const baseShown = Number(roundAnswer.basePoints || BASE_POINTS) * multiplier;
        const speedShown = Number(roundAnswer.speedBonus || 0) * multiplier;
        const streakShown = Number(roundAnswer.streakBonus || 0) * multiplier;
        const ansStreak = Number(roundAnswer.streak || myStreak || 1);

        bannerClass = "is-correct";
        bannerText = ansStreak >= 2
          ? `🔥 Resposta correta! (${ansStreak} seguidos${isDouble ? " · 2X" : ""})`
          : isDouble
            ? "⚡ Resposta correta (2X)!"
            : "✓ Resposta correta!";
        bannerPts = `+${earned.toLocaleString("pt-BR")} PTS`;

        breakdownHTML = `
          <div class="points-breakdown-row">
            ${timeChip}
            <span>Acerto: <b>+${baseShown.toLocaleString("pt-BR")}</b></span>
            <span>⚡ Rapidez: <b>+${speedShown.toLocaleString("pt-BR")}</b></span>
            ${streakShown > 0 ? `<span class="is-fire">🔥 Sequência (${ansStreak}x): <b>+${streakShown.toLocaleString("pt-BR")}</b></span>` : ""}
          </div>
        `;
      } else {
        bannerClass = "is-incorrect";
        bannerText = "✕ Não foi dessa vez (sequência zerada)";
        bannerPts = "0 PTS";
        breakdownHTML = timeChip ? `<div class="points-breakdown-row">${timeChip}</div>` : "";
      }
    }

    gameContent.innerHTML = `
      <article class="player-card${isDouble ? " is-double-points" : ""}">
        ${header}
        ${identity}
        ${isDouble ? `
          <div class="player-double-banner">
            <span>⚡ MODO DOBRO DE PONTOS · 2X ATIVO</span>
          </div>
        ` : ""}
        <div class="round-result-banner ${bannerClass}">
          <span>${bannerText}</span>
          <span class="round-result-pts">${bannerPts}</span>
        </div>
        ${breakdownHTML}
        <h2>${escapeHTML(question.prompt)}</h2>
        <div class="player-answer-list">
          ${question.choices.map((choice, index) => {
            const isCorrectOpt = index === correctIndex;
            const isWrongPick = lastChoice === index && !isCorrectOpt;
            const stateClass = isCorrectOpt ? " is-correct" : isWrongPick ? " is-incorrect" : " is-dimmed";
            const tag = isCorrectOpt
              ? `<span class="player-answer-tag">CORRETA</span>`
              : isWrongPick
                ? `<span class="player-answer-tag">SUA RESPOSTA</span>`
                : "";
            return `
              <div class="player-answer${stateClass}" style="--stagger:${index}">
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
  const myBestStreak = Math.max(
    computePreviousStreak(currentPlayer.answers || {}, GAME_QUESTIONS.length),
    Number(currentPlayer.maxStreak || 0)
  );

  const winnerCard = winner
    ? `
      <div class="player-champion">
        ${renderDancingAvatar(winner.avatar, "game-avatar game-avatar-champion", true)}
        <span class="player-champion-tag">✦ ${tiedWinners.length > 1 ? "EMPATE NO TOPO" : "CAMPEÃO DA SALA"}</span>
        <b>${tiedWinners.length > 1 ? tiedWinners.map((p) => escapeHTML(p.name)).join(" & ") : escapeHTML(winner.name)}</b>
        <small>${winner.score.toLocaleString("pt-BR")} PONTOS</small>
      </div>
    `
    : "";

  const fullHistoryHTML = renderQuestionHistoryGrid(
    currentPlayer.answers || {},
    durationMs
  );

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
          <strong>${myCorrectCount}/${GAME_QUESTIONS.length}${myBestStreak >= 2 ? ` · 🔥${myBestStreak}` : ""}</strong>
          <span>ACERTOS</span>
        </div>
      </div>
      ${fullHistoryHTML}
      ${ranking}
      <p class="player-waiting" style="margin-top: 16px;">Obrigado por jogar! Reveja as dicas com a turma.</p>
      <button type="button" class="secondary-action-btn" id="leaveRoomBtn">Entrar em outra sala</button>
    </article>
  `;

  gameContent.querySelector("#leaveRoomBtn")?.addEventListener("click", () => {
    window.GameAudio?.playEffect("click");
    exitToJoinScreen("Pronto para entrar em uma nova sala.");
  });
}

function subscribeToRoom(roomCode) {
  cleanupListeners();
  hasSeenRoomSnapshot = false;
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
          streak: Number(data.streak || 0),
          maxStreak: Number(data.maxStreak || 0),
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
  window.GameAudio?.playEffect("click");
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
      streak: 0,
      maxStreak: 0,
      joinedAt: Date.now(),
      answers: {}
    };

    const newPlayerRef = await addDoc(collection(db, "rooms", roomCode, "players"), initialPlayer);
    playerId = newPlayerRef.id;
    playerRoom = roomCode;
    currentPlayers = [{ id: playerId, ...initialPlayer }];

    sessionStorage.setItem("conexao-game-player-id", playerId);
    sessionStorage.setItem("conexao-game-room", playerRoom);
    window.GameAudio?.playEffect("join");
    showStatus("");
    subscribeToRoom(roomCode);
  } catch (error) {
    window.GameAudio?.playEffect("wrong");
    joinError.textContent = error.message;
  } finally {
    joinButton.disabled = false;
  }
});

avatarFields.forEach((field) => {
  field.addEventListener("change", () => {
    window.GameAudio?.playEffect("avatar");
    renderAvatarPreview();
  });
});
renderAvatarPreview();

gameContent.addEventListener("click", async (event) => {
  const reviewTile = event.target.closest("[data-open-review]");
  if (reviewTile && currentGame?.status === "final") {
    window.GameAudio?.playEffect("select");
    openReviewIframeModal(Number(reviewTile.dataset.openReview));
    return;
  }

  const button = event.target.closest("[data-choice]");
  if (!button || submitting || !playerId || !playerRoom || !currentGame) return;

  const qIndex = Number(currentGame.questionIndex);
  const qKey = String(qIndex);
  const question = GAME_QUESTIONS[qIndex];
  if (!question || currentGame.status !== "question") return;
  if (currentPlayer?.answers?.[qKey] !== undefined) return;

  window.GameAudio?.playEffect("select");

  const choice = Number(button.dataset.choice);
  const durationMs = getQuestionDurationMs(currentGame);
  const timeLeft = getSyncedRemainingMs(currentGame);
  const responseTimeMs = Math.max(100, Math.min(durationMs, durationMs - timeLeft));
  const multiplier = isDoublePointsQuestion(qIndex, question, currentGame) ? 2 : 1;

  submitting = true;
  pendingChoice = choice;
  renderGame(currentGame, currentPlayers);

  try {
    const correctIndex = getCorrectAnswerIndex(question);
    const correct = choice === correctIndex;
    const prevStreak = computePreviousStreak(currentPlayer?.answers || {}, qIndex);
    const newStreak = correct ? prevStreak + 1 : 0;
    const nextMaxStreak = Math.max(Number(currentPlayer?.maxStreak || 0), newStreak);

    const speedBonus = correct ? Math.round((SPEED_BONUS_MAX * timeLeft) / durationMs) : 0;
    const streakBonus = correct ? getStreakBonus(newStreak) : 0;
    const pointsEarned = correct ? (BASE_POINTS + speedBonus + streakBonus) * multiplier : 0;

    const answerPayload = {
      choice,
      correct,
      basePoints: correct ? BASE_POINTS : 0,
      speedBonus,
      streakBonus,
      streak: newStreak,
      pointsEarned,
      responseTimeMs,
      doublePoints: multiplier === 2,
      answeredAt: Date.now()
    };

    await updateDoc(doc(db, "rooms", playerRoom, "players", playerId), {
      score: increment(pointsEarned),
      streak: newStreak,
      maxStreak: nextMaxStreak,
      [`answers.${qKey}`]: answerPayload
    });

    if (currentPlayer) {
      currentPlayer.score = Number(currentPlayer.score || 0) + pointsEarned;
      currentPlayer.streak = newStreak;
      currentPlayer.maxStreak = nextMaxStreak;
      currentPlayer.answers = { ...(currentPlayer.answers || {}), [qKey]: answerPayload };
    }
    pendingChoice = null;
    if (currentGame.status === "question") {
      renderGame(currentGame, currentPlayers);
    }
  } catch (error) {
    pendingChoice = null;
    window.GameAudio?.playEffect("wrong");
    const feedback = gameContent.querySelector("#playerFeedback");
    if (feedback) {
      feedback.textContent = `Erro ao salvar resposta: ${error.message}`;
    }
    showStatus(`Não foi possível enviar sua resposta: ${error.message}`, true);
    gameContent.querySelectorAll("[data-choice]").forEach((btn) => { btn.disabled = false; });
  } finally {
    submitting = false;
  }
});

void resumeGame();