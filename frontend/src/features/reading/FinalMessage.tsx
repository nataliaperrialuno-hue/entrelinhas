const FINAL_TEXT =
  'Esta carta já cumpriu seu propósito.\n\nAlgumas palavras precisam apenas ser sentidas.';

export function FinalMessage() {
  return (
    <main className="reading-final">
      <div className="reading-final__halo" aria-hidden="true" />
      <p className="reading-final__text">{FINAL_TEXT}</p>
      <a href="/" className="reading-final__home">
        Home — escrever outra carta
      </a>
    </main>
  );
}

export default FinalMessage;
