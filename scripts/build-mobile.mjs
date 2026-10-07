import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const endpoint = process.env.SHAREBAJAR_API_URL;
if (!endpoint) throw new Error('Set SHAREBAJAR_API_URL to your deployed HTTPS backend origin before building.');
const url = new URL(endpoint);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('SHAREBAJAR_API_URL must be an HTTPS origin, e.g. https://api.example.com');
}
await mkdir('dist', { recursive: true });
for (const name of ['style.css', 'auth.css', 'favicon.svg']) await copyFile(`static/${name}`, `dist/${name}`);
await mkdir('dist/vendor', {recursive:true});
for (const name of ['lightweight-charts.LICENSE', 'lightweight-charts.NOTICE']) await copyFile(`static/vendor/${name}`, `dist/vendor/${name}`);
const html = await readFile('static/index.html', 'utf8');
await writeFile('dist/index.html', html.replace(/\/app.js\?v=\d+/, '/app.js'));
await build({ entryPoints: ['static/app.js'], outfile: 'dist/app.js', bundle: true, format: 'esm', target: 'es2020',
  define: { 'globalThis.SHAREBAJAR_API_URL': JSON.stringify(url.origin) } });
console.log(`Mobile assets built with API ${url.origin}`);
