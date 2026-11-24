import { LetterSheet } from '../../shared/LetterSheet';
import type { RichTextRenderOptions } from '../../shared/richText';
import type { LetterView } from '../../shared/types';

interface PreviewPaneProps {
  letter: LetterView;
  resolveAsset?: RichTextRenderOptions['resolveAsset'];
}

export function PreviewPane({ letter, resolveAsset }: PreviewPaneProps) {
  return (
    <section className="preview-pane" aria-labelledby="preview-heading">
      <div className="preview-pane__intro">
        <h2 className="preview-pane__title" id="preview-heading">
          Prévia da carta
        </h2>
        <p className="preview-pane__note">
          Esta prévia não é a carta final: ela mostra apenas como suas palavras e seu tema
          serão apresentados na leitura.
        </p>
      </div>
      <LetterSheet letter={letter} className="preview-sheet" resolveAsset={resolveAsset} />
    </section>
  );
}

export default PreviewPane;
