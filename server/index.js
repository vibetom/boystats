import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Riot API configuration
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const AMERICAS_BASE = 'https://americas.api.riotgames.com';
const NA1_BASE = 'https://na1.api.riotgames.com';

// The Boys - their Riot IDs
const THE_BOYS = [
  { gameName: 'SomeBees', tagLine: 'NA1' },
  { gameName: 'BananaJamHands', tagLine: 'NA1' },
  { gameName: 'Storklord', tagLine: 'NA1' },
  { gameName: 'pRiNcEsSFiStY', tagLine: 'NA1' },
  { gameName: 'Alessio', tagLine: 'NA1' },
];

app.use(cors());
app.use(express.json());

// Helper to make Riot API requests
async function riotFetch(url) {
  const response = await fetch(url, {
    headers: {
      'X-Riot-Token': RIOT_API_KEY,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Riot API error ${response.status}: ${error}`);
  }

  return response.json();
}

// Helper for rate limiting - simple delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Get account by Riot ID
async function getAccountByRiotId(gameName, tagLine) {
  const url = `${AMERICAS_BASE}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotFetch(url);
}

// Get summoner by PUUID
async function getSummonerByPuuid(puuid) {
  const url = `${NA1_BASE}/lol/summoner/v4/summoners/by-puuid/${puuid}`;
  return riotFetch(url);
}

// Get ranked stats
async function getRankedStats(summonerId) {
  const url = `${NA1_BASE}/lol/league/v4/entries/by-summoner/${summonerId}`;
  return riotFetch(url);
}

// Get match IDs for a player
async function getMatchIds(puuid, start = 0, count = 100) {
  const url = `${AMERICAS_BASE}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`;
  return riotFetch(url);
}

// Get match details
async function getMatchDetails(matchId) {
  const url = `${AMERICAS_BASE}/lol/match/v5/matches/${matchId}`;
  return riotFetch(url);
}

// ============================================================================
// API ROUTES
// ============================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: !!RIOT_API_KEY });
});

// Get all players' basic info and ranked stats
app.get('/api/players', async (req, res) => {
  try {
    const players = [];

    for (const boy of THE_BOYS) {
      try {
        // Get account info (PUUID)
        const account = await getAccountByRiotId(boy.gameName, boy.tagLine);
        await delay(50); // Rate limiting

        // Get summoner info
        const summoner = await getSummonerByPuuid(account.puuid);
        await delay(50);

        // Get ranked stats
        const rankedStats = await getRankedStats(summoner.id);
        await delay(50);

        // Find solo queue stats
        const soloQueue = rankedStats.find(q => q.queueType === 'RANKED_SOLO_5x5');
        const flexQueue = rankedStats.find(q => q.queueType === 'RANKED_FLEX_SR');

        players.push({
          gameName: account.gameName,
          tagLine: account.tagLine,
          puuid: account.puuid,
          summonerId: summoner.id,
          summonerLevel: summoner.summonerLevel,
          profileIconId: summoner.profileIconId,
          soloQueue: soloQueue ? {
            tier: soloQueue.tier,
            rank: soloQueue.rank,
            lp: soloQueue.leaguePoints,
            wins: soloQueue.wins,
            losses: soloQueue.losses,
          } : null,
          flexQueue: flexQueue ? {
            tier: flexQueue.tier,
            rank: flexQueue.rank,
            lp: flexQueue.leaguePoints,
            wins: flexQueue.wins,
            losses: flexQueue.losses,
          } : null,
        });

        console.log(`Fetched player: ${boy.gameName}`);
      } catch (err) {
        console.error(`Error fetching ${boy.gameName}:`, err.message);
        players.push({
          gameName: boy.gameName,
          tagLine: boy.tagLine,
          error: err.message,
        });
      }
    }

    res.json(players);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get match history for all boys (finds shared games)
app.get('/api/matches', async (req, res) => {
  try {
    const maxMatches = parseInt(req.query.max) || 500;
    const allMatchIds = new Set();
    const puuidMap = {};

    // First, get all PUUIDs
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

    // Get match IDs from each player
    for (const [name, puuid] of Object.entries(puuidMap)) {
      try {
        let start = 0;
        const batchSize = 100;

        while (start < maxMatches) {
          const matchIds = await getMatchIds(puuid, start, Math.min(batchSize, maxMatches - start));
          await delay(100);

          if (matchIds.length === 0) break;

          matchIds.forEach(id => allMatchIds.add(id));
          start += batchSize;

          console.log(`Fetched ${start} match IDs for ${name}`);

          if (matchIds.length < batchSize) break;
        }
      } catch (err) {
        console.error(`Error getting matches for ${name}:`, err.message);
      }
    }

    console.log(`Total unique match IDs: ${allMatchIds.size}`);

    // Fetch match details
    const matches = [];
    const matchIdArray = Array.from(allMatchIds);

    for (let i = 0; i < matchIdArray.length; i++) {
      try {
        const match = await getMatchDetails(matchIdArray[i]);
        await delay(100);

        // Check if any of The Boys are in this match
        const boysInMatch = match.info.participants.filter(p => puuids.includes(p.puuid));

        if (boysInMatch.length > 0) {
          // Add isBoy flag to participants
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

        if ((i + 1) % 10 === 0) {
          console.log(`Processed ${i + 1}/${matchIdArray.length} matches, found ${matches.length} with The Boys`);
        }
      } catch (err) {
        console.error(`Error fetching match ${matchIdArray[i]}:`, err.message);
      }
    }

    // Sort by date descending
    matches.sort((a, b) => b.gameCreation - a.gameCreation);

    console.log(`Returning ${matches.length} matches`);
    res.json({
      matches,
      players: puuidMap,
      total: matches.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single player's match history
app.get('/api/player/:gameName/matches', async (req, res) => {
  try {
    const { gameName } = req.params;
    const tagLine = req.query.tagLine || 'NA1';
    const count = parseInt(req.query.count) || 20;

    const account = await getAccountByRiotId(gameName, tagLine);
    await delay(50);

    const matchIds = await getMatchIds(account.puuid, 0, count);
    await delay(50);

    const matches = [];
    for (const matchId of matchIds) {
      const match = await getMatchDetails(matchId);
      await delay(100);
      matches.push(match);
    }

    res.json({ puuid: account.puuid, matches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`BoyStats API server running on port ${PORT}`);
  if (!RIOT_API_KEY) {
    console.warn('WARNING: RIOT_API_KEY not set! API calls will fail.');
  }
});
