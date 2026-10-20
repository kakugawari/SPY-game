/*
 * 全ファイルを 1 枚の HTML にまとめる (CSS も JS もアイコンも埋め込む)。
 *   node bundle.js [出力先]      既定は dist/spy-kon.html
 *   node bundle.js --artifact [出力先]   Artifact 用 (向こうが <html> と上下の安全域の余白を足すので、中身だけにして、その余白を消す)
 * スマホで試してもらうための Artifact 用。ビルドではなく、ただ貼りつけるだけ。
 */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const args = process.argv.slice(2);
const artifact = args.includes('--artifact');       // Claude の Artifact 用: <html> や <head> を持たない「中身だけ」にする
const out = args.find((a) => !a.startsWith('--')) || path.join(root, 'dist', 'spy-kon.html');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const b64 = (f) => fs.readFileSync(path.join(root, f)).toString('base64');

let html = read('index.html');
const css = read('styles.css');

html = html.replace('<link rel="stylesheet" href="./styles.css">', () => '<style>\n' + css + '\n</style>');
html = html.replace(/<script src="\.\/([\w-]+\.js)"><\/script>/g, (m, name) =>
  '<script>\n' + read(name).replace(/<\/script/gi, '<\\/script') + '\n</script>');
html = html.replace('href="./icon.png"', () => 'href="data:image/png;base64,' + b64('icon.png') + '"');
html = html.replace('href="./apple-touch-icon.png"', () => 'href="data:image/png;base64,' + b64('apple-touch-icon.png') + '"');

// 画像 (キャラの絵) を埋め込む。HTML の src と、JS の './xxx.webp' の両方
html = html.replace(/(["'])\.\/([\w-]+\.webp)\1/g, (m, q, name) => q + 'data:image/webp;base64,' + b64(name) + q);
if (/(href|src)="\.\//.test(html) || /['"]\.\/[\w-]+\.(webp|png|svg)['"]/.test(html)) throw new Error('埋め込めていない読み込みが残っている');

if (artifact) {
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'スパイ・コン';
  const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0]
    // 向こうの下地は :root に上下の安全域の余白を付ける。そのうえで html を 100% にすると、
    // iPhone では 100% が画面より上の安全域ぶん高く渡され (932 + 59)、画面全体が下へずれて下が切れた。
    // 向こうの余白は消して、index.html と同じ作り (100vh + #app の安全域の余白) にそろえる
    .replace('</style>', '/* Artifact: 向こうの下地の余白を消し、index.html と同じ作りで受ける */\n:root { padding: 0 !important; }\n</style>');
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  html = '<title>' + title + '</title>\n' + style + '\n' + body.trim() + '\n';
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(out + '  ' + Math.round(html.length / 1024) + 'KB');
