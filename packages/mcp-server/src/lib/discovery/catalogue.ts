import type { Capability } from '../ai_act/scope-map';

/**
 * What a dependency can tell you, and what it cannot.
 *
 * `packages/cli/src/detect.ts` already finds AI stacks well. What it returns is
 * `likelyArticle50: boolean` — one flag for a provision that is five separate
 * duties on two different parties. A repo pulling in `openai` and a repo
 * pulling in `face-api.js` both come back "article_50", which is true and
 * useless: the first may owe machine-readable marking under 50(2), the second
 * owes an emotion-recognition notice under 50(3), and they are not
 * interchangeable.
 *
 * So this maps dependencies to CAPABILITIES, the same vocabulary
 * lib/ai_act/scope-map.ts already resolves into limbs, dates and duty-bearers.
 *
 * THE HONEST LIMIT, and it shapes the whole design. A dependency proves what a
 * codebase COULD do, never what it ships. `openai` is one SDK covering text,
 * images and speech; importing it does not mean you generate images. So a
 * manifest match yields a `possible` capability, and only a call site in source
 * raises it to `likely`. Nothing here ever reaches certain.
 *
 * That is why every output of this module is a HYPOTHESIS.
 * docs/EVIDENCE-SUBSTRATE.md: "Machines and models write Hypothesis. A named
 * human writes Claim. That conversion is itself the record." A scanner is a
 * machine, so it may not assert a duty. It may only propose one for a person to
 * confirm.
 */

export type Confidence = 'possible' | 'likely';

export interface PackageRule {
  /** Exact names, or a trailing `*` for scope prefixes. */
  packages: string[];
  capabilities: Capability[];
  /** Shown to the user. A finding without a reason is an accusation. */
  because: string;
}

/**
 * Multi-modal SDKs. These deliberately carry SEVERAL capabilities, all
 * `possible`: one import is genuinely ambiguous between text, image and speech,
 * and pretending otherwise is how a scanner starts lying.
 */
export const MULTIMODAL_RULES: PackageRule[] = [
  {
    packages: ['openai'],
    capabilities: ['gen_text', 'gen_image', 'gen_audio'],
    because: 'The OpenAI SDK covers chat completions, image generation and speech synthesis in one package.',
  },
  {
    packages: ['@google/generative-ai', '@google/genai', '@google-cloud/vertexai'],
    capabilities: ['gen_text', 'gen_image'],
    because: 'The Google generative SDKs cover text and image generation.',
  },
  {
    packages: ['replicate', '@huggingface/inference', 'fal', '@fal-ai/*', 'together-ai'],
    capabilities: ['gen_text', 'gen_image', 'gen_video', 'gen_audio'],
    because: 'Model-hosting SDKs run whatever model you point them at, across every modality.',
  },
];

/** Single-modality packages. Less ambiguous, but still only `possible`. */
export const MODALITY_RULES: PackageRule[] = [
  {
    packages: [
      '@anthropic-ai/sdk', '@mistralai/mistralai', 'cohere-ai', 'groq-sdk', 'ollama',
      '@aws-sdk/client-bedrock-runtime', '@azure/openai', 'ai', '@ai-sdk/*',
      'langchain', '@langchain/*', 'llamaindex',
    ],
    capabilities: ['gen_text'],
    because: 'A text-generation SDK or orchestration framework.',
  },
  {
    packages: ['elevenlabs', '@elevenlabs/*', 'playht', '@play-ai/*'],
    capabilities: ['gen_audio'],
    because: 'A speech-synthesis SDK: synthetic audio output.',
  },
  {
    packages: ['@stability-ai/*', 'stability-client', 'midjourney'],
    capabilities: ['gen_image'],
    because: 'An image-generation SDK.',
  },
  {
    packages: ['@runwayml/sdk', 'runwayml', 'lumaai'],
    capabilities: ['gen_video'],
    because: 'A video-generation SDK.',
  },
  {
    packages: [
      'face-api.js', '@vladmandic/face-api', '@tensorflow-models/face-landmarks-detection',
      '@tensorflow-models/face-detection', 'affectiva', 'morphcast',
    ],
    capabilities: ['emotion_biometric'],
    because: 'Facial analysis: emotion recognition or biometric categorisation of people.',
  },
  {
    packages: ['botpress', '@botpress/*', '@chatscope/chat-ui-kit-react', 'react-chatbot-kit', 'voiceflow', '@voiceflow/*'],
    capabilities: ['interaction'],
    because: 'A conversational interface people talk to directly.',
  },
];

export const ALL_RULES: PackageRule[] = [...MULTIMODAL_RULES, ...MODALITY_RULES];

/**
 * Call-site markers that RAISE a possible capability to likely.
 *
 * A dependency says the door exists. These say somebody walked through it.
 * Deliberately narrow: a false "likely" is worse than an honest "possible",
 * because "possible" invites a human to look and "likely" invites them not to.
 */
export interface CallSiteMarker {
  /** Source-text needle, matched case-insensitively. */
  marker: string;
  capability: Capability;
  because: string;
}

export const CALL_SITE_MARKERS: CallSiteMarker[] = [
  { marker: '.images.generate', capability: 'gen_image', because: 'an image-generation call' },
  { marker: 'generateImage(', capability: 'gen_image', because: 'an image-generation call' },
  { marker: 'experimental_generateImage', capability: 'gen_image', because: 'an image-generation call' },
  { marker: '.audio.speech', capability: 'gen_audio', because: 'a speech-synthesis call' },
  { marker: 'textToSpeech', capability: 'gen_audio', because: 'a speech-synthesis call' },
  { marker: '.chat.completions', capability: 'gen_text', because: 'a chat-completion call' },
  { marker: 'generateText(', capability: 'gen_text', because: 'a text-generation call' },
  { marker: 'streamText(', capability: 'gen_text', because: 'a streamed text-generation call' },
  { marker: 'messages.create', capability: 'gen_text', because: 'a message-completion call' },
  { marker: 'generateVideo', capability: 'gen_video', because: 'a video-generation call' },
  { marker: 'detectFaces', capability: 'emotion_biometric', because: 'a facial-analysis call' },
  { marker: 'faceExpressions', capability: 'emotion_biometric', because: 'an expression-analysis call' },
];

/**
 * Paths that suggest a human-facing conversational surface.
 *
 * Mirrors the CHAT_PATH_RE already in packages/cli/src/detect.ts. Interaction
 * is the hardest capability to infer from a repository: an LLM dependency says
 * nothing about whether a PERSON is on the other end, and Article 50(1) turns
 * entirely on that. So this stays `possible` no matter how many markers hit.
 */
export const INTERACTION_PATH_RE = /(chat|assistant|copilot|conversation|messenger|widget)/i;

/** Expand a rule's package list against one dependency name. */
export function ruleMatches(rule: PackageRule, dependency: string): boolean {
  return rule.packages.some((p) =>
    p.endsWith('*') ? dependency.startsWith(p.slice(0, -1)) : dependency === p,
  );
}

/**
 * Cross-ecosystem tokens, matched as lowercase substrings against the RAW TEXT
 * of any manifest or CI file.
 *
 * Carried over from packages/cli/src/detect.ts, which read Python, Go, Rust,
 * Java, .NET and PHP manifests while the first version of this engine parsed
 * package.json and nothing else. Converging the CLI onto a JS-only scanner
 * would have been a downgrade dressed as a refactor, so the coverage moves here
 * first and the CLI follows.
 *
 * Substring matching rather than per-format parsing is deliberate: dependency
 * identifiers appear verbatim in every one of these formats (`go-openai`,
 * `langchain4j`, `openai-php`, `Azure.AI.OpenAI`), so one scan covers six
 * ecosystems without six parsers to keep correct.
 */
export interface TokenRule {
  tokens: string[];
  capabilities: Capability[];
  because: string;
}

export const TOKEN_RULES: TokenRule[] = [
  {
    // Providers whose SDKs span modalities: the same ambiguity as `openai` in
    // MULTIMODAL_RULES, and graded the same way.
    tokens: ['openai', 'azure.ai.openai', 'generativeai', 'generative-ai', 'gemini', 'vertexai', 'vertex-ai', 'replicate', 'huggingface'],
    capabilities: ['gen_text', 'gen_image', 'gen_audio'],
    because: 'A multi-modal model provider referenced in a manifest or CI file.',
  },
  {
    tokens: ['anthropic', 'claude', 'langchain', 'langchain4j', 'llamaindex', 'llama-index', 'llama_index', 'cohere', 'mistral', 'ollama', 'bedrock', 'semantic-kernel', 'transformers'],
    capabilities: ['gen_text'],
    because: 'A text-generation SDK or framework referenced in a manifest or CI file.',
  },
  {
    tokens: ['elevenlabs', 'playht', 'whisper.cpp', 'piper-tts'],
    capabilities: ['gen_audio'],
    because: 'A speech-synthesis dependency referenced in a manifest or CI file.',
  },
  {
    tokens: ['stable-diffusion', 'stablediffusion', 'comfyui', 'diffusers'],
    capabilities: ['gen_image'],
    because: 'An image-generation dependency referenced in a manifest or CI file.',
  },
  {
    tokens: ['deepface', 'face_recognition', 'face-recognition', 'mediapipe.face', 'affectiva'],
    capabilities: ['emotion_biometric'],
    because: 'A facial-analysis dependency referenced in a manifest or CI file.',
  },
];

/**
 * Manifests in ecosystems other than npm, plus the CI and container files where
 * a model endpoint often appears when no manifest names it.
 */
export const TEXT_SCANNED_FILES = [
  // Python
  /(^|\/)requirements[^/]*\.txt$/i,
  /(^|\/)pyproject\.toml$/i,
  /(^|\/)Pipfile$/i,
  // Go, Rust, Ruby, PHP, Java, .NET
  /(^|\/)go\.mod$/i,
  /(^|\/)Cargo\.toml$/i,
  /(^|\/)Gemfile$/i,
  /(^|\/)composer\.json$/i,
  /(^|\/)pom\.xml$/i,
  /(^|\/)build\.gradle(\.kts)?$/i,
  /\.csproj$/i,
  // CI and containers
  /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i,
  /(^|\/)Dockerfile(\.[^/]+)?$/i,
  /(^|\/)docker-compose(\.[^/]+)?\.ya?ml$/i,
];

export function isTextScanned(path: string): boolean {
  return TEXT_SCANNED_FILES.some((re) => re.test(path));
}
