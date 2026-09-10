const socket = io();
const $ = (id) => document.getElementById(id);
const elements = {
  joinScreen: $('joinScreen'), lobbyScreen: $('lobbyScreen'), gameScreen: $('gameScreen'),
  nameInput: $('nameInput'), roomInput: $('roomInput'), createBtn: $('createBtn'), joinBtn: $('joinBtn'), joinHint: $('joinHint'),
  lobbyInfo: $('lobbyInfo'), lobbyHint: $('lobbyHint'), lobbyRoomCode: $('lobbyRoomCode'), copyInviteBtn: $('copyInviteBtn'), leaveLobbyBtn: $('leaveLobbyBtn'), startDiceBtn: $('startDiceBtn'), startCardBtn: $('startCardBtn'), lobbySeats: $('lobbySeats'), seatPickerStatus: $('seatPickerStatus'),
  modeBadge: $('modeBadge'), roomInfo: $('roomInfo'), seats: $('seats'), centerLabel: $('centerLabel'),
  centerValue: $('centerValue'), turnInfo: $('turnInfo'), wildStatus: $('wildStatus'), returnLobbyBtn: $('returnLobbyBtn'),
  lastPlayPanel: $('lastPlayPanel'), lastPlayLabel: $('lastPlayLabel'), lastPlaySummary: $('lastPlaySummary'), lastPlayCards: $('lastPlayCards'),
  myName: $('myName'), myAreaLabel: $('myAreaLabel'), myDiceRow: $('myDiceRow'), myCardRow: $('myCardRow'), myEmptyTip: $('myEmptyTip'),
  diceControls: $('diceControls'), cardControls: $('cardControls'), diceHint: $('diceHint'), cardHint: $('cardHint'),
  cntSel: $('cntSel'), faceSel: $('faceSel'), exactBtn: $('exactBtn'), flyBtn: $('flyBtn'), bidBtn: $('bidBtn'), doubtBtn: $('doubtBtn'),
  playBtn: $('playBtn'), doubtCardBtn: $('doubtCardBtn'), log: $('log'), connectionState: $('connectionState'), roundReveal: $('roundReveal'),
  historyPanel: $('historyPanel'), historyRound: $('historyRound'), playHistory: $('playHistory'),
  rulesBtn: $('rulesBtn'), resultsBtn: $('resultsBtn'), rulesOverlay: $('rulesOverlay'), rulesCloseBtn: $('rulesCloseBtn'), rulesTitle: $('rulesTitle'), rulesBody: $('rulesBody'),
  leaderboardOverlay: $('leaderboardOverlay'), leaderboardCloseBtn: $('leaderboardCloseBtn'), leaderboardSummary: $('leaderboardSummary'), leaderboardList: $('leaderboardList'), leaderboardLobbyBtn: $('leaderboardLobbyBtn'), readyStatus: $('readyStatus'),
  rouletteOverlay: $('rouletteOverlay'), rouletteMechanism: $('rouletteMechanism'), rouletteCylinder: $('rouletteCylinder'), rouletteEyebrow: $('rouletteEyebrow'), rouletteName: $('rouletteName'), rouletteResult: $('rouletteResult'),
  quickChatPopover: $('quickChatPopover'), quickChatOptions: $('quickChatOptions'),
  appearanceBtn: $('appearanceBtn'), appearancePanel: $('appearancePanel'), bgColorInput: $('bgColorInput'), bgOpacityInput: $('bgOpacityInput'), bgOpacityOutput: $('bgOpacityOutput'), brightnessInput: $('brightnessInput'), brightnessOutput: $('brightnessOutput'), resetAppearanceBtn: $('resetAppearanceBtn'), leaveGameBtn: $('leaveGameBtn'),
  toastLayer: $('toastLayer')
};

let myId = null;
let myDice = [];
let myCards = [];
let selectedCards = [];
let state = null;
let joined = false;
let bidAction = 'normal';
let rulesInvoker = null;
let revealTimer = null;
let lastResults = null;
let myRoomId = '';
let myNameText = '';
let joinPending = false;
let joinTimer = null;
let rouletteQueue = [];
let rouletteAnimating = false;
let lastPlaySignature = '';
let lastCardReveal = null;
let cardRevealTimer = null;
let quickChatInvoker = null;
const seenQuickMessages = new Set();
const ROULETTE_TIMING = Object.freeze({
  spinStart: 700,
  lock: 3900,
  reveal: 4700,
  close: 9000,
  reducedSpinStart: 160,
  reducedLock: 620,
  reducedReveal: 980,
  reducedClose: 3200
});

function getDeviceId() {
  try {
    let value = localStorage.getItem('liars-device-id');
    if (!value) {
      value = `device-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      localStorage.setItem('liars-device-id', value);
    }
    return value;
  } catch (_) {
    return `device-${Math.random().toString(36).slice(2)}`;
  }
}
const deviceId = getDeviceId();
try { elements.nameInput.value = localStorage.getItem('liars-name') || ''; } catch (_) {}
const invitedRoom = new URLSearchParams(location.search).get('room');
if (invitedRoom) elements.roomInput.value = invitedRoom.replace(/\D/g, '').slice(0, 6);

const FACE_GLYPH = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' };
const cardIcon = (content) => `<svg class="card-symbol" viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;
const CARD_ICONS = {
  sun: cardIcon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'),
  moon: cardIcon('<path d="M19.6 15.3A8.2 8.2 0 0 1 8.7 4.4 8.3 8.3 0 1 0 19.6 15.3Z"/>'),
  star: cardIcon('<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>'),
  joker: cardIcon('<path d="M5 15h14l-1.2 5H6.2L5 15Z"/><path d="M6 15 4 7l5 3 3-6 3 6 5-3-2 8"/><circle cx="4" cy="6.5" r="1"/><circle cx="12" cy="3" r="1"/><circle cx="20" cy="6.5" r="1"/>'),
  devil: cardIcon('<path d="M7 8 4 4c-.6 3 .1 5.2 2.2 6.5M17 8l3-4c.6 3-.1 5.2-2.2 6.5"/><path d="M6 13a6 6 0 0 1 12 0v2a6 6 0 0 1-12 0v-2Z"/><path d="m9 13 1.5 1M15 13l-1.5 1M10 18h4"/>'),
  unknown: cardIcon('<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.4 2c-.9.5-1.2 1-1.2 2M12 17h.01"/>')
};
const CARD_BACK_MARK = cardIcon('<path d="M7 5h10v14H7z"/><path d="m9 8 3-2 3 2-3 2-3-2Zm0 5 3-2 3 2-3 2-3-2Zm0 3 3-2 3 2"/>');
const CARD_META = {
  sun: { cn: '太阳', icon: CARD_ICONS.sun }, moon: { cn: '月亮', icon: CARD_ICONS.moon }, star: { cn: '星星', icon: CARD_ICONS.star },
  joker: { cn: '魔术师', icon: CARD_ICONS.joker }, devil: { cn: '恶魔', icon: CARD_ICONS.devil }
};
const MODE_NAME = { dice: '骰子模式', card: '卡牌模式' };
const QUICK_CHAT_OPTIONS = [
  '开我啊', '你开他准没错！', '我说的是真的', '这把稳了', '别急，再想想',
  '😏', '🤨', '😂', '😈', '💀'
];
const SEAT_LAYOUTS = {
  1: [{ left:50, top:14 }],
  2: [{ left:50, top:14 }, { left:50, top:86 }],
  3: [{ left:50, top:14 }, { left:18, top:76 }, { left:82, top:76 }],
  4: [{ left:50, top:14 }, { left:84, top:50 }, { left:50, top:86 }, { left:16, top:50 }]
};
const RULES = {
  dice: `
    <ol>
      <li>每人持有 5 颗私密骰子，按顺序报出桌上某个点数的总数量；报价必须按当前规则递增。</li>
      <li><strong>普通状态</strong>下，1 可以代替 2–6 的任意点数。任何人都可以质疑上家的报价。</li>
      <li><strong>摘：</strong>喊 1 会自动摘；也可点“摘”喊其他点数。摘后 1 只代表 1。由普通报价转摘时，数量最低为上家的一半并向上取整。</li>
      <li><strong>飞：</strong>摘后想恢复 1 的百搭能力，必须点“飞”，喊 2–6 且数量至少是上家的两倍。</li>
      <li><strong>假豹子：</strong>2–4 颗相同的非 1 点数，其余全是 1，该相同点数按 6 个计算。<strong>真豹子：</strong>5 颗完全相同，该点数按 7 个计算。</li>
      <li>质疑后，报价不足则上家扣动轮盘，否则质疑者扣动轮盘。<strong>每次轮盘结算后，只要对局未结束，所有存活玩家立即重摇骰子。</strong></li>
    </ol><div class="rules-foot">点击面板外空白处、右上角关闭按钮或按 Esc 返回对局。</div>`,
  card: `
    <ol>
      <li>牌库由 6 张太阳、6 张月亮、6 张星星和 2 张魔术师组成；每小轮随机用 1 张恶魔替换其中 1 张普通图案牌。</li>
      <li>每轮会指定太阳、月亮或星星为目标牌；魔术师可以代替目标牌。</li>
      <li>轮到你时暗着打出 1–3 张牌，并默认宣称它们都是目标牌。恶魔只能单独打出。</li>
      <li>下家可以直接继续出牌，也可以质疑上家；不再需要单独点击“相信上家”。</li>
      <li>质疑成功时撒谎者扣动轮盘；质疑失败时质疑者扣动轮盘。</li>
      <li>恶魔牌被揭开时，除出牌者外的所有存活玩家都要扣动轮盘。</li>
      <li>轮盘结算且仍有多人存活时，重新发牌并更换目标牌。</li>
    </ol><div class="rules-foot">点击面板外空白处、右上角关闭按钮或按 Esc 返回对局。</div>`
};

for (let quantity = 1; quantity <= 30; quantity += 1) {
  const option = document.createElement('option');
  option.value = quantity;
  option.textContent = quantity;
  elements.cntSel.appendChild(option);
}
elements.quickChatOptions.innerHTML = QUICK_CHAT_OPTIONS.map((message) => `<button class="quick-chat-option${message.length <= 2 ? ' emoji' : ''}" type="button" data-quick-message="${escapeHtml(message)}">${escapeHtml(message)}</button>`).join('');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function log(text, kind = 'msg') {
  const row = document.createElement('div');
  row.className = kind;
  row.textContent = text;
  elements.log.appendChild(row);
  while (elements.log.children.length > 80) elements.log.firstElementChild.remove();
  elements.log.scrollTop = elements.log.scrollHeight;
}

function myIdx() {
  return state ? state.players.findIndex((player) => player.id === myId) : -1;
}

function isMyTurn() {
  const index = myIdx();
  return Boolean(state && index >= 0 && index === state.turnIndex && !state.gameOver && state.players[index].alive && !rouletteAnimating);
}

function showAppropriateScreen() {
  elements.joinScreen.hidden = joined;
  elements.lobbyScreen.hidden = !joined || Boolean(state && state.gameMode);
  elements.gameScreen.hidden = !joined || !state || !state.gameMode;
  if (joined && state && !state.gameMode) {
    const ready = state.players.length >= 2;
    elements.lobbyInfo.innerHTML = `已加入 <b>${state.players.length}</b>/4${ready ? '，可以开局了' : '，等待其他玩家…'}`;
    const isHost = state.hostId === myId;
    elements.lobbyRoomCode.textContent = state.roomCode || myRoomId || '—';
    elements.startDiceBtn.disabled = !ready || !isHost;
    elements.startCardBtn.disabled = !ready || !isHost;
    elements.lobbyHint.textContent = !isHost ? '等待房主选择玩法并开始' : ready ? '请选择玩法开始本局' : '至少 2 人才能开局';
  }
}

function renderLobbySeats() {
  elements.lobbySeats.replaceChildren();
  if (!state || state.gameMode) return;
  const bySeat = new Map(state.players.map((player) => [player.seatIndex, player]));
  const mine = state.players.find((player) => player.id === myId);
  elements.seatPickerStatus.textContent = mine ? `当前 ${mine.seatIndex + 1} 号位 · 点击空位可换座` : '点击空位即可换座';
  for (let index = 0; index < 4; index += 1) {
    const player = bySeat.get(index);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `lobby-seat${player ? ' occupied' : ' vacant'}${player && player.id === myId ? ' mine' : ''}`;
    button.dataset.seatIndex = String(index);
    button.disabled = Boolean(player && player.id !== myId);
    button.setAttribute('aria-label', player ? `${index + 1} 号位，${player.name}${player.id === myId ? '，我的座位' : '，已占用'}` : `${index + 1} 号位，空位，点击换座`);
    button.innerHTML = `<span class="seat-number">${String(index + 1).padStart(2, '0')}</span><strong>${player ? escapeHtml(player.name) : '空位'}</strong><small>${player ? (player.id === myId ? '我的位置' : '已占用') : '点击换座'}</small>`;
    if (!player) button.addEventListener('click', () => {
      elements.seatPickerStatus.textContent = `正在换到 ${index + 1} 号位…`;
      button.classList.add('pending');
      socket.emit('chooseSeat', index);
    });
    elements.lobbySeats.appendChild(button);
  }
}

function renderSeats() {
  closeQuickChatMenu(false);
  elements.seats.replaceChildren();
  if (!state) return;
  elements.roomInfo.textContent = `房间 ${state.roomCode || '公共房'} · ${state.players.length}/4`;
  state.players.forEach((player, index) => {
    const seat = document.createElement('div');
    seat.className = 'seat';
    seat.dataset.playerId = player.id;
    seat.dataset.tableSeat = String(Number.isInteger(player.seatIndex) ? player.seatIndex : index);
    if (player.id === myId) seat.classList.add('my-seat');
    if (!player.alive) seat.classList.add('dead');
    if (state.turnIndex === index && !state.gameOver) seat.classList.add('active');
    const slot = SEAT_LAYOUTS[4][Number.isInteger(player.seatIndex) ? player.seatIndex : index];
    seat.style.left = `${slot.left}%`;
    seat.style.top = `${slot.top}%`;

    let status = '<div class="stat wait">等待中</div>';
    if (state.gameOver && player.alive) status = '<div class="stat win">胜者</div>';
    else if (!player.alive) status = '<div class="stat wait">已出局</div>';
    else if (state.turnIndex === index) status = '<div class="stat turn">正在思考</div>';
    const held = state.gameMode === 'card' ? `剩余 ${player.cardCount || 0} 张牌` : `持有 ${player.diceCount || 0} 颗骰子`;
    const remaining = player.revolver ? player.revolver.remaining : 6;
    const chamber = `<div class="chamber-count" aria-label="弹巢剩余 ${remaining} 格"><span class="chamber-dot"></span>弹巢 ${remaining}/6</div>`;
    const quickMessage = player.quickMessage && player.quickMessage.expiresAt > Date.now() ? player.quickMessage : null;
    const isFresh = quickMessage && !seenQuickMessages.has(quickMessage.id);
    const bubble = quickMessage ? `<div class="quick-bubble${isFresh ? ' fresh' : ''}"${isFresh ? ' role="status"' : ''}>${escapeHtml(quickMessage.text)}</div>` : '';
    const trigger = player.id === myId ? '<button class="quick-chat-trigger" type="button" aria-haspopup="dialog" aria-expanded="false">快捷语</button>' : '';
    const turnTimer = state.turnIndex === index && !state.gameOver ? `<div class="turn-elapsed" data-turn-timer>${formatTurnElapsed()}</div>` : '';
    seat.innerHTML = `${bubble}<div class="sname">${escapeHtml(player.name)}${player.id === myId ? '（我）' : ''}<small>${player.alive ? '存活' : '出局'}</small></div><div class="sdice">${held}</div>${chamber}${status}${turnTimer}${trigger}`;
    if (quickMessage) {
      seenQuickMessages.add(quickMessage.id);
      if (seenQuickMessages.size > 80) seenQuickMessages.clear();
    }
    const quickChatButton = seat.querySelector('.quick-chat-trigger');
    if (quickChatButton) quickChatButton.addEventListener('click', (event) => { event.stopPropagation(); openQuickChatMenu(quickChatButton); });
    elements.seats.appendChild(seat);
  });
}

function formatTurnElapsed() {
  const elapsed = state && state.turnStartedAt ? Math.max(0, Math.floor((Date.now() - state.turnStartedAt) / 1000)) : 0;
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const seconds = String(elapsed % 60).padStart(2, '0');
  return `本回合 ${minutes}:${seconds}`;
}

function updateTurnTimer() {
  const timer = elements.seats.querySelector('[data-turn-timer]');
  if (timer) timer.textContent = formatTurnElapsed();
}

function openQuickChatMenu(button) {
  quickChatInvoker = button;
  elements.quickChatPopover.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  const rect = button.getBoundingClientRect();
  const popoverRect = elements.quickChatPopover.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - popoverRect.width - 8, rect.left + rect.width / 2 - popoverRect.width / 2));
  const below = rect.bottom + 7;
  const top = below + popoverRect.height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - popoverRect.height - 7);
  elements.quickChatPopover.style.left = `${left}px`;
  elements.quickChatPopover.style.top = `${top}px`;
  elements.quickChatPopover.querySelector('button')?.focus();
}

function closeQuickChatMenu(restoreFocus = true) {
  if (!elements.quickChatPopover || elements.quickChatPopover.hidden) return;
  elements.quickChatPopover.hidden = true;
  if (quickChatInvoker) {
    quickChatInvoker.setAttribute('aria-expanded', 'false');
    if (restoreFocus && quickChatInvoker.isConnected) quickChatInvoker.focus();
  }
  quickChatInvoker = null;
}

function renderCenter() {
  if (!state) return;
  elements.returnLobbyBtn.hidden = !state.gameOver;
  const ready = (state.readyPlayerIds || []).includes(myId);
  elements.returnLobbyBtn.disabled = false;
  elements.returnLobbyBtn.textContent = ready ? '取消准备' : '准备下一局';
  if (state.gameMode === 'card') {
    elements.centerLabel.textContent = '本轮目标牌';
    const meta = CARD_META[state.targetCard];
    if (meta) elements.centerValue.innerHTML = `${meta.icon}<span>${meta.cn}</span>`;
    else elements.centerValue.textContent = '—';
    elements.centerValue.classList.add('card-target');
    elements.wildStatus.hidden = true;
  } else {
    elements.centerLabel.textContent = '当前报价';
    elements.centerValue.classList.remove('card-target');
    elements.centerValue.textContent = state.currentBid ? `${state.currentBid[0]} 个 ${state.currentBid[1]}` : '—';
    elements.wildStatus.hidden = false;
    elements.wildStatus.textContent = state.onesWild === false ? '已摘 · 1 仅算 1' : '1 可百搭';
    if (state.currentBid) {
      elements.cntSel.value = String(Math.min(30, Math.max(1, state.currentBid[0])));
      elements.faceSel.value = String(state.currentBid[1]);
    }
  }
  if (state.gameOver) {
    const winner = state.players.find((player) => player.alive);
    elements.turnInfo.innerHTML = winner ? `本局结束 · <b>${escapeHtml(winner.name)}</b> 获胜` : '本局结束';
  } else if (state.players.length) {
    const current = state.players[state.turnIndex];
    elements.turnInfo.innerHTML = current && current.id === myId ? '<b>轮到你</b>' : `轮到 <b>${current ? escapeHtml(current.name) : '—'}</b>`;
  }
}

function renderLastPlayPanel() {
  const isCardMode = Boolean(state && state.gameMode === 'card');
  elements.lastPlayPanel.hidden = !isCardMode;
  if (!isCardMode) { lastPlaySignature = ''; return; }

  const reveal = lastCardReveal;
  const lastPlay = state.lastPlay;
  const player = !reveal && lastPlay ? state.players[lastPlay.playerIdx] : null;
  const count = reveal ? reveal.cards.length : lastPlay ? lastPlay.count : 0;
  const playerName = reveal ? reveal.playerName : player ? player.name : '';
  const signature = reveal ? `reveal:${reveal.id}:${reveal.cards.join(',')}` : `hidden:${state.roundNumber}:${lastPlay ? `${lastPlay.playerIdx}:${count}` : 'empty'}`;
  if (signature === lastPlaySignature) return;

  elements.lastPlayPanel.classList.toggle('revealed', Boolean(reveal));
  elements.lastPlayLabel.textContent = reveal ? '质疑揭牌' : '上一手';
  elements.lastPlaySummary.textContent = count ? `${playerName || '上家'}打出 ${count} 张` : '本轮等待首位玩家出牌';
  elements.lastPlayCards.setAttribute('aria-label', reveal ? `真实牌面：${reveal.cards.map((card) => CARD_META[card]?.cn || card).join('、')}` : count ? `${count} 张未揭示卡牌` : '本轮尚未出牌');
  elements.lastPlayCards.innerHTML = Array.from({ length: count }, (_, index) => {
    const card = reveal ? reveal.cards[index] : null;
    const meta = card ? CARD_META[card] : null;
    return `<span class="played-card${card === 'devil' ? ' devil' : ''}" style="--card-index:${index}"><span class="played-card-inner"><span class="played-card-side played-card-back">${CARD_BACK_MARK}</span><span class="played-card-side played-card-face">${meta ? `${meta.icon}<small>${meta.cn}</small>` : ''}</span></span></span>`;
  }).join('');
  lastPlaySignature = signature;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reveal) window.requestAnimationFrame(() => {
    elements.lastPlayCards.querySelectorAll('.played-card').forEach((card) => card.classList.add('is-revealed'));
  });
  if (!reducedMotion && window.anime && typeof window.anime.animate === 'function') {
    window.anime.animate(elements.lastPlayPanel, { opacity:[0.7,1], y:[-5,0], duration:420, ease:'out(4)' });
  }
}

function renderPlayHistory() {
  const isCard = Boolean(state && state.gameMode === 'card');
  elements.historyPanel.hidden = !isCard;
  if (!isCard) return;
  elements.historyRound.textContent = `第 ${state.roundNumber || 1} 轮`;
  const entries = (state.playHistory || []).slice().reverse();
  if (!entries.length) {
    elements.playHistory.innerHTML = '<div class="history-empty">本轮尚未出牌</div>';
    return;
  }
  elements.playHistory.innerHTML = entries.map((entry) => {
    const cards = entry.cards ? entry.cards.map((card) => (CARD_META[card] ? CARD_META[card].cn : card)).join('、') : '牌面未揭示';
    const outcome = entry.outcome === 'true' ? '<span class="history-outcome true">属实</span>' : entry.outcome === 'lie' ? '<span class="history-outcome lie">撒谎</span>' : '<span class="history-outcome">待验证</span>';
    return `<div class="history-item"><span class="history-turn">R${entry.round}</span><div><strong>${escapeHtml(entry.playerName)}</strong><span>暗出 ${entry.count} 张 · ${escapeHtml(cards)}</span></div>${outcome}</div>`;
  }).join('');
}

function updateReadyUi() {
  if (!state) return;
  const connected = state.players.filter((player) => player.connected).length;
  const count = (state.readyPlayerIds || []).filter((id) => state.players.some((player) => player.id === id && player.connected)).length;
  const ready = (state.readyPlayerIds || []).includes(myId);
  elements.readyStatus.textContent = `已准备 ${count}/${connected}`;
  elements.leaderboardLobbyBtn.textContent = ready ? '取消准备' : '准备下一局';
}

function renderMyArea(animateDice = false) {
  elements.myDiceRow.hidden = true;
  elements.myCardRow.hidden = true;
  elements.myEmptyTip.hidden = true;
  if (!state || !state.gameMode) {
    elements.myEmptyTip.hidden = false;
    return;
  }
  elements.myAreaLabel.textContent = state.gameMode === 'dice' ? '我的骰子' : '我的手牌';
  const index = myIdx();
  if (index < 0 || !state.players[index].alive) {
    elements.myEmptyTip.textContent = '你已出局，可以继续旁观本局。';
    elements.myEmptyTip.hidden = false;
    return;
  }
  if (state.gameMode === 'dice') {
    elements.myAreaLabel.textContent = '我的骰子';
    elements.myDiceRow.hidden = false;
    elements.myDiceRow.replaceChildren();
    myDice.forEach((value, diceIndex) => {
      const die = document.createElement('div');
      die.className = `die${animateDice ? ' rolling' : ''}`;
      die.style.animationDelay = `${diceIndex * 45}ms`;
      die.textContent = FACE_GLYPH[value] || value;
      die.setAttribute('aria-label', `${value} 点`);
      elements.myDiceRow.appendChild(die);
    });
    return;
  }
  elements.myAreaLabel.textContent = '我的手牌';
  if (!myCards.length) {
    elements.myEmptyTip.textContent = '手牌已出完，等待下一轮发牌。';
    elements.myEmptyTip.hidden = false;
    return;
  }
  elements.myCardRow.hidden = false;
  elements.myCardRow.replaceChildren();
  myCards.forEach((cardType, cardIndex) => {
    const meta = CARD_META[cardType] || { cn: cardType, icon: CARD_ICONS.unknown };
    const card = document.createElement('button');
    const selected = selectedCards.includes(cardIndex);
    card.type = 'button';
    card.className = `card${selected ? ' selected' : ''}`;
    card.setAttribute('aria-pressed', String(selected));
    card.innerHTML = `<span class="cf">${meta.icon}</span><span>${escapeHtml(meta.cn)}</span>`;
    card.addEventListener('click', () => {
      if (!isMyTurn()) { log('还没轮到你。', 'sys'); return; }
      const selectedIndex = selectedCards.indexOf(cardIndex);
      if (selectedIndex >= 0) selectedCards.splice(selectedIndex, 1);
      else if (cardType === 'devil') {
        selectedCards = [cardIndex];
        showToast('恶魔牌必须单独打出', 'bad');
      } else if (selectedCards.some((index) => myCards[index] === 'devil')) {
        selectedCards = [cardIndex];
        showToast('已取消恶魔牌；恶魔不能与其他牌混出', 'bad');
      } else if (selectedCards.length < 3) selectedCards.push(cardIndex);
      else log('每次最多选择 3 张牌。', 'sys');
      renderMyArea();
      updateControls();
    });
    elements.myCardRow.appendChild(card);
  });
}

function updateControls() {
  const myTurn = isMyTurn();
  if (!state || !joined || !state.gameMode) {
    elements.diceControls.hidden = true;
    elements.cardControls.hidden = true;
    return;
  }
  if (state.gameMode === 'card') {
    elements.diceControls.hidden = true;
    elements.cardControls.hidden = false;
    elements.playBtn.disabled = !myTurn || selectedCards.length === 0;
    elements.doubtCardBtn.disabled = !myTurn || !state.lastPlay;
    elements.cardHint.textContent = myTurn && state.lastPlay ? '可继续出牌，或质疑上家的上一手。' : myTurn ? '选中 1–3 张牌后出牌，恶魔只能单出。' : '等待当前玩家行动。';
    return;
  }
  elements.diceControls.hidden = false;
  elements.cardControls.hidden = true;
  elements.bidBtn.disabled = !myTurn;
  elements.doubtBtn.disabled = !myTurn || !state.currentBid;
  const hasBid = Boolean(state.currentBid);
  const wild = state.onesWild !== false;
  elements.exactBtn.disabled = !myTurn || !wild;
  elements.flyBtn.disabled = !myTurn || !hasBid || wild;
  elements.exactBtn.setAttribute('aria-pressed', String(bidAction === 'exact'));
  elements.flyBtn.setAttribute('aria-pressed', String(bidAction === 'fly'));
  if (!myTurn) elements.diceHint.textContent = '等待当前玩家报价或质疑。';
  else if (!hasBid) elements.diceHint.textContent = '首报可自由选择；喊 1 会自动摘。';
  else if (wild) elements.diceHint.textContent = `摘的数量至少为 ${Math.ceil(state.currentBid[0] / 2)}；喊 1 会自动摘。`;
  else elements.diceHint.textContent = `当前已摘；飞需喊 2–6，数量至少为 ${state.currentBid[0] * 2}。`;
}

function renderAll() {
  showAppropriateScreen(); renderLobbySeats(); renderSeats(); renderCenter(); renderLastPlayPanel(); renderPlayHistory(); renderMyArea(); updateControls(); updateReadyUi();
}

function syncModalInert() {
  const modalOpen = elements.rulesOverlay.classList.contains('open') || elements.leaderboardOverlay.classList.contains('open');
  elements.gameScreen.toggleAttribute('inert', modalOpen);
}

function focusableElements(container) {
  return [...container.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.getClientRects().length > 0);
}

function trapModalFocus(event, overlay) {
  if (event.key !== 'Tab') return;
  const focusable = focusableElements(overlay);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function focusGameplayControl(preferred = null) {
  const candidates = [preferred, elements.bidBtn, elements.doubtBtn, elements.playBtn, elements.doubtCardBtn, elements.rulesBtn];
  const target = candidates.find((element) => element && document.contains(element) && !element.hidden && !element.disabled && element.getClientRects().length > 0);
  if (target) target.focus();
}

function openRules(mode = state && state.gameMode, invoker = null) {
  const selectedMode = mode === 'card' ? 'card' : 'dice';
  rulesInvoker = invoker;
  elements.rulesTitle.textContent = `${MODE_NAME[selectedMode]}规则`;
  elements.rulesBody.innerHTML = RULES[selectedMode];
  elements.rulesOverlay.classList.add('open');
  elements.rulesOverlay.setAttribute('aria-hidden', 'false');
  syncModalInert();
  window.requestAnimationFrame(() => elements.rulesCloseBtn.focus());
}

function closeRules() {
  elements.rulesOverlay.classList.remove('open');
  elements.rulesOverlay.setAttribute('aria-hidden', 'true');
  syncModalInert();
  focusGameplayControl(rulesInvoker);
  rulesInvoker = null;
}

function renderLeaderboard(data) {
  lastResults = data;
  elements.resultsBtn.hidden = false;
  elements.leaderboardLobbyBtn.disabled = false;
  updateReadyUi();
  const winner = (data.rankings || []).find((player) => player.id === data.winnerId);
  elements.leaderboardSummary.textContent = winner ? `${winner.name} 获得本局第一名；排名按存活与淘汰顺序计算。` : '本局无人幸存；排名按淘汰先后与本局表现计算。';
  const header = '<div class="leaderboard-row header"><span>名次</span><span>玩家</span><span>结果</span><span>质疑</span><span>行动</span><span>轮盘</span></div>';
  const rows = (data.rankings || []).map((player) => {
    const actions = player.bids + player.cardsPlayed;
    return `<div class="leaderboard-row${player.rank === 1 ? ' winner' : ''}"><span class="leaderboard-rank">${player.rank}</span><span class="leaderboard-name">${escapeHtml(player.name)}</span><span>${player.alive ? '幸存' : '出局'}</span><span>成功 ${player.successfulDoubts}/${player.doubts}</span><span>${actions} 次</span><span>${player.roulettePulls} 次</span></div>`;
  }).join('');
  elements.leaderboardList.innerHTML = header + rows;
}

function openLeaderboard() {
  if (!lastResults) return;
  elements.leaderboardOverlay.classList.add('open');
  elements.leaderboardOverlay.setAttribute('aria-hidden', 'false');
  syncModalInert();
  window.requestAnimationFrame(() => elements.leaderboardCloseBtn.focus());
}

function closeLeaderboard() {
  elements.leaderboardOverlay.classList.remove('open');
  elements.leaderboardOverlay.setAttribute('aria-hidden', 'true');
  syncModalInert();
  focusGameplayControl(!elements.resultsBtn.hidden ? elements.resultsBtn : null);
}

function showToast(text, type = '') {
  elements.toastLayer.replaceChildren();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`.trim();
  toast.textContent = text;
  elements.toastLayer.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

function renderReveal(data) {
  const rows = (data.players || []).map((player) => {
    const dice = (player.dice || []).map((value) => FACE_GLYPH[value] || value).join(' ');
    const leopard = player.leopardType === 'real' ? '真豹子 · 计7' : player.leopardType === 'fake' ? '假豹子 · 计6' : '';
    return `<div class="reveal-row"><span>${escapeHtml(player.name)}</span><span class="reveal-dice">${dice}</span><span class="leopard">${leopard}</span></div>`;
  }).join('');
  elements.roundReveal.innerHTML = `<div class="reveal-card"><div class="reveal-head"><span>开骰 · ${data.bid[0]} 个 ${data.bid[1]}</span><strong>实际计数 ${data.actualCount}</strong></div><div class="reveal-list">${rows}</div></div>`;
  elements.roundReveal.classList.add('show');
  if (revealTimer) window.clearTimeout(revealTimer);
  revealTimer = window.setTimeout(() => elements.roundReveal.classList.remove('show'), 6500);
}

function animateRoulette(data) {
  rouletteQueue.push(data);
  if (rouletteAnimating) return;
  playNextRoulette();
}

function playNextRoulette() {
  const data = rouletteQueue.shift();
  if (!data) {
    rouletteAnimating = false;
    if (lastCardReveal) {
      if (cardRevealTimer) window.clearTimeout(cardRevealTimer);
      cardRevealTimer = window.setTimeout(() => { lastCardReveal = null; lastPlaySignature = ''; renderLastPlayPanel(); }, 5000);
    }
    return;
  }
  rouletteAnimating = true;
  updateControls();
  const seat = elements.seats.querySelector(`[data-player-id="${cssEscape(data.victimId)}"]`);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  elements.rouletteEyebrow.textContent = data.isDevil ? '恶魔牌触发' : data.challengeSuccess ? '质疑成功' : '质疑失败';
  elements.rouletteName.textContent = `${data.victimName} 接受轮盘`;
  elements.rouletteResult.textContent = '装入一枚实弹 · 弹巢待转';
  elements.rouletteOverlay.classList.remove('shot', 'safe', 'phase-load', 'phase-spin', 'phase-trigger');
  elements.rouletteOverlay.classList.add('phase-load');
  elements.rouletteOverlay.classList.add('open');
  elements.rouletteOverlay.setAttribute('aria-hidden', 'false');
  document.documentElement.classList.add('roulette-active');
  elements.rouletteCylinder.style.transition = 'none';
  elements.rouletteCylinder.style.transform = 'rotate(0turn)';
  const visualStopIndex = Number.isInteger(data.visualStopIndex) ? Math.max(0, Math.min(5, data.visualStopIndex)) : (data.isShot ? 0 : Math.floor(Math.random() * 5) + 1);
  const visualTurns = Number.isInteger(data.visualTurns) ? Math.max(5, Math.min(10, data.visualTurns)) : 7;
  const stopAngle = visualTurns * 360 + visualStopIndex * 60;
  elements.rouletteCylinder.style.setProperty('--roulette-stop', `${stopAngle}deg`);
  const spinStart = reducedMotion ? ROULETTE_TIMING.reducedSpinStart : ROULETTE_TIMING.spinStart;
  const lockDelay = reducedMotion ? ROULETTE_TIMING.reducedLock : ROULETTE_TIMING.lock;
  const revealDelay = reducedMotion ? ROULETTE_TIMING.reducedReveal : ROULETTE_TIMING.reveal;
  const closeDelay = reducedMotion ? ROULETTE_TIMING.reducedClose : ROULETTE_TIMING.close;
  if (!reducedMotion && window.anime && typeof window.anime.animate === 'function') {
    window.anime.animate(elements.rouletteMechanism, { scale:[0.965,1], opacity:[0.72,1], duration:520, ease:'out(4)' });
  }
  window.setTimeout(() => {
    elements.rouletteOverlay.classList.remove('phase-load');
    elements.rouletteOverlay.classList.add('phase-spin');
    elements.rouletteResult.textContent = '弹巢高速旋转 · 所有人等待结果';
    if (!reducedMotion && window.anime && typeof window.anime.animate === 'function') {
      window.anime.animate(elements.rouletteCylinder, { rotate:`${stopAngle}deg`, scale:[1,1.035,1.012,1], duration:3050, ease:'out(7)' });
    } else {
      elements.rouletteCylinder.style.transition = `transform ${reducedMotion ? 450 : 3050}ms cubic-bezier(.12,.72,.12,1)`;
      elements.rouletteCylinder.style.transform = `rotate(${stopAngle}deg)`;
    }
  }, spinStart);
  window.setTimeout(() => {
    elements.rouletteOverlay.classList.remove('phase-spin');
    elements.rouletteOverlay.classList.add('phase-trigger');
    elements.rouletteResult.textContent = '弹巢锁定 · 击锤落下';
    if (!reducedMotion && window.anime && typeof window.anime.animate === 'function') {
      window.anime.animate(elements.rouletteMechanism, { rotate:[0,-1.4,.7,0], scale:[1,1.018,1], duration:460, ease:'inOut(2)' });
    }
  }, lockDelay);
  if (seat) {
    seat.classList.add('risk');
    window.setTimeout(() => {
      seat.classList.remove('risk');
      seat.classList.add(data.isShot ? 'shot' : 'safe');
      window.setTimeout(() => seat.classList.remove('shot', 'safe'), 1500);
    }, revealDelay);
  }
  window.setTimeout(() => {
    elements.rouletteOverlay.classList.remove('phase-trigger');
    elements.rouletteOverlay.classList.add(data.isShot ? 'shot' : 'safe');
    if (data.isShot && !reducedMotion) {
      elements.gameScreen.classList.add('impact-shake');
      window.setTimeout(() => elements.gameScreen.classList.remove('impact-shake'), 1450);
      if (navigator.vibrate) navigator.vibrate([120, 45, 180]);
    }
    elements.rouletteResult.textContent = data.isShot ? '命中 · 实弹击发 · 玩家出局' : `空枪 · 本次幸存 · 剩余 ${data.remaining} 格`;
    if (!reducedMotion && window.anime && typeof window.anime.animate === 'function') {
      if (!data.isShot) window.anime.animate('.roulette-stage', { y:[0,4,0], duration:480, ease:'out(3)' });
    }
    showToast(data.isShot ? `${data.victimName} 中弹出局` : `${data.victimName} 扣下空枪，幸存`, data.isShot ? 'bad' : 'good');
  }, revealDelay);
  window.setTimeout(() => {
    elements.rouletteOverlay.classList.remove('open', 'shot', 'safe', 'phase-load', 'phase-spin', 'phase-trigger');
    elements.rouletteOverlay.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('roulette-active');
    rouletteAnimating = false;
    updateControls();
    playNextRoulette();
  }, closeDelay);
}

function applyAppearance() {
  const color = elements.bgColorInput.value.replace('#', '');
  const rgb = color.length === 6 ? [0, 2, 4].map((index) => parseInt(color.slice(index, index + 2), 16)) : [35, 56, 47];
  const strength = Number(elements.bgOpacityInput.value) / 100;
  const brightness = Number(elements.brightnessInput.value);
  const brightnessOverlay = brightness < 100
    ? `rgba(0,0,0,${(100 - brightness) / 100})`
    : `rgba(255,255,255,${(brightness - 100) / 100})`;
  document.documentElement.style.setProperty('--window-color-overlay', `rgba(${rgb.join(',')},${strength})`);
  document.documentElement.style.setProperty('--window-brightness-overlay', brightnessOverlay);
  elements.bgOpacityOutput.textContent = `${elements.bgOpacityInput.value}%`;
  elements.brightnessOutput.textContent = `${elements.brightnessInput.value}%`;
  localStorage.setItem('liars-bg-color', elements.bgColorInput.value);
  localStorage.setItem('liars-bg-opacity', elements.bgOpacityInput.value);
  localStorage.setItem('liars-window-brightness', elements.brightnessInput.value);
}

function restoreAppearance() {
  elements.bgColorInput.value = localStorage.getItem('liars-bg-color') || '#dfe8df';
  elements.bgOpacityInput.value = localStorage.getItem('liars-bg-opacity') || '0';
  elements.brightnessInput.value = localStorage.getItem('liars-window-brightness') || '100';
  applyAppearance();
}

socket.on('connect', () => {
  elements.connectionState.textContent = '已连接';
  elements.connectionState.classList.remove('offline');
  log('已连接服务器。', 'sys');
  if (joined && myRoomId) socket.emit('joinRoom', myRoomId, myNameText, deviceId);
});
socket.on('joined', (data) => {
  clearTimeout(joinTimer);
  joinPending = false;
  if (!data || data.ok === false) {
    elements.createBtn.disabled = false;
    elements.joinBtn.disabled = false;
    elements.joinHint.textContent = data && data.message ? data.message : '无法加入房间，请检查房间号。';
    return;
  }
  joined = true;
  myId = data.playerId;
  myRoomId = data.roomId;
  myNameText = data.name;
  elements.myName.textContent = data.name;
  elements.createBtn.disabled = false;
  elements.joinBtn.disabled = false;
  elements.joinHint.textContent = '';
  showAppropriateScreen();
});
socket.on('state', (nextState) => {
  state = nextState;
  elements.modeBadge.textContent = MODE_NAME[state.gameMode] || '';
  if (state.gameOver && state.finalResults && !lastResults) {
    renderLeaderboard(state.finalResults);
    window.setTimeout(openLeaderboard, 350);
  }
  renderAll();
});
socket.on('gameStarted', (data) => {
  lastResults = null;
  lastCardReveal = null;
  lastPlaySignature = '';
  if (cardRevealTimer) window.clearTimeout(cardRevealTimer);
  elements.log.replaceChildren();
  elements.roundReveal.classList.remove('show');
  elements.roundReveal.replaceChildren();
  elements.resultsBtn.hidden = true;
  openRules(data.mode);
  showToast(`${MODE_NAME[data.mode]}已开始`, 'good');
});
socket.on('gameOver', (data) => {
  renderLeaderboard(data);
  window.setTimeout(openLeaderboard, 2500);
});
socket.on('returnedToLobby', () => {
  closeLeaderboard();
  elements.resultsBtn.hidden = true;
});
socket.on('myDice', (payload) => {
  myDice = Array.isArray(payload) ? payload : payload.dice;
  log(`你的骰子：${myDice.join(' ')}`, 'me');
  renderMyArea(true);
});
socket.on('myCards', (cards) => {
  myCards = cards;
  selectedCards = [];
  log(`你的手牌：${cards.map((card) => CARD_META[card] ? CARD_META[card].cn : card).join('、')}`, 'me');
  renderMyArea(); updateControls();
});
socket.on('diceReveal', renderReveal);
socket.on('rouletteResult', animateRoulette);
socket.on('seatResult', (data) => {
  if (!data) return;
  elements.seatPickerStatus.textContent = data.message || (data.ok ? '换座成功。' : '无法换座。');
  showToast(elements.seatPickerStatus.textContent, data.ok ? 'good' : 'bad');
});
socket.on('quickMessageResult', (data) => {
  if (!data || !data.valid) showToast((data && data.reason) || '快捷语言发送失败', 'bad');
});
socket.on('newCardRound', (data) => {
  const meta = CARD_META[data.target];
  log(`新一轮目标牌：${meta ? meta.cn : data.target}`, 'sys');
});
socket.on('revealCards', (data) => {
  const list = (data.cards || []).map((card) => CARD_META[card] ? CARD_META[card].cn : card).join('、');
  const player = state && state.players[data.playerIdx];
  lastCardReveal = { id: `${Date.now()}-${data.playerIdx}`, cards: (data.cards || []).slice(), playerName: data.playerName || (player && player.name) || '上家' };
  lastPlaySignature = '';
  renderLastPlayPanel();
  if (cardRevealTimer) window.clearTimeout(cardRevealTimer);
  cardRevealTimer = null;
  log(`${player ? player.name : '上家'} 打出：${list}`, 'sys');
});
socket.on('msg', (text) => {
  let kind = 'msg';
  if (/出局|中弹|撒谎|不合法|失败/.test(text)) kind = 'bad';
  else if (/结束|获胜|空枪|属实|成功/.test(text)) kind = 'good';
  else if (/加入|离开|开始|新一轮|摘|飞/.test(text)) kind = 'sys';
  log(text, kind);
  if (/房间已满|不存在|无法加入/.test(text)) {
    joinPending = false;
    elements.createBtn.disabled = false;
    elements.joinBtn.disabled = false;
    elements.joinHint.textContent = text;
  }
});
socket.on('disconnect', () => {
  elements.connectionState.textContent = '连接中断';
  elements.connectionState.classList.add('offline');
  log('与服务器断开连接，请刷新页面。', 'bad');
  [elements.bidBtn, elements.doubtBtn, elements.playBtn, elements.doubtCardBtn, elements.exactBtn, elements.flyBtn].forEach((button) => { button.disabled = true; });
});

function submitRoom(action) {
  const name = elements.nameInput.value.trim();
  if (!name) { elements.joinHint.textContent = '请输入昵称。'; return; }
  if (joinPending) return;
  const roomCode = elements.roomInput.value.trim();
  if (action === 'joinRoom' && !/^\d{4,6}$/.test(roomCode)) { elements.joinHint.textContent = '请输入 4–6 位房间号。'; return; }
  joinPending = true;
  myNameText = name;
  try { localStorage.setItem('liars-name', name); } catch (_) {}
  elements.joinHint.textContent = action === 'createRoom' ? '正在创建房间…' : '正在加入房间…';
  elements.createBtn.disabled = true;
  elements.joinBtn.disabled = true;
  if (action === 'createRoom') socket.emit('createRoom', name, deviceId);
  else socket.emit('joinRoom', roomCode, name, deviceId);
  joinTimer = window.setTimeout(() => {
    if (!joined) {
      joinPending = false;
      elements.createBtn.disabled = false;
      elements.joinBtn.disabled = false;
      elements.joinHint.textContent = '连接超时，请检查网络后重试。';
    }
  }, 7000);
}

elements.createBtn.addEventListener('click', () => submitRoom('createRoom'));
elements.joinBtn.addEventListener('click', () => submitRoom('joinRoom'));
elements.nameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') submitRoom(elements.roomInput.value ? 'joinRoom' : 'createRoom'); });
elements.roomInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') submitRoom('joinRoom'); });
elements.startDiceBtn.addEventListener('click', () => { elements.lobbyHint.textContent = '正在开局…'; socket.emit('startGame', 'dice'); });
elements.startCardBtn.addEventListener('click', () => { elements.lobbyHint.textContent = '正在开局…'; socket.emit('startGame', 'card'); });
function leaveRoom() { socket.emit('leaveRoom'); }
elements.leaveLobbyBtn.addEventListener('click', leaveRoom);
elements.leaveGameBtn.addEventListener('click', leaveRoom);
elements.copyInviteBtn.addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?room=${myRoomId}`;
  try { await navigator.clipboard.writeText(link); showToast('邀请链接已复制', 'good'); }
  catch (_) { showToast(`房间号：${myRoomId}`); }
});
socket.on('left', () => {
  joined = false; myId = null; myRoomId = ''; state = null; myDice = []; myCards = []; selectedCards = [];
  elements.joinScreen.hidden = false; elements.lobbyScreen.hidden = true; elements.gameScreen.hidden = true;
  history.replaceState(null, '', location.pathname);
});
elements.exactBtn.addEventListener('click', () => { bidAction = bidAction === 'exact' ? 'normal' : 'exact'; updateControls(); });
elements.flyBtn.addEventListener('click', () => { bidAction = bidAction === 'fly' ? 'normal' : 'fly'; updateControls(); });
elements.faceSel.addEventListener('change', () => {
  if (elements.faceSel.value === '1' && state && state.onesWild !== false) bidAction = 'exact';
  updateControls();
});
elements.bidBtn.addEventListener('click', () => {
  socket.emit('bid', Number(elements.cntSel.value), Number(elements.faceSel.value), bidAction);
  bidAction = 'normal';
});
elements.doubtBtn.addEventListener('click', () => socket.emit('doubt'));
elements.playBtn.addEventListener('click', () => {
  if (!selectedCards.length) return;
  const cards = selectedCards.map((index) => myCards[index]);
  if (cards.includes('devil') && cards.length !== 1) {
    showToast('恶魔牌必须单独打出', 'bad');
    return;
  }
  socket.emit('playCards', cards);
  selectedCards = [];
});
elements.doubtCardBtn.addEventListener('click', () => socket.emit('doubtCard'));
elements.returnLobbyBtn.addEventListener('click', () => socket.emit('toggleReady'));
elements.rulesBtn.addEventListener('click', () => openRules(state && state.gameMode, elements.rulesBtn));
elements.resultsBtn.addEventListener('click', openLeaderboard);
elements.rulesCloseBtn.addEventListener('click', closeRules);
elements.rulesOverlay.addEventListener('click', (event) => { if (event.target === elements.rulesOverlay) closeRules(); });
elements.leaderboardCloseBtn.addEventListener('click', closeLeaderboard);
elements.leaderboardOverlay.addEventListener('click', (event) => { if (event.target === elements.leaderboardOverlay) closeLeaderboard(); });
elements.leaderboardLobbyBtn.addEventListener('click', () => socket.emit('toggleReady'));
elements.quickChatOptions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-quick-message]');
  if (!button) return;
  socket.emit('sendQuickMessage', button.dataset.quickMessage);
  closeQuickChatMenu(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.quickChatPopover.hidden) { closeQuickChatMenu(); return; }
  if (elements.leaderboardOverlay.classList.contains('open')) {
    trapModalFocus(event, elements.leaderboardOverlay);
    if (event.key === 'Escape') closeLeaderboard();
  } else if (elements.rulesOverlay.classList.contains('open')) {
    trapModalFocus(event, elements.rulesOverlay);
    if (event.key === 'Escape') closeRules();
  }
});
elements.appearanceBtn.addEventListener('click', () => {
  elements.appearancePanel.hidden = !elements.appearancePanel.hidden;
  elements.appearanceBtn.setAttribute('aria-expanded', String(!elements.appearancePanel.hidden));
});
document.addEventListener('click', (event) => {
  if (!elements.quickChatPopover.hidden && !elements.quickChatPopover.contains(event.target)) closeQuickChatMenu(false);
  if (!elements.appearancePanel.hidden && !elements.appearancePanel.contains(event.target) && event.target !== elements.appearanceBtn) {
    elements.appearancePanel.hidden = true;
    elements.appearanceBtn.setAttribute('aria-expanded', 'false');
  }
});
elements.bgColorInput.addEventListener('input', applyAppearance);
elements.bgOpacityInput.addEventListener('input', applyAppearance);
elements.brightnessInput.addEventListener('input', applyAppearance);
elements.resetAppearanceBtn.addEventListener('click', () => {
  elements.bgColorInput.value = '#dfe8df'; elements.bgOpacityInput.value = '0'; elements.brightnessInput.value = '100'; applyAppearance();
});
restoreAppearance();
window.setInterval(updateTurnTimer, 1000);
