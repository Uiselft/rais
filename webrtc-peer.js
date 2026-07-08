import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } from 'wrtc';

export default class WebRTCPeer {
  constructor(onMessage) {
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] },
      ],
    });

    this.onMessage = onMessage;
    this.dataChannel = null;

    // Когда браузер создаёт DataChannel, мы его получаем
    this.pc.ondatachannel = (event) => {
      console.log('[WebRTC] Получен DataChannel от браузера');
      this.setupDataChannel(event.channel);
    };

    // Логируем ICE кандидаты
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTC] ICE candidate:', event.candidate.candidate);
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', this.pc.connectionState);
    };
  }

  setupDataChannel(channel) {
    this.dataChannel = channel;

    channel.onopen = () => {
      console.log('[WebRTC] DataChannel открыт!');
    };

    channel.onmessage = (event) => {
      console.log('[WebRTC] Сообщение от браузера:', event.data);
      if (this.onMessage) {
        this.onMessage(event.data, channel);
      }
    };

    channel.onclose = () => {
      console.log('[WebRTC] DataChannel закрыт');
    };

    channel.onerror = (error) => {
      console.error('[WebRTC] DataChannel ошибка:', error);
    };
  }

  async createOffer() {
    try {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      console.log('[WebRTC] Offer создан');
      return this.pc.localDescription;
    } catch (err) {
      console.error('[WebRTC] Ошибка при создании offer:', err);
      throw err;
    }
  }

  async handleAnswer(answer) {
    try {
      const rtcAnswer = new RTCSessionDescription(answer);
      await this.pc.setRemoteDescription(rtcAnswer);
      console.log('[WebRTC] Answer установлен');
    } catch (err) {
      console.error('[WebRTC] Ошибка при обработке answer:', err);
      throw err;
    }
  }

  addIceCandidate(candidate) {
    if (candidate && candidate.candidate) {
      this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  send(data) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(JSON.stringify(data));
    }
  }

  close() {
    if (this.pc) {
      this.pc.close();
    }
  }
}
