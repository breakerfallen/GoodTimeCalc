/* GoodTimeCalc — UI wiring, history, copy/share, PWA registration. */
'use strict';

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var HISTORY_KEY = 'gtc-history-v1';
  var HISTORY_MAX = 10;
  var lastExportText = '';
  var lastResult = null;

  /* ---------- form <-> input object ---------- */

  function radioValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function setRadio(name, value) {
    var el = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
    if (el) el.checked = true;
  }

  function readInput() {
    return {
      title: $('title').value.trim(),
      notes: $('notes').value.trim(),
      psccMode: radioValue('psccMode'),
      psccManualDays: $('pscc-days').value,
      arrestDate: $('arrest-date').value,
      custodyEnd: radioValue('custodyEnd'),
      bondDate: $('bond-date').value,
      sentencingDate: $('sentencing-date').value,
      extraPsccDays: $('extra-pscc').value,
      years: $('sent-years').value,
      months: $('sent-months').value,
      days: $('sent-days').value,
      type: radioValue('type'),
      etRate: $('et-rate').value,
      parolePct: $('parole-pct').value
    };
  }

  function writeInput(input) {
    $('title').value = input.title || '';
    $('notes').value = input.notes || '';
    setRadio('psccMode', input.psccMode || 'dates');
    $('pscc-days').value = input.psccManualDays || '';
    $('arrest-date').value = input.arrestDate || '';
    setRadio('custodyEnd', input.custodyEnd || 'sentencing');
    $('bond-date').value = input.bondDate || '';
    $('sentencing-date').value = input.sentencingDate || '';
    $('extra-pscc').value = input.extraPsccDays || 0;
    $('sent-years').value = input.years || 0;
    $('sent-months').value = input.months || 0;
    $('sent-days').value = input.days || 0;
    setRadio('type', input.type || 'doc');
    $('et-rate').value = String(input.etRate || '14');
    $('parole-pct').value = input.parolePct || '50';
    syncVisibility();
  }

  function syncVisibility() {
    var manualPscc = radioValue('psccMode') === 'manual';
    $('pscc-dates').hidden = manualPscc;
    $('pscc-manual').hidden = !manualPscc;
    $('sent-date-hint').hidden = !manualPscc;
    $('bond-row').hidden = radioValue('custodyEnd') !== 'bond';
    $('doc-options').hidden = radioValue('type') !== 'doc';
  }

  /* ---------- rendering ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function row(label, value, sub, cls) {
    return '<div class="result-row' + (cls ? ' ' + cls : '') + '"><dt>' + label +
      '</dt><dd>' + value + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</dd></div>';
  }

  function renderResult(input, result) {
    var p = result.pscc;
    var html = '<dl>';
    html += row('PSCC as of sentencing (' + GTC.fmtShort(p.sentencingMs) + ')',
      p.totalDays + ' days',
      p.manual ? 'entered directly' + (p.assumedToday ?
        ' · no date entered — calculated as of ' + GTC.fmtShort(p.sentencingMs) : '') :
        (p.extraDays ? p.baseDays + ' counted + ' + p.extraDays + ' additional' :
          'day of arrest through ' +
          (input.custodyEnd === 'bond' ? 'bond-out' : 'sentencing') + ', inclusive'),
      'hero');
    html += row('Sentence', GTC.termToString(result.term) +
      (result.type === 'jail' ? ' county jail' : ' DOC'),
      'all dates below already include the PSCC credit');

    if (result.type === 'jail') {
      var j = result.jail;
      j.scenarios.forEach(function (sc) {
        html += row('Release — ' + esc(sc.label),
          GTC.fmtDate(sc.releaseMs) + (sc.alreadyServed ? '<span class="badge">time served</span>' : ''),
          sc.deductionDays ? sc.deductionDays + ' days good time' : null,
          sc.rate === 15 ? 'hero' : '');
      });
    } else {
      var d = result.doc;
      if (d.parolePct === 85 || d.parolePct === 100) {
        html += row('Parole eligibility — ' +
            (d.parolePct === 85 ? '85% floor' : 'full sentence (100%)'),
          GTC.fmtDate(d.pedNoEtMs), 'earned time cannot move this date', 'hero');
        html += row('Mandatory release (MRD) — with max earned time', GTC.fmtDate(d.mrdFullMs),
          d.etFullDays + ' days earned at ' + d.etRate +
          '/mo · release to parole supervision; may fall before the eligibility floor', 'hero');
        if (d.parolePct === 85) {
          html += row('Sentence discharge — if no earned time', GTC.fmtDate(d.sddMs));
        }
      } else {
        html += row('Parole eligibility — if no earned time', GTC.fmtDate(d.pedNoEtMs));
        html += row('Parole eligibility — with max earned time', GTC.fmtDate(d.pedFullEtMs),
          null, 'hero');
        html += row('Mandatory release (MRD) — with max earned time', GTC.fmtDate(d.mrdFullMs),
          d.etFullDays + ' days earned at ' + d.etRate + '/mo', 'hero');
        html += row('Sentence discharge — if no earned time', GTC.fmtDate(d.sddMs));
      }
    }
    html += '</dl>';
    $('results-body').innerHTML = html;
    $('disclaimer').textContent = GTC.DISCLAIMER;
    $('results').hidden = false;
  }

  function showErrors(errors) {
    var box = $('form-errors');
    if (!errors || !errors.length) { box.hidden = true; return; }
    box.innerHTML = '<ul>' + errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- history ---------- */

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
    catch (e) { return []; }
  }

  function saveHistory(items) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  }

  function addToHistory(input, exportText) {
    var items = loadHistory();
    items.unshift({
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
      savedAt: new Date().toISOString(),
      input: input,
      exportText: exportText
    });
    saveHistory(items);
    renderHistory();
  }

  function renderHistory() {
    var items = loadHistory();
    var list = $('history-list');
    $('history-empty').hidden = items.length > 0;
    list.innerHTML = items.map(function (it) {
      var when = new Date(it.savedAt);
      var summary = [];
      if (it.input.sentencingDate) summary.push('sentencing ' + it.input.sentencingDate);
      var term = [];
      if (+it.input.years) term.push(it.input.years + 'y');
      if (+it.input.months) term.push(it.input.months + 'm');
      if (+it.input.days) term.push(it.input.days + 'd');
      if (term.length) summary.push(term.join(' ') + ' ' + (it.input.type === 'jail' ? 'jail' : 'DOC'));
      return '<li data-id="' + it.id + '">' +
        '<div class="h-title">' + esc(it.input.title || 'Untitled calculation') + '</div>' +
        '<div class="h-meta">' + esc(summary.join(' · ')) + ' · saved ' +
          when.toLocaleDateString() + ' ' +
          when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</div>' +
        (it.input.notes ? '<div class="h-notes">' + esc(it.input.notes) + '</div>' : '') +
        '<div class="h-actions">' +
          '<button type="button" data-act="load">Load</button>' +
          '<button type="button" data-act="copy">Copy</button>' +
          '<button type="button" data-act="delete" class="danger">Delete</button>' +
        '</div></li>';
    }).join('');
  }

  /* ---------- copy / share ---------- */

  function copyText(text, btn) {
    function done() {
      if (!btn) return;
      var orig = btn.textContent;
      btn.textContent = 'Copied ✓';
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text); done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* best effort */ }
    document.body.removeChild(ta);
  }

  /* ---------- events ---------- */

  $('calc-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var input = readInput();
    var result = GTC.calculate(input);
    if (result.errors && result.errors.length) {
      showErrors(result.errors);
      $('results').hidden = true;
      return;
    }
    showErrors(null);
    lastResult = result;
    lastExportText = GTC.buildExportText(input, result);
    renderResult(input, result);
    addToHistory(input, lastExportText);
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.querySelectorAll('input[name="custodyEnd"], input[name="type"], input[name="psccMode"]')
    .forEach(function (el) {
      el.addEventListener('change', syncVisibility);
    });

  $('today-btn').addEventListener('click', function () {
    var d = new Date();
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    $('sentencing-date').value = d.getFullYear() + '-' +
      (m.length < 2 ? '0' : '') + m + '-' + (day.length < 2 ? '0' : '') + day;
  });

  $('copy-btn').addEventListener('click', function () {
    if (lastExportText) copyText(lastExportText, this);
  });

  $('share-btn').addEventListener('click', function () {
    if (!lastExportText) return;
    if (navigator.share) {
      navigator.share({ title: 'GoodTimeCalc', text: lastExportText }).catch(function () { /* cancelled */ });
    } else {
      copyText(lastExportText, this);
    }
  });

  $('history-list').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    var li = btn.closest('li');
    var id = li.getAttribute('data-id');
    var items = loadHistory();
    var item = items.find(function (it) { return it.id === id; });
    if (!item) return;

    if (btn.dataset.act === 'delete') {
      saveHistory(items.filter(function (it) { return it.id !== id; }));
      renderHistory();
    } else if (btn.dataset.act === 'copy') {
      copyText(item.exportText || '', btn);
    } else if (btn.dataset.act === 'load') {
      writeInput(item.input);
      var result = GTC.calculate(item.input);
      if (!result.errors.length) {
        lastResult = result;
        lastExportText = GTC.buildExportText(item.input, result);
        renderResult(item.input, result);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  });

  /* ---------- init ---------- */

  syncVisibility();
  renderHistory();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline install optional */ });
    });
  }
})();
