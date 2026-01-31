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
  maxDuration: 60, // 60 seconds max for Pro plan, 10 for Hobby
};

// Fetch match IDs with pagination to get older matches
async function getAllMatchIds(puuid, maxPages = 5) {
  const allIds = [];
  for (let page = 0; page < maxPages; page++) {
    try {
      const start = page * 100;
      const matchIds = await getMatchIds(puuid, start, 100);
      if (matchIds.length === 0) break; // No more matches
      allIds.push(...matchIds);
      await delay(100); // Rate limiting
      if (matchIds.length < 100) break; // Last page
    } catch (err) {
      console.error(`Error fetching page ${page}:`, err.message);
      break;
    }
  }
  return allIds;
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // pages = how many pages of 100 matches to fetch per player (max 10 = 1000 matches each)
    const pages = Math.min(parseInt(req.query.pages) || 5, 10);
    // limit = max number of match details to fetch (to control timeout)
    const detailLimit = Math.min(parseInt(req.query.limit) || 150, 300);

    const allMatchIds = new Set();
    const puuidMap = {};
    const debug = {
      playersFound: [],
      matchIdsPerPlayer: {},
      totalUniqueMatchIds: 0,
      matchDetailsFetched: 0,
      matchesWithBoys: 0,
      errors: []
    };

    // Get all PUUIDs
    for (const boy of THE_BOYS) {
      try {
        const account = await getAccountByRiotId(boy.gameName, boy.tagLine);
        puuidMap[boy.gameName] = account.puuid;
        debug.playersFound.push(boy.gameName);
        await delay(50);
      } catch (err) {
        debug.errors.push(`PUUID error for ${boy.gameName}: ${err.message}`);
      }
    }

    const puuids = Object.values(puuidMap);

    // Get match IDs from each player with pagination
    for (const [name, puuid] of Object.entries(puuidMap)) {
      try {
        const matchIds = await getAllMatchIds(puuid, pages);
        debug.matchIdsPerPlayer[name] = matchIds.length;
        matchIds.forEach(id => allMatchIds.add(id));
      } catch (err) {
        debug.errors.push(`Match IDs error for ${name}: ${err.message}`);
      }
    }

    debug.totalUniqueMatchIds = allMatchIds.size;

    // Sort match IDs (they contain timestamps) to get most recent first
    const matchIdArray = Array.from(allMatchIds)
      .sort((a, b) => {
        // Match IDs are like "NA1_1234567890" - extract the number
        const numA = parseInt(a.split('_')[1]) || 0;
        const numB = parseInt(b.split('_')[1]) || 0;
        return numB - numA; // Descending (newest first)
      })
      .slice(0, detailLimit);

    // Fetch match details
    const matches = [];

    for (let i = 0; i < matchIdArray.length; i++) {
      try {
        const match = await getMatchDetails(matchIdArray[i]);
        debug.matchDetailsFetched++;
        await delay(50);

        // Check if any of The Boys are in this match
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
      } catch (err) {
        debug.errors.push(`Match detail error ${matchIdArray[i]}: ${err.message}`);
      }
    }

    // Sort by date descending
    matches.sort((a, b) => b.gameCreation - a.gameCreation);

    res.json({
      matches,
      players: puuidMap,
      total: matches.length,
      debug, // Include debug info to see what's happening
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
