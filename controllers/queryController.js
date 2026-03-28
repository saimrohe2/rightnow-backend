const Scenario = require('../models/Scenario');
const fetch = require('node-fetch');

// Helper function to handle API delays if needed
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.findScenario = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ message: 'A message is required.' });
    }

    console.log("Querying AI for situation:", message);
    
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      console.error("Missing GEMINI_API_KEY in environment variables.");
      throw new Error('Gemini API key is not configured.');
    }

    // UPDATED: Using 'gemini-3-flash-preview' as per latest March 2026 documentation
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`;

    const prompt = `
      Analyze the user's situation in India and respond ONLY as a raw JSON object with these keys: "rights_text", "law_reference", "script".
      - "rights_text": Explain the user's main legal right.
      - "law_reference": State the specific Indian law or IPC section.
      - "script": Provide a polite statement the user can say. IMPORTANT: End this script with the disclaimer: "(Note: This information is for guidance and not a substitute for professional legal advice.)"
      
      User's situation: "${message}"
      JSON Response:
    `;

    // Fetch call with updated model and safety settings
    const apiResponse = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        safetySettings: [
            { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
        ]
      })
    });

    if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error("Gemini API Error Response:", errorText);
        throw new Error(`Gemini API responded with status: ${apiResponse.status}`);
    }

    const aiResponse = await apiResponse.json();

    // Check if the response exists and wasn't blocked
    if (!aiResponse.candidates || aiResponse.candidates.length === 0 || !aiResponse.candidates[0].content) {
        console.error("Gemini Response Blocked or Empty:", JSON.stringify(aiResponse, null, 2));
        return res.status(422).json({ 
            message: 'The AI could not process this legal query due to safety filters. Please rephrase.' 
        });
    }

    const aiText = aiResponse.candidates[0].content.parts[0].text;
    
    // Robust JSON cleaning using Regex to find the {} block
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : aiText;
    const parsedJson = JSON.parse(cleanJson);

    // --- Save to MongoDB ---
    try {
        const newScenario = new Scenario({
          title: message,
          rights_text: parsedJson.rights_text,
          law_reference: parsedJson.law_reference,
          script: parsedJson.script
        });
        await newScenario.save();
        console.log("Scenario saved to MongoDB successfully.");
    } catch (dbError) {
        console.error("Database Save Error (Response still sent to user):", dbError.message);
    }

    // Send successful response to frontend
    res.status(200).json(parsedJson);

  } catch (error) {
    console.error("!!! FATAL ERROR in findScenario:", error.message); 
    res.status(500).json({ 
        message: 'A server error occurred. Please try again.',
        error: error.message 
    });
  }
};
