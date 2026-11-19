const pairCard = document.querySelector("#pairCard");
const controller = document.querySelector("#controller");
const pairForm = document.querySelector("#pairForm");
const pairCode = document.querySelector("#pairCode");
const pairError = document.querySelector("#pairError");
const connectionStatus = document.querySelector("#connectionStatus");
const remoteStatus = document.querySelector("#remoteStatus");
const pointerToggle = document.querySelector("#pointerToggle");
const pointerPad = document.querySelector("#pointerPad");
const pointerPadCursor = document.querySelector("#pointerPadCursor");
const pointerClickButton = document.querySelector("#pointerClickButton");
const slideCounter = document.querySelector("#slideCounter");
const slideTitle = document.querySelector("#slideTitle");
const remoteProgress = document.querySelector("#remoteProgress");
const slideSelect = document.querySelector("#slideSelect");
const notesButton = document.querySelector("#notesButton");
const phoneNotes = document.querySelector("#phoneNotes");
const noteText = document.querySelector("#noteText");
const revealAnswerButton = document.querySelector("#revealAnswerButton");
const revealAnswerLabel = document.querySelector("#revealAnswerLabel");
const blurButton = document.querySelector("#blurButton");
const blurButtonLabel = document.querySelector("#blurButtonLabel");
const computerClickButton = document.querySelector("#computerClickButton");
const detailControls = document.querySelector("#detailControls");
const detailTitle = document.querySelector("#detailTitle");
const detailTabs = document.querySelector("#detailTabs");
const demoControls = document.querySelector("#demoControls");
const demoButtons = document.querySelector("#demoButtons");
const quizControls = document.querySelector("#quizControls");
const quizQuestion = document.querySelector("#quizQuestion");
const quizAnswers = document.querySelector("#quizAnswers");
const quizFeedback = document.querySelector("#quizFeedback");
const roomGameInfo = document.querySelector("#roomGameInfo");
const roomGameCode = document.querySelector("#roomGameCode");
const roomGameAction = document.querySelector("#roomGameAction");
const copyGameLink = document.querySelector("#copyGameLink");
const closeGameButton = document.querySelector("#closeGameButton");
const roomGameControls = document.querySelector("#roomGameControls");

const slideNames = [
  "Inclusão digital para qualquer idade",
  "A tecnologia faz parte da nossa vida",
  "O que é inclusão digital?",
  "Por que aprender a usar a tecnologia?",
  "Como a internet pode me ajudar?",
  "Conhecendo melhor o seu celular",
  "O que são aplicativos?",
  "Alguns tipos de aplicativos",
  "Pesquisando informações na internet",
  "Ferramentas de aprendizagem",
  "Atenção aos golpes digitais · Deepfake",
  "Phishing · antes de clicar, confira",
  "Como identificar mensagens suspeitas?",
  "Protegendo suas senhas",
  "Cuidado com seus dados pessoais",
  "Usando o banco com segurança",
  "Muito obrigado",
  "O que aprendemos?",
  "Desafio final · cadastro seguro",
];

let token = sessionStorage.getItem("conexao-remote-token");
let currentState = null;
let currentGame = null;
let events = null;
let commandPending = false;
let pointerEnabled = false;
let pointerPosition = { x: 0.5, y: 0.5 };
let pointerTimer = 0;
let pendingPointer = null;
let pointerDrag = null;
let pointerInFlight = false;

slideNames.forEach((name, index) => {
  const option = document.createElement("option");
  option.value = String(index);
  option.textContent = `${String(index + 1).padStart(2, "0")} · ${name}`;
  slideSelect.append(option);
});

function showStatus(message, error = false) {
  remoteStatus.textContent = message;
  remoteStatus.classList.toggle("is-error", error);
}

function setConnected(connected) {
  connectionStatus.classList.toggle("connected", connected);
  connectionStatus.innerHTML = connected ? "<i></i> CONECTADO" : "<i></i> RECONECTANDO";
}

async function postCommand(payload) {
  if (!token || commandPending) return;
  commandPending = true;
  showStatus("");
  try {
    const response = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível enviar o comando.");
    if (navigator.vibrate) navigator.vibrate(12);
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    commandPending = false;
  }
}

function renderState(state) {
  currentState = state;
  if (state.pointer && Number.isFinite(state.pointer.x) && Number.isFinite(state.pointer.y)) {
    pointerPosition = { x: state.pointer.x, y: state.pointer.y };
    pointerEnabled = state.pointer.visible === true;
  }
  const slideNumber = state.slide + 1;
  slideCounter.textContent = `SLIDE ${String(slideNumber).padStart(2, "0")} / 19`;
  slideTitle.textContent = state.title || slideNames[state.slide];
  remoteProgress.style.width = `${(slideNumber / 19) * 100}%`;
  slideSelect.value = String(state.slide);
  notesButton.setAttribute("aria-pressed", String(state.notesVisible));
  phoneNotes.hidden = !state.notesVisible;
  noteText.textContent = state.note || "";
  blurButton.setAttribute("aria-pressed", String(state.blurred));
  blurButtonLabel.textContent = state.blurred ? "Mostrar telão" : "Desfocar telão";

  const canRevealAnswer = state.slide === 4 && !state.answerRevealed;
  const answerWasRevealed = state.slide === 4 && state.answerRevealed;
  revealAnswerButton.hidden = !canRevealAnswer && !answerWasRevealed;
  revealAnswerButton.disabled = answerWasRevealed;
  revealAnswerButton.classList.toggle("revealed", answerWasRevealed);
  revealAnswerLabel.textContent = answerWasRevealed ? "Resposta revelada no telão" : "Revelar resposta no telão";
  computerClickButton.disabled = !state.computerClickable;
  computerClickButton.title = state.computerClickable ? "" : "Disponível nas telas com o computador.";

  const detail = state.detail;
  detailControls.hidden = !detail;
  if (detail) {
    detailTitle.textContent = detail.title;
    detailTabs.innerHTML = (detail.tabs || []).map((tab, index) => `
      <button type="button" data-detail-tab="${index}" aria-pressed="${index === detail.tab}">${tab}</button>`).join("");
  }

  const demos = state.demos || [];
  demoControls.hidden = !demos.length;
  demoButtons.innerHTML = demos.map((demo, index) => `
    <button type="button" data-open-detail="${demo.id}"><span>ZOOM ${String(index + 1).padStart(2, "0")}</span>${demo.label}</button>`).join("");

  const quiz = state.quiz;
  quizControls.hidden = !quiz;
  if (quiz) {
    quizQuestion.textContent = quiz.prompt;
    quizAnswers.innerHTML = quiz.choices.map((choice, index) => `
      <button type="button" data-answer="${index}" aria-pressed="${quiz.selected === index}">${choice}</button>`).join("");
    quizFeedback.textContent = quiz.selected === null ? "" : "Resposta enviada para a apresentação.";
  }
  roomGameControls.hidden = state.slide !== slideNames.length - 1;
  renderPointerControls();
}

function renderPointerControls() {
  pointerToggle.setAttribute("aria-pressed", String(pointerEnabled));
  pointerToggle.textContent = pointerEnabled ? "Desativar cursor no telão" : "Ativar cursor no telão";
  pointerPad.hidden = !pointerEnabled;
  pointerClickButton.hidden = !pointerEnabled;
  pointerPadCursor.style.left = `${pointerPosition.x * 100}%`;
  pointerPadCursor.style.top = `${pointerPosition.y * 100}%`;
}

async function postPointer(payload) {
  if (!token) return;
  const response = await fetch("/api/pointer", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível mover o cursor.");
}

function queuePointer(action) {
  if (!pointerEnabled) return;
  pendingPointer = { action, ...pointerPosition };
  if (pointerInFlight) return;
  window.clearTimeout(pointerTimer);
  pointerTimer = window.setTimeout(flushPointer, 40);
}

async function flushPointer() {
  pointerTimer = 0;
  if (!pendingPointer || pointerInFlight) return;
  const payload = pendingPointer;
  pendingPointer = null;
  pointerInFlight = true;
  try {
    await postPointer(payload);
    if (remoteStatus.classList.contains("is-error")) showStatus("");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    pointerInFlight = false;
    if (pendingPointer) pointerTimer = window.setTimeout(flushPointer, 40);
  }
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function renderGameState(game) {
  currentGame = game;
  roomGameCode.hidden = !game.roomCode;
  roomGameCode.textContent = game.roomCode ? `PIN DA SALA · ${game.roomCode}` : "";
  copyGameLink.hidden = !game.roomCode || game.status !== "lobby";
  closeGameButton.hidden = game.status === "closed";
  roomGameAction.dataset.gameAction = game.status === "closed" || game.status === "final" ? "open" : "";
  roomGameAction.disabled = false;

  if (game.status === "closed") {
    roomGameInfo.textContent = "Abra uma sala para a turma participar pelo celular. O jogo usa apenas apelidos e funciona nesta rede local.";
    roomGameAction.textContent = "Abrir sala do desafio";
  } else if (game.status === "lobby") {
    roomGameInfo.textContent = `${game.players.length} de 60 participantes na sala. O QR code e o PIN aparecem no telão; inicie quando a turma estiver pronta.`;
    roomGameAction.dataset.gameAction = "start";
    roomGameAction.disabled = game.players.length === 0;
    roomGameAction.textContent = game.players.length ? "Iniciar desafio cronometrado" : "Aguardando participantes…";
  } else if (game.status === "question") {
    const answered = game.players.filter((player) => player.hasAnswered).length;
    roomGameInfo.textContent = `Pergunta ${game.questionIndex + 1} de ${game.questionCount} · ${answered} de ${game.players.length} responderam. O tempo termina automaticamente.`;
    roomGameAction.dataset.gameAction = "reveal";
    roomGameAction.textContent = "Encerrar pergunta agora";
  } else if (game.status === "review") {
    roomGameInfo.textContent = game.questionIndex === game.questionCount - 1
      ? "Última resposta revelada. Avance para mostrar o placar final e o vencedor."
      : `Resposta revelada · pergunta ${game.questionIndex + 1} de ${game.questionCount}.`;
    roomGameAction.dataset.gameAction = "next";
    roomGameAction.textContent = game.questionIndex === game.questionCount - 1 ? "Mostrar resultado final" : "Próxima pergunta";
  } else {
    const winner = game.players[0];
    roomGameInfo.textContent = winner
      ? `Partida concluída. ${winner.name} venceu com ${winner.score.toLocaleString("pt-BR")} pontos.`
      : "Partida concluída. Abra uma nova sala quando quiser jogar novamente.";
    roomGameAction.dataset.gameAction = "open";
    roomGameAction.textContent = "Abrir nova sala";
  }
}

async function postGameAction(action) {
  if (!token) return;
  roomGameAction.disabled = true;
  showStatus("");
  try {
    const response = await fetch("/api/game/host", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível comandar o jogo.");
    renderGameState(data.game);
  } catch (error) {
    showStatus(error.message, true);
    if (currentGame) renderGameState(currentGame);
  }
}

async function connectToPresentation() {
  if (!token) return;
  showStatus("");
  try {
    const response = await fetch(`/api/state?token=${encodeURIComponent(token)}`);
    if (!response.ok) throw new Error(`O servidor respondeu ${response.status}.`);
    const data = await response.json();
    renderState(data.state);
    const gameResponse = await fetch(`/api/game/state?token=${encodeURIComponent(token)}`);
    if (!gameResponse.ok) throw new Error(`O servidor respondeu ${gameResponse.status} ao consultar a sala.`);
    const gameData = await gameResponse.json();
    renderGameState(gameData.game);
    pairCard.hidden = true;
    controller.hidden = false;
    setConnected(true);
    if (events) events.close();
    events = new EventSource(`/api/events?role=remote&token=${encodeURIComponent(token)}`);
    events.onopen = () => setConnected(true);
    events.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "state") renderState(message.state);
      else if (message.type === "game-state") renderGameState(message.game);
    };
    events.onerror = () => setConnected(false);
  } catch (error) {
    sessionStorage.removeItem("conexao-remote-token");
    token = null;
    pairCard.hidden = false;
    controller.hidden = true;
    setConnected(false);
    showStatus(`Não foi possível conectar. Confirme se “Iniciar apresentação.bat” está aberto. (${error.message})`, true);
  }
}

pairForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  pairError.textContent = "";
  const code = pairCode.value.trim();
  try {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Código inválido.");
    token = data.token;
    sessionStorage.setItem("conexao-remote-token", token);
    history.replaceState(null, "", "/remote");
    await connectToPresentation();
  } catch (error) {
    pairError.textContent = error.message;
  }
});

const pinFromQr = new URLSearchParams(location.search).get("pin");
if (pinFromQr) pairCode.value = pinFromQr.slice(0, 6);
if (token) connectToPresentation();

document.querySelector("#prevButton").addEventListener("click", () => postCommand({ action: "previous" }));
document.querySelector("#nextButton").addEventListener("click", () => postCommand({ action: "next" }));
slideSelect.addEventListener("change", () => postCommand({ action: "goto", slide: Number(slideSelect.value) }));
notesButton.addEventListener("click", () => postCommand({ action: "toggle-notes" }));
revealAnswerButton.addEventListener("click", () => postCommand({ action: "reveal-answer" }));
blurButton.addEventListener("click", () => postCommand({ action: "toggle-blur" }));
computerClickButton.addEventListener("click", () => postCommand({ action: "computer-click" }));
document.querySelector("#closeDetail").addEventListener("click", () => postCommand({ action: "close-detail" }));
roomGameAction.addEventListener("click", () => postGameAction(roomGameAction.dataset.gameAction));
closeGameButton.addEventListener("click", () => postGameAction("close"));
copyGameLink.addEventListener("click", async () => {
  if (!currentGame?.roomCode) return;
  const url = `${currentGame.joinBaseUrl || location.origin}/play?room=${encodeURIComponent(currentGame.roomCode)}`;
  try {
    await navigator.clipboard.writeText(url);
    showStatus("Link da sala copiado.");
  } catch (error) {
    showStatus(`Não foi possível copiar o link da sala: ${error.message}`, true);
  }
});
document.querySelector("#disconnectButton").addEventListener("click", async () => {
  if (events) events.close();
  if (token) {
    try {
      await fetch("/api/unpair", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      showStatus(`O controle saiu do celular, mas o servidor não confirmou a desconexão: ${error.message}`, true);
    }
  }
  sessionStorage.removeItem("conexao-remote-token");
  token = null;
  currentState = null;
  pairCard.hidden = false;
  controller.hidden = true;
  pairCode.value = "";
  setConnected(false);
  showStatus("Controle desconectado.");
});

pointerToggle.addEventListener("click", async () => {
  const wasEnabled = pointerEnabled;
  pointerEnabled = !pointerEnabled;
  renderPointerControls();
  try {
    await postPointer(pointerEnabled
      ? { action: "move", ...pointerPosition }
      : { action: "hide" });
    showStatus(pointerEnabled ? "Cursor do telão ativado." : "Cursor do telão desativado.");
  } catch (error) {
    pointerEnabled = wasEnabled;
    renderPointerControls();
    showStatus(error.message, true);
  }
});

pointerPad.addEventListener("pointerdown", (event) => {
  if (!pointerEnabled) return;
  event.preventDefault();
  pointerDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  pointerPad.setPointerCapture(event.pointerId);
});

pointerPad.addEventListener("pointermove", (event) => {
  if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
  const deltaX = event.clientX - pointerDrag.x;
  const deltaY = event.clientY - pointerDrag.y;
  if (Math.hypot(deltaX, deltaY) > 3) pointerDrag.moved = true;
  if (!pointerDrag.moved) return;
  const bounds = pointerPad.getBoundingClientRect();
  pointerPosition = {
    x: clamp(pointerPosition.x + deltaX / bounds.width * 1.8),
    y: clamp(pointerPosition.y + deltaY / bounds.height * 1.8),
  };
  pointerDrag.x = event.clientX;
  pointerDrag.y = event.clientY;
  renderPointerControls();
  queuePointer("move");
});

pointerPad.addEventListener("pointerup", (event) => {
  if (!pointerDrag || pointerDrag.id !== event.pointerId) return;
  const shouldClick = !pointerDrag.moved;
  pointerDrag = null;
  if (shouldClick) queuePointer("click");
});

pointerPad.addEventListener("pointercancel", () => { pointerDrag = null; });
pointerClickButton.addEventListener("click", () => queuePointer("click"));

detailTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-detail-tab]");
  if (button) postCommand({ action: "detail-tab", tab: Number(button.dataset.detailTab) });
});
demoButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-detail]");
  if (button) postCommand({ action: "open-detail", id: button.dataset.openDetail });
});
quizAnswers.addEventListener("click", (event) => {
  const button = event.target.closest("[data-answer]");
  if (button) postCommand({ action: "answer", choice: Number(button.dataset.answer) });
});
