import { put, head, list } from '@vercel/blob';

const CACHE_BLOB_NAME = 'boystats-cache.json';

export const config = {
  maxDuration: 30,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // Find the cache blob
      const { blobs } = await list({ prefix: CACHE_BLOB_NAME });

      if (blobs.length === 0) {
        return res.status(404).json({ error: 'No cache found', exists: false });
      }

      // Fetch the cache content
      const cacheBlob = blobs[0];
      const response = await fetch(cacheBlob.url);

      if (!response.ok) {
        return res.status(500).json({ error: 'Failed to fetch cache' });
      }

      const cacheData = await response.json();

      return res.json({
        exists: true,
        lastUpdated: cacheBlob.uploadedAt,
        size: cacheBlob.size,
        data: cacheData,
      });
    }

    if (req.method === 'POST') {
      const { matches, matchIds, players, timestamp } = req.body;

      if (!matches || !players) {
        return res.status(400).json({ error: 'Missing required fields: matches, players' });
      }

      const cacheData = {
        matches,
        matchIds: matchIds || [],
        players,
        timestamp: timestamp || Date.now(),
        updatedAt: new Date().toISOString(),
      };

      // Upload to Vercel Blob (overwrites if exists)
      const blob = await put(CACHE_BLOB_NAME, JSON.stringify(cacheData), {
        access: 'public',
        addRandomSuffix: false,
      });

      return res.json({
        success: true,
        url: blob.url,
        size: JSON.stringify(cacheData).length,
        matchCount: matches.length,
        timestamp: cacheData.timestamp,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Cache API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
