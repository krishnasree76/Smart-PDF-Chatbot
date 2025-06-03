import React, { useState, useEffect, useRef } from 'react';

// Main App component
const App = () => {
  // State variables for managing UI and data
  const [selectedFiles, setSelectedFiles] = useState([]); // Array of File objects
  const [allPdfData, setAllPdfData] = useState([]); // Array of { filename: string, text: string } objects
  const [summary, setSummary] = useState(''); // Stores the summarized text from the PDF
  const [loading, setLoading] = useState(false); // Indicates if an operation is in progress
  const [error, setError] = useState(''); // Stores any error messages to display
  const [chatMessages, setChatMessages] = useState([]); // Stores the history of chat messages
  const [currentQuestion, setCurrentQuestion] = useState(''); // Stores the current question typed by the user
  const [isListening, setIsListening] = useState(false); // Indicates if speech recognition is active
  const [comparisonResult, setComparisonResult] = useState(''); // New state for comparison results
  const [comparing, setComparing] = useState(false); // New state for comparison loading

  // Ref for the chat messages container to enable auto-scrolling
  const chatMessagesRef = useRef(null);

  // Scroll to the bottom of the chat messages whenever they update
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Handler for when a file is selected via the input field
  const handleFileChange = (event) => {
    const newFiles = Array.from(event.target.files);
    // Append new files to the existing selectedFiles array
    setSelectedFiles((prevFiles) => [...prevFiles, ...newFiles]);
    
    // Clear previous processed data and chat when new files are selected
    setAllPdfData([]); 
    setSummary(''); 
    setChatMessages([]); 
    setError(''); 
    setComparisonResult(''); // Clear comparison result on new file selection
  };

  // Handler for uploading the PDF(s) and extracting their text
  const handleUploadPDFs = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select at least one PDF file first.');
      return;
    }

    setLoading(true); // Set loading state to true
    setError(''); // Clear previous errors
    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append('pdfs', file); // Append each file with the name 'pdfs'
    });

    try {
      // Send the PDF files to the backend upload endpoint
      const response = await fetch('http://localhost:5000/upload', {
        method: 'POST',
        body: formData,
      });

      // Check if the response was successful
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to upload PDFs');
      }

      const data = await response.json(); // Expects an array of {filename, text}
      setAllPdfData(data); // Store the extracted PDF data
      
      // Combine all texts for initial summarization and chat context
      const combinedText = data.map(pdf => pdf.text).join('\n\n---\n\n'); // Separator for clarity
      
      await handleSummarize(combinedText); // Summarize combined text
      
      const fileNames = data.map(pdf => pdf.filename).join(', ');
      setChatMessages([{ sender: 'bot', text: `PDF(s) uploaded and processed: ${fileNames}. How can I help you with these documents?` }]);
    } catch (err) {
      console.error('Upload Error:', err);
      setError(err.message); // Display error message to the user
    } finally {
      setLoading(false); // Reset loading state
      // Clear the selected files from the input after successful upload
      setSelectedFiles([]); 
    }
  };

  // Handler for summarizing the extracted PDF text (now combines all text)
  const handleSummarize = async (textToSummarize) => {
    if (!textToSummarize) {
      setError('No PDF text to summarize.');
      return;
    }

    setLoading(true); // Set loading state to true
    setError(''); // Clear previous errors
    try {
      // Send a request to the backend's /ask endpoint for summarization
      const response = await fetch('http://localhost:5000/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: 'Summarize the following document(s) concisely:', // Specific question for summarization
          pdfText: textToSummarize,
        }),
      });

      // Check if the response was successful
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to summarize PDF(s)');
      }

      const data = await response.json();
      setSummary(data.answer); // Store the summarized text
    } catch (err) {
      console.error('Summarize Error:', err);
      setError(err.message); // Display error message to the user
    } finally {
      setLoading(false); // Reset loading state
    }
  };

  // Handler for sending a user's question to the chatbot (now uses all combined text)
  const handleAskQuestion = async (question) => {
    // FIX: Changed condition to primarily check allPdfData.length
    if (allPdfData.length === 0 || !question.trim()) {
      setError('Please type a question and ensure PDF(s) are uploaded.');
      return;
    }

    setLoading(true); // Set loading state to true
    setError(''); // Clear previous errors
    const userMessage = { sender: 'user', text: question };
    setChatMessages((prevMessages) => [...prevMessages, userMessage]); // Add user's message to chat history
    setCurrentQuestion(''); // Clear the input field

    // Combine all PDF texts to send to the AI for answering
    const combinedTextForQuestion = allPdfData.map(pdf => pdf.text).join('\n\n---\n\n');

    try {
      // Send the question and combined PDF text to the backend's /ask endpoint
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

      // Check if the response was successful
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to get answer from AI');
      }

      const data = await response.json();
      const botMessage = { sender: 'bot', text: data.answer };
      setChatMessages((prevMessages) => [...prevMessages, botMessage]); // Add bot's answer to chat history
      speakText(data.answer); // Speak the bot's answer using text-to-speech
    } catch (err) {
      console.error('Ask Question Error:', err);
      setError(err.message); // Display error message to the user
      // Add an error message to the chat if the API call fails
      setChatMessages((prevMessages) => [...prevMessages, { sender: 'bot', text: `Error: ${err.message}` }]);
    } finally {
      setLoading(false); // Reset loading state
    }
  };

  // Function to start speech-to-text recognition (voice input)
  const startListening = () => {
    // Check for browser compatibility
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false; // Listen for a single utterance
    recognition.interimResults = false; // Do not show interim results
    recognition.lang = 'en-US'; // Set recognition language

    // Event handler for when recognition starts
    recognition.onstart = () => {
      setIsListening(true); // Set listening state to true
      setError(''); // Clear previous errors
    };

    // Event handler for when a speech result is obtained
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript; // Get the recognized text
      setCurrentQuestion(transcript); // Set the recognized text to the input field
      setIsListening(false); // Reset listening state
      // Optionally, you can uncomment the line below to send the question immediately after recognition
      // handleAskQuestion(transcript);
    };

    // Event handler for recognition errors
    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      setError(`Speech recognition error: ${event.error}`); // Display error
      setIsListening(false); // Reset listening state
    };

    // Event handler for when recognition ends
    recognition.onend = () => {
      setIsListening(false); // Reset listening state
    };

    recognition.start(); // Start the speech recognition
  };

  // Function to convert text to speech (voice output)
  const speakText = (text) => {
    // Check for browser compatibility
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US'; // Set speech language
      window.speechSynthesis.speak(utterance); // Speak the text
    } else {
      console.warn('Text-to-speech not supported in this browser.');
    }
  };

  // NEW: Handler for comparing PDFs
  const handleComparePDFs = async () => {
    if (allPdfData.length < 2) {
      setError('Please upload at least two PDFs to compare.');
      return;
    }

    setComparing(true);
    setError('');
    setComparisonResult(''); // Clear previous comparison result

    // Combine all PDF texts with clear separators for the AI to understand
    const comparisonPrompt = `Compare the following documents and highlight key similarities and differences.
    
    ${allPdfData.map((pdf, index) => `--- Document ${index + 1}: ${pdf.filename} ---\n${pdf.text}`).join('\n\n')}`;

    try {
      const response = await fetch('http://localhost:5000/compare', { // NEW ENDPOINT: /compare
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: comparisonPrompt, // Send the constructed prompt
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to get comparison from AI');
      }

      const data = await response.json();
      setComparisonResult(data.answer); // Store the comparison answer
    } catch (err) {
      console.error('Comparison Error:', err);
      setError(err.message);
    } finally {
      setComparing(false);
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-indigo-200 flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-5xl flex flex-col lg:flex-row gap-8">
        {/* Left Section: Upload, Summary, and Comparison */}
        <div className="flex-1 space-y-6">
          <h1 className="text-4xl font-extrabold text-center text-purple-800 mb-6">Smart PDF Chatbot</h1>

          {/* File Upload Section */}
          <div className="bg-purple-50 p-6 rounded-lg shadow-inner">
            <label htmlFor="pdf-upload" className="block text-lg font-semibold text-purple-700 mb-3">
              Choose PDF File(s)
            </label>
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              multiple // Allow multiple file selection
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-700
                         file:mr-4 file:py-2 file:px-4
                         file:rounded-full file:border-0
                         file:text-sm file:font-semibold
                         file:bg-purple-500 file:text-white
                         hover:file:bg-purple-600 cursor-pointer"
            />
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
            <button
              onClick={handleUploadPDFs} 
              disabled={loading || selectedFiles.length === 0}
              className="mt-4 w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white py-3 px-6 rounded-full
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
          </div>

          {/* Summary Display Section */}
          {summary && (
            <div className="bg-green-50 p-6 rounded-lg shadow-inner">
              <h2 className="text-xl font-bold text-green-800 mb-3">Summary of documents:</h2>
              <p className="text-gray-700 leading-relaxed">{summary}</p>
            </div>
          )}

          {/* New: Compare PDFs Button */}
          <div className="bg-orange-50 p-6 rounded-lg shadow-inner">
            <h2 className="text-xl font-bold text-orange-800 mb-3">Document Comparison</h2>
            <button
              onClick={handleComparePDFs}
              disabled={comparing || allPdfData.length < 2} // Enable only if at least 2 PDFs are processed
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

          {/* New: Comparison Result Display Section */}
          {comparisonResult && (
            <div className="bg-yellow-50 p-6 rounded-lg shadow-inner">
              <h2 className="text-xl font-bold text-yellow-800 mb-3">Comparison Result:</h2>
              <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{comparisonResult}</p>
            </div>
          )}

          {/* Error Message Display Section */}
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md relative" role="alert">
              <strong className="font-bold">Error!</strong>
              <span className="block sm:inline ml-2">{error}</span>
            </div>
          )}
        </div>

        {/* Right Section: Chatbot Interface */}
        <div className="flex-1 flex flex-col space-y-4 bg-blue-50 p-6 rounded-xl shadow-inner">
          <h2 className="text-3xl font-bold text-center text-blue-800 mb-4">Chat with PDF(s)</h2>

          {/* Chat Messages Display Area */}
          <div ref={chatMessagesRef} className="flex-1 bg-white p-4 rounded-lg shadow-md overflow-y-auto h-96 custom-scrollbar">
            {chatMessages.length === 0 ? (
              <p className="text-gray-500 text-center mt-10">Upload PDF(s) to start chatting!</p>
            ) : (
              chatMessages.map((msg, index) => (
                <div
                  key={index}
                  className={`mb-3 p-3 rounded-lg max-w-[80%] ${
                    msg.sender === 'user'
                      ? 'bg-blue-500 text-white ml-auto rounded-br-none' // Style for user messages
                      : 'bg-gray-200 text-gray-800 mr-auto rounded-bl-none' // Style for bot messages
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
              className="flex-1 p-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-700"
              disabled={allPdfData.length === 0 || loading || isListening} // Disable if no PDF, loading, or listening
            />
            <button
              onClick={startListening}
              disabled={allPdfData.length === 0 || loading} // Disable if no PDF or loading
              className={`p-3 rounded-full shadow-md transition-all duration-200
                         ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-500 text-white hover:bg-blue-600'}
                         disabled:opacity-50 disabled:cursor-not-allowed`}
              title="Voice Input"
            >
              {isListening ? (
                // Microphone icon when listening
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
              ) : (
                // Microphone icon when not listening
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            <button
              onClick={() => handleAskQuestion(currentQuestion)}
              disabled={allPdfData.length === 0 || loading || !currentQuestion.trim()} // Disable if no PDF, loading, or empty question
              className="p-3 bg-indigo-500 text-white rounded-full shadow-md hover:bg-indigo-600 transition-colors duration-200
                         disabled:opacity-50 disabled:cursor-not-allowed"
              title="Send Question"
            >
              {/* Send icon */}
              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l.684-.275a1 1 0 00.51-.639L10 8.58l4.426 9.576a1 1 0 00.51.639l.684.275a1 1 0 001.169-1.409l-7-14z" />
              </svg>
            </button>
          </div>
        </div>
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
