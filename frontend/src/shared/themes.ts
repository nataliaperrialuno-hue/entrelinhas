import type {
  EnvelopeId,
  PaletteId,
  PaperId,
  SealId,
  ThemeSelection,
  TypographyId,
} from './types';

interface ThemeOption<Id extends string> {
  id: Id;
  label: string;
  description: string;
}

export const ENVELOPES = [
  { id: 'classic', label: 'Clássico', description: 'Sobrescrito tradicional, com detalhes discretos.' },
  { id: 'floral', label: 'Floral', description: 'Motivos botânicos sutis nas bordas.' },
  { id: 'minimal', label: 'Minimal', description: 'Linhas limpas, sem ornamentos.' },
] as const satisfies readonly ThemeOption<EnvelopeId>[];

export const SEALS = [
  { id: 'wine', label: 'Vinho', description: 'Vermelho profundo, discreto e solene.' },
  { id: 'gold', label: 'Ouro', description: 'Brilho quente e delicado.' },
  { id: 'ink', label: 'Tinta', description: 'Azul escuro de tinta de caneta.' },
] as const satisfies readonly ThemeOption<SealId>[];

export const PALETTES = [
  { id: 'sepia', label: 'Sépia', description: 'Tons quentes de papel envelhecido.' },
  { id: 'rose', label: 'Rosado', description: 'Rosa suave, com contraste equilibrado.' },
  { id: 'night', label: 'Noturno', description: 'Fundo escuro e tinta clara.' },
  { id: 'sage', label: 'Sálvia', description: 'Verde sereno e natural.' },
] as const satisfies readonly ThemeOption<PaletteId>[];

export const TYPOGRAPHIES = [
  { id: 'serif', label: 'Serifada', description: 'Clássica, confortável para leitura longa.' },
  { id: 'hand', label: 'Manuscrita', description: 'Traços próximos da escrita à mão.' },
  { id: 'mono', label: 'Monoespaçada', description: 'Ritmo regular, inspiração mecânica.' },
] as const satisfies readonly ThemeOption<TypographyId>[];

export const PAPERS = [
  { id: 'linen', label: 'Linho', description: 'Textura leve de fibra de linho.' },
  { id: 'plain', label: 'Simples', description: 'Superfície lisa e sem marcas.' },
  { id: 'aged', label: 'Envelhecido', description: 'Papel amarelado, com sombra suave.' },
] as const satisfies readonly ThemeOption<PaperId>[];

export const DEFAULT_THEME: ThemeSelection = {
  envelope: 'classic',
  seal: 'wine',
  palette: 'sepia',
  typography: 'serif',
  paper: 'linen',
};

export function themeClassNames(theme: ThemeSelection): string {
  return `theme-palette-${theme.palette} theme-type-${theme.typography} theme-paper-${theme.paper} env-${theme.envelope} seal-${theme.seal}`;
}
