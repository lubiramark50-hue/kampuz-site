/* StreamCampus — WebRTC call engine.
 *
 * Builds a full peer-to-peer mesh and uses "perfect negotiation" so that two peers
 * adding tracks at the same moment cannot deadlock on glare. The signaling hub only
 * relays SDP/ICE; every media packet goes straight between browsers.
 */

const ICE_CONFIG = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
  // Modern browsers use unified-plan by default; stating it keeps older engines honest.
  sdpSemantics: 'unified-plan',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  // Prefer a direct path; fall back to relay only when needed.
  iceTransportPolicy: 'all',
};

export class CallEngine extends EventTarget {
  /**
   * @param {object} opts
   * @param {object} opts.hub      SignalR connection to /hubs/call
   * @param {string} opts.callId
   * @param {string} opts.selfId   current user id
   * @param {string} opts.selfConn current SignalR connection id
   */
  constructor({ hub, callId, selfId, selfConn }) {
    super();
    this.hub = hub;
    this.callId = callId;
    this.selfId = selfId;
    this.selfConn = selfConn;

    /** @type {Map<string, {pc: RTCPeerConnection, polite: boolean, makingOffer: boolean, ignoreOffer: boolean, stream: MediaStream|null, name: string, userId: string}>} */
    this.peers = new Map();
    this.localStream = null;
    this.screenStream = null;
    this.cameraTrack = null;
    this.micTrack = null;

    this.muted = false;
    this.cameraOff = false;
    this.sharing = false;
    this.closed = false;
  }

  // ───────────────────────────── local media ──────────────────────────────

  async startLocalMedia({ video = true, audio = true } = {}) {
    const constraints = {
      audio: audio
        ? {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        : false,
      video: video
        ? {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 30 },
            facingMode: 'user',
          }
        : false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this._adoptStream(stream);
    return stream;
  }

  _adoptStream(stream) {
    this.localStream = stream;
    this.micTrack = stream.getAudioTracks()[0] || null;
    this.cameraTrack = stream.getVideoTracks()[0] || null;

    if (this.micTrack) {
      this.micTrack.enabled = !this.muted;
      // If the user yanks the device (unplug / OS permission), reflect it in the UI.
      this.micTrack.onended = () => {
        this.micTrack = null;
        this._emit('devicelost', { kind: 'audio' });
      };
    }
    if (this.cameraTrack) {
      this.cameraTrack.enabled = !this.cameraOff;
      this.cameraTrack.onended = () => {
        this.cameraTrack = null;
        this._emit('devicelost', { kind: 'video' });
      };
    }

    // A peer connection can be created *before* getUserMedia resolves (the far side
    // may join while the permission prompt is still up). Those connections were built
    // without our tracks, so the remote end would hear and see nothing. Attach them
    // now; addTrack fires negotiationneeded and the renegotiation follows.
    for (const [, peer] of this.peers) {
      if (peer.pc.signalingState === 'closed') continue;
      for (const track of stream.getTracks()) {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch(() => {});
          continue;
        }
        const added = peer.pc.addTrack(track, stream);
        if (track.kind === 'video') added.__scVideo = true;
        if (track.kind === 'audio') added.__scAudio = true;
      }
    }
  }

  /** Replace the outgoing video track on every peer (screen share ⇄ camera, device switch). */
  async _replaceVideoTrack(newTrack) {
    for (const [, peer] of this.peers) {
      const sender = peer.pc.getSenders().find(s => s.track && s.track.kind === 'video')
        || peer.pc.getSenders().find(s => s.track === null && s.__scVideo);
      if (sender) {
        await sender.replaceTrack(newTrack).catch(() => {});
      } else if (newTrack && this.localStream) {
        peer.pc.addTrack(newTrack, this.localStream);
        this._negotiate(peer);
      }
    }
  }

  // ───────────────────────────── mesh membership ──────────────────────────

  /** Create (or reuse) a peer connection for a remote SignalR connection id. */
  addPeer(connectionId, { name = 'Student', userId = '' } = {}) {
    if (!connectionId || connectionId === this.selfConn) return null;
    if (this.peers.has(connectionId)) {
      const existing = this.peers.get(connectionId);
      if (name) existing.name = name;
      if (userId) existing.userId = userId;
      return existing;
    }

    const pc = new RTCPeerConnection(ICE_CONFIG);
    // Deterministic politeness: exactly one side of a pair yields during glare.
    const polite = String(this.selfConn) < String(connectionId);

    const peer = {
      pc, polite, makingOffer: false, ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      stream: null, name, userId, id: connectionId,
    };
    this.peers.set(connectionId, peer);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream);
        if (track.kind === 'video') sender.__scVideo = true;
      }
    }

    pc.onnegotiationneeded = () => this._negotiate(peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.hub.invoke('SendIce', this.callId, JSON.stringify(candidate), connectionId).catch(() => {});
      }
    };

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      peer.stream = stream;
      track.onmute = () => this._emit('trackmuted', { connectionId, kind: track.kind });
      track.onunmute = () => this._emit('trackunmuted', { connectionId, kind: track.kind });
      track.onended = () => this._emit('trackended', { connectionId, kind: track.kind });
      this._emit('track', { connectionId, stream, kind: track.kind, name: peer.name, userId: peer.userId });
    };

    pc.onconnectionstatechange = () => {
      this._emit('state', { connectionId, state: pc.connectionState });
      if (pc.connectionState === 'failed') this._restartIce(peer);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') this._restartIce(peer);
    };

    this._emit('peeradded', { connectionId, name, userId });
    return peer;
  }

  removePeer(connectionId) {
    const peer = this.peers.get(connectionId);
    if (!peer) return;
    try { peer.pc.close(); } catch {}
    this.peers.delete(connectionId);
    this._emit('peerremoved', { connectionId });
  }

  /** ICE restart keeps a call alive across Wi-Fi → mobile handover. */
  async _restartIce(peer) {
    if (this.closed || peer.pc.signalingState === 'closed') return;
    try {
      if (peer.polite) return;   // the impolite side drives the restart
      peer.makingOffer = true;
      const offer = await peer.pc.createOffer({ iceRestart: true });
      await peer.pc.setLocalDescription(offer);
      await this.hub.invoke('SendOffer', this.callId, JSON.stringify(peer.pc.localDescription), peer.id);
    } catch {
      // give up quietly — the UI shows "reconnecting" from connection state
    } finally {
      peer.makingOffer = false;
    }
  }

  // ─────────────────────────── perfect negotiation ────────────────────────

  async _negotiate(peer) {
    if (this.closed || peer.pc.signalingState === 'closed') return;
    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      await this.hub.invoke('SendOffer', this.callId, JSON.stringify(peer.pc.localDescription), peer.id);
    } catch (err) {
      console.warn('[call] negotiate failed', err);
    } finally {
      peer.makingOffer = false;
    }
  }

  async handleOffer(sdpJson, fromConnectionId) {
    const peer = this.peers.get(fromConnectionId) || this.addPeer(fromConnectionId);
    if (!peer) return;
    const pc = peer.pc;
    const description = JSON.parse(sdpJson);

    const readyForOffer = !peer.makingOffer
      && (pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
    const offerCollision = !readyForOffer;

    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) return;   // impolite peer wins the glare

    try {
      peer.isSettingRemoteAnswerPending = description.type === 'answer';
      await pc.setRemoteDescription(description);
      peer.isSettingRemoteAnswerPending = false;

      if (description.type === 'offer') {
        await pc.setLocalDescription();
        await this.hub.invoke('SendAnswer', this.callId, JSON.stringify(pc.localDescription), fromConnectionId);
      }
    } catch (err) {
      console.warn('[call] offer handling failed', err);
    }
  }

  async handleAnswer(sdpJson, fromConnectionId) {
    const peer = this.peers.get(fromConnectionId);
    if (!peer) return;
    try {
      await peer.pc.setRemoteDescription(JSON.parse(sdpJson));
    } catch (err) {
      console.warn('[call] answer handling failed', err);
    }
  }

  async handleIce(candidateJson, fromConnectionId) {
    const peer = this.peers.get(fromConnectionId);
    if (!peer) return;
    try {
      await peer.pc.addIceCandidate(JSON.parse(candidateJson));
    } catch (err) {
      // A candidate that arrives for a rejected offer is expected noise.
      if (!peer.ignoreOffer) console.debug('[call] ice add failed', err?.message);
    }
  }

  /**
   * Hub subscriptions are owned by the call UI, not here, so that signalling that
   * arrives *before* the engine exists (the peer can answer faster than we finish
   * getUserMedia) is buffered instead of silently dropped. See `flushSignals`.
   */
  async handleRenegotiate(fromConnectionId) {
    const peer = this.peers.get(fromConnectionId) || this.addPeer(fromConnectionId);
    if (peer) await this._negotiate(peer);
  }

  // ───────────────────────────── controls ─────────────────────────────────

  setMuted(muted) {
    this.muted = muted;
    if (this.micTrack) this.micTrack.enabled = !muted;
    else if (!muted) return this._reacquireAudio();
    this._pushMediaState();
    return Promise.resolve();
  }

  setCameraOff(off) {
    this.cameraOff = off;
    if (this.cameraTrack) this.cameraTrack.enabled = !off;
    else if (!off) return this._reacquireVideo();
    this._pushMediaState();
    return Promise.resolve();
  }

  async _reacquireAudio() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = s.getAudioTracks()[0];
      if (!track) return;
      if (this.micTrack) this.micTrack.stop();
      this.micTrack = track;
      this.localStream?.addTrack(track);
      for (const [, peer] of this.peers) {
        const sender = peer.pc.getSenders().find(x => x.track?.kind === 'audio')
          || peer.pc.getSenders().find(x => x.__scAudio);
        if (sender) { sender.__scAudio = true; await sender.replaceTrack(track); }
        else { peer.pc.addTrack(track, this.localStream); }
      }
      this.setMuted(false);
    } catch (e) { this._emit('error', { scope: 'audio', message: e.message }); }
  }

  async _reacquireVideo() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      const track = s.getVideoTracks()[0];
      if (!track) return;
      if (this.cameraTrack) this.cameraTrack.stop();
      this.cameraTrack = track;
      this.localStream?.addTrack(track);
      await this._replaceVideoTrack(track);
      this.setCameraOff(false);
    } catch (e) { this._emit('error', { scope: 'camera', message: e.message }); }
  }

  async toggleScreenShare() {
    if (!navigator.mediaDevices.getDisplayMedia) throw new Error('Screen sharing is not supported on this device.');

    if (this.sharing) {
      this.sharing = false;
      this.screenStream?.getTracks().forEach(t => t.stop());
      this.screenStream = null;
      if (this.cameraTrack) await this._replaceVideoTrack(this.cameraTrack);
      this._pushMediaState();
      this._emit('screenshare', { active: false });
      return false;
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: false,
    });
    this.screenStream = stream;
    this.sharing = true;
    const track = stream.getVideoTracks()[0];
    track.onended = () => { this.toggleScreenShare().catch(() => {}); };   // browser "Stop sharing" bar
    await this._replaceVideoTrack(track);
    this._pushMediaState();
    this._emit('screenshare', { active: true, stream });
    return true;
  }

  /** Flip between front and rear camera on phones. */
  async switchCamera() {
    if (!this.cameraTrack) return;
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter(d => d.kind === 'videoinput');
    if (devices.length < 2) return;

    const settings = this.cameraTrack.getSettings();
    const idx = devices.findIndex(d => d.deviceId === settings.deviceId);
    const next = devices[(idx + 1) % devices.length];

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: next.deviceId }, width: 1280, height: 720 },
    });
    const track = stream.getVideoTracks()[0];
    this.cameraTrack.stop();
    this.cameraTrack = track;
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(t => this.localStream.removeTrack(t));
      this.localStream.addTrack(track);
    }
    await this._replaceVideoTrack(track);
    this._emit('localstream', { stream: this.localStream });
  }

  _pushMediaState() {
    this.hub.invoke('SetMediaState', this.callId, this.muted, this.cameraOff, this.sharing).catch(() => {});
  }

  /** Round-trip stats for the "connection quality" pill. */
  async quality() {
    const results = [];
    for (const [connectionId, peer] of this.peers) {
      try {
        const stats = await peer.pc.getStats();
        let rtt = null, loss = 0, packets = 0;
        stats.forEach(r => {
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
            rtt = Math.round(r.currentRoundTripTime * 1000);
          }
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            loss += r.packetsLost || 0;
            packets += r.packetsReceived || 0;
          }
        });
        const lossPct = packets ? (loss / (packets + loss)) * 100 : 0;
        results.push({
          connectionId, rtt, lossPct,
          level: rtt == null ? 'unknown' : rtt < 150 && lossPct < 2 ? 'good' : rtt < 350 && lossPct < 6 ? 'fair' : 'poor',
        });
      } catch {
        results.push({ connectionId, rtt: null, lossPct: 0, level: 'unknown' });
      }
    }
    return results;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const [, peer] of this.peers) {
      try { peer.pc.close(); } catch {}
    }
    this.peers.clear();
    this.screenStream?.getTracks().forEach(t => t.stop());
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this._emit('closed', {});
  }
}

export const mediaSupported = () =>
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

export const enumerate = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return { cameras: [], mics: [], speakers: [] };
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter(d => d.kind === 'videoinput'),
    mics: devices.filter(d => d.kind === 'audioinput'),
    speakers: devices.filter(d => d.kind === 'audiooutput'),
  };
};
