import { expect, test, type Page } from '@playwright/test';

/**
 * Contrato do caderno local (ADR 0005). As chaves são usadas pelo E2E para
 * isolar cada cenário e provar a persistência sem depender de mensagens de
 * confirmação que não fazem parte do contrato.
 */
const DRAFTS_KEY = 'entrelinhas:drafts:v1';
const LETTERS_WRITTEN_KEY = 'entrelinhas:letters-written:v1';

// PNG 1x1 válido (magic bytes 89 50 4e 47); o servidor valida MIME e bytes reais.
const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PIXEL_PNG = Buffer.from(PIXEL_PNG_BASE64, 'base64');

async function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((storageKey: string) => window.localStorage.getItem(storageKey), key);
}

async function fillIdentityAndMessage(page: Page, title: string, message: string): Promise<void> {
  await page.getByLabel('De:').fill('Remetente');
  await page.getByLabel('Não informar destinatário').uncheck();
  await page.getByLabel('Para:').fill('Destinatário');
  await page.getByLabel('Título da carta').fill(title);
  await page.getByLabel('Mensagem').fill(message);
}

test.describe('Caderno local de rascunhos', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Cada cenário começa com um navegador "limpo": o caderno é por navegador.
    await page.evaluate(
      ({ draftsKey, lettersKey }: { draftsKey: string; lettersKey: string }) => {
        window.localStorage.removeItem(draftsKey);
        window.localStorage.removeItem(lettersKey);
      },
      { draftsKey: DRAFTS_KEY, lettersKey: LETTERS_WRITTEN_KEY },
    );
    await page.reload();
  });

  test('salvar, recarregar e carregar restaura o texto sem marcadores de foto', async ({ page }) => {
    await fillIdentityAndMessage(page, 'Rascunho de verificação', 'Primeiro parágrafo do rascunho.');

    // A foto inserida cria um marcador [[foto:id]] no texto. Ela não volta no
    // rascunho: o carregamento precisa devolver o texto legível, sem marcador.
    const message = page.getByLabel('Mensagem');
    const photoInput = page.locator('input[type="file"][accept*="image"]').first();
    await photoInput.setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PIXEL_PNG });
    await expect.poll(async () => (await message.inputValue()).includes('[[foto:')).toBe(true);

    // O aviso sobre mídia perdida é exibido quando há selo desenhado (ou foto)
    // envolvido; selecioná-lo também garante que o aviso sobreviva ao reload.
    await page.locator('input[name="seal"][value="custom"]').check();

    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect.poll(() => readStorage(page, DRAFTS_KEY)).not.toBeNull();

    await page.reload();
    await page.getByRole('button', { name: 'Rascunhos' }).click();
    await expect(
      page.getByText('Fotos e selo desenhado não voltam no rascunho; refaça-os se quiser.'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Carregar' }).first().click();
    await expect(page.getByLabel('Título da carta')).toHaveValue('Rascunho de verificação');
    await expect(page.getByLabel('Mensagem')).toHaveValue(/Primeiro parágrafo do rascunho\./);
    await expect(page.getByLabel('Mensagem')).not.toHaveValue(/\[\[foto:/);
  });

  test('painel Rascunhos mostra o texto vazio quando não há rascunhos', async ({ page }) => {
    await page.getByRole('button', { name: 'Rascunhos' }).click();
    await expect(page.getByText('Nenhum rascunho salvo.')).toBeVisible();
    expect(await readStorage(page, DRAFTS_KEY)).toBeNull();
  });

  test('Excluir remove o rascunho salvo', async ({ page }) => {
    await fillIdentityAndMessage(page, 'Rascunho para excluir', 'Texto do rascunho.');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect.poll(() => readStorage(page, DRAFTS_KEY)).not.toBeNull();

    await page.getByRole('button', { name: 'Rascunhos' }).click();
    // Aceita uma eventual confirmação; segue funcionando se não houver diálogo.
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Excluir' }).first().click();
    await expect(page.getByText('Nenhum rascunho salvo.')).toBeVisible();
  });

  test('contador aparece na barra do ShareBox e cresce só após criação com sucesso', async ({
    page,
  }) => {
    // O contador é comportamento de UI + localStorage: interceptar a criação
    // evita consumir o limite de taxa do backend com criações que não são lidas.
    await page.route('**/api/letters', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ url: '/c/contador-local' }),
      });
    });

    // Uma tentativa inválida não pode incrementar o contador.
    await page.getByRole('button', { name: 'Guardar carta' }).click();
    await expect(page.getByText('Dê um título à sua carta antes de guardá-la.')).toBeVisible();
    expect(await readStorage(page, LETTERS_WRITTEN_KEY)).toBeNull();

    await fillIdentityAndMessage(page, 'Primeira carta', 'Mensagem da primeira carta.');
    await page.getByRole('button', { name: 'Guardar carta' }).click();
    await expect(page.locator('#share-url')).toHaveValue(/\/c\//);
    await expect(
      page.getByText('Você já escreveu 1 carta neste navegador.', { exact: true }),
    ).toBeVisible();
    expect(await readStorage(page, LETTERS_WRITTEN_KEY)).not.toBeNull();

    await page.getByRole('button', { name: 'Nova carta' }).click();
    await fillIdentityAndMessage(page, 'Segunda carta', 'Mensagem da segunda carta.');
    await page.getByRole('button', { name: 'Guardar carta' }).click();
    await expect(page.locator('#share-url')).toHaveValue(/\/c\//);
    await expect(
      page.getByText('Você já escreveu 2 cartas neste navegador.', { exact: true }),
    ).toBeVisible();
  });

  test('botão Nova carta limpa o formulário', async ({ page }) => {
    await fillIdentityAndMessage(page, 'Rascunho temporário', 'Texto que deve desaparecer.');
    await page.getByLabel('Assinatura').fill('Assinatura temporária');

    await page.getByRole('button', { name: 'Nova carta' }).click();

    await expect(page.getByLabel('De:')).toHaveValue('');
    await expect(page.getByLabel('Para:')).toHaveValue('');
    await expect(page.getByLabel('Título da carta')).toHaveValue('');
    await expect(page.getByLabel('Mensagem')).toHaveValue('');
    await expect(page.getByLabel('Assinatura')).toHaveValue('');
    expect(await readStorage(page, LETTERS_WRITTEN_KEY)).toBeNull();
  });
});
