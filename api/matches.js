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

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const maxMatches = Math.min(parseInt(req.query.max) || 100, 200);
    const allMatchIds = new Set();
    const puuidMap = {};

    // Get all PUUIDs
    for (const boy of THE_BOYS) {
      try {
        const account = await getAccountByRiotId(boy.gameName, boy.tagLine);
        puuidMap[boy.gameName] = account.puuid;
        await delay(50);
      } catch (err) {
        console.error(`Error getting PUUID for ${boy.gameName}:`, err.message);
      }
    }

    const puuids = Object.values(puuidMap);

    // Get match IDs from each player (limited to stay within timeout)
    for (const [name, puuid] of Object.entries(puuidMap)) {
      try {
        const matchIds = await getMatchIds(puuid, 0, Math.min(maxMatches, 100));
        await delay(100);
        matchIds.forEach(id => allMatchIds.add(id));
      } catch (err) {
        console.error(`Error getting matches for ${name}:`, err.message);
      }
    }

    // Fetch match details (limit to prevent timeout)
    const matches = [];
    const matchIdArray = Array.from(allMatchIds).slice(0, maxMatches);

    for (let i = 0; i < matchIdArray.length; i++) {
      try {
        const match = await getMatchDetails(matchIdArray[i]);
        await delay(50);

        // Check if any of The Boys are in this match
        const boysInMatch = match.info.participants.filter(p => puuids.includes(p.puuid));

        if (boysInMatch.length > 0) {
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
        console.error(`Error fetching match ${matchIdArray[i]}:`, err.message);
      }
    }

    // Sort by date descending
    matches.sort((a, b) => b.gameCreation - a.gameCreation);

    res.json({
      matches,
      players: puuidMap,
      total: matches.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
