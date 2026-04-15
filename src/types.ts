export interface Category {
  id: string;
  name: string;
  icon: string;
}

export interface Question {
  id: number;
  category: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

export type GameState = 'lobby' | 'category-selection' | 'question' | 'answer-reveal' | 'explanation' | 'voting' | 'reveal' | 'scoreboard' | 'finished';

export interface Player {
  id: string;
  name: string;
  avatar: string;
  score: number;
  selectedAnswer: string | null;
}

export interface GameRoom {
  code: string;
  presenterSocketId: string;
  gameState: GameState;
  currentQuestion: Question | null;
  isAnswerEnabled: boolean;
  timer: number;
  players: Record<string, Player>;
  expectators: Set<string>;
  timerInterval: ReturnType<typeof setInterval> | null;
  /** Socket ID of the berlinda (hot seat) player for this round */
  hotSeatPlayerId: string | null;
  /** Socket ID of the player currently giving their explanation (same as hotSeatPlayerId in new flow) */
  explanationPlayerId: string | null;
  /** The answer submitted by the explanation player (stored at start_explanation time) */
  explanationPlayerAnswer: string | null;
  /** Votes from non-berlinda players: playerId → 'lying' | 'truth' */
  hotSeatVotes: Record<string, 'lying' | 'truth'>;
}
