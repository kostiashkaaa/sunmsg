'use strict';

const express = require('express');
const mediasoup = require('mediasoup');
const config = require('./config');
const roomManager = require('./room-manager');

const app = express();
app.use(express.json());

function hasE2eeDeclaration(appData) {
  return Boolean(appData && appData.e2ee === true);
}

// ── Auth middleware ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const secret = req.headers['x-mediasoup-secret'];
  if (secret !== config.apiSecret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});


// ── Worker pool ──────────────────────────────────────────────────────────────
async function createWorkers() {
  const workers = [];
  for (let i = 0; i < config.mediasoup.numWorkers; i++) {
    const worker = await mediasoup.createWorker(config.mediasoup.workerSettings);
    worker.on('died', () => {
      console.error(`mediasoup worker ${worker.pid} died — restarting in 2s`);
      setTimeout(async () => {
        const newWorker = await mediasoup.createWorker(config.mediasoup.workerSettings);
        const idx = workers.indexOf(worker);
        if (idx !== -1) workers.splice(idx, 1, newWorker);
        roomManager.setWorkers(workers);
      }, 2000);
    });
    workers.push(worker);
    console.log(`Worker spawned pid=${worker.pid}`);
  }
  return workers;
}


// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Liveness probe.
 */
app.get('/health', (req, res) => {
  res.json({ ok: true, e2eeRequired: config.security.requireE2ee, ...roomManager.stats() });
});


/**
 * POST /rooms/:roomId
 * Create a room (idempotent).
 * Body: {} (optional)
 */
app.post('/rooms/:roomId', async (req, res) => {
  try {
    const room = await roomManager.createRoom(req.params.roomId, config.mediasoup.routerOptions);
    res.json({ roomId: room.roomId, rtpCapabilities: room.getRtpCapabilities() });
  } catch (err) {
    console.error('POST /rooms error', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * DELETE /rooms/:roomId
 * Tear down a room when the call ends.
 */
app.delete('/rooms/:roomId', (req, res) => {
  roomManager.deleteRoom(req.params.roomId);
  res.json({ ok: true });
});


/**
 * GET /rooms/:roomId/rtp-capabilities
 */
app.get('/rooms/:roomId/rtp-capabilities', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  res.json({ rtpCapabilities: room.getRtpCapabilities() });
});


/**
 * POST /rooms/:roomId/transports
 * Create a WebRTC transport for a peer.
 * Body: { userId }
 */
app.post('/rooms/:roomId/transports', async (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'missing_user_id' });

  try {
    const transport = await room.createWebRtcTransport(userId, config.mediasoup.webRtcTransportOptions);
    res.json({
      transportId: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
  } catch (err) {
    console.error('POST /transports error', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /rooms/:roomId/transports/:transportId/connect
 * Connect transport with DTLS params from the client.
 * Body: { dtlsParameters }
 */
app.post('/rooms/:roomId/transports/:transportId/connect', async (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });

  const { dtlsParameters } = req.body;
  if (!dtlsParameters) return res.status(400).json({ error: 'missing_dtls_parameters' });

  try {
    await room.connectTransport(req.params.transportId, dtlsParameters);
    res.json({ ok: true });
  } catch (err) {
    console.error('connect transport error', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /rooms/:roomId/produce
 * Start producing (sending) media.
 * Body: { userId, transportId, kind, rtpParameters, appData? }
 */
app.post('/rooms/:roomId/produce', async (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });

  const { userId, transportId, kind, rtpParameters, appData } = req.body;
  if (!userId || !transportId || !kind || !rtpParameters) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  if (config.security.requireE2ee && !hasE2eeDeclaration(appData)) {
    return res.status(428).json({
      error: 'e2ee_required',
      detail: 'mediasoup is disabled for non-E2EE media; set appData.e2ee=true only for frame-encrypted tracks',
    });
  }

  try {
    const producer = await room.produce(userId, transportId, kind, rtpParameters, appData || {});
    const existingProducers = room.getProducersExceptUser(userId);
    res.json({ producerId: producer.id, existingProducers });
  } catch (err) {
    console.error('produce error', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /rooms/:roomId/consume
 * Start consuming (receiving) a remote track.
 * Body: { userId, transportId, producerId, rtpCapabilities }
 */
app.post('/rooms/:roomId/consume', async (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });

  const { userId, transportId, producerId, rtpCapabilities } = req.body;
  if (!userId || !transportId || !producerId || !rtpCapabilities) {
    return res.status(400).json({ error: 'missing_fields' });
  }

  try {
    const consumer = await room.consume(userId, transportId, producerId, rtpCapabilities);
    res.json({
      consumerId: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });
  } catch (err) {
    console.error('consume error', err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * POST /rooms/:roomId/peers/:userId/leave
 * Remove a peer from the room.
 */
app.post('/rooms/:roomId/peers/:userId/leave', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });

  room.removePeer(req.params.userId);
  if (room.isEmpty()) {
    roomManager.deleteRoom(req.params.roomId);
  }
  res.json({ ok: true });
});


/**
 * GET /rooms/:roomId/producers
 * List active producers in the room (for a joining peer to subscribe to).
 * Query: ?exclude_user_id=<userId>
 */
app.get('/rooms/:roomId/producers', (req, res) => {
  const room = roomManager.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });

  const excludeUserId = req.query.exclude_user_id || null;
  const producers = room.getProducersExceptUser(excludeUserId);
  res.json({ producers });
});


// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  const workers = await createWorkers();
  roomManager.setWorkers(workers);

  app.listen(config.apiPort, '127.0.0.1', () => {
    console.log(`mediasoup API listening on 127.0.0.1:${config.apiPort}`);
    console.log(`Workers: ${workers.length}`);
  });
})();
