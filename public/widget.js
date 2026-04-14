(function () {
  'use strict';

  const CONFIG = {
    apiUrl: window.HELPDESK_CONFIG?.apiUrl || '/api/chat',
    title: window.HELPDESK_CONFIG?.title || 'Help Desk',
    subtitle: window.HELPDESK_CONFIG?.subtitle || 'Ask about MLS rules or classes',
    welcomeMessage:
      window.HELPDESK_CONFIG?.welcomeMessage ||
      "Hi! I can answer questions about MLS Rules & Regulations and our class calendar. What would you like to know?",
    primaryColor: window.HELPDESK_CONFIG?.primaryColor || '#1f4e79',
    position: window.HELPDESK_CONFIG?.position || 'bottom-right',
    hideLauncher: window.HELPDESK_CONFIG?.hideLauncher || false,
  };

  const STYLES = `
    .hd-widget-root, .hd-widget-root * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .hd-widget-root { position: fixed; z-index: 2147483000; ${CONFIG.position === 'bottom-left' ? 'left: 20px;' : 'right: 20px;'} bottom: 20px; }
    .hd-launcher { width: 60px; height: 60px; border-radius: 50%; background: ${CONFIG.primaryColor}; color: #fff; border: none; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; transition: transform 0.2s ease, box-shadow 0.2s ease; }
    .hd-launcher:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(0,0,0,0.25); }
    .hd-launcher svg { width: 28px; height: 28px; }
    .hd-panel { position: absolute; bottom: 80px; ${CONFIG.position === 'bottom-left' ? 'left: 0;' : 'right: 0;'} width: 380px; max-width: calc(100vw - 40px); height: 560px; max-height: calc(100vh - 120px); background: #fff; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.18); display: none; flex-direction: column; overflow: hidden; }
    .hd-panel.hd-open { display: flex; }
    .hd-header { background: ${CONFIG.primaryColor}; color: #fff; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; }
    .hd-header-text h3 { margin: 0; font-size: 16px; font-weight: 600; }
    .hd-header-text p { margin: 2px 0 0; font-size: 12px; opacity: 0.85; }
    .hd-close { background: none; border: none; color: #fff; cursor: pointer; padding: 4px; border-radius: 4px; opacity: 0.8; }
    .hd-close:hover { opacity: 1; background: rgba(255,255,255,0.1); }
    .hd-messages { flex: 1; overflow-y: auto; padding: 16px; background: #f7f8fa; display: flex; flex-direction: column; gap: 10px; }
    .hd-msg { max-width: 85%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.45; word-wrap: break-word; }
    .hd-msg-bot { background: #fff; color: #1a1a1a; align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
    .hd-msg-user { background: ${CONFIG.primaryColor}; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
    .hd-msg-error { background: #fdecea; color: #8a1f11; align-self: flex-start; border: 1px solid #f5c6c2; }
    .hd-typing { display: flex; gap: 4px; padding: 12px 14px; background: #fff; border-radius: 14px; border-bottom-left-radius: 4px; align-self: flex-start; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
    .hd-typing span { width: 7px; height: 7px; border-radius: 50%; background: #b0b0b0; animation: hd-bounce 1.2s infinite ease-in-out; }
    .hd-typing span:nth-child(2) { animation-delay: 0.15s; }
    .hd-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes hd-bounce { 0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }
    .hd-input-area { border-top: 1px solid #e5e7eb; padding: 12px; background: #fff; display: flex; gap: 8px; }
    .hd-input { flex: 1; border: 1px solid #d1d5db; border-radius: 20px; padding: 10px 14px; font-size: 14px; outline: none; resize: none; max-height: 100px; font-family: inherit; }
    .hd-input:focus { border-color: ${CONFIG.primaryColor}; }
    .hd-send { background: ${CONFIG.primaryColor}; color: #fff; border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .hd-send:disabled { background: #c0c4cc; cursor: not-allowed; }
    .hd-send svg { width: 18px; height: 18px; }
    .hd-footer { text-align: center; font-size: 11px; color: #9ca3af; padding: 6px; background: #fff; }
  `;

  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  const state = {
    open: false,
    sending: false,
    history: [],
  };

  let refs = {};

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  function buildWidget() {
    const launcher = h(
      'button',
      { class: 'hd-launcher', 'aria-label': 'Open help desk' },
      [
        (() => {
          const span = document.createElement('span');
          span.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.02 2 11c0 2.68 1.32 5.08 3.43 6.76L4 22l4.64-1.39c1.04.31 2.17.48 3.36.48 5.52 0 10-4.02 10-9s-4.48-9-10-9z"/></svg>';
          return span.firstChild;
        })(),
      ]
    );

    const messages = h('div', { class: 'hd-messages', role: 'log', 'aria-live': 'polite' });
    const input = h('textarea', {
      class: 'hd-input',
      placeholder: 'Type your question...',
      rows: '1',
      'aria-label': 'Message input',
    });
    const send = h('button', { class: 'hd-send', 'aria-label': 'Send message' }, [
      (() => {
        const span = document.createElement('span');
        span.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>';
        return span.firstChild;
      })(),
    ]);

    const panel = h('div', { class: 'hd-panel', role: 'dialog', 'aria-label': CONFIG.title }, [
      h('div', { class: 'hd-header' }, [
        h('div', { class: 'hd-header-text' }, [
          h('h3', {}, CONFIG.title),
          h('p', {}, CONFIG.subtitle),
        ]),
        h(
          'button',
          { class: 'hd-close', 'aria-label': 'Close help desk' },
          (() => {
            const span = document.createElement('span');
            span.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
            return span.firstChild;
          })()
        ),
      ]),
      messages,
      h('div', { class: 'hd-input-area' }, [input, send]),
      h('div', { class: 'hd-footer' }, 'Powered by AI — answers may be inaccurate'),
    ]);

    const children = CONFIG.hideLauncher ? [panel] : [panel, launcher];
    const root = h('div', { class: 'hd-widget-root' }, children);
    document.body.appendChild(root);

    refs = { root, launcher, panel, messages, input, send, closeBtn: panel.querySelector('.hd-close') };
  }

  function wireEvents() {
    if (refs.launcher) refs.launcher.addEventListener('click', togglePanel);
    refs.closeBtn.addEventListener('click', togglePanel);
    refs.send.addEventListener('click', handleSend);
    refs.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    refs.input.addEventListener('input', () => {
      refs.input.style.height = 'auto';
      refs.input.style.height = Math.min(refs.input.scrollHeight, 100) + 'px';
    });
  }

  function togglePanel() {
    state.open = !state.open;
    refs.panel.classList.toggle('hd-open', state.open);
    if (state.open) {
      if (state.history.length === 0) {
        appendMessage('bot', CONFIG.welcomeMessage);
      }
      setTimeout(() => refs.input.focus(), 100);
    }
  }

  function appendMessage(role, text) {
    const cls = role === 'user' ? 'hd-msg hd-msg-user' : role === 'error' ? 'hd-msg hd-msg-error' : 'hd-msg hd-msg-bot';
    const node = h('div', { class: cls }, text);
    refs.messages.appendChild(node);
    refs.messages.scrollTop = refs.messages.scrollHeight;
    if (role !== 'error') state.history.push({ role, text });
    return node;
  }

  function showTyping() {
    const node = h('div', { class: 'hd-typing' }, [h('span'), h('span'), h('span')]);
    refs.messages.appendChild(node);
    refs.messages.scrollTop = refs.messages.scrollHeight;
    return node;
  }

  async function handleSend() {
    const text = refs.input.value.trim();
    if (!text || state.sending) return;

    state.sending = true;
    refs.send.disabled = true;
    appendMessage('user', text);
    refs.input.value = '';
    refs.input.style.height = 'auto';

    const typing = showTyping();

    try {
      const reply = await sendToBackend(text);
      typing.remove();
      appendMessage('bot', reply);
    } catch (err) {
      typing.remove();
      appendMessage('error', 'Sorry, something went wrong. Please try again.');
      console.error('[HelpDesk]', err);
    } finally {
      state.sending = false;
      refs.send.disabled = false;
      refs.input.focus();
    }
  }

  async function sendToBackend(message) {
    const res = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: state.history.slice(-10),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.reply || data.message || '(no response)';
  }

  function init() {
    if (document.querySelector('.hd-widget-root')) return;
    injectStyles();
    buildWidget();
    wireEvents();
    window.HelpDesk = {
      open: () => { if (!state.open) togglePanel(); },
      close: () => { if (state.open) togglePanel(); },
      toggle: togglePanel,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
