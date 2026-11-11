
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json());

app.use(session({
  name: "juuampaca.sid",
  secret: process.env.SESSION_SECRET || "CAMBIAR_ANTES_DE_USAR",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 1000
  }
}));

app.get("/", (req, res) => {
  res.send(`
    <h1>JuuampaCA AI</h1>
    <p>Servidor funcionando.</p>
    <p>Conexión con Twitch pendiente de configurar.</p>
    <a href="/auth/twitch">Conectar con Twitch</a>
  `);
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/auth/twitch", (req, res) => {
  const { TWITCH_CLIENT_ID, TWITCH_REDIRECT_URI } = process.env;

  if (!TWITCH_CLIENT_ID || !TWITCH_REDIRECT_URI) {
    return res.status(503).send("Falta configurar Twitch en Render.");
  }

  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: "code",
    scope: "user:read:chat",
    state
  });

  res.redirect("https://id.twitch.tv/oauth2/authorize?" + params);
});

app.get("/auth/twitch/callback", (req, res) => {
  if (!req.query.code || !req.query.state ||
      req.query.state !== req.session.oauthState) {
    return res.status(400).send("Autorización no válida. Inténtalo de nuevo.");
  }

  delete req.session.oauthState;

  res.send(`
    <h1>JuuampaCA AI</h1>
    <p>Autorización recibida. El intercambio seguro de credenciales aún debe configurarse.</p>
    <p>Esta prueba todavía no conecta el chat ni envía mensajes.</p>
  `);
});

app.listen(PORT, () => {
  console.log("JuuampaCA AI funcionando en el puerto " + PORT);
});
