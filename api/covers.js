export default async function handler(req, res) {
  try {
    const count = req.query.count || 60;
    const response = await fetch(`https://api.wabi.ai/api/v1/app/random-covers?count=${count}`);
    const data = await response.json();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch covers' });
  }
}
