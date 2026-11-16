const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');

// Regras de Fichas
const DEFAULT_START_CHIPS = 50000; // Contas normais começam com 50.000
const USER_VIP_CHIPS = 100000000000; // Conta especial (100 bilhões / infinitas)
const BONUS_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 horas
const BONUS_AMOUNT = 10000; // +10.000 a cada 4 horas

// ==========================================
// Persistência de Contas e Senhas
// ==========================================
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
      const normalized = {};
      for (const [key, acc] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();
        if (!acc.salt) {
          acc.salt = crypto.randomBytes(16).toString('hex');
          acc.passwordHash = hashPassword('123456', acc.salt);
        }
        if (!acc.lastBonusClaim) acc.lastBonusClaim = 0;

        // Se for a conta do usuário (Gabriel), garante as 100 bilhões de fichas
        if (lowerKey === 'gabriel') {
          acc.bankroll = USER_VIP_CHIPS;
        }

        normalized[lowerKey] = acc;
      }
      return normalized;
    }
  } catch (e) {
    console.error('Erro ao ler contas:', e);
  }

  const defaultAccounts = {};
  const salt1 = crypto.randomBytes(16).toString('hex');
  defaultAccounts['gabriel'] = {
    username: 'Gabriel',
    avatar: '🦁',
    salt: salt1,
    passwordHash: hashPassword('123456', salt1),
    bankroll: USER_VIP_CHIPS,
    lastBonusClaim: 0,
    handsWon: 0,
    handsPlayed: 0
  };
  return defaultAccounts;
}

const accounts = loadAccounts();

function saveAccounts() {
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf8');
  } catch (e) {
    console.error('Erro ao salvar contas:', e);
  }
}

// Tokens de sessão em memória
const sessionTokens = new Map();

// ==========================================
// Servidor HTTP Estático
// ==========================================
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(PUBLIC_DIR, reqPath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Não Encontrado');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

const wss = new WebSocketServer({ server });

// ==========================================
// Baralho 100% Aleatório (Criptograficamente Seguro)
// ==========================================
const SUITS = [
  { symbol: '♠', color: 'black' },
  { symbol: '♥', color: 'red' },
  { symbol: '♦', color: 'red' },
  { symbol: '♣', color: 'black' }
];

const RANKS = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9' },
  { value: 10, label: '10' },
  { value: 11, label: 'J' },
  { value: 12, label: 'Q' },
  { value: 13, label: 'K' },
  { value: 14, label: 'A' }
];

const HAND_NAMES = {
  9: 'Straight Flush',
  8: 'Quadra',
  7: 'Full House',
  6: 'Flush',
  5: 'Sequência',
  4: 'Trinca',
  3: 'Dois Pares',
  2: 'Um Par',
  1: 'Carta Alta'
};

function createCryptoShuffledDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({
        value: r.value,
        rank: r.label,
        label: r.label,
        suit: s.symbol,
        color: s.color
      });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const head = arr[0];
  const tail = arr.slice(1);
  const withHead = getCombinations(tail, k - 1).map(c => [head, ...c]);
  const withoutHead = getCombinations(tail, k);
  return [...withHead, ...withoutHead];
}

function evaluate5Cards(cards) {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;

  const countPairs = Object.entries(counts).map(([val, cnt]) => ({
    val: Number(val),
    cnt
  })).sort((a, b) => b.cnt - a.cnt || b.val - a.val);

  let isStraight = false;
  let straightHigh = 0;
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 5) {
    if (uniqueValues[0] - uniqueValues[4] === 4) {
      isStraight = true;
      straightHigh = uniqueValues[0];
    } else if (
      uniqueValues[0] === 14 &&
      uniqueValues[1] === 5 &&
      uniqueValues[2] === 4 &&
      uniqueValues[3] === 3 &&
      uniqueValues[4] === 2
    ) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  if (isFlush && isStraight) return [9, straightHigh];
  if (countPairs[0].cnt === 4) return [8, countPairs[0].val, countPairs[1].val];
  if (countPairs[0].cnt === 3 && countPairs[1].cnt === 2) return [7, countPairs[0].val, countPairs[1].val];
  if (isFlush) return [6, ...values];
  if (isStraight) return [5, straightHigh];
  if (countPairs[0].cnt === 3) return [4, countPairs[0].val, countPairs[1].val, countPairs[2].val];
  if (countPairs[0].cnt === 2 && countPairs[1].cnt === 2) return [3, countPairs[0].val, countPairs[1].val, countPairs[2].val];
  if (countPairs[0].cnt === 2) return [2, countPairs[0].val, ...countPairs.slice(1).map(p => p.val)];
  return [1, ...values];
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const valA = a[i] || 0;
    const valB = b[i] || 0;
    if (valA !== valB) return valA - valB;
  }
  return 0;
}

function getBestHand(allCards) {
  if (allCards.length < 5) return null;
  const combos = getCombinations(allCards, 5);
  let best = null;
  for (const combo of combos) {
    const score = evaluate5Cards(combo);
    if (!best || compareScores(score, best.score) > 0) {
      best = { score, cards: combo, name: HAND_NAMES[score[0]] };
    }
  }
  return best;
}

// ==========================================
// Gerenciamento de Mesas MAXpoker
// ==========================================
const NUM_SEATS = 6;
const SMALL_BLIND = 100;
const BIG_BLIND = 200;
const BOT_NAMES = ['MAXBot Negreanu', 'MAXBot Ivey', 'MAXBot Antonius', 'MAXBot Brunson', 'MAXBot Cates', 'MAXBot Dwan'];
const BOT_AVATARS = ['🤖', '🦾', '👾', '🎩', '🐺', '🦊'];

const rooms = new Map();
const clients = new Map(); // ws => { id, username, roomId, seatIndex }

function createRoom(options = {}) {
  const roomId = options.id || 'room_' + Math.random().toString(36).substring(2, 8);
  const roomName = options.name || 'Mesa MAXpoker';
  const botDifficulty = options.botDifficulty || 'medium';
  const botSpeed = options.botSpeed || 'normal';
  const autoFillBots = options.autoFillBots !== undefined ? options.autoFillBots : true;

  const minBuyIn = Number(options.minBuyIn) || 4000;
  const maxBuyIn = Number(options.maxBuyIn) || 50000;
  const defaultBuyIn = Number(options.defaultBuyIn) || 10000;

  const room = {
    id: roomId,
    name: roomName,
    botDifficulty,
    botSpeed,
    autoFillBots,
    minBuyIn,
    maxBuyIn,
    defaultBuyIn,
    seats: Array(NUM_SEATS).fill(null),
    pot: 0,
    communityCards: [],
    deck: [],
    stage: 'waiting',
    dealerSeat: 0,
    currentTurnSeat: null,
    currentBet: 0,
    minRaise: BIG_BLIND,
    handInProgress: false,
    statusMsg: 'Mesa pronta! Escolha seu Buy-in para começar.',
    timer: null,
    botTimer: null
  };

  rooms.set(roomId, room);
  return room;
}

// Mesas pré-definidas com buy-ins proporcionais aos 50.000 / 100 bilhões
createRoom({
  id: 'mesa-iniciante',
  name: 'Mesa 1 - Iniciantes ($4.000 - $20.000)',
  botDifficulty: 'easy',
  botSpeed: 'slow',
  minBuyIn: 4000,
  maxBuyIn: 20000,
  defaultBuyIn: 10000,
  autoFillBots: true
});

createRoom({
  id: 'mesa-padrao',
  name: 'Mesa 2 - Regular ($10.000 - $50.000)',
  botDifficulty: 'medium',
  botSpeed: 'normal',
  minBuyIn: 10000,
  maxBuyIn: 50000,
  defaultBuyIn: 25000,
  autoFillBots: true
});

createRoom({
  id: 'mesa-highroller',
  name: 'Mesa 3 - High Roller VIP ($50.000 - $500.000)',
  botDifficulty: 'hard',
  botSpeed: 'normal',
  minBuyIn: 50000,
  maxBuyIn: 500000,
  defaultBuyIn: 100000,
  autoFillBots: true
});

// ==========================================
// Conexões WebSocket & Autenticação
// ==========================================
wss.on('connection', (ws) => {
  const clientId = 'user_' + Math.random().toString(36).substring(2, 9);
  clients.set(ws, { id: clientId, username: null, roomId: null, seatIndex: -1 });

  sendToClient(ws, {
    type: 'init',
    clientId,
    rooms: getRoomsSummary()
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleClientMessage(ws, msg);
    } catch (e) {
      console.error('Erro na mensagem do cliente:', e);
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client && client.roomId) {
      leaveCurrentRoom(ws);
    }
    clients.delete(ws);
    broadcastLobby();
  });
});

function getRoomsSummary() {
  const summary = [];
  for (const room of rooms.values()) {
    const humanCount = room.seats.filter(s => s && !s.isBot).length;
    const totalCount = room.seats.filter(s => s !== null).length;
    summary.push({
      id: room.id,
      name: room.name,
      botDifficulty: room.botDifficulty,
      botSpeed: room.botSpeed,
      autoFillBots: room.autoFillBots,
      minBuyIn: room.minBuyIn,
      maxBuyIn: room.maxBuyIn,
      defaultBuyIn: room.defaultBuyIn,
      humanCount,
      totalCount,
      maxSeats: NUM_SEATS
    });
  }
  return summary;
}

function broadcastLobby() {
  const summary = getRoomsSummary();
  for (const [ws, client] of clients.entries()) {
    if (!client.roomId) {
      sendToClient(ws, {
        type: 'lobbyUpdate',
        rooms: summary
      });
    }
  }
}

function sanitizeAccount(acc) {
  if (!acc) return null;
  return {
    username: acc.username,
    avatar: acc.avatar || '🦁',
    bankroll: acc.bankroll,
    lastBonusClaim: acc.lastBonusClaim || 0,
    handsWon: acc.handsWon || 0,
    handsPlayed: acc.handsPlayed || 0
  };
}

// Sentar jogador com Buy-in escolhido
function sitPlayerInRoom(room, client, targetSeatIndex = -1, requestedBuyIn = null) {
  if (!client.username) return { success: false, message: 'Faça login primeiro!' };
  const userKey = client.username.toLowerCase();
  const acc = accounts[userKey];
  if (!acc) return { success: false, message: 'Conta não encontrada.' };

  const minB = room.minBuyIn;
  const maxB = room.maxBuyIn;

  if (acc.bankroll < minB) {
    return { success: false, message: `Você precisa de pelo menos $${minB.toLocaleString('pt-BR')} fichas para entrar nesta mesa. Resgate o bônus ou escolha outra mesa!` };
  }

  let buyIn = requestedBuyIn !== null ? Number(requestedBuyIn) : room.defaultBuyIn;
  buyIn = Math.max(minB, Math.min(buyIn, maxB, acc.bankroll));

  // Se já estava em outro assento, devolve as fichas
  if (client.seatIndex !== -1 && room.seats[client.seatIndex]?.id === client.id) {
    acc.bankroll += room.seats[client.seatIndex].chips;
    room.seats[client.seatIndex] = null;
  }

  let seatIdx = targetSeatIndex;
  if (seatIdx < 0 || seatIdx >= NUM_SEATS || (room.seats[seatIdx] && !room.seats[seatIdx].isBot)) {
    if (!room.seats[0] || room.seats[0].isBot) {
      seatIdx = 0;
    } else {
      seatIdx = -1;
      for (let i = 0; i < NUM_SEATS; i++) {
        if (!room.seats[i] || room.seats[i].isBot) {
          seatIdx = i;
          break;
        }
      }
    }
  }

  if (seatIdx === -1) {
    return { success: false, message: 'A mesa está cheia de jogadores humanos!' };
  }

  acc.bankroll -= buyIn;
  saveAccounts();

  client.seatIndex = seatIdx;
  room.seats[seatIdx] = {
    id: client.id,
    username: acc.username,
    name: acc.username,
    avatar: acc.avatar || '🦁',
    chips: buyIn,
    isBot: false,
    cards: [],
    currentBet: 0,
    folded: false,
    isAllIn: false,
    lastAction: ''
  };

  return { success: true, seatIndex: seatIdx, buyIn };
}

function leaveCurrentRoom(ws) {
  const client = clients.get(ws);
  if (!client || !client.roomId) return;

  const room = rooms.get(client.roomId);
  if (room) {
    if (client.seatIndex !== -1 && room.seats[client.seatIndex]?.id === client.id) {
      const seat = room.seats[client.seatIndex];
      const acc = accounts[client.username.toLowerCase()];
      if (acc) {
        acc.bankroll += seat.chips;
        saveAccounts();
        sendToClient(ws, { type: 'accountUpdate', account: sanitizeAccount(acc) });
      }

      room.seats[client.seatIndex] = null;
      broadcastRoom(room, `${seat.name} saiu da mesa com $${seat.chips.toLocaleString('pt-BR')} fichas.`);
      checkGameContinuation(room);
    }
  }

  client.roomId = null;
  client.seatIndex = -1;
  broadcastLobby();
}

function handleClientMessage(ws, msg) {
  const client = clients.get(ws);
  if (!client) return;

  // 1. Cadastrar Conta (Username + Senha)
  if (msg.type === 'register') {
    const rawUser = (msg.username || '').trim();
    const rawPass = (msg.password || '').trim();
    const avatar = msg.avatar || '🦁';

    if (rawUser.length < 3) {
      sendToClient(ws, { type: 'authError', message: 'O nome de usuário deve ter pelo menos 3 caracteres.' });
      return;
    }
    if (rawPass.length < 4) {
      sendToClient(ws, { type: 'authError', message: 'A senha deve ter pelo menos 4 caracteres.' });
      return;
    }

    const key = rawUser.toLowerCase();
    if (accounts[key]) {
      sendToClient(ws, { type: 'authError', message: 'Este nome de usuário já existe. Faça login ou escolha outro nome!' });
      return;
    }

    // Se for o usuário especial "Gabriel", ganha 100 bilhões de fichas; senão, 50.000 fichas
    const startingChips = (key === 'gabriel') ? USER_VIP_CHIPS : DEFAULT_START_CHIPS;

    const salt = crypto.randomBytes(16).toString('hex');
    const newAcc = {
      username: rawUser,
      avatar,
      salt,
      passwordHash: hashPassword(rawPass, salt),
      bankroll: startingChips,
      lastBonusClaim: 0,
      handsWon: 0,
      handsPlayed: 0
    };

    accounts[key] = newAcc;
    saveAccounts();

    const token = crypto.randomBytes(24).toString('hex');
    sessionTokens.set(token, key);
    client.username = rawUser;

    sendToClient(ws, {
      type: 'authSuccess',
      token,
      account: sanitizeAccount(newAcc)
    });
    broadcastLobby();
  }

  // 2. Login com Senha
  else if (msg.type === 'login') {
    const rawUser = (msg.username || '').trim();
    const rawPass = (msg.password || '').trim();
    const key = rawUser.toLowerCase();
    const acc = accounts[key];

    if (!acc) {
      sendToClient(ws, { type: 'authError', message: 'Usuário não encontrado. Clique em Cadastrar para criar sua conta!' });
      return;
    }

    const checkHash = hashPassword(rawPass, acc.salt);
    if (checkHash !== acc.passwordHash) {
      sendToClient(ws, { type: 'authError', message: 'Senha incorreta!' });
      return;
    }

    // Garante que se for a conta Gabriel, mantém as 100 bilhões
    if (key === 'gabriel' && acc.bankroll < USER_VIP_CHIPS) {
      acc.bankroll = USER_VIP_CHIPS;
      saveAccounts();
    }

    const token = crypto.randomBytes(24).toString('hex');
    sessionTokens.set(token, key);
    client.username = acc.username;

    sendToClient(ws, {
      type: 'authSuccess',
      token,
      account: sanitizeAccount(acc)
    });
    broadcastLobby();
  }

  // 3. Login Automático com Token
  else if (msg.type === 'tokenAuth') {
    const key = sessionTokens.get(msg.token);
    if (key && accounts[key]) {
      const acc = accounts[key];
      client.username = acc.username;
      sendToClient(ws, {
        type: 'authSuccess',
        token: msg.token,
        account: sanitizeAccount(acc)
      });
    } else {
      sendToClient(ws, { type: 'tokenExpired' });
    }
  }

  // 4. Logout
  else if (msg.type === 'logout') {
    if (client.roomId) leaveCurrentRoom(ws);
    client.username = null;
    sendToClient(ws, { type: 'loggedOut' });
  }

  // 5. Resgate de Bônus (+10.000 fichas a cada 4 horas)
  else if (msg.type === 'claimBonus') {
    if (!client.username) return;
    const key = client.username.toLowerCase();
    const acc = accounts[key];
    if (!acc) return;

    const now = Date.now();
    const lastClaim = acc.lastBonusClaim || 0;
    const elapsed = now - lastClaim;

    if (elapsed < BONUS_COOLDOWN_MS && acc.bankroll >= 2000) {
      const waitMinutes = Math.ceil((BONUS_COOLDOWN_MS - elapsed) / 60000);
      sendToClient(ws, {
        type: 'alert',
        message: `Bônus disponível em ${waitMinutes} minutos.`
      });
      return;
    }

    acc.bankroll += BONUS_AMOUNT;
    acc.lastBonusClaim = now;
    saveAccounts();

    sendToClient(ws, {
      type: 'accountUpdate',
      account: sanitizeAccount(acc)
    });
    sendToClient(ws, {
      type: 'alert',
      message: `🎉 Bônus de +$${BONUS_AMOUNT.toLocaleString('pt-BR')} fichas adicionado com sucesso!`
    });
  }

  // 6. Criar Mesa com Buy-in Ajustável
  else if (msg.type === 'createRoom') {
    const minB = Math.max(BIG_BLIND * 10, Number(msg.minBuyIn) || 4000);
    const maxB = Math.max(minB * 2, Number(msg.maxBuyIn) || 50000);
    const defB = Math.min(maxB, Math.max(minB, Number(msg.defaultBuyIn) || (minB + maxB) / 2));

    const newRoom = createRoom({
      name: msg.name || 'Mesa MAXpoker',
      botDifficulty: msg.botDifficulty || 'medium',
      botSpeed: msg.botSpeed || 'normal',
      autoFillBots: !!msg.autoFillBots,
      minBuyIn: minB,
      maxBuyIn: maxB,
      defaultBuyIn: defB
    });
    broadcastLobby();
    joinRoom(ws, newRoom.id, Number(msg.playerBuyIn) || defB);
  }

  // 7. Entrar na Mesa com Buy-in
  else if (msg.type === 'joinRoom') {
    joinRoom(ws, msg.roomId, Number(msg.buyInAmount));
  }

  // 8. Sair da Mesa
  else if (msg.type === 'leaveRoom') {
    leaveCurrentRoom(ws);
    sendToClient(ws, { type: 'leftRoom', rooms: getRoomsSummary() });
  }

  // 9. Sentar
  else if (msg.type === 'sit') {
    if (!client.roomId) return;
    const room = rooms.get(client.roomId);
    if (!room) return;

    const res = sitPlayerInRoom(room, client, msg.seatIndex, msg.buyIn);
    if (!res.success) {
      sendToClient(ws, { type: 'alert', message: res.message });
      return;
    }

    const acc = accounts[client.username.toLowerCase()];
    sendToClient(ws, { type: 'accountUpdate', account: sanitizeAccount(acc) });
    broadcastRoom(room, `${acc.username} sentou com $${res.buyIn.toLocaleString('pt-BR')} fichas.`);
    checkGameStart(room);
    broadcastLobby();
  }

  // 10. Ações de Jogo
  else if (msg.type === 'action') {
    if (!client.roomId) return;
    const room = rooms.get(client.roomId);
    if (room && room.currentTurnSeat === client.seatIndex) {
      handlePlayerAction(room, client.seatIndex, msg.action, msg.amount);
    }
  }
}

function joinRoom(ws, roomId, buyInAmount = null) {
  const client = clients.get(ws);
  if (!client) return;

  const room = rooms.get(roomId);
  if (!room) {
    sendToClient(ws, { type: 'alert', message: 'Mesa não encontrada.' });
    return;
  }

  client.roomId = roomId;

  const sitRes = sitPlayerInRoom(room, client, -1, buyInAmount);
  if (!sitRes.success) {
    sendToClient(ws, { type: 'alert', message: sitRes.message });
    return;
  }

  sendToClient(ws, {
    type: 'joinedRoom',
    roomId: room.id,
    table: getSanitizedTable(room, client.id)
  });

  const acc = accounts[client.username.toLowerCase()];
  if (acc) {
    sendToClient(ws, { type: 'accountUpdate', account: sanitizeAccount(acc) });
  }

  broadcastRoom(room, `${client.username} entrou na mesa!`);
  checkGameStart(room);
  broadcastLobby();
}

function fillBots(room) {
  if (room.handInProgress) return;
  let botIndex = 0;
  for (let i = 0; i < NUM_SEATS; i++) {
    if (!room.seats[i]) {
      const botName = BOT_NAMES[botIndex % BOT_NAMES.length];
      const botAvatar = BOT_AVATARS[botIndex % BOT_AVATARS.length];
      botIndex++;
      room.seats[i] = {
        id: 'bot_' + Math.random().toString(36).substring(2, 7),
        name: botName,
        avatar: botAvatar,
        chips: room.defaultBuyIn,
        isBot: true,
        cards: [],
        currentBet: 0,
        folded: false,
        isAllIn: false,
        lastAction: ''
      };
    }
  }
}

function removeBots(room) {
  if (room.handInProgress) return;
  for (let i = 0; i < NUM_SEATS; i++) {
    if (room.seats[i]?.isBot) {
      room.seats[i] = null;
    }
  }
}

function getSanitizedTable(room, clientId) {
  const showAll = room.stage === 'showdown';
  const seatsCopy = room.seats.map(seat => {
    if (!seat) return null;
    const isOwner = seat.id === clientId;
    return {
      id: seat.id,
      name: seat.name,
      avatar: seat.avatar || (seat.isBot ? '🤖' : '🦁'),
      chips: seat.chips,
      isBot: seat.isBot,
      currentBet: seat.currentBet,
      folded: seat.folded,
      isAllIn: seat.isAllIn,
      lastAction: seat.lastAction,
      cards: seat.cards.map(c => {
        if (showAll || isOwner) return c;
        return { hidden: true };
      })
    };
  });

  return {
    roomId: room.id,
    roomName: room.name,
    botDifficulty: room.botDifficulty,
    botSpeed: room.botSpeed,
    autoFillBots: room.autoFillBots,
    minBuyIn: room.minBuyIn,
    maxBuyIn: room.maxBuyIn,
    defaultBuyIn: room.defaultBuyIn,
    seats: seatsCopy,
    pot: room.pot,
    communityCards: room.communityCards,
    stage: room.stage,
    dealerSeat: room.dealerSeat,
    currentTurnSeat: room.currentTurnSeat,
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    handInProgress: room.handInProgress,
    statusMsg: room.statusMsg,
    lastWinners: room.lastWinners || null
  };
}

function broadcastRoom(room, statusMsg = null) {
  if (statusMsg) room.statusMsg = statusMsg;
  for (const [ws, client] of clients.entries()) {
    if (client.roomId === room.id) {
      sendToClient(ws, {
        type: 'tableUpdate',
        table: getSanitizedTable(room, client.id)
      });
    }
  }
}

function sendToClient(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ==========================================
// Mecânica do Texas Hold'em com Ritmo e Tempo
// ==========================================
function getSeatedPlayers(room) {
  return room.seats.map((s, idx) => ({ ...s, seatIndex: idx })).filter(s => s.id && s.chips > 0);
}

function nextSeat(room, index) {
  let count = 0;
  let curr = (index + 1) % NUM_SEATS;
  while (count < NUM_SEATS) {
    if (room.seats[curr] && room.seats[curr].chips > 0 && !room.seats[curr].folded) {
      return curr;
    }
    curr = (curr + 1) % NUM_SEATS;
    count++;
  }
  return -1;
}

function checkGameStart(room) {
  if (room.handInProgress) return;

  if (room.autoFillBots) {
    fillBots(room);
  }

  const seated = getSeatedPlayers(room);
  if (seated.length >= 2) {
    room.statusMsg = 'Embaralhando cartas...';
    broadcastRoom(room);
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
      if (!room.handInProgress && getSeatedPlayers(room).length >= 2) {
        startNewHand(room);
      }
    }, 2500);
  }
}

function checkGameContinuation(room) {
  const active = room.seats.filter(s => s && s.chips > 0 && !s.folded);
  if (active.length < 2 && room.handInProgress) {
    if (active.length === 1) {
      awardPot(room, active[0]);
    } else {
      endHand(room);
    }
  } else if (!room.handInProgress) {
    checkGameStart(room);
  }
}

function startNewHand(room) {
  room.handInProgress = true;
  room.deck = createCryptoShuffledDeck();
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 0;
  room.minRaise = BIG_BLIND;
  room.stage = 'preflop';
  room.lastWinners = null;

  // Rotação visual do botão de Dealer "D"
  const oldDealer = room.dealerSeat;
  room.dealerSeat = (room.dealerSeat + 1) % NUM_SEATS;
  while (!room.seats[room.dealerSeat] || room.seats[room.dealerSeat].chips <= 0) {
    room.dealerSeat = (room.dealerSeat + 1) % NUM_SEATS;
  }

  const seated = getSeatedPlayers(room);
  for (const s of seated) {
    const seat = room.seats[s.seatIndex];
    seat.cards = [room.deck.pop(), room.deck.pop()];
    seat.currentBet = 0;
    seat.folded = false;
    seat.isAllIn = false;
    seat.lastAction = '';

    if (!seat.isBot && accounts[seat.username.toLowerCase()]) {
      accounts[seat.username.toLowerCase()].handsPlayed++;
    }
  }
  saveAccounts();

  let sbSeat, bbSeat, firstActorSeat;
  if (seated.length === 2) {
    sbSeat = room.dealerSeat;
    bbSeat = nextSeat(room, room.dealerSeat);
    firstActorSeat = sbSeat;
  } else {
    sbSeat = nextSeat(room, room.dealerSeat);
    bbSeat = nextSeat(room, sbSeat);
    firstActorSeat = nextSeat(room, bbSeat);
  }

  postBet(room, sbSeat, SMALL_BLIND, `Small Blind ($${SMALL_BLIND})`);
  postBet(room, bbSeat, BIG_BLIND, `Big Blind ($${BIG_BLIND})`);
  room.currentBet = BIG_BLIND;

  room.currentTurnSeat = firstActorSeat;
  const dealerName = room.seats[room.dealerSeat]?.name || 'Jogador';
  room.statusMsg = `🔄 Botão de Dealer com ${dealerName}. Vez de ${room.seats[firstActorSeat].name}!`;
  broadcastRoom(room);

  triggerBotTurnIfNeeded(room);
}

function postBet(room, seatIdx, amount, actionName) {
  const seat = room.seats[seatIdx];
  if (!seat) return;
  const actual = Math.min(seat.chips, amount);
  seat.chips -= actual;
  seat.currentBet += actual;
  room.pot += actual;
  if (seat.chips === 0) seat.isAllIn = true;
  seat.lastAction = actionName;
}

function handlePlayerAction(room, seatIdx, action, raiseToAmount) {
  const seat = room.seats[seatIdx];
  if (!seat || room.currentTurnSeat !== seatIdx) return;

  const toCall = room.currentBet - seat.currentBet;

  if (action === 'fold') {
    seat.folded = true;
    seat.lastAction = 'Fold';
    broadcastRoom(room, `${seat.name} deu Fold.`);
  } else if (action === 'check') {
    if (toCall > 0) return;
    seat.lastAction = 'Check';
    broadcastRoom(room, `${seat.name} deu Check.`);
  } else if (action === 'call') {
    const pay = Math.min(toCall, seat.chips);
    seat.chips -= pay;
    seat.currentBet += pay;
    room.pot += pay;
    if (seat.chips === 0) seat.isAllIn = true;
    seat.lastAction = `Call $${pay.toLocaleString('pt-BR')}`;
    broadcastRoom(room, `${seat.name} pagou $${pay.toLocaleString('pt-BR')}.`);
  } else if (action === 'raise') {
    const targetTotal = Number(raiseToAmount) || (room.currentBet + room.minRaise);
    const added = targetTotal - seat.currentBet;
    const actualPay = Math.min(added, seat.chips);

    seat.chips -= actualPay;
    seat.currentBet += actualPay;
    room.pot += actualPay;
    if (seat.chips === 0) seat.isAllIn = true;

    if (seat.currentBet > room.currentBet) {
      room.minRaise = seat.currentBet - room.currentBet;
      room.currentBet = seat.currentBet;
    }
    seat.lastAction = `Raise $${seat.currentBet.toLocaleString('pt-BR')}`;
    broadcastRoom(room, `${seat.name} aumentou para $${seat.currentBet.toLocaleString('pt-BR')}.`);
  }

  const nonFolded = room.seats.filter(s => s && !s.folded && s.chips + s.currentBet > 0);
  if (nonFolded.length === 1) {
    awardPot(room, nonFolded[0]);
    return;
  }

  advanceTurn(room);
}

function advanceTurn(room) {
  const activeUnfolded = room.seats.filter(s => s && !s.folded);
  const eligibleToAct = activeUnfolded.filter(s => !s.isAllIn);

  const betsEqual = activeUnfolded.every(s => s.isAllIn || s.currentBet === room.currentBet);
  const allActed = activeUnfolded.every(s => s.lastAction !== '' || s.isAllIn);

  if ((betsEqual && allActed) || eligibleToAct.length <= 1) {
    // Pausa dramática para ver o final da rodada de apostas
    const streetPause = getStreetPauseDelay(room.botSpeed);
    setTimeout(() => {
      advanceStreet(room);
    }, streetPause);
    return;
  }

  const next = nextSeat(room, room.currentTurnSeat);
  room.currentTurnSeat = next;
  room.statusMsg = `Vez de ${room.seats[next].name}...`;
  broadcastRoom(room);

  triggerBotTurnIfNeeded(room);
}

function advanceStreet(room) {
  for (let i = 0; i < NUM_SEATS; i++) {
    if (room.seats[i]) {
      room.seats[i].currentBet = 0;
      room.seats[i].lastAction = '';
    }
  }
  room.currentBet = 0;
  room.minRaise = BIG_BLIND;

  if (room.stage === 'preflop') {
    room.stage = 'flop';
    room.deck.pop();
    room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    room.statusMsg = '🃏 Flop na mesa!';
  } else if (room.stage === 'flop') {
    room.stage = 'turn';
    room.deck.pop();
    room.communityCards.push(room.deck.pop());
    room.statusMsg = '🃏 Turn na mesa!';
  } else if (room.stage === 'turn') {
    room.stage = 'river';
    room.deck.pop();
    room.communityCards.push(room.deck.pop());
    room.statusMsg = '🃏 River na mesa!';
  } else if (room.stage === 'river') {
    resolveShowdown(room);
    return;
  }

  let firstActor = nextSeat(room, room.dealerSeat);
  room.currentTurnSeat = firstActor;
  broadcastRoom(room);

  triggerBotTurnIfNeeded(room);
}

function resolveShowdown(room) {
  room.stage = 'showdown';
  room.currentTurnSeat = null;

  const contenders = room.seats
    .map((s, idx) => ({ ...s, seatIndex: idx }))
    .filter(s => s && s.id && !s.folded);

  let bestScore = null;
  let winners = [];

  for (const p of contenders) {
    const full7 = [...p.cards, ...room.communityCards];
    const best = getBestHand(full7);
    p.evaluated = best;

    if (!bestScore) {
      bestScore = best.score;
      winners = [p];
    } else {
      const cmp = compareScores(best.score, bestScore);
      if (cmp > 0) {
        bestScore = best.score;
        winners = [p];
      } else if (cmp === 0) {
        winners.push(p);
      }
    }
  }

  const potWon = room.pot;
  if (winners.length === 1) {
    const win = winners[0];
    room.seats[win.seatIndex].chips += room.pot;
    room.statusMsg = `🏆 ${win.name} venceu $${potWon.toLocaleString('pt-BR')} com ${win.evaluated.name}!`;

    if (!win.isBot && accounts[win.username.toLowerCase()]) {
      accounts[win.username.toLowerCase()].handsWon++;
      saveAccounts();
    }
    room.lastWinners = [{
      seatIndex: win.seatIndex,
      name: win.name,
      amount: potWon,
      handName: win.evaluated.name
    }];
  } else {
    const share = Math.floor(room.pot / winners.length);
    const names = winners.map(w => w.name).join(', ');
    for (const w of winners) {
      room.seats[w.seatIndex].chips += share;
      if (!w.isBot && accounts[w.username.toLowerCase()]) {
        accounts[w.username.toLowerCase()].handsWon++;
      }
    }
    saveAccounts();
    room.statusMsg = `🤝 Pote dividido entre ${names} ($${share.toLocaleString('pt-BR')} cada) com ${winners[0].evaluated.name}!`;
    room.lastWinners = winners.map(w => ({
      seatIndex: w.seatIndex,
      name: w.name,
      amount: share,
      handName: w.evaluated.name
    }));
  }

  room.pot = 0;
  broadcastRoom(room);
  scheduleNextHand(room);
}

function awardPot(room, winner) {
  const seatIdx = room.seats.findIndex(s => s?.id === winner.id);
  const potWon = room.pot;
  if (seatIdx !== -1) {
    room.seats[seatIdx].chips += room.pot;
    room.statusMsg = `🏆 ${winner.name} venceu $${potWon.toLocaleString('pt-BR')} (todos desistiram)!`;
    if (!winner.isBot && accounts[winner.username.toLowerCase()]) {
      accounts[winner.username.toLowerCase()].handsWon++;
      saveAccounts();
    }
    room.lastWinners = [{
      seatIndex: seatIdx,
      name: winner.name,
      amount: potWon,
      handName: 'Todos deram fold'
    }];
    room.pot = 0;
  }
  endHand(room);
}

function endHand(room) {
  room.stage = 'showdown';
  room.currentTurnSeat = null;
  broadcastRoom(room);
  scheduleNextHand(room);
}

function scheduleNextHand(room) {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    room.handInProgress = false;
    room.stage = 'waiting';

    for (let i = 0; i < NUM_SEATS; i++) {
      if (room.seats[i] && room.seats[i].chips <= 0) {
        if (room.seats[i].isBot) {
          room.seats[i].chips = room.defaultBuyIn;
        } else {
          const acc = accounts[room.seats[i].username.toLowerCase()];
          if (acc && acc.bankroll >= room.defaultBuyIn) {
            acc.bankroll -= room.defaultBuyIn;
            room.seats[i].chips = room.defaultBuyIn;
            saveAccounts();
          } else {
            room.seats[i] = null;
          }
        }
      }
    }
    checkGameStart(room);
  }, 4500);
}

function getBotThinkingDelay(speed) {
  if (speed === 'slow') return 2400 + Math.random() * 1000;
  if (speed === 'fast') return 900 + Math.random() * 400;
  return 1800 + Math.random() * 800;
}

function getStreetPauseDelay(speed) {
  if (speed === 'slow') return 1800;
  if (speed === 'fast') return 800;
  return 1400;
}

function triggerBotTurnIfNeeded(room) {
  if (room.stage === 'showdown' || room.stage === 'waiting') return;
  const currentSeat = room.seats[room.currentTurnSeat];
  if (!currentSeat || !currentSeat.isBot) return;

  clearTimeout(room.botTimer);
  const delay = getBotThinkingDelay(room.botSpeed);

  room.botTimer = setTimeout(() => {
    if (room.currentTurnSeat === null) return;
    const bot = room.seats[room.currentTurnSeat];
    if (!bot || !bot.isBot) return;

    const toCall = room.currentBet - bot.currentBet;
    const botFull = [...bot.cards, ...room.communityCards];
    const best = botFull.length >= 5 ? getBestHand(botFull) : null;
    const tier = best ? best.score[0] : 1;
    const diff = room.botDifficulty || 'medium';

    if (diff === 'easy') {
      if (toCall === 0) {
        if (tier >= 3 && Math.random() > 0.6) {
          handlePlayerAction(room, room.currentTurnSeat, 'raise', room.currentBet + BIG_BLIND);
        } else {
          handlePlayerAction(room, room.currentTurnSeat, 'check');
        }
      } else {
        if (tier >= 2 && toCall <= BIG_BLIND * 2) {
          handlePlayerAction(room, room.currentTurnSeat, 'call');
        } else if (tier >= 3) {
          handlePlayerAction(room, room.currentTurnSeat, 'call');
        } else {
          handlePlayerAction(room, room.currentTurnSeat, 'fold');
        }
      }
    } else if (diff === 'hard') {
      if (toCall === 0) {
        if (tier >= 2 || Math.random() > 0.35) {
          const raiseSize = room.currentBet + BIG_BLIND * (Math.random() > 0.5 ? 2 : 1);
          handlePlayerAction(room, room.currentTurnSeat, 'raise', raiseSize);
        } else {
          handlePlayerAction(room, room.currentTurnSeat, 'check');
        }
      } else {
        if (tier >= 3) {
          if (Math.random() > 0.45) {
            handlePlayerAction(room, room.currentTurnSeat, 'raise', room.currentBet + BIG_BLIND * 3);
          } else {
            handlePlayerAction(room, room.currentTurnSeat, 'call');
          }
        } else if (tier === 2) {
          if (Math.random() > 0.75) {
            handlePlayerAction(room, room.currentTurnSeat, 'raise', room.currentBet + BIG_BLIND * 2);
          } else {
            handlePlayerAction(room, room.currentTurnSeat, 'call');
          }
        } else {
          if (toCall <= BIG_BLIND && Math.random() > 0.5) {
            handlePlayerAction(room, room.currentTurnSeat, 'call');
          } else if (Math.random() > 0.7) {
            handlePlayerAction(room, room.currentTurnSeat, 'raise', room.currentBet + BIG_BLIND * 2);
          } else {
            handlePlayerAction(room, room.currentTurnSeat, 'fold');
          }
        }
      }
    } else {
      if (toCall === 0) {
        if (tier >= 2 && Math.random() > 0.4) {
          handlePlayerAction(room, room.currentTurnSeat, 'raise', room.currentBet + BIG_BLIND);
        } else {
          handlePlayerAction(room, room.currentTurnSeat, 'check');
        }
      } else {
        if (tier >= 3) {
          if (Math.random() > 0.6 && room.stage !== 'river') {
            handlePlayerAction(room, room.currentTurnSeat, 'raise', room.currentBet + BIG_BLIND * 2);
          } else {
            handlePlayerAction(room, room.currentTurnSeat, 'call');
          }
        } else if (tier === 2) {
          handlePlayerAction(room, room.currentTurnSeat, 'call');
        } else {
          if (toCall <= BIG_BLIND * 2 && Math.random() > 0.4) {
            handlePlayerAction(room, room.currentTurnSeat, 'call');
          } else {
            handlePlayerAction(room, room.currentTurnSeat, 'fold');
          }
        }
      }
    }
  }, delay);
}

server.listen(PORT, () => {
  console.log(`♠ MAXpoker Server rodando em http://localhost:${PORT}`);
});
