// The browser's own dictation, where it has one: what the composer's mic
// listens through.
export type Recognizer = {
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

export const recognizer = (): Recognizer | null => {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognizer;
    webkitSpeechRecognition?: new () => Recognizer;
  };
  const R = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return R ? new R() : null;
};

// Everything heard so far, as one line.
export const heardOf = (e: {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}) => {
  let heard = "";
  for (let i = 0; i < e.results.length; i++)
    heard += e.results[i]![0]!.transcript;
  return heard;
};
