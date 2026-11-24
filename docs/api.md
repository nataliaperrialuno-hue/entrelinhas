# API HTTP

Contrato de comportamento da API do Entrelinhas. Em desenvolvimento, todas as rotas são alcançáveis pelo frontend em `http://localhost:5173` (o Vite faz proxy para `http://localhost:3001`). Os exemplos usam apenas marcadores — **não há tokens reais neste documento**.

## Convenções

- Corpos de requisição e resposta usam `application/json`; o corpo recebido é limitado a **512 kb**.
- `sessionId` e `linkToken` devem ser tratados como valores opacos e codificados na URL quando necessário.
- O cliente envia `credentials: same-origin`; o cookie de sessão é definido pelo servidor.
- Erros de validação retornam `400`, corpo excessivo `413`, abuso `429` e falha interna `500` (sem detalhes do erro).

## `GET /api/health`

Verificação de disponibilidade.

**Resposta `200`**

```json
{ "ok": true }
```

```bash
curl -i http://localhost:5173/api/health
```

## `POST /api/letters`

Cria uma carta e devolve o link de leitura.

**Corpo**

```json
{
  "senderName": "Remetente",
  "senderAnonymous": false,
  "recipientName": "Destinatário",
  "title": "Carta de verificação",
  "message": "Primeiro parágrafo.\n\nSegundo parágrafo.",
  "signature": "Assinatura",
  "theme": {
    "envelope": "classic",
    "seal": "wine",
    "palette": "sepia",
    "typography": "serif",
    "paper": "linen",
    "inkColor": "#3a2e24"
  }
}
```

`inkColor` é opcional, no formato `#RRGGBB` (cartas antigas não possuem o campo).

Exemplo curto de mensagem com formatação: `"Um texto com **ênfase** e [[cor:#7c2d38]]trecho em cor[[/cor]]."`. Os marcadores são texto puro; um parser com whitelist os converte em elementos React e marcadores inválidos ou malformados permanecem como texto comum.

Os identificadores de tema seguem `frontend/src/shared/types.ts`: `envelope` (`classic`, `floral`, `minimal`), `seal` (`wine`, `gold`, `ink`), `palette` (`sepia`, `rose`, `night`, `sage`), `typography` (`serif`, `hand`, `mono`) e `paper` (`linen`, `plain`, `aged`).

**Resposta `201`**

```json
{ "url": "/c/<LINK_TOKEN>" }
```

**Falhas:** `400` (dados inválidos, inclusive mensagem acima de 4.000 palavras ou 100.000 caracteres), `413` (corpo maior que 512 kb), `429` (limite de taxa), `500`.

```bash
curl -i -X POST http://localhost:5173/api/letters \
  -H 'Content-Type: application/json' \
  --data-binary @carta.json
```

## `GET /c/:linkToken`

Abre o link curto. É o único ponto em que o token do link aparece na URL.

**Sucesso:** `302 Found` com `Location: /leitura/<SESSION_ID>` e `Set-Cookie` contendo o cookie de sessão com `HttpOnly`, `SameSite` restritivo e `Secure` em produção. O valor efetivo dos atributos é definido pela configuração de produção; o cliente JavaScript não lê esse cookie.

**Falhas:** `404`/`410` para token inválido ou expirado; `409`/`410` na segunda abertura (link de uso único).

```bash
curl -i http://localhost:5173/c/LINK_TOKEN
```

## `GET /api/read/:sessionId/state`

Consulta o estado atual da leitura.

**Resposta `200`**

```json
{ "state": "opening", "progress": 0 }
```

`state` assume `opening`, `reading`, `completed`, `expired` ou `invalidated` (ver `ReadingState` em `frontend/src/shared/types.ts`). `progress` é o valor numérico aceito pelo servidor.

**Falhas:** `404` (sessão inexistente), `409`/`410` (sessão inválida ou encerrada), `429`, `500`.

```bash
curl -i http://localhost:5173/api/read/SESSION_ID/state
```

## `POST /api/read/:sessionId/open`

Libera o conteúdo da carta após a confirmação no selo.

**Resposta `200` — `LetterView`**

```json
{
  "id": "LETTER_ID",
  "title": "Carta de verificação",
  "message": "Primeiro parágrafo.\n\nSegundo parágrafo.",
  "senderName": "Remetente",
  "recipientName": "Destinatário",
  "signature": "Assinatura",
  "theme": {
    "envelope": "classic",
    "seal": "wine",
    "palette": "sepia",
    "typography": "serif",
    "paper": "linen"
  }
}
```

`senderName`, `recipientName` e `signature` podem ser `null`.

**Falhas:** `409`/`410` (sessão encerrada, inválida ou link já consumido), `429`, `500`.

```bash
curl -i -X POST http://localhost:5173/api/read/SESSION_ID/open \
  -H 'Cookie: <cookie de sessão>'
```

## `POST /api/read/:sessionId/progress`

Registra o avanço da leitura. O servidor — não o cliente — decide qual progresso é aceito.

**Corpo**

```json
{ "progress": 0.5 }
```

**Resposta `200`**

```json
{ "progress": 0.5 }
```

**Falhas:** `400` (valor inválido), `409`/`410` (sessão inativa), `429`, `500`.

```bash
curl -i -X POST http://localhost:5173/api/read/SESSION_ID/progress \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <cookie de sessão>' \
  --data '{"progress":0.5}'
```

## `POST /api/read/:sessionId/complete`

Encerra a leitura de forma idempotente. Uma repetição com a mesma chave não produz efeito adicional.

**Cabeçalho obrigatório:** `Idempotency-Key: <SESSION_ID>:complete` (o cliente oficial usa esse formato).

**Resposta `200`**

```json
{ "state": "completed" }
```

**Falhas:** `400` (chave ausente/inválida), `409`/`410` (sessão inativa), `429`, `500`.

```bash
curl -i -X POST http://localhost:5173/api/read/SESSION_ID/complete \
  -H 'Idempotency-Key: SESSION_ID:complete' \
  -H 'Cookie: <cookie de sessão>'
```

## Cabeçalhos de segurança

- Helmet aplica cabeçalhos protetores (por exemplo, `X-Content-Type-Options: nosniff`, proteção contra framing e `Referrer-Policy` restritiva para reduzir vazamento de token em `Referer`).
- `Strict-Transport-Security` depende de HTTPS na borda; configure TLS/HSTS no proxy reverso em produção.
- A CSP está ativa com diretivas restritivas (ver `backend/src/middleware/security.ts`). CSP é defesa em profundidade: **não substitui HTTPS/HSTS** nem o escape do React.
- Respostas de erro não expõem detalhes internos; nunca registre tokens crus em logs — use `id`/`sessionId` para rastrear.

Mais detalhes em [`threat-model.md`](threat-model.md) e [`architecture.md`](architecture.md).
