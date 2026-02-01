import { put, list, del } from '@vercel/blob';

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
      // List all blobs and find our cache file
      const { blobs } = await list();

      // Find blob that contains our cache name
      const cacheBlob = blobs.find(b => b.pathname.includes(CACHE_BLOB_NAME) || b.pathname.endsWith(CACHE_BLOB_NAME));

      if (!cacheBlob) {
        console.log('No cache blob found. Available blobs:', blobs.map(b => b.pathname));
        return res.status(404).json({ error: 'No cache found', exists: false });
      }

      console.log('Found cache blob:', cacheBlob.pathname, cacheBlob.url);

      // Fetch the cache content
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

      // Check existing cache - don't overwrite with less data
      try {
        const { blobs } = await list();
        const existingBlob = blobs.find(b => b.pathname.includes(CACHE_BLOB_NAME));

        if (existingBlob) {
          const existingRes = await fetch(existingBlob.url);
          if (existingRes.ok) {
            const existingData = await existingRes.json();
            const existingCount = existingData.matches?.length || 0;

            if (matches.length < existingCount) {
              console.log(`Skipping cache update: new data has ${matches.length} matches, existing has ${existingCount}`);
              return res.json({
                success: false,
                reason: 'existing_cache_larger',
                existingCount,
                newCount: matches.length,
              });
            }
          }
        }
      } catch (checkErr) {
        console.log('Could not check existing cache:', checkErr.message);
      }

      const cacheData = {
        matches,
        matchIds: matchIds || [],
        players,
        timestamp: timestamp || Date.now(),
        updatedAt: new Date().toISOString(),
      };

      // Delete old cache blobs first
      try {
        const { blobs } = await list();
        const oldCacheBlobs = blobs.filter(b => b.pathname.includes(CACHE_BLOB_NAME));
        for (const oldBlob of oldCacheBlobs) {
          await del(oldBlob.url);
          console.log('Deleted old cache blob:', oldBlob.pathname);
        }
      } catch (delErr) {
        console.log('No old cache to delete or delete failed:', delErr.message);
      }

      // Upload new cache to Vercel Blob
      const blob = await put(CACHE_BLOB_NAME, JSON.stringify(cacheData), {
        access: 'public',
        addRandomSuffix: false,
      });

      console.log('Created new cache blob:', blob.pathname, blob.url);

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
