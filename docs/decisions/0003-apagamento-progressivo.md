# ADR 0003 — Apagamento progressivo

- **Status:** Aceito
- **Data:** 2026-11-24
- **Decisores:** Frontend e arquitetura do Entrelinhas

## Contexto

O apagamento progressivo precisa acompanhar a rolagem com fluidez, sem apagar texto antes da leitura e sem custo elevado de layout. Também deve funcionar em iOS Safari, onde barras dinâmicas e suporte parcial a animações scroll-driven exigem cuidado. O efeito é visual — não uma garantia de destruição segura de dados.

## Decisão

1. **Amostragem com `requestAnimationFrame`:** a posição de rolagem é lida no máximo uma vez por frame, evitando cálculos a cada evento `scroll`.
2. **Linha de leitura a 70% da viewport:** um trecho passa a ser considerado lido quando cruza essa linha, não quando entra na tela.
3. **Dwell com teto:** um bloco só é apagado após permanecer na linha por `min(4000 ms, max(400 ms, palavras × 30 ms))`. O fator por palavra evita que parágrafos longos desapareçam rápido demais; o teto de 4.000 ms impede que cartas de até 4.000 palavras exijam dezenas de segundos por bloco e travem a conclusão.
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
