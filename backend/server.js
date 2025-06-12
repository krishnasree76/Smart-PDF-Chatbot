require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs').promises; // Changed to fs.promises for async/await file operations
const originalFs = require('fs'); // Keep original fs for fs.existsSync
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
if (!originalFs.existsSync(uploadsDir)) { // Use originalFs for synchronous check
  originalFs.mkdirSync(uploadsDir); // Use originalFs for synchronous creation
}
// Serve dashboards from /dashboards folder
app.use('/dashboards', express.static(path.join(__dirname, '../dashboards')));

// Multer config for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'), // Files will be stored in the 'uploads' directory
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)) // Unique filename
});
const upload = multer({ storage }).array('pdfs', 10); 

// Endpoint for uploading PDF files (now handles multiple)
app.post('/upload', async (req, res) => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      console.error('Multer Error:', err);
      return res.status(500).json({ error: `Multer error: ${err.message}` });
    } else if (err) {
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
        const dataBuffer = await fs.readFile(filePath); // Use fs.promises.readFile
        const pdfData = await pdfParse(dataBuffer); 
        
        processedPdfs.push({ // Corrected variable name from processedPpdfs
          filename: file.originalname, 
          savedname: file.filename,    
          tempPath: filePath,          
          text: pdfData.text
        });
      } catch (parseError) {
        console.error(`Error processing file ${file.originalname}:`, parseError);
        processedPdfs.push({
          filename: file.originalname,
          error: `Failed to extract text: ${parseError.message}`
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

// DEPRECATED: This endpoint will no longer be used for comparison,
// as we are now generating an HTML page for comparison result.
app.post('/compare', async (req, res) => {
  res.status(404).json({ error: 'This endpoint is deprecated. Use /compare-html instead.' });
});

// NEW: Endpoint to generate HTML page for comparison result with improved CSS and readability
app.post('/compare-html', async (req, res) => {
  try {
    const { prompt } = req.body;
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

    let comparisonText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No comparison result available.';
    
    // --- NEW: Text processing to remove asterisks and format for HTML ---
    // Remove all asterisks, which are likely markdown remnants for bold/italic
    comparisonText = comparisonText.replace(/\*/g, ''); 
    
    // Convert newlines to <br/> for proper display in HTML
    comparisonText = comparisonText.replace(/\n/g, '<br/>');

    // Simple heuristic to highlight "Similarities" and "Differences" sections
    // This assumes the AI consistently uses these phrases
    comparisonText = comparisonText.replace(/Similarities:/g, '<h2 class="section-title similarities-title">Similarities:</h2>');
    comparisonText = comparisonText.replace(/Differences:/g, '<h2 class="section-title differences-title">Differences:</h2>');

    // Also, wrap potential list items or key points in a consistent way
    // This is a basic regex for lines starting with hyphen or bullet-like characters, followed by a space
    comparisonText = comparisonText.replace(/<br\/>(\s*)- (.+?)(?=<br\/>|$)/g, '<br/><span class="list-item-bullet">&bull;</span> <span class="list-item-text">$2</span>');
    comparisonText = comparisonText.replace(/<br\/>(\s*)([0-9]+\.) (.+?)(?=<br\/>|$)/g, '<br/><span class="list-item-number">$1$2</span> <span class="list-item-text">$3</span>');
    // Ensure the very first line if it's a list item also gets styled
    comparisonText = comparisonText.replace(/^(- (.+?)(?=<br\/>|$))/g, '<span class="list-item-bullet">&bull;</span> <span class="list-item-text">$2</span>');
    comparisonText = comparisonText.replace(/^([0-9]+\.) (.+?)(?=<br\/>|$)/g, '<span class="list-item-number">$1</span> <span class="list-item-text">$2</span>');

    // Ensure the main comparison text is wrapped in a content div
    const contentToWrap = comparisonText; // Use the processed text
    // --- END NEW ---

    // Generate an improved HTML page for the comparison result
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Document Comparison Result</title>
          <link href="https://cdn.tailwindcss.com" rel="stylesheet">
          <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
          <style>
            body { 
              font-family: 'Roboto', sans-serif; /* Changed font to Roboto */
              background-color: #f8fafc; /* Lighter background */
              margin: 0; 
              padding: 20px; 
              color: #334155; 
            }
            .container { 
              max-width: 1000px; 
              margin: 30px auto; 
              background-color: #ffffff; 
              padding: 40px; 
              border-radius: 16px; 
              box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15); 
            }
            h1 { 
              font-size: 2.8rem; 
              color: #1a202c; 
              text-align: center; 
              margin-bottom: 30px; 
              font-weight: 700; /* Bold */
              letter-spacing: -0.025em; 
            }
            .main-content {
              background-color: #ffffff; /* Explicitly white for the main content area */
              padding: 25px;
              border-radius: 10px;
              border: 1px solid #e2e8f0; /* Lighter border */
            }
            .section-title {
              font-size: 1.8rem; /* Larger sub-heading size */
              margin-top: 30px;
              margin-bottom: 20px;
              padding-bottom: 10px;
              font-weight: 700;
              border-bottom: 3px solid; /* Dynamic border color */
            }
            .similarities-title {
              color: #10b981; /* Green for similarities */
              border-color: #10b981;
            }
            .differences-title {
              color: #ef4444; /* Red for differences */
              border-color: #ef4444;
            }
            .comparison-content {
              line-height: 1.8; 
              font-size: 1.05rem; 
              color: #475569; 
            }
            .list-item-bullet, .list-item-number {
                font-weight: 500; /* Medium bold for bullet/number */
                color: #4f46e5; /* A distinct color for list markers */
                margin-right: 5px;
            }
            .list-item-text {
                display: inline; /* Keep text inline with bullet/number */
            }
            /* Add some responsive adjustments */
            @media (max-width: 768px) {
              .container {
                padding: 20px;
                margin: 15px auto;
              }
              h1 {
                font-size: 2.2rem;
                margin-bottom: 25px;
              }
              .section-title {
                font-size: 1.5rem;
              }
              .comparison-content {
                font-size: 0.95rem;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📄 Document Comparison Report</h1>
            <div class="main-content">
              ${contentToWrap}
            </div>
            <p class="text-center text-gray-500 text-sm mt-8">Generated by Smart PDF Chatbot</p>
          </div>
        </body>
      </html>
    `;

    // Save the HTML to a file in the dashboards directory
    const dashboardDir = path.join(__dirname, '../dashboards');
    await fs.mkdir(dashboardDir, { recursive: true }); 
    const uniqueFileName = `comparison_${Date.now()}.html`;
    const outputPath = path.join(dashboardDir, uniqueFileName);
    await fs.writeFile(outputPath, htmlContent); 

    // Return the URL to the newly created HTML file
    res.json({ comparisonUrl: `/dashboards/${uniqueFileName}` });

  } catch (error) {
    console.error('Gemini API Error (Comparison HTML Generation):', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate comparison HTML from Gemini' });
  }
});


// Endpoint for extracting tabular data using Gemini API (this endpoint was replaced by Python, but kept for context)
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
const pdfTableToHTMLDashboard = require('./utils/pdfDashboard'); 

app.post('/dashboard', async (req, res) => {
  const { savedname } = req.body; 
  if (!savedname) {
    return res.status(400).json({ error: 'Missing saved filename for dashboard generation.' });
  }

  const filePath = path.join(__dirname, 'uploads', savedname);

  if (!originalFs.existsSync(filePath)) { 
      console.error(`File not found: ${filePath}`);
      return res.status(404).json({ error: `File not found on server: ${savedname}` });
  }

  try {
    const htmlPath = await pdfTableToHTMLDashboard(filePath);
    return res.json({ dashboardUrl: `/dashboards/${path.basename(htmlPath)}` }); 
  } catch (error) {
    console.error('Dashboard generation error:', error);
    if (error.message.includes("No table-like data found")) {
        return res.status(400).json({ error: `No recognizable tabular data found in the PDF: ${error.message}` });
    }
    return res.status(500).json({ error: error.message || 'Dashboard generation failed' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`); 
});
