# CCPD Home Treatment Record

A Progressive Web App version of the paper CCPD (continuous cycling peritoneal dialysis)
home treatment log. Plain HTML, CSS and vanilla JavaScript — no build step, no frameworks,
no server. Drop it on GitHub Pages and it runs.

## What it does

**Everything stays on the device.** Records live in the browser's `localStorage`. Nothing is
uploaded, and there is no account or backend. Clearing the browser's site data erases the log,
so use **More ▸ Export backup (JSON)** regularly.

### Three-phase entry

Each treatment is captured in the order it actually happens, so nothing has to be guessed
ahead of time:

| Phase | Fields |
| --- | --- |
| **1 · Pre-Dialysis** | Date, Time, Pre Dialysis Wt (Kg), Pre Dialysis HR, Pre Dialysis BP, Pre Dialysis Temp |
| **2 · Dextrose & Drain** | % Dextrose Concentration, Initial Drain |
| **3 · Post-Dialysis** | Is Effluent Clear?, Total UF, Avg Dwell Time, Lost Dwell Time, Post Dialysis HR, Post Dialysis BP, Post Dialysis Wt (Kg), Comments |

A record can be saved after any phase and reopened later — it resumes at the phase that still
needs work.

### Dextrose bag is chosen from the blood pressure

The pre-dialysis **systolic** reading picks the bag automatically:

| Reading | Bag | Colour |
| --- | --- | --- |
| Systolic under 130 | **1.5%** | 🟡 yellow |
| Systolic 130 or higher | **2.5%** | 🟢 green |
| Chosen by hand only | **ICO** | 🟣 purple — **patient needs a hospital ASAP** |

4.25% is not offered. Selecting ICO raises an on-screen warning, marks the record purple in the
list and in the PDF, and the app keeps that choice instead of overriding it. Any manual choice
sticks until you press **Use the BP recommendation**.

### Phase 3 stays locked until the initial drain is in

Every Phase 3 field is disabled — visibly, with a note explaining why — until an **Initial Drain**
volume is recorded in Phase 2.

### Share a PDF

**Share PDF** builds the complete log as a real PDF file in the browser (no library — see
[`js/pdf.js`](js/pdf.js)) and hands it to the system share sheet, so it can go straight to
the clinic by mail, message, or AirDrop. If the browser has no file sharing (most desktops),
the PDF downloads instead. **More ▸ Share selected period** does the same for just the month
and year currently selected.

The PDF reproduces the paper form: landscape grid, patient label, colour-coded dextrose cells,
a nurse signature line, and blank ruled rows so a partly-filled sheet can still be written on.

### Also in the app

- Card view (phone-friendly) and full-grid table view
- Month / year filter and a small summary strip (treatments, completed, average total UF, cloudy effluent, ICO days)
- **Print / Save as PDF** — prints the grid through the browser, as a fallback
- JSON backup export / import, and an erase-everything option
- Installable and fully offline via a service worker

## Deploy to GitHub Pages

1. Create a repository and push these files to its default branch:

```bash
git init && git add . && git commit -m "CCPD home treatment record PWA"
```

2. Add the remote and push:

```bash
git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main
```

3. In the repository, open **Settings ▸ Pages** and set **Source** to *Deploy from a branch*,
   branch `main`, folder `/ (root)`. The app appears at `https://<you>.github.io/<repo>/`.

All paths are relative, so the app works from a project subpath without changes. `.nojekyll`
keeps GitHub from filtering files. A workflow at
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) is included if you would rather
deploy with GitHub Actions (**Settings ▸ Pages ▸ Source: GitHub Actions**).

## Running it locally

A service worker needs a real `http://` origin, so open it through a server rather than
double-clicking the file:

```bash
node serve.js
```

Then visit `http://localhost:5177`. On iOS use Safari's **Share ▸ Add to Home Screen**; on
Android and desktop Chrome use the install prompt or **More ▸ Install app**.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Markup: app bar, filters, card and table views, the three-phase wizard, patient modal |
| `css/styles.css` | All styling, including the dextrose colour codes and the print stylesheet |
| `js/app.js` | State, storage, rendering, the phase/gating rules, share and backup |
| `js/pdf.js` | Dependency-free PDF writer (base-14 fonts, text/rect/line, real xref table) |
| `js/record-pdf.js` | Lays the treatment grid onto PDF pages |
| `sw.js` | Service worker — caches the app shell for offline use |
| `manifest.webmanifest`, `icons/` | Install metadata and icons |
| `serve.js` | Local dev server, not used by GitHub Pages |

## A note on use

This is a record-keeping aid, not a medical device. The dextrose suggestion follows the single
blood-pressure rule configured in `js/app.js` (`BP_THRESHOLD`) and does not replace the
prescription or instructions from the dialysis team.
