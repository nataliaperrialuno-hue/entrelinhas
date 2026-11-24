import { DEFAULT_INK_COLOR, ENVELOPES, LETTER_COLORS, PAPERS, PALETTES, SEALS, TYPOGRAPHIES } from '../../shared/themes';
import type { ThemeSelection } from '../../shared/types';

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
}

export function PersonalizationPanel({ theme, onThemeChange }: PersonalizationPanelProps) {
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
