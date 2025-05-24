require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Upload endpoint
app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);

    // Clean up the uploaded file after processing
    fs.unlinkSync(filePath);

    res.status(200).json({ success: true, text: pdfData.text });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: 'Error extracting text from PDF' });
  }
});

// Ask endpoint using Gemini
app.post('/ask', async (req, res) => {
  try {
    const { question, pdfText } = req.body;
    if (!question || !pdfText) {
      return res.status(400).json({ error: 'Missing question or PDF text' });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    // Corrected URL: using v1beta and gemini-2.0-flash
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

    const prompt = `Here is the PDF content:\n\n${pdfText}\n\nNow answer this question:\n${question}`;

    const response = await axios.post(url, {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ]
    });
    
    const answer = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    res.json({ answer });
  } catch (error) {
    console.error('Gemini API Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to get answer from Gemini' });
  }
});


app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
