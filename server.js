'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { checkDiceBid, classifyDiceHand, rerollDice, validateBidTransition, createRevolver, pullRevolver, createRouletteVisual, revolverPublicState, aliveTurnIndex, clockwiseAliveIndexes, validateCardSelection, mustChallengeEmptyHand, buildCardDeck, validateQuickMessage } = require('./game-logic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static('public'));

const MAX_PLAYER = 4;
const CARD_TYPES = ['sun', 'moon', 'star'];
const rooms = new Map();
const disconnectTimers = new Map();

const emptyStats = () => ({ bids:0, doubts:0, successfulDoubts:0, failedDoubts:0, roulettePulls:0, cardsPlayed:0 });

function makeRoom(code) {
  return { roomCode:code, hostId:null, players:[], gameMode:null, currentBid:null, onesWild:true, lastBidAction:null, turnIndex:0, turnStartedAt:null, gameOver:false, finalResults:null, targetCard:null, lastPlay:null, playHistory:[], roundNumber:0, readyPlayerIds:[], eliminationCounter:0 };
}

function firstOpenSeat(state) {
  const occupied=new Set(state.players.map(p=>p.seatIndex));
  for(let index=0;index<MAX_PLAYER;index+=1) if(!occupied.has(index)) return index;
  return -1;
}

function makeCode() {
  let code;
  do code = String(Math.floor(1000 + Math.random() * 9000)); while (rooms.has(code));
  return code;
}

function roomFor(socket) { return socket.data.roomCode ? rooms.get(socket.data.roomCode) : null; }
function channel(state) { return `room:${state.roomCode}`; }
function roomEmit(state, event, payload) { io.to(channel(state)).emit(event, payload); }

function publicState(state) {
  return {
    roomCode:state.roomCode, hostId:state.hostId, gameMode:state.gameMode, currentBid:state.currentBid,
    onesWild:state.onesWild, lastBidAction:state.lastBidAction, turnIndex:state.turnIndex, turnStartedAt:state.turnStartedAt,
    gameOver:state.gameOver, finalResults:state.finalResults, targetCard:state.targetCard, roundNumber:state.roundNumber,
    lastPlay:state.lastPlay ? { playerIdx:state.lastPlay.playerIdx, count:state.lastPlay.cards.length } : null,
    mustDoubt:state.gameMode==='card'&&mustChallengeEmptyHand(state.players,state.lastPlay,state.turnIndex),
    playHistory:state.playHistory.slice(-16).map(entry => ({ ...entry, cards:entry.cards ? entry.cards.slice() : null })),
    readyPlayerIds:state.readyPlayerIds.slice(),
    players:state.players.map(p => ({ id:p.id, name:p.name, seatIndex:p.seatIndex, alive:p.alive, connected:p.connected, diceCount:p.dice.length, cardCount:p.cards.length, revolver:revolverPublicState(p.revolver), quickMessage:p.quickMessage ? { id:p.quickMessage.id, text:p.quickMessage.text, expiresAt:p.quickMessage.expiresAt } : null }))
  };
}

function emitState(state) { roomEmit(state, 'state', publicState(state)); }
function privateSocket(player) { return player.socketId ? io.sockets.sockets.get(player.socketId) : null; }
function activeCount(state) { return state.players.filter(p => p.alive).length; }

function nextAliveIdx(state, from) {
  const total = state.players.length;
  if (!total) return -1;
  let index = ((from + 1) % total + total) % total;
  for (let step=0; step<total; step+=1) {
    if (state.players[index].alive) return index;
    index = (index + 1) % total;
  }
  return -1;
}

function prevAliveIdx(state, from) {
  const total = state.players.length;
  if (!total) return -1;
  let index = ((from - 1) % total + total) % total;
  for (let step=0; step<total; step+=1) {
    if (state.players[index].alive) return index;
    index = (index - 1 + total) % total;
  }
  return -1;
}

function nextTurn(state) {
  if (state.gameOver || activeCount(state) <= 1) return;
  const next = nextAliveIdx(state, state.turnIndex);
  if (next >= 0) { state.turnIndex = next; state.turnStartedAt=Date.now(); }
}

function ensureAliveTurn(state) {
  if (state.gameOver || activeCount(state) <= 1) return;
  const next = aliveTurnIndex(state.players, state.turnIndex);
  if (next >= 0 && next!==state.turnIndex) { state.turnIndex = next; state.turnStartedAt=Date.now(); }
}

function resetPlayers(state) {
  state.eliminationCounter=0;
  state.playHistory=[]; state.roundNumber=0; state.readyPlayerIds=[];
  state.players.forEach(p => { p.alive=true; p.dice=[]; p.cards=[]; p.revolver=createRevolver(); p.eliminatedAt=null; p.stats=emptyStats(); p.quickMessage=null; });
}

function rankings(state) {
  return state.players.slice().sort((a,b) => {
    if (a.alive!==b.alive) return a.alive?-1:1;
    if (!a.alive && a.eliminatedAt!==b.eliminatedAt) return (b.eliminatedAt||0)-(a.eliminatedAt||0);
    if (a.stats.successfulDoubts!==b.stats.successfulDoubts) return b.stats.successfulDoubts-a.stats.successfulDoubts;
    return (b.stats.bids+b.stats.cardsPlayed)-(a.stats.bids+a.stats.cardsPlayed);
  }).map((p,i) => ({ rank:i+1,id:p.id,name:p.name,alive:p.alive,bids:p.stats.bids,cardsPlayed:p.stats.cardsPlayed,doubts:p.stats.doubts,successfulDoubts:p.stats.successfulDoubts,roulettePulls:p.stats.roulettePulls }));
}

function finishIfNeeded(state) {
  if (activeCount(state)>1) return false;
  if (!state.gameOver) {
    state.gameOver=true;
    const winner=state.players.find(p=>p.alive);
    roomEmit(state,'msg',winner?`游戏结束，${winner.name} 获胜！`:'游戏结束，本局无人幸存。');
    state.finalResults={winnerId:winner?winner.id:null,rankings:rankings(state)};
    roomEmit(state,'gameOver',state.finalResults);
  }
  return true;
}

function roulette(state,victimIndex,context={}) {
  const victim=state.players[victimIndex];
  victim.stats.roulettePulls+=1;
  const pull=pullRevolver(victim.revolver||createRevolver());
  victim.revolver=pull.revolver;
  const isShot=pull.isShot;
  if (isShot&&victim.alive) { victim.alive=false; state.eliminationCounter+=1; victim.eliminatedAt=state.eliminationCounter; }
  const result={isShot,victimIdx:victimIndex,victimId:victim.id,victimName:victim.name,remaining:pull.remaining,chambers:6,...createRouletteVisual(isShot),...context};
  roomEmit(state,'rouletteResult',result);
  return result;
}

function startDiceRound(state,reason='start') {
  state.players=rerollDice(state.players); state.currentBid=null; state.onesWild=true; state.lastBidAction=null;
  state.players.forEach(p => { if (p.alive) { const s=privateSocket(p); if(s) s.emit('myDice',{dice:p.dice,reason}); } });
  roomEmit(state,'diceRoundStarted',{reason});
}

function startCardRound(state) {
  state.roundNumber+=1; state.targetCard=CARD_TYPES[Math.floor(Math.random()*CARD_TYPES.length)]; state.lastPlay=null; state.currentBid=null; state.turnStartedAt=Date.now();
  const deck=buildCardDeck(); let cursor=0;
  state.players.forEach(p => {
    if(!p.alive){p.cards=[];return;}
    p.cards=deck.slice(cursor,cursor+5); cursor+=5;
  });
  roomEmit(state,'newCardRound',{target:state.targetCard});
  state.players.forEach(p => { if(p.alive) { const s=privateSocket(p); if(s) s.emit('myCards',p.cards); } });
}

function checkCardPlay(cards,target) {
  const devil=cards.includes('devil');
  if (devil&&cards.length!==1) return {valid:false,reason:'恶魔牌只能单独打出'};
  if (devil) return {valid:true,isDevil:true};
  return cards.every(c=>c===target||c==='joker') ? {valid:true,isDevil:false} : {valid:false,reason:'手牌含有非目标牌'};
}

function resetLobby(state) {
  Object.assign(state,{gameMode:null,currentBid:null,onesWild:true,lastBidAction:null,turnIndex:0,turnStartedAt:null,gameOver:false,finalResults:null,targetCard:null,lastPlay:null,playHistory:[],roundNumber:0,readyPlayerIds:[]});
  state.players.forEach(p=>{p.alive=true;p.dice=[];p.cards=[];p.revolver=createRevolver();p.quickMessage=null;});
}

function leaveCurrent(socket,notify=true) {
  const state=roomFor(socket);
  if(!state) return;
  const index=state.players.findIndex(p=>p.id===socket.data.playerId);
  socket.leave(channel(state));
  socket.data.roomCode=null; socket.data.playerId=null;
  if(index<0) return;
  const player=state.players[index]; const wasCurrent=state.turnIndex===index;
  state.players.splice(index,1);
  if(state.turnIndex>index) state.turnIndex-=1;
  if(state.turnIndex>=state.players.length) state.turnIndex=0;
  if(wasCurrent&&state.gameMode&&!state.gameOver) state.turnStartedAt=Date.now();
  if(state.lastPlay) {
    if(state.lastPlay.playerIdx===index) state.lastPlay=null;
    else if(state.lastPlay.playerIdx>index) state.lastPlay.playerIdx-=1;
  }
  if(state.hostId===player.id) state.hostId=state.players[0]?.id||null;
  if(notify) roomEmit(state,'msg',`${player.name} 离开了房间。`);
  if(!state.players.length) rooms.delete(state.roomCode);
  else { if(state.gameMode) finishIfNeeded(state); emitState(state); }
}

function addOrReconnect(socket,state,name,deviceId) {
  const cleanId=String(deviceId||'').slice(0,80) || `socket-${socket.id}`;
  const cleanName=String(name||'').trim().slice(0,8)||'匿名';
  let player=state.players.find(p=>p.id===cleanId);
  if(player) {
    const timerKey=`${state.roomCode}:${player.id}`; const timer=disconnectTimers.get(timerKey);
    if(timer){clearTimeout(timer);disconnectTimers.delete(timerKey);}
    player.socketId=socket.id; player.connected=true; player.name=cleanName;
  }
  else {
    if(state.gameMode) return {ok:false,message:'该房间正在对局中。你可以创建新房间，或等待本局结束。'};
    if(state.players.length>=MAX_PLAYER) return {ok:false,message:'房间已满，最多 4 人。'};
    player={id:cleanId,socketId:socket.id,name:cleanName,seatIndex:firstOpenSeat(state),dice:[],cards:[],revolver:createRevolver(),alive:true,connected:true,eliminatedAt:null,stats:emptyStats(),quickMessage:null};
    state.players.push(player);
  }
  socket.join(channel(state)); socket.data.roomCode=state.roomCode; socket.data.playerId=player.id;
  if(!state.hostId) state.hostId=player.id;
  socket.emit('joined',{ok:true,playerId:player.id,roomId:state.roomCode,name:player.name,isHost:state.hostId===player.id});
  if(state.gameMode==='dice'&&player.dice.length) socket.emit('myDice',{dice:player.dice,reason:'reconnect'});
  if(state.gameMode==='card'&&player.cards.length) socket.emit('myCards',player.cards);
  emitState(state);
  return {ok:true};
}

io.on('connection',socket=>{
  socket.on('createRoom',(name,deviceId)=>{
    leaveCurrent(socket,false);
    const state=makeRoom(makeCode()); rooms.set(state.roomCode,state);
    addOrReconnect(socket,state,name,deviceId);
    roomEmit(state,'msg',`${String(name||'匿名').trim().slice(0,8)} 创建了房间。`);
  });

  socket.on('joinRoom',(code,name,deviceId)=>{
    const state=rooms.get(String(code||'').trim());
    if(!state) { socket.emit('joined',{ok:false,message:'房间不存在或已关闭，请检查房间号。'}); return; }
    if(socket.data.roomCode!==state.roomCode) leaveCurrent(socket,false);
    const result=addOrReconnect(socket,state,name,deviceId);
    if(!result.ok) socket.emit('joined',result);
    else roomEmit(state,'msg',`${String(name||'匿名').trim().slice(0,8)} 加入了房间。`);
  });

  socket.on('startGame',mode=>{
    const state=roomFor(socket); if(!state||state.hostId!==socket.data.playerId) return;
    if(!['dice','card'].includes(mode)||state.gameMode) return;
    if(state.players.length<2) { socket.emit('msg','至少 2 人才能开局。'); return; }
    state.players.sort((a,b)=>a.seatIndex-b.seatIndex);
    resetPlayers(state); state.gameMode=mode; state.turnStartedAt=Date.now();
    if(mode==='dice') startDiceRound(state,'start'); else startCardRound(state);
    roomEmit(state,'gameStarted',{mode}); roomEmit(state,'msg',mode==='dice'?'骰子模式开始。':'卡牌模式开始。'); emitState(state);
  });

  socket.on('chooseSeat',seatIndex=>{
    const state=roomFor(socket); if(!state||state.gameMode)return;
    const player=state.players.find(p=>p.id===socket.data.playerId); if(!player)return;
    seatIndex=Number.parseInt(seatIndex,10);
    if(!Number.isInteger(seatIndex)||seatIndex<0||seatIndex>=MAX_PLAYER){socket.emit('seatResult',{ok:false,message:'座位无效，请重新选择。'});return;}
    const occupied=state.players.find(p=>p.seatIndex===seatIndex&&p.id!==player.id);
    if(occupied){socket.emit('seatResult',{ok:false,message:`${occupied.name} 已坐在这个位置。`});return;}
    if(player.seatIndex===seatIndex){socket.emit('seatResult',{ok:true,seatIndex,message:'你已经在这个位置。'});return;}
    player.seatIndex=seatIndex;
    socket.emit('seatResult',{ok:true,seatIndex,message:`已换到 ${seatIndex+1} 号位。`});
    roomEmit(state,'msg',`${player.name} 换到了 ${seatIndex+1} 号位。`);
    emitState(state);
  });

  socket.on('bid',(quantity,face,action='normal')=>{
    const state=roomFor(socket); if(!state||state.gameMode!=='dice'||state.gameOver) return;
    const i=state.players.findIndex(p=>p.id===socket.data.playerId); if(i<0||i!==state.turnIndex||!state.players[i].alive) return;
    quantity=Number.parseInt(quantity,10); face=Number.parseInt(face,10);
    if(quantity>30){socket.emit('msg','报价数量不能超过 30。');return;}
    const v=validateBidTransition(state.currentBid,{quantity,face,exact:action==='exact',fly:action==='fly'},state.onesWild);
    if(!v.valid){socket.emit('msg',`报价不合法：${v.reason}`);return;}
    state.currentBid=[quantity,face]; state.onesWild=v.nextOnesWild; state.lastBidAction=v.transition; state.players[i].stats.bids+=1;
    const marker=v.transition==='fly'?'（飞）':v.transition.includes('exact')?'（摘）':'';
    roomEmit(state,'msg',`${state.players[i].name} 报价：${quantity} 个 ${face}${marker}`); nextTurn(state); emitState(state);
  });

  socket.on('doubt',()=>{
    const state=roomFor(socket); if(!state||state.gameMode!=='dice'||state.gameOver||!state.currentBid) return;
    const i=state.players.findIndex(p=>p.id===socket.data.playerId); if(i<0||i!==state.turnIndex||!state.players[i].alive) return;
    const doubter=state.players[i]; doubter.stats.doubts+=1;
    const [q,f]=state.currentBid; const result=checkDiceBid(state.players,q,f,state.onesWild); let victim;
    if(result.valid){victim=i;doubter.stats.failedDoubts+=1;roomEmit(state,'msg',`${doubter.name} 质疑失败，实际计数为 ${result.total}。`);}
    else{victim=prevAliveIdx(state,i);if(victim<0)return;doubter.stats.successfulDoubts+=1;roomEmit(state,'msg',`抓到骗子，实际只有 ${result.total} 个。`);}
    roomEmit(state,'diceReveal',{bid:state.currentBid.slice(),onesWild:state.onesWild,actualCount:result.total,valid:result.valid,players:state.players.filter(p=>p.alive).map(p=>{const c=classifyDiceHand(p.dice);return{id:p.id,name:p.name,dice:p.dice.slice(),leopardType:c.kind==='real-leopard'?'real':c.kind==='fake-leopard'?'fake':null};})});
    const shot=roulette(state,victim,{challengeSuccess:!result.valid,actualCount:result.total}); roomEmit(state,'msg',shot.isShot?`${shot.victimName} 中弹出局。`:`${shot.victimName} 扣下空枪，幸存。`);
    state.currentBid=null;
    if(!finishIfNeeded(state)){nextTurn(state);startDiceRound(state,'roulette');roomEmit(state,'msg','轮盘结算完成，所有存活玩家已经重摇骰子。');}
    emitState(state);
  });

  socket.on('playCards',cards=>{
    const state=roomFor(socket); if(!state||state.gameMode!=='card'||state.gameOver) return;
    const i=state.players.findIndex(p=>p.id===socket.data.playerId); if(i<0||i!==state.turnIndex||!state.players[i].alive) return;
    if(mustChallengeEmptyHand(state.players,state.lastPlay,state.turnIndex)){socket.emit('msg','对手已出完手牌，本回合必须质疑上一手。');return;}
    const selection=validateCardSelection(cards);
    if(!selection.valid){socket.emit('msg',selection.reason);return;}
    const hand=state.players[i].cards.slice();
    for(const c of cards){const pos=hand.indexOf(c);if(pos<0){socket.emit('msg','你手里没有这张牌。');return;}hand.splice(pos,1);}
    state.players[i].cards=hand; state.players[i].stats.cardsPlayed+=cards.length;
    const historyEntry={id:`${Date.now()}-${i}`,round:state.roundNumber,playerId:state.players[i].id,playerName:state.players[i].name,count:cards.length,cards:null,outcome:null};
    state.playHistory.push(historyEntry); state.lastPlay={playerIdx:i,cards:cards.slice(),historyId:historyEntry.id};
    socket.emit('myCards',hand); roomEmit(state,'msg',`${state.players[i].name} 暗着打出 ${cards.length} 张牌。`); nextTurn(state); emitState(state);
  });

  socket.on('doubtCard',()=>{
    const state=roomFor(socket); if(!state||state.gameMode!=='card'||state.gameOver||!state.lastPlay) return;
    const i=state.players.findIndex(p=>p.id===socket.data.playerId); if(i<0||i!==state.turnIndex||!state.players[i].alive) return;
    const doubter=state.players[i], last=state.lastPlay, lastPlayer=state.players[last.playerIdx]; doubter.stats.doubts+=1;
    roomEmit(state,'revealCards',{playerIdx:last.playerIdx,playerName:lastPlayer.name,cards:last.cards}); const check=checkCardPlay(last.cards,state.targetCard);
    const historyEntry=state.playHistory.find(entry=>entry.id===last.historyId); if(historyEntry){historyEntry.cards=last.cards.slice();historyEntry.outcome=check.valid?'true':'lie';}
    if(check.valid){
      doubter.stats.failedDoubts+=1;
      if(check.isDevil){roomEmit(state,'msg','恶魔牌生效，从触发者顺时针依次执行。');clockwiseAliveIndexes(state.players,last.playerIdx,MAX_PLAYER).forEach(index=>{const p=state.players[index];const r=roulette(state,index,{challengeSuccess:false,isDevil:true});roomEmit(state,'msg',r.isShot?`${p.name} 中弹出局。`:`${p.name} 扣下空枪，幸存。`);});}
      else{roomEmit(state,'msg',`出牌属实，${doubter.name} 质疑失败。`);const r=roulette(state,i,{challengeSuccess:false});roomEmit(state,'msg',r.isShot?`${doubter.name} 中弹出局。`:`${doubter.name} 扣下空枪，幸存。`);}
    }else{doubter.stats.successfulDoubts+=1;roomEmit(state,'msg',`${lastPlayer.name} 撒谎，被质疑成功。`);const r=roulette(state,last.playerIdx,{challengeSuccess:true});roomEmit(state,'msg',r.isShot?`${lastPlayer.name} 中弹出局。`:`${lastPlayer.name} 扣下空枪，幸存。`);}
    if(!finishIfNeeded(state)){
      ensureAliveTurn(state);
      startCardRound(state);
      roomEmit(state,'msg','新一轮已经发牌，目标牌已更新。');
    }
    emitState(state);
  });

  socket.on('toggleReady',()=>{
    const state=roomFor(socket); if(!state||!state.gameOver)return;
    const player=state.players.find(p=>p.id===socket.data.playerId); if(!player||!player.connected)return;
    const readyIndex=state.readyPlayerIds.indexOf(player.id);
    if(readyIndex>=0) state.readyPlayerIds.splice(readyIndex,1); else state.readyPlayerIds.push(player.id);
    const connected=state.players.filter(p=>p.connected);
    if(connected.length&&connected.every(p=>state.readyPlayerIds.includes(p.id))){resetLobby(state);roomEmit(state,'returnedToLobby');roomEmit(state,'msg','所有玩家已准备，可以开始下一局。');emitState(state);return;}
    roomEmit(state,'msg',`${player.name}${readyIndex>=0?'取消了准备':'已准备下一局'}。`); emitState(state);
  });

  socket.on('sendQuickMessage',value=>{
    const state=roomFor(socket); if(!state||!state.gameMode)return;
    const player=state.players.find(p=>p.id===socket.data.playerId); if(!player||!player.connected)return;
    const result=validateQuickMessage(value);
    if(!result.valid){socket.emit('quickMessageResult',result);return;}
    const id=`${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    player.quickMessage={id,text:result.text,expiresAt:Date.now()+30000};
    socket.emit('quickMessageResult',{valid:true,text:result.text}); emitState(state);
    setTimeout(()=>{
      const current=rooms.get(state.roomCode); const sender=current&&current.players.find(p=>p.id===player.id);
      if(!sender||!sender.quickMessage||sender.quickMessage.id!==id)return;
      sender.quickMessage=null; emitState(current);
    },30000);
  });
  socket.on('leaveRoom',()=>{leaveCurrent(socket,true);socket.emit('left');});
  socket.on('disconnect',()=>{
    const state=roomFor(socket); if(!state)return;
    const playerIndex=state.players.findIndex(x=>x.id===socket.data.playerId); const p=state.players[playerIndex]; if(!p)return;
    p.connected=false;p.socketId=null; emitState(state);
    if(state.gameMode&&!state.gameOver&&p.alive){
      const timerKey=`${state.roomCode}:${p.id}`;
      const timer=setTimeout(()=>{
        disconnectTimers.delete(timerKey);
        const current=rooms.get(state.roomCode); const stale=current&&current.players.find(x=>x.id===p.id);
        if(!current||!stale||stale.connected||current.gameOver||!stale.alive)return;
        const staleIndex=current.players.indexOf(stale); stale.alive=false;current.eliminationCounter+=1;stale.eliminatedAt=current.eliminationCounter;
        roomEmit(current,'msg',`${stale.name} 断线超时，已退出本局。`);
        if(current.hostId===stale.id)current.hostId=current.players.find(x=>x.connected)?.id||stale.id;
        if(current.turnIndex===staleIndex)nextTurn(current);finishIfNeeded(current);emitState(current);
      },12000);
      disconnectTimers.set(timerKey,timer);
    } else if(state.hostId===p.id) state.hostId=state.players.find(x=>x.connected)?.id||p.id;
    if(!state.gameMode) setTimeout(()=>{
      const current=rooms.get(state.roomCode); const stale=current&&current.players.find(x=>x.id===p.id);
      if(!current||!stale||stale.connected)return;
      const index=current.players.indexOf(stale); current.players.splice(index,1);
      if(current.hostId===stale.id) current.hostId=current.players.find(x=>x.connected)?.id||null;
      if(!current.players.length) rooms.delete(current.roomCode); else emitState(current);
    },60000);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('server run on port',PORT));
