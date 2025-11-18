import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const SMAP_API_KEY = process.env.SMAP_API_KEY; // Render 환경변수

app.get("/proxy", async (req, res) => {
  const { gu } = req.query;

  if (!gu) return res.status(400).json({ error: "gu parameter required" });

  try {
    const url = `https://api-v2.smap.seoul.go.kr/v2/road/centerline?gu=${gu}&apikey=${SMAP_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Proxy request failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
