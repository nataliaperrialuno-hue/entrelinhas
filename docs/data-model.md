# Modelo de dados

O esquema inicial está em `backend/src/db/migrations/001_init.sql` (`letters` e `sessions`). A migração `backend/src/db/migrations/002_reading_options.sql` acrescenta as opções de leitura e a tabela `letter_assets`. O runner aplica as migrações em ordem e registra o resultado em `PRAGMA user_version`: **banco na versão 2** após a migração 002 (a versão 1 corresponde somente ao esquema inicial). Instantes são armazenados como `INTEGER` em milissegundos (epoch) pela camada de domínio.

## Tabela `letters`

| Coluna | Tipo | Restrição | Finalidade |
| --- | --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` | Identificador da carta. |
| `token_hash` | `TEXT` | `NOT NULL UNIQUE` | Hash HMAC do token do link; o token cru não é armazenado. |
| `title` | `TEXT` | `NOT NULL` | Título da carta. |
| `message` | `TEXT` | `NOT NULL` | Texto da mensagem; descartado quando a leitura é concluída. |
| `sender_name` | `TEXT` | anulável | Nome do remetente; `NULL` quando anônimo. |
| `recipient_name` | `TEXT` | anulável | Nome do destinatário. |
| `signature` | `TEXT` | anulável | Assinatura opcional. |
| `theme_json` | `TEXT` | `NOT NULL` | Seleção de tema serializada (envelope, selo, paleta, tipografia, papel e `inkColor` opcional no formato `#RRGGBB`; cartas antigas não possuem esse campo). `seal` pode ser `custom`. |
| `fade_enabled` | `INTEGER` | `NOT NULL DEFAULT 1` | Apagamento visual progressivo da carta (`1` = ligado, padrão retrocompatível; `0` = texto visível até a conclusão). |
| `read_time_limit_seconds` | `INTEGER` | anulável (padrão efetivo `600`) | Prazo absoluto por carta, de `60` a `3600` segundos. `NULL` em cartas criadas antes da migração 002. |
| `seal_asset_id` | `TEXT` | anulável | Id do asset de selo customizado usado no envelope; `NULL` quando o selo é um dos temas fixos. |
| `state` | `TEXT` | `NOT NULL DEFAULT 'unopened'`, `CHECK IN ('unopened','opening','reading','completed','expired')` | Ciclo de vida da carta. |
| `created_at` | `INTEGER` | `NOT NULL` | Criação. |
| `expires_at` | `INTEGER` | `NOT NULL` | Limite de validade. |
| `opened_at` | `INTEGER` | anulável | Primeira abertura. |
| `completed_at` | `INTEGER` | anulável | Conclusão da leitura. |
| `current_session_id` | `TEXT` | anulável | Sessão ativa (sem `FOREIGN KEY` declarado na migração). |

Índice: `idx_letters_state_expires` em `(state, expires_at)` — consultas de validade e limpeza por estado.

### Estados e transições de `letters`

| De | Para | Gatilho |
| --- | --- | --- |
| `unopened` | `opening` | Primeira abertura válida do link (claim atômico). |
| `opening` | `reading` | Confirmação no selo libera o conteúdo (`POST /open`). |
| `reading` | `completed` | Fim do conteúdo e `POST /complete`. |
| `unopened` / `opening` / `reading` | `expired` | `expires_at` atingido (TTL) ou validade encerrada. |

Uma nova abertura do link após a primeira é rejeitada com `409`/`410`; a carta não retrocede de estado.

## Tabela `sessions`

| Coluna | Tipo | Restrição | Finalidade |
| --- | --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` | Identificador de sessão usado em `/leitura/:sessionId`. |
| `letter_id` | `TEXT` | `NOT NULL REFERENCES letters(id) ON DELETE CASCADE` | Carta associada. |
| `token_hash` | `TEXT` | `NOT NULL UNIQUE` | Hash do token de sessão transportado no cookie. |
| `state` | `TEXT` | `NOT NULL DEFAULT 'opening'`, `CHECK IN ('opening','reading','completed','expired','invalidated')` | Ciclo de vida da sessão. |
| `epoch` | `INTEGER` | `NOT NULL DEFAULT 0` | Versão da sessão; incremento invalida a anterior. |
| `last_progress` | `REAL` | `NOT NULL DEFAULT 0` | Último progresso aceito pelo servidor. |
| `last_seen_at` | `INTEGER` | `NOT NULL` | Último heartbeat recebido. |
| `grace_until` | `INTEGER` | `NOT NULL` | Limite da janela de retomada. |
| `created_at` | `INTEGER` | `NOT NULL` | Criação da sessão. |
| `completed_at` | `INTEGER` | anulável | Conclusão da leitura. |

Índices: `idx_sessions_letter` em `(letter_id)` e `idx_sessions_state_seen` em `(state, last_seen_at)` — consulta das sessões de uma carta e de sessões ativas por presença.

### Estados e transições de `sessions`

| De | Para | Gatilho |
| --- | --- | --- |
| `opening` | `reading` | Usuário confirma a abertura no selo. |
| `reading` | `completed` | Progresso chega ao fim e a conclusão é registrada. |
| `opening` / `reading` | `invalidated` | Nova sessão assume a carta (`epoch` avançado). |
| `opening` / `reading` | `expired` | Heartbeat expirado ou janela de carência encerrada. |

A sessão é a única fonte autoritativa de progresso aceito; o cliente envia amostras, o servidor grava `last_progress`. Ver [`architecture.md`](architecture.md).

Os prazos expostos por `/state` são **derivados**, não colunas persistentes:

- `readDeadlineAt = sessions.created_at + letters.read_time_limit_seconds × 1000` (padrão 600 s quando a coluna é `NULL`);
- `idleDeadlineAt = sessions.last_seen_at + IDLE_TIMEOUT_SECONDS × 1000` (padrão `600` s).

`heartbeat` atualiza `last_seen_at`; o prazo absoluto depende apenas de `created_at` e da opção escolhida por quem enviou.

## Tabela `letter_assets` (migração 002)

| Coluna | Tipo | Restrição | Finalidade |
| --- | --- | --- | --- |
| `id` | `TEXT` | `PRIMARY KEY` | Identificador público opaco do arquivo. |
| `letter_id` | `TEXT` | `REFERENCES letters(id) ON DELETE CASCADE` (anulável para órfãos) | Carta a que o arquivo foi vinculado; preenchido no `POST /api/letters`. |
| `kind` | `TEXT` | `NOT NULL CHECK IN ('photo','seal')` | Foto no corpo da carta ou selo desenhado. |
| `mime` | `TEXT` | `NOT NULL CHECK IN ('image/png','image/jpeg','image/webp')` | Tipo validado no upload. |
| `width`, `height` | `INTEGER` | `NOT NULL` | Dimensões validadas no upload (sem reencode). |
| `byte_size` | `INTEGER` | `NOT NULL` | Tamanho já validado (2 MiB para foto; 16 KiB para selo). |
| `data` | `BLOB` | `NOT NULL` | Bytes da imagem, no mesmo SQLite do texto. |
| `upload_token_hash` | `TEXT` | `UNIQUE` | Hash do token descartável; o token cru não é gravado. |
| `attached` | `INTEGER` | `NOT NULL DEFAULT 0` | `1` depois que a carta referenciou o asset; `0` permite limpeza de uploads abandonados. |
| `created_at` | `INTEGER` | `NOT NULL` | Upload. |

Índices: `idx_letter_assets_letter_kind` em `(letter_id, kind)` e `idx_letter_assets_orphan` em `(attached, created_at)`.

Manter os BLOBs no SQLite evita um segundo sistema de armazenamento com ciclo de vida próprio: a mesma transação que descarta o texto remove fotos e selo.

## Retenção e apagamento

- **Validade padrão:** `LETTER_TTL_DAYS=30`. `expires_at` define quando uma carta não lida deixa de ser acessível; registros expirados são elegíveis à limpeza.
- **Conclusão ou prazo vencido:** ao atingir `completed`/`expired`, o texto em claro é descartado (`message` é `NOT NULL`, portanto o mecanismo exato de sobrescrita é detalhe de implementação). O título e os metadados mínimos podem permanecer para controle de validade e sessão.
- **Apagamento atômico:** numa única transação `BEGIN IMMEDIATE`, a carta muda de estado, `message` é sobrescrito/vaciado e `DELETE FROM letter_assets WHERE letter_id = ?` remove fotos **e** selo. Não há janela em que o texto já foi apagado mas a imagem ainda é servida (ou vice-versa). Os tokens de upload são descartados no mesmo vínculo.
- **Inatividade:** 10 minutos sem `last_seen_at` válido (`IDLE_TIMEOUT_SECONDS=600`) disparam o mesmo apagamento atômico; `read_time_limit_seconds` limita a leitura mesmo com heartbeat ativo.
- **Privacidade:** nenhum token cru é gravado; apenas `token_hash` e `upload_token_hash`. Não há dados de cadastro de usuário.
