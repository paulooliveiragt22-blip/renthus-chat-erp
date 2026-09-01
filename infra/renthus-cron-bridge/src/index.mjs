// renthus-cron-bridge handler (Node.js 22.x)
// Recebe { targetUrl } via EventBridge Constant (JSON text) e dispara GET
// autenticado por Bearer CRON_SECRET contra a rota cron correspondente
// na Vercel (app.renthus.com.br). Logs vao para CloudWatch Logs.

export const handler = async (event) => {
  const url = event?.targetUrl || process.env.DEFAULT_URL;
  const secret = process.env.CRON_SECRET;

  if (!url) {
    console.error('[cron-bridge] missing targetUrl');
    return { statusCode: 400, body: 'missing targetUrl' };
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${secret}` },
    });
    const text = await res.text();
    console.log(`[cron-bridge] ${url} -> ${res.status} (${text.length}b)`);
    return { statusCode: res.status, body: text.slice(0, 500) };
  } catch (err) {
    console.error(`[cron-bridge] ${url} -> ERROR ${err.message}`);
    throw err;
  }
};