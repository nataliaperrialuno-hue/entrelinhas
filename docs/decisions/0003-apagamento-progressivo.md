# ADR 0003 — Apagamento progressivo

- **Status:** Aceito
- **Data:** 2026-11-24
- **Decisores:** Frontend e arquitetura do Entrelinhas

## Contexto

O apagamento progressivo precisa acompanhar a rolagem com fluidez, sem apagar texto antes da leitura e sem custo elevado de layout. Também deve funcionar em iOS Safari, onde barras dinâmicas e suporte parcial a animações scroll-driven exigem cuidado. O efeito é visual — não uma garantia de destruição segura de dados.

## Decisão

1. **Amostragem com `requestAnimationFrame`:** a posição de rolagem é lida no máximo uma vez por frame, evitando cálculos a cada evento `scroll`.
2. **Linha de leitura a 70% da viewport:** um trecho passa a ser considerado lido quando cruza essa linha, não quando entra na tela.
3. **Dwell mínimo:** um bloco só é apagado após permanecer na linha por `max(400 ms, palavras × 30 ms)`. O fator por palavra evita que parágrafos longos desapareçam rápido demais.
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
- A calibração do dwell (400 ms / 30 ms por palavra) é subjetiva e pode precisar de ajuste após testes com usuários.
- A coordenação entre rAF, observadores e revalidação da sessão aumenta a complexidade do lado cliente.

## Alternativas rejeitadas

- **Apagar imediatamente ao entrar na viewport:** texto desaparece antes da leitura.
- **Somente CSS scroll-driven:** sem fallback e com suporte insuficiente em iOS Safari.
- **Canvas/WebGL:** perda de semântica e acessibilidade.
- **Timers fixos por parágrafo:** ignora o tamanho real do texto e a velocidade individual de leitura.
