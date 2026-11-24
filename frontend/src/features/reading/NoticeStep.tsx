interface NoticeStepProps {
  onContinue: () => void;
}

const NOTICE_TEXT =
  'Antes de continuar...\n\nEsta carta foi preparada para ser lida uma única vez. Quando chegar ao final, as palavras desaparecerão.\n\nLeia no seu tempo.';

export function NoticeStep({ onContinue }: NoticeStepProps) {
  return (
    <main className="reading-step reading-step--notice">
      <section className="reading-step__card">
        <p className="notice-step__text">{NOTICE_TEXT}</p>
        <button
          type="button"
          className="btn btn--primary notice-step__continue"
          onClick={onContinue}
        >
          Continuar
        </button>
      </section>
    </main>
  );
}

export default NoticeStep;
