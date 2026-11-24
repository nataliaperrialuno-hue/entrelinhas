import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';

// Específico da curva moderada. Mantido em arquivo separado para não alterar
// os cenários já verdes em reading.spec.ts.
interface ModeratedFadeDraft {
  senderName: string;
  senderAnonymous: boolean;
  recipientName: string;
  title: string;
  message: string;
  signature: string;
  theme: {
    envelope: 'classic';
    seal: 'wine';
    palette: 'sepia';
    typography: 'serif';
    paper: 'linen';
  };
  fadeEnabled: boolean;
}

async function openShortLetter(
  page: Page,
  request: APIRequestContext,
  message: string,
): Promise<Locator> {
  const draft: ModeratedFadeDraft = {
    senderName: 'Remetente',
    senderAnonymous: false,
    recipientName: 'Destinatário',
    title: 'Carta curta',
    message,
    signature: 'Assinatura',
    theme: {
      envelope: 'classic',
      seal: 'wine',
      palette: 'sepia',
      typography: 'serif',
      paper: 'linen',
    },
    fadeEnabled: true,
  };

  const response = await request.post('/api/letters', { data: draft });
  expect(response.status(), await response.text()).toBe(201);
  const { url } = (await response.json()) as { url: string };

  await page.goto(url);
  await expect(page).toHaveURL(/\/leitura\//);
  await page.getByRole('button', { name: /Continuar/i }).click();
  await page.getByRole('button', { name: /abrir|selo|revelar/i }).first().click();
  await expect(page.locator('.letter-sheet')).toBeVisible();
  return page.locator('.letter-sheet__paragraph').first();
}

test.describe('Curva de apagamento moderada', () => {
  // A transição é desligada sob prefers-reduced-motion; fixamos a preferência
  // para que a medição do CSS seja determinística.
  test.use({ reducedMotion: 'no-preference' });

  test('carta curta não apaga antes da interação e usa transição de 500 ms ease-out', async ({
    page,
    request,
  }) => {
    const paragraph = await openShortLetter(page, request, 'Apenas uma frase breve.');

    // 1800 ms excede tanto o antigo teto (400 ms) quanto o novo mínimo (1000 ms).
    // Sem wheel, scrollBy, toque ou tecla, nenhum bloco pode ser apagado.
    await page.waitForTimeout(1800);

    await expect(paragraph).toHaveText(/Apenas uma frase breve\./);
    await expect(page.locator('[data-letter-block][data-faded="true"]')).toHaveCount(0);
    await expect
      .poll(() => paragraph.evaluate((element) => Number(getComputedStyle(element).opacity)))
      .toBeGreaterThan(0.95);

    // A mesma carta serve para medir a curva CSS: evita um POST extra de carta
    // e mantém a suíte abaixo do limite de taxa do backend.
    const transition = await paragraph.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        duration: style.transitionDuration,
        timing: style.transitionTimingFunction,
      };
    });

    expect(transition.duration).toContain('0.5s');
    expect(transition.timing).toContain('ease-out');
  });
});
