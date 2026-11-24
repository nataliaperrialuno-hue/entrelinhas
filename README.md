# Entrelinhas

**Cartas digitais que se despedem.** O Entrelinhas é uma aplicação web para escrever cartas que podem ser lidas uma única vez: depois de aberta, a mensagem se apaga progressivamente conforme a leitura avança.

## Objetivo

Recriar, no ambiente digital, a sensibilidade de uma carta manuscrita que se consome ao ser lida. A proposta é valorizar a escrita direta, o gesto de enviar e a natureza efêmera da mensagem — sem contas de usuário, feeds ou histórico persistente da leitura.

O projeto é um monorepo de estudo e demonstração, organizado para permitir evolução incremental com testes automatizados em cada etapa.

## Funcionalidades principais

- **Criação de cartas:** remetente (com opção de anonimato), destinatário, título, mensagem e assinatura.
- **Temas combináveis:** envelope, selo, paleta de cores, tipografia e textura do papel.
- **Prévia em tempo real:** a carta é mostrada exatamente como será lida.
- **Leitura única:** cada carta gera um link compartilhável no formato `/leitura/<sessionId>`.
- **Apagamento progressivo:** os parágrafos perdem nitidez e opacidade à medida que o leitor avança.
- **Sessões protegidas:** tokens assinados com HMAC, heartbeat, janela de carência e invalidamento da sessão anterior quando uma nova é iniciada.
- **Limites de segurança:** `helmet`, corpo JSON limitado a 32 kb e limitação de taxa nas rotas sensíveis.
- **Acessibilidade:** suporte a `prefers-reduced-motion`, foco visível e contraste cuidadoso nas paletas.

## Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Linguagem | TypeScript 5.9 |
| Frontend | React 19, Vite 7, CSS puro |
| Backend | Express 5, Node 24 (`node:sqlite`) |
| Banco de dados | SQLite nativo do Node, via `node:sqlite` |
| Validação | Zod 4 |
| Segurança HTTP | Helmet 8, `express-rate-limit` 8 |
| Testes | Vitest, Testing Library, Supertest, Playwright |
| Ferramentas | npm workspaces, ESLint 9, concurrently |

## Arquitetura

O monorepo é dividido em dois workspaces:

- `@entrelinhas/frontend`: aplicação React com roteamento mínimo baseado em `window.location.pathname`. Não há router externo: `/` exibe a criação e `/leitura/:sessionId` exibe a leitura.
- `@entrelinhas/backend`: API HTTP responsável por persistir cartas, emitir tokens de leitura, controlar sessões e coordenar o progresso. O banco é SQLite local com transações `BEGIN IMMEDIATE` para evitar corridas entre leitores.

O frontend se comunica com a API por `/api/*` e por links curtos de leitura; em desenvolvimento, o Vite faz proxy desses caminhos para a porta `3001`. Em produção, o próprio Express serve o build do frontend.

As fronteiras de dados são os tipos em `frontend/src/shared/types.ts` e os contratos de rotas implementados nos módulos `backend/src/modules`.

## Estrutura de pastas

```text
entrelinhas/
├── backend/
│   ├── src/
│   │   ├── app.ts                 # fábrica da aplicação Express
│   │   ├── config.ts              # leitura e validação das variáveis de ambiente
│   │   ├── server.ts              # entrypoint: banco, listen e estático em produção
│   │   ├── db/
│   │   │   ├── client.ts          # DatabaseSync, migrações e transações
│   │   │   └── migrations/
│   │   │       └── 001_init.sql   # esquema inicial de cartas e sessões
│   │   └── modules/               # regras e rotas de letters/reading
│   └── test/
├── frontend/
│   ├── index.html
│   ├── src/
│   │   ├── App.tsx                # roteamento por pathname
│   │   ├── main.tsx               # mount React
│   │   ├── features/
│   │   │   ├── creation/          # formulário e prévia de criação
│   │   │   └── reading/           # experiência de leitura única
│   │   ├── lib/api.ts             # cliente HTTP tipado
│   │   ├── shared/                # tipos, temas e componente de carta
│   │   ├── styles/                # tokens, reset e estilos da carta
│   │   └── test/setup.ts          # setup do Vitest + Testing Library
│   └── vite.config.ts
├── docs/                          # documentação de produto e decisões técnicas
├── .env.example
├── eslint.config.js
├── package.json
└── README.md
```

## Pré-requisitos

- **Node.js 24** (ver `.nvmrc`; versão mínima declarada: 22.12.0, necessária para `node:sqlite`).
- **npm 11** ou superior (suporte a workspaces).
- Opcional: navegador Chromium instalado para os testes end-to-end com Playwright.

## Instalação

```bash
npm install
cp .env.example .env
```

Ajuste `.env` conforme o ambiente. Em produção, **`TOKEN_HMAC_SECRET` é obrigatório**.

## Executando o projeto

```bash
# frontend (http://localhost:5173) e API (http://localhost:3001) juntos
npm run dev

# separadamente
npm run dev:frontend
npm run dev:backend
```

## Testes

```bash
# testes unitários e de integração de todos os workspaces
npm run test:run

# testes end-to-end (Playwright)
npm run test:e2e

# pipeline completo: lint + typecheck + testes + build
npm run ci
```

Durante o desenvolvimento, use `npm test` para executar os testes em modo watch.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3001` | Porta HTTP do backend. |
| `NODE_ENV` | `development` | Ambiente de execução; `production` habilita o serve do build frontend. |
| `TOKEN_HMAC_SECRET` | somente em desenvolvimento | Segredo de assinatura HMAC dos tokens; obrigatório fora de desenvolvimento. |
| `LETTER_TTL_DAYS` | `30` | Dias até o expiramento de uma carta não lida. |
| `SESSION_GRACE_MINUTES` | `10` | Minutos de tolerância para retomar uma sessão interrompida. |
| `HEARTBEAT_TTL_SECONDS` | `120` | Segundos de validade do heartbeat da sessão de leitura. |
| `RATE_LIMIT_MAX` | `30` | Máximo de requisições por janela de rate limit. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Duração da janela de rate limit, em milissegundos. |
| `PUBLIC_APP_URL` | `http://localhost:5173` | URL pública usada na montagem dos links de leitura. |

## Segurança e privacidade

- **Tokens HMAC:** o identificador de leitura é associado a um token assinado; alterações no link invalidam o acesso. O segredo nunca é enviado ao navegador nem escrito em logs.
- **Cookie HttpOnly:** o estado da sessão de leitura é transportado em cookie `HttpOnly`, `SameSite` restritivo e, em produção, `Secure`. O JavaScript da página não lê esse cookie diretamente.
- **Leitura única e invalidamento:** iniciar uma nova sessão invalida a anterior. O progresso é aceito somente da sessão ativa e dentro da janela de carência.
- **Limitações de screenshot:** não é possível impedir fotografias, capturas de tela do sistema operacional, impressão ou ferramentas de desenvolvedidor. O apagamento progressivo é uma experiência visual, não uma garantia criptográfica de destruição de dados. Por isso, a interface evita incentivar capturas e recomenda não compartilhar links de cartas sensíveis.
- **Dados mínimos:** não há cadastro de usuários nem perfil. A carta guarda apenas o que foi escrito e os metadados necessários ao controle de validade e sessão.
- **Cabeçalhos e limites:** Helmet, JSON limitado a 32 kb e limitação de taxa reduzem a superfície de abuso.

## Limitações técnicas

- O SQLite é local e mono-processo: para escalar horizontalmente será necessário outro armazenamento ou replicação explícita.
- O apagamento progressivo atua na renderização; o texto permanece no banco até a limpeza por validade/conclusão.
- A CSP ainda está desabilitada no Helmet até que os módulos de rotas definam as fontes permitidas.
- Testes end-to-end dependem de um navegador compatível instalado no ambiente.
- O suporte a `node:sqlite` exige uma versão recente do Node; versões antigas não iniciam a API.

## Roadmap

1. **Etapa 1 — Fundação do monorepo:** workspaces, TypeScript, ESLint, Vitest, esquema SQLite e contratos compartilhados. *(base desta entrega)*
2. **Etapa 2 — Criação de cartas:** formulário validado, seleção de tema e prévia fiel da carta.
3. **Etapa 3 — Persistência e links:** geração de tokens HMAC, expiração e montagem da URL pública de leitura.
4. **Etapa 4 — Leitura com apagamento progressivo:** abertura, heartbeat, progresso e conclusão da leitura.
5. **Etapa 5 — Concorrência e sessões:** invalidamento da sessão anterior, janela de carência e estados `expired`/`invalidated`.
6. **Etapa 6 — Qualidade:** cobertura de testes, acessibilidade, responsividade e refinamento visual.
7. **Etapa 7 — Entrega:** build de produção, deploy, observabilidade e endurecimento de cabeçalhos.

## Capturas de tela

Capturas serão adicionadas quando existirem.
