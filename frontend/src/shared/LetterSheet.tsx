import { themeClassNames } from './themes';
import type { LetterView } from './types';

interface LetterSheetProps {
  letter: LetterView;
  className?: string;
}

export function LetterSheet({ letter, className }: LetterSheetProps) {
  return (
    <article
      className={`letter-sheet ${themeClassNames(letter.theme)} ${className ?? ''}`}
      data-letter-sheet="true"
    >
      <header className="letter-sheet__header">
        {letter.senderName && <p className="letter-sheet__sender">De: {letter.senderName}</p>}
        {letter.recipientName && (
          <p className="letter-sheet__recipient">Para: {letter.recipientName}</p>
        )}
      </header>
      <h1 className="letter-sheet__title">{letter.title}</h1>
      <div className="letter-sheet__body">
        {letter.message.split(/\n\s*\n/).map((paragraph, index) => (
          <p
            key={index}
            className="letter-sheet__paragraph"
            data-letter-block="true"
            data-block-index={index}
          >
            {paragraph}
          </p>
        ))}
      </div>
      {letter.signature && <footer className="letter-sheet__signature">{letter.signature}</footer>}
    </article>
  );
}

export default LetterSheet;
