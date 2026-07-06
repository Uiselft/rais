import http from "node:http"
import { WebSocketServer } from "ws"

// Railway provides PORT via env. Fall back to 8080 for local dev.
const PORT = process.env.PORT || 8080

// rooms: Map<roomId, Set<WebSocket>>
const rooms = new Map()

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

  ws.on("message", (raw) => {
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
