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
// Serve dashboards from /dashboards folder
app.use('/dashboards', express.static(path.join(__dirname, '../dashboards')));

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
      console.error('Multer Error:', err);
      return res.status(500).json({ error: `Multer error: ${err.message}` });
    } else if (err) {
      console.error('Unknown Upload Error:', err);
      return res.status(500).json({ error: `Unknown upload error: ${err.message}` }); // Fixed backticks
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const processedPdfs = [];
    for (const file of req.files) {
      const filePath = path.join(__dirname, 'uploads', file.filename); // Full path to the saved file
      try {
        const dataBuffer = fs.readFileSync(filePath); 
        const pdfData = await pdfParse(dataBuffer); 
        
        processedPdfs.push({
          filename: file.originalname, // Original name
          savedname: file.filename,    // Temporary unique name on server
          tempPath: filePath,          // Full path to the file on server (for dashboard generation)
          text: pdfData.text
        });
      } catch (parseError) {
        console.error(`Error processing file ${file.originalname}:`, parseError); // Fixed backticks
        processedPdfs.push({
          filename: file.originalname,
          error: `Failed to extract text: ${parseError.message}` // Fixed backticks
        });
      } finally {
        // IMPORTANT: We are NOT deleting the file here anymore, as the dashboard endpoint needs it.
        // File cleanup will be handled implicitly by the OS or a separate cleanup routine.
      }
    }
    
    if (processedPdfs.every(pdf => pdf.error)) {
        return res.status(500).json({ error: "All PDFs failed to process.", details: processedPdfs });
    }

    res.status(200).json(processedPdfs); 
  });
});

// Endpoint for asking questions using the Gemini API
app.post('/ask', async (req, res) => {
  try {
    const { question, pdfText } = req.body; 
    if (!question || !pdfText) {
      return res.status(400).json({ error: 'Missing question or PDF text' });
    }

    const API_KEY = process.env.GEMINI_API_KEY; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`; // Fixed backticks

    const prompt = `Here is the PDF content:\n\n${pdfText}\n\nNow answer this question:\n${question}`; // Fixed backticks

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

// Endpoint for comparing multiple PDFs using the Gemini API
app.post('/compare', async (req, res) => {
  try {
    const { prompt } = req.body; 
    if (!prompt) {
      return res.status(400).json({ error: 'Missing comparison prompt' });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`; // Fixed backticks

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

// NEW: Endpoint for extracting tabular data using Gemini API (this endpoint was replaced by Python, but kept for context)
// Reverting to Node.js pdf-parse for table extraction, as indicated by user's new server.js and pdfDashboard.js
app.post('/extract-tables', async (req, res) => {
    // This endpoint was for direct AI table extraction.
    // Given the user's intent to use pdfDashboard.js,
    // this endpoint's logic is now handled by the /dashboard endpoint.
    // Keeping this as a placeholder or removing it is an option.
    // For now, it's safe to keep it, but it won't be called by the new frontend logic.
    res.status(404).json({ error: 'This endpoint is no longer in use for table extraction. Please use /dashboard.' });
});


// NEW: Extract and visualize tables from a PDF using pdfDashboard.js
// This replaces the previous AI-based table extraction for dashboards.
const pdfTableToHTMLDashboard = require('./utils/pdfDashboard'); // Corrected path: ./utils/pdfDashboard.js

app.post('/dashboard', async (req, res) => {
  const { savedname } = req.body; // Expecting the saved filename from the frontend
  if (!savedname) {
    return res.status(400).json({ error: 'Missing saved filename for dashboard generation.' });
  }

  // Construct the full path to the temporary PDF file
  const filePath = path.join(__dirname, 'uploads', savedname);

  // Check if the file exists before trying to process it
  if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      return res.status(404).json({ error: `File not found on server: ${savedname}` });
  }

  try {
    const htmlPath = await pdfTableToHTMLDashboard(filePath);
    // Return the URL relative to the /dashboards static serve path
    return res.json({ dashboardUrl: `/dashboards/${path.basename(htmlPath)}` }); // Fixed backticks
  } catch (error) {
    console.error('Dashboard generation error:', error);
    // If the error is from pdf-parse (e.g., no tables), provide specific feedback
    if (error.message.includes("No table-like data found")) {
        return res.status(400).json({ error: `No recognizable tabular data found in the PDF: ${error.message}` });
    }
    return res.status(500).json({ error: error.message || 'Dashboard generation failed' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`); // Fixed backticks
});
