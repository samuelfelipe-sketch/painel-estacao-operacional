# Fluxo de Caixa — RUNBOOK da rotina automática (Claude Code)

Procedimento que a Rotina do Claude Code segue toda **segunda-feira ~11:40 BRT** (os extratos da semana
são salvos no OneDrive na manhã de segunda) para carregar os extratos bancários do mês na ferramenta de
Fluxo de Caixa publicada em `fluxo/dados.enc.json`. Tudo que é sensível fica cifrado no repositório; o trabalho
decifrado acontece só em `/tmp/fluxo`.

## O que existe

| Peça | Onde | Papel |
|---|---|---|
| Ferramenta publicada | `fluxo/dados.enc.json` | HTML gzip+base64 cifrado ({v,em,gz}); é o que o shell `fluxo/index.html` abre |
| Estado da esteira | `fluxo/estado.enc.json` | as 20 constantes de dados da ferramenta (DATA, DIA, PREV, PROJ, STATUS, PAINEL…) — fonte da verdade; a ferramenta é gerada a partir dele |
| Mapa de fornecedores | `fluxo/fornecedores.enc.json` | 527 fornecedores do Argo → conta do plano, mais os `aprendidos` pela esteira |
| Regras do projeto | `fluxo/regras.enc.json` | os 3 docs de regras (Atualização, Configuração, Identidade Visual) + nota de versionamento |
| Fonte dos extratos (semanal) | OneDrive do Samuel, `Financeiro/Fluxo de Caixa/Extratos/Fluxo On-line/` (item `013KRIELRP5L5KTEZ6ZBGLBRVBF43E2WXK`) | **fonte principal desde 21/10/2026**: toda segunda de manhã entram os PDFs da semana (qualquer nome, qualquer organização em subpastas — a rotina reconhece empresa e banco pelo cabeçalho). Os arquivos se acumulam; o `fluxo-mes` emenda as partes de um mesmo banco e exige que a cadeia de saldos feche e que o mês esteja coberto desde o dia 1º |
| Arquivo mensal permanente | `Financeiro/Financeiro/Bancos - Extratos/Extratos/AAAA/MM Mês AAAA/<Empresa>/` (PDF por banco); drive `b!VfxZ3Rv-PEGE3a_D-6KEfuBOwtNke0NCvkjtRDE2eZMLzILfb5O4SrVZVVJGP6Yx`, pasta `Extratos` = item `013KRIELSDFRVMIPZVCZDZFWCW3OGD5OR4`, ano 2026 = `013KRIELWEGW6OESMLZZGJ726N7N5JOQ2S` | fonte de reserva: fechamento de mês quando a pasta semanal não tiver o mês inteiro (o extrato do mês fechado substitui os pedaços) |
| Chave dos dados | segredo `SAPATAO_DEK` do ambiente | base64 de 32 bytes (valor de `sapatao-dek-v1`); nunca em chat, log ou arquivo |
| Conector | Microsoft 365 (só leitura) | lê pastas e o texto dos PDFs (`read_resource`); não lê `.ofx` |

Scripts (`scripts/fluxo-*.mjs`), na ordem da esteira:

| Script | Faz |
|---|---|
| `fluxo-estado.mjs` | `abre` (estado → `/tmp/fluxo/estado/*.json`), `pendentes` (meses a carregar), `grava` (regrava cifrado, com guardas: nenhum mês some, dias não regridem), `inicia` (1ª carga a partir do HTML) |
| `fluxo-leituras.mjs` | recupera do transcript da sessão o texto de cada PDF lido pelo conector, reconhece empresa e banco pelo cabeçalho e grava `<pasta>/<empresa>/<banco>.txt` |
| `fluxo-extratos.mjs` | um leitor por banco (Sicredi, Stone, Unicred, Banrisul, Bradesco, Itaú, PagBank); valor pelo Δ do saldo corrido; cada extrato tem de reconciliar no centavo |
| `fluxo-classifica.mjs` | regras de memo + mapa de fornecedores → conta do plano; marca giro (transferência própria), intercompany, captação/amortização, abates |
| `fluxo-montagem.mjs` | casa sweeps entre contas próprias (mesmo dia e valor), semanas seg→dom, dias, conciliação `ini + entradas − saídas + entre empresas = fim` |
| `fluxo-mes.mjs` | carrega um mês inteiro no estado (DATA, DIA, MES_WEEKS, MES_LABEL, STATUS, PAINEL) e escreve o relatório de revisão fora do repo |
| `fluxo-fornecedores.mjs` | `abre`/`grava`/`aprende` o mapa de fornecedores |
| `fluxo-previsao.mjs` | `fixa` = previsão dos meses futuros (mediana dos meses fechados por conta, perfil por dia do mês e dia da semana, parcelas de dívida nas datas do último mês fechado; mês corrente e fechados nunca são reescritos); `proj` = projeção dos 2 meses seguintes ao último mês fechado (o embute troca os rótulos do card) |
| `fluxo-embute.mjs` → `fluxo-publica.mjs` → `fluxo-valida.mjs` | gera o HTML novo a partir do publicado + estado, cifra/publica, valida (contrato, conciliação, Chromium 1440/390) |

Empresas: `ps` Posto Sapatão (sapatao) · `sf` SF Estância Velha (sf) · `as` Auto Posto Safyr (safyr) · `siss` Siss (siss) · `st` Transportes (transportes) · `ss` Serviços (servicos).

## Passo a passo (segunda)

0. **Chave.** Sem `SAPATAO_DEK` no ambiente: parar e dizer isso em uma linha. Nunca procurar a chave em outro lugar.
1. **Abrir.** `mkdir -p /tmp/fluxo && node scripts/fluxo-estado.mjs abre --para /tmp/fluxo && node scripts/fluxo-estado.mjs pendentes && node scripts/fluxo-fornecedores.mjs abre --para /tmp/fluxo && node scripts/fluxo-publica.mjs abre --para /tmp/fluxo`. O `pendentes` diz quais meses carregar: meses anteriores com diário incompleto (fechar) e o mês corrente (realizado até D-1).
2. **Ler os extratos** pelo conector Microsoft 365: liste `file:///<drive>/013KRIELRP5L5KTEZ6ZBGLBRVBF43E2WXK` (pasta `Fluxo On-line`) e as subpastas que houver, e leia **todos os PDFs** com `read_resource` (`startPage 1`, `endPage 80`; ignore `.ofx`, `.xls(x)`, XP e "Sicredi - Rotativo/Investimento/Conta Garantida" — se ler por engano, o passo 3 descarta). Os arquivos de semanas anteriores continuam na pasta e devem ser lidos de novo (o passo 3 emenda). Para FECHAR um mês cujo início não está na pasta semanal, leia também o arquivo mensal: `file:///<drive>/Financeiro/Financeiro/Bancos - Extratos/Extratos/AAAA/MM Mês AAAA` e a pasta do mês seguinte (os extratos exportados no início do mês caem nela). O texto não precisa ser copiado à mão: o passo 3 recupera do transcript (inclusive os resultados que a ferramenta salvou em arquivo por serem grandes).
3. **Separar.** Para cada mês: `node scripts/fluxo-leituras.mjs --para /tmp/fluxo/AAAA-MM/extratos --mes AAAA-MM` (grava `<empresa>/<banco>.txt`, e `.2.txt`, `.3.txt`… quando há mais de um extrato do mesmo banco no mês; o `fluxo-mes` emenda e confere a cadeia de saldos — se uma semana faltar, ele recusa e diz qual banco). Confira na saída que cada empresa tem todos os bancos esperados (PS: Sicredi, Stone, Unicred, Banrisul, Bradesco · SF: Sicredi, Stone, Unicred, Banrisul, Bradesco · AS: Sicredi, Stone, Banrisul, Itaú · Siss: Sicredi, Banrisul, Bradesco · ST: Sicredi · SS: Sicredi, PagBank) e que todos reconciliam. Nunca carregue uma empresa com conta faltando — a conciliação ficaria errada em silêncio. **O mês só avança para todas as empresas juntas**: se faltar banco ou um extrato não reconciliar, o `fluxo-mes` recusa a carga e diz quem falta. Nesse caso: releia o PDF (todas as páginas) uma vez; se o problema for de leitura (formato novo), não tente contornar — pare, deixe o mês como está e descreva o caso ao Samuel no resumo (o leitor é corrigido no repositório, não na rodada). Única exceção aceita sem perguntar: **Serviços sem o PagBank** no arquivo — aí `--sem ss` no `fluxo-mes`; a SS fica com o realizado até onde tinha e a nota/STATUS avisam. Para qualquer outra empresa, `--sem` só com decisão do Samuel.
4. **Conferir.** `node scripts/fluxo-mes.mjs --mes AAAA-MM --extratos /tmp/fluxo/AAAA-MM/extratos --estado /tmp/fluxo/estado --fornecedores /tmp/fluxo/fornecedores.json --so-conferir --relatorio /tmp/fluxo/AAAA-MM/relatorio.txt`. Leia o relatório inteiro.
5. **Revisar** (é aqui que entra o julgamento; critérios abaixo). Decisões viram `/tmp/fluxo/AAAA-MM/ajustes.json` (lista de `{empresa, data?, valor?, contem?, conta, giro?}`) e, para fornecedores recorrentes, `node scripts/fluxo-fornecedores.mjs aprende --nome "<nome como no memo>" --conta "<rótulo do plano>" --por rotina` (isso já regrava `fluxo/fornecedores.enc.json`; depois reabra o mapa com `abre` para a carga usar).
6. **Carregar.** O mesmo comando do passo 4 sem `--so-conferir`, com `--ajustes` e, se for o caso, `--nota "…"` (uma frase para a nota do mês: decisões tomadas, o que ficou a confirmar). Repita 4–6 para cada mês pendente, do mais antigo para o mais novo.
6b. **Previsão e projeção.** Sempre: `node scripts/fluxo-previsao.mjs fixa --estado /tmp/fluxo/estado --proximos 3` (fixa a previsão dos meses que ainda não têm, mantendo 3 meses à frente — é assim que 2027 nasce). Se nesta rodada algum mês FECHOU (passou a `full`): acrescente `--refazer`, que recalcula a previsão de todos os meses futuros (tipo `prev`) com a mediana incluindo o mês recém-fechado — regra 6 do projeto ("na virada do mês a mediana é recalculada"). O mês corrente (parcial) e os fechados nunca são reescritos. Depois `node scripts/fluxo-previsao.mjs proj --estado /tmp/fluxo/estado` (projeção dos dois meses seguintes ao último fechado; o embute troca os rótulos do card sozinho). Então `node scripts/fluxo-estado.mjs grava --de /tmp/fluxo`.
7. **Gerar e validar.** `node scripts/fluxo-embute.mjs --base /tmp/fluxo/fluxo-anterior.html --estado /tmp/fluxo --saida /tmp/fluxo/fluxo-novo.html`; `mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright@1.54` (o Chromium já está em `/opt/pw-browsers`); de volta ao repositório, `node scripts/fluxo-valida.mjs --html /tmp/fluxo/fluxo-novo.html --pw /tmp/pw/node_modules/playwright`. Reprovado → **não publica** nem grava o estado no git; se for erro de leitura/ajuste, corrija e refaça; senão avise o Samuel com os itens reprovados e encerre com a versão anterior no ar.
8. **Publicar.** `node scripts/fluxo-publica.mjs publica --html /tmp/fluxo/fluxo-novo.html`, depois `git pull --rebase origin main`, `git add fluxo/dados.enc.json fluxo/estado.enc.json fluxo/fornecedores.enc.json`, commit `chore: publica o Fluxo de Caixa (extratos até DD/MM, automático)` e `git push origin HEAD:main`. Push recusado: abra um PR com esse título e mescle-o (squash).
9. **Resumo ao Samuel** (lista, uma linha por item): meses carregados e até que dia; empresas e contas conciliadas; empresas que ficaram de fora e por quê; decisões de classificação tomadas (as relevantes) e fornecedores aprendidos; viradas de saldo que não bateram; transferências próprias sem par e intercompany pendentes de confirmação; o que a rotina não consegue atualizar (ver "Limites"). Pode citar saldos e totais consolidados — o resumo é privado do Samuel; números nunca vão para arquivo em claro no repositório.

Sem mês pendente e sem extrato novo: não publica e termina em uma linha.

## Critérios de revisão (passo 5)

O relatório lista, por empresa, os lançamentos classificados com baixa confiança (regra genérica) e um agregado "fornecedores sem mapa". Regras:

- **Conciliação nunca se ajusta.** Se um extrato não reconcilia, a leitura está incompleta: releia o PDF (mais páginas) e refaça o passo 3; se persistir, a empresa fica de fora desta rodada.
- **Transferência própria sem par** (nome da própria empresa, "Outras entradas/saídas [sem par]"): quase sempre é conta que não está no arquivo (XP, Sicredinvest, Conta Garantida). Mantenha em Outras entradas/saídas, cite no resumo e na `--nota`. Entrada PIX em nome próprio sem par já vira Cartões (Sipag/QR) sozinha.
- **Entre empresas**: aluguel PS/SF/ST→Siss e frete PS/SF→ST são operacionais; boleto pago a empresa do grupo é operacional (a frota abastece nos postos = Combustível); PIX/TED entre empresas é empréstimo interno, neutralizado na linha "Entre empresas e financiamentos". Não mude isso sem decisão do Samuel.
- **Fornecedores sem mapa**: decida pelo nome e pelo valor típico — distribuidora de combustível → Combustível; alimentos, bebidas, cigarros, franquia → Mercadorias; energia, água, aluguel, telefonia → Operacionais; construção/reforma/equipamento → Investimentos — parcelas contratadas; advocacia, seguros, sindicato, Brinks → Não operacionais; contabilidade, consultoria, PJ de serviço → Serviços de terceiros; gráfica, agência, mídia → Marketing; software/monitoramento → Sistemas. Valor ≥ R$ 2.000 ou fornecedor que aparece 2+ vezes: grave com `aprende`. Pessoa física com PIX pequeno e sem contexto: deixe em "PIX/TED pagamentos diversos".
- **SISPAG Fornecedores (Itaú) sem par** no mesmo dia/valor numa conta própria: é fornecedor (Mercadorias/Combustível conforme o valor); com par, é giro (a montagem já casa).
- **DARF** fica em Tributos; FGTS/GPS só quando o memo diz (CEF, FGTS, GPS, GRF).
- Nunca reclassifique meses já fechados (`tipo: full` com `dias = nd`) — isso é decisão do Samuel, com `--refazer`.
- Cheque devolvido abate Cobranças; cancelamento de venda (PagBank) abate Cartões — já automático.

## Limites (o que a rotina não atualiza)

- **Previsão (PREV/PROJ)**: calculada pela rotina com o método do projeto (mediana dos meses fechados por conta e empresa; captações, amortizações do rotativo, resgates e distribuições = zero; dívida/parcelas contratadas pelo padrão do último mês fechado). O que a rotina NÃO tem são os **títulos já agendados no Argo** (regra max(mediana, agendado)) — eles não entram; se o Samuel quiser incluí-los, é uma leitura do Argo a construir. A distribuição semanal segue o perfil médio por dia do mês do diário, não é idêntica à feita à mão em agosto.
- **Contas a pagar/receber, vendas, metas, ERP** (COMPROMISSOS, RECEBER, VENDAS, METAS, ERP, PEND e os campos `vencidos`/`venc_intra` do PAINEL): vêm de exports do Argo que a rotina não lê. Ficam como estavam; o STATUS continua a dizer a data deles.
- **Setembro/2026** estava com 18 dias no painel na entrega da esteira (20/10/2026): a primeira rodada fecha setembro a partir das pastas `09 Setembro 2026` + `10 Outubro 2026` e carrega outubro até D-1. Diferenças de classificação com o que foi feito à mão em agosto são esperadas (os saldos e totais batem; a distribuição entre contas segue o mapa do Argo).
- PagBank da SS: o arquivo de agosto continha o extrato de julho — se o banco faltar, a SS fica de fora da rodada (aviso ao Samuel).
- O conector não lê `.ofx`; os PDFs são a fonte. Se a TI liberar escrita/`.ofx`, só o `fluxo-leituras`/`fluxo-extratos` mudam.

## Proibido

Imprimir, commitar ou enviar valores fora dos arquivos cifrados; ajustar número para fechar soma; apagar mês ou regredir dias do diário; reescrever a previsão do mês corrente ou de mês fechado; mexer em qualquer outro arquivo do site; publicar sem validação aprovada; carregar empresa com banco faltando; pedir ou procurar a chave dos dados fora do ambiente.
