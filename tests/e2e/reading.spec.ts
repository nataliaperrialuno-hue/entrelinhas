import { expect, test, type APIRequestContext } from '@playwright/test';

// As cartas são criadas pela API real: nenhum token ou dado pessoal é embutido
// neste arquivo. O link retornado é usado apenas em tempo de execução.
const draft = {
  senderName: 'Remetente',
  senderAnonymous: false,
  recipientName: 'Destinatário',
  title: 'Carta de verificação',
  message: 'Primeiro parágrafo da carta de verificação.\n\nSegundo parágrafo da carta de verificação.',
  signature: 'Assinatura',
  theme: {
    envelope: 'classic',
    seal: 'wine',
    palette: 'sepia',
    typography: 'serif',
    paper: 'linen',
  },
} as const;

interface ReadingStateResponse {
  state: string;
  progress: number;
}

async function createLetterUrl(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/letters', { data: draft });
  expect(response.status()).toBe(201);

  const body = (await response.json()) as { url: string };
  expect(body.url).toMatch(/^\/c\/[A-Za-z0-9_-]+$/);
  return body.url;
}

function sessionIdFromUrl(currentUrl: string): string {
  const segments = new URL(currentUrl).pathname.split('/').filter(Boolean);
  const sessionId = segments[1];
  if (!sessionId) {
    throw new Error('A URL de leitura não continha um sessionId');
  }
  return decodeURIComponent(sessionId);
}

async function readState(
  request: APIRequestContext,
  sessionId: string,
): Promise<ReadingStateResponse> {
  const response = await request.get(`/api/read/${encodeURIComponent(sessionId)}/state`);
  if (!response.ok()) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(`GET /state falhou (${response.status()}): ${body.error ?? 'sem detalhe'}`);
  }
  return (await response.json()) as ReadingStateResponse;
}

test.describe('Fluxo de leitura única', () => {
  test('cria uma carta e devolve um link de leitura', async ({ request }) => {
    const url = await createLetterUrl(request);

    // maxRedirects: 0 evita que o cliente siga o 302 e perca a resposta do link.
    const response = await request.get(url, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toMatch(/^\/leitura\//);
    expect(response.headers()['set-cookie']).toMatch(/HttpOnly/i);
  });

  test('preenche De, Para, título e mensagem no formulário e obtém o link', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('De:').fill('Remetente');
    await page.getByLabel('Não informar destinatário').uncheck();
    await page.getByLabel('Para:').fill('Destinatário');
    await page.getByLabel('Título da carta').fill('Carta de verificação');
    await page.getByLabel('Mensagem').fill('Primeiro parágrafo.\n\nSegundo parágrafo.');
    await page.getByRole('button', { name: /Guardar carta/i }).click();
    await expect(page.locator('#share-url')).toHaveValue(/\/c\//);
    await expect(page.getByRole('link', { name: /WhatsApp/i })).toBeVisible();
  });

  test('abrir o link exibe o aviso inicial antes de revelar a carta', async ({ page, request }) => {
    const url = await createLetterUrl(request);

    await page.goto(url);
    await expect(page).toHaveURL(/\/leitura\//);
    await expect(page.getByText(/Antes de continuar/i)).toBeVisible();
  });

  test('clique no selo revela o conteúdo da carta', async ({ page, request }) => {
    const url = await createLetterUrl(request);
    await page.goto(url);
    await page.getByRole('button', { name: /Continuar/i }).click();
    const sessionId = sessionIdFromUrl(page.url());
    await expect(page.getByRole('button', { name: /abrir|selo|revelar/i }).first()).toBeVisible();

    const opened = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes(`/api/read/${encodeURIComponent(sessionId)}/open`),
    );

    await page.getByRole('button', { name: /abrir|selo|revelar/i }).first().click();

    const response = await opened;
    expect(response.status()).toBe(200);
    const letter = (await response.json()) as { title: string; message: string };
    expect(letter.title).toBe(draft.title);
    expect(letter.message).toContain('Primeiro parágrafo');
  });

  test('rolagem progressiva conclui a leitura automaticamente', async ({ page, request }) => {
    test.setTimeout(90000);
    const url = await createLetterUrl(request);
    await page.goto(url);
    await page.getByRole('button', { name: /Continuar/i }).click();
    const sessionId = sessionIdFromUrl(page.url());

    await expect(page.getByRole('button', { name: /abrir|selo|revelar/i }).first()).toBeVisible();
    await page.getByRole('button', { name: /abrir|selo|revelar/i }).first().click();
    await expect
      .poll(async () => (await readState(page.request, sessionId)).progress)
      .toBeGreaterThan(0);

    // A rolagem e o dwell ("linha de leitura") avançam o progresso; a decisão
    // final de conclusão é sempre do servidor, consultada via /state.
    await page.locator('.letter-scroll').hover();
    for (let step = 0; step < 40; step += 1) {
      await page.mouse.wheel(0, 800);
      await page.locator('.letter-scroll').evaluate((el) => el.scrollBy(0, 800));
      await page.waitForTimeout(500);
      if ((await readState(page.request, sessionId)).state === 'completed') {
        break;
      }
    }

    await expect.poll(async () => (await readState(page.request, sessionId)).state).toBe('completed');
    await expect(page.getByText(/cumpriu seu propósito|palavras precisam apenas ser sentidas/i)).toBeVisible();
  });

  test('formatação e cor da letra chegam intactas ao leitor', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Não informar destinatário').uncheck();
    await page.getByLabel('Para:').fill('Destinatário');
    await page.getByLabel('Título da carta').fill('Carta formatada');

    const message = page.getByLabel('Mensagem');
    await message.fill('Texto importante');
    await message.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(0, 5));
    await page.getByRole('button', { name: 'Negrito (Ctrl+B)' }).click();
    await expect(page.locator('.preview-sheet strong')).toHaveText('Texto');

    await page.getByRole('button', { name: 'Cor da letra Vinho' }).click();
    await expect(page.locator('.preview-sheet')).toHaveAttribute(
      'style',
      /--letter-ink:\s*#7c2d38/,
    );

    await page.getByRole('button', { name: /Guardar carta/i }).click();
    const url = await page.locator('#share-url').inputValue();

    await page.goto(url);
    await page.getByRole('button', { name: /Continuar/i }).click();
    await page.getByRole('button', { name: /abrir|selo|revelar/i }).first().click();

    await expect(page.locator('.letter-sheet strong')).toHaveText('Texto');
    await expect(page.locator('.letter-sheet')).toHaveAttribute(
      'style',
      /--letter-ink:\s*#7c2d38/,
    );
  });
});
