/* =====================================================================
   ACTOM Grid — the question-and-answer assistant, browser side.

   A plain script, one global: window.Chat.

   WHAT THIS DELIBERATELY DOES NOT DO.

   It does not keep the conversation. It holds what is on screen so the
   panel can render, and sends only a thread id and the new question. The
   server rebuilds the conversation by reading the rows it wrote itself.
   That is not an optimisation — a browser that can assert what the
   assistant said earlier can talk it into repeating a determination it
   never made, and this is the side of the wire a user controls.

   It does not stream. An answer that types itself out cannot be checked
   before it is read, and you cannot unsay a rendered token. The reply
   arrives whole or is refused whole.

   It shows WHICH LOOKUPS were made under each answer. An answer with no
   lookups behind it came from the model's general knowledge, and an
   inspector is entitled to know the difference between that and something
   read out of their own register.

   Edit HERE, then run ./shared/sync.sh.
   ===================================================================== */
(function () {
  'use strict';

  var state = {
    enabled: false,
    thread: null,
    turns: [],        // what is on screen, not the authoritative history
    busy: false,
    open: false
  };

  function client() { return window.GRID && window.GRID.supabase; }
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Paragraphs and line breaks only. The answer is escaped first and then
     given structure — never inserted as markup. A reply is model output
     shaped partly by text an inspector typed, so it is untrusted on two
     counts. */
  function body(text) {
    /* The prompt forbids markdown, but a habit that strong is worth
       catching here too: an inspector should never be shown a literal
       **0 open NCRs**. Emphasis markers are removed rather than rendered
       -- turning them into real bold would mean interpreting model output
       as markup, which is a larger door than it is worth opening. */
    var flat = String(text == null ? '' : text)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:!?])/g, '$1$2')
      .replace(/^#{1,6}\s+/gm, '');
    return esc(flat).split(/\n{2,}/).map(function (p) {
      return '<p style="margin:0 0 8px">' + p.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function threadId() {
    if (state.thread) return state.thread;
    state.thread = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      /* Older tablet browsers. Not cryptographically meaningful and does
         not need to be: the id groups rows, and RLS is what stops anyone
         reading a thread that is not theirs. */
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    return state.thread;
  }

  function render() {
    var log = $('chatLog');
    if (!log) return;
    if (!state.turns.length) {
      log.innerHTML =
        '<div class="note" style="margin:0">Ask about what is in this division\'s register — open ' +
        'nonconformances, what goes wrong most often, parts that keep coming back, the state of a works ' +
        'order. It reads the same records you can see and nothing more.</div>' +
        '<div class="note q" style="margin-top:10px">It will not tell you whether something conforms, ' +
        'passes or should be accepted. That is yours to determine and is recorded against your name. ' +
        'Every question and answer here is kept.</div>';
      return;
    }
    log.innerHTML = state.turns.map(function (t) {
      if (t.role === 'you') {
        return '<div style="margin:0 0 14px;text-align:right"><div style="display:inline-block;' +
          'background:var(--pri);color:#fff;padding:8px 12px;border-radius:12px 12px 3px 12px;' +
          'max-width:85%;text-align:left;font-size:13px">' + esc(t.text) + '</div></div>';
      }
      var reads = (t.reads && t.reads.length)
        ? '<div class="cnt" style="margin-top:6px">Looked up: ' + esc(t.reads.join(', ')) + '</div>'
        : '<div class="cnt" style="margin-top:6px">No records looked up for this answer.</div>';
      return '<div style="margin:0 0 14px"><div style="background:var(--card);border:1px solid var(--line);' +
        'padding:10px 12px;border-radius:12px 12px 12px 3px;max-width:92%;font-size:13px' +
        (t.withheld ? ';border-color:var(--warn,#c88)' : '') + '">' +
        body(t.text) + reads + '</div></div>';
    }).join('');
    log.scrollTop = log.scrollHeight;
  }

  async function send() {
    if (state.busy) return;
    var input = $('chatInput');
    var text = input ? String(input.value || '').trim() : '';
    if (!text) return;
    if (!state.enabled) return;

    state.turns.push({ role: 'you', text: text });
    if (input) input.value = '';
    state.busy = true;
    render();

    var log = $('chatLog');
    if (log) {
      log.insertAdjacentHTML('beforeend',
        '<div id="chatWait" class="cnt" style="margin:0 0 14px">Reading the register…</div>');
      log.scrollTop = log.scrollHeight;
    }

    try {
      var c = client();
      var sess = c && await c.auth.getSession();
      var token = sess && sess.data && sess.data.session && sess.data.session.access_token;
      if (!token) throw new Error('no session');

      var res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify({ thread_id: threadId(), text: text })
      });
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }

      if (res.status === 403) {
        state.enabled = false;
        state.turns.push({ role: 'ai', text: 'The assistant is switched off for this division.', reads: [] });
      } else if (!res.ok) {
        /* The panel keeps its plain sentence; the console gets the cause.
           An inspector does not need to read "model 404", and whoever is
           debugging it should not have to guess. */
        console.warn('[assist] /api/chat', res.status, data && data.detail, data && data.upstream);
        state.turns.push({
          role: 'ai', reads: [],
          text: (data && data.error) || 'The assistant is unavailable. Carry on without it.'
        });
      } else {
        state.turns.push({ role: 'ai', text: data.answer, reads: data.reads || [], withheld: !!data.withheld });
      }
    } catch (e) {
      state.turns.push({ role: 'ai', reads: [], text: 'The assistant could not be reached.' });
    } finally {
      state.busy = false;
      var w = $('chatWait');
      if (w) w.remove();
      render();
      var i = $('chatInput');
      if (i) i.focus();
    }
  }

  function open() {
    if (!state.enabled) return;
    state.open = true;
    var p = $('chatPanel');
    if (p) p.classList.remove('hidden');
    render();
    var i = $('chatInput');
    if (i) i.focus();
  }
  function close() {
    state.open = false;
    var p = $('chatPanel');
    if (p) p.classList.add('hidden');
  }
  function toggle() { state.open ? close() : open(); }

  /* A new conversation, deliberately explicit. The old thread stays in
     the register; starting fresh is how you stop a long thread carrying
     an early misunderstanding through every later answer. */
  function reset() {
    state.thread = null;
    state.turns = [];
    render();
  }

  function init(opts) {
    opts = opts || {};
    state.enabled = !!opts.enabled;
    var btn = $('btnChat');
    if (btn) btn.classList.toggle('hidden', !state.enabled);
    if (!state.enabled) close();
    if (window.Chat.wired) return;
    window.Chat.wired = true;

    if (btn) btn.addEventListener('click', toggle);
    var x = $('chatClose'); if (x) x.addEventListener('click', close);
    var nw = $('chatNew');  if (nw) nw.addEventListener('click', reset);
    var s = $('chatSend');  if (s) s.addEventListener('click', function () { send().catch(function () { }); });
    var i = $('chatInput');
    if (i) i.addEventListener('keydown', function (e) {
      /* Enter sends, shift+Enter breaks the line: a question about a
         works order is one line, and a paste of a fault note is not. */
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send().catch(function () { }); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.open) close(); });
  }

  window.Chat = { init: init, open: open, close: close, toggle: toggle, reset: reset, wired: false };
})();
