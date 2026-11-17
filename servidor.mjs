// O site (www.usemarcai.online) na VPS: serve a landing e recebe o
// "quero o Marcaí" do formulário, que vira um WhatsApp para o José.
//
// Sem dependência nenhuma (só o Node), de propósito: é um contêiner exposto
// na internet que guarda a chave da Evolution, e cada pacote a menos é uma
// porta a menos.
//
// O que protege o formulário:
// - o DESTINO é fixo (`INTERESSE_WHATSAPP`, no servidor). Quem preenche só
//   escreve o texto; não há como usar esta rota para mandar mensagem a
//   outra pessoa;
// - limite por IP e um teto geral por hora;
// - o campo-isca `site`, invisível para gente e preenchido por robô;
// - corpo pequeno (2 KB) e nome e telefone conferidos.
//
// Ninguém recebe resposta automática no WhatsApp: o aviso vai só para o
// José, que puxa a conversa.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTA = Number(process.env.PORT ?? 3000);
const PUBLICO = join(fileURLToPath(new URL('.', import.meta.url)), 'publico');
const EVOLUTION_URL = (process.env.EVOLUTION_API_URL ?? '').replace(/\/+$/, '');
const EVOLUTION_CHAVE = process.env.EVOLUTION_API_KEY ?? '';
const EVOLUTION_INSTANCIA = process.env.EVOLUTION_INSTANCE ?? '';
const DESTINO = (process.env.INTERESSE_WHATSAPP ?? '').replace(/\D/g, '');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// A página usa estilo e script em linha e as fontes do Google; nada mais
// carrega de fora, e o formulário só posta aqui mesmo.
const CABECALHOS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "script-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; '),
};

// ---- Limites ----
// Em memória: um contêiner só, e perder a contagem num restart não é grave.
const POR_IP = { maximo: 5, janelaMs: 10 * 60_000 };
const GERAL = { maximo: 60, janelaMs: 60 * 60_000 };
const contagem = new Map(); // ip -> [instantes]
let geral = [];

function passou(lista, agora, janelaMs) {
  return lista.filter((t) => agora - t < janelaMs);
}

function podeEnviar(ip) {
  const agora = Date.now();
  geral = passou(geral, agora, GERAL.janelaMs);
  const doIp = passou(contagem.get(ip) ?? [], agora, POR_IP.janelaMs);
  if (geral.length >= GERAL.maximo || doIp.length >= POR_IP.maximo) {
    contagem.set(ip, doIp);
    return false;
  }
  doIp.push(agora);
  geral.push(agora);
  contagem.set(ip, doIp);
  return true;
}

// Limpa quem não aparece há mais de uma janela, para o mapa não crescer.
setInterval(() => {
  const agora = Date.now();
  for (const [ip, lista] of contagem) {
    if (!passou(lista, agora, POR_IP.janelaMs).length) contagem.delete(ip);
  }
}, POR_IP.janelaMs).unref();

// O Traefik não confia no X-Forwarded-For que chega de fora e escreve o
// dele: o primeiro da lista é o IP de quem abriu a página.
function ipDe(req) {
  const xff = req.headers['x-forwarded-for'];
  return (typeof xff === 'string' && xff.split(',')[0].trim()) || req.socket.remoteAddress || '?';
}

// ---- Conferência dos campos ----
export function limparNome(bruto) {
  const nome = String(bruto ?? '')
    .replace(/[\u0000-\u001f\u007f*_~`]/g, ' ') // controle e a formatação do WhatsApp
    .replace(/\s+/g, ' ')
    .trim();
  return nome.length >= 2 && nome.length <= 60 ? nome : null;
}

/// Celular ou fixo do Brasil, com DDD: 10 ou 11 dígitos, aceitando o 55 na
/// frente. Devolve só os dígitos sem o 55, ou null.
export function limparWhatsapp(bruto) {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (Number(d.slice(0, 2)) < 11) return null;
  if (d.length === 11 && d[2] !== '9') return null;
  return d;
}

function formatar(d) {
  return d.length === 11
    ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
    : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

export function mensagemPara(nome, whatsapp) {
  return [
    '🔔 Interessado no Marcaí pelo site',
    '',
    `Nome: ${nome}`,
    `WhatsApp: ${formatar(whatsapp)}`,
    `wa.me/55${whatsapp}`,
  ].join('\n');
}

async function avisarOJose(texto) {
  if (!EVOLUTION_URL || !DESTINO) {
    // Em desenvolvimento não há Evolution: só registra.
    console.log('[interesse] sem EVOLUTION_API_URL/INTERESSE_WHATSAPP:\n' + texto);
    return true;
  }
  try {
    const r = await fetch(`${EVOLUTION_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCIA)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_CHAVE },
      body: JSON.stringify({ number: `55${DESTINO}`, text: texto }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.error(`[interesse] Evolution recusou (${r.status}): ${(await r.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[interesse] falha ao chamar a Evolution:', e.message);
    return false;
  }
}

// ---- Corpo do pedido ----
const LIMITE_CORPO = 2048;

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > LIMITE_CORPO) {
        // Responde o 413 antes de fechar: derrubar a conexão aqui deixaria
        // o navegador sem resposta nenhuma.
        req.removeAllListeners('data');
        req.resume();
        reject(new Error('grande'));
        return;
      }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function campos(req, texto) {
  const tipo = req.headers['content-type'] ?? '';
  if (tipo.startsWith('application/json')) {
    try {
      const o = JSON.parse(texto);
      return o && typeof o === 'object' ? o : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(texto));
}

// ---- Respostas ----
function responder(res, status, corpo, extra = {}) {
  res.writeHead(status, { ...CABECALHOS, ...extra });
  res.end(corpo);
}

function json(res, status, objeto) {
  responder(res, status, JSON.stringify(objeto), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

// Quem posta pelo `fetch` da página recebe JSON; quem posta sem JavaScript
// volta para a página com o resultado no endereço.
function resultado(req, res, status, ok, erro) {
  if ((req.headers.accept ?? '').includes('application/json')) {
    json(res, status, ok ? { ok: true } : { ok: false, erro });
    return;
  }
  const destino = ok ? '/?enviado=1#comecar' : `/?erro=${encodeURIComponent(erro)}#comecar`;
  responder(res, 303, '', { Location: destino });
}

async function receberInteresse(req, res) {
  let texto;
  try {
    texto = await lerCorpo(req);
  } catch {
    res.setHeader('Connection', 'close');
    res.on('finish', () => req.destroy());
    return resultado(req, res, 413, false, 'Pedido grande demais.');
  }
  const f = campos(req, texto);

  // Robô que preencheu a isca: finge que deu certo e não manda nada.
  if (String(f.site ?? '').trim()) return resultado(req, res, 200, true);

  const nome = limparNome(f.nome);
  const whatsapp = limparWhatsapp(f.whatsapp);
  if (!nome) return resultado(req, res, 400, false, 'Confere o seu nome.');
  if (!whatsapp) return resultado(req, res, 400, false, 'Confere o WhatsApp, com DDD.');

  if (!podeEnviar(ipDe(req))) {
    return resultado(req, res, 429, false, 'Muitos envios. Tenta de novo daqui a pouco.');
  }

  const saiu = await avisarOJose(mensagemPara(nome, whatsapp));
  if (!saiu) {
    // O contato não pode se perder: fica no log do contêiner para o José ler.
    console.error(`[interesse] NÃO ENVIADO — ${nome} ${whatsapp}`);
    return resultado(req, res, 502, false, 'Não deu para enviar agora. Tenta de novo em instantes.');
  }
  return resultado(req, res, 200, true);
}

async function servirArquivo(req, res, caminho) {
  const relativo = caminho === '/' ? 'index.html' : decodeURIComponent(caminho).replace(/^\/+/, '');
  const arquivo = normalize(join(PUBLICO, relativo));
  // Nada fora de `publico/`, nem com `..` codificado.
  if (!arquivo.startsWith(PUBLICO + sep) || !TIPOS[extname(arquivo)]) {
    return responder(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  try {
    const conteudo = await readFile(arquivo);
    const html = extname(arquivo) === '.html';
    responder(res, 200, req.method === 'HEAD' ? '' : conteudo, {
      'Content-Type': TIPOS[extname(arquivo)],
      'Cache-Control': html ? 'no-cache' : 'public, max-age=86400',
    });
  } catch {
    responder(res, 404, 'Não encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

export const servidor = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://site');
  try {
    if (pathname === '/saude') return responder(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    if (pathname === '/interesse') {
      if (req.method !== 'POST') return responder(res, 405, '', { Allow: 'POST' });
      return await receberInteresse(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return responder(res, 405, '', { Allow: 'GET, HEAD' });
    return await servirArquivo(req, res, pathname);
  } catch (e) {
    console.error('[site] erro:', e);
    if (!res.headersSent) responder(res, 500, 'Erro', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  servidor.listen(PORTA, () => console.log(`[site] no ar na porta ${PORTA}`));
}
