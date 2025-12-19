
import { GoogleGenAI } from "@google/genai";
import { ComparisonReport } from "../types";

export const getAIAnalysis = async (report: ComparisonReport): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const statsDescription = report.similarityMatrix.map(s => 
    `Comparison of ${s.sampleA} and ${s.sampleB}: 
    - Pearson: ${s.pearson.toFixed(6)}
    - Cosine Similarity: ${s.cosine.toFixed(6)}
    - Normalized RMSE: ${s.rmse.toExponential(4)}
    - SID (Spectral Information Divergence): ${s.sid.toFixed(6)}.`
  ).join('\n');

  const dataSummary = report.samples.map(s => {
    const maxAbs = Math.max(...s.data.map(d => d.absorption));
    const peakW = s.data.find(d => d.absorption === maxAbs)?.wavelength;
    return `Sample ${s.name} peaks at ${peakW}nm (Abs: ${maxAbs.toFixed(4)}).`;
  }).join('\n');

  const prompt = `
    As a laboratory spectroscopy expert, interpret the high-precision UV absorption spectra of these water samples.
    
    Data Context:
    ${dataSummary}

    High-Precision Metrics:
    ${statsDescription}

    Analytical Focus:
    - Pearson and Cosine show general shape similarity.
    - SID (Spectral Information Divergence) is the most sensitive metric here; values < 0.001 indicate highly identical chemical signatures.
    - Use Normalized RMSE to discuss subtle deviations in specific absorption bands.

    Interpretation Request:
    1. Identify if samples are chemically identical or just visually similar.
    2. Suggest if discrepancies are due to trace organics, nitrates (peaks near 200-220nm), or humic substances (slopes 250-300nm).
    3. Provide a definitive final assessment for a lab report.
    
    Tone: Precise, scientific, and conclusive.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: { temperature: 0.3 }
    });
    return response.text || "No analysis generated.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "The analytical engine encountered an error. Check data formats.";
  }
};
