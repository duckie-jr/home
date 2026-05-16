import './style.css';

const startPageInput = document.getElementById('startPage');
const endPageInput = document.getElementById('endPage');
const startSuggestions = document.getElementById('startSuggestions');
const endSuggestions = document.getElementById('endSuggestions');
const findPathBtn = document.getElementById('findPathBtn');
const stopBtn = document.getElementById('stopBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const wikiFrame = document.getElementById('wikiFrame');
const iframeWrap = document.getElementById('iframe-wrap');
const sidebar = document.getElementById('sidebar');
const fwdInfo = document.getElementById('fwdInfo');
const bwdInfo = document.getElementById('bwdInfo');
const statsText = document.getElementById('statsText');
const youStatus = document.getElementById('you-status');
const youInfo = document.getElementById('youInfo');
const pathResult = document.getElementById('path-result');
const pathHeader = document.getElementById('path-header');
const pathSteps = document.getElementById('pathSteps');
const replayStatus = document.getElementById('replay-status');

let abortController = null;
let foundPath = null;
let searchRunning = false;

// Shared search state so the user-tracking can inject into forward BFS
let forwardParent = null;
let backwardNext = null;
let endTitle = null;

const WIKI_API = 'https://en.wikipedia.org/w/api.php';

function buildApiUrl(params) {
  const url = new URL(WIKI_API);
  url.searchParams.set('origin', '*');
  for (const [key, val] of Object.entries(params)) url.searchParams.set(key, val);
  return url.toString();
}

// ── Fullscreen ──
fullscreenBtn.addEventListener('click', () => {
  iframeWrap.classList.toggle('fullscreen');
  fullscreenBtn.textContent = iframeWrap.classList.contains('fullscreen') ? '✕' : '⛶';
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && iframeWrap.classList.contains('fullscreen')) {
    iframeWrap.classList.remove('fullscreen');
    fullscreenBtn.textContent = '⛶';
  }
});

// ── User navigation detection ──
// Poll the iframe URL to detect when the human clicks a wiki link.
// We can't read cross-origin URLs directly, so we detect load events
// and try to extract the title from the URL via a proxy trick.
// Fallback: we watch for the iframe 'load' event and try to parse
// the new URL. Cross-origin blocks reading .contentWindow.location,
// but we can listen for navigation via the History API trick.

let lastUserTitle = null;

function extractTitleFromUrl(url) {
  try {
    const match = url.match(/\/wiki\/([^#?]+)/);
    if (match) return decodeURIComponent(match[1].replace(/_/g, ' '));
  } catch {}
  return null;
}

// We set the iframe src ourselves, so we know what it should be.
// If the iframe fires 'load' and we didn't cause it, the user clicked a link.
let programmaticNavigation = false;

wikiFrame.addEventListener('load', () => {
  if (programmaticNavigation) return;
  // User navigated — try to figure out where they went by checking
  // what we can. Since cross-origin blocks .contentWindow.location,
  // we use the Wikipedia API to check what page they might be on
  // based on the links of their last known page.
  if (searchRunning && lastUserTitle) {
    detectUserNavigation();
  }
});

async function detectUserNavigation() {
  // We can't read the iframe URL cross-origin, but we can detect
  // the user clicked something. We fetch the links of their last
  // known page and check if any connect to the backward set.
  if (!lastUserTitle || !backwardNext || !forwardParent) return;

  try {
    const links = await fetchLinks(lastUserTitle, abortController?.signal);
    // Check if any of the user's available links hit the backward set
    for (const linkTitle of links) {
      if (backwardNext.has(linkTitle) && !forwardParent.has(linkTitle)) {
        // Inject this into the forward search
        forwardParent.set(linkTitle, lastUserTitle);
        youInfo.textContent = 'found shortcut via ' + linkTitle;
      }
    }
  } catch {}
}

// ── API fetches ──
async function fetchSuggestions(query) {
  if (!query || query.length < 2) return [];
  try {
    const res = await fetch(buildApiUrl({ action: 'opensearch', search: query, limit: '6', namespace: '0', format: 'json' }));
    return (await res.json())[1] || [];
  } catch { return []; }
}

async function fetchLinks(title, signal) {
  const allLinks = [];
  let plcontinue = null;
  for (let batch = 0; batch < 2; batch++) {
    const params = { action: 'query', titles: title, prop: 'links', pllimit: '500', plnamespace: '0', format: 'json' };
    if (plcontinue) params.plcontinue = plcontinue;
    const res = await fetch(buildApiUrl(params), { signal });
    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) break;
    const pageId = Object.keys(pages)[0];
    if (pageId === '-1') break;
    for (const link of (pages[pageId].links || [])) allLinks.push(link.title);
    if (data.continue?.plcontinue) plcontinue = data.continue.plcontinue;
    else break;
  }
  return allLinks;
}

async function fetchBacklinks(title, signal) {
  const allLinks = [];
  let blcontinue = null;
  for (let batch = 0; batch < 2; batch++) {
    const params = {
      action: 'query', list: 'backlinks', bltitle: title,
      bllimit: '500', blnamespace: '0', blfilterredir: 'nonredirects', format: 'json'
    };
    if (blcontinue) params.blcontinue = blcontinue;
    const res = await fetch(buildApiUrl(params), { signal });
    const data = await res.json();
    for (const bl of (data.query?.backlinks || [])) allLinks.push(bl.title);
    if (data.continue?.blcontinue) blcontinue = data.continue.blcontinue;
    else break;
  }
  return allLinks;
}

// Fetch links for multiple titles in parallel (batch of up to N concurrent)
async function fetchLinksParallel(titles, signal, concurrency) {
  const results = new Map();
  let index = 0;
  async function worker() {
    while (index < titles.length) {
      if (signal.aborted) return;
      const currentIndex = index++;
      const title = titles[currentIndex];
      try {
        const links = await fetchLinks(title, signal);
        results.set(title, links);
      } catch (err) {
        if (err.name === 'AbortError' || signal.aborted) return;
        results.set(title, []);
      }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, titles.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

async function fetchBacklinksParallel(titles, signal, concurrency) {
  const results = new Map();
  let index = 0;
  async function worker() {
    while (index < titles.length) {
      if (signal.aborted) return;
      const currentIndex = index++;
      const title = titles[currentIndex];
      try {
        const links = await fetchBacklinks(title, signal);
        results.set(title, links);
      } catch (err) {
        if (err.name === 'AbortError' || signal.aborted) return;
        results.set(title, []);
      }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, titles.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function navigateIframe(title) {
  return new Promise((resolve) => {
    programmaticNavigation = true;
    const targetUrl = 'https://en.m.wikipedia.org/wiki/' + encodeURIComponent(title);
    function onLoad() {
      wikiFrame.removeEventListener('load', onLoad);
      programmaticNavigation = false;
      lastUserTitle = title;
      setTimeout(resolve, 80);
    }
    wikiFrame.addEventListener('load', onLoad);
    wikiFrame.src = targetUrl;
    setTimeout(() => {
      wikiFrame.removeEventListener('load', onLoad);
      programmaticNavigation = false;
      lastUserTitle = title;
      resolve();
    }, 2500);
  });
}

function setupAutocomplete(input, suggestionsEl) {
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const results = await fetchSuggestions(input.value);
      suggestionsEl.innerHTML = '';
      if (results.length > 0) {
        suggestionsEl.classList.add('active');
        for (const r of results) {
          const li = document.createElement('li');
          li.textContent = r;
          li.addEventListener('click', () => {
            input.value = r;
            suggestionsEl.classList.remove('active');
            programmaticNavigation = true;
            wikiFrame.src = 'https://en.m.wikipedia.org/wiki/' + encodeURIComponent(r);
            lastUserTitle = r;
            setTimeout(() => { programmaticNavigation = false; }, 1000);
          });
          suggestionsEl.appendChild(li);
        }
      } else suggestionsEl.classList.remove('active');
    }, 250);
  });
  input.addEventListener('blur', () => setTimeout(() => suggestionsEl.classList.remove('active'), 200));
  input.addEventListener('focus', () => { if (suggestionsEl.children.length > 0) suggestionsEl.classList.add('active'); });
}
setupAutocomplete(startPageInput, startSuggestions);
setupAutocomplete(endPageInput, endSuggestions);

// ── Bidirectional BFS — parallel fetches ──
async function findShortestPath(startTitle, targetTitle) {
  abortController = new AbortController();
  const signal = abortController.signal;
  foundPath = null;
  searchRunning = true;
  endTitle = targetTitle;

  sidebar.classList.remove('hidden');
  pathResult.classList.add('hidden');
  replayStatus.classList.add('hidden');
  youStatus.classList.remove('hidden');
  youInfo.textContent = 'browsing...';
  fwdInfo.textContent = 'starting';
  fwdInfo.className = 'dir-info active';
  bwdInfo.textContent = 'starting';
  bwdInfo.className = 'dir-info active';
  statsText.textContent = '';

  // Navigate iframe to START page
  programmaticNavigation = true;
  wikiFrame.src = 'https://en.m.wikipedia.org/wiki/' + encodeURIComponent(startTitle);
  lastUserTitle = startTitle;
  setTimeout(() => { programmaticNavigation = false; }, 1500);

  if (startTitle === targetTitle) {
    foundPath = [startTitle];
    displayPath(foundPath);
    searchRunning = false;
    return foundPath;
  }

  backwardNext = new Map();
  backwardNext.set(targetTitle, null);
  let backwardFrontier = [targetTitle];
  let backwardDepth = 0;
  let backwardScanned = 0;

  forwardParent = new Map();
  forwardParent.set(startTitle, null);
  let forwardFrontier = [startTitle];
  let forwardDepth = 0;
  let forwardScanned = 0;
  let pathFound = false;
  const PARALLEL = 4;

  function updateStats() {
    statsText.textContent = (forwardScanned + backwardScanned) + ' scanned  (fwd ' + forwardScanned + ' / bwd ' + backwardScanned + ')';
  }

  function tryConnect(linkTitle, parentTitle) {
    // Check if linkTitle hits the backward set
    if (backwardNext.has(linkTitle)) {
      forwardParent.set(linkTitle, parentTitle);
      let walker = linkTitle;
      while (backwardNext.get(walker) !== null) {
        const nextHop = backwardNext.get(walker);
        forwardParent.set(nextHop, walker);
        walker = nextHop;
      }
      pathFound = true;
      return true;
    }
    return false;
  }

  // Backward — full speed, parallel fetches
  async function expandBackward() {
    while (backwardFrontier.length > 0 && !pathFound && !signal.aborted) {
      backwardDepth++;
      bwdInfo.textContent = 'd' + backwardDepth + '  (' + backwardFrontier.length + ' pages)';
      updateStats();

      const batchResults = await fetchBacklinksParallel(backwardFrontier, signal, PARALLEL);
      const nextLevel = [];

      for (const [current, backlinks] of batchResults) {
        if (pathFound || signal.aborted) return;
        backwardScanned++;
        for (const blTitle of backlinks) {
          if (pathFound) return;
          if (!backwardNext.has(blTitle)) {
            backwardNext.set(blTitle, current);
            nextLevel.push(blTitle);
          }
        }
      }
      backwardFrontier = nextLevel;
      updateStats();
      if (backwardDepth >= 4) break;
    }
    bwdInfo.textContent = 'done (' + backwardScanned + ' pages, ' + backwardNext.size + ' known)';
    bwdInfo.className = 'dir-info done';
    updateStats();
  }

  // Forward — full speed, parallel fetches
  async function expandForward() {
    while (forwardFrontier.length > 0 && !pathFound && !signal.aborted) {
      forwardDepth++;
      fwdInfo.textContent = 'd' + forwardDepth + '  (' + forwardFrontier.length + ' pages)';
      updateStats();

      const batchResults = await fetchLinksParallel(forwardFrontier, signal, PARALLEL);
      const nextLevel = [];

      for (const [current, links] of batchResults) {
        if (pathFound || signal.aborted) return;
        forwardScanned++;

        // Direct hit
        if (links.includes(targetTitle)) {
          forwardParent.set(targetTitle, current);
          pathFound = true;
          return;
        }

        // Check backward lookup
        for (const linkTitle of links) {
          if (pathFound) return;
          if (backwardNext.has(linkTitle)) {
            if (tryConnect(linkTitle, current)) return;
          }
        }

        // Queue unseen links
        for (const linkTitle of links) {
          if (!forwardParent.has(linkTitle)) {
            forwardParent.set(linkTitle, current);
            nextLevel.push(linkTitle);
          }
        }
      }
      forwardFrontier = nextLevel;
      updateStats();
      if (forwardDepth > 5) break;
    }
  }

  await Promise.all([expandForward(), expandBackward()]);

  searchRunning = false;

  if (pathFound) {
    const path = [];
    let trace = targetTitle;
    while (trace !== null) {
      path.unshift(trace);
      trace = forwardParent.get(trace) ?? null;
    }

    foundPath = path;
    fwdInfo.textContent = 'done';
    fwdInfo.className = 'dir-info done';
    bwdInfo.textContent = 'done (' + backwardScanned + ' pages)';
    bwdInfo.className = 'dir-info done';
    statsText.textContent = (forwardScanned + backwardScanned) + ' scanned · ' + (path.length - 1) + ' steps';
    youStatus.classList.add('hidden');

    displayPath(path);

    replayStatus.classList.remove('hidden');
    for (let i = 0; i < path.length; i++) {
      highlightPathStep(i);
      await navigateIframe(path[i]);
    }
    replayStatus.classList.add('hidden');
    return path;
  }

  fwdInfo.textContent = 'exhausted';
  bwdInfo.textContent = 'exhausted';
  youStatus.classList.add('hidden');
  pathResult.classList.remove('hidden');
  pathHeader.textContent = 'No path found within search depth';
  pathSteps.innerHTML = '<div style="color:#999;font-size:0.8rem;padding:8px 0">Try more closely related articles.</div>';
  return null;
}

function highlightPathStep(activeIndex) {
  const nodes = pathSteps.querySelectorAll('.path-node');
  nodes.forEach((node, i) => node.classList.toggle('current', i === activeIndex));
}

function displayPath(path) {
  pathResult.classList.remove('hidden');
  pathHeader.textContent = 'Shortest Path · ' + (path.length - 1) + ' steps';
  pathSteps.innerHTML = '';
  path.forEach((title, index) => {
    const node = document.createElement('div');
    node.classList.add('path-node');
    node.style.animationDelay = (index * 0.08) + 's';
    node.addEventListener('click', () => {
      wikiFrame.src = 'https://en.m.wikipedia.org/wiki/' + encodeURIComponent(title);
    });
    const num = document.createElement('span');
    num.classList.add('path-number');
    if (index === 0) num.classList.add('start');
    else if (index === path.length - 1) num.classList.add('end');
    num.textContent = index + 1;
    const name = document.createElement('span');
    name.classList.add('path-node-title');
    name.textContent = title;
    node.appendChild(num);
    node.appendChild(name);
    pathSteps.appendChild(node);
    if (index < path.length - 1) {
      const connector = document.createElement('div');
      connector.classList.add('path-connector');
      pathSteps.appendChild(connector);
    }
  });
}

findPathBtn.addEventListener('click', async () => {
  const startTitle = startPageInput.value.trim();
  const targetTitle = endPageInput.value.trim();
  if (!startTitle || !targetTitle) { alert('Enter both articles.'); return; }
  findPathBtn.disabled = true;
  stopBtn.classList.remove('hidden');
  try { await findShortestPath(startTitle, targetTitle); }
  catch (err) {
    fwdInfo.textContent = err.message === 'Aborted' ? 'stopped' : 'error';
    bwdInfo.textContent = err.message === 'Aborted' ? 'stopped' : 'error';
    searchRunning = false;
  }
  findPathBtn.disabled = false;
  stopBtn.classList.add('hidden');
});

stopBtn.addEventListener('click', () => {
  if (abortController) { abortController.abort(); abortController = null; }
  searchRunning = false;
});

startPageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    programmaticNavigation = true;
    wikiFrame.src = 'https://en.m.wikipedia.org/wiki/' + encodeURIComponent(startPageInput.value.trim());
    lastUserTitle = startPageInput.value.trim();
    setTimeout(() => { programmaticNavigation = false; }, 1000);
  }
});
endPageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') findPathBtn.click();
});
