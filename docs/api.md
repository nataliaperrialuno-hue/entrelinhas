# API HTTP

Contrato de comportamento da API do Entrelinhas. Em desenvolvimento, todas as rotas são alcançáveis pelo frontend em `http://localhost:5173` (o Vite faz proxy para `http://localhost:3001`). Os exemplos usam apenas marcadores — **não há tokens reais neste documento**.

## Convenções

- Corpos de requisição e resposta usam `application/json`; o corpo recebido é limitado a **512 kb**. A exceção é `POST /api/assets`, que recebe bytes de imagem crus (não JSON).
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

## `POST /api/assets`

Envia um arquivo de imagem **cru** (sem envelope JSON) antes de criar a carta. O cabeçalho `x-asset-kind` distingue `photo` (fotos no meio do texto) de `seal` (selo desenhado em canvas).

- Tipos aceitos: `image/png`, `image/jpeg` e `image/webp`; o `Content-Type` deve corresponder aos *magic bytes* reais.
- Fotos: no máximo **3 por carta**, até **2 MiB** cada.
- Selo: PNG ou WebP de até **16 KiB**.
- Dimensões são validadas no servidor (whitelist de tamanho); não há reencode automático.

**Resposta `201`**

```json
{ "id": "ASSET_ID", "uploadToken": "UPLOAD_TOKEN" }
```

O par `{ id, uploadToken }` deve ser enviado de volta em `POST /api/letters` (`assets`). O `uploadToken` é **descartável**: autoriza apenas o vínculo do arquivo à carta; **não** é credencial de leitura nem de download.

**Falhas:** `400` (`x-asset-kind` inválido, MIME/magic bytes ou dimensões fora da whitelist), `413` (arquivo acima do limite), `429`, `500`.

```bash
curl -i -X POST http://localhost:5173/api/assets \
  -H 'Content-Type: image/png' \
  -H 'x-asset-kind: photo' \
  --data-binary @foto.png
```

## `GET /api/assets/:id`

Entrega os bytes do arquivo já vinculado a uma carta. **Exige o cookie de sessão** da leitura (`HttpOnly`); o `uploadToken` não serve para esta rota. A resposta usa o `Content-Type` validado no upload e `Cache-Control: no-store, private`.

**Falhas:** `404` (cookie ausente/inválido, ID inexistente ou arquivo já apagado), `429`, `500`. A resposta é uniforme para não vazar a existência do asset a quem não tem a sessão.

```bash
curl -i http://localhost:5173/api/assets/ASSET_ID \
  -H 'Cookie: <cookie de sessão>'
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
  },
  "fadeEnabled": true,
  "readTimeLimitSeconds": 600,
  "assets": [{ "id": "ASSET_ID", "uploadToken": "UPLOAD_TOKEN" }],
  "sealAssetId": null
}
```

`inkColor` é opcional, no formato `#RRGGBB` (cartas antigas não possuem o campo).

Campos opcionais adicionados à carta:

| Campo | Tipo | Padrão | Finalidade |
| --- | --- | --- | --- |
| `fadeEnabled` | `boolean` | `true` | Apagamento visual progressivo. Com `false`, as palavras ficam visíveis durante a leitura e só desaparecem ao concluir; o descarte do texto no servidor continua obrigatório. |
| `readTimeLimitSeconds` | `number` | `DEFAULT_READ_TIME_LIMIT_SECONDS=600` | Prazo absoluto por carta, de **60 a 3600 segundos**, contado a partir de `sessions.created_at`. Fora da faixa: `400`. |
| `assets` | `Array<{ id, uploadToken }>` | `[]` | Referências devolvidas por `POST /api/assets`; ligam fotos e selo à carta. |
| `sealAssetId` | `string \| null` | `null` | Id do asset `seal` usado no envelope quando `theme.seal` é `custom`. |

O apagamento progressivo, quando ligado, **só começa após interação do leitor** (scroll, roda, toque ou tecla de navegação). Isso evita que uma carta curta seja apagada apenas pela geometria inicial da página. A conclusão automática ao fim do conteúdo continua existindo em ambos os modos.

Exemplo curto de mensagem com formatação: `"Um texto com **ênfase** e [[cor:#7c2d38]]trecho em cor[[/cor]]."`. Os marcadores são texto puro; um parser com whitelist os converte em elementos React e marcadores inválidos ou malformados permanecem como texto comum.

Os identificadores de tema seguem `frontend/src/shared/types.ts`: `envelope` (`classic`, `floral`, `minimal`), `seal` (`wine`, `gold`, `ink`, `custom`), `palette` (`sepia`, `rose`, `night`, `sage`), `typography` (`serif`, `hand`, `mono`) e `paper` (`linen`, `plain`, `aged`). `custom` exige `sealAssetId` válido, vinculado em `assets`.

**Resposta `201`**

```json
{ "url": "/c/<LINK_TOKEN>" }
```

**Falhas:** `400` (dados inválidos, inclusive mensagem acima de 6.000 palavras ou 100.000 caracteres), `413` (corpo maior que 512 kb), `429` (limite de taxa), `500`.

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
{
  "state": "reading",
  "progress": 0,
  "readDeadlineAt": 1764000000000,
  "idleDeadlineAt": 1764000600000,
  "fadeEnabled": true,
  "sealAssetId": null
}
```

`state` assume `opening`, `reading`, `completed`, `expired` ou `invalidated` (ver `ReadingState` em `frontend/src/shared/types.ts`). `progress` é o valor numérico aceito pelo servidor. Os prazos são instantes em milissegundos (epoch):

- `readDeadlineAt`: prazo **absoluto** por carta (`sessions.created_at + readTimeLimitSeconds × 1000`); não é renovado por heartbeat.
- `idleDeadlineAt`: prazo de **inatividade** (`last_seen_at + IDLE_TIMEOUT_SECONDS × 1000`, padrão `600`); renovado por `/heartbeat` e por atividade de leitura.
- `fadeEnabled` e `sealAssetId` devolvem as opções escolhidas na criação (`null` quando não há selo customizado).

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

## `POST /api/read/:sessionId/heartbeat`

Renova a presença do leitor. **Só `idleDeadlineAt` avança**: o prazo absoluto `readDeadlineAt` permanece inalterado. Não requer corpo.

**Resposta `200`**

```json
{
  "state": "reading",
  "progress": 0.5,
  "readDeadlineAt": 1764000000000,
  "idleDeadlineAt": 1764000600000
}
```

**Falhas:** `401`/`403` (cookie ausente ou de outra sessão), `410` (prazo absoluto ou de inatividade expirado), `429`, `500`.

```bash
curl -i -X POST http://localhost:5173/api/read/SESSION_ID/heartbeat \
  -H 'Cookie: <cookie de sessão>'
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

## Prazos, inatividade e `410`

- **Prazo absoluto:** `readDeadlineAt` é calculado por carta na criação da sessão; `readTimeLimitSeconds` aceita de `60` a `3600` segundos (padrão `600`). Heartbeats não o extendem.
- **Inatividade:** `IDLE_TIMEOUT_SECONDS=600` (10 minutos) desde o último `last_seen_at` encerra a leitura. `/heartbeat` e as amostras de progresso renovam esse relógio, nunca o prazo absoluto.
- **Efeito:** ao atingir qualquer um dos prazos, o texto em claro e os assets da carta são **descartados atomicamente**. `/open`, `/progress`, `/complete` e `/heartbeat` passam a responder `410 Gone`; `/state` continua consultável para informar `state: "expired"` enquanto a sessão existir.
- **Não confundir com carência:** `SESSION_GRACE_MINUTES=10` continua sendo a janela de retomada de uma sessão interrompida (ADR 0002). A inatividade de 10 minutos é um limite independente, medido por `last_seen_at` (ADR 0004).

Não há teste E2E que durma 60 s ou 600 s para provar `410`: a verificação de expiração com relógio controlado pertence aos testes de integração do backend.

## Cabeçalhos de segurança

- Helmet aplica cabeçalhos protetores (por exemplo, `X-Content-Type-Options: nosniff`, proteção contra framing e `Referrer-Policy` restritiva para reduzir vazamento de token em `Referer`).
- `Strict-Transport-Security` depende de HTTPS na borda; configure TLS/HSTS no proxy reverso em produção.
- A CSP está ativa com diretivas restritivas (ver `backend/src/middleware/security.ts`): `default-src`/`script-src`/`connect-src` em `'self'`, `style-src` em `'self' 'unsafe-inline'`, `img-src` em `'self' data:` (e `blob:` quando usado para prévia local), `object-src`/`frame-ancestors` em `'none'`. CSP é defesa em profundidade: **não substitui HTTPS/HSTS** nem o escape do React. A presença de `data:` em `img-src` é uma limitação conhecida documentada no modelo de ameaças.
- Respostas de erro não expõem detalhes internos; nunca registre tokens crus em logs — use `id`/`sessionId` para rastrear.

Mais detalhes em [`threat-model.md`](threat-model.md) e [`architecture.md`](architecture.md).
