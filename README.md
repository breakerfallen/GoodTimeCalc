# GoodTimeCalc

A progressive web app (PWA) for Colorado criminal defense practitioners to estimate
release dates for jail and prison (DOC) sentences based on presentence confinement
credit (PSCC), earned time, and good time.

**Estimates only — not legal advice.** Actual dates are determined by the court,
CDOC time computation, or the county sheriff, and depend on facts this tool does
not model (concurrent/consecutive sentences, parole periods, forfeitures,
achievement earned time, earned release time, sex-offender sentencing, etc.).

## What it does

Enter the date of arrest, either a bond-out date or "in custody through sentencing,"
the sentencing date, and the sentence. One screen produces:

- **PSCC as of the sentencing date** — day of arrest through day of release or
  sentencing, counted inclusively (C.R.S. 18-1.3-405; *People v. Fransua*),
  plus a field for additional custody days from other periods. The total can
  also be entered directly (e.g., off the mittimus) instead of computed from dates.
- **DOC (prison) sentences** (C.R.S. 17-22.5-403, -405):
  - Parole eligibility date with **no earned time** and with **full earned time**
  - Mandatory release date (MRD) with full earned time
  - Sentence discharge date with no earned time
  - Earned time at 10 days/month (standard), 14 days/month for F4–F6 and
    DF3–DF4 under SB26-159 (2026), or 12 days/month for SB26-159's excluded
    offenses (felony motor vehicle theft; C.R.S. 18-3-303, -305, -306;
    18-6-701; 18-7-402 to -407; 18-12-102; 18-12-109; felony victim-rights
    crimes in 24-4.1-302) — all capped at 30% of the sentence
  - Parole eligibility rules: 50% less earned time (most felonies); 75% less
    earned time (listed crimes of violence committed 7/1/2004–12/31/2024);
    85% with no earned-time reduction (Proposition 128, listed crimes of violence
    on/after 1/1/2025); 100% (two prior crimes of violence)
- **County jail sentences** (C.R.S. 17-26-109): release dates with no good time,
  base good time (7 days/30), base plus program/trusty (10 days/30), and the
  maximum 15-days-per-30 cap — flagged "time served" when PSCC already covers
  the sentence.

Results can be **copied to the clipboard or sent to the share sheet**. The last
**10 calculations** are kept on-device (localStorage) with a user-set title and
notes, so different plea options for a client can be run and compared.

## Running it

It is a static site — no build step, no dependencies.

- Local: serve the repo root (e.g. `python3 -m http.server`) and open it, or just
  open `index.html` directly.
- Hosted: enable **GitHub Pages** for this repo (Settings → Pages → deploy from
  branch → `main`, root). Then open the Pages URL on your phone or desktop and
  use "Add to Home Screen" / "Install app" — it works offline after the first load.

## Development

- `calc.js` — all calculation logic, no DOM (also loads in Node for tests)
- `app.js` — UI wiring, history, copy/share, service-worker registration
- `test/test-calc.js` — unit tests: `node test/test-calc.js`

When changing any shipped asset, bump the `CACHE` version in `sw.js` so installed
clients pick up the update.
