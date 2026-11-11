
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send(`
    <h1>JuuampaCA AI</h1>
    <h2>Servidor funcionando correctamente</h2>
    <p>El siguiente paso será conectar Twitch.</p>
  `);
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log("JuuampaCA AI está funcionando en el puerto " + PORT);
});
