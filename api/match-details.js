const RIOT_API_KEY = process.env.RIOT_API_KEY;
const AMERICAS_BASE = 'https://americas.api.riotgames.com';

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

async function getMatchDetails(matchId) {
  const url = `${AMERICAS_BASE}/lol/match/v5/matches/${matchId}`;
  return riotFetch(url);
}

// Helper to fetch with concurrency limit
async function fetchWithConcurrency(items, fetchFn, concurrency = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fetchFn));
    results.push(...batchResults);
    // Small delay between mini-batches to respect rate limits
    if (i + concurrency < items.length) {
      await new Promise(r => setTimeout(r, 50));
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

    // Reduce batch size to 15 to stay well within timeout
    const batchIds = matchIds.slice(0, 15);
    const puuids = Object.values(players);

    const matches = [];
    const errors = [];
    let skippedNoboys = 0;

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
          // Log first skipped match for debugging
          if (skippedNoboys === 1) {
            console.log('First skipped match debug:', {
              matchId: match.metadata.matchId,
              expectedPuuids: puuids.slice(0, 2), // First 2 for brevity
              sampleMatchPuuids: matchPuuids.slice(0, 3), // First 3 for brevity
            });
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
        errors.push(`${batchIds[i]}: ${result.reason.message}`);
      }
    }

    res.json({
      matches,
      processed: batchIds.length,
      skippedNoboys,
      expectedPuuids: puuids.length,
      errors: errors.length > 0 ? errors : undefined,
      timeMs: Date.now() - startTime,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, timeMs: Date.now() - startTime });
  }
}
