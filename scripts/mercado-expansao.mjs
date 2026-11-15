/* Market Share — postos em avaliação para expansão da rede, CIFRADOS em
   mercado/expansao.enc.json com a chave dos dados (SAPATAO_DEK), no formato
   {enc:1,iv,ct} que o navegador abre com window.sapataoCofre. A lista de alvos é
   estratégica: nunca em claro no repositório, nem em mensagem de commit ou log.

   Conteúdo (em claro só dentro do cifrado):
     { v:1, atualizado_em,
       perfis:{ urbano:{nome:'Urbano', ref:['<código da unidade de referência>']}, rodovia:{…} },
       rampa:{ m6:<fração do padrão em 6 meses>, m12:<fração em 12 meses> },   (24 meses = 100%)
       teto:true|false,   (posto novo limitado ao volume da unidade de referência, por produto)
       candidatos:[ { cnpj, apelido, perfil:'urbano'|'rodovia',
                      area:{tipo:'raio', km} | {tipo:'unidade', u:'<código da nossa unidade>'},
                      descartados?:[cnpj…], nota? } ] }
   area 'raio' = vizinhança automática: postos de mercado/postos-raio.json (`area`) a até km
   do candidato; area 'unidade' = a mesma área (lista de concorrentes escolhida) de uma unidade
   nossa, para posto que fica no mesmo corredor dela.

   Uso:
     node scripts/mercado-expansao.mjs grava --json <arquivo em claro FORA do repo>
     node scripts/mercado-expansao.mjs abre --para <pasta fora do repo>
   Logs: só contagens. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { falha, chave, cifra, decifra } from './vendas-lib.mjs';

const args = process.argv.slice(2), cmd = args[0];
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
const ARQ = 'mercado/expansao.enc.json';
const foraDoRepo = p => !resolve(p).startsWith(resolve('.')) || resolve(p).startsWith('/tmp');

if (cmd === 'abre') {
  const para = opt('para'); if (!para || !foraDoRepo(para)) falha('--para precisa apontar para fora do repositório.');
  if (!existsSync(ARQ)) falha('ainda não há candidatos publicados.');
  mkdirSync(para, { recursive: true });
  writeFileSync(join(para, 'expansao.json'), JSON.stringify(decifra(JSON.parse(readFileSync(ARQ, 'utf8')), chave()), null, 2));
  console.log('ok: aberto fora do repositório');
} else if (cmd === 'grava') {
  const js = opt('json'); if (!js || !foraDoRepo(js)) falha('--json precisa apontar para um arquivo fora do repositório.');
  const k = chave(), novo = JSON.parse(readFileSync(js, 'utf8'));
  if (!novo || !Array.isArray(novo.candidatos)) falha('o arquivo precisa ter { candidatos: [...] }.');
  const perfis = novo.perfis || {};
  for (const [nome, pf] of Object.entries(perfis)) if (!Array.isArray(pf.ref) || !pf.ref.length) falha(`perfil ${nome} sem unidade de referência.`);
  if (novo.rampa) for (const kk of ['m6', 'm12']) if (!(novo.rampa[kk] > 0 && novo.rampa[kk] <= 1)) falha('rampa inválida (frações entre 0 e 1).');
  for (const c of novo.candidatos) {
    if (!/^\d{14}$/.test(c.cnpj || '')) falha('CNPJ inválido na lista.');
    if (!c.apelido) falha('candidato sem apelido.');
    if (Object.keys(perfis).length && !perfis[c.perfil]) falha('candidato sem perfil (urbano ou rodovia).');
    const a = c.area || {};
    if (!(a.tipo === 'raio' && a.km > 0) && !(a.tipo === 'unidade' && a.u)) falha('candidato sem área (raio em km ou unidade).');
  }
  const doc0 = { v: 1, atualizado_em: new Date().toISOString().slice(0, 16), perfis, ...(novo.rampa ? { rampa: novo.rampa } : {}), teto: novo.teto !== false, candidatos: novo.candidatos };
  const doc = cifra(doc0, k);
  if (JSON.stringify(decifra(doc, k)) !== JSON.stringify(doc0)) falha('a conferência da cifra falhou.');
  writeFileSync(ARQ, JSON.stringify(doc) + '\n');
  console.log(`ok: ${doc0.candidatos.length} candidatos`);
} else falha('uso: grava --json <arquivo> | abre --para <pasta>');
