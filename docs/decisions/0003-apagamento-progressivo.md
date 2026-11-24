# ADR 0003 — Apagamento progressivo

- **Status:** Aceito
- **Data:** 2026-11-24
- **Decisores:** Frontend e arquitetura do Entrelinhas

## Contexto

O apagamento progressivo precisa acompanhar a rolagem com fluidez, sem apagar texto antes da leitura e sem custo elevado de layout. Também deve funcionar em iOS Safari, onde barras dinâmicas e suporte parcial a animações scroll-driven exigem cuidado. O efeito é visual — não uma garantia de destruição segura de dados.

## Decisão

1. **Amostragem com `requestAnimationFrame`:** a posição de rolagem é lida no máximo uma vez por frame, evitando cálculos a cada evento `scroll`.
2. **Linha de leitura a 70% da viewport:** um trecho passa a ser considerado lido quando cruza essa linha, não quando entra na tela. *(Valor original; revisto na seção "Atualização (2026-11-24) — curva moderada" abaixo.)*
3. **Dwell com teto:** um bloco só é apagado após permanecer na linha por `min(4000 ms, max(400 ms, palavras × 30 ms))`. O fator por palavra evita que parágrafos longos desapareçam rápido demais; o teto de 4.000 ms impede que cartas de até 4.000 palavras exijam dezenas de segundos por bloco e travem a conclusão. *(Parâmetros originais; revistos na seção "Atualização (2026-11-24) — curva moderada" abaixo.)*
4. **`IntersectionObserver` como gate:** usado para limitar quais blocos recebem processamento; a fonte autoritativa de progresso continua sendo o cálculo baseado na rolagem, validado no servidor.
5. **CSS scroll-driven apenas como realce:** animações via `animation-timeline` são aplicadas **somente** sob `@supports`, para destaque visual. O apagamento funcional tem fallback em JavaScript.
6. **Não usar IntersectionObserver v2 nem canvas:**
   - IO v2 (tracking de visibilidade) tem suporte inconsistente, especialmente em WebKit;
   - canvas exigiria renderizar o texto fora do DOM, perdendo seleção, leitores de tela, busca e acessibilidade.
7. **Compatibilidade com iOS Safari:** usar `100dvh` para a altura da viewport, respeitar `prefers-reduced-motion` e validar o fluxo no projeto WebKit do Playwright.

## Consequências

### Positivas

- Custo por frame previsível e baixo; somente blocos visíveis são observados.
- Texto permanece no DOM: acessibilidade, seleção e busca continuam funcionando.
- Degradação graciosa em navegadores sem animações scroll-driven.

### Negativas / dívidas

- O progresso por rolagem continua sendo um **proxy** de leitura — não comprova atenção do leitor.
- A calibração do dwell (400 ms / 30 ms por palavra, com teto de 4.000 ms) é subjetiva e pode precisar de ajuste após testes com usuários; o teto evita esperas prolongadas por bloco em cartas longas.
- A coordenação entre rAF, observadores e revalidação da sessão aumenta a complexidade do lado cliente.

## Alternativas rejeitadas

- **Apagar imediatamente ao entrar na viewport:** texto desaparece antes da leitura.
- **Somente CSS scroll-driven:** sem fallback e com suporte insuficiente em iOS Safari.
- **Canvas/WebGL:** perda de semântica e acessibilidade.
- **Timers fixos por parágrafo:** ignora o tamanho real do texto e a velocidade individual de leitura.

## Atualização (2026-11-24) — opção do remetente e gate de interação

A decisão de rAF, linha de leitura, dwell e `IntersectionObserver` **continua valendo** quando o apagamento está ligado. Mudanças posteriores:

1. `fadeEnabled` (`true` por padrão) permite que o remetente mantenha as palavras visíveis durante toda a leitura; nesse modo a contabilidade de progresso e a conclusão automática seguem ativas, e o texto só desaparece ao concluir.
2. Mesmo com `fadeEnabled: true`, o efeito agora começa **após a primeira interação** (scroll, roda, toque ou tecla de navegação). Antes disso, a geometria do mount não apaga uma carta curta.
3. A conclusão dispara o apagamento imediato de todos os blocos restantes; o servidor, não o cliente, continua sendo a autoridade que descarta o plaintext.
4. Canvas continua **fora** do texto: a decisão original de não renderizar as palavras em canvas permanece. O canvas passou a ser usado apenas para desenhar o selo `custom`, enviado como asset PNG e exibido no envelope.

Ver [`0004-limite-e-opcoes-de-leitura.md`](0004-limite-e-opcoes-de-leitura.md).

## Atualização (2026-11-24) — curva moderada

Motivo: **experiência do usuário**. Com a calibração original, a linha em 70% e o dwell mínimo de 400 ms faziam cartas curtas perderem nitidez cedo, e a sensação era de leitura apressada. A revisão atrasou o ponto de decisão e suavizou a transição sem alterar o contrato de segurança (descarte no servidor) nem as opções do remetente:

1. **Linha de leitura em 82% da viewport** (era 70%) e **faixa de transição de 22%** (era 15%). A linha continua sendo calculada a partir da caixa do contêiner de rolagem, não do topo da página.
2. **Dwell em `min(6000 ms, max(1000 ms, palavras × 60 ms))`** (era `min(4000, max(400, palavras × 30))`). O piso de 1000 ms dá tempo de ler linhas curtas; o teto de 6000 ms mantém a conclusão viável em cartas longas; 60 ms por palavra acompanha a leitura com menos pressa.
3. **Transição CSS de 500 ms com `ease-out`** nas propriedades `opacity` e `filter` de cada bloco (`--read-progress`), preservando o texto no DOM.
4. **Inalterados:** `fadeEnabled`, `readTimeLimitSeconds`, heartbeat, autoridade do servidor sobre conclusão e o gate de primeira interação — uma carta curta não apaga apenas pela geometria do mount.

Os parâmetros anteriores seguem registrados na seção "Decisão" como histórico da decisão original; a calibração é um ajuste de UX, não uma mudança de modelo de ameaça.
