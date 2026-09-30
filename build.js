// Bundles src/* into dist/index.html (standalone file) and dist/page.html (artifact body: no doctype/html/head/body wrappers).
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
let tpl = src('template.html');
const put = (marker, text) => { tpl = tpl.split(marker).join(text); };
put('/*__CSS__*/', src('style.css'));
put('/*__ENGINE__*/', src('engine.js'));
put('/*__APP__*/', src('app.js'));
tpl = tpl.replace(/\\u00b7/g, '·');
const head = tpl.slice(tpl.indexOf('<!--HEAD-->') + 11, tpl.indexOf('<!--/HEAD-->')).trim();
const body = tpl.slice(tpl.indexOf('<!--BODY-->') + 11, tpl.indexOf('<!--/BODY-->')).trim();
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'page.html'), head + '\n' + body + '\n');
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'),
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + head + '\n</head>\n<body>\n' + body + '\n</body>\n</html>\n');
// docs/ is what GitHub Pages serves: https://spacejam91.github.io/cuajo/
fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
fs.copyFileSync(path.join(__dirname, 'dist', 'index.html'), path.join(__dirname, 'docs', 'index.html'));
fs.writeFileSync(path.join(__dirname, 'docs', '.nojekyll'), '');
console.log('built dist/index.html (' + fs.statSync(path.join(__dirname, 'dist', 'index.html')).size + ' bytes) and dist/page.html, docs/index.html for GitHub Pages');
