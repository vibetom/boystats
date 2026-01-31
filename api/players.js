const RIOT_API_KEY = process.env.RIOT_API_KEY;
const AMERICAS_BASE = 'https://americas.api.riotgames.com';
const NA1_BASE = 'https://na1.api.riotgames.com';

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

async function getSummonerByPuuid(puuid) {
  const url = `${NA1_BASE}/lol/summoner/v4/summoners/by-puuid/${puuid}`;
  return riotFetch(url);
}

async function getRankedStats(summonerId) {
  const url = `${NA1_BASE}/lol/league/v4/entries/by-summoner/${summonerId}`;
  return riotFetch(url);
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const players = [];

    for (const boy of THE_BOYS) {
      try {
        const account = await getAccountByRiotId(boy.gameName, boy.tagLine);
        await delay(50);

        const summoner = await getSummonerByPuuid(account.puuid);
        await delay(50);

        const rankedStats = await getRankedStats(summoner.id);
        await delay(50);

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
}
