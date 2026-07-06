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
    }
    .traffio-chat-status {
      display: flex;
      flex-direction: column;
    }
    .traffio-chat-status-title {
      font-size: 14px;
      font-weight: 700;
    }
    .traffio-chat-status-sub {
      font-size: 11px;
      opacity: 0.8;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .traffio-chat-status-dot {
      width: 6px;
      height: 6px;
      background: #10b981;
      border-radius: 50%;
      display: inline-block;
    }
    .traffio-chat-close {
      cursor: pointer;
      opacity: 0.8;
      transition: opacity 0.2s;
      background: transparent;
      border: none;
      color: white;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
    }
    .traffio-chat-close:hover {
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

  // 3. Criar os elementos HTML do widget
  const widgetContainer = document.createElement("div");
  widgetContainer.className = "traffio-chat-widget";
  widgetContainer.innerHTML = `
    <div class="traffio-chat-pill" id="traffio-pill">Fale conosco</div>
    <div class="traffio-chat-bubble" id="traffio-bubble">
      <svg viewBox="0 0 24 24">
        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
      </svg>
    </div>
    <div class="traffio-chat-window" id="traffio-window">
      <div class="traffio-chat-header">
        <div class="traffio-chat-header-info">
          <div class="traffio-chat-avatar">T</div>
          <div class="traffio-chat-status">
            <span class="traffio-chat-status-title">Atendimento Online</span>
            <span class="traffio-chat-status-sub"><span class="traffio-chat-status-dot"></span>Fale conosco</span>
          </div>
        </div>
        <button class="traffio-chat-close" id="traffio-close">×</button>
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
    </div>
  `;
  document.body.appendChild(widgetContainer);

  // 4. Lógica de controle de estado do widget
  const bubble = document.getElementById("traffio-bubble");
  const pill = document.getElementById("traffio-pill");
  const windowEl = document.getElementById("traffio-window");
  const closeBtn = document.getElementById("traffio-close");
  const chatBody = document.getElementById("traffio-chat-body");
  const chatFooter = document.getElementById("traffio-chat-footer");
  const chatInput = document.getElementById("traffio-chat-input");
  const sendBtn = document.getElementById("traffio-send-btn");
  const attachBtn = document.getElementById("traffio-attach-btn");
  const fileInput = document.getElementById("traffio-file-input");
  const filePreview = document.getElementById("traffio-file-preview");
  const fileNameSpan = document.getElementById("traffio-file-name");
  const fileCancelBtn = document.getElementById("traffio-file-cancel");

  let supabaseClient = null;
  let activeSessionId = localStorage.getItem("traffio_livechat_session_id");
  if (activeSessionId === "undefined" || activeSessionId === "null" || activeSessionId === "") {
    activeSessionId = null;
    localStorage.removeItem("traffio_livechat_session_id");
  }
  let visitorName = localStorage.getItem("traffio_livechat_name");
  if (visitorName === "undefined" || visitorName === "null" || visitorName === "") {
    visitorName = null;
    localStorage.removeItem("traffio_livechat_name");
  }
  let selectedFile = null;
  let messagesList = [];

  // Toggle de exibição da janela do chat
  function toggleChatWindow() {
    windowEl.classList.toggle("open");
    const isOpen = windowEl.classList.contains("open");
    if (isOpen) {
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
    is_active: true
  };

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

  async function initSupabase() {
    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn("[Traffio LiveChat] Supabase URL ou Anon Key ausentes. O realtime pode não funcionar.");
      // Exibe com defaults caso falhe
      widgetContainer.style.display = "block";
      if (activeSessionId) {
        showChatScreen();
        loadHistory();
      } else {
        showRegistrationForm();
      }
      return;
    }
    if (!window._traffioSupabaseClient) {
      window._traffioSupabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    }
    supabaseClient = window._traffioSupabaseClient;
    
    // Buscar configurações do banco de dados (bypass RLS se ativo)
    try {
      const { data, error } = await supabaseClient
        .from('tenant_livechat_configs')
        .select('primary_color, welcome_title, welcome_subtitle, pill_text, is_active')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        chatConfig = data;
      }
    } catch (err) {
      console.error("[Traffio LiveChat] Erro ao carregar configurações:", err);
    }

    // Aplicar a configuração recebida
    applyDynamicConfig();

    if (chatConfig.is_active) {
      if (activeSessionId) {
        showChatScreen();
        loadHistory();
        subscribeToRealtime();
      } else {
        showRegistrationForm();
      }
    }
  }

  function applyDynamicConfig() {
    if (!chatConfig.is_active) {
      widgetContainer.style.display = "none";
      return;
    }
    
    widgetContainer.style.display = "block";

    // Injetar variável CSS para a cor primária
    const primaryColor = chatConfig.primary_color || '#1152d4';
    style.textContent += `
      :root {
        --traffio-chat-primary: ${primaryColor} !important;
      }
    `;

    // Atualizar títulos no formulário de registro, se visível
    const formTitle = document.getElementById("traffio-form-title-el");
    if (formTitle) {
      formTitle.textContent = chatConfig.welcome_title || 'Iniciar Atendimento';
    }
    const formSubtitle = document.getElementById("traffio-form-subtitle-el");
    if (formSubtitle) {
      formSubtitle.textContent = chatConfig.welcome_subtitle || 'Preencha os campos abaixo...';
    }
    const chatPill = document.getElementById("traffio-pill");
    if (chatPill) {
      chatPill.textContent = chatConfig.pill_text || 'Fale conosco';
    }
  }

  // Iniciar carregamento imediatamente
  loadSupabaseAndConnect();

  // ── Renderizador do Formulário de Registro ──
  function showRegistrationForm() {
    chatFooter.style.display = "none";
    chatBody.innerHTML = `
      <div class="traffio-chat-form-container">
        <h3 class="traffio-chat-form-title" id="traffio-form-title-el">${chatConfig.welcome_title || 'Iniciar Atendimento'}</h3>
        <p class="traffio-chat-form-subtitle" id="traffio-form-subtitle-el">${chatConfig.welcome_subtitle || 'Preencha os campos abaixo para conversar em tempo real com a nossa equipe.'}</p>
        
        <form id="traffio-reg-form">
          <div class="traffio-chat-form-group">
            <label for="traffio-reg-name">Seu Nome *</label>
            <input type="text" id="traffio-reg-name" required placeholder="Digite seu nome completo" />
          </div>
          <div class="traffio-chat-form-group" style="margin-top: 10px;">
            <label for="traffio-reg-email">E-mail *</label>
            <input type="email" id="traffio-reg-email" required placeholder="exemplo@email.com" />
          </div>
          <div class="traffio-chat-form-group" style="margin-top: 10px;">
            <label for="traffio-reg-phone">Telefone (Mobile) *</label>
            <input type="tel" id="traffio-reg-phone" required placeholder="Ex: +64 21 000 0000" />
          </div>
          <button type="submit" class="traffio-chat-form-btn" id="traffio-reg-submit">Começar Chat</button>
        </form>
      </div>
    `;

    const regForm = document.getElementById("traffio-reg-form");
    regForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("traffio-reg-submit");
      submitBtn.disabled = true;
      submitBtn.textContent = "Conectando...";

      const nameVal = document.getElementById("traffio-reg-name").value;
      const emailVal = document.getElementById("traffio-reg-email").value;
      const phoneVal = document.getElementById("traffio-reg-phone").value;

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
            content: "Olá! Iniciei o atendimento no chat."
          })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        activeSessionId = data.session_id;
        visitorName = nameVal;

        localStorage.setItem("traffio_livechat_session_id", activeSessionId);
        localStorage.setItem("traffio_livechat_name", visitorName);

        showChatScreen();
        loadHistory();
        loadSupabaseAndConnect();

      } catch (error) {
        alert("Erro ao conectar: " + error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = "Começar Chat";
      }
    });
  }

  // ── Renderizador da Tela de Chat ──
  function showChatScreen() {
    chatBody.innerHTML = "";
    chatFooter.style.display = "block";
  }

  function clearSession() {
    activeSessionId = null;
    visitorName = null;
    localStorage.removeItem("traffio_livechat_session_id");
    localStorage.removeItem("traffio_livechat_name");
    showRegistrationForm();
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

  // Inscrever-se via Supabase Realtime Broadcast
  function subscribeToRealtime() {
    if (!supabaseClient) return;

    const channel = supabaseClient.channel(`livechat:${activeSessionId}`);
    channel
      .on("broadcast", { event: "message" }, (payload) => {
        const msg = payload.payload;
        // Impedir duplicação de mensagens enviadas por si mesmo
        if (messagesList.some((m) => m.id === msg.id)) return;

        messagesList.push(msg);
        renderMessages();
      })
      .subscribe();
  }

  // Renderizar bolhas de mensagem na tela
  function renderMessages() {
    chatBody.innerHTML = "";
    messagesList.forEach((msg) => {
      const isVisitor = msg.role === "user";
      const bubbleEl = document.createElement("div");
      bubbleEl.className = `traffio-chat-bubble-msg ${isVisitor ? "visitor" : "agent"}`;

      let mediaMarkup = "";
      if (msg.message_type === "image") {
        mediaMarkup = `<img src="${msg.media_url}" alt="Mídia" onclick="window.open('${msg.media_url}', '_blank')" style="cursor:pointer;" />`;
      } else if (msg.message_type === "video") {
        mediaMarkup = `<video src="${msg.media_url}" controls style="max-width:100%; border-radius:8px; margin-top:4px;"></video>`;
      } else if (msg.message_type === "document") {
        mediaMarkup = `
          <a class="file-link" href="${msg.media_url}" target="_blank">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            ${msg.file_name || "Baixar arquivo"}
          </a>`;
      }

      const timeString = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      bubbleEl.innerHTML = `
        <div>${msg.content || ""}</div>
        ${mediaMarkup}
        <div class="traffio-chat-bubble-time">${timeString}</div>
      `;
      chatBody.appendChild(bubbleEl);
    });
    scrollToBottom();
  }

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
      alert("O arquivo excede o limite máximo de 5MB.");
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
  async function handleSendMessage() {
    const messageText = chatInput.value.trim();
    if (!messageText && !selectedFile) return;

    chatInput.value = "";
    sendBtn.disabled = true;

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
            content: messageText
          })
        });
      }

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      // Atualizar id e data oficiais do banco
      await loadHistory();

    } catch (err) {
      console.error("Erro ao enviar mensagem:", err);
      // Remover a mensagem temporária em caso de falha
      messagesList = messagesList.filter((m) => m.id !== tempMsg.id);
      renderMessages();
      alert("Erro ao enviar mensagem: " + err.message);
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
