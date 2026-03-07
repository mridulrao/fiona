type TranscriptEvent = {
  isFinal?: boolean;
  transcript?: string;
};

type BackchannelConfig = {
  fillers: string[];
  microPauseMs: number;
  cooldownMs: number;
  minWordsBeforeBackchannel: number;
  finalSuppressMs: number;
  enabled: boolean;
};

type BackchannelDeps = {
  say: (text: string) => unknown;
  now?: () => number;
  random?: () => number;
  logger?: (message: string) => void;
};

const DEFAULT_FILLERS = [
  'I see...',
  'Mm, yeah...',
  'Right...',
  'Hmm...',
  'Okay...',
  'Alright...',
];

const DEFAULT_CONFIG: BackchannelConfig = {
  fillers: DEFAULT_FILLERS,
  microPauseMs: 260,
  cooldownMs: 4500,
  minWordsBeforeBackchannel: 3,
  finalSuppressMs: 1200,
  enabled: true,
};

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFillers(value: string | undefined): string[] {
  if (!value) return DEFAULT_FILLERS;
  const parsed = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_FILLERS;
}

function createConfigFromEnv(): BackchannelConfig {
  const enabled = process.env.BACKCHANNEL_ENABLED !== 'false';
  return {
    enabled,
    fillers: parseFillers(process.env.BACKCHANNEL_FILLERS),
    microPauseMs: parseInteger(process.env.BACKCHANNEL_MICRO_PAUSE_MS, DEFAULT_CONFIG.microPauseMs),
    cooldownMs: parseInteger(process.env.BACKCHANNEL_COOLDOWN_MS, DEFAULT_CONFIG.cooldownMs),
    minWordsBeforeBackchannel: parseInteger(
      process.env.BACKCHANNEL_MIN_WORDS,
      DEFAULT_CONFIG.minWordsBeforeBackchannel,
    ),
    finalSuppressMs: parseInteger(
      process.env.BACKCHANNEL_FINAL_SUPPRESS_MS,
      DEFAULT_CONFIG.finalSuppressMs,
    ),
  };
}

export class BackchannelController {
  private readonly config: BackchannelConfig;
  private readonly say: (text: string) => unknown;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly logger: (message: string) => void;

  private lastInterimAt = 0;
  private lastFinalAt = 0;
  private lastBackchannelAt = 0;
  private lastTranscript = '';
  private pauseTimer: NodeJS.Timeout | null = null;
  private emitInFlight = false;

  constructor(deps: BackchannelDeps, config?: Partial<BackchannelConfig>) {
    this.config = { ...createConfigFromEnv(), ...config };
    this.say = deps.say;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.logger = deps.logger ?? (() => undefined);
  }

  onTranscript(event: TranscriptEvent): void {
    if (!this.config.enabled) return;

    const transcript = (event.transcript ?? '').trim();
    if (!transcript) return;

    if (event.isFinal) {
      this.lastFinalAt = this.now();
      this.lastTranscript = transcript;
      this.clearPauseTimer();
      return;
    }

    this.lastInterimAt = this.now();
    this.lastTranscript = transcript;

    this.clearPauseTimer();
    this.pauseTimer = setTimeout(() => {
      void this.maybeEmitBackchannel();
    }, this.config.microPauseMs);
  }

  dispose(): void {
    this.clearPauseTimer();
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
    }
  }

  private wordCount(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
  }

  private pickFiller(): string {
    const index = Math.floor(this.random() * this.config.fillers.length);
    return this.config.fillers[index] ?? DEFAULT_FILLERS[0];
  }

  private async maybeEmitBackchannel(): Promise<void> {
    const now = this.now();
    const sinceInterim = now - this.lastInterimAt;
    const sinceFinal = now - this.lastFinalAt;
    const sinceBackchannel = now - this.lastBackchannelAt;

    if (this.emitInFlight) return;
    if (sinceInterim < this.config.microPauseMs) return;
    if (sinceFinal < this.config.finalSuppressMs) return;
    if (sinceBackchannel < this.config.cooldownMs) return;
    if (this.wordCount(this.lastTranscript) < this.config.minWordsBeforeBackchannel) return;

    const filler = this.pickFiller();
    this.emitInFlight = true;

    try {
      await Promise.resolve(this.say(filler));
      this.lastBackchannelAt = this.now();
      this.logger(`Backchannel emitted: "${filler}"`);
    } catch (error) {
      this.logger(`Backchannel emit failed: ${String(error)}`);
    } finally {
      this.emitInFlight = false;
    }
  }
}

