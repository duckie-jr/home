(function () {
  var startPageInput = document.getElementById('startPage');
  var endPageInput = document.getElementById('endPage');
  var startSuggestions = document.getElementById('startSuggestions');
  var endSuggestions = document.getElementById('endSuggestions');
  var findPathBtn = document.getElementById('findPathBtn');
  var stopBtn = document.getElementById('stopBtn');
  var fullscreenBtn = document.getElementById('fullscreenBtn');
  var wikiView = document.getElementById('wiki-view');
  var wikiTitleBar = document.getElementById('wiki-title-bar');
  var wikiContent = document.getElementById('wiki-content');
  var sidebar = document.getElementById('sidebar');
  var fwdInfo = document.getElementById('fwdInfo');
  var bwdInfo = document.getElementById('bwdInfo');
  var statsText = document.getElementById('statsText');
  var youStatus = document.getElementById('you-status');
  var youInfo = document.getElementById('youInfo');
  var youPath = document.getElementById('youPath');
  var pathResult = document.getElementById('path-result');
  var pathHeader = document.getElementById('path-header');
  var pathSteps = document.getElementById('pathSteps');
  var replayStatus = document.getElementById('replay-status');

  var abortController = null;
  var foundPath = null;
  var searchRunning = false;
  var forwardParent = null;
  var backwardNext = null;
  var targetTitle = null;
  var currentPageTitle = null;
  var userSteps = [];

  var WIKI_API = 'https://en.wikipedia.org/w/api.php';
  var PARALLEL = 6;
  var MAX_FRONTIER = 80;

  var linkCache = {};
  var backlinkCache = {};
  var categoryCache = {};

  function buildApiUrl(params) {
    var url = WIKI_API + '?origin=*';
    for (var key in params) url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    return url;
  }

  // ── Fullscreen ──
  fullscreenBtn.addEventListener('click', function () {
    wikiView.classList.toggle('fullscreen');
    fullscreenBtn.textContent = wikiView.classList.contains('fullscreen') ? '✕' : '⛶';
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && wikiView.classList.contains('fullscreen')) {
      wikiView.classList.remove('fullscreen');
      fullscreenBtn.textContent = '⛶';
    }
  });

  // ── Wiki page renderer ──
  function loadWikiPage(title) {
    wikiTitleBar.textContent = 'Loading: ' + title + '...';
    wikiContent.style.opacity = '0.4';

    var url = buildApiUrl({
      action: 'parse', page: title, format: 'json',
      prop: 'text|displaytitle', disableeditsection: 'true', redirects: 'true'
    });

    return fetch(url).then(function (res) { return res.json(); }).then(function (data) {
      if (!data.parse) {
        wikiTitleBar.textContent = 'Page not found: ' + title;
        wikiContent.innerHTML = '<p style="padding:20px;color:#888">Article not found.</p>';
        wikiContent.style.opacity = '1';
        return null;
      }

      var html = data.parse.text['*'];
      var displayTitle = data.parse.displaytitle;
      var resolvedTitle = data.parse.title;
      currentPageTitle = resolvedTitle;

      wikiTitleBar.textContent = resolvedTitle;
      wikiContent.innerHTML = html;
      wikiContent.scrollTop = 0;
      wikiContent.style.opacity = '1';

      // Intercept all internal wiki links
      var allLinks = wikiContent.querySelectorAll('a');
      for (var i = 0; i < allLinks.length; i++) {
        wireUpLink(allLinks[i]);
      }

      return resolvedTitle;
    }).catch(function () {
      wikiTitleBar.textContent = 'Error loading: ' + title;
      wikiContent.style.opacity = '1';
      return null;
    });
  }

  function wireUpLink(linkElement) {
    var href = linkElement.getAttribute('href');
    if (!href) return;

    // Internal wiki link
    if (href.indexOf('/wiki/') === 0) {
      var rawTitle = href.replace('/wiki/', '').split('#')[0].split('?')[0];
      rawTitle = decodeURIComponent(rawTitle.replace(/_/g, ' '));

      // Skip special, file, category pages
      if (/^(Special|File|Category|Template|Help|Talk|User|Wikipedia|Portal|Draft|Module):/i.test(rawTitle)) return;

      linkElement.classList.add('wiki-link-tracked');
      linkElement.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        onUserClickedLink(rawTitle);
      });
    }
    // External links open in new tab
    else if (href.indexOf('http') === 0) {
      linkElement.setAttribute('target', '_blank');
      linkElement.setAttribute('rel', 'noopener');
    }
    // Hash links
    else if (href.indexOf('#') === 0) {
      linkElement.addEventListener('click', function (e) {
        e.preventDefault();
        var targetId = href.slice(1);
        var targetEl = document.getElementById(targetId) || wikiContent.querySelector('[id="' + CSS.escape(targetId) + '"]');
        if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth' });
      });
    }
    // Disable other relative links
    else {
      linkElement.addEventListener('click', function (e) { e.preventDefault(); });
    }
  }

  // ── User clicked a wiki link ──
  function onUserClickedLink(title) {
    var previousPage = currentPageTitle;
    userSteps.push(title);

    // Show in sidebar
    if (youStatus.classList.contains('hidden')) youStatus.classList.remove('hidden');
    youInfo.textContent = title + ' (' + userSteps.length + ' clicks)';
    var stepSpan = document.createElement('span');
    stepSpan.className = 'you-step';
    stepSpan.textContent = title.length > 25 ? title.slice(0, 23) + '..' : title;
    stepSpan.addEventListener('click', function () { loadWikiPage(title); });
    youPath.appendChild(stepSpan);

    // Feed into forward search
    if (searchRunning && forwardParent && previousPage) {
      if (!forwardParent.has(title)) {
        forwardParent.set(title, previousPage);
      }

      // Check if this connects to backward set
      if (backwardNext && backwardNext.has(title)) {
        // User found a shortcut!
        youInfo.textContent = '🎯 YOU connected to target via ' + title + '!';
        // Wire up the backward chain
        var walker = title;
        while (backwardNext.get(walker) !== null) {
          var nextHop = backwardNext.get(walker);
          if (!forwardParent.has(nextHop)) {
            forwardParent.set(nextHop, walker);
          }
          walker = nextHop;
        }
      }

      // Direct hit
      if (title === targetTitle) {
        youInfo.textContent = '🎯 YOU reached the target!';
      }
    }

    // Navigate
    loadWikiPage(title);
  }

  // ── API fetches with caching ──
  function fetchSuggestions(query) {
    if (!query || query.length < 2) return Promise.resolve([]);
    var url = buildApiUrl({ action: 'opensearch', search: query, limit: '6', namespace: '0', format: 'json' });
    return fetch(url).then(function (r) { return r.json(); }).then(function (d) { return d[1] || []; }).catch(function () { return []; });
  }

  function fetchLinksCached(title, signal) {
    if (linkCache[title]) return Promise.resolve(linkCache[title]);
    var allLinks = [];
    return fetchLinksPage(title, null, allLinks, 0, signal).then(function () {
      linkCache[title] = allLinks;
      return allLinks;
    });
  }

  function fetchLinksPage(title, plcontinue, allLinks, batch, signal) {
    if (batch >= 2) return Promise.resolve();
    var params = { action: 'query', titles: title, prop: 'links', pllimit: '500', plnamespace: '0', format: 'json' };
    if (plcontinue) params.plcontinue = plcontinue;
    return fetch(buildApiUrl(params), { signal: signal }).then(function (r) { return r.json(); }).then(function (data) {
      var pages = data.query && data.query.pages;
      if (!pages) return;
      var pageId = Object.keys(pages)[0];
      if (pageId === '-1') return;
      var links = pages[pageId].links || [];
      for (var i = 0; i < links.length; i++) allLinks.push(links[i].title);
      if (data.continue && data.continue.plcontinue) {
        return fetchLinksPage(title, data.continue.plcontinue, allLinks, batch + 1, signal);
      }
    });
  }

  function fetchBacklinksCached(title, signal) {
    if (backlinkCache[title]) return Promise.resolve(backlinkCache[title]);
    var allLinks = [];
    return fetchBacklinksPage(title, null, allLinks, 0, signal).then(function () {
      backlinkCache[title] = allLinks;
      return allLinks;
    });
  }

  function fetchBacklinksPage(title, blcontinue, allLinks, batch, signal) {
    if (batch >= 2) return Promise.resolve();
    var params = { action: 'query', list: 'backlinks', bltitle: title, bllimit: '500', blnamespace: '0', blfilterredir: 'nonredirects', format: 'json' };
    if (blcontinue) params.blcontinue = blcontinue;
    return fetch(buildApiUrl(params), { signal: signal }).then(function (r) { return r.json(); }).then(function (data) {
      var bls = (data.query && data.query.backlinks) || [];
      for (var i = 0; i < bls.length; i++) allLinks.push(bls[i].title);
      if (data.continue && data.continue.blcontinue) {
        return fetchBacklinksPage(title, data.continue.blcontinue, allLinks, batch + 1, signal);
      }
    });
  }

  function fetchCategories(title, signal) {
    if (categoryCache[title]) return Promise.resolve(categoryCache[title]);
    var params = { action: 'query', titles: title, prop: 'categories', cllimit: '40', clshow: '!hidden', format: 'json' };
    return fetch(buildApiUrl(params), { signal: signal }).then(function (r) { return r.json(); }).then(function (data) {
      var pages = data.query && data.query.pages;
      if (!pages) return [];
      var pageId = Object.keys(pages)[0];
      var cats = (pages[pageId].categories || []).map(function (c) { return c.title.replace('Category:', '').toLowerCase(); });
      categoryCache[title] = cats;
      return cats;
    }).catch(function () { return []; });
  }

  // ── Parallel fetcher ──
  function parallelFetch(titles, fetchFn, signal, pathFoundRef) {
    var results = new Map();
    var index = 0;
    function worker() {
      if (index >= titles.length || pathFoundRef.found || (signal && signal.aborted)) return Promise.resolve();
      var currentIndex = index++;
      if (currentIndex >= titles.length) return Promise.resolve();
      var title = titles[currentIndex];
      return fetchFn(title, signal).then(function (links) {
        results.set(title, links || []);
      }).catch(function () {
        results.set(title, []);
      }).then(function () {
        return worker();
      });
    }
    var workers = [];
    for (var i = 0; i < Math.min(PARALLEL, titles.length); i++) workers.push(worker());
    return Promise.all(workers).then(function () { return results; });
  }

  // ── Scoring ──
  function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(function (w) { return w.length > 2; });
  }

  function buildScorer(tTitle, tCategories) {
    var targetWords = {};
    tokenize(tTitle).forEach(function (w) { targetWords[w] = true; });
    var catWords = {};
    (tCategories || []).forEach(function (cat) { tokenize(cat).forEach(function (w) { catWords[w] = true; }); });
    return function (title) {
      var words = tokenize(title);
      var score = 0;
      for (var i = 0; i < words.length; i++) {
        if (targetWords[words[i]]) score += 10;
        if (catWords[words[i]]) score += 3;
      }
      return score;
    };
  }

  // ── Autocomplete ──
  function setupAutocomplete(input, suggestionsEl) {
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        fetchSuggestions(input.value).then(function (results) {
          suggestionsEl.innerHTML = '';
          if (results.length > 0) {
            suggestionsEl.classList.add('active');
            results.forEach(function (r) {
              var li = document.createElement('li');
              li.textContent = r;
              li.addEventListener('click', function () {
                input.value = r;
                suggestionsEl.classList.remove('active');
                loadWikiPage(r);
              });
              suggestionsEl.appendChild(li);
            });
          } else suggestionsEl.classList.remove('active');
        });
      }, 250);
    });
    input.addEventListener('blur', function () { setTimeout(function () { suggestionsEl.classList.remove('active'); }, 200); });
    input.addEventListener('focus', function () { if (suggestionsEl.children.length > 0) suggestionsEl.classList.add('active'); });
  }
  setupAutocomplete(startPageInput, startSuggestions);
  setupAutocomplete(endPageInput, endSuggestions);

  // ── Bidirectional BFS ──
  function findShortestPath(startTitle, endTitleArg) {
    abortController = new AbortController();
    var signal = abortController.signal;
    foundPath = null;
    searchRunning = true;
    targetTitle = endTitleArg;
    userSteps = [];
    youPath.innerHTML = '';

    sidebar.classList.remove('hidden');
    pathResult.classList.add('hidden');
    replayStatus.classList.add('hidden');
    youStatus.classList.remove('hidden');
    youInfo.textContent = 'browse to help!';
    fwdInfo.textContent = 'loading...';
    fwdInfo.className = 'dir-info active';
    bwdInfo.textContent = 'loading...';
    bwdInfo.className = 'dir-info active';
    statsText.textContent = '';

    // Navigate to start page
    return loadWikiPage(startTitle).then(function () {
      if (startTitle === endTitleArg) {
        foundPath = [startTitle];
        displayPath(foundPath);
        searchRunning = false;
        return foundPath;
      }

      return Promise.all([
        fetchCategories(startTitle, signal),
        fetchCategories(endTitleArg, signal)
      ]).then(function (catResults) {
        var scoreTitle = buildScorer(endTitleArg, catResults[1]);

        backwardNext = new Map();
        backwardNext.set(endTitleArg, null);
        var backwardFrontier = [endTitleArg];
        var backwardDepth = 0;
        var backwardScanned = 0;

        forwardParent = new Map();
        forwardParent.set(startTitle, null);
        var forwardFrontier = [startTitle];
        var forwardDepth = 0;
        var forwardScanned = 0;
        var pathFoundRef = { found: false };

        function updateStats() {
          statsText.textContent = (forwardScanned + backwardScanned) + ' scanned (fwd ' + forwardScanned + ' / bwd ' + backwardScanned + ')';
        }

        function tryConnect(linkTitle, parentTitle) {
          if (backwardNext.has(linkTitle)) {
            forwardParent.set(linkTitle, parentTitle);
            var walker = linkTitle;
            while (backwardNext.get(walker) !== null) {
              var nextHop = backwardNext.get(walker);
              forwardParent.set(nextHop, walker);
              walker = nextHop;
            }
            pathFoundRef.found = true;
            return true;
          }
          return false;
        }

        function expandBackward() {
          if (backwardFrontier.length === 0 || pathFoundRef.found || signal.aborted) {
            bwdInfo.textContent = 'done (' + backwardScanned + ' pgs, ' + backwardNext.size + ' known)';
            bwdInfo.className = 'dir-info done';
            return Promise.resolve();
          }
          if (backwardDepth >= 4) {
            bwdInfo.textContent = 'done d4 (' + backwardNext.size + ' known)';
            bwdInfo.className = 'dir-info done';
            return Promise.resolve();
          }
          backwardDepth++;
          bwdInfo.textContent = 'd' + backwardDepth + ' (' + backwardFrontier.length + ' pages)';
          updateStats();

          return parallelFetch(backwardFrontier, fetchBacklinksCached, signal, pathFoundRef).then(function (batchResults) {
            var nextLevel = [];
            batchResults.forEach(function (backlinks, current) {
              if (pathFoundRef.found || signal.aborted) return;
              backwardScanned++;
              for (var i = 0; i < backlinks.length; i++) {
                if (pathFoundRef.found) return;
                var blTitle = backlinks[i];
                if (!backwardNext.has(blTitle)) {
                  backwardNext.set(blTitle, current);
                  nextLevel.push(blTitle);
                }
              }
            });
            backwardFrontier = nextLevel;
            updateStats();
            return expandBackward();
          });
        }

        function expandForward() {
          if (forwardFrontier.length === 0 || pathFoundRef.found || signal.aborted) return Promise.resolve();
          if (forwardDepth > 5) return Promise.resolve();
          forwardDepth++;
          fwdInfo.textContent = 'd' + forwardDepth + ' (' + forwardFrontier.length + ' pages)';
          updateStats();

          return parallelFetch(forwardFrontier, fetchLinksCached, signal, pathFoundRef).then(function (batchResults) {
            var nextLevel = [];
            batchResults.forEach(function (links, current) {
              if (pathFoundRef.found || signal.aborted) return;
              forwardScanned++;

              // Direct hit
              if (links.indexOf(endTitleArg) !== -1) {
                forwardParent.set(endTitleArg, current);
                pathFoundRef.found = true;
                return;
              }

              // Check backward set
              for (var i = 0; i < links.length; i++) {
                if (pathFoundRef.found) return;
                if (backwardNext.has(links[i])) {
                  if (tryConnect(links[i], current)) return;
                }
              }

              // Queue unseen
              for (var j = 0; j < links.length; j++) {
                if (!forwardParent.has(links[j])) {
                  forwardParent.set(links[j], current);
                  nextLevel.push(links[j]);
                }
              }
            });

            // Smart prune
            if (nextLevel.length > MAX_FRONTIER) {
              var scored = nextLevel.map(function (t) { return { t: t, s: scoreTitle(t) }; });
              scored.sort(function (a, b) { return b.s - a.s; });
              forwardFrontier = scored.slice(0, MAX_FRONTIER).map(function (e) { return e.t; });
              fwdInfo.textContent = 'd' + forwardDepth + ' pruned ' + nextLevel.length + '→' + forwardFrontier.length;
            } else {
              forwardFrontier = nextLevel;
            }
            updateStats();
            return expandForward();
          });
        }

        return Promise.all([expandForward(), expandBackward()]).then(function () {
          searchRunning = false;

          if (pathFoundRef.found) {
            var path = [];
            var trace = endTitleArg;
            while (trace !== null && trace !== undefined) {
              path.unshift(trace);
              trace = forwardParent.get(trace);
              if (trace === undefined) trace = null;
            }

            foundPath = path;
            fwdInfo.textContent = 'done';
            fwdInfo.className = 'dir-info done';
            bwdInfo.textContent = 'done (' + backwardScanned + ' pgs)';
            bwdInfo.className = 'dir-info done';
            statsText.textContent = (forwardScanned + backwardScanned) + ' scanned · ' + (path.length - 1) + ' steps';

            displayPath(path);
            return replayPath(path);
          }

          fwdInfo.textContent = 'exhausted';
          bwdInfo.textContent = 'exhausted';
          pathResult.classList.remove('hidden');
          pathHeader.textContent = 'No path found within search depth';
          pathSteps.innerHTML = '<div style="color:#888;font-size:0.8rem;padding:8px">Try more closely related articles.</div>';
          return null;
        });
      });
    });
  }

  function replayPath(path) {
    replayStatus.classList.remove('hidden');
    var i = 0;
    function next() {
      if (i >= path.length) {
        replayStatus.classList.add('hidden');
        return Promise.resolve();
      }
      highlightPathStep(i);
      var title = path[i];
      i++;
      return loadWikiPage(title).then(function () {
        return new Promise(function (r) { setTimeout(r, 300); });
      }).then(next);
    }
    return next();
  }

  function highlightPathStep(activeIndex) {
    var nodes = pathSteps.querySelectorAll('.path-node');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('current', i === activeIndex);
    }
  }

  function displayPath(path) {
    pathResult.classList.remove('hidden');
    pathHeader.textContent = 'Shortest Path · ' + (path.length - 1) + ' steps';
    pathSteps.innerHTML = '';
    path.forEach(function (title, index) {
      var node = document.createElement('div');
      node.className = 'path-node';
      node.style.animationDelay = (index * 0.08) + 's';
      node.addEventListener('click', function () { loadWikiPage(title); });

      var num = document.createElement('span');
      num.className = 'path-number';
      if (index === 0) num.classList.add('start');
      else if (index === path.length - 1) num.classList.add('end');
      num.textContent = index + 1;

      var name = document.createElement('span');
      name.className = 'path-node-title';
      name.textContent = title;

      node.appendChild(num);
      node.appendChild(name);
      pathSteps.appendChild(node);

      if (index < path.length - 1) {
        var connector = document.createElement('div');
        connector.className = 'path-connector';
        pathSteps.appendChild(connector);
      }
    });
  }

  // ── Event handlers ──
  findPathBtn.addEventListener('click', function () {
    var startTitle = startPageInput.value.trim();
    var endTitleVal = endPageInput.value.trim();
    if (!startTitle || !endTitleVal) { alert('Enter both articles.'); return; }
    findPathBtn.disabled = true;
    stopBtn.classList.remove('hidden');
    findShortestPath(startTitle, endTitleVal).catch(function (err) {
      fwdInfo.textContent = (err && err.message === 'Aborted') ? 'stopped' : 'error';
      bwdInfo.textContent = (err && err.message === 'Aborted') ? 'stopped' : 'error';
      searchRunning = false;
    }).then(function () {
      findPathBtn.disabled = false;
      stopBtn.classList.add('hidden');
    });
  });

  stopBtn.addEventListener('click', function () {
    if (abortController) { abortController.abort(); abortController = null; }
    searchRunning = false;
  });

  startPageInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') loadWikiPage(startPageInput.value.trim());
  });
  endPageInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') findPathBtn.click();
  });
})();
