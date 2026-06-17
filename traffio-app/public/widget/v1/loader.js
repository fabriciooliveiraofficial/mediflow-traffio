/* =============================================================================
 * Mediflow / Traffio — Widget de Agendamento Embarcável (v1 Loader Lazy-load)
 * -----------------------------------------------------------------------------
 * Script de carregamento preguiçoso que substitui o widget original para
 * otimizar o Google PageSpeed das landing pages.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.customElements && customElements.get('mediflow-booking')) return;

  var DEFAULT_API = 'https://fyyhxmugxcfqhvoevuwf.supabase.co/functions/v1/public-booking';

  // Localiza a tag de agendamento na página
  var container = document.querySelector('mediflow-booking');
  if (!container) return;

  var key = container.getAttribute('data-key');
  if (!key) {
    console.error('[mediflow-booking-loader] data-key ausente');
    return;
  }

  var api = container.getAttribute('data-api') || DEFAULT_API;

  // i18n padrão simplificado para o botão flutuante inicial
  var fabTextDefault = 'Agendar';
  var locale = container.getAttribute('data-locale') || 'pt-BR';
  if (locale.indexOf('en') === 0) {
    fabTextDefault = 'Book now';
  }

  // Busca as configurações de aparência em background
  fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'config', key: key })
  })
  .then(function (res) { return res.json(); })
  .then(function (cfg) {
    if (!cfg || !cfg.theme) return;

    var primaryColor = cfg.theme.primary_color || '#0E7C7B';
    var fab = cfg.fab || {};
    var position = fab.position || 'bottom-right';
    var label = fab.label || fabTextDefault;
    var style = fab.style || 'soft';

    // Determina a paleta mínima do botão flutuante
    // Hex to RGB
    var hex = primaryColor.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(hex, 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var softColor = 'rgba(' + r + ',' + g + ',' + b + ',.12)';
    
    // Contraste para o texto do botão sólido
    // Formula de luminância
    var a = [r, g, b].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var L = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    var textColor = L > 0.4 ? '#0b1220' : '#ffffff';

    // Injeta os estilos CSS necessários para o botão flutuante temporário
    var css = '\
      .mf-loader-fab { position: fixed; bottom: 26px; z-index: 2147483000; display: inline-flex; align-items: center; gap: 12px; height: 64px; padding: 0 26px 0 22px; border-radius: 999px; cursor: pointer; font-size: 19px; font-weight: 800; letter-spacing: -.01em; border: 2px solid transparent; box-shadow: 0 12px 30px rgba(11,18,32,.18); transition: transform .15s, box-shadow .15s, opacity .15s; font-family: Inter, system-ui, -apple-system, sans-serif; box-sizing: border-box; }\
      .mf-loader-fab:hover { transform: translateY(-2px); }\
      .mf-loader-fab[data-pos=bottom-right] { right: 26px; }\
      .mf-loader-fab[data-pos=bottom-left] { left: 26px; }\
      .mf-loader-fab.solid { background: ' + primaryColor + '; color: ' + textColor + '; }\
      .mf-loader-fab.soft { background: #ffffff; color: ' + primaryColor + '; border-color: ' + softColor + '; box-shadow: 0 12px 30px rgba(11,18,32,.12); }\
      .mf-loader-fab.outline { background: #ffffff; color: ' + primaryColor + '; border-color: ' + primaryColor + '; }\
      .mf-loader-fab svg { width: 24px; height: 24px; }\
      .mf-loader-fab span { display: inline; }';

    var styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // Cria e renderiza o botão flutuante temporário (Mock FAB)
    var btn = document.createElement('button');
    btn.className = 'mf-loader-fab ' + style;
    btn.setAttribute('data-pos', position);
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><span>' + label + '</span>';

    if (fab.delay_ms && fab.delay_ms > 0) {
      btn.style.display = 'none';
      setTimeout(function () { btn.style.display = ''; }, fab.delay_ms);
    } else {
      document.body.appendChild(btn);
    }

    // Função de carregamento dinâmico do script core
    var loadCoreAndOpen = function () {
      btn.style.opacity = '0.7';
      btn.disabled = true;

      // Localiza o domínio atual de onde o widget.js foi importado para baixar o widget-core.js
      var scripts = document.getElementsByTagName('script');
      var srcDomain = '';
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].src;
        if (src && (src.indexOf('/widget.js') !== -1 || src.indexOf('/loader.js') !== -1)) {
          var a = document.createElement('a');
          a.href = src;
          srcDomain = a.protocol + '//' + a.host;
          break;
        }
      }
      if (!srcDomain) srcDomain = window.location.origin;

      var script = document.createElement('script');
      script.src = srcDomain + '/widget/v1/widget-core.js';
      script.async = true;

      script.onload = function () {
        // Aguarda a definição do Custom Element no navegador
        var checkComponent = function () {
          var el = document.querySelector('mediflow-booking');
          if (el && typeof el.open === 'function') {
            btn.remove(); // Remove o botão mock do loader
            el.open();    // Abre o Drawer de agendamento imediatamente
          } else {
            setTimeout(checkComponent, 50);
          }
        };
        checkComponent();
      };

      document.head.appendChild(script);
    };

    btn.addEventListener('click', loadCoreAndOpen);
    
    // Adiciona o botão se ele tinha delay e não foi inserido
    if (fab.delay_ms && fab.delay_ms > 0) {
      document.body.appendChild(btn);
    }
  })
  .catch(function (err) {
    console.error('[mediflow-booking-loader] erro ao obter configurações', err);
  });
})();
