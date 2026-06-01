const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

export function extractJsonObject(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Gemini response did not contain JSON: ${text}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function parseRestaurantText(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Set it in .env or GitHub Actions secrets.');
  }

  const prompt = `
You turn informal Korean community restaurant notes into clean public data.
Return only valid JSON. No markdown.

Rules:
- Remove slang, exaggeration, profanity, and casual community wording.
- Preserve useful caveats as a short public remark.
- If the original text suggests mixed opinions, strong taste preference, long waits, price concerns, or atmosphere issues, use a remark like "호불호 있음", "대기 가능성 있음", "가격대 확인 필요", or another short neutral Korean phrase.
- If no caveat exists, return an empty string for remark.
- Extract business hours or regular holiday notes only when the input explicitly contains them.
- Do not invent a full address.

Schema:
{
  "region": "string, Korean location such as 서울 서초구 방배동. If only a neighborhood is given, keep that neighborhood.",
  "name": "string, restaurant name",
  "menu": "string, representative menu or food category",
  "business_hours": "string, business hours if explicitly present, otherwise empty string",
  "holiday_note": "string, regular holiday or closure note if explicitly present, otherwise empty string",
  "remark": "string, short neutral Korean caveat or empty string"
}

Input: ${JSON.stringify(text)}
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n');
  if (!content) {
    throw new Error(`Gemini API returned no text: ${JSON.stringify(payload)}`);
  }

  const parsed = extractJsonObject(content);
  for (const key of ['region', 'name', 'menu']) {
    if (!parsed[key] || typeof parsed[key] !== 'string') {
      throw new Error(`Gemini JSON is missing a valid "${key}" field: ${content}`);
    }
  }

  return {
    region: parsed.region.trim(),
    name: parsed.name.trim(),
    menu: parsed.menu.trim(),
    business_hours: typeof parsed.business_hours === 'string' ? parsed.business_hours.trim() : '',
    holiday_note: typeof parsed.holiday_note === 'string' ? parsed.holiday_note.trim() : '',
    remark: typeof parsed.remark === 'string' ? parsed.remark.trim() : ''
  };
}
