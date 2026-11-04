/* Junta vários CSVs diários do Argo ("Relatório de Compra de Combustíveis") num
   só, ficando, para cada data de entrada, com as linhas do arquivo MAIS NOVO que
   cobre aquela data. Cada arquivo `DD-MM-AAAA_...csv` cobre os 30 dias até o dia
   anterior ao do nome.

   Por que não somar/deduplicar linha a linha: o Argo corrige lançamentos depois
   (nota lançada com atraso, nota que muda de dia, linha que ganha mais uma nota).
   A linha corrigida muda de chave e a soma contaria duas vezes; trocar o dia
   inteiro pela versão mais nova não.

   Uso:
     node scripts/compras-compoe.mjs --csv /tmp/ms/compras-31-10-2026.csv --csv /tmp/ms/compras-04-11-2026.csv \
       --mes 2026-10 --saida /tmp/ms/composto.csv

   O nome de cada arquivo precisa conter a data (DD-MM-AAAA). Com --mes, confere
   que todos os dias do mês estão dentro da janela de algum arquivo e imprime
   `periodo=AAAA-MM-DD:AAAA-MM-DD` (do 1º dia do mês ao último dia coberto) para
   o `mercado-sapatao.mjs grava --periodo`. Faltou dia: sai com erro e não grava.
   Os logs dizem só datas e contagens. */
import { readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';

const args = process.argv.slice(2);
const csvs = []; for (let i = 0; i < args.length; i++) if (args[i] === '--csv' && args[i + 1]) csvs.push(args[++i]);
function opt(nome) { const i = args.indexOf('--' + nome); return i >= 0 && args[i + 1] ? args[i + 1] : null; }
function falha(m) { console.error('ERRO: ' + m); process.exit(1); }
const saida = opt('saida'), mes = opt('mes');
if (!csvs.length || !saida) falha('uso: --csv <arquivo DD-MM-AAAA> [--csv ...] [--mes AAAA-MM] --saida <csv fora do repositório>.');
if (resolve(saida).startsWith(resolve('.')) && !resolve(saida).startsWith('/tmp')) falha('--saida precisa apontar para fora do repositório.');

const DIA = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);
const arqs = csvs.map(p => {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(basename(p)); if (!m) falha(`sem data DD-MM-AAAA no nome: ${basename(p)}`);
  const fim = Date.UTC(+m[3], +m[2] - 1, +m[1]) - DIA; /* último dia coberto */
  const linhas = readFileSync(p, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  return { nome: basename(p), ini: fim - 29 * DIA, fim, cab: linhas[0], linhas: linhas.slice(1).filter(l => l.split(';').length === 10) };
}).sort((a, b) => a.fim - b.fim);
const dataDe = l => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(l.split(';')[2].trim()); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : NaN; };
const dono = t => { for (let i = arqs.length - 1; i >= 0; i--) if (t >= arqs[i].ini && t <= arqs[i].fim) return arqs[i]; return null; };

const datas = new Set(); for (const a of arqs) for (const l of a.linhas) { const t = dataDe(l); if (isFinite(t)) datas.add(t); }
const out = [arqs[arqs.length - 1].cab]; const uso = {};
for (const t of [...datas].sort((a, b) => a - b)) {
  const a = dono(t); if (!a) continue;
  for (const l of a.linhas) if (dataDe(l) === t) out.push(l);
  uso[a.nome] = (uso[a.nome] || 0) + 1;
}
writeFileSync(saida, out.join('\n') + '\n');
console.log(`ok: ${out.length - 1} linhas · dias por arquivo: ${Object.entries(uso).map(([n, k]) => `${n} ${k}`).join(', ')}`);

if (mes) {
  const [a, m] = mes.split('-').map(Number), ini = Date.UTC(a, m - 1, 1), fimMes = Date.UTC(a, m, 0);
  const ultimo = arqs[arqs.length - 1].fim, ate = Math.min(fimMes, ultimo);
  const faltam = []; for (let t = ini; t <= ate; t += DIA) if (!dono(t)) faltam.push(iso(t));
  if (faltam.length) falha(`dias de ${mes} fora da janela dos arquivos: ${faltam.join(', ')}`);
  console.log(`periodo=${iso(ini)}:${iso(ultimo)}`);
}
