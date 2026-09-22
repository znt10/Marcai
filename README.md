<div align="center">

# Marcai

**Agenda para barbearias, uma barbearia por subdomínio.**

O cliente marca sozinho pelo celular e recebe confirmação no WhatsApp.
O barbeiro abre o painel e vê o dia dele. O dono vê a casa inteira.

[![Backend](https://img.shields.io/badge/backend-Django%20%2B%20Celery-092E20?style=flat-square&logo=django)](https://github.com/znt10/Marcai-back)
[![Frontend](https://img.shields.io/badge/frontend-Next.js%2016-000000?style=flat-square&logo=nextdotjs)](https://github.com/znt10/Marcai-front)
[![Postgres](https://img.shields.io/badge/isolamento-Row%20Level%20Security-4169E1?style=flat-square&logo=postgresql&logoColor=white)](#o-isolamento-entre-barbearias)
[![WhatsApp](https://img.shields.io/badge/whatsapp-integrado-25D366?style=flat-square&logo=whatsapp)](#whatsapp)
[![License](https://img.shields.io/badge/licen%C3%A7a-MIT-blue?style=flat-square)](#licença)

[Site](https://www.usemarcai.online) &middot;
[Backend](https://github.com/znt10/Marcai-back) &middot;
[Frontend](https://github.com/znt10/Marcai-front) &middot;
[Propostas](#propostas)

</div>

> [!TIP]
> ### 🔑 Acesso de teste
>
> | | |
> |---|---|
> | **Número** | `11911112222` |
> | **Senha** | `teste-12345` |
>
> Conta de demonstração, com dados descartáveis.

---

## Em resumo

Barbearia trabalha com agenda de caderno e telefone. O cliente liga, alguém
atende com a máquina na mão, e o horário some quando a página vira. Quem tenta
resolver isso com app genérico de agendamento esbarra no mesmo lugar: a agenda
de uma barbearia não é uma agenda só — é a agenda de cada barbeiro, com o
serviço que cada um faz, no tempo que cada um leva.

| | |
|---|---|
| 🏠 **Uma barbearia por subdomínio** | `brutus.exemplo.com` é uma casa, `dontony.exemplo.com` é outra — dados isolados no banco, não só na tela |
| 📱 **O cliente marca sozinho** | escolhe serviço, barbeiro e horário; recebe confirmação no WhatsApp |
| ⏰ **Lembrete 1h antes** | sai entre 50 e 60 minutos antes, uma vez só, e é calado para quem acabou de marcar |
| ✂️ **Agenda por barbeiro** | cada um tem expediente, folga, pausa e o próprio catálogo de serviços com a própria duração |
| 📋 **Quadro do dia** | a equipe lado a lado, com o próximo horário livre de cada um — para o cliente parado no balcão |
| 👤 **Três alcances** | plataforma, dono e barbeiro veem coisas diferentes, e a fronteira é aplicada na API |

**Stack:** Django + Celery + Postgres com RLS no backend, Next.js 16 +
TypeScript no frontend, Evolution API para o WhatsApp, tudo em Docker.

---

## O que é o Marcai

Um SaaS de agendamento onde **cada barbearia é um tenant**, servido no próprio
subdomínio. A casa entra no ar com um endereço, uma vitrine pública com a
equipe e os preços, e um painel para quem trabalha lá.

O recorte é a barbearia de bairro com dois a seis barbeiros — grande o bastante
para o caderno já não dar conta, pequena demais para ter alguém dedicado a
atender telefone.

### O fluxo do cliente

Ele abre o endereço da barbearia, escolhe o serviço, vê os barbeiros que fazem
aquele serviço com o preço de cada um, escolhe o horário e confirma com nome e
WhatsApp. Não cria conta, não instala nada. A confirmação chega no zap dele, e
o lembrete também.

Os horários oferecidos saem de um motor que cruza quatro coisas: o expediente
daquele barbeiro naquele dia da semana, os bloqueios (almoço, folga, compromisso
pontual), o que já está vendido, e a **duração que aquele barbeiro pratica para
aquele serviço** — que é dele, não do catálogo. Barbeiro rápido cabe mais gente
no mesmo dia, e a agenda reflete isso sozinha.

### O painel de quem trabalha

| Tela | Quem mexe |
|---|---|
| **Agenda** (`/painel`) | dono vê a casa toda e filtra por barbeiro; barbeiro vê só a dele |
| **Quadro do dia** (`/painel/dia`) | uma coluna por barbeiro, com ocupação e próximo horário livre |
| **Equipe** (`/painel/equipe`) | só o dono: cadastra, corrige, reemite convite, desativa |
| **Horários** (`/painel/horarios`) | dono mexe no de todos, barbeiro só no seu |
| **Serviços** (`/painel/servicos`) | catálogo é do dono; quem faz o quê e em quanto tempo é de cada um |

O barbeiro nasce por **convite**: o dono cadastra, o link vai pelo WhatsApp e
aparece na tela uma vez. O token só existe em hash no banco — link perdido não
se recupera, reemite. E reemitir convite *é* o reset de senha.

### O painel da plataforma

Em `admin.<domínio>`, fora de qualquer barbearia: cria casas com o primeiro
dono, liga e desliga, reemite o convite do dono. Em qualquer subdomínio de
barbearia, `/admin` e `/api/admin/*` respondem **404** — a barreira está no
proxy do front, então rota nova sob esse prefixo já nasce protegida.

---

## O isolamento entre barbearias

É a decisão que sustenta o resto, e ela não mora na aplicação.

O Postgres tem **Row Level Security** nas tabelas de tenant, e a aplicação roda
sob um papel (`brutus_app`) que **não tem DDL** e não pode desligar a política.
Cada requisição resolve a barbearia pelo subdomínio e fixa esse identificador na
conexão; a partir daí, uma consulta sem filtro devolve só as linhas daquela
casa. Um `SELECT` esquecido não vaza a agenda do vizinho — ele volta vazio.

Isso é testado contra um banco real, com as migrações aplicadas: a suíte do
backend roda **sem** `--no-migrations` de propósito, porque são as migrações que
criam a política. Pular todas testaria um banco que nenhum ambiente tem.

Três decisões que acompanham:

- **Dois papéis no banco.** `brutus_owner` tem DDL e roda as migrações;
  `brutus_app` é o runtime e não tem — nem deve ter.
- **404, nunca 403,** para ação sobre registro de outro barbeiro. 403
  confirmaria que o registro existe.
- **Segredos de sessão separados.** O cookie do painel e o cookie do admin são
  assinados com segredos diferentes, então um não abre o outro sem que exista
  nenhuma checagem escrita para isso.

---

## Arquitetura

```text
        cliente                    barbeiro / dono              plataforma
   brutus.exemplo.com          brutus.exemplo.com/painel    admin.exemplo.com
           │                            │                          │
           └────────────────┬───────────┴──────────────────────────┘
                            ▼
              ┌──────────────────────────────┐
              │   Frontend — Next.js 16        │
              │   proxy.ts no runtime Edge:     │
              │   resolve o subdomínio e guarda │
              │   /admin/* antes de qualquer    │
              │   rota rodar                    │
              └───────────────┬────────────────┘
                              │  fetch (cookie HTTP-only assinado)
                              ▼
              ┌──────────────────────────────┐
              │   Backend — Django              │
              │   resolve o tenant pelo Host e   │
              │   fixa o escopo na conexão       │
              └───┬───────────┬────────────┬───┘
                  │           │            │
                  ▼           ▼            ▼
        ┌──────────────┐ ┌─────────┐ ┌──────────────────┐
        │  Postgres      │ │  Redis    │ │  Evolution API     │
        │  RLS por        │ │  broker   │ │  (Baileys, self-   │
        │  barbearia      │ │           │ │  hosted)            │
        └──────────────┘ └────┬────┘ └─────────┬────────┘
                                  │              │
                                  ▼              ▼
                        ┌──────────────┐   WhatsApp do cliente
                        │  Celery         │   (confirmação, cancelamento,
                        │  worker + beat   │    lembrete, convite)
                        └──────────────┘
```

Os dois `docker compose` (um em cada repositório) dividem a rede externa
`brutus`, criada à mão. Ela é `external: true` de propósito nos dois lados:
vive mais que qualquer um dos composes, porque Postgres, Redis e Evolution
atendem os dois. Se um compose a criasse, ela morreria no `down` de quem a
criou e o outro lado perderia o banco no meio do trabalho.

---

## WhatsApp

Todo contato com gente de fora sai por lá: confirmação, cancelamento, lembrete e
convite de barbeiro. O canal roda sobre a
[Evolution API](https://github.com/EvolutionAPI/evolution-api), auto-hospedada
via Docker — sem depender da API oficial paga da Meta.

Quem fala com ela é o **Django**, nunca o front. O envio é fire-and-forget por
decisão: WhatsApp fora do ar não pode desfazer um agendamento nem deixar um
barbeiro sem convite.

O lembrete é uma tarefa de Celery beat que bate a cada 10 minutos e dispara o
que estiver na janela. Sai entre 50 e 60 minutos antes do horário, uma vez só
por agendamento — e quem marca já dentro da janela **não** recebe, porque a
confirmação que acabou de chegar já é o lembrete.

**Um número para a plataforma inteira.** Quem identifica a casa é o texto da
mensagem, que já leva nome e endereço.

---

## Como está organizado

Este repositório é o guarda-chuva. O código vive em dois repositórios
independentes, ligados aqui como submódulos:

```text
Marcai/
├── backend/    → znt10/Marcai-back    Django + Celery + Postgres (RLS) + Evolution API
└── frontend/   → znt10/Marcai-front   Next.js 16 + React 19 + TypeScript
```

Cada um tem o próprio README, com variáveis de ambiente, comandos e as decisões
internas daquele lado.

O backend sobe, testa e vai para produção **sozinho** — o front depende dele,
não o contrário. E é o backend quem cria e migra o schema do banco.

---

## Quick start

### Pré-requisitos

- **Docker** e **Docker Compose**
- **Git**

### Clonar

Com os submódulos — sem a flag, `backend/` e `frontend/` vêm vazias:

```bash
git clone --recurse-submodules https://github.com/znt10/Marcai.git
cd Marcai
```

Se já clonou sem a flag:

```bash
git submodule update --init --recursive
```

### A rede compartilhada, uma vez por máquina

```bash
docker network create brutus
```

### Backend primeiro

```bash
cd backend
cp .env.example .env      # o arquivo documenta cada variável
docker compose up -d --build
```

Sobe Postgres, Redis, Evolution, a API Django em `localhost:8000`, o worker e o
beat. Para popular com duas barbearias de exemplo e a equipe de cada uma:

```bash
docker compose run --rm api python manage.py semear
```

### Frontend

```bash
cd ../frontend
cp .env.example .env
docker compose up
```

- `http://brutus.localhost:3000` — uma barbearia
- `http://dontony.localhost:3000` — outra
- `http://admin.localhost:3000` — o painel da plataforma

`*.localhost` resolve sozinho no Chrome e no Firefox: não precisa mexer em DNS.

> **Atenção às variáveis compartilhadas.** `DOMINIO_BASE`, `SESSAO_JWT_SECRET` e
> `ADMIN_JWT_SECRET` precisam ter o **mesmo valor** nos dois `.env` — o cookie é
> emitido de um lado e lido do outro. Divergir desloga a cada navegação, e o
> sintoma não aponta para a causa.

### Testar

```bash
cd backend  && docker compose run --rm api pytest -q
cd frontend && npm test
```

---

## Tecnologias

**Backend** — Python, Django, Celery + Redis, Postgres com Row Level Security,
argon2 para senhas, Evolution API (WhatsApp), pytest, Docker Compose

**Frontend** — Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS,
zod, jose (JWT em cookie HTTP-only), date-fns, Vitest

---

## Propostas

O que está registrado para as próximas etapas, com o motivo. Nada aqui está em
construção.

### PWA do painel — só de quem trabalha

Um app instalável para o barbeiro abrir no celular e já ter o dia dele à mão.
**Escopo: `/painel` e `/admin`, não o fluxo do cliente** — a tela pública é
visitada uma vez por corte, por gente que não vai instalar app de barbearia.

A pergunta que precisa de resposta antes de virar etapa é o que "offline" serve
aqui. Agenda em cache tem valor real (o barbeiro consulta com a mão ocupada e o
sinal ruim), mas agenda em cache é agenda desatualizada, e *"achei que o horário
estava livre"* é pior que *"não carregou"*. O desenho provável: ler do cache com
marca visível de "visto às HH:MM", e **nunca** deixar marcar offline.

Cada barbearia tem subdomínio próprio, então cada uma viraria um PWA distinto no
aparelho — com ícone e nome próprios, o que provavelmente é o desejado, mas
significa manifest gerado por tenant.

### Avisar o barbeiro sobre a própria agenda

Hoje o cliente recebe três tipos de mensagem e o **barbeiro, zero**. Ele
descobre que tem gente nova abrindo o painel.

O caso que mais dói é o cancelamento: o cliente desmarca às 14h e o barbeiro só
percebe às 15h, olhando a tela, com um buraco que daria para vender.

A infraestrutura de envio já existe — é fatia pequena depois de duas decisões de
produto: marcação pelo cliente avisa só o barbeiro escolhido ou o dono também
(dono de equipe de cinco receberia mensagem toda hora), e **encaixe do balcão
não deve avisar**, porque mandar mensagem para quem acabou de marcar na mão é
ruído.

### Perceber quando o WhatsApp cai

O contêiner da Evolution já reiniciou, gravou a sessão como `close` e não
reconectou sozinho. Duas barbearias foram cadastradas nesse intervalo e os
convites dos donos falharam em silêncio — nada na tela mudou.

O envio ser fire-and-forget está certo. O problema é que ele virou
*fire-and-forget-and-shut-up*. As duas saídas, provavelmente ambas: um
**healthcheck no beat**, que já bate a cada 10 minutos e pode conferir o
`connectionState` no mesmo tique, e um **selo vermelho na lista do admin**, que
é onde a pessoa que pode agir está olhando.

O que **não** resolve é reconectar sozinho: reconexão exige o QR, que exige uma
pessoa com o celular. O sistema pode avisar, não consertar.

### Dizer que reemitir convite apaga a senha

Reemitir convite *é* o reset de senha, e a interface não diz. Dois donos já
ficaram sem acesso exatamente assim, e o sintoma na tela é "celular ou senha
inválidos", que aponta para o lugar errado.

A correção do botão é pequena. A da mensagem de login exige cuidado: contar que
a conta existe mas está sem senha vaza quais números estão cadastrados — o
genérico de hoje é a resposta certa para isso.

### Alinhar o seed com a regra do próprio produto

`SENHA_MINIMA` é 8 e o seed grava uma senha de 6. Não quebra nada (o seed
escreve o hash direto), mas é uma regra que o projeto afirma e desobedece no
próprio fixture — e o sintoma aparece quando alguém tenta restaurar o estado do
seed pela ferramenta oficial e é recusado.

---

## Licença

MIT — veja o arquivo `LICENSE` em cada repositório
([backend](https://github.com/znt10/Marcai-back/blob/master/LICENSE),
[frontend](https://github.com/znt10/Marcai-front/blob/main/LICENSE)).

---

<p align="center">
  Feito por <a href="https://github.com/znt10">znt10</a>
</p>
