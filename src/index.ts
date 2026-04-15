import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { GameRoom, Player } from './types';
import { categories, questions } from './mockData';

dotenv.config();

const PORT = process.env.PORT || 2999;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const app = express();
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
  },
});

// All active rooms keyed by room code
const rooms: Record<string, GameRoom> = {};

// Generate a unique 6-character alphanumeric code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

function emitRoomState(room: GameRoom) {
  const base = {
    code: room.code,
    gameState: room.gameState,
    isAnswerEnabled: room.isAnswerEnabled,
    timer: room.timer,
    players: room.players,
    categories,
    hotSeatPlayerId: room.hotSeatPlayerId,
    explanationPlayerId: room.explanationPlayerId,
    explanationPlayerAnswer: room.explanationPlayerAnswer,
    hotSeatVotes: room.hotSeatVotes,
    expectatorCount: room.expectators.size,
    usedCategories: room.usedCategories,
    usedQuestionIds: room.usedQuestionIds,
  };

  // Full question (with correctAnswer + explanation) is shown only AFTER explanation: reveal + scoreboard
  const showFullQuestion = room.gameState === 'reveal' || room.gameState === 'scoreboard';

  // Sanitized question (no correct answer / explanation) for everyone during question phase
  const sanitizedQuestion = room.currentQuestion
    ? { ...room.currentQuestion, correctAnswer: '', explanation: '' }
    : null;

  const questionForAll = showFullQuestion ? room.currentQuestion : sanitizedQuestion;

  // Broadcast to the whole room (participants, expectators, presenter)
  io.to(room.code).emit('game:state', { ...base, currentQuestion: questionForAll });

  // Presenter always gets full question regardless of state
  if (room.currentQuestion && !showFullQuestion) {
    io.to(room.presenterSocketId).emit('game:state', {
      ...base,
      currentQuestion: room.currentQuestion,
    });
  }
}

function startTimer(room: GameRoom, seconds = 10) {
  if (room.timerInterval) clearInterval(room.timerInterval);
  room.timer = seconds;

  room.timerInterval = setInterval(() => {
    if (room.timer > 0) {
      room.timer -= 1;
      io.to(room.code).emit('timer:tick', room.timer);
    } else {
      if (room.timerInterval) clearInterval(room.timerInterval);
    }
  }, 1000);
}

// REST health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: Object.keys(rooms) });
});

// Socket.IO events
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // ── PRESENTER: create a new room ────────────────────────────────────────────
  socket.on('presenter:create_room', () => {
    const code = generateRoomCode();
    const room: GameRoom = {
      code,
      presenterSocketId: socket.id,
      gameState: 'lobby',
      currentQuestion: null,
      isAnswerEnabled: false,
      timer: 0,
      players: {},
      expectators: new Set(),
      timerInterval: null,
      hotSeatPlayerId: null,
      explanationPlayerId: null,
      explanationPlayerAnswer: null,
      hotSeatVotes: {},
      usedCategories: [],
      usedQuestionIds: [],
    };
    rooms[code] = room;
    socket.join(code);
    console.log(`Room created: ${code} by presenter ${socket.id}`);
    socket.emit('room:created', { code });
    emitRoomState(room);
  });

  // ── PARTICIPANT: join an existing room ───────────────────────────────────────
  socket.on('player:join_room', (data: { code: string; name: string; avatar: string }) => {
    const room = rooms[data.code.toUpperCase()];
    if (!room) {
      socket.emit('room:error', { message: 'Sala não encontrada. Verifique o código.' });
      return;
    }
    if (room.gameState !== 'lobby') {
      socket.emit('room:error', { message: 'Esta sala já iniciou o jogo.' });
      return;
    }

    const player: Player = {
      id: socket.id,
      name: data.name,
      avatar: data.avatar,
      score: 0,
      selectedAnswer: null,
      totalVotes: 0,
      correctVotes: 0,
    };
    room.players[socket.id] = player;
    socket.join(data.code.toUpperCase());
    console.log(`Player ${data.name} joined room ${data.code}`);
    socket.emit('room:joined', { code: room.code });
    emitRoomState(room);
  });

  // ── EXPECTATOR: join an existing room (read-only, not counted as player) ────
  socket.on('expectator:join_room', (data: { code: string }) => {
    const room = rooms[data.code.toUpperCase()];
    if (!room) {
      socket.emit('room:error', { message: 'Sala não encontrada. Verifique o código.' });
      return;
    }
    room.expectators.add(socket.id);
    socket.join(data.code.toUpperCase());
    console.log(`Expectator ${socket.id} joined room ${data.code}`);
    socket.emit('room:joined', { code: room.code });
    emitRoomState(room);
  });

  // ── PRESENTER: set hot seat (berlinda) player ────────────────────────────────
  // Can be called from lobby state; can also be updated between rounds.
  socket.on('presenter:set_hot_seat', (data: { code: string; playerId: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    if (!room.players[data.playerId]) return;
    room.hotSeatPlayerId = data.playerId;
    emitRoomState(room);
  });

  // ── PARTICIPANT (berlinda only): select category ──────────────────────────────
  socket.on('player:select_category', (data: { code: string; categoryId: string }) => {
    const room = rooms[data.code];
    if (!room) return;
    // Only the hot seat player can select the category
    if (room.hotSeatPlayerId && room.hotSeatPlayerId !== socket.id) return;
    // Block already-used categories
    if (room.usedCategories.includes(data.categoryId)) return;
    // Difficulty = current round number (1-based), capped at 10
    const targetDifficulty = Math.min(room.usedCategories.length + 1, 10);
    // Pick the question for this category at the target difficulty, skipping already-used question IDs
    const question = questions.find(
      (q) => q.category === data.categoryId &&
             q.difficulty === targetDifficulty &&
             !room.usedQuestionIds.includes(q.id)
    ) ?? questions.find(
      // Fallback: any unused question for this category
      (q) => q.category === data.categoryId && !room.usedQuestionIds.includes(q.id)
    );
    if (question) {
      room.usedCategories.push(data.categoryId);
      room.usedQuestionIds.push(question.id);
      room.currentQuestion = question;
      room.gameState = 'question';
      room.isAnswerEnabled = false;
      room.timer = 0;
      emitRoomState(room);
    }
  });

  // ── PARTICIPANT (berlinda only): submit answer ────────────────────────────────
  // Only the hot seat player answers. Others watch.
  socket.on('player:submit_answer', (data: { code: string; answer: string }) => {
    const room = rooms[data.code];
    if (!room || !room.isAnswerEnabled) return;
    // Only berlinda submits; guard so other players cannot sneak answers in
    if (room.hotSeatPlayerId && room.hotSeatPlayerId !== socket.id) return;
    if (room.players[socket.id] && room.currentQuestion) {
      room.players[socket.id].selectedAnswer = data.answer;
      const isCorrect = data.answer === room.currentQuestion.correctAnswer;

      // Private response: player learns only if they're right or wrong — correct answer NOT sent
      socket.emit('player:answer_received', {
        answer: data.answer,
        isCorrect,
      });

      // Broadcast player list update to whole room (presenter + expectators see answer status)
      io.to(room.code).emit('game:players_update', room.players);
    }
  });

  // ── PRESENTER: enable answers ────────────────────────────────────────────────
  socket.on('presenter:enable_answers', (data: { code: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    room.isAnswerEnabled = true;
    startTimer(room, 10);
    emitRoomState(room);
  });

  // ── PRESENTER: start explanation ──────────────────────────────────────────────
  // NEW FLOW: question → answer-reveal (presenter shows what berlinda chose)
  // Then answer-reveal → explanation (presenter starts the 45s timer)
  // We split this into two events: reveal_berlinda_answer and start_explanation.

  // FLOW: question → answer-reveal
  socket.on('presenter:reveal_berlinda_answer', (data: { code: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    if (room.gameState !== 'question') return;
    if (room.timerInterval) clearInterval(room.timerInterval);

    // Store berlinda's answer now (used in explanation, voting, scoreboard)
    const berlindaId = room.hotSeatPlayerId;
    if (berlindaId && room.players[berlindaId]) {
      room.explanationPlayerId = berlindaId;
      room.explanationPlayerAnswer = room.players[berlindaId].selectedAnswer ?? null;
    }

    room.gameState = 'answer-reveal';
    emitRoomState(room);
  });

  // FLOW: answer-reveal → explanation
  socket.on('presenter:start_explanation', (data: { code: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    if (room.gameState !== 'answer-reveal') return;
    room.gameState = 'explanation';
    startTimer(room, 45);
    emitRoomState(room);
  });

  // ── PARTICIPANT (non-berlinda): submit vote ───────────────────────────────────
  // FLOW: during 'voting' state, non-berlinda players vote 'lying' or 'truth'
  socket.on('player:submit_vote', (data: { code: string; vote: 'lying' | 'truth' }) => {
    const room = rooms[data.code];
    if (!room || room.gameState !== 'voting') return;
    // Berlinda cannot vote on their own round
    if (socket.id === room.hotSeatPlayerId) return;
    if (!room.players[socket.id]) return;
    room.hotSeatVotes[socket.id] = data.vote;
    // Broadcast updated votes to all (presenter/expectators can see who voted)
    io.to(room.code).emit('game:votes_update', room.hotSeatVotes);
  });

  // ── PRESENTER: open voting (explanation → voting) ────────────────────────────
  socket.on('presenter:start_voting', (data: { code: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    if (room.gameState !== 'explanation') return;
    if (room.timerInterval) clearInterval(room.timerInterval);
    room.gameState = 'voting';
    room.hotSeatVotes = {}; // clear any stale votes
    emitRoomState(room);
  });

  // ── PRESENTER: reveal answer (voting → reveal) ────────────────────────────────
  // Score berlinda + voters here.
  socket.on('presenter:reveal_answer', (data: { code: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    if (room.gameState !== 'voting') return;
    if (room.timerInterval) clearInterval(room.timerInterval);

    if (room.currentQuestion) {
      const berlindaId = room.hotSeatPlayerId;
      const correctAnswer = room.currentQuestion.correctAnswer;

      // Score berlinda: +1 if they answered correctly
      if (berlindaId && room.players[berlindaId]) {
        if (room.players[berlindaId].selectedAnswer === correctAnswer) {
          room.players[berlindaId].score += 1;
        }
      }

      // Score voters: +1 if their vote matches reality
      // berlinda answered correctly → they were telling the truth → correct vote is 'truth'
      // berlinda answered wrongly → they were lying → correct vote is 'lying'
      const berlindaWasCorrect = berlindaId && room.players[berlindaId]
        ? room.players[berlindaId].selectedAnswer === correctAnswer
        : false;
      const correctVote: 'lying' | 'truth' = berlindaWasCorrect ? 'truth' : 'lying';

      Object.entries(room.hotSeatVotes).forEach(([voterId, vote]) => {
        if (room.players[voterId]) {
          room.players[voterId].totalVotes += 1;
          if (vote === correctVote) {
            room.players[voterId].score += 1;
            room.players[voterId].correctVotes += 1;
          }
        }
      });
    }

    room.gameState = 'reveal';
    emitRoomState(room);
  });

  // ── PRESENTER: show scoreboard (reveal → scoreboard) ─────────────────────────
  socket.on('presenter:show_scoreboard', (data: { code: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    if (room.gameState !== 'reveal') return;
    room.gameState = 'scoreboard';
    emitRoomState(room);
  });

  // ── PRESENTER: next question ─────────────────────────────────────────────────
  socket.on('presenter:next_question', (data: { code: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    room.gameState = 'category-selection';
    room.currentQuestion = null;
    room.isAnswerEnabled = false;
    room.timer = 0;
    room.explanationPlayerId = null;
    room.explanationPlayerAnswer = null;
    room.hotSeatVotes = {};
    // hotSeatPlayerId persists — presenter can keep the same berlinda or change it
    Object.values(room.players).forEach((p) => { p.selectedAnswer = null; });
    emitRoomState(room);
  });

  // ── PRESENTER: start game ────────────────────────────────────────────────────
  socket.on('presenter:start_game', (data: { code: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    room.gameState = 'category-selection';
    emitRoomState(room);
  });

  // ── PRESENTER: kick player ────────────────────────────────────────────────────
  socket.on('presenter:kick_player', (data: { code: string; playerId: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    if (!room.players[data.playerId]) return;
    delete room.players[data.playerId];
    // Notify the kicked player so they can return to lobby screen
    io.to(data.playerId).emit('room:kicked', { message: 'Você foi removido da sala pelo apresentador.' });
    // Broadcast updated player list to everyone
    io.to(room.code).emit('game:players_update', room.players);
  });

  // ── PRESENTER: reset game ────────────────────────────────────────────────────
  socket.on('presenter:reset_game', (data: { code: string }) => {
    const room = rooms[data.code];
    if (!room || room.presenterSocketId !== socket.id) return;
    room.gameState = 'lobby';
    room.currentQuestion = null;
    room.isAnswerEnabled = false;
    room.timer = 0;
    room.hotSeatPlayerId = null;
    room.explanationPlayerId = null;
    room.explanationPlayerAnswer = null;
    room.hotSeatVotes = {};
    room.usedCategories = [];
    if (room.timerInterval) clearInterval(room.timerInterval);
    // Reset all player scores/votes but keep them in the room
    Object.values(room.players).forEach((p) => {
      p.score = 0;
      p.selectedAnswer = null;
      p.totalVotes = 0;
      p.correctVotes = 0;
    });
    emitRoomState(room);
  });

  // ── DISCONNECT ───────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);

    for (const code of Object.keys(rooms)) {
      const room = rooms[code];
      if (room.presenterSocketId === socket.id) {
        io.to(code).emit('room:closed', { message: 'O apresentador encerrou a sala.' });
        if (room.timerInterval) clearInterval(room.timerInterval);
        delete rooms[code];
        console.log(`Room ${code} closed (presenter left)`);
      } else if (room.players[socket.id]) {
        delete room.players[socket.id];
        // Broadcast sanitized players update to the whole room so expectators see the status change
        io.to(room.code).emit('game:players_update', room.players);
      } else if (room.expectators.has(socket.id)) {
        room.expectators.delete(socket.id);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Accepting connections from: ${FRONTEND_URL}`);
});
