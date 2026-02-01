const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export const config = {
  maxDuration: 30,
};

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Gemini API key not configured. Add GEMINI_API_KEY to environment variables.' });
  }

  try {
    const { question, stats, matches } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Build context from stats and matches
    const context = buildContext(stats, matches);

    const systemPrompt = `You are BoyStats AI, a statistics analyst for a League of Legends friend group called "The Boys". You have access to their COMPLETE match history dataset.

CRITICAL: You have the FULL raw match data as JSON. You can answer ANY question by analyzing this data directly. Do not say data is missing - compute it from the raw matches.

CAPABILITIES:
- Calculate any statistic by processing the match JSON
- Find specific games (by champion, date, queue type, outcome)
- Compare players across any metric
- Identify trends, patterns, streaks
- Analyze champion performance, role distribution, duo synergies
- Find records (highest damage, most kills, longest game, etc.)

HOW TO ANSWER:
1. Parse the JSON match data to find relevant matches
2. Compute the requested statistics
3. Cite specific numbers and examples
4. Be precise - show your calculations when helpful

TONE:
- Accurate and data-driven first
- Friendly but professional
- Use gaming terms naturally
- Keep responses focused

The players ("The Boys"):
- SomeBees
- BananaJamHands
- Storklord
- pRiNcEsSFiStY
- Alessio

QUEUE TYPES: 420=Ranked Solo, 440=Ranked Flex, 400=Normal Draft, 450=ARAM

You can answer questions like:
- "What's Storklord's win rate on Jinx in ranked?"
- "Who has the most pentakills?"
- "What duo has the best synergy?"
- "Show me games where someone had 20+ kills"
- "What's our ARAM win rate vs ranked?"
- "Who carries hardest in losses?"

Analyze the raw data to answer accurately.`;

    const userMessage = `Here's the current stats and match data for The Boys:

${context}

User's question: ${question}`;

    // Use models from user's available list
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
    let response;
    let lastError;

    for (const model of models) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: systemPrompt + '\n\n' + userMessage }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.5,
                maxOutputTokens: 8192,
              },
            }),
          }
        );

        if (response.ok) {
          break; // Success, exit loop
        }
        lastError = await response.text();
        console.error(`Gemini API error with model ${model}:`, lastError);
      } catch (err) {
        lastError = err.message;
        console.error(`Gemini fetch error with model ${model}:`, err.message);
      }
    }

    if (!response || !response.ok) {
      return res.status(500).json({
        error: `Gemini API error: ${lastError}. Make sure your API key is valid and the Generative Language API is enabled in Google Cloud Console.`
      });
    }

    const data = await response.json();

    // Check for blocked or truncated responses
    const candidate = data.candidates?.[0];
    const finishReason = candidate?.finishReason;
    let answer = candidate?.content?.parts?.[0]?.text || '';

    if (!answer && data.promptFeedback?.blockReason) {
      answer = `Response blocked: ${data.promptFeedback.blockReason}`;
    } else if (!answer) {
      answer = 'No response generated';
    }

    // Log finish reason for debugging
    if (finishReason && finishReason !== 'STOP') {
      console.log('Gemini finish reason:', finishReason);
    }

    res.json({ answer, finishReason });
  } catch (err) {
    console.error('Ask AI error:', err);
    res.status(500).json({ error: err.message });
  }
}

function buildContext(stats, matches) {
  let context = '';

  // Data Dictionary - explain what each field means
  context += `## DATA DICTIONARY

You have access to the COMPLETE match history dataset. Here's what each field means:

### Match Fields:
- matchId: Unique identifier for the match
- gameCreation: Unix timestamp (milliseconds) when the game started
- gameDuration: Game length in seconds
- gameMode: e.g., "CLASSIC", "ARAM"
- queueId: 420=Ranked Solo, 440=Ranked Flex, 400=Normal Draft, 450=ARAM

### Participant Fields (each match has 10 participants):
- puuid: Player's unique ID
- isBoy: true if this is one of "The Boys"
- boyName: The player's name if isBoy is true
- riotIdGameName: In-game name
- championName: Champion played
- teamId: 100=Blue side, 200=Red side
- teamPosition: TOP, JUNGLE, MIDDLE, BOTTOM (ADC), UTILITY (Support)
- win: true/false
- kills, deaths, assists: K/D/A stats
- totalMinionsKilled: Lane minion CS
- neutralMinionsKilled: Jungle monster CS
- goldEarned: Total gold
- totalDamageDealtToChampions: Damage to enemy champions
- totalDamageTaken: Damage received
- visionScore: Ward/vision contribution
- timeCCingOthers: Seconds of CC applied to enemies
- totalHealsOnTeammates: Healing done to allies
- totalDamageShieldedOnTeammates: Shielding done to allies
- doubleKills, tripleKills, quadraKills, pentaKills: Multi-kill counts
- firstBloodKill: true if got first blood
- largestKillingSpree: Highest killstreak in the game
- gameEndedInSurrender: true if the game ended in surrender
- challenges.soloKills: 1v1 kills
- challenges.hadOpenNexus: true if enemy nexus was exposed (comeback potential)

## THE BOYS (the 5 players we're tracking):
- SomeBees
- BananaJamHands
- Storklord
- pRiNcEsSFiStY
- Alessio

`;

  // Add computed stats summary for quick reference
  if (stats?.players) {
    context += '## COMPUTED STATS SUMMARY (for quick reference)\n\n';
    for (const [name, s] of Object.entries(stats.players)) {
      if (s.games === 0) continue;
      const kda = ((s.kills + s.assists) / Math.max(s.deaths, 1)).toFixed(2);
      const wr = ((s.wins / s.games) * 100).toFixed(1);
      context += `${name}: ${s.games}g, ${wr}%WR, ${kda}KDA, ${s.kills}K/${s.deaths}D/${s.assists}A, ${s.pentas}penta, ${s.quadras}quadra\n`;
    }
    context += '\n';
  }

  if (stats?.duos) {
    context += '## DUO SYNERGIES\n';
    const sortedDuos = Object.entries(stats.duos)
      .filter(([, d]) => d.games >= 2)
      .sort((a, b) => b[1].games - a[1].games);
    for (const [, duo] of sortedDuos) {
      const wr = ((duo.wins / duo.games) * 100).toFixed(0);
      context += `${duo.players.join('+')}:${duo.games}g,${wr}%\n`;
    }
    context += '\n';
  }

  // Add FULL match data as JSON
  if (matches && matches.length > 0) {
    context += `## COMPLETE MATCH DATA (${matches.length} matches)\n\n`;
    context += `Below is the full JSON dataset. Use this to answer ANY question about the match history.\n\n`;
    context += '```json\n';
    context += JSON.stringify(matches, null, 0); // Compact JSON to save tokens
    context += '\n```\n';
  }

  return context;
}
