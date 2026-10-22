// 🔁 api/[...path].js — Serverless Function do Vercel.
//
// Reencaminha /api/* do painel (HTTPS, no Vercel) para o bot a correr no
// Wispbyte. O endereço do bot fica na variável MIKU_BOT_URL
// (Vercel → Settings → Environment Variables), nunca no código.

const CAUSAS = {
  ECONNREFUSED: 'o bot não está a escutar nesse endereço/porta (confirma WEB_PORT e se o bot está a correr)',
  ENOTFOUND: 'o domínio ou IP não existe (confirma o endereço em MIKU_BOT_URL)',
  EAI_AGAIN: 'não foi possível resolver o domínio (confirma o endereço em MIKU_BOT_URL)',
  ETIMEDOUT: 'a porta não está acessível de fora (firewall ou porta não exposta no Wispbyte)',
  UND_ERR_CONNECT_TIMEOUT: 'a ligação expirou (porta não exposta ou bot inacessível)',
  ABORT_ERR: 'o bot demorou demasiado a responder',
};

module.exports = async (req, res) => {
  const base = (process.env.MIKU_BOT_URL || '').trim().replace(/\/+$/, '');

  if (!base) {
    res.status(500).json({ ok: false, erro: 'MIKU_BOT_URL não está definido no Vercel.' });
    return;
  }
  if (!/^https?:\/\//i.test(base)) {
    res.status(500).json({
      ok: false,
      erro: `MIKU_BOT_URL inválido ("${base}"): tem de começar por http:// ou https://, ex.: https://bot.teudominio.com`,
    });
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
    const resp = await fetch(`${base}${req.url}`, {
      method: metodo,
      headers,
      body: corpo,
      signal: AbortSignal.timeout(20000),
    });
    res.status(resp.status);
    res.setHeader('content-type', resp.headers.get('content-type') || 'application/json; charset=utf-8');
    res.send(await resp.text());
  } catch (erro) {
    const codigo = erro.cause?.code || erro.code || erro.name || 'desconhecido';
    const motivo = CAUSAS[codigo] || 'erro de rede desconhecido';
    let host = base;
    try { host = new URL(base).host; } catch { /* mantém o texto original */ }
    res.status(502).json({
      ok: false,
      erro: `Bot inacessível em ${host} (${codigo}): ${motivo}.`,
    });
  }
};
