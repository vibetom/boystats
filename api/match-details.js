const RIOT_API_KEY = process.env.RIOT_API_KEY;
const AMERICAS_BASE = 'https://americas.api.riotgames.com';

async function riotFetch(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(url, {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '2');
      console.log(`Rate limited, waiting ${retryAfter}s...`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Riot API error ${response.status}: ${error}`);
    }
    return response.json();
  }
  throw new Error('Max retries exceeded due to rate limiting');
}

async function getMatchDetails(matchId) {
  const url = `${AMERICAS_BASE}/lol/match/v5/matches/${matchId}`;
  return riotFetch(url);
}

// Helper to fetch with very conservative rate limiting
// Only 2 concurrent requests with 300ms delay between mini-batches
async function fetchWithConcurrency(items, fetchFn, concurrency = 2) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fetchFn));
    results.push(...batchResults);
    // Longer delay between mini-batches to respect rate limits
    if (i + concurrency < items.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  return results;
}

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    const { matchIds, players } = req.body;

    if (!matchIds || !Array.isArray(matchIds)) {
      return res.status(400).json({ error: 'matchIds array is required' });
    }

    if (!players || typeof players !== 'object') {
      return res.status(400).json({ error: 'players map is required' });
    }

    // Very small batch size for conservative rate limiting
    const batchIds = matchIds.slice(0, 5);
    const puuids = Object.values(players);

    const matches = [];
    const errors = [];
    let skippedNoboys = 0;
    let rateLimitHits = 0;
    let debugInfo = null;

    // Fetch with limited concurrency (5 at a time) to avoid rate limits
    const results = await fetchWithConcurrency(
      batchIds,
      matchId => getMatchDetails(matchId),
      5
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      if (result.status === 'fulfilled') {
        const match = result.value;

        // Debug: Check what PUUIDs are in the match
        const matchPuuids = match.info.participants.map(p => p.puuid);
        const boysInMatch = match.info.participants.filter(p => puuids.includes(p.puuid));

        if (boysInMatch.length === 0) {
          skippedNoboys++;
          // Capture first skipped match for debugging
          if (skippedNoboys === 1) {
            debugInfo = {
              firstSkippedMatchId: match.metadata.matchId,
              expectedPuuids: puuids,
              actualMatchPuuids: matchPuuids,
              matchHadParticipants: match.info.participants.length,
            };
          }
        }

        if (boysInMatch.length > 0) {
          // Annotate participants with boy info
          match.info.participants = match.info.participants.map(p => ({
            ...p,
            isBoy: puuids.includes(p.puuid),
            boyName: Object.entries(players).find(([name, puid]) => puid === p.puuid)?.[0] || null,
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
        const errMsg = result.reason.message;
        errors.push(`${batchIds[i]}: ${errMsg}`);
        if (errMsg.includes('429') || errMsg.includes('rate limit')) {
          rateLimitHits++;
        }
      }
    }

    res.json({
      matches,
      processed: batchIds.length,
      skippedNoboys,
      rateLimitHits,
      expectedPuuids: puuids.length,
      debugInfo: debugInfo || undefined,
      errors: errors.length > 0 ? errors : undefined,
      timeMs: Date.now() - startTime,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, timeMs: Date.now() - startTime });
  }
}
