# ADR 0001 — Token, hash e transporte da credencial

- **Status:** Aceito
- **Data:** 2026-11-24
- **Decisores:** Arquitetura do Entrelinhas

## Contexto

O Entrelinhas precisa permitir que qualquer pessoa crie uma carta e compartilhe um link de leitura sem cadastro. O link não pode ser adivinhado, não pode ser reutilizado após a abertura e não pode expor a mensagem a quem apenas possui o histórico do navegador. Também é necessário distinguir a credencial que abre o link da credencial que mantém a sessão de leitura.

## Decisão

1. **Token de 256 bits:** o token do link é gerado com `randomBytes(32)` e codificado em base64url, produzindo valor opaco e imprevisível.
2. **Hash assinado:** o que é persistido é `token_hash`, resultante de HMAC-SHA256 com `TOKEN_HMAC_SECRET`. O token cru nunca é gravado no banco nem escrito em logs.
3. **Dois tokens com escopos distintos:**
   - *token de link*: aparece apenas em `/c/:linkToken`, é consumido na abertura e não autoriza leitura posterior;
   - *token de sessão*: emitido no `302`, transportado em cookie e associado à sessão ativa.
4. **Cookie versus URL:** o token de sessão vai em cookie `HttpOnly`, `SameSite` restritivo e `Secure` em produção. A URL de leitura contém `/leitura/:sessionId`, um identificador de sessão — não a credencial de autorização.
5. **Rastreabilidade:** logs e telemetria usam `id` da carta ou `sessionId`, nunca o token.

## Consequências

### Positivas

- Espaço de 256 bits inviabiliza força bruta; cookies `HttpOnly` reduzem superfície de XSS.
- A rotação do segredo invalida tokens antigos de forma previsível (mitigação em caso de suspeita de vazamento do segredo).
- Como o link é consumido, vazamento posterior não concede leitura contínua.

### Negativas / dívidas

- Perder `TOKEN_HMAC_SECRET` torna os links existentes inoperantes; é necessário backup seguro do segredo.
- O token ainda pode ser copiado manualmente pelo usuário; a mitigação é o uso único e a carência curta (ADR 0002).
- Exige disciplina de logging: qualquer log acidental do token cru compromete o modelo.

## Alternativas rejeitadas

- **UUID v4:** cerca de 122 bits de aleatoriedade e fácil de confundir com identificador público; insuficiente para links de portador.
- **ID sequencial:** previsível e enumerável.
- **Token único para link e sessão:** vazamento do link equivaleria a vazamento da sessão inteira.
- **Sessão na URL:** aumenta a exposição em `Referer`, histórico e ferramentas de terceiros.
