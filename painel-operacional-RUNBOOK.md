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

## Passos (todo dia, 06:45 Brasília)

1. **Estado de ontem.** `node scripts/vendas-publica.mjs abre --para /tmp/vendas` → `/tmp/vendas/vendas-anterior.json` (a versão no ar, decifrada). Fora do repositório.
2. **Texto do relatório.** Ler o PDF do dia pelo conector e gravar o texto devolvido, **sem alterar nada** (uma página por linha, exatamente como veio), em `/tmp/vendas/relatorio.txt`. Não "corrigir" número, não arredondar, não reordenar.
3. **Montar.** `node scripts/vendas-monta.mjs --txt /tmp/vendas/relatorio.txt --saida /tmp/vendas/dados.json --anterior /tmp/vendas/vendas-anterior.json`. O script transcreve as três tabelas de cada secção (3 unidades + TODAS UNIDADES), calcula os campos derivados (regras §2) e confere: filhos = pai (Otto + Diesel + Arla = Combustíveis; linhas = Mercadorias), projeção = acumulado ÷ dias × dias do mês, rede = soma das unidades, decomposição fecha, acumulado não regride dentro do mês. **Reprovado → não publica**: o erro mais comum é texto mal copiado no passo 2; reler o PDF e repetir. Se continuar reprovado, avisar o Samuel com a lista de itens e encerrar com a versão anterior no ar.
4. **Publicar.** `node scripts/vendas-publica.mjs publica --json /tmp/vendas/dados.json` grava `operacional-conteudo.json` cifrado (conferência de ida e volta antes de gravar).
5. **Commit na branch principal.** `git pull --rebase origin main` → `git add operacional-conteudo.json` → commit `chore: publica os dados do painel Vendas (automático)` → `git push origin HEAD:main`. Se o push for recusado, abrir um PR com o mesmo título e mesclá-lo (squash). O site mostra o dia novo em 1 a 2 minutos; os aparelhos redesenham sozinhos.
6. **Avisar** o Samuel em uma mensagem curta: corte publicado (data), mês de referência, e se alguma conferência precisou de releitura. Sem valores. Relatório do dia ausente no OneDrive → não publica e diz isso em uma linha.

## Virada de mês

No dia 1º o relatório traz o corte do último dia do mês anterior (mês fechado, `dias_dec = dias_mes`); no dia 2 começa o mês novo (`mes_ref` muda, `dias_dec = 1`). O montador trata isso sozinho pelas datas do rodapé; a comparação com o anterior só se aplica dentro do mesmo `mes_ref`.

## O que a rotina nunca faz

- Não grava o JSON decifrado dentro do repositório (só em `/tmp`). Nenhum número do painel vai para commit, log, PR ou mensagem.
- Não "ajusta" número para fechar soma: conferência reprovada é motivo para não publicar e avisar.
- Não publica relatório mais antigo que o já no ar.
- Não toca em nenhum outro arquivo do site.
