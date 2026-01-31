const RIOT_API_KEY = process.env.RIOT_API_KEY;
const AMERICAS_BASE = 'https://americas.api.riotgames.com';

const THE_BOYS = [
  { gameName: 'SomeBees', tagLine: 'NA1' },
  { gameName: 'BananaJamHands', tagLine: 'NA1' },
  { gameName: 'Storklord', tagLine: 'NA1' },
  { gameName: 'pRiNcEsSFiStY', tagLine: 'NA1' },
  { gameName: 'Alessio', tagLine: 'NA1' },
];

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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAccountByRiotId(gameName, tagLine) {
  const url = `${AMERICAS_BASE}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetch(url);
}

async function getMatchIds(puuid, start = 0, count = 100) {
  const url = `${AMERICAS_BASE}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`;
  return riotFetch(url);
}

async function getMatchDetails(matchId) {
  const url = `${AMERICAS_BASE}/lol/match/v5/matches/${matchId}`;
  return riotFetch(url);
}

export const config = {
  maxDuration: 60, // 60 seconds for Pro plan, 10 for Hobby
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const startTime = Date.now();

  try {
    // Reduced defaults for hobby plan (10s timeout)
    const pages = Math.min(parseInt(req.query.pages) || 2, 10);
    const detailLimit = Math.min(parseInt(req.query.limit) || 75, 300);
    const batchSize = 10; // Fetch this many match details in parallel

    const allMatchIds = new Set();
    const puuidMap = {};
    const debug = {
      playersFound: [],
      matchIdsPerPlayer: {},
      totalUniqueMatchIds: 0,
      matchDetailsFetched: 0,
      matchesWithBoys: 0,
      errors: [],
      timeMs: 0
    };

    // Fetch all PUUIDs in parallel
    const puuidResults = await Promise.allSettled(
      THE_BOYS.map(boy => getAccountByRiotId(boy.gameName, boy.tagLine).then(acc => ({ name: boy.gameName, puuid: acc.puuid })))
    );

    for (const result of puuidResults) {
      if (result.status === 'fulfilled') {
        puuidMap[result.value.name] = result.value.puuid;
        debug.playersFound.push(result.value.name);
      } else {
        debug.errors.push(`PUUID error: ${result.reason.message}`);
      }
    }

    const puuids = Object.values(puuidMap);

    // Fetch match IDs for all players in parallel (first page only for speed)
    // Then do additional pages sequentially if time permits
    const matchIdPromises = Object.entries(puuidMap).map(async ([name, puuid]) => {
      const allIds = [];
      for (let page = 0; page < pages; page++) {
        try {
          const matchIds = await getMatchIds(puuid, page * 100, 100);
          allIds.push(...matchIds);
          if (matchIds.length < 100) break;
          // Check if we're running low on time (leave 6s for match details)
          if (Date.now() - startTime > 4000) break;
        } catch (err) {
          debug.errors.push(`Match IDs error for ${name} page ${page}: ${err.message}`);
          break;
        }
      }
      return { name, matchIds: allIds };
    });

    const matchIdResults = await Promise.allSettled(matchIdPromises);

    for (const result of matchIdResults) {
      if (result.status === 'fulfilled') {
        debug.matchIdsPerPlayer[result.value.name] = result.value.matchIds.length;
        result.value.matchIds.forEach(id => allMatchIds.add(id));
      }
    }

    debug.totalUniqueMatchIds = allMatchIds.size;

    // Sort match IDs to get most recent first
    const matchIdArray = Array.from(allMatchIds)
      .sort((a, b) => {
        const numA = parseInt(a.split('_')[1]) || 0;
        const numB = parseInt(b.split('_')[1]) || 0;
        return numB - numA;
      })
      .slice(0, detailLimit);

    // Fetch match details in parallel batches
    const matches = [];

    for (let i = 0; i < matchIdArray.length; i += batchSize) {
      // Check timeout - leave 1s buffer
      if (Date.now() - startTime > 9000) {
        debug.errors.push(`Timeout approaching, stopped at ${i} matches`);
        break;
      }

      const batch = matchIdArray.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(matchId => getMatchDetails(matchId))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        if (result.status === 'fulfilled') {
          const match = result.value;
          debug.matchDetailsFetched++;

          const boysInMatch = match.info.participants.filter(p => puuids.includes(p.puuid));

          if (boysInMatch.length > 0) {
            debug.matchesWithBoys++;
            match.info.participants = match.info.participants.map(p => ({
              ...p,
              isBoy: puuids.includes(p.puuid),
              boyName: Object.entries(puuidMap).find(([name, puid]) => puid === p.puuid)?.[0] || null,
            }));

            matches.push({
              matchId: match.metadata.matchId,
              gameCreation: match.info.gameCreation,
              gameDuration: match.info.gameDuration,
              gameMode: match.info.gameMode,
              queueId: match.info.queueId,
              participants: match.info.participants,
              teams: match.info.teams,
            });
          }
        } else {
          debug.errors.push(`Match detail error: ${result.reason.message}`);
        }
      }

      // Small delay between batches to avoid rate limits
      if (i + batchSize < matchIdArray.length) {
        await delay(50);
      }
    }

    // Sort by date descending
    matches.sort((a, b) => b.gameCreation - a.gameCreation);

    debug.timeMs = Date.now() - startTime;

    res.json({
      matches,
      players: puuidMap,
      total: matches.length,
      debug,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, timeMs: Date.now() - startTime });
  }
}
