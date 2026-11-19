(() => {
  const config = window.PRESENTATION_CONFIG || {};
  const presenterToken = config.presenterToken || "";
  const networkUrl = config.networkUrl || window.location.origin;

  const els = {
    gameContent: document.getElementById("gameContent"),
    connectToggle: document.getElementById("connectToggle"),
    connectDialog: document.getElementById("connectDialog"),
    qrCode: document.getElementById("qrCode"),
    connectUrl: document.getElementById("connectUrl"),
    connectPin: document.getElementById("connectPin"),
    copyUrl: document.getElementById("copyUrl"),
    fullscreenToggle: document.getElementById("fullscreenToggle"),
    audioToggle: document.getElementById("audioToggle"),
  };

  let gameState = { status: "closed", players: [] };
  let timerInterval = null;
  let lastBeepSecond = null;

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderAvatar(avatar, size = 44) {
    if (window.AvatarRenderer && typeof window.AvatarRenderer.render === "function") {
      return window.AvatarRenderer.render(avatar, size);
    }
    return `<span class="avatar-fallback">👤</span>`;
  }

  async function hostAction(action) {
    try {
      const res = await fetch("/api/game/host", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${presenterToken}`,
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Não foi possível executar o comando.");
    } catch {
      alert("Erro de conexão com o servidor local.");
    }
  }

  function renderQrInto(container, text, size = 210) {
    if (!container) return;
    container.innerHTML = "";
    if (window.QRCode) {
      new window.QRCode(container, { text, width: size, height: size });
    } else if (typeof window.generateQrSvg === "function") {
      container.innerHTML = window.generateQrSvg(text);
    } else {
      container.innerHTML = `<div class="qr-placeholder">${escapeHtml(text)}</div>`;
    }
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    lastBeepSecond = null;
  }

  function startTimer(endsAt) {
    stopTimer();
    const update = () => {
      const timerEl = document.getElementById("hostTimer");
      if (!timerEl || !endsAt) return;
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      timerEl.textContent = `${left}s`;
      if (left <= 5 && left > 0 && lastBeepSecond !== left) {
        lastBeepSecond = left;
        window.GameAudio?.playTick?.();
      }
    };
    update();
    timerInterval = setInterval(update, 200);
  }

  function renderGame() {
    const g = gameState;
    if (g.status !== "question") stopTimer();

    if (!g || g.status === "closed") {
      els.gameContent.innerHTML = `
        <div class="game-closed-screen" style="text-align:center; padding: 3rem 1.5rem;">
          <p class="eyebrow">QUIZ INTERATIVO AO VIVO</p>
          <h1 style="font-size: clamp(2rem, 4vw, 3.4rem); margin: 0.5rem 0 1rem;">Desafio Relâmpago</h1>
          <p style="max-width: 540px; margin: 0 auto 2rem; opacity: 0.85;">
            Abra a sala para gerar o QR Code e o PIN de acesso para os participantes entrarem pelo celular.
          </p>
          <button type="button" class="room-game-button" data-host="open" style="font-size: 1.1rem; padding: 1rem 2rem; cursor: pointer;">
            Abrir Sala do Jogo →
          </button>
        </div>
      `;
      return;
    }

    if (g.status === "lobby") {
      const joinUrl = `${g.joinBaseUrl || networkUrl}/play?room=${encodeURIComponent(g.roomCode)}`;
      els.gameContent.innerHTML = `
        <div class="game-lobby" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem; align-items:center; padding: 1.5rem;">
          <div style="text-align:center; background: rgba(255,255,255,0.04); padding: 1.5rem; border-radius: 20px;">
            <p class="eyebrow">ESCANEIE PARA ENTRAR</p>
            <div id="lobbyQr" style="display:inline-block; background:#fff; padding:12px; border-radius:14px; margin: 1rem 0;"></div>
            <div style="font-family:'DM Mono', monospace; font-size: 0.9rem; opacity:0.85;">${escapeHtml(`${g.joinBaseUrl || networkUrl}/play`)}</div>
            <div style="margin-top: 1rem;">
              <span style="font-size:0.75rem; letter-spacing:0.12em; opacity:0.7;">CÓDIGO DA SALA</span>
              <div style="font-family:'DM Mono', monospace; font-size: 2.6rem; font-weight: 800; letter-spacing: 0.15em;">${escapeHtml(g.roomCode)}</div>
            </div>
          </div>
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
              <h2>Participantes (${g.players.length})</h2>
              <div style="display:flex; gap:0.75rem;">
                <button type="button" class="icon-button" data-host="close">Encerrar</button>
                <button type="button" class="room-game-button" data-host="start" ${g.players.length === 0 ? "disabled" : ""}>
                  Iniciar Jogo →
                </button>
              </div>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:0.75rem; max-height: 320px; overflow-y:auto;">
              ${
                g.players.length === 0
                  ? `<p style="opacity:0.7;">Aguardando jogadores entrarem pelo celular...</p>`
                  : g.players
                      .map(
                        (p) => `
                    <div style="display:flex; align-items:center; gap:0.6rem; background:rgba(255,255,255,0.07); padding:0.5rem 0.9rem; border-radius:999px;">
                      ${renderAvatar(p.avatar, 32)}
                      <strong>${escapeHtml(p.name)}</strong>
                    </div>`
                      )
                      .join("")
              }
            </div>
          </div>
        </div>
      `;
      renderQrInto(document.getElementById("lobbyQr"), joinUrl, 200);
      return;
    }

    if (g.status === "question" || g.status === "review") {
      const q = g.question || { prompt: "", choices: [] };
      const answeredCount = g.players.filter((p) => p.hasAnswered).length;
      const isReview = g.status === "review";

      els.gameContent.innerHTML = `
        <div class="game-round" style="padding: 1.5rem;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <span class="eyebrow">PERGUNTA ${g.questionIndex + 1} DE ${g.questionCount}</span>
            <div style="display:flex; gap:1rem; align-items:center;">
              <span>Respostas: <strong>${answeredCount}/${g.players.length}</strong></span>
              ${
                isReview
                  ? `<button type="button" class="room-game-button" data-host="next">${
                      g.questionIndex === g.questionCount - 1 ? "Ver Pódio Final →" : "Próxima Pergunta →"
                    }</button>`
                  : `<strong id="hostTimer" style="font-family:'DM Mono', monospace; font-size:1.5rem;">20s</strong>
                     <button type="button" class="icon-button" data-host="reveal">Revelar Agora</button>`
              }
            </div>
          </div>
          <h2 style="font-size: clamp(1.35rem, 2.5vw, 2rem); margin-bottom: 1.5rem;">${escapeHtml(q.prompt)}</h2>
          <div style="display:grid; gap:0.9rem;">
            ${q.choices
              .map((choice, idx) => {
                const isCorrect = isReview && q.answer === idx;
                const isWrong = isReview && q.answer !== idx;
                const border = isCorrect ? "2px solid #22c55e" : "1px solid rgba(255,255,255,0.12)";
                const bg = isCorrect ? "rgba(34,197,94,0.18)" : "rgba(255,255,255,0.05)";
                return `
                  <div style="padding:1rem 1.25rem; border-radius:14px; border:${border}; background:${bg}; opacity:${isWrong ? 0.55 : 1}; display:flex; justify-content:space-between; align-items:center;">
                    <span><strong>${["A", "B", "C", "D"][idx]}.</strong> ${escapeHtml(choice)}</span>
                    ${isCorrect ? `<span style="color:#4ade80; font-weight:700;">✓ CORRETA</span>` : ""}
                  </div>`;
              })
              .join("")}
          </div>
          ${
            isReview && q.explanation
              ? `<div style="margin-top:1.25rem; padding:1rem 1.25rem; border-radius:12px; background:rgba(56,189,248,0.12); border-left:4px solid #38bdf8;">
                  <strong>Explicação:</strong> ${escapeHtml(q.explanation)}
                </div>`
              : ""
          }
        </div>
      `;
      if (!isReview && g.questionEndsAt) startTimer(g.questionEndsAt);
      return;
    }

    if (g.status === "final") {
      els.gameContent.innerHTML = `
        <div class="game-final" style="padding: 1.5rem; text-align:center;">
          <p class="eyebrow">FIM DE JOGO</p>
          <h2 style="font-size: 2.2rem; margin-bottom: 1.5rem;">Ranking Final</h2>
          <div style="max-width: 640px; margin: 0 auto 2rem; display:grid; gap:0.75rem; text-align:left;">
            ${g.players
              .map(
                (p, index) => `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:0.85rem 1.2rem; border-radius:14px; background:${
                index === 0 ? "rgba(250,204,21,0.16)" : "rgba(255,255,255,0.06)"
              };">
                <div style="display:flex; align-items:center; gap:0.85rem;">
                  <strong style="font-family:'DM Mono', monospace; width:2rem;">#${index + 1}</strong>
                  ${renderAvatar(p.avatar, 38)}
                  <span>${escapeHtml(p.name)}</span>
                </div>
                <strong style="font-family:'DM Mono', monospace;">${p.score} pts</strong>
              </div>`
              )
              .join("")}
          </div>
          <div style="display:flex; justify-content:center; gap:1rem;">
            <button type="button" class="room-game-button" data-host="open">Jogar Novamente</button>
            <button type="button" class="icon-button" data-host="close">Fechar Sala</button>
          </div>
        </div>
      `;
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-host]");
    if (btn) hostAction(btn.getAttribute("data-host"));
  });

  els.connectToggle?.addEventListener("click", async () => {
    els.connectDialog?.showModal();
    try {
      const res = await fetch("/api/info", {
        headers: { Authorization: `Bearer ${presenterToken}` },
      });
      const info = await res.json();
      const base = (info.networkUrls && info.networkUrls[0]) || info.localUrl || networkUrl;
      const remoteUrl = `${base}/remote`;
      els.connectUrl.textContent = remoteUrl;
      els.connectPin.textContent = info.pairingCode || "------";
      renderQrInto(els.qrCode, remoteUrl, 190);
    } catch {
      els.connectUrl.textContent = `${networkUrl}/remote`;
    }
  });

  els.copyUrl?.addEventListener("click", () => {
    navigator.clipboard?.writeText(els.connectUrl.textContent || "");
  });

  els.fullscreenToggle?.addEventListener("click", () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  els.audioToggle?.addEventListener("click", () => {
    const next = els.audioToggle.getAttribute("aria-pressed") !== "true";
    els.audioToggle.setAttribute("aria-pressed", String(next));
    window.GameAudio?.setEnabled?.(next);
  });

  const events = new EventSource(`/api/events?role=presenter&token=${encodeURIComponent(presenterToken)}`);
  events.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "game-state" && payload.game) {
        gameState = payload.game;
        renderGame();
      }
    } catch {}
  };

  renderGame();
})();