/* Unit tests for calc.js — run with: node test/test-calc.js */
'use strict';

var GTC = require('../calc.js');
var failures = 0;

function eq(actual, expected, label) {
  if (actual !== expected) {
    failures++;
    console.error('FAIL: ' + label + ' — expected ' + expected + ', got ' + actual);
  } else {
    console.log('ok:   ' + label + ' = ' + actual);
  }
}

/* --- PSCC: inclusive of day of arrest and day of release/sentencing --- */

var p = GTC.computePscc({
  arrestDate: '2026-01-01', custodyEnd: 'sentencing',
  sentencingDate: '2026-07-01', extraPsccDays: 0
});
eq(p.errors.length, 0, 'pscc: no errors');
eq(p.totalDays, 182, 'pscc Jan 1 -> Jul 1 2026 inclusive');

var p2 = GTC.computePscc({
  arrestDate: '2026-01-01', custodyEnd: 'bond', bondDate: '2026-01-03',
  sentencingDate: '2026-07-01', extraPsccDays: 5
});
eq(p2.totalDays, 8, 'pscc 3-day hold (inclusive) + 5 extra days');

var pSame = GTC.computePscc({
  arrestDate: '2026-01-01', custodyEnd: 'bond', bondDate: '2026-01-01',
  sentencingDate: '2026-07-01', extraPsccDays: 0
});
eq(pSame.totalDays, 1, 'pscc same-day book and release = 1 day');

var pErr = GTC.computePscc({
  arrestDate: '2026-07-02', custodyEnd: 'sentencing',
  sentencingDate: '2026-07-01', extraPsccDays: 0
});
eq(pErr.errors.length > 0, true, 'pscc rejects arrest after sentencing');

/* --- DOC: 5 years, arrested Jan 1, sentenced Jul 1 2026 (user example) --- */

var input = {
  arrestDate: '2026-01-01', custodyEnd: 'sentencing',
  sentencingDate: '2026-07-01', extraPsccDays: 0,
  years: 5, months: 0, days: 0,
  type: 'doc', etRate: 10, parolePct: 50
};
var r = GTC.calculate(input);
eq(r.errors.length, 0, 'doc calc: no errors');
var d = r.doc;

// Time comp start = Jul 1 2026 minus 182 days = Dec 31 2025
eq(GTC.toISO(d.startMs), '2025-12-31', 'doc time comp start');
// SDD = start + 5 years = Dec 31 2030; S = 1826 days (incl. 2028 leap day)
eq(GTC.toISO(d.sddMs), '2030-12-31', 'doc SDD (no earned time)');
eq(d.sentenceDays, 1826, 'doc sentence days (includes 2028 leap day)');
// Full earned time at 10/mo: floor(1826*10/40) = 456, under 30% cap (547)
eq(d.etCapDays, 547, 'doc earned time cap = 30%');
eq(d.etFullDays, 456, 'doc full earned time days');
eq(GTC.toISO(d.mrdFullMs), '2029-10-01', 'doc MRD with full earned time');
// PED no ET: ceil(0.5*1826) = 913 -> 2028-07-01
eq(GTC.toISO(d.pedNoEtMs), '2028-07-01', 'doc PED no earned time');
// PED full ET: t = ceil(913*30/40) = 685 -> 2027-11-16
eq(GTC.toISO(d.pedFullEtMs), '2027-11-16', 'doc PED full earned time');

/* --- DOC 12 days/month rate --- */
var r12 = GTC.calculate(Object.assign({}, input, { etRate: 12 }));
// floor(1826*12/42) = 521 <= cap 547
eq(r12.doc.etFullDays, 521, 'doc 12/mo full earned time days');

/* --- DOC 85% (Prop 128): no earned-time reduction of the floor --- */
var r85 = GTC.calculate(Object.assign({}, input, { parolePct: 85 }));
eq(GTC.toISO(r85.doc.pedNoEtMs), GTC.toISO(r85.doc.pedFullEtMs), 'doc 85% PED ignores earned time');
// ceil(0.85*1826) = 1553 days from 2025-12-31 -> 2030-04-02
eq(GTC.toISO(r85.doc.pedNoEtMs), '2030-04-02', 'doc 85% PED date');

/* --- DOC 100%: PED equals discharge --- */
var r100 = GTC.calculate(Object.assign({}, input, { parolePct: 100 }));
eq(GTC.toISO(r100.doc.pedNoEtMs), '2030-12-31', 'doc 100% PED = SDD');

/* --- Jail: 90 days, 10 days PSCC --- */
var jr = GTC.calculate({
  arrestDate: '2026-06-22', custodyEnd: 'sentencing',
  sentencingDate: '2026-07-01', extraPsccDays: 0,
  years: 0, months: 0, days: 90, type: 'jail'
});
eq(jr.errors.length, 0, 'jail calc: no errors');
var j = jr.jail;
eq(jr.pscc.totalDays, 10, 'jail pscc 10 days');
eq(GTC.toISO(j.startMs), '2026-06-21', 'jail time comp start');
eq(j.sentenceDays, 90, 'jail sentence days');
var byRate = {};
j.scenarios.forEach(function (s) { byRate[s.rate] = s; });
eq(GTC.toISO(byRate[0].releaseMs), '2026-09-19', 'jail release, no good time');
eq(byRate[7].deductionDays, 21, 'jail base good time 7/30 on 90 days');
eq(GTC.toISO(byRate[7].releaseMs), '2026-08-29', 'jail release, base good time');
eq(byRate[10].deductionDays, 30, 'jail program/trusty 10/30');
eq(byRate[15].deductionDays, 45, 'jail max 15/30 (half time)');
eq(GTC.toISO(byRate[15].releaseMs), '2026-08-05', 'jail release, max good time');

/* --- Jail sentence fully covered by PSCC flags time served --- */
var jts = GTC.calculate({
  arrestDate: '2026-01-01', custodyEnd: 'sentencing',
  sentencingDate: '2026-07-01', extraPsccDays: 0,
  years: 0, months: 0, days: 120, type: 'jail'
});
eq(jts.jail.scenarios.every(function (s) { return s.alreadyServed; }), true,
  'jail 120-day sentence with 182 PSCC = time served in all scenarios');

/* --- Export text sanity --- */
var text = GTC.buildExportText(input, r);
eq(text.indexOf('PSCC as of sentencing: 182 days') >= 0, true, 'export includes PSCC');
eq(text.indexOf('Not legal advice') >= 0, true, 'export includes disclaimer');

if (failures) {
  console.error('\n' + failures + ' test(s) failed');
  process.exit(1);
}
console.log('\nAll tests passed');
