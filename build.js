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
// the website version can be installed as an app (manifest, icons, offline service worker)
const PWA = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<meta name="theme-color" content="#12352a">',
  '<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">',
  '<link rel="apple-touch-icon" href="icon-180.png">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Cuajo">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
].join('\n');
const standalone = fs.readFileSync(path.join(__dirname, 'dist', 'index.html'), 'utf8');
fs.writeFileSync(path.join(__dirname, 'docs', 'index.html'), standalone.replace('<title>Cuajo</title>', '<title>Cuajo</title>\n' + PWA));
for (const f of ['manifest.webmanifest', 'sw.js']) fs.copyFileSync(path.join(__dirname, 'src', f), path.join(__dirname, 'docs', f));
for (const f of fs.readdirSync(path.join(__dirname, 'src', 'assets'))) fs.copyFileSync(path.join(__dirname, 'src', 'assets', f), path.join(__dirname, 'docs', f));
fs.writeFileSync(path.join(__dirname, 'docs', '.nojekyll'), '');
console.log('built dist/index.html (' + fs.statSync(path.join(__dirname, 'dist', 'index.html')).size + ' bytes) and dist/page.html, docs/index.html for GitHub Pages');
