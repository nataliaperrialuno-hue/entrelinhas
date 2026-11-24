interface NoticeStepProps {
  onContinue: () => void;
  fadeEnabled?: boolean;
}

const NOTICE_TEXT_WITH_FADE =
  'Antes de continuar...\n\nEsta carta foi preparada para ser lida uma única vez. Quando chegar ao final, as palavras desaparecerão.\n\nLeia no seu tempo.';

const NOTICE_TEXT_WITHOUT_FADE =
  'Antes de continuar...\n\nEsta carta foi preparada para ser lida uma única vez. As palavras permanecem visíveis durante a leitura e desaparecem somente quando ela termina.\n\nLeia no seu tempo.';

export function NoticeStep({ onContinue, fadeEnabled = true }: NoticeStepProps) {
  const noticeText = fadeEnabled ? NOTICE_TEXT_WITH_FADE : NOTICE_TEXT_WITHOUT_FADE;

  return (
    <main className="reading-step reading-step--notice">
      <section className="reading-step__card">
        <p className="notice-step__text">{noticeText}</p>
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
