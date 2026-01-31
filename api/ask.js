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

    const systemPrompt = `You are BoyStats AI, an expert analyst for a League of Legends friend group called "The Boys". You have access to their match history and statistics. Be friendly, use gaming terminology, and give specific insights based on the data provided. Keep responses concise but informative. Use emojis sparingly for fun. If asked about something not in the data, say so.

The players in "The Boys" are:
- SomeBees 🐝
- BananaJamHands 🍌
- Storklord 🦩
- pRiNcEsSFiStY 👸
- Alessio 🧙`;

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
                temperature: 0.7,
                maxOutputTokens: 1024,
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
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';

    res.json({ answer });
  } catch (err) {
    console.error('Ask AI error:', err);
    res.status(500).json({ error: err.message });
  }
}

function buildContext(stats, matches) {
  let context = '';

  // Add player stats summary
  if (stats?.players) {
    context += '## Player Statistics (filtered view)\n\n';
    for (const [name, s] of Object.entries(stats.players)) {
      if (s.games === 0) continue;
      const kda = ((s.kills + s.assists) / Math.max(s.deaths, 1)).toFixed(2);
      const wr = ((s.wins / s.games) * 100).toFixed(0);
      const avgKP = ((s.totalKP / s.games) * 100).toFixed(0);
      const avgDmg = Math.round(s.damage / s.games);

      context += `**${name}**: ${s.games} games, ${wr}% WR, ${kda} KDA, ${avgKP}% KP, ${avgDmg} avg dmg\n`;
      context += `  Kills: ${s.kills}, Deaths: ${s.deaths}, Assists: ${s.assists}\n`;
      context += `  Pentas: ${s.pentas}, Quadras: ${s.quadras}, First Bloods: ${s.firstBloods}\n`;

      // Top champions
      const topChamps = Object.entries(s.champions || {})
        .sort((a, b) => b[1].games - a[1].games)
        .slice(0, 3)
        .map(([champ, data]) => `${champ}(${data.games}g, ${((data.wins/data.games)*100).toFixed(0)}%)`);
      if (topChamps.length > 0) {
        context += `  Top champs: ${topChamps.join(', ')}\n`;
      }
      context += '\n';
    }
  }

  // Add duo stats
  if (stats?.duos) {
    context += '## Duo Statistics\n\n';
    const sortedDuos = Object.entries(stats.duos)
      .filter(([, d]) => d.games >= 2)
      .sort((a, b) => b[1].games - a[1].games)
      .slice(0, 10);

    for (const [key, duo] of sortedDuos) {
      const wr = ((duo.wins / duo.games) * 100).toFixed(0);
      context += `${duo.players.join(' + ')}: ${duo.games} games, ${wr}% WR\n`;
    }
    context += '\n';
  }

  // Add overall stats
  if (stats?.totalGames) {
    const overallWR = ((stats.totalWins / stats.totalGames) * 100).toFixed(0);
    context += `## Overall: ${stats.totalGames} games, ${stats.totalWins} wins (${overallWR}% WR)\n\n`;
  }

  // Add recent matches summary (last 10)
  if (matches && matches.length > 0) {
    context += '## Recent Matches (last 10)\n\n';
    const recentMatches = matches.slice(0, 10);

    for (const match of recentMatches) {
      const boys = match.participants?.filter(p => p.isBoy) || [];
      if (boys.length === 0) continue;

      const didWin = boys[0]?.win ? 'WIN' : 'LOSS';
      const date = new Date(match.gameCreation).toLocaleDateString();
      const duration = Math.floor(match.gameDuration / 60);

      const boySummaries = boys.map(p => {
        const name = p.boyName || p.riotIdGameName;
        return `${name}(${p.championName} ${p.kills}/${p.deaths}/${p.assists})`;
      }).join(', ');

      context += `${date} - ${didWin} (${duration}min): ${boySummaries}\n`;
    }
  }

  return context;
}
