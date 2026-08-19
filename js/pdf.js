/* ============================================================
   pdf.js - a tiny, dependency-free PDF writer.

   Emits a valid PDF 1.4 file using the two standard base-14
   fonts (Helvetica / Helvetica-Bold), so nothing needs to be
   embedded and no external library is required.

   Coordinates are given TOP-LEFT origin, in points (72 = 1in);
   they are flipped to PDF's bottom-left origin internally.
   ============================================================ */
(function (global) {
  'use strict';

  /* Glyph widths (per 1000 units) for ASCII 32..126 */
  var W_REG = [
    278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
    1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
    333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
    556,556,333,500,278,556,500,722,500,500,500,334,260,334,584
  ];
  var W_BOLD = [
    278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
    556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
    975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
    667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
    333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
    611,611,389,556,333,611,556,778,556,556,500,389,280,389,584
  ];

  /* Map the handful of typographic characters we may meet onto ASCII */
  var FOLD = {
    '‘': "'", '’': "'", '“': '"', '”': '"',
    '–': '-', '—': '-', '…': '...', ' ': ' ',
    '•': '*', '°': ' deg', 'µ': 'u', '≥': '>=',
    '≤': '<=', '×': 'x', '→': '->', '½': '1/2'
  };

  function ascii(s) {
    s = String(s == null ? '' : s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (FOLD[ch]) { out += FOLD[ch]; continue; }
      var c = ch.charCodeAt(0);
      out += (c >= 32 && c <= 126) ? ch : (c === 10 || c === 13 ? ' ' : '?');
    }
    return out;
  }

  function esc(s) {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function num(n) {
    return (Math.round(n * 100) / 100).toString();
  }

  function widthTable(font) { return font === 'bold' ? W_BOLD : W_REG; }

  /** Width of `text` in points at `size`, for the chosen face. */
  function measure(text, size, font) {
    var t = ascii(text), tbl = widthTable(font), total = 0;
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i) - 32;
      total += (c >= 0 && c < tbl.length ? tbl[c] : 500);
    }
    return total * size / 1000;
  }

  /** Truncate with an ellipsis so the result fits inside maxWidth. */
  function ellipsize(text, maxWidth, size, font) {
    var t = ascii(text);
    if (measure(t, size, font) <= maxWidth) return t;
    while (t.length > 1 && measure(t + '...', size, font) > maxWidth) {
      t = t.slice(0, -1);
    }
    return t + '...';
  }

  /** Greedy word wrap into an array of lines that fit maxWidth. */
  function wrap(text, maxWidth, size, font) {
    var words = ascii(text).split(/\s+/).filter(Boolean);
    var lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var probe = line ? line + ' ' + words[i] : words[i];
      if (measure(probe, size, font) <= maxWidth || !line) {
        line = probe;
      } else {
        lines.push(line);
        line = words[i];
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /* ---------------------------------------------------------- */

  function Page(doc) {
    this.doc = doc;
    this.ops = [];
  }

  Page.prototype._y = function (y) { return this.doc.height - y; };

  Page.prototype._color = function (c, stroke) {
    var op = stroke ? 'RG' : 'rg';
    this.ops.push(num(c[0] / 255) + ' ' + num(c[1] / 255) + ' ' + num(c[2] / 255) + ' ' + op);
  };

  /** Draw text with its baseline-box top-left at (x, y). */
  Page.prototype.text = function (str, x, y, opt) {
    opt = opt || {};
    var size = opt.size || 9;
    var font = opt.font === 'bold' ? 'bold' : 'regular';
    var s = ascii(str);
    if (!s) return;
    if (opt.maxWidth) s = ellipsize(s, opt.maxWidth, size, font);

    var w = measure(s, size, font);
    var tx = x;
    if (opt.align === 'center') tx = x - w / 2;
    else if (opt.align === 'right') tx = x - w;

    this.ops.push('BT');
    this._color(opt.color || [0, 0, 0], false);
    this.ops.push('/' + (font === 'bold' ? 'F2' : 'F1') + ' ' + num(size) + ' Tf');
    /* y is the top of the text box; drop by the cap height for the baseline */
    this.ops.push('1 0 0 1 ' + num(tx) + ' ' + num(this._y(y + size * 0.8)) + ' Tm');
    this.ops.push('(' + esc(s) + ') Tj');
    this.ops.push('ET');
    return w;
  };

  /** Text centred inside a box, vertically middled. */
  Page.prototype.textBox = function (str, x, y, w, h, opt) {
    opt = Object.assign({}, opt || {});
    var size = opt.size || 9;
    opt.maxWidth = w - 4;
    var align = opt.align || 'center';
    var tx = align === 'center' ? x + w / 2 : (align === 'right' ? x + w - 2 : x + 2);
    opt.align = align;
    return this.text(str, tx, y + (h - size) / 2, opt);
  };

  Page.prototype.rect = function (x, y, w, h, opt) {
    opt = opt || {};
    var mode = '';
    if (opt.fill) { this._color(opt.fill, false); mode += 'f'; }
    if (opt.stroke) {
      this._color(opt.stroke, true);
      this.ops.push(num(opt.lineWidth || 0.5) + ' w');
      mode = mode === 'f' ? 'B' : 'S';
    }
    if (!mode) return;
    this.ops.push(num(x) + ' ' + num(this._y(y + h)) + ' ' + num(w) + ' ' + num(h) + ' re ' + mode);
  };

  Page.prototype.line = function (x1, y1, x2, y2, opt) {
    opt = opt || {};
    this._color(opt.color || [0, 0, 0], true);
    this.ops.push(num(opt.width || 0.5) + ' w');
    this.ops.push(num(x1) + ' ' + num(this._y(y1)) + ' m ' + num(x2) + ' ' + num(this._y(y2)) + ' l S');
  };

  Page.prototype.stream = function () { return this.ops.join('\n'); };

  /* ---------------------------------------------------------- */

  function MiniPDF(opt) {
    opt = opt || {};
    this.width = opt.width || 792;    /* Letter landscape */
    this.height = opt.height || 612;
    this.title = opt.title || 'Document';
    this.pages = [];
  }

  MiniPDF.prototype.addPage = function () {
    var p = new Page(this);
    this.pages.push(p);
    return p;
  };

  MiniPDF.prototype.measure = function (t, s, f) { return measure(t, s, f); };
  MiniPDF.prototype.wrap = function (t, w, s, f) { return wrap(t, w, s, f); };

  MiniPDF.prototype.build = function () {
    var self = this;
    var objects = [];                       /* 1-based bodies */
    function put(body) { objects.push(body); return objects.length; }

    var nPages = this.pages.length || 1;
    if (!this.pages.length) this.addPage();

    /* Reserve ids: 1 catalog, 2 pages tree, 3 F1, 4 F2, then page/content pairs */
    var catalogId = 1, pagesId = 2, f1Id = 3, f2Id = 4;
    var firstPageId = 5;
    var kids = [];
    for (var i = 0; i < nPages; i++) kids.push((firstPageId + i * 2) + ' 0 R');

    put('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
    put('<< /Type /Pages /Count ' + nPages + ' /Kids [' + kids.join(' ') + '] >>');
    put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    this.pages.forEach(function (page, idx) {
      var pageId = firstPageId + idx * 2;
      var contentId = pageId + 1;
      put('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' +
          num(self.width) + ' ' + num(self.height) + '] ' +
          '/Resources << /Font << /F1 ' + f1Id + ' 0 R /F2 ' + f2Id + ' 0 R >> >> ' +
          '/Contents ' + contentId + ' 0 R >>');
      var s = page.stream();
      put('<< /Length ' + s.length + ' >>\nstream\n' + s + '\nendstream');
    });

    /* Serialise with an xref table */
    var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    var offsets = [0];
    objects.forEach(function (body, i) {
      offsets.push(out.length);
      out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });

    var xrefPos = out.length;
    var count = objects.length + 1;
    out += 'xref\n0 ' + count + '\n0000000000 65535 f \n';
    for (var k = 1; k < count; k++) {
      out += ('0000000000' + offsets[k]).slice(-10) + ' 00000 n \n';
    }
    out += 'trailer\n<< /Size ' + count + ' /Root ' + catalogId + ' 0 R /Info << /Title (' +
           esc(ascii(this.title)) + ') /Producer (CCPD Home Treatment Record) >> >>\n' +
           'startxref\n' + xrefPos + '\n%%EOF\n';
    return out;
  };

  MiniPDF.prototype.bytes = function () {
    var str = this.build();
    var buf = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i) & 0xff;
    return buf;
  };

  MiniPDF.prototype.blob = function () {
    return new Blob([this.bytes()], { type: 'application/pdf' });
  };

  MiniPDF.measure = measure;
  MiniPDF.wrap = wrap;
  MiniPDF.ellipsize = ellipsize;

  global.MiniPDF = MiniPDF;
})(window);
