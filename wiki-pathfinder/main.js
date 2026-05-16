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
let forwardParent = null;
let backwardNext = null;
let endTitle = null;

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const PARALLEL = 6;
const MAX_FRONTIER = 80; // prune frontier to top-scored pages

// ── Link & category cache ──
const linkCache = new Map();
const backlinkCache = new Map();
const categoryCache = new Map();

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
let lastUserTitle = null;
let programmaticNavigation = false;

wikiFrame.addEventListener('load', () => {
  if (programmaticNavigation) return;
  if (searchRunning && lastUserTitle) detectUserNavigation();
});

async function detectUserNavigation() {
  if (!lastUserTitle || !backwardNext || !forwardParent) return;
  try {
    const links = await fetchLinksCached(lastUserTitle, abortController?.signal);
    for (const linkTitle of links) {
      if (backwardNext.has(linkTitle) && !forwardParent.has(linkTitle)) {
        forwardParent.set(linkTitle, lastUserTitle);
        youInfo.textContent = 'shortcut via ' + linkTitle;
      }
    }
  } catch {}
}

// ── API fetches with caching ──
async function fetchSuggestions(query) {
  if (!query || query.length < 2) return [];
  try {
    const res = await fetch(buildApiUrl({ action: 'opensearch', search: query, limit: '6', namespace: '0', format: 'json' }));
    return (await res.json())[1] || [];
  } catch { return []; }
}

async function fetchLinksCached(title, signal) {
  if (linkCache.has(title)) return linkCache.get(title);
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
  linkCache.set(title, allLinks);
  return allLinks;
}

async function fetchBacklinksCached(title, signal) {
  if (backlinkCache.has(title)) return backlinkCache.get(title);
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
  backlinkCache.set(title, allLinks);
  return allLinks;
}

async function fetchCategories(title, signal) {
  if (categoryCache.has(title)) return categoryCache.get(title);
  try {
    const params = {
      action: 'query', titles: title, prop: 'categories',
      cllimit: '40', clshow: '!hidden', format: 'json'
    };
    const res = await fetch(buildApiUrl(params), { signal });
    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) return [];
    const pageId = Object.keys(pages)[0];
    const cats = (pages[pageId].categories || []).map(c => c.title.replace('Category:', '').toLowerCase());
    categoryCache.set(title, cats);
    return cats;
  } catch { return []; }
}

// ── Parallel fetchers with early exit ──
async function fetchLinksParallel(titles, signal, pathFoundRef) {
  const results = new Map();
  let index = 0;
  async function worker() {
    while (index < titles.length && !pathFoundRef.found && !signal.aborted) {
      const currentIndex = index++;
      if (currentIndex >= titles.length) return;
      const title = titles[currentIndex];
      try {
        results.set(title, await fetchLinksCached(title, signal));
      } catch (err) {
        if (err.name === 'AbortError' || signal.aborted) return;
        results.set(title, []);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, titles.length) }, () => worker()));
  return results;
}

async function fetchBacklinksParallel(titles, signal, pathFoundRef) {
  const results = new Map();
  let index = 0;
  async function worker() {
    while (index < titles.length && !pathFoundRef.found && !signal.aborted) {
      const currentIndex = index++;
      if (currentIndex >= titles.length) return;
      const title = titles[currentIndex];
      try {
        results.set(title, await fetchBacklinksCached(title, signal));
      } catch (err) {
        if (err.name === 'AbortError' || signal.aborted) return;
        results.set(title, []);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, titles.length) }, () => worker()));
  return results;
}

// ── Scoring: how promising is a title for reaching the target? ──
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
}

function buildScorer(targetTitle, targetCategories) {
  const targetWords = new Set(tokenize(targetTitle));
  const targetCatWords = new Set();
  for (const cat of targetCategories) {
    for (const word of tokenize(cat)) targetCatWords.add(word);
  }

  return function scoreTitle(title) {
    const words = tokenize(title);
    let score = 0;
    for (const word of words) {
      if (targetWords.has(word)) score += 10;  // shares word with target title
      if (targetCatWords.has(word)) score += 3; // shares word with target categories
    }
    return score;
  };
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

// ── Bidirectional BFS — smart ──
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
  fwdInfo.textContent = 'loading categories...';
  fwdInfo.className = 'dir-info active';
  bwdInfo.textContent = 'loading categories...';
  bwdInfo.className = 'dir-info active';
  statsText.textContent = '';

  // Navigate iframe to START
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

  // Fetch categories for both endpoints to build a scorer
  const [startCategories, targetCategories] = await Promise.all([
    fetchCategories(startTitle, signal),
    fetchCategories(targetTitle, signal)
  ]);
  const scoreTitle = buildScorer(targetTitle, targetCategories);

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
  const pathFoundRef = { found: false };

  function updateStats() {
    statsText.textContent = (forwardScanned + backwardScanned) + ' scanned  (fwd ' + forwardScanned + ' / bwd ' + backwardScanned + ')';
  }

  function tryConnect(linkTitle, parentTitle) {
    if (backwardNext.has(linkTitle)) {
      forwardParent.set(linkTitle, parentTitle);
      let walker = linkTitle;
      while (backwardNext.get(walker) !== null) {
        const nextHop = backwardNext.get(walker);
        forwardParent.set(nextHop, walker);
        walker = nextHop;
      }
      pathFoundRef.found = true;
      return true;
    }
    return false;
  }

  // Backward — full speed, parallel, no scoring needed
  async function expandBackward() {
    while (backwardFrontier.length > 0 && !pathFoundRef.found && !signal.aborted) {
      backwardDepth++;
      bwdInfo.textContent = 'd' + backwardDepth + '  (' + backwardFrontier.length + ' pages)';
      updateStats();

      const batchResults = await fetchBacklinksParallel(backwardFrontier, signal, pathFoundRef);
      const nextLevel = [];

      for (const [current, backlinks] of batchResults) {
        if (pathFoundRef.found || signal.aborted) return;
        backwardScanned++;
        for (const blTitle of backlinks) {
          if (pathFoundRef.found) return;
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
    bwdInfo.textContent = 'done (' + backwardScanned + ' pgs, ' + backwardNext.size + ' known)';
    bwdInfo.className = 'dir-info done';
    updateStats();
  }

  // Forward — parallel, scored frontier, pruned
  async function expandForward() {
    while (forwardFrontier.length > 0 && !pathFoundRef.found && !signal.aborted) {
      forwardDepth++;
      fwdInfo.textContent = 'd' + forwardDepth + '  (' + forwardFrontier.length + ' pages)';
      updateStats();

      const batchResults = await fetchLinksParallel(forwardFrontier, signal, pathFoundRef);
      const nextLevel = [];

      for (const [current, links] of batchResults) {
        if (pathFoundRef.found || signal.aborted) return;
        forwardScanned++;

        // Direct hit
        if (links.includes(targetTitle)) {
          forwardParent.set(targetTitle, current);
          pathFoundRef.found = true;
          return;
        }

        // Check backward set first
        for (const linkTitle of links) {
          if (pathFoundRef.found) return;
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

      // ── Smart pruning: score and keep only the most promising pages ──
      if (nextLevel.length > MAX_FRONTIER) {
        const scored = nextLevel.map(title => ({ title, score: scoreTitle(title) }));
        scored.sort((a, b) => b.score - a.score);
        forwardFrontier = scored.slice(0, MAX_FRONTIER).map(entry => entry.title);
        fwdInfo.textContent = 'd' + forwardDepth + ' pruned ' + nextLevel.length + '→' + forwardFrontier.length;
      } else {
        forwardFrontier = nextLevel;
      }

      updateStats();
      if (forwardDepth > 5) break;
    }
  }

  await Promise.all([expandForward(), expandBackward()]);

  searchRunning = false;

  if (pathFoundRef.found) {
    const path = [];
    let trace = targetTitle;
    while (trace !== null) {
      path.unshift(trace);
      trace = forwardParent.get(trace) ?? null;
    }

    foundPath = path;
    fwdInfo.textContent = 'done';
    fwdInfo.className = 'dir-info done';
    bwdInfo.textContent = 'done (' + backwardScanned + ' pgs)';
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
