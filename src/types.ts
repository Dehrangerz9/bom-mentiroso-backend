export interface Category {
  id: string;
  name: string;
  icon: string;
}

export interface Question {
  id: string;
  category: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: number; // 1–10
}

export type GameState = 'lobby' | 'category-selection' | 'question' | 'answer-reveal' | 'explanation' | 'voting' | 'reveal' | 'scoreboard' | 'finished';

export interface Player {
  id: string;
  name: string;
  avatar: string;
  score: number;
  selectedAnswer: string | null;
  /** Total rounds this player participated as a voter (not berlinda) */
  totalVotes: number;
  /** Total rounds this player guessed correctly (lying/truth) */
  correctVotes: number;
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
  /** Categories already selected in this game (no repeats allowed) */
  usedCategories: string[];
  /** IDs of questions already used across all rounds, including after resets (no question repeats in a session) */
  usedQuestionIds: string[];
}
