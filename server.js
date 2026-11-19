const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const PRESENTER_TOKEN = crypto.randomBytes(24).toString("hex");
const PAIR_CODE = String(crypto.randomInt(100000, 1000000));
const clients = { presenter: new Set(), remote: new Set() };
const pairedTokens = new Set();
const pairingFailures = new Map();
const pointerRequests = new Map();
let pointerOwner = null;
const playerTokens = new Set();
const gamePlayers = new Map();
const avatarOptions = {
  skin: new Set(["light", "medium", "tan", "dark"]),
  hair: new Set(["short", "long", "curly", "bun"]),
  hairColor: new Set(["brown", "black", "blonde", "blue", "pink"]),
  accessory: new Set(["none", "glasses", "crown", "headphones", "cap"]),
};
const defaultAvatar = { skin: "medium", hair: "short", hairColor: "brown", accessory: "none" };
const gameQuestions = [
  {
    prompt: "Um formulário pede CPF, foto do documento e nome da mãe para baixar um folheto gratuito. Qual é o melhor próximo passo?",
    choices: ["Preencher: todo cadastro pede esses dados", "Parar e confirmar se os dados são realmente necessários", "Inventar um CPF e enviar a foto"],
    answer: 1,
    explanation: "Peça apenas os dados necessários. Um pedido excessivo é motivo para pausar e confirmar quem está coletando as informações.",
  },
  {
    prompt: "Você encontra um cadastro por um anúncio e o endereço tem uma letra diferente do site que conhece. O que fazer?",
    choices: ["Conferir pelo aplicativo ou endereço oficial que você já conhece", "Continuar se houver um cadeado no navegador", "Entrar com a mesma senha usada no banco"],
    answer: 0,
    explanation: "Um cadeado indica uma conexão criptografada, não que o site seja legítimo. Confira o endereço por um canal confiável.",
  },
  {
    prompt: "Ao preencher um endereço, você percebe que digitou um número errado. Antes de continuar:",
    choices: ["Enviar mesmo assim para não perder o formulário", "Revisar o campo e corrigir usando informação confirmada", "Usar o endereço de outra pessoa"],
    answer: 1,
    explanation: "Confira cada campo antes de avançar. Dados incorretos podem impedir contato ou causar problemas no cadastro.",
  },
  {
    prompt: "Um formulário pede um código que chegou por SMS para “confirmar sua identidade”. Qual cuidado é essencial?",
    choices: ["Compartilhar o código com quem estiver ajudando por mensagem", "Digitar o código apenas no serviço oficial que você abriu", "Enviar uma captura da tela para o suporte"],
    answer: 1,
    explanation: "Códigos de uso único são secretos. Não os envie a outra pessoa nem compartilhe por telefone ou mensagem.",
  },
  {
    prompt: "O site diz que o cadastro é gratuito, mas uma tela inesperada pede dados do cartão para liberar uma conta básica. Você deve:",
    choices: ["Parar e verificar a oferta e o endereço por um canal oficial", "Preencher: o cadeado garante que é seguro", "Tentar com o cartão de um familiar"],
    answer: 0,
    explanation: "Uma conexão segura não prova que a cobrança é legítima. Confirme se o serviço e a cobrança correspondem ao que você pretendia.",
  },
  {
    prompt: "Você usou um computador compartilhado para preencher um cadastro. O que fazer ao terminar?",
    choices: ["Salvar a senha no navegador para a próxima pessoa", "Sair da conta e não salvar senha nem documentos", "Deixar o formulário aberto para voltar depois"],
    answer: 1,
    explanation: "Em aparelhos compartilhados, encerre a sessão e evite salvar senhas ou deixar documentos e páginas abertas.",
  },
  {
    prompt: "Um formulário de inscrição em um curso pede uma senha. Qual opção reduz o risco se o site tiver um problema?",
    choices: ["Repetir a senha do e-mail para não esquecer", "Criar uma senha longa e exclusiva para esse serviço", "Usar nome e data de nascimento"],
    answer: 1,
    explanation: "Uma senha única impede que a exposição de uma conta abra automaticamente as outras.",
  },
  {
    prompt: "Antes de tocar em “Enviar cadastro”, qual revisão é mais segura?",
    choices: ["Conferir endereço do site, dados digitados e finalidade dos campos", "Verificar apenas se todos os campos estão preenchidos", "Enviar rápido e corrigir depois por um link recebido"],
    answer: 0,
    explanation: "Confira se está no serviço certo, se os dados estão corretos e se os campos pedidos fazem sentido antes de enviar.",
  },
];
let game = { roomCode: null, status: "closed", questionIndex: -1, questionEndsAt: null, players: new Map(), timeout: null };
let commandSequence = 0;
let state = {
  slide: 0,
  section: "BOAS-VINDAS",
  title: "Inclusão digital para qualquer idade",
  blurred: false,
  answerRevealed: false,
  computerClickable: false,
  notesVisible: false,
  note: "",
  quizChoice: null,
  quiz: null,
  demos: [],
  detail: null,
  pointer: { visible: false, x: 0.5, y: 0.5, clicked: false },
  updatedAt: Date.now(),
};

const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/remote", ["remote.html", "text/html; charset=utf-8"]],
  ["/remote.html", ["remote.html", "text/html; charset=utf-8"]],
  ["/remote.js", ["remote.js", "text/javascript; charset=utf-8"]],
  ["/qr.js", ["qr.js", "text/javascript; charset=utf-8"]],
  ["/remote.css", ["remote.css", "text/css; charset=utf-8"]],
  ["/play", ["play.html", "text/html; charset=utf-8"]],
  ["/play.html", ["play.html", "text/html; charset=utf-8"]],
  ["/play.js", ["play.js", "text/javascript; charset=utf-8"]],
  ["/play.css", ["play.css", "text/css; charset=utf-8"]],
  ["/avatar.js", ["avatar.js", "text/javascript; charset=utf-8"]],
  ["/game-audio.js", ["game-audio.js", "text/javascript; charset=utf-8"]],
]);

function jsonResponse(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error("Request body exceeds limit"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Request body is not valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function bearerToken(request) {
  const authorization = request.headers.authorization || "";
  const match = /^Bearer ([a-f0-9]{48})$/.exec(authorization);
  return match?.[1] || "";
}

function isPresenter(request, urlToken = "") {
  const token = bearerToken(request) || urlToken;
  const expected = Buffer.from(PRESENTER_TOKEN);
  const received = Buffer.from(token);
  return token.length === PRESENTER_TOKEN.length && crypto.timingSafeEqual(received, expected);
}

function isPaired(request, urlToken = "") {
  const token = bearerToken(request) || urlToken;
  if (!token || !pairedTokens.has(token)) return false;
  const received = Buffer.from(token);
  for (const pairedToken of pairedTokens) {
    const expected = Buffer.from(pairedToken);
    if (expected.length === received.length && crypto.timingSafeEqual(expected, received)) return true;
  }
  return false;
}

function networkAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)].sort((left, right) => {
    const rank = (address) => {
      if (address.startsWith("192.168.")) return 0;
      if (address.startsWith("10.")) return 1;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
      return 3;
    };
    return rank(left) - rank(right);
  });
}

function broadcast(payload, audience = ["presenter", "remote"]) {
  const message = `data: ${JSON.stringify(payload)}\n\n`;
  for (const role of audience) {
    for (const response of clients[role]) {
      try {
        response.write(message);
      } catch (error) {
        clients[role].delete(response);
      }
    }
  }
}

function updateState(patch) {
  state = { ...state, ...patch, updatedAt: Date.now() };
  broadcast({ type: "state", state });
}

function gameSnapshot() {
  const question = gameQuestions[game.questionIndex];
  const revealed = game.status === "review" || game.status === "final";
  const address = networkAddresses()[0];
  return {
    roomCode: game.roomCode,
    joinBaseUrl: address ? `http://${address}:${PORT}` : `http://localhost:${PORT}`,
    status: game.status,
    questionIndex: game.questionIndex,
    questionCount: gameQuestions.length,
    questionEndsAt: game.questionEndsAt,
    question: question ? {
      prompt: question.prompt,
      choices: question.choices,
      answer: revealed ? question.answer : null,
      explanation: revealed ? question.explanation : null,
    } : null,
    players: [...game.players.values()]
      .map(({ name, score, lastChoice, lastCorrect, avatar }) => ({
        name,
        score,
        avatar,
        hasAnswered: lastChoice !== null,
        lastCorrect: revealed ? lastCorrect : null,
      }))
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "pt-BR")),
  };
}

function broadcastGame() {
  const message = `data: ${JSON.stringify({ type: "game-state", game: gameSnapshot() })}\n\n`;
  for (const role of ["presenter", "remote"]) {
    for (const response of clients[role]) {
      try {
        response.write(message);
      } catch (error) {
        clients[role].delete(response);
      }
    }
  }
  for (const [token, response] of gamePlayers) {
    try {
      response.write(message);
    } catch (error) {
      gamePlayers.delete(token);
    }
  }
}

function revealGameQuestion() {
  if (game.status !== "question") return;
  clearTimeout(game.timeout);
  game.status = "review";
  game.questionEndsAt = null;
  const answer = gameQuestions[game.questionIndex].answer;
  for (const player of game.players.values()) {
    player.lastCorrect = player.lastChoice === answer;
  }
  broadcastGame();
}

function startGameQuestion() {
  game.status = "question";
  game.questionEndsAt = Date.now() + 20000;
  game.timeout = setTimeout(revealGameQuestion, 20000);
  broadcastGame();
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return jsonResponse(response, 200, { ok: true });
  }

  if (request.method === "GET" && url.pathname === "/api/info") {
    if (!isPresenter(request)) {
      return jsonResponse(response, 401, { error: "Presenter authentication required" });
    }
    const addresses = networkAddresses();
    return jsonResponse(response, 200, {
      pairingCode: PAIR_CODE,
      localUrl: `http://localhost:${PORT}`,
      networkUrls: addresses.map((address) => `http://${address}:${PORT}`),
      pairedControllers: pairedTokens.size,
    });
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    if (!isPaired(request, url.searchParams.get("token") || "")) {
      return jsonResponse(response, 401, { error: "Pair this controller before reading presentation state" });
    }
    return jsonResponse(response, 200, { state });
  }

  if (request.method === "GET" && url.pathname === "/api/game/state") {
    const token = url.searchParams.get("token") || "";
    if (!isPresenter(request, token) && !isPaired(request, token)) {
      return jsonResponse(response, 401, { error: "Conecte o controle antes de consultar o jogo." });
    }
    return jsonResponse(response, 200, { game: gameSnapshot() });
  }

  if (request.method === "GET" && url.pathname === "/api/game/player-state") {
    const token = url.searchParams.get("token") || "";
    const player = game.players.get(token);
    if (!playerTokens.has(token) || !player) {
      return jsonResponse(response, 401, { error: "Entre na sala para consultar seu progresso." });
    }
    return jsonResponse(response, 200, {
      game: gameSnapshot(),
      player: {
        name: player.name,
        score: player.score,
        avatar: player.avatar,
        lastChoice: player.lastChoice,
        lastCorrect: game.status === "review" || game.status === "final" ? player.lastCorrect : null,
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/game/events") {
    const token = url.searchParams.get("token") || "";
    if (!playerTokens.has(token) || !game.players.has(token)) {
      return jsonResponse(response, 401, { error: "Entre na sala para acompanhar o jogo." });
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`data: ${JSON.stringify({ type: "game-state", game: gameSnapshot() })}\n\n`);
    gamePlayers.set(token, response);
    response.on("close", () => {
      if (gamePlayers.get(token) === response) gamePlayers.delete(token);
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    const role = url.searchParams.get("role");
    if (role !== "presenter" && role !== "remote") {
      return jsonResponse(response, 400, { error: "Unknown event stream role" });
    }
    const streamToken = url.searchParams.get("token") || "";
    if (role === "presenter" && !isPresenter(request, streamToken)) {
      return jsonResponse(response, 401, { error: "Presenter authentication required" });
    }
    if (role === "remote" && !isPaired(request, streamToken)) {
      return jsonResponse(response, 401, { error: "Pair this controller before connecting" });
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(`data: ${JSON.stringify({ type: "state", state })}\n\n`);
    response.write(`data: ${JSON.stringify({ type: "pointer", pointer: state.pointer })}\n\n`);
    response.write(`data: ${JSON.stringify({ type: "game-state", game: gameSnapshot() })}\n\n`);
    clients[role].add(response);
    request.on("close", () => clients[role].delete(response));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/pair") {
    const address = request.socket.remoteAddress || "unknown";
    const failure = pairingFailures.get(address);
    if (failure && failure.until > Date.now()) {
      return jsonResponse(response, 429, { error: "Muitas tentativas. Aguarde um minuto e tente novamente." });
    }
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return jsonResponse(response, 400, { error: error.message });
    }
    const suppliedCode = typeof body.code === "string" ? body.code : "";
    const suppliedBuffer = Buffer.from(suppliedCode.padEnd(PAIR_CODE.length, " ").slice(0, PAIR_CODE.length));
    const expectedBuffer = Buffer.from(PAIR_CODE);
    const matches = suppliedCode.length === PAIR_CODE.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
    if (!matches) {
      const attempts = (failure?.attempts || 0) + 1;
      pairingFailures.set(address, { attempts, until: attempts >= 5 ? Date.now() + 60000 : 0 });
      return jsonResponse(response, 401, { error: "Código incorreto. Confira o número exibido na apresentação." });
    }
    pairingFailures.delete(address);
    const token = crypto.randomBytes(24).toString("hex");
    pairedTokens.add(token);
    return jsonResponse(response, 200, { token, state });
  }

  if (request.method === "POST" && url.pathname === "/api/game/join") {
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return jsonResponse(response, 400, { error: error.message });
    }
    const roomCode = typeof body.roomCode === "string" ? body.roomCode : "";
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 20) : "";
    const suppliedAvatar = body.avatar;
    let avatar = { ...defaultAvatar };
    if (roomCode !== game.roomCode || game.status !== "lobby") {
      return jsonResponse(response, 409, { error: "Sala não encontrada ou jogo já iniciado. Confira o código com quem apresenta." });
    }
    if (name.length < 2) {
      return jsonResponse(response, 400, { error: "Escolha um apelido com pelo menos 2 caracteres." });
    }
    if (suppliedAvatar !== undefined) {
      if (!suppliedAvatar || typeof suppliedAvatar !== "object" || Array.isArray(suppliedAvatar)) {
        return jsonResponse(response, 400, { error: "As opções do avatar são inválidas." });
      }
      for (const [field, allowed] of Object.entries(avatarOptions)) {
        if (typeof suppliedAvatar[field] !== "string" || !allowed.has(suppliedAvatar[field])) {
          return jsonResponse(response, 400, { error: "Escolha uma opção válida para cada parte do avatar." });
        }
      }
      avatar = Object.fromEntries(Object.keys(avatarOptions).map((field) => [field, suppliedAvatar[field]]));
    }
    if (game.players.size >= 60) {
      return jsonResponse(response, 409, { error: "Esta sala já atingiu o limite de 60 participantes." });
    }
    if ([...game.players.values()].some((player) => player.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
      return jsonResponse(response, 409, { error: "Esse apelido já está na sala. Escolha outro." });
    }
    const token = crypto.randomBytes(24).toString("hex");
    playerTokens.add(token);
    game.players.set(token, { name, avatar, score: 0, lastChoice: null, lastCorrect: null });
    broadcastGame();
    return jsonResponse(response, 200, { token, game: gameSnapshot() });
  }

  if (request.method === "POST" && url.pathname === "/api/game/answer") {
    const token = bearerToken(request);
    const player = game.players.get(token);
    if (!player) return jsonResponse(response, 401, { error: "Entre na sala antes de responder." });
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return jsonResponse(response, 400, { error: error.message });
    }
    if (!Number.isInteger(body.choice) || body.choice < 0 || body.choice > 2) {
      return jsonResponse(response, 400, { error: "Escolha uma resposta válida." });
    }
    if (game.status === "question" && game.questionEndsAt <= Date.now()) revealGameQuestion();
    if (game.status !== "question") {
      return jsonResponse(response, 409, { error: "O tempo acabou ou a pergunta já foi encerrada." });
    }
    if (player.lastChoice !== null) {
      return jsonResponse(response, 409, { error: "Você já respondeu a esta pergunta." });
    }
    const question = gameQuestions[game.questionIndex];
    player.lastChoice = body.choice;
    player.lastCorrect = body.choice === question.answer;
    if (player.lastCorrect) {
      const timeLeft = Math.max(0, game.questionEndsAt - Date.now());
      player.score += 1000 + Math.round(500 * timeLeft / 20000);
    }
    broadcastGame();
    return jsonResponse(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/game/host") {
    if (!isPresenter(request) && !isPaired(request)) {
      return jsonResponse(response, 401, { error: "Somente a apresentação ou o controle emparelhado pode comandar o jogo." });
    }
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return jsonResponse(response, 400, { error: error.message });
    }
    if (body.action === "open") {
      clearTimeout(game.timeout);
      game = { roomCode: null, status: "closed", questionIndex: -1, questionEndsAt: null, players: new Map(), timeout: null };
      broadcastGame();
      gamePlayers.clear();
      playerTokens.clear();
      game = {
        roomCode: String(crypto.randomInt(10000, 100000)),
        status: "lobby",
        questionIndex: -1,
        questionEndsAt: null,
        players: new Map(),
        timeout: null,
      };
      gamePlayers.clear();
      playerTokens.clear();
      broadcastGame();
      return jsonResponse(response, 200, { game: gameSnapshot() });
    }
    if (body.action === "start" && game.status === "lobby") {
      if (!game.players.size) return jsonResponse(response, 409, { error: "Espere pelo menos uma pessoa entrar na sala." });
      game.questionIndex = 0;
      startGameQuestion();
      return jsonResponse(response, 200, { game: gameSnapshot() });
    }
    if (body.action === "reveal" && game.status === "question") {
      revealGameQuestion();
      return jsonResponse(response, 200, { game: gameSnapshot() });
    }
    if (body.action === "next" && game.status === "review") {
      if (game.questionIndex === gameQuestions.length - 1) {
        game.status = "final";
        broadcastGame();
        return jsonResponse(response, 200, { game: gameSnapshot() });
      }
      game.questionIndex += 1;
      for (const player of game.players.values()) {
        player.lastChoice = null;
        player.lastCorrect = null;
      }
      startGameQuestion();
      return jsonResponse(response, 200, { game: gameSnapshot() });
    }
    if (body.action === "close" && game.status !== "closed") {
      clearTimeout(game.timeout);
      game = { roomCode: null, status: "closed", questionIndex: -1, questionEndsAt: null, players: new Map(), timeout: null };
      broadcastGame();
      gamePlayers.clear();
      playerTokens.clear();
      return jsonResponse(response, 200, { game: gameSnapshot() });
    }
    return jsonResponse(response, 409, { error: "Este comando não está disponível nesta etapa do jogo." });
  }

  if (request.method === "POST" && url.pathname === "/api/unpair") {
    const token = bearerToken(request);
    if (!isPaired(request)) {
      return jsonResponse(response, 401, { error: "This controller is not paired" });
    }
    pairedTokens.delete(token);
    pointerRequests.delete(token);
    if (pointerOwner === token) {
      pointerOwner = null;
      state = { ...state, pointer: { ...state.pointer, visible: false, clicked: false }, updatedAt: Date.now() };
      broadcast({ type: "pointer", pointer: state.pointer }, ["presenter"]);
    }
    return jsonResponse(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/presenter-state") {
    if (!isPresenter(request)) {
      return jsonResponse(response, 401, { error: "Presenter authentication required" });
    }
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return jsonResponse(response, 400, { error: error.message });
    }
    if (!Number.isInteger(body.slide) || body.slide < 0 || body.slide > 18) {
      return jsonResponse(response, 400, { error: "Invalid slide number" });
    }
    updateState({
      slide: body.slide,
      section: typeof body.section === "string" ? body.section.slice(0, 100) : state.section,
      title: typeof body.title === "string" ? body.title.slice(0, 180) : state.title,
      blurred: body.blurred === true,
      answerRevealed: body.answerRevealed === true && body.slide === 4,
      computerClickable: body.computerClickable === true,
      notesVisible: body.notesVisible === true,
      note: typeof body.note === "string" ? body.note.slice(0, 600) : "",
      quizChoice: Number.isInteger(body.quizChoice) && body.quizChoice >= 0 && body.quizChoice <= 2 ? body.quizChoice : null,
      quiz: body.quiz && typeof body.quiz.prompt === "string" && Array.isArray(body.quiz.choices)
        ? {
          prompt: body.quiz.prompt.slice(0, 280),
          choices: body.quiz.choices.slice(0, 3).map((choice) => String(choice).slice(0, 120)),
          selected: Number.isInteger(body.quiz.selected) ? body.quiz.selected : null,
        }
        : null,
      demos: Array.isArray(body.demos)
        ? body.demos.slice(0, 10).flatMap((demo) => (
          demo && typeof demo.id === "string" && /^[a-z0-9-]{1,60}$/.test(demo.id) && typeof demo.label === "string"
            ? [{ id: demo.id, label: demo.label.slice(0, 60) }]
            : []
        ))
        : [],
      detail: body.detail && typeof body.detail.id === "string"
        ? {
          id: body.detail.id.slice(0, 80),
          title: String(body.detail.title || "").slice(0, 120),
          tabs: Array.isArray(body.detail.tabs) ? body.detail.tabs.slice(0, 10).map((tab) => String(tab).slice(0, 80)) : [],
          tab: Number.isInteger(body.detail.tab) && body.detail.tab >= 0 && body.detail.tab <= 9 ? body.detail.tab : 0,
        }
        : null,
    });
    return jsonResponse(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/command") {
    if (!isPaired(request)) {
      return jsonResponse(response, 401, { error: "Emparelhe este celular antes de enviar comandos." });
    }
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return jsonResponse(response, 400, { error: error.message });
    }
    const allowedActions = new Set(["next", "previous", "goto", "toggle-notes", "open-detail", "close-detail", "detail-tab", "answer", "toggle-overview", "toggle-blur", "computer-click", "reveal-answer"]);
    if (!allowedActions.has(body.action)) {
      return jsonResponse(response, 400, { error: "Unknown presentation command" });
    }
    if (body.action === "goto" && (!Number.isInteger(body.slide) || body.slide < 0 || body.slide > 18)) {
      return jsonResponse(response, 400, { error: "Invalid slide number" });
    }
    if (body.action === "answer" && (!Number.isInteger(body.choice) || body.choice < 0 || body.choice > 2)) {
      return jsonResponse(response, 400, { error: "Invalid answer choice" });
    }
    if (body.action === "detail-tab" && (!Number.isInteger(body.tab) || body.tab < 0 || body.tab > 9)) {
      return jsonResponse(response, 400, { error: "Invalid detail tab" });
    }
    if (body.action === "reveal-answer" && state.slide !== 4) {
      return jsonResponse(response, 409, { error: "A resposta só pode ser revelada no slide sobre a internet." });
    }
    if (body.action === "computer-click" && !state.computerClickable) {
      return jsonResponse(response, 409, { error: "O computador não está visível neste slide." });
    }
    if (body.action === "open-detail" && (typeof body.id !== "string" || !/^[a-z0-9-]{1,60}$/.test(body.id))) {
      return jsonResponse(response, 400, { error: "Invalid interactive item" });
    }
    broadcast({ type: "command", id: ++commandSequence, action: body.action, slide: body.slide, choice: body.choice, tab: body.tab, itemId: body.id }, ["presenter"]);
    return jsonResponse(response, 200, { ok: true, sequence: commandSequence });
  }

  if (request.method === "POST" && url.pathname === "/api/pointer") {
    const token = bearerToken(request);
    if (!isPaired(request)) {
      return jsonResponse(response, 401, { error: "Emparelhe este celular antes de mover o cursor." });
    }
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      return jsonResponse(response, 400, { error: error.message });
    }
    if (!["move", "click", "hide"].includes(body.action)) {
      return jsonResponse(response, 400, { error: "Ação de cursor inválida." });
    }
    if (body.action !== "hide" && (
      typeof body.x !== "number" || !Number.isFinite(body.x) || body.x < 0 || body.x > 1
      || typeof body.y !== "number" || !Number.isFinite(body.y) || body.y < 0 || body.y > 1
    )) {
      return jsonResponse(response, 400, { error: "Posição do cursor inválida." });
    }
    const now = Date.now();
    if (now - (pointerRequests.get(token) || 0) < 30) {
      return jsonResponse(response, 429, { error: "Movimento do cursor muito rápido. Tente novamente." });
    }
    pointerRequests.set(token, now);
    const pointer = body.action === "hide"
      ? { ...state.pointer, visible: false, clicked: false }
      : { visible: true, x: body.x, y: body.y, clicked: body.action === "click" };
    pointerOwner = body.action === "hide" ? null : token;
    state = { ...state, pointer, updatedAt: now };
    broadcast({ type: "pointer", pointer }, ["presenter"]);
    return jsonResponse(response, 200, { ok: true });
  }

  return jsonResponse(response, 404, { error: "Not found" });
}

function serveStatic(request, response, url) {
  const entry = publicFiles.get(url.pathname);
  if (!entry || !["GET", "HEAD"].includes(request.method)) {
    return jsonResponse(response, 404, { error: "Not found" });
  }
  const filePath = path.join(ROOT, entry[0]);
  fs.readFile(filePath, "utf8", (error, content) => {
    if (error) {
      console.error(`Não foi possível ler ${entry[0]}:`, error.message);
      return jsonResponse(response, 500, { error: "Could not read presentation file" });
    }
    if (entry[0] === "index.html") {
      const networkUrl = networkAddresses()[0];
      const config = JSON.stringify({
        presenterToken: PRESENTER_TOKEN,
        networkUrl: networkUrl ? `http://${networkUrl}:${PORT}` : `http://localhost:${PORT}`,
      });
      content = content.replace("</head>", `<script>window.PRESENTATION_CONFIG=${config};</script></head>`);
    }
    response.writeHead(200, {
      "Content-Type": entry[1],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(request, response, url);
    } catch (error) {
      console.error("Erro ao processar uma solicitação:", error.message);
      if (!response.headersSent) jsonResponse(response, 500, { error: "Unexpected server error" });
      else response.end();
    }
    return;
  }
  serveStatic(request, response, url);
});

server.on("error", (error) => {
  console.error(`Não foi possível iniciar o servidor na porta ${PORT}: ${error.message}`);
  process.exitCode = 1;
});

server.listen(PORT, "0.0.0.0", () => {
  const addresses = networkAddresses();
  console.log("");
  console.log("  APRESENTAÇÃO CONEXÃO");
  console.log("  ------------------------------------------");
  console.log(`  Projetor:    http://localhost:${PORT}`);
  if (addresses.length) {
    for (const address of addresses) console.log(`  Celular:     http://${address}:${PORT}/remote`);
  } else {
    console.log("  Celular:     conecte computador e celular na mesma rede Wi-Fi");
  }
  console.log(`  Código PIN:  ${PAIR_CODE}`);
  console.log("");
  console.log("  Deixe esta janela aberta durante a apresentação.");
  console.log("  Pressione Ctrl+C para encerrar.");
  console.log("");
});
