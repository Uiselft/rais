import http from "node:http"
import { WebSocketServer } from "ws"
import WebRTCPeer from "./webrtc-peer.js"

// Railway provides PORT via env. Fall back to 8080 for local dev.
const PORT = process.env.PORT || 8080

// rooms: Map<roomId, Set<WebSocket>>
const rooms = new Map()

// WebRTC peer (для букмарклета, который хочет обойти CSP)
let rtcPeer = null

// A tiny HTTP server so Railway health checks (and a browser hitting the URL)
// get a friendly response. The WebSocket server shares this same server.
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
    return
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
  res.end("WebRTC signaling server is running. Connect via WebSocket.\n")
})

const wss = new WebSocketServer({ server })

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj))
}

// Broadcast to everyone in the room except the sender.
function relay(roomId, sender, obj) {
  const peers = rooms.get(roomId)
  if (!peers) return
  for (const peer of peers) {
    if (peer !== sender) send(peer, obj)
  }
}

wss.on("connection", (ws) => {
  ws.roomId = null

  ws.on("message", async (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return // ignore malformed messages
    }

    switch (msg.type) {
      case "join": {
        const roomId = String(msg.room || "default")
        ws.roomId = roomId
        if (!rooms.has(roomId)) rooms.set(roomId, new Set())
        const peers = rooms.get(roomId)
        peers.add(ws)

        // Tell the newcomer how many peers are already here.
        // The 2nd peer to join is responsible for creating the offer.
        const others = peers.size - 1
        send(ws, { type: "joined", room: roomId, peers: others })
        // Let existing peers know someone arrived.
        relay(roomId, ws, { type: "peer-joined", peers: peers.size })
        break
      }

      // Forward WebRTC handshake messages to the other peer(s) in the room.
      case "offer":
      case "answer":
      case "ice": {
        if (ws.roomId) relay(ws.roomId, ws, msg)
        break
      }

      // WebRTC peer mode (для букмарклета через DataChannel)
      case "webrtc-connect": {
        console.log("[signaling] Букмарклет хочет подключиться через WebRTC");

        // Закрываем предыдущий пир если есть
        if (rtcPeer) {
          try { rtcPeer.close(); } catch (_) {}
          rtcPeer = null;
        }

        rtcPeer = new WebRTCPeer((data, channel) => {
          console.log("[signaling] Получено от букмарклета через DataChannel:", data);
          try {
            const parsed = JSON.parse(data);
            if (parsed.action === "ping") {
              channel.sendMessage(
                JSON.stringify({
                  action: "pong",
                  message: "hello ты получил ответ от моего сервера (через WebRTC!)",
                  timestamp: new Date().toISOString(),
                })
              );
            }
          } catch (err) {
            console.error("Ошибка парсинга:", err);
          }
        });

        // Пробрасываем ICE кандидаты сервера обратно в браузер
        rtcPeer.onIceCandidate = (candidate) => {
          send(ws, { type: "webrtc-ice", candidate });
        };

        // Создаём offer и отправляем браузеру
        try {
          const offer = await rtcPeer.createOffer();
          send(ws, { type: "webrtc-offer", offer });
        } catch (err) {
          console.error("Ошибка создания offer:", err);
          send(ws, { type: "error", message: "Failed to create offer" });
        }
        break;
      }

      // Браузер отправляет answer
      case "webrtc-answer": {
        console.log("[signaling] Получен answer от букмарклета");
        if (rtcPeer && msg.answer) {
          try {
            await rtcPeer.handleAnswer(msg.answer);
          } catch (err) {
            console.error("Ошибка установки answer:", err);
          }
        }
        break;
      }

      // ICE кандидаты для WebRTC
      case "webrtc-ice": {
        if (rtcPeer && msg.candidate) {
          try {
            rtcPeer.addIceCandidate(msg.candidate);
          } catch (err) {
            console.error("Ошибка добавления ICE candidate:", err);
          }
        }
        break;
      }

      default:
        break
    }
  })

  ws.on("close", () => {
    const roomId = ws.roomId
    if (!roomId) return
    const peers = rooms.get(roomId)
    if (!peers) return
    peers.delete(ws)
    if (peers.size === 0) rooms.delete(roomId)
    else relay(roomId, ws, { type: "peer-left", peers: peers.size })
  })
})

server.listen(PORT, () => {
  console.log(`[signaling] listening on port ${PORT}`)
})

