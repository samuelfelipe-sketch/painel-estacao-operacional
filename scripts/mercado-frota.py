"""Frota de veículos por município (Senatran), mês a mês, para a região de atuação.

Lê as planilhas "Frota por município e tipo" baixadas das páginas da Senatran
(gov.br/transportes, frota-de-veiculos-AAAA) e grava mercado/frota.json com o
total do RS e dos municípios da região, por grupo de veículo:
  leves    = automóvel + caminhonete + camioneta + utilitário (consomem gasolina/etanol)
  motos    = motocicleta + motoneta + ciclomotor
  pesados  = caminhão + caminhão trator + ônibus + micro-ônibus (consomem diesel)
  total    = todos os tipos
Dados públicos. Uso: python3 scripts/mercado-frota.py <pasta com .xlsx/.csv> <municipios.json> <saida.json>
"""
import sys, os, re, json, csv, unicodedata, datetime

def norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', s).strip().upper()

MESES = {'JAN': 1, 'FEV': 2, 'MAR': 3, 'ABR': 4, 'MAI': 5, 'JUN': 6, 'JUL': 7, 'AGO': 8, 'SET': 9, 'OUT': 10, 'NOV': 11, 'DEZ': 12}
def mes_do_nome(nome):
    n = norm(nome).replace('_', ' ')
    a = re.search(r'(20\d\d)', n)
    for k, v in MESES.items():
        if re.search(k, n): m = v; break
    else: return None
    return f'{a.group(1)}-{m:02d}' if a else None

GRUPOS = {
    'leves': ['AUTOMOVEL', 'CAMINHONETE', 'CAMIONETA', 'UTILITARIO'],
    'motos': ['MOTOCICLETA', 'MOTONETA', 'CICLOMOTOR'],
    'pesados': ['CAMINHAO', 'CAMINHAO TRATOR', 'ONIBUS', 'MICRO-ONIBUS', 'MICROONIBUS'],
}

def linhas(caminho):
    if caminho.lower().endswith('.csv'):
        raw = open(caminho, 'rb').read()
        txt = raw.decode('utf-8') if b'\xc3' in raw else raw.decode('latin1')
        sep = ';' if txt.count(';') > txt.count(',') else ','
        yield from csv.reader(txt.splitlines(), delimiter=sep)
    else:
        import openpyxl
        wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
        for ws in wb.worksheets:
            for r in ws.iter_rows(values_only=True):
                yield list(r)

def num(v):
    if v is None or v == '': return 0
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().replace('.', '').replace(',', '.')
    try: return float(s)
    except ValueError: return 0

def main():
    pasta, munArq, saida = sys.argv[1:4]
    cfg = json.load(open(munArq))
    alvo = set(norm(m) for m in cfg)
    out = json.load(open(saida)) if os.path.exists(saida) else {'v': 1, 'meses': {}}
    for f in sorted(os.listdir(pasta)):
        if not re.search(r'\.(xlsx|csv)$', f, re.I): continue
        ym = mes_do_nome(f)
        if not ym: print('sem mês no nome:', f); continue
        cab = None; reg = {}; rs = None
        for r in linhas(os.path.join(pasta, f)):
            cel = [norm(x) for x in r]
            if cab is None:
                if 'UF' in cel and any('MUNICIPIO' in c for c in cel): cab = cel; print(f, ym, 'colunas:', ' | '.join(c for c in cab if c))
                continue
            d = dict(zip(cab, r))
            uf = norm(d.get('UF')); mun = norm(next((d[k] for k in cab if 'MUNICIPIO' in k), ''))
            if uf != 'RS': continue
            tipos = {k: num(v) for k, v in d.items() if k and k not in ('UF',) and 'MUNICIPIO' not in k}
            tot = tipos.get('TOTAL') or sum(v for k, v in tipos.items() if k != 'TOTAL')
            g = {'total': tot, **{n: sum(tipos.get(t, 0) for t in ts) for n, ts in GRUPOS.items()}}
            rs = {k: (rs or {}).get(k, 0) + v for k, v in g.items()}
            if mun in alvo: reg[mun] = g
        if cab is None: print('cabeçalho não achado em', f); continue
        falta = alvo - set(reg)
        if falta: print('  municípios não achados:', ', '.join(sorted(falta)))
        out['meses'][ym] = {'rs': rs, 'municipios': reg}
        print(f'  {ym}: RS total {int(rs["total"]) if rs else 0} · {len(reg)} municípios da região')
    out['gerado_em'] = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M')
    out['fonte'] = 'Senatran — frota de veículos por município e tipo (gov.br/transportes)'
    out['ultimo_mes'] = max(out['meses']) if out['meses'] else None
    json.dump(out, open(saida, 'w'), ensure_ascii=False, separators=(',', ':'))
    print('ok:', saida, '·', len(out['meses']), 'meses')

main()
