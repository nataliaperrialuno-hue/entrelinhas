# ADR 0005 — Caderno local de rascunhos

- **Status:** Aceito
- **Data:** 2026-11-24
- **Decisores:** Produto, frontend e arquitetura do Entrelinhas
- **Relacionadas:** [0004 — Limite e opções de leitura](0004-limite-e-opcoes-de-leitura.md), [0003 — Apagamento progressivo](0003-apagamento-progressivo.md)

## Contexto

Quem escreve uma carta pode ser interrompido antes de gerar o link. Sem um rascunho, um recarregamento acidental descarta título e mensagem — um atrito direto com a proposta de escrita direta do produto. Ao mesmo tempo, a aplicação não tem contas de usuário, e o ADR 0004 estabeleceu que fotos e selo desenhado são assets transitórios, ligados à carta e descartados com ela. Era preciso oferecer rascunho e uma noção de "quantas cartas escrevi aqui" sem criar um segundo serviço de persistência, sem coletar identidade e sem transformar o link da carta em credencial de longo prazo.

## Decisão

1. **Persistência local e versionada.** Rascunhos e contador ficam no `localStorage` do navegador, sob as chaves `entrelinhas:drafts:v1` e `entrelinhas:letters-written:v1`. O sufixo `v1` permite migração futura sem interpretar dados de layout antigo. O backend não participa: rascunho não é carta, não recebe token e não cria sessão.
2. **Escopo do rascunho.** Salvam-se título, mensagem, identificação (com anonimato) e opções de leitura (`fadeEnabled`, prazo, tema). **Fotos e selo desenhado não são persistidos**: suas referências de asset não voltam no carregamento, e o painel avisa `Fotos e selo desenhado não voltam no rascunho; refaça-os se quiser.` O texto carregado não deve conter marcadores `[[foto:id]]` órfãos.
3. **Interação explícita.** O botão `Salvar rascunho` grava; o menu superior expõe `Nova carta` (limpa o formulário) e `Rascunhos`; o painel oferece `Carregar` e `Excluir`, com o texto vazio `Nenhum rascunho salvo.` quando não há nada guardado.
4. **Contador por navegador.** A barra do ShareBox mostra `Você já escreveu N carta(s) neste navegador.` com pluralização correta em português. O valor em `entrelinhas:letters-written:v1` é incrementado **somente após `POST /api/letters` bem-sucedido** — falhas de validação ou de rede não contam. Ele não é enviado ao servidor e não entra na carta.

## Consequências

### Positivas

- Nenhuma conta, nenhum dado pessoal coletado pelo serviço e nenhuma chamada de rede extra para salvar rascunho.
- O autor pode recarregar a página sem perder texto e pode começar outra carta com um clique.
- Fotos e selo mantêm o ciclo de vida curto definido no ADR 0004: não viram cópia permanente no navegador.
- Chaves versionadas permitem evoluir o formato sem quebrar leituras antigas.

### Negativas / limites

- **Limpar dados do site apaga tudo.** Rascunhos e contador desaparecem com a limpeza de `localStorage`, modo privado ou desinstalação do navegador; não há recuperação no servidor.
- **Sem sincronização entre dispositivos.** Outro navegador ou aparelho não vê os mesmos rascunhos nem o mesmo contador.
- **Fotos e selo não voltam.** Ao carregar, é preciso refazê-los; o texto é restaurado sem marcadores de imagem.
- **Capacidade limitada.** `localStorage` tem cota pequena (da ordem de poucos MiB por origem) e é síncrono; por isso só texto e opções entram, nunca binários.
- **Não é segredo criptografado.** Qualquer script com acesso à origem pode ler a chave; por isso nenhum segredo, token de sessão ou identificador de carta é guardado no caderno.

## Privacidade

O caderno contém apenas o que o próprio autor digitou, no dispositivo dele. Não há envio automático, analytics, chave de API nem PII além do texto da carta em rascunho. O contador é um número local, sem vínculo com identidade, IP ou sessão. Recomenda-se não usar rascunhos em máquinas compartilhadas; limpar os dados do site é a forma de remoção imediata.

## Alternativas rejeitadas

- **Backend com conta de usuário:** permitiria sincronização e recuperação, mas exigiria cadastro, autenticação, armazenamento de texto em claro por mais tempo e um novo ciclo de vida de dados — contrário à proposta sem contas do produto e ao princípio de dados mínimos.
- **Rascunho no banco sem conta (por cookie/IP):** evitaria login, mas criaria uma persistência secundária de texto no servidor, exigiria política de retenção e exporia o rascunho a vazamento ou limpeza central; o link de leitura deixaria de ser o único artefato da carta.
- **Download de `.txt`:** simples e privado, mas fora do fluxo do navegador: o autor teria de gerenciar arquivos, reimportar manualmente e perderia as opções de leitura e o tema. Não resolve o botão `Nova carta` nem o contador.
- **Cookies:** navegam a cada requisição, têm cota ainda menor (≈4 KiB) e precisariam de consentimento em algumas jurisdições; `localStorage` é mais adequado para texto.
- **IndexedDB:** escala melhor e é assíncrono, mas adicionaria complexidade de esquema e migração para um volume de dados que cabe confortavelmente em `localStorage`.
