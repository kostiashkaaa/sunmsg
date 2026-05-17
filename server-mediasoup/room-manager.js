'use strict';

const { v4: uuidv4 } = require('uuid');

class Room {
  constructor(roomId, router) {
    this.roomId = roomId;
    this.router = router;
    this.transports = new Map();   // transportId → transport
    this.producers = new Map();    // producerId → producer
    this.consumers = new Map();    // consumerId → consumer
    this.peers = new Map();        // userId → { transportIds[], producerIds[], consumerIds[] }
    this.createdAt = Date.now();
  }

  addPeer(userId) {
    if (!this.peers.has(userId)) {
      this.peers.set(userId, { transportIds: [], producerIds: [], consumerIds: [] });
    }
    return this.peers.get(userId);
  }

  removePeer(userId) {
    const peer = this.peers.get(userId);
    if (!peer) return;

    for (const tid of peer.transportIds) {
      const t = this.transports.get(tid);
      if (t) { t.close(); this.transports.delete(tid); }
    }
    for (const pid of peer.producerIds) {
      const p = this.producers.get(pid);
      if (p) { p.close(); this.producers.delete(pid); }
    }
    for (const cid of peer.consumerIds) {
      const c = this.consumers.get(cid);
      if (c) { c.close(); this.consumers.delete(cid); }
    }
    this.peers.delete(userId);
  }

  isEmpty() {
    return this.peers.size === 0;
  }

  getRtpCapabilities() {
    return this.router.rtpCapabilities;
  }

  async createWebRtcTransport(userId, config) {
    const transport = await this.router.createWebRtcTransport(config);
    this.transports.set(transport.id, transport);

    const peer = this.addPeer(userId);
    peer.transportIds.push(transport.id);

    transport.on('dtlsstatechange', (state) => {
      if (state === 'closed') {
        this.transports.delete(transport.id);
      }
    });

    return transport;
  }

  async connectTransport(transportId, dtlsParameters) {
    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);
    await transport.connect({ dtlsParameters });
  }

  async produce(userId, transportId, kind, rtpParameters, appData) {
    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const producerAppData = {
      ...(appData || {}),
      e2ee: Boolean(appData && appData.e2ee === true),
    };
    const producer = await transport.produce({ kind, rtpParameters, appData: producerAppData });
    this.producers.set(producer.id, producer);

    const peer = this.peers.get(userId);
    if (peer) peer.producerIds.push(producer.id);

    producer.on('transportclose', () => {
      this.producers.delete(producer.id);
    });

    return producer;
  }

  async consume(userId, transportId, producerId, rtpCapabilities) {
    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const producer = this.producers.get(producerId);
    if (!producer) throw new Error(`Producer ${producerId} not found`);

    if (!this.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume: incompatible RTP capabilities');
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false,
    });
    this.consumers.set(consumer.id, consumer);

    const peer = this.peers.get(userId);
    if (peer) peer.consumerIds.push(consumer.id);

    consumer.on('transportclose', () => {
      this.consumers.delete(consumer.id);
    });
    consumer.on('producerclose', () => {
      this.consumers.delete(consumer.id);
    });

    return consumer;
  }

  getProducersExceptUser(userId) {
    const result = [];
    for (const [peerId, peer] of this.peers) {
      if (peerId === userId) continue;
      for (const pid of peer.producerIds) {
        const producer = this.producers.get(pid);
        if (producer && !producer.closed) {
          result.push({
            producerId: pid,
            userId: peerId,
            kind: producer.kind,
            e2ee: producer.appData?.e2ee === true,
          });
        }
      }
    }
    return result;
  }

  close() {
    this.router.close();
  }
}


class RoomManager {
  constructor() {
    this._rooms = new Map();  // roomId → Room
    this._workers = [];
    this._workerIndex = 0;
  }

  setWorkers(workers) {
    this._workers = workers;
  }

  _nextWorker() {
    if (this._workers.length === 0) throw new Error('No mediasoup workers available');
    const worker = this._workers[this._workerIndex % this._workers.length];
    this._workerIndex++;
    return worker;
  }

  async createRoom(roomId, routerOptions) {
    if (this._rooms.has(roomId)) return this._rooms.get(roomId);
    const worker = this._nextWorker();
    const router = await worker.createRouter(routerOptions);
    const room = new Room(roomId, router);
    this._rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId) {
    return this._rooms.get(roomId) || null;
  }

  deleteRoom(roomId) {
    const room = this._rooms.get(roomId);
    if (room) {
      room.close();
      this._rooms.delete(roomId);
    }
  }

  stats() {
    return {
      rooms: this._rooms.size,
      workers: this._workers.length,
    };
  }
}

module.exports = new RoomManager();
