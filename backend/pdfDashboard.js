const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse'); // pdf-parse is used for text extraction here

/**
 * Extracts table-like data from PDF text.
 * This is a basic heuristic and might not work for complex or image-based tables.
 * @param {string} filePath - The path to the PDF file on the server.
 * @returns {Promise<{headers: string[], values: Array<Array<string|number>>}>} - Extracted table data.
 * @throws {Error} If no table-like data is found.
 */
const extractTable = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  
  // Split text by line and filter lines containing multiple spaces or tabs (heuristic for table-like lines)
  // This approach is very basic and depends heavily on consistent spacing in the PDF.
  const lines = data.text.split('\n').filter(line => line.trim().length > 0 && line.match(/\t|\s{2,}/));
  
  if (lines.length < 2) { // Need at least a header row and one data row
    throw new Error("No table-like data found in the PDF or insufficient rows for a table.");
  }

  // Use flexible split by one or more whitespace characters
  const rows = lines.map(line => line.trim().split(/\t|\s{2,}/).filter(cell => cell.trim() !== '')); // Filter out empty cells

  const headers = rows[0].map(header => header.trim()); // Trim headers
  
  // Filter out any rows that don't have the same number of columns as headers
  // and convert values to numbers where applicable
  const values = rows.slice(1)
    .filter(row => row.length === headers.length)
    .map(row => row.map(value => {
      const trimmed = value.trim();
      // Convert to number if valid number string, else keep as string
      // This is a common pattern for dashboard data
      return !isNaN(trimmed) && trimmed !== '' ? Number(trimmed) : trimmed;
    }));

  if (values.length === 0) {
      throw new Error("Table headers found, but no valid data rows match the header count.");
  }

  return { headers, values };
};

/**
 * Generates a simple HTML table dashboard.
 * @param {string[]} headers - Array of table headers.
 * @param {Array<Array<string|number>>} values - 2D array of table data.
 * @returns {string} - HTML content for the dashboard.
 */
const generateHTML = (headers, values) => {
  // Generate table header row
  const tableHeader = `<tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr>`;

  // Generate table data rows
  const tableRows = values.map(row => 
    `<tr>${row.map(cell => `<td>${typeof cell === 'object' && cell !== null ? JSON.stringify(cell) : cell}</td>`).join('')}</tr>`
  ).join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dashboard</title>
        <link href="https://cdn.tailwindcss.com" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; background-color: #f0f4f8; margin: 0; padding: 20px; }
          .container { max-width: 900px; margin: 20px auto; background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
          h1 { font-size: 2.5rem; color: #4338ca; text-align: center; margin-bottom: 25px; font-weight: 700; }
          table { border-collapse: collapse; width: 100%; margin-top: 20px; border-radius: 8px; overflow: hidden; }
          th, td { border: 1px solid #e2e8f0; padding: 12px 15px; text-align: left; }
          th { background-color: #e0f2fe; color: #1e3a8a; font-weight: 600; text-transform: uppercase; font-size: 0.85rem; }
          tr:nth-child(even) { background-color: #f8fafc; }
          tr:hover { background-color: #eef2ff; }
          td { color: #334155; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📊 PDF Table Dashboard</h1>
          <div class="overflow-x-auto rounded-lg shadow-md">
            <table>
              <thead>
                ${tableHeader}
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </div>
        </div>
      </body>
    </html>
  `;
};

/**
 * Saves HTML content to a file in the dashboards directory.
 * @param {string} htmlContent - The HTML string to save.
 * @param {string} filename - The base filename (without extension).
 * @returns {Promise<string>} - The full path to the saved HTML file.
 */
const saveHTMLToFile = async (htmlContent, filename) => {
  const dashboardDir = path.join(__dirname, '../../dashboards'); // Adjusted path for utils directory
  await fs.mkdir(dashboardDir, { recursive: true });
  const outputPath = path.join(dashboardDir, `${filename}.html`);
  await fs.writeFile(outputPath, htmlContent);
  return outputPath;
};

/**
 * Main function to extract table from PDF and generate an HTML dashboard.
 * @param {string} filePath - The path to the PDF file.
 * @returns {Promise<string>} - The path to the generated HTML dashboard file.
 */
module.exports = async function pdfTableToHTMLDashboard(filePath) {
  const { headers, values } = await extractTable(filePath);
  const html = generateHTML(headers, values);
  // Pass the basename of the PDF file to be the HTML file name
  const htmlFile = await saveHTMLToFile(html, path.basename(filePath, '.pdf'));
  return htmlFile;
};

