/* 🩵 Miku-Dashboard — lógica do painel (vanilla JS, sem build) */

const $ = (id) => document.getElementById(id);

/* ⚙️ Auto-conexão.
   Quando o painel é servido PELO PRÓPRIO BOT (python -m bot.main), o servidor
   injeta `window.MIKU_BOOT` com a URL (mesma origem) e o token do painel.
   Assim o bot é reconhecido automaticamente — sem digitar URL nem token.
   Se o painel for aberto sozinho (ex.: Vercel), cai no modo manual antigo. */
const BOOT = window.MIKU_BOOT || null;
const AUTO = !!(BOOT && BOOT.autoConnect);

/* ☁️ Modo proxy (painel no Vercel).
   O site reencaminha /api/* para o bot (variável MIKU_BOT_URL), por isso a API
   está sempre na mesma origem: não é preciso escrever URL nenhum. Só o token. */
const PROXY = !AUTO && !!window.MIKU_PROXY;

const CONFIG = {
  clientId: (BOOT && BOOT.clientId) || '1551238667492790352', // Application ID do Discord
};

const estado = {
  url: AUTO
    ? (BOOT.apiUrl || window.location.host)
    : PROXY ? window.location.host : (localStorage.getItem('miku-dash/url') || ''),
  token: AUTO ? (BOOT.token || '') : (localStorage.getItem('miku-dash/token') || ''),
  guildId: localStorage.getItem('miku-dash/guild') || '1501482046693052466',
  guilds: [],
  canais: [],
  ligado: false,
  auto: AUTO,
  timer: null,
  rankTipo: 'xp',
};

const discord = { user: null, token: null };

/* ═══ helpers ═══ */

function pill(classe, texto) {
  const el = $('pill-status');
  el.className = `pill ${classe}`;
  el.innerHTML = `<span class="dot"></span> ${texto}`;
}

function hint(id, texto, tipo = '') {
  const el = $(id);
  el.textContent = texto;
  el.className = `hint ${tipo}`;
}

function formatarUptime(segundos) {
  const d = Math.floor(segundos / 86400);
  const h = Math.floor((segundos % 86400) / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function escapar(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function baseApi() {
  // O protocolo é SEMPRE o da página: HTTPS não pode falar HTTP (Mixed Content)
  // e aceitamos o URL com ou sem http:// na frente (fica normalizado aqui).
  const protocolo = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const base = estado.url.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `${protocolo}//${base}`;
}

async function api(caminho, opcoes = {}) {
  const resp = await fetch(`${baseApi()}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${estado.token}`,
      'Content-Type': 'application/json',
      ...(opcoes.headers || {}),
    },
  });
  let dados = {};
  try { dados = await resp.json(); } catch { /* resposta vazia */ }
  if (!resp.ok || dados.ok === false) {
    throw new Error(dados.erro || `HTTP ${resp.status}`);
  }
  return dados;
}

function mostrarCartoes(ligado) {
  for (const id of ['cartao-estado', 'cartao-boasvindas', 'cartao-verificacao',
    'cartao-contadores', 'cartao-anuncio', 'cartao-lembrete', 'cartao-moderacao',
    'cartao-rankings', 'cartao-say', 'cartao-logs']) {
    $(id).hidden = !ligado;
  }
}

/* ══════════════════ LOGIN COM DISCORD ══════════════════ */

function guardarSessao(chave, valor) {
  try {
    if (valor === null) sessionStorage.removeItem(chave);
    else sessionStorage.setItem(chave, valor);
  } catch { /* modo privado — a sessão simplesmente não persiste */ }
}

function lerSessao(chave) {
  try { return sessionStorage.getItem(chave); } catch { return null; }
}

function estadoAleatorio() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function redirectUri() {
  // ⚠️ Tem de estar igualzinho em Developer Portal → OAuth2 → Redirects
  return window.location.origin + window.location.pathname;
}

function loginDiscord() {
  if (!CONFIG.clientId) {
    hint('hint-login', '⚠️ Define o clientId em app.js primeiro (Application ID do Discord).', 'erro');
    return;
  }
  const state = estadoAleatorio();
  guardarSessao('miku-dash/oauth-state', state);
  const params = new URLSearchParams({
    response_type: 'token',
    client_id: CONFIG.clientId,
    redirect_uri: redirectUri(),
    scope: 'identify',
    state,
  });
  window.location.href = `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function logoutDiscord() {
  guardarSessao('miku-dash/oauth', null);
  localStorage.setItem('miku-dash/convidado', '1');
  discord.user = null;
  discord.token = null;
  renderizarUtilizador();
  hint('hint-ligacao', '👋 Sair da conta do Discord.');
  $('login-overlay').hidden = true;
}

async function tratarRedirect() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const token = hash.get('access_token');
  if (!token) return;
  const state = hash.get('state');
  const esperado = lerSessao('miku-dash/oauth-state');
  guardarSessao('miku-dash/oauth-state', null);
  // tira o token da barra de endereço
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!state || state !== esperado) {
    hint('hint-login', '❌ Login recusado (state inválido) — tenta outra vez.', 'erro');
    return;
  }
  const expira = Date.now() + Number(hash.get('expires_in') || 604800) * 1000;
  guardarSessao('miku-dash/oauth', JSON.stringify({ token, expira }));
  localStorage.removeItem('miku-dash/convidado');
}

async function carregarUtilizador() {
  let guardado = null;
  try { guardado = JSON.parse(lerSessao('miku-dash/oauth') || 'null'); } catch { guardado = null; }
  if (!guardado || !guardado.token) return;
  if (guardado.expira < Date.now()) {
    guardarSessao('miku-dash/oauth', null);
    return;
  }
  try {
    const resp = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${guardado.token}` },
    });
    if (!resp.ok) throw new Error(`Discord API: ${resp.status}`);
    discord.token = guardado.token;
    discord.user = await resp.json();
  } catch {
    discord.user = null;
    hint('hint-ligacao', '⚠️ Sessão do Discord expirada — entra outra vez.', 'erro');
  }
}

function renderizarUtilizador() {
  const chip = $('user-chip');
  const btnLogin = $('btn-discord-login');
  if (discord.user) {
    const nome = discord.user.global_name || discord.user.username;
    $('user-nome').textContent = nome;
    const avatar = discord.user.avatar
      ? `https://cdn.discordapp.com/avatars/${discord.user.id}/${discord.user.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(discord.user.id) >> 22n) % 6}.png`;
    $('user-avatar').src = avatar;
    chip.hidden = false;
    btnLogin.hidden = true;
    $('heroi-saudacao').textContent = `Olá, ${nome}! 🎤`;
    $('login-overlay').hidden = true;
  } else {
    chip.hidden = true;
    btnLogin.hidden = false;
    $('heroi-saudacao').textContent = 'Bem-vinda(o) ao painel! 🎤';
  }
}

function decidirLogin() {
  // Overlay de login: à primeira visita (ou sem sessão), senão segue.
  // No modo auto (servido pelo bot) não bloqueia com login — o bot já é reconhecido.
  if (discord.user) return;
  if (AUTO) return;
  if (!localStorage.getItem('miku-dash/convidado')) {
    $('login-overlay').hidden = false;
  }
}

async function initDiscord() {
  await tratarRedirect();
  await carregarUtilizador();
  renderizarUtilizador();
  decidirLogin();
}

/* ═══ ligação ═══ */

async function ligar() {
  // No modo manual, lê e guarda o que o utilizador escreveu.
  // No modo auto (servido pelo bot), usa a config injetada — sem digitar nada.
  if (!estado.auto) {
    if (!PROXY) {
      estado.url = $('input-url').value.trim().replace(/\/$/, '');
      localStorage.setItem('miku-dash/url', estado.url);
    }
    estado.token = $('input-token').value.trim();
    localStorage.setItem('miku-dash/token', estado.token);
  }

  if (!estado.url || !estado.token) {
    hint('hint-ligacao', 'Preenche a URL e o token.', 'erro');
    return;
  }

  pill('', 'A ligar…');
  try {
    await api('/api/status');
    estado.ligado = true;
    pill('online', 'Ligado');
    hint('hint-ligacao', 'Ligação estabelecida! 🩵', 'ok');
    if (estado.auto) $('cartao-ligacao').hidden = true;
    mostrarCartoes(true);
    await carregarEstado();
    await carregarGuilds();
    await carregarLogs();
    await carregarRanking(estado.rankTipo);
    estado.timer = setInterval(carregarLogs, 15000);
  } catch (erro) {
    estado.ligado = false;
    pill('erro', 'Sem ligação');
    $('cartao-ligacao').hidden = false; // mostra o cartão para tentar de novo
    let msg = erro.message;
    if (window.location.protocol === 'https:' && erro instanceof TypeError) {
      msg += ' — o site é HTTPS, por isso a API do bot tem de responder em HTTPS '
        + '(se o teu bot só tem HTTP, expõe-o com TLS/túnel ou testa primeiro numa página http:// local).';
    }
    if (PROXY) {
      msg += ' — confirma a variável MIKU_BOT_URL no Vercel e que o bot está online no Wispbyte.';
    }
    hint('hint-ligacao', `Falha: ${msg}`, 'erro');
  }
}

function desligar() {
  estado.ligado = false;
  clearInterval(estado.timer);
  pill('', 'Desligado');
  hint('hint-ligacao', 'Desligado do bot.');
  mostrarCartoes(false);
}

/* ═══ estado + servidores ═══ */

async function carregarEstado() {
  try {
    const dados = await api('/api/status');
    $('st-bot').textContent = dados.bot || '—';
    $('st-servidores').textContent = dados.servidores ?? 0;
    $('st-membros').textContent = dados.membros ?? 0;
    $('st-latencia').textContent = `${dados.latencia_ms ?? 0}ms`;
    $('st-uptime').textContent = formatarUptime(dados.uptime_s ?? 0);
    $('st-cogs').textContent = (dados.cogs || []).length;
  } catch (erro) {
    hint('hint-ligacao', `Estado: ${erro.message}`, 'erro');
  }
}

async function carregarGuilds() {
  try {
    const dados = await api('/api/guilds');
    estado.guilds = dados.guilds || [];
    const select = $('select-guild');
    select.innerHTML = estado.guilds
      .map((g) => `<option value="${g.id}">${escapar(g.nome)} (${g.membros})</option>`)
      .join('');
    if (estado.guildId && estado.guilds.some((g) => g.id === estado.guildId)) {
      select.value = estado.guildId;
    }
    estado.guildId = select.value;
    await carregarConfig();
    await carregarVerificacao();
    await carregarContadores();
    await carregarRanking(estado.rankTipo);
  } catch (erro) {
    hint('hint-ligacao', `Servidores: ${erro.message}`, 'erro');
  }
}

/* ═══ canais + config ═══ */

function preencherCanais(canais, selecionado) {
  for (const select of document.querySelectorAll('.canal-select')) {
    select.innerHTML = canais
      .map((c) => `<option value="${c.id}"># ${escapar(c.nome)}</option>`)
      .join('');
    if (selecionado && canais.some((c) => c.id === selecionado)) {
      select.value = selecionado;
    }
  }
}

async function carregarConfig() {
  if (!estado.guildId) return;
  try {
    const dados = await api(`/api/config?guild_id=${estado.guildId}`);
    estado.canais = dados.canais || [];
    preencherCanais(estado.canais, dados.boasvindas.canal_id || '');
    $('input-mensagem').value = dados.boasvindas.mensagem || '';
    $('input-cargo').value = dados.boasvindas.cargo || '';
    $('input-imagem').checked = !!dados.boasvindas.imagem;
    hint('hint-boasvindas', `A configurar: ${dados.guild.nome}`);
  } catch (erro) {
    hint('hint-boasvindas', `Config: ${erro.message}`, 'erro');
  }
}

async function guardarConfig() {
  try {
    await api('/api/config', {
      method: 'POST',
      body: JSON.stringify({
        guild_id: estado.guildId,
        boasvindas: {
          canal_id: $('select-canal').value,
          mensagem: $('input-mensagem').value,
          imagem: $('input-imagem').checked,
          cargo: $('input-cargo').value,
        },
      }),
    });
    hint('hint-boasvindas', '✅ Configuração guardada!', 'ok');
  } catch (erro) {
    hint('hint-boasvindas', `Erro: ${erro.message}`, 'erro');
  }
}

async function testarBoasVindas() {
  try {
    await api('/api/testar-boasvindas', {
      method: 'POST',
      body: JSON.stringify({ guild_id: estado.guildId }),
    });
    hint('hint-boasvindas', '🧪 Boas-vindas de teste enviada!', 'ok');
  } catch (erro) {
    hint('hint-boasvindas', `Erro: ${erro.message}`, 'erro');
  }
}

/* ═══ verificação ═══ */

async function carregarVerificacao() {
  if (!estado.guildId) return;
  try {
    const dados = await api(`/api/verificacao?guild_id=${estado.guildId}`);
    const select = $('select-cargo-verif');
    select.innerHTML = (dados.cargos || [])
      .map((c) => `<option value="${c.id}">@ ${escapar(c.nome)}</option>`)
      .join('');
    if (dados.cargo_id) select.value = dados.cargo_id;
    hint('hint-verif', dados.cargo_nome
      ? `Cargo atual: @${dados.cargo_nome}` : 'Ainda sem cargo definido.');
  } catch (erro) {
    hint('hint-verif', `Verificação: ${erro.message}`, 'erro');
  }
}

async function guardarVerificacao() {
  try {
    const dados = await api('/api/verificacao', {
      method: 'POST',
      body: JSON.stringify({
        guild_id: estado.guildId,
        cargo_id: $('select-cargo-verif').value,
      }),
    });
    hint('hint-verif', `✅ Cargo guardado: @${dados.cargo_nome}`, 'ok');
  } catch (erro) {
    hint('hint-verif', `Erro: ${erro.message}`, 'erro');
  }
}

async function publicarVerificacao() {
  try {
    await api('/api/verificacao/painel', {
      method: 'POST',
      body: JSON.stringify({
        guild_id: estado.guildId,
        channel_id: $('select-canal-verif').value,
      }),
    });
    hint('hint-verif', '📢 Painel de verificação publicado!', 'ok');
  } catch (erro) {
    hint('hint-verif', `Erro: ${erro.message}`, 'erro');
  }
}

/* ═══ contadores ═══ */

async function carregarContadores() {
  if (!estado.guildId) return;
  try {
    const dados = await api(`/api/contadores?guild_id=${estado.guildId}`);
    const lista = $('lista-contadores');
    const itens = dados.contadores || [];
    lista.innerHTML = itens.length
      ? itens.map((c) => `
        <li>
          <span>📊 <b>#${escapar(c.nome)}</b> — <code>${escapar(c.modelo)}</code></span>
          <button class="botao fantasma pequeno" data-contador="${c.canal_id}">🗑️</button>
        </li>`).join('')
      : '<li>Ainda sem contadores.</li>';
  } catch (erro) {
    hint('hint-contadores', `Contadores: ${erro.message}`, 'erro');
  }
}

async function criarContador() {
  const modelo = $('input-modelo').value.trim();
  if (!modelo) return hint('hint-contadores', 'Escreve o texto do contador.', 'erro');
  try {
    await api('/api/contadores', {
      method: 'POST',
      body: JSON.stringify({ guild_id: estado.guildId, acao: 'criar', modelo }),
    });
    $('input-modelo').value = '';
    hint('hint-contadores', '✅ Contador criado!', 'ok');
    await carregarContadores();
  } catch (erro) {
    hint('hint-contadores', `Erro: ${erro.message}`, 'erro');
  }
}

async function removerContador(canalId) {
  try {
    await api('/api/contadores', {
      method: 'POST',
      body: JSON.stringify({ guild_id: estado.guildId, acao: 'remover', canal_id: canalId }),
    });
    hint('hint-contadores', '🗑️ Contador removido.', 'ok');
    await carregarContadores();
  } catch (erro) {
    hint('hint-contadores', `Erro: ${erro.message}`, 'erro');
  }
}

/* ═══ anúncio em embed ═══ */

async function enviarEmbed() {
  try {
    await api('/api/embed', {
      method: 'POST',
      body: JSON.stringify({
        guild_id: estado.guildId,
        channel_id: $('select-canal-embed').value,
        titulo: $('input-titulo').value,
        descricao: $('input-descricao').value,
        cor: $('input-cor').value,
        rodape: $('input-rodape').value,
      }),
    });
    hint('hint-embed', '📢 Anúncio enviado!', 'ok');
  } catch (erro) {
    hint('hint-embed', `Erro: ${erro.message}`, 'erro');
  }
}

/* ═══ lembretes ═══ */

async function agendarLembrete() {
  const texto = $('input-lembrete').value.trim();
  if (!texto) return hint('hint-lembrete', 'Escreve o lembrete primeiro.', 'erro');
  try {
    const dados = await api('/api/lembrete', {
      method: 'POST',
      body: JSON.stringify({
        guild_id: estado.guildId,
        channel_id: $('select-canal-lembrete').value,
        minutos: $('input-minutos').value,
        texto,
      }),
    });
    $('input-lembrete').value = '';
    hint('hint-lembrete', `⏰ Lembrete agendado para daqui a ${dados.minutos} min!`, 'ok');
  } catch (erro) {
    hint('hint-lembrete', `Erro: ${erro.message}`, 'erro');
  }
}

/* ═══ moderação rápida ═══ */

async function limparMensagens() {
  const quantidade = $('input-quantidade').value;
  if (!confirm(`Apagar ${quantidade} mensagens? Esta ação não pode ser desfeita.`)) return;
  try {
    const dados = await api('/api/moderacao/limpar', {
      method: 'POST',
      body: JSON.stringify({
        guild_id: estado.guildId,
        channel_id: $('select-canal-mod').value,
        quantidade,
      }),
    });
    hint('hint-mod', `🧹 ${dados.apagadas} mensagens apagadas.`, 'ok');
  } catch (erro) {
    hint('hint-mod', `Erro: ${erro.message}`, 'erro');
  }
}

/* ═══ rankings ═══ */

async function carregarRanking(tipo) {
  if (!estado.ligado || !estado.guildId) return;
  estado.rankTipo = tipo;
  try {
    const dados = await api(`/api/leaderboard?tipo=${tipo}&guild_id=${estado.guildId}`);
    const lista = $('lista-ranking');
    const top = dados.top || [];
    lista.innerHTML = top.length
      ? top.map((l, i) => `
        <li>
          <span class="pos">${i + 1}.</span>
          <span><b>${escapar(l.nome)}</b> <span class="extra">${escapar(l.extra)}</span></span>
          <span class="valor">${l.valor}</span>
        </li>`).join('')
      : '<li>Ainda sem dados.</li>';
  } catch (erro) {
    hint('hint-ligacao', `Ranking: ${erro.message}`, 'erro');
  }
}

/* ═══ falar como a Miku ═══ */

async function enviarMensagem() {
  const texto = $('input-say').value.trim();
  if (!texto) return hint('hint-say', 'Escreve uma mensagem primeiro.', 'erro');
  try {
    await api('/api/say', {
      method: 'POST',
      body: JSON.stringify({
        guild_id: estado.guildId,
        channel_id: $('select-canal-say').value,
        content: texto,
      }),
    });
    $('input-say').value = '';
    hint('hint-say', '✅ Mensagem enviada!', 'ok');
  } catch (erro) {
    hint('hint-say', `Erro: ${erro.message}`, 'erro');
  }
}

/* ═══ logs ═══ */

async function carregarLogs() {
  if (!estado.ligado) return;
  try {
    const dados = await api('/api/logs');
    const lista = $('lista-logs');
    const logs = dados.logs || [];
    lista.innerHTML = logs.length
      ? logs.slice().reverse().map((l) => `<li>${escapar(l)}</li>`).join('')
      : '<li>Ainda sem registos.</li>';
  } catch {
    /* o próximo poll tenta de novo */
  }
}

/* ═══ arranque ═══ */

$('input-url').value = estado.url;
$('input-token').value = estado.token;
if (PROXY) {
  // No Vercel a URL é automática (proxy) — o campo deixa de ser necessário.
  $('input-url').closest('label').hidden = true;
  hint('hint-ligacao', 'Escreve o token do painel e clica em Ligar.');
}

$('btn-ligar').addEventListener('click', ligar);
$('btn-desligar').addEventListener('click', desligar);
$('btn-guardar').addEventListener('click', guardarConfig);
$('btn-testar').addEventListener('click', testarBoasVindas);
$('btn-enviar').addEventListener('click', enviarMensagem);
$('btn-logs').addEventListener('click', carregarLogs);

$('btn-guardar-verif').addEventListener('click', guardarVerificacao);
$('btn-publicar-verif').addEventListener('click', publicarVerificacao);
$('btn-contador-criar').addEventListener('click', criarContador);
$('btn-enviar-embed').addEventListener('click', enviarEmbed);
$('btn-lembrete').addEventListener('click', agendarLembrete);
$('btn-limpar').addEventListener('click', limparMensagens);
$('btn-rank-refresh').addEventListener('click', () => carregarRanking(estado.rankTipo));

for (const btn of document.querySelectorAll('[data-rank]')) {
  btn.addEventListener('click', () => carregarRanking(btn.dataset.rank));
}

$('lista-contadores').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-contador]');
  if (btn) removerContador(btn.dataset.contador);
});

$('btn-discord-login').addEventListener('click', loginDiscord);
$('btn-login-discord').addEventListener('click', loginDiscord);
$('btn-discord-logout').addEventListener('click', logoutDiscord);
$('btn-continuar').addEventListener('click', () => {
  localStorage.setItem('miku-dash/convidado', '1');
  $('login-overlay').hidden = true;
});

$('select-guild').addEventListener('change', (e) => {
  estado.guildId = e.target.value;
  localStorage.setItem('miku-dash/guild', estado.guildId);
  carregarConfig();
  carregarVerificacao();
  carregarContadores();
  carregarRanking(estado.rankTipo);
});

// Sessão do Discord + ligação automática
initDiscord();
if (estado.auto) {
  hint('hint-ligacao', '🔗 Ligação automática ativa — o bot foi reconhecido sozinho.');
}
if (estado.url && estado.token) ligar();
