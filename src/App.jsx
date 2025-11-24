import React, { useState, useEffect, useRef } from "react";
import { Upload, Send, FileText, X, Loader2, AlertCircle } from "lucide-react";

export default function App() {
  // Use your Vite env variable
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Welcome! Please upload a PDF file to begin asking questions about its content.",
    },
  ]);
  const [input, setInput] = useState("");
  const [pdfText, setPdfText] = useState("");
  const [fileName, setFileName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingPdf, setIsProcessingPdf] = useState(false);
  const [error, setError] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const chatEndRef = useRef(null);

  const lastCallTime = useRef(0); // persist across renders

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load PDF.js
  useEffect(() => {
    const pdfJsUrl =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";

    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      return;
    }

    const script = document.createElement("script");
    script.src = pdfJsUrl;
    script.async = true;
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }
    };
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Only PDF files are allowed.");
      return;
    }

    setFileName(file.name);
    setIsProcessingPdf(true);
    setShowUploadModal(false);
    setError("");

    event.target.value = null;

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (!window.pdfjsLib) throw new Error("PDF library not loaded");

      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer })
        .promise;

      let extractedText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str).join(" ");
        extractedText += `\nPage ${i}: ${pageText}`;
      }

      setPdfText(extractedText);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `The file "${file.name}" has been successfully processed and is ready for querying. Ask me anything about its content!`,
        },
      ]);
    } catch (err) {
      console.error("PDF Error:", err);
      setError(
        "Error reading the PDF. It might be encrypted, corrupted, or the PDF library failed to load."
      );
      setFileName("");
      setPdfText("");
    } finally {
      setIsProcessingPdf(false);
    }
  };

  // Gemini API call with exponential backoff
  const callGeminiAPI = async (userQuery, context, retries = 0) => {
    const now = Date.now();
    if (now - lastCallTime.current < 1000 && retries === 0) {
      return "Please wait a moment before sending another request.";
    }
    lastCallTime.current = now;

    const maxRetries = 3;
    const baseDelay = 1000;

    try {
      const truncatedContext = context.substring(0, 30000);
      const systemPrompt =
        "You are an intelligent PDF analysis assistant. Answer strictly based on the PDF content. If not available, say it's not in the document.";
      const finalPrompt = `PDF Context:\n---\n${truncatedContext}\n---\n\nUser Question: ${userQuery}`;

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: finalPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
        }),
      });

      if (response.status === 429 && retries < maxRetries) {
        const delay = baseDelay * Math.pow(2, retries) + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return callGeminiAPI(userQuery, context, retries + 1);
      }

      if (!response.ok) {
        const errorBody = await response.json();
        console.error("API Error Response:", errorBody);
        if (response.status === 403)
          return "Authentication failed (403). Check your API credentials.";
        throw new Error(
          `API Request Failed: ${response.status} - ${
            errorBody.error?.message || "Unknown error"
          }`
        );
      }

      const data = await response.json();
      return (
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Sorry, I couldn't generate a meaningful response."
      );
    } catch (err) {
      console.error("Gemini API Error:", err);
      return "An unexpected error occurred while processing your request. Try again shortly.";
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const userMessage = input.trim();

    if (!userMessage || isLoading || isProcessingPdf) return;
    if (!pdfText) {
      setError("Please upload and process a PDF first.");
      return;
    }

    setMessages((prev) => [...prev, { role: "user", text: userMessage }]);
    setInput("");
    setIsLoading(true);
    setError("");

    try {
      const aiResponse = await callGeminiAPI(userMessage, pdfText);
      setMessages((prev) => [...prev, { role: "assistant", text: aiResponse }]);
    } catch {
      setError("Failed to communicate with the AI model.");
    } finally {
      setIsLoading(false);
    }
  };

  const removeFile = () => {
    setPdfText("");
    setFileName("");
    setMessages([
      {
        role: "assistant",
        text: "File removed. Please upload a new PDF document to begin.",
      },
    ]);
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 font-sans transition-all">
      {/* Header */}
      <header className="bg-white px-6 py-4 shadow-xl border-b-4 border-yellow-500 rounded-b-lg flex justify-center items-center sticky top-0 z-10">
        <h1 className="text-3xl font-extrabold text-gray-800 tracking-tight">
          AI PDF Reader
        </h1>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 w-full pt-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`p-4 rounded-3xl shadow-lg max-w-[90%] sm:max-w-[70%] transition-all duration-300 ${
                  msg.role === "user"
                    ? "bg-yellow-500 text-white rounded-br-lg"
                    : "bg-white text-gray-800 border border-gray-200 rounded-tl-lg"
                }`}
                style={{ whiteSpace: "pre-wrap" }}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl shadow-md border border-gray-200">
                <Loader2 className="w-5 h-5 text-yellow-600 animate-spin" />
                <span className="text-gray-600">Thinking...</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>
      </main>

      {/* Footer */}
      <footer className="px-4 py-4 border-t border-gray-200 bg-white sticky bottom-0 z-10">
        <div className="max-w-3xl mx-auto space-y-4">
          {error && (
            <div className="flex items-center gap-2 text-red-700 text-sm bg-red-100 p-3 rounded-xl shadow-inner border border-red-300">
              <AlertCircle className="w-4 h-4" />
              <span className="font-medium">{error}</span>
            </div>
          )}

          {!fileName || isProcessingPdf ? (
            <div className="flex justify-center">
              <button
                onClick={() => setShowUploadModal(true)}
                className={`flex items-center gap-2 px-8 py-3 rounded-full font-semibold shadow-md transition-all ${
                  isProcessingPdf
                    ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                    : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                }`}
                disabled={isProcessingPdf}
              >
                {isProcessingPdf ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Processing PDF...
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" /> Upload PDF Document
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between bg-yellow-50 px-4 py-2 rounded-xl border border-yellow-300 shadow-inner">
              <div className="flex items-center gap-3 truncate">
                <FileText className="w-5 h-5 text-yellow-700" />
                <span className="truncate text-gray-700 font-medium">
                  {fileName}
                </span>
              </div>
              <button
                onClick={removeFile}
                className="text-gray-500 p-1 rounded-full hover:bg-yellow-200 hover:text-red-500 transition-all"
                aria-label="Remove File"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}

          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                fileName
                  ? "Ask your question about the document..."
                  : "Upload a PDF document to start chatting..."
              }
              className="flex-1 px-5 py-3 rounded-full border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-yellow-500 transition-all shadow-lg"
              disabled={!fileName || isLoading || isProcessingPdf}
            />
            <button
              type="submit"
              disabled={
                !input.trim() || !fileName || isLoading || isProcessingPdf
              }
              className="bg-yellow-500 hover:bg-yellow-600 text-white w-14 h-14 rounded-full shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-95 flex items-center justify-center"
              aria-label="Send Message"
            >
              <Send className="w-6 h-6" />
            </button>
          </form>
        </div>
      </footer>

      {/* Upload Modal */}
      {showUploadModal && (
        <div
          className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 p-4"
          onClick={() => !isProcessingPdf && setShowUploadModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl p-8 max-w-sm w-full flex flex-col items-center gap-6 transform transition-all duration-300 scale-100"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-gray-800">
              Choose a PDF Document
            </h2>
            <p className="text-gray-600 text-center">
              The AI will extract text from this file to answer your questions.
            </p>
            <label
              className={`flex items-center gap-3 px-6 py-3 rounded-xl border-4 border-dashed font-semibold cursor-pointer transition-all w-full justify-center ${
                isProcessingPdf
                  ? "bg-gray-100 text-gray-500 border-gray-300"
                  : "bg-yellow-50 text-yellow-700 border-yellow-300 hover:bg-yellow-100"
              }`}
            >
              <Upload className="w-5 h-5" /> Click to Select PDF
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isProcessingPdf}
              />
            </label>
            <button
              onClick={() => setShowUploadModal(false)}
              className="text-gray-500 hover:text-gray-700 text-sm mt-2 transition-colors"
              disabled={isProcessingPdf}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
