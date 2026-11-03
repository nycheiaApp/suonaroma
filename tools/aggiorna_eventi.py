#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SuonaRoma · tools/aggiorna_eventi.py
────────────────────────────────────
Aggiorna data/eventi.json collegandosi ai siti ufficiali dei locali
(vedi data/locali.json). Solo librerie standard di Python: nessuna
dipendenza da installare, funziona in GitHub Actions così com'è.

Strategie di estrazione (provate nell'ordine, la prima che dà
risultati vince):
  · ical    — feed calendario iCal (.ics) dei siti WordPress con
              "The Events Calendar" e di qualsiasi altro sito che
              pubblica un link ?ical=1 / .ics
  · wp_json — API REST di The Events Calendar (/wp-json/tribe/...)
  · jsonld  — dati strutturati schema.org (Event / MusicEvent)
              dentro le pagine di elenco

Integrazione con l'archivio esistente (modalità "sostituisci futuro"):
per ogni locale estratto con successo gli eventi con data di OGGI in
poi vengono rimpiazzati dai dati freschi; il passato resta come
storico. I locali la cui fonte non risponde NON vengono toccati.

Output:
  · data/eventi.json           — dati aggiornati
  · data/eventi.js             — specchio per apertura via file://
  · tools/report.json / .md    — rapporto dell'esecuzione

Uso:  python3 tools/aggiorna_eventi.py [--giorni=120] [--solo-report]
"""
import json, re, ssl, sys, time, html as htmllib
import urllib.request, urllib.error, urllib.parse
import concurrent.futures as cf
from datetime import date, datetime, timedelta
from pathlib import Path

BASE   = Path(__file__).resolve().parent.parent   # cartella suonaroma/
CFG    = json.loads((BASE / 'tools' / 'config_scraping.json').read_text(encoding='utf-8'))
SETT   = CFG.get('impostazioni', {})
UA     = SETT.get('user_agent', 'SuonaRoma-bot/1.0 (aggiornamento eventi; contatto: vedi README-AUTOMAZIONE)')
TIMEO  = SETT.get('timeout_s', 25)
TENT   = SETT.get('tentativi', 2)
PAUSA  = SETT.get('pausa_s', 1.0)
GG_MAX = SETT.get('giorni_avanzo', 120)
CAP    = SETT.get('max_eventi_locale', 60)
PAR    = SETT.get('parallelo', 8)
SOLO_REPORT = '--solo-report' in sys.argv
for a in sys.argv:
    if a.startswith('--giorni='): GG_MAX = int(a.split('=')[1])

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo('Europe/Rome')
except Exception:
    TZ = None

def oggi():
    return datetime.now(TZ).date() if TZ else date.today()

# ── rete ─────────────────────────────────────────────────────
def get(url, t=TIMEO):
    """GET con User-Agent e retry; ritorna bytes ('' se fallisce)."""
    for i in range(TENT):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=t, context=CTX) as r:
                data = r.read()
            time.sleep(PAUSA)
            return data
        except Exception:
            if i == TENT - 1: return b''
            time.sleep(PAUSA * 2)
    return b''

def get_text(url, t=TIMEO):
    return get(url, t).decode('utf-8', 'replace')

def base_url(url):
    m = re.match(r'(https?://[^/]+)', url)
    return m.group(1) if m else url

# ── generi ───────────────────────────────────────────────────
GENERI = [
    ('Jazz / Blues',        r'jazz|blues|swing|soul|funk|bossa'),
    ('Rock / Metal',        r'rock|metal|punk|grunge'),
    ('Indie / Alternative', r'indie|post[- ]?rock|shoegaze|dream pop'),
    ('Pop / Cantautorato',  r'pop|cantaut|songwriter|acoustic|acustic'),
    ('Elettronica / DJ',    r'dj set|djset|electro|techno|house music|edm|elettronica|disco music'),
    ('Hip Hop / Rap',       r'hip ?hop|rap|trap'),
    ('Classica / Opera',    r'classica|sinfon|orchestra|opera|pianoforte solo'),
    ('Folk / Country',      r'folk|country|bluegrass|celtic'),
    ('Latino / World',      r'latino|salsa|bachata|reggae|afrobeat|world'),
    ('Cover / Tribute',     r'tribute|cover band|omaggio a'),
]
def classifica(t):
    t = (t or '').lower()
    for nome, pat in GENERI:
        if re.search(pat, t): return nome
    return 'Live'

def pulisci(s):
    s = htmllib.unescape(str(s or '')).replace('\u00a0', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:180]

# ── parser iCal ──────────────────────────────────────────────
def unfold_ics(text):
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    out = []
    for line in text.split('\n'):
        if line[:1] in (' ', '\t') and out:
            out[-1] += line[1:]
        else:
            out.append(line)
    return out

def dec_ics(s):
    s = re.sub(r'\\n', '\n', s, flags=re.I)
    s = s.replace('\\,', ',').replace('\\;', ';').replace('\\\\', '\\')
    if 'QUOTED-PRINTABLE' in s.upper():
        s = re.sub(r'=([0-9A-F]{2})', lambda m: chr(int(m.group(1), 16)), s, flags=re.I).replace('=\n', '')
    return s

def parse_dt_ics(val):
    """DTSTART → datetime (Europe/Rome se possibile)."""
    val = val.strip()
    utc = val.endswith('Z')
    tzid = None
    m = re.search(r'TZID=([^:;]+)', val)
    if m: tzid = m.group(1)
    body = val.split(':')[-1].rstrip('Zz').strip()
    try:
        if 'T' in body:
            dt = datetime.strptime(body[:15], '%Y%m%dT%H%M%S')
        else:
            d = datetime.strptime(body[:8], '%Y%m%d')
            dt = datetime(d.year, d.month, d.day, 0, 0)
    except ValueError:
        return None
    try:
        from zoneinfo import ZoneInfo
        if utc:
            dt = dt.replace(tzinfo=ZoneInfo('UTC')).astimezone(ZoneInfo('Europe/Rome'))
        elif tzid:
            try: dt = dt.replace(tzinfo=ZoneInfo(tzid)).astimezone(ZoneInfo('Europe/Rome'))
            except Exception: pass
        elif TZ:
            dt = dt.replace(tzinfo=TZ)
    except Exception:
        pass
    return dt

def parse_ics(text, limite=200):
    """Estrae {dt, sum, desc, url} dai VEVENT."""
    lines = unfold_ics(text)
    evs, cur = [], None
    for ln in lines:
        u = ln.strip().upper()
        if u.startswith('BEGIN:VEVENT'):
            cur = {'dt': None, 'sum': '', 'desc': '', 'url': '', 'loc': ''}
        elif u.startswith('END:VEVENT'):
            if cur and cur['dt']: evs.append(cur)
            cur = None
        elif cur is not None:
            m = re.match(r'([A-Z\-]+)(?:;([^:]*))?:(.*)', ln)
            if not m: continue
            prop, params, val = m.group(1).upper(), m.group(2) or '', m.group(3).strip()
            if prop == 'DTSTART':
                dt = parse_dt_ics(params + ':' + val if 'TZID' in params else val)
                if dt: cur['dt'] = dt
            elif prop == 'SUMMARY':     cur['sum']  = dec_ics(val)
            elif prop == 'DESCRIPTION': cur['desc'] = dec_ics(val)
            elif prop == 'URL':         cur['url']  = val
            elif prop == 'LOCATION':    cur['loc']  = dec_ics(val)
        if len(evs) >= limite: break
    return evs

# ── strategie di estrazione ──────────────────────────────────
def estrai_ical(base, html0, scadenza):
    """Feed iCal: prima i link ?ical=1/.ics presenti nella pagina,
    poi i percorsi standard di The Events Calendar (solo siti WP)."""
    candidati = []
    for m in re.finditer(r'href="([^"]*(?:\?ical=1|\.ics)[^"]*)"', html0, re.I):
        u = m.group(1).replace('&amp;', '&')
        candidati.append(urllib.parse.urljoin(base, u))
    if re.search(r'wp-json|wp-content|tribe', html0, re.I):
        candidati += [base + p for p in ('/events/?ical=1', '/eventi/?ical=1', '/?ical=1')]
    visti, eventi = set(), []
    for u in candidati[:5]:
        if time.monotonic() > scadenza: break
        if u in visti: continue
        visti.add(u)
        ics = get_text(u, t=12)
        if 'BEGIN:VEVENT' not in ics: continue
        eventi = parse_ics(ics)
        if eventi: break
    return eventi

def estrai_wp_json(base, scadenza):
    out, p = [], 1
    while p <= 3 and time.monotonic() < scadenza:
        u = f"{base}/wp-json/tribe/events/v1/events?per_page=40&paged={p}&start_date={oggi().isoformat()}"
        try:
            d = json.loads(get_text(u, t=12) or '{}')
        except Exception:
            break
        evs = d.get('events') or []
        for e in evs:
            try: dt = datetime.fromisoformat(str(e.get('start_date', '')))
            except Exception: continue
            out.append({'dt': dt, 'sum': e.get('title', ''),
                        'desc': e.get('excerpt', '') or e.get('description', '') or '',
                        'url': e.get('url', ''), 'loc': ''})
        if len(evs) < 40: break
        p += 1
    return out

def estrai_jsonld(url, html0, scadenza):
    eventi = []
    def da_pagina(html):
        for blocco in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
            try:
                data = json.loads(blocco.strip().rstrip(';') or 'null')
            except Exception:
                continue
            if isinstance(data, dict):
                candidati = data.get('@graph', [data])
            elif isinstance(data, list):
                candidati = data
            else:
                candidati = []
            for item in candidati:
                if not isinstance(item, dict): continue
                if 'Event' not in str(item.get('@type', '')): continue
                sd = str(item.get('startDate', '') or item.get('start_date', ''))
                if not sd: continue
                try: dt = datetime.fromisoformat(sd.replace('Z', '+00:00'))
                except Exception: continue
                loc = item.get('location') or {}
                eventi.append({'dt': dt, 'sum': item.get('name', ''),
                               'desc': str(item.get('description', '') or ''),
                               'url': str((item.get('offers') or {}).get('url', '') or item.get('url', '') or ''),
                               'loc': str(loc.get('name', '') if isinstance(loc, dict) else loc)})
    da_pagina(html0)
    if not eventi and time.monotonic() < scadenza:
        pg = urllib.parse.urljoin(url, 'eventi/')
        da_pagina(get_text(pg, t=12))
    return eventi

# ── parser dedicati ──────────────────────────────────────────
MESI_IT = {'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4, 'maggio': 5,
           'giugno': 6, 'luglio': 7, 'agosto': 8, 'settembre': 9,
           'ottobre': 10, 'novembre': 11, 'dicembre': 12}

def estrai_apm_card(url, html0, scadenza, pagine=3):
    """Parser per le schede 'event-card' di auditorium.com: le card
    contengono titolo, data testuale italiana ('Mercoledì 04 Novembre
    2026'), orario ('h. 20:00') ed etichetta del genere. Vengono
    tenuti solo gli eventi ospitati sul dominio dell'Auditorium.
    Segue le prime N pagine dell'elenco (/it/eventi/page/2/...)."""
    evs = []
    def da_html(html):
        for m in re.finditer(r'<div class="event-card[^"]*">(.*?)(?=<div class="event-card|$)', html, re.S | re.I):
            if time.monotonic() > scadenza: return
            blocco = m.group(1)
            def campo(cls):
                x = re.search(r'<span class="' + cls + r'[^"]*">(.*?)</span>', blocco, re.S | re.I)
                return pulisci(re.sub(r'<[^>]+>', ' ', x.group(1))) if x else ''
            link = re.search(r'<a class="apm-card-link" href="([^"]+)"', blocco, re.I)
            titolo = campo('text-card-title')
            sub    = campo('text-subtitle').lower()
            intro  = campo('text-intro').lower()
            label  = campo('text-label')
            if not (titolo and sub): continue
            if link and 'auditorium.com' not in link.group(1): continue   # eventi esterni (es. Santa Cecilia)
            dm = re.search(r'(\d{1,2})\s+([a-zàèéìòù]+)\s+(\d{4})', sub)
            if not dm or dm.group(2) not in MESI_IT: continue
            try:
                dt = datetime(int(dm.group(3)), MESI_IT[dm.group(2)], int(dm.group(1)))
            except ValueError:
                continue
            om = re.search(r'(\d{1,2})[.:](\d{2})', intro)
            if om: dt = dt.replace(hour=int(om.group(1)) % 24, minute=int(om.group(2)))
            biglietti = bool(re.search(r'event-ticket-link', blocco, re.I))
            evs.append({'dt': dt, 'sum': titolo, 'desc': label, 'url': '',
                        'loc': '', 'ticket': biglietti})
    da_html(html0)
    for p in range(2, pagine + 1):
        if time.monotonic() > scadenza or not evs: break
        pg = urllib.parse.urljoin(url, f'page/{p}/')
        da_html(get_text(pg, t=12))
    return evs

def normalizza(raw, venue):
    dt = raw['dt']
    if dt.tzinfo is not None and TZ: dt = dt.astimezone(TZ)
    if dt.date() < oggi() or dt.date() > oggi() + timedelta(days=GG_MAX): return None
    artista = pulisci(re.sub(r'\s*[-–|]\s*' + re.escape(venue['nome']) + r'\s*$', '', raw.get('sum', ''), flags=re.I)) or 'Live in programma'
    txt = (artista + ' ' + raw.get('desc', '')).lower()
    biglietti = bool(raw.get('url')) or bool(raw.get('ticket')) or bool(re.search(r'bigliett|ticket|presale|abbonament', txt))
    descr = pulisci(raw.get('desc', ''))
    loc = pulisci(raw.get('loc', ''))
    note = ''
    if descr and descr.lower() != artista.lower(): note = descr[:140]
    elif loc and loc.lower() not in venue['nome'].lower(): note = loc
    return {'venueId': venue['id'], 'data': dt.strftime('%Y-%m-%d'),
            'ora': dt.strftime('%H:%M'), 'artista': artista,
            'genere': classifica(txt), 'prenotazione': biglietti, 'note': note}

# ── per-locale ───────────────────────────────────────────────
def estrai_locale(v):
    cfgl = CFG.get('locali', {}).get(str(v['id']), {})
    if cfgl.get('attivo') is False:
        return [], 'disattivato: ' + cfgl.get('motivo', ''), None
    url = cfgl.get('url') or v.get('website') or ''
    if not url: return [], 'nessun sito', None
    base = base_url(url)
    scadenza = time.monotonic() + 50          # budget massimo per locale
    html0 = get_text(url, t=12) if time.monotonic() < scadenza else ''
    wp = bool(re.search(r'wp-json|wp-content|tribe', html0, re.I))
    strat = cfgl.get('strategie', ['ical', 'wp_json', 'jsonld'])
    tentato = []
    for s in strat:
        if time.monotonic() > scadenza: break
        if s == 'wp_json' and not wp:
            tentato.append('wp_json: saltato (non WordPress)')
            continue
        try:
            raw = {'ical':      lambda: estrai_ical(base, html0, scadenza),
                   'wp_json':   lambda: estrai_wp_json(base, scadenza),
                   'jsonld':    lambda: estrai_jsonld(url, html0, scadenza),
                   'html_apm':  lambda: estrai_apm_card(url, html0, scadenza)}[s]()
        except Exception as ex:
            tentato.append(f'{s}: errore {type(ex).__name__}')
            continue
        evs = [e for e in (normalizza(r, v) for r in raw) if e]
        if evs:
            dedup, visti = [], set()
            for e in evs:
                k = (e['data'], e['ora'], e['artista'].casefold())
                if k not in visti: visti.add(k); dedup.append(e)
            dedup.sort(key=lambda e: (e['data'], e['ora']))
            return dedup[:CAP], f'{s} · {len(dedup)} eventi', s
        tentato.append(f'{s}: 0 eventi')
    if not html0:
        return [], 'sito non raggiungibile', None
    return [], 'fonte non disponibile (' + '; '.join(tentato) + ')', None

# ── main ─────────────────────────────────────────────────────
def main():
    locali = json.loads((BASE / 'data' / 'locali.json').read_text(encoding='utf-8'))
    vecchi = json.loads((BASE / 'data' / 'eventi.json').read_text(encoding='utf-8'))
    og = oggi().isoformat()
    print(f"SuonaRoma · aggiornamento eventi del {og} · finestra {GG_MAX} giorni\n")

    with cf.ThreadPoolExecutor(PAR) as ex:
        risultati = dict(ex.map(lambda v: (v['id'], estrai_locale(v)), locali))

    nuovi, report = [], []
    for v in locali:
        evs, stato, fonte = risultati.get(v['id'], ([], 'non elaborato', None))
        passati  = [e for e in vecchi if e.get('venueId') == v['id'] and e.get('data', '') < og]
        presenti = [e for e in vecchi if e.get('venueId') == v['id'] and e.get('data', '') >= og]
        if evs:
            nuovi.extend(passati + evs)
            report.append({'id': v['id'], 'nome': v['nome'], 'fonte': fonte, 'stato': 'ok',
                           'estratti': len(evs), 'rimossi_vecchi': len(presenti)})
            print(f"  ✔ {v['nome'][:34]:34} {stato}  (+{len(evs)} al posto di {len(presenti)})")
        else:
            nuovi.extend(passati + presenti)
            report.append({'id': v['id'], 'nome': v['nome'], 'fonte': None, 'stato': stato, 'estratti': 0})
            print(f"  · {v['nome'][:34]:34} {stato[:74]} — dati attuali invariati ({len(presenti)})")

    nuovi.sort(key=lambda e: (e['data'], e['ora'], e['venueId']))
    ok = sum(1 for r in report if r['stato'] == 'ok')

    rep = {'eseguito_il': datetime.now(TZ).isoformat(timespec='seconds') if TZ else datetime.now().isoformat(timespec='seconds'),
           'giorni_avanzo': GG_MAX, 'locali_aggiornati': ok, 'locali_totali': len(report),
           'eventi_totali': len(nuovi), 'dettaglio': report}
    (BASE / 'tools' / 'report.json').write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding='utf-8')

    righe = ['# Rapporto aggiornamento eventi SuonaRoma', '', f"- Eseguito il: **{rep['eseguito_il']}** (ora italiana)",
             f"- Locali aggiornati: **{ok} / {len(report)}**", f"- Eventi totali in archivio: **{len(nuovi)}**", '', '| Locale | Fonte | Eventi |', '|---|---|---|']
    for r in report:
        righe.append(f"| {r['nome']} | {r['fonte'] or r['stato']} | {r['estratti']} |")
    (BASE / 'tools' / 'report.md').write_text('\n'.join(righe) + '\n', encoding='utf-8')

    if not SOLO_REPORT:
        (BASE / 'data' / 'eventi.json').write_text(json.dumps(nuovi, ensure_ascii=False), encoding='utf-8')
        js = (BASE / 'data' / 'eventi.js').read_text(encoding='utf-8')
        header = js.split('window.EVENTI_DATA', 1)[0]
        (BASE / 'data' / 'eventi.js').write_text(header + 'window.EVENTI_DATA = ' + json.dumps(nuovi, ensure_ascii=False) + ';\n', encoding='utf-8')
        print(f"\nSalvati data/eventi.json e data/eventi.js ({len(nuovi)} eventi).")
    else:
        print(f"\nModalità --solo-report: file dati NON modificati ({len(nuovi)} eventi risultanti).")
    print(f"Rapporto: tools/report.json · tools/report.md  |  locali aggiornati: {ok}/{len(report)}")

if __name__ == '__main__':
    main()
