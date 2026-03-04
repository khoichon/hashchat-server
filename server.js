require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const uploadRoutes = require("./src/routes/upload");
const adminRoutes  = require("./src/routes/admin");
const messagesRoutes = require("./src/routes/messages");
const pushRoutes   = require("./src/routes/push");
const { globalLimiter } = require("./src/middleware/rateLimit");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "*", methods: ["GET","POST","DELETE"] }));
app.use(express.json());
app.use(globalLimiter);

// serve frontend
app.use(express.static(path.join(__dirname, "public")));

// api routes
app.use("/upload",   uploadRoutes);
app.use("/admin",    adminRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/push", pushRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

// spa fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => console.log("HashChat server on :" + PORT));
