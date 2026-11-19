import { db, ensureAnonymousSession } from "./firebase-config.js";
import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp
} from "firebase/firestore";

const ROUND_DURATION = 20.0;
const BEST_SCORE_KEY = "arcade_pulse_v2_best_score";
const NICKNAME_KEY = "arcade_pulse_v2_nickname";

const statusDot = document.getElementById("statusDot");
const sessionText = document.getElementById("sessionText");
const scoreValue = document.getElementById("scoreValue");
const comboValue = document.getElementById("comboValue");
const bestScoreValue = document.getElementById("bestScoreValue");
const timerValue = document.getElementById("timerValue");
const arena = document.getElementById("arena");
const arenaOverlay = document.getElementById("arenaOverlay");
const startBtn = document.getElementById("startBtn");
const targetBtn = document.getElementById("targetBtn");
const nicknameInput = document.getElementById("nicknameInput");
const submitScoreBtn = document.getElementById("submitScoreBtn");
const feedbackMsg = document.getElementById("feedbackMsg");
const leaderboardList = document.getElementById("leaderboardList");

let playerId = null;
let score = 0;
let combo = 1;
let maxCombo = 1;
let isBonusTarget = false;
let bestScore = Number(localStorage.getItem(BEST_SCORE_KEY) || 0);
let timeLeft = ROUND_DURATION;
let running = false;
let countdownInterval = null;
let targetExpireTimeout = null;
let scoreSubmittedForRound = false;

const savedNick = localStorage.getItem(NICKNAME_KEY);
if (savedNick) {
  nicknameInput.value = savedNick;
}
bestScoreValue.textContent = String(bestScore);

function setFeedback(msg, isError = false) {
  feedbackMsg.textContent = msg;
  feedbackMsg.style.color = isError ? "#f43f5e" : "#38bdf8";
}

function getTargetLifetimeMs() {
  // Dificuldade aumenta conforme a pontuacao sobe
  return Math.max(680, 1450 - Math.floor(score / 80) * 90);
}

function spawnTarget() {
  if (!running) return;
  clearTimeout(targetExpireTimeout);

  isBonusTarget = Math.random() < 0.25;
  targetBtn.classList.toggle("bonus", isBonusTarget);
  targetBtn.textContent = isBonusTarget ? "BÔNUS" : "ALVO";

  const maxX = Math.max(10, arena.clientWidth - targetBtn.offsetWidth - 10);
  const maxY = Math.max(10, arena.clientHeight - targetBtn.offsetHeight - 10);
  const x = Math.floor(Math.random() * maxX);
  const y = Math.floor(Math.random() * maxY);
  targetBtn.style.left = `${x}px`;
  targetBtn.style.top = `${y}px`;
  targetBtn.hidden = false;

  targetExpireTimeout = setTimeout(() => {
    if (!running) return;
    // Se o alvo expirar sem clique, reseta o combo e gera um novo alvo
    combo = 1;
    comboValue.textContent = "x1";
    spawnTarget();
  }, getTargetLifetimeMs());
}

function startRound() {
  score = 0;
  combo = 1;
  maxCombo = 1;
  timeLeft = ROUND_DURATION;
  running = true;
  scoreSubmittedForRound = false;

  scoreValue.textContent = "0";
  comboValue.textContent = "x1";
  timerValue.textContent = `${timeLeft.toFixed(1)}s`;
  submitScoreBtn.disabled = true;
  arenaOverlay.hidden = true;
  setFeedback("Partida v2 iniciada! Alvos dourados valem o dobro!");

  spawnTarget();

  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    timeLeft = Math.max(0, Number((timeLeft - 0.1).toFixed(1)));
    timerValue.textContent = `${timeLeft.toFixed(1)}s`;
    if (timeLeft <= 0) {
      finishRound();
    }
  }, 100);
}

function finishRound() {
  running = false;
  clearInterval(countdownInterval);
  clearTimeout(targetExpireTimeout);
  targetBtn.hidden = true;
  arenaOverlay.hidden = false;
  arenaOverlay.querySelector("h2").textContent = `FIM DE JOGO — ${score} PTS`;
  startBtn.textContent = "Jogar Novamente";

  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
    bestScoreValue.textContent = String(bestScore);
  }

  submitScoreBtn.disabled = score <= 0 || scoreSubmittedForRound;
  setFeedback(
    score > 0
      ? `Partida encerrada (Combo máx: x${maxCombo}). Clique em 'Salvar no Placar' para enviar ao Firestore.`
      : "Tempo esgotado! Acerte ao menos um alvo na próxima partida para salvar no placar."
  );
}

targetBtn.addEventListener("click", () => {
  if (!running) return;
  clearTimeout(targetExpireTimeout);

  const basePoints = isBonusTarget ? 20 : 10;
  const gained = basePoints * combo;
  score += gained;

  combo = Math.min(8, combo + 1);
  if (combo > maxCombo) {
    maxCombo = combo;
  }

  scoreValue.textContent = String(score);
  comboValue.textContent = `x${combo}`;
  spawnTarget();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && running && !targetBtn.hidden) {
    e.preventDefault();
    targetBtn.click();
  }
});

nicknameInput.addEventListener("change", () => {
  localStorage.setItem(NICKNAME_KEY, nicknameInput.value.trim().slice(0, 20));
});

startBtn.addEventListener("click", startRound);

submitScoreBtn.addEventListener("click", async () => {
  if (score <= 0 || scoreSubmittedForRound) return;

  const rawName = (nicknameInput.value || "Piloto").trim().slice(0, 20);
  const nickname = rawName || "Piloto";
  localStorage.setItem(NICKNAME_KEY, nickname);

  submitScoreBtn.disabled = true;
  setFeedback("Enviando pontuação para o Firestore...");

  try {
    await addDoc(collection(db, "scores"), {
      nickname,
      score,
      maxCombo,
      playerId: playerId || "guest",
      createdAt: serverTimestamp()
    });
    scoreSubmittedForRound = true;
    setFeedback(`Pontuação de ${score} pts salva no placar como "${nickname}"!`);
  } catch (err) {
    console.error("Erro ao salvar no Firestore:", err);
    submitScoreBtn.disabled = false;
    setFeedback("Não foi possível salvar no Firestore. Verifique as regras e o console.", true);
  }
});

function listenLeaderboard() {
  const q = query(
    collection(db, "scores"),
    orderBy("score", "desc"),
    limit(10)
  );

  onSnapshot(
    q,
    (snapshot) => {
      leaderboardList.innerHTML = "";
      if (snapshot.empty) {
        leaderboardList.innerHTML = '<li class="empty">Nenhuma pontuação registrada ainda.</li>';
        return;
      }

      let pos = 1;
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const li = document.createElement("li");
        if (playerId && data.playerId && data.playerId === playerId) {
          li.classList.add("me");
        }

        const left = document.createElement("div");
        left.className = "rank-left";

        const rankSpan = document.createElement("span");
        rankSpan.className = "rank-pos";
        rankSpan.textContent = `#${pos}`;

        const nameSpan = document.createElement("span");
        nameSpan.className = "rank-name";
        nameSpan.textContent = String(data.nickname || "Piloto").slice(0, 20);

        left.append(rankSpan, nameSpan);

        const meta = document.createElement("div");
        meta.className = "rank-meta";

        if (Number(data.maxCombo || 1) > 1) {
          const comboSpan = document.createElement("span");
          comboSpan.className = "rank-combo";
          comboSpan.textContent = `x${Number(data.maxCombo)}`;
          meta.appendChild(comboSpan);
        }

        const scoreSpan = document.createElement("span");
        scoreSpan.className = "rank-score";
        scoreSpan.textContent = `${Number(data.score || 0)} pts`;
        meta.appendChild(scoreSpan);

        li.append(left, meta);
        leaderboardList.appendChild(li);
        pos += 1;
      });
    },
    (err) => {
      console.error("Erro ao escutar placar:", err);
      leaderboardList.innerHTML = '<li class="empty">Erro ao carregar o placar.</li>';
    }
  );
}

async function init() {
  try {
    const user = await ensureAnonymousSession();
    playerId = user.uid;
    statusDot.classList.add("online");
    sessionText.textContent = `Sessão ativa (${user.uid.slice(0, 6)}...) • Sem login`;
  } catch (err) {
    console.warn("Auth anônima indisponível, seguindo em modo aberto:", err);
    statusDot.classList.add("online");
    sessionText.textContent = "Modo direto • Sem login";
  }

  listenLeaderboard();
}

init();
