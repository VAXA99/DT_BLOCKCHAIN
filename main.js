'use strict';

class Block {
  constructor(index, previousHash, timestamp, data, hash, difficulty, nonce) {
    this.index = index;
    this.previousHash = previousHash.toString();
    this.timestamp = timestamp;
    this.data = data;
    this.hash = hash.toString();
    this.difficulty = difficulty;
    this.nonce = nonce;
  }
}

var CryptoJS = require('crypto-js');
var express = require('express');
var bodyParser = require('body-parser');
var WebSocket = require('ws');

var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];
var difficulty = 6;

var sockets = [];
var MessageType = {
  QUERY_LATEST: 0,
  QUERY_ALL: 1,
  RESPONSE_BLOCKCHAIN: 2,
};

var blockchain = [getGenesisBlock()];

// Инициализация Блокчейна
var getGenesisBlock = () => {
  return new Block(
    0,
    '0',
    1682839690,
    'RUT-MIIT first block',
    '8d9d5a7ff4a78042ea6737bf59c772f8ed27ef3c9b576eac1976c91aaf48d2de',
    0,
    0
  );
}

// Инициализация HTTP-сервера 
var initHttpServer = () => {
  var app = express();
  app.use(bodyParser.json());
  
  app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain)));

  app.post('/mineBlock', (req, res) => {
    var newBlock = mineBlock(req.body.data);
    addBlock(newBlock);
    broadcast(responseLatestMsg());
    console.log('Block added: ' + JSON.stringify(newBlock));
    res.send();
  });

  app.get('/peers', (req, res) => {
    res.send(sockets.map((s) => s._socket.remoteAddress + ':' + s._socket.remotePort));
  });

  app.post('/addPeer', (req, res) => {
    connectToPeers([req.body.peer]);
    res.send();
  });

  app.listen(http_port, () => console.log('Listening http on port: ' + http_port));
}

var isMiningConditionMet = (hash) => {
    const firstSixCharacters = hash.substring(0, 6);
    let sum = 0;
  
    // Вычисляем сумму ASCII кодов символов первых шести символов
    for (let i = 0; i < firstSixCharacters.length; i++) {
      sum += firstSixCharacters.charCodeAt(i);
    }
  
    // Проверяем, является ли сумма кратной 10
    return sum % 10 === 0;
  }


// Майнинг нового блока
var mineBlock = (blockData) => {
  var previousBlock = getLatestBlock();
  var nextIndex = previousBlock.index + 1;
  var nonce = 0;
  var nextTimestamp = new Date().getTime() / 1000;
  var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData, nonce);

  while (!isMiningConditionMet(nextHash.substring(0, difficulty))) {
    nonce++;
    nextTimestamp = new Date().getTime() / 1000;
    nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData, nonce);

    console.log(
      '"index":' +
        nextIndex +
        ',"previousHash":' +
        previousBlock.hash +
        '"timestamp":' +
        nextTimestamp +
        ',"data":' +
        blockData +
        ',\x1b[33mhash: ' +
        nextHash +
        ' \x1b[0m,' +
        '"difficulty":' +
        difficulty +
        ' \x1b[33mnonce: ' +
        nonce +
        ' \x1b[0m '
    );
  }

  return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash, difficulty, nonce);
}

// Инициализация P2P-сервера
var initP2PServer = () => {
  var server = new WebSocket.Server({ port: p2p_port });
  server.on('connection', (ws) => initConnection(ws));
  console.log('Listening websocket p2p port on: ' + p2p_port);
}

// Инициализация нового соединения
var initConnection = (ws) => {
  sockets.push(ws);
  initMessageHandler(ws);
  initErrorHandler(ws);
  write(ws, queryChainLengthMsg());
}

// Обработка полученных сообщений
var initMessageHandler = (ws) => {
  ws.on('message', (data) => {
    var message = JSON.parse(data);
    console.log('Received message' + JSON.stringify(message));
    switch (message.type) {
      case MessageType.QUERY_LATEST:
        write(ws, responseLatestMsg());
        break;
      case MessageType.QUERY_ALL:
        write(ws, responseChainMsg());
        break;
      case MessageType.RESPONSE_BLOCKCHAIN:
        handleBlockchainResponse(message);
        break;
    }
  });
}

// Обработка ошибок соединения
var initErrorHandler = (ws) => {
  function closeConnection(ws) {
    console.log('Connection failed to peer: ' + ws.url);
    sockets.splice(sockets.indexOf(ws), 1);
  }

  ws.on('close', () => closeConnection(ws));
  ws.on('error', () => closeConnection(ws));
}

// Подключение к новым пирам
var connectToPeers = (newPeers) => {
  newPeers.forEach((peer) => {
    var ws = new WebSocket(peer);
    ws.on('open', () => initConnection(ws));
    ws.on('error', () => {
      console.log('Connection failed');
    });
  });
}

// Обработка блокчейн-ответов от пиров
var handleBlockchainResponse = (message) => {
  var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => b1.index - b2.index);
  var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
  var latestBlockHeld = getLatestBlock();

  if (latestBlockReceived.index > latestBlockHeld.index) {
    console.log(
      'Blockchain possibly behind. We got: ' +
        latestBlockHeld.index +
        ' Peer got: ' +
        latestBlockReceived.index
    );

    if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
      console.log('We can append the received block to our chain');
      blockchain.push(latestBlockReceived);
      broadcast(responseLatestMsg());
    } else if (receivedBlocks.length === 1) {
      console.log('We have to query the chain from our peer');
      broadcast(queryAllMsg());
    } else {
      console.log('Received blockchain is longer than current blockchain');
      replaceChain(receivedBlocks);
    }
  } else {
    console.log('Received blockchain is not longer than current blockchain. Do nothing');
  }
}

// Создание следуюшего блока
var generateNextBlock = (blockData) => {
  var previousBlock = getLatestBlock();
  var nextIndex = previousBlock.index + 1;
  var nextTimestamp = new Date().getTime() / 1000;
  var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData);

  return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash);
}

// Вычисление хэша для блока
var calculateHashForBlock = (block) => {
  return calculateHash(block.index, block.previousHash, block.timestamp, block.data, block.nonce);
}

// Вычисление хэша для блока (CryptoJS)
var calculateHash = (index, previousHash, timestamp, data, nonce) => {
  return CryptoJS.SHA256(index + previousHash + timestamp + data, nonce).toString();
}

// Добавление нового блока в блокчейн 
var addBlock = (newBlock) => {
  if (isValidNewBlock(newBlock, getLatestBlock())) {
    blockchain.push(newBlock);
  }
}

// Проверка нового блока
var isValidNewBlock = (newBlock, previousBlock) => {
  if (previousBlock.index + 1 !== newBlock.index) {
    console.log('Invalid index');
    return false;
  } else if (previousBlock.hash !== newBlock.previousHash) {
    console.log('Invalid previoushash');
    return false;
  } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
    console.log(
      typeof newBlock.hash +
        ' ' +
        typeof calculateHashForBlock(newBlock) +
        'Invalid hash: ' +
        calculateHashForBlock(newBlock) +
        ' ' +
        newBlock.hash
    );
    return false;
  }
  return true;
}

// Замещение старого блокчейна новым
var replaceChain = (newBlocks) => {
  if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
    console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
    blockchain = newBlocks;
    broadcast(responseLatestMsg());
  } else {
    console.log('Received blockchain invalid');
  }
}

// Проверка цепи
var isValidChain = (blockchainToValidate) => {
  if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
    return false;
  }
  var tempBlocks = [blockchainToValidate[0]];
  for (var i = 1; i < blockchainToValidate.length; i++) {
    if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
      tempBlocks.push(blockchainToValidate[i]);
    } else {
      return false;
    }
  }
  return true;
}

// Получение последнего блока в цепи
var getLatestBlock = () => {
  return blockchain[blockchain.length - 1];
}

// Создание сообщения запроса для последнего блока
var queryChainLengthMsg = () => {
  return { type: MessageType.QUERY_LATEST };
}

// Создание сообщения запроса для всего блокчейна
var queryAllMsg = () => {
  return { type: MessageType.QUERY_ALL };
}

// Создание ответного сообщения для блокчейна
var responseChainMsg = () => {
  return {
    type: MessageType.RESPONSE_BLOCKCHAIN,
    data: JSON.stringify(blockchain),
  };
}

// Создание ответного сообщения для последнего блока в цепи 
var responseLatestMsg = () => {
  return {
    type: MessageType.RESPONSE_BLOCKCHAIN,
    data: JSON.stringify([getLatestBlock()]),
  };
}

// Отправка сообщения в WebSocket
var write = (ws, message) => {
  ws.send(JSON.stringify(message));
}

// Рассылка сообщения всем пирам
var broadcast = (message) => {
  sockets.forEach((socket) => write(socket, message));
}

// Подключение к начальным пирам
connectToPeers(initialPeers);

// Инициализация HTTP-сервера, P2P-сервера
initHttpServer();
initP2PServer();