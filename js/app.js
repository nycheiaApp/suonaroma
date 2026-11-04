// ══════════════════════════════════════════
// SuonaRoma · app.js
// Tutte le funzionalità della v2 + correzioni:
//  · fallback dati via data/*.js quando il sito è aperto senza server (file://)
//  · calendario che include anche oggi (il pulsante "Oggi" ora funziona)
//  · chiusura pannello con tasto ESC
//  · messaggio d'aiuto se i dati non si caricano
//  · copia negli appunti con fallback universale
//  · Leaflet incluso in locale + cartina con fornitori multipli e
//    verifica preventiva dei blocchi 403 (v4/v5)
// ══════════════════════════════════════════

// ── STATO GLOBALE ──
let venues         = [];
let eventiOggi     = [];
let eventiTutti    = [];
let allGenres      = [];
let sortedEvents   = [];
let selectedGenres = new Set();
let currentVenueId = null;
let leafletMap     = null;
let mapMarkers     = {};
let activeMapVenue = null;
let calSelectedDate = null;
let dataLoadError  = false;

// ── DATE ──
const _today  = new Date();
const _mesiL  = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const _giorni = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];

function pad2(n){ return String(n).padStart(2,'0'); }
function oggiStr(d = _today){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

function esc(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escJs(s){ return String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

function initDate() {
  const el1 = document.getElementById('live-date');
  const el2 = document.getElementById('full-date');
  if(el1) el1.textContent = oggiStr().split('-').reverse().join('/');
  if(el2) el2.textContent = `${_giorni[_today.getDay()]} ${_today.getDate()} ${_mesiL[_today.getMonth()]} ${_today.getFullYear()}`;
}

// ── CARICAMENTO DATI ──
// Prova prima con fetch (funziona su server/hosting e legge i JSON,
// che restano il punto di riferimento per le modifiche); se fallisce
// (apertura diretta con doppio clic, protocollo file://) usa i file
// data/*.js che impostano window.LOCALI_DATA / window.EVENTI_DATA.
async function loadData() {
  dataLoadError = false;
  try {
    const [rLocali, rEventi] = await Promise.all([
      fetch('data/locali.json'),
      fetch('data/eventi.json')
    ]);
    if(!rLocali.ok || !rEventi.ok) throw new Error('risposta non valida');
    venues       = await rLocali.json();
    eventiTutti  = await rEventi.json();
  } catch(e) {
    venues      = window.LOCALI_DATA || [];
    eventiTutti = window.EVENTI_DATA || [];
    if(!venues.length) dataLoadError = true;
  }
  eventiOggi = eventiTutti.filter(e => e.data === oggiStr());
  allGenres  = [...new Set(venues.flatMap(v => v.generi))].sort((a,b) => a.localeCompare(b,'it'));
}

function getVenue(id) { return venues.find(v => v.id === id); }

// ── v9 · locali senza informazioni ──
// Un locale è "senza informazioni" quando l'archivio non ha eventi futuri
// per esso: la fonte non è raggiungibile (blocco anti-bot, sito rotto,
// solo social) o il locale non ha ancora pubblicato la programmazione.
function venueHaEventi(id) {
  return eventiTutti.some(e => e.venueId === id && e.data >= oggiStr());
}
function venueNADiv(cls) {
  return `<div class="${cls}"><i class="fa fa-circle-info"></i> Informazioni non disponibili</div>`;
}

function dataErrorMsg() {
  return `<div class="data-error">
    <strong>Dati non disponibili</strong>
    Non è stato possibile caricare locali ed eventi.<br>
    Se hai aperto il sito con doppio clic (file://), avvia un server locale:<br>
    <code>python -m http.server 8000</code> → poi apri <code>http://localhost:8000</code><br>
    Vedi il file <code>LEGGIMI.txt</code> per tutte le istruzioni.
  </div>`;
}

// ── INIT PAGINE ──
async function initPaginaOggi()      { initDate(); await loadData(); renderEvents(); }
async function initPaginaCalendario(){ initDate(); await loadData(); renderCalendario(); }
async function initPaginaLocali()    { initDate(); await loadData(); renderVenues(); }
async function initPaginaGeneri()    { initDate(); await loadData(); renderGenreTags(); }
async function initPaginaMappa()     { initDate(); await loadData(); renderMappa(); }
function  initPaginaContatti()       { initDate(); }

// ── CARD EVENTO (riusabile) ──
function buildEventCard(ev, idx, totalCount, extraTopLabel) {
  const v      = ev.venueId ? getVenue(ev.venueId) : null;
  const vName  = v ? v.nome      : (ev.tmVenue  || '');
  const vAddr  = v ? v.indirizzo : (ev.tmAddress || '');
  const vClick = v ? `openVenuePanel(${v.id})` : `window.open('${ev.tmUrl||'#'}','_blank')`;
  const badge  = ev.isTM
    ? `<span class="booking-badge booking-yes" style="background:var(--accent)">🎟 Biglietti disponibili</span>`
    : `<span class="booking-badge ${ev.prenotazione?'booking-yes':'booking-no'}">${ev.prenotazione?'● Prenotazione richiesta':'○ Senza prenotazione'}</span>`;
  const topLabel = extraTopLabel
    ? `<div class="event-date-label">${extraTopLabel}</div>`
    : '';
  const artista = ev.artista || ev.artist || '';
  const genere  = ev.genere  || ev.genre  || '';
  return `<div class="event-card" onclick="${vClick}">
    ${topLabel}
    <div class="event-num">Nº ${String(idx+1).padStart(2,'0')} / ${String(totalCount).padStart(2,'0')}</div>
    <div class="event-time">${esc(ev.ora)}</div>
    <div class="event-artist">${esc(artista)}</div>
    <div class="event-genre-label">${esc(genere)}</div>
    ${ev.note ? `<div class="event-note">${esc(ev.note)}</div>` : ''}
    <div class="event-meta">
      <div class="event-meta-row"><i class="fa fa-location-dot"></i>
        ${v ? `<a class="venue-link" onclick="event.stopPropagation();openVenuePanel(${v.id})">${esc(vName)}</a>`
            : `<span style="font-weight:600;font-family:'Courier New', Courier, monospace;font-size:11px">${esc(vName)}</span>`}
      </div>
      <div class="event-meta-row"><i class="fa fa-map-marker-alt"></i><span>${esc(vAddr)}</span></div>
      <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin-top:.2rem">
        ${badge}
        <button onclick="event.stopPropagation();shareEventCard(${v?v.id:'null'},this,'${escJs(artista)}','${escJs(genere)}','${escJs(ev.ora)}')" class="card-share-btn"><i class="fa fa-share-nodes"></i> Condividi</button>
      </div>
    </div>
  </div>`;
}

// ── PAGINA OGGI ──
function renderEvents() {
  sortedEvents = [...eventiOggi].sort((a,b) => a.ora.localeCompare(b.ora));
  const venueIds = [...new Set(sortedEvents.filter(e=>e.venueId).map(e=>e.venueId))];
  const se = document.getElementById('stat-eventi');
  const sl = document.getElementById('stat-locali');
  const sa = document.getElementById('stat-archivio');
  if(se) se.textContent = dataLoadError ? '—' : sortedEvents.length;
  if(sl) sl.textContent = dataLoadError ? '—' : venueIds.length;
  if(sa) sa.textContent = dataLoadError ? '—' : venues.length;

  const grid = document.getElementById('events-grid');
  if(!grid) return;

  if(dataLoadError) { grid.style.background='transparent'; grid.innerHTML = dataErrorMsg(); return; }

  if(sortedEvents.length === 0) {
    grid.style.background = 'transparent';
    grid.innerHTML = `<div style="grid-column:1/-1;padding:3rem 2rem;text-align:center;font-family:'Courier New', Courier, monospace;font-size:11px;color:var(--muted);letter-spacing:.1em"><span style="display:block;font-family:Georgia, 'Times New Roman', serif;font-size:1.5rem;color:var(--border);margin-bottom:.8rem">♩</span>Nessun evento in programma oggi.<br>Consulta il <a href="calendario.html" style="color:var(--accent)">calendario</a> per i prossimi giorni.</div>`;
    return;
  }
  grid.style.background = 'var(--border)';
  grid.innerHTML = sortedEvents.map((ev, i) => buildEventCard(ev, i, sortedEvents.length, null)).join('');
}

// ── PAGINA LOCALI ──
function renderVenues(list) {
  const grid = document.getElementById('venues-grid');
  if(!grid) return;
  if(dataLoadError) { grid.style.background='transparent'; grid.innerHTML = dataErrorMsg(); return; }

  const data = [...(list || venues)].sort((a,b) => a.nome.localeCompare(b.nome, 'it'));
  const n = data.length;
  const hint  = document.getElementById('locali-hint');
  const count = document.getElementById('locali-count');
  if(hint)  hint.textContent  = `${n} ${n===1?'locale':'locali'}`;
  if(count && !list) count.textContent = `${venues.length} locali in archivio`;

  grid.innerHTML = data.map(v => `
    <div class="venue-card">
      <div class="vc-num">Nº ${String(venues.indexOf(v)+1).padStart(2,'0')} / ${String(venues.length).padStart(2,'0')}</div>
      <div class="vc-tag">${esc(v.tag)}</div>
      <div class="vc-name">${esc(v.nome)}</div>
      ${venueHaEventi(v.id) ? '' : venueNADiv('vc-na')}
      ${v.descrizione ? `<div style="font-family:'Courier New', Courier, monospace;font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:1rem">${esc(v.descrizione)}</div>` : ''}
      <div class="vc-info">
        <div class="vc-row"><i class="fa fa-map-marker-alt"></i><span>${esc(v.indirizzo)}</span></div>
        <div class="vc-row"><i class="fa fa-phone"></i><a class="vc-phone" href="tel:${esc((v.telefono||'').replace(/\s/g,''))}">${esc(v.telefono)}</a></div>
        <div class="vc-row"><i class="fa fa-globe"></i><a class="vc-web" href="${esc(v.website)}" target="_blank" rel="noopener">${esc(v.website.replace(/https?:\/\//,''))}</a></div>
      </div>
      <div class="vc-actions">
        <a class="vc-btn vc-btn-call" href="tel:${esc((v.telefono||'').replace(/\s/g,''))}"><i class="fa fa-phone"></i> Chiama</a>
        <button class="vc-btn vc-btn-events" onclick="openVenuePanel(${v.id})"><i class="fa fa-calendar"></i> Eventi</button>
        <button class="vc-btn vc-btn-share" onclick="shareVenueCard(${v.id},this)"><i class="fa fa-share-nodes"></i> Condividi</button>
      </div>
    </div>`).join('') || `<div style="grid-column:1/-1;padding:3rem 2rem;font-family:'Courier New', Courier, monospace;font-size:11px;color:var(--muted);text-align:center"><span style="display:block;font-family:Georgia, 'Times New Roman', serif;font-size:1.5rem;color:var(--border);margin-bottom:.5rem">♪</span>Nessun locale trovato</div>`;
}

function filterVenues(q) {
  const clear = document.getElementById('locali-clear');
  const hint  = document.getElementById('locali-hint');
  const bar   = document.getElementById('locali-bar-label');
  const count = document.getElementById('locali-count');
  const term  = q.trim().toLowerCase();
  clear.classList.toggle('hidden', term === '');
  if(!term) { renderVenues(); bar.textContent='◆ tutti i locali'; count.textContent=`${venues.length} locali in archivio`; return; }
  const filtered = venues.filter(v =>
    v.nome.toLowerCase().includes(term) ||
    v.indirizzo.toLowerCase().includes(term) ||
    v.tag.toLowerCase().includes(term) ||
    v.generi.some(g => g.toLowerCase().includes(term)) ||
    (v.tipo && v.tipo.toLowerCase().includes(term)) ||
    (v.descrizione && v.descrizione.toLowerCase().includes(term))
  );
  renderVenues(filtered);
  const n = filtered.length;
  hint.textContent  = `${n} ${n===1?'risultato':'risultati'}`;
  bar.textContent   = n > 0 ? `◆ risultati per "${q.trim()}"` : '◆ nessun risultato';
  count.textContent = `${n} ${n===1?'locale trovato':'locali trovati'}`;
}

function clearVenueSearch() {
  const input = document.getElementById('locali-search');
  input.value = ''; input.focus(); filterVenues('');
}

// ── PAGINA GENERI ──
function renderGenreTags() {
  const wrap = document.getElementById('genre-tags');
  if(!wrap) return;
  wrap.innerHTML =
    allGenres.map(g => `<span class="genre-tag${selectedGenres.has(g)?' selected':''}" onclick="toggleGenre('${escJs(g)}')">${esc(g)}</span>`).join('') +
    `<span class="genre-reset" onclick="resetGenres()">✕ Azzera filtri</span>`;
  renderGenreResults();
}

function toggleGenre(g) { selectedGenres.has(g) ? selectedGenres.delete(g) : selectedGenres.add(g); renderGenreTags(); }
function resetGenres()   { selectedGenres.clear(); renderGenreTags(); }

function renderGenreResults() {
  const grid  = document.getElementById('genre-events-grid');
  const count = document.getElementById('genre-count');
  if(!grid) return;
  if(dataLoadError) { grid.style.background='transparent'; grid.innerHTML = dataErrorMsg(); count.textContent='dati non disponibili'; return; }

  if(selectedGenres.size === 0) {
    count.textContent = 'seleziona un genere';
    grid.innerHTML = `<div class="generi-empty" style="grid-column:1/-1"><span>♩</span>Seleziona uno o più generi per vedere gli eventi</div>`;
    grid.style.background = 'transparent'; return;
  }
  const matchesGenre = (genreStr) => {
    const evGenres = genreStr.toLowerCase().split(/[\/,]+/).map(g => g.trim());
    return [...selectedGenres].some(sg => evGenres.some(eg => eg.includes(sg.toLowerCase()) || sg.toLowerCase().includes(eg)));
  };
  // Correzione v3: gli eventi di oggi non vengono più conteggiati due volte
  const todayFiltered  = eventiOggi.filter(ev => matchesGenre(ev.genere || ''));
  const futureFiltered = eventiTutti.filter(ev => ev.data > oggiStr() && matchesGenre(ev.genere || ''));
  const total = todayFiltered.length + futureFiltered.length;
  count.textContent = `${total} ${total===1?'evento trovato':'eventi trovati'}`;
  grid.style.background = total > 0 ? 'var(--border)' : 'transparent';
  if(total === 0) { grid.innerHTML = `<div class="generi-empty" style="grid-column:1/-1"><span>♪</span>Nessun evento trovato</div>`; return; }

  const todayCards  = todayFiltered.map((ev, i) => buildEventCard(ev, i, todayFiltered.length, '● OGGI'));
  const futureCards = futureFiltered.map((ev, i) => {
    const d = new Date(ev.data+'T00:00:00');
    const label = `${d.getDate()} ${_mesiL[d.getMonth()].slice(0,3).toUpperCase()}`;
    return buildEventCard(ev, i, futureFiltered.length, label);
  });
  grid.innerHTML = [...todayCards, ...futureCards].join('');
}

// ── PAGINA CALENDARIO ──
// Correzione v3: include anche oggi, così il pulsante "Oggi" mostra gli eventi del giorno
function getAllAvailableDatesSorted() {
  return [...eventiTutti]
    .filter(e => e.data >= oggiStr())
    .sort((a,b) => a.data !== b.data ? a.data.localeCompare(b.data) : a.ora.localeCompare(b.ora));
}

function renderCalendario() {
  const all = getAllAvailableDatesSorted();
  const dates = [...new Set(all.map(e => e.data))].sort();
  if(!calSelectedDate && dates.length > 0) calSelectedDate = dates[0];
  const input = document.getElementById('cal-date-input');
  if(input) { input.min = dates[0]||''; input.max = dates[dates.length-1]||''; input.value = calSelectedDate||''; }
  _renderCalResults();
}

function _renderCalResults() {
  const all = getAllAvailableDatesSorted();
  let filtered, labelText;
  if(calSelectedDate) {
    filtered = all.filter(e => e.data === calSelectedDate);
    const d = new Date(calSelectedDate+'T00:00:00');
    labelText = `◆ ${_giorni[d.getDay()]} ${d.getDate()} ${_mesiL[d.getMonth()]} ${d.getFullYear()}`;
  } else {
    filtered = all;
    labelText = '◆ tutti gli eventi in programma';
  }
  const bar   = document.getElementById('cal-bar-label');
  const count = document.getElementById('cal-count');
  const hint  = document.getElementById('cal-hint');
  if(bar)   bar.textContent   = labelText;
  if(count) count.textContent = `${filtered.length} ${filtered.length===1?'evento':'eventi'}`;
  if(hint)  hint.textContent  = `${filtered.length} ${filtered.length===1?'evento trovato':'eventi trovati'}`;

  const grid = document.getElementById('cal-events-grid');
  if(!grid) return;
  if(dataLoadError) { grid.style.background='transparent'; grid.innerHTML = dataErrorMsg(); return; }
  if(filtered.length === 0) {
    grid.style.background = 'transparent';
    grid.innerHTML = `<div style="grid-column:1/-1;padding:3rem 2rem;font-family:'Courier New', Courier, monospace;font-size:11px;color:var(--muted);text-align:center;letter-spacing:.1em"><span style="display:block;font-family:Georgia, 'Times New Roman', serif;font-size:1.5rem;color:var(--border);margin-bottom:.5rem">♪</span>Nessun evento per questa data</div>`;
    return;
  }
  grid.style.background = 'var(--border)';
  grid.innerHTML = filtered.map((ev, i) => {
    const d = new Date(ev.data+'T00:00:00');
    const topLabel = calSelectedDate ? null : `${d.getDate()} ${_mesiL[d.getMonth()].slice(0,3).toUpperCase()} ${d.getFullYear()}`;
    return buildEventCard(ev, i, filtered.length, topLabel);
  }).join('');
}

function calSetDate(val) { calSelectedDate = val || null; _renderCalResults(); }
function calGoToday()    {
  calSelectedDate = oggiStr();
  const input = document.getElementById('cal-date-input');
  if(input) input.value = calSelectedDate;
  _renderCalResults();
}
function calPrevDay() {
  const dates = [...new Set(getAllAvailableDatesSorted().map(e=>e.data))].sort();
  const idx = calSelectedDate ? dates.indexOf(calSelectedDate) : 0;
  if(idx > 0) { calSelectedDate = dates[idx-1]; const i=document.getElementById('cal-date-input'); if(i) i.value=calSelectedDate; _renderCalResults(); }
}
function calNextDay() {
  const dates = [...new Set(getAllAvailableDatesSorted().map(e=>e.data))].sort();
  const idx = calSelectedDate ? dates.indexOf(calSelectedDate) : -1;
  if(idx < dates.length-1) { calSelectedDate = dates[idx+1]; const i=document.getElementById('cal-date-input'); if(i) i.value=calSelectedDate; _renderCalResults(); }
}

// ── SIDE PANEL LOCALE ──
function openVenuePanel(venueId) {
  currentVenueId = venueId;
  const v = getVenue(venueId);
  if(!v) return;
  document.getElementById('panel-tag').textContent     = v.tag;
  document.getElementById('panel-name').textContent    = v.nome;
  document.getElementById('panel-address').textContent = v.indirizzo;
  document.getElementById('btn-call').href             = 'tel:' + (v.telefono||'').replace(/\s/g,'');
  document.getElementById('panel-website').href        = v.website;
  document.getElementById('contact-form').classList.remove('open');
  document.getElementById('form-success').style.display = 'none';

  const futuri = eventiTutti
    .filter(e => e.venueId === venueId && e.data >= oggiStr())
    .sort((a,b) => a.data.localeCompare(b.data))
    .slice(0, 10);

  document.getElementById('panel-events').innerHTML = futuri.length
    ? futuri.map(e => {
        const d = new Date(e.data+'T00:00:00');
        return `<div class="panel-event">
          <div class="panel-event-date">
            <div class="panel-event-day">${d.getDate()}</div>
            <div class="panel-event-month">${_mesiL[d.getMonth()].slice(0,3).toUpperCase()}</div>
          </div>
          <div class="panel-event-info">
            <div class="panel-event-artist">${esc(e.artista)}</div>
            <div class="panel-event-genre">${esc(e.genere)}</div>
            <div class="panel-event-time"><i class="fa fa-clock"></i> ${esc(e.ora)}</div>
          </div>
        </div>`;
      }).join('')
    : `<div class="panel-na">
        <div class="panel-na-tit">Informazioni non disponibili</div>
        <div class="panel-na-txt">Al momento non riusciamo a recuperare la programmazione di questo locale.<br>Consulta il sito ufficiale o i canali social del locale:</div>
        <a class="panel-na-link" href="${esc(v.website)}" target="_blank" rel="noopener">${esc(v.website.replace(/https?:\/\//,''))} <i class="fa fa-arrow-up-right-from-square"></i></a>
       </div>`;

  document.getElementById('panel-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePanel(e) {
  if(e && e.target !== document.getElementById('panel-overlay')) return;
  document.getElementById('panel-overlay').classList.remove('open');
  document.body.style.overflow = '';
}
function toggleForm() { document.getElementById('contact-form').classList.toggle('open'); }
function sendForm() {
  const o = document.getElementById('form-oggetto').value;
  const m = document.getElementById('form-msg').value;
  if(!o||!m) { alert('Compila tutti i campi.'); return; }
  document.getElementById('form-oggetto').value = '';
  document.getElementById('form-msg').value = '';
  document.getElementById('form-success').style.display = 'block';
}

// ── CONDIVISIONE ──
function legacyCopy(text, cb) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    cb();
  } catch(e) {
    window.prompt('Copia il testo con Ctrl+C:', text);
  }
}

function doShare(title, text, url, btn) {
  if(navigator.share) { navigator.share({title, text, url}).catch(()=>{}); return; }
  const flash = () => {
    if(!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa fa-check"></i> Copiato!';
    setTimeout(() => btn.innerHTML = orig, 2000);
  };
  if(navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(flash).catch(() => legacyCopy(text, flash));
  } else {
    legacyCopy(text, flash);
  }
}

function shareVenue() {
  const v = getVenue(currentVenueId); if(!v) return;
  const futuri = eventiTutti.filter(e=>e.venueId===v.id && e.data>=oggiStr()).slice(0,5);
  const evText = futuri.length ? '\n\nPROSSIMI EVENTI:\n'+futuri.map(e=>`• ${e.data} – ${e.artista} (${e.genere}) ore ${e.ora}`).join('\n') : '';
  const text = `🎵 ${v.nome}\n📍 ${v.indirizzo}\n📞 ${v.telefono}\n🌐 ${v.website}${evText}`;
  doShare(v.nome, text, v.website, document.querySelector('.btn-share'));
}

function shareVenueCard(venueId, btn) {
  const v = getVenue(venueId); if(!v) return;
  const text = `🎵 ${v.nome}\n📍 ${v.indirizzo}\n📞 ${v.telefono}\n🌐 ${v.website}`;
  doShare(v.nome, text, v.website, btn);
}

function shareEventCard(venueId, btn, artista, genere, ora) {
  const v = venueId ? getVenue(venueId) : null;
  const vName = v ? v.nome : '';
  const vAddr = v ? v.indirizzo : '';
  const vUrl  = v ? v.website : '#';
  const text = `🎵 ${artista}\n🎼 ${genere}\n🕐 ore ${ora}\n📍 ${vName}\n🗺 ${vAddr}\n🌐 ${vUrl}`;
  doShare(`${artista}${vName?' – '+vName:''}`, text, vUrl, btn);
}

// ── TILE DELLA MAPPA · fallback automatico (novità v5) ──
// Leaflet è incluso in locale (js/leaflet.min.js, css/leaflet.css):
// nessuna dipendenza dai CDN per la libreria. La cartina (tile) arriva
// invece da fornitori online gratuiti. Novità v5:
//  · Esri è il fornitore primario (senza chiave API); seguono OSM e
//    CARTO. La verifica preventiva scarta automaticamente i blocchi.
//  · verifica preventiva (probe): prima di collegare un fornitore
//    viene scaricato un tile di prova; se la risposta è un blocco
//    (HTTP 403, ecc.) si passa direttamente al fornitore successivo;
//  · rimane il fallback di emergenza sui tileerror (rete assente).
const TILE_PROVIDERS = [
  { url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attr:'Tile © Esri — Esri, Maxar, Earthstar Geographics' },
  { url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  { url:'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attr:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>' }
];
let activeTileProvider = 0;
let tileErrCount       = 0;
let tileLayer          = null;
let tileOfflineShown   = false;
let switchingTiles     = false;

function tileUrl(p, z, x, y){
  return p.url.replace('{s}','a').replace('{z}',z).replace('{x}',x).replace('{y}',y).replace('{r}','');
}

// ── Verifica preventiva dei fornitori (novità v5) ──
// Alcuni server, invece della cartina, restituiscono un'immagine di
// blocco con HTTP 200: il 403 "Access blocked" di OpenStreetMap o
// l'"API KEY REQUIRED" di CARTO. Per Leaflet sono tile "buoni" e
// nessun errore scatta. La verifica è quindi a due livelli:
//  1) HTTP: scarica un tile di prova (Roma, zoom 12) e controlla che
//     la risposta sia 200 con tipo immagine;
//  2) PIXEL: disegna su canvas un tile oceanico (Atlantico, zoom 3):
//     se è davvero una cartina è blu; se è una pagina di blocco è
//     quasi tutta bianca → fornitore scartato.
async function probeProvider(p){
  try{
    const z = 12, lat = 41.9028, lon = 12.4964;
    const x = Math.floor((lon+180)/360 * Math.pow(2,z));
    const y = Math.floor((1 - Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI) / 2 * Math.pow(2,z));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(tileUrl(p, z, x, y), {mode:'cors', cache:'no-store', signal:ctrl.signal});
    clearTimeout(t);
    if(!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) return false;
  } catch(e) {
    return false;
  }
  return oceanProbe(p);
}

function oceanProbe(p){
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const to = setTimeout(() => resolve(false), 6000);
    img.onload = () => {
      clearTimeout(to);
      try{
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let blue = 0, total = d.length / 4;
        for(let i = 0; i < d.length; i += 4){
          const r = d[i], g = d[i+1], b = d[i+2];
          if(b > 120 && b > r + 15 && b >= g) blue++;
        }
        resolve(blue / total > 0.5);      // tile oceanico davvero blu
      } catch(e) {
        resolve(true);                    // canvas non leggibile: accetta
      }
    };
    img.onerror = () => { clearTimeout(to); resolve(false); };
    img.src = tileUrl(p, 3, 3, 4);        // Oceano Atlantico
  });
}

async function attachTileLayer(startFrom = activeTileProvider){
  if(switchingTiles) return;
  switchingTiles = true;
  // Trova il primo fornitore che risponde con un'immagine valida;
  // se nessuno risponde resta quello di partenza (lasciando il
  // fallback sui tileerror gestire il caso "nessuna connessione").
  let chosen = -1;
  for(let i = startFrom; i < TILE_PROVIDERS.length; i++){
    if(await probeProvider(TILE_PROVIDERS[i])) { chosen = i; break; }
  }
  if(chosen === -1) chosen = startFrom;
  activeTileProvider = chosen;
  const p = TILE_PROVIDERS[chosen];
  tileErrCount = 0;
  if(tileLayer && leafletMap) leafletMap.removeLayer(tileLayer);
  tileLayer = L.tileLayer(p.url, { attribution:p.attr, maxZoom:19 });
  tileLayer.on('tileerror', onTileError);
  tileLayer.addTo(leafletMap);
  switchingTiles = false;
}

function onTileError() {
  if(switchingTiles) return;
  tileErrCount++;
  if(tileErrCount < 4) return;          // pochi tile mancanti: ignora
  if(activeTileProvider < TILE_PROVIDERS.length - 1) {
    attachTileLayer(activeTileProvider + 1);   // fornitore successivo
  } else if(!tileOfflineShown) {
    tileOfflineShown = true;            // nessun fornitore risponde
    showMapOfflineNotice();
  }
}

function showMapOfflineNotice() {
  const host = document.getElementById('leaflet-map');
  if(!host) return;
  const n = document.createElement('div');
  n.className = 'map-offline-notice';
  n.innerHTML = '<strong>Cartina non disponibile</strong><br>La mappa richiede una connessione a Internet.<br>Pin ed elenco dei locali restano attivi.';
  host.appendChild(n);
}

// ── PAGINA MAPPA ──
function renderMappa() {
  const sub = document.getElementById('mappa-sub');
  const list = document.getElementById('mappa-list');
  if(!list) return;
  if(dataLoadError) { list.innerHTML = `<div class="mvi-empty">Dati non disponibili.<br>Avvia un server locale o usa i file data/*.js.<br>Vedi LEGGIMI.txt.</div>`; if(sub) sub.textContent = 'errore caricamento dati'; }
  else {
    if(sub) sub.textContent = `${venues.length} locali · clicca per centrare la mappa`;
    list.innerHTML = venues.map(v => `
      <div class="mappa-venue-item" id="mvi-${v.id}" onclick="selectMapVenue(${v.id})">
        <div class="mvi-pin">📍</div>
        <div class="mvi-body">
          <div class="mvi-name">${esc(v.nome)}</div>
          <div class="mvi-tag">${esc(v.tag)}</div>
          <div class="mvi-addr">${esc(v.indirizzo)}</div>
          ${venueHaEventi(v.id) ? '' : venueNADiv('mvi-na')}
          <a class="mvi-phone" href="tel:${esc((v.telefono||'').replace(/\s/g,''))}" onclick="event.stopPropagation()">${esc(v.telefono)}</a>
          <div class="mvi-actions">
            <a class="mvi-btn mvi-btn-call" href="tel:${esc((v.telefono||'').replace(/\s/g,''))}" onclick="event.stopPropagation()"><i class="fa fa-phone"></i> Chiama</a>
            <button class="mvi-btn mvi-btn-eventi" onclick="event.stopPropagation();openVenuePanel(${v.id})"><i class="fa fa-calendar"></i> Eventi</button>
            <a class="mvi-btn mvi-btn-maps" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent((v.indirizzo||'')+', Roma')}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="fa fa-diamond-turn-right"></i> Indicazioni</a>
          </div>
        </div>
      </div>`).join('');
  }

  if(leafletMap) { leafletMap.invalidateSize(); return; }
  setTimeout(() => {
    leafletMap = L.map('leaflet-map', {zoomControl:true}).setView([41.9028, 12.4964], 12);
    attachTileLayer();

    const customIcon = L.divIcon({ className:'',
      html:`<div style="width:32px;height:32px;border-radius:50% 50% 50% 0;background:#C75B2A;border:2px solid #3d3f52;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3)"><span style="transform:rotate(45deg);font-size:13px;color:#EFE7D2">♪</span></div>`,
      iconSize:[32,32], iconAnchor:[16,32], popupAnchor:[0,-36]
    });
    const activeIcon = L.divIcon({ className:'',
      html:`<div style="width:38px;height:38px;border-radius:50% 50% 50% 0;background:#3d3f52;border:2px solid #C75B2A;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.4)"><span style="transform:rotate(45deg);font-size:15px;color:#EFE7D2">♪</span></div>`,
      iconSize:[38,38], iconAnchor:[19,38], popupAnchor:[0,-42]
    });

    venues.forEach(v => {
      if(!v.lat || !v.lng) return;
      const marker = L.marker([v.lat, v.lng], {icon: customIcon})
        .addTo(leafletMap)
        .bindPopup(`<div style="font-family:'Courier New', Courier, monospace;min-width:180px">
          <div style="font-size:9px;color:#C75B2A;letter-spacing:.1em;text-transform:uppercase;margin-bottom:.3rem">${esc(v.tag)}</div>
          <div style="font-family:Georgia, 'Times New Roman', serif;font-size:1rem;font-weight:700;color:#3d3f52;margin-bottom:.4rem">${esc(v.nome)}</div>
          <div style="font-size:10px;color:#7a7060;margin-bottom:.5rem">${esc(v.indirizzo)}</div>
          <a href="tel:${esc((v.telefono||'').replace(/\s/g,''))}" style="font-size:10px;color:#3d3f52;font-weight:600;text-decoration:none">${esc(v.telefono)}</a>
        </div>`, {maxWidth:240});
      marker.on('click', () => selectMapVenue(v.id, false));
      mapMarkers[v.id] = {marker, customIcon, activeIcon};
    });
  }, 100);
}

function selectMapVenue(id, fromList=true) {
  if(activeMapVenue && mapMarkers[activeMapVenue])
    mapMarkers[activeMapVenue].marker.setIcon(mapMarkers[activeMapVenue].customIcon);
  if(activeMapVenue) { const p=document.getElementById('mvi-'+activeMapVenue); if(p) p.classList.remove('active'); }
  activeMapVenue = id;
  const el = document.getElementById('mvi-'+id);
  if(el) { el.classList.add('active'); el.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  if(mapMarkers[id]) {
    mapMarkers[id].marker.setIcon(mapMarkers[id].activeIcon);
    mapMarkers[id].marker.openPopup();
    if(fromList && leafletMap) { const v=getVenue(id); if(v) leafletMap.flyTo([v.lat, v.lng], 16, {duration:0.8}); }
  }
}

// ── PAGINA CONTATTI ──
function sendContatti() {
  const nome    = document.getElementById('c-nome').value.trim();
  const email   = document.getElementById('c-email').value.trim();
  const oggetto = document.getElementById('c-oggetto').value.trim();
  const msg     = document.getElementById('c-msg').value.trim();
  if(!nome||!email||!oggetto||!msg) { alert('Compila tutti i campi.'); return; }
  window.location.href = `mailto:nycheia@proton.me?subject=${encodeURIComponent('[SuonaRoma] '+oggetto)}&body=${encodeURIComponent('Da: '+nome+' <'+email+'>\n\n'+msg)}`;
  document.getElementById('c-nome').value='';
  document.getElementById('c-email').value='';
  document.getElementById('c-oggetto').value='';
  document.getElementById('c-msg').value='';
  document.getElementById('contatti-success').style.display='block';
  setTimeout(()=>document.getElementById('contatti-success').style.display='none',5000);
}

// ── TASTO ESC → chiude il pannello laterale (novità v3) ──
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') closePanel();
});

// ── v10 · header compatto su mobile durante lo scroll ──
// La barra del menu è sticky su tutte le pagine (css/style.css). Su
// telefono, appena si scorre, la classe hdr-compatto richiude la riga
// del logo e lascia in alto solo la barra di navigazione, per non
// togliere spazio all'elenco degli eventi. Tornando in cima si riapre.
// Su desktop la classe non ha effetto (il CSS è dentro la media query).
let _hdrRaf = false;
window.addEventListener('scroll', () => {
  if(_hdrRaf) return;
  _hdrRaf = true;
  requestAnimationFrame(() => {
    document.body.classList.toggle('hdr-compatto', window.scrollY > 70);
    _hdrRaf = false;
  });
}, {passive:true});
