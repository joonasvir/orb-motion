// Vercel serverless function that proxies a single image generation call to
// OpenAI's image API. Returns the generated image as a data URL so the
// front-end can drop it straight onto a Matter.js orb body.
//
// Env var required (set via `vercel env add OPENAI_API_KEY`):
//   OPENAI_API_KEY — a project key with `images.generate` permission.

const DEFAULT_PROMPT =
  'A minimalist square app icon, vibrant gradient background with a single bold ' +
  'abstract glyph centered, soft inner glow, high contrast, no text. Modern ' +
  'iOS-style app cover artwork.';

export default async function handler(req, res) {
  // CORS for our own subdomains; harmless on same-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'Server is missing OPENAI_API_KEY. Set it via `vercel env add`.',
    });
    return;
  }

  // Accept prompt from POST body (preferred) or ?prompt= query string.
  let prompt = DEFAULT_PROMPT;
  let count = 1;
  if (req.method === 'POST' && req.body) {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (body.prompt && typeof body.prompt === 'string') prompt = body.prompt;
    if (body.count && Number.isFinite(body.count)) {
      count = Math.min(Math.max(1, Math.floor(body.count)), 4);
    }
  } else if (req.query && req.query.prompt) {
    prompt = String(req.query.prompt);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: count,
        size: '1024x1024',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({
        error: `OpenAI request failed (${response.status})`,
        detail: text.slice(0, 500),
      });
      return;
    }

    const json = await response.json();
    // gpt-image-1 always returns b64_json; wrap each as a data URL.
    const images = (json.data || [])
      .map(d => d.b64_json && `data:image/png;base64,${d.b64_json}`)
      .filter(Boolean);

    if (images.length === 0) {
      res.status(502).json({ error: 'OpenAI returned no images' });
      return;
    }

    // Don't cache — every call should produce a fresh image.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ images, prompt });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to generate image',
      detail: err && err.message ? err.message : String(err),
    });
  }
}
