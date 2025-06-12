import React, { useState, useEffect, useRef } from 'react';

// Main App component
const App = () => {
  // State variables for managing UI and data
  const [selectedFiles, setSelectedFiles] = useState([]); 
  const [allPdfData, setAllPdfData] = useState([]); // Array of { filename: string, text: string, savedname?: string, tempPath?: string, error?: string } objects
  const [summary, setSummary] = useState(''); 
  const [loading, setLoading] = useState(false); 
  const [error, setError] = useState(''); 
  const [chatMessages, setChatMessages] = useState([]); 
  const [currentQuestion, setCurrentQuestion] = useState(''); 
  const [isListening, setIsListening] = useState(false); 
  const [comparing, setComparing] = useState(false); 
  const [generatingDashboard, setGeneratingDashboard] = useState(false); 

  // Ref for the chat messages container to enable auto-scrolling
  const chatMessagesRef = useRef(null);
  // Ref for the hidden file input to trigger it programmatically
  const fileInputRef = useRef(null);

  // Determine if any valid PDFs have been processed
  const hasProcessedPdfs = allPdfData.filter(pdf => !pdf.error).length > 0;

  // Scroll to the bottom of the chat messages whenever they update
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Utility function for introducing a delay (not directly used here but kept for consistency)
  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  // Handler for when a file is selected via the input field
  const handleFileChange = (event) => {
    const newFiles = Array.from(event.target.files);
    // Append new files to existing selected files if any
    setSelectedFiles((prevFiles) => [...prevFiles, ...newFiles]);
    
    // Clear previous processed data and chat when new files are selected
    // Note: If you want to *add* PDFs to existing processed data, this logic would change.
    // For now, selecting new files clears everything and starts fresh as per previous implementation.
    setAllPdfData([]); 
    setSummary(''); 
    setChatMessages([]); 
    setError(''); 
    // Clear the input's value to allow selecting the same file again if needed
    event.target.value = null; 
  };

  // Handler for uploading the PDF(s) and extracting their text
  const handleUploadPDFs = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select at least one PDF file first.');
      return;
    }

    setLoading(true); 
    setError(''); 
    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append('pdfs', file); 
    });

    try {
      const response = await fetch('http://localhost:5000/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to upload PDFs due to a server error.');
      }

      // Backend now returns objects with filename, savedname, tempPath, and text
      const data = await response.json(); 
      setAllPdfData(data); 
      
      const successfulPdfs = data.filter(pdf => !pdf.error);
      const failedPdfs = data.filter(pdf => pdf.error);

      if (failedPdfs.length > 0) {
          const failedNames = failedPdfs.map(pdf => pdf.filename).join(', ');
          const errorMessage = `Failed to process: ${failedNames}. Some PDFs might be corrupted, encrypted, or malformed.`; 
          setError(errorMessage);
          if (successfulPdfs.length === 0) {
              setLoading(false);
              setSelectedFiles([]);
              return;
          }
      }

      // Combine text only from successfully processed PDFs for summarization
      const combinedText = successfulPdfs.map(pdf => pdf.text).join('\n\n---\n\n'); 
      
      await handleSummarize(combinedText); 
      
      const fileNames = successfulPdfs.map(pdf => pdf.filename).join(', ');
      setChatMessages([{ sender: 'bot', text: `PDF(s) uploaded and processed: ${fileNames}. How can I help you with these documents?` }]); 
    } catch (err) {
      console.error('Upload Error:', err);
      setError(err.message); 
    } finally {
      setLoading(false); 
      setSelectedFiles([]); // Clear selected files after upload attempt
    }
  };

  // Handler for summarizing the extracted PDF text (now combines all text)
  const handleSummarize = async (textToSummarize) => {
    if (!textToSummarize) {
      setError('No PDF text to summarize. Please upload valid PDFs.');
      return;
    }

    setLoading(true); 
    setError(''); 
    try {
      const response = await fetch('http://localhost:5000/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: 'Summarize the following document(s) concisely:', 
          pdfText: textToSummarize,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to summarize PDF(s)');
      }

      const data = await response.json();
      setSummary(data.answer); 
    } catch (err) {
      console.error('Summarize Error:', err);
      setError(err.message); 
    } finally {
      setLoading(false); 
    }
  };

  // Handler for sending a user's question to the chatbot (now uses all combined text)
  const handleAskQuestion = async (question) => {
    const successfullyProcessedPdfs = allPdfData.filter(pdf => !pdf.error);
    if (successfullyProcessedPdfs.length === 0 || !question.trim()) {
      setError('Please type a question and ensure valid PDF(s) are uploaded and processed.');
      return;
    }

    setLoading(true); 
    setError(''); 
    const userMessage = { sender: 'user', text: question };
    setChatMessages((prevMessages) => [...prevMessages, userMessage]); 
    setCurrentQuestion(''); 

    const combinedTextForQuestion = successfullyProcessedPdfs.map(pdf => pdf.text).join('\n\n---\n\n');

    try {
      const response = await fetch('http://localhost:5000/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: question,
          pdfText: combinedTextForQuestion,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to get answer from AI');
      }

      const data = await response.json();
      const botMessage = { sender: 'bot', text: data.answer };
      setChatMessages((prevMessages) => [...prevMessages, botMessage]); 
      speakText(data.answer); 
    } catch (err) {
      console.error('Ask Question Error:', err);
      setError(err.message); 
      setChatMessages((prevMessages) => [...prevMessages, { sender: 'bot', text: `Error: ${err.message}` }]); 
    } finally {
      setLoading(false); 
    }
  };

  // Function to start speech-to-text recognition (voice input)
  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false; 
    recognition.interimResults = false; 
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true); 
      setError(''); 
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript; 
      setCurrentQuestion(transcript); 
      setIsListening(false); 
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setError(`Speech recognition error: ${event.error}`); 
      setIsListening(false); 
    };

    recognition.onend = () => {
      setIsListening(false); 
    };

    recognition.start(); 
  };

  // Function to convert text to speech (voice output)
  const speakText = (text) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US'; 
      window.speechSynthesis.speak(utterance); 
    } else {
      console.warn('Text-to-speech not supported in this browser.');
    }
  };

  // Modified Handler for comparing PDFs - now opens in a new page
  const handleComparePDFs = async () => {
    const successfullyProcessedPdfs = allPdfData.filter(pdf => !pdf.error);
    if (successfullyProcessedPdfs.length < 2) { 
      setError('Please upload at least two valid PDFs to compare.');
      return;
    }

    setComparing(true);
    setError('');

    const comparisonPrompt = `Compare the following documents and highlight key similarities and differences.
    
    ${successfullyProcessedPdfs.map((pdf, index) => `--- Document ${index + 1}: ${pdf.filename} ---\n${pdf.text}`).join('\n\n')}`;

    try {
      // Call the new /compare-html endpoint on the backend
      const response = await fetch('http://localhost:5000/compare-html', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: comparisonPrompt, 
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to generate comparison HTML');
      }

      const data = await response.json();
      // Open the generated comparison HTML in a new tab
      window.open(`http://localhost:5000${data.comparisonUrl}`, '_blank'); 
    } catch (err) {
      console.error('Comparison Error:', err);
      setError(err.message);
    } finally {
      setComparing(false);
    }
  };

  // Modified handleGenerateDashboard function - now opens in a new page
  const handleGenerateDashboard = async () => {
    const firstSuccessfulPdf = allPdfData.find(pdf => !pdf.error && pdf.savedname); 
    if (!firstSuccessfulPdf) {
      setError('Please upload at least one valid PDF to generate a dashboard.');
      return;
    }

    setGeneratingDashboard(true);
    setError('');

    try {
      const response = await fetch('http://localhost:5000/dashboard', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          savedname: firstSuccessfulPdf.savedname, 
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Failed to generate dashboard (Status: ${response.status})`);
      }

      const data = await response.json(); 
      // Open the generated dashboard HTML in a new tab
      window.open(`http://localhost:5000${data.dashboardUrl}`, '_blank'); 
      
    } catch (err) { 
      console.error('Dashboard Generation Error:', err);
      setError(err.message || 'An unexpected error occurred during dashboard generation.');
    } finally { 
      setGeneratingDashboard(false);
    }
  };

  // Function to trigger the hidden file input
  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-indigo-200 flex flex-col items-center p-4 font-sans">
      {/* Centered Chatbot Title */}
      <h1 className="text-5xl font-extrabold text-center text-purple-800 mt-8 mb-8 z-10 relative">
        Smart PDF Chatbot
      </h1>

      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-5xl flex flex-col lg:flex-row gap-8">
        {/* Left Section: Upload and Dynamic Features */}
        <div className="flex-1 space-y-6">
          {/* File Upload Section (Always visible) */}
          <div className="bg-purple-50 p-6 rounded-lg shadow-inner relative"> {/* Added relative positioning */}
            <label htmlFor="pdf-upload" className="block text-lg font-semibold text-purple-700 mb-3">
              Choose PDF File(s)
            </label>
            {/* Hidden file input, triggered by buttons */}
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              multiple 
              onChange={handleFileChange}
              ref={fileInputRef} // Attach ref to the input
              className="hidden" // Hide the default input
            />
            
            {/* Custom styled file input button */}
            <button
              onClick={triggerFileInput}
              disabled={loading}
              className="mb-4 w-2/3 mx-auto flex items-center justify-center py-2 px-4 rounded-full border border-purple-500 text-sm font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Select Files
            </button>

            {selectedFiles.length > 0 && (
              <div className="mt-2 text-sm text-gray-600">
                <p className="font-semibold mb-1">Selected Files for Upload:</p>
                <ul className="list-disc list-inside">
                  {selectedFiles.map((file, index) => (
                    <li key={index}>{file.name}</li>
                  ))}
                </ul>
              </div>
            )}
            {/* Modified: Reduced width for upload button */}
            <button
              onClick={handleUploadPDFs} 
              disabled={loading || selectedFiles.length === 0}
              className="mt-4 w-2/3 mx-auto bg-gradient-to-r from-purple-600 to-indigo-600 text-white py-3 px-6 rounded-full
                         font-bold text-lg shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300
                         disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading ? (
                <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : 'Upload PDF(s) and Process'}
            </button>

            {/* PLUS SYMBOL / ADD MORE PDFs button - Now always visible */}
            <button
              onClick={triggerFileInput} // Triggers the hidden file input
              // Disabled if loading (uploading)
              disabled={loading}
              className="absolute top-0 right-0 transform translate-x-1/2 -translate-y-1/2 
                         bg-blue-500 text-white rounded-full p-2 shadow-lg 
                         hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 
                         transition-all duration-200 flex items-center justify-center z-20"
              title="Add more PDFs"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* Conditional Sections - Enabled/Shown after PDF upload */}
          {hasProcessedPdfs && (
            <>
              {/* Summary Display Section */}
              {summary && (
                <div className="bg-green-50 p-6 rounded-lg shadow-inner">
                  <h2 className="text-xl font-bold text-green-800 mb-3">Summary of documents:</h2>
                  <p className="text-gray-700 leading-relaxed">{summary}</p>
                </div>
              )}

              {/* Compare PDFs Button */}
              <div className="bg-orange-50 p-6 rounded-lg shadow-inner">
                <h2 className="text-xl font-bold text-orange-800 mb-3">Document Comparison</h2>
                <button
                  onClick={handleComparePDFs}
                  disabled={comparing || allPdfData.filter(pdf => !pdf.error).length < 2} 
                  className="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold rounded-full shadow-md hover:scale-105 transition transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {comparing ? (
                    <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : 'Compare Uploaded PDFs'}
                </button>
              </div>

              {/* Generate Dashboard Button */}
              <div className="bg-blue-50 p-6 rounded-lg shadow-inner">
                <h2 className="text-xl font-bold text-blue-800 mb-3">Interactive Dashboard</h2>
                <button
                  onClick={handleGenerateDashboard}
                  disabled={generatingDashboard || allPdfData.filter(pdf => !pdf.error && pdf.savedname).length === 0} 
                  className="w-full py-3 bg-gradient-to-r from-green-500 to-teal-500 text-white font-semibold rounded-full shadow-md hover:scale-105 transition transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {generatingDashboard ? (
                    <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : 'Generate Dashboard'}
                </button>
              </div>
            </>
          )} {/* End Conditional Sections */}

          {/* Error Message Display Section */}
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md relative" role="alert">
              <strong className="font-bold">Error!</strong>
              <span className="block sm:inline ml-2">{error}</span>
            </div>
          )}
        </div>

        {/* Right Section: Chatbot Interface (Conditional) */}
        {hasProcessedPdfs && (
          <div className="flex-1 flex flex-col space-y-4 bg-blue-50 p-6 rounded-xl shadow-inner">
            <h2 className="text-3xl font-bold text-center text-blue-800 mb-4">Chat with PDF(s)</h2>

            {/* Chat Messages Display Area */}
            <div ref={chatMessagesRef} className="flex-1 bg-white p-4 rounded-lg shadow-md overflow-y-auto h-96 custom-scrollbar">
              {chatMessages.length === 0 ? (
                <p className="text-gray-500 text-center mt-10">Start chatting once PDFs are uploaded!</p>
              ) : (
                chatMessages.map((msg, index) => (
                  <div
                    key={index}
                    className={`mb-3 p-3 rounded-lg max-w-[80%] ${
                      msg.sender === 'user'
                        ? 'bg-blue-500 text-white ml-auto rounded-br-none' 
                        : 'bg-gray-200 text-gray-800 mr-auto rounded-bl-none' 
                    }`}
                  >
                    <p className="text-sm">{msg.text}</p>
                  </div>
                ))
              )}
            </div>

            {/* Chat Input and Controls (Text input, Voice input, Send button) */}
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={currentQuestion}
                onChange={(e) => setCurrentQuestion(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleAskQuestion(currentQuestion);
                  }
                }}
                placeholder={isListening ? 'Listening...' : 'Ask a question about the PDF(s)...'}
                disabled={loading || isListening} 
                className="flex-1 p-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-700"
              />
              <button
                onClick={startListening}
                disabled={loading} 
                className={`p-3 rounded-full shadow-md transition-all duration-200
                           ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-500 text-white hover:bg-blue-600'}
                           disabled:opacity-50 disabled:cursor-not-allowed`}
                title="Voice Input"
              >
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                onClick={() => handleAskQuestion(currentQuestion)}
                disabled={loading || !currentQuestion.trim()} 
                className="p-3 bg-indigo-500 text-white rounded-full shadow-md hover:bg-indigo-600 transition-colors duration-200
                           disabled:opacity-50 disabled:cursor-not-allowed"
                title="Send Question"
              >
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l.684-.275a1 1 0 00.51-.639L10 8.58l4.426 9.576a1 1 0 00.51-.639l.684.275a1 1 0 001.169-1.409l-7-14z" />
                </svg>
              </button>
            </div>
          </div>
        )} {/* End Chatbot Interface Conditional */}
      </div>
      {/* Tailwind CSS CDN for styling */}
      <script src="https://cdn.tailwindcss.com"></script>
      {/* Inter Font for consistent typography */}
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
      {/* Custom CSS for scrollbar styling */}
      <style>
        {`
        body {
          font-family: 'Inter', sans-serif;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #888;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
        `}
      </style>
    </div>
  );
};

export default App;
