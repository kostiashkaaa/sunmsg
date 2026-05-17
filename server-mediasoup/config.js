'use strict';

const os = require('os');

module.exports = {
  // HTTP API port (internal — not exposed to internet)
  apiPort: parseInt(process.env.MEDIASOUP_API_PORT || '3000', 10),

  // Secret shared with Flask for request authentication
  apiSecret: process.env.MEDIASOUP_API_SECRET || 'change_me_in_production',

  security: {
    // mediasoup terminates WebRTC transport encryption. Require callers to
    // explicitly declare Insertable Streams/SFrame-style frame encryption before
    // accepting media into the SFU path.
    requireE2ee: process.env.MEDIASOUP_REQUIRE_E2EE !== '0',
  },

  mediasoup: {
    // One worker per logical CPU, leaving 1-2 for Flask/coturn
    numWorkers: Math.max(1, Math.min(os.cpus().length - 1, 4)),

    workerSettings: {
      logLevel: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      rtcMinPort: parseInt(process.env.RTC_MIN_PORT || '40000', 10),
      rtcMaxPort: parseInt(process.env.RTC_MAX_PORT || '49999', 10),
    },

    routerOptions: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
          parameters: { 'sprop-stereo': 1 },
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: { 'x-google-start-bitrate': 1000 },
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: { 'profile-id': 2, 'x-google-start-bitrate': 1000 },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
      ],
    },

    webRtcTransportOptions: {
      listenInfos: [
        {
          protocol: 'udp',
          ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
          announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
        },
        {
          protocol: 'tcp',
          ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
          announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
        },
      ],
      initialAvailableOutgoingBitrate: 1_000_000,
      minimumAvailableOutgoingBitrate: 600_000,
      maxSctpMessageSize: 262144,
    },
  },
};
