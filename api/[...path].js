// 🔁 api/[...path].js — Serverless Function do Vercel.
//
// Reencaminha /api/* do painel (HTTPS, no Vercel) para o bot a correr no
// Wispbyte (HTTP). Assim o browser só fala com o próprio site (mesma origem):
// sem "Mixed Content" e sem problemas de CORS. O endereço do bot fica na
// variável de ambiente MIKU_BOT_URL (Vercel → Settings → Environment Variables),
// nunca no código.

module.exports = async (req, res) => {
  const base = (process.env.MIKU_BOT_URL || '').replace(/\/+$/, '');
  if (!base) {
    res.status(500).json({ ok: false, erro: 'MIKU_BOT_URL não está definido no Vercel.' });
    return;
  }

  const headers = {};
  if (req.headers.authorization) headers.authorization = req.headers.authorization;
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];

  const metodo = req.method;
  let corpo;
  if (metodo !== 'GET' && metodo !== 'HEAD') {
    corpo = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  }

  try {
    // req.url já traz o caminho completo (ex.: /api/status?guild_id=…)
    const resp = await fetch(`${base}${req.url}`, { method: metodo, headers, body: corpo });
    res.status(resp.status);
    res.setHeader('content-type', resp.headers.get('content-type') || 'application/json; charset=utf-8');
    res.send(await resp.text());
  } catch (erro) {
    res.status(502).json({ ok: false, erro: `Bot inacessível: ${erro.message}. Confirma que está online no Wispbyte.` });
  }
};
