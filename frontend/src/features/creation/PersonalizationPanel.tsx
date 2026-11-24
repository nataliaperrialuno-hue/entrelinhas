import { useState } from 'react';
import { uploadAsset } from '../../lib/api';
import { MAX_SEAL_BYTES } from '../../shared/limits';
import { DEFAULT_INK_COLOR, ENVELOPES, LETTER_COLORS, PAPERS, PALETTES, SEALS, TYPOGRAPHIES } from '../../shared/themes';
import type { AssetRef, ThemeSelection } from '../../shared/types';
import { SealCanvas } from './SealCanvas';

interface ThemeOptionLike<Id extends string> {
  id: Id;
  label: string;
  description: string;
}

interface ThemeGroupProps<Id extends string> {
  legend: string;
  name: string;
  options: readonly ThemeOptionLike<Id>[];
  value: Id;
  onChange: (id: Id) => void;
}

function ThemeGroup<Id extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: ThemeGroupProps<Id>) {
  const groupId = `theme-group-${name}`;

  return (
    <fieldset className="theme-group">
      <legend className="theme-group__legend">{legend}</legend>
      <div className="theme-options" role="radiogroup" aria-labelledby={groupId}>
        <span className="sr-only" id={groupId}>
          {legend}
        </span>
        {options.map((option) => {
          const optionId = `${name}-${option.id}`;
          return (
            <label className="theme-option" htmlFor={optionId} key={option.id}>
              <input
                id={optionId}
                type="radio"
                name={name}
                value={option.id}
                checked={value === option.id}
                onChange={() => onChange(option.id)}
              />
              <span>
                <span className="theme-option__label">{option.label}</span>
                <span className="theme-option__description">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface PersonalizationPanelProps {
  theme: ThemeSelection;
  onThemeChange: <Key extends keyof ThemeSelection>(field: Key, value: ThemeSelection[Key]) => void;
  sealAssetId: string | null;
  sealPreviewUrl: string | null;
  onSealAssetChange: (asset: AssetRef | null, objectUrl: string | null) => void;
}

export function PersonalizationPanel({
  theme,
  onThemeChange,
  sealAssetId,
  sealPreviewUrl,
  onSealAssetChange,
}: PersonalizationPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [sealError, setSealError] = useState<string | null>(null);

  async function handleUseSeal(blob: Blob): Promise<void> {
    if (blob.size > MAX_SEAL_BYTES) {
      setSealError(`O desenho do selo pode ter até ${MAX_SEAL_BYTES / 1024} KiB.`);
      return;
    }

    setUploading(true);
    setSealError(null);
    const previewUrl = URL.createObjectURL(blob);
    try {
      // uploadAsset aceita File: o nome é gerado internamente, nunca vem do usuário.
      const sealFile = new File([blob], 'selo.png', { type: 'image/png' });
      const asset = await uploadAsset(sealFile, 'seal');
      onSealAssetChange(asset, previewUrl);
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      setSealError(
        error instanceof Error ? error.message : 'Não foi possível guardar o selo. Tente novamente.',
      );
    } finally {
      setUploading(false);
    }
  }

  function handleClearSeal(): void {
    setSealError(null);
    onSealAssetChange(null, null);
  }

  return (
    <div className="personalization">
      <ThemeGroup
        legend="Envelope"
        name="envelope"
        options={ENVELOPES}
        value={theme.envelope}
        onChange={(id) => onThemeChange('envelope', id)}
      />
      <ThemeGroup
        legend="Selo"
        name="seal"
        options={SEALS}
        value={theme.seal}
        onChange={(id) => onThemeChange('seal', id)}
      />
      {theme.seal === 'custom' && (
        <div className="seal-custom-panel">
          <SealCanvas
            onUse={(blob) => void handleUseSeal(blob)}
            onClear={handleClearSeal}
          />
          {sealPreviewUrl !== null && (
            <img className="seal-preview" src={sealPreviewUrl} alt="Prévia do selo desenhado" />
          )}
          {sealAssetId !== null && <p className="seal-ready">Selo pronto para a carta.</p>}
          {uploading && (
            <p className="upload-note" aria-live="polite">
              Guardando o selo…
            </p>
          )}
          {sealError !== null && (
            <p className="photo-error" role="alert" aria-live="assertive">
              {sealError}
            </p>
          )}
        </div>
      )}
      <ThemeGroup
        legend="Paleta"
        name="palette"
        options={PALETTES}
        value={theme.palette}
        onChange={(id) => onThemeChange('palette', id)}
      />
      <ThemeGroup
        legend="Tipografia"
        name="typography"
        options={TYPOGRAPHIES}
        value={theme.typography}
        onChange={(id) => onThemeChange('typography', id)}
      />
      <ThemeGroup
        legend="Papel"
        name="paper"
        options={PAPERS}
        value={theme.paper}
        onChange={(id) => onThemeChange('paper', id)}
      />

      <fieldset className="theme-group">
        <legend className="theme-group__legend">Cor da letra</legend>
        <div className="ink-colors" role="group" aria-label="Cor da letra da carta">
          {LETTER_COLORS.map((color) => (
            <button
              className={`ink-swatch${theme.inkColor === color.value ? ' ink-swatch--selected' : ''}`}
              key={color.id}
              type="button"
              style={{ backgroundColor: color.value }}
              title={color.label}
              aria-label={`Cor da letra ${color.label}`}
              aria-pressed={theme.inkColor === color.value}
              onClick={() => onThemeChange('inkColor', color.value)}
            />
          ))}
          <label className="ink-custom">
            <span className="sr-only">Cor personalizada</span>
            <input
              type="color"
              value={theme.inkColor ?? DEFAULT_INK_COLOR}
              onChange={(event) => onThemeChange('inkColor', event.target.value.toLowerCase())}
            />
            <span className="ink-custom__label">Personalizada</span>
          </label>
          <button
            className="ink-reset"
            type="button"
            onClick={() => onThemeChange('inkColor', undefined)}
          >
            Usar cor da paleta
          </button>
        </div>
      </fieldset>
    </div>
  );
}

export default PersonalizationPanel;
