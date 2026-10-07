import {mkdir, copyFile, writeFile} from 'node:fs/promises';
await mkdir('static/vendor', {recursive:true});
await copyFile('node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs', 'static/vendor/lightweight-charts.mjs');
await copyFile('node_modules/lightweight-charts/LICENSE', 'static/vendor/lightweight-charts.LICENSE');
await writeFile('static/vendor/lightweight-charts.NOTICE', 'TradingView Lightweight Charts™\nCopyright (с) 2025 TradingView, Inc. https://www.tradingview.com/\n');
