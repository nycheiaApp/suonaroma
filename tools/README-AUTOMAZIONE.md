════════════════════════════════════════════════════════════
 AUTOMAZIONE AGGIORNAMENTO EVENTI · SuonaRoma
════════════════════════════════════════════════════════════

Un agente automatico (GitHub Actions) aggiorna ogni giorno alle
14:00 (ora italiana) gli eventi di SuonaRoma: si collega ai siti
ufficiali dei locali, estrae la programmazione e aggiorna i file
data/eventi.json e data/eventi.js con un commit automatico.

── COSA C'È NELLA CARTELLA ─────────────────────────────────

  .github/workflows/aggiorna-eventi.yml   il job giornaliero
  tools/aggiorna_eventi.py                l'estrattore (solo
                                          librerie standard
                                          Python: zero install)
  tools/config_scraping.json              configurazione per
                                          locale (URL alternativi,
                                          strategie, note)
  tools/report.json / report.md           rapporto dell'ultima
                                          esecuzione

── INSTALLAZIONE (una volta sola) ──────────────────────────

 1. Copia nella radice del repository:
      · la cartella .github/ (con dentro workflows/aggiorna-eventi.yml)
      · la cartella tools/
    (se il sito è nella radice del repo, va bene così; se è in una
    sottocartella, vedi più avanti "SITO IN SOTTOCARTELLA")

 2. Commit e push:
      git add .github tools
      git commit -m "Automazione aggiornamento eventi"
      git push

 3. Su GitHub: Settings → Actions → General →
    "Allow all actions and reusable workflows" (di solito già attivo).

 4. Prova manuale: scheda Actions → "Aggiorna eventi" → Run workflow.
    Apri l'esecuzione: nel riquadro "Summary" trovi il rapporto
    completo locale per locale.

── COME FUNZIONA ───────────────────────────────────────────

 · Il job viene controllato ogni ora e parte solo quando a Roma
   sono le 14:00: l'orario resta corretto anche al cambio ora
   legale/solare (il cron di GitHub usa UTC).
 · Per ogni locale prova in ordine:
     1) feed iCal (.ics, tipico dei siti WordPress con The Events
        Calendar — Auditorium, Casa del Jazz, Big Mama...)
     2) API REST The Events Calendar (/wp-json/tribe/...)
     3) dati strutturati schema.org (JSON-LD) nelle pagine eventi
 · La prima strategia che estrae eventi vince.
 · INTEGRAZIONE: per i locali estratti con successo, gli eventi
   da oggi in avanti vengono SOSTITUITI con quelli freschi; il
   passato resta come storico. I locali la cui fonte non risponde
   NON vengono modificati (il sito non resta mai vuoto).
 · Se i dati non cambiano, nessun commit (il repo resta pulito).
 · Il rapporto dell'ultima esecuzione è in tools/report.md e viene
   mostrato anche nella pagina dell'esecuzione di Actions.

── LIMITI NOTI ─────────────────────────────────────────────

 · I siti che caricano i contenuti solo via JavaScript (es.
   Fonclea, Alexanderplatz) non si lasciano leggere con richieste
   HTTP semplici: vengono segnalati nel rapporto come "fonte non
   disponibile" e i loro dati restano invariati.
 · Facebook e Instagram non sono leggibili senza login: se un
   locale usa solo i social, serve un sito ufficiale.
 · Alcuni siti bloccano i bot (es. protezioni Cloudflare): anche
   in quel caso il locale viene semplicemente saltato.
 · Verifica sempre gli orari prima di pubblicare: l'estrazione è
   automatica e può sbagliare (soprattutto i generi, che sono
   stimati dalle parole nel titolo).

── PERSONALIZZARE ──────────────────────────────────────────

 · Cambiare l'ora: modifica il numero 14 nel passaggio
   "È l'ora" del workflow.
 · Escludere un locale: in tools/config_scraping.json aggiungi
     "17": { "attivo": false, "motivo": "..." }
 · Usare un URL diverso per un locale:
     "4": { "url": "https://www.esempio.it", "attivo": true }
 · Limitare le strategie di un locale (ical, wp_json, jsonld,
   html_apm — quest'ultimo è il parser dedicato ad auditorium.com):
     "3": { "strategie": ["ical"] }

── SITO IN SOTTOCARTELLA ───────────────────────────────────

 Lo script individua la cartella del sito a partire dalla sua
 posizione (../data rispetto a tools/). Se metti tools/ dentro la
 sottocartella del sito (es. suonaroma/tools/), funziona senza
 modifiche; il workflow instead va sempre in .github/workflows/
 alla radice del repo, eventualmente con un passaggio di
 working-directory. Scrivimi e te lo adatto.

── NOTE LEGALI / BONARIENZA ────────────────────────────────

 Lo script si limita a leggere pagine pubbliche, con User-Agent
 dichiarato, pausa tra le richieste e senza aggirare protezioni.
 Per un uso intensivo chiedi sempre ai locali il consenso o i
 dati in formato aperto (feed iCal gratuiti, se chiesti).
