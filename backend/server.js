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

// Multer config for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'), // Files will be stored in the 'uploads' directory
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)) // Unique filename
});
// 'pdfs' is the field name that the frontend will send the files under.
// '10' is the maximum number of files allowed. Adjust as needed.
const upload = multer({ storage }).array('pdfs', 10); 

// Endpoint for uploading PDF files (now handles multiple)
app.post('/upload', async (req, res) => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading.
      console.error('Multer Error:', err);
      return res.status(500).json({ error: `Multer error: ${err.message}` });
    } else if (err) {
      // An unknown error occurred when uploading.
      console.error('Unknown Upload Error:', err);
      return res.status(500).json({ error: `Unknown upload error: ${err.message}` });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const processedPdfs = [];
    for (const file of req.files) {
      const filePath = path.join(__dirname, 'uploads', file.filename);
      try {
        const dataBuffer = fs.readFileSync(filePath); // Read PDF file into a buffer
        const pdfData = await pdfParse(dataBuffer); // Parse PDF to extract text
        
        processedPdfs.push({
          filename: file.originalname,
          text: pdfData.text
        });
      } catch (parseError) {
        console.error(`Error processing file ${file.originalname}:`, parseError);
        // Optionally, you could still push an object with an error message for this file
        processedPdfs.push({
          filename: file.originalname,
          error: `Failed to extract text: ${parseError.message}`
        });
      } finally {
        // Clean up the uploaded file after processing
        fs.unlinkSync(filePath);
      }
    }
    
    // If all files failed, return an error. Otherwise, return processed data.
    if (processedPdfs.every(pdf => pdf.error)) {
        return res.status(500).json({ error: "All PDFs failed to process.", details: processedPdfs });
    }

    res.status(200).json(processedPdfs); // Return an array of processed PDF data
  });
});

// Endpoint for asking questions using the Gemini API
app.post('/ask', async (req, res) => {
  try {
    const { question, pdfText } = req.body; // pdfText will now be a combined string of all PDFs
    if (!question || !pdfText) {
      return res.status(400).json({ error: 'Missing question or PDF text' });
    }

    const API_KEY = process.env.GEMINI_API_KEY; // Get API key from environment variables
    // Gemini API URL using gemini-2.0-flash model and v1beta version
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

    // Construct the prompt with PDF content and the user's question
    // Frontend is responsible for combining texts when sending to this endpoint
    const prompt = `Here is the PDF content:\n\n${pdfText}\n\nNow answer this question:\n${question}`;

    // Make a POST request to the Gemini API
    const response = await axios.post(url, {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ]
    });
    
    // Extract the answer from the API response
    const answer = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
    res.json({ answer });
  } catch (error) {
    console.error('Gemini API Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to get answer from Gemini' });
  }
});

// NEW: Endpoint for comparing multiple PDFs using the Gemini API
app.post('/compare', async (req, res) => {
  try {
    const { prompt } = req.body; // The frontend sends the full comparison prompt
    if (!prompt) {
      return res.status(400).json({ error: 'Missing comparison prompt' });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

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
    console.error('Gemini API Error (Comparison):', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to get comparison from Gemini' });
  }
});


// Start the server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
