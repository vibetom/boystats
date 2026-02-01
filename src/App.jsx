import React, { useState, useMemo, useEffect } from 'react';

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_BASE = '/api';

const THE_BOYS = [
  { gameName: "SomeBees", tagLine: "NA1", emoji: "🐝" },
  { gameName: "BananaJamHands", tagLine: "NA1", emoji: "🍌" },
  { gameName: "Storklord", tagLine: "NA1", emoji: "🦩" },
  { gameName: "pRiNcEsSFiStY", tagLine: "NA1", emoji: "👸" },
  { gameName: "Alessio", tagLine: "NA1", emoji: "🧙" },
];

const PLAYER_COLORS = {
  "SomeBees": "#fbbf24",
  "BananaJamHands": "#34d399",
  "Storklord": "#60a5fa",
  "pRiNcEsSFiStY": "#f472b6",
  "Alessio": "#a78bfa",
};

const PLAYER_EMOJIS = {
  "SomeBees": "🐝",
  "BananaJamHands": "🍌",
  "Storklord": "🦩",
  "pRiNcEsSFiStY": "👸",
  "Alessio": "🧙",
};

// ============================================================================
// UTILITIES
// ============================================================================

const QUEUE_NAMES = { 420: "Ranked Solo", 440: "Ranked Flex", 400: "Normal Draft", 450: "ARAM", 490: "Quickplay", 1700: "Swiftplay", 830: "Co-op AI", 840: "Co-op AI", 850: "Co-op AI", 900: "URF", 1900: "URF" };
const ROLE_SHORT = { TOP: "TOP", JUNGLE: "JNG", MIDDLE: "MID", BOTTOM: "ADC", UTILITY: "SUP", "": "" };

const formatDuration = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
const formatNumber = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString();

const TAG_COLORS = {
  amber: 'bg-amber-900 border-amber-600 text-amber-200',
  red: 'bg-red-900 border-red-600 text-red-200',
  emerald: 'bg-emerald-900 border-emerald-600 text-emerald-200',
  blue: 'bg-blue-900 border-blue-600 text-blue-200',
  purple: 'bg-purple-900 border-purple-600 text-purple-200',
  cyan: 'bg-cyan-900 border-cyan-600 text-cyan-200',
  pink: 'bg-pink-900 border-pink-600 text-pink-200',
  orange: 'bg-orange-900 border-orange-600 text-orange-200',
  yellow: 'bg-yellow-900 border-yellow-600 text-yellow-200',
  slate: 'bg-slate-800 border-slate-600 text-slate-300',
};

// ============================================================================
// STATS ENGINE
// ============================================================================

function calculateAllStats(matches, selectedPlayers) {
  const players = {};
  const duos = {};
  const recentGames = [];
  let totalGames = 0, totalWins = 0;

  selectedPlayers.forEach(name => {
    players[name] = {
      games: 0, wins: 0, kills: 0, deaths: 0, assists: 0,
      cs: 0, gold: 0, damage: 0, damageTaken: 0,
      vision: 0, cc: 0, healing: 0, shielding: 0,
      doubles: 0, triples: 0, quadras: 0, pentas: 0,
      firstBloods: 0, soloKills: 0, perfectGames: 0, comebacks: 0,
      surrenders: 0, longestSpree: 0, totalKP: 0, totalDmgShare: 0, totalTime: 0,
      champions: {}, roles: {},
    };
  });

  matches.forEach(match => {
    const boysInGame = match.participants.filter(p => p.isBoy && selectedPlayers.includes(p.boyName || p.riotIdGameName));
    if (boysInGame.length === 0) return;

    // Get win status from first boy
    const didWin = boysInGame[0]?.win || false;

    totalGames++;
    if (didWin) totalWins++;

    if (recentGames.length < 20) {
      recentGames.push({ won: didWin, players: boysInGame.map(p => p.boyName || p.riotIdGameName) });
    }

    const teamKills = match.participants
      .filter(p => p.teamId === boysInGame[0]?.teamId)
      .reduce((sum, p) => sum + p.kills, 0);

    boysInGame.forEach(p => {
      const name = p.boyName || p.riotIdGameName;
      const s = players[name];
      if (!s) return;

      s.games++;
      if (p.win) s.wins++;
      s.kills += p.kills;
      s.deaths += p.deaths;
      s.assists += p.assists;
      s.cs += (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0);
      s.gold += p.goldEarned || 0;
      s.damage += p.totalDamageDealtToChampions || 0;
      s.damageTaken += p.totalDamageTaken || 0;
      s.vision += p.visionScore || 0;
      s.cc += p.timeCCingOthers || 0;
      s.healing += p.totalHealsOnTeammates || 0;
      s.shielding += p.totalDamageShieldedOnTeammates || 0;
      s.doubles += p.doubleKills || 0;
      s.triples += p.tripleKills || 0;
      s.quadras += p.quadraKills || 0;
      s.pentas += p.pentaKills || 0;
      if (p.firstBloodKill) s.firstBloods++;
      s.soloKills += p.challenges?.soloKills || 0;
      if (p.deaths === 0 && p.win) s.perfectGames++;
      if (p.challenges?.hadOpenNexus && p.win) s.comebacks++;
      if (p.gameEndedInSurrender) s.surrenders++;
      if ((p.largestKillingSpree || 0) > s.longestSpree) s.longestSpree = p.largestKillingSpree;

      // Calculate KP
      const kp = teamKills > 0 ? (p.kills + p.assists) / teamKills : 0;
      s.totalKP += kp;

      // Calculate damage share
      const teamDamage = match.participants
        .filter(x => x.teamId === p.teamId)
        .reduce((sum, x) => sum + (x.totalDamageDealtToChampions || 0), 0);
      const dmgShare = teamDamage > 0 ? (p.totalDamageDealtToChampions || 0) / teamDamage : 0;
      s.totalDmgShare += dmgShare;

      s.totalTime += match.gameDuration || 0;

      // Champion stats
      if (p.championName) {
        if (!s.champions[p.championName]) s.champions[p.championName] = { games: 0, wins: 0 };
        s.champions[p.championName].games++;
        if (p.win) s.champions[p.championName].wins++;
      }

      // Role stats
      if (p.teamPosition && p.teamPosition !== 'NONE' && p.teamPosition !== '') {
        s.roles[p.teamPosition] = (s.roles[p.teamPosition] || 0) + 1;
      }
    });

    // Duo stats
    const names = [...new Set(boysInGame.map(p => p.boyName || p.riotIdGameName))].sort();
    if (names.length >= 2) {
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const key = `${names[i]}+${names[j]}`;
          if (!duos[key]) duos[key] = { games: 0, wins: 0, players: [names[i], names[j]] };
          duos[key].games++;
          if (didWin) duos[key].wins++;
        }
      }
    }
  });

  return { players, duos, totalGames, totalWins, recentGames };
}

// ============================================================================
// PLAYER TAGS
// ============================================================================

const TAG_DEFINITIONS = {
  'KDA Demon': { icon: '😇', color: 'emerald', desc: 'Averaging 4+ KDA' },
  'Clean Player': { icon: '✨', color: 'cyan', desc: 'Solid 3+ KDA' },
  'Death Prone': { icon: '💀', color: 'red', desc: 'Below 1.5 KDA' },
  'Winner': { icon: '🏆', color: 'amber', desc: '60%+ win rate' },
  'Climbing': { icon: '📈', color: 'emerald', desc: '55%+ win rate' },
  'Struggling': { icon: '📉', color: 'red', desc: 'Below 40% win rate' },
  'Slayer': { icon: '⚔️', color: 'red', desc: '9+ kills per game' },
  'Team Player': { icon: '🤝', color: 'blue', desc: '12+ assists per game' },
  'Carry Potential': { icon: '💪', color: 'orange', desc: '30%+ of team damage' },
  'Always Involved': { icon: '👑', color: 'amber', desc: '65%+ kill participation' },
  'Vision God': { icon: '👁️', color: 'blue', desc: '50+ vision score per game' },
  'Pentakill Legend': { icon: '🏆', color: 'amber', desc: 'Has scored pentakills' },
  'Survivor': { icon: '🛡️', color: 'emerald', desc: 'Under 3 deaths per game' },
  'Frontliner': { icon: '🛡️', color: 'blue', desc: 'Takes tons of damage' },
  'Guardian': { icon: '💗', color: 'pink', desc: 'High healing and shielding' },
};

function generatePlayerTags(name, stats) {
  const s = stats;
  if (s.games < 2) return [];

  const tags = [];
  const kda = (s.kills + s.assists) / Math.max(s.deaths, 1);
  const avgDeaths = s.deaths / s.games;
  const avgAssists = s.assists / s.games;
  const winRate = s.wins / s.games;
  const avgKP = s.totalKP / s.games;
  const avgDmgShare = s.totalDmgShare / s.games;
  const avgVision = s.vision / s.games;

  if (kda >= 4) tags.push('KDA Demon');
  else if (kda >= 3) tags.push('Clean Player');
  else if (kda < 1.5) tags.push('Death Prone');

  if (winRate >= 0.6) tags.push('Winner');
  else if (winRate >= 0.55) tags.push('Climbing');
  else if (winRate < 0.4) tags.push('Struggling');

  if (avgDeaths < 3) tags.push('Survivor');
  if (avgAssists >= 12) tags.push('Team Player');
  if (avgDmgShare >= 0.3) tags.push('Carry Potential');
  if (avgKP >= 0.65) tags.push('Always Involved');
  if (avgVision >= 50) tags.push('Vision God');
  if (s.pentas > 0) tags.push('Pentakill Legend');
  if (s.damageTaken / s.games > 25000) tags.push('Frontliner');
  if ((s.healing + s.shielding) / s.games > 5000) tags.push('Guardian');

  return tags.slice(0, 3).map(label => ({ label, ...TAG_DEFINITIONS[label] })).filter(t => t.icon);
}

// ============================================================================
// MATCH INSIGHTS
// ============================================================================

function generateMatchInsights(match) {
  const boys = match.participants.filter(p => p.isBoy);
  const priorityTags = []; // Always show these
  const normalTags = [];   // Show if room
  const lowPriorityTags = []; // Only if nothing else

  if (boys.length === 0) return { tags: [], insights: [] };

  const didWin = boys[0]?.win;
  const teamId = boys[0]?.teamId;
  const ourTeam = match.participants.filter(p => p.teamId === teamId);
  const enemyTeam = match.participants.filter(p => p.teamId !== teamId);
  const teamKills = ourTeam.reduce((sum, p) => sum + p.kills, 0);
  const teamDamage = ourTeam.reduce((sum, p) => sum + (p.totalDamageDealtToChampions || 0), 0);
  const gameDurationMins = match.gameDuration / 60;

  // Calculate stats for each boy
  const boysWithStats = boys.map(p => ({
    ...p,
    name: p.boyName || p.riotIdGameName,
    kda: (p.kills + p.assists) / Math.max(p.deaths, 1),
    kp: teamKills > 0 ? (p.kills + p.assists) / teamKills : 0,
    dmgShare: teamDamage > 0 ? (p.totalDamageDealtToChampions || 0) / teamDamage : 0,
    csPerMin: gameDurationMins > 0 ? ((p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0)) / gameDurationMins : 0,
  }));

  // Track if player has a "positive" tag (for Rough Game exclusion)
  const playersWithPositiveTags = new Set();

  // === PRIORITY TAGS (Always show if applicable) ===

  // MVP - best KDA with decent participation
  const sortedByKDA = [...boysWithStats].sort((a, b) => b.kda - a.kda);
  if (sortedByKDA.length > 0 && sortedByKDA[0].kda >= 2.5 && sortedByKDA[0].kp > 0.25) {
    priorityTags.push({ label: 'MVP', player: sortedByKDA[0].name, color: 'amber', icon: '👑' });
    playersWithPositiveTags.add(sortedByKDA[0].name);
  }

  // Multi-kills (always show)
  boys.forEach(p => {
    const name = p.boyName || p.riotIdGameName;
    if (p.pentaKills > 0) {
      priorityTags.push({ label: 'PENTAKILL', player: name, color: 'amber', icon: '🏆' });
      playersWithPositiveTags.add(name);
    }
    if (p.quadraKills > 0) {
      priorityTags.push({ label: 'Quadra', player: name, color: 'purple', icon: '💎' });
      playersWithPositiveTags.add(name);
    }
    if (p.tripleKills > 0) {
      priorityTags.push({ label: 'Triple', player: name, color: 'blue', icon: '🔥' });
      playersWithPositiveTags.add(name);
    }
  });

  // Perfect game (always show)
  boys.forEach(p => {
    const name = p.boyName || p.riotIdGameName;
    if (p.deaths === 0 && (p.kills + p.assists) >= 5) {
      priorityTags.push({ label: 'Perfect', player: name, color: 'cyan', icon: '✨' });
      playersWithPositiveTags.add(name);
    }
  });

  // === NORMAL TAGS ===

  // Kill Leader - only ONE person, must have most kills among boys
  const sortedByKills = [...boysWithStats].sort((a, b) => b.kills - a.kills);
  if (sortedByKills.length > 0 && sortedByKills[0].kills >= 8) {
    // Only give if they have significantly more than others or are the clear leader
    const leader = sortedByKills[0];
    const secondMost = sortedByKills[1]?.kills || 0;
    if (leader.kills > secondMost || sortedByKills.length === 1) {
      normalTags.push({ label: 'Kill Leader', player: leader.name, color: 'red', icon: '⚔️' });
      playersWithPositiveTags.add(leader.name);
    }
  }

  // Damage Carry - highest damage share
  const sortedByDmg = [...boysWithStats].sort((a, b) => b.dmgShare - a.dmgShare);
  if (sortedByDmg.length > 0 && sortedByDmg[0].dmgShare >= 0.35) {
    normalTags.push({ label: 'Damage Carry', player: sortedByDmg[0].name, color: 'orange', icon: '💥' });
    playersWithPositiveTags.add(sortedByDmg[0].name);
  }

  // Tank/Frontline - took a lot of damage
  boys.forEach(p => {
    const name = p.boyName || p.riotIdGameName;
    if ((p.totalDamageTaken || 0) >= 40000) {
      normalTags.push({ label: 'Frontline', player: name, color: 'blue', icon: '🛡️' });
      playersWithPositiveTags.add(name);
    }
  });

  // Vision MVP - high vision score
  const sortedByVision = [...boysWithStats].sort((a, b) => (b.visionScore || 0) - (a.visionScore || 0));
  if (sortedByVision.length > 0 && (sortedByVision[0].visionScore || 0) >= 50) {
    normalTags.push({ label: 'Vision King', player: sortedByVision[0].name, color: 'purple', icon: '👁️' });
  }

  // Farm God - high CS/min
  boysWithStats.forEach(p => {
    if (p.csPerMin >= 8 && match.queueId !== 450) { // Not ARAM
      normalTags.push({ label: 'Farm God', player: p.name, color: 'yellow', icon: '🌾' });
    }
  });

  // Assist King - lots of assists
  const sortedByAssists = [...boysWithStats].sort((a, b) => b.assists - a.assists);
  if (sortedByAssists.length > 0 && sortedByAssists[0].assists >= 15) {
    normalTags.push({ label: 'Assist King', player: sortedByAssists[0].name, color: 'emerald', icon: '🤝' });
    playersWithPositiveTags.add(sortedByAssists[0].name);
  }

  // CC Machine - lots of CC
  boys.forEach(p => {
    const name = p.boyName || p.riotIdGameName;
    if ((p.timeCCingOthers || 0) >= 60) {
      normalTags.push({ label: 'CC Machine', player: name, color: 'purple', icon: '⛓️' });
    }
  });

  // Healer/Support carry
  boys.forEach(p => {
    const name = p.boyName || p.riotIdGameName;
    const healShield = (p.totalHealsOnTeammates || 0) + (p.totalDamageShieldedOnTeammates || 0);
    if (healShield >= 10000) {
      normalTags.push({ label: 'Guardian', player: name, color: 'pink', icon: '💗' });
    }
  });

  // Solo Killer - lots of 1v1s
  boys.forEach(p => {
    const name = p.boyName || p.riotIdGameName;
    if (p.challenges?.soloKills >= 5) {
      normalTags.push({ label: 'Duelist', player: name, color: 'red', icon: '🗡️' });
      playersWithPositiveTags.add(name);
    }
  });

  // Killing Spree
  boys.forEach(p => {
    const name = p.boyName || p.riotIdGameName;
    if ((p.largestKillingSpree || 0) >= 7) {
      normalTags.push({ label: 'Unstoppable', player: name, color: 'orange', icon: '🔥' });
      playersWithPositiveTags.add(name);
    }
  });

  // Comeback king
  if (didWin && boys.some(p => p.challenges?.hadOpenNexus)) {
    normalTags.push({ label: 'Comeback', color: 'emerald', icon: '🔄' });
  }

  // Stomp/Dominated
  if (didWin && gameDurationMins < 25 && teamKills >= 30) {
    normalTags.push({ label: 'Stomp', color: 'emerald', icon: '👊' });
  }

  // Close Game
  if (gameDurationMins >= 35) {
    normalTags.push({ label: 'Marathon', color: 'slate', icon: '⏱️' });
  }

  // Surrender
  if (match.participants.some(p => p.gameEndedInSurrender)) {
    if (didWin) {
      normalTags.push({ label: 'FF@15', color: 'emerald', icon: '🏳️' });
    }
  }

  // === NEGATIVE TAGS (Only show if player doesn't have positive tags) ===
  boys.forEach(p => {
    const name = p.boyName || p.riotIdGameName;
    if (p.deaths >= 10 && !playersWithPositiveTags.has(name)) {
      normalTags.push({ label: 'Rough Game', player: name, color: 'red', icon: '💀' });
    }
    if (p.deaths >= 8 && p.kills <= 2 && !playersWithPositiveTags.has(name)) {
      normalTags.push({ label: 'Struggle Bus', player: name, color: 'red', icon: '🚌' });
    }
  });

  // Inted (very bad game, only if no positive tags)
  boys.forEach(p => {
    const name = p.boyName || p.riotIdGameName;
    const kda = (p.kills + p.assists) / Math.max(p.deaths, 1);
    if (kda < 0.5 && p.deaths >= 8 && !playersWithPositiveTags.has(name)) {
      normalTags.push({ label: 'Oops', player: name, color: 'red', icon: '😬' });
    }
  });

  // === LOW PRIORITY TAGS ===

  // First Blood (low priority)
  boys.forEach(p => {
    const name = p.boyName || p.riotIdGameName;
    if (p.firstBloodKill) {
      lowPriorityTags.push({ label: 'First Blood', player: name, color: 'red', icon: '🩸' });
    }
  });

  // Squad size tags (low priority)
  if (boys.length === 5) lowPriorityTags.push({ label: 'Full Squad', color: 'amber', icon: '👥' });
  else if (boys.length === 4) lowPriorityTags.push({ label: '4-Stack', color: 'blue', icon: '👥' });
  else if (boys.length === 1) lowPriorityTags.push({ label: 'Solo Queue', color: 'slate', icon: '🎮' });

  // Combine tags with priority
  const allTags = [...priorityTags, ...normalTags, ...lowPriorityTags];

  // Remove duplicates
  const uniqueTags = [];
  const seen = new Set();
  allTags.forEach(t => {
    const key = t.label + (t.player || '');
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTags.push(t);
    }
  });

  return { tags: uniqueTags.slice(0, 8), insights: [] };
}

// ============================================================================
// TOOLTIP COMPONENT
// ============================================================================

function Tooltip({ children, text }) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative inline-block">
      <div onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} className="cursor-help">
        {children}
      </div>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 border-2 border-slate-600 rounded-lg text-sm text-white whitespace-nowrap shadow-xl">
          {text}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MATCH CARD
// ============================================================================

function MatchCard({ match }) {
  const [expanded, setExpanded] = useState(false);
  const { tags } = useMemo(() => generateMatchInsights(match), [match]);
  const boys = match.participants.filter(p => p.isBoy);
  const isARAM = match.queueId === 450;

  if (boys.length === 0) return null;

  const didWin = boys[0]?.win;
  const teamId = boys[0]?.teamId;
  const ourTeam = match.participants.filter(p => p.teamId === teamId);
  const enemyTeam = match.participants.filter(p => p.teamId !== teamId);

  return (
    <div className={`rounded-2xl border-2 ${didWin ? 'bg-emerald-950 border-emerald-700' : 'bg-red-950 border-red-800'}`}>
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center font-black ${didWin ? 'bg-emerald-600' : 'bg-red-600'}`}>
              <span className="text-lg">{didWin ? 'W' : 'L'}</span>
              <span className="text-xs opacity-80">{formatDuration(match.gameDuration)}</span>
            </div>
            <div>
              <div className="font-bold text-white text-lg">{QUEUE_NAMES[match.queueId] || match.gameMode}</div>
              <div className="text-slate-400 text-sm">{new Date(match.gameCreation).toLocaleDateString()}</div>
            </div>
          </div>
          <div className="text-2xl text-slate-400">{expanded ? '▼' : '▶'}</div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {tags.map((t, i) => (
              <span key={i} className={`px-2 py-1 rounded text-xs font-bold border ${TAG_COLORS[t.color]}`}>
                {t.icon} {t.label}{t.player ? ` (${t.player})` : ''}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {boys.map((p, i) => {
            const name = p.boyName || p.riotIdGameName;
            const color = PLAYER_COLORS[name];
            const emoji = PLAYER_EMOJIS[name];
            return (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl border-2"
                style={{ background: `${color}20`, borderColor: `${color}60` }}>
                <span>{emoji}</span>
                <span className="font-bold" style={{ color }}>{name}</span>
                <span className="text-slate-300">{p.championName}</span>
                <span className="font-mono text-white">{p.kills}/{p.deaths}/{p.assists}</span>
              </div>
            );
          })}
        </div>
      </div>

      {expanded && (
        <div className="border-t-2 border-slate-700 p-4">
          {!isARAM ? (
            <div className="space-y-2">
              <div className="text-amber-400 font-bold text-sm mb-2">Lane Matchups</div>
              {ourTeam.map((ally, i) => {
                const enemy = enemyTeam.find(e => e.teamPosition === ally.teamPosition);
                if (!enemy) return null;
                const name = ally.boyName || ally.riotIdGameName;
                const color = ally.isBoy ? PLAYER_COLORS[name] : null;
                const emoji = ally.isBoy ? PLAYER_EMOJIS[name] : null;

                return (
                  <div key={i} className="flex items-center gap-2 p-2 bg-slate-900 rounded-lg border border-slate-700">
                    <div className="w-10 text-center text-xs font-bold text-slate-400">{ROLE_SHORT[ally.teamPosition] || ''}</div>
                    <div className={`flex-1 flex items-center gap-2 p-2 rounded-lg ${ally.isBoy ? 'border-2' : 'border border-slate-700'}`}
                      style={ally.isBoy ? { borderColor: `${color}60`, background: `${color}15` } : {}}>
                      {ally.isBoy && <span>{emoji}</span>}
                      <span className={`font-bold ${ally.isBoy ? '' : 'text-slate-400'}`} style={ally.isBoy ? { color } : {}}>
                        {ally.isBoy ? name : ally.riotIdGameName}
                      </span>
                      <span className="text-slate-400 text-sm">{ally.championName}</span>
                      <span className="font-mono text-white ml-auto">{ally.kills}/{ally.deaths}/{ally.assists}</span>
                    </div>
                    <div className="flex-1 flex items-center gap-2 p-2 rounded-lg bg-red-950/50 border border-red-900">
                      <span className="text-red-300 font-medium">{enemy.riotIdGameName}</span>
                      <span className="text-slate-400 text-sm">{enemy.championName}</span>
                      <span className="font-mono text-red-200 ml-auto">{enemy.kills}/{enemy.deaths}/{enemy.assists}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-emerald-400 text-xs font-bold mb-2">Our Team</div>
                {ourTeam.map((p, i) => {
                  const name = p.boyName || p.riotIdGameName;
                  const color = p.isBoy ? PLAYER_COLORS[name] : null;
                  const emoji = p.isBoy ? PLAYER_EMOJIS[name] : null;
                  return (
                    <div key={i} className={`flex items-center gap-2 p-2 mb-1 rounded-lg ${p.isBoy ? 'border' : 'bg-slate-900/50'}`}
                      style={p.isBoy ? { borderColor: `${color}60`, background: `${color}15` } : {}}>
                      {p.isBoy && <span>{emoji}</span>}
                      <span className={p.isBoy ? 'font-bold' : 'text-slate-400'} style={p.isBoy ? { color } : {}}>
                        {p.isBoy ? name : p.riotIdGameName}
                      </span>
                      <span className="text-slate-400 text-sm">{p.championName}</span>
                      <span className="font-mono text-white ml-auto text-sm">{p.kills}/{p.deaths}/{p.assists}</span>
                    </div>
                  );
                })}
              </div>
              <div>
                <div className="text-red-400 text-xs font-bold mb-2">Enemy Team</div>
                {enemyTeam.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 mb-1 rounded-lg bg-red-950/50">
                    <span className="text-red-300">{p.riotIdGameName}</span>
                    <span className="text-slate-400 text-sm">{p.championName}</span>
                    <span className="font-mono text-red-200 ml-auto text-sm">{p.kills}/{p.deaths}/{p.assists}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AI QUERY COMPONENT
// ============================================================================

function AskAI({ stats, matches }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);

  const exampleQuestions = [
    "Who's the best player right now?",
    "Which duo has the best synergy?",
    "Who dies the most?",
    "What's our best game mode?",
    "Who should play more ranked?",
    "Roast our stats",
  ];

  const askQuestion = async (q) => {
    const questionText = q || question;
    if (!questionText.trim()) return;

    setLoading(true);
    setError(null);
    setAnswer('');

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: questionText,
          stats: {
            players: stats.players,
            duos: stats.duos,
            totalGames: stats.totalGames,
            totalWins: stats.totalWins,
          },
          matches: matches.slice(0, 20), // Send recent matches for context
        }),
      });

      const data = await response.json();

      if (data.error) {
        setError(data.error);
      } else {
        setAnswer(data.answer);
        setHistory(prev => [...prev, { question: questionText, answer: data.answer }]);
      }
    } catch (err) {
      setError(`Failed to get AI response: ${err.message}`);
    } finally {
      setLoading(false);
      setQuestion('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 rounded-2xl p-6 border-2 border-purple-700">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-4xl">🤖</span>
          <div>
            <h2 className="text-xl font-bold text-purple-400">Ask BoyStats AI</h2>
            <p className="text-slate-400 text-sm">Ask anything about The Boys' stats and performance</p>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && askQuestion()}
            placeholder="Ask a question about your squad..."
            className="flex-1 bg-slate-800 border-2 border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
            disabled={loading}
          />
          <button
            onClick={() => askQuestion()}
            disabled={loading || !question.trim()}
            className={`px-6 py-3 rounded-xl font-bold ${
              loading || !question.trim()
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-purple-600 text-white hover:bg-purple-500'
            }`}
          >
            {loading ? '...' : 'Ask'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {exampleQuestions.map((q, i) => (
            <button
              key={i}
              onClick={() => askQuestion(q)}
              disabled={loading}
              className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-300 hover:border-purple-500 hover:text-purple-300 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="bg-slate-900 rounded-2xl p-6 border-2 border-slate-700">
          <div className="flex items-center gap-3">
            <div className="animate-spin text-2xl">🤔</div>
            <span className="text-slate-400">Analyzing your stats...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-950 rounded-2xl p-6 border-2 border-red-700">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <div className="text-red-400 font-bold">Error</div>
              <div className="text-red-200">{error}</div>
            </div>
          </div>
        </div>
      )}

      {answer && !loading && (
        <div className="bg-slate-900 rounded-2xl p-6 border-2 border-emerald-700">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🤖</span>
            <div className="flex-1">
              <div className="text-emerald-400 font-bold mb-2">BoyStats AI</div>
              <div className="text-white whitespace-pre-wrap">{answer}</div>
            </div>
          </div>
        </div>
      )}

      {history.length > 1 && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-slate-400">Previous Questions</h3>
          {history.slice(0, -1).reverse().map((item, i) => (
            <div key={i} className="bg-slate-900 rounded-xl p-4 border border-slate-700">
              <div className="text-purple-400 text-sm mb-2">Q: {item.question}</div>
              <div className="text-slate-300 text-sm">{item.answer}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LOADING COMPONENT
// ============================================================================

function LoadingScreen({ message, progress, subMessage }) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center max-w-md px-4">
        <div className="text-6xl mb-4 animate-bounce">🎮</div>
        <h1 className="text-3xl font-black text-amber-400 mb-2">BOYSTATS</h1>
        <p className="text-slate-400 mb-2">{message}</p>
        {subMessage && <p className="text-slate-500 text-sm mb-4">{subMessage}</p>}
        {progress !== undefined && progress > 0 && (
          <div className="w-full bg-slate-800 rounded-full h-3 mb-2 overflow-hidden">
            <div
              className="bg-amber-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        )}
        {progress !== undefined && progress > 0 ? (
          <p className="text-amber-400 font-bold">{Math.round(progress)}%</p>
        ) : (
          <div className="mt-4 flex justify-center gap-1">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-3 h-3 bg-amber-400 rounded-full animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================

// Cache keys for localStorage
const CACHE_KEY_MATCHES = 'boystats_matches';
const CACHE_KEY_MATCH_IDS = 'boystats_matchIds';
const CACHE_KEY_PLAYERS = 'boystats_players';
const CACHE_KEY_TIMESTAMP = 'boystats_lastUpdated';
const CACHE_KEY_BACKUPS = 'boystats_backups';
const MAX_BACKUPS = 3;

function loadFromCache() {
  try {
    const matchesJson = localStorage.getItem(CACHE_KEY_MATCHES);
    const matchIdsJson = localStorage.getItem(CACHE_KEY_MATCH_IDS);
    const playersJson = localStorage.getItem(CACHE_KEY_PLAYERS);
    const timestamp = localStorage.getItem(CACHE_KEY_TIMESTAMP);

    if (matchesJson && playersJson && timestamp) {
      return {
        matches: JSON.parse(matchesJson),
        matchIds: matchIdsJson ? JSON.parse(matchIdsJson) : [],
        players: JSON.parse(playersJson),
        lastUpdated: parseInt(timestamp),
      };
    }
  } catch (err) {
    console.error('Failed to load from cache:', err);
  }
  return null;
}

function saveToCache(matches, matchIds, players) {
  try {
    localStorage.setItem(CACHE_KEY_MATCHES, JSON.stringify(matches));
    localStorage.setItem(CACHE_KEY_MATCH_IDS, JSON.stringify(matchIds));
    localStorage.setItem(CACHE_KEY_PLAYERS, JSON.stringify(players));
    localStorage.setItem(CACHE_KEY_TIMESTAMP, Date.now().toString());
  } catch (err) {
    console.error('Failed to save to cache:', err);
  }
}

function createBackup() {
  try {
    const matchesJson = localStorage.getItem(CACHE_KEY_MATCHES);
    const matchIdsJson = localStorage.getItem(CACHE_KEY_MATCH_IDS);
    const playersJson = localStorage.getItem(CACHE_KEY_PLAYERS);
    const timestamp = localStorage.getItem(CACHE_KEY_TIMESTAMP);

    if (!matchesJson) return null;

    const backupsJson = localStorage.getItem(CACHE_KEY_BACKUPS);
    const backups = backupsJson ? JSON.parse(backupsJson) : [];

    const newBackup = {
      id: Date.now(),
      timestamp: parseInt(timestamp) || Date.now(),
      matches: matchesJson,
      matchIds: matchIdsJson,
      players: playersJson,
      matchCount: JSON.parse(matchesJson).length,
    };

    backups.unshift(newBackup);
    // Keep only last N backups
    while (backups.length > MAX_BACKUPS) {
      backups.pop();
    }

    localStorage.setItem(CACHE_KEY_BACKUPS, JSON.stringify(backups));
    return newBackup.id;
  } catch (err) {
    console.error('Failed to create backup:', err);
    return null;
  }
}

function getBackups() {
  try {
    const backupsJson = localStorage.getItem(CACHE_KEY_BACKUPS);
    if (!backupsJson) return [];
    const backups = JSON.parse(backupsJson);
    return backups.map(b => ({
      id: b.id,
      timestamp: b.timestamp,
      matchCount: b.matchCount,
    }));
  } catch (err) {
    return [];
  }
}

function restoreBackup(backupId) {
  try {
    const backupsJson = localStorage.getItem(CACHE_KEY_BACKUPS);
    if (!backupsJson) return false;
    const backups = JSON.parse(backupsJson);
    const backup = backups.find(b => b.id === backupId);
    if (!backup) return false;

    localStorage.setItem(CACHE_KEY_MATCHES, backup.matches);
    localStorage.setItem(CACHE_KEY_MATCH_IDS, backup.matchIds || '[]');
    localStorage.setItem(CACHE_KEY_PLAYERS, backup.players);
    localStorage.setItem(CACHE_KEY_TIMESTAMP, backup.timestamp.toString());
    return true;
  } catch (err) {
    console.error('Failed to restore backup:', err);
    return false;
  }
}

// Central cache functions (Vercel Blob)
async function loadFromCentralCache() {
  try {
    const res = await fetch(`${API_BASE}/cache`);
    if (!res.ok) {
      if (res.status === 404) {
        console.log('No central cache found');
        return null;
      }
      throw new Error(`Cache fetch failed: ${res.status}`);
    }
    const result = await res.json();
    if (result.exists && result.data) {
      console.log('Loaded from central cache:', {
        matches: result.data.matches?.length || 0,
        lastUpdated: result.data.updatedAt,
      });
      return {
        matches: result.data.matches || [],
        matchIds: result.data.matchIds || [],
        players: result.data.players || [],
        lastUpdated: result.data.timestamp,
      };
    }
  } catch (err) {
    console.error('Failed to load from central cache:', err);
  }
  return null;
}

async function saveToCentralCache(matches, matchIds, players) {
  try {
    console.log('Saving to central cache...', { matchCount: matches.length });
    const res = await fetch(`${API_BASE}/cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matches,
        matchIds,
        players,
        timestamp: Date.now(),
      }),
    });
    const result = await res.json();
    if (!res.ok) {
      console.error('Central cache save failed:', res.status, result);
      return false;
    }
    console.log('Central cache saved successfully:', result);
    return result.success;
  } catch (err) {
    console.error('Failed to save to central cache:', err);
    return false;
  }
}

function formatLastUpdated(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatBackupDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

export default function BoyStats() {
  const [matches, setMatches] = useState([]);
  const [cachedMatchIds, setCachedMatchIds] = useState(new Set());
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Connecting to server...');
  const [loadingSubMessage, setLoadingSubMessage] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [backups, setBackups] = useState([]);

  const [selectedPlayers, setSelectedPlayers] = useState(THE_BOYS.map(b => b.gameName));
  const [queueFilter, setQueueFilter] = useState(new Set(['420', '440', '400'])); // Solo, Flex, Normal by default
  const [resultFilter, setResultFilter] = useState('all');
  const [partySizeFilter, setPartySizeFilter] = useState(new Set(['2', '3', '4', '5'])); // Exclude solo queue by default
  const [timeFilter, setTimeFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('dashboard');

  // Fetch data from API - supports incremental mode
  const fetchData = async (incrementalMode = true, existingMatches = [], existingMatchIds = new Set()) => {
    try {
      // Check server health
      setLoadingMessage('Checking server...');
      const healthRes = await fetch(`${API_BASE}/health`);
      const health = await healthRes.json();

      if (!health.hasApiKey) {
        setError('Server is running but missing Riot API key. Check server/.env file.');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Fetch players
      setLoadingMessage('Fetching player data...');
      const playersRes = await fetch(`${API_BASE}/players`);
      const playersData = await playersRes.json();
      setPlayers(playersData);

      // Phase 1: Fetch all match IDs
      setLoadingMessage('Finding matches...');
      setLoadingSubMessage(incrementalMode ? 'Looking for new matches...' : 'Full refresh - fetching all match IDs...');
      setLoadingProgress(5);

      const matchIdsRes = await fetch(`${API_BASE}/match-ids?queues=420,440,400,450&pages=10`);
      const matchIdsData = await matchIdsRes.json();

      if (matchIdsData.error) {
        throw new Error(matchIdsData.error);
      }

      const allMatchIds = matchIdsData.matchIds || [];
      const playerMap = matchIdsData.players || {};

      console.log('Match IDs from API:', allMatchIds.length);

      // In incremental mode, filter to only new IDs
      let idsToFetch = allMatchIds;
      if (incrementalMode && existingMatchIds.size > 0) {
        idsToFetch = allMatchIds.filter(id => !existingMatchIds.has(id));
        console.log('New match IDs to fetch:', idsToFetch.length);
      }

      if (idsToFetch.length === 0) {
        setLoadingMessage('No new matches found');
        setLoadingSubMessage('Your data is up to date!');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      setLoadingProgress(15);
      setLoadingMessage(`Found ${idsToFetch.length} ${incrementalMode ? 'new ' : ''}matches`);
      setLoadingSubMessage('Fetching match details (this may take a while)...');

      // Phase 2: Fetch match details in smaller batches with conservative rate limiting
      const BATCH_SIZE = 5; // Smaller batches
      const allNewMatches = [];
      let processed = 0;
      let failedBatches = 0;

      for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
        const batchIds = idsToFetch.slice(i, i + BATCH_SIZE);

        try {
          const detailsRes = await fetch(`${API_BASE}/match-details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              matchIds: batchIds,
              players: playerMap,
            }),
          });

          if (!detailsRes.ok) {
            console.error('Batch response not ok:', detailsRes.status);
            failedBatches++;
            processed += batchIds.length;
            continue;
          }

          const detailsData = await detailsRes.json();

          if (detailsData.error) {
            console.error('Batch error from API:', detailsData.error);
            failedBatches++;
          }

          const batchNum = Math.floor(i/BATCH_SIZE) + 1;
          console.log(`Batch ${batchNum}:`, {
            processed: detailsData.processed,
            matchesFound: detailsData.matches?.length || 0,
          });

          if (detailsData.matches && detailsData.matches.length > 0) {
            allNewMatches.push(...detailsData.matches);
          }

          processed += batchIds.length;
          const progress = 15 + (processed / idsToFetch.length) * 85;
          setLoadingProgress(progress);
          setLoadingMessage(`Loading matches...`);
          const failedMsg = failedBatches > 0 ? ` (${failedBatches} batches need retry)` : '';
          setLoadingSubMessage(`${allNewMatches.length} new matches loaded (${processed}/${idsToFetch.length})${failedMsg}`);

        } catch (batchErr) {
          console.error('Batch fetch error:', batchErr);
          failedBatches++;
          processed += batchIds.length;
        }

        // More conservative delay - 1 second between batches
        if (i + BATCH_SIZE < idsToFetch.length) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // Combine with existing matches (in incremental mode)
      let finalMatches;
      let finalMatchIds;
      if (incrementalMode) {
        finalMatches = [...allNewMatches, ...existingMatches];
        finalMatchIds = new Set([...idsToFetch.filter(id => allNewMatches.some(m => m.matchId === id)), ...existingMatchIds]);
      } else {
        finalMatches = allNewMatches;
        finalMatchIds = new Set(allNewMatches.map(m => m.matchId));
      }

      // Sort by date
      finalMatches.sort((a, b) => b.gameCreation - a.gameCreation);
      setMatches(finalMatches);
      setCachedMatchIds(finalMatchIds);

      // Save to local cache
      saveToCache(finalMatches, Array.from(finalMatchIds), playersData);
      setLastUpdated(Date.now());
      setBackups(getBackups());

      // Save to central cache (async, don't block UI)
      saveToCentralCache(finalMatches, Array.from(finalMatchIds), playersData);

      setLoading(false);
      setRefreshing(false);

    } catch (err) {
      console.error('Error fetching data:', err);
      setError(`Failed to connect to server: ${err.message}. Make sure the backend is running.`);
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Handle incremental refresh - only fetch new matches
  const handleRefresh = () => {
    setRefreshing(true);
    setLoadingProgress(0);
    fetchData(true, matches, cachedMatchIds);
  };

  // Handle full refresh with password protection
  const handleFullRefresh = (password) => {
    if (password !== 'boystats') {
      alert('Incorrect password');
      return false;
    }

    // Create backup before full refresh
    const backupId = createBackup();
    if (backupId) {
      console.log('Created backup before full refresh:', backupId);
    }

    setRefreshing(true);
    setLoadingProgress(0);
    fetchData(false, [], new Set());
    return true;
  };

  // Handle backup restore
  const handleRestoreBackup = (backupId) => {
    if (restoreBackup(backupId)) {
      const cached = loadFromCache();
      if (cached) {
        setMatches(cached.matches);
        setCachedMatchIds(new Set(cached.matchIds || []));
        setPlayers(cached.players);
        setLastUpdated(cached.lastUpdated);
        setBackups(getBackups());
        alert('Backup restored successfully!');
      }
    } else {
      alert('Failed to restore backup');
    }
  };

  // Load data on mount - try local cache, then central cache, then fetch
  useEffect(() => {
    const initData = async () => {
      setBackups(getBackups());

      // First try local cache
      const localCached = loadFromCache();
      if (localCached && localCached.matches.length > 0) {
        console.log('Loaded from local cache:', {
          matches: localCached.matches.length,
          matchIds: localCached.matchIds?.length || 0,
          lastUpdated: new Date(localCached.lastUpdated).toLocaleString(),
        });
        setMatches(localCached.matches);
        setCachedMatchIds(new Set(localCached.matchIds || []));
        setPlayers(localCached.players);
        setLastUpdated(localCached.lastUpdated);
        setLoading(false);
        return;
      }

      // No local cache, try central cache
      setLoadingMessage('Checking central cache...');
      const centralCached = await loadFromCentralCache();
      if (centralCached && centralCached.matches.length > 0) {
        console.log('Loaded from central cache:', {
          matches: centralCached.matches.length,
          matchIds: centralCached.matchIds?.length || 0,
        });
        setMatches(centralCached.matches);
        setCachedMatchIds(new Set(centralCached.matchIds || []));
        setPlayers(centralCached.players);
        setLastUpdated(centralCached.lastUpdated);
        // Save to local cache for next time
        saveToCache(centralCached.matches, centralCached.matchIds, centralCached.players);
        setLoading(false);
        return;
      }

      // No cache at all, do full fetch
      fetchData(false, [], new Set());
    };

    initData();
  }, []);

  const togglePartySize = (size) => {
    setPartySizeFilter(prev => {
      const next = new Set(prev);
      if (next.has(size)) next.delete(size);
      else next.add(size);
      return next;
    });
  };

  const toggleQueue = (queueId) => {
    setQueueFilter(prev => {
      const next = new Set(prev);
      if (next.has(queueId)) next.delete(queueId);
      else next.add(queueId);
      return next;
    });
  };

  const filteredMatches = useMemo(() => {
    return matches.filter(match => {
      if (queueFilter.size > 0 && !queueFilter.has(String(match.queueId))) return false;
      if (timeFilter !== 'all') {
        const days = parseInt(timeFilter);
        if (match.gameCreation < Date.now() - days * 86400000) return false;
      }
      const boysInGame = match.participants.filter(p => p.isBoy && selectedPlayers.includes(p.boyName || p.riotIdGameName));
      if (boysInGame.length === 0) return false;

      const didWin = boysInGame[0]?.win;
      if (resultFilter === 'wins' && !didWin) return false;
      if (resultFilter === 'losses' && didWin) return false;
      if (!partySizeFilter.has(String(boysInGame.length))) return false;
      return true;
    });
  }, [matches, selectedPlayers, queueFilter, resultFilter, partySizeFilter, timeFilter]);

  const stats = useMemo(() => calculateAllStats(filteredMatches, selectedPlayers), [filteredMatches, selectedPlayers]);

  const togglePlayer = (name) => {
    setSelectedPlayers(prev => prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]);
  };

  const streak = useMemo(() => {
    if (stats.recentGames.length === 0) return { type: null, count: 0 };
    const first = stats.recentGames[0].won;
    let count = 1;
    for (let i = 1; i < stats.recentGames.length; i++) {
      if (stats.recentGames[i].won === first) count++; else break;
    }
    return { type: first ? 'win' : 'loss', count };
  }, [stats.recentGames]);

  const awards = useMemo(() => {
    const valid = Object.entries(stats.players).filter(([, s]) => s.games >= 3);
    if (valid.length === 0) return [];
    const a = [];

    const mvp = [...valid].sort((x, y) => (y[1].totalKP / y[1].games) - (x[1].totalKP / x[1].games))[0];
    if (mvp) a.push({ icon: '🏆', title: 'MVP', sub: 'Kill Participation', player: mvp[0], value: `${(mvp[1].totalKP / mvp[1].games * 100).toFixed(0)}%` });

    const deaths = [...valid].sort((x, y) => (y[1].deaths / y[1].games) - (x[1].deaths / x[1].games))[0];
    if (deaths) a.push({ icon: '💀', title: 'Death Wish', sub: 'Deaths/Game', player: deaths[0], value: `${(deaths[1].deaths / deaths[1].games).toFixed(1)}` });

    const dpm = [...valid].sort((x, y) => (y[1].damage / y[1].totalTime) - (x[1].damage / x[1].totalTime))[0];
    if (dpm && dpm[1].totalTime > 0) a.push({ icon: '🎯', title: 'Sniper', sub: 'Damage/Min', player: dpm[0], value: `${(dpm[1].damage / dpm[1].totalTime * 60).toFixed(0)}` });

    const vis = [...valid].sort((x, y) => (y[1].vision / y[1].games) - (x[1].vision / x[1].games))[0];
    if (vis) a.push({ icon: '👁️', title: 'Hawkeye', sub: 'Vision Score', player: vis[0], value: `${(vis[1].vision / vis[1].games).toFixed(1)}` });

    const tank = [...valid].sort((x, y) => (y[1].damageTaken / y[1].games) - (x[1].damageTaken / x[1].games))[0];
    if (tank) a.push({ icon: '🛡️', title: 'Tank', sub: 'Dmg Taken', player: tank[0], value: formatNumber(Math.round(tank[1].damageTaken / tank[1].games)) });

    const kda = [...valid].sort((x, y) => ((y[1].kills + y[1].assists) / Math.max(y[1].deaths, 1)) - ((x[1].kills + x[1].assists) / Math.max(x[1].deaths, 1)))[0];
    if (kda) a.push({ icon: '✨', title: 'Cleanest', sub: 'KDA', player: kda[0], value: `${((kda[1].kills + kda[1].assists) / Math.max(kda[1].deaths, 1)).toFixed(2)}` });

    return a;
  }, [stats.players]);

  // Loading state
  if (loading) {
    return <LoadingScreen message={loadingMessage} progress={loadingProgress} subMessage={loadingSubMessage} />;
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-red-950 border-2 border-red-700 rounded-2xl p-8 max-w-lg text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-red-400 mb-2">Connection Error</h1>
          <p className="text-red-200 mb-4">{error}</p>
          <p className="text-slate-400 text-sm">
            Make sure the backend server is running:<br />
            <code className="bg-slate-800 px-2 py-1 rounded mt-2 inline-block">cd server && npm run dev</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Refresh progress bar */}
      {refreshing && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-slate-900 border-b border-emerald-700">
          <div className="max-w-7xl mx-auto px-4 py-2">
            <div className="flex items-center gap-3">
              <div className="animate-spin text-lg">🔄</div>
              <div className="flex-1">
                <p className="text-emerald-400 text-sm font-bold">{loadingMessage}</p>
                <p className="text-slate-400 text-xs">{loadingSubMessage}</p>
              </div>
              <div className="w-32">
                <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(loadingProgress, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <header className={`border-b-2 border-slate-800 bg-slate-900 sticky top-0 z-50 ${refreshing ? 'mt-12' : ''}`}>
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="text-5xl">🎮</div>
              <div>
                <h1 className="text-3xl md:text-4xl font-black text-amber-400">BOYSTATS</h1>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-slate-400">{matches.length} Matches • {filteredMatches.length} Filtered</span>
                  {lastUpdated && (
                    <span className="text-slate-500">• Updated {formatLastUpdated(lastUpdated)}</span>
                  )}
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={`px-2 py-1 rounded-lg text-xs font-bold border transition-all ${
                      refreshing
                        ? 'bg-slate-700 border-slate-600 text-slate-400 cursor-not-allowed'
                        : 'bg-emerald-900 border-emerald-700 text-emerald-300 hover:bg-emerald-800'
                    }`}
                    title="Fetch new matches only"
                  >
                    {refreshing ? '...' : 'Refresh'}
                  </button>
                  <button
                    onClick={() => {
                      const pw = prompt('Enter password for full refresh:');
                      if (pw) handleFullRefresh(pw);
                    }}
                    disabled={refreshing}
                    className={`px-2 py-1 rounded-lg text-xs font-bold border transition-all ${
                      refreshing
                        ? 'bg-slate-700 border-slate-600 text-slate-400 cursor-not-allowed'
                        : 'bg-amber-900 border-amber-700 text-amber-300 hover:bg-amber-800'
                    }`}
                    title="Full refresh - requires password, creates backup first"
                  >
                    🔒 Full
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {['dashboard', 'matches', 'players', 'ask'].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-xl font-bold text-sm ${activeTab === tab ? (tab === 'ask' ? 'bg-purple-500 text-white' : 'bg-amber-500 text-black') : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-2 border-slate-700'}`}>
                  {tab === 'ask' ? '🤖 Ask AI' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="border-b-2 border-slate-800 bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <div className="col-span-2 md:col-span-4 lg:col-span-2">
              <label className="text-xs text-amber-400 font-bold uppercase block mb-2">Players</label>
              <div className="flex flex-wrap gap-2">
                {THE_BOYS.map(boy => {
                  const color = PLAYER_COLORS[boy.gameName];
                  const sel = selectedPlayers.includes(boy.gameName);
                  return (
                    <button key={boy.gameName} onClick={() => togglePlayer(boy.gameName)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-bold border-2 ${sel ? 'border-white shadow-lg' : 'border-slate-600 opacity-60 hover:opacity-100'}`}
                      style={{ background: sel ? color : '#1e293b', color: sel ? '#000' : color }}>
                      <span>{boy.emoji}</span>
                      <span className="hidden sm:inline">{boy.gameName}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs text-amber-400 font-bold uppercase block mb-2">Time</label>
              <select value={timeFilter} onChange={e => setTimeFilter(e.target.value)}
                className="w-full bg-slate-800 border-2 border-slate-600 rounded-lg px-3 py-2 text-white">
                <option value="all">All Time</option>
                <option value="7">7 Days</option>
                <option value="14">14 Days</option>
                <option value="30">30 Days</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-amber-400 font-bold uppercase block mb-2">Queue</label>
              <div className="flex flex-wrap gap-1">
                {[
                  { id: '420', label: 'Solo' },
                  { id: '440', label: 'Flex' },
                  { id: '400', label: 'Norm' },
                  { id: '450', label: 'ARAM' },
                ].map(q => (
                  <button key={q.id} onClick={() => toggleQueue(q.id)}
                    className={`px-2 py-2 rounded-lg text-xs font-bold border-2 transition-all ${queueFilter.has(q.id) ? 'bg-amber-500 border-amber-400 text-black' : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                      }`}>
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-amber-400 font-bold uppercase block mb-2">Party Size</label>
              <div className="flex gap-1">
                {['1', '2', '3', '4', '5'].map(size => (
                  <button key={size} onClick={() => togglePartySize(size)}
                    className={`flex-1 px-2 py-2 rounded-lg text-xs font-bold border-2 transition-all ${partySizeFilter.has(size) ? 'bg-amber-500 border-amber-400 text-black' : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-500'
                      }`}>
                    {size}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-amber-400 font-bold uppercase block mb-2">Result</label>
              <div className="flex gap-1">
                {['all', 'wins', 'losses'].map(f => (
                  <button key={f} onClick={() => setResultFilter(f)}
                    className={`flex-1 px-2 py-2 rounded-lg text-xs font-bold border-2 ${resultFilter === f
                      ? (f === 'wins' ? 'bg-emerald-600 border-emerald-500 text-white' : f === 'losses' ? 'bg-red-600 border-red-500 text-white' : 'bg-amber-500 border-amber-400 text-black')
                      : 'bg-slate-800 border-slate-600 text-slate-300'
                      }`}>
                    {f === 'all' ? 'All' : f === 'wins' ? 'W' : 'L'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="bg-slate-900 rounded-2xl p-6 border-2 border-slate-700">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <div className="text-5xl font-black text-amber-400">{stats.totalGames}</div>
                  <div className="text-slate-400">Games</div>
                </div>
                <div className="text-center">
                  <div className="text-5xl font-black text-emerald-400">{stats.totalWins}</div>
                  <div className="text-slate-400">Wins</div>
                </div>
                <div className="text-center">
                  <div className={`text-5xl font-black ${stats.totalGames > 0 && (stats.totalWins / stats.totalGames) >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {stats.totalGames > 0 ? (stats.totalWins / stats.totalGames * 100).toFixed(0) : 0}%
                  </div>
                  <div className="text-slate-400">Win Rate</div>
                </div>
                <div className="text-center">
                  <div className={`text-5xl font-black ${streak.type === 'win' ? 'text-emerald-400' : streak.type === 'loss' ? 'text-red-400' : 'text-slate-600'}`}>
                    {streak.count > 0 ? `${streak.type === 'win' ? '🔥' : '❄️'} ${streak.count}` : '-'}
                  </div>
                  <div className="text-slate-400">{streak.type ? `${streak.type === 'win' ? 'Win' : 'Loss'} Streak` : 'Streak'}</div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold text-amber-400 mb-4">🏅 Squad Awards</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {awards.map((aw, i) => {
                  const color = PLAYER_COLORS[aw.player];
                  const emoji = PLAYER_EMOJIS[aw.player];
                  return (
                    <div key={i} className="bg-slate-900 rounded-2xl p-4 border-2 border-slate-700 hover:border-slate-500">
                      <div className="flex items-start justify-between mb-2">
                        <span className="text-3xl">{aw.icon}</span>
                        <span className="text-2xl">{emoji}</span>
                      </div>
                      <div className="text-white font-bold">{aw.title}</div>
                      <div className="text-slate-500 text-xs mb-2">{aw.sub}</div>
                      <div className="font-bold" style={{ color }}>{aw.player}</div>
                      <div className="text-slate-400 text-xs">{aw.value}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold text-amber-400 mb-4">🤝 Duo Synergy</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {Object.entries(stats.duos).filter(([, d]) => d.games >= 3).sort((a, b) => b[1].games - a[1].games).slice(0, 10).map(([key, duo]) => {
                  const wr = duo.wins / duo.games * 100;
                  return (
                    <div key={key} className={`rounded-2xl p-4 border-2 ${wr >= 55 ? 'bg-emerald-950 border-emerald-700' : wr >= 45 ? 'bg-slate-900 border-slate-700' : 'bg-red-950 border-red-800'}`}>
                      <div className="flex justify-center gap-1 text-2xl mb-2">
                        <span>{PLAYER_EMOJIS[duo.players[0]]}</span>
                        <span className="text-slate-500">+</span>
                        <span>{PLAYER_EMOJIS[duo.players[1]]}</span>
                      </div>
                      <div className="text-center">
                        <div className={`text-2xl font-black ${wr >= 55 ? 'text-emerald-400' : wr >= 45 ? 'text-white' : 'text-red-400'}`}>{wr.toFixed(0)}%</div>
                        <div className="text-xs text-slate-400">{duo.games} games</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold text-amber-400 mb-4">📈 Recent Form</h2>
              <div className="flex gap-1 flex-wrap">
                {stats.recentGames.slice(0, 20).map((g, i) => (
                  <div key={i} className={`w-10 h-12 rounded-lg flex items-center justify-center font-bold border-2 ${g.won ? 'bg-emerald-900 border-emerald-600 text-emerald-300' : 'bg-red-900 border-red-600 text-red-300'}`}>
                    {g.won ? 'W' : 'L'}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'matches' && (
          <div className="space-y-3">
            <p className="text-slate-400 mb-4">Showing {Math.min(filteredMatches.length, 50)} of {filteredMatches.length} matches</p>
            {filteredMatches.slice(0, 50).map(m => <MatchCard key={m.matchId} match={m} />)}
          </div>
        )}

        {activeTab === 'players' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {selectedPlayers.map(name => {
              const s = stats.players[name];
              if (!s || s.games === 0) return null;
              const color = PLAYER_COLORS[name];
              const emoji = PLAYER_EMOJIS[name];
              const wr = (s.wins / s.games * 100).toFixed(0);
              const kda = ((s.kills + s.assists) / Math.max(s.deaths, 1)).toFixed(2);
              const playerTags = generatePlayerTags(name, s);

              // Find player ranked info
              const playerInfo = players.find(p => p.gameName === name);

              const champStats = Object.entries(s.champions).map(([c, d]) => ({ name: c, games: d.games, wins: d.wins, wr: d.wins / d.games }));
              const topChamps = champStats.filter(c => c.games >= 2).sort((a, b) => b.games - a.games).slice(0, 3);

              return (
                <div key={name} className="rounded-2xl p-6 border-2 bg-slate-900" style={{ borderColor: `${color}60` }}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="text-5xl">{emoji}</div>
                    <div>
                      <div className="text-xl font-black" style={{ color }}>{name}</div>
                      {playerInfo?.soloQueue && (
                        <div className="text-sm text-slate-400">
                          {playerInfo.soloQueue.tier} {playerInfo.soloQueue.rank} • {playerInfo.soloQueue.lp} LP
                        </div>
                      )}
                    </div>
                  </div>

                  {playerTags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {playerTags.map((t, i) => (
                        <Tooltip key={i} text={t.desc}>
                          <span className={`px-2 py-1 rounded text-xs font-bold border ${TAG_COLORS[t.color]}`}>
                            {t.icon} {t.label}
                          </span>
                        </Tooltip>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="text-center">
                      <div className={`text-2xl font-black ${parseInt(wr) >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{wr}%</div>
                      <div className="text-xs text-slate-400">Win Rate</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-black text-white">{kda}</div>
                      <div className="text-xs text-slate-400">KDA</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-black text-amber-400">{s.games}</div>
                      <div className="text-xs text-slate-400">Games</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                    <div className="flex justify-between bg-slate-800 rounded px-2 py-1">
                      <span className="text-slate-400">Avg Dmg</span>
                      <span className="font-bold text-white">{formatNumber(Math.round(s.damage / s.games))}</span>
                    </div>
                    <div className="flex justify-between bg-slate-800 rounded px-2 py-1">
                      <span className="text-slate-400">Vision</span>
                      <span className="font-bold text-white">{(s.vision / s.games).toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between bg-slate-800 rounded px-2 py-1">
                      <span className="text-slate-400">KP</span>
                      <span className="font-bold text-white">{(s.totalKP / s.games * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-between bg-slate-800 rounded px-2 py-1">
                      <span className="text-slate-400">CS/Game</span>
                      <span className="font-bold text-white">{(s.cs / s.games).toFixed(0)}</span>
                    </div>
                  </div>

                  {topChamps.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-emerald-400 font-bold mb-1">Top Champions</div>
                      <div className="flex flex-wrap gap-2">
                        {topChamps.map(c => (
                          <span key={c.name} className="px-2 py-1 bg-emerald-900/50 border border-emerald-700 rounded text-xs text-emerald-200">
                            {c.name} <span className="text-emerald-400">{(c.wr * 100).toFixed(0)}%</span> <span className="text-slate-400">({c.games})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {(s.pentas > 0 || s.quadras > 0) && (
                    <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-700">
                      {s.pentas > 0 && <span className="px-2 py-1 bg-amber-900 border border-amber-600 rounded text-xs text-amber-200">🏆 {s.pentas} Penta</span>}
                      {s.quadras > 0 && <span className="px-2 py-1 bg-purple-900 border border-purple-600 rounded text-xs text-purple-200">💎 {s.quadras} Quadra</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'ask' && (
          <AskAI stats={stats} matches={filteredMatches} />
        )}
      </main>

      {/* Backup Restore Section */}
      {backups.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 py-6">
          <details className="bg-slate-900 rounded-xl border border-slate-700">
            <summary className="px-4 py-3 cursor-pointer text-slate-400 text-sm font-medium hover:text-slate-300">
              📦 Data Backups ({backups.length})
            </summary>
            <div className="px-4 pb-4 pt-2 border-t border-slate-700">
              <p className="text-xs text-slate-500 mb-3">
                Backups are created automatically before full refreshes. Click to restore.
              </p>
              <div className="space-y-2">
                {backups.map((backup) => (
                  <div
                    key={backup.id}
                    className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-2"
                  >
                    <div>
                      <span className="text-slate-300 text-sm">{formatBackupDate(backup.timestamp)}</span>
                      <span className="text-slate-500 text-xs ml-2">({backup.matchCount} matches)</span>
                    </div>
                    <button
                      onClick={() => {
                        if (confirm(`Restore backup from ${formatBackupDate(backup.timestamp)}? This will replace your current data.`)) {
                          handleRestoreBackup(backup.id);
                        }
                      }}
                      className="px-3 py-1 bg-slate-700 border border-slate-600 rounded text-xs text-slate-300 hover:bg-slate-600"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>
      )}

      <footer className="border-t-2 border-slate-800 mt-6">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center">
          <p className="text-amber-400 font-bold">🎮 BOYSTATS</p>
          <p className="text-xs text-slate-500 mt-1">Built for The Boys • Powered by Riot Games API</p>
        </div>
      </footer>
    </div>
  );
}
