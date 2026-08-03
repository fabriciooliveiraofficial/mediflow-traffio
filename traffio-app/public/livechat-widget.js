(function () {
  // 1. Obter parâmetros de configuração da tag script
  const scriptTag = document.currentScript;
  const tenantId = scriptTag.getAttribute("data-tenant-id");
  const supabaseUrl = scriptTag.getAttribute("data-supabase-url") || "https://fyyhxmugxcfqhvoevuwf.supabase.co"; // URL padrão ou injetada
  const supabaseAnonKey = scriptTag.getAttribute("data-supabase-anon-key");

  if (!tenantId) {
    console.error("[Traffio LiveChat] data-tenant-id é obrigatório para carregar o widget.");
    return;
  }

  // 2. Injetar folha de estilo (CSS) customizada para evitar conflitos na página
  const style = document.createElement("style");
  style.textContent = `
    .traffio-chat-widget * {
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .traffio-chat-pill {
      position: fixed;
      bottom: 30px;
      right: 96px;
      height: 48px;
      padding: 0 20px;
      border-radius: 24px;
      background: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.08);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      white-space: nowrap;
      user-select: none;
    }
    .traffio-chat-pill:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
    }
    .traffio-chat-bubble {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 60px;
      height: 60px;
      border-radius: 30px;
      background: var(--traffio-chat-primary, #1152d4);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .traffio-chat-bubble:hover {
      transform: scale(1.08) translateY(-2px);
      filter: brightness(1.1);
    }
    .traffio-chat-bubble svg {
      width: 28px;
      height: 28px;
      fill: #ffffff;
      transition: transform 0.3s ease;
    }
    .traffio-chat-bubble-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 10px;
      background: #ef4444;
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      display: none;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    }
    .traffio-chat-window {
      position: fixed;
      bottom: 96px;
      right: 24px;
      width: 380px;
      height: 580px;
      border-radius: 20px;
      background: #ffffff;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      border: 1px solid rgba(0, 0, 0, 0.08);
      display: flex;
      flex-direction: column;
      z-index: 999999;
      overflow: hidden;
      opacity: 0;
      transform: translateY(20px) scale(0.95);
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
    }
    .traffio-chat-window.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    .traffio-chat-header {
      background: var(--traffio-chat-primary, #1152d4);
      color: #ffffff;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
    }
    .traffio-chat-header-info {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .traffio-chat-header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .traffio-chat-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 16px;
      flex-shrink: 0;
    }
    .traffio-chat-status {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .traffio-chat-status-title {
      font-size: 14px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .traffio-chat-status-sub {
      font-size: 11px;
      opacity: 0.8;
      display: flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .traffio-chat-status-dot {
      width: 6px;
      height: 6px;
      background: #10b981;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .traffio-chat-close, .traffio-chat-end {
      cursor: pointer;
      opacity: 0.8;
      transition: opacity 0.2s;
      background: transparent;
      border: none;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
    }
    .traffio-chat-close {
      font-size: 20px;
    }
    .traffio-chat-close:hover, .traffio-chat-end:hover {
      opacity: 1;
    }
    .traffio-chat-body {
      flex: 1;
      background: #f8fafc;
      overflow-y: auto;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .traffio-chat-form-container {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 24px;
      justify-content: center;
      height: 100%;
      background: #ffffff;
    }
    .traffio-chat-form-title {
      font-size: 18px;
      font-weight: bold;
      color: #0f172a;
      text-align: center;
      margin-bottom: 4px;
    }
    .traffio-chat-form-subtitle {
      font-size: 12px;
      color: #64748b;
      text-align: center;
      margin-bottom: 16px;
      line-height: 1.4;
    }
    .traffio-chat-form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .traffio-chat-form-group label {
      font-size: 11px;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .traffio-chat-form-group input {
      width: 100%;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }
    .traffio-chat-form-group input:focus {
      border-color: #1152d4;
      box-shadow: 0 0 0 3px rgba(17, 82, 212, 0.1);
    }
    .traffio-chat-form-btn {
      width: 100%;
      padding: 12px;
      border-radius: 10px;
      background: var(--traffio-chat-primary, #1152d4);
      color: #ffffff;
      border: none;
      font-weight: bold;
      font-size: 14px;
      cursor: pointer;
      margin-top: 10px;
      transition: background-color 0.2s;
    }
    .traffio-chat-form-btn:hover {
      filter: brightness(0.9);
    }
    .traffio-chat-form-btn:disabled {
      background: #94a3b8;
      cursor: not-allowed;
    }
    .traffio-chat-bubble-msg {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 13px;
      line-height: 1.4;
      word-wrap: break-word;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }
    .traffio-chat-bubble-text {
      white-space: pre-wrap;
    }
    .traffio-chat-bubble-msg.visitor {
      background: var(--traffio-chat-primary, #1152d4);
      color: #ffffff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .traffio-chat-bubble-msg.agent {
      background: #ffffff;
      color: #0f172a;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
      border: 1px solid #e2e8f0;
    }
    .traffio-chat-agent-name {
      font-size: 10px;
      font-weight: 700;
      color: #64748b;
      margin-bottom: 3px;
    }
    .traffio-chat-system-msg {
      align-self: center;
      background: #e2e8f0;
      color: #475569;
      font-size: 11px;
      padding: 6px 14px;
      border-radius: 12px;
      text-align: center;
      max-width: 90%;
    }
    .traffio-chat-ended-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      height: 100%;
      padding: 24px;
      text-align: center;
    }
    .traffio-chat-ended-icon {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #d1fae5;
      color: #059669;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }
    .traffio-chat-ended-text {
      font-size: 13px;
      color: #475569;
      line-height: 1.5;
    }
    .traffio-chat-new-chat-btn {
      padding: 10px 20px;
      border-radius: 10px;
      background: var(--traffio-chat-primary, #1152d4);
      color: #ffffff;
      border: none;
      font-weight: bold;
      font-size: 13px;
      cursor: pointer;
      margin-top: 6px;
    }
    .traffio-chat-new-chat-btn:hover {
      filter: brightness(0.9);
    }
    .traffio-chat-bubble-msg img {
      max-width: 100%;
      max-height: 180px;
      border-radius: 8px;
      margin-top: 4px;
      display: block;
    }
    .traffio-chat-bubble-msg a.file-link {
      display: flex;
      align-items: center;
      gap: 8px;
      color: inherit;
      text-decoration: underline;
      font-weight: 500;
      margin-top: 4px;
    }
    .traffio-chat-bubble-time {
      font-size: 9px;
      opacity: 0.7;
      margin-top: 4px;
      text-align: right;
    }
    .traffio-chat-footer {
      background: #ffffff;
      border-top: 1px solid #f1f5f9;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .traffio-chat-input-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .traffio-chat-input {
      flex: 1;
      border: none;
      outline: none;
      resize: none;
      font-size: 13px;
      max-height: 80px;
      padding: 8px 4px;
    }
    .traffio-chat-attach-btn, .traffio-chat-send-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border: none;
      background: transparent;
      color: #64748b;
      transition: all 0.2s;
      outline: none;
    }
    .traffio-chat-attach-btn:hover {
      background: #f1f5f9;
      color: #0f172a;
    }
    .traffio-chat-send-btn {
      background: var(--traffio-chat-primary, #1152d4);
      color: #ffffff;
    }
    .traffio-chat-send-btn:hover {
      filter: brightness(0.9);
    }
    .traffio-chat-send-btn:disabled {
      background: #e2e8f0;
      color: #94a3b8;
      cursor: not-allowed;
    }
    .traffio-chat-file-preview {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #f1f5f9;
      padding: 6px 12px;
      border-radius: 10px;
      font-size: 12px;
      color: #334155;
    }
    .traffio-chat-file-preview-cancel {
      cursor: pointer;
      color: #ef4444;
      font-weight: bold;
      border: none;
      background: transparent;
    }
    .traffio-chat-confirm {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 20;
      padding: 24px;
    }
    .traffio-chat-confirm.open {
      display: flex;
    }
    .traffio-chat-confirm-box {
      background: #ffffff;
      border-radius: 16px;
      padding: 20px;
      width: 100%;
      max-width: 280px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
      text-align: center;
    }
    .traffio-chat-confirm-text {
      font-size: 13px;
      color: #0f172a;
      line-height: 1.5;
      margin: 0 0 16px 0;
      font-weight: 500;
    }
    .traffio-chat-confirm-actions {
      display: flex;
      gap: 10px;
    }
    .traffio-chat-confirm-ok, .traffio-chat-confirm-cancel {
      flex: 1;
      padding: 9px 0;
      border-radius: 10px;
      border: none;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: filter 0.2s;
    }
    .traffio-chat-confirm-ok {
      background: var(--traffio-chat-primary, #1152d4);
      color: #ffffff;
    }
    .traffio-chat-confirm-ok:hover {
      filter: brightness(0.9);
    }
    .traffio-chat-confirm-cancel {
      background: #f1f5f9;
      color: #475569;
    }
    .traffio-chat-confirm-cancel:hover {
      background: #e2e8f0;
    }
    .traffio-chat-toast {
      position: absolute;
      top: 74px;
      left: 50%;
      transform: translateX(-50%) translateY(-8px);
      background: var(--traffio-chat-primary, #1152d4);
      color: #ffffff;
      padding: 9px 18px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
      z-index: 21;
      max-width: 85%;
      text-align: center;
      opacity: 0;
      pointer-events: none;
      transition: all 0.3s ease;
    }
    .traffio-chat-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .traffio-chat-interactive-options {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
      width: 100%;
    }
    .traffio-chat-option-btn {
      background: #ffffff;
      border: 1.5px solid var(--traffio-chat-primary, #1152d4);
      color: var(--traffio-chat-primary, #1152d4);
      padding: 8px 12px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      outline: none;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
    }
    .traffio-chat-option-btn:hover:not(:disabled) {
      background: var(--traffio-chat-primary, #1152d4);
      color: #ffffff;
      transform: translateY(-1px);
    }
    .traffio-chat-option-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .traffio-chat-option-btn.selected {
      background: var(--traffio-chat-primary, #1152d4);
      color: #ffffff;
      border-color: var(--traffio-chat-primary, #1152d4);
    }
    .traffio-chat-option-desc {
      font-size: 11px;
      font-weight: 400;
      opacity: 0.85;
      margin-top: 2px;
    }
    @media (max-width: 480px) {
      .traffio-chat-window {
        bottom: 0;
        right: 0;
        width: 100%;
        height: 100%;
        border-radius: 0;
      }
      .traffio-chat-bubble {
        bottom: 16px;
        right: 16px;
      }
      .traffio-chat-pill {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);

  // 3. Criar os elementos HTML do widget (oculto até a configuração ser aplicada,
  // para não exibir cor/idioma padrão antes da personalização do tenant)
  const widgetContainer = document.createElement("div");
  widgetContainer.className = "traffio-chat-widget";
  widgetContainer.style.display = "none";
  widgetContainer.innerHTML = `
    <div class="traffio-chat-pill" id="traffio-pill">Fale conosco</div>
    <div class="traffio-chat-bubble" id="traffio-bubble">
      <svg viewBox="0 0 24 24">
        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
      </svg>
      <span class="traffio-chat-bubble-badge" id="traffio-badge"></span>
    </div>
    <div class="traffio-chat-window" id="traffio-window">
      <div class="traffio-chat-header">
        <div class="traffio-chat-header-info">
          <div class="traffio-chat-avatar" id="traffio-avatar">A</div>
          <div class="traffio-chat-status">
            <span class="traffio-chat-status-title" id="traffio-header-title">Atendimento Online</span>
            <span class="traffio-chat-status-sub"><span class="traffio-chat-status-dot"></span><span id="traffio-header-sub">Fale conosco</span></span>
          </div>
        </div>
        <div class="traffio-chat-header-actions">
          <button class="traffio-chat-end" id="traffio-end-btn" title="Encerrar atendimento" style="display: none;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
          <button class="traffio-chat-close" id="traffio-close" title="Minimizar">×</button>
        </div>
      </div>
      <div class="traffio-chat-body" id="traffio-chat-body">
        <!-- O formulário de registro ou as mensagens serão injetadas aqui -->
      </div>
      <div class="traffio-chat-footer" id="traffio-chat-footer" style="display: none;">
        <div class="traffio-chat-file-preview" id="traffio-file-preview" style="display: none;">
          <span id="traffio-file-name">arquivo.pdf</span>
          <button class="traffio-chat-file-preview-cancel" id="traffio-file-cancel">Remover</button>
        </div>
        <div class="traffio-chat-input-row">
          <button class="traffio-chat-attach-btn" id="traffio-attach-btn" title="Anexar arquivo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>
          <input type="file" id="traffio-file-input" style="display: none;" />
          <input type="text" class="traffio-chat-input" id="traffio-chat-input" placeholder="Digite sua mensagem..." />
          <button class="traffio-chat-send-btn" id="traffio-send-btn" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="traffio-chat-toast" id="traffio-toast"></div>
      <div class="traffio-chat-confirm" id="traffio-confirm">
        <div class="traffio-chat-confirm-box">
          <p class="traffio-chat-confirm-text" id="traffio-confirm-text"></p>
          <div class="traffio-chat-confirm-actions">
            <button class="traffio-chat-confirm-cancel" id="traffio-confirm-cancel">Cancelar</button>
            <button class="traffio-chat-confirm-ok" id="traffio-confirm-ok">Encerrar</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(widgetContainer);

  // 4. Lógica de controle de estado do widget
  const bubble = document.getElementById("traffio-bubble");
  const badge = document.getElementById("traffio-badge");
  const pill = document.getElementById("traffio-pill");
  const windowEl = document.getElementById("traffio-window");
  const closeBtn = document.getElementById("traffio-close");
  const endBtn = document.getElementById("traffio-end-btn");
  const avatarEl = document.getElementById("traffio-avatar");
  const headerTitleEl = document.getElementById("traffio-header-title");
  const headerSubEl = document.getElementById("traffio-header-sub");
  const chatBody = document.getElementById("traffio-chat-body");
  const chatFooter = document.getElementById("traffio-chat-footer");
  const chatInput = document.getElementById("traffio-chat-input");
  const sendBtn = document.getElementById("traffio-send-btn");
  const attachBtn = document.getElementById("traffio-attach-btn");
  const fileInput = document.getElementById("traffio-file-input");
  const filePreview = document.getElementById("traffio-file-preview");
  const fileNameSpan = document.getElementById("traffio-file-name");
  const fileCancelBtn = document.getElementById("traffio-file-cancel");
  const toastEl = document.getElementById("traffio-toast");
  const confirmEl = document.getElementById("traffio-confirm");
  const confirmTextEl = document.getElementById("traffio-confirm-text");
  const confirmOkBtn = document.getElementById("traffio-confirm-ok");
  const confirmCancelBtn = document.getElementById("traffio-confirm-cancel");

  // ── Toast e confirmação internos (substituem alert/confirm nativos) ──
  let toastTimer = null;
  function showWidgetToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3500);
  }

  let confirmResolve = null;
  function showWidgetConfirm(message) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmTextEl.textContent = message;
      confirmOkBtn.textContent = t('confirmYes');
      confirmCancelBtn.textContent = t('confirmNo');
      confirmEl.classList.add("open");
    });
  }

  function resolveConfirm(result) {
    confirmEl.classList.remove("open");
    if (confirmResolve) {
      confirmResolve(result);
      confirmResolve = null;
    }
  }

  confirmOkBtn.addEventListener("click", () => resolveConfirm(true));
  confirmCancelBtn.addEventListener("click", () => resolveConfirm(false));
  confirmEl.addEventListener("click", (e) => {
    if (e.target === confirmEl) resolveConfirm(false);
  });

  const LS_SESSION = "traffio_livechat_session_id";
  const LS_NAME = "traffio_livechat_name";
  const LS_ACTIVITY = "traffio_livechat_last_activity";

  let supabaseClient = null;
  let realtimeChannel = null;
  let inactivityTimer = null;
  let agentName = null;
  let unreadCount = 0;
  let activeSessionId = localStorage.getItem(LS_SESSION);
  if (activeSessionId === "undefined" || activeSessionId === "null" || activeSessionId === "") {
    activeSessionId = null;
    localStorage.removeItem(LS_SESSION);
  }
  let visitorName = localStorage.getItem(LS_NAME);
  if (visitorName === "undefined" || visitorName === "null" || visitorName === "") {
    visitorName = null;
    localStorage.removeItem(LS_NAME);
  }
  let selectedFile = null;
  let messagesList = [];

  // Escapar HTML para impedir injeção de markup/script via conteúdo de mensagens
  function escapeHtml(value) {
    if (typeof value !== "string") return "";
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatMessageText(text) {
    if (!text) return "";
    let html = escapeHtml(text);
    // Transformar URLs em tags <a> clicáveis
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    html = html.replace(urlRegex, function(url) {
      return `<a href="${url}" target="_blank" rel="noopener" style="text-decoration: underline;">${url}</a>`;
    });
    return html;
  }

  // URLs de mídia só são renderizadas se forem http(s) absolutas
  function safeUrl(url) {
    return /^https?:\/\//i.test(url || "") ? escapeHtml(url) : "";
  }

  // ── Rastreio de atividade (para encerramento por inatividade) ──
  function touchActivity() {
    localStorage.setItem(LS_ACTIVITY, String(Date.now()));
  }

  function getInactivityLimitMs() {
    const minutes = Number(chatConfig.inactivity_timeout_minutes);
    if (!minutes || minutes <= 0) return 0; // 0 = nunca expira
    return minutes * 60 * 1000;
  }

  function isSessionStale() {
    const limit = getInactivityLimitMs();
    if (!limit || !activeSessionId) return false;
    const last = Number(localStorage.getItem(LS_ACTIVITY) || 0);
    if (!last) return false;
    return Date.now() - last > limit;
  }

  function startInactivityWatcher() {
    if (inactivityTimer) clearInterval(inactivityTimer);
    inactivityTimer = setInterval(() => {
      if (activeSessionId && isSessionStale()) {
        endSession(t('endedInactivity'), true);
      }
    }, 60 * 1000);
  }

  function setUnread(count) {
    unreadCount = count;
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  }

  // Toggle de exibição da janela do chat
  function toggleChatWindow() {
    windowEl.classList.toggle("open");
    const isOpen = windowEl.classList.contains("open");
    if (isOpen) {
      setUnread(0);
      if (pill) {
        pill.style.opacity = "0";
        pill.style.pointerEvents = "none";
        pill.style.transform = "translateX(10px) scale(0.9)";
      }
      scrollToBottom();
      chatInput.focus();
    } else {
      if (pill) {
        pill.style.opacity = "1";
        pill.style.pointerEvents = "auto";
        pill.style.transform = "translateX(0) scale(1)";
      }
    }
  }

  bubble.addEventListener("click", toggleChatWindow);
  if (pill) {
    pill.addEventListener("click", toggleChatWindow);
  }

  closeBtn.addEventListener("click", toggleChatWindow);

  // Encerramento manual pelo visitante
  endBtn.addEventListener("click", async () => {
    if (!activeSessionId) return;
    const confirmed = await showWidgetConfirm(t('confirmEnd'));
    if (confirmed) {
      endSession(t('endedByYou'), true);
    }
  });

  // Habilitar/Desabilitar botão de envio
  chatInput.addEventListener("input", () => {
    sendBtn.disabled = !chatInput.value.trim() && !selectedFile;
  });

  // Lógica de configuração padrão
  let chatConfig = {
    primary_color: '#1152d4',
    welcome_title: 'Iniciar Atendimento',
    welcome_subtitle: 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.',
    pill_text: 'Fale conosco',
    header_title: 'Atendimento Online',
    header_subtitle: 'Fale conosco',
    inactivity_timeout_minutes: 30,
    is_active: true
  };

  // ── Localização: o idioma, timezone e país do TENANT são a fonte de verdade ──
  let tenantLocale = 'en';
  let tenantTimezone = 'America/Sao_Paulo';
  let tenantCountry = 'BR';

  const COUNTRY_WIDGET_FORMATS = {
    BR: {
      code: 'BR',
      dialCode: '+55',
      phonePlaceholder: '(41) 99000-0000',
      docLabel: 'CPF',
      docPlaceholder: '000.000.000-00',
      docMask: '###.###.###-##'
    },
    US: {
      code: 'US',
      dialCode: '+1',
      phonePlaceholder: '(404) 925-7024',
      docLabel: 'SSN',
      docPlaceholder: '000-00-0000',
      docMask: '###-##-####'
    },
    NZ: {
      code: 'NZ',
      dialCode: '+64',
      phonePlaceholder: '21 123 4567',
      docLabel: 'IRD',
      docPlaceholder: '000-000-000',
      docMask: '###-###-###'
    },
    MX: {
      code: 'MX',
      dialCode: '+52',
      phonePlaceholder: '55 1234 5678',
      docLabel: 'RFC',
      docPlaceholder: 'XAXX010101000',
      docMask: null
    }
  };

  function getWidgetCountryDef(code) {
    const c = (code || 'BR').toUpperCase();
    return COUNTRY_WIDGET_FORMATS[c] || COUNTRY_WIDGET_FORMATS.BR;
  }

  function applyWidgetMask(rawValue, mask) {
    if (!mask) return rawValue;
    const digits = rawValue.replace(/\D/g, "");
    let result = "";
    let digitIndex = 0;
    for (let i = 0; i < mask.length; i++) {
      if (digitIndex >= digits.length) break;
      if (mask[i] === "#") {
        result += digits[digitIndex];
        digitIndex++;
      } else {
        result += mask[i];
      }
    }
    return result;
  }

  function formatWidgetPhone(rawValue, countryCode) {
    const digits = rawValue.replace(/\D/g, "");
    if (countryCode === 'BR') {
      if (digits.length <= 10) {
        return applyWidgetMask(digits, "(##) ####-####");
      }
      return applyWidgetMask(digits.slice(0, 11), "(##) #####-####");
    } else if (countryCode === 'US') {
      return applyWidgetMask(digits.slice(0, 10), "(###) ###-####");
    } else if (countryCode === 'NZ') {
      if (digits.length <= 8) {
        return applyWidgetMask(digits, "## ### ####");
      }
      return applyWidgetMask(digits.slice(0, 10), "### ### ####");
    } else if (countryCode === 'MX') {
      return applyWidgetMask(digits.slice(0, 10), "## #### ####");
    }
    return rawValue;
  }

  function formatWidgetDoc(rawValue, countryCode) {
    if (!rawValue) return "";
    const cDef = getWidgetCountryDef(countryCode);
    if (cDef.docMask) {
      return applyWidgetMask(rawValue, cDef.docMask);
    }
    return rawValue.toUpperCase().replace(/\s+/g, "");
  }

  const I18N = {
    pt: {
      pill: 'Fale conosco',
      header_title: 'Atendimento Online',
      header_subtitle: 'Fale conosco',
      welcome_title: 'Iniciar Atendimento',
      welcome_subtitle: 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.',
      nameLabel: 'Seu Nome *',
      namePlaceholder: 'Digite seu nome completo',
      emailLabel: 'E-mail *',
      emailPlaceholder: 'exemplo@email.com',
      phoneLabel: 'Telefone (Mobile) *',
      phonePlaceholder: 'Ex: +55 11 90000-0000',
      startChat: 'Começar Chat',
      connecting: 'Conectando...',
      initialMessage: 'Olá! Iniciei o atendimento no chat.',
      inputPlaceholder: 'Digite sua mensagem...',
      attachTitle: 'Anexar arquivo',
      removeFile: 'Remover',
      fileTooLarge: 'O arquivo excede o limite máximo de 5MB.',
      endTitle: 'Encerrar atendimento',
      minimizeTitle: 'Minimizar',
      confirmEnd: 'Deseja encerrar este atendimento?',
      confirmYes: 'Encerrar',
      confirmNo: 'Cancelar',
      endedByYou: 'Você encerrou o atendimento. Obrigado pelo contato!',
      endedByAgent: 'O atendimento foi encerrado pela nossa equipe. Obrigado pelo contato!',
      endedGeneric: 'O atendimento foi encerrado. Obrigado pelo contato!',
      endedInactivity: 'Atendimento encerrado por inatividade.',
      endedWhileAway: 'Este atendimento foi encerrado. Se precisar, inicie uma nova conversa.',
      newChat: 'Iniciar novo atendimento',
      talkingWith: 'Você está falando com {name}',
      downloadFile: 'Baixar arquivo',
      connectError: 'Erro ao conectar: ',
      sendError: 'Erro ao enviar mensagem: '
    },
    en: {
      pill: 'Chat with us',
      header_title: 'Online Support',
      header_subtitle: 'Chat with us',
      welcome_title: 'Start a Conversation',
      welcome_subtitle: 'Fill in the fields below to chat with our team in real time.',
      nameLabel: 'Your Name *',
      namePlaceholder: 'Enter your full name',
      emailLabel: 'E-mail *',
      emailPlaceholder: 'example@email.com',
      phoneLabel: 'Phone (Mobile) *',
      phonePlaceholder: 'e.g. +1 555 000 0000',
      startChat: 'Start Chat',
      connecting: 'Connecting...',
      initialMessage: 'Hello! I just started a chat conversation.',
      inputPlaceholder: 'Type your message...',
      attachTitle: 'Attach file',
      removeFile: 'Remove',
      fileTooLarge: 'The file exceeds the 5MB size limit.',
      endTitle: 'End chat',
      minimizeTitle: 'Minimize',
      confirmEnd: 'Do you want to end this chat?',
      confirmYes: 'End chat',
      confirmNo: 'Cancel',
      endedByYou: 'You ended the chat. Thank you for reaching out!',
      endedByAgent: 'This chat was closed by our team. Thank you for reaching out!',
      endedGeneric: 'This chat has ended. Thank you for reaching out!',
      endedInactivity: 'Chat ended due to inactivity.',
      endedWhileAway: 'This chat has been closed. Start a new conversation if you need anything else.',
      newChat: 'Start a new chat',
      talkingWith: 'You are talking to {name}',
      downloadFile: 'Download file',
      connectError: 'Connection error: ',
      sendError: 'Error sending message: '
    },
    es: {
      pill: 'Hable con nosotros',
      header_title: 'Atención en Línea',
      header_subtitle: 'Hable con nosotros',
      welcome_title: 'Iniciar Atención',
      welcome_subtitle: 'Complete los campos a continuación para conversar en tiempo real con nuestro equipo.',
      nameLabel: 'Su Nombre *',
      namePlaceholder: 'Escriba su nombre completo',
      emailLabel: 'E-mail *',
      emailPlaceholder: 'ejemplo@email.com',
      phoneLabel: 'Teléfono (Móvil) *',
      phonePlaceholder: 'Ej: +34 600 000 000',
      startChat: 'Comenzar Chat',
      connecting: 'Conectando...',
      initialMessage: '¡Hola! Inicié la atención por chat.',
      inputPlaceholder: 'Escriba su mensaje...',
      attachTitle: 'Adjuntar archivo',
      removeFile: 'Quitar',
      fileTooLarge: 'El archivo supera el límite de 5MB.',
      endTitle: 'Finalizar atención',
      minimizeTitle: 'Minimizar',
      confirmEnd: '¿Desea finalizar esta atención?',
      confirmYes: 'Finalizar',
      confirmNo: 'Cancelar',
      endedByYou: 'Usted finalizó la atención. ¡Gracias por contactarnos!',
      endedByAgent: 'La atención fue finalizada por nuestro equipo. ¡Gracias por contactarnos!',
      endedGeneric: 'La atención ha finalizado. ¡Gracias por contactarnos!',
      endedInactivity: 'Atención finalizada por inactividad.',
      endedWhileAway: 'Esta atención fue finalizada. Si lo necesita, inicie una nueva conversación.',
      newChat: 'Iniciar nueva atención',
      talkingWith: 'Está hablando con {name}',
      downloadFile: 'Descargar archivo',
      connectError: 'Error al conectar: ',
      sendError: 'Error al enviar el mensaje: '
    }
  };

  function t(key) {
    const lang = /^pt/i.test(tenantLocale) ? 'pt' : /^es/i.test(tenantLocale) ? 'es' : 'en';
    return (I18N[lang] && I18N[lang][key]) || I18N.pt[key] || key;
  }

  // Textos que o banco preenche com seed em PT: se o tenant nunca personalizou
  // (valor vazio ou igual ao seed), usar o default traduzido no idioma do tenant.
  const PT_SEEDS = {
    welcome_title: 'Iniciar Atendimento',
    welcome_subtitle: 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.',
    pill_text: 'Fale conosco',
    header_title: 'Atendimento Online',
    header_subtitle: 'Fale conosco'
  };

  function cfgText(key, i18nKey) {
    const value = (chatConfig[key] || '').trim();
    if (!value || value === PT_SEEDS[key]) return t(i18nKey);
    return value;
  }

  // Horário no locale e timezone do tenant (fonte de verdade), com fallback
  function formatTime(isoDate) {
    const d = new Date(isoDate);
    try {
      return d.toLocaleTimeString(tenantLocale, { hour: '2-digit', minute: '2-digit', timeZone: tenantTimezone });
    } catch (err) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  // Cache local da configuração: elimina o "flash" de cor/idioma padrão
  // nas visitas seguintes, enquanto a config fresca é buscada em background
  const CFG_CACHE_KEY = `traffio_livechat_cfg_${tenantId}`;

  function applyCachedConfig() {
    try {
      const cached = JSON.parse(localStorage.getItem(CFG_CACHE_KEY) || "null");
      if (cached && cached.config) {
        chatConfig = cached.config;
        if (cached.locale) tenantLocale = cached.locale;
        if (cached.timezone) tenantTimezone = cached.timezone;
        if (cached.country) tenantCountry = cached.country;
        return true;
      }
    } catch (err) { /* cache corrompido é ignorado */ }
    return false;
  }

  // Buscar configuração do widget + idioma/timezone/país do tenant (fonte de verdade).
  // Usa fetch puro: não depende do carregamento da biblioteca Supabase via CDN.
  async function fetchConfig() {
    if (!supabaseUrl || !supabaseAnonKey) return false;
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/livechat-visitor-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({ action: "get_config", tenant_id: tenantId })
      });
      const data = await response.json();
      if (data && data.success) {
        if (data.config) chatConfig = data.config;
        if (data.locale) tenantLocale = data.locale;
        if (data.timezone) tenantTimezone = data.timezone;
        if (data.country) tenantCountry = data.country;
        try {
          localStorage.setItem(CFG_CACHE_KEY, JSON.stringify({
            config: chatConfig,
            locale: tenantLocale,
            timezone: tenantTimezone,
            country: tenantCountry
          }));
        } catch (err) { /* storage cheio/indisponível é ignorado */ }
        return true;
      }
    } catch (err) {
      console.error("[Traffio LiveChat] Erro ao carregar configurações:", err);
    }
    return false;
  }

  // Renderiza o estado inicial (formulário ou conversa em andamento) uma única vez
  let stateRendered = false;
  function renderInitialState() {
    if (!chatConfig.is_active || stateRendered) return;
    stateRendered = true;

    // Sessão antiga demais? Encerra silenciosamente antes de exibir
    if (activeSessionId && isSessionStale()) {
      endSession(null, true);
      showRegistrationForm();
      return;
    }
    if (activeSessionId) {
      showChatScreen();
      loadHistory();
      subscribeToRealtime();
      startInactivityWatcher();
    } else {
      showRegistrationForm();
    }
  }

  async function bootstrap() {
    if (applyCachedConfig()) {
      // Cache disponível: exibir imediatamente com a personalização correta
      // e revalidar em background
      applyDynamicConfig();
      renderInitialState();
      fetchConfig().then((ok) => {
        if (ok) {
          applyDynamicConfig();
          renderInitialState();
        }
      });
    } else {
      // Primeira visita: aguardar a config antes de exibir (sem flash de padrão)
      await fetchConfig();
      applyDynamicConfig();
      renderInitialState();
    }

    // Biblioteca Supabase (CDN) é necessária apenas para o realtime
    loadSupabaseAndConnect();
  }

  // Carregar biblioteca Supabase do CDN de forma assíncrona se não estiver disponível
  function loadSupabaseAndConnect() {
    if (window.supabase) {
      initSupabase();
    } else {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = () => initSupabase();
      document.head.appendChild(script);
    }
  }

  function initSupabase() {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn("[Traffio LiveChat] Supabase URL ou Anon Key ausentes. O realtime pode não funcionar.");
      return;
    }
    if (!window._traffioSupabaseClient) {
      window._traffioSupabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    }
    supabaseClient = window._traffioSupabaseClient;

    // Se já existe uma conversa em andamento, conectar o canal realtime
    if (activeSessionId) {
      subscribeToRealtime();
    }
  }

  function applyDynamicConfig() {
    if (!chatConfig.is_active) {
      widgetContainer.style.display = "none";
      return;
    }

    widgetContainer.style.display = "block";

    // Injetar variável CSS para a cor primária (elemento dedicado e idempotente)
    const primaryColor = chatConfig.primary_color || '#1152d4';
    let colorStyle = document.getElementById("traffio-chat-color-style");
    if (!colorStyle) {
      colorStyle = document.createElement("style");
      colorStyle.id = "traffio-chat-color-style";
      document.head.appendChild(colorStyle);
    }
    colorStyle.textContent = `
      :root {
        --traffio-chat-primary: ${primaryColor} !important;
      }
    `;

    updateHeader();

    // Traduzir os textos estáticos do widget para o idioma do tenant
    chatInput.placeholder = t('inputPlaceholder');
    attachBtn.title = t('attachTitle');
    endBtn.title = t('endTitle');
    closeBtn.title = t('minimizeTitle');
    fileCancelBtn.textContent = t('removeFile');

    // Atualizar títulos no formulário de registro, se visível
    const formTitle = document.getElementById("traffio-form-title-el");
    if (formTitle) {
      formTitle.textContent = cfgText('welcome_title', 'welcome_title');
    }
    const formSubtitle = document.getElementById("traffio-form-subtitle-el");
    if (formSubtitle) {
      formSubtitle.textContent = cfgText('welcome_subtitle', 'welcome_subtitle');
    }
    const chatPill = document.getElementById("traffio-pill");
    if (chatPill) {
      chatPill.textContent = cfgText('pill_text', 'pill');
    }

    // Se o formulário já foi renderizado, atualiza o código do país
    const phoneCodeSpan = document.getElementById("traffio-reg-phone-code");
    const phoneInputEl = document.getElementById("traffio-reg-phone");
    if (phoneCodeSpan && phoneInputEl) {
      const countryDef = getWidgetCountryDef(tenantCountry);
      phoneCodeSpan.textContent = countryDef.dialCode;
      phoneInputEl.placeholder = countryDef.phonePlaceholder;
    }
  }

  // Cabeçalho dinâmico: título/subtítulo das configurações; quando um atendente
  // assume a conversa, o subtítulo e o avatar passam a exibir o nome dele
  function updateHeader() {
    const title = cfgText('header_title', 'header_title');
    headerTitleEl.textContent = title;
    if (agentName) {
      headerSubEl.textContent = t('talkingWith').replace('{name}', agentName);
      avatarEl.textContent = agentName.trim().charAt(0).toUpperCase();
    } else {
      headerSubEl.textContent = cfgText('header_subtitle', 'header_subtitle');
      avatarEl.textContent = (title.trim().charAt(0) || 'A').toUpperCase();
    }
  }

  function setAgentName(name) {
    if (!name || name === agentName) return;
    agentName = name;
    updateHeader();
  }

  // Iniciar carregamento imediatamente
  bootstrap();

  // ── Renderizador do Formulário de Registro ──
  function showRegistrationForm() {
    const countryDef = getWidgetCountryDef(tenantCountry);
    chatFooter.style.display = "none";
    endBtn.style.display = "none";
    chatBody.innerHTML = `
      <div class="traffio-chat-form-container">
        <h3 class="traffio-chat-form-title" id="traffio-form-title-el">${escapeHtml(cfgText('welcome_title', 'welcome_title'))}</h3>
        <p class="traffio-chat-form-subtitle" id="traffio-form-subtitle-el">${escapeHtml(cfgText('welcome_subtitle', 'welcome_subtitle'))}</p>

        <form id="traffio-reg-form">
          <div class="traffio-chat-form-group">
            <label for="traffio-reg-name">${escapeHtml(t('nameLabel'))}</label>
            <input type="text" id="traffio-reg-name" required placeholder="${escapeHtml(t('namePlaceholder'))}" />
          </div>
          <div class="traffio-chat-form-group" style="margin-top: 10px;">
            <label for="traffio-reg-email">${escapeHtml(t('emailLabel'))}</label>
            <input type="email" id="traffio-reg-email" required placeholder="${escapeHtml(t('emailPlaceholder'))}" />
          </div>
          <div class="traffio-chat-form-group" style="margin-top: 10px;">
            <label for="traffio-reg-phone">${escapeHtml(t('phoneLabel'))}</label>
            <div style="display: flex; align-items: center; background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden;">
              <span id="traffio-reg-phone-code" style="padding: 10px 12px; font-size: 13px; font-weight: 700; color: #475569; background: #f8fafc; border-right: 1px solid #cbd5e1; user-select: none;">${escapeHtml(countryDef.dialCode)}</span>
              <input type="tel" id="traffio-reg-phone" required placeholder="${escapeHtml(countryDef.phonePlaceholder)}" style="border: none; border-radius: 0; flex: 1;" />
            </div>
          </div>
          <button type="submit" class="traffio-chat-form-btn" id="traffio-reg-submit">${escapeHtml(t('startChat'))}</button>
        </form>
      </div>
    `;

    const phoneInput = document.getElementById("traffio-reg-phone");
    if (phoneInput) {
      phoneInput.addEventListener("input", (e) => {
        e.target.value = formatWidgetPhone(e.target.value, tenantCountry);
      });
    }

    const regForm = document.getElementById("traffio-reg-form");
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("traffio-reg-submit");
      submitBtn.disabled = true;
      submitBtn.textContent = t('connecting');

      const nameVal = document.getElementById("traffio-reg-name").value;
      const emailVal = document.getElementById("traffio-reg-email").value;
      const phoneRaw = document.getElementById("traffio-reg-phone").value;
      const phoneVal = countryDef.dialCode + ' ' + phoneRaw;

      try {
        // Chamar a Edge Function para criar a sessão
        const response = await fetch(`${supabaseUrl}/functions/v1/livechat-visitor-message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseAnonKey}`
          },
          body: JSON.stringify({
            tenant_id: tenantId,
            visitor_name: nameVal,
            visitor_email: emailVal,
            visitor_phone: phoneVal,
            content: t('initialMessage')
          })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        activeSessionId = data.session_id;
        visitorName = nameVal;

        localStorage.setItem(LS_SESSION, activeSessionId);
        localStorage.setItem(LS_NAME, visitorName);
        touchActivity();

        showChatScreen();
        loadHistory();
        subscribeToRealtime();
        startInactivityWatcher();

      } catch (error) {
        showWidgetToast(t('connectError') + error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = t('startChat');
      }
    });
  }

  // ── Renderizador da Tela de Chat ──
  function showChatScreen() {
    chatBody.innerHTML = "";
    chatFooter.style.display = "block";
    endBtn.style.display = "flex";
  }

  function clearSession() {
    activeSessionId = null;
    visitorName = null;
    agentName = null;
    messagesList = [];
    localStorage.removeItem(LS_SESSION);
    localStorage.removeItem(LS_NAME);
    localStorage.removeItem(LS_ACTIVITY);
    unsubscribeRealtime();
    if (inactivityTimer) {
      clearInterval(inactivityTimer);
      inactivityTimer = null;
    }
    updateHeader();
    showRegistrationForm();
  }

  // Encerra a sessão no servidor e exibe a tela de fim de atendimento.
  // Com `message = null`, encerra silenciosamente (usado para sessões velhas).
  async function endSession(message, notifyServer) {
    const sessionToClose = activeSessionId;
    if (notifyServer && sessionToClose) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/livechat-visitor-message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseAnonKey}`
          },
          body: JSON.stringify({
            action: "end_session",
            session_id: sessionToClose,
            tenant_id: tenantId
          })
        });
      } catch (err) {
        console.error("[Traffio LiveChat] Falha ao encerrar sessão no servidor:", err);
      }
    }

    activeSessionId = null;
    visitorName = null;
    agentName = null;
    messagesList = [];
    localStorage.removeItem(LS_SESSION);
    localStorage.removeItem(LS_NAME);
    localStorage.removeItem(LS_ACTIVITY);
    unsubscribeRealtime();
    if (inactivityTimer) {
      clearInterval(inactivityTimer);
      inactivityTimer = null;
    }
    updateHeader();

    if (message) {
      showEndedScreen(message);
    }
  }

  // Tela exibida após o encerramento do atendimento
  function showEndedScreen(message) {
    chatFooter.style.display = "none";
    endBtn.style.display = "none";
    chatBody.innerHTML = `
      <div class="traffio-chat-ended-container">
        <div class="traffio-chat-ended-icon">✓</div>
        <p class="traffio-chat-ended-text">${escapeHtml(message)}</p>
        <button class="traffio-chat-new-chat-btn" id="traffio-new-chat-btn">${escapeHtml(t('newChat'))}</button>
      </div>
    `;
    document.getElementById("traffio-new-chat-btn").addEventListener("click", () => {
      showRegistrationForm();
    });
  }

  // Carregar histórico de mensagens
  async function loadHistory() {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/livechat-visitor-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseAnonKey}`
        },
        body: JSON.stringify({
          action: "get_history",
          session_id: activeSessionId,
          tenant_id: tenantId
        })
      });
      const data = await response.json();
      if (data.success && data.messages) {
        // Sessão foi encerrada pela clínica enquanto o visitante estava fora
        if (data.session_status === 'closed') {
          endSession(t('endedWhileAway'), false);
          return;
        }
        if (data.agent_name) setAgentName(data.agent_name);
        messagesList = data.messages;
        renderMessages();
      } else {
        clearSession();
      }
    } catch (err) {
      console.error("Falha ao obter histórico de mensagens:", err);
      clearSession();
    }
  }

  function unsubscribeRealtime() {
    if (realtimeChannel && supabaseClient) {
      supabaseClient.removeChannel(realtimeChannel);
    }
    realtimeChannel = null;
  }

  // Inscrever-se via Supabase Realtime Broadcast
  function subscribeToRealtime() {
    if (!supabaseClient || !activeSessionId) return;

    unsubscribeRealtime();
    realtimeChannel = supabaseClient.channel(`livechat:${activeSessionId}`);
    realtimeChannel
      .on("broadcast", { event: "message" }, (payload) => {
        const msg = payload.payload;
        // Impedir duplicação de mensagens enviadas por si mesmo
        if (messagesList.some((m) => m.id === msg.id)) return;

        // Dedup optimistic message race condition
        if (msg.role === "user") {
          const tempIdx = messagesList.findIndex(m => String(m.id).startsWith("temp-") && m.content === msg.content);
          if (tempIdx !== -1) {
            messagesList[tempIdx].id = msg.id;
            return;
          }
        }

        if (msg.sender_name) setAgentName(msg.sender_name);
        touchActivity();
        messagesList.push(msg);
        renderMessages();

        // Badge de não lidas quando a janela está fechada
        if (msg.role !== "user" && !windowEl.classList.contains("open")) {
          setUnread(unreadCount + 1);
        }
      })
      .on("broadcast", { event: "session_closed" }, (payload) => {
        // Se o próprio visitante encerrou nesta aba, endSession já limpou o estado
        if (!activeSessionId) return;
        const closedByVisitor = payload && payload.payload && payload.payload.closed_by === 'visitor';
        endSession(closedByVisitor ? t('endedGeneric') : t('endedByAgent'), false);
      })
      .subscribe();
  }

  function renderInteractiveButtons(msg) {
    const interactive = msg.interactive || (msg.metadata && msg.metadata.interactive);
    if (!interactive) return "";

    let buttons = [];
    if (interactive.type === "button" && Array.isArray(interactive.buttons)) {
      buttons = interactive.buttons.map(b => ({ id: b.id, title: b.title || b.label }));
    } else if (interactive.type === "list" && Array.isArray(interactive.sections)) {
      const rows = interactive.sections.flatMap(s => s.rows || []);
      buttons = rows.map(r => ({ id: r.id, title: r.title, description: r.description }));
    }

    if (!buttons.length) return "";

    const buttonsHtml = buttons.map(btn => `
      <button class="traffio-chat-option-btn" data-btn-id="${escapeHtml(btn.id)}" data-btn-title="${escapeHtml(btn.title)}">
        <span class="traffio-chat-option-title">${escapeHtml(btn.title)}</span>
        ${btn.description ? `<span class="traffio-chat-option-desc">${escapeHtml(btn.description)}</span>` : ""}
      </button>
    `).join("");

    return `<div class="traffio-chat-interactive-options" data-msg-id="${escapeHtml(msg.id)}">${buttonsHtml}</div>`;
  }

  // Renderizar bolhas de mensagem na tela
  function renderMessages() {
    chatBody.innerHTML = "";
    messagesList.forEach((msg) => {
      const isVisitor = msg.role === "user";
      const bubbleEl = document.createElement("div");
      bubbleEl.className = `traffio-chat-bubble-msg ${isVisitor ? "visitor" : "agent"}`;

      const mediaUrl = safeUrl(msg.media_url);
      let mediaMarkup = "";
      if (msg.message_type === "image" && mediaUrl) {
        mediaMarkup = `<a href="${mediaUrl}" target="_blank" rel="noopener"><img src="${mediaUrl}" alt="Mídia" style="cursor:pointer;" /></a>`;
      } else if (msg.message_type === "video" && mediaUrl) {
        mediaMarkup = `<video src="${mediaUrl}" controls style="max-width:100%; border-radius:8px; margin-top:4px;"></video>`;
      } else if (msg.message_type === "document" && mediaUrl) {
        mediaMarkup = `
          <a class="file-link" href="${mediaUrl}" target="_blank" rel="noopener">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            ${escapeHtml(msg.file_name || t('downloadFile'))}
          </a>`;
      }

      const interactiveMarkup = renderInteractiveButtons(msg);
      const timeString = formatTime(msg.created_at);

      // Nome de quem enviou, acima das mensagens do atendente
      const senderLabel = (!isVisitor && msg.role === "human" && (msg.sender_name || agentName))
        ? `<div class="traffio-chat-agent-name">${escapeHtml(msg.sender_name || agentName)}</div>`
        : "";

      bubbleEl.innerHTML = `
        ${senderLabel}
        <div class="traffio-chat-bubble-text">${formatMessageText(msg.content || "")}</div>
        ${mediaMarkup}
        ${interactiveMarkup}
        <div class="traffio-chat-bubble-time">${timeString}</div>
      `;
      chatBody.appendChild(bubbleEl);
    });
    scrollToBottom();
  }

  // Listener delegado de clique em botões interativos
  chatBody.addEventListener("click", async (e) => {
    const btn = e.target.closest(".traffio-chat-option-btn");
    if (!btn || btn.disabled) return;

    const btnTitle = btn.getAttribute("data-btn-title");
    const btnId = btn.getAttribute("data-btn-id");
    if (!btnTitle || !activeSessionId) return;

    const container = btn.closest(".traffio-chat-interactive-options");
    if (container) {
      container.querySelectorAll(".traffio-chat-option-btn").forEach(b => {
        b.disabled = true;
        if (b === btn) b.classList.add("selected");
      });
    }

    chatInput.value = btnTitle;
    handleSendMessage(btnId || null);
  });

  function scrollToBottom() {
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  // ── Lógica de Upload / Seleção de Arquivos ──
  attachBtn.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validar tamanho máximo (5MB)
    if (file.size > 5 * 1024 * 1024) {
      showWidgetToast(t('fileTooLarge'));
      fileInput.value = "";
      return;
    }

    selectedFile = file;
    fileNameSpan.textContent = file.name;
    filePreview.style.display = "flex";
    sendBtn.disabled = false;
  });

  fileCancelBtn.addEventListener("click", () => {
    selectedFile = null;
    fileInput.value = "";
    filePreview.style.display = "none";
    sendBtn.disabled = !chatInput.value.trim();
  });

  // ── Envio de Mensagem ──
  async function handleSendMessage(buttonId = null) {
    const messageText = chatInput.value.trim();
    if (!messageText && !selectedFile) return;

    chatInput.value = "";
    sendBtn.disabled = true;
    touchActivity();

    // Limpar visual de anexo
    filePreview.style.display = "none";

    // Criar ID de mensagem temporário para otimização visual (Optimistic UI)
    const tempMsg = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: selectedFile ? (messageText || `[${selectedFile.type.split('/')[0]}]`) : messageText,
      message_type: selectedFile ? selectedFile.type.split('/')[0] : "text",
      media_url: selectedFile ? URL.createObjectURL(selectedFile) : null,
      file_name: selectedFile ? selectedFile.name : null,
      created_at: new Date().toISOString()
    };
    messagesList.push(tempMsg);
    renderMessages();

    try {
      let response;
      if (selectedFile) {
        // Envio com FormData para upload do anexo
        const formData = new FormData();
        formData.append("session_id", activeSessionId);
        formData.append("tenant_id", tenantId);
        formData.append("content", messageText);
        if (buttonId) formData.append("button_id", buttonId);
        formData.append("file", selectedFile);

        selectedFile = null;
        fileInput.value = "";

        response = await fetch(`${supabaseUrl}/functions/v1/livechat-visitor-message`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseAnonKey}`
          },
          body: formData
        });
      } else {
        // Envio JSON simples
        response = await fetch(`${supabaseUrl}/functions/v1/livechat-visitor-message`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseAnonKey}`
          },
          body: JSON.stringify({
            session_id: activeSessionId,
            tenant_id: tenantId,
            content: messageText,
            button_id: buttonId || null
          })
        });
      }

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      // Atualizar id oficial sem recarregar o histórico inteiro para evitar 
      // que a mensagem suma (pois pode estar apenas na fila message_inbox).
      const tempIdx = messagesList.findIndex((m) => m.id === tempMsg.id);
      if (tempIdx !== -1) {
        messagesList[tempIdx].id = data.message_id;
        // Se o broadcast do Realtime chegou antes do fetch terminar, remove a temporária
        const duplicateIdx = messagesList.findIndex((m, idx) => m.id === data.message_id && idx !== tempIdx);
        if (duplicateIdx !== -1) {
          messagesList.splice(tempIdx, 1);
        }
      }
      renderMessages();

    } catch (err) {
      console.error("Erro ao enviar mensagem:", err);
      // Remover a mensagem temporária em caso de falha
      messagesList = messagesList.filter((m) => m.id !== tempMsg.id);
      renderMessages();
      showWidgetToast(t('sendError') + err.message);
    }
  }

  sendBtn.addEventListener("click", handleSendMessage);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSendMessage();
    }
  });

})();
