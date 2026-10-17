/*
 * 全ファイルを 1 枚の HTML にまとめる (CSS も JS もアイコンも埋め込む)。
 *   node bundle.js [出力先]      既定は dist/spy-mint.html
 * スマホで試してもらうための Artifact 用。ビルドではなく、ただ貼りつけるだけ。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const out = process.argv[2] || path.join(root, 'dist', 'spy-mint.html');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const b64 = (f) => fs.readFileSync(path.join(root, f)).toString('base64');

let html = read('index.html');
const css = read('styles.css');

html = html.replace('<link rel="stylesheet" href="./styles.css">', () => '<style>\n' + css + '\n</style>');
html = html.replace(/<script src="\.\/([\w-]+\.js)"><\/script>/g, (m, name) =>
  '<script>\n' + read(name).replace(/<\/script/gi, '<\\/script') + '\n</script>');
html = html.replace('href="./icon.svg"', () => 'href="data:image/svg+xml;base64,' + b64('icon.svg') + '"');
html = html.replace('href="./apple-touch-icon.png"', () => 'href="data:image/png;base64,' + b64('apple-touch-icon.png') + '"');

if (/(href|src)="\.\//.test(html)) throw new Error('埋め込めていない読み込みが残っている');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out + '  ' + Math.round(html.length / 1024) + 'KB');
