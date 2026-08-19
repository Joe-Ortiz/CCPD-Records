/* ============================================================
   record-pdf.js - lays the treatment log out onto PDF pages
   using MiniPDF. Landscape US Letter, one grid per page.
   ============================================================ */
(function (global) {
  'use strict';

  var PAGE_W = 792, PAGE_H = 612, M = 24;

  var INK       = [28, 36, 41];
  var SOFT      = [91, 104, 114];
  var GRID      = [150, 160, 168];
  var GRID_SOFT = [205, 212, 218];
  var HEAD_BG   = [238, 242, 245];
  var BRAND     = [11, 92, 122];

  var DEX_FILL = {
    '1.5': [255, 248, 219],
    '2.5': [228, 246, 236],
    'ICO': [241, 233, 251]
  };
  var DEX_INK = {
    '1.5': [122, 98, 0],
    '2.5': [16, 96, 58],
    'ICO': [76, 35, 121]
  };

  /* label lines, width, key */
  var COLS = [
    { k: 'date',     w: 54, l: ['Date'] },
    { k: 'time',     w: 40, l: ['Time'] },
    { k: 'preWt',    w: 42, l: ['Pre Dial.', 'Wt (Kg)'] },
    { k: 'preHR',    w: 34, l: ['Pre', 'HR'] },
    { k: 'preBP',    w: 52, l: ['Pre Dialysis', 'BP'] },
    { k: 'preTemp',  w: 40, l: ['Pre', 'Temp'] },
    { k: 'dextrose', w: 46, l: ['% Dextrose', 'Conc.'] },
    { k: 'initialDrain', w: 46, l: ['Initial', 'Drain'] },
    { k: 'effluentClear', w: 38, l: ['Effluent', 'Clear?'] },
    { k: 'totalUF',  w: 44, l: ['Total', 'UF'] },
    { k: 'avgDwell', w: 42, l: ['Avg Dwell', 'Time'] },
    { k: 'lostDwell', w: 42, l: ['Lost Dwell', 'Time'] },
    { k: 'postHR',   w: 36, l: ['Post', 'HR'] },
    { k: 'postBP',   w: 52, l: ['Post Dialysis', 'BP'] },
    { k: 'postWt',   w: 44, l: ['Post Dial.', 'Wt (Kg)'] },
    { k: 'comments', w: 0,  l: ['Comments'], align: 'left' }
  ];

  function fmt(v) {
    return (v === null || v === undefined || v === '') ? '' : String(v);
  }

  function bp(sys, dia) {
    if (!fmt(sys) && !fmt(dia)) return '';
    return fmt(sys) + ' / ' + fmt(dia);
  }

  function shortDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    return p.length === 3 ? (+p[1]) + '/' + (+p[2]) + '/' + p[0].slice(2) : iso;
  }

  function shortTime(t) {
    if (!t) return '';
    var p = String(t).split(':');
    if (p.length < 2) return t;
    var h = +p[0], m = p[1];
    var ap = h >= 12 ? 'p' : 'a';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + m + ap;
  }

  function cellValue(e, key) {
    switch (key) {
      case 'date':     return shortDate(e.date);
      case 'time':     return shortTime(e.time);
      case 'preBP':    return bp(e.preSys, e.preDia);
      case 'postBP':   return bp(e.postSys, e.postDia);
      case 'dextrose': return e.dextrose ? (e.dextrose === 'ICO' ? 'ICO' : e.dextrose + '%') : '';
      case 'effluentClear': return e.effluentClear || '';
      default:         return fmt(e[key]);
    }
  }

  function layoutColumns() {
    var fixed = 0;
    COLS.forEach(function (c) { fixed += c.w; });
    var cols = COLS.map(function (c) { return Object.assign({}, c); });
    cols[cols.length - 1].w = (PAGE_W - M * 2) - fixed;
    var x = M;
    cols.forEach(function (c) { c.x = x; x += c.w; });
    return cols;
  }

  /* ---------------------------------------------------------- */

  function drawHeader(page, ctx, pageNo, pageCount) {
    var y = M;

    page.text('CCPD Home Treatment Record', M, y, { size: 15, font: 'bold', color: BRAND });
    page.text('Peritoneal Dialysis Home Programs', M, y + 19, { size: 8.5, color: SOFT });

    /* Patient label box, mirroring the paper form */
    var bx = PAGE_W - M - 250, bw = 250, bh = 50;
    page.rect(bx, y - 2, bw, bh, { stroke: GRID, lineWidth: 0.8 });
    page.text('PATIENT', bx + 8, y + 4, { size: 6.5, font: 'bold', color: SOFT });
    page.text(ctx.patientName || '--', bx + 8, y + 13, { size: 11, font: 'bold', maxWidth: bw - 16 });
    page.text('DOB: ' + (ctx.patientDob || '--'), bx + 8, y + 29, { size: 8.5, color: SOFT });
    page.text('Generated ' + ctx.generated, bx + 8, y + 39, { size: 7, color: SOFT });

    /* Period + legend */
    page.text(ctx.periodLabel, M, y + 34, { size: 10, font: 'bold' });

    var lx = M, ly = y + 50;
    page.text('% Dextrose:', lx, ly, { size: 7, font: 'bold', color: SOFT });
    lx += 48;
    [['1.5', '1.5% (BP under 130)'], ['2.5', '2.5% (BP 130+)'], ['ICO', 'ICO (hospital ASAP)']]
      .forEach(function (pair) {
        page.rect(lx, ly - 1, 9, 9, { fill: DEX_FILL[pair[0]], stroke: GRID_SOFT, lineWidth: 0.5 });
        page.text(pair[1], lx + 13, ly, { size: 7, color: DEX_INK[pair[0]] });
        lx += 13 + MiniPDF.measure(pair[1], 7, 'regular') + 14;
      });

    page.text('Page ' + pageNo + ' of ' + pageCount, PAGE_W - M, y + 55, { size: 7, color: SOFT, align: 'right' });

    return y + 66;   /* top of the table */
  }

  function drawTableHead(page, cols, top) {
    var h = 24;
    page.rect(M, top, PAGE_W - M * 2, h, { fill: HEAD_BG, stroke: GRID, lineWidth: 0.8 });
    cols.forEach(function (c, i) {
      if (i > 0) page.line(c.x, top, c.x, top + h, { color: GRID, width: 0.5 });
      var lines = c.l;
      var startY = top + (h - lines.length * 8) / 2;
      lines.forEach(function (txt, j) {
        page.text(txt, c.x + c.w / 2, startY + j * 8, {
          size: 6.6, font: 'bold', color: SOFT, align: 'center', maxWidth: c.w - 4
        });
      });
    });
    return top + h;
  }

  function drawRow(page, cols, y, h, entry) {
    var dex = entry.dextrose;

    page.rect(M, y, PAGE_W - M * 2, h, { stroke: GRID_SOFT, lineWidth: 0.5 });

    cols.forEach(function (c, i) {
      if (i > 0) page.line(c.x, y, c.x, y + h, { color: GRID_SOFT, width: 0.5 });

      var val = cellValue(entry, c.k);
      var opt = { size: 7.4, align: c.align === 'left' ? 'left' : 'center' };

      if (c.k === 'dextrose' && dex && DEX_FILL[dex]) {
        page.rect(c.x + 1, y + 1, c.w - 2, h - 2, { fill: DEX_FILL[dex] });
        opt.font = 'bold';
        opt.color = DEX_INK[dex];
      }
      if (c.k === 'effluentClear' && val === 'N') {
        opt.font = 'bold';
        opt.color = [192, 57, 43];
      }
      page.textBox(val, c.x, y, c.w, h, opt);
    });

    return y + h;
  }

  function drawFooter(page, ctx) {
    var y = PAGE_H - M - 16;
    page.line(M, y - 6, PAGE_W - M, y - 6, { color: GRID, width: 0.6 });
    page.text('Nurse Signature: ______________________________', M, y, { size: 8, color: SOFT });
    page.text('Date: ____________________', M + 300, y, { size: 8, color: SOFT });
    page.text(ctx.footNote, PAGE_W - M, y, { size: 7, color: SOFT, align: 'right' });
  }

  /* ---------------------------------------------------------- */

  /**
   * @param {{patient:Object, entries:Array, periodLabel:string}} data
   * @returns {MiniPDF}
   */
  function buildRecordPdf(data) {
    var patient = data.patient || {};
    var entries = (data.entries || []).slice();
    var cols = layoutColumns();

    var name = [patient.last, patient.first].filter(Boolean).join(', ');
    var ctx = {
      patientName: name,
      patientDob: patient.dob ? shortDate(patient.dob) : '',
      periodLabel: data.periodLabel || 'All records',
      generated: new Date().toLocaleString(),
      footNote: entries.length + ' treatment' + (entries.length === 1 ? '' : 's') + ' recorded'
    };

    var doc = new MiniPDF({
      width: PAGE_W, height: PAGE_H,
      title: 'CCPD Treatment Record - ' + (name || 'Patient')
    });

    var ROW_H = 18;
    var bottomLimit = PAGE_H - M - 30;

    /* First pass: how many rows fit per page (constant), for the page count */
    var probeTop = 66 + M + 24;
    var perPage = Math.max(1, Math.floor((bottomLimit - probeTop) / ROW_H));
    var pageCount = Math.max(1, Math.ceil(entries.length / perPage));

    for (var p = 0; p < pageCount; p++) {
      var page = doc.addPage();
      var top = drawHeader(page, ctx, p + 1, pageCount);
      var y = drawTableHead(page, cols, top);

      var slice = entries.slice(p * perPage, (p + 1) * perPage);
      slice.forEach(function (e) { y = drawRow(page, cols, y, ROW_H, e); });

      if (!entries.length) {
        page.text('No treatments recorded for this period.',
          PAGE_W / 2, y + 24, { size: 10, color: SOFT, align: 'center' });
      }

      /* Blank ruled rows so the sheet still looks like the paper form */
      while (y + ROW_H <= bottomLimit) {
        page.rect(M, y, PAGE_W - M * 2, ROW_H, { stroke: GRID_SOFT, lineWidth: 0.5 });
        cols.forEach(function (c, i) {
          if (i > 0) page.line(c.x, y, c.x, y + ROW_H, { color: GRID_SOFT, width: 0.5 });
        });
        y += ROW_H;
      }

      drawFooter(page, ctx);
    }

    return doc;
  }

  global.buildRecordPdf = buildRecordPdf;
})(window);
