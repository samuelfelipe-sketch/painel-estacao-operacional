# Vendas (Metas e Margens) — rotina diária de atualização e publicação

Procedimento que a Rotina do Claude Code segue todo dia para atualizar o painel **Vendas** (`painel-operacional.html`) a partir do relatório do Argo e publicá-lo no site. As regras de negócio (esquema do JSON, fórmulas, hierarquia, inconsistências do Argo) ficam em `painel-operacional-regras.md`; este arquivo é só o **procedimento**.

## Por que o OneDrive, e não o e-mail

O Argo envia o relatório por e-mail toda madrugada (`naoresponda@redepostos.com`, assunto "Estação Sapatão - Relatório De Acompanhamento De Metas E Margens De Venda - Rede"), mas o anexo chega como `smime.p7m` (envelope assinado S/MIME) e o conector Microsoft 365 não entrega anexos binários. Já o PDF que o Argo deixa no OneDrive é lido pelo conector como texto, página a página. Por isso a fonte é a pasta, não o e-mail.

## Pré-requisitos (uma vez)

| O quê | Quem | Como |
|---|---|---|
| Chave dos dados como segredo do ambiente, variável `SAPATAO_DEK` | Samuel | Mesma da rotina da Negociação (valor de `sapatao-dek-v1`, base64 de 32 bytes). Nunca em chat, e-mail ou arquivo. |
| Conector Microsoft 365 na sessão | Samuel | O mesmo que lê o OneDrive. |
| Exportação diária do Argo para o OneDrive | TI / Argo | Relatório "Acompanhamento de Metas e Margens de Vendas", unidades 3, 4 e 5, 1º nível, todas as análises, em PDF, salvo em `Operações/Vendas/Claude/DD-MM-AAAA_RelatorioDeAcompanhamentoDeMetasEMargensDeVenda.pdf` (já configurado em 10/2026; chega ~02h de Brasília, com corte no dia anterior). |

Sem `SAPATAO_DEK`, a rotina para na primeira etapa e avisa; não tenta nada.

## Fonte

Pasta `Operações/Vendas/Claude` no OneDrive do Samuel (drive `b!VfxZ3Rv-PEGE3a_D-6KEfuBOwtNke0NCvkjtRDE2eZMLzILfb5O4SrVZVVJGP6Yx`). Ler pelo conector com `read_resource`:

```
file:///b!VfxZ3Rv-PEGE3a_D-6KEfuBOwtNke0NCvkjtRDE2eZMLzILfb5O4SrVZVVJGP6Yx/Operações/Vendas/Claude/DD-MM-AAAA_RelatorioDeAcompanhamentoDeMetasEMargensDeVenda.pdf
```

com `startPage: 1` e `endPage: 20` (o relatório tem ~10 páginas; se vier o aviso de truncado, ler as páginas restantes). `DD-MM-AAAA` é a data de HOJE (dia da geração); o corte dos dados é o dia anterior (`Data:` no rodapé). Se o PDF de hoje não existir, listar a pasta (`file:///<drive>/Operações/Vendas/Claude`) e usar o mais recente — mas só publicar se for mais novo que o já publicado.

Na mesma pasta chegam três CSVs por dia (`RelatorioDeVendasPorDataDeEmissao{As,Ps,Sf}.csv`): não fazem parte desta rotina.

## Passos (todo dia, ~06:00 Brasília)

1. **Estado de ontem.** `node scripts/vendas-publica.mjs abre --para /tmp/vendas` → `/tmp/vendas/vendas-anterior.json` (a versão no ar, decifrada). Fora do repositório.
2. **Texto do relatório.** Ler o PDF do dia pelo conector e gravar o texto devolvido, **sem alterar nada** (uma página por linha, exatamente como veio), em `/tmp/vendas/relatorio.txt`. Não "corrigir" número, não arredondar, não reordenar.
3. **Montar.** `node scripts/vendas-monta.mjs --txt /tmp/vendas/relatorio.txt --saida /tmp/vendas/dados.json --anterior /tmp/vendas/vendas-anterior.json`. O script transcreve as três tabelas de cada secção (3 unidades + TODAS UNIDADES), calcula os campos derivados (regras §2) e confere: filhos = pai (Otto + Diesel + Arla = Combustíveis; linhas = Mercadorias), projeção = acumulado ÷ dias × dias do mês, rede = soma das unidades, decomposição fecha, acumulado não regride dentro do mês. **Reprovado → não publica**: o erro mais comum é texto mal copiado no passo 2; reler o PDF e repetir. Se continuar reprovado, avisar o Samuel com a lista de itens e encerrar com a versão anterior no ar.
4. **Publicar.** `node scripts/vendas-publica.mjs publica --json /tmp/vendas/dados.json` grava `operacional-conteudo.json` cifrado (conferência de ida e volta antes de gravar).
4a. **Mês fechado → arquivo do seletor de mês.** Quando o relatório é do último dia do mês (`dias_dec = dias_mes`, o PDF do dia 1º), o próprio `publica` grava também `operacional-meses/AAAA-MM.json` (o JSON inteiro do painel, cifrado) e atualiza `operacional-meses/indice.json` (só a lista de meses, em claro). É o que o seletor "Mês" do topo do painel abre. Se o dia 1º falhar, gerar depois o relatório com Data no último dia do mês e rodar `node scripts/vendas-publica.mjs arquiva --json <dados.json desse relatório>`.
4b. **Histórico (seção Ano a ano).** `node scripts/vendas-historico.mjs anota --json /tmp/vendas/dados.json` acrescenta a `operacional-historico.json` (cifrado) o que o relatório do dia diz sobre os seus três meses: mês anterior e mesmo mês do ano passado (fechados) e o mês corrente (parcial, dias 1 a N). Mês fechado de relatório mais novo substitui o anterior; parcial nunca substitui fechado. O log diz só os meses gravados.
5. **Commit na branch principal.** `git pull --rebase origin main` → `git add operacional-conteudo.json operacional-historico.json operacional-meses/` → commit `chore: publica os dados do painel Vendas (automático)` → `git push origin HEAD:main`. Se o push for recusado, abrir um PR com o mesmo título e mesclá-lo (squash). O site mostra o dia novo em 1 a 2 minutos; os aparelhos redesenham sozinhos.
6. **Avisar** o Samuel em uma mensagem curta: corte publicado (data), mês de referência, e se alguma conferência precisou de releitura. Sem valores. Relatório do dia ausente no OneDrive → não publica e diz isso em uma linha.

## Semeadura do histórico (uma vez)

A seção **Ano a ano** compara o faturamento mês a mês do ano corrente com o anterior. O histórico começou em 03/11/2026 com o que havia na pasta (relatórios de 01/10 e 01/11 e o do dia): set–nov/2025 e ago–nov/2026; em 04/11/2026 o Samuel enviou os oito relatórios abaixo e o histórico ficou completo (jan/2025 → nov/2026), com os meses fechados de 2026 também arquivados para o seletor de mês. Fica registrado o procedimento, para o caso de um mês faltar: gerar no Argo **o mesmo relatório** (Acompanhamento de Metas e Margens de Vendas, unidades 3/4/5, 1º nível, todas as análises, PDF) com o campo **Data** no último dia de cada mês:

| Data do relatório | Meses que ele traz |
|---|---|
| 31/01/2026 | jan/2026 · dez/2025 · jan/2025 |
| 28/02/2026 | fev/2026 · jan/2026 · fev/2025 |
| 31/03/2026 | mar/2026 · fev/2026 · mar/2025 |
| 30/04/2026 | abr/2026 · mar/2026 · abr/2025 |
| 31/05/2026 | mai/2026 · abr/2026 · mai/2025 |
| 30/06/2026 | jun/2026 · mai/2026 · jun/2025 |
| 31/07/2026 | jul/2026 · jun/2026 · jul/2025 |
| 31/08/2026 | ago/2026 · jul/2026 · ago/2025 |

Os oito PDFs podem ir para `Operações/Vendas/Claude/Historico/` no OneDrive (qualquer nome) — a rotina (ou uma sessão) lê cada um pelo conector e grava o texto em `/tmp/vendas/hist/<AAAA-MM>.txt` — ou ser enviados como arquivo numa sessão, caso em que `node scripts/vendas-pdf-texto.mjs --pdf <arquivo.pdf> --saida /tmp/vendas/hist/<AAAA-MM>.txt` produz o mesmo texto (poppler `pdftotext -bbox-layout`, linhas remontadas pela posição das palavras). Depois, monta com `vendas-monta.mjs --txt … --saida /tmp/vendas/hist/<AAAA-MM>.json` (sem `--anterior`) e roda `vendas-historico.mjs anota --json` em cada JSON, em qualquer ordem; como são relatórios de mês fechado, rodar também `vendas-publica.mjs arquiva --json` em cada um, para o seletor de mês abrir esses meses inteiros. Depois, commit de `operacional-historico.json` com a mensagem `chore: semeia o histórico do painel Vendas (automático)`. A linha "Ano inteiro" da seção aparece quando o ano anterior tiver os 12 meses.

Outros comandos: `vendas-historico.mjs abre --para /tmp/vendas` (decifra para `/tmp/vendas/historico.json`, para conferir) e `importa --json` (substitui tudo — só por decisão do Samuel). Os cofres dos scripts do Vendas vivem em `scripts/vendas-lib.mjs`.

## Transportadora e Holding (botão "Grupo / Só postos")

Fora da rotina diária. Quando o Samuel quiser atualizar, gera no Argo os dois relatórios com o período desejado (pode ser o ano inteiro; os meses do período são substituídos) e envia como arquivo: **Relatório de MDF-es Emitidos** (unidade 99, situação Autorizado) e **Relatório de Vendas - Nota Avulsa** (unidade 1, tipo Completo). Em seguida, `node scripts/vendas-grupo.mjs confere --pdf <arquivo.pdf>` (lê e confere, sem gravar) e `node scripts/vendas-grupo.mjs importa --pdf <arquivo.pdf>` para cada um; commit de `operacional-historico.json` com `chore: atualiza Transportadora e Holding no histórico do Vendas`. Primeira carga em 04/11/2026: jan/2025 → out/2026 nas duas. Regras em `painel-operacional-regras.md`.

## Virada de mês

No dia 1º o relatório traz o corte do último dia do mês anterior (mês fechado, `dias_dec = dias_mes`); no dia 2 começa o mês novo (`mes_ref` muda, `dias_dec = 1`). O montador trata isso sozinho pelas datas do rodapé; a comparação com o anterior só se aplica dentro do mesmo `mes_ref`.

## O que a rotina nunca faz

- Não grava o JSON decifrado dentro do repositório (só em `/tmp`). Nenhum número do painel vai para commit, log, PR ou mensagem.
- Não "ajusta" número para fechar soma: conferência reprovada é motivo para não publicar e avisar.
- Não publica relatório mais antigo que o já no ar.
- Não toca em nenhum outro arquivo do site.

## Chave dos dados trocada

Se um script parar dizendo que a `SAPATAO_DEK` do ambiente é **ANTIGA**, o admin trocou a chave pelas Configurações. Não publique nada e não tente contornar: avise o Samuel em uma linha para colar a chave nova no segredo `SAPATAO_DEK` do ambiente da rotina.
