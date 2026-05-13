// ══ CONFIG ══════════════════════════════════════
const LISTING_BASE = 'https://vidapi.ru';
const PLAYER_BASE  = 'https://vaplayer.ru';
const PLAYER_COLOR = '%2306b6d4';
const SHANNON_ID   = '229386'; // 🤫 tell her privately

// ══ SHANNON ══════════════════════════════════════
const shannonOverlay = document.getElementById('shannonOverlay');
document.getElementById('shannonContinue').addEventListener('click', () => {
  doLogin(SHANNON_ID);
  shannonOverlay.classList.add('hidden');
  document.body.style.overflow = '';
});

// ══ LOGIN ════════════════════════════════════════
const loginWidget    = document.getElementById('loginWidget');
const userWidget     = document.getElementById('userWidget');
const loginToggleBtn = document.getElementById('loginToggleBtn');
const loginDropdown  = document.getElementById('loginDropdown');
const loginIdInput   = document.getElementById('loginIdInput');
const loginErr       = document.getElementById('loginErr');
const userTag        = document.getElementById('userTag');

loginToggleBtn.addEventListener('click', () => {
  const isOpen = !loginDropdown.classList.contains('hidden');
  loginDropdown.classList.toggle('hidden', isOpen);
  if (!isOpen) { loginIdInput.value = ''; loginErr.classList.add('hidden'); loginIdInput.focus(); }
});
document.addEventListener('click', (e) => {
  if (!document.getElementById('loginArea').contains(e.target))
    loginDropdown.classList.add('hidden');
});
loginIdInput.addEventListener('input', () => {
  loginIdInput.value = loginIdInput.value.replace(/\D/g, '').slice(0, 6);
  loginErr.classList.add('hidden');
  if (loginIdInput.value.length === 6) setTimeout(() => submitLogin(loginIdInput.value), 80);
});
loginIdInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (loginIdInput.value.length !== 6) { loginErr.classList.remove('hidden'); return; }
  submitLogin(loginIdInput.value);
});
function submitLogin(id) {
  if (id === SHANNON_ID) {
    loginDropdown.classList.add('hidden');
    shannonOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    return;
  }
  doLogin(id);
}
function doLogin(id) {
  sessionStorage.setItem('vs_id', id);
  loginDropdown.classList.add('hidden');
  loginWidget.classList.add('hidden');
  userWidget.classList.remove('hidden');
  userTag.textContent = `#${id}`;
}
document.getElementById('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('vs_id');
  userWidget.classList.add('hidden');
  loginWidget.classList.remove('hidden');
});
const savedId = sessionStorage.getItem('vs_id');
if (savedId) {
  loginWidget.classList.add('hidden');
  userWidget.classList.remove('hidden');
  userTag.textContent = `#${savedId}`;
}

// ══ HELPERS ══════════════════════════════════════
const esc  = (s) => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const pad2 = (n) => String(n).padStart(2,'0');
function fmt(s) {
  if (!s) return '0:00';
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);
  return h>0?`${h}:${pad2(m)}:${pad2(sec)}`:`${m}:${pad2(sec)}`;
}
async function getJSON(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json();
}
function skels(el, n=12) {
  el.innerHTML = Array.from({length:n}).map(()=>'<div class="skel"></div>').join('');
}
function resume(key) { const v=localStorage.getItem(`vs_${key}`); return v?`&resumeAt=${v}`:''; }
function embedMovie(item) {
  const id=item.imdb_id||item.tmdb_id;
  return `${PLAYER_BASE}/embed/movie/${id}?primaryColor=${PLAYER_COLOR}${resume(id)}`;
}
function embedTv(item, s, e) {
  const id=item.imdb_id||item.tmdb_id;
  return `${PLAYER_BASE}/embed/tv/${id}/${s}/${e}?primaryColor=${PLAYER_COLOR}${resume(`${id}_${s}_${e}`)}`;
}

const PLAY_SVG = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
const FILM_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"/></svg>`;
const TV_SVG   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>`;

// ══ STATE ════════════════════════════════════════
let moviesPage = 1, tvPage = 1, activeSection = 'movies';

// ══ DOM ══════════════════════════════════════════
const moviesGrid  = document.getElementById('moviesGrid');
const tvGrid      = document.getElementById('tvGrid');
const searchGrid  = document.getElementById('searchGrid');
const playerModal = document.getElementById('playerModal');
const playerIframe= document.getElementById('playerIframe');
const playerTitle = document.getElementById('playerTitle');
const progFill    = document.getElementById('progFill');
const progTime    = document.getElementById('progTime');

// ══ PLAYER ═══════════════════════════════════════
function play(url, title) {
  playerIframe.src = url; playerTitle.textContent = title;
  progFill.style.width = '0%'; progTime.textContent = '—';
  playerModal.classList.remove('hidden'); document.body.style.overflow = 'hidden';
}
function closePlayer() {
  playerIframe.src = ''; playerModal.classList.add('hidden'); document.body.style.overflow = '';
}
document.getElementById('playerClose').addEventListener('click', closePlayer);
playerModal.addEventListener('click', (e) => { if(e.target===playerModal) closePlayer(); });
document.addEventListener('keydown', (e) => {
  if (e.key==='Escape' && !playerModal.classList.contains('hidden')) closePlayer();
});

window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'PLAYER_EVENT') return;
  const {player_info, player_status, player_progress, player_duration} = event.data.data;
  if (player_status === 'playing' || player_status === 'paused') {
    const key = player_info.season != null
      ? `${player_info.imdb||player_info.tmdb}_${player_info.season}_${player_info.episode}`
      : `${player_info.imdb||player_info.tmdb}`;
    localStorage.setItem(`vs_${key}`, player_progress);
    progFill.style.width = player_duration > 0 ? `${(player_progress/player_duration)*100}%` : '0%';
    progTime.textContent = player_duration
      ? `${fmt(player_progress)} / ${fmt(player_duration)}` : fmt(player_progress);
  }
  if (player_status === 'completed' && player_info.mediaType === 'tv') {
    const show = {imdb_id: player_info.imdb, tmdb_id: player_info.tmdb, title: player_info.title};
    const nextEp = parseInt(player_info.episode) + 1;
    play(embedTv(show, player_info.season, nextEp),
      `${player_info.title} — S${pad2(player_info.season)}E${pad2(nextEp)}`);
  }
});

// ══ CARDS ════════════════════════════════════════
function movieCard(item) {
  const d = document.createElement('div'); d.className = 'card';
  const img = item.poster_url
    ? `<img class="card-img" src="${esc(item.poster_url)}" alt="${esc(item.title)}" loading="lazy">`
    : `<div class="card-no-img">${FILM_SVG}</div>`;
  d.innerHTML = `${img}
    <span class="card-badge badge-movie">Movie</span>
    <div class="card-play"><div class="play-circle">${PLAY_SVG}</div></div>
    <div class="card-foot">
      <span class="card-name">${esc(item.title)}</span>
      <div class="card-meta">
        <span>${item.year||'—'}</span>
        ${item.rating?`<span class="card-star">★ ${item.rating}</span>`:''}
      </div>
    </div>`;
  d.addEventListener('click', () => play(embedMovie(item), item.title));
  return d;
}

function tvCard(item) {
  const d = document.createElement('div'); d.className = 'card';
  const img = item.poster_url
    ? `<img class="card-img" src="${esc(item.poster_url)}" alt="${esc(item.title)}" loading="lazy">`
    : `<div class="card-no-img">${TV_SVG}</div>`;
  d.innerHTML = `${img}
    <span class="card-badge badge-tv">TV</span>
    <div class="card-play"><div class="play-circle">${PLAY_SVG}</div></div>
    <div class="card-foot">
      <span class="card-name">${esc(item.title)}</span>
      <div class="card-meta">
        <span>${item.year||'—'}</span>
        ${item.rating?`<span class="card-star">★ ${item.rating}</span>`:''}
      </div>
    </div>`;
  d.addEventListener('click', () => play(embedTv(item, 1, 1), item.title));
  return d;
}

// ══ LOADERS ══════════════════════════════════════
async function loadMovies(page=1) {
  skels(moviesGrid);
  const data = await getJSON(`${LISTING_BASE}/movies/latest/page-${page}.json`);
  moviesGrid.innerHTML = '';
  data.items.forEach(i => moviesGrid.appendChild(movieCard(i)));
  setPager('movies', page, data.total_pages); moviesPage = page;
}
async function loadTv(page=1) {
  skels(tvGrid);
  const data = await getJSON(`${LISTING_BASE}/tvshows/latest/page-${page}.json`);
  tvGrid.innerHTML = '';
  data.items.forEach(i => tvGrid.appendChild(tvCard(i)));
  setPager('tv', page, data.total_pages); tvPage = page;
}

// ══ PAGINATION ═══════════════════════════════════
function setPager(key, page, total) {
  document.getElementById(`${key}Page`).textContent = `${page} / ${total}`;
  document.getElementById(`${key}Prev`).disabled = page <= 1;
  document.getElementById(`${key}Next`).disabled = page >= total;
}
document.getElementById('moviesPrev').addEventListener('click', () => loadMovies(moviesPage - 1));
document.getElementById('moviesNext').addEventListener('click', () => loadMovies(moviesPage + 1));
document.getElementById('tvPrev').addEventListener('click',     () => loadTv(tvPage - 1));
document.getElementById('tvNext').addEventListener('click',     () => loadTv(tvPage + 1));

// ══ SECTIONS ═════════════════════════════════════
function switchSection(name) {
  activeSection = name;
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.ntab,.hpill').forEach(t => t.classList.remove('active'));
  document.getElementById(`${name}Section`).classList.remove('hidden');
  document.querySelectorAll(`[data-section="${name}"]`).forEach(t => t.classList.add('active'));
  if (name === 'tv' && tvGrid.children.length === 0) loadTv(tvPage);
}
document.querySelectorAll('.ntab,.hpill').forEach(btn =>
  btn.addEventListener('click', () => switchSection(btn.dataset.section))
);

// ══ SEARCH ═══════════════════════════════════════
async function doSearch(q) {
  if (!q) return;
  document.getElementById('searchQuery').textContent = q;
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.ntab,.hpill').forEach(t => t.classList.remove('active'));
  document.getElementById('searchSection').classList.remove('hidden');
  skels(searchGrid, 8);
  try {
    const [md, td] = await Promise.all([
      getJSON(`${LISTING_BASE}/movies/latest/page-1.json`),
      getJSON(`${LISTING_BASE}/tvshows/latest/page-1.json`),
    ]);
    const lower = q.toLowerCase();
    const hits = [
      ...md.items.filter(i => i.title.toLowerCase().includes(lower)),
      ...td.items.filter(i => i.title.toLowerCase().includes(lower)),
    ];
    searchGrid.innerHTML = '';
    if (!hits.length) {
      searchGrid.innerHTML = `<p style="color:var(--text3);font-size:.85rem;padding:.5rem 0">No results found.</p>`;
      return;
    }
    hits.forEach(i => searchGrid.appendChild('imdb_id' in i ? movieCard(i) : tvCard(i)));
  } catch {
    searchGrid.innerHTML = `<p style="color:#f87171;font-size:.85rem;padding:.5rem 0">Search failed.</p>`;
  }
}
document.getElementById('heroSearchBtn').addEventListener('click', () =>
  doSearch(document.getElementById('heroSearch').value.trim())
);
document.getElementById('heroSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch(e.target.value.trim());
});
document.getElementById('backBtn').addEventListener('click', () => {
  document.getElementById('heroSearch').value = '';
  switchSection(activeSection);
});

// ══ SCROLL HEADER ════════════════════════════════
window.addEventListener('scroll', () => {
  document.getElementById('header').style.boxShadow =
    window.scrollY > 10 ? '0 4px 24px rgba(0,0,0,0.5)' : '';
}, {passive: true});

// ══ INIT ═════════════════════════════════════════
loadMovies(1);
