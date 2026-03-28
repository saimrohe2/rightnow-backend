const Scenario = require('../models/Scenario');
const fetch = require('node-fetch');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.findScenario = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ message: 'A message is required.' });
    }

    // --- AI Query Configuration ---
    console.log("Querying AI for:", message);
    
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      throw new Error('Gemini API key is not configured.');
    }

    // FIXED: Using v1beta and gemini-1.5-flash-latest for stability
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    const prompt = `
      Analyze the user's situation in India and respond ONLY as a raw JSON object with keys: "rights_text", "law_reference", "script".
      - "rights_text": Explain the user's main legal right.
      - "law_reference": State the specific Indian law or IPC section.
      - "script": Provide a polite statement the user can say. IMPORTANT: End this script with the disclaimer: "(Note: This information is for guidance and not a substitute for professional legal advice.)"
      User's situation: "${message}"
      JSON Response:
    `;

    // FIXED: Added missing 'const apiResponse = await fetch' declaration to fix SyntaxError
    const apiResponse = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Safety settings to prevent unnecessary blocking of legal topics
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

    if (!aiResponse.candidates || aiResponse.candidates.length === 0 || !aiResponse.candidates[0].content) {
        console.error("Gemini Response Blocked:", JSON.stringify(aiResponse, null, 2));
        throw new Error('AI response was blocked or empty due to safety filters.');
    }

    const aiText = aiResponse.candidates[0].content.parts[0].text;
    
    // Robust JSON cleaning to handle markdown code blocks (```json ... ```)
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    const cleanedText = jsonMatch ? jsonMatch[0] : aiText;
    const parsedJson = JSON.parse(cleanedText);

    // --- 3. Save to MongoDB ---
    try {
        const newScenario = new Scenario({
          title: message,
          rights_text: parsedJson.rights_text,
          law_reference: parsedJson.law_reference,
          script: parsedJson.script
        });
        await newScenario.save();
        console.log("Scenario saved successfully to MongoDB.");
    } catch (dbError) {
        console.error("Database save failed, but returning AI response anyway:", dbError.message);
    }

    res.status(200).json(parsedJson);

  } catch (error) {
    console.error("!!! FATAL ERROR in findScenario:", error.message); 
    res.status(500).json({ message: 'A server error occurred.', error: error.message });
  }
};
