export default function handler(req, res) {
  res.json({
    status: 'ok',
    hasApiKey: !!process.env.RIOT_API_KEY
  });
}
