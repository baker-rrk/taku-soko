// 実PDFのテキストを調べる開発用スクリプト：node ccfolia/tests/probe_pdf.js <pdf> [検索語]
const fs = require('fs'), path = require('path');
const pdfjs = require('../../node_modules/pdfjs-dist/legacy/build/pdf.js');
(async () => {
  const f = process.argv[2], q = process.argv[3] || 'STR';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), cMapUrl: path.resolve(__dirname, '../../node_modules/pdfjs-dist/cmaps') + '/', cMapPacked: true, standardFontDataUrl: path.resolve(__dirname, '../../node_modules/pdfjs-dist/standard_fonts') + '/', isEvalSupported: false, verbosity: 0 }).promise;
  console.log('pages', doc.numPages);
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i), tc = await p.getTextContent(), text = tc.items.map(x => x.str + (x.hasEOL ? '\n' : '')).join('');
    if (text.includes(q)) { console.log('--- page', i, 'items', tc.items.length); console.log(text.slice(0, +process.argv[4] || 1500)); }
  }
})();
