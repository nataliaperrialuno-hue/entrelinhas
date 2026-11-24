import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';

// As cartas são criadas pela API real: nenhum token ou dado pessoal é embutido
// neste arquivo. O link retornado é usado apenas em tempo de execução.
interface AssetRef {
  id: string;
  uploadToken: string;
}

interface DraftTheme {
  envelope: 'classic' | 'floral' | 'minimal';
  seal: 'wine' | 'gold' | 'ink' | 'custom';
  palette: 'sepia' | 'rose' | 'night' | 'sage';
  typography: 'serif' | 'hand' | 'mono';
  paper: 'linen' | 'plain' | 'aged';
  inkColor?: string;
}

interface LetterDraftPayload {
  senderName: string;
  senderAnonymous: boolean;
  recipientName: string;
  title: string;
  message: string;
  signature: string;
  theme: DraftTheme;
  /** Opcionais: cartas antigas não enviam estes campos. */
  fadeEnabled?: boolean;
  readTimeLimitSeconds?: number;
  assets?: AssetRef[];
  sealAssetId?: string | null;
}

const draft: LetterDraftPayload = {
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
};

type DraftOverrides = Partial<Omit<LetterDraftPayload, 'theme'>> & {
  theme?: Partial<DraftTheme>;
};

function draftWith(overrides: DraftOverrides = {}): LetterDraftPayload {
  const { theme, ...fields } = overrides;
  return { ...draft, ...fields, theme: { ...draft.theme, ...theme } };
}

interface ReadingStateResponse {
  state: string;
  progress: number;
  readDeadlineAt?: number | null;
  idleDeadlineAt?: number | null;
  fadeEnabled?: boolean;
  sealAssetId?: string | null;
}

// PNG 1x1 válido (magic bytes 89 50 4e 47); o servidor valida MIME e bytes reais.
const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PIXEL_PNG = Buffer.from(PIXEL_PNG_BASE64, 'base64');

async function createLetterUrl(
  request: APIRequestContext,
  overrides: DraftOverrides = {},
): Promise<string> {
  const response = await request.post('/api/letters', { data: draftWith(overrides) });
  expect(response.status(), await response.text()).toBe(201);

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

/** Retorna o primeiro seletor presente, sem depender de uma classe de UI específica. */
async function firstPresent(page: Page, selectors: readonly string[]): Promise<Locator> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) return locator;
  }
  throw new Error(`Nenhum destes seletores foi encontrado: ${selectors.join(', ')}`);
}

async function openReading(page: Page, url: string): Promise<string> {
  await page.goto(url);
  await expect(page).toHaveURL(/\/leitura\//);
  await page.getByRole('button', { name: /Continuar/i }).click();

  const sealButton = page.getByRole('button', { name: /abrir|selo|revelar/i }).first();
  await expect(sealButton).toBeVisible();
  await sealButton.click();
  await expect(page.locator('.letter-sheet')).toBeVisible();

  return sessionIdFromUrl(page.url());
}

async function expectParagraphsIntact(page: Page, pattern: RegExp): Promise<void> {
  const paragraph = page.locator('.letter-sheet__paragraph').first();
  await expect(paragraph).toHaveText(pattern);
  await expect
    .poll(async () =>
      Number(await paragraph.evaluate((element) => getComputedStyle(element).opacity)),
    )
    .toBeGreaterThan(0.95);
  expect(await page.locator('[data-letter-block][data-faded="true"]').count()).toBe(0);
}

async function scrollToEnd(page: Page, sessionId: string): Promise<void> {
  await page.locator('.letter-scroll').hover();
  for (let step = 0; step < 40; step += 1) {
    if ((await readState(page.request, sessionId)).state === 'completed') return;
    await page.mouse.wheel(0, 800);
    // A leitura pode completar e remover o container; scroll via DOM tolera a ausência.
    await page.evaluate(() => document.querySelector('.letter-scroll')?.scrollBy(0, 800));
    await page.waitForTimeout(400);
  }
}

async function drawCustomSeal(page: Page, canvas: Locator): Promise<void> {
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error('O canvas do selo não tem caixa delimitadora');

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX - box.width * 0.25, centerY);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(
      centerX - box.width * 0.25 + (box.width * 0.5 * step) / 6,
      centerY + (step % 2 === 0 ? box.height * 0.12 : -box.height * 0.12),
    );
  }
  await page.mouse.up();

  const hasInk = await canvas.evaluate((node: HTMLCanvasElement) => {
    const context = node.getContext('2d');
    if (context === null) return false;
    const pixels = context.getImageData(0, 0, node.width, node.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) return true;
    }
    return false;
  });
  expect(hasInk, 'O canvas do selo deveria conter traços desenhados').toBe(true);

  // O desenho só vira asset quando o usuário confirma com "Usar desenho".
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().includes('/api/assets'),
  );
  await page.getByRole('button', { name: /Usar desenho/i }).click();
  expect((await uploaded).status()).toBe(201);
  await expect(page.getByText('Selo pronto para a carta.')).toBeVisible();
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

  test('carta curta não apaga palavras antes de qualquer interação', async ({ page, request }) => {
    // O dwell antigo apagava uma carta curta apenas pela geometria do mount.
    // Aqui não há wheel, scrollBy, toque ou tecla de navegação após /open.
    const url = await createLetterUrl(request, {
      title: 'Carta curta',
      message: 'Apenas uma frase breve.',
    });
    const sessionId = await openReading(page, url);

    await page.waitForTimeout(1500);
    await expectParagraphsIntact(page, /Apenas uma frase breve\./);
    expect((await readState(page.request, sessionId)).state).toBe('reading');
  });

  test('fadeEnabled:false mantém o texto visível e ainda conclui a leitura', async ({
    page,
    request,
  }) => {
    const url = await createLetterUrl(request, {
      fadeEnabled: false,
      title: 'Carta sem apagamento visual',
      message: 'Primeira linha que permanece.\n\nSegunda linha que permanece.',
    });
    const sessionId = await openReading(page, url);
    const state = await readState(page.request, sessionId);
    expect(state.fadeEnabled).toBe(false);

    await page.waitForTimeout(1200);
    await expectParagraphsIntact(page, /Primeira linha que permanece\./);

    // Interação pequena: o progresso é contabilizado, mas as palavras não somem.
    await page.locator('.letter-scroll').hover();
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(500);
    await expectParagraphsIntact(page, /Primeira linha que permanece\./);

    await scrollToEnd(page, sessionId);
    await expect.poll(async () => (await readState(page.request, sessionId)).state).toBe('completed');
    await expect(page.getByText(/cumpriu seu propósito|palavras precisam apenas ser sentidas/i)).toBeVisible();
  });

  test('selo em branco desenhado no canvas aparece no envelope', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/');
    await page.locator('input[name="seal"][value="custom"]').check();

    const canvas = await firstPresent(page, [
      'canvas[data-seal-canvas]',
      'canvas[aria-label*="selo" i]',
      '.seal-canvas canvas',
      'canvas',
    ]);
    await drawCustomSeal(page, canvas);

    await page.getByLabel('Título da carta').fill('Carta com selo desenhado');
    await page.getByLabel('Mensagem').fill('Uma mensagem com selo desenhado à mão.');

    const letterRequest = page.waitForRequest(
      (request) => request.url().endsWith('/api/letters') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: /Guardar carta/i }).click();

    const sent = await letterRequest;
    const payload = JSON.parse(sent.postData() ?? '{}') as LetterDraftPayload;
    expect(payload.theme.seal).toBe('custom');
    expect(payload.sealAssetId).toBeTruthy();
    expect((payload.assets ?? []).some((asset) => asset.id === payload.sealAssetId)).toBe(true);

    const url = await page.locator('#share-url').inputValue();
    await page.goto(url);
    await page.getByRole('button', { name: /Continuar/i }).click();
    await expect(page.getByRole('button', { name: /abrir|selo|revelar/i }).first()).toBeVisible();

    // Na leitura há cookie de sessão: a imagem do selo precisa carregar de verdade.
    const customSeal = await firstPresent(page, [
      '.wax-seal__image',
      '.wax-seal img',
      '.envelope-stage img',
      '[data-custom-seal]',
    ]);
    await expect(customSeal).toHaveAttribute('src', /\/api\/assets\//);
    await expect.poll(() =>
      customSeal.evaluate((image: HTMLImageElement) => image.naturalWidth),
    ).toBeGreaterThan(0);
  });

  test('foto enviada pelo input aparece na prévia e na carta', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Título da carta').fill('Carta com foto');
    await page.getByLabel('Mensagem').fill('Olha a foto que mandei.');

    const input = await firstPresent(page, [
      'input[type="file"][accept*="image"]',
      'input[type="file"][multiple]',
      'input[type="file"]',
    ]);
    const uploaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/api/assets'),
    );
    await input.setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PIXEL_PNG });
    expect((await uploaded).status()).toBe(201);

    // A prévia roda sem cookie de leitura: validamos a referência, não o decode
    // (que depende de /api/assets/:id só autorizado após abrir a carta).
    const previewImage = await firstPresent(page, ['.preview-sheet img', '.preview-pane img']);
    await expect(previewImage).toBeVisible();
    await expect(previewImage).toHaveAttribute('src', /\/api\/assets\/|blob:|data:image/);

    await page.getByRole('button', { name: /Guardar carta/i }).click();
    const url = await page.locator('#share-url').inputValue();
    await openReading(page, url);

    const letterImage = await firstPresent(page, ['.letter-sheet__body img', '.letter-sheet img']);
    await expect(letterImage).toBeVisible();
    await expect(letterImage).toHaveAttribute('src', /\/api\/assets\//);
    await expect
      .poll(() => letterImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('foto enviada por drag-and-drop aparece na prévia e na carta', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Título da carta').fill('Carta com foto arrastada');
    await page.getByLabel('Mensagem').fill('Esta foto chegou arrastando.');

    // O handler de drop vive no editor de mensagem, não no formulário inteiro.
    const dropTarget = await firstPresent(page, [
      '[data-letter-message-editor]',
      '#letter-message',
      'textarea',
      '[data-photo-dropzone]',
      '.photo-dropzone',
      '.photo-drop-zone',
      '[data-dropzone]',
      'label:has(input[type="file"])',
    ]);
    const dataTransfer = await page.evaluateHandle((base64: string) => {
      const transfer = new DataTransfer();
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      transfer.items.add(new File([bytes], 'foto-arrastada.png', { type: 'image/png' }));
      return transfer;
    }, PIXEL_PNG_BASE64);

    const uploaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/api/assets'),
    );
    await dropTarget.dispatchEvent('dragenter', { dataTransfer });
    await dropTarget.dispatchEvent('dragover', { dataTransfer });
    await dropTarget.dispatchEvent('drop', { dataTransfer });
    expect((await uploaded).status()).toBe(201);

    const previewImage = await firstPresent(page, ['.preview-sheet img', '.preview-pane img']);
    await expect(previewImage).toBeVisible();
    await expect(previewImage).toHaveAttribute('src', /\/api\/assets\/|blob:|data:image/);

    await page.getByRole('button', { name: /Guardar carta/i }).click();
    const url = await page.locator('#share-url').inputValue();
    await openReading(page, url);

    const letterImage = await firstPresent(page, ['.letter-sheet__body img', '.letter-sheet img']);
    await expect(letterImage).toBeVisible();
    await expect(letterImage).toHaveAttribute('src', /\/api\/assets\//);
    await expect
      .poll(() => letterImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  });

  test('estado expõe prazos e heartbeat renova somente a inatividade', async ({ page, request }) => {
    const url = await createLetterUrl(request, { readTimeLimitSeconds: 60 });
    await page.goto(url);
    await expect(page).toHaveURL(/\/leitura\//);
    const sessionId = sessionIdFromUrl(page.url());

    const before = await readState(page.request, sessionId);
    expect(before.fadeEnabled).toBe(true);
    expect(typeof before.readDeadlineAt).toBe('number');
    expect(typeof before.idleDeadlineAt).toBe('number');
    const now = Date.now();
    expect(before.readDeadlineAt!).toBeGreaterThan(now + 50_000);
    expect(before.readDeadlineAt!).toBeLessThan(now + 61_000);
    expect(before.idleDeadlineAt!).toBeGreaterThan(before.readDeadlineAt!);

    await page.waitForTimeout(30);
    const heartbeat = await page.request.post(
      `/api/read/${encodeURIComponent(sessionId)}/heartbeat`,
    );
    expect(heartbeat.status()).toBe(200);
    const after = await readState(page.request, sessionId);
    expect(after.readDeadlineAt).toBe(before.readDeadlineAt);
    expect(after.idleDeadlineAt).toBeGreaterThanOrEqual(before.idleDeadlineAt!);
    expect(after.state).toBe(before.state);

    // A expiração por prazo absoluto/inatividade é verificada nos testes de
    // integração do backend: aqui não há relógio injetável nem espera de 600 s.
  });

  test('tela final oferece o link Home — escrever outra carta', async ({ page, request }) => {
    const url = await createLetterUrl(request);
    await page.goto(url);
    await expect(page).toHaveURL(/\/leitura\//);
    const sessionId = sessionIdFromUrl(page.url());

    const completed = await page.request.post(
      `/api/read/${encodeURIComponent(sessionId)}/complete`,
      { headers: { 'Idempotency-Key': `${sessionId}:complete` } },
    );
    expect(completed.status()).toBe(200);

    await page.reload();
    await expect(page.getByText(/cumpriu seu propósito|palavras precisam apenas ser sentidas/i)).toBeVisible();

    const home = page.getByRole('link', { name: /Home/i });
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute('href', '/');
    await home.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByLabel('Mensagem')).toBeVisible();
  });
});
