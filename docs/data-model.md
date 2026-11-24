# Modelo de dados

O esquema inicial está em `backend/src/db/migrations/001_init.sql` e usa duas tabelas: `letters` (a carta) e `sessions` (cada abertura da leitura). Instantes são armazenados como `INTEGER` pela camada de domínio; não é necessário assumir a unidade para entender as transições.

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
| `theme_json` | `TEXT` | `NOT NULL` | Seleção de tema serializada (envelope, selo, paleta, tipografia, papel). |
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

## Retenção e apagamento

- **Validade padrão:** `LETTER_TTL_DAYS=30`. `expires_at` define quando uma carta não lida deixa de ser acessível; registros expirados são elegíveis à limpeza.
- **Conclusão:** ao atingir `completed`, o texto em claro é descartado (`message` é `NOT NULL`, portanto o mecanismo exato de sobrescrita é detalhe de implementação). O título e os metadados mínimos podem permanecer para controle de validade e sessão.
- **Privacidade:** nenhum token cru é gravado; apenas `token_hash`. Não há dados de cadastro de usuário.
