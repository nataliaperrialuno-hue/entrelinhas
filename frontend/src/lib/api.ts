import type {
  AssetUploadResult,
  CreateLetterResponse,
  LetterDraft,
  LetterView,
  ReadingState,
} from '../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Converte uma resposta não-OK em ApiError, preservando `error` do servidor. */
async function throwApiError(response: Response): Promise<never> {
  let message = `Requisição falhou com status ${response.status}`;
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload?.error === 'string' && payload.error.length > 0) {
      message = payload.error;
    }
  } catch {
    // Resposta sem corpo JSON: manter a mensagem padrão baseada no status.
  }
  throw new ApiError(response.status, message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined;
  const headers: Record<string, string> = {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };

  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers,
  });

  if (!response.ok) await throwApiError(response);

  return response.json() as Promise<T>;
}

function readingPath(sessionId: string, action: string): string {
  return `/api/read/${encodeURIComponent(sessionId)}/${action}`;
}

export function createLetter(draft: LetterDraft): Promise<CreateLetterResponse> {
  return request<CreateLetterResponse>('/api/letters', {
    method: 'POST',
    body: JSON.stringify(draft),
  });
}

export function getReadingState(sessionId: string): Promise<ReadingState> {
  return request<ReadingState>(readingPath(sessionId, 'state'));
}

export function openLetter(sessionId: string): Promise<LetterView> {
  return request<LetterView>(readingPath(sessionId, 'open'), { method: 'POST' });
}

export function sendProgress(
  sessionId: string,
  progress: number,
): Promise<{ progress: number }> {
  return request<{ progress: number }>(readingPath(sessionId, 'progress'), {
    method: 'POST',
    body: JSON.stringify({ progress }),
  });
}

export function completeReading(sessionId: string): Promise<{ state: 'completed' }> {
  return request<{ state: 'completed' }>(readingPath(sessionId, 'complete'), {
    method: 'POST',
    headers: { 'Idempotency-Key': `${sessionId}:complete` },
  });
}

/**
 * Envia o arquivo cru, sem o JSON de `request()`. O tipo vem do próprio File;
 * o servidor valida MIME/tamanho e é a autoridade final.
 */
export function uploadAsset(file: File, kind: 'photo' | 'seal'): Promise<AssetUploadResult> {
  return fetch('/api/assets', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-asset-kind': kind,
    },
    body: file,
  }).then(async (response) => {
    if (!response.ok) await throwApiError(response);
    return response.json() as Promise<AssetUploadResult>;
  });
}

export function heartbeatReading(sessionId: string): Promise<{
  state: string;
  progress: number;
  readDeadlineAt: number | null;
  idleDeadlineAt: number | null;
}> {
  return request(readingPath(sessionId, 'heartbeat'), { method: 'POST' });
}

export function assetUrl(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}`;
}
