// node --test servidor.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Uma Evolution de mentira, para ver o que sairia.
const recebidos = [];
const evolution = createServer((req, res) => {
  let c = '';
  req.on('data', (d) => (c += d));
  req.on('end', () => {
    recebidos.push({ url: req.url, chave: req.headers.apikey, corpo: JSON.parse(c) });
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end('{"status":"PENDING"}');
  });
});

let base, servidor, limparNome, limparWhatsapp;

before(async () => {
  await new Promise((r) => evolution.listen(0, r));
  process.env.EVOLUTION_API_URL = `http://127.0.0.1:${evolution.address().port}`;
  process.env.EVOLUTION_API_KEY = 'chave-teste';
  process.env.EVOLUTION_INSTANCE = 'central';
  process.env.INTERESSE_WHATSAPP = '(11) 91111-2222';
  ({ servidor, limparNome, limparWhatsapp } = await import('./servidor.mjs'));
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => { servidor.close(); evolution.close(); });

const postar = (corpo, ip = '1.1.1.1', json = true) =>
  fetch(`${base}/interesse`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Forwarded-For': ip,
      ...(json ? { Accept: 'application/json' } : {}),
    },
    body: new URLSearchParams(corpo).toString(),
  });

test('WhatsApp: aceita celular e fixo com DDD, com ou sem 55', () => {
  assert.equal(limparWhatsapp('(11) 98765-4321'), '11987654321');
  assert.equal(limparWhatsapp('+55 11 98765-4321'), '11987654321');
  assert.equal(limparWhatsapp('1132654321'), '1132654321');
  assert.equal(limparWhatsapp('98765-4321'), null);
  assert.equal(limparWhatsapp('(11) 88765-4321'), null);
  assert.equal(limparWhatsapp('(01) 98765-4321'), null);
});

test('nome: tira a formatação do WhatsApp e confere o tamanho', () => {
  assert.equal(limparNome('  *Rafael*   Souza '), 'Rafael Souza');
  assert.equal(limparNome('R'), null);
  assert.equal(limparNome('x'.repeat(61)), null);
});

test('interesse válido vira WhatsApp para o número fixo', async () => {
  recebidos.length = 0;
  const r = await postar({ nome: 'Rafael', whatsapp: '(11) 98765-4321' }, '2.2.2.2');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(recebidos.length, 1);
  assert.equal(recebidos[0].url, '/message/sendText/central');
  assert.equal(recebidos[0].chave, 'chave-teste');
  assert.equal(recebidos[0].corpo.number, '5511911112222');
  assert.match(recebidos[0].corpo.text, /Nome: Rafael/);
  assert.match(recebidos[0].corpo.text, /wa\.me\/5511987654321/);
});

test('sem JavaScript: volta para a página com o resultado', async () => {
  const r = await postar({ nome: 'Ana', whatsapp: '11987654321' }, '3.3.3.3', false);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/?enviado=1#comecar');
});

test('isca preenchida: finge sucesso e não manda nada', async () => {
  recebidos.length = 0;
  const r = await postar({ nome: 'Robô', whatsapp: '11987654321', site: 'http://spam' }, '4.4.4.4');
  assert.equal(r.status, 200);
  assert.equal(recebidos.length, 0);
});

test('dados ruins: 400 e nada sai', async () => {
  recebidos.length = 0;
  const r = await postar({ nome: 'Ze', whatsapp: '123' }, '5.5.5.5');
  assert.equal(r.status, 400);
  assert.equal(recebidos.length, 0);
});

test('limite por IP: o sexto em 10 minutos é recusado', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await postar({ nome: 'Lia', whatsapp: '11987654321' }, '6.6.6.6')).status, 200);
  assert.equal((await postar({ nome: 'Lia', whatsapp: '11987654321' }, '6.6.6.6')).status, 429);
});

test('corpo grande demais: 413', async () => {
  const r = await postar({ nome: 'x'.repeat(3000), whatsapp: '11987654321' }, '7.7.7.7');
  assert.equal(r.status, 413);
});

test('arquivos: nada fora da pasta pública', async () => {
  assert.equal((await fetch(`${base}/..%2fservidor.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/servidor.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/servidor.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/interesse`)).status, 405);
  assert.equal((await fetch(`${base}/saude`)).status, 200);
});
