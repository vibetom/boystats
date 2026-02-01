const RIOT_API_KEY = process.env.RIOT_API_KEY;
const AMERICAS_BASE = 'https://americas.api.riotgames.com';

const THE_BOYS = [
  { gameName: 'SomeBees', tagLine: 'NA1' },
  { gameName: 'BananaJamHands', tagLine: 'NA1' },
  { gameName: 'Storklord', tagLine: 'NA1' },
  { gameName: 'pRiNcEsSFiStY', tagLine: 'NA1' },
  { gameName: 'Alessio', tagLine: 'NA1' },
];

// Queue types: Ranked Solo (420), Ranked Flex (440), Normal Draft (400), ARAM (450)
const DEFAULT_QUEUES = [420, 440, 400, 450];

async function riotFetch(url) {
  const response = await fetch(url, {
    headers: { 'X-Riot-Token': RIOT_API_KEY },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Riot API error ${response.status}: ${error}`);
  }
  return response.json();
}

async function getAccountByRiotId(gameName, tagLine) {
  const url = `${AMERICAS_BASE}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetch(url);
}

async function getMatchIds(puuid, start = 0, count = 100, queue = null, startTime = null) {
  let url = `${AMERICAS_BASE}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`;
  if (queue) {
    url += `&queue=${queue}`;
  }
  if (startTime) {
    url += `&startTime=${startTime}`;
  }
  return riotFetch(url);
}

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const startTime = Date.now();

  try {
    // Parse parameters
    const queues = req.query.queues
      ? req.query.queues.split(',').map(q => parseInt(q)).filter(q => !isNaN(q))
      : DEFAULT_QUEUES;

    // How many pages to fetch per player per queue (each page = 100 matches)
    // Default 5 pages = 500 matches per player per queue = potentially thousands total
    const pagesPerQueue = Math.min(parseInt(req.query.pages) || 5, 20);

    // Optional: start time in epoch seconds (for fetching older matches)
    const matchStartTime = req.query.startTime ? parseInt(req.query.startTime) : null;

    const allMatchIds = new Set();
    const puuidMap = {};
    const debug = {
      playersFound: [],
      matchIdsPerPlayer: {},
      queues,
      pagesPerQueue,
      errors: [],
      timeMs: 0
    };

    // Fetch all PUUIDs in parallel
    const puuidResults = await Promise.allSettled(
      THE_BOYS.map(boy =>
        getAccountByRiotId(boy.gameName, boy.tagLine)
          .then(acc => ({ name: boy.gameName, puuid: acc.puuid }))
      )
    );

    for (const result of puuidResults) {
      if (result.status === 'fulfilled') {
        puuidMap[result.value.name] = result.value.puuid;
        debug.playersFound.push(result.value.name);
      } else {
        debug.errors.push(`PUUID error: ${result.reason.message}`);
      }
    }

    // Fetch match IDs for all players and queues
    // Strategy: fetch first page of ALL queues for ALL players in parallel first
    // This ensures we get at least some data from every queue
    const allPromises = [];

    for (const [name, puuid] of Object.entries(puuidMap)) {
      for (const queue of queues) {
        // First page of each queue (most recent 100 matches)
        allPromises.push(
          getMatchIds(puuid, 0, 100, queue, matchStartTime)
            .then(ids => ({ name, queue, page: 0, ids }))
            .catch(err => ({ name, queue, page: 0, ids: [], error: err.message }))
        );
      }
    }

    // Fetch all first pages in parallel
    const firstPageResults = await Promise.all(allPromises);

    for (const result of firstPageResults) {
      if (result.error) {
        debug.errors.push(`${result.name} q${result.queue} p0: ${result.error}`);
      } else {
        result.ids.forEach(id => allMatchIds.add(id));
        const key = `${result.name}_q${result.queue}`;
        debug.matchIdsPerPlayer[key] = (debug.matchIdsPerPlayer[key] || 0) + result.ids.length;
      }
    }

    // If we have time left, fetch additional pages for queues that had 100 results
    const needsMorePages = firstPageResults.filter(r => r.ids.length === 100 && !r.error);

    for (let page = 1; page < pagesPerQueue && Date.now() - startTime < 50000; page++) {
      if (needsMorePages.length === 0) break;

      const pagePromises = needsMorePages.map(r =>
        getMatchIds(puuidMap[r.name], page * 100, 100, r.queue, matchStartTime)
          .then(ids => ({ name: r.name, queue: r.queue, page, ids }))
          .catch(err => ({ name: r.name, queue: r.queue, page, ids: [], error: err.message }))
      );

      const pageResults = await Promise.all(pagePromises);

      for (const result of pageResults) {
        if (result.error) {
          debug.errors.push(`${result.name} q${result.queue} p${result.page}: ${result.error}`);
        } else {
          result.ids.forEach(id => allMatchIds.add(id));
          const key = `${result.name}_q${result.queue}`;
          debug.matchIdsPerPlayer[key] = (debug.matchIdsPerPlayer[key] || 0) + result.ids.length;
        }
      }

      // Remove entries that returned fewer than 100 (no more pages)
      for (let i = needsMorePages.length - 1; i >= 0; i--) {
        const found = pageResults.find(r => r.name === needsMorePages[i].name && r.queue === needsMorePages[i].queue);
        if (!found || found.ids.length < 100 || found.error) {
          needsMorePages.splice(i, 1);
        }
      }
    }

    // Sort match IDs by the numeric part (higher = more recent)
    const sortedMatchIds = Array.from(allMatchIds).sort((a, b) => {
      const numA = parseInt(a.split('_')[1]) || 0;
      const numB = parseInt(b.split('_')[1]) || 0;
      return numB - numA;
    });

    debug.totalMatchIds = sortedMatchIds.length;
    debug.timeMs = Date.now() - startTime;

    res.json({
      matchIds: sortedMatchIds,
      players: puuidMap,
      debug,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, timeMs: Date.now() - startTime });
  }
}
