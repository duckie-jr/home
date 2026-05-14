// ══ CONFIG ═══════════════════════════════════════════════════════
const LISTING_BASE = 'https://vidapi.ru';
const PLAYER_BASE  = 'https://vaplayer.ru';
const PCOLOR       = '%2300e676';
const SHANNON_ID   = '229386'; // 🤫

// ══ HELPERS ══════════════════════════════════════════════════════
const $  = (id) => document.getElementById(id);
const esc = (s) => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const pad2 = (n) => String(n).padStart(2,'0');
function fmt(s){
  if(!s)return'0:00';
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);
  return h>0?`${h}:${pad2(m)}:${pad2(sec)}`:`${m}:${pad2(sec)}`;
}
async function getJSON(url){const r=await fetch(url);if(!r.ok)throw new Error(r.status);return r.json();}
function skels(el,n=24){el.innerHTML=Array.from({length:n}).map(()=>'<div class="skel"></div>').join('');}

function resume(key){const v=localStorage.getItem(`vs_prog_${key}`);return v?`&resumeAt=${v}`:'';}
function embedMovie(item){
  const id=item.imdb_id||item.tmdb_id||item.id;
  return `${PLAYER_BASE}/embed/movie/${id}?primaryColor=${PCOLOR}${resume(id)}`;
}
function embedTv(item,s,e){
  const id=item.imdb_id||item.tmdb_id||item.id;
  return `${PLAYER_BASE}/embed/tv/${id}/${s}/${e}?primaryColor=${PCOLOR}${resume(`${id}_${s}_${e}`)}`;
}

const PLAY_SVG=`<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;

// ── IN-MEMORY PAGE CACHE ─────────────────────────────────────────
// Stores API JSON responses so back/forward pagination is instant.
const pageCache = new Map();
async function getJSONCached(url) {
  if (pageCache.has(url)) return pageCache.get(url);
  const data = await getJSON(url);
  pageCache.set(url, data);
  return data;
}

// ── TOAST NOTIFICATIONS ──────────────────────────────────────────
const toastRack = (() => {
  const rack = document.createElement('div');
  rack.className = 'toast-rack';
  document.body.appendChild(rack);
  return rack;
})();

function toast(msg, isGreen = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isGreen ? ' green' : '');
  el.textContent = msg;
  toastRack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  }, 2200);
}

// ── KEYBOARD SHORTCUTS ───────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // '/' focuses search when not typing in an input and player is closed
  if (
    e.key === '/' &&
    !e.ctrlKey && !e.metaKey &&
    !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName) &&
    $('playerModal').classList.contains('hidden')
  ) {
    e.preventDefault();
    $('searchInput').focus();
    $('searchInput').select();
  }
});

// ── SCROLL TO TOP ON PAGE CHANGE ─────────────────────────────────
function scrollToContent() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const FILM_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"/></svg>`;
const TV_SVG=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>`;

// ══ AUTH ══════════════════════════════════════════════════════════
let currentUser = sessionStorage.getItem('vs_id') || null;
let pendingPlay = null; // { url, title, item } waiting for login

function isLoggedIn(){ return !!currentUser; }

function doLogin(id){
  currentUser = id;
  sessionStorage.setItem('vs_id', id);
  $('loggedOut').classList.add('hidden');
  $('loggedIn').classList.remove('hidden');
  $('userDisplay').textContent = `#${id}`;
  $('panelUserId').textContent = `> #${id}`;
  // Execute pending play if any
  if(pendingPlay){
    const {url,title,item} = pendingPlay;
    pendingPlay = null;
    $('loginGate').classList.add('hidden');
    _play(url, title, item);
  }
}

function doLogout(){
  currentUser = null;
  sessionStorage.removeItem('vs_id');
  $('loggedIn').classList.add('hidden');
  $('loggedOut').classList.remove('hidden');
}

// Restore session
if(currentUser){
  $('loggedOut').classList.add('hidden');
  $('loggedIn').classList.remove('hidden');
  $('userDisplay').textContent = `#${currentUser}`;
  $('panelUserId').textContent = `> #${currentUser}`;
}

// ── Login toggle dropdown ─────────────────────
$('loginToggle').addEventListener('click', () => {
  const drop = $('loginDrop');
  const open = !drop.classList.contains('hidden');
  drop.classList.toggle('hidden', open);
  if(!open){ $('loginInput').value=''; $('loginErr').classList.add('hidden'); $('loginInput').focus(); }
});
document.addEventListener('click', (e) => {
  if(!$('authArea').contains(e.target)) $('loginDrop').classList.add('hidden');
});
function handleLoginInput(id){
  if(id === SHANNON_ID){
    $('loginDrop').classList.add('hidden');
    $('shannonOverlay').classList.remove('hidden');
    return;
  }
  doLogin(id);
}
$('loginInput').addEventListener('input', ()=>{
  $('loginInput').value = $('loginInput').value.replace(/\D/g,'').slice(0,6);
  $('loginErr').classList.add('hidden');
  if($('loginInput').value.length===6) setTimeout(()=>handleLoginInput($('loginInput').value),80);
});
$('loginInput').addEventListener('keydown', (e)=>{
  if(e.key!=='Enter')return;
  if($('loginInput').value.length!==6){$('loginErr').classList.remove('hidden');return;}
  handleLoginInput($('loginInput').value);
});

// ── Login Gate (when trying to watch without login) ──
$('gateInput').addEventListener('input', ()=>{
  $('gateInput').value = $('gateInput').value.replace(/\D/g,'').slice(0,6);
  $('gateErr').classList.add('hidden');
  if($('gateInput').value.length===6) setTimeout(()=>gateSubmit($('gateInput').value),80);
});
$('gateInput').addEventListener('keydown', (e)=>{
  if(e.key!=='Enter')return;
  if($('gateInput').value.length!==6){$('gateErr').classList.remove('hidden');return;}
  gateSubmit($('gateInput').value);
});
$('gateSubmit').addEventListener('click', ()=>{
  if($('gateInput').value.length!==6){$('gateErr').classList.remove('hidden');return;}
  gateSubmit($('gateInput').value);
});
$('gateCancel').addEventListener('click', ()=>{
  $('loginGate').classList.add('hidden');
  pendingPlay = null;
  $('gateInput').value='';
});
function gateSubmit(id){
  if(id===SHANNON_ID){
    $('loginGate').classList.add('hidden');
    $('shannonOverlay').classList.remove('hidden');
    return;
  }
  doLogin(id);
}

$('logoutBtn').addEventListener('click', doLogout);
$('shannonContinue').addEventListener('click', ()=>{
  doLogin(SHANNON_ID);
  $('shannonOverlay').classList.add('hidden');
});

// ── requireAuth — gate before playing ─────────
function requireAuth(url, title, item){
  if(isLoggedIn()){ _play(url,title,item); return; }
  pendingPlay = {url,title,item};
  $('gateInput').value='';
  $('gateErr').classList.add('hidden');
  $('loginGate').classList.remove('hidden');
  setTimeout(()=>$('gateInput').focus(),100);
}

// ══ HISTORY ══════════════════════════════════════════════════════
function historyKey(){ return `vs_history_${currentUser}`; }
function getHistory(){
  if(!currentUser)return[];
  try{ return JSON.parse(localStorage.getItem(historyKey())||'[]'); }
  catch{ return []; }
}
function addHistory(item){
  if(!currentUser)return;
  const history = getHistory().filter(h=>h.id !== (item.imdb_id||item.tmdb_id||item.id));
  history.unshift({
    id:    item.imdb_id||item.tmdb_id||item.id||'unknown',
    title: item.title||'Unknown',
    type:  item._type||'movie',
    year:  item.year||'',
    poster_url: item.poster_url||'',
    watched_at: new Date().toISOString(),
  });
  localStorage.setItem(historyKey(), JSON.stringify(history.slice(0,200)));
}

// ══ PLAYLISTS ═════════════════════════════════════════════════════
function plKey(){ return `vs_playlists_${currentUser}`; }
function getPlaylists(){
  if(!currentUser)return[];
  try{ return JSON.parse(localStorage.getItem(plKey())||'[]'); }
  catch{ return []; }
}
function savePlaylists(pls){ if(currentUser) localStorage.setItem(plKey(),JSON.stringify(pls)); }
function createPlaylist(name){
  const pls = getPlaylists();
  pls.push({id: Date.now().toString(), name, items:[]});
  savePlaylists(pls);
}
function deletePlaylist(plId){
  savePlaylists(getPlaylists().filter(p=>p.id!==plId));
}
function addToPlaylist(plId, item){
  const pls = getPlaylists();
  const pl  = pls.find(p=>p.id===plId);
  if(!pl)return;
  if(pl.items.find(i=>i.id===(item.imdb_id||item.tmdb_id||item.id)))return;
  pl.items.push({
    id:    item.imdb_id||item.tmdb_id||item.id,
    title: item.title||'Unknown',
    type:  item._type||'movie',
    year:  item.year||'',
    poster_url: item.poster_url||'',
  });
  savePlaylists(pls);
}
function removeFromPlaylist(plId, itemId){
  const pls = getPlaylists();
  const pl  = pls.find(p=>p.id===plId);
  if(!pl)return;
  pl.items = pl.items.filter(i=>i.id!==itemId);
  savePlaylists(pls);
}

// ══ PLAYER ════════════════════════════════════════════════════════
let nowPlaying = null;

function _play(url, title, item){
  $('playerIframe').src = url;
  $('playerTitle').textContent = title;
  $('progFill').style.width='0%';
  $('progTime').textContent='—';
  $('playerModal').classList.remove('hidden');
  document.body.style.overflow='hidden';
  nowPlaying = item || null;
  if(item && currentUser){ addHistory(item); }
}

function closePlayer(){
  $('playerIframe').src='';
  $('playerModal').classList.add('hidden');
  document.body.style.overflow='';
  nowPlaying=null;
}

$('playerClose').addEventListener('click', closePlayer);
$('playerModal').addEventListener('click',(e)=>{if(e.target===$('playerModal'))closePlayer();});

// Add to playlist from player
$('addToPlaylistBtn').addEventListener('click', ()=>{
  if(!nowPlaying||!currentUser)return;
  openPlPicker(nowPlaying);
});

document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape'){
    if(!$('playerModal').classList.contains('hidden')) closePlayer();
    else if(!$('loginGate').classList.contains('hidden')){ $('loginGate').classList.add('hidden'); pendingPlay=null; }
    else if(!$('shannonOverlay').classList.contains('hidden')){ doLogin(SHANNON_ID); $('shannonOverlay').classList.add('hidden'); }
    else if(!$('plPicker').classList.contains('hidden')) $('plPicker').classList.add('hidden');
  }
});

window.addEventListener('message',(event)=>{
  if(!event.data||event.data.type!=='PLAYER_EVENT')return;
  const{player_info,player_status,player_progress,player_duration}=event.data.data;
  if(player_status==='playing'||player_status==='paused'){
    const key=player_info.season!=null
      ?`${player_info.imdb||player_info.tmdb}_${player_info.season}_${player_info.episode}`
      :`${player_info.imdb||player_info.tmdb}`;
    localStorage.setItem(`vs_prog_${key}`,player_progress);
    $('progFill').style.width=player_duration>0?`${(player_progress/player_duration)*100}%`:'0%';
    $('progTime').textContent=player_duration?`${fmt(player_progress)} / ${fmt(player_duration)}`:fmt(player_progress);
  }
  if(player_status==='completed'&&player_info.mediaType==='tv'){
    const show={imdb_id:player_info.imdb,tmdb_id:player_info.tmdb,title:player_info.title,_type:'tv'};
    const nextEp=parseInt(player_info.episode)+1;
    _play(embedTv(show,player_info.season,nextEp),`${player_info.title} — S${pad2(player_info.season)}E${pad2(nextEp)}`,show);
  }
});

// ══ PLAYLIST PICKER POPUP ═════════════════════════════════════════
function openPlPicker(item){
  const pls=getPlaylists();
  const list=$('plPickerList');
  list.innerHTML='';
  if(!pls.length){
    list.innerHTML='<p style="font-size:.7rem;color:var(--dim)">No playlists yet — create one in your profile</p>';
  }else{
    pls.forEach(pl=>{
      const btn=document.createElement('button');
      btn.className='pl-pick-btn';
      btn.textContent=`${pl.name} (${pl.items.length})`;
      btn.addEventListener('click',()=>{
        addToPlaylist(pl.id,item);
        $('plPicker').classList.add('hidden');
        toast('Added to ' + pl.name, true);
      });
      list.appendChild(btn);
    });
  }
  $('plPicker').classList.remove('hidden');
}
$('plPickerClose').addEventListener('click',()=>$('plPicker').classList.add('hidden'));

// ══ CARDS ═════════════════════════════════════════════════════════
function makeCard(item, type){
  item._type = type;
  const d=document.createElement('div');
  d.className='card';
  const img=item.poster_url
    ?`<img class="card-img" src="${esc(item.poster_url)}" alt="${esc(item.title)}" loading="lazy">`
    :`<div class="card-no-img">${type==='movie'?FILM_SVG:TV_SVG}</div>`;
  const star=item.rating?`<span class="card-star">★${item.rating}</span>`:'';
  d.innerHTML=`${img}
    <span class="card-badge ${type==='movie'?'badge-movie':'badge-tv'}">${type}</span>
    <button class="card-add" title="Add to playlist">+pl</button>
    <div class="card-play"><div class="play-ring">${PLAY_SVG}</div></div>
    <div class="card-foot">
      <span class="card-name">${esc(item.title)}</span>
      <div class="card-meta"><span>${item.year||'—'}</span>${star}</div>
    </div>`;
  // Add-to-playlist button
  d.querySelector('.card-add').addEventListener('click',(e)=>{
    e.stopPropagation();
    if(!currentUser){$('loginToggle').click();return;}
    openPlPicker(item);
  });
  // Play
  d.addEventListener('click',()=>{
    const url = type==='movie' ? embedMovie(item) : embedTv(item,1,1);
    const title = item.title;
    requireAuth(url, title, item);
  });
  return d;
}

// ══ LOADERS — progressive: each page reveals cards as it arrives ══
const BATCH = 5; // 5 pages loaded simultaneously = 120 cards max
let moviesPage=1, tvPage=1, activeSection='movies';

// Load a grid progressively: show skeleton slots immediately, swap in
// real cards as each individual page resolves — no waiting for all 5.
async function loadGrid(grid, endpoint, type, startPage) {
  grid.innerHTML = '';
  const pageNums = Array.from({ length: BATCH }, (_, i) => startPage + i);

  // Pre-create 24 skeleton slots per page, in order
  const slotGroups = pageNums.map(() => {
    return Array.from({ length: 24 }).map(() => {
      const el = document.createElement('div');
      el.className = 'skel';
      grid.appendChild(el);
      return el;
    });
  });

  let knownTotal = pageNums[pageNums.length - 1]; // optimistic minimum

  await Promise.all(pageNums.map(async (pageNum, groupIdx) => {
    const data = await getJSON(
      `${LISTING_BASE}/${endpoint}/page-${pageNum}.json`
    ).catch(() => null);

    const slots = slotGroups[groupIdx];

    if (!data) {
      slots.forEach(s => s.remove());
      return;
    }

    if (data.total_pages > knownTotal) knownTotal = data.total_pages;

    // Replace each skeleton with a real card as soon as this page loads
    data.items.forEach((item, i) => {
      const card = makeCard(item, type);
      if (slots[i]) slots[i].replaceWith(card);
    });
    // Remove unused skeletons (last page may have fewer than 24)
    slots.slice(data.items.length).forEach(s => s.remove());
  }));

  return knownTotal;
}

async function loadMovies(startPage=1) {
  const totalPages = await loadGrid($('moviesGrid'), 'movies/latest', 'movie', startPage);
  const endPage = Math.min(startPage + BATCH - 1, totalPages);
  $('moviesPage').textContent = `${startPage}–${endPage} / ${totalPages}`;
  $('moviesPrev').disabled = startPage <= 1;
  $('moviesNext').disabled = endPage >= totalPages;
  moviesPage = startPage;
  scrollToContent();
}

async function loadTv(startPage=1) {
  const totalPages = await loadGrid($('tvGrid'), 'tvshows/latest', 'tv', startPage);
  const endPage = Math.min(startPage + BATCH - 1, totalPages);
  $('tvPage').textContent = `${startPage}–${endPage} / ${totalPages}`;
  $('tvPrev').disabled = startPage <= 1;
  $('tvNext').disabled = endPage >= totalPages;
  tvPage = startPage;
  scrollToContent();
}

$('moviesPrev').addEventListener('click', () => loadMovies(Math.max(1, moviesPage - BATCH)));
$('moviesNext').addEventListener('click', () => loadMovies(moviesPage + BATCH));
$('tvPrev').addEventListener('click',     () => loadTv(Math.max(1, tvPage - BATCH)));
$('tvNext').addEventListener('click',     () => loadTv(tvPage + BATCH));

// ══ SECTIONS ══════════════════════════════════════════════════════
function switchSection(name){
  activeSection=name;
  document.querySelectorAll('.section').forEach(s=>s.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  $(`${name}Section`).classList.remove('hidden');
  document.querySelector(`[data-section="${name}"]`).classList.add('active');
  if(name==='tv'&&$('tvGrid').children.length===0) loadTv(tvPage);
}
document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>switchSection(btn.dataset.section)));

// ══ SEARCH ══════════════════════════════════════════════════════════
// State for the progressive search
const search = {
  query:         '',
  allResults:    [],   // every hit found so far across all batched pages
  movieMaxPages: 0,
  tvMaxPages:    0,
  nextMoviePage: 1,    // next API page to scan for movies
  nextTvPage:    1,    // next API page to scan for TV
  running:       false,
  stopped:       false,
  resultPage:    0,    // current results-display page
};
const SEARCH_BATCH   = 1000; // API pages fetched per batch (1500×24 = 36,000 items scanned at once)
const FETCH_CHUNK    = 100;  // concurrent requests per chunk (browser-safe limit)
const RESULTS_PER_PG = 48;  // results shown per display-page

$('searchInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  if (q) doSearch(q);
});

async function doSearch(q) {
  // Reset state
  Object.assign(search, {
    query: q, allResults: [],
    movieMaxPages: 0, tvMaxPages: 0,
    nextMoviePage: 1, nextTvPage: 1,
    running: false, stopped: false, resultPage: 0,
  });

  $('searchQuery').textContent = q;
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  $('searchSection').classList.remove('hidden');
  $('searchPagerBar').classList.add('hidden');
  $('searchStopBtn').style.display = 'none';
  $('searchGrid').innerHTML = '';

  // ── ID shortcut ───────────────────────────────────────
  const isImdbId = /^tt\d+$/i.test(q);
  const isTmdbId = /^\d{5,}$/.test(q);
  if (isImdbId || isTmdbId) {
    setSearchStatus(`ID: ${q}`);
    const mItem = { id:q, title:`${q} (movie)`, year:'', rating:'', poster_url:'', _type:'movie' };
    const tItem = { id:q, title:`${q} (tv)`,    year:'', rating:'', poster_url:'', _type:'tv'    };
    $('searchGrid').innerHTML = '';
    $('searchGrid').appendChild(makeCard(mItem, 'movie'));
    $('searchGrid').appendChild(makeCard(tItem, 'tv'));
    return;
  }

  // ── Progressive scan ──────────────────────────────────
  await runSearchBatch();
}

// Search streams results live: movies + TV scanned in parallel,
// results rendered after every 100-page chunk without waiting for both.
async function runSearchBatch() {
  if (search.running || search.stopped) return;
  search.running = true;

  const moviePages = pageRange(search.nextMoviePage, SEARCH_BATCH, search.movieMaxPages);
  const tvPages    = pageRange(search.nextTvPage,    SEARCH_BATCH, search.tvMaxPages);

  if (!moviePages.length && !tvPages.length) {
    search.running = false;
    finishSearch();
    return;
  }

  const lower = search.query.toLowerCase();
  const scoreTitle = (title) => {
    const t = title.toLowerCase();
    if (t === lower)             return 0;
    if (t.startsWith(lower))     return 1;
    if (t.includes(' ' + lower)) return 2;
    return 3;
  };

  // Stream one endpoint: fetch FETCH_CHUNK pages at a time, add hits
  // to allResults and re-render after each chunk — no waiting for the
  // other endpoint to finish.
  async function streamEndpoint(endpoint, pages, type) {
    for (let i = 0; i < pages.length; i += FETCH_CHUNK) {
      if (search.stopped) break;
      const chunk = pages.slice(i, i + FETCH_CHUNK);

      const chunkData = await Promise.all(
        chunk.map(p =>
          getJSON(`${LISTING_BASE}/${endpoint}/page-${p}.json`).catch(() => null)
        )
      );

      // Capture total pages from first valid response
      if (type === 'movie' && !search.movieMaxPages)
        search.movieMaxPages = chunkData.find(r => r)?.total_pages ?? 0;
      if (type === 'tv' && !search.tvMaxPages)
        search.tvMaxPages = chunkData.find(r => r)?.total_pages ?? 0;

      const hits = chunkData
        .flatMap(r => r?.items ?? [])
        .filter(item => item.title.toLowerCase().includes(lower))
        .map(item => ({ ...item, _type: type }));

      if (hits.length > 0) {
        // Insert in relevance order within existing results
        search.allResults.push(...hits);
        search.allResults.sort((a, b) => scoreTitle(a.title) - scoreTitle(b.title));
        renderSearchPage(search.resultPage);
      }

      // Live status after every chunk
      const scanned = Math.max(
        (search.nextMoviePage - 1) + (i + chunk.length),
        0
      );
      const total = (search.movieMaxPages || 0) + (search.tvMaxPages || 0);
      setSearchStatus(
        `Scanning ${search.allResults.length} found — ${scanned} / ${total || '?'} pages checked`,
        true
      );
    }
  }

  // Run both endpoints truly in parallel — results from whichever
  // finishes a chunk first appear immediately without waiting for the other.
  await Promise.all([
    streamEndpoint('movies/latest', moviePages, 'movie'),
    streamEndpoint('tvshows/latest', tvPages, 'tv'),
  ]);

  search.nextMoviePage += moviePages.length;
  search.nextTvPage    += tvPages.length;
  search.running = false;

  const mDone = !moviePages.length || search.nextMoviePage > (search.movieMaxPages || Infinity);
  const tDone = !tvPages.length    || search.nextTvPage    > (search.tvMaxPages    || Infinity);

  if (mDone && tDone) {
    finishSearch();
  } else if (!search.stopped) {
    // Auto-continue — kick off next batch immediately without user input
    setTimeout(runSearchBatch, 0);
  }
}

// Build array of page numbers to fetch, capped at max
function pageRange(start, batchSize, maxPages) {
  if (maxPages && start > maxPages) return [];
  const end = maxPages ? Math.min(start + batchSize - 1, maxPages) : start + batchSize - 1;
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function finishSearch() {
  search.stopped = true;
  const total = (search.movieMaxPages || 0) + (search.tvMaxPages || 0);
  if (!search.allResults.length) {
    setSearchStatus(`No results across all ${total} pages — try an IMDB ID (tt…) or a TMDB number`);
    $('searchGrid').innerHTML = '<p style="font-size:.72rem;color:var(--dim);padding:.5rem 0">Nothing found</p>';
  } else {
    setSearchStatus(`${search.allResults.length} result${search.allResults.length !== 1 ? 's' : ''} — all ${total} pages scanned`);
  }
  $('searchStopBtn').style.display = 'none';
}

function setSearchStatus(msg, scanning = false) {
  $('searchStatus').textContent = msg;
  $('searchStopBtn').style.display = scanning ? '' : 'none';
}

function renderSearchPage(page) {
  search.resultPage = page;
  const total = search.allResults.length;
  if (!total) return;

  const totalPages = Math.ceil(total / RESULTS_PER_PG);
  const start      = page * RESULTS_PER_PG;
  const slice      = search.allResults.slice(start, start + RESULTS_PER_PG);

  $('searchPagerBar').classList.remove('hidden');
  $('searchResultCount').textContent = `${total} result${total !== 1 ? 's' : ''}`;
  $('searchPageNum').textContent     = `${page + 1} / ${totalPages}`;
  $('searchPrev').disabled           = page <= 0;
  $('searchNext').disabled           = page >= totalPages - 1;

  $('searchGrid').innerHTML = '';
  slice.forEach(i => $('searchGrid').appendChild(makeCard(i, i._type)));
  window.scrollTo({ top: $('searchSection').offsetTop - 60, behavior: 'smooth' });
}

$('searchStopBtn').addEventListener('click', () => {
  search.stopped = true;
  search.running = false;
  finishSearch();
});
$('searchPrev').addEventListener('click', () => renderSearchPage(search.resultPage - 1));
$('searchNext').addEventListener('click', () => renderSearchPage(search.resultPage + 1));

$('backBtn').addEventListener('click', () => {
  search.stopped = true;
  $('searchInput').value = '';
  switchSection(activeSection);
});

// ══ PROFILE PANEL ═════════════════════════════════════════════════
$('openProfile').addEventListener('click',()=>{
  if(!currentUser)return;
  renderHistory();
  renderPlaylists();
  $('profilePanel').classList.remove('hidden');
  $('panelBackdrop').classList.remove('hidden');
  document.body.style.overflow='hidden';
});
function closePanel(){
  $('profilePanel').classList.add('hidden');
  $('panelBackdrop').classList.add('hidden');
  document.body.style.overflow='';
}
$('closePanel').addEventListener('click',closePanel);
$('panelBackdrop').addEventListener('click',closePanel);

// Panel tabs
document.querySelectorAll('.ptab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.ptab-content').forEach(c=>c.classList.add('hidden'));
    btn.classList.add('active');
    $(`ptab${btn.dataset.ptab.charAt(0).toUpperCase()+btn.dataset.ptab.slice(1)}`).classList.remove('hidden');
  });
});

// ── History rendering ──────────────────────────
function renderHistory(){
  const history=getHistory();
  const list=$('historyList');
  $('historyCount').textContent=`${history.length} item${history.length!==1?'s':''}`;
  if(!history.length){ list.innerHTML='<p class="empty-msg">No history yet</p>'; return; }
  list.innerHTML='';
  history.forEach(item=>{
    const row=document.createElement('div');
    row.className='history-item';
    const poster=item.poster_url
      ?`<img class="h-poster" src="${esc(item.poster_url)}" alt="" loading="lazy">`
      :`<div class="h-poster-ph">${item._type==='tv'?TV_SVG:FILM_SVG}</div>`;
    const date=new Date(item.watched_at).toLocaleDateString();
    row.innerHTML=`${poster}
      <div class="h-info">
        <div class="h-title">${esc(item.title)}</div>
        <div class="h-meta">${item.type||'movie'}${item.year?'  '+item.year:''}  ·  ${date}</div>
      </div>`;
    row.addEventListener('click',()=>{
      const url=item.type==='tv'?embedTv(item,1,1):embedMovie(item);
      closePanel();
      requireAuth(url, item.title, item);
    });
    list.appendChild(row);
  });
}
$('clearHistoryBtn').addEventListener('click',()=>{
  if(!currentUser)return;
  localStorage.removeItem(historyKey());
  renderHistory();
  toast('History cleared');
});

// ── Playlists rendering ────────────────────────
function renderPlaylists(){
  const pls=getPlaylists();
  const list=$('playlistList');
  if(!pls.length){ list.innerHTML='<p class="empty-msg">No playlists yet</p>'; return; }
  list.innerHTML='';
  pls.forEach(pl=>{
    const wrapper=document.createElement('div');
    wrapper.className='playlist-item';
    const header=document.createElement('div');
    header.className='pl-header';
    header.innerHTML=`<span class="pl-name">${esc(pl.name)}</span><span class="pl-count">${pl.items.length}</span><button class="pl-del" title="Delete playlist">✕</button>`;
    header.querySelector('.pl-del').addEventListener('click',(e)=>{
      e.stopPropagation();
      deletePlaylist(pl.id); renderPlaylists();
    });
    const itemsDiv=document.createElement('div');
    itemsDiv.className='pl-items';
    if(pl.items.length){
      pl.items.forEach(item=>{
        const row=document.createElement('div');
        row.className='pl-item-row';
        row.innerHTML=`<span class="pl-item-title">${esc(item.title)}</span><span style="font-size:.6rem;color:var(--dim);margin-right:.3rem">${item.year||''}</span><button class="pl-item-del" title="Remove">✕</button>`;
        row.querySelector('.pl-item-del').addEventListener('click',(e)=>{
          e.stopPropagation();
          removeFromPlaylist(pl.id,item.id); renderPlaylists();
        });
        row.addEventListener('click',()=>{
          const url=item.type==='tv'?embedTv(item,1,1):embedMovie(item);
          closePanel();
          requireAuth(url, item.title, item);
        });
        itemsDiv.appendChild(row);
      });
    }else{
      itemsDiv.innerHTML='<p style="font-size:.65rem;color:var(--dim);padding:.4rem .65rem">Empty playlist</p>';
    }
    header.addEventListener('click',()=>itemsDiv.classList.toggle('open'));
    wrapper.appendChild(header);
    wrapper.appendChild(itemsDiv);
    list.appendChild(wrapper);
  });
}

$('newPlaylistBtn').addEventListener('click',()=>{ $('newPlForm').classList.toggle('hidden'); $('newPlName').focus(); });
$('cancelPlBtn').addEventListener('click',()=>$('newPlForm').classList.add('hidden'));
$('createPlBtn').addEventListener('click',()=>{
  const name=$('newPlName').value.trim();
  if(!name)return;
  createPlaylist(name);
  $('newPlName').value='';
  $('newPlForm').classList.add('hidden');
  renderPlaylists();
  toast('Playlist created', true);
});
$('newPlName').addEventListener('keydown',(e)=>{
  if(e.key==='Enter'){ $('createPlBtn').click(); }
  if(e.key==='Escape'){ $('newPlForm').classList.add('hidden'); }
});

// ══ EXPORT / IMPORT ════════════════════════════════════════════════
$('exportBtn').addEventListener('click',()=>{
  if(!currentUser)return;
  const data={
    userId:  currentUser,
    exported: new Date().toISOString(),
    history:  getHistory(),
    playlists:getPlaylists(),
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`jrs-movies-${currentUser}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exported', true);
});

$('importInput').addEventListener('change', async(e)=>{
  const files=[...e.target.files];
  if(!files.length)return;
  for(const file of files){
    try{
      const text=await file.text();
      const data=JSON.parse(text);
      // Merge playlists
      if(Array.isArray(data.playlists)){
        const existing=getPlaylists();
        data.playlists.forEach(pl=>{
          if(!existing.find(p=>p.name===pl.name)){
            existing.push({...pl, id: Date.now().toString()+Math.random()});
          }else{
            // Merge items into existing playlist with same name
            const target=existing.find(p=>p.name===pl.name);
            pl.items.forEach(item=>{
              if(!target.items.find(i=>i.id===item.id)) target.items.push(item);
            });
          }
        });
        savePlaylists(existing);
      }
      // Merge history
      if(Array.isArray(data.history)&&currentUser){
        const existing=getHistory();
        const existingIds=new Set(existing.map(h=>h.id));
        data.history.forEach(h=>{ if(!existingIds.has(h.id)) existing.push(h); });
        localStorage.setItem(historyKey(), JSON.stringify(existing.slice(0,200)));
      }
    }catch(err){
      console.warn('Failed to import file:', file.name, err);
    }
  }
  e.target.value='';
  renderHistory();
  renderPlaylists();
  toast('Imported', true);
});

// ══ SCROLL ════════════════════════════════════════════════════════
window.addEventListener('scroll',()=>{
  $('topbar').style.boxShadow=window.scrollY>10?'0 2px 16px rgba(0,0,0,.6)':'';
},{passive:true});

// ══ INIT ══════════════════════════════════════════════════════════
loadMovies(1);

// ══ DEV PANEL (backtick / tilde while player is open) ════════════
const devPanel    = document.getElementById('devPanel');
const playerOuter = document.getElementById('playerOuter');
const devIdInput      = document.getElementById('devId');
const devTypeSelect   = document.getElementById('devType');
const devTvRow        = document.getElementById('devTvRow');
const devSeasonInput  = document.getElementById('devSeason');
const devEpisodeInput = document.getElementById('devEpisode');
const devCustomUrl    = document.getElementById('devCustomUrl');
const devInfo         = document.getElementById('devInfo');

let devOpen = false;

// Parse current iframe src back into editable fields
function syncDevFromPlayer() {
  const src = $('playerIframe').src;
  if (!src) return;
  devCustomUrl.value = '';
  devInfo.textContent = src;

  const movieMatch = src.match(/\/embed\/movie\/([^?]+)/);
  const tvMatch    = src.match(/\/embed\/tv\/([^/]+)\/(\d+)\/(\d+)/);

  if (tvMatch) {
    devIdInput.value      = tvMatch[1];
    devTypeSelect.value   = 'tv';
    devSeasonInput.value  = tvMatch[2];
    devEpisodeInput.value = tvMatch[3];
    devTvRow.classList.remove('hidden');
  } else if (movieMatch) {
    devIdInput.value    = movieMatch[1];
    devTypeSelect.value = 'movie';
    devTvRow.classList.add('hidden');
  }
}

function openDevPanel() {
  devOpen = true;
  devPanel.classList.remove('hidden');
  playerOuter.classList.add('dev-open');
  syncDevFromPlayer();
}

function closeDevPanel() {
  devOpen = false;
  devPanel.classList.add('hidden');
  playerOuter.classList.remove('dev-open');
}

function toggleDevPanel() {
  if (devOpen) closeDevPanel(); else openDevPanel();
}

// Backtick or tilde toggles the panel while player is open
document.addEventListener('keydown', (e) => {
  if (e.key === '`' || e.key === '~') {
    if (!$('playerModal').classList.contains('hidden')) {
      e.preventDefault();
      toggleDevPanel();
    }
  }
});

// Close dev panel when player closes
const _origClosePlayer = closePlayer;
// Patch closePlayer to also close dev
const _closePlayerRef = closePlayer;
document.getElementById('playerClose').addEventListener('click', () => closeDevPanel(), true);

// Type selector shows/hides TV fields
devTypeSelect.addEventListener('change', () => {
  devTvRow.classList.toggle('hidden', devTypeSelect.value !== 'tv');
});

// Apply — rebuild the embed URL from dev fields
document.getElementById('devApply').addEventListener('click', () => {
  const customUrl = devCustomUrl.value.trim();
  if (customUrl) {
    $('playerIframe').src = customUrl;
    devInfo.textContent = customUrl;
    return;
  }

  const mediaId = devIdInput.value.trim();
  if (!mediaId) return;

  const type    = devTypeSelect.value;
  const season  = parseInt(devSeasonInput.value) || 1;
  const episode = parseInt(devEpisodeInput.value) || 1;

  const url = type === 'tv'
    ? `${PLAYER_BASE}/embed/tv/${mediaId}/${season}/${episode}?primaryColor=${PCOLOR}`
    : `${PLAYER_BASE}/embed/movie/${mediaId}?primaryColor=${PCOLOR}`;

  $('playerIframe').src = url;
  $('playerTitle').textContent = type === 'tv'
    ? `${mediaId} — S${pad2(season)}E${pad2(episode)}`
    : mediaId;
  devInfo.textContent = url;
});

// Episode/season navigation shortcuts
document.getElementById('devNextEp').addEventListener('click', () => {
  devEpisodeInput.value = (parseInt(devEpisodeInput.value) || 1) + 1;
  document.getElementById('devApply').click();
});
document.getElementById('devPrevEp').addEventListener('click', () => {
  const ep = Math.max(1, (parseInt(devEpisodeInput.value) || 1) - 1);
  devEpisodeInput.value = ep;
  document.getElementById('devApply').click();
});
document.getElementById('devNextSeason').addEventListener('click', () => {
  devSeasonInput.value  = (parseInt(devSeasonInput.value) || 1) + 1;
  devEpisodeInput.value = 1;
  document.getElementById('devApply').click();
});
document.getElementById('devPrevSeason').addEventListener('click', () => {
  const s = Math.max(1, (parseInt(devSeasonInput.value) || 1) - 1);
  devSeasonInput.value  = s;
  devEpisodeInput.value = 1;
  document.getElementById('devApply').click();
});

// Enter in dev inputs triggers apply
[devIdInput, devSeasonInput, devEpisodeInput, devCustomUrl].forEach(el => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('devApply').click();
  });
});
