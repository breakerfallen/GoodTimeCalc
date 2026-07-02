/*
 * GoodTimeCalc — core calculation logic (no DOM).
 * Colorado presentence confinement credit (PSCC), DOC earned time,
 * and county jail good time estimates.
 *
 * Legal basis (rough-estimate model):
 *  - PSCC: C.R.S. 18-1.3-405; credit for day of arrest and day of
 *    release/sentencing (People v. Fransua), so counting is inclusive
 *    of both endpoints.
 *  - DOC earned time: C.R.S. 17-22.5-405; 10 days/month standard,
 *    12 days/month for class 4/5/6 felonies and level 3/4 drug felonies,
 *    capped at 30% of the sentence.
 *  - Parole eligibility: C.R.S. 17-22.5-403; 50% of sentence less earned
 *    time (most felonies); 75% less earned time for listed crimes of
 *    violence committed 7/1/2004-12/31/2024; 85% with NO earned-time
 *    reduction for listed crimes of violence committed on/after 1/1/2025
 *    (Proposition 128); 100% with two prior crime-of-violence convictions.
 *  - Jail good time: C.R.S. 17-26-109; 7-day deduction per 30 days of
 *    sentence (base), +3 days for program completion or trusty status,
 *    up to 13 days for trusty workers, capped at 15 days per 30-day period.
 *
 * All results are estimates. DOC time computation applies additional
 * rules (concurrent/consecutive sentences, parole periods, forfeitures,
 * achievement earned time, earned release time) not modeled here.
 */
'use strict';

var GTC = (function () {
  var MS_DAY = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function parseDate(str) {
    if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
    var p = str.split('-');
    var ms = Date.UTC(+p[0], +p[1] - 1, +p[2]);
    return isNaN(ms) ? null : ms;
  }

  function fmtDate(ms) {
    var d = new Date(ms);
    return WEEKDAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' +
      d.getUTCDate() + ', ' + d.getUTCFullYear();
  }

  function fmtShort(ms) {
    var d = new Date(ms);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
  }

  function toISO(ms) {
    var d = new Date(ms);
    var m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function addDays(ms, n) { return ms + n * MS_DAY; }

  function daysBetween(a, b) { return Math.round((b - a) / MS_DAY); }

  // Calendar addition of a term (years/months anchored, then days).
  function addTerm(ms, term) {
    var d = new Date(ms);
    var y = d.getUTCFullYear() + (term.years || 0);
    var mo = d.getUTCMonth() + (term.months || 0);
    var out = Date.UTC(y, mo, d.getUTCDate());
    return addDays(out, term.days || 0);
  }

  function termToString(term) {
    var parts = [];
    if (term.years) parts.push(term.years + ' year' + (term.years === 1 ? '' : 's'));
    if (term.months) parts.push(term.months + ' month' + (term.months === 1 ? '' : 's'));
    if (term.days) parts.push(term.days + ' day' + (term.days === 1 ? '' : 's'));
    return parts.length ? parts.join(', ') : '0 days';
  }

  /*
   * PSCC: inclusive of the day of arrest and the day of release
   * (bond-out) or the day of sentencing when held through sentencing.
   */
  function computePscc(input) {
    var arrest = parseDate(input.arrestDate);
    var sentencing = parseDate(input.sentencingDate);
    var extra = Math.max(0, Math.floor(+input.extraPsccDays || 0));
    var errors = [];

    if (arrest === null) errors.push('Enter a valid arrest date.');
    if (sentencing === null) errors.push('Enter a valid sentencing date.');

    var endMs = null;
    if (input.custodyEnd === 'bond') {
      endMs = parseDate(input.bondDate);
      if (endMs === null) errors.push('Enter a valid bond-out date.');
    } else {
      endMs = sentencing;
    }

    if (!errors.length) {
      if (endMs < arrest) errors.push('Release/sentencing date is before the arrest date.');
      if (input.custodyEnd === 'bond' && endMs > sentencing) {
        errors.push('Bond-out date is after the sentencing date.');
      }
    }
    if (errors.length) return { errors: errors };

    var baseDays = daysBetween(arrest, endMs) + 1; // inclusive of both endpoints
    return {
      errors: [],
      arrestMs: arrest,
      endMs: endMs,
      sentencingMs: sentencing,
      baseDays: baseDays,
      extraDays: extra,
      totalDays: baseDays + extra
    };
  }

  /*
   * DOC (prison) sentence estimate.
   * The sentence is backdated by PSCC ("time comp start"), then:
   *  - SDD: statutory discharge, no earned time.
   *  - MRD (full earned time): serve S*30/(30+r) days; earned time
   *    capped at 30% of sentence.
   *  - PED: fraction f of sentence less earned time accrued by that
   *    point (t*(1+r/30) = f*S), except the 85%/100% groups where
   *    earned time cannot reduce the floor.
   * Credits are floored / served days ceiled so estimates err on the
   * later (conservative) side.
   */
  function computeDoc(opts) {
    var start = addDays(opts.sentencingMs, -opts.psccDays);
    var sdd = addTerm(start, opts.term);
    var S = daysBetween(start, sdd);
    if (S <= 0) return { errors: ['Sentence length must be greater than zero.'] };

    var r = opts.etRate === 12 ? 12 : 10;
    var etCap = Math.floor(0.30 * S);
    var etFull = Math.min(Math.floor(S * r / (30 + r)), etCap);
    var mrdFull = addDays(start, S - etFull);

    var f = { 50: 0.50, 75: 0.75, 85: 0.85, 100: 1.00 }[opts.parolePct] || 0.50;
    var pedNoEt, pedFullEt, mrdClamped = false;
    if (opts.parolePct === 85 || opts.parolePct === 100) {
      pedNoEt = addDays(start, Math.ceil(S * f));
      pedFullEt = pedNoEt; // earned time may not reduce the 85%/100% floor
      if (mrdFull < pedNoEt) { // release cannot precede the Prop 128 floor
        mrdFull = pedNoEt;
        etFull = daysBetween(mrdFull, sdd);
        mrdClamped = true;
      }
    } else {
      pedNoEt = addDays(start, Math.ceil(S * f));
      var servedPed = Math.ceil(S * f * 30 / (30 + r));
      var etAtPed = Math.min(Math.floor(servedPed * r / 30), etCap);
      pedFullEt = addDays(start, Math.max(servedPed, Math.ceil(S * f) - etAtPed));
    }

    return {
      errors: [],
      startMs: start,
      sentenceDays: S,
      etRate: r,
      etCapDays: etCap,
      etFullDays: etFull,
      sddMs: sdd,
      mrdFullMs: mrdFull,
      mrdClamped: mrdClamped,
      pedNoEtMs: pedNoEt,
      pedFullEtMs: pedFullEt,
      parolePct: opts.parolePct
    };
  }

  /*
   * County jail sentence estimate under C.R.S. 17-26-109.
   * Deductions are "for each thirty days on his or her sentence"
   * (pro-rated), so deduction = floor(S * rate / 30).
   */
  var JAIL_SCENARIOS = [
    { rate: 0,  label: 'No good time' },
    { rate: 7,  label: 'Base good time (7 days/30)' },
    { rate: 10, label: 'Base + program or trusty (10 days/30)' },
    { rate: 15, label: 'Maximum (15-day/30 cap)' }
  ];

  function computeJail(opts) {
    var start = addDays(opts.sentencingMs, -opts.psccDays);
    var sdd = addTerm(start, opts.term);
    var S = daysBetween(start, sdd);
    if (S <= 0) return { errors: ['Sentence length must be greater than zero.'] };

    var scenarios = JAIL_SCENARIOS.map(function (sc) {
      var deduction = Math.floor(S * sc.rate / 30);
      var releaseMs = addDays(start, S - deduction);
      return {
        rate: sc.rate,
        label: sc.label,
        deductionDays: deduction,
        releaseMs: releaseMs,
        alreadyServed: releaseMs <= opts.sentencingMs
      };
    });

    return {
      errors: [],
      startMs: start,
      sentenceDays: S,
      sddMs: sdd,
      scenarios: scenarios
    };
  }

  var PAROLE_LABELS = {
    50: '50% less earned time (most felonies)',
    75: '75% less earned time (listed violent crimes 7/1/2004–12/31/2024)',
    85: '85%, no earned-time reduction (Prop 128 violent crimes on/after 1/1/2025)',
    100: '100% (two prior crime-of-violence convictions, Prop 128)'
  };

  function calculate(input) {
    var pscc = computePscc(input);
    if (pscc.errors.length) return { errors: pscc.errors };

    var term = {
      years: Math.max(0, Math.floor(+input.years || 0)),
      months: Math.max(0, Math.floor(+input.months || 0)),
      days: Math.max(0, Math.floor(+input.days || 0))
    };
    if (!term.years && !term.months && !term.days) {
      return { errors: ['Enter a sentence length.'] };
    }

    var result = { errors: [], pscc: pscc, term: term, type: input.type };
    if (input.type === 'jail') {
      result.jail = computeJail({ sentencingMs: pscc.sentencingMs, psccDays: pscc.totalDays, term: term });
      if (result.jail.errors && result.jail.errors.length) return { errors: result.jail.errors };
    } else {
      result.doc = computeDoc({
        sentencingMs: pscc.sentencingMs,
        psccDays: pscc.totalDays,
        term: term,
        etRate: +input.etRate === 12 ? 12 : 10,
        parolePct: +input.parolePct || 50
      });
      if (result.doc.errors && result.doc.errors.length) return { errors: result.doc.errors };
    }
    return result;
  }

  var DISCLAIMER = 'Estimates only, based on C.R.S. 18-1.3-405, 17-22.5-403/-405, and ' +
    '17-26-109. Actual dates are set by the court, DOC time computation, or the sheriff ' +
    'and depend on facts not modeled here. Not legal advice.';

  function buildExportText(input, result) {
    var L = [];
    var p = result.pscc;
    L.push('GoodTimeCalc — ' + (input.title || 'Untitled calculation'));
    if (input.notes) L.push('Notes: ' + input.notes);
    L.push('');
    L.push('Arrest date: ' + fmtShort(p.arrestMs));
    if (input.custodyEnd === 'bond') {
      L.push('Bonded out: ' + fmtShort(p.endMs));
    } else {
      L.push('In custody through sentencing');
    }
    L.push('Sentencing date: ' + fmtShort(p.sentencingMs));
    if (p.extraDays) L.push('Additional PSCC days: ' + p.extraDays);
    L.push('PSCC as of sentencing: ' + p.totalDays + ' days');
    L.push('');

    if (result.type === 'jail') {
      var j = result.jail;
      L.push('Sentence: ' + termToString(result.term) + ' county jail (' + j.sentenceDays + ' days)');
      L.push('');
      L.push('Estimated release dates (PSCC already applied; C.R.S. 17-26-109):');
      j.scenarios.forEach(function (sc) {
        L.push('  ' + sc.label + ': ' + fmtShort(sc.releaseMs) +
          (sc.deductionDays ? ' (' + sc.deductionDays + ' days good time)' : '') +
          (sc.alreadyServed ? ' — satisfied by PSCC (time served)' : ''));
      });
    } else {
      var d = result.doc;
      L.push('Sentence: ' + termToString(result.term) + ' DOC (' + d.sentenceDays + ' days)');
      L.push('Parole eligibility rule: ' + PAROLE_LABELS[d.parolePct]);
      L.push('');
      L.push('Estimated dates (PSCC already applied):');
      if (d.parolePct === 100) {
        L.push('  Release: ' + fmtShort(d.sddMs) +
          ' — full sentence must be served; earned time does not apply');
      } else if (d.parolePct === 85) {
        L.push('  Parole eligibility (85% floor): ' + fmtShort(d.pedNoEtMs) +
          ' — earned time cannot move this date');
        L.push('  Mandatory release: ' + fmtShort(d.mrdFullMs) +
          (d.mrdClamped ? ' — held to the 85% floor' :
            ' (max earned time, ' + d.etFullDays + ' days)'));
        L.push('  Sentence discharge, if no earned time: ' + fmtShort(d.sddMs));
      } else {
        L.push('  Parole eligibility, if no earned time: ' + fmtShort(d.pedNoEtMs));
        L.push('  Parole eligibility, with max earned time: ' + fmtShort(d.pedFullEtMs));
        L.push('  Mandatory release, with max earned time (' + d.etFullDays + ' days at ' +
          d.etRate + '/mo): ' + fmtShort(d.mrdFullMs));
        L.push('  Sentence discharge, if no earned time: ' + fmtShort(d.sddMs));
      }
    }
    L.push('');
    L.push(DISCLAIMER);
    return L.join('\n');
  }

  return {
    parseDate: parseDate,
    fmtDate: fmtDate,
    fmtShort: fmtShort,
    toISO: toISO,
    addDays: addDays,
    daysBetween: daysBetween,
    addTerm: addTerm,
    termToString: termToString,
    computePscc: computePscc,
    computeDoc: computeDoc,
    computeJail: computeJail,
    calculate: calculate,
    buildExportText: buildExportText,
    PAROLE_LABELS: PAROLE_LABELS,
    JAIL_SCENARIOS: JAIL_SCENARIOS,
    DISCLAIMER: DISCLAIMER
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GTC;
