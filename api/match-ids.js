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
    // Strategy: fetch all queues for each player in parallel, then paginate
    const allPlayerPromises = Object.entries(puuidMap).map(async ([name, puuid]) => {
      const playerMatchIds = [];

      // Fetch each queue for this player
      for (const queue of queues) {
        // Check time limit
        if (Date.now() - startTime > 8500) {
          debug.errors.push(`Time limit for ${name} at queue ${queue}`);
          break;
        }

        for (let page = 0; page < pagesPerQueue; page++) {
          try {
            const ids = await getMatchIds(puuid, page * 100, 100, queue, matchStartTime);
            playerMatchIds.push(...ids);

            // Track per-player-queue stats
            const key = `${name}_q${queue}`;
            debug.matchIdsPerPlayer[key] = (debug.matchIdsPerPlayer[key] || 0) + ids.length;

            // If we got fewer than 100, no more pages for this queue
            if (ids.length < 100) break;
          } catch (err) {
            debug.errors.push(`${name} q${queue} p${page}: ${err.message}`);
            break;
          }
        }
      }

      return { name, matchIds: playerMatchIds };
    });

    // Run all player fetches in parallel
    const results = await Promise.allSettled(allPlayerPromises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        result.value.matchIds.forEach(id => allMatchIds.add(id));
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
