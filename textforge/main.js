import './style.css';

const promptInput = document.getElementById('promptInput');
const generateBtn = document.getElementById('generateBtn');
const outputBox = document.getElementById('outputBox');
const statusMsg = document.getElementById('statusMsg');
const curiosityMsg = document.getElementById('curiosityMsg');
const statArticles = document.getElementById('statArticles');
const statStates = document.getElementById('statStates');
const statQueue = document.getElementById('statQueue');

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const CRAWL_BATCH_SIZE = 2;
const CRAWL_DELAY_MS = 2000;
const LINKS_PER_ARTICLE = 15;

/* ------------------------------------------------------------------ */
/*  Safe JSON fetch — returns null if response isn't valid JSON        */
/* ------------------------------------------------------------------ */
async function safeWikiFetch(params) {
  try {
    const response = await fetch(`${WIKIPEDIA_API}?${params}`);
    if (!response.ok) return null;
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Global brain — dual-layer Markov chain (trigram + bigram fallback) */
/* ------------------------------------------------------------------ */
const globalBrain = {
  trigramChain: {},
  bigramChain: {},
  totalArticles: 0,
  visitedTitles: new Set(),
  titleQueue: [],
  isUserGenerating: false,
  crawlerRunning: false,
};

function updateStatsDisplay() {
  statArticles.textContent = globalBrain.totalArticles.toLocaleString();
  const trigramCount = Object.keys(globalBrain.trigramChain).length;
  const bigramCount = Object.keys(globalBrain.bigramChain).length;
  statStates.textContent = (trigramCount + bigramCount).toLocaleString();
  statQueue.textContent = globalBrain.titleQueue.length.toLocaleString();
}

/* ------------------------------------------------------------------ */
/*  Wikipedia helpers                                                  */
/* ------------------------------------------------------------------ */
async function fetchRandomTitles(count = 10) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'random',
    rnlimit: String(count),
    rnnamespace: '0',
    format: 'json',
    origin: '*',
  });
  const data = await safeWikiFetch(params);
  if (!data?.query?.random) return [];
  return data.query.random.map((page) => page.title);
}

async function searchRelatedTitles(topic, limit = 10) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: topic,
    srlimit: String(limit),
    format: 'json',
    origin: '*',
  });
  const data = await safeWikiFetch(params);
  if (!data?.query?.search) return [];
  return data.query.search.map((result) => result.title);
}

async function fetchArticleExtract(title) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    titles: title,
    format: 'json',
    origin: '*',
    exlimit: '1',
  });
  const data = await safeWikiFetch(params);
  if (!data?.query?.pages) return '';
  const pages = data.query.pages;
  const pageId = Object.keys(pages)[0];
  if (pageId === '-1') return '';
  return pages[pageId].extract || '';
}

async function fetchInternalLinks(title, limit = LINKS_PER_ARTICLE) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'links',
    titles: title,
    pllimit: String(limit),
    plnamespace: '0',
    format: 'json',
    origin: '*',
  });
  const data = await safeWikiFetch(params);
  if (!data?.query?.pages) return [];
  const pages = data.query.pages;
  const pageId = Object.keys(pages)[0];
  if (!pages[pageId]?.links) return [];
  return pages[pageId].links.map((link) => link.title);
}

/* ------------------------------------------------------------------ */
/*  Text cleaning — aggressively strip non-prose junk                  */
/* ------------------------------------------------------------------ */
function cleanWikiText(rawText) {
  let text = rawText;

  /* Remove everything after "References", "See also", "External links", etc. */
  text = text.replace(/\n\s*==\s*(References|See also|External links|Further reading|Notes|Bibliography|Sources|Citations)\s*==[\s\S]*/gi, '');

  /* Remove section headers */
  text = text.replace(/==+[^=]+=+/g, '. ');

  /* Remove parentheticals, brackets, braces */
  text = text.replace(/\([^)]*\)/g, '');
  text = text.replace(/\[[^\]]*\]/g, '');
  text = text.replace(/\{[^}]*\}/g, '');

  /* Remove arXiv IDs, DOIs, bibcodes, ISBNs */
  text = text.replace(/arXiv:[^\s.]+/gi, '');
  text = text.replace(/doi:\s*[^\s.]+/gi, '');
  text = text.replace(/Bibcode:\s*[^\s.]+/gi, '');
  text = text.replace(/ISBN\s*[\d\-Xx]+/gi, '');
  text = text.replace(/ISSN\s*[\d\-]+/gi, '');
  text = text.replace(/PMC\s*\d+/gi, '');
  text = text.replace(/PMID\s*\d+/gi, '');
  text = text.replace(/S2CID\s*\d+/gi, '');

  /* Remove catalog/survey references like "1ES 1927+654", "SDSS J120136.02" */
  text = text.replace(/\b[A-Z0-9]{2,}[\s\-]?[JB]?\d{4,}[+\-.][\d.]+\b/g, '');
  text = text.replace(/\bSDSS\s+J[\d.+\-]+/gi, '');

  /* Remove URLs */
  text = text.replace(/https?:\/\/[^\s]+/g, '');

  /* Remove date-style references like "17-Oct-2007" */
  text = text.replace(/\d{1,2}-[A-Z][a-z]{2}-\d{4}/g, '');

  /* Remove standalone numbers, coords, and short fragments */
  text = text.replace(/\b\d{3,}\b/g, '');
  text = text.replace(/conf\./g, '');

  /* Normalize whitespace and punctuation */
  text = text.replace(/\n+/g, ' ');
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/\.\s*\./g, '.');
  text = text.replace(/\.\s*,/g, '.');
  text = text.replace(/,\s*\./g, '.');
  text = text.trim();

  /* Split into sentences and filter out junk ones */
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const cleanSentences = sentences.filter((sentence) => {
    const trimmed = sentence.trim();
    const wordCount = trimmed.split(/\s+/).length;
    /* Keep only sentences with 5+ words */
    if (wordCount < 5) return false;
    /* Skip sentences that are mostly uppercase / look like references */
    const upperRatio = (trimmed.match(/[A-Z]/g) || []).length / trimmed.length;
    if (upperRatio > 0.4) return false;
    /* Skip sentences with too many numbers */
    const digitRatio = (trimmed.match(/\d/g) || []).length / trimmed.length;
    if (digitRatio > 0.15) return false;
    return true;
  });

  return cleanSentences.join(' ');
}

/* ------------------------------------------------------------------ */
/*  Feed text into both trigram and bigram chains                       */
/* ------------------------------------------------------------------ */
function feedChain(chain, words, stateSize) {
  for (let index = 0; index <= words.length - stateSize - 1; index++) {
    const stateKey = words.slice(index, index + stateSize).join(' ');
    const nextWord = words[index + stateSize];
    if (!chain[stateKey]) {
      chain[stateKey] = [];
    }
    chain[stateKey].push(nextWord);
  }
}

function feedBrain(text) {
  const words = text.split(' ').filter((word) => word.length > 0);
  if (words.length < 10) return;
  feedChain(globalBrain.trigramChain, words, 3);
  feedChain(globalBrain.bigramChain, words, 2);
}

/* ------------------------------------------------------------------ */
/*  Learn a single article                                             */
/* ------------------------------------------------------------------ */
async function learnArticle(title) {
  if (globalBrain.visitedTitles.has(title)) return false;
  globalBrain.visitedTitles.add(title);

  const rawText = await fetchArticleExtract(title);
  if (rawText.length < 100) return false;

  feedBrain(cleanWikiText(rawText));
  globalBrain.totalArticles++;

  const links = await fetchInternalLinks(title);
  const newLinks = links.filter((link) => !globalBrain.visitedTitles.has(link));
  globalBrain.titleQueue.push(...newLinks);

  return true;
}

/* ------------------------------------------------------------------ */
/*  Background curiosity crawler — parallel batch fetching             */
/* ------------------------------------------------------------------ */
async function startCuriosityCrawler() {
  if (globalBrain.crawlerRunning) return;
  globalBrain.crawlerRunning = true;

  curiosityMsg.textContent = 'Getting curious…';
  const seedTitles = await fetchRandomTitles(10);
  globalBrain.titleQueue.push(...seedTitles);
  updateStatsDisplay();

  while (true) {
    if (globalBrain.isUserGenerating) {
      curiosityMsg.textContent = 'Paused — helping you generate…';
      await sleep(300);
      continue;
    }

    if (globalBrain.titleQueue.length === 0) {
      curiosityMsg.textContent = 'Discovering new topics…';
      const moreTitles = await fetchRandomTitles(10);
      globalBrain.titleQueue.push(...moreTitles);
    }

    /* Grab a batch of titles to learn in parallel */
    const batch = [];
    while (batch.length < CRAWL_BATCH_SIZE && globalBrain.titleQueue.length > 0) {
      const title = globalBrain.titleQueue.shift();
      if (title && !globalBrain.visitedTitles.has(title)) {
        batch.push(title);
      }
    }

    if (batch.length === 0) continue;

    curiosityMsg.textContent = `Reading: ${batch.map((title) => `"${title}"`).join(', ')}`;

    try {
      const results = await Promise.allSettled(
        batch.map((title) => learnArticle(title))
      );
      updateStatsDisplay();
    } catch (error) {
      /* silently skip */
    }

    await sleep(CRAWL_DELAY_MS);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/* ------------------------------------------------------------------ */
/*  Build temporary dual chains from topic text                        */
/* ------------------------------------------------------------------ */
function buildTemporaryChains(text) {
  const words = text.split(' ').filter((word) => word.length > 0);
  const trigram = {};
  const bigram = {};
  feedChain(trigram, words, 3);
  feedChain(bigram, words, 2);
  return { trigram, bigram };
}

/* ------------------------------------------------------------------ */
/*  Merge chains with optional weight multiplier                       */
/* ------------------------------------------------------------------ */
function mergeChains(base, addition, weight = 1) {
  const merged = {};

  for (const [key, values] of Object.entries(base)) {
    merged[key] = [...values];
  }

  for (const [key, values] of Object.entries(addition)) {
    const weighted = weight > 1
      ? Array.from({ length: weight }, () => values).flat()
      : values;

    if (merged[key]) {
      merged[key].push(...weighted);
    } else {
      merged[key] = [...weighted];
    }
  }

  return merged;
}

/* ------------------------------------------------------------------ */
/*  Sentence quality check                                             */
/* ------------------------------------------------------------------ */
function isCleanSentence(sentence) {
  const trimmed = sentence.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < 5) return false;
  const upperCount = (trimmed.match(/[A-Z]/g) || []).length;
  if (upperCount / trimmed.length > 0.35) return false;
  const digitCount = (trimmed.match(/\d/g) || []).length;
  if (digitCount / trimmed.length > 0.12) return false;
  if (/Bibcode|arXiv|doi:|Newswise|PMID|conf\.|\.conf/i.test(trimmed)) return false;
  if (/(.{15,})\1/.test(trimmed)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/*  Sentence classification — who/what/when/where/how/why/overview     */
/* ------------------------------------------------------------------ */
const CATEGORY_RULES = [
  {
    key: 'what',
    label: '📖 What It Is',
    patterns: [/\bis\b/i, /\bare\b/i, /\bdefin/i, /\brefers?\s+to/i, /\bdescrib/i, /\bknown\s+as/i, /\bcalled/i, /\btype\s+of/i, /\bform\s+of/i, /\bconsist/i, /\bcomposed/i, /\bcharacteri/i],
  },
  {
    key: 'how',
    label: '⚙️ How It Works',
    patterns: [/\bprocess/i, /\bmethod/i, /\bfunction/i, /\boperat/i, /\bmechanism/i, /\bcaus/i, /\bproduced?\b/i, /\bgenerat/i, /\bcreat/i, /\bconvert/i, /\btransform/i, /\binteract/i, /\babsorb/i, /\bemit/i, /\btransmit/i, /\bresult/i],
  },
  {
    key: 'where',
    label: '📍 Where It Occurs',
    patterns: [/\bfound\s+(in|on|at|near)/i, /\blocated/i, /\bregion/i, /\bspace/i, /\buniverse/i, /\bearth/i, /\batmospher/i, /\bsurface/i, /\bplanet/i, /\bgalaxy/i, /\bocean/i, /\benviron/i, /\barea/i, /\bsource/i],
  },
  {
    key: 'when',
    label: '📅 When & History',
    patterns: [/\bdiscover/i, /\bcentury/i, /\byear/i, /\bfirst\b/i, /\boriginal/i, /\bhistor/i, /\bancient/i, /\bdevelop/i, /\bevolv/i, /\bearlier/i, /\bfounded/i, /\bintroduc/i, /\bpioneered/i, /\bin\s+\d{3,4}/i],
  },
  {
    key: 'who',
    label: '👤 Who Is Involved',
    patterns: [/\bscientist/i, /\bresearcher/i, /\bphysicist/i, /\bastronom/i, /\bengineer/i, /\bproposed\s+by/i, /\bnamed\s+after/i, /\bdiscovered\s+by/i, /\btheori/i, /\bNobel/i, /\bprofessor/i, /\bpioneered/i],
  },
  {
    key: 'why',
    label: '❓ Why It Matters',
    patterns: [/\bimportan/i, /\bsignifican/i, /\bapplicat/i, /\bused\s+(in|for|to|by)/i, /\bimpact/i, /\beffect/i, /\binfluenc/i, /\brole/i, /\bessential/i, /\bcritical/i, /\bbeneficial/i, /\bdanger/i, /\bharmful/i, /\brisk/i, /\btechnolog/i],
  },
  {
    key: 'types',
    label: '🔬 Types & Examples',
    patterns: [/\btypes?\s+of/i, /\bkind\s+of/i, /\bexampl/i, /\binclude/i, /\bsuch\s+as/i, /\bvariet/i, /\bspectrum/i, /\brange/i, /\bclassif/i, /\bcategor/i, /\bform\b/i],
  },
  {
    key: 'numbers',
    label: '📊 Key Facts & Figures',
    patterns: [/\bmeasure/i, /\bspeed/i, /\btemperatur/i, /\bfrequen/i, /\bwavelength/i, /\benergy/i, /\bmass\b/i, /\bdistance/i, /\blight[\s-]year/i, /\bkilomet/i, /\bpercent/i, /\bapproximate/i, /\bestimate/i],
  },
];

function classifySentence(sentence) {
  const lower = sentence.toLowerCase();
  let bestCategory = 'overview';
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    let matchScore = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(lower)) matchScore++;
    }
    if (matchScore > bestScore) {
      bestScore = matchScore;
      bestCategory = rule.key;
    }
  }

  return bestCategory;
}

function classifyAllSentences(corpusText) {
  const rawSentences = corpusText.match(/[^.!?]+[.!?]+/g) || [];
  const cleanSentences = rawSentences.filter(isCleanSentence);

  const categories = {
    overview: [],
    what: [],
    how: [],
    where: [],
    when: [],
    who: [],
    why: [],
    types: [],
    numbers: [],
  };

  const seenSentences = new Set();

  for (const sentence of cleanSentences) {
    const trimmed = sentence.trim();
    /* Deduplicate similar sentences */
    const fingerprint = trimmed.toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
    if (seenSentences.has(fingerprint)) continue;
    seenSentences.add(fingerprint);

    const category = classifySentence(trimmed);
    categories[category].push(trimmed);
  }

  return categories;
}

/* ------------------------------------------------------------------ */
/*  Build structured HTML report from classified sentences             */
/* ------------------------------------------------------------------ */
function buildStructuredReport(categories, topic) {
  const sectionOrder = [
    { key: 'what', fallbackLabel: `📖 What is ${topic}?` },
    { key: 'how', fallbackLabel: '⚙️ How It Works' },
    { key: 'types', fallbackLabel: '🔬 Types & Examples' },
    { key: 'where', fallbackLabel: '📍 Where It Occurs' },
    { key: 'when', fallbackLabel: '📅 When & History' },
    { key: 'who', fallbackLabel: '👤 Who Is Involved' },
    { key: 'why', fallbackLabel: '❓ Why It Matters' },
    { key: 'numbers', fallbackLabel: '📊 Key Facts & Figures' },
    { key: 'overview', fallbackLabel: '📝 Overview' },
  ];

  const htmlParts = [];
  let totalSentences = 0;
  const maxPerSection = 4;

  for (const section of sectionOrder) {
    const rule = CATEGORY_RULES.find((r) => r.key === section.key);
    const label = rule?.label || section.fallbackLabel;
    const sentences = categories[section.key] || [];

    if (sentences.length === 0) continue;

    const selected = sentences.slice(0, maxPerSection);
    totalSentences += selected.length;

    htmlParts.push(`<div class="section-heading">${label}</div>`);
    htmlParts.push(`<div class="section-text">${selected.join(' ')}</div>`);
  }

  if (totalSentences === 0) {
    return '<p class="empty-section">Could not extract enough information. Try a more specific topic.</p>';
  }

  return htmlParts.join('');
}

/* ------------------------------------------------------------------ */
/*  Main generate handler                                              */
/* ------------------------------------------------------------------ */
/* Fetch a small batch of articles sequentially to avoid overwhelming the proxy */
async function fetchExtractsInBatches(titles, batchSize = 3) {
  const allExtracts = [];

  for (let startIndex = 0; startIndex < titles.length; startIndex += batchSize) {
    const batch = titles.slice(startIndex, startIndex + batchSize);
    const batchCount = startIndex + batch.length;
    statusMsg.textContent = `Downloading article ${startIndex + 1}–${batchCount} of ${titles.length}…`;

    const results = await Promise.all(
      batch.map((title) => fetchArticleExtract(title))
    );
    allExtracts.push(...results);

    /* Small pause between batches to let the proxy breathe */
    if (startIndex + batchSize < titles.length) {
      await sleep(300);
    }
  }

  return allExtracts;
}

async function fetchTopicCorpus(topic) {
  const maxAttempts = 5;
  const topicVariants = [
    topic,
    topic.toLowerCase(),
    topic.split(/\s+/).join('_'),
  ];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    /* Alternate search terms on retries */
    const searchTerm = attempt <= topicVariants.length
      ? topicVariants[attempt - 1]
      : topic;

    statusMsg.textContent = attempt > 1
      ? `Attempt ${attempt}/${maxAttempts} — searching for "${searchTerm}"…`
      : `Searching for "${searchTerm}"…`;

    const searchTitles = await searchRelatedTitles(searchTerm, 10);

    if (searchTitles.length === 0) {
      /* Try fetching the exact title directly as a fallback */
      statusMsg.textContent = `Search returned nothing. Trying direct lookup for "${topic}"…`;
      const directExtract = await fetchArticleExtract(topic);

      if (directExtract.length > 200) {
        const cleaned = cleanWikiText(directExtract);
        if (cleaned.split(' ').length > 50) {
          return { topicCorpus: cleaned, validArticleCount: 1 };
        }
      }

      await sleep(1000);
      continue;
    }

    /* Fetch search result articles in small batches */
    const extracts = await fetchExtractsInBatches(searchTitles, 3);

    /* Get links from the top result for more articles */
    const linkedTitles = await fetchInternalLinks(searchTitles[0], 8);
    const newLinkedTitles = linkedTitles
      .filter((title) => !searchTitles.includes(title))
      .slice(0, 6);

    let linkedExtracts = [];
    if (newLinkedTitles.length > 0) {
      linkedExtracts = await fetchExtractsInBatches(newLinkedTitles, 3);
    }

    const allExtracts = [...extracts, ...linkedExtracts];
    const goodExtracts = allExtracts.filter((text) => text.length > 50);
    const topicCorpus = goodExtracts
      .map((text) => cleanWikiText(text))
      .join(' ');

    if (topicCorpus.split(' ').length > 50) {
      return { topicCorpus, validArticleCount: goodExtracts.length };
    }

    statusMsg.textContent = `Got too little content. Retrying…`;
    await sleep(1000);
  }

  return null;
}

async function handleGenerate() {
  const topic = promptInput.value.trim();
  if (!topic) {
    statusMsg.textContent = 'Please enter a topic first.';
    return;
  }

  generateBtn.disabled = true;
  outputBox.innerHTML = '';
  globalBrain.isUserGenerating = true;

  try {
    const result = await fetchTopicCorpus(topic);

    if (!result) {
      statusMsg.textContent = 'Wikipedia is not responding. Please try again.';
      generateBtn.disabled = false;
      globalBrain.isUserGenerating = false;
      return;
    }

    const { topicCorpus, validArticleCount } = result;

    feedBrain(topicCorpus);
    globalBrain.totalArticles += validArticleCount;
    updateStatsDisplay();

    statusMsg.textContent = 'Classifying and building report…';

    /* Classify every clean sentence into who/what/when/where/how/why */
    const categories = classifyAllSentences(topicCorpus);

    /* Build a structured HTML report */
    const reportHtml = buildStructuredReport(categories, topic);

    outputBox.innerHTML = reportHtml;
    statusMsg.textContent =
      `Done — report built from ${validArticleCount} articles (${globalBrain.totalArticles.toLocaleString()} total in brain).`;
  } catch (error) {
    statusMsg.textContent = `Error: ${error.message}`;
  }

  generateBtn.disabled = false;
  globalBrain.isUserGenerating = false;
}

/* ------------------------------------------------------------------ */
/*  Event listeners                                                    */
/* ------------------------------------------------------------------ */
generateBtn.addEventListener('click', handleGenerate);
promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleGenerate();
});

/* ------------------------------------------------------------------ */
/*  Start the curiosity crawler on page load                           */
/* ------------------------------------------------------------------ */
startCuriosityCrawler();
