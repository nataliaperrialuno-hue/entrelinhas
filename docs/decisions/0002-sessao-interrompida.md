# ADR 0002 — Sessão interrompida

- **Status:** Aceito (política híbrida confirmada pelo usuário)
- **Data:** 2026-11-24
- **Decisores:** Produto e arquitetura do Entrelinhas

## Contexto

Durante a leitura, o navegador pode ser fechado, a aba recarregada ou a conexão interrompida. Expirar a sessão imediatamente frustra o leitor; permitir retomada irrestrita transforma um link vazado em acesso duradouro. É necessário equilibrar continuidade e unicidade.

## Decisão

Política **híbrida**, com três casos:

1. **Cookie fresco:** se o cookie de sessão ainda é válido dentro de `HEARTBEAT_TTL_SECONDS=120` desde o último heartbeat, o leitor retoma a mesma sessão, sem gerar novo link e sem invalidar nada.
2. **Janela de carência curta:** se o cookie expirou, mas a sessão ainda está dentro de `SESSION_GRACE_MINUTES=10`, é permitida **uma** retomada. A nova sessão avança o `epoch` e **invalida o link anterior**, impedindo que um terceiro use o mesmo link para assumir a leitura.
3. **Após a carência:** a sessão passa a `expired`. Não há retomada; é necessário gerar outra carta.

A decisão prioriza a experiência de quem realmente está lendo, limitando a tolerância a 10 minutos. Estados e transições estão em [`../data-model.md`](../data-model.md).

## Consequências

### Positivas

- Recarregar a página ou perder a conexão por poucos segundos não destrói a leitura.
- Um link vazado deixa de servir como credencial após a janela de carência.
- A retomada única reduz a superfície de "segundo leitor" sem exigir autenticação.

### Negativas / trade-offs

- O leitor interrompido por mais de 10 minutos perde o acesso — aceito como custo da privacidade.
- A lógica de `epoch`, `last_seen_at` e `grace_until` aumenta a complexidade do domínio e exige testes de concorrência.
- Relógios de cliente não são confiáveis: toda decisão é tomada com timestamps do servidor.

## Alternativas rejeitadas

- **Expiração imediata a cada perda de heartbeat:** simples, mas excessivamente punitiva em redes móveis.
- **Retomada sempre enquanto a carta não estiver concluída:** conveniente, mas transforma o link em acesso permanente se vazado.
- **Renovação automática indefinida:** elimina a natureza efêmera do produto.

## Atualização (2026-11-24) — inatividade e prazo absoluto

A decisão híbrida acima **permanece vigente** para retomada de sessão interrompida (`SESSION_GRACE_MINUTES=10` e `epoch`). A migração 002 acrescentou dois limites distintos, que não revogam a carência:

- `IDLE_TIMEOUT_SECONDS=600`: inatividade medida por `sessions.last_seen_at`. `POST /heartbeat` renova apenas esse prazo (`idleDeadlineAt`).
- `readTimeLimitSeconds` por carta (60..3600 s, padrão 600): prazo absoluto desde `sessions.created_at` (`readDeadlineAt`), que **nenhum** heartbeat renova.

Ao vencer qualquer um dos dois, o texto e os assets são descartados atomicamente e as rotas de leitura passam a responder `410`. Ou seja: a carência continua decidindo *se* a sessão pode ser retomada; os novos prazos decidem *até quando* a carta pode ser lida. Ver [`0004-limite-e-opcoes-de-leitura.md`](0004-limite-e-opcoes-de-leitura.md).
