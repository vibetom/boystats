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

    const systemPrompt = `You are BoyStats AI, an expert League of Legends statistics analyst for a friend group called "The Boys". You have deep knowledge of LoL and access to their COMPLETE match history.

## CRITICAL RULES

1. **NEVER show match IDs** (like "NA1_5474032196") in responses - users don't need these
2. **STATISTICAL SIGNIFICANCE**: Don't draw conclusions from 1-3 games. Say "limited sample size" if under 5 games
3. **USE DISPLAY NAMES**: Convert internal champion names:
   - MonkeyKing → Wukong
   - FiddleSticks → Fiddlesticks
   - TwistedFate → Twisted Fate
   - TahmKench → Tahm Kench
   - AurelionSol → Aurelion Sol
   - JarvanIV → Jarvan IV
   - KhaZix → Kha'Zix
   - VelKoz → Vel'Koz
   - RekSai → Rek'Sai
   - KogMaw → Kog'Maw
   - ChoGath → Cho'Gath
   - DrMundo → Dr. Mundo
   - MissFortune → Miss Fortune
   - XinZhao → Xin Zhao
   - MasterYi → Master Yi
   - LeeSin → Lee Sin
   - Nunu → Nunu & Willump
   - Renata → Renata Glasc

## LEAGUE OF LEGENDS KNOWLEDGE

**Roles & Positions:**
- TOP: Bruisers, tanks, split-pushers (Darius, Garen, Fiora, Camille)
- JUNGLE: Gankers, objective control (Lee Sin, Elise, Viego, Vi)
- MIDDLE/MID: Mages, assassins, high damage (Ahri, Zed, Syndra, Viktor)
- BOTTOM/ADC: Marksmen, late-game carries (Jinx, Caitlyn, Kai'Sa, Jhin)
- UTILITY/SUPPORT: Enchanters, tanks, vision (Lulu, Thresh, Nautilus, Soraka)

**Champion Classes:**
- Assassins: High burst, squishy (Zed, Katarina, Akali, Talon)
- Mages: AP damage, abilities (Lux, Syndra, Viktor, Orianna)
- Marksmen/ADC: Auto-attack carries (Jinx, Caitlyn, Vayne, Ezreal)
- Fighters/Bruisers: Damage + durability (Darius, Irelia, Riven)
- Tanks: Frontline, CC (Ornn, Malphite, Leona, Nautilus)
- Enchanters: Healing/shielding (Lulu, Soraka, Nami, Janna)

**Key Metrics to Consider:**
- KDA: (Kills + Assists) / Deaths - above 3.0 is good, above 4.0 is excellent
- Kill Participation: Should be 50%+ for most roles, 60%+ for supports/junglers
- Damage: ADCs/Mids should top damage charts. 20k+ is solid, 30k+ is carrying
- Vision Score: Supports should have 40+, junglers 30+, others 20+
- CS (farm): Laners should aim for 7+ CS/min. Supports/Junglers have lower CS
- Deaths: Under 4 is safe, 5-7 is normal, 8+ is feeding

## HOW TO ANALYZE

**For Champion Recommendations:**
- Look at 5+ games minimum for meaningful conclusions
- Consider KDA AND win rate together, not just wins
- Factor in damage output - are they actually performing well?
- Compare to their performance on other champions
- Note role consistency - playing off-role affects performance

**For Player Comparisons:**
- Normalize by games played (averages, not totals)
- Consider role differences (supports have fewer kills, more assists)
- Look at multiple metrics, not just one stat

**For "Stay Away From" Questions:**
- Require 5+ games AND poor KDA (<2.0) AND low win rate (<40%)
- A single loss doesn't mean avoid the champion
- Check if they were autofilled (wrong role)
- Consider if they were learning the champ

## RESPONSE FORMAT

- **NO TABLES** - tables don't render properly, use conversational text instead
- **NO MARKDOWN** - avoid headers, bullet lists, bold/italic. Just write naturally
- **NO CODE BLOCKS** - don't show JSON or code snippets
- Be conversational and helpful, like chatting with a friend
- Lead with the key insight, then support with data
- Use percentages and averages, not raw counts
- Round numbers sensibly (52% not 52.38461538%)
- Keep responses focused and concise - 2-4 paragraphs max
- Write in flowing sentences, not lists of stats

Example good response:
"Honestly, Alessio should probably stick to Smolder - he's got a 67% win rate over 12 games with a solid 3.2 KDA. His Jinx games have been rough though, only winning 2 of 8 with a lot of deaths. The data suggests he's better on scaling mages than traditional ADCs."

Example bad response:
"| Champion | Games | Win Rate |
|----------|-------|----------|
| Smolder | 12 | 67% |"

The players ("The Boys"):
- SomeBees
- BananaJamHands
- Storklord
- pRiNcEsSFiStY
- Alessio

QUEUE TYPES: 420=Ranked Solo, 440=Ranked Flex, 400=Normal Draft, 450=ARAM`;

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
