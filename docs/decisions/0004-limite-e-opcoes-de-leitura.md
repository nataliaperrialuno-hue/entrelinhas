# ADR 0004 — Limite de leitura, opções visuais e assets

- **Status:** Aceito
- **Data:** 2026-11-24
- **Decisores:** Produto e arquitetura do Entrelinhas
- **Relacionadas:** [0002 — Sessão interrompida](0002-sessao-interrompida.md), [0003 — Apagamento progressivo](0003-apagamento-progressivo.md)

## Contexto

O apagamento progressivo é a assinatura do produto, mas nem toda carta deve desaparecer enquanto é lida: há mensagens que o remetente quer deixar visíveis até o fim. Também era necessário limitar a exposição no tempo sem transformar a leitura em uma corrida contra um relógio global, e permitir fotos e um selo desenhado sem criar um segundo serviço de armazenamento com ciclo de vida próprio. A sessão interrompida (ADR 0002) e o apagamento por rolagem (ADR 0003) já existiam; as novas decisões precisam conviver com esse histórico.

## Decisão

1. **Prazo por carta, não global.** `POST /api/letters` aceita `readTimeLimitSeconds` entre **60 e 3600 segundos** (padrão `DEFAULT_READ_TIME_LIMIT_SECONDS=600`). O prazo absoluto é `sessions.created_at + readTimeLimitSeconds × 1000`, exposto como `readDeadlineAt` em `/state`. Ele **não** é renovado por heartbeat nem reiniciado na abertura do selo.
2. **Apagamento visual opcional; descarte obrigatório.** `fadeEnabled` (padrão `true`) controla apenas o efeito visual. Com `true`, nenhuma palavra some antes de uma interação do leitor (scroll, roda, toque ou tecla de navegação); com `false`, o texto permanece visível durante toda a leitura e é removido quando ela conclui. Em ambos os casos, o servidor descarta o plaintext e os assets ao concluir ou ao vencer qualquer prazo.
3. **Inatividade por `last_seen_at`.** `IDLE_TIMEOUT_SECONDS=600` define `idleDeadlineAt = last_seen_at + 600 s`. `/heartbeat` renova somente esse prazo. É uma fronteira independente da janela de carência `SESSION_GRACE_MINUTES=10` do ADR 0002, que continua valendo para retomada de sessão interrompida.
4. **Assets no SQLite.** Uploads binários vão para `POST /api/assets` (`x-asset-kind: photo|seal`) e são gravados como BLOB em `letter_assets` (migração 002). O `uploadToken` é descartável e só vincula o arquivo em `POST /api/letters`. `GET /api/assets/:id` exige o cookie da sessão. A remoção de fotos/selo acontece na **mesma transação** que apaga o texto.
5. **Limites explícitos.** No máximo 3 fotos de até 2 MiB, selo PNG/WebP de até 16 KiB, e carta de até 4.000 palavras / 100.000 caracteres. MIME, *magic bytes* e dimensões são validados no servidor; o cliente valida apenas como UX.

## Consequências

### Positivas

- Quem envia escolhe o tempo de vida e se quer o ritual do apagamento progressivo, sem mudar a configuração global do serviço.
- Uma carta curta não é apagada apenas por estar acima da linha de leitura no momento do mount.
- Heartbeat não transforma a carta em acesso permanente; inatividade e prazo absoluto são limites complementares.
- Texto e mídia têm um único dono (a carta no SQLite), o que simplifica apagamento, backup e testes.

### Negativas / trade-offs

- Dois relógios (`readDeadlineAt` e `idleDeadlineAt`) aumentam a complexidade de interpretação do estado; `/state` passa a expô-los justamente para reduzir ambiguidade.
- Guardar BLOBs no SQLite aumenta o tamanho do banco e exige limites rígidos de upload (3 × 2 MiB + 16 KiB por carta).
- A checagem de dimensões não reencodifica a imagem; arquivos polimórficos que passem nas verificações permanecem uma superfície residual (ver modelo de ameaças).
- `data:`/`blob:` na CSP segue necessário para prévia e desenho do selo, enfraquecendo marginalmente a política de imagens.

## Alternativas rejeitadas

- **Prazo único global (`LETTER_TTL_DAYS` ou variável de ambiente):** simples, mas incapaz de respeitar cartas curtas versus longas e obrigaria deploy para mudar a política.
- **Prazo contado da primeira abertura e renovado por heartbeat:** melhora a experiência, mas transforma o link em credencial de longo prazo se vazado.
- **Apagamento progressivo obrigatório:** fiel à estética, mas frustra cartas que devem permanecer legíveis até a conclusão.
- **Só apagamento no cliente:** o DOM pode ser limpo, mas os bytes continuariam no servidor e voltariam em recarregamento ou busca direta à API.
- **Assets em sistema de arquivos/S3:** escala melhor, mas cria outro ciclo de vida, mais uma chance de órfãos e exigiria coordenação de remoção fora da transação da carta.
- **Token de upload como credencial permanente de leitura:** vazamento do token daria acesso direto à imagem, contornando cookie e sessão.
- **Esperar apenas o job de limpeza:** tornaria a janela de exposição dependente de agendamento; o apagamento precisa acontecer na transição de estado.
