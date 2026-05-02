/* ── Default Playlist ────────────────────────────────── */
const DEFAULT_PLAYLIST = [
  { id: "dQw4w9WgXcQ", title: "Rick Astley – Never Gonna Give You Up", channel: "Rick Astley" },
  { id: "9bZkp7q19f0", title: "PSY – GANGNAM STYLE",                   channel: "officialpsy" },
  { id: "kJQP7kiw5Fk", title: "Luis Fonsi – Despacito ft. Daddy Yankee", channel: "Luis Fonsi" },
  { id: "JGwWNGJdvx8", title: "Ed Sheeran – Shape of You",              channel: "Ed Sheeran" },
  { id: "RgKAFK5djSk", title: "Wiz Khalifa – See You Again ft. Charlie Puth", channel: "Wiz Khalifa" },
  { id: "OPf0YbXqDm0", title: "Mark Ronson – Uptown Funk ft. Bruno Mars", channel: "Mark Ronson" },
];

const QUALITY_LABELS = {
  highres:"4K", hd2160:"4K", hd1440:"1440p", hd1080:"1080p",
  hd720:"720p", large:"480p", medium:"360p", small:"240p",
  tiny:"144p", auto:"Auto", default:"Auto",
};

const LS = {
  QUEUE:   "yr-queue",
  INDEX:   "yr-index",
  VOLUME:  "yr-volume",
  SHUFFLE: "yr-shuffle",
  LOOP:    "yr-loop",
};

/* ── State ───────────────────────────────────────────── */
let player        = null;
let playlist      = [...DEFAULT_PLAYLIST];
let currentIndex  = 0;
let isShuffleOn   = false;
let isLoopOn      = false;
let isMuted       = false;
let isPlaying     = false;
let isTheatre     = false;
let captionsOn    = false;
let captionTracks = [];
let pollId        = null;
let isSeeking     = false;

/* ── DOM ─────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const playBtn       = $("play-btn");
const prevBtn       = $("prev-btn");
const nextBtn       = $("next-btn");
const muteBtn       = $("mute-btn");
const shuffleBtn    = $("shuffle-btn");
const loopBtn       = $("loop-btn");
const theatreBtn    = $("theatre-btn");
const ccBtn         = $("cc-btn");
const ccLang        = $("cc-lang");
const ytLink        = $("yt-link");
const volSlider     = $("vol-slider");
const seekTrack     = $("seek-track");
const seekFill      = $("seek-fill");
const seekBuffer    = $("seek-buffer");
const seekThumb     = $("seek-thumb");
const tCurrent      = $("t-current");
const tDuration     = $("t-duration");
const npTitle       = $("np-title");
const npChannel     = $("np-channel");
const npThumb       = $("np-thumb");
const trackPos      = $("track-pos");
const qCount        = $("q-count");
const queueList     = $("queue-list");
const searchInput   = $("search-input");
const addBtn        = $("add-btn");
const addForm       = $("add-form");
const urlInput      = $("url-input");
const cancelBtn     = $("cancel-btn");
const speedPills    = $("speed-pills");
const qualitySelect = $("quality-select");
const toastsEl      = $("toasts");
const mainEl        = document.querySelector(".main");
const videoWrap     = document.querySelector(".video-wrap");

/* New elements added in HTML/CSS update */
const seekTooltip    = $("seek-tooltip");
const queueCol       = $("queue-col");
const queueOverlay   = $("queue-overlay");
const queueOpenBtn   = $("queue-open-btn");
const queueCloseBtn  = $("queue-close-btn");
const clearQueueBtn  = $("clear-queue-btn");
const fsBtn          = $("fs-btn");
const swipeHintLeft  = $("swipe-hint-left");
const swipeHintRight = $("swipe-hint-right");
const dragHandle     = $("drag-handle");

/* ── localStorage persistence ────────────────────────── */
function saveState() {
  try {
    localStorage.setItem(LS.QUEUE,   JSON.stringify(playlist));
    localStorage.setItem(LS.INDEX,   String(currentIndex));
    localStorage.setItem(LS.VOLUME,  volSlider.value);
    localStorage.setItem(LS.SHUFFLE, String(isShuffleOn));
    localStorage.setItem(LS.LOOP,    String(isLoopOn));
  } catch { /* storage unavailable */ }
}

function loadState() {
  try {
    const savedQueue = localStorage.getItem(LS.QUEUE);
    if (savedQueue) {
      const parsed = JSON.parse(savedQueue);
      if (Array.isArray(parsed) && parsed.length) {
        playlist     = parsed;
        currentIndex = Math.min(
          parseInt(localStorage.getItem(LS.INDEX) || "0", 10),
          playlist.length - 1
        );
      }
    }

    const savedVol = localStorage.getItem(LS.VOLUME);
    if (savedVol) volSlider.value = savedVol;

    isShuffleOn = localStorage.getItem(LS.SHUFFLE) === "true";
    isLoopOn    = localStorage.getItem(LS.LOOP)    === "true";

    /* Sync toggle button states */
    shuffleBtn.classList.toggle("active", isShuffleOn);
    loopBtn.classList.toggle("active", isLoopOn);
  } catch { /* ignore corrupt storage */ }
}

/* ── YouTube API Bootstrap ───────────────────────────── */
function loadAPI() {
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
}

window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player("yt-player", {
    height:  "100%",
    width:   "100%",
    videoId: playlist[currentIndex].id,
    playerVars: {
      autoplay:       0,
      controls:       0,
      rel:            0,
      modestbranding: 1,
      iv_load_policy: 3,   /* Disable annotations */
    },
    events: {
      onReady:                 onReady,
      onStateChange:           onStateChange,
      onPlaybackQualityChange: onQualityChange,
      onPlaybackRateChange:    onRateChange,
      onApiChange:             onApiChange,
    },
  });
};

function onReady(e) {
  e.target.setVolume(parseInt(volSlider.value, 10));
  e.target.loadModule("captions");
  updateTrackInfo();
  renderQueue();
}

function onStateChange(e) {
  const s = e.data;
  if (s === YT.PlayerState.PLAYING) {
    isPlaying = true;
    showPause();
    startPoll();
    fetchVideoData();
    updateQualityOptions();
  } else if (s === YT.PlayerState.PAUSED || s === YT.PlayerState.BUFFERING) {
    isPlaying = false;
    showPlay();
    stopPoll();
    syncEqState();
  } else if (s === YT.PlayerState.ENDED) {
    isPlaying = false;
    showPlay();
    stopPoll();
    syncEqState();
    onTrackEnded();
  }
}

/* ── Event-driven API sync ───────────────────────────── */

/* onPlaybackQualityChange — keeps dropdown in sync when YT auto-adjusts */
function onQualityChange(e) {
  if (qualitySelect.value !== e.data) qualitySelect.value = e.data;
}

/* onPlaybackRateChange — keeps speed pills in sync when rate changes externally */
function onRateChange(e) {
  const rate = e.data;
  speedPills.querySelectorAll(".pill").forEach((p) => {
    p.classList.toggle("active", parseFloat(p.dataset.speed) === rate);
  });
}

/* onApiChange — captions module ready, populate language list */
function onApiChange() {
  try {
    const tracks = player.getOption("captions", "tracklist");
    if (tracks?.length) {
      captionTracks = tracks;
      populateCcLangSelect();
    }
  } catch { /* not yet initialised */ }
}

/* ── Captions ────────────────────────────────────────── */
function populateCcLangSelect() {
  ccLang.innerHTML = "";
  captionTracks.forEach((track) => {
    const opt = document.createElement("option");
    opt.value       = track.languageCode;
    opt.textContent = track.displayName || track.languageCode;
    ccLang.appendChild(opt);
  });
  ccLang.classList.toggle("hidden", !captionsOn || captionTracks.length <= 1);
}

function toggleCaptions() {
  if (!player) return;
  captionsOn = !captionsOn;

  if (captionsOn) {
    if (!captionTracks.length) {
      player.loadModule("captions");
      toast("Loading captions…", "info");
    } else {
      const lang = ccLang.value || captionTracks[0]?.languageCode;
      if (lang) player.setOption("captions", "track", { languageCode: lang });
      ccLang.classList.toggle("hidden", captionTracks.length <= 1);
      toast("Captions on", "info");
    }
  } else {
    player.setOption("captions", "track", {});
    ccLang.classList.add("hidden");
    toast("Captions off", "info");
  }

  ccBtn.classList.toggle("active", captionsOn);
}

/* ── Theatre mode: setSize() after CSS transition ────── */
function toggleTheatre() {
  isTheatre = !isTheatre;
  mainEl.classList.toggle("theatre", isTheatre);
  theatreBtn.classList.toggle("active", isTheatre);

  setTimeout(() => {
    if (player?.setSize) player.setSize(videoWrap.clientWidth, videoWrap.clientHeight);
  }, 270);

  toast(isTheatre ? "Theatre mode on" : "Theatre mode off", "info");
}

/* ── Fullscreen ──────────────────────────────────────── */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    videoWrap.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

document.addEventListener("fullscreenchange", () => {
  const isFullscreen = !!document.fullscreenElement;
  fsBtn.querySelector(".icon-expand").classList.toggle("hidden", isFullscreen);
  fsBtn.querySelector(".icon-compress").classList.toggle("hidden", !isFullscreen);
});

/* ── Mobile queue sheet ──────────────────────────────── */
function openQueueSheet() {
  queueCol.classList.add("open");
  queueOverlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeQueueSheet() {
  queueCol.classList.remove("open");
  queueOverlay.classList.remove("open");
  document.body.style.overflow = "";
}

/* ── Swipe hints (video-wrap) ────────────────────────── */
function showSwipeHint(hintEl) {
  hintEl.classList.add("visible");
  setTimeout(() => hintEl.classList.remove("visible"), 600);
}

/* ── getVideoData() — auto-fill real title + author ──── */
function fetchVideoData() {
  if (!player?.getVideoData) return;
  const data = player.getVideoData();
  if (!data?.video_id) return;

  const title   = data.title  || playlist[currentIndex]?.title   || "Unknown";
  const channel = data.author || playlist[currentIndex]?.channel || "Unknown";

  if (playlist[currentIndex]) {
    playlist[currentIndex].title   = title;
    playlist[currentIndex].channel = channel;
  }

  npTitle.textContent   = title;
  npChannel.textContent = channel;
  document.title        = `${title} • yourad`;

  /* getVideoUrl() — update Open in YouTube link */
  updateYtLink();

  /* Patch live queue row title/channel without full re-render */
  const activeRow = queueList.querySelector(".q-item.active");
  if (activeRow) {
    const t = activeRow.querySelector(".q-title");
    const c = activeRow.querySelector(".q-channel");
    if (t) t.textContent = title;
    if (c) c.textContent = channel;
  }

  /* Refresh caption tracks for the new video */
  try {
    const tracks = player.getOption("captions", "tracklist");
    if (tracks?.length) { captionTracks = tracks; populateCcLangSelect(); }
  } catch { /* not yet available */ }

  saveState();
}

/* ── getVideoUrl() — Open in YouTube link ────────────── */
function updateYtLink() {
  const fallback = `https://www.youtube.com/watch?v=${playlist[currentIndex]?.id}`;
  ytLink.href = player?.getVideoUrl?.() || fallback;
}

/* ── getAvailableQualityLevels() ─────────────────────── */
function updateQualityOptions() {
  if (!player?.getAvailableQualityLevels) return;
  const levels  = player.getAvailableQualityLevels();
  const current = player.getPlaybackQuality();
  if (!levels?.length) return;

  qualitySelect.innerHTML = "";
  levels.forEach((lvl) => {
    const opt = document.createElement("option");
    opt.value       = lvl;
    opt.textContent = QUALITY_LABELS[lvl] || lvl;
    opt.selected    = lvl === current;
    qualitySelect.appendChild(opt);
  });
}

/* ── Progress: getCurrentTime + getVideoLoadedFraction() */
function startPoll() { stopPoll(); pollId = setInterval(tickProgress, 500); }
function stopPoll()  { if (pollId !== null) { clearInterval(pollId); pollId = null; } }

function tickProgress() {
  if (isSeeking || !player?.getDuration) return;
  const cur = player.getCurrentTime()         || 0;
  const dur = player.getDuration()            || 0;
  const buf = player.getVideoLoadedFraction() || 0;
  if (!dur) return;

  const pct = (cur / dur) * 100;
  seekFill.style.width   = `${pct}%`;
  seekThumb.style.left   = `${pct}%`;
  seekBuffer.style.width = `${buf * 100}%`;
  tCurrent.textContent   = fmt(cur);
  tDuration.textContent  = fmt(dur);
}

/* Core seek by raw clientX — shared by mouse drag and touch */
function seekToClientX(clientX) {
  if (!player?.getDuration?.()) return;
  const rect  = seekTrack.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const dur   = player.getDuration();
  seekTooltip.textContent = fmt(ratio * dur);
  seekTooltip.style.left  = `${ratio * 100}%`;
  player.seekTo(ratio * dur, true);
  tickProgress();
}

function seekTo(e) { seekToClientX(e.clientX); }

/* Seek ±seconds from current position (used by keyboard Arrow keys) */
function seekBy(seconds) {
  if (!player?.getDuration?.()) return;
  const clamped = Math.max(0, Math.min(player.getDuration(), player.getCurrentTime() + seconds));
  player.seekTo(clamped, true);
  tickProgress();
}

/* ── Playback ────────────────────────────────────────── */
function loadTrack(index) {
  if (index < 0 || index >= playlist.length) return;
  currentIndex = index;
  player.loadVideoById(playlist[currentIndex].id);

  captionTracks = [];
  ccLang.innerHTML = "";
  ccLang.classList.add("hidden");

  updateTrackInfo();
  renderQueue();
  saveState();
}

function onTrackEnded() {
  if (isLoopOn) { player.seekTo(0); player.playVideo(); }
  else nextTrack();
}

function nextTrack() {
  if (!playlist.length) return;
  const next = isShuffleOn
    ? randExcluding(currentIndex, playlist.length)
    : (currentIndex + 1) % playlist.length;
  loadTrack(next);
}

function prevTrack() {
  if (!playlist.length) return;
  if (player.getCurrentTime() > 3) { player.seekTo(0); return; }
  loadTrack((currentIndex - 1 + playlist.length) % playlist.length);
}

function randExcluding(exc, total) {
  if (total <= 1) return 0;
  let i; do { i = Math.floor(Math.random() * total); } while (i === exc);
  return i;
}

/* ── UI helpers ──────────────────────────────────────── */
function showPlay() {
  playBtn.querySelector(".icon-play").classList.remove("hidden");
  playBtn.querySelector(".icon-pause").classList.add("hidden");
}

function showPause() {
  playBtn.querySelector(".icon-play").classList.add("hidden");
  playBtn.querySelector(".icon-pause").classList.remove("hidden");
}

function updateTrackInfo() {
  const t = playlist[currentIndex];
  if (!t) return;
  npTitle.textContent   = t.title;
  npChannel.textContent = t.channel || "—";
  npThumb.src           = `https://i.ytimg.com/vi/${t.id}/mqdefault.jpg`;
  trackPos.textContent  = `${currentIndex + 1} / ${playlist.length}`;
  document.title        = `${t.title} • yourad`;
  updateYtLink();
}

function syncEqState() {
  const eq = queueList.querySelector(".q-item.active .q-eq");
  if (eq) eq.classList.toggle("paused", !isPlaying);
}

/* ── Queue render ────────────────────────────────────── */
function renderQueue() {
  queueList.innerHTML  = "";
  qCount.textContent   = playlist.length;
  trackPos.textContent = `${currentIndex + 1} / ${playlist.length}`;

  if (!playlist.length) {
    queueList.innerHTML = `
      <li class="q-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
        <p>Queue is empty</p>
        <span>Paste a YouTube URL above to add a video</span>
      </li>`;
    return;
  }

  playlist.forEach((track, idx) => {
    const active = idx === currentIndex;
    const li     = document.createElement("li");
    li.className = `q-item${active ? " active" : ""}`;

    const indicator = active
      ? `<div class="q-eq${isPlaying ? "" : " paused"}">
           <div class="q-eq-bar"></div>
           <div class="q-eq-bar"></div>
           <div class="q-eq-bar"></div>
         </div>`
      : `<span class="q-num">${idx + 1}</span>`;

    li.innerHTML = `
      ${indicator}
      <img class="q-thumb" src="https://i.ytimg.com/vi/${track.id}/default.jpg" alt="" loading="lazy" />
      <div class="q-info">
        <div class="q-title">${esc(track.title)}</div>
        <div class="q-channel">${esc(track.channel || "")}</div>
      </div>
      <button class="q-remove" data-idx="${idx}" title="Remove">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>`;

    li.addEventListener("click", (ev) => {
      if (ev.target.closest(".q-remove")) return;
      loadTrack(idx);
    });

    li.querySelector(".q-remove").addEventListener("click", (ev) => {
      ev.stopPropagation();
      removeTrack(parseInt(ev.currentTarget.dataset.idx, 10));
    });

    /* cueVideoById() hover preview */
    li.addEventListener("mouseenter", () => {
      npThumb.src = `https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`;
      if (player && !active) {
        const state = player.getPlayerState();
        if (state === -1 || state === YT.PlayerState.ENDED) player.cueVideoById(track.id);
      }
    });

    li.addEventListener("mouseleave", () => {
      const cur = playlist[currentIndex];
      if (cur) npThumb.src = `https://i.ytimg.com/vi/${cur.id}/mqdefault.jpg`;
      if (player && !active) {
        const state = player.getPlayerState();
        if (state === -1 || state === YT.PlayerState.ENDED) player.cueVideoById(playlist[currentIndex].id);
      }
    });

    queueList.appendChild(li);
  });

  queueList.querySelector(".q-item.active")
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });

  filterQueue(searchInput.value);
}

function removeTrack(idx) {
  playlist.splice(idx, 1);

  if (!playlist.length) {
    player?.stopVideo?.();
    npTitle.textContent   = "Select a video to play";
    npChannel.textContent = "—";
    npThumb.src           = "";
    ytLink.href           = "#";
    currentIndex          = 0;
  } else if (idx < currentIndex) {
    currentIndex = Math.max(0, currentIndex - 1);
  } else if (idx === currentIndex) {
    currentIndex = Math.min(currentIndex, playlist.length - 1);
    loadTrack(currentIndex);
  }

  renderQueue();
  saveState();
  toast("Removed from queue", "info");
}

/* ── Search ──────────────────────────────────────────── */
function filterQueue(q) {
  const query = q.trim().toLowerCase();
  queueList.querySelectorAll(".q-item").forEach((item) => {
    const title   = item.querySelector(".q-title")?.textContent.toLowerCase()   || "";
    const channel = item.querySelector(".q-channel")?.textContent.toLowerCase() || "";
    item.classList.toggle("filtered-out", !!query && !title.includes(query) && !channel.includes(query));
  });
}

/* ── Add video ───────────────────────────────────────── */
function parseVideoId(raw) {
  for (const re of [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ]) {
    const m = raw.match(re);
    if (m) return m[1];
  }
  return null;
}

function addVideo(raw) {
  const id = parseVideoId(raw.trim());
  if (!id) { toast("Invalid YouTube URL or ID", "err"); return false; }
  if (playlist.some((t) => t.id === id)) { toast("Already in queue", "err"); return false; }

  const wasEmpty = playlist.length === 0;
  playlist.push({ id, title: "Loading…", channel: "YouTube" });
  renderQueue();
  saveState();

  /* Auto-load + play when the queue was empty */
  if (wasEmpty && player) {
    loadTrack(0);
    player.playVideo();
  }

  toast("Added to queue", "ok");
  return true;
}

/* ── Toast ───────────────────────────────────────────── */
function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="toast-dot"></div>${esc(msg)}`;
  toastsEl.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("show")));
  setTimeout(() => {
    el.classList.remove("show");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  }, 2600);
}

/* ── Utility ─────────────────────────────────────────── */
function fmt(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function esc(str) {
  const d = document.createElement("div");
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

/* Update CSS custom property so the vol-slider track fills to its current value */
function updateVolSliderFill() {
  volSlider.style.setProperty("--vol-fill", `${volSlider.value}%`);
}

/* ── Event listeners ─────────────────────────────────── */
playBtn.addEventListener("click", () => {
  if (!player) return;
  player.getPlayerState() === YT.PlayerState.PLAYING
    ? player.pauseVideo()
    : player.playVideo();
});

prevBtn.addEventListener("click",    () => player && prevTrack());
nextBtn.addEventListener("click",    () => player && nextTrack());
theatreBtn.addEventListener("click", () => toggleTheatre());
ccBtn.addEventListener("click",      () => toggleCaptions());
fsBtn.addEventListener("click",      () => toggleFullscreen());

muteBtn.addEventListener("click", () => {
  if (!player) return;
  isMuted = !isMuted;
  isMuted ? player.mute() : player.unMute();
  muteBtn.querySelector(".icon-vol").classList.toggle("hidden", isMuted);
  muteBtn.querySelector(".icon-mute").classList.toggle("hidden", !isMuted);
});

volSlider.addEventListener("input", () => {
  if (!player) return;
  const v = parseInt(volSlider.value, 10);
  player.setVolume(v);
  updateVolSliderFill();
  localStorage.setItem(LS.VOLUME, volSlider.value);
  if (isMuted && v > 0) {
    isMuted = false;
    player.unMute();
    muteBtn.querySelector(".icon-vol").classList.remove("hidden");
    muteBtn.querySelector(".icon-mute").classList.add("hidden");
  }
});

shuffleBtn.addEventListener("click", () => {
  isShuffleOn = !isShuffleOn;
  shuffleBtn.classList.toggle("active", isShuffleOn);
  saveState();
  toast(isShuffleOn ? "Shuffle on" : "Shuffle off", "info");
});

loopBtn.addEventListener("click", () => {
  isLoopOn = !isLoopOn;
  loopBtn.classList.toggle("active", isLoopOn);
  saveState();
  toast(isLoopOn ? "Loop on" : "Loop off", "info");
});

/* Seek tooltip on hover */
seekTrack.addEventListener("mousemove", (e) => {
  const rect  = seekTrack.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const dur   = player?.getDuration?.() || 0;
  seekTooltip.textContent = fmt(ratio * dur);
  seekTooltip.style.left  = `${ratio * 100}%`;
  seekTooltip.classList.add("visible");
});

seekTrack.addEventListener("mouseleave", () => {
  if (!isSeeking) seekTooltip.classList.remove("visible");
});

/* Seek: mouse click + drag */
seekTrack.addEventListener("mousedown", (e) => {
  isSeeking = true;
  seekTooltip.classList.add("visible");
  seekTo(e);
  const move = (ev) => seekTo(ev);
  const up   = () => {
    isSeeking = false;
    seekTooltip.classList.remove("visible");
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

/* Seek: touch drag (mobile) — preventDefault stops page scroll */
seekTrack.addEventListener("touchstart", (e) => {
  e.preventDefault();
  isSeeking = true;
  seekToClientX(e.touches[0].clientX);
}, { passive: false });

seekTrack.addEventListener("touchmove", (e) => {
  e.preventDefault();
  seekToClientX(e.touches[0].clientX);
}, { passive: false });

seekTrack.addEventListener("touchend", () => { isSeeking = false; }, { passive: true });

/* setPlaybackRate() — onPlaybackRateChange syncs the pill UI */
speedPills.addEventListener("click", (e) => {
  const pill = e.target.closest(".pill");
  if (!pill || !player) return;
  player.setPlaybackRate(parseFloat(pill.dataset.speed));
  toast(`Speed: ${pill.dataset.speed}×`, "info");
});

/* setPlaybackQuality() — onPlaybackQualityChange confirms it */
qualitySelect.addEventListener("change", () => {
  if (!player) return;
  player.setPlaybackQuality(qualitySelect.value);
  toast(`Quality: ${QUALITY_LABELS[qualitySelect.value] || qualitySelect.value}`, "info");
});

ccLang.addEventListener("change", () => {
  if (!player || !captionsOn) return;
  player.setOption("captions", "track", { languageCode: ccLang.value });
});

searchInput.addEventListener("input", debounce(() => filterQueue(searchInput.value), 120));

addBtn.addEventListener("click", () => { addForm.classList.remove("hidden"); urlInput.focus(); });
cancelBtn.addEventListener("click", () => { addForm.classList.add("hidden"); urlInput.value = ""; });

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (addVideo(urlInput.value)) { addForm.classList.add("hidden"); urlInput.value = ""; }
});

/* Mobile queue sheet controls */
queueOpenBtn.addEventListener("click",  openQueueSheet);
queueCloseBtn.addEventListener("click", closeQueueSheet);
queueOverlay.addEventListener("click",  closeQueueSheet);

/* Drag handle: swipe down to close, swipe up to open */
let dragStartY = 0;

dragHandle.addEventListener("touchstart", (e) => {
  dragStartY = e.touches[0].clientY;
}, { passive: true });

dragHandle.addEventListener("touchend", (e) => {
  const delta = e.changedTouches[0].clientY - dragStartY;
  if (delta > 60) closeQueueSheet();
  else if (delta < -60) openQueueSheet();
}, { passive: true });

/* Video-wrap: swipe left/right = next/prev; double-tap = play/pause */
let touchStartX    = 0;
let touchStartY    = 0;
let lastVideoTapMs = 0;

videoWrap.addEventListener("touchstart", (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

videoWrap.addEventListener("touchend", (e) => {
  const deltaX = e.changedTouches[0].clientX - touchStartX;
  const deltaY = e.changedTouches[0].clientY - touchStartY;
  const isHorizontalSwipe = Math.abs(deltaX) >= 40 && Math.abs(deltaX) >= Math.abs(deltaY) * 1.5;

  if (isHorizontalSwipe) {
    if (deltaX < 0) { showSwipeHint(swipeHintRight); if (player) nextTrack(); }
    else            { showSwipeHint(swipeHintLeft);  if (player) prevTrack(); }
    return;
  }

  /* Double-tap to play/pause (only on small movements = taps) */
  if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
    const now = Date.now();
    if (now - lastVideoTapMs < 300 && player) {
      player.getPlayerState() === YT.PlayerState.PLAYING
        ? player.pauseVideo()
        : player.playVideo();
      lastVideoTapMs = 0;
    } else {
      lastVideoTapMs = now;
    }
  }
}, { passive: true });

/* Clear queue */
clearQueueBtn.addEventListener("click", () => {
  if (!playlist.length) return;
  player?.stopVideo?.();
  playlist     = [];
  currentIndex = 0;
  npTitle.textContent   = "Select a video to play";
  npChannel.textContent = "—";
  npThumb.src           = "";
  ytLink.href           = "#";
  renderQueue();
  saveState();
  toast("Queue cleared", "info");
});

/* Pause progress poll when tab is hidden, resume when visible */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPoll();
  else if (isPlaying)  startPoll();
});

/* Keyboard shortcuts */
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  switch (e.code) {
    case "Space":      e.preventDefault(); playBtn.click();                          break;
    /* Arrow keys seek ±5 s (Shift = ±30 s); N/P skip tracks */
    case "ArrowRight": e.preventDefault(); seekBy(e.shiftKey ? 30 : 5);             break;
    case "ArrowLeft":  e.preventDefault(); seekBy(e.shiftKey ? -30 : -5);           break;
    case "KeyN":       e.preventDefault(); nextBtn.click();                          break;
    case "KeyP":       e.preventDefault(); prevBtn.click();                          break;
    case "KeyM":       muteBtn.click();                                              break;
    case "KeyS":       shuffleBtn.click();                                           break;
    case "KeyR":       loopBtn.click();                                              break;
    case "KeyL":       loopBtn.click();                                              break;
    case "KeyT":       theatreBtn.click();                                           break;
    case "KeyC":       ccBtn.click();                                                break;
    case "KeyF":       fsBtn.click();                                                break;
    case "Escape":     closeQueueSheet();                                            break;
  }
});

/* ── Init ────────────────────────────────────────────── */
loadState();
updateVolSliderFill();
loadAPI();
