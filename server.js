'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  checkDiceBid,
  classifyDiceHand,
  rerollDice,
  validateBidTransition
} = require('./game-logic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const MAX_PLAYER = 4;
const CARD_TYPES = ['sun', 'moon', 'star'];
const ROOM_CODE = process.env.ROOM_CODE || String(Math.floor(1000 + Math.random() * 9000));

function emptyStats() {
  return {
    bids: 0,
    doubts: 0,
    successfulDoubts: 0,
    failedDoubts: 0,
    roulettePulls: 0,
    cardsPlayed: 0
  };
}

let gameState = {
  roomCode: ROOM_CODE,
  players: [],
  gameMode: null,
  currentBid: null,
  onesWild: true,
  lastBidAction: null,
  turnIndex: 0,
  gameOver: false,
  targetCard: null,
  lastPlay: null,
  eliminationCounter: 0
};

function buildDeck() {
  const deck = [];
  for (let index = 0; index < 6; index += 1) deck.push('sun', 'moon', 'star');
  deck.push('joker', 'joker', 'devil', 'devil');
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[target]] = [deck[target], deck[index]];
  }
  return deck;
}

function generateCardHand() {
  return buildDeck().slice(0, 5);
}

function aliveCount() {
  return gameState.players.filter((player) => player.alive).length;
}

function publicState() {
  return {
    roomCode: gameState.roomCode,
    gameMode: gameState.gameMode,
    currentBid: gameState.currentBid,
    onesWild: gameState.onesWild,
    lastBidAction: gameState.lastBidAction,
    turnIndex: gameState.turnIndex,
    gameOver: gameState.gameOver,
    targetCard: gameState.targetCard,
    lastPlay: gameState.lastPlay ? { playerIdx: gameState.lastPlay.playerIdx, count: gameState.lastPlay.cards.length } : null,
    players: gameState.players.map((player) => ({
      id: player.id,
      name: player.name,
      alive: player.alive,
      diceCount: player.dice.length,
      cardCount: player.cards.length
    }))
  };
}

function emitState() {
  io.emit('state', publicState());
}

function privateSocket(player) {
  return io.sockets.sockets.get(player.id);
}

function nextAliveIdx(fromIndex) {
  const total = gameState.players.length;
  if (!total) return -1;
  let index = ((fromIndex + 1) % total + total) % total;
  for (let step = 0; step < total; step += 1) {
    if (gameState.players[index].alive) return index;
    index = (index + 1) % total;
  }
  return -1;
}

function prevAliveIdx(fromIndex) {
  const total = gameState.players.length;
  if (!total) return -1;
  let index = ((fromIndex - 1) % total + total) % total;
  for (let step = 0; step < total; step += 1) {
    if (gameState.players[index].alive) return index;
    index = (index - 1 + total) % total;
  }
  return -1;
}

function nextTurn() {
  if (gameState.gameOver || aliveCount() <= 1) return;
  const next = nextAliveIdx(gameState.turnIndex);
  if (next >= 0) gameState.turnIndex = next;
}

function resetPlayersForMatch() {
  gameState.eliminationCounter = 0;
  gameState.players.forEach((player) => {
    player.alive = true;
    player.dice = [];
    player.cards = [];
    player.eliminatedAt = null;
    player.stats = emptyStats();
  });
}

function rankings() {
  const ordered = gameState.players.slice().sort((left, right) => {
    if (left.alive !== right.alive) return left.alive ? -1 : 1;
    if (!left.alive && left.eliminatedAt !== right.eliminatedAt) return (right.eliminatedAt || 0) - (left.eliminatedAt || 0);
    if (left.stats.successfulDoubts !== right.stats.successfulDoubts) return right.stats.successfulDoubts - left.stats.successfulDoubts;
    const leftActions = left.stats.bids + left.stats.cardsPlayed;
    const rightActions = right.stats.bids + right.stats.cardsPlayed;
    return rightActions - leftActions;
  });
  return ordered.map((player, index) => ({
    rank: index + 1,
    id: player.id,
    name: player.name,
    alive: player.alive,
    bids: player.stats.bids,
    cardsPlayed: player.stats.cardsPlayed,
    doubts: player.stats.doubts,
    successfulDoubts: player.stats.successfulDoubts,
    roulettePulls: player.stats.roulettePulls
  }));
}

function finishIfNeeded() {
  if (aliveCount() > 1) return false;
  if (!gameState.gameOver) {
    gameState.gameOver = true;
    const winner = gameState.players.find((player) => player.alive);
    io.emit('msg', winner ? `游戏结束，${winner.name} 获胜！` : '游戏结束，本局无人幸存。');
    io.emit('gameOver', { winnerId: winner ? winner.id : null, rankings: rankings() });
  }
  return true;
}

function roulette(victimIndex) {
  const victim = gameState.players[victimIndex];
  victim.stats.roulettePulls += 1;
  const isShot = Math.floor(Math.random() * 6) === 0;
  if (isShot && victim.alive) {
    victim.alive = false;
    gameState.eliminationCounter += 1;
    victim.eliminatedAt = gameState.eliminationCounter;
  }
  const result = { isShot, victimIdx: victimIndex, victimId: victim.id, victimName: victim.name };
  io.emit('rouletteResult', result);
  return result;
}

function startNewDiceRound(reason = 'start') {
  gameState.players = rerollDice(gameState.players);
  gameState.currentBid = null;
  gameState.onesWild = true;
  gameState.lastBidAction = null;
  gameState.players.forEach((player) => {
    if (!player.alive) return;
    const socket = privateSocket(player);
    if (socket) socket.emit('myDice', { dice: player.dice, reason });
  });
  io.emit('diceRoundStarted', { reason });
}

function startNewCardRound() {
  gameState.targetCard = CARD_TYPES[Math.floor(Math.random() * CARD_TYPES.length)];
  gameState.lastPlay = null;
  gameState.currentBid = null;
  gameState.players.forEach((player) => {
    if (player.alive) player.cards = generateCardHand();
  });
  io.emit('newCardRound', { target: gameState.targetCard });
  gameState.players.forEach((player) => {
    if (!player.alive) return;
    const socket = privateSocket(player);
    if (socket) socket.emit('myCards', player.cards);
  });
}

function checkCardPlay(playedCards, target) {
  const hasDevil = playedCards.includes('devil');
  if (hasDevil && playedCards.length !== 1) return { valid: false, reason: '恶魔牌只能单独打出' };
  if (hasDevil) return { valid: true, isDevil: true };
  const valid = playedCards.every((card) => card === target || card === 'joker');
  return valid ? { valid: true, isDevil: false } : { valid: false, reason: '手牌含有非目标牌' };
}

function resetToLobby() {
  gameState.gameMode = null;
  gameState.currentBid = null;
  gameState.onesWild = true;
  gameState.lastBidAction = null;
  gameState.turnIndex = 0;
  gameState.gameOver = false;
  gameState.targetCard = null;
  gameState.lastPlay = null;
  gameState.players.forEach((player) => {
    player.alive = true;
    player.dice = [];
    player.cards = [];
  });
}

io.on('connection', (socket) => {
  console.log('玩家连接', socket.id);

  socket.on('join', (name) => {
    if (gameState.gameMode) {
      socket.emit('msg', '对局进行中，请等待下一局。');
      return;
    }
    if (gameState.players.length >= MAX_PLAYER) {
      socket.emit('msg', '房间已满，最多 4 人。');
      return;
    }
    if (gameState.players.some((player) => player.id === socket.id)) return;
    const cleanName = String(name || '').trim().slice(0, 8) || '匿名';
    const player = {
      id: socket.id,
      name: cleanName,
      dice: [],
      cards: [],
      alive: true,
      eliminatedAt: null,
      stats: emptyStats()
    };
    gameState.players.push(player);
    socket.emit('joined', { id: socket.id, name: cleanName, roomCode: gameState.roomCode });
    io.emit('msg', `${cleanName} 加入游戏。`);
    emitState();
  });

  socket.on('startGame', (mode) => {
    if (mode !== 'dice' && mode !== 'card') return;
    if (!gameState.players.some((player) => player.id === socket.id)) return;
    if (gameState.players.length < 2) {
      socket.emit('msg', '至少 2 人才能开局。');
      return;
    }
    if (gameState.gameMode) {
      socket.emit('msg', '本局已经开始。');
      return;
    }

    resetPlayersForMatch();
    gameState.gameMode = mode;
    gameState.turnIndex = 0;
    gameState.gameOver = false;
    gameState.currentBid = null;
    gameState.onesWild = true;
    gameState.lastBidAction = null;
    gameState.lastPlay = null;
    gameState.targetCard = null;

    if (mode === 'dice') {
      startNewDiceRound('start');
      io.emit('msg', '骰子模式开始，每人获得 5 颗骰子。');
    } else {
      startNewCardRound();
      io.emit('msg', '卡牌模式开始。');
    }
    io.emit('gameStarted', { mode });
    emitState();
  });

  socket.on('bid', (quantity, face, action = 'normal') => {
    if (gameState.gameMode !== 'dice' || gameState.gameOver) return;
    const playerIndex = gameState.players.findIndex((player) => player.id === socket.id);
    if (playerIndex < 0 || playerIndex !== gameState.turnIndex) return;
    const player = gameState.players[playerIndex];
    if (!player.alive) return;
    quantity = Number.parseInt(quantity, 10);
    face = Number.parseInt(face, 10);
    if (quantity > 30) {
      socket.emit('msg', '报价数量不能超过 30。');
      return;
    }
    const validation = validateBidTransition(gameState.currentBid, {
      quantity,
      face,
      exact: action === 'exact',
      fly: action === 'fly'
    }, gameState.onesWild);
    if (!validation.valid) {
      socket.emit('msg', `报价不合法：${validation.reason}`);
      return;
    }

    gameState.currentBid = [quantity, face];
    gameState.onesWild = validation.nextOnesWild;
    gameState.lastBidAction = validation.transition;
    player.stats.bids += 1;
    const marker = validation.transition === 'fly' ? '（飞）' : validation.transition.includes('exact') ? '（摘）' : '';
    io.emit('msg', `${player.name} 报价：${quantity} 个 ${face}${marker}`);
    nextTurn();
    emitState();
  });

  socket.on('doubt', () => {
    if (gameState.gameMode !== 'dice' || gameState.gameOver || !gameState.currentBid) return;
    const playerIndex = gameState.players.findIndex((player) => player.id === socket.id);
    if (playerIndex < 0 || playerIndex !== gameState.turnIndex || !gameState.players[playerIndex].alive) return;

    const doubter = gameState.players[playerIndex];
    doubter.stats.doubts += 1;
    const [bidQuantity, bidFace] = gameState.currentBid;
    const result = checkDiceBid(gameState.players, bidQuantity, bidFace, gameState.onesWild);
    let victimIndex;
    if (result.valid) {
      victimIndex = playerIndex;
      doubter.stats.failedDoubts += 1;
      io.emit('msg', `${doubter.name} 质疑失败，实际计数为 ${result.total}。`);
    } else {
      victimIndex = prevAliveIdx(playerIndex);
      if (victimIndex < 0) return;
      doubter.stats.successfulDoubts += 1;
      io.emit('msg', `抓到骗子，实际只有 ${result.total} 个。`);
    }

    io.emit('diceReveal', {
      bid: gameState.currentBid.slice(),
      onesWild: gameState.onesWild,
      actualCount: result.total,
      valid: result.valid,
      players: gameState.players.filter((player) => player.alive).map((player) => {
        const classification = classifyDiceHand(player.dice);
        return {
          id: player.id,
          name: player.name,
          dice: player.dice.slice(),
          leopardType: classification.kind === 'real-leopard' ? 'real' : classification.kind === 'fake-leopard' ? 'fake' : null
        };
      })
    });

    const rouletteResult = roulette(victimIndex);
    io.emit('msg', rouletteResult.isShot ? `${rouletteResult.victimName} 中弹出局。` : `${rouletteResult.victimName} 扣下空枪，幸存。`);
    gameState.currentBid = null;
    if (!finishIfNeeded()) {
      nextTurn();
      startNewDiceRound('roulette');
      io.emit('msg', '轮盘结算完成，所有存活玩家已经重摇骰子。');
    }
    emitState();
  });

  socket.on('playCards', (cardList) => {
    if (gameState.gameMode !== 'card' || gameState.gameOver) return;
    const playerIndex = gameState.players.findIndex((player) => player.id === socket.id);
    if (playerIndex < 0 || playerIndex !== gameState.turnIndex) return;
    const player = gameState.players[playerIndex];
    if (!player.alive) return;
    if (!Array.isArray(cardList) || cardList.length < 1 || cardList.length > 3) {
      socket.emit('msg', '每次出牌 1–3 张，恶魔只能单出。');
      return;
    }
    const hand = player.cards.slice();
    for (const card of cardList) {
      const position = hand.indexOf(card);
      if (position < 0) {
        socket.emit('msg', '你手里没有这张牌。');
        return;
      }
      hand.splice(position, 1);
    }
    player.cards = hand;
    player.stats.cardsPlayed += cardList.length;
    gameState.lastPlay = { playerIdx: playerIndex, cards: cardList.slice() };
    socket.emit('myCards', player.cards);
    io.emit('msg', `${player.name} 暗着打出 ${cardList.length} 张牌，下家可继续出牌或质疑。`);
    nextTurn();
    emitState();
  });

  socket.on('doubtCard', () => {
    if (gameState.gameMode !== 'card' || gameState.gameOver || !gameState.lastPlay) return;
    const playerIndex = gameState.players.findIndex((player) => player.id === socket.id);
    if (playerIndex < 0 || playerIndex !== gameState.turnIndex || !gameState.players[playerIndex].alive) return;
    const doubter = gameState.players[playerIndex];
    const lastPlay = gameState.lastPlay;
    const lastPlayer = gameState.players[lastPlay.playerIdx];
    doubter.stats.doubts += 1;
    io.emit('revealCards', { playerIdx: lastPlay.playerIdx, cards: lastPlay.cards });
    const check = checkCardPlay(lastPlay.cards, gameState.targetCard);

    if (check.valid) {
      doubter.stats.failedDoubts += 1;
      if (check.isDevil) {
        io.emit('msg', '恶魔牌生效，除出牌者外的存活玩家依次扣动轮盘。');
        gameState.players.forEach((player, index) => {
          if (!player.alive || index === lastPlay.playerIdx) return;
          const result = roulette(index);
          io.emit('msg', result.isShot ? `${player.name} 中弹出局。` : `${player.name} 扣下空枪，幸存。`);
        });
      } else {
        io.emit('msg', `出牌属实，${doubter.name} 质疑失败。`);
        const result = roulette(playerIndex);
        io.emit('msg', result.isShot ? `${doubter.name} 中弹出局。` : `${doubter.name} 扣下空枪，幸存。`);
      }
    } else {
      doubter.stats.successfulDoubts += 1;
      io.emit('msg', `${lastPlayer.name} 撒谎，被质疑成功。`);
      const result = roulette(lastPlay.playerIdx);
      io.emit('msg', result.isShot ? `${lastPlayer.name} 中弹出局。` : `${lastPlayer.name} 扣下空枪，幸存。`);
    }

    if (!finishIfNeeded()) {
      startNewCardRound();
      io.emit('msg', '新一轮已经发牌，目标牌已更新。');
    }
    emitState();
  });

  socket.on('returnLobby', () => {
    if (!gameState.gameOver || !gameState.players.some((player) => player.id === socket.id)) return;
    resetToLobby();
    io.emit('returnedToLobby');
    io.emit('msg', '已返回大厅，可以开始下一局。');
    emitState();
  });

  socket.on('disconnect', () => {
    const playerIndex = gameState.players.findIndex((player) => player.id === socket.id);
    if (playerIndex < 0) return;
    const playerName = gameState.players[playerIndex].name;
    const removedCurrent = playerIndex === gameState.turnIndex;
    gameState.players.splice(playerIndex, 1);

    if (!gameState.players.length) {
      resetToLobby();
      emitState();
      return;
    }
    if (gameState.lastPlay) {
      if (gameState.lastPlay.playerIdx === playerIndex) gameState.lastPlay = null;
      else if (gameState.lastPlay.playerIdx > playerIndex) gameState.lastPlay.playerIdx -= 1;
    }
    if (gameState.turnIndex > playerIndex) gameState.turnIndex -= 1;
    if (gameState.turnIndex >= gameState.players.length) gameState.turnIndex = 0;
    if (removedCurrent && !gameState.gameOver) {
      gameState.turnIndex = ((gameState.turnIndex - 1) % gameState.players.length + gameState.players.length) % gameState.players.length;
      nextTurn();
    }
    io.emit('msg', `${playerName} 离开了房间。`);
    if (gameState.gameMode) finishIfNeeded();
    emitState();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('server run on port', PORT);
});
