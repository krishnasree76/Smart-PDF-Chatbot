// backend/index.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// Setup file upload handling
const upload = multer({ dest: 'uploads/' });

// Test route
app.get('/', (req, res) => {
  res.send('Smart PDF Chatbot backend is running');
});

// Upload and parse PDF
app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    const dataBuffer = req.file;
    const fs = require('fs');
    const buffer = fs.readFileSync(dataBuffer.path);
    const pdfData = await pdfParse(buffer);
    res.json({ text: pdfData.text });
  } catch (err) {
    console.error('Error parsing PDF:', err);
    res.status(500).json({ error: 'Failed to process PDF' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
