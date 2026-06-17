/* =============================================================================
 * Mediflow / Traffio — Widget de Agendamento Embarcável (v1 Core)
 * -----------------------------------------------------------------------------
 * Web Component <mediflow-booking data-key="pk_live_..."> com Shadow DOM.
 * - Conversão SECUNDÁRIA: botão flutuante (FAB) → drawer onboarding.
 * - Config (tema/idioma/FAB/pixel/LGPD/Turnstile) resolvida no servidor a partir da key.
 * - Consome a API pública `public-booking`. Dispara eventos no documento PAI.
 * - Foco no público +50: alto contraste, fontes grandes, 1 decisão por tela,
 *   avanço automático com confirmação, transição suave, "Voltar" destacado.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.customElements && customElements.get('mediflow-booking')) return;

  var DEFAULT_API = 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/public-booking';

  /* ---------------- i18n (strings essenciais do fluxo) ---------------- */
  var I18N = {
    'pt-BR': {
      fabDefault: 'Agendar', headTitle: 'Agendar consulta', headSub: 'É rápido e simples',
      qSpecialty: 'O que você precisa?', qDoctor: 'Com qual profissional?',
      qDate: 'Qual dia fica melhor?', qDateHint: 'Mostramos os próximos dias com vaga.',
      qSlot: 'Qual horário fica bom?', qData: 'Como podemos te chamar?',
      moreDates: '📅 Ver mais datas no calendário', backToList: '‹ Voltar às datas sugeridas',
      calTitle: 'Escolha a data exata', legendOn: 'Disponível', legendOff: 'Sem vaga',
      name: 'Nome completo', phone: 'Telefone', email: 'E-mail',
      emailHint: '— enviaremos a confirmação aqui', namePh: 'Seu nome', emailPh: 'voce@email.com',
      hintTap: 'Toque em uma opção para continuar', cont: 'Continuar', back: '‹ Voltar e corrigir',
      confirm: 'Confirmar meu agendamento', step: 'Passo', of: 'de',
      successT: 'Tudo certo! 🎉', successP: 'Sua consulta foi agendada.\nEnviamos a confirmação para o seu e-mail.',
      close: 'Fechar', today: 'Hoje', tomorrow: 'Amanhã', loading: 'Carregando…',
      errGeneric: 'Algo deu errado. Tente novamente.', errSlot: 'Esse horário acabou de ser reservado. Escolha outro 👇',
      noSlots: 'Nenhum horário disponível neste dia.', noDates: 'Não encontramos vagas online no momento.',
      weekdays: ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'],
      weekdaysShort: ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'],
      months: ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
    },
    'en': {
      fabDefault: 'Book now', headTitle: 'Book an appointment', headSub: 'Quick and simple',
      qSpecialty: 'What do you need?', qDoctor: 'Which provider?',
      qDate: 'Which day works best?', qDateHint: 'We only show days with availability.',
      qSlot: 'Which time works?', qData: 'How can we reach you?',
      moreDates: '📅 See more dates on the calendar', backToList: '‹ Back to suggested dates',
      calTitle: 'Pick the exact date', legendOn: 'Available', legendOff: 'Unavailable',
      name: 'Full name', phone: 'Phone', email: 'Email',
      emailHint: '— we will send the confirmation here', namePh: 'Your name', emailPh: 'you@email.com',
      hintTap: 'Tap an option to continue', cont: 'Continue', back: '‹ Go back and edit',
      confirm: 'Confirm my appointment', step: 'Step', of: 'of',
      successT: 'All set! 🎉', successP: 'Your appointment is booked.\nWe sent the confirmation to your email.',
      close: 'Close', today: 'Today', tomorrow: 'Tomorrow', loading: 'Loading…',
      errGeneric: 'Something went wrong. Please try again.', errSlot: 'That time was just taken. Please pick another 👇',
      noSlots: 'No times available for this day.', noDates: 'No online availability right now.',
      weekdays: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
      weekdaysShort: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
      months: ['January','February','March','April','May','June','July','August','September','October','November','December']
    }
  };
  function dict(locale) { return I18N[locale] || (locale && locale.indexOf('en') === 0 ? I18N['en'] : I18N['pt-BR']); }

  var PHONE = {
    BR: { ph: '(11) 90000-0000', fmt: function (v) { v = v.replace(/\D/g, '').slice(0, 11); var o = ''; if (v.length > 0) o = '(' + v.slice(0, 2); if (v.length >= 2) o += ') ' + v.slice(2, 7); if (v.length >= 7) o += '-' + v.slice(7, 11); return o; } },
    US: { ph: '(555) 555-5555', fmt: function (v) { v = v.replace(/\D/g, '').slice(0, 10); var o = ''; if (v.length > 0) o = '(' + v.slice(0, 3); if (v.length >= 3) o += ') ' + v.slice(3, 6); if (v.length >= 6) o += '-' + v.slice(6, 10); return o; } },
    NZ: { ph: '021 123 4567', fmt: function (v) { v = v.replace(/\D/g, '').slice(0, 10); return v.replace(/(\d{3})(\d{0,3})(\d{0,4})/, function (m, a, b, c) { return [a, b, c].filter(Boolean).join(' '); }); } }
  };

  /* ---------------- paleta: 1 cor → derivada + contraste AAA ---------------- */
  function hexToRgb(h) { h = (h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); var n = parseInt(h || '0E7C7B', 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
  function lum(c) { var a = [c.r, c.g, c.b].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
  function contrast(L1, L2) { var a = Math.max(L1, L2), b = Math.min(L1, L2); return (a + 0.05) / (b + 0.05); }
  function adjust(c, f) { var k = f < 0 ? 0 : 255, t = Math.abs(f); return { r: Math.round(c.r + (k - c.r) * t), g: Math.round(c.g + (k - c.g) * t), b: Math.round(c.b + (k - c.b) * t) }; }
  function rgb(c) { return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')'; }
  function palette(hex) {
    var c = hexToRgb(hex), L = lum(c);
    var on = contrast(L, 1.0) >= 4.5 ? '#ffffff' : '#0b1220';
    var usable = c; if (contrast(L, 1.0) < 3.0) usable = adjust(c, -0.35);
    return { primary: rgb(usable), hover: rgb(adjust(usable, -0.2)), on: on, soft: 'rgba(' + usable.r + ',' + usable.g + ',' + usable.b + ',.12)' };
  }

  var CSS = '\
:host{all:initial}\
*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}\
.fab{position:fixed;bottom:26px;z-index:2147483000;display:inline-flex;align-items:center;gap:12px;height:64px;padding:0 26px 0 22px;border-radius:999px;cursor:pointer;font-size:19px;font-weight:800;letter-spacing:-.01em;border:2px solid transparent;box-shadow:0 12px 30px rgba(11,18,32,.18);transition:transform .15s,box-shadow .15s;animation:fabIn .5s cubic-bezier(.2,.8,.2,1) both}\
.fab:hover{transform:translateY(-2px)}\
.fab[data-pos=bottom-right]{right:26px}.fab[data-pos=bottom-left]{left:26px}\
.fab.solid{background:var(--p);color:var(--on)}\
.fab.soft{background:#fff;color:var(--p);border-color:var(--soft);box-shadow:0 12px 30px rgba(11,18,32,.12)}\
.fab.outline{background:#fff;color:var(--p);border-color:var(--p)}\
.fab svg{width:24px;height:24px}\
@keyframes fabIn{from{opacity:0;transform:translateY(20px) scale(.9)}}\
.ov{position:fixed;inset:0;background:rgba(11,18,32,.5);z-index:2147483001;opacity:0;pointer-events:none;transition:opacity .25s}\
.ov.open{opacity:1;pointer-events:auto}\
.dw{position:fixed;top:0;right:0;height:100%;width:460px;max-width:100vw;background:#fff;z-index:2147483002;transform:translateX(100%);transition:transform .32s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;box-shadow:-20px 0 60px rgba(11,18,32,.25)}\
.dw.open{transform:translateX(0)}\
@media(max-width:520px){.dw{width:100vw;top:auto;bottom:0;height:92vh;border-radius:22px 22px 0 0;transform:translateY(100%)}.dw.open{transform:translateY(0)}}\
.hd{padding:22px 24px 14px;border-bottom:1px solid #e4e9f1;display:flex;align-items:center;gap:14px}\
.hd .lg{width:40px;height:40px;border-radius:12px;background:var(--p);color:var(--on);display:grid;place-items:center}\
.hd h2{margin:0;font-size:19px;color:#0b1220}.hd .sb{margin:2px 0 0;font-size:14px;color:#44506a}\
.cl{margin-left:auto;width:44px;height:44px;border-radius:12px;border:1px solid #d3dae6;background:#fff;cursor:pointer;font-size:22px;color:#44506a}\
.st{display:flex;gap:6px;padding:14px 24px 0}.st i{flex:1;height:6px;border-radius:999px;background:#d3dae6}.st i.on{background:var(--p)}\
.sl{padding:8px 24px 0;font-size:13px;font-weight:800;color:#44506a;text-transform:uppercase;letter-spacing:.08em}\
.bd{padding:18px 24px 24px;overflow-y:auto;overflow-x:hidden;flex:1}\
.q{font-size:24px;font-weight:800;letter-spacing:-.02em;margin:6px 0 18px;color:#0b1220}\
.hint{color:#44506a;font-size:16px;margin:-8px 0 16px}\
.opt{width:100%;display:flex;align-items:center;gap:16px;text-align:left;cursor:pointer;background:#fff;border:2px solid #d3dae6;border-radius:18px;padding:18px;margin-bottom:14px;min-height:76px;transition:border-color .15s,background .15s,transform .1s}\
.opt:hover{border-color:var(--p)}.opt:active{transform:scale(.99)}.opt.sel{border-color:var(--p);background:var(--soft)}\
.opt .ic{width:52px;height:52px;border-radius:14px;background:var(--soft);color:var(--p);display:grid;place-items:center;flex:none}\
.opt .ic svg{width:28px;height:28px}\
.opt .tx{display:flex;flex-direction:column;gap:3px}\
.opt .t{font-size:19px;font-weight:800;color:#0b1220;line-height:1.2}.opt .s{font-size:15px;color:#44506a;line-height:1.3}\
.opt .ck{margin-left:auto;width:28px;height:28px;border-radius:999px;border:2px solid #d3dae6;display:grid;place-items:center;color:#fff;flex:none}\
.opt.sel .ck{background:var(--p);border-color:var(--p)}\
.more{width:100%;padding:16px;border:2px dashed #d3dae6;border-radius:18px;background:#fff;color:var(--p);font-size:16px;font-weight:800;cursor:pointer}\
.more:hover{border-color:var(--p);background:var(--soft)}\
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}\
.slot{padding:16px 8px;border:2px solid #d3dae6;border-radius:14px;background:#fff;font-size:18px;font-weight:800;cursor:pointer;color:#0b1220}\
.slot:hover,.slot.sel{border-color:var(--p);color:var(--p);background:var(--soft)}\
.fld{margin-bottom:16px}.fld label{display:block;font-size:15px;font-weight:800;margin-bottom:7px;color:#0b1220}\
.fld .lh{color:#44506a;font-weight:600}\
.fld input{width:100%;height:56px;border:2px solid #d3dae6;border-radius:14px;padding:0 16px;font-size:18px}\
.fld input:focus{outline:3px solid var(--soft);border-color:var(--p)}\
.ft{padding:16px 24px 22px;border-top:1px solid #e4e9f1}\
.bp{width:100%;height:60px;border:none;border-radius:16px;background:var(--p);color:var(--on);font-size:19px;font-weight:800;cursor:pointer}\
.bp:hover{background:var(--hover)}.bp:disabled{opacity:.45;cursor:default}\
.bb{width:100%;height:52px;border:2px solid #d98a8a;border-radius:14px;background:#fdecec;color:#b42318;font-size:16px;font-weight:800;cursor:pointer;margin-top:8px}\
.bb:hover{background:#fbdcdc;border-color:#b42318}\
.fh{text-align:center;color:#44506a;font-size:15px;font-weight:600;margin:14px 0 6px}\
.err{background:#fdecec;border:1px solid #f3c0c0;color:#b42318;border-radius:12px;padding:12px 14px;font-size:15px;font-weight:600;margin-bottom:14px}\
.spin{width:40px;height:40px;border:3px solid #e4e9f1;border-top-color:var(--p);border-radius:999px;animation:sp .8s linear infinite;margin:40px auto}\
@keyframes sp{to{transform:rotate(360deg)}}\
.suc{text-align:center;padding:30px 10px}.suc .rg{width:92px;height:92px;border-radius:999px;background:#e7f8ec;color:#1ca54c;display:grid;place-items:center;margin:0 auto 18px}\
.suc h3{font-size:26px;margin:0 0 6px;color:#0b1220}.suc p{color:#44506a;font-size:17px;margin:0;white-space:pre-line}\
.calh{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.calh .ml{font-size:20px;font-weight:800;color:#0b1220}\
.cn{width:52px;height:52px;border-radius:14px;border:2px solid #d3dae6;background:#fff;font-size:26px;cursor:pointer;color:#0b1220}.cn:disabled{opacity:.3;cursor:default}\
.cg{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}\
.cw{text-align:center;font-size:12px;font-weight:800;color:#44506a;text-transform:uppercase;padding-bottom:4px}\
.cc{height:50px;border-radius:12px;border:2px solid transparent;background:transparent;font-size:18px;font-weight:800;color:#c2cad8;cursor:default}\
.cc.av{background:var(--soft);color:var(--p);cursor:pointer}.cc.av:hover{border-color:var(--p)}.cc.sel{background:var(--p);color:var(--on)}\
.clb{background:none;border:none;color:var(--p);font-weight:800;font-size:15px;cursor:pointer;padding:0 0 12px}\
.lg2{display:flex;gap:18px;margin-top:16px;font-size:14px;color:#44506a;font-weight:600}.lg2 i{display:inline-block;width:16px;height:16px;border-radius:5px;vertical-align:-3px;margin-right:7px}\
@keyframes mf-fwd{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}\
@keyframes mf-back{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}\
@media(prefers-reduced-motion:reduce){.fab,.dw,.ov{animation:none!important;transition:opacity .15s!important}.bd{animation:none!important}}';

  var IC = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    stet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v6a6 6 0 0 0 12 0V3"/><circle cx="18" cy="16" r="3"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
  };

  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseISO(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }

  class MediflowBooking extends HTMLElement {
    connectedCallback() {
      if (this._init) return; this._init = true;
      this.key = this.getAttribute('data-key');
      this.api = this.getAttribute('data-api') || DEFAULT_API;
      this.presetSpecialty = (this.getAttribute('data-specialty') || '').trim();
      this.presetDoctor = (this.getAttribute('data-doctor') || '').trim();
      this.root = this.attachShadow({ mode: 'open' });
      this.state = { step: 0, last: 0, view: 'list', calY: 0, calM: 0, conv: false };
      this.cache = {};
      this.turnstileToken = null;
      this.turnstileId = undefined;
      if (!this.key) { console.error('[mediflow-booking] data-key ausente'); return; }
      this.boot();
    }

    async boot() {
      try {
        this.cfg = await this.call('config', {});
      } catch (e) { console.error('[mediflow-booking] config falhou', e); return; }
      this.T = dict(this.cfg.locale);
      this.country = (this.cfg.country || 'BR').toUpperCase();
      if (!PHONE[this.country]) this.country = 'BR';
      var p = palette(this.cfg.theme && this.cfg.theme.primary_color);
      var st = document.createElement('style'); st.textContent = CSS;
      this.wrap = document.createElement('div');
      this.wrap.style.setProperty('--p', p.primary);
      this.wrap.style.setProperty('--hover', p.hover);
      this.wrap.style.setProperty('--on', p.on);
      this.wrap.style.setProperty('--soft', p.soft);
      this.root.appendChild(st); this.root.appendChild(this.wrap);
      
      // Remove mock loader button if it exists in the outer document
      var mockBtn = document.querySelector('.mf-loader-fab');
      if (mockBtn) mockBtn.remove();

      this.renderFab();
    }

    async call(action, params) {
      var body = Object.assign({ action: action, key: this.key }, params);
      var res = await fetch(this.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    track(event, params) {
      var base = { tenant: this.cfg && this.cfg.tenant ? this.cfg.tenant.slug : undefined };
      var p = Object.assign(base, params || {});
      try { window.dataLayer = window.dataLayer || []; window.dataLayer.push(Object.assign({ event: event }, p)); } catch (e) {}
    }

    /* ---------------- FAB ---------------- */
    renderFab() {
      var fab = this.cfg.fab || {};
      var b = el('<button class="fab ' + (fab.style || 'soft') + '" data-pos="' + (fab.position || 'bottom-right') + '">' + IC.cal + '<span></span></button>');
      b.querySelector('span').textContent = fab.label || this.T.fabDefault;
      var self = this;
      var show = function () { b.style.display = ''; };
      if (fab.delay_ms && fab.delay_ms > 0) { b.style.display = 'none'; setTimeout(show, fab.delay_ms); }
      b.addEventListener('click', function () { self.open(); });
      this.fab = b; this.wrap.appendChild(b);
    }

    /* ---------------- Drawer ---------------- */
    ensureDrawer() {
      if (this.dw) return;
      var T = this.T;
      this.ov = el('<div class="ov"></div>');
      this.dw = el('<div class="dw" role="dialog" aria-label="' + T.headTitle + '">\
<div class="hd"><div class="lg">' + IC.cal + '</div><div><h2>' + T.headTitle + '</h2><p class="sb">' + T.headSub + '</p></div>\
<button class="cl" aria-label="' + T.close + '">×</button></div>\
<div class="st"><i></i><i></i><i></i><i></i><i></i></div><div class="sl"></div>\
<div class="bd"></div><div class="ft"></div></div>');
      var self = this;
      this.ov.addEventListener('click', function () { self.close(); });
      this.dw.querySelector('.cl').addEventListener('click', function () { self.close(); });
      this.bd = this.dw.querySelector('.bd');
      this.ft = this.dw.querySelector('.ft');
      this.stEls = this.dw.querySelectorAll('.st i');
      this.slEl = this.dw.querySelector('.sl');
      this.bd.addEventListener('click', function (e) { self.onBodyClick(e); });
      this.ft.addEventListener('click', function (e) { self.onFootClick(e); });
      this.wrap.appendChild(this.ov); this.wrap.appendChild(this.dw);
    }

    async open() {
      this.ensureDrawer();
      this.state = { step: 0, last: 0, view: 'list', calY: 0, calM: 0, conv: false };
      this.sel = {};
      this.ov.classList.add('open'); this.dw.classList.add('open');
      this.track('booking_widget_open');
      this.renderLoading();

      // Se tiver médico pré-definido, pula direto para a seleção de datas (Step 2)
      if (this.presetDoctor) {
        this.sel.doctorId = this.presetDoctor;
        this.go(2);
        var loadDatesPromise = this.loadDates();
        try {
          var docsData = await this.call('doctors', {});
          var docs = docsData.doctors || [];
          var docObj = docs.find(d => d.id === this.presetDoctor);
          if (docObj) {
            this.sel.doctor = docObj;
            this.sel.specialty = docObj.specialty;
          }
        } catch (e) {
          console.error('[mediflow-booking] erro ao obter médico', e);
        }
        await loadDatesPromise;
        if (this.state.step === 2) this.render();
        return;
      }

      // Se tiver especialidade pré-definida, pula direto para a busca de médicos (Step 1)
      if (this.presetSpecialty) {
        this.pickSpecialty(this.presetSpecialty);
        return;
      }

      try { this.cache.specialties = (await this.call('specialties', {})).specialties || []; }
      catch (e) { this.renderError(); return; }
      // auto-skip se só houver 1 especialidade
      if (this.cache.specialties.length === 1) { this.pickSpecialty(this.cache.specialties[0].name); }
      else this.render();
    }
    close() {
      var self = this; this.ov.classList.remove('open'); this.dw.classList.remove('open');
      setTimeout(function () { self.state.step = 0; self.state.last = 0; }, 300);
    }

    animate(dir) {
      this.bd.style.animation = 'none'; void this.bd.offsetWidth;
      this.bd.style.animation = (dir === 'back'
        ? 'mf-back .3s cubic-bezier(.2,.8,.2,1)' : 'mf-fwd .3s cubic-bezier(.2,.8,.2,1)');
    }

    renderLoading() { this.bd.innerHTML = '<div class="spin"></div>'; this.ft.innerHTML = ''; this.slEl.textContent = ''; }
    renderError(msg) { this.bd.innerHTML = '<div class="err">' + (msg || this.T.errGeneric) + '</div>'; this.ft.innerHTML = '<button class="bb" data-act="retry">' + this.T.back + '</button>'; }

    /* ---------------- Steps ---------------- */
    // 0 especialidade · 1 profissional · 2 data · 3 horário · 4 dados · 5 sucesso
    render() {
      var T = this.T, s = this.state, dir = s.step > s.last ? 'fwd' : (s.step < s.last ? 'back' : null);
      for (var i = 0; i < this.stEls.length; i++) this.stEls[i].classList.toggle('on', i <= s.step);
      this.slEl.textContent = s.step < 5 ? (T.step + ' ' + (s.step + 1) + ' ' + T.of + ' 5') : '';

      if (s.step === 0) this.renderSpecialty();
      else if (s.step === 1) this.renderDoctor();
      else if (s.step === 2) this.renderDate();
      else if (s.step === 3) this.renderSlot();
      else if (s.step === 4) this.renderData();
      else this.renderSuccess();

      if (dir) this.animate(dir);
      s.last = s.step;
    }

    choiceFoot(canBack) {
      var T = this.T;
      return '<p class="fh">' + T.hintTap + '</p>' + (canBack ? '<button class="bb" data-act="back">' + T.back + '</button>' : '');
    }

    renderSpecialty() {
      var T = this.T, list = this.cache.specialties || [];
      var selSp = this.sel.specialty;
      this.bd.innerHTML = '<div class="q">' + T.qSpecialty + '</div>' + list.map(function (sp) {
        return '<button class="opt' + (sp.name === selSp ? ' sel' : '') + '" data-sp="' + esc(sp.name) + '"><span class="ic">' + IC.stet + '</span><span class="tx"><span class="t">' + esc(sp.name) + '</span><span class="s">' + sp.count + (sp.count === 1 ? ' profissional' : ' profissionais') + '</span></span><span class="ck">' + IC.check + '</span></button>';
      }).join('');
      this.ft.innerHTML = this.choiceFoot(false);
    }
    renderDoctor() {
      var T = this.T;
      if (!this.cache.doctors) { this.bd.innerHTML = '<div class="q">' + T.qDoctor + '</div><div class="spin"></div>'; this.ft.innerHTML = this.choiceFoot(true); return; }
      var list = this.cache.doctors, selD = this.sel.doctorId;
      this.bd.innerHTML = '<div class="q">' + T.qDoctor + '</div>' + list.map(function (d) {
        return '<button class="opt' + (d.id === selD ? ' sel' : '') + '" data-doc="' + d.id + '"><span class="ic">' + IC.user + '</span><span class="tx"><span class="t">' + esc(d.full_name) + '</span><span class="s">' + esc(d.specialty || '') + '</span></span><span class="ck">' + IC.check + '</span></button>';
      }).join('');
      this.ft.innerHTML = this.choiceFoot(true);
    }
    renderDate() {
      var T = this.T, s = this.state, self = this;
      if (!this.cache.dates) { this.bd.innerHTML = '<div class="q">' + T.qDate + '</div><div class="spin"></div>'; this.ft.innerHTML = this.choiceFoot(true); return; }
      if (s.view === 'calendar') { this.bd.innerHTML = '<div class="q">' + T.calTitle + '</div>' + this.calHTML(); this.ft.innerHTML = this.choiceFoot(true); return; }
      var list = this.cache.dates.slice(0, 14);
      if (list.length === 0) { this.bd.innerHTML = '<div class="err">' + T.noDates + '</div>'; this.ft.innerHTML = '<button class="bb" data-act="back">' + T.back + '</button>'; return; }
      var selDate = this.sel.date;
      this.bd.innerHTML = '<div class="q">' + T.qDate + '</div><p class="hint">' + T.qDateHint + '</p>' + list.map(function (d) {
        var L = self.dateLabel(d.date);
        return '<button class="opt' + (d.date === selDate ? ' sel' : '') + '" data-date="' + d.date + '" data-loc="' + (d.location_id || '') + '"><span class="ic">' + IC.cal + '</span><span class="tx"><span class="t">' + L.t + '</span><span class="s">' + L.s + (d.location_name ? ' · ' + esc(d.location_name) : '') + '</span></span><span class="ck">' + IC.check + '</span></button>';
      }).join('') + '<button class="more" data-act="cal">' + T.moreDates + '</button>';
      this.ft.innerHTML = this.choiceFoot(true);
    }
    renderSlot() {
      var T = this.T;
      if (!this.cache.slots) { this.bd.innerHTML = '<div class="q">' + T.qSlot + '</div><div class="spin"></div>'; this.ft.innerHTML = '<button class="bb" data-act="back">' + T.back + '</button>'; return; }
      var list = this.cache.slots;
      var body = '<div class="q">' + T.qSlot + '</div>';
      if (this.sel.date) { var L = this.dateLabel(this.sel.date); body += '<p class="hint">' + L.t + ' · ' + L.s + '</p>'; }
      if (this._err) { body += '<div class="err">' + this._err + '</div>'; this._err = null; }
      if (list.length === 0) body += '<div class="err">' + T.noSlots + '</div>';
      else body += '<div class="grid">' + list.map(function (sl) { return '<button class="slot" data-slot="' + sl.slot_time + '" data-end="' + (sl.slot_end || '') + '">' + sl.slot_time.slice(0, 5) + '</button>'; }).join('') + '</div>';
      this.bd.innerHTML = body;
      this.ft.innerHTML = '<button class="bb" data-act="back">' + T.back + '</button>';
    }
    renderData() {
      var T = this.T, ph = PHONE[this.country].ph;
      var html = '<div class="q">' + T.qData + '</div>' +
        '<div class="fld"><label>' + T.name + '</label><input id="mf-name" placeholder="' + T.namePh + '"/></div>' +
        '<div class="fld"><label>' + T.phone + '</label><input id="mf-phone" inputmode="tel" placeholder="' + ph + '"/></div>' +
        '<div class="fld"><label>' + T.email + ' <span class="lh">' + T.emailHint + '</span></label><input id="mf-email" type="email" inputmode="email" placeholder="' + T.emailPh + '"/></div>';

      if (this.cfg.privacy_policy_url) {
        html += '<div style="margin: 20px 0 10px; display: flex; gap: 10px; align-items: flex-start; text-align: left;">' +
          '<input type="checkbox" id="mf-lgpd" style="width: 20px; height: 20px; cursor: pointer; flex-shrink: 0; margin-top: 2px;" />' +
          '<label for="mf-lgpd" style="font-size: 14px; color: #44506a; font-weight: 500; cursor: pointer; user-select: none; line-height: 1.4;">' +
          'Concordo com a coleta de dados e com a <a href="' + this.cfg.privacy_policy_url + '" target="_blank" style="color: var(--p); text-decoration: underline;">Política de Privacidade</a>.' +
          '</label></div>';
      }

      if (this.cfg.turnstile_sitekey) {
        html += '<div id="mf-turnstile" style="margin: 20px 0 10px; display: flex; justify-content: center; min-height: 65px;"></div>';
      }

      this.bd.innerHTML = html;
      this.ft.innerHTML = '<button class="bp" data-act="book">' + T.confirm + '</button><button class="bb" data-act="back">' + T.back + '</button>';

      var self = this, pe = this.bd.querySelector('#mf-phone'), btn = this.ft.querySelector('[data-act=book]');
      pe.addEventListener('input', function () { pe.value = PHONE[self.country].fmt(pe.value); });

      // LGPD constraint
      var lgpd = this.bd.querySelector('#mf-lgpd');
      if (lgpd && btn) {
        btn.disabled = true;
        lgpd.addEventListener('change', function () {
          btn.disabled = !lgpd.checked;
        });
      }

      // Explicit Cloudflare Turnstile rendering
      var sitekey = this.cfg.turnstile_sitekey;
      if (sitekey) {
        if (!document.querySelector('script[src*="turnstile/v0/api.js"]')) {
          var tsScript = document.createElement('script');
          tsScript.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          tsScript.async = true;
          tsScript.defer = true;
          document.head.appendChild(tsScript);
        }
        var container = this.bd.querySelector('#mf-turnstile');
        var renderTurnstile = function () {
          if (window.turnstile && container) {
            self.turnstileId = window.turnstile.render(container, {
              sitekey: sitekey,
              callback: function (token) {
                self.turnstileToken = token;
              }
            });
          } else {
            setTimeout(renderTurnstile, 250);
          }
        };
        renderTurnstile();
      }
    }
    renderSuccess() {
      var T = this.T;
      this.bd.innerHTML = '<div class="suc"><div class="rg">' + IC.check + '</div><h3>' + T.successT + '</h3><p>' + T.successP + '</p></div>';
      this.ft.innerHTML = '<button class="bp" data-act="close">' + T.close + '</button>';
      this.fireConversion();
    }

    /* ---------------- Calendário ---------------- */
    calHTML() {
      var T = this.T, s = this.state, set = this.dateSet();
      if (!s.calY) { var first = (this.cache.dates && this.cache.dates[0]) ? parseISO(this.cache.dates[0].date) : new Date(); s.calY = first.getFullYear(); s.calM = first.getMonth(); }
      var y = s.calY, m = s.calM, startDow = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
      var now = new Date(), canPrev = (y > now.getFullYear()) || (y === now.getFullYear() && m > now.getMonth());
      var cells = T.weekdaysShort.map(function (w) { return '<div class="cw">' + w + '</div>'; }).join('');
      for (var i = 0; i < startDow; i++) cells += '<div class="cc"></div>';
      for (var d = 1; d <= days; d++) {
        var ds = iso(new Date(y, m, d)), av = set[ds], sel = this.sel.date === ds;
        cells += '<button class="cc ' + (av ? 'av' : '') + (sel ? ' sel' : '') + '" ' + (av ? 'data-date="' + ds + '" data-loc="' + (av.loc || '') + '"' : 'disabled') + '>' + d + '</button>';
      }
      var ml = T.months[m].charAt(0).toUpperCase() + T.months[m].slice(1) + ' ' + y;
      return '<button class="clb" data-act="list">' + T.backToList + '</button>\
<div class="calh"><button class="cn" data-act="prev"' + (canPrev ? '' : ' disabled') + '>‹</button><span class="ml">' + ml + '</span><button class="cn" data-act="nextm">›</button></div>\
<div class="cg">' + cells + '</div>\
<div class="lg2"><span><i style="background:var(--soft)"></i>' + T.legendOn + '</span><span><i style="background:#eef1f6"></i>' + T.legendOff + '</span></div>';
    }
    dateSet() { var o = {}; (this.cache.dates || []).forEach(function (d) { o[d.date] = { loc: d.location_id }; }); return o; }
    dateLabel(s) {
      var T = this.T, d = parseISO(s), now = new Date(), t = T.weekdays[d.getDay()];
      var todayIso = iso(now), tm = new Date(now); tm.setDate(tm.getDate() + 1);
      if (s === todayIso) t = T.today; else if (s === iso(tm)) t = T.tomorrow;
      var sub = (t === T.today || t === T.tomorrow) ? (T.weekdays[d.getDay()] + ' · ' + d.getDate() + ' ' + (T.locale === 'en' ? '' : 'de ') + T.months[d.getMonth()]) : (d.getDate() + ' ' + (this.cfg.locale && this.cfg.locale.indexOf('en') === 0 ? '' : 'de ') + T.months[d.getMonth()]);
      return { t: t, s: sub };
    }

    /* ---------------- Interações ---------------- */
    onBodyClick(e) {
      var self = this, t = e.target;
      var sp = t.closest && t.closest('[data-sp]'); if (sp) { this.pickSpecialty(sp.getAttribute('data-sp')); return; }
      var doc = t.closest && t.closest('[data-doc]'); if (doc) { this.pickDoctor(doc.getAttribute('data-doc')); return; }
      var act = t.closest && t.closest('[data-act]'); if (act) { return this.onAct(act.getAttribute('data-act')); }
      var dt = t.closest && t.closest('[data-date]'); if (dt) { this.pickDate(dt.getAttribute('data-date'), dt.getAttribute('data-loc')); return; }
      var sl = t.closest && t.closest('[data-slot]'); if (sl) { this.pickSlot(sl.getAttribute('data-slot'), sl.getAttribute('data-end')); return; }
    }
    onFootClick(e) { var a = e.target.closest && e.target.closest('[data-act]'); if (a) this.onAct(a.getAttribute('data-act')); }
    onAct(a) {
      var s = this.state;
      if (a === 'back') { this.goBack(); }
      else if (a === 'next') { s.step++; this.render(); }
      else if (a === 'close') { this.close(); }
      else if (a === 'retry') { this.close(); }
      else if (a === 'cal') { s.view = 'calendar'; this.render(); }
      else if (a === 'list') { s.view = 'list'; this.render(); }
      else if (a === 'prev') { if (s.calM === 0) { s.calM = 11; s.calY--; } else s.calM--; this.render(); }
      else if (a === 'nextm') { if (s.calM === 11) { s.calM = 0; s.calY++; } else s.calM++; this.render(); }
      else if (a === 'book') { this.doBook(); }
    }
    goBack() {
      var s = this.state;
      if (s.step === 2 && s.view === 'calendar') { s.view = 'list'; this.render(); return; }
      
      // Se a especialidade for pré-definida, ao voltar da seleção de médicos (Step 1), fecha o drawer
      if (s.step === 1 && this.presetSpecialty) {
        this.close();
        return;
      }
      // Se o médico for pré-definido, ao voltar da seleção de datas (Step 2), fecha o drawer
      if (s.step === 2 && this.presetDoctor) {
        this.close();
        return;
      }

      if (s.step > 0) { s.step--; this.render(); }
    }

    // Avança IMEDIATAMENTE (com a animação de slide/fade); os dados da próxima
    // etapa carregam em background e preenchem o spinner quando chegam.
    go(step) { this.state.step = step; this.render(); }

    async pickSpecialty(name) {
      this.sel.specialty = name; this.sel.doctorId = null; this.sel.date = null; this.sel.slot = null;
      this.cache.doctors = null;
      this.go(1);
      var docs;
      try { docs = (await this.call('doctors', { specialty: name })).doctors || []; } catch (e) { this.renderError(); return; }
      this.cache.doctors = docs;
      if (this.state.step !== 1) return;

      // Se tiver médico pré-definido (caso redundante mas de segurança), encaminha
      if (this.presetDoctor) {
        var foundDoc = docs.find(d => d.id === this.presetDoctor);
        if (foundDoc) {
          this.pickDoctor(this.presetDoctor);
          return;
        }
      }

      if (docs.length === 1) {
        this.sel.doctorId = docs[0].id; this.sel.doctor = docs[0]; this.cache.dates = null;
        this.go(2); await this.loadDates(); if (this.state.step === 2) this.render();
        return;
      }
      this.render();
    }

    async pickDoctor(id) {
      this.sel.doctorId = id; this.sel.doctor = (this.cache.doctors || []).find(function (d) { return d.id === id; });
      this.sel.date = null; this.sel.slot = null; this.cache.dates = null;
      this.go(2);
      await this.loadDates();
      if (this.state.step === 2) this.render();
    }
    async loadDates() { try { this.cache.dates = (await this.call('dates', { doctor_id: this.sel.doctorId, limit: 14 })).dates || []; } catch (e) { this.cache.dates = []; } }

    async pickDate(date, loc) {
      this.sel.date = date; this.sel.locationId = loc || null; this.sel.slot = null; this.cache.slots = null; this.state.view = 'list';
      this.go(3);
      try { var r = await this.call('slots', { doctor_id: this.sel.doctorId, date: date, location_id: this.sel.locationId }); this.cache.slots = r.slots || []; if (!this.sel.locationId && r.location_id) this.sel.locationId = r.location_id; }
      catch (e) { this.cache.slots = []; }
      if (this.state.step === 3) this.render();
    }

    async pickSlot(time, end) {
      this.sel.slot = time; this.sel.slotEnd = end;
      this.go(4); // avança já; o lock roda em background (o book é a garantia final anti-corrida)
      this.call('lock', { doctor_id: this.sel.doctorId, date: this.sel.date, time: time }).catch(function () {});
      this.track('booking_step', { step: 'slot_selected' });
    }

    async doBook() {
      var name = this.bd.querySelector('#mf-name'), phone = this.bd.querySelector('#mf-phone'), email = this.bd.querySelector('#mf-email');
      var lgpd = this.bd.querySelector('#mf-lgpd');
      if (!name.value.trim() || !phone.value.trim() || !email.value.trim()) { this.flash(this.T.errGeneric); return; }
      if (lgpd && !lgpd.checked) { this.flash('Você precisa concordar com a Política de Privacidade.'); return; }
      
      var params = {
        doctor_id: this.sel.doctorId, location_id: this.sel.locationId, date: this.sel.date,
        start_time: this.sel.slot, end_time: this.sel.slotEnd || null,
        patient: { full_name: name.value.trim(), phone: phone.value.trim(), email: email.value.trim() }
      };

      if (this.cfg.turnstile_sitekey) {
        if (!this.turnstileToken) {
          this.flash('Por favor, complete a verificação de segurança (captcha).');
          return;
        }
        params.turnstile_token = this.turnstileToken;
      }

      var btn = this.ft.querySelector('[data-act=book]'); btn.disabled = true; btn.textContent = this.T.loading;
      this.track('booking_lead', { specialty: this.sel.specialty, doctor_id: this.sel.doctorId });
      try {
        var r = await this.call('book', params);
        if (!r.success) {
          if (window.turnstile && this.turnstileId !== undefined) {
            window.turnstile.reset(this.turnstileId);
            this.turnstileToken = null;
          }
          if (r.status === 'slot_taken') {
            // horário foi tomado entre a seleção e a confirmação: volta aos horários already atualizados
            this._err = r.message || this.T.errSlot;
            this.cache.slots = null;
            this.state.step = 3; this.render();
            try { var rs = await this.call('slots', { doctor_id: this.sel.doctorId, date: this.sel.date, location_id: this.sel.locationId }); this.cache.slots = rs.slots || []; if (this.state.step === 3) this.render(); } catch (e2) { this.cache.slots = []; if (this.state.step === 3) this.render(); }
            return;
          }
          this.flash(r.message || this.T.errGeneric); btn.disabled = false; btn.textContent = this.T.confirm; return;
        }
        this.lastBooking = r;
        this.state.step = 5; this.render();
      } catch (e) {
        if (window.turnstile && this.turnstileId !== undefined) {
          window.turnstile.reset(this.turnstileId);
          this.turnstileToken = null;
        }
        this.flash((e && e.message) || this.T.errGeneric); btn.disabled = false; btn.textContent = this.T.confirm;
      }
    }
    flash(msg) { var ex = this.bd.querySelector('.err'); if (ex) ex.remove(); this.bd.insertBefore(el('<div class="err">' + esc(msg) + '</div>'), this.bd.firstChild); }

    fireConversion() {
      if (this.state.conv) return; this.state.conv = true;
      var tr = (this.cfg && this.cfg.tracking) || {};
      var meta = { specialty: this.sel.specialty, doctor_id: this.sel.doctorId, tenant: this.cfg.tenant && this.cfg.tenant.slug };
      this.track('booking_confirmed', meta);
      try { if (window.fbq) window.fbq('track', 'Schedule', { content_name: this.sel.specialty }); } catch (e) {}
      try {
        if (window.gtag) {
          if (tr.google_ads_id && tr.google_conversion_label) window.gtag('event', 'conversion', { send_to: tr.google_ads_id + '/' + tr.google_conversion_label });
          window.gtag('event', 'booking_confirmed', meta);
        }
      } catch (e) {}
      // virtual pageview (compatível com conversões configuradas por URL de obrigado)
      try {
        var path = tr.success_virtual_path || '/agendamento-confirmado';
        if (window.history && window.history.pushState) window.history.pushState({ mfBooking: true }, '', path);
        window.dataLayer && window.dataLayer.push({ event: 'page_view', page_path: path, virtual: true });
      } catch (e) {}
    }
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // keyframes globais p/ a animação de transição dentro do shadow (definidas no CSS via nomes mf-*)
  var kf = document.createElement('style');
  kf.textContent = '@keyframes mf-fwd{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}@keyframes mf-back{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}';
  // injeta dentro de cada shadow via CSS string tb; aqui garantimos no documento como fallback
  document.head && document.head.appendChild(kf);

  customElements.define('mediflow-booking', MediflowBooking);
})();
