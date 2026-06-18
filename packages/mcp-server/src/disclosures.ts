// Article 50 transparency disclosure snippets (EN/DE). Offline templates — the
// operational layer the free LLM can't reliably produce on demand with citations.

export type DisclosureScenario = 'chatbot' | 'genai-content' | 'deepfake' | 'emotion';

const ARTICLE_50_URL = 'https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202401689#article-50';

const TEMPLATES: Record<DisclosureScenario, { en: string; de: string }> = {
  chatbot: {
    en: 'You are interacting with an AI system. Responses are generated automatically and may be inaccurate. A human is available on request.',
    de: 'Sie interagieren mit einem KI-System. Antworten werden automatisch generiert und können fehlerhaft sein. Auf Wunsch ist eine menschliche Ansprechperson verfügbar.',
  },
  'genai-content': {
    en: 'This content was generated or assisted by artificial intelligence and is marked as AI-generated in a machine-readable way.',
    de: 'Dieser Inhalt wurde von künstlicher Intelligenz erzeugt oder unterstützt und ist maschinenlesbar als KI-generiert gekennzeichnet.',
  },
  deepfake: {
    en: 'This image/audio/video has been artificially generated or manipulated (AI-generated content).',
    de: 'Dieses Bild/Audio/Video wurde künstlich erzeugt oder manipuliert (KI-generierter Inhalt).',
  },
  emotion: {
    en: 'This system uses emotion-recognition AI. You are informed of its operation; processing follows applicable data-protection law.',
    de: 'Dieses System nutzt KI zur Emotionserkennung. Sie werden über den Betrieb informiert; die Verarbeitung erfolgt nach geltendem Datenschutzrecht.',
  },
};

export interface DisclosureResult {
  scenario: DisclosureScenario;
  locale: 'en' | 'de';
  text: string;
  article: string;
  citationUrl: string;
}

export function generateDisclosure(scenario: DisclosureScenario, locale: 'en' | 'de' = 'en'): DisclosureResult {
  const tpl = TEMPLATES[scenario];
  return {
    scenario,
    locale,
    text: tpl[locale],
    article: 'Article 50',
    citationUrl: ARTICLE_50_URL,
  };
}

export const DISCLOSURE_SCENARIOS = Object.keys(TEMPLATES) as DisclosureScenario[];
