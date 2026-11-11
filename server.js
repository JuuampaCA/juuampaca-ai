
const express = require("express");
const session = require("express-session");
const crypto = require("crypto");

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

app.get("/", (req, res) => {
  res.send(`
    <h1>JuuampaCA AI</h1>
    <p>Servidor funcionando.</p>
    <a href="/auth/twitch">Conectar con Twitch</a>
    <p><a href="/status">Ver estado de conexión</a></p>
  `);
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/auth/twitch", (req, res) => {
  const {
    TWITCH_CLIENT_ID,
    TWITCH_REDIRECT_URI
  } = process.env;

  if (!TWITCH_CLIENT_ID || !TWITCH_REDIRECT_URI) {
    return res.status(503).send("Falta configurar Twitch en Render.");
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

app.get("/auth/twitch/callback", async (req, res) => {
  try {
    if (req.query.error) {
      return res.status(400).send("No se autorizó la aplicación.");
    }

    if (
      !req.query.code ||
      !req.query.state ||
      req.query.state !== req.session.oauthState
    ) {
      return res.status(400).send("Autorización no válida. Inténtalo de nuevo.");
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
        "Twitch no pudo completar la autorización. Revisa la configuración."
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
      return res.status(502).send("No se pudo verificar la autorización.");
    }

    const account = await validateResponse.json();

    const requiredScopes = [
      "user:read:chat",
      "user:write:chat"
    ];

    const hasPermissions = requiredScopes.every(
      scope => account.scopes.includes(scope)
    );

    if (!hasPermissions) {
      return res.status(403).send(
        "Faltan permisos de chat. Vuelve a conectar Twitch."
      );
    }

    req.session.twitch = {
      login: account.login,
      userId: account.user_id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scopes: account.scopes
    };

    res.send(`
      <h1>JuuampaCA AI</h1>
      <p>¡Autorización de Twitch verificada!</p>
      <p>Cuenta conectada: ${account.login}</p>
      <p>La lectura y el envío de mensajes todavía no están activados.</p>
    `);

  } catch (error) {
    console.error("Error de autorización:", error.message);
    res.status(500).send("Ocurrió un error al conectar Twitch.");
  }
});

app.get("/status", (req, res) => {
  if (!req.session.twitch) {
    return res.json({ connected: false });
  }

  res.json({
    connected: true,
    account: req.session.twitch.login,
    chatPermissions: req.session.twitch.scopes
  });
});

app.listen(PORT, () => {
  console.log("JuuampaCA AI funcionando en el puerto " + PORT);
});
