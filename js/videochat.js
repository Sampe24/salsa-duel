// Live "rival cam": a WebRTC video call between the two players during a match.
// Video only (each side's music plays locally). Signaling goes over the room's
// 'video' broadcast event. Handshake: both sides announce 'ready' when their
// camera is up; the host offers once both are ready, so no offer gets lost.

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export class VideoCall {
  constructor(room) {
    this.room = room;
    this.pc = null;
    this.started = false;
    this.peerReady = false;
    this.localStream = null;
    this.onRemoteStream = null;
  }

  async start(localStream, onRemoteStream) {
    this.localStream = localStream;
    this.onRemoteStream = onRemoteStream;

    this.room.onVideo = (p) => this._onSignal(p).catch((e) => console.warn('[videochat]', e.message));
    this.room.sendVideo({ kind: 'ready' });
    // If the peer's 'ready' arrived before ours was announced, the host may
    // need a nudge — re-announce once after a short delay.
    setTimeout(() => { if (!this.pc) this.room.sendVideo({ kind: 'ready' }); }, 1500);
  }

  _newPc() {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    for (const track of this.localStream.getVideoTracks()) pc.addTrack(track, this.localStream);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.room.sendVideo({ kind: 'ice', from: this.room.isHost ? 'h' : 'j', candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (e.streams[0]) this.onRemoteStream?.(e.streams[0]);
    };
    return pc;
  }

  async _onSignal(p) {
    const { room } = this;
    if (p.kind === 'ready') {
      this.peerReady = true;
      if (room.isHost && !this.started) {
        this.started = true;
        this.pc = this._newPc();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        room.sendVideo({ kind: 'offer', desc: this.pc.localDescription.toJSON() });
      }
    } else if (p.kind === 'offer' && !room.isHost) {
      this.pc = this._newPc();
      await this.pc.setRemoteDescription(p.desc);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      room.sendVideo({ kind: 'answer', desc: this.pc.localDescription.toJSON() });
    } else if (p.kind === 'answer' && room.isHost) {
      await this.pc.setRemoteDescription(p.desc);
    } else if (p.kind === 'ice') {
      // ignore our own relayed candidates
      const mine = this.room.isHost ? 'h' : 'j';
      if (p.from !== mine) await this.pc?.addIceCandidate(p.candidate).catch(() => {});
    }
  }

  stop() {
    this.room.onVideo = null;
    this.pc?.close();
    this.pc = null;
    this.started = false;
  }
}
