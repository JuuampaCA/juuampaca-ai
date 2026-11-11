
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json());

if (!process.env.SESSION_SECRET) {
  throw new Error("Falta configurar SESSION_SECRET en Render.");
}

app.use(session({
  name: "juuampaca.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 1000
  }
}));

// Estado temporal del chat
let chatSocket = null;
let chatAccount = null;
let chatMessages = [];
let reconnectTimer = null;

function addMessage(message) {
  chatMessages.push({
    user: message.chatter_user_name,
    text: message.message.text,
    time: new Date().toISOString()
  });

  if (chatMessages.length > 100) {
    chatMessages.shift();
  }

  console.log(
    `[CHAT] ${message.chatter_user_name}: ${message.message.text}`
  );
}

// Conectar con Twitch EventSub
async function connectChat(accessToken, userId) {
  if (chatSocket) {
    chatSocket.removeAllListeners();
    chatSocket.close();
    chatSocket = null;
  }

  clearTimeout(reconnectTimer);

  const socket = new WebSocket(
    "wss://eventsub.wss.twitch.tv/ws"
  );

  chatSocket = socket;

  socket.on("open", () => {
    console.log("Conectando con Twitch EventSub...");
  });

  socket.on("message", async (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const type = data.metadata.message_type;

      if (type === "session_welcome") {
        const sessionId = data.payload.session.id;

        console.log("Sesión EventSub conectada.");

        const response = await fetch(
          "https://api.twitch.tv/helix/eventsub/subscriptions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Client-Id": process.env.TWITCH_CLIENT_ID,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              type: "channel.chat.message",
              version: "1",
              condition: {
                broadcaster_user_id: userId,
                user_id: userId
              },
              transport: {
                method: "websocket",
                session_id: sessionId
              }
            })
          }
        );

        if (!response.ok) {
          const error = await response.text();
          console.error("Error al suscribirse al chat:", error);
          return;
        }

        console.log("¡Escuchando el chat de juuampaca!");
      }

      if (type === "notification") {
        if (
          data.metadata.subscription_type === "channel.chat.message"
        ) {
          addMessage(data.payload.event);
        }
      }

      if (type === "session_reconnect") {
        console.log("Twitch solicita reconectar la sesión.");
      }

      if (type === "revocation") {
        console.log("Twitch revocó la suscripción.");
      }

    } catch (error) {
      console.error("Error procesando mensaje:", error.message);
    }
  });

  socket.on("error", (error) => {
    console.error("Error WebSocket:", error.message);
  });

  socket.on("close", () => {
    console.log("Conexión EventSub cerrada.");

    if (chatAccount && chatAccount.userId === userId) {
      reconnectTimer = setTimeout(() => {
        connectChat(accessToken, userId);
      }, 5000);
    }
  });
}

// Página principal
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>JuuampaCA AI</title>
      <style>
        body {
          background: #17151f;
          color: white;
          font-family: Arial, sans-serif;
          padding: 25px;
        }
        h1 { color: #a970ff; }
        a, button {
          background: #9147ff;
          color: white;
          padding: 12px 18px;
          border-radius: 8px;
          text-decoration: none;
          border: 0;
          cursor: pointer;
        }
        #messages {
          margin-top: 25px;
          padding: 15px;
          background: #24212e;
          border-radius: 10px;
        }
        .message {
          padding: 10px;
          border-bottom: 1px solid #444;
          overflow-wrap: anywhere;
        }
        .user { color: #bf9aff; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>JuuampaCA AI</h1>
      <p>Asistente de chat de Twitch</p>
      <p id="status">Comprobando conexión...</p>
      <p><a href="/auth/twitch">Conectar con Twitch</a></p>
      <h2>Mensajes del chat</h2>
      <div id="messages">Esperando mensajes...</div>

      <script>
        async function updateChat() {
          try {
            const response = await fetch("/api/messages");

            if (response.status === 401) {
              document.getElementById("status").textContent =
                "Conecta tu cuenta de Twitch para comenzar.";
              return;
            }

            const data = await response.json();

            document.getElementById("status").textContent =
              data.connected
                ? "Conectado a Twitch: " + data.account
                : "Chat desconectado";

            const container = document.getElementById("messages");
            container.replaceChildren();

            if (data.messages.length === 0) {
              container.textContent = "Todavía no hay mensajes.";
              return;
            }

            data.messages.slice().reverse().forEach(msg => {
              const item = document.createElement("div");
              item.className = "message";

              const user = document.createElement("span");
              user.className = "user";
              user.textContent = msg.user + ": ";

              const message = document.createElement("span");
              message.textContent = msg.text;

              item.append(user, message);
              container.appendChild(item);
            });

          } catch (error) {
            document.getElementById("status").textContent =
              "No se pudo consultar el chat.";
          }
        }

        updateChat();
        setInterval(updateChat, 3000);
      </script>
    </body>
    </html>
  `);
});

// Comenzar autorización Twitch
app.get("/auth/twitch", (req, res) => {
  const {
    TWITCH_CLIENT_ID,
    TWITCH_REDIRECT_URI
  } = process.env;

  if (!TWITCH_CLIENT_ID || !TWITCH_REDIRECT_URI) {
    return res.status(503).send(
      "Falta configurar Twitch en Render."
    );
  }

  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: "code",
    scope: "user:read:chat user:write:chat",
    state
  });

  res.redirect(
    "https://id.twitch.tv/oauth2/authorize?" + params.toString()
  );
});

// Respuesta de autorización Twitch
app.get("/auth/twitch/callback", async (req, res) => {
  try {
    if (
      !req.query.code ||
      !req.query.state ||
      req.query.state !== req.session.oauthState
    ) {
      return res.status(400).send(
        "Autorización no válida. Inténtalo de nuevo."
      );
    }

    delete req.session.oauthState;

    const body = new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      code: req.query.code,
      grant_type: "authorization_code",
      redirect_uri: process.env.TWITCH_REDIRECT_URI
    });

    const tokenResponse = await fetch(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body
      }
    );

    if (!tokenResponse.ok) {
      return res.status(502).send(
        "Twitch no pudo completar la autorización."
      );
    }

    const tokens = await tokenResponse.json();

    const validateResponse = await fetch(
      "https://id.twitch.tv/oauth2/validate",
      {
        headers: {
          Authorization: `OAuth ${tokens.access_token}`
        }
      }
    );

    if (!validateResponse.ok) {
      return res.status(502).send(
        "No se pudo verificar la autorización."
      );
    }

    const account = await validateResponse.json();

    if (
      !account.scopes.includes("user:read:chat")
    ) {
      return res.status(403).send(
        "Falta el permiso user:read:chat. Vuelve a conectar Twitch."
      );
    }

    req.session.twitch = {
      login: account.login,
      userId: account.user_id
    };

    chatAccount = {
      login: account.login,
      userId: account.user_id
    };

    chatMessages = [];

    await new Promise((resolve, reject) => {
      req.session.save((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    connectChat(tokens.access_token, account.user_id);

    res.redirect("/");

  } catch (error) {
    console.error("Error de autorización:", error.message);
    res.status(500).send(
      "Ocurrió un error al conectar Twitch."
    );
  }
});

// Mensajes para el panel
app.get("/api/messages", (req, res) => {
  if (!req.session.twitch) {
    return res.status(401).json({
      connected: false
    });
  }

  res.json({
    connected: true,
    account: req.session.twitch.login,
    messages: chatMessages
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(
    "JuuampaCA AI funcionando en el puerto " + PORT
  );
});
